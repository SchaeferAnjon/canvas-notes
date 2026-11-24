/**
 * 搜索进程（Electron utilityProcess）：读 PDF 的字、算向量、查询都在这里，不卡界面和主进程。
 * 自己盯着库：文件变了等 1.5 秒没动静再扫一遍（只算新的和改了的）。优先级调低，建索引时不和界面抢 CPU。
 *
 * 换模型（e5-small → bge-m3）：大模型下好以前只有 e5 那一份索引；下好以后在后台用 bge-m3 另建一份（indexDir/bge-m3/），
 * 建完以前查询、梦游照用 e5 的；建完换过去，e5 那份删掉（全软件只留一份索引）。以后打开时 bge-m3 那份建完过就直接用它，不再载 e5。
 */
// bge-m3 跑在 node-llama-cpp 上：打好的包里它找自带文件夹要先补上 fs.access（赶在它载入以前）
import './asar-access'
import { watch, type FSWatcher } from 'node:fs'
import { rm } from 'node:fs/promises'
import { setPriority } from 'node:os'
import { join } from 'node:path'
import type { SearchStatus } from '../../shared/search'
import { BGE_FAKE_MODEL, BGE_MODEL, bgeEmbedder } from './bge'
import { e5Embedder, type Embedder, fakeEmbedder } from './embedder'
import { Indexer } from './indexer'
import { ortScorer, type Scorer } from './matmul'
import { readPdfText } from './pdf-read'
import type { BigModel, EmbedFromWorker, PassagesReply, RelatedReply, ToWorker } from './protocol'
import { VectorIndex } from './vector-index'

type Open = Extract<ToWorker, { t: 'open' }>

const port = process.parentPort
/** 查询用的那一份 */
let ix: Indexer | null = null
/** 正在用大模型建的那一份（建完换成 ix） */
let next: Indexer | null = null
let small: Embedder | null = null
let cur: Open | null = null
let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null
let opening: Promise<void> | null = null
let embedState: EmbedFromWorker = { model: null, big: 'none', done: 0, total: 0 }

try {
  setPriority(10)
} catch {
  // 调不了优先级（权限）就照常跑
}

const post = (m: unknown) => port.postMessage(m)
const status = (s: SearchStatus) => post({ t: 'status', s })
const embed = (s: Partial<EmbedFromWorker>) => {
  embedState = { ...embedState, ...s }
  if (!s.error) delete embedState.error
  post({ t: 'embed', s: embedState })
}

const bigDir = (m: Open) => join(m.indexDir, 'bge-m3')
const bigName = (big: BigModel) => (big.fake ? BGE_FAKE_MODEL : BGE_MODEL)

/** 测试模式的「bge-m3」：e5 换个名字（没有 e5 时用假模型），向量和门槛都是 e5 的，老的搜索测试照样过 */
async function loadBig(big: BigModel): Promise<Embedder> {
  if (!big.fake) return bgeEmbedder(big.dir)
  const base = small ?? fakeEmbedder()
  return { ...base, model: BGE_FAKE_MODEL }
}

/** searchRelated 的点乘交给 onnxruntime（第一次用时载） */
let scorer: Promise<Scorer> | null = null
const score: Scorer = async (...args) => (await (scorer ??= ortScorer()))(...args)

function makeIndexer(m: Open, embedder: Embedder | null, indexDir: string): Indexer {
  const me: Indexer = new Indexer({ root: m.root, userData: m.userData, indexDir, embedder, readPdf: readPdfText, onStatus: (s) => onStatus(me, s), scorer: score })
  return me
}

/** 一份索引报的状态：查询用的那份照旧报给界面；在建的那份报成「建索引 N / M 段」，建完换过去 */
function onStatus(me: Indexer, s: SearchStatus) {
  if (me === ix) {
    status(s)
    return
  }
  if (me !== next) return
  if (s.phase === 'error') {
    embed({ big: 'error', error: s.error ?? '' })
    ix?.resumeEmbed()
  }
  else if (s.phase === 'ready' && me.built) swap(me)
  else embed({ big: 'indexing', done: s.phase === 'embed' ? s.done : 0, total: s.phase === 'embed' ? s.total : 0 })
}

function swap(me: Indexer) {
  const old = ix
  ix = me
  next = null
  old?.close()
  status(me.state)
  embed({ model: me.model, big: 'ready', done: embedState.total, total: embedState.total })
  // 旧模型那份索引不再要了
  if (old?.model && cur) for (const f of ['index.json', 'vectors.f32']) void rm(join(cur.indexDir, f), { force: true })
}

