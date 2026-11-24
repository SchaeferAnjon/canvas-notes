/**
 * 费曼学习的接口：界面（白板上讲的那一列、讲完以后、课程首页）调这些，主进程 main/feynman.ts 实现，preload 暴露成 window.cnFeynman。
 * 写进文档由界面做（文档在编辑器里开着）：用 doc.ts 的 addRound / appendEntry / putBlock / setMeta 改全文，这里只给内容。
 * CN_AI_FAKE=1 时不调模型，照 fake.ts 给固定回答（流程测试用）。
 */
import type { CoreJudged, CoverRef, Entry, FeynmanMeta, LongStep, MaterialRef, Myth, Point, PointEdit, Scope, StudentAct, Verdict } from './types'

/** 拆点时列给你挑的一项（PDF 一讲的知识点单子、导图一支的子枝、按意思分成的几组卡） */
export interface Candidate {
  name: string
  /** 估的核心几条（PDF 单子上写；导图子枝不估） */
  cores?: number
  /** 分级：这个知识点是核心还是了解即可（PDF 单子上写，串讲这一章只取核心的） */
  level?: 'core' | 'extra'
  /** 这一项的材料（PDF 那几页、那一个子枝、那几张卡） */
  refs: MaterialRef[]
  scope: Scope
  /** 上次讲的结果（这个点以前讲过的话） */
  last?: Verdict | null
  /** AI 拆点时已经抽好的这一个点（挑了直接用，不再问一次） */
  draft?: Draft
  /** 同一张单子上的几个点的名字（课程首页数「没讲过」） */
  siblings?: string[]
}

/** 抽要点的请求 */
export interface ExtractReq {
  refs: MaterialRef[]
  /** 默认 point（一个知识点） */
  scope?: Scope
  /** 正在看的那块白板（找剪自同一页、讲同一件事的卡，配对的网页） */
  board?: string
  /** 从拆点单子里挑的一项：只抽这一项 */
  pick?: Candidate
  /** 同一个点上次你的改动（下次照你的来） */
  edits?: PointEdit[]
  /** 不拆：核心超过 5 条也照样给（你在单子上点了「就讲这一整个」） */
  noSplit?: boolean
}

/** 抽好的「这次要讲到」：界面列给你改，「开始讲」时用 newMeta 变成一轮 */
export interface Draft {
  topic: string
  scope: Scope
  points: Point[]
  myths: Myth[]
  from: MaterialRef[]
  cover: CoverRef[]
  /** 材料一张也没找到，要点是 AI 按常识定的（列头写「没有材料，AI 自己定的要点」） */
  noMaterial?: boolean
  /** 同一讲的知识点单子（课程首页数「没讲过」） */
  siblings?: string[]
  lecture?: number
  /** 「照导图「范数」这一支和配对的网页核对」：列头第二行 */
  basisLine: string
  /** 「Claude Code · Opus 5.5」 */
  by: string
}

export type ExtractResult =
  | { kind: 'draft'; draft: Draft }
  /** 先挑一个：why 是 pdf（一整份 PDF 先给单子）、many-cores（核心超过 5 条，分成几个点）、branch（导图这一支超过 5 条，子枝各一个点） */
  | { kind: 'pick'; why: 'pdf' | 'many-cores' | 'branch'; title: string; items: Candidate[]; chain?: Candidate; by: string }

/** 学生说一轮的请求：entries 是这一节到现在的全部（最后一段是你刚说的），image 是你拍的手画的图（交给「看图问」那家） */
export interface TurnReq {
  reqId: number
  meta: FeynmanMeta
  entries: Pick<Entry, 'kind' | 'text'>[]
  image?: { mime: string; base64: string }
  /** 再讲这几处：只问这几条核心 */
  only?: string[]
  /**
   * 聊到底里你点的：reveal「说穿吧」、skip「先跳过」、deep「接着往深里聊」（这三样没有新的一段你说的）；
   * more「接着聊下去」（三轮用完转成聊到底，接着问）
   */
  cmd?: 'reveal' | 'skip' | 'deep' | 'more'
}

