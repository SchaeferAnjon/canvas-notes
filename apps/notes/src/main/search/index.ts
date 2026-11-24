/**
 * 三层搜索的主进程这一半：起搜索进程（utilityProcess，见 worker.ts）、把界面的查询转过去，
 * 以及「让 Claude 帮我找」（Claude Code 只读翻文件，过程一步步报给界面）。
 * 意思索引存在软件设置目录 userData/search/<库的指纹>/，不进库。
 */
import { app, type BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeFindResult, MeaningHit, RelatedNote, SearchStatus } from '../../shared/search'
import { engine, FAST_MODEL } from '../agent'
import { findCli, INSTALL_HINT } from '../agent/cli'
import type { Vault } from '../vault'
import { E2E } from '../test-mode'
import { FIND_SYSTEM, findPrompt, parseFound, toolStep } from './claude-find'
import { EmbedModel } from './embed-model'
import type { FromWorker, PassagesReply, Query, RelatedReply, ToWorker } from './protocol'

export interface SearchDeps {
  win(): BrowserWindow | null
  vault(): Vault | null
  /** 设置 › 文档和白板「按意思找」：关着时不载本机模型、不建意思索引（PDF 里的字照样搜） */
  semantic(): boolean
}

/** 包里的模型（打包时 extraResources 放进 Resources/models/）；开发时在 apps/notes/resources/models/；CN_MODEL_DIR 能换 */
function modelDir(): string | null {
  const dir = process.env.CN_MODEL_DIR || (app.isPackaged ? join(process.resourcesPath, 'models', 'multilingual-e5-small') : join(__dirname, '../../resources/models/multilingual-e5-small'))
  return existsSync(join(dir, 'onnx', 'model_quantized.onnx')) ? dir : null
}

/**
 * bge-m3 下到哪：用户级缓存（Mac 上 ~/Library/Caches/<软件名>/models/bge-m3；Electron 的 getPath 没有 cache 这一项），
 * 别的系统放软件设置目录里的 models/；CN_EMBED_DIR 能换
 */
const bigModelDir = () =>
  process.env.CN_EMBED_DIR ||
  (process.platform === 'darwin' ? join(app.getPath('home'), 'Library', 'Caches', app.getName(), 'models', 'bge-m3') : join(app.getPath('userData'), 'models', 'bge-m3'))

let openVault: (root: string) => void = () => undefined
let reopen: () => void = () => undefined
let statusNow: () => SearchStatus = () => ({ phase: 'loading', done: 0, total: 0, files: 0 })
/** 搜索索引建到哪了（右栏「相关」写「正在读全库找像的」；对外接口也报这个，task-av5t8） */
export const searchStatus = () => statusNow()
let askRelated: (paths: string[], k: number) => Promise<RelatedReply> = async () => null

/** 每篇在全库里最像的几篇；model 是算它用的模型名（梦游报告要写） */
export type RelatedMap = Map<string, RelatedNote[]> & { model: string }

/**
 * 梦游补双链找候选：每篇在全库里按「两篇最像的那一对段落的余弦」取前 k 篇（不含自己），带回那一对段落的原文。
 * 读的就是搜索的那一份意思索引（不另算）。意思索引没开（「按意思找」关着、没有模型）或还没建完过一遍时是 null，梦游退回只用关键词。
 * 不在索引里的篇（新建还没算到、不是 md / PDF）给空数组
 */
export async function searchRelated(paths: string[], k = 5): Promise<RelatedMap | null> {
  const r = await askRelated(paths, k)
  if (!r) return null
  return Object.assign(new Map(r.related), { model: r.model })
}

let askPassages: (qs: string[], k: number) => Promise<PassagesReply> = async () => null
/**
 * 梦游 Wiki 化找候选的向量那一路：每句话在全库最像的 k 段（不先挑篇），带回那一段原文。读的就是搜索那一份意思索引；
 * 没开、没建完过一遍时是 null（梦游这晚只用名字、标题、关键词）
 */
export const searchPassages = (qs: string[], k = 8): Promise<PassagesReply> => askPassages(qs, k)

/** 换库、打开库时叫一声：搜索进程按这个库建索引 */
export const searchVault = (root: string) => openVault(root)
/** 「按意思找」开关换了：按新的样子重开索引 */
export const reopenSearch = () => reopen()

let meaningQ: (q: string) => Promise<MeaningHit[]> = () => Promise.reject(new Error('搜索还没起来'))
/** 按意思找（对外接口的 search_notes 用，task-av5t8）：和 ⌘K 的「意思相近」同一个索引 */
export const searchMeaning = (q: string) => meaningQ(q)

