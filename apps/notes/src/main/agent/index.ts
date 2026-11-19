/**
 * AI 浮窗的主进程这一半：选引擎、跑一轮对话（边生成边发给界面）、给 AI 动手的 MCP 工具、
 * 把这一轮 AI 改的文件做成一次只含 AI 改动的提交。
 *
 * 一轮里 AI 第一次改某个文件前，先把这个文件里用户没提交的字单独提交（和 ai:change 一样），
 * 这样 AI 的那次提交里只有 AI 的改动，撤回才不会带走用户的字。
 */
import { app, type BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'node:path'
import * as git from '@cn/git'
import type { AgentContext, AiAct, AiActArea, AiEvent, BridgeOp, EngineId, EngineInfo, StoredMsg, TurnRequest, TurnResult } from '../../shared/agent'
import { type AiFeature, type AiPick, type AiPrefs, CLAUDE_DEFAULT, FEATURES, fitPick, hasEffort, type ModelOption, modelsOf, pickLabel, resolvePick } from '../../shared/ai-features'
import { checkMaterials, withMaterials } from '../../shared/materials'
import { BRAND } from '../../shared/brand'
import { MATH_RULE } from '../../shared/reading'
import { logActivity } from '../activity'
import type { Vault } from '../vault'
import type { Size } from './board-ops'
import { describeContext } from './context'
import { checkCli, checkedCli, COMMAND, findCli, forgetChecks, INSTALL_HINT, loadShellPath, locateCli, pickedCli, setCustomCli, whereOf } from './cli'
import { claudeEngine, codexEngine, codexModelList, type Engine, geminiEngine, LABELS, opencodeEngine } from './engines'
import { fakeCodexModels, fakeEngine } from './fake-engine'
import { pastedImages } from '../pasted'
import { type McpServer, startMcpServer } from './mcp-server'
import { readingChats } from '../reading/chats'
import type { ChatSummary } from '../../shared/ai-chats'
import { AgentStore } from './store'
import { runTool, type ToolHost, toolLabel, toolSpecs } from './tools'
import * as web from './web'

export { attachWeb, markedClips, unmarkClips } from './web'

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
- 做完用一两句话说做了什么。用中文回答，平实、直接，不客套。不编造笔记里没有的事。
- ${MATH_RULE}`

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
  /** 这一轮动过手的地方（白板、文档、网页）：界面上画外圈和提示条，做完收起（DESIGN.v3 2.3） */
  acts: Set<AiActArea>
  /** 用户按了停下（esc、提示条「停下」、发送键）：一长串的下一步不做了 */
  signal: AbortSignal
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

/** AI 动手看得见：告诉界面开始动哪一块、去拿哪几样、做完了 */
function act(e: AiAct) {
  send('ai:act', e)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 等 ms，按了停下就不等了 */
async function wait(ms: number, signal: AbortSignal) {
  const end = Date.now() + ms
  while (Date.now() < end && !signal.aborted) await sleep(Math.min(40, end - Date.now()))
}

/**
 * 每拿一样东西的节奏（DESIGN.v3 2.3）：指针移过去 0.55 秒，到了那样东西外圈亮约 0.5 秒（这时候改、卡片滑过去），再拿下一样。
 * 一长串时每步短一点，几十张卡也在十来秒里排完；grab 是指针走的时间，settle 是外圈亮着、卡片滑过去的时间
 */
function pace(of = 1): { grab: number; settle: number } {
  const step = Math.max(450, Math.min(1100, 12000 / Math.max(1, of)))
  return { grab: Math.round(step * 0.55), settle: Math.round(step * 0.45) }
}

/** 软件的强调色（网页里的 AI 指针、剪下的竖线跟着主题） */
async function accent(): Promise<web.AccentColors> {
  return bridge<web.AccentColors>('accent').catch(() => ({ acc: '#8a63d2', accBg: '#8a63d2', ring: 'rgba(138,99,210,.4)' }))
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
  async grab(path, ids, of) {
    const t = needTurn()
    // 白板不在屏幕上（用户换了标签、AI 在改别的白板）：不画也不等
    if (t.signal.aborted || !(await bridge<boolean>('onScreen', path).catch(() => false))) return
    const ms = pace(of).grab
    act({ turn: t.id, kind: 'grab', area: 'board', path, ids, ms })
    await wait(ms, t.signal)
  },
  async settle(path, of) {
    const t = needTurn()
    if (t.signal.aborted || !(await bridge<boolean>('onScreen', path).catch(() => false))) return
    await wait(pace(of).settle, t.signal)
  },
  stopped: () => !!current?.signal.aborted,
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
    async clip(whole, text) {
      const v = needVault()
      const t = needTurn()
      const colors = await accent()
      // 给了那一段里的几个字：指针先去找到那一段、亮一下、选中它，再剪（DESIGN.v3 2.3、B3）
      if (text && !whole && !(await web.pickBlock(text, colors, () => t.signal.aborted))) throw new Error(`网页上没找到含「${text.slice(0, 20)}」的那一段。先 web_read 看看原文。`)
      const c = await web.pageForClip(whole)
      const path = await v.clip(c.text, c.url, c.title.slice(0, 300))
      t.touched.set(path, '新')
      // 剪下的那一段：左边一道竖线、段尾「✂ 剪成卡片」，撤回后去掉
      if (!whole) await web.markClip(path, colors)
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
        await announce(t, name, args)
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

/**
 * 这一轮第一次动白板、文档、网页时告诉界面：那一块外圈亮起来、顶上出「AI 正在整理这块白板 · 停下 esc」，到这一轮做完为止。
 * 白板是哪一块：工具里给了 path 就是它，不然是当前标签里的那篇；读白板（board_list）也算开始动手（第一步）
 */
async function announce(t: Turn, name: string, args: Record<string, unknown>) {
  const area: AiActArea | null = name.startsWith('board_') ? 'board' : name.startsWith('web_') ? 'web' : name.startsWith('doc_') ? 'doc' : null
  if (!area || t.acts.has(area)) return
  let path: string | null = null
  if (area !== 'web') {
    const given = typeof args.path === 'string' && args.path.trim() ? args.path : null
    const ctx = await bridge<AgentContext>('context').catch(() => null)
    const tab = ctx?.tab
    const here = tab?.type === 'note' && tab.path ? tab : null
    if (area === 'board') path = given ?? (here && (here.board || here.mode === 'board') ? here.path! : null)
    else path = here && here.mode !== 'board' ? here.path! : null
    if (!path) return
  }
  t.acts.add(area)
  act({ turn: t.id, kind: 'start', area, path })
}

function emit(id: number, e: AiEvent) {
  send('ai:event', id, e)
}

/** 会话接不上时补的最近几轮 */
function historyOf(msgs: StoredMsg[]): string | undefined {
  const recent = msgs.filter((m) => m.text).slice(-10)
  if (!recent.length) return undefined
  const lines = recent.map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${(m.text ?? '').slice(0, 600)}`)
  return `之前聊过的（供参考）：\n${lines.join('\n')}`
}

