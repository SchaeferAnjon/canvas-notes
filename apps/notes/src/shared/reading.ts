/** 读 PDF 边读边问：界面和主进程之间来回传的东西 */
import type { AskSection, DoubtItem, PdfBlock, Rect } from '@cn/format'
import { type FigureBox, parseFigureMark, stripFigureMark } from '@cn/format'
import type { AiCommitFailed, CommitInfo } from './api'
import type { EngineId, ToolStep } from './agent'
import type { AiPick } from './ai-features'
import type { Material } from './materials'

/** 库里的一份 PDF（⌘K 里列出来、能打开） */
export interface PdfFile {
  path: string
  mtimeMs: number
  size: number
}

/** 一处问的地方：框的一块、整页，或者选中的一段字。同一处接着问都算这一处（笔记里的一段、一轮） */
export interface ReadingThread {
  /** 这一处的身份（.canvas-notes/对话/<PDF 名>-p5-1.md，笔记那一段第二行行尾写的是 <PDF 名>-p5-1） */
  id: string
  page: number
  /** 框的位置（这一页上的比例）；整页问的没有 */
  rect?: Rect
  /** 选中的字（选字问的时候） */
  quote?: string
  /** 框的那块截图在库里的路径 */
  crop?: string
  /** 那块在 PDF 上 100% 时的宽（CSS 像素）：笔记里的图按这个宽显示，截图是它的 2 倍（CN-111） */
  cropW?: number
  /**
   * 在网页上框着问的（右栏网页）或库里的 HTML：网址（HTML 是库里的路径）、标题、框里的字。
   * 有它时笔记那段的来源写域名、点了回网页
   */
  web?: { url: string; title: string; text?: string; /** 视频问答块「接着问」：那一问在视频第几秒 */ t?: number; /** 「接着问」：那一问 AI 当时的回答 */ answer?: string }
  createdAt: number
}

export interface ReadingMsg {
  id: number
  role: 'user' | 'ai'
  thread: string
  text: string
  time: number
  /** 用户消息带的截图（库里的路径） */
  image?: string
  /** 用户在输入框里粘贴的图（软件设置目录 pasted/ 里的名字） */
  pasted?: string[]
  /** 用户这句引用的材料（多段引用方向 B）：text 里的 ①② 是它们的位置（笔记里写成 md 脚注 [^1]） */
  mats?: Material[]
  /** AI 在回答里给的配图框（整页上的比例，CN-60） */
  fig?: FigureBox
  page?: number
  /** AI 回答上面那一行「读了第 5 页」 */
  read?: string
  error?: string
  engine?: EngineId
  /** 哪家哪个模型答的（「Claude Code · Opus 5.5」，CN-54） */
  by?: string
  /** 这一轮记进笔记了没有 */
  note?: 'writing' | 'done' | 'error'
  /** 记到了别处（网页上问的：「《文档名》」「收件箱」） */
  noteTo?: string
  noteError?: string
  /** AI 觉得这一处适合做个可视化（回答最后那行标记，界面上不显示） */
  vizOk?: boolean
  /** 做个可视化：在做、做好了（库里的 HTML）、没做成 */
  viz?: { state: 'making' } | { state: 'done'; path: string; title: string } | { state: 'error'; error: string }
  /** AI 这一问动手的每一步（我们的工具、全能模式下它自己跑命令、写文件……），和 AI 对话的步骤行一样 */
  steps?: ToolStep[]
  /** 这一问 AI 改了库里的文件：那次提交（「改了 N 个文件 · 撤回」）；reverted：撤回了 */
  change?: { commit: CommitInfo; kinds: Record<string, string>; reverted?: CommitInfo; moved?: Record<string, string> }
  /** 改好了、提交没成功 */
  warn?: string
  /**
   * / 命令自己说的「这次没做」（右栏没开着视频、还在读全文、AI 给的不对没写进去……）：照原话写，
   * 不当成 AI 没答出来、不给「再问一次」（task-s2mhv）。AI 那边真出错（没登录、断网）还是 error
   */
  cant?: string
  /** / 命令写进去的那一篇（新建的、这份 PDF 的笔记）：回答下面「打开」开到中间（task-69r0v）。笔记标签只列问答，看不到命令加的那一节 */
  open?: { path: string }
  /** / 命令「先给你看」摆在中间的那一份（这次打开软件时有）：回答下面「收下」「不要」「看改动」 */
  proposal?: string
}

