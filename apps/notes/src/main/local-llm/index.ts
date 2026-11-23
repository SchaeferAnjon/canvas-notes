/**
 * 本地模型（task-h7oy8）：梦游判断「两篇是不是讲同一件事」不走订阅时用这台 Mac 自己跑的小模型。
 * - 模型第一次用时下载到用户级缓存 ~/Library/Caches/<名字>/llm/（CN_LLM_DIR 能换），不进安装包；断点续传、校验 sha256、能取消，进度推给界面。
 * - 推理在单独的 utilityProcess（worker.ts）里，主进程、界面不卡；闲 5 分钟或退出时结束那个进程，内存还回去。
 * - 选的哪个模型存在 userData/local-llm.json。
 * - CN_AI_FAKE=1：下载不联网，CN_FAKE_LLM_MS（默认 3000）里假装走完进度、写一个假文件；localAsk 转给 ai.ts 的 ask（梦游的假回答）。
 */
import { app, type BrowserWindow, ipcMain, shell, utilityProcess, type UtilityProcess } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { totalmem } from 'node:os'
import { join } from 'node:path'
import { BRAND } from '../../shared/brand'
import { t } from '../../shared/i18n'
import { DEFAULT_LOCAL_MODEL, type LocalLlmStatus, type LocalModel, localModel } from '../../shared/local-models'
import { ask } from '../ai'
import { E2E } from '../test-mode'
import { downloadFile, partOf, partSize } from './download'
import type { AskStats, FromWorker, ToWorker } from './protocol'
// 只拿类型：node-llama-cpp 只在模型进程里载入
import type { GbnfJsonSchema } from 'node-llama-cpp'

const FAKE = () => process.env.CN_AI_FAKE === '1'
/** 闲这么久没问就结束模型进程（梦游一晚连着问，问完放掉约 3 GB 内存） */
const IDLE_MS = 5 * 60_000

// Electron 的 app.getPath 没有 'cache'：Mac 的用户级缓存是 ~/Library/Caches（只出 Mac 版）
export const llmDir = () => process.env.CN_LLM_DIR || join(app.getPath('home'), 'Library', 'Caches', BRAND.name, 'llm')
const prefsFile = () => join(app.getPath('userData'), 'local-llm.json')
const fileOf = (m: LocalModel) => join(llmDir(), m.file)

let win: () => BrowserWindow | null = () => null
let chosen: string | null = null
/** 正在做的（下载、校验、载入、出错）；没在做时按文件在不在算 missing / ready */
let busy: Pick<LocalLlmStatus, 'phase' | 'got' | 'total' | 'speed' | 'error'> | null = null
/** 上次下载为什么没下成（网络、校验），回到 missing 时还带着 */
let lastStop: string | undefined
let dl: { id: string; ac: AbortController; done: Promise<LocalLlmStatus> } | null = null

function current(): LocalModel {
  if (chosen === null) {
    try {
      chosen = (JSON.parse(readFileSync(prefsFile(), 'utf8')) as { model?: string }).model ?? DEFAULT_LOCAL_MODEL
    } catch {
      chosen = DEFAULT_LOCAL_MODEL
    }
  }
  return localModel(chosen) ?? localModel(DEFAULT_LOCAL_MODEL)!
}

/** 本地模型现在怎样 */
export function localLlmStatus(): LocalLlmStatus {
  const m = current()
  const base = { model: m.id, dir: llmDir(), ram: totalmem(), appleSilicon: process.platform === 'darwin' && process.arch === 'arm64' }
  if (busy) return { ...base, ...busy }
  if (existsSync(fileOf(m))) return { ...base, phase: 'ready', got: m.size, total: m.size }
  const got = partGot(m)
  return { ...base, phase: 'missing', ...(got ? { got, total: m.size } : {}), ...(lastStop ? { error: lastStop } : {}) }
}

/** 已经下了多少（.part 的大小；假下载记在内存里） */
const partGot = (m: LocalModel) => (FAKE() ? (fakeGot.get(m.id) ?? 0) : partSize(fileOf(m)))

const emit = () => win()?.webContents.send('llm:changed', localLlmStatus())
function setBusy(b: typeof busy) {
  busy = b
  emit()
}

/** 选哪个模型（下拉）：换了就停掉另一个的下载、结束载着旧模型的进程 */
export function localLlmSetModel(id: string): LocalLlmStatus {
  if (!localModel(id)) throw new Error(t('没有这个本地模型：{id}', { id }))
  if (dl && dl.id !== id) dl.ac.abort()
  if (id !== current().id) {
    chosen = id
    lastStop = undefined
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(prefsFile(), JSON.stringify({ model: id }, null, 2))
    stopWorker()
  }
  emit()
  return localLlmStatus()
}

