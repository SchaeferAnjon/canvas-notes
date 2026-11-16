/**
 * 搜索进程（Electron utilityProcess）：读 PDF 的字、算向量、查询都在这里，不卡界面和主进程。
 * 自己盯着库：文件变了等 1.5 秒没动静再扫一遍（只算新的和改了的）。优先级调低，建索引时不和界面抢 CPU。
 */
import { watch, type FSWatcher } from 'node:fs'
import { setPriority } from 'node:os'
import type { SearchStatus } from '../../shared/search'
import { e5Embedder } from './embedder'
import { Indexer } from './indexer'
import { readPdfText } from './pdf-read'
import type { ToWorker } from './protocol'

const port = process.parentPort
let ix: Indexer | null = null
let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | null = null
let opening: Promise<void> | null = null

try {
  setPriority(10)
} catch {
  // 调不了优先级（权限）就照常跑
}

const post = (m: unknown) => port.postMessage(m)
const status = (s: SearchStatus) => post({ t: 'status', s })

async function open(m: Extract<ToWorker, { t: 'open' }>) {
  ix?.close()
  watcher?.close()
  if (timer) clearTimeout(timer)
  status({ phase: 'loading', done: 0, total: 0, files: 0 })
  let embedder = null
  if (m.modelDir) {
    try {
      embedder = await e5Embedder(m.modelDir)
    } catch (e) {
      status({ phase: 'error', done: 0, total: 0, files: 0, error: `本机模型载入不了：${(e as Error).message}` })
    }
  }
  const me = new Indexer({ root: m.root, userData: m.userData, indexDir: m.indexDir, embedder, readPdf: readPdfText, onStatus: status })
  ix = me
  status(me.state)
  watcher = watch(m.root, { recursive: true }, (_e, name) => {
    if (!name || /(^|[\\/])\.(git|trash|canvas-notes)([\\/]|$)/.test(name)) return
    if (!/\.(md|pdf)$/i.test(name)) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void me.scan(), 1500)
  })
  void me.scan()
}

port.on('message', async (e) => {
  const m = e.data as ToWorker
  if (m.t === 'open') {
    opening = open(m)
    return
  }
  if (m.t === 'scan') {
    await opening
    void ix?.scan()
    return
  }
  try {
    await opening
    const value = m.t === 'pdfText' ? (ix?.pdfSearch(m.q) ?? []) : ((await ix?.meaning(m.q)) ?? [])
    post({ t: 'reply', id: m.id, ok: true, value })
  } catch (err) {
    post({ t: 'reply', id: m.id, ok: false, error: String((err as Error).message ?? err) })
  }
})
