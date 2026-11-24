/** 看视频：界面（window.cnVideo）和主进程之间来回传的东西 */
import type { Dest, Site, Track } from './video'

/** 字幕怎么显示：双语 / 只看译文 / 只看原文 / 关 */
export type SubMode = 'bi' | 'tr' | 'orig' | 'off'
/** 盖在画面上 / 放在画面下面 */
export type SubPlace = 'over' | 'below'

export interface VideoKeys {
  /** 记下这一刻（默认 ⌥S） */
  moment: string
  /** 框一块问（默认 ⌥D） */
  ask: string
}

export interface VideoSettings {
  mode: SubMode
  place: SubPlace
  /** 打开视频就开字幕（设置里能关） */
  autoSubs: boolean
  /** 存字幕全文时带译文 */
  withTranslation: boolean
  keys: VideoKeys
  /** 以后没字幕的视频打开就自动生成字幕（下载音频、Soniox 听写，要花钱），默认关 */
  autoStt: boolean
}

export const DEFAULT_VIDEO_KEYS: VideoKeys = { moment: 'Alt+KeyS', ask: 'Alt+KeyD' }

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = { mode: 'bi', place: 'over', autoSubs: true, withTranslation: true, keys: DEFAULT_VIDEO_KEYS, autoStt: false }

/** 快捷键只认「⌥ 加一个字母或数字」（不占网站自己的不带修饰键的键，见 spec 7.5） */
export const isVideoKey = (k: unknown): k is string => typeof k === 'string' && /^Alt\+(Key[A-Z]|Digit[0-9])$/.test(k)

/** ⌥S 这样给人看 */
export const keyLabel = (k: string) => '⌥' + k.replace(/^Alt\+(Key|Digit)/, '')

/** ⌥K / ⌥J / ⌥L：播放暂停、退 5 秒、进 5 秒（不能改） */
export const FIXED_KEYS: Record<string, 'toggle' | 'back' | 'fwd'> = { KeyK: 'toggle', KeyJ: 'back', KeyL: 'fwd' }

export function normalizeVideoSettings(raw: unknown): VideoSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<VideoSettings>
  const k = (r.keys && typeof r.keys === 'object' ? r.keys : {}) as Partial<VideoKeys>
  const moment = isVideoKey(k.moment) && !FIXED_KEYS[k.moment.slice(4)] ? k.moment : DEFAULT_VIDEO_KEYS.moment
  const ask = isVideoKey(k.ask) && k.ask !== moment && !FIXED_KEYS[k.ask.slice(4)] ? k.ask : moment === DEFAULT_VIDEO_KEYS.ask ? DEFAULT_VIDEO_KEYS.moment : DEFAULT_VIDEO_KEYS.ask
  return {
    mode: r.mode === 'tr' || r.mode === 'orig' || r.mode === 'off' ? r.mode : 'bi',
    place: r.place === 'below' ? 'below' : 'over',
    autoSubs: typeof r.autoSubs === 'boolean' ? r.autoSubs : true,
    withTranslation: typeof r.withTranslation === 'boolean' ? r.withTranslation : true,
    keys: { moment, ask },
    autoStt: r.autoStt === true,
  }
}

/** 生成字幕走到哪：下载音频 / Soniox 听写 / 翻译（1/3、2/3、3/3）；出错时 error 是原因 */
export interface SttState {
  stage: 'download' | 'listen' | 'translate'
  error?: string
}

/** 字幕现在怎样：在拿 / 好了 / 这个视频没有字幕 / 要登录 B 站 / 出错 */
export type SubStatus = 'loading' | 'ready' | 'none' | 'login' | 'error'

/** 一个时刻（刻度上一根）：秒、记进了哪篇、是不是问过 AI 的 */
export interface MomentMark {
  t: number
  note: string
  asked?: boolean
  /** 那一秒的那句译文（没有就原文），「N 个时刻」弹层里显示 */
  text?: string
  /** 截图（库里的路径） */
  image?: string
}

