/**
 * 评测找候选用的本机向量：给一个 ONNX 模型目录（tokenizer.json + onnx/model_quantized.onnx）。
 * bge-m3（Xenova 转的 int8，梦游方案已定换它）：取第一个词元（CLS）再归一化，不加前缀；
 * 目录名里有 e5 的按软件里搜索那样（「query: / passage: 」前缀、按词元取平均）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Embed {
  name: string
  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>
}

const MAX_TOKENS = 512

export async function onnxEmbedder(dir: string, threads = 8): Promise<Embed> {
  const ort = await import('onnxruntime-node')
  const { Tokenizer } = await import('@huggingface/tokenizers')
  const tok = new Tokenizer(JSON.parse(readFileSync(join(dir, 'tokenizer.json'), 'utf8')), JSON.parse(readFileSync(join(dir, 'tokenizer_config.json'), 'utf8')))
  const session = await ort.InferenceSession.create(join(dir, 'onnx', 'model_quantized.onnx'), { intraOpNumThreads: threads, graphOptimizationLevel: 'all' })
  const e5 = /e5/i.test(dir)
  const typeIds = session.inputNames.includes('token_type_ids')
  return {
    name: e5 ? 'multilingual-e5-small' : 'bge-m3',
    async embed(texts, kind) {
      if (!texts.length) return []
      const encs = texts.map((t) => {
        const ids = tok.encode(e5 ? `${kind}: ${t}` : t).ids
        return ids.length > MAX_TOKENS ? [...ids.slice(0, MAX_TOKENS - 1), ids[ids.length - 1]!] : ids
      })
      const n = encs.length
      const L = Math.max(...encs.map((e) => e.length))
      const ids = new BigInt64Array(n * L)
      const mask = new BigInt64Array(n * L)
      encs.forEach((e, i) =>
        e.forEach((id, j) => {
          ids[i * L + j] = BigInt(id)
          mask[i * L + j] = 1n
        }),
      )
      const feeds: Record<string, InstanceType<typeof ort.Tensor>> = {
        input_ids: new ort.Tensor('int64', ids, [n, L]),
        attention_mask: new ort.Tensor('int64', mask, [n, L]),
      }
      if (typeIds) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(n * L), [n, L])
      const out = (await session.run(feeds))[session.outputNames[0]!]!
      const D = out.dims[2]!
      const data = out.data as Float32Array
      return encs.map((e, i) => {
        const v = new Float32Array(D)
        if (e5) {
          for (let j = 0; j < e.length; j++) for (let k = 0; k < D; k++) v[k]! += data[(i * L + j) * D + k]!
        } else for (let k = 0; k < D; k++) v[k] = data[i * L * D + k]!
        let s = 0
        for (const x of v) s += x * x
        s = Math.sqrt(s) || 1
        for (let k = 0; k < D; k++) v[k]! /= s
        return v
      })
    },
  }
}

/**
 * 同一个模型的 OpenAI 兼容向量接口（llama-server --embedding --pooling cls、Ollama 都行）：用显卡算，比 ONNX 在 CPU 上快十来倍。
 * 评测只要「找候选用的是 bge-m3」，模型文件是 GGUF 还是 ONNX 不影响结论。
 */
export function httpEmbedder(url: string, name = 'bge-m3'): Embed {
  return {
    name,
    async embed(texts) {
      if (!texts.length) return []
      const post = () =>
        fetch(`${url}/v1/embeddings`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input: texts.map((t) => t.toWellFormed()) }),
          signal: AbortSignal.timeout(120_000),
        })
      // 本机服务偶尔断一次连接（别的进程也在用它），再问一次
      const r = await post().catch(post)
      if (!r.ok) throw new Error(`向量接口 ${r.status}：${(await r.text()).slice(0, 200)}`)
      const j = (await r.json()) as { data: { index: number; embedding: number[] }[] }
      return j.data
        .sort((a, b) => a.index - b.index)
        .map((d) => {
          const v = Float32Array.from(d.embedding)
          let s = 0
          for (const x of v) s += x * x
          s = Math.sqrt(s) || 1
          for (let k = 0; k < v.length; k++) v[k]! /= s
          return v
        })
    },
  }
}

/** 一篇切成几段（每段约 600 字，最多 8 段）；篇和篇的相似度取最像的两段 */
export function chunksOf(title: string, text: string, size = 600, max = 8): string[] {
  // 按字切（不按 UTF-16 码元），表情符号不会被切成半个
  const t = Array.from(`${title}\n${text}`)
  const out: string[] = []
  for (let i = 0; i < t.length && out.length < max; i += size) out.push(t.slice(i, i + size).join(''))
  return out
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

export function maxSim(xs: Float32Array[], ys: Float32Array[]): number {
  let best = -1
  for (const x of xs) for (const y of ys) best = Math.max(best, dot(x, y))
  return best
}
