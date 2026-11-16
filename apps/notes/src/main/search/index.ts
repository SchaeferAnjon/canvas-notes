/**
 * 三层搜索的主进程这一半：起搜索进程（utilityProcess，见 worker.ts）、把界面的查询转过去，
 * 以及「让 Claude 帮我找」（Claude Code 只读翻文件，过程一步步报给界面）。
 * 意思索引存在软件设置目录 userData/search/<库的指纹>/，不进库。
 */
import { app, type BrowserWindow, ipcMain, utilityProcess, type UtilityProcess } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeFindResult, SearchStatus } from '../../shared/search'
import { engine, FAST_MODEL } from '../agent'
import { findCli, INSTALL_HINT } from '../agent/cli'
import type { Vault } from '../vault'
import { FIND_SYSTEM, findPrompt, parseFound, toolStep } from './claude-find'
import type { FromWorker, Query, ToWorker } from './protocol'

export interface SearchDeps {
  win(): BrowserWindow | null
  vault(): Vault | null
}

/** 包里的模型（打包时 extraResources 放进 Resources/models/）；开发时在 apps/notes/resources/models/；CN_MODEL_DIR 能换 */
function modelDir(): string | null {
  const dir = process.env.CN_MODEL_DIR || (app.isPackaged ? join(process.resourcesPath, 'models', 'multilingual-e5-small') : join(__dirname, '../../resources/models/multilingual-e5-small'))
  return existsSync(join(dir, 'onnx', 'model_quantized.onnx')) ? dir : null
}

let openVault: (root: string) => void = () => undefined

/** 换库、打开库时叫一声：搜索进程按这个库建索引 */
export const searchVault = (root: string) => openVault(root)

export function setupSearch(deps: SearchDeps) {
  let proc: UtilityProcess | null = null
  let root: string | null = null
  let quitting = false
  let seq = 0
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()
  let status: SearchStatus = { phase: 'loading', done: 0, total: 0, files: 0 }
  const send = (ch: string, ...args: unknown[]) => deps.win()?.webContents.send(ch, ...args)

  const post = (m: ToWorker) => proc!.postMessage(m)
  const openMsg = (r: string): ToWorker => ({ t: 'open', root: r, userData: app.getPath('userData'), indexDir: join(app.getPath('userData'), 'search', createHash('sha1').update(r).digest('hex').slice(0, 16)), modelDir: modelDir() })
  const start = () => {
    proc = utilityProcess.fork(join(__dirname, 'search-worker.js'), [], { serviceName: '搜索索引', stdio: 'inherit' })
    proc.on('message', (m: FromWorker) => {
      if (m.t === 'status') {
        status = m.s
        send('search:status', m.s)
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
  }
  app.on('will-quit', () => {
    quitting = true
    proc?.kill()
  })

  const needQ = (q: unknown) => {
    if (typeof q !== 'string') throw new Error('搜索的词不对')
    return q.slice(0, 500)
  }
  ipcMain.handle('search:pdfText', (_e, q: unknown) => ask({ t: 'pdfText', q: needQ(q) }))
  ipcMain.handle('search:meaning', (_e, q: unknown) => ask({ t: 'meaning', q: needQ(q) }))
  ipcMain.handle('search:status', () => status)

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
