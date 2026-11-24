/**
 * 大一点的本机模型 bge-m3（MIT，BAAI），GGUF 版，用 node-llama-cpp（llama.cpp）跑在显卡上（Metal）。
 * 2026-11-23 起不用 ONNX 版：ONNX 在 CPU 上一段要几百毫秒，真库 7 万段要算一整天；GGUF 走显卡快一个数量级（评测那一路实测 2875 篇 15 分钟）。
 * 不进安装包：第一次用时下到用户级缓存（embed-model.ts 管下载），下好、校验过、索引建完以前搜索和梦游先用 e5-small（onnxruntime）顶着。
 * 用法：不加前缀；池化按 GGUF 里写的（bge-m3 是 CLS），再归一化。每段最多 512 个词元，长的截掉。
 * 只在搜索进程（utilityProcess）里载，主进程不碰；算完一阵（IDLE_MS）没新活就放掉上下文，不占着显存。
 * 分数分得开：不相干的多在 0.3 上下，同一主题 0.6 到 0.75，重复 0.9 上下。
 */
import { join } from 'node:path'
import type { LlamaEmbeddingContext } from 'node-llama-cpp'
import type { Embedder } from './embedder'
import type { ModelFile } from './model-fetch'

export const BGE_MODEL = 'bge-m3-q8_0'
/** 测试模式的假下载以后用的「bge-m3」（其实是 e5 换了个名字，见 worker.ts 的 loadBig），报告里一眼看得出是假的 */
export const BGE_FAKE_MODEL = 'bge-m3-fake'
const REPO = 'ggml-org/bge-m3-Q8_0-GGUF'
const REV = '9eba04c5d75ba5a1595e45de734d36bef4e5cb98'
/** 主地址、备用地址（hf-mirror.com 是 Hugging Face 的国内镜像，同一个提交号同一份文件，sha256 对得上才用） */
export const BGE_BASES = [`https://huggingface.co/${REPO}/resolve/${REV}`, `https://hf-mirror.com/${REPO}/resolve/${REV}`]
/** llama.cpp 官方（ggml-org）转的 Q8_0，一个文件 */
export const BGE_FILES: ModelFile[] = [{ file: 'bge-m3-q8_0.gguf', size: 634553760, sha256: 'aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173' }]
const DIMS = 1024
/**
 * 意思相近那一层的门槛（indexer 的 MEANING 是按 e5 量的）。bge-m3 和套话（FILLER）的分数本身就高（0.3 到 0.7），
 * 看「比套话高多少」：像真库的样本（e2e/fixtures/meaning-vault.ts）上，GGUF Q8_0 版不沾边的 26 个最高 0.068（张三），
 * 沾边的 30 个除 borrow checker 0.019、看极光 0.061、特征直 0.065（e5 也漏这三个）以外最低 0.072（zettelkasten），所以 over 卡 0.07。
 * （ONNX int8 版量的是 0.059 和 0.076，同一道线。）分数拉得比 e5 开（第二名常比第一名低 0.04 到 0.08），near 放到 0.05；spread 同理放到 0.05。
 * 重新量：CN_BGE_DIR=<目录> CN_MEASURE=1 npx vitest run apps/notes/test/search-bge.test.ts
 */
const BGE_GATE = { limit: 5, near: 0.05, over: 0.07, spread: 0.05 }
/** 一段最多多少个词元（连开头结尾两个记号）：chunks.ts 一段最多 360 字（PDF 540 字），中文约一字一个词元，512 够；更长的截掉 */
const MAX_TOKENS = 512
/** 没活多久放掉上下文（模型本身留着，下次只重建上下文，几十毫秒） */
const IDLE_MS = 3000

/** file 默认 BGE_FILES 那一个；测试里能换成别的量化（比 F16 和 Q8_0） */
export async function bgeEmbedder(modelDir: string, file = BGE_FILES[0]!.file, name = BGE_MODEL): Promise<Embedder> {
  // node-llama-cpp 只出 ESM：用 import() 载入（原样放在 node_modules 里，不打进 bundle）。build: 'never'：只用包里带的预编译
  const { getLlama, LlamaLogLevel } = await import('node-llama-cpp')
  const llama = await getLlama({ gpu: 'auto', build: 'never', logLevel: LlamaLogLevel.error, progressLogs: false })
  const model = await llama.loadModel({ modelPath: join(modelDir, file) })
  const bos = model.tokens.bos
  if (bos === null) throw new Error('bge-m3 的 GGUF 里没有开头记号 <s>')
  let ctx: Promise<LlamaEmbeddingContext> | null = null
  let busy = 0
  let timer: NodeJS.Timeout | null = null
  const release = () => {
    const c = ctx
    ctx = null
    void c?.then((x) => x.dispose())
  }
  return {
    model: name,
    dims: DIMS,
    gate: BGE_GATE,
    async embed(texts) {
      if (!texts.length) return []
      if (timer) clearTimeout(timer)
      busy++
      try {
        // BERT 一类的模型整段要在一批里算完：批和上下文都给 1024，比 512 宽
        ctx ??= model.createEmbeddingContext({ contextSize: 1024, batchSize: 1024 })
        const c = await ctx
        const out: Float32Array[] = []
        for (const t of texts) {
          const toks = model.tokenize(t)
          // 开头的 <s> 自己加：node-llama-cpp 3.22 对 bge-m3 这种 UGM 分词的模型不加（withcatai/node-llama-cpp#683），
          // bge-m3 取第一个词元当整段的向量，少了它就拿了第一个字（「朱高煦造反」配讲朱高煦的那段只有 0.25，加上是 0.57，和 ONNX 版一致）。
          // 结尾的 </s> 它照常加；以后它修好了也不会加两个（开头已经是 <s> 就不再加）
          const e = await c.getEmbeddingFor([bos, ...(toks.length > MAX_TOKENS - 2 ? toks.slice(0, MAX_TOKENS - 2) : toks)])
          if (e.vector.length !== DIMS) throw new Error(`模型输出 ${e.vector.length} 维，应该是 ${DIMS} 维`)
          out.push(normalize(Float32Array.from(e.vector)))
        }
        return out
      } finally {
        if (--busy === 0) timer = setTimeout(release, IDLE_MS).unref()
      }
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