/**
 * 一条旁支（CN-90 方向 A「照 Dispatch 旁支」）：在主对话某一问的回答里选中一句开的支线。
 * 问答和主对话分开存（不往主对话里加东西），和对话记录一起存在软件设置目录，重开软件还在；笔记里挂在被问那一问的回答后面
 */
export interface ReadingSide {
  /** 旁支编号（字母数字和 -，主进程按它记旁支自己的会话号） */
  id: string
  /** 属于哪一处（ReadingThread.id） */
  thread: string
  /** 在哪条回答里选的（主对话那条 AI 回答的 id） */
  msg: number
  /** 选中的那一句 */
  quote: string
  /** 改过的名字（没改过按问的话或那一句起） */
  name?: string
  /** 旁支里的问答（和主对话的消息一样） */
  msgs: ReadingMsg[]
  createdAt: number
}

/** 一份 PDF 在本机记着的：上次看到哪页、对话（存在软件设置目录，不进库；会话号主进程自己另记） */
export interface ReadingState {
  pdf: string
  page: number
  msgs: ReadingMsg[]
  threads: ReadingThread[]
  /** 旁支（CN-90） */
  sides?: ReadingSide[]
  /** 点过「新对话」的时间：AI 从这之后重新开会话 */
  newChatAt?: number
  /** 这份 PDF 的对话自己选的模型、effort（输入框底行，CN-91 方向 C：只管这个对话）；没选过没有，用设置 › AI「AI 对话」那一行 */
  pick?: AiPick
}

export interface AskRequest {
  id: number
  pdf: string
  /** PDF 的内容指纹（拿缓存的全文） */
  hash: string
  engine: EngineId
  thread: ReadingThread
  /** 用户这一句 */
  text: string
  /** 这一轮带的图（库里的路径），框的那块 */
  images: string[]
  /** 输入框里粘贴的图（软件设置目录 pasted/ 里的名字） */
  pasted?: string[]
  /** 这一页的文字（pdf-blocks 拼好的） */
  pageText: string
  pages: number
  /** 这一问用的模型（CN-91，输入框底行选的，只管这个对话）：EngineInfo.models 里的 id，空串是这家的默认模型；不给用「AI 对话」那一行的 */
  model?: string
  /** 这一问的 effort（EngineInfo.efforts 里的 id）；不给用「AI 对话」那一行的，没设过是 High */
  effort?: string
  /**
   * 旁支（CN-90）：在 AI 的回答里选一句开的支线。id 是这条旁支的编号（界面起，字母数字和 - _，最多 80 个；同一条旁支接着问用同一个）。
   * 第一问从这份 PDF 主对话的会话整段分叉（Claude Code --fork-session、Codex thread/fork），之后接着旁支自己的会话，主对话的会话不动；
   * history 是被问那一轮的问答原文：分叉不了（Gemini、OpenCode，或主对话还没有会话）时放在第一问前面。旁支不再附整份 PDF 的字。
   * 问的时候告诉 AI 被问的那句（quote）和它所在的那一轮（ask：那一轮问的原话，title：那一轮的标题）；
   * fresh：那一轮在「新对话」之前（主对话现在的会话里没有它），不分叉，开新会话、history 放在前面
   */
  side?: { id: string; history: string; quote?: string; ask?: string; title?: string; fresh?: boolean }
  /**
   * 引用的材料（多段引用方向 B）：text 里的 ①② 是它们的位置，主进程交给引擎时照旧是 ①②、后面按同一套编号列出每块（图叫「图②」）；
   * 里面的图同时在 pasted 里（按顺序，排在框的那块后面）。后面记笔记写成 md 脚注 [^1] 用的也是它
   */
  mats?: Material[]
}

export interface AskResult {
  text: string
  error?: string
  /** 这一问 AI 动手改了库里的文件（2026-11-19：读 PDF 也能新建、改名、挪、删笔记，全能模式下还能自己写文件）：一次提交 */
  commit?: CommitInfo | null
  kinds?: Record<string, string>
  failed?: AiCommitFailed
  /** 改名、挪动了的：新路径 → 旧路径 */
  moved?: Record<string, string>
}

/** 边答边给：字，和动手的每一步（同 AI 对话的 AiEvent） */
export type AskEvent = { type: 'text'; delta: string } | { type: 'tool'; id: string; label: string; code?: string; status: 'run' | 'ok' | 'err'; detail?: string }