/** 右栏某个网页上正在看的视频 */
export interface VideoState {
  wcId: number
  key: string
  site: Site
  id: string
  p?: number
  title: string
  channel: string
  duration: number
  tracks: Track[]
  /** 用的哪条字幕（语言代码） */
  track: string | null
  subs: SubStatus
  /** 出错时的一句话 */
  error?: string
  /** 翻成什么；没有能翻的时候是 null */
  target: string | null
  translated: number
  total: number
  /** 正在翻（翻完、停了都是 false） */
  translating: boolean
  /** 这一轮翻完还没翻成的句数（视频条上「有 N 句没翻成 · 重试」） */
  trFailed: number
  /** 没翻成的原因 */
  trError?: string
  /** 引擎的原话（字幕菜单里「看原话」） */
  trRaw?: string
  /** AI 摘要：没有字幕 / 在写 / 写好了 / 没写成（原因写在字幕全文那一篇里） */
  summary: 'none' | 'writing' | 'done' | 'error'
  moments: MomentMark[]
  /** 字幕全文那一篇（存好以后） */
  material: string | null
  /** 章节（YouTube 有就给） */
  chapters: { start: number; title: string }[]
  /** 这个视频的字幕关着（视频条上关的，或者设置里「打开视频就开字幕」关着） */
  off: boolean
  /** 正在生成字幕（CN-69）；没在生成是 null */
  stt: SttState | null
  /** 填了 Soniox 密钥（没填时「生成字幕」旁写「先在设置里填」） */
  sttKey: boolean
}

/** 网页里报给界面的：播放到哪、视频在网页里的位置（框一块问、问话框要贴着它） */
export interface PlayTick {
  t: number
  duration: number
  paused: boolean
  /** 视频在网页里的位置（CSS 像素，相对网页左上角） */
  rect: { x: number; y: number; w: number; h: number } | null
}

/** 框一块：框在画面里的位置（0 到 1） */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface MomentRequest {
  wcId: number
  dest: Dest
}

/** 记下这一刻：主进程截好帧、存好图，给回要插的 md（图片链接按落点那篇算好） */
export interface MomentResult {
  t: number
  time: string
  /** 时刻块的 md */
  moment: string
  /** 视频卡的 md（文档里第一次记这个视频时先插一行；白板上没有视频卡时放一张） */
  card: string
  /** 截图和封面（库里的路径），提交时一起 */
  files: string[]
  /** 收件箱：主进程自己写好、提交好了 */
  commit?: string
  key: string
}

/** 框好一块（问框打开时）：主进程截好那一帧（画上紫框）记着，问、接着问、想建议都用它；给回框住那块的小图 */
export interface PeekResult {
  /** 这一帧的编号（问的时候带上） */
  card: number
  t: number
  /** 框住那块的小图（data: 网址，长边不超过 192） */
  thumb: string
}

export interface AskRequest {
  wcId: number
  /** 记到哪；null 是不写问答块、不提交（问框 2026-11-24 起都给 null，记进 AI 笔记由界面写） */
  dest: Dest | null
  /** 要记进 AI 笔记：dest 是 null 时也把那一帧存进库（结果里的 image），不写、不提交 */
  keep?: boolean
  box: Box
  question: string
  /** 当前文档的字（给 AI 看） */
  noteText: string
  /** 问框里截好的那一帧（PeekResult.card）；没有就现截 */
  card?: number
  /** 带上前后字幕（问框头上那一格，默认勾上） */
  subs?: boolean
  /** 问框底下选的模型、effort（看图问只有 Claude Code）；不给用设置 › AI「看图问」那一行 */
  model?: string
  effort?: string
  /** 接着问：之前在这一帧问过的几问和回答（第一问时不给） */
  prior?: { q: string; a: string }[]
}

