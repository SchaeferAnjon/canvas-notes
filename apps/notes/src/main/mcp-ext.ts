/**
 * 设置 › 对外接口的主进程这半（task-av5t8，方案 46-对外开放MCP 第一批）：
 * - 总开关开着时听本机 socket（设置目录里的 mcp.sock，权限 600），小程序 canvas-notes-mcp 把各家 AI 的调用交过来；
 *   关着时没有 socket 文件。按钥匙认是哪家（mcp.json），跑工具（mcp/tools.ts，用库的全文缓存和意思索引），记调用记录。
 * - 每家一行：Claude Code、Codex「装上」写进它们的 MCP 配置；Claude 桌面版、别的 AI「拷贝配置」；ParaRead、MeetCaption「接上」写一份接法。
 * - open_note 走「打开笔记，到这一行」那条路（note:openAt），库还没打开、界面还没听上时最多等 15 秒。
 * 测试模式：拷贝配置不碰剪贴板、在不在这台 Mac 上只看测试给的临时家目录（CN_CLI_HOME_ONLY），打开时不把窗口拿到前面。
 */
import type { Installed } from '@cn/family'
import { app, type BrowserWindow, clipboard, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { configEnv, configPath, configSnippet, install, installedKey, uninstall } from '../mcp/install'
import type { NoteSource } from '../mcp/notes'
import { appendCall, briefArgs, clientOfKey, newKey, readCalls, readMcpFile, socketPath, userDataDir, writeMcpFile } from '../mcp/store'
import { runTool, type ToolHost } from '../mcp/tools'
import { serveWire, type WireRequest, type WireResult } from '../mcp/wire'
import { MCP_CLIENTS, type McpCall, type McpClientId, type McpLaunch, type McpRow, type McpView } from '../shared/mcp'
import type { MeaningHit, SearchStatus } from '../shared/search'
import { findCli } from '@cn/ai-engines'
import { E2E } from './test-mode'
import type { Vault } from './vault'

export interface McpExtDeps {
  userData: string
  vault(): Vault | null
  /** 库开着、界面听上了（能交 note:openAt） */
  ready(): boolean
  win(): BrowserWindow | null
  /** 开过的库（settings.json 的 knownVaults，新的在前） */
  knownVaults(): string[]
  /** 设置 › 文档和白板「按意思找」 */
  semantic(): boolean
  meaning(q: string): Promise<MeaningHit[]>
  meaningStatus(): SearchStatus
  /** 软件家族装了哪些（ParaRead、MeetCaption 那两行） */
  familyInstalled(): Promise<Installed>
}

const OFF = 'Canvas Notes’ connection for other AI apps is turned off. Ask the user to turn it on in Canvas Notes › Settings › External access (对外接口).'
const BAD_KEY = 'Canvas Notes does not recognize this key (it was disconnected or replaced). Ask the user to install this app again in Canvas Notes › Settings › External access (对外接口).'

/** 写进各家配置的那一段：装好的软件用包里的 bin/canvas-notes-mcp；开发、测试用同一个 Electron 当 Node 跑 out/main/mcp-stdio.js */
export function launchOf(userData: string): McpLaunch {
  const env: Record<string, string> = userData === userDataDir({}) ? {} : { CN_USER_DATA: userData }
  if (app.isPackaged) return { command: join(process.resourcesPath, 'bin', 'canvas-notes-mcp'), args: [], env }
  return { command: process.execPath, args: [join(__dirname, 'mcp-stdio.js')], env: { ELECTRON_RUN_AS_NODE: '1', ...env } }
}

/** 这家在不在这台 Mac 上（命令行、App）；测试模式只看临时家目录 */
function appFound(name: string): boolean {
  const home = homedir()
  const roots = process.env.CN_CLI_HOME_ONLY === '1' ? [join(home, 'Applications')] : ['/Applications', join(home, 'Applications')]
  return roots.some((r) => existsSync(join(r, name)))
}

export function setupMcpExt(d: McpExtDeps) {
  const userData = d.userData
  let wire: { close(): Promise<void> } | null = null
  const send = (ch: string, ...a: unknown[]) => d.win()?.webContents.send(ch, ...a)

  const source = (v: Vault): NoteSource => ({
    root: v.root,
    files: async () => (await v.list()).map((f) => ({ path: f.path, mtimeMs: f.mtimeMs })),
    texts: () => v.texts(),
  })

  const waitReady = async (ms: number) => {
    const until = Date.now() + ms
    while (!d.ready() && Date.now() < until) await new Promise((r) => setTimeout(r, 200))
    return d.ready()
  }

  const host = (): ToolHost => {
    const v = d.vault()
    return {
      src: v ? source(v) : null,
      appRunning: true,
      vaults: () =>
        d
          .knownVaults()
          .filter((p) => existsSync(p))
          .map((p) => ({ name: basename(p), path: p, open: p === v?.root })),
      meaning: async (q, limit) => {
        if (!d.semantic()) return { off: 'meaning search is turned off in Canvas Notes (Settings › Documents › Search by meaning)' }
        const st = d.meaningStatus()
        if (st.phase === 'off') return { off: 'the meaning model is not on this Mac' }
        if (st.phase === 'error') return { off: `the meaning index has a problem: ${st.error ?? ''}` }
        if (st.phase !== 'ready') return { off: `the meaning index is still being built (${st.done}/${st.total})` }
        return { hits: (await d.meaning(q)).slice(0, limit * 2) }
      },
      open: async (path, line) => {
        if (!(await waitReady(15_000))) throw new Error('Canvas Notes has not finished opening the vault; try again in a moment.')
        const w = d.win()!
        w.webContents.send('note:openAt', { file: path, line })
        if (!E2E) {
          w.show()
          app.focus({ steal: true })
        }
      },
    }
  }

  const handle = async (r: WireRequest): Promise<WireResult> => {
    const f = readMcpFile(userData)
    const at = Date.now()
    const log = (c: Omit<McpCall, 'at' | 'tool' | 'args'>) => {
      const call: McpCall = { at, tool: r.tool, args: briefArgs(r.args), ...c }
      appendCall(userData, call)
      send('mcp:called', call)
    }
    if (!f.on) return { text: OFF, isError: true }
    const client = clientOfKey(f, r.key)
    if (!client) {
      log({ client: null, ok: false, chars: BAD_KEY.length, error: BAD_KEY })
      return { text: BAD_KEY, isError: true }
    }
    const out = await runTool(r.tool, r.args, host())
    log({ client, ok: !out.isError, chars: out.text.length, ...out.log })
    return { structured: out.structured, text: out.text, isError: out.isError }
  }

  const start = async () => {
    if (wire) return
    wire = await serveWire(socketPath(userData), handle)
  }
  const stop = async () => {
    const w = wire
    wire = null
    await w?.close()
  }

  // ---------- 设置页 ----------

  const env = () => configEnv()
  const found = async (id: McpClientId, fam: Installed): Promise<{ found: boolean; version?: string }> => {
    switch (id) {
      case 'claude-code':
        return { found: !!findCli('claude') }
      case 'codex':
        return { found: !!findCli('codex') }
      case 'claude-desktop':
        return { found: appFound('Claude.app') }
      case 'pararead':
      case 'meetcaption': {
        const hit = fam[id]
        return hit ? { found: true, version: hit.version ?? undefined } : { found: false }
      }
      case 'other':
        return { found: true }
    }
  }

  const view = async (): Promise<McpView> => {
    const f = readMcpFile(userData)
    const since = Date.now() - 7 * 86_400_000
    const calls = readCalls(userData, { since })
    const fam = await d.familyInstalled()
    const rows: McpRow[] = []
    for (const id of MCP_CLIENTS) {
      const key = f.clients[id]?.key
      const mine = calls.filter((c) => c.client === id)
      const inConfig = installedKey(id, env(), userData)
      rows.push({
        id,
        keyed: !!key,
        installed: id === 'other' ? !!key : !!key && inConfig === key,
        ...(await found(id, fam)),
        ...(configPath(id, env(), userData) ? { configPath: configPath(id, env(), userData)! } : {}),
        lastUsed: mine[0]?.at ?? null,
        calls7: mine.length,
      })
    }
    return { on: f.on, rows, calls7: calls.length, failed7: calls.filter((c) => !c.ok).length }
  }

  const needId = (id: unknown): McpClientId => {
    if (typeof id !== 'string' || !(MCP_CLIENTS as readonly string[]).includes(id)) throw new Error('不认识这一家')
    return id as McpClientId
  }

  ipcMain.handle('mcp:get', () => view())
  ipcMain.handle('mcp:recheck', () => view())
  ipcMain.handle('mcp:setOn', async (_e, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('开关的参数不对')
    writeMcpFile(userData, { ...readMcpFile(userData), on })
    if (on) await start()
    else await stop()
    return view()
  })
  ipcMain.handle('mcp:install', async (_e, raw: unknown) => {
    const id = needId(raw)
    if (id === 'claude-desktop' || id === 'other') throw new Error('这一家用「拷贝配置」')
    const f = readMcpFile(userData)
    const key = newKey()
    install(id, env(), userData, launchOf(userData), key)
    writeMcpFile(userData, { ...f, clients: { ...f.clients, [id]: { key, level: 'read', at: Date.now() } } })
    return view()
  })
  ipcMain.handle('mcp:remove', async (_e, raw: unknown) => {
    const id = needId(raw)
    uninstall(id, env(), userData)
    const f = readMcpFile(userData)
    const clients = { ...f.clients }
    delete clients[id]
    writeMcpFile(userData, { ...f, clients })
    return view()
  })
  ipcMain.handle('mcp:copyConfig', async (_e, raw: unknown) => {
    const id = needId(raw)
    const f = readMcpFile(userData)
    let key = f.clients[id]?.key
    if (!key) {
      key = newKey()
      writeMcpFile(userData, { ...f, clients: { ...f.clients, [id]: { key, level: 'read', at: Date.now() } } })
    }
    const text = configSnippet(launchOf(userData), key)
    if (E2E) (globalThis as unknown as { cnScreen?: string[] }).cnScreen?.push(`拷贝配置 ${id}`)
    else clipboard.writeText(text)
    return text
  })
  ipcMain.handle('mcp:copyText', (_e, text: unknown) => {
    if (typeof text !== 'string' || text.length > 4000) throw new Error('参数不对')
    if (E2E) (globalThis as unknown as { cnScreen?: string[] }).cnScreen?.push(`拷贝 ${text}`)
    else clipboard.writeText(text)
  })
  ipcMain.handle('mcp:calls', (_e, q: unknown) => {
    const o = (q ?? {}) as { days?: unknown; client?: unknown }
    const days = typeof o.days === 'number' && o.days > 0 && o.days <= 366 ? o.days : 7
    const client = o.client === undefined ? undefined : o.client === null ? null : needId(o.client)
    return readCalls(userData, { since: Date.now() - days * 86_400_000, client, limit: 500 })
  })

  app.on('will-quit', () => void stop())

  return {
    /** 打开软件时：开着就听 socket */
    async open() {
      if (readMcpFile(userData).on) await start()
    },
  }
}