/**
 * 后台的两件小活（CN-93、94、96）：给快的模型看这一轮（主对话 + 旁支）的问答，要这一轮的标题和一句小结。
 * 问题、回答都原样写进笔记，不让 AI 改写；每答完一次（主对话或旁支）重写小结
 */
export interface SummarizeRequest {
  pdf: string
  engine: EngineId
  thread: ReadingThread
  msgs: ReadingMsg[]
  sides?: ReadingSide[]
  /** 这一页的块（给标题和小结看这一页讲什么） */
  blocks: PdfBlock[]
  /** 已经有的标题：内容没变就照抄 */
  title?: string
}

export interface SummarizeResult {
  title: string
  recap: string
}

/**
 * 写笔记里的一段：主进程按这一处的问答（主对话 + 旁支）收成一段（问题原话、回答原文），写进笔记、提交。
 * title、recap 不给时用笔记里原来那段的（答完马上先写一次，标题和小结晚一点再补；那一次 commit: false，不提交）
 */
export interface WriteSectionRequest {
  pdf: string
  title?: string
  recap?: string
  /** AI 回答里给的配图框截好的 PNG 和说明 */
  figurePng?: Uint8Array
  figureCaption?: string
  thread: ReadingThread
  msgs: ReadingMsg[]
  sides?: ReadingSide[]
  /** false：只写不提交（答完马上先写的那一次，等标题和小结写好再一起提交） */
  commit?: boolean
  /** PDF 一共几页（笔记属性里的进度「问到 5/10」） */
  pages: number
  /** 网页上问的（来源是 web:<网址>）记到哪：中间栏开着的文档（插到光标处）或收件箱 */
  target?: { kind: 'doc'; path: string } | { kind: 'inbox' }
}

export interface WriteSectionResult {
  note: string
  commit: CommitInfo | null
  /** 记到文档里的：这一段的 md（界面插到光标处）和要一起提交的文件 */
  markdown?: string
  files?: string[]
}

/** 我的疑惑页：一个文件夹（一门课）的清单 */
export interface DoubtsView {
  folder: string
  course: string
  items: (DoubtItem & { sent: boolean })[]
  /** 看视频时框一块问的（文档里的问答块），这门课里的 */
  videos: VideoDoubt[]
}

/** 看视频时框一块问的一处（文档里的问答块，main/reading/doubts.ts 的 collectVideoDoubts） */
export interface VideoDoubt {
  /** 记在哪篇文档、第几行（问答块开头那行注释） */
  doc: string
  line: number
  /** 视频里的时间「00:06」、视频名、带时间的网址 */
  time: string
  title: string
  url: string
  /** 问题原话、回答开头一段 */
  question: string
  answer: string
}

export interface AnkiSendResult {
  added: string[]
  /** 牌组里已经有一样的问题，没有重复加（也算送过） */
  duplicates: string[]
  failed: Record<string, string>
  deck?: string
  /** Anki 没开、没装 AnkiConnect 这类：一句话说怎么办 */
  error?: string
  commit: CommitInfo | null
}

export interface VizRequest {
  pdf: string
  engine: EngineId
  thread: ReadingThread
  msgs: ReadingMsg[]
  pageText: string
}

export interface VizResult {
  path: string
  title: string
  commit: CommitInfo | null
}

