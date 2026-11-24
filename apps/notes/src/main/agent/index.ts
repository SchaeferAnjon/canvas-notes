/**
 * AI 浮窗的主进程这一半：选引擎、跑一轮对话（边生成边发给界面）、给 AI 动手的 MCP 工具、
 * 把这一轮 AI 改的文件做成一次只含 AI 改动的提交。AI 对话和读 PDF 的问答都走 runAgentTurn。
 *
 * 一轮里 AI 第一次改某个文件前，先把这个文件里用户没提交的字单独提交（和 ai:change 一样），
 * 这样 AI 的那次提交里只有 AI 的改动，撤回才不会带走用户的字。
 *
 * 全能模式（2026-11-19，默认开，AI 输入框下面一键切换、两处共用）：AI 能自己写文件、跑命令（engines.ts），
 * 改了库里哪些文件我们事先不知道：这一轮开始先把用户没提交的字提交掉，结束时库里新冒出来的改动就是这一轮的，
 * 和我们工具改的一起提交成「AI：…」（编辑器自己存的字、软件自己写的不算，除非监听看到外面又改了它）。
 */
import { app, type BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { realpathSync } from 'node:fs'
import { readFile, rename } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { type AiWrote, aiWroteHead, blockKeys, chatLink, decodeNote, encodeNote, wrapInsert, wrapNewBlocks } from '@cn/format'
import * as git from '@cn/git'
import { type ActTally, actScope, noTally } from '../../shared/ai-act'
import type { AgentContext, AiAct, AiActArea, AiEvent, BridgeOp, ChatSide, EngineId, EngineInfo, SideTurnRequest, StoredMsg, TurnRequest, TurnResult } from '../../shared/agent'
import type { AiCommitFailed, CommitInfo } from '../../shared/api'
import { commitErrorText } from '../../shared/git-errors'
import { type AiFeature, type AiPick, type AiPrefs, CLAUDE_DEFAULT, FEATURES, fitPick, MODEL_ID, type ModelOption, modelsOf, pickLabel, resolvePick } from '../../shared/ai-features'
import { problemText } from '../../shared/engine-health'
import { usesOf } from '../../shared/ai-logo'
import { checkMaterials, withMaterials } from '../../shared/materials'
import { ALL_IDS, API_DEFAULT, type CliId, isApi, isCli, isLocal, KEY_JUDGE, KEY_PAGE, LOCAL_SITE, preferModel, routeOf } from '../../shared/ai-sources'
import { apiEngine, localEngine } from './engine-api'
import { installClaudeCode, loginClaudeCode } from './cc-setup'
import { apiKey, bundledOpencode, initSources, localFound, probeAll, removeKey, setKey, sourceModels, sourceReady, sourceStates } from './sources'
import { BRAND } from '../../shared/brand'
import { t } from '../../shared/i18n'
import { MATH_RULE } from '../../shared/reading'
import { CITE_FIND, CITE_RULE, notesLine } from '../../shared/cite-rule'
import { listEntries } from '../files'
import { logActivity } from '../activity'
import type { Vault } from '../vault'
import type { Size } from './board-ops'
import { describeContext } from './context'
import { checkCli, checkedCli, COMMAND, findCli, forgetChecks, INSTALL_HINT, loadShellPath, locateCli, pickedCli, setCustomCli, whereOf } from './cli'
import { claudeEngine, codexEngine, type Engine, type EngineImage, type EngineOutcome, type EngineRun, geminiEngine, LABELS, opencodeEngine, sessionOf } from './engines'
import { checkNow, engineState, noteVersion, pulledModels, refreshAll, startEngineWatch, updateNow, watchInfo, watching } from './engine-watch'
import { fakeCodexModels, fakeEngine } from './fake-engine'
import { pastedImages } from '../pasted'
import { type McpServer, startMcpServer } from './mcp-server'
import { readingChats } from '../reading/chats'
import type { ChatSummary } from '../../shared/ai-chats'
import { AgentStore } from './store'
import { runTool, stepLabel, stepPaths, type ToolHost, toolLabel, toolSpecs } from './tools'
import * as vops from './vault-ops'
import { AI_BLOCK_RULE, aiBlockLine, langTail, modeLine, MODES_RULE, userNoteLine } from './modes'
import { sideTurnPrompt } from './side-prompt'
import * as web from './web'
import { atomicWrite } from '@cn/atomic'

export { attachWeb, markedClips, unmarkClips } from './web'
export { langTail, modeLine, MODES_RULE } from './modes'

const FAKE = () => process.env.CN_AI_FAKE === '1'
const IDS: EngineId[] = ALL_IDS

export const AGENT_SYSTEM = `你是 ${BRAND.name} 笔记软件里的助手，帮一个人整理和写作自己的笔记。库目录就是你的工作目录，里面是普通 md 文件（白板也是 md：卡片写在 <!-- card --> 注释后面）。

你能直接操作这个软件（canvas 这组工具）：
- 笔记和文件夹（note_*、folder_create）：新建笔记（指定文件夹、标题、正文）、整篇改写或在末尾加一段、改名、挪进别的文件夹、删到废纸篓（连同只有它在用的附件）、新建文件夹。改名、挪动时库里的链接跟着改，开着的编辑器跟着刷新。
- 网页（web_*）：在右栏的内置浏览器里打开网址、读页面文字和链接、点击、输入、滚动、把选中的字或整页剪进收件箱。
- 白板（board_*）：列出卡片和列、加卡片、改卡片内容、挪位置、放进列、连线、按网格或按列排整齐。改之前先 board_list 拿到 id。
- 文档（doc_*）：读当前文档、在光标处插入、替换选中的字。
- notes_list、note_read 看库里有哪些笔记、文件夹，读一篇。

${MODES_RULE}

规矩：
- 用户在看网页就用 web_*，在白板上就用 board_*，在文档里就用 doc_*；每条消息开头写着用户现在在看什么。
- 新建、改名、挪动、删掉库里的笔记优先用 canvas 这组工具（链接、附件、开着的编辑器跟着走）；全能模式下别的事可以直接写文件、跑命令。不管怎么改，这一轮结束软件把库里的改动提交一次，用户能一键撤回，所以直接做，不用先问。
- 不管用哪种办法改了库里的文件（canvas 工具、自己写文件、跑命令），开着的编辑器当场换成新内容，用户正在打的字会合并进来，不用叫用户关掉标签再打开。
${AI_BLOCK_RULE}
- 做完用一两句话说做了什么。回答用哪种语言照每条消息开头的【语言】；平实、直接，不客套。不编造笔记里没有的事。
- ${MATH_RULE}

${CITE_RULE}
${CITE_FIND}`

/**
 * AGENT_SYSTEM 改过就加一：Claude Code 接着聊时一直用会话第一次的系统提示（--system-prompt-snapshot），
 * 版本对不上的会话不再接着聊，开新会话、补上最近几轮（2：全能模式、笔记和文件夹那组工具；3：改了开着的文件编辑器当场换；
 * 4：回答的语言照每条消息开头的【语言】，task-zojmg；5：往笔记里新加的段落写成 [!ai] 块，头一行照每条消息开头的【AI 块】，task-dtc34；
 * 6：提到库里的东西写成链接，路径照每条消息开头的【库里的笔记】，task-3e53q）
 */
export const AGENT_VERSION = 6

let engines: Partial<Record<EngineId, Engine>> = {}

/** 读 PDF 边读边问也用同一组引擎（同一个进程、同一个假引擎） */
export function engine(id: EngineId): Engine {
  // API Key、本机模型（task-587os）：测试也走真的 HTTP（CN_API_BASE_*、CN_LOCAL_BASE_* 指到本机假的服务，或者真 Key 真问一句）
  if (isApi(id)) return (engines[id] ??= apiEngine(id, { key: apiKey, opencode: bundledOpencode }))
  if (isLocal(id)) return (engines[id] ??= localEngine(id))
  if (FAKE()) return (engines[id] ??= fakeEngine(id))
  return (engines[id] ??= id === 'claude' ? claudeEngine() : id === 'codex' ? codexEngine() : id === 'gemini' ? geminiEngine() : opencodeEngine())
}

/** 这一轮：记下 AI 改了哪些文件 */
interface Turn {
  /** 外圈、提示条和「停下」认的编号：AI 对话是消息编号，读 PDF 是负的问答编号（两边的消息编号可能撞上） */
  id: number
  engine: EngineId
  touched: Map<string, string>
  /** 已经先提交过用户的字的文件 */
  checked: Set<string>
  /** 这一轮动过手的地方（白板、文档、网页）：界面上画流光和提示条，做完收起（DESIGN.v3 2.3） */
  acts: Set<AiActArea>
  /** 其中整块亮着的（四边一道光、顶上提示条）；只亮一处的（只加一张卡、只写一段）不在这里 */
  whole: Set<AiActArea>
  /** 这一轮做了多少：做完时「整理好了 · 挪了N张卡」、停下时「做完的N步留着」 */
  tally: ActTally
  /** 用户按了停下（esc、提示条「停下」、发送键）：一长串的下一步不做了 */
  signal: AbortSignal
  /** 全能模式：AI 自己的工具改了库里什么，这一轮结束看库里多出来的改动 */
  omni: boolean
  /** 这一轮里软件自己写过的（编辑器存字、剪藏、速记）：不算 AI 改的，除非监听看到外面又改了它 */
  own: Set<string>
  /** 这一轮里监听看到在外面改了的（AI 自己写的、跑命令改的） */
  external: Set<string>
  /** 这一轮改名、挪动了的：新路径 → 旧路径（改动预览里一行写「旧 → 新」） */
  moved: Map<string, string>
  /** 全能模式：命令行自己的写文件、改文件那几步点了名的库里文件 */
  named: Set<string>
  /**
   * 全能模式：这一轮跑过命令、开过子 Agent 这类说不清改了哪些文件的步骤。没跑过时，库里多出来的改动只算点了名的；
   * 跑过就分不清（命令能改任何文件），都算这一轮的
   */
  shell: boolean
  /** 这一轮开始前就有、开始时没提交上（锁一直不放）的改动：不算 AI 的，结束时先单独提交 */
  before: Set<string>
  /** 这一轮往库里的笔记写过字（发过 wrote）：结束时也发 end，那一段下面「AI 在写这一段」跟着收 */
  wrote: boolean
  /**
   * AI 对话（不是读 PDF）：AI 往笔记里新加的整段一律包成 [!ai] 块（task-dtc34），头上写哪家哪个模型、链回这段对话；
   * 我们的工具插的当场包，AI 自己改文件的这一轮结束补包（wrapTurn）
   */
  aiWrote?: AiWrote
  /** 这一轮里库里笔记的每一版（按先后）：own 是软件写的（编辑器存用户打的字），不是的是 AI 写的；补包时认出用户这一轮自己打的整段 */
  trail: { path: string; own: boolean; text: string }[]
  /** 字和步骤发给界面（AI 对话：ai:event；读 PDF：reading:event） */
  emit(e: AiEvent): void
}

export interface AgentDeps {
  win(): BrowserWindow | null
  vault(): Vault | null
  /** 文件挪了、改了名：读 PDF 的本机进度跟过去（AI 对话的对话由这里自己跟） */
  moved?(root: string, from: string, to: string): void
}

let store: AgentStore
/** AI 对话这一格一次答一轮 */
let dockTurn: Turn | null = null
/** 正在答的每一轮（AI 对话、读 PDF） */
const liveTurns = new Set<Turn>()
/** 每一轮自己的令牌 → 那一轮（Claude Code 一轮一个进程，令牌写在那一轮的配置文件里） */
const byToken = new Map<string, Turn>()
/** Codex、Gemini、OpenCode 的进程一直开着、令牌在起进程时给：一家一个令牌，算在这家正在答的最新那一轮上 */
const engineTokens = new Map<EngineId, string>()
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
  return bridge<web.AccentColors>('accent').catch(() => ({ acc: '#8a63d2', accBg: '#8a63d2', accOn: '#fff', ring: 'rgba(138,99,210,.4)' }))
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

/** 这次工具调用是哪一轮的：带着那一轮自己的令牌来的就是它；一家一个令牌的，算在这家正在答的最新那一轮上 */
function turnOf(token: string): Turn {
  const own = byToken.get(token)
  if (own) return own
  const id = [...engineTokens].find(([, t]) => t === token)?.[0]
  const t = id ? [...liveTurns].reverse().find((x) => x.engine === id) : undefined
  if (!t) throw new Error('现在没有正在进行的对话')
  return t
}

/** 第一次改这个文件前：用户没提交的字先单独提交 */
async function beforeEdit(t: Turn, path: string) {
  if (t.checked.has(path)) return
  t.checked.add(path)
  const v = needVault()
  const pending = (await git.status(v.root)).filter((s) => s.path === path)
  if (pending.length) await git.commitPaths(v.root, [path], git.describeChanges(pending))
}

/** 库里的笔记、文件夹挪了改了名：开着的标签、编辑器跟过去，读 PDF 的进度、这里的 AI 对话跟过去 */
function movedFiles(root: string, from: string, to: string) {
  moveChatPlace(root, from, to)
  deps.moved?.(root, from, to)
}

/** 删到废纸篓（测试把「废纸篓」换成临时文件夹，不往用户真的废纸篓里放） */
async function toTrash(abs: string) {
  const dir = process.env.CN_TRASH_DIR
  if (dir) await rename(abs, join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${abs.split('/').pop()}`))
  else await shell.trashItem(abs)
}

/**
 * 改名、挪动碰过的路径在改动预览里那一列写什么：它自己（旧的、新的路径，文件夹里的、附件文件夹里的）写「改名」或「移动」，
 * 链接跟着改了的那几篇写「改」（小文件改了开头那行，Git 认不出是改名，旧路径、新路径各占一行）
 */
function movedKind(r: { from: string; to: string }, kind: string) {
  const strip = (p: string) => p.replace(/\.md$/i, '')
  const own = [r.from, r.to].flatMap((p) => [p, `附件/${strip(p)}`])
  return (p: string) => (own.some((d) => p === d || p.startsWith(d + '/')) ? kind : '改')
}

/** 这一步碰过的路径记进这一轮（结束时一起提交）：kind 是改动预览里那一列（新、改、改名、移动、删） */
function touch(t: Turn, paths: string[], kind: (p: string) => string) {
  for (const p of paths) t.touched.set(p, kind(p))
}

/**
 * 改名、挪动：碰过的路径里，新的那个（文件夹里每一篇、附件文件夹里每一个）对上旧的那个，记成新 → 旧；
 * 前面已经挪过一次的（先改名再挪）接着记最早的旧路径
 */
function noteMoves(t: Turn, r: { from: string; to: string; touched: string[] }) {
  const strip = (p: string) => p.replace(/\.md$/i, '')
  const pairs: [string, string][] = [
    [r.to, r.from],
    [`附件/${strip(r.to)}`, `附件/${strip(r.from)}`],
  ]
  for (const p of r.touched) {
    for (const [to, from] of pairs) {
      const old = p === to ? from : p.startsWith(to + '/') ? from + p.slice(to.length) : null
      if (old === null || old === p) continue
      t.moved.set(p, t.moved.get(old) ?? old)
      t.moved.delete(old)
    }
  }
}

function hostFor(t: Turn): ToolHost {
  return {
    ...(t.aiWrote ? { wrote: t.aiWrote } : {}),
    context: () => bridge<AgentContext>('context'),
    listNotes: () => needVault().list(),
    readNote: async (path) => {
      await bridge('saveAll')
      const v = needVault()
      return (await v.read(vops.relPath(v, path, 'path'))).text
    },
    async editNote(path, change) {
      const v = needVault()
      const rel = vops.relPath(v, path, 'path')
      await bridge('saveAll')
      await beforeEdit(t, rel)
      const cur = (await v.read(rel)).text
      const next = change(cur)
      if (next === cur) return
      aiWriting.add(rel)
      const r = await v.write(rel, next, cur).finally(() => aiWriting.delete(rel))
      if (!r.ok) throw new Error('文件刚被改过，再试一次')
      if (!t.touched.has(rel)) t.touched.set(rel, '改')
      // 主进程写的，监听不到；打开着这篇的编辑器要收到，按外部改动合并（先说是 AI 写的：新的字一点点长出来，task-6kun1）
      wroteNote(t, rel)
      send('note:changed', rel, next)
    },
    measure: (path) => bridge<Record<string, Size>>('measure', path),
    async grab(path, ids, of) {
      // 白板不在屏幕上（用户换了标签、AI 在改别的白板）：不画也不等
      if (t.signal.aborted || !(await bridge<boolean>('onScreen', path).catch(() => false))) return
      const ms = pace(of).grab
      act({ turn: t.id, kind: 'grab', area: 'board', path, ids, ms })
      await wait(ms, t.signal)
    },
    // 只加一张卡：只亮那一张（这一轮已经整块亮着时不用，指针去拿它时外面跑一圈就够）
    spot(path, ids) {
      if (!t.whole.has('board')) act({ turn: t.id, kind: 'spot', area: 'board', path, ids })
    },
    tally(k, n = 1) {
      t.tally[k] += n
    },
    async settle(path, of) {
      if (t.signal.aborted || !(await bridge<boolean>('onScreen', path).catch(() => false))) return
      await wait(pace(of).settle, t.signal)
    },
    stopped: () => t.signal.aborted,
    vault: {
      folders: () => vops.listFolders(needVault()),
      async create(folder, title, text) {
        const v = needVault()
        const r = await vops.createNote(v, folder, title, text)
        touch(t, r.touched, () => '新')
        send('files:changed')
        return r.path
      },
      async rename(path, name) {
        const v = needVault()
        await bridge('saveAll')
        const r = await vops.renamePath(v, opsDeps(v), path, name)
        touch(t, r.touched, movedKind(r, r.folder ? '移动' : '改名'))
        noteMoves(t, r)
        await bridge('moved', { from: r.from, to: r.to }).catch(() => undefined)
        send('files:changed')
        return r
      },
      async move(path, folder) {
        const v = needVault()
        await bridge('saveAll')
        const r = await vops.movePath(v, opsDeps(v), path, folder)
        touch(t, r.touched, movedKind(r, '移动'))
        noteMoves(t, r)
        await bridge('moved', { from: r.from, to: r.to }).catch(() => undefined)
        // 挂在它下面的数据库记录文件夹跟着挪了：开着的首页、条目跟着换路径
        for (const c of r.with ?? []) {
          noteMoves(t, { ...c, touched: r.touched })
          await bridge('moved', c).catch(() => undefined)
        }
        send('files:changed')
        return r
      },
      async trash(path) {
        const v = needVault()
        // 没存的字先存掉；查过了要删的那一样开着的标签先收起来（不然编辑器接着存字会把删掉的那篇建回来），再先提交、再删
        await bridge('saveAll')
        const r = await vops.trashPath(v, { ...opsDeps(v), beforeTrash: (rel) => bridge('closeTabs', rel).then(() => bridge('saveAll')).then(() => undefined, () => undefined) }, path)
        touch(t, r.touched, () => '删')
        send('files:changed')
        return r
      },
      async mkdir(parent, name) {
        const v = needVault()
        const r = await vops.makeFolder(v, parent, name)
        touch(t, r.touched, () => '新')
        send('files:changed')
        return r.path
      },
    },
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
        const colors = await accent()
        // 给了那一段里的几个字：指针先去找到那一段、亮一下、选中它，再剪（DESIGN.v3 2.3、B3）
        if (text && !whole && !(await web.pickBlock(text, colors, t.engine, () => t.signal.aborted))) throw new Error(`网页上没找到含「${text.slice(0, 20)}」的那一段。先 web_read 看看原文。`)
        const c = await web.pageForClip(whole)
        const path = await v.clip(c.text, c.url, c.title.slice(0, 300))
        t.touched.set(path, '新')
        // 剪下的那一段：左边一道竖线、段尾「✂ 剪成卡片」，撤回后去掉
        if (!whole) await web.markClip(path, colors, t.engine)
        await logActivity(v.root, { t: Date.now(), kind: 'clip', path })
        send('files:changed')
        return path
      },
    },
    doc: {
      read: () => bridge('docRead'),
      async insert(text) {
        const path = await docPath()
        await beforeEdit(t, path)
        // 只写一段：这一段左边竖线里一道光往下走、下面「AI 在写这一段 · 停下 esc」（turn 给界面认是哪一轮）；
        // AI 对话里写的包成 [!ai] 块（task-dtc34，标题、代码留在外面）
        await bridge('docInsert', { path, text: t.aiWrote ? wrapInsert(text, t.aiWrote) : text, turn: t.id })
        t.touched.set(path, '改')
        t.tally.added++
        return `插好了（${path}）`
      },
      async replaceSelection(text) {
        const path = await docPath()
        await beforeEdit(t, path)
        await bridge('docReplace', { path, text, turn: t.id })
        t.touched.set(path, '改')
        t.tally.changed++
        return `换好了（${path}）`
      },
    },
  }
}

const opsDeps = (v: Vault): vops.OpsDeps => ({ put: toTrash, stage: join(app.getPath('userData'), 'trash-undo'), moved: (from, to) => movedFiles(v.root, from, to) })

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
      async call(name, args, token) {
        const t = turnOf(token)
        await announce(t, name, args)
        const step = `${t.id}-${Math.random().toString(36).slice(2, 8)}`
        const label = toolLabel(name, args)
        t.emit({ type: 'tool', id: step, label, status: 'run' })
        try {
          const r = await runTool(name, args, hostFor(t))
          // 改名、挪动、删的原来是个文件夹：做完步骤行换成文件夹的说法
          const paths = r.isError || name === 'notes_list' ? [] : stepPaths(name, args, needVault().root, r.text)
          t.emit({ type: 'tool', id: step, label: r.label ?? label, status: r.isError ? 'err' : 'ok', ...(r.isError ? { detail: r.text } : {}), ...(paths.length ? { paths } : {}) })
          return { text: r.text, ...(r.isError ? { isError: true } : {}) }
        } catch (e) {
          const detail = String((e as Error).message ?? e)
          t.emit({ type: 'tool', id: step, label, status: 'err', detail })
          return { text: detail, isError: true }
        }
      },
    },
    { name: 'canvas-notes', version: app.getVersion() },
  )
  return mcp
}

/**
 * 这一轮在白板、文档、网页上动手时告诉界面（shared/ai-act.ts 的 actScope 定在哪、整块还是一处）：
 * 整块的第一次发 start（四边一道光绕圈、顶上「AI 正在整理这块白板 · 停下 esc」，到这一轮做完为止）；
 * 文档里只写一段发 spot（那一段由界面插的时候亮）；白板只加一张卡的 spot 等卡写好有了 id 再发（hostFor 的 spot）。
 * 只是看（board_list、doc_read）不亮：光只在 AI 真动手的地方
 */
async function announce(t: Turn, name: string, args: Record<string, unknown>) {
  if (!/^(board_|doc_|web_|note_write$)/.test(name)) return
  if (name.startsWith('web_') && t.whole.has('web')) return
  const ctx = name.startsWith('web_') ? null : await bridge<AgentContext>('context').catch(() => null)
  const tab = ctx?.tab.type === 'note' && ctx.tab.path ? ctx.tab : null
  const scope = actScope(name, args, { path: tab?.path ?? null, mode: tab?.mode ?? null, board: !!tab?.board })
  if (!scope) return
  t.acts.add(scope.area)
  if (scope.whole) {
    if (t.whole.has(scope.area)) return
    t.whole.add(scope.area)
    act({ turn: t.id, kind: 'start', area: scope.area, path: scope.path })
  } else if (scope.area === 'doc' && scope.path && !t.whole.has('doc')) act({ turn: t.id, kind: 'spot', area: 'doc', path: scope.path })
}

function emit(id: number, e: AiEvent) {
  send('ai:event', id, e)
}

/** 这一轮用我们 MCP 的哪个令牌：Claude Code 一轮一个进程、一轮一个令牌；别家的进程一直开着，一家一个 */
function tokenFor(server: McpServer, id: EngineId): { token: string; own: boolean } {
  if (id === 'claude') return { token: server.issue(), own: true }
  let tk = engineTokens.get(id)
  if (!tk) engineTokens.set(id, (tk = server.issue()))
  return { token: tk, own: false }
}

/**
 * 全能模式开始一轮前：工作区里已经有的改动（用户的字、软件外面删的附件……，软件自己的文件不算）先单独提交，说明照改了什么写
 * （「删除 15 个文件：…」），这一轮结束时库里多出来的改动才是这一轮的。返回没提交上的那几个（结束时也不算 AI 的）
 */
async function commitUserPending(root: string): Promise<string[]> {
  const st = (await git.status(root)).filter((s) => !git.isInternalPath(s.path))
  if (!st.length) return []
  try {
    await git.commitPaths(root, st.map((s) => s.path), git.describeChanges(st))
    return []
  } catch (e) {
    // 提交不上（没署名、锁一直不放）：不挡着这一轮；这几个记下来，结束时不算进 AI 那次，先单独再提交一次
    if (!(e instanceof git.GitError)) throw e
    console.error('全能模式开始前提交工作区的改动没成功', e.message)
    return st.map((s) => s.path)
  }
}

/** 命令行自己那几步里只读的（不改文件）；别的不认识的一律当成说不清改了什么 */
const READ_ONLY_STEPS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'TodoWrite', 'Skill', 'LS', 'ToolSearch'])
/** 点了名改哪个文件的几步：工具名 → 路径在哪个字段 */
const FILE_STEPS: Record<string, string> = { Write: 'file_path', Edit: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path', Delete: 'file_path' }

/** 命令行这一步动了什么：点了名的库里文件记进 named（写到库外面的不管），说不清的（跑命令、子 Agent、不认识的）记 shell */
function noteStep(t: Turn, root: string, tool: string, input: Record<string, unknown>) {
  const key = FILE_STEPS[tool]
  if (!key) {
    if (!READ_ONLY_STEPS.has(tool)) t.shell = true
    return
  }
  const all = [input[key], ...(Array.isArray(input.paths) ? input.paths : [])].filter((x): x is string => typeof x === 'string')
  for (const p of all) {
    const rel = vaultRel(root, p)
    if (rel) t.named.add(rel)
  }
}

/** 命令行给的路径（绝对的、相对库的；macOS 上 /var 和 /private/var 是同一处）换成库里的相对路径，不在库里是 null */
function vaultRel(root: string, p: string): string | null {
  if (!p) return null
  const abs = isAbsolute(p) ? p : join(root, p)
  let real = root
  try {
    real = realpathSync(root)
  } catch {
    // 库目录读不到：只按给的路径比
  }
  for (const r of [root, real]) if (abs.startsWith(r + '/')) return abs.slice(r.length + 1)
  return null
}

/**
 * 这一轮改了的提交成一次：我们工具记下的，全能模式下再加上库里多出来的改动（编辑器存的字、软件自己写的不算，
 * 除非监听看到外面又改了它）。提交失败（没署名、锁一直不放）：照实说是哪几个文件，界面「再提交一次」只提交它们
 */
async function commitTurn(v: Vault, t: Turn, message: string): Promise<{ commit: CommitInfo | null; kinds: Record<string, string>; failed?: AiCommitFailed }> {
  const kinds: Record<string, string> = Object.fromEntries(t.touched)
  /** 库里多出来的、不是这一轮 AI 改的：开始前就有、没提交上的；AI 没跑过命令时它没点名的（访达里删的、别的程序写的） */
  const others: git.FileStatus[] = []
  if (t.omni)
    for (const s of await git.status(v.root)) {
      if (git.isInternalPath(s.path) || kinds[s.path]) continue
      // 软件自己写过的（编辑器存的字）不算，除非外面又改了它：监听报过的，或者磁盘上已经不是软件最后写下的（监听还没来得及报）
      if (t.own.has(s.path) && !t.external.has(s.path) && !(/\.md$/i.test(s.path) && (await v.changedOutside(s.path)))) continue
      if (!t.named.has(s.path) && (t.before.has(s.path) || !t.shell)) {
        others.push(s)
        continue
      }
      kinds[s.path] = s.code.includes('D') ? '删' : s.code === '??' || s.code[0] === 'A' ? '新' : '改'
    }
  // AI 往笔记里新加、没包进 [!ai] 块的整段补包上（task-dtc34），和 AI 的改动在同一次提交里
  if (t.aiWrote) await wrapTurn(v, t, kinds)
  // 不是 AI 的先单独提交一次，说明照改了什么写（「删除 15 个文件：…」），不挂 AI 的名字；提交不上就留在工作区，等下次自动提交
  if (others.length)
    await git.commitPaths(v.root, others.map((s) => s.path), git.describeChanges(others)).catch((e: unknown) => {
      if (!(e instanceof git.GitError)) throw e
      console.error('这一轮里不是 AI 的改动提交失败', e.message)
    })
  const paths = Object.keys(kinds)
  if (!paths.length) return { commit: null, kinds }
  try {
    const hash = await git.commitPaths(v.root, paths, message)
    send('files:changed')
    return { commit: hash ? ((await git.log(v.root, 1))[0] ?? null) : null, kinds }
  } catch (e) {
    if (!(e instanceof git.GitError)) throw e
    console.error('AI 这一轮改完提交失败', e.message)
    send('files:changed')
    return { commit: null, kinds, failed: { failed: commitErrorText(e.message), paths, message } }
  }
}

/** 这一篇在上一次提交里的样子（那时还没有它是空的）；CRLF、BOM 照编辑器读的去掉 */
async function headText(root: string, path: string): Promise<string> {
  const there = (await git.git(root, ['ls-tree', '--name-only', 'HEAD', '--', path]).catch(() => '')).trim()
  if (!there) return ''
  return (await git.git(root, ['show', `HEAD:${path}`])).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
}

/**
 * 这一轮结束补包（task-dtc34）：这一轮改了的每篇笔记（不是新建的）和这一轮开始时（上一次提交，开始前用户的字已经单独提交了）比，
 * AI 纯新增、没包的整段包成 [!ai] 块；改了用户原有字的地方不包（那是「改」，照「AI 动过」的光和历史看）。
 * 这一轮里用户自己在同一篇打的整段不包：按这一篇的每一版（trail）认，编辑器存下的那一版比上一版多出来的是用户打的。
 * 写回磁盘、告诉开着这篇的编辑器（按外部改动合并），和 AI 的改动一起提交，「撤回」一下都撤掉
 */
async function wrapTurn(v: Vault, t: Turn, kinds: Record<string, string>) {
  for (const [path, kind] of Object.entries(kinds)) {
    if (kind !== '改' || !/\.md$/i.test(path) || git.isInternalPath(path)) continue
    const before = await headText(v.root, path)
    // 直接读磁盘，不经 Vault（Vault.read 会把这一版记成「软件读到过的」，监听就不再报 AI 刚写的那一下，编辑器收不到）
    const disk = await readFile(v.abs(path)).then(decodeNote, (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (!disk) continue
    let prev = blockKeys(before)
    const mine = new Set<string>()
    for (const e of t.trail) {
      if (e.path !== path) continue
      const now = blockKeys(e.text)
      if (e.own) for (const k of now) if (!prev.has(k)) mine.add(k)
      prev = now
    }
    const r = wrapNewBlocks(before, disk.text, t.aiWrote!, (k) => mine.has(k))
    if (!r.wrapped) continue
    // 正好这一下编辑器又存了字（磁盘和刚读的不一样）：这次不包，AI 的改动照样提交
    if (decodeNote(await readFile(v.abs(path))).text !== disk.text) continue
    // 像外面改的一样写（不记进 Vault）：监听读到磁盘上最新的那一版交给编辑器，编辑器照「外部改动不丢正在打的字」三方合并。
    // 以前用 Vault.write + 直接发 note:changed：编辑器刚存过字时，这份旧的字排在后面合进去，把用户刚打的字当成被删掉了
    // 监听报过 AI 写的那一下（编辑器已经拿到 AI 的字、正在长）：这一回只当外部改动合并，不当 AI 又写了一回；
    // 还没报过（AI 写完这一轮马上就答完，两下会并成一下报）：这一回就是编辑器头一次见到 AI 的字，照旧当 AI 写的、一点点长出来
    wrapWrites.set(path, { at: Date.now(), grow: await v.changedOutside(path) })
    await atomicWrite(v.abs(path), encodeNote(r.text, disk.meta))
  }
}

/** 这一轮结束补包写的（路径 → 什么时候、要不要当 AI 写的长出来） */
const wrapWrites = new Map<string, { at: number; grow: boolean }>()

export interface AgentTurnResult {
  outcome: EngineOutcome | null
  /** 中途出错或停下（已经改了的照样提交了） */
  error?: string
  /** 中途出错或停下时的会话号（答完的在 outcome 里） */
  session?: string
  commit: CommitInfo | null
  kinds: Record<string, string>
  /** 改好了、提交没成功 */
  failed?: AiCommitFailed
  /** 改名、挪动了的：新路径 → 旧路径 */
  moved?: Record<string, string>
}

/**
 * 跑一轮能动手的对话（AI 对话、读 PDF 共用）：给我们的 MCP 工具；全能模式开着时命令行自己的工具也全给，它的每一步发成步骤行。
 * 这一轮 AI 改了的提交成一次「AI：subject」；中途出错、停下也把已经改了的提交掉：改动永远能撤回。
 * id：外圈、提示条、「停下」认的编号；omni：调的人读的开关（和它写进话里的【模式】一致）
 */
export async function runAgentTurn(o: {
  id: number
  engine: EngineId
  omni: boolean
  ac: AbortController
  subject: string
  emit(e: AiEvent): void
  run: Omit<EngineRun, 'cwd' | 'mcp' | 'omni' | 'onStep' | 'signal'>
  /** AI 往笔记里新加的整段包成 [!ai] 块时头上写的（AI 对话、旁支给；读 PDF 不给，它的笔记有自己的写法） */
  aiWrote?: AiWrote
}): Promise<AgentTurnResult> {
  const v = needVault()
  const t: Turn = { id: o.id, engine: o.engine, touched: new Map(), checked: new Set(), acts: new Set(), whole: new Set(), tally: noTally(), signal: o.ac.signal, omni: o.omni, own: new Set(), external: new Set(), moved: new Map(), named: new Set(), shell: false, before: new Set(), wrote: false, emit: o.emit, ...(o.aiWrote ? { aiWrote: o.aiWrote } : {}), trail: [] }
  let outcome: EngineOutcome | null = null
  let error: string | undefined
  /** 没答完（停下、出错）时引擎给的会话号：已经做了的几步在这个会话里，「接着做」接着它 */
  let session: string | undefined
  let token: { token: string; own: boolean } | null = null
  liveTurns.add(t)
  turns.set(o.id, o.ac)
  try {
    await bridge('saveAll')
    if (o.omni) for (const p of await commitUserPending(v.root)) t.before.add(p)
    const server = await ensureMcp()
    token = tokenFor(server, o.engine)
    if (token.own) byToken.set(token.token, t)
    // 设置 › AI「给AI的长期说明」：放在这一问的最前面（AI 对话、读 PDF 都走这里）
    const note = store.prompt().trim()
    outcome = await engine(o.engine).run({
      ...o.run,
      ...(note ? { prompt: `${userNoteLine(note)}${o.run.prompt}` } : {}),
      cwd: v.root,
      mcp: { url: server.url, token: token.token, tools: toolSpecs().map((x) => x.name) },
      omni: o.omni,
      // 命令行自己的那一步（全能模式下跑命令、写文件、上网搜）：在做转圈、做完绿勾，和我们工具的步骤行一样
      onStep: (st) => {
        if (st.status === 'run') noteStep(t, v.root, st.tool, st.input)
        const paths = st.tool === 'Glob' ? [] : stepPaths(st.tool, st.input, v.root)
        o.emit({ type: 'tool', id: `${t.id}-${st.id}`, ...stepLabel(st.tool, st.input, v.root), status: st.status, ...(st.detail ? { detail: st.detail } : {}), ...(paths.length ? { paths } : {}) })
      },
      signal: o.ac.signal,
    })
  } catch (e) {
    error = (e as Error).name === 'AbortError' || o.ac.signal.aborted ? '停下了' : explain(o.engine, String((e as Error).message ?? e))
    session = sessionOf(e)
  } finally {
    liveTurns.delete(t)
    if (t.omni) omniEndedAt = Date.now()
    turns.delete(o.id)
    if (token?.own) {
      byToken.delete(token.token)
      mcp?.revoke(token.token)
    }
    // 网页里的指针收起，剪下的标记留着
    if (t.acts.has('web')) await web.endWebAct()
  }
  let done: Awaited<ReturnType<typeof commitTurn>> | null = null
  try {
    done = await commitTurn(v, t, `AI：${subject(o.subject)}`)
  } finally {
    // 提交好了再收光：做完的提示条带「撤回」（就是这一次提交），停下、出错的变灰淡掉；提交出了错也收
    if (t.acts.size || t.wrote) act({ turn: t.id, kind: 'end', stopped: o.ac.signal.aborted || !!error, commit: done?.commit?.hash ?? null, tally: t.tally })
  }
  const { commit, kinds, failed } = done
  const moved = t.moved.size ? Object.fromEntries(t.moved) : undefined
  return { outcome, ...(error ? { error } : {}), ...(session ? { session } : {}), commit, kinds, ...(failed ? { failed } : {}), ...(moved ? { moved } : {}) }
}

/** 软件自己写了库里这个文件（编辑器存字、剪藏、速记、改名挪动）：正在答的全能模式那几轮不把它算成 AI 改的 */
export function agentOwnWrite(path: string, text?: string) {
  for (const t of liveTurns) {
    if (t.omni) t.own.add(path)
    if (t.aiWrote && text !== undefined && /\.md$/i.test(path)) t.trail.push({ path, own: !aiWriting.has(path), text })
  }
}

/** 我们的工具正在写的这几篇（editNote）：软件自己写的，但是是 AI 的字 */
const aiWriting = new Set<string>()

/**
 * 监听看到库里这个文件在外面改了（AI 自己的工具改的）：正在答的全能模式那几轮把它算回 AI 改的；
 * 是笔记就告诉界面这是最新那一轮 AI 写的（紧接着的 note:changed 合进编辑器时新的字一点点长出来，task-6kun1）
 */
export function agentExternal(path: string, text?: string) {
  for (const t of liveTurns) {
    if (t.omni) t.external.add(path)
    if (t.aiWrote && text !== undefined && /\.md$/i.test(path)) t.trail.push({ path, own: false, text })
  }
  if (!/\.md$/i.test(path)) return
  // 这一轮结束补包成 AI 块写的那一下：编辑器照外部改动合并就好，不是 AI 又写了字
  const wrapped = wrapWrites.get(path)
  if (wrapped) {
    wrapWrites.delete(path)
    if (!wrapped.grow && Date.now() - wrapped.at < 10_000) return
  }
  const t = [...liveTurns].reverse().find((x) => x.omni)
  if (t) wroteNote(t, path)
  // 写完紧接着这一轮就答完了（监听晚到几十毫秒）：照样是 AI 写的，只是没有还在答的一轮了（不挂「AI 在写这一段」到这一轮做完）
  else if (Date.now() - omniEndedAt < 3000) act({ turn: 0, kind: 'wrote', path })
}

/** 全能模式最近一轮答完的时候（AI 自己写的文件，监听可能在这一轮结束后才报） */
let omniEndedAt = 0

/** 这一轮 AI 写了这一篇：界面上开着它的编辑器、白板认这一下（DESIGN.v3 2.3「字一点点长出来」） */
function wroteNote(t: Turn, path: string) {
  t.wrote = true
  act({ turn: t.id, kind: 'wrote', path })
}

/** 全能模式开着没有（读 PDF 那边写【模式】、跑引擎用） */
export const omniOn = () => store.omni()

/** 会话接不上时补的最近几轮 */
function historyOf(msgs: StoredMsg[]): string | undefined {
  const recent = msgs.filter((m) => m.text).slice(-10)
  if (!recent.length) return undefined
  const lines = recent.map((m) => `${m.role === 'user' ? '用户' : 'AI'}：${(m.text ?? '').slice(0, 600)}`)
  return `之前聊过的（供参考）：\n${lines.join('\n')}`
}

const turns = new Map<number, AbortController>()

/** 界面给的旁支：形状不对的不收（编号只许字母数字和 -，主进程按它记会话号） */
function checkSides(x: unknown[]): ChatSide[] {
  return x.filter((s): s is ChatSide => {
    const o = s as Partial<ChatSide> | null
    return !!o && typeof o.id === 'string' && /^[\w-]{1,80}$/.test(o.id) && typeof o.msg === 'number' && typeof o.quote === 'string' && Array.isArray(o.msgs) && typeof o.createdAt === 'number'
  })
}

/** 地方的 key、名字：界面给的，进文件名前过一遍 */
function placeOf(p: unknown): { key: string; label: string } | null {
  if (p === undefined) return null
  const o = p as { key?: unknown; label?: unknown }
  if (!o || typeof o.key !== 'string' || !o.key || o.key.length > 4000 || typeof o.label !== 'string' || o.label.length > 400) throw new Error('AI 参数不对')
  return { key: o.key, label: o.label }
}

async function runTurn(req: TurnRequest): Promise<TurnResult> {
  if (!IDS.includes(req.engine) || typeof req.text !== 'string' || typeof req.id !== 'number') throw new Error('AI 参数不对')
  if (req.subject !== undefined && (typeof req.subject !== 'string' || !req.subject.trim() || req.subject.length > 400)) throw new Error('AI 参数不对')
  const place = placeOf(req.place)
  const mats = checkMaterials(req.mats)
  if (dockBusy) throw new Error('上一轮还没做完，等它做完或者先停下')
  const v = needVault()
  dockBusy = true
  // 一开始就登记「停下」（读贴的图、拼话这一会儿按停下也算数）
  const ac = new AbortController()
  turns.set(req.id, ac)
  let text = ''
  try {
    // 接着这个地方自己的会话（D 组 CN-132）；没给地方就不接着谁。系统提示改过版本的旧会话不再接着聊
    const chat = place ? store.chat(v.root, place.key) : null
    const omni = store.omni()
    // 这一问的模型、effort 不对（界面给的）：照旧当这一轮出错说回去，不当成调用失败
    let picked: ReturnType<typeof chatRun>
    try {
      picked = chatRun(req.engine, req)
    } catch (e) {
      return { text: '', commit: null, kinds: {}, error: String((e as Error).message ?? e) }
    }
    const wrote = wroteFor(req.engine, req, place, req.id)
    const r = await runAgentTurn({
      id: req.id,
      engine: req.engine,
      omni,
      ac,
      subject: req.subject ?? req.text,
      emit: (e) => emit(req.id, e),
      aiWrote: wrote,
      run: {
        ...picked,
        // 开头一行是现在开没开全能模式（系统提示在一个会话里定死了，开关随时会换）；【AI 块】这一问往笔记里新加的段落包成的头；
        // 引用的材料：字里的 ①②，后面按同一套编号列出每块
        prompt: `${modeLine(omni, req.engine, v.root, req.text)}\n${aiBlockLine(aiWroteHead(wrote))}\n${describeContext(req.context)}\n${await vaultNotes(v.root, req.context, req.text)}\n\n用户说：\n${withMaterials(req.text, mats)}${langTail(req.text)}`,
        system: AGENT_SYSTEM,
        session: place ? store.session(v.root, place.key, req.engine, AGENT_VERSION) : undefined,
        history: chat ? historyOf(chat.msgs.filter((m) => !(m.role === 'user' && m.text === req.text))) : undefined,
        images: await pastedImages(req.pasted),
        onText: (delta) => {
          text += delta
          emit(req.id, { type: 'text', delta })
        },
      },
    })
    text = (r.outcome?.text || text).replace(/\n{3,}/g, '\n\n')
    // 没答完也记下会话号：「接着做」、接着问都接着这个会话，不开新会话（以前只记答完的，停下以后下一问从头开、只补几句之前聊过的）
    const session = r.outcome?.session ?? r.session
    if (place && session) store.setSession(v.root, place.key, req.engine, session, AGENT_VERSION)
    return { text, commit: r.commit, kinds: r.kinds, ...(r.error ? { error: r.error } : {}), ...(r.failed ? { failed: r.failed } : {}), ...(r.moved ? { moved: r.moved } : {}) }
  } finally {
    dockBusy = false
    turns.delete(req.id)
  }
}

/** AI 对话这一格正在答 */
let dockBusy = false

/**
 * 每条消息开头的【库里的笔记】（task-3e53q）：AI 照着写链接的路径，不用猜。列哪几篇见 shared/cite-rule.ts 的 notesLine；
 * 读 PDF 也用（current 是那份 PDF）
 */
export async function vaultNotes(root: string, c: { tab?: { path?: string }; recent?: string[] } | null, said: string): Promise<string> {
  const files = await listEntries(root)
  return notesLine({ files, ...(c?.tab?.path ? { current: c.tab.path } : {}), ...(c?.recent ? { recent: c.recent } : {}), said })
}

/**
 * AI 对话这一问往笔记里新加的段落包成 [!ai] 块时头上写的（task-dtc34）：哪家 · 哪个模型（和回答头上一样，不带 effort），
 * 有地方时链回这段对话的这一条回答（msg 是 AI 那条消息的编号）
 */
function wroteFor(engine: EngineId, req: { model?: unknown }, place: { key: string } | null, msg: number): AiWrote {
  const p = effectivePick(engine, typeof req.model === 'string' ? { model: req.model } : {})
  return { by: pickLabel({ engine, ...(p.model ? { model: p.model } : {}) }, modelsFor(engine)), ...(place ? { link: chatLink(place.key, msg) } : {}) }
}

/**
 * 旁支里问一句（task-4edsc：AI 对话、文档里 AI 讲解块的旁支）。第一问从这个地方主对话的会话整段分叉（fresh 的不分叉，开新会话），
 * 之后接着旁支自己的会话（记在这个地方的对话文件里），主对话的会话一直不动；不占 AI 对话那一格（主对话照样能问）。
 * 能动手（同 AI 对话，这一轮改的提交一次、能撤回）
 */
async function runSideTurn(req: SideTurnRequest): Promise<TurnResult> {
  if (!req || !IDS.includes(req.engine) || typeof req.text !== 'string' || typeof req.id !== 'number') throw new Error('AI 参数不对')
  const place = placeOf(req.place)
  const side = req.side
  const str = (x: unknown, max: number) => typeof x === 'string' && x.length <= max
  const opt = (x: unknown, max: number) => x === undefined || str(x, max)
  if (!place || !side || !str(side.id, 80) || !/^[\w-]{1,80}$/.test(side.id) || !str(side.quote, 20_000) || !str(side.history, 200_000) || !opt(side.ask, 20_000) || !opt(side.where, 400)) throw new Error('AI 参数不对')
  const mats = checkMaterials(req.mats)
  const v = needVault()
  const ac = new AbortController()
  turns.set(req.id, ac)
  let text = ''
  try {
    let picked: ReturnType<typeof chatRun>
    try {
      picked = chatRun(req.engine, req)
    } catch (e) {
      return { text: '', commit: null, kinds: {}, error: String((e as Error).message ?? e) }
    }
    const mine = store.sideSession(v.root, place.key, side.id, req.engine)
    const base = side.fresh ? undefined : store.session(v.root, place.key, req.engine, AGENT_VERSION)
    const omni = store.omni()
    // 旁支里写进笔记的也包成 [!ai] 块；不带「回到对话」（旁支的问答不在对话列表里，没有一条能滚到）
    const wrote = wroteFor(req.engine, req, null, req.id)
    const r = await runAgentTurn({
      id: req.id,
      engine: req.engine,
      omni,
      ac,
      subject: `旁支：${req.text}`,
      emit: (e) => emit(req.id, e),
      aiWrote: wrote,
      run: {
        ...picked,
        prompt: `${modeLine(omni, req.engine, v.root, req.text)}\n${aiBlockLine(aiWroteHead(wrote))}\n${describeContext(req.context)}\n${await vaultNotes(v.root, req.context, req.text)}\n\n${sideTurnPrompt({ first: !mine, quote: side.quote, ...(side.ask ? { ask: side.ask } : {}), ...(side.where ? { where: side.where } : {}), question: withMaterials(req.text, mats) })}${langTail(req.text)}`,
        system: AGENT_SYSTEM,
        session: mine ?? base,
        ...(!mine && base ? { fork: true } : {}),
        // 分叉不了（Gemini、OpenCode、主对话还没有会话、文档里的讲解块）：被问的那一轮（那段讲解）放在第一问前面
        ...(side.history ? { history: side.history } : {}),
        images: await pastedImages(req.pasted),
        onText: (delta) => {
          text += delta
          emit(req.id, { type: 'text', delta })
        },
      },
    })
    text = (r.outcome?.text || text).replace(/\n{3,}/g, '\n\n')
    const session = r.outcome?.session ?? r.session
    if (session && session !== base) store.setSideSession(v.root, place.key, side.id, req.engine, session)
    return { text, commit: r.commit, kinds: r.kinds, ...(r.error ? { error: r.error } : {}), ...(r.failed ? { failed: r.failed } : {}), ...(r.moved ? { moved: r.moved } : {}) }
  } finally {
    turns.delete(req.id)
  }
}

function subject(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > 40 ? one.slice(0, 40) + '…' : one
}

// ---------- 只聊天（/ 命令） ----------

/** 设置 › AI 里这个功能用哪家哪个模型（CN-44）。小活的 Claude Code 模型 CN_FAST_MODEL 能换（测试和自己试用） */
export function pickFor(feature: AiFeature): AiPick {
  const prefs = store.prefs()
  let p = resolvePick(prefs, feature)
  // 选的那家这台 Mac 上没装：小活退回默认那家（以前「装了 Claude Code 就用 Haiku，没装用浮窗选的」的规矩，usesOf 里）
  if (usesOf(prefs, installed)[feature] !== p.engine) p = prefs.default
  // 默认那家也用不了（没装 Claude Code、Key 删了）：找到哪家用哪家（命令行、Key、本机模型依次，task-587os）
  if (!installed(p.engine)) p = firstAvailable(feature) ?? p
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

/**
 * 这家能选的模型（task-m55m7）：从命令行拉到的（engine-watch.ts，启动后、每天一次、版本变了、点「检查更新」时拉，记在软件设置目录）；
 * 没拉到过用自带的（Claude Code 三个、别家只有「某家默认模型」）。假 AI 又不盯命令行时（CN_AI_FAKE=1）Codex 给一份固定的
 */
function modelsFor(id: EngineId): ModelOption[] {
  if (!isCli(id)) return modelsOf(id, sourceModels(id))
  const pulled = pulledModels(id)
  if (pulled) return modelsOf(id, pulled)
  return modelsOf(id, id === 'codex' && FAKE() ? fakeCodexModels() : [])
}

/**
 * 这一问真正用的哪家、哪个模型、哪一档（CN-91）：请求里带了就用请求的（输入框底行选的，只管这个对话），没带用「AI 对话」那一行的，
 * effort 没设过是 High；这个模型不认这一档（Codex 每个模型那几档不一样）就用它自己的默认档；Gemini、OpenCode 只有哪家
 */
function effectivePick(id: EngineId, req: { model?: string; effort?: string } = {}): AiPick {
  const p = pickFor('chat')
  const def = store.prefs().default
  const own: AiPick = p.engine === id ? p : def.engine === id ? def : { engine: id }
  return fitPick(id, modelsFor(id), { model: req.model ?? own.model, effort: req.effort ?? own.effort })
}

/** 「AI 对话」这一行现在选的：哪家、哪个模型、想多久（effort 没设过是 High；Gemini、OpenCode 没有 effort） */
export const chatPick = (): AiPick => effectivePick(pickFor('chat').engine)

/**
 * 数据库 AI 列这一格用哪家（task-i921u）：这一列单独选了的照选的（家不认识就跟 AI 对话），没选跟「AI 对话」那一行；
 * by 是新建那篇 [!ai] 块头上写的「Claude Code · Opus 5.5」（和 AI 写的块一样，不带 effort）
 */
export function columnPick(own: { engine: string; model?: string; effort?: string } | null): { pick: AiPick; by: string } {
  const engine = own && IDS.includes(own.engine as EngineId) ? (own.engine as EngineId) : null
  const p = engine ? effectivePick(engine, { ...(own?.model ? { model: own.model } : {}), ...(own?.effort ? { effort: own.effort } : {}) }) : chatPick()
  return { pick: p, by: pickLabel({ engine: p.engine, ...(p.model ? { model: p.model } : {}) }, modelsFor(p.engine)) }
}

/** 「Claude Code · Opus 5.5 · High」：AI 对话、读 PDF 回答头上那行（CN-91） */
export const chatLabel = () => {
  const p = chatPick()
  return pickLabel(p, modelsFor(p.engine))
}

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
  return { engine, ...(typeof o.model === 'string' ? { model: o.model } : {}), ...(typeof o.effort === 'string' ? { effort: o.effort } : {}) }
}

/** 看图问（视频框一块问、拍导图）用 Claude Code 的哪个模型 */
export const visionModel = () => modelOpt('vision', 'claude').model

/** 各功能用的「Claude Code · Opus 5.5」（界面上写是哪个模型做的，CN-54） */
export const featureLabel = (feature: AiFeature) => {
  const p = pickFor(feature)
  return pickLabel(p, modelsFor(p.engine))
}

/** 用这个功能选好的引擎问一次，不给工具；onText 边生成边给（/ 命令是 AI 对话，梦游是梦游） */
export async function ask(system: string, prompt: string, signal: AbortSignal, onText: (d: string) => void, feature: AiFeature = 'chat'): Promise<string> {
  const v = deps.vault()
  const p = pickFor(feature)
  // 梦游不用本机模型（2026-11-23 用户定：真库上判双链准确率五六成）
  if (feature === 'dream' && isLocal(p.engine)) throw new Error(t('梦游不用本机模型：接一把API Key或装Claude Code才能梦游'))
  const r = await engine(p.engine)
    .run({ prompt, system, cwd: v?.root ?? app.getPath('home'), signal, onText, ...modelOpt(feature, p.engine) })
    .catch((e: Error) => {
      throw signal.aborted ? e : Object.assign(new Error(explain(p.engine, String(e.message ?? e))), { name: e.name })
    })
  return r.text
}

/**
 * 照给的那一家、模型、想多久问一次，不给工具（/ 命令：AI 输入框底行选的，task-0fhyo）；模型、effort 和 AI 对话一样过一遍
 * （chatRun：这个模型不认的档换成它自己的默认档，CN_AI_MODEL 能换默认的 Opus）；images 是一起给的图
 */
export async function askWith(system: string, prompt: string, signal: AbortSignal, onText: (d: string) => void, pick: { engine: EngineId; model?: string; effort?: string }, images: EngineImage[] = []): Promise<string> {
  if (!IDS.includes(pick.engine)) throw new Error('AI 参数不对')
  const v = deps.vault()
  const r = await engine(pick.engine).run({ prompt, system, cwd: v?.root ?? app.getPath('home'), signal, onText, ...chatRun(pick.engine, pick), ...(images.length ? { images } : {}) })
  return r.text
}

/** 快而便宜的模型：翻译这类一次要问很多遍的活用它（CN_FAST_MODEL 能换） */
export const FAST_MODEL = process.env.CN_FAST_MODEL || 'haiku'

/** 小活用哪家（设置 › AI 的「小活」，从没设过是 Claude Code · Haiku） */
export function fastEngine(): { id: EngineId; label: string } {
  const p = pickFor('quick')
  return { id: p.engine, label: pickLabel(p, modelsFor(p.engine)) }
}

/** 用小活那家问一次，不给工具 */
export async function askFast(system: string, prompt: string, signal: AbortSignal, onText: (d: string) => void): Promise<string> {
  const v = deps.vault()
  const p = pickFor('quick')
  const r = await engine(p.engine)
    .run({ prompt, system, cwd: v?.root ?? app.getPath('home'), signal, onText, ...modelOpt('quick', p.engine) })
    .catch((e: Error) => {
      throw signal.aborted ? e : Object.assign(new Error(explain(p.engine, String(e.message ?? e))), { name: e.name })
    })
  return r.text
}

/**
 * AI 没答出来、而这家命令行不兼容（task-m55m7）：自查查出来过、或者它的原话就是「不认这个参数」，
 * 前面加一行「【不兼容】Claude Code 2.2.0 有一个参数不认了：--x，AI 对话可能出错」（界面认这一行，说清楚、给「换一家」；
 * 梦游报告、翻译这些地方原样显示也看得懂）。原话留在后面
 */
export const INCOMPATIBLE = '【不兼容】'
const CLI_REJECTS = /unknown option '(--?[\w-]+)'|option '(--[\w-]+)[^']*' argument '([^']*)' is invalid|Unknown (--[\w-]+) value '([^']*)'|[Mm]ethod not found/

function explain(id: EngineId, raw: string): string {
  if (raw.startsWith(INCOMPATIBLE) || !isCli(id)) return raw
  const { version, health } = engineState(id)
  const head = `${LABELS[id]}${version ? ` ${version}` : ''}`
  if (health?.state === 'bad') return `${INCOMPATIBLE}${head} ${problemText(health.problems)}\n${raw}`
  const m = CLI_REJECTS.exec(raw)
  if (!m) return raw
  const what = m[1] ?? (m[2] ? `${m[2]} ${m[3]}` : m[4] ? `${m[4]} ${m[5]}` : '我们用的接口')
  return `${INCOMPATIBLE}${head} 不认 ${what}，多半是命令行更新了\n${raw}`
}

// ---------- 本机装了哪几家（CN-87） ----------

/** 找命令是真的：不是假 AI，或者测试要真的找（CN_REAL_FIND=1：找命令走真的，跑的还是假引擎） */
const REAL_FIND = () => !FAKE() || process.env.CN_REAL_FIND === '1'

const verifying = new Set<string>()

/** 后台跑一次 `--version`；运行不了时通知界面再要一次（先前当它能用报出去了）；能跑的 Codex 接着问它有哪些模型 */
function verify(id: CliId, path: string) {
  if (verifying.has(path)) return
  verifying.add(path)
  void checkCli(path)
    .then((c) => {
      if (!c.ok) send('ai:prefs:changed')
      // 版本和记下的不一样（Claude Code 自己在后台升级了）：后台自查、重拉模型
      else noteVersion(id, c.version)
    })
    .finally(() => verifying.delete(path))
}

const brokenHint = (id: CliId) => `找到了 ${COMMAND[id]}，但运行不了。在终端里运行一次 ${COMMAND[id]} --version 看看哪里不对，或者重新装一遍。`

/** 测试用的假命令行（CN_AI_FAKE=1）：在哪找到照真的样子写；CN_AI_FAKE_CLI=codex=missing,gemini=broken 演没找到、运行不了 */
const FAKE_WHERE: Record<CliId, string> = { claude: '~/.local/bin', codex: '/opt/homebrew/bin', gemini: '/opt/homebrew/bin', opencode: '~/.opencode/bin' }
function fakeFound(id: CliId): Pick<EngineInfo, 'path' | 'where' | 'broken' | 'custom' | 'hint'> {
  const mine = store.cliPaths()[id]
  if (mine) return { path: mine, where: whereOf(mine, app.getPath('home')), custom: true }
  const state = new Map((process.env.CN_AI_FAKE_CLI ?? '').split(',').map((kv) => kv.split('=') as [string, string])).get(id)
  if (state === 'missing') return { path: null, where: '没找到', hint: INSTALL_HINT[id] }
  if (state === 'broken') return { path: null, where: FAKE_WHERE[id], broken: `运行 ${COMMAND[id]} --version 出错（退出码 1）：测试用的坏命令行`, hint: brokenHint(id) }
  return { path: `/fake/${id}`, where: FAKE_WHERE[id] }
}

function found(id: EngineId): Pick<EngineInfo, 'path' | 'where' | 'broken' | 'custom' | 'hint'> {
  // API Key、本机模型：没有命令行，能用时给一个记号（界面照旧按 path 认能不能用）
  if (!isCli(id)) return sourceReady(id) ? { path: `${routeOf(id)}:${id}`, where: '' } : { path: null, where: isApi(id) ? '没填Key' : '没找到' }
  if (!REAL_FIND()) return fakeFound(id)
  const hit = locateCli(id)
  if (!hit) return { path: null, where: '没找到', hint: INSTALL_HINT[id] }
  const mine = hit.custom ? { custom: true } : {}
  const c = checkedCli(hit.path)
  // 还没跑过 --version（或者文件换过了）：先当它能用，后台跑完运行不了再改口
  if (!c) verify(id, hit.path)
  if (c && !c.ok) return { path: null, where: hit.where, broken: c.why, hint: brokenHint(id), ...mine }
  return { path: hit.path, where: hit.where, ...mine }
}

export function engineInfo(): EngineInfo[] {
  const states = sourceStates()
  return IDS.map((id) => {
    const models = modelsFor(id)
    const where = found(id)
    const tail = states.find((s) => s.id === id)?.tail
    return { id, label: LABELS[id], route: routeOf(id), ...where, models, efforts: models[0]?.efforts ?? [], ...(tail ? { tail } : {}), ...(isCli(id) ? watchInfo(id, where.path) : {}) }
  })
}

/** 这一家现在能不能用（命令行找到了、Key 填过、本机模型开着）：费曼、认时间这些问之前先看 */
export const engineReady = (id: EngineId) => installed(id)

/** 用不了时说一句怎么办 */
export function notReadyHint(id: EngineId): string {
  if (isCli(id)) return INSTALL_HINT[id]
  if (isApi(id)) return t('还没填{name}的Key：在AI栏或 设置 › AI填一把', { name: LABELS[id] })
  return t('{name}没开或里面没有模型：打开它，再在 设置 › AI点「再找一遍」', { name: LABELS[id] })
}

/**
 * 梦游判断这一次用哪家（task-587os，设计页第 5 节）：设置 › 梦游 选的那家能用就照选的；
 * 用不了（没装 Claude Code）而填了 Anthropic Key：Haiku 5.5 · Low（门槛 0.85 由 judgeLine 按 Haiku 定）；
 * 都没有照选的（问的时候说没装）。别家 Key 判双链没量过准确率，第一版不拿来判；本机模型梦游不用（用户定）
 */
export function effectiveJudge<J extends { engine: EngineId; model: string; effort: string }>(j: J): J {
  if (installed(j.engine) && !isLocal(j.engine)) return j
  if (sourceReady('anthropic')) return { ...j, engine: KEY_JUDGE.engine, model: KEY_JUDGE.model, effort: KEY_JUDGE.effort }
  const cli = CLI_ORDER.find((id) => installed(id))
  if (cli) return { ...j, engine: cli, model: cli === 'claude' ? 'sonnet' : '', effort: cli === 'claude' ? 'medium' : '' }
  return j
}

/** 这台 Mac 上一个能用的都没有（没命令行、没 Key、本机模型没开）：AI 栏第一次打开就是三选一卡 */
export const noAi = () => !IDS.some((id) => installed(id))

/**
 * 这个功能在选的那家用不了时找哪家（找到哪家默认哪家，task-587os）：命令行、Key、本机模型依次；
 * 梦游、看图问、出卡不用本机模型（梦游 2026-11-23 用户定去掉本机模型；看图问本机模型不认图）。
 * Key 那家：小活用便宜的（Haiku），别的用推荐的（Sonnet）
 */
function firstAvailable(feature: AiFeature): AiPick | null {
  const id = IDS.find((x) => installed(x) && !(isLocal(x) && feature !== 'chat' && feature !== 'quick'))
  if (!id) return null
  if (isCli(id)) return id === 'claude' ? { engine: id, model: CLAUDE_DEFAULT } : { engine: id }
  const ids = modelsFor(id).map((m) => m.id)
  if (isApi(id)) return { engine: id, model: preferModel(ids, feature === 'quick' ? API_DEFAULT[id].quick : API_DEFAULT[id].chat) }
  return { engine: id, model: ids[0] ?? '' }
}

/** 「重新找一遍」：重新取登录 shell 的 PATH、每家重新跑 --version，跑完再答；和先前不一样就让开着的 AI 面板都再要一次 */
async function findAgain(): Promise<void> {
  // 本机模型（Ollama、LM Studio）每次都真找（测试用 CN_LOCAL_BASE_* 指到假的或关着的地址）
  const before = JSON.stringify(engineInfo())
  await probeAll()
  if (!REAL_FIND()) {
    if (JSON.stringify(engineInfo()) !== before) send('ai:prefs:changed')
    return
  }
  forgetChecks()
  await loadShellPath(true)
  await Promise.all(CLI_ORDER.map((id) => locateCli(id)).map((hit) => hit && checkCli(hit.path)))
  // 重新找到的：版本、模型、自查也再看一遍（等它做完再答）
  await refreshAll()
  if (JSON.stringify(engineInfo()) !== before) send('ai:prefs:changed')
}

/** 启动后在后台取登录 shell 的 PATH：取到以后找到的和先前不一样，通知界面再要一次 */
function findInBackground() {
  // 本机模型开没开（2 秒不回算没开）：找到了让开着的 AI 面板再要一次
  void probeAll().then(() => {
    if (LOCAL_ORDER.some((id) => sourceReady(id))) send('ai:prefs:changed')
  })
  if (!REAL_FIND()) return
  const before = CLI_ORDER.map((id) => locateCli(id)?.path ?? null).join('\n')
  void loadShellPath().then(() => {
    if (CLI_ORDER.map((id) => locateCli(id)?.path ?? null).join('\n') !== before) send('ai:prefs:changed')
    // 找到了：后台读版本、自查、拉模型、看新版本（task-m55m7）
    if (watching()) void refreshAll()
  })
}

/** 「装在别处？指定位置…」：系统选文件框选命令行（或带着它的 App，比如 Codex.app），记进设置、排第一个找 */
async function pickCli(id: EngineId): Promise<EngineInfo | null> {
  if (!isCli(id)) throw new Error('没有这个引擎')
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

/**
 * 这台 Mac 上这家能不能用：命令行找到了（假 AI 时照 CN_AI_FAKE_CLI 演的，默认都当装了）；Key 填过；本机模型开着、有模型
 */
const installed = (id: EngineId) => (isCli(id) ? (REAL_FIND() ? !!findCli(id) : !!fakeFound(id).path) : sourceReady(id))
const CLI_ORDER = IDS.filter(isCli)
const LOCAL_ORDER = IDS.filter(isLocal)

function aiPrefsView() {
  const prefs = store.prefs()
  return { prefs, labels: Object.fromEntries(FEATURES.map((f) => [f, featureLabel(f)])) as Record<AiFeature, string>, engines: engineInfo(), uses: usesOf(prefs, installed) }
}

/** 文件改了名、挪了地方（标签上改名、文件夹改名挪走里面的）：这个文件的 AI 对话跟过去 */
export function moveChatPlace(root: string, from: string, to: string) {
  if (!store || !/\.md$/i.test(from)) return
  store.move(root, `file:${from}`, `file:${to}`, (to.split('/').pop() ?? to).replace(/\.md$/i, ''))
}

export function registerAgent(d: AgentDeps) {
  deps = d
  store = new AgentStore(join(app.getPath('userData'), 'ai'))
  initSources(join(app.getPath('userData'), 'ai'))
  setCustomCli(store.cliPaths())
  // 后台盯着各家命令行（版本、自查、模型、新版本）：测试实例默认不盯，CN_ENGINE_WATCH=1 才盯（e2e 用假命令行）
  startEngineWatch({ dir: join(app.getPath('userData'), 'ai'), changed: () => send('ai:prefs:changed'), enabled: REAL_FIND() && (process.env.CN_E2E !== '1' || process.env.CN_ENGINE_WATCH === '1') })
  findInBackground()
  // 浮窗、边读边问头上的引擎胶囊：现在 AI 对话用的那家；换了它只改「AI 对话」那一行（设置 › AI 里同一行），默认、梦游这些不动。
  // again：「重新找一遍」，重新取登录 shell 的 PATH、每家重新跑 --version 再答
  ipcMain.handle('ai:engines', async (_e, again?: unknown) => {
    if (again === true) await findAgain()
    const chat = chatPick()
    return { engines: engineInfo(), current: chat.engine, label: chatLabel(), chat, omni: store.omni(), none: noAi(), intro: store.introSeen() }
  })
  // API Key、本机模型（task-587os）：填 Key（先验，认了才存进钥匙串）、删 Key、再找一遍本机模型、接上一家（设成默认）
  ipcMain.handle('ai:key:set', async (_e, id: unknown, key: unknown) => {
    if (!isApi(id)) throw new Error('没有这一家')
    try {
      const models = await setKey(id, key)
      send('ai:prefs:changed')
      return { ok: true as const, models }
    } catch (e) {
      return { ok: false as const, error: String((e as Error).message ?? e) }
    }
  })
  ipcMain.handle('ai:key:remove', (_e, id: unknown) => {
    if (!isApi(id)) throw new Error('没有这一家')
    removeKey(id)
    send('ai:prefs:changed')
  })
  ipcMain.handle('ai:local', async (_e, again?: unknown) => {
    if (again === true) await probeAll()
    return LOCAL_ORDER.map((id) => ({ id, ...(localFound(id) ?? { on: false, models: [] }) }))
  })
  ipcMain.handle('ai:connect', (_e, pick: unknown) => {
    const p = ownPick(pick)
    if (!installed(p.engine)) throw new Error('这一家还用不了')
    store.connect(p)
    send('ai:prefs:changed')
  })
  // 上手卡的链接：拿 Key 的页面、本机模型的官网（只开这几个固定的地址）
  ipcMain.handle('ai:open-page', (_e, id: unknown) => {
    const url = isApi(id) ? KEY_PAGE[id] : isLocal(id) ? LOCAL_SITE[id] : null
    if (!url) throw new Error('没有这个页面')
    return shell.openExternal(url)
  })
  // 装 Claude Code：官方安装命令的输出一行行发给界面（ai:cc:line），装好重新找一遍；登录打开浏览器等它登好
  ipcMain.handle('ai:cc:install', async () => {
    try {
      await installClaudeCode((line) => send('ai:cc:line', line))
    } catch (e) {
      return { ok: false as const, error: String((e as Error).message ?? e) }
    }
    if (process.env.CN_E2E === '1') process.env.CN_AI_FAKE_CLI = (process.env.CN_AI_FAKE_CLI ?? '').replace(/claude=missing,?/, '')
    await findAgain()
    send('ai:prefs:changed')
    return { ok: true as const }
  })
  ipcMain.handle('ai:cc:login', async () => {
    try {
      return { ok: await loginClaudeCode() }
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e) }
    }
  })
  // 第一次开 AI、第一次梦游前那一句说明（全能模式、梦游能做什么、在哪关）：看过一次就不再出
  ipcMain.handle('ai:intro:seen', (_e, what: unknown) => {
    if (what !== 'ai' && what !== 'dream') throw new Error('AI 参数不对')
    store.setIntroSeen(what)
    send('ai:prefs:changed')
  })
  // 全能模式开关（AI 输入框下面那一行，AI 对话和读 PDF 共用）：记在软件设置目录，开着的 AI 面板都跟着换
  ipcMain.handle('ai:omni:set', (_e, on: unknown) => {
    if (typeof on !== 'boolean') throw new Error('AI 参数不对')
    store.setOmni(on)
    send('ai:prefs:changed')
  })
  // 给AI的长期说明（设置 › AI）：AI 对话和读 PDF 每一问都带上（runAgentTurn）
  ipcMain.handle('ai:prompt', () => store.prompt())
  ipcMain.handle('ai:prompt:set', (_e, text: unknown) => {
    if (typeof text !== 'string') throw new Error('AI 参数不对')
    store.setPrompt(text)
  })
  ipcMain.handle('ai:cli:pick', (_e, id: EngineId) => pickCli(id))
  // 设置 › AI「各家命令行」那一行：检查更新（重读版本、重拉模型、看新版本）、更新（跑它官方的更新，跑完再自查）
  ipcMain.handle('ai:cli:check', async (_e, id: unknown) => {
    if (!isCli(id)) throw new Error('没有这个引擎')
    await checkNow(id)
    return engineInfo().find((e) => e.id === id)!
  })
  ipcMain.handle('ai:cli:update', async (_e, id: unknown) => {
    if (!isCli(id)) throw new Error('没有这个引擎')
    await updateNow(id)
    return engineInfo().find((e) => e.id === id)!
  })
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
  ipcMain.handle('ai:chat:save', (_e, place: unknown, label: unknown, msgs: StoredMsg[], sides?: unknown) => {
    const v = deps.vault()
    const p = placeOf({ key: place, label })!
    if (!v || !Array.isArray(msgs) || (sides !== undefined && !Array.isArray(sides))) return
    store.saveMsgs(v.root, p.key, p.label, msgs, sides === undefined ? undefined : checkSides(sides))
  })
  // 这段对话里开的旁支（task-4edsc）
  ipcMain.handle('ai:chat:sides', (_e, place: unknown) => {
    const v = deps.vault()
    const p = placeOf({ key: place, label: '' })!
    return v ? store.sides(v.root, p.key) : []
  })
  ipcMain.handle('ai:side', (_e, req: SideTurnRequest) => runSideTurn(req))
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