/** 下载（不给 id 下选着的那个；给了先选上它）。下好、取消、出错都回最后的状态，不报错；正在下同一个就等那一次 */
export function localLlmDownload(id?: string): Promise<LocalLlmStatus> {
  if (id) localLlmSetModel(id)
  const m = current()
  if (dl?.id === m.id) return dl.done
  if (existsSync(fileOf(m))) return Promise.resolve(localLlmStatus())
  const ac = new AbortController()
  lastStop = undefined
  const done = (async () => {
    try {
      mkdirSync(llmDir(), { recursive: true })
      setBusy({ phase: 'downloading', got: partGot(m), total: m.size })
      let last = 0
      const onProgress = (p: { phase: 'downloading' | 'verifying'; got: number; total: number; speed?: number }) => {
        // 进度最多一秒推五次；换阶段立刻推
        const now = Date.now()
        if (p.phase === busy?.phase && now - last < 200 && p.got < p.total) return
        last = now
        setBusy(p)
      }
      if (FAKE()) await fakeDownload(m, ac.signal, onProgress)
      else await downloadFile({ urls: m.urls, dest: fileOf(m), size: m.size, sha256: m.sha256, signal: ac.signal, onProgress })
    } catch (e) {
      // 自己点的取消不算出错：卡上写「下了一部分」和「继续下载」就够了
      lastStop = (e as Error).name === 'AbortError' ? undefined : (e as Error).message
    } finally {
      // 换了模型、另一个已经接着下了：别把它的进度清掉
      if (dl?.ac === ac) {
        dl = null
        busy = null
        emit()
      }
    }
    return localLlmStatus()
  })()
  dl = { id: m.id, ac, done }
  return done
}

/** 停下正在下的（.part 留着，下次接着下） */
export function localLlmCancel(): void {
  dl?.ac.abort()
}

// ---------- 测试模式的假下载 ----------
const fakeGot = new Map<string, number>()
async function fakeDownload(m: LocalModel, signal: AbortSignal, onProgress: (p: { phase: 'downloading' | 'verifying'; got: number; total: number; speed?: number }) => void) {
  const ms = Number(process.env.CN_FAKE_LLM_MS) || 3000
  const speed = (m.size / ms) * 1000
  const tick = () =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 100)
      signal.addEventListener('abort', () => (clearTimeout(timer), reject(Object.assign(new Error(t('停下了')), { name: 'AbortError' }))), { once: true })
    })
  let got = fakeGot.get(m.id) ?? 0
  while (got < m.size) {
    await tick()
    got = Math.min(m.size, got + speed / 10)
    fakeGot.set(m.id, got)
    onProgress({ phase: 'downloading', got: Math.round(got), total: m.size, speed })
  }
  for (let i = 1; i <= 3; i++) {
    await tick()
    onProgress({ phase: 'verifying', got: Math.round((m.size * i) / 3), total: m.size })
  }
  writeFileSync(fileOf(m), 'CN_AI_FAKE fake model file\n')
  fakeGot.delete(m.id)
}

// ---------- 推理进程 ----------
let proc: UtilityProcess | null = null
let procModel: string | null = null
let loaded: Promise<void> | null = null
let idle: NodeJS.Timeout | undefined
let seq = 0
const pending = new Map<number, { resolve(v: { text: string; stats: AskStats }): void; reject(e: Error): void }>()
let quitting = false

/** 最近一问的用时（测试和实测看），loadMs 是这次进程载入模型用了多久 */
export const llmStats: { loadMs: number | null; loadSteps: { llama: number; model: number; context: number } | null; contextSize: number | null; last: AskStats | null } = { loadMs: null, loadSteps: null, contextSize: null, last: null }

function stopWorker() {
  clearTimeout(idle)
  proc?.kill()
  proc = null
  procModel = null
  loaded = null
}

function startWorker(m: LocalModel): Promise<void> {
  const p = utilityProcess.fork(join(__dirname, 'llm-worker.js'), [], { serviceName: t('本地模型'), stdio: 'inherit' })
  proc = p
  procModel = m.id
  llmStats.loadMs = null
  setBusy({ phase: 'loading' })
  return new Promise<void>((resolve, reject) => {
    p.on('message', (msg: FromWorker) => {
      if (msg.t === 'loaded') {
        llmStats.loadMs = msg.ms
        llmStats.loadSteps = msg.steps
        llmStats.contextSize = msg.contextSize
        setBusy(null)
        resolve()
      } else if (msg.t === 'loadError') {
        setBusy({ phase: 'error', error: t('本地模型载入不了：{why}', { why: msg.error }) })
        reject(new Error(t('本地模型载入不了：{why}', { why: msg.error })))
        stopWorker()
      } else {
        const q = pending.get(msg.id)
        pending.delete(msg.id)
        if (!q) return
        if (msg.ok) q.resolve(msg)
        else if (msg.aborted) q.reject(Object.assign(new Error(t('停下了')), { name: 'AbortError' }))
        else q.reject(new Error(humanError(msg.error)))
      }
    })
    p.on('exit', (code) => {
      if (proc === p) {
        proc = null
        procModel = null
        loaded = null
      }
      const why = t('本地模型的进程退出了（{code}），可能是内存不够', { code })
      for (const q of pending.values()) q.reject(new Error(why))
      pending.clear()
      reject(new Error(why))
      if (quitting) return
      if (busy?.phase === 'loading') setBusy({ phase: 'error', error: why })
    })
    p.postMessage({ t: 'load', path: fileOf(m), thinks: !!m.thinks } satisfies ToWorker)
  })
}