export interface AskResult {
  /** 问框里显示的回答（带要点） */
  answer: string
  /** 「看了 03:42 这一帧、03:12–04:12 的字幕、这篇笔记」 */
  read: string
  /** 要插进笔记的问答块（第一问） */
  block: string
  /** 接着问：接在那块讲解后面的几行（shared/video.ts 的 followMd） */
  follow?: string
  /** 截图（问答块在文档里，一门课的「我的疑惑」直接读它）；只问不记时是空的 */
  files: string[]
  commit?: string
  t: number
  /** 谁答的：「Claude Code · Opus 5.5 · Low」 */
  by: string
  /** 框的那一帧存在库里的哪（只问不记时没有） */
  image?: string
  /** AI 标了这一问讲的是视频外的前置知识：记进笔记那一问的小标题带 #前置知识 */
  pre?: true
}

export interface CnVideoApi {
  state(wcId: number): Promise<VideoState | null>
  onState(cb: (wcId: number, st: VideoState | null) => void): () => void
  settings(): Promise<VideoSettings>
  setSettings(patch: Partial<VideoSettings>): Promise<VideoSettings>
  onSettings(cb: (s: VideoSettings) => void): () => void
  /** 换原文用哪条字幕 */
  useTrack(wcId: number, lang: string): Promise<void>
  /** 翻成什么（和网页翻译同一个设置） */
  setTarget(target: string): Promise<void>
  /** 「有 N 句没翻成 · 重试」：只翻还没翻成的 */
  retryTranslate(wcId: number): Promise<void>
  /** 字幕全文那一篇里「AI 摘要没写成 · 重试」 */
  retrySummary(path: string): Promise<void>
  moment(r: MomentRequest): Promise<MomentResult>
  /** 框好一块：截好那一帧记着，给回编号和框住那块的小图 */
  peek(r: { wcId: number; box: Box }): Promise<PeekResult>
  /** 问框里另外两颗建议：小活那家看那一帧和字幕现想（想不出、出错是空的，只留两颗固定的） */
  suggest(card: number): Promise<string[]>
  ask(r: AskRequest): Promise<AskResult>
  /** 边答边来的回答（问框里就地长出来）：这一帧的编号、已经到了的那一截 */
  onAskText(cb: (card: number, text: string) => void): () => void
  /** 停下这个视频正在问的那一问 */
  askStop(wcId: number): Promise<void>
  /** 文档、白板里插好、存好以后：一次提交（附件图 + 文档改动） */
  commit(paths: string[], message: string, mark: { wcId: number; t: number; note: string; asked?: boolean; text?: string; image?: string }): Promise<string | null>
  /** 撤回 = 反向提交 */
  undo(hash: string, mark: { wcId: number; t: number }): Promise<void>
  /** 网页里按了视频的快捷键（焦点在网页时主进程转过来） */
  onKey(cb: (action: 'moment' | 'ask' | 'toggle' | 'back' | 'fwd' | 'subs', wcId: number) => void): () => void
  /** 白板上视频卡、文档里链接：封面、标题、频道、时长（YouTube oEmbed / B 站接口；本机缓存） */
  meta(url: string): Promise<{ title: string; channel: string; duration: number; cover: string | null } | null>
  /** 双击视频卡接着看：上次看到哪一秒 */
  lastPos(key: string): Promise<number>
  /** 生成字幕：wcId 是开着的视频；只给 key 时（时刻块里点「生成字幕」）等这个视频在右栏打开后开始 */
  transcribe(r: { wcId?: number; key?: string }): Promise<void>
  stopTranscribe(wcId: number): Promise<void>
  /** Soniox 密钥：有没有、最后 4 位、是不是用的环境变量；null 是删掉 */
  sttKey(): Promise<{ has: boolean; tail: string | null; fromEnv: boolean }>
  setSttKey(key: string | null): Promise<{ has: boolean; tail: string | null; fromEnv: boolean }>
  /** 主进程后台做完的事说一句（生成字幕后补上了几处时刻的原文和译文） */
  onNotice(cb: (text: string) => void): () => void
  /** 端到端测试：本机假视频站的地址（当成 YouTube）；平时是 null */
  testOrigin: string | null
}
