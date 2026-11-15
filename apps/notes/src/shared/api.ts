/** 主进程和界面之间的接口，preload 按这个暴露成 window.cn */

import type { AiEvent, BridgeOp, EngineId, EngineInfo, StoredMsg, TurnRequest, TurnResult } from './agent'
import type { Appearance, AppSettings } from './appearance'
import type { HomeConfig } from './home'
import type { NoteKind } from './layout'

export interface VaultInfo {
  path: string
  name: string
}

export interface NoteFile {
  /** 相对库根目录，用 / 分隔 */
  path: string
  mtimeMs: number
  /** 创建时间（frontmatter 里的 created，没有就用文件的） */
  createdMs: number
  kind: NoteKind
  /** 素材的主题（素材/<主题>/） */
  topic?: string
  /** 收件箱和素材才有：前几行 */
  preview?: string
  /** frontmatter 里的 source（剪藏来源） */
  source?: string
  /** frontmatter 里 draft: true（AI 写的草稿） */
  draft?: boolean
  /** frontmatter 里 type: board 的是白板 */
  board?: { color: string; cards: number; icon?: string; thumb: ThumbRect[] }
}

export interface OpenedNote {
  path: string
  text: string
  readOnly: boolean
}

export type WriteResult =
  | { ok: true }
  /** 磁盘上的已经不是 base 了：先合并再写 */
  | { ok: false; diskText: string }

export interface GitState {
  isRepo: boolean
  branch: string | null
  /** 没提交的文件 */
  changes: { path: string; code: string }[]
  /** 本周（周一起）的提交数 */
  weekCommits: number
  hasRemote: boolean
  /** 上次同步成功的时间（毫秒） */
  lastSync: number | null
  /** 自动提交的间隔（分钟） */
  autoCommitMinutes: number
}

export interface CommitInfo {
  hash: string
  date: string
  subject: string
  files: { path: string; added: number; removed: number }[]
}

export type SyncOutcome =
  | { kind: 'no-remote' }
  | { kind: 'conflict'; message: string }
  | { kind: 'ok'; committed: string | null; pulled: number; pushed: boolean }

