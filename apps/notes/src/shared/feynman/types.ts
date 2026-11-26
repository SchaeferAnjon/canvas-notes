/**
 * 费曼学习（方向 B「在白板上讲」，task-yvabi）的共用类型。规矩照 design/feynman/teaching.md，存法照 notes.md「和画布笔记现有的东西怎么接」。
 * 不依赖 Electron、Node：主进程、界面、以后的 iPad 版都用。
 *
 * 一轮 = 文档里一节 `## 费曼 · <点>`：开头一行隐藏注释记 FeynmanMeta（doc.ts），你讲的、你答的是普通段落，
 * 学生的话、说穿、判定、缺口、说法提醒、完整版是 `> [!ai]` 块。
 */

/** 要点分两类（teaching.md 1.1）：核心决定过不过，了解即可不影响、不追问 */
export type PointKind = 'core' | 'extra'

/**
 * 一条要点。text 只写要讲的事（「放大 α 倍会怎样」），不写答案；answer 是正确说法（讲完才给看，缺口和完整版用）。
 * basis：凭什么（「公式 (2.3.10)」「课后题 3」「PPT p20」）；只凭 AI 判断的写「AI 判断」（AI_BASIS）
 */
export interface Point {
  /** 这一轮里的短编号：核心 c1、c2…，了解即可 e1、e2…，你加的 u1… */
  id: string
  kind: PointKind
  text: string
  answer: string
  basis: string
  /** 出处，点了回到材料：卡片（白板上那张）、PDF 那一页、网页 */
  src?: SourceRef
  /** 核心的关键词（「同时」「旧值」「一起改」）：一说就等于说穿；聊到底给提示、说穿后再问时问题里不能出现 */
  words?: string[]
  /** 核心的一句提示（指一个方向或给一个具体情形，不说结论）：聊到底第 2 次没答上时给 */
  hint?: string
}

/** 只凭 AI 判断的要点，「凭什么」写这一句 */
export const AI_BASIS = 'AI 判断'

/** 常见误解：只有学生知道，拿来追问；不列给你看，讲完在缺口里出现（teaching.md 1.1） */
export interface Myth {
  id: string
  /** 错的说法 */
  text: string
  /** 正确是什么 */
  right: string
  /** 挂在哪条核心上 */
  core: string
}

/**
 * 每条核心只给一个状态（teaching.md 1.2）。前三种算讲清：
 * clear 讲清、asked 追问后补上、fixed 说错后改对；vague 含糊、missing 没讲到、wrong 讲错
 */
export type CoreState = 'clear' | 'asked' | 'fixed' | 'vague' | 'missing' | 'wrong'
export const CORE_STATES: readonly CoreState[] = ['clear', 'asked', 'fixed', 'vague', 'missing', 'wrong']
export const STATE_LABEL: Readonly<Record<CoreState, string>> = { clear: '讲清', asked: '追问后补上', fixed: '说错后改对', vague: '含糊', missing: '没讲到', wrong: '讲错' }
export const isGood = (s: CoreState) => s === 'clear' || s === 'asked' || s === 'fixed'

/** 三档：pass 过、almost 差一点、fail 没过；软件按状态算（rules.ts 的 verdictOf），AI 不直接给 */
export type Verdict = 'pass' | 'almost' | 'fail'
export const VERDICT_LABEL: Readonly<Record<Verdict, string>> = { pass: '过', almost: '差一点', fail: '没过' }

/** AI 判的一条核心：状态 + 一句原话做证据 */
export interface CoreJudged {
  id: string
  state: CoreState
  /** 你的原话（没讲到的是空串） */
  quote: string
  /** 聊到底：hint 提示后答上（出卡、下次提前）；again 说穿后换个情形答上了（说穿后补讲清，判定最多到「过 · 当场补讲」） */
  via?: 'hint' | 'again'
}

/**
 * 缺口一条（teaching.md 4.1）：核心里讲错、含糊、没讲到的，按这个顺序；了解即可的灰着排最后（extra）。
 * 过了的那一轮另有一条 kind 'recap'：「用两三句讲清 X」（已定 1，默认勾）。说错后改对的也出一条（默认勾）
 */
export interface Gap {
  /** 哪条要点（recap 是 '*'） */
  point: string
  kind: CoreState | 'extra' | 'recap'
  /** 你的原话 */
  quote: string
  /** 一句正确说法，不超过 40 字（正好当卡片答案） */
  right: string
  /** 出处：「公式 (2.3.10)」「PPT p20」「材料里没有」 */
  src: string
  /** 出处指回哪里（那条要点的 src）：界面画成能点的出处 */
  ref?: SourceRef
  /** 「出卡」勾没勾：讲错、含糊、没讲到、说错后改对、recap 默认勾；追问后补上、了解即可不勾 */
  card: boolean
  /** 送进 Anki 了（「✓ 已送进Anki」） */
  sent?: boolean
  /** 当场补讲清了（「✓ 当场补讲清了」） */
  redone?: boolean
  /** 聊到底：hint 提示后答上的（「追问后补上（提示后）」，默认出卡）；again 说穿后补讲清（redone 一起记） */
  via?: 'hint' | 'again'
}