export function setupSearch(deps: SearchDeps) {
  let proc: UtilityProcess | null = null
  let root: string | null = null
  let quitting = false
  let seq = 0
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  let status: SearchStatus = { phase: 'loading', done: 0, total: 0, files: 0 }
  statusNow = () => status
  const send = (ch: string, ...args: unknown[]) => deps.win()?.webContents.send(ch, ...args)

  const post = (m: ToWorker) => proc!.postMessage(m)
  const embedModel = new EmbedModel({
    dir: bigModelDir(),
    fake: (E2E || process.env.CN_AI_FAKE === '1') && process.env.CN_EMBED_REAL !== '1',
    semantic: deps.semantic,
    onStatus: (s) => send('embed:status', s),
    onReady: (big) => {
      if (proc && root) post({ t: 'upgrade', big })
    },
    ...(process.env.CN_EMBED_DELAY_MS ? { delayMs: Number(process.env.CN_EMBED_DELAY_MS) } : {}),
    ...(process.env.CN_EMBED_FAKE_MS ? { fakeMs: Number(process.env.CN_EMBED_FAKE_MS) } : {}),
  })
  const openMsg = (r: string): ToWorker => {
    const on = deps.semantic()
    return { t: 'open', root: r, userData: app.getPath('userData'), indexDir: join(app.getPath('userData'), 'search', createHash('sha1').update(r).digest('hex').slice(0, 16)), modelDir: on ? modelDir() : null, big: on ? embedModel.big() : null }
  }
  const start = () => {
    proc = utilityProcess.fork(join(__dirname, 'search-worker.js'), [], { serviceName: '搜索索引', stdio: 'inherit' })
    proc.on('message', (m: FromWorker) => {
      if (m.t === 'status') {
        status = m.s
        send('search:status', m.s)
      } else if (m.t === 'embed') {
        embedModel.fromWorker(m.s)
      } else {
        const p = pending.get(m.id)
        pending.delete(m.id)
        if (m.ok) p?.resolve(m.value)
        else p?.reject(new Error(m.error))
      }
    })
    proc.on('exit', (code) => {
      proc = null
      for (const p of pending.values()) p.reject(new Error(`搜索进程退出了（${code}）`))
      pending.clear()
      if (quitting) return
      status = { phase: 'error', done: 0, total: 0, files: 0, error: `搜索进程退出了（${code}），下次搜索时重开` }
      send('search:status', status)
    })
  }
  const ensure = () => {
    if (proc) return
    if (!root) throw new Error('还没有打开库')
    start()
    post(openMsg(root))
  }
  const ask = <T>(m: Query): Promise<T> => {
    ensure()
    const id = ++seq
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      post({ ...m, id })
    })
  }

  openVault = (r) => {
    root = r
    if (proc) post(openMsg(r))
    else ensure()
    embedModel.sync()
  }
  reopen = () => {
    if (root && proc) post(openMsg(root))
    embedModel.sync()
  }
  // 搜索进程还在读库、建索引（不是 ready）时不排队等它：梦游这晚只用关键词和标题（task-h7oy8）
  askRelated = async (paths, k) => (root && status.phase === 'ready' ? ask<RelatedReply>({ t: 'related', paths: paths.filter((p): p is string => typeof p === 'string'), k: Math.max(0, Math.floor(k)) }) : null)
  askPassages = async (qs, k) => (root && status.phase === 'ready' ? ask<PassagesReply>({ t: 'passages', qs: qs.filter((q): q is string => typeof q === 'string').map((q) => q.slice(0, 500)), k: Math.max(1, Math.min(20, Math.floor(k))) }) : null)
  // 测试从主进程里直接叫（app.evaluate 拿不到模块的导出），e2e/h7oy8-embed-model 用
  if (E2E) (globalThis as unknown as { cnSearchRelated: typeof searchRelated }).cnSearchRelated = searchRelated
  app.on('will-quit', () => {
    quitting = true
    embedModel.stop()
    proc?.kill()
  })

  const needQ = (q: unknown) => {
    if (typeof q !== 'string') throw new Error('搜索的词不对')
    return q.slice(0, 500)
  }
  ipcMain.handle('search:pdfText', (_e, q: unknown) => ask({ t: 'pdfText', q: needQ(q) }))
  ipcMain.handle('search:meaning', (_e, q: unknown) => ask({ t: 'meaning', q: needQ(q) }))
  meaningQ = (q) => ask<MeaningHit[]>({ t: 'meaning', q: needQ(q) })
  ipcMain.handle('search:status', () => status)
  ipcMain.handle('embed:status', () => embedModel.status())
  ipcMain.handle('embed:retry', () => embedModel.retry())

  // ---------- 让 Claude 帮我找 ----------
  const finding = new Map<number, AbortController>()
  ipcMain.handle('search:claude:stop', (_e, id: number) => finding.get(id)?.abort())
  ipcMain.handle('search:claude', async (_e, id: unknown, q: unknown): Promise<ClaudeFindResult> => {
    if (typeof id !== 'number') throw new Error('参数不对')
    const query = needQ(q).trim()
    const v = deps.vault()
    if (!v) throw new Error('还没有打开库')
    if (process.env.CN_AI_FAKE !== '1' && !findCli('claude')) return { found: [], looked: 0, error: INSTALL_HINT.claude }
    const ac = new AbortController()
    finding.set(id, ac)
    const read = new Set<string>()
    try {
      const r = await engine('claude').run({
        prompt: findPrompt(query),
        system: FIND_SYSTEM,
        cwd: v.root,
        readOnly: true,
        model: FAST_MODEL,
        signal: ac.signal,
        onText: () => undefined,
        onTool: (name, input) => {
          const step = toolStep(name, input, v.root)
          if (name === 'Read' && typeof input.file_path === 'string') read.add(input.file_path)
          if (step) send('search:claude:event', id, { type: 'step', text: step })
        },
      })
      const found = parseFound(r.text, v.root).filter((f) => {
        try {
          return existsSync(v.abs(f.path))
        } catch {
          return false // 库外的路径
        }
      })
      return { found, looked: read.size }
    } catch (e) {
      return { found: [], looked: read.size, error: (e as Error).name === 'AbortError' || ac.signal.aborted ? '停下了' : String((e as Error).message ?? e) }
    } finally {
      finding.delete(id)
    }
  })
}
