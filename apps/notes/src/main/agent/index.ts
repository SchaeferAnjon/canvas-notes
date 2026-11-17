/**
 * AI 浮窗的主进程这一半：选引擎、跑一轮对话（边生成边发给界面）、给 AI 动手的 MCP 工具、
 * 把这一轮 AI 改的文件做成一次只含 AI 改动的提交。
 *
 * 一轮里 AI 第一次改某个文件前，先把这个文件里用户没提交的字单独提交（和 ai:change 一样），
 * 这样 AI 的那次提交里只有 AI 的改动，撤回才不会带走用户的字。
 */
import { app, type BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import * as git from '@cn/git'
import type { AgentContext, AiEvent, BridgeOp, EngineId, EngineInfo, StoredMsg, TurnRequest, TurnResult } from '../../shared/agent'
import { type AiFeature, type AiPick, type AiPrefs, CLAUDE_DEFAULT, FEATURES, pickLabel, resolvePick } from '../../shared/ai-features'
import { BRAND } from '../../shared/brand'
import { logActivity } from '../activity'
import type { Vault } from '../vault'
import type { Size } from './board-ops'
import { findCli, INSTALL_HINT } from './cli'
import { claudeEngine, codexEngine, type Engine, geminiEngine, LABELS, opencodeEngine } from './engines'
import { fakeEngine } from './fake-engine'
import { pastedImages } from '../pasted'
import { type McpServer, startMcpServer } from './mcp-server'
import { AgentStore } from './store'
import { runTool, type ToolHost, toolLabel, toolSpecs } from './tools'
import * as web from './web'

export { attachWeb } from './web'

const FAKE = () => process.env.CN_AI_FAKE === '1'
const IDS: EngineId[] = ['claude', 'codex', 'gemini', 'opencode']

export const AGENT_SYSTEM = `你是 ${BRAND.name} 笔记软件里的助手，帮一个人整理和写作自己的笔记。库目录就是你的工作目录，里面是普通 md 文件（白板也是 md：卡片写在 <!-- card --> 注释后面）。

你能直接操作这个软件（canvas 这组工具）：
- 网页（web_*）：在右栏的内置浏览器里打开网址、读页面文字和链接、点击、输入、滚动、把选中的字或整页剪进收件箱。
- 白板（board_*）：列出卡片和列、加卡片、改卡片内容、挪位置、放进列、连线、按网格或按列排整齐。改之前先 board_list 拿到 id。
- 文档（doc_*）：读当前文档、在光标处插入、替换选中的字。
- notes_list、note_read 看库里有什么。

规矩：
- 用户在看网页就用 web_*，在白板上就用 board_*，在文档里就用 doc_*；每条消息开头写着用户现在在看什么。
- 改笔记只用这些工具，不要自己写文件、不要跑命令。改动会自动成为一次 Git 提交，用户能一键撤回，所以直接做，不用先问。
- 做完用一两句话说做了什么。用中文回答，平实、直接，不客套。不编造笔记里没有的事。`

let engines: Partial<Record<EngineId, Engine>> = {}

/** 读 PDF 边读边问也用同一组引擎（同一个进程、同一个假引擎） */
export function engine(id: EngineId): Engine {
  if (FAKE()) return (engines[id] ??= fakeEngine(id))
  return (engines[id] ??= id === 'claude' ? claudeEngine() : id === 'codex' ? codexEngine() : id === 'gemini' ? geminiEngine() : opencodeEngine())
}

/** 这一轮：记下 AI 改了哪些文件 */
interface Turn {
  id: number
  context: AgentContext
  touched: Map<string, string>
  /** 已经先提交过用户的字的文件 */
  checked: Set<string>
}

export interface AgentDeps {
  win(): BrowserWindow | null
  vault(): Vault | null
}

let store: AgentStore
let current: Turn | null = null
let mcp: McpServer | null = null
let deps: AgentDeps

function send(channel: string, ...args: unknown[]) {
  deps.win()?.webContents.send(channel, ...args)
}

function needVault(): Vault {
  const v = deps.vault()
  if (!v) throw new Error('还没有打开库')
  return v
}

// ---------- 请界面做事（编辑器、标签、右栏只有界面拿得到） ----------

let callSeq = 0
const calls = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: NodeJS.Timeout }>()

export function bridge<T>(op: BridgeOp, arg?: unknown): Promise<T> {
  const win = deps.win()
  if (!win) return Promise.reject(new Error('窗口关了'))
  const id = ++callSeq
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      calls.delete(id)
      reject(new Error('软件界面没有回应'))
    }, 30_000)
    calls.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
    win.webContents.send('ai:call', id, op, arg)
  })
}