const turns = new Map<number, AbortController>()

/** 地方的 key、名字：界面给的，进文件名前过一遍 */
function placeOf(p: unknown): { key: string; label: string } | null {
  if (p === undefined) return null
  const o = p as { key?: unknown; label?: unknown }
  if (!o || typeof o.key !== 'string' || !o.key || o.key.length > 4000 || typeof o.label !== 'string' || o.label.length > 400) throw new Error('AI 参数不对')
  return { key: o.key, label: o.label }
}

async function runTurn(req: TurnRequest): Promise<TurnResult> {
  if (!IDS.includes(req.engine) || typeof req.text !== 'string' || typeof req.id !== 'number') throw new Error('AI 参数不对')
  const place = placeOf(req.place)
  const mats = checkMaterials(req.mats)
  if (current) throw new Error('上一轮还没做完，等它做完或者先停下')
  const v = needVault()
  const ac = new AbortController()
  turns.set(req.id, ac)
  const t: Turn = { id: req.id, context: req.context, touched: new Map(), checked: new Set(), acts: new Set(), signal: ac.signal }
  current = t
  let text = ''
  let error: string | undefined
  try {
    await bridge('saveAll')
    const server = await ensureMcp()
    // 接着这个地方自己的会话（D 组 CN-132）；没给地方就不接着谁
    const chat = place ? store.chat(v.root, place.key) : null
    const r = await engine(req.engine).run({
      ...chatRun(req.engine, req),
      // 引用的材料（多段引用方向 B）：字里的 ①②，后面按同一套编号列出每块（图叫「图②」）；图和粘贴的图一样附上
      prompt: `${describeContext(req.context)}\n\n用户说：\n${withMaterials(req.text, mats)}`,
      system: AGENT_SYSTEM,
      cwd: v.root,
      mcp: { url: server.url, token: server.token, tools: toolSpecs().map((x) => x.name) },
      session: chat?.sessions[req.engine],
      history: chat ? historyOf(chat.msgs.filter((m) => !(m.role === 'user' && m.text === req.text))) : undefined,
      images: await pastedImages(req.pasted),
      signal: ac.signal,
      onText: (delta) => {
        text += delta
        emit(req.id, { type: 'text', delta })
      },
    })
    text = (r.text || text).replace(/\n{3,}/g, '\n\n')
    if (place) store.setSession(v.root, place.key, req.engine, r.session)
  } catch (e) {
    error = (e as Error).name === 'AbortError' || ac.signal.aborted ? '停下了' : String((e as Error).message ?? e)
  } finally {
    current = null
    turns.delete(req.id)
    // 外圈、提示条、指针收起；网页里的指针收起，剪下的标记留着
    if (t.acts.size) act({ turn: t.id, kind: 'end' })
    if (t.acts.has('web')) await web.endWebAct()
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

/**
 * 这个功能这一轮用 id 这家时传给引擎的模型和 effort：模型 Claude Code、Codex 认（Codex 没选就用它自己的默认）；
 * effort 只传设置里明着选了的（梦游、/ 命令这些没选过就用命令行自己的默认档）；CN_AI_MODEL 能换默认的 Opus（测试用便宜的）
 */
export function modelOpt(feature: AiFeature, id: EngineId): { model?: string; effort?: string } {
  const p = pickFor(feature)
  const own = p.engine === id ? p : store.prefs().default.engine === id ? store.prefs().default : null
  const m = own?.model
  return {
    ...(m ? { model: m === CLAUDE_DEFAULT && process.env.CN_AI_MODEL ? process.env.CN_AI_MODEL : m } : {}),
    ...(own?.effort ? { effort: own.effort } : {}),
  }
}

/** Codex 的模型列表（问它的 app-server model/list，拿到一次记着；「重新找一遍」再问）：null 是还没拿到 */
let codexModels: ModelOption[] | null = null
let codexListing = false
function listCodexModels() {
  if (codexModels || codexListing) return
  codexListing = true
  void codexModelList()
    .then(
      (list) => (codexModels = list),
      (e) => {
        // 问不到（没登录、没网）：模型菜单只有「Codex 默认模型」一项，原因写进日志
        console.error('Codex 模型列表拿不到', e)
        codexModels = []
      },
    )
    .then(() => send('ai:prefs:changed'))
    .finally(() => (codexListing = false))
}

/** 这家能选的模型：Codex 的假引擎给一份固定的（CN_AI_FAKE=1），真的问 app-server */
function modelsFor(id: EngineId): ModelOption[] {
  if (id !== 'codex') return modelsOf(id)
  return modelsOf('codex', FAKE() ? fakeCodexModels() : (codexModels ?? []))
}

/**
 * 这一问真正用的哪家、哪个模型、哪一档（CN-91）：请求里带了就用请求的（输入框底行选的，只管这个对话），没带用「AI 对话」那一行的，
 * effort 没设过是 High；这个模型不认这一档（Codex 每个模型那几档不一样）就用它自己的默认档；Gemini、OpenCode 只有哪家
 */
function effectivePick(id: EngineId, req: { model?: string; effort?: string } = {}): AiPick {
  if (!hasEffort(id)) return { engine: id }
  const p = pickFor('chat')
  const def = store.prefs().default
  const own: AiPick = p.engine === id ? p : def.engine === id ? def : { engine: id }
  return fitPick(id, modelsFor(id), { model: req.model ?? own.model, effort: req.effort ?? own.effort })
}

/** 「AI 对话」这一行现在选的：哪家、哪个模型、想多久（effort 没设过是 High；Gemini、OpenCode 没有 effort） */
export const chatPick = (): AiPick => effectivePick(pickFor('chat').engine)

/** 「Claude Code · Opus 5.5 · High」：AI 对话、读 PDF 回答头上那行（CN-91） */
export const chatLabel = () => {
  const p = chatPick()
  return pickLabel(p, modelsFor(p.engine))
}

const MODEL_ID = /^[\w.:\-[\]/]{0,200}$/

/** AI 浮窗、读 PDF 这一问传给引擎的模型和 effort（effectivePick）；Claude Code 的默认 Opus 能用 CN_AI_MODEL 换（测试用便宜的） */
export function chatRun(id: EngineId, req: { model?: unknown; effort?: unknown }): { model?: string; effort?: string } {
  if (req.model !== undefined && (typeof req.model !== 'string' || !MODEL_ID.test(req.model))) throw new Error('AI 参数不对')
  if (req.effort !== undefined && (typeof req.effort !== 'string' || !/^[a-z]{1,20}$/.test(req.effort))) throw new Error('AI 参数不对')
  const p = effectivePick(id, { ...(typeof req.model === 'string' ? { model: req.model } : {}), ...(typeof req.effort === 'string' ? { effort: req.effort } : {}) })
  const model = p.model === CLAUDE_DEFAULT && process.env.CN_AI_MODEL ? process.env.CN_AI_MODEL : p.model
  return { ...(model ? { model } : {}), ...(p.effort ? { effort: p.effort } : {}) }
}

/**
 * 一个对话自己选的（输入框底行的模型、effort，CN-91）：界面给的，查一遍。模型可以是空串（Codex 自己的默认模型，和设置里选的不一样时也记得住）
 */
export function ownPick(x: unknown): AiPick {
  const o = (x && typeof x === 'object' ? x : {}) as { engine?: unknown; model?: unknown; effort?: unknown }
  if (!IDS.includes(o.engine as EngineId)) throw new Error('AI 参数不对')
  if (o.model !== undefined && (typeof o.model !== 'string' || !MODEL_ID.test(o.model))) throw new Error('AI 参数不对')
  if (o.effort !== undefined && (typeof o.effort !== 'string' || !/^[a-z]{1,20}$/.test(o.effort))) throw new Error('AI 参数不对')
  const engine = o.engine as EngineId
  if (!hasEffort(engine)) return { engine }
  return { engine, ...(typeof o.model === 'string' ? { model: o.model } : {}), ...(typeof o.effort === 'string' ? { effort: o.effort } : {}) }
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

// ---------- 本机装了哪几家（CN-87） ----------

/** 找命令是真的：不是假 AI，或者测试要真的找（CN_REAL_FIND=1：找命令走真的，跑的还是假引擎） */
const REAL_FIND = () => !FAKE() || process.env.CN_REAL_FIND === '1'

const verifying = new Set<string>()

/** 后台跑一次 `--version`；运行不了时通知界面再要一次（先前当它能用报出去了）；能跑的 Codex 接着问它有哪些模型 */
function verify(id: EngineId, path: string) {
  if (verifying.has(path)) return
  verifying.add(path)
  void checkCli(path)
    .then((c) => {
      if (!c.ok) send('ai:prefs:changed')
      else if (id === 'codex' && !FAKE()) listCodexModels()
    })
    .finally(() => verifying.delete(path))
}

const brokenHint = (id: EngineId) => `找到了 ${COMMAND[id]}，但运行不了。在终端里运行一次 ${COMMAND[id]} --version 看看哪里不对，或者重新装一遍。`

/** 测试用的假命令行（CN_AI_FAKE=1）：在哪找到照真的样子写；CN_AI_FAKE_CLI=codex=missing,gemini=broken 演没找到、运行不了 */
const FAKE_WHERE: Record<EngineId, string> = { claude: '~/.local/bin', codex: '/opt/homebrew/bin', gemini: '/opt/homebrew/bin', opencode: '~/.opencode/bin' }
function fakeFound(id: EngineId): Pick<EngineInfo, 'path' | 'where' | 'broken' | 'custom' | 'hint'> {
  const mine = store.cliPaths()[id]
  if (mine) return { path: mine, where: whereOf(mine, app.getPath('home')), custom: true }
  const state = new Map((process.env.CN_AI_FAKE_CLI ?? '').split(',').map((kv) => kv.split('=') as [string, string])).get(id)
  if (state === 'missing') return { path: null, where: '没找到', hint: INSTALL_HINT[id] }
  if (state === 'broken') return { path: null, where: FAKE_WHERE[id], broken: `运行 ${COMMAND[id]} --version 出错（退出码 1）：测试用的坏命令行`, hint: brokenHint(id) }
  return { path: `/fake/${id}`, where: FAKE_WHERE[id] }
}

function found(id: EngineId): Pick<EngineInfo, 'path' | 'where' | 'broken' | 'custom' | 'hint'> {
  if (!REAL_FIND()) return fakeFound(id)
  const hit = locateCli(id)
  if (!hit) return { path: null, where: '没找到', hint: INSTALL_HINT[id] }
  const mine = hit.custom ? { custom: true } : {}
  const c = checkedCli(hit.path)
  // 还没跑过 --version（或者文件换过了）：先当它能用，后台跑完运行不了再改口
  if (!c) verify(id, hit.path)
  if (c && !c.ok) return { path: null, where: hit.where, broken: c.why, hint: brokenHint(id), ...mine }
  // 能跑的 Codex：后台问一次它有哪些模型（拿到了通知界面再要一次）
  if (id === 'codex' && !FAKE() && c?.ok) listCodexModels()
  return { path: hit.path, where: hit.where, ...mine }
}

export function engineInfo(): EngineInfo[] {
  return IDS.map((id) => {
    const models = modelsFor(id)
    return { id, label: LABELS[id], ...found(id), models, efforts: models[0]!.efforts }
  })
}

/** 「重新找一遍」：重新取登录 shell 的 PATH、每家重新跑 --version，跑完再答；和先前不一样就让开着的 AI 面板都再要一次 */
async function findAgain(): Promise<void> {
  if (!REAL_FIND()) return
  const before = JSON.stringify(engineInfo())
  forgetChecks()
  if (!codexListing) codexModels = null
  await loadShellPath(true)
  await Promise.all(IDS.map((id) => locateCli(id)).map((hit) => hit && checkCli(hit.path)))
  // 能跑的 Codex：等它的模型列表也问回来再答
  const codex = locateCli('codex')
  if (codex && checkedCli(codex.path)?.ok && !FAKE() && !codexModels)
    codexModels = await codexModelList().catch((e) => {
      console.error('Codex 模型列表拿不到', e)
      return []
    })
  if (JSON.stringify(engineInfo()) !== before) send('ai:prefs:changed')
}

/** 启动后在后台取登录 shell 的 PATH：取到以后找到的和先前不一样，通知界面再要一次 */
function findInBackground() {
  if (!REAL_FIND()) return
  const before = IDS.map((id) => locateCli(id)?.path ?? null).join('\n')
  void loadShellPath().then(() => {
    if (IDS.map((id) => locateCli(id)?.path ?? null).join('\n') !== before) send('ai:prefs:changed')
  })
}

/** 「装在别处？指定位置…」：系统选文件框选命令行（或带着它的 App，比如 Codex.app），记进设置、排第一个找 */
async function pickCli(id: EngineId): Promise<EngineInfo | null> {
  if (!IDS.includes(id)) throw new Error('没有这个引擎')
  const win = deps.win()
  const opts: Electron.OpenDialogOptions = {
    title: `${LABELS[id]} 的命令行在哪`,
    message: `选 ${COMMAND[id]} 这个文件${id === 'codex' ? '，或者带着它的 Codex.app、ChatGPT.app' : ''}`,
    defaultPath: id === 'codex' ? '/Applications' : app.getPath('home'),
    properties: ['openFile', 'showHiddenFiles'],
  }
  const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  const picked = r.filePaths[0]
  if (r.canceled || !picked) return null
  const exe = pickedCli(id, picked)
  if (!exe) throw new Error(`选的不是能运行的 ${COMMAND[id]}：${picked}`)
  store.setCliPath(id, exe)
  setCustomCli(store.cliPaths())
  if (REAL_FIND()) await checkCli(exe)
  send('ai:prefs:changed')
  return engineInfo().find((e) => e.id === id)!
}

function aiPrefsView() {
  return { prefs: store.prefs(), labels: Object.fromEntries(FEATURES.map((f) => [f, featureLabel(f)])) as Record<AiFeature, string>, engines: engineInfo() }
}

/** 文件改了名、挪了地方（标签上改名、文件夹改名挪走里面的）：这个文件的 AI 对话跟过去 */
export function moveChatPlace(root: string, from: string, to: string) {
  if (!store || !/\.md$/i.test(from)) return
  store.move(root, `file:${from}`, `file:${to}`, (to.split('/').pop() ?? to).replace(/\.md$/i, ''))
}

export function registerAgent(d: AgentDeps) {
  deps = d
  store = new AgentStore(join(app.getPath('userData'), 'ai'))
  setCustomCli(store.cliPaths())
  findInBackground()
  // 浮窗、边读边问头上的引擎胶囊：现在 AI 对话用的那家；换了它只改「AI 对话」那一行（设置 › AI 里同一行），默认、梦游这些不动。
  // again：「重新找一遍」，重新取登录 shell 的 PATH、每家重新跑 --version 再答
  ipcMain.handle('ai:engines', async (_e, again?: unknown) => {
    if (again === true) await findAgain()
    const chat = chatPick()
    return { engines: engineInfo(), current: chat.engine, label: chatLabel(), chat }
  })
  ipcMain.handle('ai:cli:pick', (_e, id: EngineId) => pickCli(id))
  // 输入框底行换了模型、effort（CN-91）：记成「AI 对话」那一行（下次打开还是它），不动默认、梦游、小活
  ipcMain.handle('ai:chat:set', (_e, pick: AiPick) => {
    store.setChatPick(pick)
    send('ai:prefs:changed')
  })
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
  // 对话按地方存（D 组 CN-132）：每个文件、文件夹、首页、收件箱各一份
  ipcMain.handle('ai:chat:load', (_e, place: unknown) => {
    const v = deps.vault()
    const p = placeOf({ key: place, label: '' })!
    return v ? store.chat(v.root, p.key).msgs : []
  })
  ipcMain.handle('ai:chat:save', (_e, place: unknown, label: unknown, msgs: StoredMsg[]) => {
    const v = deps.vault()
    const p = placeOf({ key: place, label })!
    if (!v || !Array.isArray(msgs)) return
    store.saveMsgs(v.root, p.key, p.label, msgs)
  })
  // 这个对话自己选的模型、effort（CN-91 方向 C：只管这个对话，记在这个对话里；没选过是 null，用设置 › AI「AI 对话」那一行）
  ipcMain.handle('ai:chat:pick', (_e, place: unknown) => {
    const v = deps.vault()
    const p = placeOf({ key: place, label: '' })!
    return v ? (store.chat(v.root, p.key).pick ?? null) : null
  })
  ipcMain.handle('ai:chat:pick:set', (_e, place: unknown, pick: unknown) => {
    const v = deps.vault()
    const p = placeOf({ key: place, label: '' })!
    if (v) store.setPick(v.root, p.key, pick === null ? null : ownPick(pick))
  })
  ipcMain.handle('ai:chat:clear', (_e, place: unknown) => {
    const v = deps.vault()
    const p = placeOf({ key: place, label: '' })!
    if (v) store.clear(v.root, p.key)
  })
  // 对话菜单：这个库问过的地方，连读 PDF 那一套的（按最后问的时间，新的在前）
  ipcMain.handle('ai:chats', (): ChatSummary[] => {
    const v = deps.vault()
    if (!v) return []
    return [...store.list(v.root), ...readingChats(join(app.getPath('userData'), 'reading'), v.root)].sort((a, b) => b.at - a.at)
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