export interface CnApi {
  vault(): Promise<VaultInfo | null>
  chooseVault(): Promise<VaultInfo | null>
  listNotes(): Promise<NoteFile[]>
  readNote(path: string): Promise<OpenedNote>
  /** 只在磁盘上还是 base 时写；否则把磁盘上的文字还回来 */
  writeNote(path: string, text: string, base: string): Promise<WriteResult>
  /** 把冲突的那一版另存一份，返回新文件的相对路径 */
  saveConflictCopy(path: string, text: string): Promise<string>
  /** 在 folder（'' 是库根目录）里新建一篇，名字重了自动加序号；返回相对路径 */
  createNote(folder: string, name: string, text: string): Promise<string>
  /** 改名（同一个文件夹里），别的笔记里的 [[旧名]] 一起改；返回新路径 */
  renameNote(path: string, newName: string): Promise<string>
  /** 新建白板，返回相对路径 */
  createBoard(folder: string, name: string): Promise<string>
  /** 移到废纸篓（Git 里也算删除，能从历史找回） */
  trashNote(path: string): Promise<void>
  /** 速记：一句话进收件箱，返回新文件路径 */
  capture(text: string): Promise<string>
  /** 网页里剪的一段进收件箱（带来源），返回新文件路径 */
  clipToInbox(clip: Clip): Promise<string>
  /**
   * 整页剪藏右栏开着的网页（AI 的 /剪藏当前网页、网页面板的剪刀按钮都用它）：正文转成 md 进收件箱新的一篇，
   * frontmatter 带 created 和 source，单独一次提交（可撤回）；返回新文件的库内路径。
   * webUrl 是右栏开着的网址：当前网页不是它时，找开着这个网址的那个标签剪。
   */
  clipCurrentPage(arg?: { webUrl?: string | null }): Promise<string>
  /** Chrome 的用户（导入登录用） */
  chromeProfiles(): Promise<{ id: string; name: string; account?: string }[]>
  /** 把 Chrome 某个用户的登录状态导入内置浏览器 */
  importChrome(profileId: string): Promise<{ imported: number; expired: number; skipped: number }>
  /** 问 AI 一次；id 用来中途停 */
  aiAsk(id: number, system: string, prompt: string): Promise<string>
  aiStop(id: number): Promise<void>
  /** AI 改文件：一次提交（提交说明前面加「AI：」）；没有改动返回 null */
  aiChange(change: AiChange): Promise<CommitInfo | null>
  /** 撤回 AI 的那次提交（反向提交），返回新的提交 */
  aiRevert(hash: string): Promise<CommitInfo | null>
  search(q: string): Promise<SearchHit[]>
  /** 左栏右键菜单（系统原生菜单），返回点了哪一项；置顶 / 取消置顶在主进程里就存好了 */
  noteMenu(path: string): Promise<NoteMenuAction>
  /** 置顶的笔记（库里 .canvas-notes/置顶.json），按置顶的先后 */
  pins(): Promise<string[]>
  /** 记一次积累（剪进文档时用；剪进收件箱主进程自己记） */
  logActivity(kind: 'clip', path: string): Promise<void>
  activity(): Promise<Activity>
  gitState(): Promise<GitState>
  /** 提交所有改动；没有改动时返回 null */
  commit(): Promise<CommitInfo | null>
  sync(): Promise<SyncOutcome>
  history(limit: number): Promise<CommitInfo[]>
  /** 某次提交里某个文件改了什么；exists：这个文件现在还在不在 */
  commitFileDiff(hash: string, path: string): Promise<{ diff: DreamDiffFile | null; exists: boolean }>
  /** 选一张图片拷进库的「附件/」，返回库里的相对路径；取消返回 null */
  pickImage(): Promise<string | null>
  /** 软件设置（外观、自动提交间隔），存在软件设置目录 */
  settings(): Promise<AppSettings>
  setSettings(patch: { appearance?: Partial<Appearance>; autoCommitMinutes?: number; archiveDays?: number; autoUpdate?: boolean }): Promise<AppSettings>
  /** 从电脑选一张窗口背景（深海蓝用），拷进设置目录；取消是 null */
  pickWinBg(): Promise<AppSettings | null>
  /** 首页设置：库里的 .canvas-notes/首页.json */
  homeConfig(): Promise<HomeConfig>
  saveHomeConfig(cfg: HomeConfig): Promise<HomeConfig>
  /** 从电脑选一张封面，拷进库里的 附件/封面/，返回库里的路径；取消是 null */
  pickCover(): Promise<string | null>
  /** 拖到封面上的图：存进库里的 附件/封面/，返回库里的路径 */
  dropCover(bytes: Uint8Array, name: string): Promise<string>
  /** 库的远程仓库（第一个），没有是 null */
  gitRemote(): Promise<{ name: string; url: string } | null>
  /** 设远程地址（只改本机配置，不联网） */
  setGitRemote(url: string): Promise<{ name: string; url: string } | null>
  /** 库里的文件被外部改了（同步、AI、别的软件）。自己刚写的不报。 */
  onNoteChanged(cb: (path: string, text: string) => void): () => void
  /** 文件增删 */
  onFilesChanged(cb: () => void): () => void
  updateStatus(): Promise<UpdateState>
  /** 现在查一次；出错时 ok 为 false，error 是看得懂的话 */
  checkUpdate(): Promise<{ ok: boolean; error?: string; state: UpdateState }>
  /** 下好的新版：退出、装上、重新打开 */
  installUpdate(): Promise<boolean>
  onUpdateState(cb: (s: UpdateState) => void): () => void
  /** 不在「应用程序」文件夹：挪过去并重开；用户取消返回 false */
  moveToApps(): Promise<boolean>
  revealApp(): Promise<void>
  /** 新版本（没有就是这一版）在 GitHub 上的发布页 */
  releaseUrl(): Promise<string>
  /** 菜单栏点了「检查更新…」：界面打开设置里的更新 */
  onUpdateOpen(cb: () => void): () => void
  /** 网页有焦点时按的 ⌘J、⌘K、⌘F、⌘N、⌘,（主线转过来的，key 是小写字母） */
  onAppKey(cb: (key: string) => void): () => void

  // ---------- AI 浮窗（类型见 shared/agent.ts） ----------
  /** 本机找到的 AI 命令行和现在选的那家 */
  aiEngines(): Promise<{ engines: EngineInfo[]; current: EngineId }>
  aiSetEngine(id: EngineId): Promise<void>
  /** 跑一轮对话：AI 能用工具操纵网页、白板、文档；字和工具步骤从 onAiEvent 边做边来 */
  aiTurn(req: TurnRequest): Promise<TurnResult>
  aiTurnStop(id: number): Promise<void>
  /** 对话记录存在软件设置目录（不进库），关了再开还在 */
  aiChatLoad(): Promise<StoredMsg[]>
  aiChatSave(msgs: StoredMsg[]): Promise<void>
  aiChatClear(): Promise<void>
  onAiEvent(cb: (id: number, e: AiEvent) => void): () => void
  /** 主进程请界面做事（编辑器、标签、右栏），做完用 aiReply 回 */
  onAiCall(cb: (id: number, op: BridgeOp, arg: unknown) => void): () => void
  aiReply(id: number, ok: boolean, value: unknown): Promise<void>