function humanError(raw: string): string {
  const long = /^too long: (\d+) tokens, context (\d+)/.exec(raw)
  if (long) return t('这一问太长，本地模型一次看不了（{n} 个 token，最多 {max}）', { n: Number(long[1]), max: Number(long[2]) })
  return t('本地模型出错：{why}', { why: raw })
}

export interface LocalAskOpts {
  signal: AbortSignal
  /** 最多回多少 token（默认 1024） */
  maxTokens?: number
  /** 只许回合法的 JSON（node-llama-cpp 的 JSON 语法约束）；提示里照样要说清楚要什么字段 */
  json?: boolean
  /**
   * 再严一点：按这个 JSON Schema 生成（字段、枚举、const、数组条数 minItems / maxItems / prefixItems 都管得住），
   * 给了就不用 json。实测只给 json 时 4B 会把第二条写到数组外面、1.7B 五个候选只回一条；给 schema 后没再出现。
   * 支持的写法见 node-llama-cpp 的 GbnfJsonSchema（JSON Schema 的一个子集，不认 minimum / maximum）
   */
  schema?: GbnfJsonSchema
}

/** 用本地模型问一次；没下好、不是 Apple 芯片时抛一句人话；停下时抛 AbortError */
export async function localAsk(system: string, prompt: string, o: LocalAskOpts): Promise<string> {
  const m = current()
  if (FAKE()) {
    if (process.env.CN_FAKE_PICK_LOG) appendFileSync(process.env.CN_FAKE_PICK_LOG, JSON.stringify({ cmd: '', feature: 'local', model: m.id, json: !!(o.json || o.schema), prompt }) + '\n')
    return ask(system, prompt, o.signal, undefined, 'dream')
  }
  if (!(process.platform === 'darwin' && process.arch === 'arm64')) throw new Error(t('本地模型只能在 Apple 芯片的 Mac 上跑'))
  if (!existsSync(fileOf(m))) throw new Error(t('本地模型还没下好，设置 › 梦游里点下载'))
  if (o.signal.aborted) throw Object.assign(new Error(t('停下了')), { name: 'AbortError' })
  clearTimeout(idle)
  if (!proc || procModel !== m.id || !loaded) {
    stopWorker()
    loaded = startWorker(m)
  }
  await loaded
  const id = ++seq
  const p = proc!
  const stop = () => p.postMessage({ t: 'abort', id } satisfies ToWorker)
  o.signal.addEventListener('abort', stop, { once: true })
  try {
    const r = await new Promise<{ text: string; stats: AskStats }>((resolve, reject) => {
      pending.set(id, { resolve, reject })
      p.postMessage({ t: 'ask', id, system, prompt, maxTokens: o.maxTokens ?? 1024, json: !!o.json, schema: o.schema } satisfies ToWorker)
    })
    llmStats.last = r.stats
    return r.text
  } finally {
    o.signal.removeEventListener('abort', stop)
    if (!pending.size) idle = setTimeout(stopWorker, IDLE_MS)
  }
}

export function setupLocalLlm(deps: { win(): BrowserWindow | null }) {
  win = deps.win
  const id = (v: unknown) => {
    if (typeof v !== 'string') throw new Error(t('参数不对'))
    return v
  }
  ipcMain.handle('llm:status', () => localLlmStatus())
  ipcMain.handle('llm:download', (_e, v: unknown) => localLlmDownload(v == null ? undefined : id(v)))
  ipcMain.handle('llm:cancel', () => localLlmCancel())
  ipcMain.handle('llm:setModel', (_e, v: unknown) => localLlmSetModel(id(v)))
  // 「在访达中显示」：下好了选中那个模型文件，没下好打开放模型的文件夹（没有就先建）
  ipcMain.handle('llm:reveal', () => {
    const f = fileOf(current())
    if (existsSync(f)) return shell.showItemInFolder(f)
    mkdirSync(llmDir(), { recursive: true })
    return void shell.openPath(llmDir())
  })
  app.on('will-quit', () => {
    quitting = true
    dl?.ac.abort()
    stopWorker()
  })
  // 测试、实测从主进程直接问（e2e 用 app.evaluate 调）
  if (E2E) (globalThis as unknown as { cnLocalLlm: unknown }).cnLocalLlm = { ask: localAsk, stats: llmStats, status: localLlmStatus, stop: stopWorker, part: (mid: string) => partOf(fileOf(localModel(mid)!)) }
}
