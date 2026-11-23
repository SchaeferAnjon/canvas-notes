/**
 * 本机小模型算向量：multilingual-e5-small（MIT，intfloat，Xenova 转的 int8 ONNX，118 MB，384 维），
 * onnxruntime-node 跑，分词用 @huggingface/tokenizers（纯 JS）。中英文都认，不联网。
 * e5 的用法：查询前面加「query: 」，被找的段前面加「passage: 」，最后一层按词元取平均再归一化。
 * 只在搜索进程里用（utilityProcess），不卡界面和主进程。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface Embedder {
  /** 模型的名字（索引按它认，换了模型整个重建） */
  model: string
  dims: number
  embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[]>
  /** 意思相近那一层多像才出（不给用 indexer 的 MEANING，那是按 e5 量的；各模型分数的范围不一样） */
  gate?: { limit: number; near: number; over: number; spread: number }
}

export const E5_MODEL = 'multilingual-e5-small-int8'
/** 一次最多多少个词元（e5 是 512） */
const MAX_TOKENS = 512

export async function e5Embedder(modelDir: string, threads = 4): Promise<Embedder> {
  // 原生模块和分词器只在真要用时才载入（单元测试、没有模型的开发环境用不着）
  const ort = await import('onnxruntime-node')
  const { Tokenizer } = await import('@huggingface/tokenizers')
  const tok = new Tokenizer(JSON.parse(readFileSync(join(modelDir, 'tokenizer.json'), 'utf8')), JSON.parse(readFileSync(join(modelDir, 'tokenizer_config.json'), 'utf8')))
  const session = await ort.InferenceSession.create(join(modelDir, 'onnx', 'model_quantized.onnx'), {
    intraOpNumThreads: threads,
    graphOptimizationLevel: 'all',
    // 算完就歇着：默认线程算完还空转一阵等下一批，后台建索引时白白占着 CPU
    extra: { session: { intra_op: { allow_spinning: '0' }, inter_op: { allow_spinning: '0' } } },
  })
  const typeIds = session.inputNames.includes('token_type_ids')
  const dims = 384
  return {
    model: E5_MODEL,
    dims,
    async embed(texts, kind) {
      if (!texts.length) return []
      const encs = texts.map((t) => {
        const ids = tok.encode(`${kind}: ${t}`).ids
        // 太长的截掉，末尾的结束符留着
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
      if (D !== dims) throw new Error(`模型输出 ${D} 维，应该是 ${dims} 维`)
      const data = out.data as Float32Array
      return encs.map((e, i) => {
        const v = new Float32Array(D)
        for (let j = 0; j < e.length; j++) {
          const off = (i * L + j) * D
          for (let k = 0; k < D; k++) v[k]! += data[off + k]!
        }
        return normalize(v)
      })
    },
  }
}

function normalize(v: Float32Array): Float32Array {
  let s = 0
  for (const x of v) s += x * x
  s = Math.sqrt(s) || 1
  for (let k = 0; k < v.length; k++) v[k]! /= s
  return v
}

/**
 * 单元测试用的假模型：按字（和英文词）算词袋向量，同字多的就像。
 * 再加一张小同义词表，测「意思相近」的那一层在界面上怎么排；真搜索不用它。
 */
export function fakeEmbedder(dims = 64): Embedder {
  const SAME: Record<string, string> = { 变换: '映射', 映射: '映射', 矩阵: '矩阵', matrix: '矩阵', map: '映射', rotation: '旋转', 旋转: '旋转' }
  return {
    model: 'fake',
    dims,
    async embed(texts) {
      return texts.map((t) => {
        const v = new Float32Array(dims)
        let s = t.toLowerCase()
        for (const [k, w] of Object.entries(SAME)) s = s.split(k).join(` ${w} `)
        const units = s.match(/[a-z0-9]+|[^\sa-z0-9]/g) ?? []
        for (const u of units) {
          let h = 2166136261
          for (const ch of u) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0
          v[h % dims]! += 1
        }
        return normalize(v)
      })
    },
  }
}