  /** 找重复：整个库里讲同一件事的笔记对，像的在前。只给建议，不改文件（AI 的 /找重复 调它，参数是 { webUrl }，用不上） */
  findDuplicates(arg?: { webUrl: string | null }): Promise<DuplicatePair[]>
  /** 梦游：最近一份报告，没梦游过是 null */
  dreamReport(): Promise<DreamReport | null>
  /** 现在梦游（不等闲时），跑完返回新报告；正在跑时等它跑完（AI 的 /现在梦游 调它，参数是 { webUrl }，用不上） */
  dreamNow(arg?: { webUrl: string | null }): Promise<DreamReport>
  /** 收下一条：把那个提交 cherry-pick 到当前分支 */
  dreamTake(id: string): Promise<DreamReport>
  /** 丢掉一条：跳过，不进当前分支 */
  dreamDrop(id: string): Promise<DreamReport>
  /** 剩下的全部收下 */
  dreamTakeAll(): Promise<DreamReport>
  /** 这一条改了什么（那个提交的 diff） */
  dreamDiff(id: string): Promise<DreamDiffFile[]>
  /** 梦游开始、跑完、报告变了 */
  onDream(cb: (report: DreamReport | null, running: boolean) => void): () => void
}

/** 找重复的一对：a、b 是相对路径，score 是 0 到 1 的相似度，why 是一句人话 */
export interface DuplicatePair {
  a: string
  b: string
  score: number
  why: string
}

export type DreamGroup = 'inbox' | 'link' | 'dup' | 'week'

export interface DreamItem {
  id: string
  group: DreamGroup
  /** 一行标题：哪篇 */
  title: string
  /** 第二行：→ 素材/旅行、↔ [[x]]、相似度 72% */
  sub: string
  /** 为什么这么改 */
  why: string
  /** dream 分支上的提交；可能重复的只是提醒，没有提交 */
  commit: string | null
  /** 涉及的文件（相对路径） */
  files: string[]
  state: 'pending' | 'taken' | 'dropped'
  /** 收下后在当前分支上的提交号 */
  taken?: string
}

export interface DreamReport {
  /** 改动所在的分支，如 dream/11-15 */
  branch: string
  /** 从哪个分支、哪次提交分出来的 */
  base: string
  baseCommit: string
  started: number
  finished: number
  /** 闲时自己跑的还是手动 */
  trigger: 'idle' | 'manual'
  items: DreamItem[]
  /** 有一组没做成（比如 AI 不可用）时的说明 */
  notes: string[]
  /** 分支和临时检出都已删掉（都处理完了） */
  closed: boolean
}

/**
 * 检查更新的状态。off：这个包不更新（开发版、本机打的包）；checking；downloading（percent）；
 * ready：新版 version 下好了，重启就装上；latest：已是最新（checkedAt 是上次查的时间）；error：error 是原文。
 * inApps：是不是从「应用程序」文件夹打开的（别处打开的可能装不上）
 */
export interface UpdateState {
  phase: 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'latest' | 'error'
  current: string
  version: string
  percent: number
  error: string
  checkedAt: number
  inApps: boolean
}

export interface DreamDiffFile {
  path: string
  /** 挪动时的旧路径 */
  from?: string
  status: 'new' | 'changed' | 'moved' | 'deleted'
  /** a 加的行、d 删的行、c 上下文、gap 中间省略 */
  lines: { k: 'a' | 'd' | 'c' | 'gap'; t: string }[]
}

export interface Clip {
  text: string
  url: string
  title: string
}

export interface AiChange {
  /** 提交说明，前面会加「AI：」 */
  message: string
  /** path 是相对路径；create 为 true 时新建（名字重了加序号） */
  writes?: { path: string; text: string; create?: boolean }[]
  /** 挪到另一个文件夹 */
  moves?: { from: string; toFolder: string }[]
}

export interface SearchHit {
  path: string
  /** 正文里第一处命中附近的一小段 */
  snippet: string
}

/** 首页「最近积累」要的数 */
export interface Activity {
  /** 每天存了几样（剪藏和提交），键是 YYYY-MM-DD */
  days: Record<string, number>
  clipsThisWeek: number
  clipsLastWeek: number
  /** 本周自己写的笔记改了几次（提交里的作品文件） */
  workEditsThisWeek: number
  /** 上次同步的时间（毫秒），没同步过是 null */
  lastSync: number | null
}

export type NoteMenuAction = 'pin' | 'unpin' | 'rename' | 'trash' | 'reveal' | null

/** 白板缩略图里的一块：坐标是白板上的像素；k 是 n 普通卡、c 素材卡、i 图片、l 列 */
export interface ThumbRect {
  x: number
  y: number
  w: number
  h: number
  k: 'n' | 'c' | 'i' | 'l'
}