/** 正确说法最长几个字 */
export const RIGHT_MAX = 40
/** 完整版最长几个字 */
export const FULL_MAX = 150
/** 说法提醒最多几条 */
export const WORDING_MAX = 2
/** 一个点的核心最多几条，多了拆点（teaching.md 3） */
export const CORE_MAX = 5
/** 最多追问几轮 */
export const ROUNDS_MAX = 3
/** 一次最多选几张卡（notes.md B2） */
export const CARDS_MAX = 12
/** 整块白板最多读几张卡（多的不读，列头照样写「这块白板上的 N 张卡」里读了的数） */
export const BOARD_CARDS_MAX = 30

/** 讲多大一块（teaching.md 3.2）：一个知识点（默认）、串讲这一节 / 一讲、串讲这一章 */
export type Scope = 'point' | 'section' | 'chapter'

/**
 * 材料从哪来（四种入口，能混选）：
 * - map：导图的一支（node 是 @cn/format 导图路径的 pathKey，「0.2」；text 是那个节点的字，路径变了按字找回来）
 * - card：白板上的一张卡（id 是卡的编号行；没编号的按 head 找：卡开头 40 个字）；剪藏卡、子白板卡、PDF 页卡、带框选截图的卡都是 card
 * - word：直接写一个词（从库里找相关笔记当材料，找不到按常识）
 * - pdf：一整份 PDF（先给知识点单子让人挑）；pages 是挑中的那几页（一个点只用那几页）
 * - note：一篇笔记（词找到的、子白板读进来的）
 * - board：整块白板（什么都没选时「从这块白板上挑」的「整块白板」）：白板上的卡一张张读（同 card，最多 BOARD_CARDS_MAX 张），
 *   哪一列、卡之间的连线一起给；以前的费曼轮、导图那一段列表不算卡（导图读成一支）。旧版本认不出这一种时当成 note 读整篇
 */
export type MaterialRef =
  | { kind: 'map'; path: string; node: string; text: string }
  | { kind: 'card'; path: string; id?: string; head: string }
  | { kind: 'word'; word: string }
  | { kind: 'pdf'; path: string; pages?: [number, number] }
  | { kind: 'note'; path: string }
  | { kind: 'board'; path: string }

/**
 * 要一起盖住的东西（界面线照它盖）：白板上剪自同一页、讲同一件事的卡；配对的网页；那份 PDF。
 * card 的 from、to 是读的时候卡在文档里的位置（界面按 id、head 找回来更稳）
 */
export type CoverRef =
  | { kind: 'card'; path: string; id?: string; head: string; from: number; to: number; why: 'picked' | 'same-page' | 'same-thing' }
  | { kind: 'web'; url: string }
  | { kind: 'pdf'; path: string; page?: number }

/** 要点、缺口的出处：卡片、PDF 某一页、网页、笔记 */
export type SourceRef =
  | { kind: 'card'; path: string; id?: string; head: string }
  | { kind: 'pdf'; path: string; page: number }
  | { kind: 'web'; url: string; title?: string }
  | { kind: 'note'; path: string }

/** 你在「这次要讲到」上的改动（teaching.md 2.2）：同一个点下次照你的来 */
export type PointEdit =
  | { op: 'move'; id: string; to: PointKind }
  | { op: 'rename'; id: string; text: string }
  | { op: 'drop'; id: string }
  | { op: 'add'; id: string; text: string }

/**
 * 学生这一句是哪一种：
 * ask 追问（算一轮）；confirm 加还是减这种确认（不算一轮）；reveal 说穿（同一处连着两次没答对）；
 * redirect「这些了解即可，先讲核心」接着问一条核心（算一轮）；answer 你问「这个要不要会」，直接答（不算一轮）；
 * done 问完了（三轮用完，或核心都讲清了），请你点「讲完了」看判定
 */
export type StudentAct = 'ask' | 'confirm' | 'reveal' | 'redirect' | 'answer' | 'done' | 'offer'

/** 追问几轮：三轮（默认，ROUNDS_MAX）或聊到底（不限轮，long.ts）；开讲前「这次要讲到」单子上选，记住上次选的 */
export type TalkMode = 'rounds' | 'long'

/**
 * 聊到底里这一问是哪一步（long.ts 的 queueOf 排的、软件定的；列里学生块右边的小字照它写）：
 * wrong 拿常见误解问说错的、weak 问含糊的、new 外行问法问没碰的；angle 换个角度（第 1 次没答上）、hint 给一个提示（第 2 次）、
 * why 只挑了选项问为什么；again 说穿后隔一会儿换个情形再问；example 带数的例子、myth 拿常见误解试、chain 串讲问点和点怎么接；
 * later 跳过的回来再问一次；deep 往深里聊（了解即可、变式，不判）
 */
export type LongStep = 'wrong' | 'weak' | 'new' | 'angle' | 'hint' | 'why' | 'again' | 'example' | 'myth' | 'chain' | 'later' | 'deep'