/** 用大模型另建一份；载入不了报错，查询照用现在的 */
async function startBig(m: Open, big: BigModel) {
  let emb: Embedder
  try {
    emb = await loadBig(big)
  } catch (e) {
    embed({ big: 'error', error: `bge-m3 载入不了：${(e as Error).message}` })
    return
  }
  if (cur !== m) return
  const me = makeIndexer(m, emb, bigDir(m))
  next = me
  // e5 那份先不再算向量：两份一起算，大模型那份慢 4 倍（同一个进程、JS 线程轮着用）；查询照用 e5 已有的
  ix?.holdEmbed()
  embed({ big: 'indexing', done: 0, total: 0 })
  void me.scan()
}

async function open(m: Open) {
  ix?.close()
  next?.close()
  ix = null
  next = null
  watcher?.close()
  if (timer) clearTimeout(timer)
  cur = m
  status({ phase: 'loading', done: 0, total: 0, files: 0 })
  embedState = { model: null, big: 'none', done: 0, total: 0 }
  // 大模型那份建完过：直接用它，不载 e5
  const peek = m.big ? VectorIndex.peek(bigDir(m)) : null
  if (m.big && peek?.built && peek.model === bigName(m.big)) {
    try {
      if (m.big.fake && m.modelDir) small = await e5Embedder(m.modelDir)
      ix = makeIndexer(m, await loadBig(m.big), bigDir(m))
      embed({ model: ix.model, big: 'ready' })
    } catch (e) {
      embed({ big: 'error', error: `bge-m3 载入不了：${(e as Error).message}` })
      ix = null
    }
  }
  if (!ix) {
    small = null
    if (m.modelDir) {
      try {
        small = await e5Embedder(m.modelDir)
      } catch (e) {
        status({ phase: 'error', done: 0, total: 0, files: 0, error: `本机模型载入不了：${(e as Error).message}` })
      }
    }
    ix = makeIndexer(m, small, m.indexDir)
    embed({ model: ix.model })
    if (m.big && embedState.big !== 'error') void startBig(m, m.big)
  }
  const me = ix
  status(me.state)
  watcher = watch(m.root, { recursive: true }, (_e, name) => {
    if (!name || /(^|[\\/])\.(git|trash|canvas-notes)([\\/]|$)/.test(name)) return
    if (!/\.(md|pdf)$/i.test(name)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      void ix?.scan()
      void next?.scan()
    }, 1500)
  })
  void me.scan()
}

async function related(paths: string[], k: number): Promise<RelatedReply> {
  const me = ix
  if (!me?.model || !me.built) return null
  const map = await me.related(paths, k)
  return { model: me.model, related: [...map] }
}

async function passages(qs: string[], k: number): Promise<PassagesReply> {
  const me = ix
  if (!me?.model || !me.built) return null
  return { model: me.model, hits: await me.passages(qs, k) }
}

port.on('message', async (e) => {
  const m = e.data as ToWorker
  if (m.t === 'open') {
    opening = open(m)
    return
  }
  if (m.t === 'upgrade') {
    await opening
    if (!cur || next || embedState.big === 'ready' || !cur.modelDir) return
    cur = { ...cur, big: m.big }
    void startBig(cur, m.big)
    return
  }
  if (m.t === 'scan') {
    await opening
    void ix?.scan()
    void next?.scan()
    return
  }
  try {
    await opening
    // 测试用：搜索进程回得慢（刚启动、机器忙时要载模型、起进程），看 ⌘K 回车会不会被它拖住（e2e/wuv05-cmdk-capture）
    const slow = Number(process.env.CN_E2E_SLOW_SEARCH_MS) || 0
    if (slow) await new Promise((r) => setTimeout(r, slow))
    const value = m.t === 'pdfText' ? (ix?.pdfSearch(m.q) ?? []) : m.t === 'meaning' ? ((await ix?.meaning(m.q)) ?? []) : m.t === 'passages' ? await passages(m.qs, m.k) : await related(m.paths, m.k)
    post({ t: 'reply', id: m.id, ok: true, value })
  } catch (err) {
    post({ t: 'reply', id: m.id, ok: false, error: String((err as Error).message ?? err) })
  }
})