export interface TurnResult {
  act: StudentAct
  /** 学生这一句（先引原话）；done 时可以是空串 */
  say: string
  /** 说穿的那一句（一句正确说法加出处）：有的话先写一块「说穿」，再写 say */
  reveal?: string
  /** 盯着哪条核心 */
  point?: string
  /** 引的你的原话（界面把那一句标出来） */
  quote?: string
  /** 聊到底：这一问是哪一步（学生块右边的小字）；act 是 offer 时是问你收尾还是接着往深里聊 */
  step?: LongStep
  /** 聊到底：说穿那一块是收尾前软件说穿的、说反了躲不掉的 */
  revealFlip?: boolean
  /** 改好的注释（asked、touched 记上了）：界面 setMeta 写回 */
  meta: FeynmanMeta
  by: string
}

/** 判定的请求 */
export interface JudgeReq {
  reqId: number
  meta: FeynmanMeta
  entries: Pick<Entry, 'kind' | 'text'>[]
  /** 今天（YYYY-MM-DD，界面给，按这台 Mac 的日子） */
  today: string
  /** 这个点以前过了几次（同一个点前几轮数出来，progress.ts 的 passesBefore） */
  prevPasses: number
  /** 再讲这几处：只判这几条，判完走「过 · 当场补讲」 */
  only?: string[]
}

export interface JudgeResult {
  /** 判好的注释（状态、判定、日子、缺口）：界面 setMeta 写回 */
  meta: FeynmanMeta
  /** 这一轮 AI 判的状态（only 时只有那几条） */
  states: CoreJudged[]
  /** 写进文档的几块正文（putBlock 用；空串是这一块删掉 / 不写，undefined 是不动：当场补讲只改判定和缺口） */
  blocks: { verdict: string; gaps: string; wording?: string; full?: string }
  wording: string[]
  full: string
  by: string
}

/** 课程首页「费曼」那一块（progress.ts 的 courseSummary） */
export interface CourseSummary {
  /** 核心知识点几个（讲过的点 + 单子上没讲过的） */
  total: number
  pass: number
  almost: number
  fail: number
  never: number
  /** 每讲一颗「第1讲 3/5」：过了几个 / 一共几个；没标第几讲的 lecture 是 null */
  lectures: { lecture: number | null; pass: number; total: number }[]
  /** 下次先讲：没过的（隔一天）→ 差一点的（隔三天）→ 学过还没讲的 → 到期重讲的；考前两周按章串讲 */
  next: NextUp | null
  /** 该串讲一次的那一讲（这一讲的点都讲过了、还没串讲过） */
  chain: number | null
  topics: TopicState[]
}

export interface NextUp {
  topic: string
  why: 'fail' | 'almost' | 'new' | 'due' | 'exam'
  /** 那一轮在哪篇（没讲过的是单子所在的那篇） */
  path: string
  lecture?: number
  /** 那一轮的编号（没讲过的没有） */
  id?: string
}

/** 一个知识点最近一次的样子 */
export interface TopicState {
  topic: string
  path: string
  id?: string
  lecture?: number
  scope: Scope
  verdict: Verdict | null
  redone?: boolean
  /** 最近一次讲的日子、下次再讲的日子 */
  day?: string
  next?: string
  /** 讲过几次 */
  rounds: number
}

/** preload 暴露成 window.cnFeynman */
export interface CnFeynmanApi {
  /** 抽要点：一个点给「这次要讲到」；一整份 PDF、核心超过 5 条、导图一支超过 5 条先给单子挑 */
  extract(reqId: number, req: ExtractReq): Promise<ExtractResult>
  /** 拆点：只要单子（PDF 一讲的知识点、导图子枝、分好的几组卡），不抽要点 */
  split(reqId: number, req: ExtractReq): Promise<ExtractResult>
  /** 学生听完你说的这一段，说一句 */
  turn(req: TurnReq): Promise<TurnResult>
  /** 讲完了：判每条核心，算判定、日子、缺口、完整版 */
  judge(req: JudgeReq): Promise<JudgeResult>
  /** 停下这一问（esc） */
  stop(reqId: number): Promise<void>
  /** AI 边写边给的字（学生的话、完整版一点点长出来） */
  onText(cb: (reqId: number, delta: string) => void): () => void
  /** 这一轮问 AI 用的哪家：「Claude Code · Opus 5.5」和标志 */
  engine(): Promise<{ id: string; label: string } | null>
  /** 课程首页「费曼」那一块：读 folder 下所有笔记里的费曼注释（exam 是考试那天） */
  course(folder: string, today: string, exam?: string): Promise<CourseSummary>
}