export interface CnReadingApi {
  listPdfs(): Promise<PdfFile[]>
  /** PDF 的字节；hash 是内容指纹（文字缓存按它存） */
  pdfData(path: string): Promise<{ data: Uint8Array; hash: string }>
  state(pdf: string): Promise<ReadingState>
  saveState(state: ReadingState): Promise<void>
  /** 框的那块存进 附件/<PDF 名>/，返回库里的路径 */
  saveCrop(pdf: string, page: number, png: Uint8Array): Promise<string>
  /** 新的一处问的地方：给它一个完整对话的路径 */
  newThread(pdf: string, page: number): Promise<string>
  /** 整份 PDF 的段落块（读全文用）和每页的宽高（搜索命中时算那一段在页上的比例），按内容指纹缓存 */
  setText(hash: string, pdf: string, pages: PdfBlock[][], sizes: [number, number][]): Promise<void>
  /** 缓存过的全文（没有是 null） */
  getText(hash: string): Promise<PdfBlock[][] | null>
  ask(req: AskRequest): Promise<AskResult>
  stop(id: number): Promise<void>
  onAsk(cb: (id: number, e: AskEvent) => void): () => void
  summarize(req: SummarizeRequest): Promise<SummarizeResult>
  writeSection(req: WriteSectionRequest): Promise<WriteSectionResult>
  /** 新对话：忘掉这份 PDF 的 AI 会话（下一句重新读全文） */
  forget(pdf: string): Promise<void>
  doubts(folder: string): Promise<DoubtsView>
  ankiSend(folder: string, ids: string[]): Promise<AnkiSendResult>
  viz(req: VizRequest): Promise<VizResult>
  /** 点了 canvas-notes://open?file=…&page=… （Anki 卡上的「打开原文」）：打开 PDF 翻到那页 */
  onOpenAt(cb: (a: { file: string; page: number; rect?: Rect }) => void): () => void
  /** 库里 HTML 的标题和 <meta> 属性（类型、课程、第几讲） */
  htmlMeta(path: string): Promise<{ title?: string; props: Record<string, string>; text: string }>
  /** 在访达里显示这份 PDF */
  reveal(pdf: string): Promise<void>
  /** 读这份 PDF 的笔记（没有就是空串） */
  readNote(pdf: string): Promise<{ path: string; text: string }>
  /** 存成双语笔记（PDF 或网页阅读视图），一次提交；返回笔记在库里的路径 */
  saveBilingual(req: BilingualSaveRequest): Promise<{ path: string }>
  /** 截屏幕上的一块（CSS 像素）：wcId 是右栏网页的，null 是窗口自己（中间栏 HTML） */
  capture(wcId: number | null, rect: { x: number; y: number; w: number; h: number }): Promise<Uint8Array>
  /** 提交几个文件（网页上问的那段插进文档、文档存好以后） */
  commit(paths: string[], message: string): Promise<CommitInfo | null>
}

/** 网页阅读视图存成双语笔记：每块字带译文，公式和图是网页上的图的网址 */
export interface BilingualSaveRequest {
  web: { url: string; title: string }
  langs?: string
  pages: {
    blocks: ({ kind: 'heading' | 'text'; text: string; tr: string | null } | { kind: 'formula' | 'figure'; url: string })[]
  }[]
}

/** 回答上面那一行：读了哪页；回答里提到的别的页正好是笔记里弄懂过的，就说用到了 */
export function readLine(page: number, answer: string, sections: AskSection[]): string {
  const used = [...new Set([...answer.matchAll(/\]\(#page=(\d+)\)/g)].map((m) => Number(m[1])))].filter((n) => n !== page && sections.some((s) => s.page === n))
  return `读了第${page}页${used.length ? ` · 用到第${used.join('、')}页你弄懂的那条` : ''}`
}

/** AI 回答最后这一行：这一处适合做个可视化（界面上不显示这行，换成「做个可视化」按钮） */
export const VIZ_MARK = '〔可以做个可视化〕'

/**
 * 发给 AI 的公式写法（读 PDF、AI 对话、/ 命令都带）：回答里的公式用 KaTeX 排，行内 $…$ 的 $ 内侧有空格就不认、原样露着
 * （真 AI 写过 `$dV/dt = $ 输入`）。渲染那边不放宽（「$5 和 $6」这种钱数会被当成公式），在提示词里说清楚
 */
export const MATH_RULE = '公式用 LaTeX：行内写 $…$，$ 里面紧贴公式、开头结尾都不留空格（写 $dV/dt$，不写 $ dV/dt $ 或 $dV/dt = $），一整条公式放在同一对 $ 里；单独一行的写 $$…$$。'

/** 回答里去掉可视化标记（边生成边显示时半截的也去掉） */
export function withoutVizMark(text: string): { text: string; viz: boolean; figure: FigureBox | null } {
  const viz = text.includes(VIZ_MARK)
  // 配图的框那一行（CN-60）也不显示
  const figure = parseFigureMark(text)
  const t = stripFigureMark(text)
  return { text: t.replace(/\n*〔可以做个可视化〕\s*$/, '').replace(VIZ_MARK, '').replace(/\n*〔[^〕\n]{0,8}$/, '').trimEnd(), viz, figure }
}

/** 问到第几页：问过的最大页码 */
export const askedUpTo = (threads: ReadingThread[]) => threads.reduce((n, t) => Math.max(n, t.page), 0)