/** 学生说过的一句，记在注释里（续讲时算轮次、连着没答对几次） */
export interface Asked {
  act: StudentAct
  /** 盯着哪条核心 */
  point?: string
  /** 这一问之前，你对这条连着没答对几次（第二次没答对才说穿） */
  miss?: number
  /** 聊到底：这一问是哪一步（三轮模式不记） */
  step?: LongStep
  /** 聊到底：你怎么答的这一问（下一句来时记上）：right 答上、miss 没答上、pick 只挑了选项 / 只说「对」 */
  res?: 'right' | 'miss' | 'pick' | 'none'
  /** 聊到底：你点了「先跳过」 */
  skip?: 1
  /** 聊到底的说穿：这一条说反过（说反的躲不掉：第二次跳过、收尾前软件说穿，记讲错） */
  flip?: 1
  /** 聊到底的说穿：收尾前软件说穿的 */
  end?: 1
  /** 聊到底的说穿：加分题（例子、误解、串讲、深聊）上说穿的，不算这条核心说穿过 */
  free?: 1
}

/** 一轮走到哪：draft 列出了「这次要讲到」还没开讲；talking 在讲；paused 暂停了；judged 判过了 */
export type RoundStatus = 'draft' | 'talking' | 'paused' | 'judged'

/** 这一节开头那一行隐藏注释里记的全部（notes.md：三类要点、你的改动、每条状态、判定、日期、看没看过、当场补讲） */
export interface FeynmanMeta {
  /** 写法版本 */
  v: 1
  /** 这一轮的编号（f-日期-四位），界面、补讲认它 */
  id: string
  /** 知识点名（列头「费曼 · 范数」） */
  topic: string
  scope: Scope
  status: RoundStatus
  /** 材料来自 */
  from: MaterialRef[]
  /** 要一起盖住的 */
  cover: CoverRef[]
  /** 核心和了解即可（已经照你的改动改好的样子） */
  points: Point[]
  myths: Myth[]
  edits?: PointEdit[]
  /** 没有材料、AI 自己定的要点（列头写「没有材料，AI 自己定的要点」） */
  noMaterial?: boolean
  /** 同一讲里的知识点单子（PDF 给的、导图这一支拆出来的）：课程首页数「没讲过」的从这里来 */
  siblings?: string[]
  /** 第几讲（课程首页按讲排）；不在课程里的没有 */
  lecture?: number
  /** 这一轮问 AI 用的「Claude Code · Opus 5.5」 */
  by?: string
  /** 开讲那天（YYYY-MM-DD） */
  day: string
  /** 第几次讲这个点 */
  nth: number
  /** 学生说过的几句（续讲用） */
  asked: Asked[]
  /** 讲的时候看过材料几次（按住「看一眼」、暂停露出后接着讲，各算一次） */
  peeks: number
  /** 讲到了的核心（列头小点变灰；判定前） */
  touched?: string[]
  /** 聊到底（不限轮）；没有这一项是三轮（旧的那几节一个字节不动） */
  mode?: 'long'
  /** 聊到底：聊了几秒（界面每一问记一次，暂停的时间不算） */
  secs?: number
  /** 聊到底：讲到了、关键那层关系没说出来的核心（AI 每一问给，只拿来排队，不显示、不进判定） */
  weak?: string[]
  /** 聊到底：说反了、还没问清的核心（问清了去掉） */
  flip?: string[]
  /** 聊到底：你选了几次「接着往深里聊」 */
  deep?: number
  /** 判过以后：每条核心的状态 */
  states?: CoreJudged[]
  /** 了解即可讲到没有 */
  extraSaid?: Record<string, boolean>
  verdict?: Verdict
  /** 当场补讲清了（「过 · 当场补讲」） */
  redone?: boolean
  /** 判的那天 */
  judged?: string
  /** 下次再讲的日子 */
  next?: string
  /** 这个点第几次过（第一次过两周、第二次起六周） */
  passes?: number
  /** 缺口（判过以后；送卡、补讲勾掉也记这里） */
  gaps?: Gap[]
}

/** 一节里的一段（按文档里的先后） */
export type EntryKind = 'me' | 'student' | 'reveal' | 'confirm' | 'verdict' | 'gaps' | 'wording' | 'full'

export interface Entry {
  kind: EntryKind
  /** 正文：me 是原话原样（几段之间的空行留着）；AI 块是去掉「> 」以后的正文（不含头一行） */
  text: string
  /** AI 块头上的「Claude Code · Opus 5.5」 */
  by?: string
  /** 在文档里的范围（整块，含 `> [!ai]` 那一行） */
  from: number
  to: number
}

/** 文档里认出来的一轮 */
export interface RoundSection {
  meta: FeynmanMeta
  /** 标题那一行（`## 费曼 · 范数`）的范围 */
  head: { from: number; to: number; level: number; title: string }
  /** 注释那一行的范围 */
  metaLine: { from: number; to: number }
  /** 这一节在文档里到哪为止（下一个同级或更高的标题之前；没有就是文末） */
  end: number
  entries: Entry[]
}
