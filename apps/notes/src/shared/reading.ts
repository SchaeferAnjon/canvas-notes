/** 读 PDF 边读边问：界面和主进程之间来回传的东西 */
import type { AskSection, DoubtItem, PdfBlock, Rect } from '@cn/format'
import type { CommitInfo } from './api'
import type { EngineId } from './agent'

/** 库里的一份 PDF（⌘K 里列出来、能打开） */
export interface PdfFile {
  path: string
  mtimeMs: number
  size: number
}

/** 一处问的地方：框的一块、整页，或者选中的一段字。同一处接着问都算这一处 */
export interface ReadingThread {
  /** 完整对话文件在库里的路径（.canvas-notes/对话/<PDF 名>-p5-1.md），也是笔记里那一段的身份 */
  id: string
  page: number
  /** 框的位置（这一页上的比例）；整页问的没有 */
  rect?: Rect
  /** 选中的字（选字问的时候） */
  quote?: string
  /** 框的那块截图在库里的路径 */
  crop?: string
  /**
   * 在网页上框着问的（右栏网页）或库里的 HTML：网址（HTML 是库里的路径）、标题、框里的字。
   * 有它时笔记那段的来源写域名、点了回网页
   */
  web?: { url: string; title: string; text?: string }
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
  page?: number
  /** AI 回答上面那一行「读了第 5 页」 */
  read?: string
  error?: string
  engine?: EngineId
  /** 这一轮记进笔记了没有 */
  note?: 'writing' | 'done' | 'error'
  /** 记到了别处（网页上问的：「《文档名》」「收件箱」） */
  noteTo?: string
  noteError?: string
  /** AI 觉得这一处适合做个可视化（回答最后那行标记，界面上不显示） */
  vizOk?: boolean
  /** 做个可视化：在做、做好了（库里的 HTML）、没做成 */
  viz?: { state: 'making' } | { state: 'done'; path: string; title: string } | { state: 'error'; error: string }
}

/** 一份 PDF 在本机记着的：上次看到哪页、对话（存在软件设置目录，不进库；会话号主进程自己另记） */
export interface ReadingState {
  pdf: string
  page: number
  msgs: ReadingMsg[]
  threads: ReadingThread[]
  /** 点过「新对话」的时间：AI 从这之后重新开会话 */
  newChatAt?: number
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
  /** 这一页的文字（pdf-blocks 拼好的） */
  pageText: string
  pages: number
}

export interface AskResult {
  text: string
  error?: string
}

export type AskEvent = { type: 'text'; delta: string }

/** 后台写笔记那一段：界面给对话，主进程问 AI 收成一段 */
export interface SummarizeRequest {
  pdf: string
  engine: EngineId
  thread: ReadingThread
  msgs: ReadingMsg[]
  /** 这一页的块（AI 从里面挑一张重要的图） */
  blocks: PdfBlock[]
}

/** AI 收好的一段（还没截 AI 挑的图） */
export interface SummarizeResult {
  section: AskSection
  /** AI 挑的图：哪一块；界面截下来再交回来写 */
  figure?: { block: string; caption: string }
}

export interface WriteSectionRequest {
  pdf: string
  section: AskSection
  /** AI 挑的那张图截好的 PNG */
  figurePng?: Uint8Array
  thread: ReadingThread
  msgs: ReadingMsg[]
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

/** 存成双语笔记：每页的块（字带译文，公式和图带裁好的 PNG；网页的图是网址） */
export interface BilingualSaveRequest {
  pdf?: string
  web?: { url: string; title: string }
  langs?: string
  pages: {
    page?: number
    blocks: ({ kind: 'heading' | 'text'; text: string; tr: string | null } | { kind: 'formula' | 'figure'; png: Uint8Array } | { kind: 'formula' | 'figure'; url: string })[]
  }[]
}

/** 回答上面那一行：读了哪页；回答里提到的别的页正好是笔记里弄懂过的，就说用到了 */
export function readLine(page: number, answer: string, sections: AskSection[]): string {
  const used = [...new Set([...answer.matchAll(/\]\(#page=(\d+)\)/g)].map((m) => Number(m[1])))].filter((n) => n !== page && sections.some((s) => s.page === n))
  return `读了第 ${page} 页${used.length ? ` · 用到第 ${used.join('、')} 页你弄懂的那条` : ''}`
}

/** AI 回答最后这一行：这一处适合做个可视化（界面上不显示这行，换成「做个可视化」按钮） */
export const VIZ_MARK = '〔可以做个可视化〕'

/** 回答里去掉可视化标记（边生成边显示时半截的也去掉） */
export function withoutVizMark(text: string): { text: string; viz: boolean } {
  const viz = text.includes(VIZ_MARK)
  return { text: text.replace(/\n*〔可以做个可视化〕\s*$/, '').replace(VIZ_MARK, '').replace(/\n*〔[^〕\n]{0,8}$/, ''), viz }
}

/** 问到第几页：问过的最大页码 */
export const askedUpTo = (threads: ReadingThread[]) => threads.reduce((n, t) => Math.max(n, t.page), 0)