// ---------- 工具落到哪里 ----------

function needTurn(): Turn {
  if (!current) throw new Error('现在没有正在进行的对话')
  return current
}

/** 第一次改这个文件前：用户没提交的字先单独提交 */
async function beforeEdit(path: string) {
  const t = needTurn()
  if (t.checked.has(path)) return
  t.checked.add(path)
  const v = needVault()
  const pending = (await git.status(v.root)).filter((s) => s.path === path)
  if (pending.length) await git.commitPaths(v.root, [path], git.describeChanges(pending))
}

const host: ToolHost = {
  context: () => bridge<AgentContext>('context'),
  listNotes: () => needVault().list(),
  readNote: async (path) => {
    await bridge('saveAll')
    return (await needVault().read(path)).text
  },
  async editNote(path, change) {
    const v = needVault()
    const t = needTurn()
    await bridge('saveAll')
    await beforeEdit(path)
    const cur = (await v.read(path)).text
    const next = change(cur)
    if (next === cur) return
    const r = await v.write(path, next, cur)
    if (!r.ok) throw new Error('文件刚被改过，再试一次')
    if (!t.touched.has(path)) t.touched.set(path, '改')
    // 主进程写的，监听不到；打开着这篇的编辑器要收到，按外部改动合并
    send('note:changed', path, next)
  },
  measure: (path) => bridge<Record<string, Size>>('measure', path),
  web: {
    async open(url) {
      if (!/^https?:\/\//i.test(url)) throw new Error('只开 http(s) 网址')
      const since = Date.now()
      const wc = web.webContents()
      if (wc) void wc.loadURL(url).catch(() => undefined)
      else await bridge('openWeb', url)
      const done = await web.waitLoaded(since)
      return { url: done.getURL(), title: done.getTitle() }
    },
    read: () => web.readPage(),
    click: (t) => web.click(t),
    type: (ref, text, submit) => web.type(ref, text, submit),
    scroll: (to) => web.scroll(to),
    async clip(whole) {
      const v = needVault()
      const c = await web.pageForClip(whole)
      const path = await v.clip(c.text, c.url, c.title.slice(0, 300))
      needTurn().touched.set(path, '新')
      await logActivity(v.root, { t: Date.now(), kind: 'clip', path })
      send('files:changed')
      return path
    },
  },
  doc: {
    read: () => bridge('docRead'),
    async insert(text) {
      const path = await docPath()
      await beforeEdit(path)
      await bridge('docInsert', { path, text })
      needTurn().touched.set(path, '改')
      return `插好了（${path}）`
    },
    async replaceSelection(text) {
      const path = await docPath()
      await beforeEdit(path)
      await bridge('docReplace', { path, text })
      needTurn().touched.set(path, '改')
      return `换好了（${path}）`
    },
  },
}

async function docPath(): Promise<string> {
  await bridge('saveAll')
  const ctx = await bridge<AgentContext>('context')
  if (ctx.tab.type !== 'note' || !ctx.tab.path || ctx.tab.mode === 'board') throw new Error('现在打开的不是文档。请用户先打开一篇文档（不是白板看法）。')
  return ctx.tab.path
}

async function ensureMcp(): Promise<McpServer> {
  if (mcp) return mcp
  mcp = await startMcpServer(
    {
      tools: toolSpecs,
      async call(name, args) {
        const t = needTurn()
        const step = `${t.id}-${Math.random().toString(36).slice(2, 8)}`
        const label = toolLabel(name, args)
        emit(t.id, { type: 'tool', id: step, label, status: 'run' })
        try {
          const r = await runTool(name, args, host)
          emit(t.id, { type: 'tool', id: step, label, status: 'ok' })
          return r
        } catch (e) {
          const detail = String((e as Error).message ?? e)
          emit(t.id, { type: 'tool', id: step, label, status: 'err', detail })
          return { text: detail, isError: true }
        }
      },
    },
    { name: 'canvas-notes', version: app.getVersion() },
  )
  return mcp
}

function emit(id: number, e: AiEvent) {
  send('ai:event', id, e)
}

function describeContext(c: AgentContext): string {
  const lines: string[] = []
  const t = c.tab
  if (t.type === 'note') lines.push(`当前标签：${t.board || t.mode === 'board' ? '白板' : '文档'}「${t.title}」（${t.path}）${t.mode === 'board' ? '，白板看法' : t.mode === 'source' ? '，源文件看法' : ''}`)
  else if (t.type === 'none') lines.push('当前标签：没有打开的标签')
  else lines.push(`当前标签：${t.title}`)
  lines.push(c.web.open ? `右栏网页：开着${c.web.url ? `，${c.web.url}` : '，还没打开网址'}` : '右栏网页：没开')
  if (c.selection) lines.push(`文档里选中的字：${c.selection}`)
  if (c.mentions?.length) lines.push(`用户 @ 点名的笔记：${c.mentions.join('、')}`)
  return lines.join('\n')
}

/** 会话接不上时补的最近几轮 */
function historyOf(msgs: StoredMsg[]): string | undefined {
  const recent = msgs.filter((m) => m.text).slice(-10)
  if (!recent.length) return undefined
  const lines = recent.map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${(m.text ?? '').slice(0, 600)}`)
  return `之前聊过的（供参考）：\n${lines.join('\n')}`
}

const turns = new Map<number, AbortController>()

async function runTurn(req: TurnRequest): Promise<TurnResult> {
  if (!IDS.includes(req.engine) || typeof req.text !== 'string' || typeof req.id !== 'number') throw new Error('AI 参数不对')
  if (current) throw new Error('上一轮还没做完，等它做完或者先停下')
  const v = needVault()
  const ac = new AbortController()
  turns.set(req.id, ac)
  const t: Turn = { id: req.id, context: req.context, touched: new Map(), checked: new Set() }
  current = t
  let text = ''
  let error: string | undefined
  try {
    await bridge('saveAll')
    const server = await ensureMcp()
    const chat = store.chat(v.root)
    const r = await engine(req.engine).run({
      ...modelOpt('chat', req.engine),
      prompt: `${describeContext(req.context)}\n\n用户说：\n${req.text}`,
      system: AGENT_SYSTEM,
      cwd: v.root,
      mcp: { url: server.url, token: server.token, tools: toolSpecs().map((x) => x.name) },
      session: chat.sessions[req.engine],
      history: historyOf(chat.msgs.filter((m) => !(m.role === 'user' && m.text === req.text))),
      images: await pastedImages(req.pasted),
      signal: ac.signal,
      onText: (delta) => {
        text += delta
        emit(req.id, { type: 'text', delta })
      },
    })
    text = (r.text || text).replace(/\n{3,}/g, '\n\n')
    store.setSession(v.root, req.engine, r.session)
  } catch (e) {
    error = (e as Error).name === 'AbortError' || ac.signal.aborted ? '停下了' : String((e as Error).message ?? e)
  } finally {
    current = null
    turns.delete(req.id)
  }
  // 中途出错也把已经改了的提交掉：改动永远能撤回
  const kinds = Object.fromEntries(t.touched)
  let commit = null
  if (t.touched.size) {
    const hash = await git.commitPaths(v.root, [...t.touched.keys()], `AI：${subject(req.text)}`)
    if (hash) commit = (await git.log(v.root, 1))[0] ?? null
    send('files:changed')
  }
  return { text, commit, kinds, ...(error ? { error } : {}) }
}

function subject(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 40 ? one.slice(0, 40) + '…' : one
}

// ---------- 只聊天（/ 命令） ----------

/** 设置 › AI 里这个功能用哪家哪个模型（CN-44）。小活的 Claude Code 模型 CN_FAST_MODEL 能换（测试和自己试用） */
export function pickFor(feature: AiFeature): AiPick {
  let p = resolvePick(store.prefs(), feature)
  // 选的那家这台 Mac 上没装：小活退回默认那家（以前「装了 Claude Code 就用 Haiku，没装用浮窗选的」的规矩）
  if (feature === 'quick' && !FAKE() && !findCli(p.engine)) p = store.prefs().default
  if (feature === 'quick' && p.engine === 'claude' && process.env.CN_FAST_MODEL) p = { engine: 'claude', model: process.env.CN_FAST_MODEL }
  return p
}

/** 这个功能这一轮用 id 这家时传给引擎的模型：只有 Claude Code 认；CN_AI_MODEL 能换默认的 Opus（测试用便宜的） */
export function modelOpt(feature: AiFeature, id: EngineId): { model?: string } {
  const p = pickFor(feature)
  const m = p.engine === id && id === 'claude' ? p.model : id === 'claude' ? store.prefs().default.model : undefined
  if (!m) return {}
  return { model: m === CLAUDE_DEFAULT && process.env.CN_AI_MODEL ? process.env.CN_AI_MODEL : m }
}

/** 看图问（视频框一块问、拍导图）用 Claude Code 的哪个模型 */
export const visionModel = () => modelOpt('vision', 'claude').model

/** 各功能用的「Claude Code · Opus 5.5」（界面上写是哪个模型做的，CN-54） */
export const featureLabel = (feature: AiFeature) => pickLabel(pickFor(feature))

/** 用这个功能选好的引擎问一次，不给工具；onText 边生成边给（/ 命令是 AI 对话，梦游是梦游） */
export async function ask(system: string, prompt: string, signal: AbortSignal, onText: (d: string) => void, feature: AiFeature = 'chat'): Promise<string> {
  const v = deps.vault()
  const p = pickFor(feature)
  const r = await engine(p.engine).run({ prompt, system, cwd: v?.root ?? app.getPath('home'), signal, onText, ...modelOpt(feature, p.engine) })
  return r.text
}

/** 快而便宜的模型：翻译这类一次要问很多遍的活用它（CN_FAST_MODEL 能换） */
export const FAST_MODEL = process.env.CN_FAST_MODEL || 'haiku'

/** 小活用哪家（设置 › AI 的「小活」，从没设过是 Claude Code · Haiku） */
export function fastEngine(): { id: EngineId; label: string } {
  const p = pickFor('quick')
  return { id: p.engine, label: pickLabel(p) }
}

/** 用小活那家问一次，不给工具 */
export async function askFast(system: string, prompt: string, signal: AbortSignal, onText: (d: string) => void): Promise<string> {
  const v = deps.vault()
  const p = pickFor('quick')
  const r = await engine(p.engine).run({ prompt, system, cwd: v?.root ?? app.getPath('home'), signal, onText, ...modelOpt('quick', p.engine) })
  return r.text
}

export function engineInfo(): EngineInfo[] {
  return IDS.map((id) => {
    const path = FAKE() ? `/fake/${id}` : findCli(id)
    return { id, label: LABELS[id], path, ...(path ? {} : { hint: INSTALL_HINT[id] }) }
  })
}

function aiPrefsView() {
  return { prefs: store.prefs(), labels: Object.fromEntries(FEATURES.map((f) => [f, featureLabel(f)])) as Record<AiFeature, string>, engines: engineInfo() }
}

export function registerAgent(d: AgentDeps) {
  deps = d
  store = new AgentStore(join(app.getPath('userData'), 'ai'))
  // 浮窗、边读边问头上的引擎胶囊：现在 AI 对话用的那家；换了它只改「AI 对话」那一行（设置 › AI 里同一行），默认、梦游这些不动
  ipcMain.handle('ai:engines', () => ({ engines: engineInfo(), current: pickFor('chat').engine, label: featureLabel('chat') }))
  ipcMain.handle('ai:engine:set', (_e, id: EngineId) => {
    store.setChatEngine(id)
    send('ai:prefs:changed')
  })
  ipcMain.handle('ai:prefs', () => aiPrefsView())
  ipcMain.handle('ai:prefs:set', (_e, p: AiPrefs) => {
    store.setPrefs(p)
    // 开着的 AI 面板（浮窗、读 PDF 右栏）马上换成新选的
    send('ai:prefs:changed')
    return aiPrefsView()
  })
  ipcMain.handle('ai:turn', (_e, req: TurnRequest) => runTurn(req))
  ipcMain.handle('ai:turn:stop', (_e, id: number) => turns.get(id)?.abort())
  ipcMain.handle('ai:chat:load', () => {
    const v = deps.vault()
    return v ? store.chat(v.root).msgs : []
  })
  ipcMain.handle('ai:chat:save', (_e, msgs: StoredMsg[]) => {
    const v = deps.vault()
    if (!v || !Array.isArray(msgs)) return
    store.saveMsgs(v.root, msgs)
  })
  ipcMain.handle('ai:chat:clear', () => {
    const v = deps.vault()
    if (v) store.clear(v.root)
  })
  ipcMain.handle('ai:reply', (_e, id: number, ok: boolean, value: unknown) => {
    const c = calls.get(id)
    if (!c) return
    calls.delete(id)
    clearTimeout(c.timer)
    if (ok) c.resolve(value)
    else c.reject(new Error(String(value)))
  })
  app.on('will-quit', () => {
    for (const e of Object.values(engines)) e.dispose?.()
    engines = {}
    void mcp?.close()
  })
}
