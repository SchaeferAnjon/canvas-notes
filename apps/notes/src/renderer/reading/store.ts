/**
 * 一份 PDF 读着时的状态，PDF 标签（中间栏）和右栏的 AI、笔记共用：
 * 对话、问过的地方、框好还没发的那块、笔记读回来的段、要跳到哪、要看笔记哪一段。
 * 存盘的部分（看到哪页、对话）交给主进程存在软件设置目录；笔记本身在库里。
 */
import { type AskSection, blocksText, CONFUSED, confusedAsk, confusedOf, DEFAULT_KINDS, type HlKind, documentBlocks, notePathFor, UNPLACED, PREREQ, parseReadingNote, type PdfBlock, pageBlocks, type Rect } from '@cn/format'
import { useSyncExternalStore } from 'react'
import { setHlKindsNow } from './hl-kinds'
import type { EngineId, ToolStep } from '../../shared/agent'
import { type AiPick, canSeeImages, convPick, pickLabel, pickReq } from '@cn/ai-engines/shared'
import { imageNames, type Material, PASTED_NAME, shiftMarks } from '../../shared/materials'
import { blocksRect, locateShot } from '../../shared/locate'
import { type AskResult, type ReadingChat, type ReadingMsg, type ReadingSide, type ReadingState, type ReadingThread, readLine, withoutVizMark } from '../../shared/reading'
import { titleOf } from '../../shared/layout'
import { fmtTime, timeUrl, videoOf } from '../../shared/video'
import { pageText, pdfDoc, renderCrop } from './pdf'
import { type FormulaCrop, formulaCrops, formulaPicks } from './formula-crops'
import { pageTitle } from '../../shared/pdf-page-title'
import { type NoteAppendRequest, type NoteKind } from '../../shared/ai-note'
import { readKey } from '../../shared/ai-chats'
import { noteSwitchNow } from '../ai-note-switch'
import { webHost } from '../plugins/host'
import { clearWebBox } from './web-bridge'
import { ASK_THIS, sideName as nameOf } from '../side/name'
import { backLabel, fragmentUrl } from '../../shared/web-link'
import { pageHead } from '../../shared/read-along'

/** 框好、还没发的那一块（右栏输入框里那张小图） */
export interface Pending {
  page: number
  rect?: Rect
  quote?: string
  /** 截好的图（blob 网址和字节）；选字问的没有。截图是框在 PDF 上 100% 时的 2 倍，w 是 100% 时的宽（CN-111） */
  url?: string
  png?: Uint8Array
  w?: number
  /** 库里已经有的图（视频问答块「接着问」：那一问框的那一帧），直接附上，不另存 */
  image?: string
  /** 改问法：输入框不预填「给我讲解一下」 */
  blank?: boolean
  /** 马上就发（工具条按钮、问这一页、⌘↵）：输入框不预填，也不抢焦点 */
  direct?: boolean
  /** 在右栏网页上框的（或库里的 HTML）：网址、标题、框里的字 */
  web?: { url: string; title: string; text?: string; /** 视频问答块「接着问」：那一问在视频第几秒 */ t?: number; /** 「接着问」：那一问 AI 当时的回答 */ answer?: string; /** 上面最近的小标题 */ head?: string }
  /** 选中小条上自己加的那颗（task-26nz7）：命令的名字（写进笔记时块头写它）、只在 AI 栏答（不写进笔记） */
  cmd?: string
  noNote?: true
}

/** 输入框里打了自己的问题再按 ⌘↵：PDF 标签带上这一页（HTML 带上这一屏）问这句。detail：{ src, text } */
export const ASK_PAGE = 'cn:reading-ask-page'

/** 来源是右栏网页（中间栏没开 PDF、HTML 时框着问）：「web:<网址>」 */
export const isWebSrc = (src: string) => src.startsWith('web:')
/**
 * 这会儿发一问会不会记进网页那篇的 AI 笔记（要先定挂在哪篇，task-6cxtc 的「记到哪篇」）：网页那一处、「记笔记」开着；
 * 看待问的那块，没有就看接着的那一串（视频问框带过来的那一串记进问框那篇，不问）
 */
export function sendsToWebNote(src: string): boolean {
  const r = get(src)
  const th = r.pending ?? r.state.threads.find((t) => t.id === r.activeThread)
  return kindOf(src, th) === 'web' && !(th && 'note' in th && th.note) && noteSwitchNow('web').main
}

/** 排着的一问。page：答的时候按 ⌘↵ 排上的，发出时和平时的 ⌘↵ 一样带上那一页；mats：带的材料（字里的 ①② 是它们的位置） */
export interface Queued {
  text: string
  pasted: string[]
  page?: number
  mats?: Material[]
}

export interface Reading {
  pdf: string
  loaded: boolean
  state: ReadingState
  pages: number
  hash: string
  /** 全文读到第几页了（读完 = pages） */
  readN: number
  /** 每页的段落块，读到哪页有哪页 */
  blocks: Record<number, PdfBlock[]>
  pending: Pending | null
  /** 接着追问的那一处 */
  activeThread: string | null
  /** 正在问的那一轮（一开始发就记上，连点两下第二下进不来） */
  running: number | null
  /**
   * AI 还在答上一问时又发的几问（点浮条「讲解一下」、输入框回车、⌘↵）：按顺序排在后面，答完一问发下一问（CN-28/30）。
   * 连排几句都留着（第 3 轮：第二句把第一句顶掉、哪里都找不回来）
   */
  queued: Queued[]
  /** 排着的那几问不发了（点了停下、点了「不发了」、换了一块）：它们的字和材料接回输入框（输入框里已经有的字不动） */
  restore: { text: string; mats: Material[]; seq: number } | null
  /**
   * 从外面加进输入框的材料（多段引用方向 B）：PDF 上框一块「引用这块」、右栏网页选字「问 AI」。输入框（ReadingAi）拿走一块删一块；
   * doc：别处选字带进来的，成为第一块（已经有一块就换掉它）
   */
  incoming: { mat: Material; doc: boolean; seq: number }[]
  note: { path: string; text: string; sections: AskSection[] }
  /** 让 PDF 翻过去、框闪两下 */
  /** text：引的那句原文（AI 回答里的页码链接带的）：PdfTab 拿它找是哪一段，找到了跳到那段、那段闪（页码链接跳到段） */
  jump: { page: number; rect?: Rect; text?: string; seq: number } | null
  /** 让笔记滚到那一段、外圈亮一下 */
  focus: { id: string; seq: number } | null
  /** 让 AI 滚到那次对话、外圈亮一下 */
  convo: { id: string; seq: number } | null
  /** 有新记的笔记还没看（竖条「笔记」上的小点） */
  fresh: boolean
  /** 正在后台写的几段 */
  writing: string[]
  /** 发出去过几次：输入框看到它变了就清掉预填的字（不管是从哪里发的） */
  sent: number
  /** 旁支（2026-11-21 方向 A「就地展开」，task-4edsc）：开着哪一条，刚收起的是哪一条（那句闪一下） */
  side: SideUi
  /** 正在答的旁支：旁支编号 → 那条回答的 id */
  sideRunning: Record<string, number>
  /** 让笔记滚到那条旁支（「在笔记里看」、笔记里点小标） */
  sideFocus: { thread: string; quote: string; seq: number } | null
  /** 打开时补了以前缺的截图（task-yp8l7）：右栏笔记顶上说的那一句 */
  filled?: string | null
  /** 网页那一处（web:<网址>）的网页标题：引用、问的时候记下（还没问过时头上、「看得到」、空白提示也写得出它，task-6cxtc 复审） */
  webTitle?: string
}

/** 旁支开着哪一条；flash：刚收起的那一条（那句闪 1.4 秒、小标闪一圈） */
export interface SideUi {
  open: string | null
  flash: { side: string; seq: number } | null
}

export { ASK_THIS }

const docs = new Map<string, Reading>()
const subs = new Set<() => void>()
let version = 0
const emit = () => {
  version++
  for (const s of subs) s()
}

const blank = (pdf: string): Reading => ({
  pdf,
  loaded: false,
  state: { pdf, page: 1, msgs: [], threads: [] },
  pages: 0,
  hash: '',
  readN: 0,
  blocks: {},
  pending: null,
  activeThread: null,
  running: null,
  queued: [],
  restore: null,
  incoming: [],
  note: { path: notePathFor(pdf), text: '', sections: [] },
  jump: null,
  focus: null,
  convo: null,
  fresh: false,
  writing: [],
  sent: 0,
  side: { open: null, flash: null },
  sideRunning: {},
  sideFocus: null,
})

export function get(pdf: string): Reading {
  let r = docs.get(pdf)
  if (!r) {
    r = blank(pdf)
    docs.set(pdf, r)
  }
  return r
}

export function update(pdf: string, f: (r: Reading) => Partial<Reading>) {
  const r = get(pdf)
  docs.set(pdf, { ...r, ...f(r) })
  emit()
}

export function useReading(pdf: string | null): Reading | null {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version,
  )
  return pdf ? get(pdf) : null
}

/** 「AI 对话」现在用的那家（做个可视化、后台记笔记跟它）；每问一次按设置 › AI「AI 对话」那一行更新 */
let engineNow: EngineId = 'claude'

/** 外面（PDF 上「引用这块」、右栏网页「问 AI」）加一块材料进这份 PDF 的输入框；输入框开着就马上拿走 */
export function addMaterial(pdf: string, mat: Material, o: { doc?: boolean } = {}) {
  update(pdf, (r) => ({ incoming: [...r.incoming, { mat, doc: !!o.doc, seq: nextSeq() }] }))
}

/** 网页那一处记下网页标题（网页上引用、问的时候） */
export function setWebTitle(src: string, title: string) {
  if (title && get(src).webTitle !== title) update(src, () => ({ webTitle: title }))
}

/** 输入框拿走等着的材料 */
export function takeIncoming(pdf: string): Reading['incoming'] {
  const got = get(pdf).incoming
  if (got.length) update(pdf, () => ({ incoming: [] }))
  return got
}

/** 输入框底行换了模型、effort（CN-91 方向 C）：只管这份 PDF 的对话，记在它的对话记录里 */
export function setPick(pdf: string, pick: AiPick) {
  update(pdf, (r) => ({ state: { ...r.state, pick } }))
  save(pdf)
}

/**
 * 这一问用的哪家、哪个模型、哪一档和回答头上那一行（CN-91）：哪家跟设置 › AI「AI 对话」那一行，
 * 这份 PDF 的对话自己选过模型、effort 就用自己的（ReadingAi 底行那三颗显示的就是它）
 */
async function pickNow(pdf: string): Promise<{ pick: AiPick; by: string; req: { model?: string; effort?: string } }> {
  const ai = await window.cn.aiEngines()
  const pick = convPick(ai.engines, ai.chat, get(pdf).state.pick)
  engineNow = pick.engine
  const models = ai.engines.find((e) => e.id === pick.engine)?.models
  return { pick, by: pickLabel(pick, models), req: pickReq(pick) }
}

/** 这一处在看什么（记笔记开关按它分，shared/ai-note.ts）：PDF、库里的 HTML 是 pdf；网页上问的看是视频（视频网页、问框带过来的那一处）还是网页 */
export function kindOf(src: string, th?: { web?: { t?: number } } | null): Extract<NoteKind, 'pdf' | 'web' | 'video'> {
  if (!isWebSrc(src)) return 'pdf'
  return th?.web?.t !== undefined || videoOf(src.slice(4)) ? 'video' : 'web'
}

/**
 * 网页、视频那一处的问答写进哪篇（2026-11-24 偏好「剪藏和AI笔记同一篇」）：网页是配成一对的剪藏那篇，视频是「记到哪」那篇，写进那篇本身、
 * 和剪藏混排。web-notes/flow.ts 登记进来（免得两边互相引用）。
 * now：现在定没定（界面显示用，不问）；ask：答完要记了，还没定就问一句（网页贴着输入框问记到哪篇、视频照「记到哪」建好那篇），取消、只问不记是 null；
 * put：把拼好的那几行写进那篇（中间看得见那篇插在光标处，不然接在末尾）、提交
 */
export interface NoteParents {
  now(kind: 'web' | 'video', url: string): string | null
  ask(kind: 'web' | 'video', url: string, title: string): Promise<string | null>
  put(note: string, md: string, o: { files: string[]; subject: string; src: string }): Promise<void>
}
let parents: NoteParents | null = null
export const setNoteParents = (p: NoteParents | null) => void (parents = p)

/** 这一处记进哪篇（库里的路径）、还没有时怎么建；还没定是 null。th：哪一处（视频问框带过来的记进问框那篇） */
export function noteTargetNow(src: string, th?: ReadingThread | null): { note: string; create?: NoteAppendRequest['create']; inline?: true } | null {
  const kind = kindOf(src, th)
  if (kind === 'pdf') return { note: get(src).note.path, create: { pdf: src } }
  const note = th?.note ?? parents?.now(kind, th?.web?.url ?? src.slice(4)) ?? null
  return note ? { note, inline: true } : null
}

async function noteTarget(src: string, th: ReadingThread): Promise<{ note: string; create?: NoteAppendRequest['create']; inline?: true } | null> {
  const kind = kindOf(src, th)
  if (kind === 'pdf' || th.note) return noteTargetNow(src, th)
  const note = (await parents?.ask(kind, th.web?.url ?? src.slice(4), th.web?.title ?? get(src).webTitle ?? '')) ?? null
  return note ? { note, inline: true } : null
}

/** ⌘J、右下角圆钮打开的 AI：打开后光标进输入框（打开 PDF 时自己出来的那次不抢焦点） */
let focusWanted = false
export const wantAiFocus = () => {
  focusWanted = true
}
export function takeAiFocus(): boolean {
  const w = focusWanted
  focusWanted = false
  return w
}

let seq = Date.now()
const nextSeq = () => ++seq

// ---------- 读进来、存回去 ----------

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
function save(pdf: string) {
  clearTimeout(saveTimers.get(pdf))
  saveTimers.set(
    pdf,
    setTimeout(() => {
      saveTimers.delete(pdf)
      const r = get(pdf)
      if (r.loaded) void window.cnReading.saveState(r.state)
    }, 300),
  )
}

/**
 * 还没存的现在就存：AI 对话菜单列「最近在别处问的」之前（刚问完的那份 PDF 也要列得出来）；
 * 退出软件、关窗口前（main.tsx 的 cnSaveAll）和页面卸载前：不然答完 300 毫秒内退出，存下的是半截回答
 */
export async function flushSaves(all = false) {
  const pending = [...saveTimers.keys()]
  for (const pdf of pending) clearTimeout(saveTimers.get(pdf))
  saveTimers.clear()
  // 退出、卸载时读进来的每一份都存：边答边显示的字（还没答完、没排上存盘的）也在
  const list = all ? [...docs.keys()] : pending
  await Promise.all(list.map((pdf) => (get(pdf).loaded ? window.cnReading.saveState(get(pdf).state) : undefined)))
}
// 页面卸载（重载、关窗口）：发出去的存盘请求在卸载前就交给了主进程
if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => void flushSaves(true))

let listening = false

/** 上次关软件时没答完的那条记成停下了；正在记笔记、做可视化的记成没做完 */
const settled = (m: ReadingMsg): ReadingMsg =>
  m.role === 'ai' && !m.text && !m.error
    ? { ...m, error: '没答完（软件关了）' }
    : m.note === 'writing' || m.viz?.state === 'making'
      ? { ...m, ...(m.note === 'writing' ? { note: undefined } : {}), ...(m.viz?.state === 'making' ? { viz: { state: 'error' as const, error: '软件关了，没做完' } } : {}) }
      : m

export async function load(pdf: string) {
  if (!listening) {
    listening = true
    window.cnReading.onAsk((id, e) => (e.type === 'text' ? onAskText(id, e.delta) : onAskStep(id, { id: e.id, label: e.label, ...(e.code ? { code: e.code } : {}), status: e.status, ...(e.detail ? { detail: e.detail } : {}), ...(e.paths?.length ? { paths: e.paths } : {}) })))
  }
  if (get(pdf).loaded) return
  const [state, note, at] = await Promise.all([window.cnReading.state(pdf), window.cnReading.readNote(pdf), /\.pdf$/i.test(pdf) ? window.cnReading.readAt(pdf).catch(() => null) : null])
  // 读到哪两边合一（ParaRead 联动）：库里那份是两个软件里最近的一次（这边翻页也写进去），有就照它回到那一页
  if (at) state.page = at.page
  // 旁支照旧在（CN-90）：没问过的空旁支不留
  const { msgs, sides, older } = splitLegacy({ ...state, msgs: state.msgs.map(settled), sides: (state.sides ?? []).filter((s) => s.msgs.length).map((s) => ({ ...s, msgs: s.msgs.map(settled) })) })
  const last = [...msgs].reverse().find((m) => m.role === 'user')
  update(pdf, () => ({ loaded: true, state: { ...state, msgs, sides, older }, activeThread: last?.thread ?? null, note: { ...note, sections: parseReadingNote(note.text, note.path) } }))
  void syncNoted(pdf).catch((e: unknown) => console.error('认记过的问没认成', e))
}

/** 笔记重读（记了一问、划了线、笔记改了）：「已记进」那几行跟着笔记里认 */
export async function reloadNote(pdf: string) {
  const note = await window.cnReading.readNote(pdf)
  update(pdf, () => ({ note: { ...note, sections: parseReadingNote(note.text, note.path) } }))
  await syncNoted(pdf)
}

export function setPage(pdf: string, page: number) {
  const r = get(pdf)
  if (!r.loaded || r.state.page === page) return
  update(pdf, (x) => ({ state: { ...x.state, page } }))
  save(pdf)
  // 读到哪写进库里两边共用的那份：停下 1.5 秒再写（翻得快时不一页写一次）
  if (/\.pdf$/i.test(pdf)) {
    clearTimeout(readAtTimers.get(pdf))
    readAtTimers.set(
      pdf,
      setTimeout(() => {
        readAtTimers.delete(pdf)
        const x = get(pdf)
        void window.cnReading.putReadAt(pdf, { page: x.state.page, ...(x.pages ? { pages: x.pages } : {}) }).catch((e: unknown) => console.error('读到哪没记上', e))
      }, 1500),
    )
  }
}
const readAtTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 这份 PDF 开着、在前面读了多久（PdfTab 每 15 秒报一次）：记进读到哪那份的「读了」 */
export function addReadTime(pdf: string, ms: number) {
  if (ms > 0) void window.cnReading.putReadAt(pdf, { addMs: ms }).catch((e: unknown) => console.error('读了多久没记上', e))
}

// ---------- 划线（ParaRead 联动，颜色带含义） ----------

/** 含义表（库里 .canvas-notes/划线颜色.json，和 ParaRead 共用）；没读到时是默认四种 */
let kindsNow: HlKind[] = DEFAULT_KINDS
let kindsAsked: Promise<void> | null = null
export function loadKinds(force = false): Promise<void> {
  if (kindsAsked && !force) return kindsAsked
  kindsAsked = window.cnReading.hlKinds().then(
    (k) => {
      kindsNow = k
      setHlKindsNow(k)
      emit()
    },
    (e: unknown) => console.error('划线颜色没读到', e),
  )
  return kindsAsked
}
export function useKinds(): HlKind[] {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version,
  )
  if (!kindsAsked) void loadKinds()
  return kindsNow
}
export const kinds = () => kindsNow
export function setKinds(k: HlKind[]) {
  kindsNow = k
  setHlKindsNow(k)
  emit()
}

/**
 * 划一条：写进配对笔记（主进程一次提交），笔记重读；看不懂的写成一段问题段，这一处记进对话记录（问 AI 时接着它），
 * 右栏笔记滚到那一段。返回这一条的身份
 */
export async function addHighlight(pdf: string, h: { page: number; rect?: Rect; text: string; key: string }): Promise<{ id: string; thread?: string }> {
  if (h.key !== CONFUSED) {
    const r = await window.cnReading.hlAdd({ pdf, ...h })
    await reloadNote(pdf)
    return { id: r.id }
  }
  const thread = await window.cnReading.newThread(pdf, h.page)
  const r = await window.cnReading.hlAdd({ pdf, ...h, thread })
  const th: ReadingThread = { id: thread, page: h.page, ...(h.rect ? { rect: h.rect } : {}), createdAt: Date.now() }
  update(pdf, (x) => ({ state: { ...x.state, threads: [...x.state.threads, th] } }))
  save(pdf)
  await reloadNote(pdf)
  focusSection(pdf, thread)
  return { id: r.id, thread }
}

export async function setHighlight(pdf: string, id: string, key: string) {
  await window.cnReading.hlSet(pdf, id, key)
  await reloadNote(pdf)
}

export async function removeHl(pdf: string, id: string) {
  await window.cnReading.hlRemove(pdf, id)
  await reloadNote(pdf)
}

/**
 * 「看不懂」那一段的「问 AI」：接着这一处问「这句看不懂：「原文」」（答完写回笔记时第一问换回看不懂那一问，回答接在下面）。
 * 这一处是 ParaRead 划的、这台 Mac 上没有记录时先补一条（页码、框照笔记那一段）
 */
export async function askConfused(pdf: string, s: AskSection) {
  const c = s.qas?.[0] ? confusedOf(s.qas[0].q) : null
  if (!c) return
  if (!get(pdf).loaded) await load(pdf)
  if (!get(pdf).state.threads.some((t) => t.id === s.id)) {
    const th: ReadingThread = { id: s.id, page: s.page, ...(s.rect ? { rect: s.rect } : {}), createdAt: Date.now() }
    update(pdf, (x) => ({ state: { ...x.state, threads: [...x.state.threads, th] } }))
    save(pdf)
  }
  update(pdf, () => ({ activeThread: s.id, pending: null }))
  await send(pdf, confusedAsk(c.text))
}

const patchMsg = (pdf: string, id: number, p: Partial<ReadingMsg>) => {
  update(pdf, (r) => ({ state: { ...r.state, msgs: r.state.msgs.map((m) => (m.id === id ? { ...m, ...p } : m)) } }))
  save(pdf)
}

/**
 * / 命令在读 PDF 的对话里跑（task-9womr：这份课件每页讲什么、复习提纲、自测题、视频要点…）：加一句问、一条回答，回答边做边改；
 * 不记进笔记（命令自己写它说的那一处）。返回回答的编号；done 时收起「在答」
 */
export function cmdTurn(pdf: string, text: string): { id: number; patch(p: Partial<ReadingMsg>): void; done(): void } {
  const now = Date.now()
  const thread = `cmd-${now}`
  const uid = nextSeq()
  const id = nextSeq()
  update(pdf, (x) => ({ running: id, state: { ...x.state, msgs: [...x.state.msgs, { id: uid, role: 'user', thread, text, time: now }, { id, role: 'ai', thread, text: '', time: now }] } }))
  save(pdf)
  return { id, patch: (p) => patchMsg(pdf, id, p), done: () => update(pdf, (x) => (x.running === id ? { running: null } : {})) }
}

// ---------- 读全文 ----------

/** 第一次打开：后台一页一页读出段落块（问的时候已经能问），读完交给主进程按内容指纹缓存 */
export async function readAll(pdf: string, hash: string, pages: number) {
  update(pdf, () => ({ hash, pages, readN: 0 }))
  // 读过的（按内容指纹缓存着）直接拿来
  const cached = await window.cnReading.getText(hash)
  if (cached && cached.length === pages) {
    update(pdf, () => ({ blocks: Object.fromEntries(cached.map((b, i) => [i + 1, b])), readN: pages }))
    return
  }
  const doc = pdfDoc(pdf)
  if (!doc) return
  const texts = []
  for (let n = 1; n <= pages; n++) {
    if (pdfDoc(pdf) !== doc) return
    texts.push(await pageText(doc, n))
    update(pdf, () => ({ readN: n }))
  }
  const all = documentBlocks(texts)
  update(pdf, (r) => ({ blocks: Object.fromEntries(all.map((b, i) => [i + 1, b])), readN: pages, hash: r.hash }))
  await window.cnReading.setText(hash, pdf, all, texts.map((t) => [t.width, t.height]))
}

/** 某一页的块：全文读到了就用，没读到现读这一页 */
async function blocksOf(pdf: string, page: number): Promise<PdfBlock[]> {
  const have = get(pdf).blocks[page]
  if (have) return have
  const doc = pdfDoc(pdf)
  if (!doc) return []
  return pageBlocks(await pageText(doc, page), page)
}

// ---------- 框一块、问 ----------

/**
 * 框好了：右栏 AI 输入框里放上截图。
 * sentAt：开始截图时的发出次数；截好之前已经发出去了（点得比截图快），晚到的截图丢掉，不再放回去（CN-28）
 */
export function stage(pdf: string, p: Pending, sentAt?: number) {
  if (sentAt !== undefined && get(pdf).sent !== sentAt) {
    if (p.url) URL.revokeObjectURL(p.url)
    return
  }
  const old = get(pdf).pending
  if (old?.url && old.url !== p.url) URL.revokeObjectURL(old.url)
  // 换了一块：排着的那一问是问上一块的，不发了（字还回输入框）
  const keep = !!old && samePlace(old, p)
  update(pdf, (x) => ({ pending: p, ...(keep ? {} : dropQueue(x)) }))
}

/**
 * 视频框一块问的问答带进 AI 标签（task-sta8n 问框里「在 AI 标签里聊」）：在这个视频那一份对话里新开一处
 * （记着视频、第几秒、那几问和回答，框的那一帧是这一处的图），几问几答照原样摆成消息，第一问带着那一帧；
 * 这一处成了接着问的那一处：在 AI 标签里问，AI 看得到那一帧（第一次附上）、那几问和回答、前后字幕
 */
export async function adoptVideoQa(src: string, v: { url: string; title: string; t: number; image?: string; note?: string; qa: { q: string; a: string; by: string; id?: number }[] }) {
  if (!v.qa.length) return
  await load(src)
  const now = Date.now()
  const id = await window.cnReading.newThread(src, 0)
  const answer = v.qa.map((x, i) => (i ? `接着问：${x.q}\n${x.a}` : x.a)).join('\n\n')
  // 问框记进的那篇 AI 笔记：在这里接着问的也记进它（问框记过的几问已经在那篇里，那几条回答照用问框的编号，认得出记过了）
  const th: ReadingThread = { id, page: 0, quote: v.qa[0]!.q, ...(v.image ? { crop: v.image } : {}), web: { url: v.url, title: v.title, t: v.t, answer: answer.slice(0, 4000) }, createdAt: now, ...(v.note ? { note: v.note } : {}) }
  const read = `看了 ${fmtTime(v.t)} 这一帧`
  const msgs: ReadingMsg[] = v.qa.flatMap((x, i): ReadingMsg[] => [
    { id: nextSeq(), role: 'user', thread: id, text: x.q, time: now, page: 0, ...(i === 0 && v.image ? { image: v.image } : {}) },
    { id: x.id ?? nextSeq(), role: 'ai', thread: id, text: x.a, time: now, page: 0, read, by: x.by, ...(v.note && x.id ? { note: 'done' as const, notePath: v.note } : {}) },
  ])
  update(src, (r) => ({ activeThread: id, state: { ...r.state, threads: [...r.state.threads, th], msgs: [...r.state.msgs, ...msgs] } }))
  save(src)
}

/** 排着的这几问不发了：字（一问一段，空一行）和材料交回输入框；后一问字里的编号接着前一问的往后数 */
function giveBack(qs: Queued[]): Reading['restore'] {
  if (!qs.length) return null
  let n = 0
  const texts: string[] = []
  const mats: Material[] = []
  for (const q of qs) {
    const own = q.mats ?? []
    texts.push(shiftMarks(q.text, own.length, n))
    mats.push(...own)
    n += own.length
  }
  return { text: texts.join('\n\n'), mats, seq: nextSeq() }
}
const dropQueue = (x: Reading): Partial<Reading> => (x.queued.length ? { queued: [], restore: giveBack(x.queued) } : {})

/** 输入框上排着的那一行的「不发了」：只这一问不发，字回输入框，别的照排 */
export function cancelQueued(pdf: string, i: number) {
  update(pdf, (x) => (x.queued[i] ? { queued: x.queued.filter((_, j) => j !== i), restore: giveBack([x.queued[i]!]) } : {}))
}

const samePlace = (a: Pending, b: Pending) => a.page === b.page && (a.rect?.join(',') ?? '') === (b.rect?.join(',') ?? '') && (a.quote ?? '') === (b.quote ?? '')

/** 不要框的这块了。keepText：点的是图上的 ×，排着的那一问的字还回输入框（esc 是连字一起清掉） */
export function unstage(pdf: string, keepText = false) {
  const old = get(pdf).pending
  if (old?.url) URL.revokeObjectURL(old.url)
  update(pdf, (x) => ({ pending: null, ...(keepText ? dropQueue(x) : { queued: [] }) }))
}

/** 一块材料从哪来（输入框顶上那一排小卡上写的）：PDF「第28页」「第28页 · 我框的」，网页「2.2.1 读取数据集 · 我框的」，HTML「旋转矩阵 · 我框的」 */
function matSrc(pdf: string, p: Pending): string {
  if (p.web && /^https?:/i.test(p.web.url)) return `${backLabel({ ...(p.web.head ? { head: p.web.head } : {}), title: p.web.title, url: p.web.url })}${p.quote ? '' : ' · 我框的'}`
  if (p.web) return `${(pdf.split('/').pop() ?? pdf).replace(/\.[^.]+$/, '')} · 我框的`
  return p.quote ? `第${p.page}页` : `第${p.page}页 · 我框的`
}

/**
 * 引用（task-6cxtc 四处小条统一：原来的「改问法」「引用这块」合成这一颗）：框着的这块（截图）、选着的这段（字）成为输入框顶上的一块材料，
 * 框收起、光标进输入框（输入框拿走材料时放光标）；接着框别处再引用就攒成 ①②。截图还在截时等它好（最多 5 秒）。没有框着的返回 false
 */
export async function quotePending(pdf: string): Promise<boolean> {
  const waiting = () => {
    const p = get(pdf).pending
    return !!p && !p.quote && !p.png && !p.image
  }
  for (let i = 0; i < 125 && waiting(); i++) await new Promise((res) => setTimeout(res, 40))
  const p = get(pdf).pending
  if (!p) return false
  const src = matSrc(pdf, p)
  const url = p.web && /^https?:/i.test(p.web.url) ? { url: p.web.url } : {}
  let mat: Material
  if (p.quote) mat = { kind: 'quote', text: p.quote.slice(0, 20_000), src, ...url }
  else if (p.png) mat = { kind: 'image', name: await window.cn.aiPaste(p.png, 'image/png'), src, ...(p.page > 0 ? { page: p.page } : {}), ...url }
  else return false
  unstage(pdf)
  addMaterial(pdf, mat)
  // 网页那边的框和工具条收起来
  if (p.web && /^https?:/i.test(p.web.url)) clearWebBox(webHost()?.view() ?? null)
  return true
}

/** 这份 PDF（HTML）的标签关了：排着的那一问不发、不记笔记；正在答的那一问照常答完记下 */
export function closed(pdf: string) {
  if (!docs.has(pdf)) return
  // 关 PDF：配对笔记的属性「读到」「读了」跟上（ParaRead 联动；笔记已经有了才写）
  if (/\.pdf$/i.test(pdf) && get(pdf).loaded) void window.cnReading.readAtProps(pdf).catch((e: unknown) => console.error('读到哪没写进笔记', e))
  const old = get(pdf).pending
  if (old?.url) URL.revokeObjectURL(old.url)
  update(pdf, () => ({ pending: null, queued: [], restore: null }))
}

/** 截一块：按 PDF 本身重新画，不受屏幕上的缩放影响；按 PDF 100% 的 2 倍画（笔记里按 100% 的宽显示，CN-111） */
export async function cropOf(pdf: string, page: number, rect?: Rect) {
  const doc = pdfDoc(pdf)
  if (!doc) throw new Error('PDF还没打开')
  return renderCrop(doc, page, rect, undefined, 2)
}

/**
 * 发出去：有框好的那块就新开一处；没有就接着上一处追问（还没问过的话，问的是正在看的这一页）。
 * 回答出来以后在后台记进笔记，不让人等。
 */
export async function send(pdf: string, text: string, pasted: string[] = [], o: { page?: number; mats?: Material[] } = {}) {
  const r = get(pdf)
  const mats = o.mats ?? []
  if (!text.trim() && !mats.length) return
  if (r.running !== null) {
    // 还在答上一问：排在队尾，答完依次发（CN-28/30）。点浮条按钮、输入框回车、⌘↵ 都走这里
    update(pdf, (x) => ({ queued: [...x.queued, { text: text.trim(), pasted, ...(o.page ? { page: o.page } : {}), ...(mats.length ? { mats } : {}) }] }))
    return
  }
  // 一开始就记下「在发了」（不等建对话、存截图那几步）：连点两下第二下进不来；
  // 输入框清掉预填的字；待问区清空，晚到的截图不再放回去
  const aiId = nextSeq()
  const p = r.pending
  update(pdf, (x) => ({ running: aiId, sent: x.sent + 1, pending: null }))
  try {
    await ask(pdf, aiId, p, text, pasted, mats)
  } finally {
    if (p?.url) URL.revokeObjectURL(p.url)
    update(pdf, () => ({ running: null }))
  }
  // 答的时候排着的：发排在最前的那一问，后面的接着排（点了停下、标签关了的，queued 已经清掉了）
  const [q, ...rest] = get(pdf).queued
  if (!q) return
  update(pdf, () => ({ queued: rest }))
  if (q.page) void sendWithPage(pdf, q)
  else void send(pdf, q.text, q.pasted, q.mats ? { mats: q.mats } : {})
}

/**
 * 排着的 ⌘↵：和平时的 ⌘↵ 一样带上那一页。PDF 在这里截那一页；HTML 的「这一屏」要它的标签来截（标签不在前面截不了时只发字）
 */
async function sendWithPage(pdf: string, q: Queued) {
  if (/\.pdf$/i.test(pdf)) {
    try {
      const c = await cropOf(pdf, q.page!)
      update(pdf, () => ({ pending: { page: q.page!, url: c.url, png: c.png, w: c.cssW, direct: true } }))
    } catch {
      // PDF 已经关了、还没打开：只发字，不丢这一问
    }
    return send(pdf, q.text, q.pasted, q.mats ? { mats: q.mats } : {})
  }
  const ask = new CustomEvent<{ src: string; text: string; taken?: boolean }>(ASK_PAGE, { detail: { src: pdf, text: q.text } })
  window.dispatchEvent(ask)
  if (!ask.detail.taken) return send(pdf, q.text, q.pasted, q.mats ? { mats: q.mats } : {})
}

async function ask(pdf: string, aiId: number, p: Pending | null, text: string, pasted: string[], mats: Material[]) {
  const r = get(pdf)
  const now = Date.now()
  // 谁来答、模型、effort：这份 PDF 的对话选的（没选过用「AI 对话」那一行），回答头上写全
  const { pick, by, req } = await pickNow(pdf)
  const engine = pick.engine
  // 材料里的图和粘贴的图一样附上（按顺序，排在框的那块后面）
  const images = [...pasted, ...imageNames(mats).filter((n) => !pasted.includes(n))]
  let thread: ReadingThread | undefined
  let image: string | undefined
  /** 贴截图问的这一问怎么定的页（回答头上「看的是第 3 页（按截图认出）」） */
  let how: ReadingThread['found']
  if (p) {
    const id = await window.cnReading.newThread(pdf, p.page)
    if (p.image) image = p.image
    // 网页上框着问、「记笔记」关着（Where「这次只问，不记」也是关它）：截图不进库（不会写进哪篇，进库就成了没人用的附件），当粘贴的图附上
    else if (p.png && isWebSrc(pdf) && !noteSwitchNow(kindOf(pdf, p)).main) {
      const name = await window.cn.aiPaste(p.png, 'image/png')
      images.unshift(name)
      pasted = [name, ...pasted]
    } else if (p.png) image = await window.cnReading.saveCrop(pdf, p.page, p.png)
    else if (!p.quote && !p.web && p.page > 0 && /\.pdf$/i.test(pdf) && pdfDoc(pdf)) {
      // 框的这块截图还没好就发了（工具条上的按钮等了 5 秒、排着的那一问）：这里照框重新截一次，笔记里这一处照样有图（task-yp8l7）
      try {
        const c = await cropOf(pdf, p.page, p.rect)
        URL.revokeObjectURL(c.url)
        image = await window.cnReading.saveCrop(pdf, p.page, c.png)
        p = { ...p, w: c.cssW }
      } catch (e) {
        console.error('框的这块没截成', e)
      }
    }
    // 视频「接着问」附的那一帧文档里那块问答已经有了，笔记里不再放一遍
    thread = { id, page: p.page, ...(p.rect ? { rect: p.rect } : {}), ...(p.quote ? { quote: p.quote } : {}), ...(image && !p.image ? { crop: image, ...(p.w ? { cropW: p.w } : {}) } : {}), ...(p.web ? { web: p.web } : {}), createdAt: now, ...(p.cmd ? { cmd: p.cmd } : {}), ...(p.noNote ? { noNote: true as const } : {}) }
    // 网页那边的框和工具条收起来
    if (p.web && /^https?:/i.test(p.web.url)) clearWebBox(webHost()?.view() ?? null)
  } else {
    thread = r.state.threads.find((t) => t.id === r.activeThread)
    // 没框没选、贴了截图（粘贴、拖进来的）问（0.5.9）：认截图里的字定是哪一页，和上一处同一页才接着问，不然新开一处
    const shot = /\.pdf$/i.test(pdf) ? shotOf(mats) : undefined
    if (shot) {
      const at = await placeShot(pdf, shot, r.state.page)
      how = at.found
      if (!thread || at.found === 'none' || thread.page !== at.page || thread.web) thread = { id: await window.cnReading.newThread(pdf, at.page), page: at.page, ...(at.rect ? { rect: at.rect } : {}), createdAt: now, found: at.found }
    }
    if (!thread) {
      const page = r.state.page
      thread = { id: await window.cnReading.newThread(pdf, page), page, createdAt: now }
    }
  }
  const th = thread
  // 视频问框带过来的那一处（adoptVideoQa）：在这里第一次问 AI 时附上框的那一帧（之后接着这个会话，不再附）
  const carried = !p && th.web?.t !== undefined && th.crop && !r.state.msgs.some((m) => m.thread === th.id && m.role === 'ai' && m.engine) ? th.crop : undefined
  // 记不记按发问那一刻的「记笔记」开关算（关掉后再答完的这一问也不记）
  const noNote = !noteSwitchNow(kindOf(pdf, th)).main
  const userMsg: ReadingMsg = {
    id: nextSeq(),
    role: 'user',
    thread: th.id,
    text: text.trim(),
    time: now,
    page: th.page,
    ...(noNote ? { noNote: true as const } : {}),
    ...(image ? { image } : {}),
    ...(pasted.length ? { pasted } : {}),
    ...(mats.length ? { mats } : {}),
  }
  const aiMsg: ReadingMsg = { id: aiId, role: 'ai', thread: th.id, text: '', time: now, page: th.page, engine, read: readOf(th, '', [], how), by }
  update(pdf, (x) => ({
    activeThread: th.id,
    state: { ...x.state, threads: x.state.threads.some((t) => t.id === th.id) ? x.state.threads : [...x.state.threads, th], msgs: [...x.state.msgs, userMsg, aiMsg] },
  }))
  save(pdf)
  const blocks = isWebSrc(pdf) ? [] : /\.html?$/i.test(pdf) ? (get(pdf).blocks[1] ?? []) : th.page > 0 ? await blocksOf(pdf, th.page) : []
  // 公式（2026-11-24）：文字层里公式是拆散的，这一页（或问到编号的那一页）有公式时照版面框截下公式那几块带给 AI（规则在 formula-crops.ts）；
  // 这一家看不了图：照旧只给字，回答头上写明
  let formulas: FormulaCrop[] = []
  let formulaRead = ''
  if (/\.pdf$/i.test(pdf) && !image && !carried && th.page > 0) {
    try {
      const first = !r.state.msgs.some((m) => m.thread === th.id && m.role === 'user')
      const picks = await formulaPicks(pdf, th.page, text, first)
      if (picks.length && canSeeImages(engine)) {
        formulas = await formulaCrops(pdf, picks)
        formulaRead = ' · 看了公式图'
      } else if (picks.length) formulaRead = ' · 公式只读了字'
    } catch (e) {
      console.error('公式那几块没截成', e)
    }
  }
  const res = await window.cnReading.ask({
    id: aiId,
    pdf,
    hash: get(pdf).hash,
    engine,
    thread: th,
    text: text.trim(),
    images: image ? [image] : carried ? [carried] : [],
    ...(images.length ? { pasted: images } : {}),
    pageText: blocksText(blocks),
    pages: get(pdf).pages,
    ...req,
    // 引用的材料（多段引用方向 B）：主进程交给引擎时照旧是 ①②、后面按同一套编号列出每块；后面记笔记也用它
    ...(mats.length ? { mats } : {}),
    ...(formulas.length ? { formulas } : {}),
  })
  const full = res.text || get(pdf).state.msgs.find((m) => m.id === aiId)?.text || ''
  const { text: answer, viz, pre } = withoutVizMark(full)
  patchMsg(pdf, aiId, {
    text: answer,
    ...(pre ? { pre: true as const } : {}),
    read: readOf(th, answer, get(pdf).note.sections, how) + formulaRead,
    ...(viz && !res.error ? { vizOk: true } : {}),
    ...(res.error ? { error: res.error } : {}),
    ...changeOf(res),
  })
  if (res.commit || res.failed) window.dispatchEvent(new CustomEvent(AI_CHANGED))
  if (res.error || !res.text.trim()) return
  // 选中小条上那颗选了「只在 AI 栏答」（task-26nz7）、发问时「记笔记」关着：答在这里，不写进笔记
  if (th.noNote || noNote) return
  void noteAsk(pdf, aiId)
}

/** AI 这一问动手改了库里的文件（2026-11-19）：界面刷新左栏、底栏（App 听这个） */
export const AI_CHANGED = 'cn:reading-ai-changed'

/**
 * 记进了笔记（工作区方向 A，原型 proto-a）：底栏说一句记到了哪（App 听这个，笔记标签没露出来时带「在笔记里看」）。
 * quote：旁支答完的（「在笔记里看」滚到那条旁支）；没有是主对话那一问
 */
export const NOTED = 'cn:reading-noted'
export interface Noted {
  pdf: string
  thread: string
  text: string
  quote?: string
}
function told(pdf: string, th: ReadingThread, side?: { quote: string; ask?: string }) {
  const at = th.page > 0 ? `第${th.page}页` : th.found === 'none' ? `「${UNPLACED}」` : ''
  const under = at + (side?.ask ? `「${side.ask.replace(/\s+/g, ' ').trim().slice(0, 10)}」` : '')
  const text = side ? (under ? `旁支也记进了笔记，挂在${under}下面` : '旁支也记进了笔记') : `记进《${titleOf(get(pdf).note.path)}》${at}`
  window.dispatchEvent(new CustomEvent<Noted>(NOTED, { detail: { pdf, thread: th.id, text, ...(side ? { quote: side.quote } : {}) } }))
}

/** 这一问的提交（「改了 N 个文件 · 撤回」）或没提交上的那句 */
function changeOf(res: AskResult): Partial<ReadingMsg> {
  if (res.commit) return { change: { commit: res.commit, kinds: res.kinds ?? {}, ...(res.moved ? { moved: res.moved } : {}) } }
  if (res.failed) return { warn: `改好了，提交没成功：${res.failed.failed}` }
  return {}
}

/** 撤回这一问 AI 的改动（反向提交）；撤回好了记在那条消息上 */
export async function revertChange(pdf: string, id: number, side?: string) {
  const r = get(pdf)
  const m = side ? sidesOf(r).find((s) => s.id === side)?.msgs.find((x) => x.id === id) : r.state.msgs.find((x) => x.id === id)
  const c = m?.change
  if (!c || c.reverted) return
  const back = await window.cn.aiRevert(c.commit.hash)
  if (!back) return
  if (side) patchSideMsg(pdf, side, id, () => ({ change: { ...c, reverted: back } }))
  else patchMsg(pdf, id, { change: { ...c, reverted: back } })
  window.dispatchEvent(new CustomEvent(AI_CHANGED))
}

/** 边生成边显示：主进程一小段一小段给字（主对话的，或者旁支的） */
export function onAskText(id: number, delta: string) {
  for (const [pdf, r] of docs) {
    if (r.running === id) update(pdf, (x) => ({ state: { ...x.state, msgs: x.state.msgs.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)) } }))
    const side = Object.entries(r.sideRunning).find(([, v]) => v === id)?.[0]
    if (side) patchSideMsg(pdf, side, id, (m) => ({ text: m.text + delta }), false)
  }
}

/** 边做边显示动手的每一步（在做转圈、做完绿勾，同 AI 对话）：同一步做完换掉在做的那行 */
export function onAskStep(id: number, step: ToolStep) {
  const put = (m: ReadingMsg): ReadingMsg => {
    const steps = [...(m.steps ?? [])]
    const i = steps.findIndex((s) => s.id === step.id)
    if (i === -1) steps.push(step)
    // 读过的文件（task-3e53q）：开始和做完各报一次，有一次报了就留着
    else steps[i] = step.paths || !steps[i]!.paths ? step : { ...step, paths: steps[i]!.paths }
    return { ...m, steps }
  }
  for (const [pdf, r] of docs) {
    if (r.running === id) update(pdf, (x) => ({ state: { ...x.state, msgs: x.state.msgs.map((m) => (m.id === id ? put(m) : m)) } }))
    const side = Object.entries(r.sideRunning).find(([, v]) => v === id)?.[0]
    if (side) patchSideMsg(pdf, side, id, (m) => put(m), false)
  }
}

// ---------- 旁支（CN-90 方向 A「照 Dispatch 旁支」） ----------

const sidesOf = (r: Reading) => r.state.sides ?? []
const setSides = (pdf: string, f: (sides: ReadingSide[]) => ReadingSide[]) => update(pdf, (r) => ({ state: { ...r.state, sides: f(sidesOf(r)) } }))

/** 旁支里的一条消息改一下（边答边显示时不存盘，答完存） */
function patchSideMsg(pdf: string, side: string, id: number, p: (m: ReadingMsg) => Partial<ReadingMsg>, store = true) {
  setSides(pdf, (all) => all.map((s) => (s.id === side ? { ...s, msgs: s.msgs.map((m) => (m.id === id ? { ...m, ...p(m) } : m)) } : s)))
  if (store) save(pdf)
}

/** 旁支的名字：改过的；没改过用问的第一句（空着问的「讲讲这句」不算），再没有用那一句的头 8 个字；还没问过是「新旁支」 */
export const sideName = (s: ReadingSide): string => nameOf(s)

/** 旁支问了几问 */
export const sideAsks = (s: ReadingSide) => s.msgs.filter((m) => m.role === 'user').length

/**
 * 一处的旁支按笔记里的顺序排（小标上的数字）：先按被问的那条回答在主对话里的先后，同一条回答里按开的先后。
 * 笔记里旁支挂在被问那一问后面，数字和笔记里一样
 */
export function sidesInOrder(r: Reading, thread: string): ReadingSide[] {
  const at = (s: ReadingSide) => r.state.msgs.findIndex((m) => m.id === s.msg)
  return sidesOf(r)
    .filter((s) => s.thread === thread)
    .sort((a, b) => at(a) - at(b) || a.createdAt - b.createdAt)
}

/** 没问过的空旁支不留（keep 那条除外：刚开、光标在它的输入框里） */
const dropEmpty = (all: ReadingSide[], keep: string | null) => all.filter((s) => s.msgs.length || s.id === keep)

/**
 * 在主对话的回答里选中一句开一条旁支：就在那一段下面长出来、光标在它的输入框里；question 给了（小框里先打了问题）直接问。
 * 一次只开一条：别的那条收起（没问过的空旁支不留）
 */
export function openSide(pdf: string, at: { msg: number; quote: string }, question?: string, mats?: Material[]): string | undefined {
  const r = get(pdf)
  const msg = r.state.msgs.find((m) => m.id === at.msg)
  if (!msg) return undefined
  const side: ReadingSide = { id: `side-${nextSeq().toString(36)}`, thread: msg.thread, msg: at.msg, quote: at.quote.replace(/\s+/g, ' ').trim(), msgs: [], createdAt: Date.now() }
  update(pdf, (x) => ({ state: { ...x.state, sides: [...dropEmpty(sidesOf(x), null), side] }, side: { open: side.id, flash: null } }))
  save(pdf)
  wantSideFocus = true
  if (question?.trim() || mats?.length) void sendSide(pdf, side.id, question ?? '', mats ?? [])
  return side.id
}

/** 头上「+」：同一句再开一条（空的，光标在它的输入框里） */
export function newSideOn(pdf: string, id: string): string | undefined {
  const s = sidesOf(get(pdf)).find((x) => x.id === id)
  return s ? openSide(pdf, { msg: s.msg, quote: s.quote }) : undefined
}

/** 切到一条旁支（小标、小签、⋯ 里点一条）；null 是收起（那句闪一下）。切走时没问过的空旁支不留 */
export function showSide(pdf: string, id: string | null) {
  const was = get(pdf).side.open
  update(pdf, (x) => ({ state: { ...x.state, sides: dropEmpty(sidesOf(x), id) }, side: { open: id, flash: !id && was ? { side: was, seq: nextSeq() } : null } }))
  save(pdf)
  if (id) wantSideFocus = true
}

export const closeSide = (pdf: string) => showSide(pdf, null)

export function renameSide(pdf: string, id: string, name: string) {
  setSides(pdf, (all) => all.map((s) => (s.id === id ? { ...s, name: name.trim() || undefined } : s)))
  save(pdf)
}

/** 删掉一条旁支：对话记录里拿掉；已经记进笔记的照旧留着（撤回在记进去的那一行、⋯ 里） */
export function deleteSide(pdf: string, id: string) {
  const side = sidesOf(get(pdf)).find((s) => s.id === id)
  if (!side) return
  const running = get(pdf).sideRunning[id]
  if (running !== undefined) void window.cnReading.stop(running)
  update(pdf, (x) => ({ state: { ...x.state, sides: sidesOf(x).filter((s) => s.id !== id) }, side: x.side.open === id ? { open: null, flash: null } : x.side }))
  save(pdf)
}

/** 「在笔记里看」、笔记里点小标：笔记滚到那条旁支 */
export function focusSide(pdf: string, thread: string, quote: string) {
  update(pdf, () => ({ sideFocus: { thread, quote, seq: nextSeq() }, fresh: false }))
}

/** 打开旁支以后光标进旁支的输入框（选中一句点「问这句」、点小标、小签、⋯ 里切过去） */
let wantSideFocus = false
export function takeSideFocus(): boolean {
  const w = wantSideFocus
  wantSideFocus = false
  return w
}

/** 那一轮的问答原文：分叉不了的时候（Gemini、OpenCode，或者那一轮在「新对话」之前）放在旁支第一问前面 */
function roundHistory(r: Reading, side: ReadingSide): string {
  const th = r.state.threads.find((t) => t.id === side.thread)
  const msgs = r.state.msgs.filter((m) => m.thread === side.thread && m.text.trim() && !m.error)
  return `【那一轮】${th && th.page > 0 ? `第 ${th.page} 页` : ''}\n${msgs.map((m) => `${m.role === 'user' ? '他问' : '你答'}：${withoutVizMark(m.text).text.slice(0, 3000)}`).join('\n')}`
}

/** 旁支里问一句：空着就是「讲讲这句」。旁支不往主对话里加东西；答完记进笔记（挂在被问那一问的回答后面） */
export async function sendSide(pdf: string, id: string, text: string, mats: Material[] = []) {
  const r = get(pdf)
  const side = sidesOf(r).find((s) => s.id === id)
  if (!side || r.sideRunning[id] !== undefined) return
  const th = r.state.threads.find((t) => t.id === side.thread)
  if (!th) return
  // 空着发：还没问过就是「讲讲这句」，问过以后不发
  const q = text.trim() || (side.msgs.some((m) => m.role === 'user') ? '' : ASK_THIS)
  if (!q) return
  const now = Date.now()
  const { pick, by, req } = await pickNow(pdf)
  const aiId = nextSeq()
  // 记不记按发问那一刻算：这条旁支单拨过（框头的小标签）照它，没拨过跟「旁支」开关
  const noNote = !(side.note ?? noteSwitchNow(kindOf(pdf, th)).side)
  const user: ReadingMsg = { id: nextSeq(), role: 'user', thread: th.id, text: q, time: now, ...(mats.length ? { mats } : {}), ...(noNote ? { noNote: true as const } : {}) }
  const ai: ReadingMsg = { id: aiId, role: 'ai', thread: th.id, text: '', time: now, engine: pick.engine, by }
  setSides(pdf, (all) => all.map((s) => (s.id === id ? { ...s, msgs: [...s.msgs, user, ai] } : s)))
  update(pdf, (x) => ({ sideRunning: { ...x.sideRunning, [id]: aiId } }))
  save(pdf)
  const cur = get(pdf)
  const parent = cur.state.msgs.findIndex((m) => m.id === side.msg)
  const ask = cur.state.msgs
    .slice(0, parent < 0 ? 0 : parent)
    .reverse()
    .find((m) => m.role === 'user' && m.thread === th.id)?.text
  const title = cur.note.sections.find((s) => s.id === th.id)?.title
  const parentTime = cur.state.msgs[parent]?.time ?? 0
  const images = imageNames(mats)
  let res: AskResult
  try {
    res = await window.cnReading.ask({
      id: aiId,
      pdf,
      hash: cur.hash,
      engine: pick.engine,
      thread: th,
      text: q,
      images: [],
      ...(images.length ? { pasted: images } : {}),
      pageText: '',
      pages: cur.pages,
      ...req,
      side: { id, history: roundHistory(cur, side), quote: side.quote, ...(ask ? { ask } : {}), ...(title ? { title } : {}), ...(cur.state.newChatAt && parentTime < cur.state.newChatAt ? { fresh: true } : {}) },
      ...(mats.length ? { mats } : {}),
    })
  } catch (e) {
    res = { text: '', error: noteErr(e) }
  }
  const sofar = sidesOf(get(pdf)).find((s) => s.id === id)?.msgs.find((m) => m.id === aiId)?.text ?? ''
  const { text: full, pre } = withoutVizMark(res.text || sofar)
  patchSideMsg(pdf, id, aiId, () => ({ text: full, ...(pre ? { pre: true as const } : {}), ...(res.error ? { error: res.error } : {}), ...changeOf(res) }))
  if (res.commit || res.failed) window.dispatchEvent(new CustomEvent(AI_CHANGED))
  update(pdf, (x) => {
    const { [id]: _done, ...rest } = x.sideRunning
    void _done
    return { sideRunning: rest }
  })
  // 记进笔记（挂在被问那一问的回答后面）：发问时开着、这一处不是「只在 AI 栏答」的
  if (!res.error && full.trim() && !noNote && !th.noNote) void noteAsk(pdf, aiId, id)
}

/** 旁支框头的小标签「记进笔记 / 不记」：只管这一条旁支以后问的；拨成记进时这条旁支前面答好、没记的补进去 */
export async function setSideNote(pdf: string, id: string, on: boolean) {
  setSides(pdf, (all) => all.map((s) => (s.id === id ? { ...s, note: on } : s)))
  save(pdf)
  const side = sidesOf(get(pdf)).find((s) => s.id === id)
  if (!on || !side) return
  for (const m of side.msgs) if (m.role === 'ai' && m.text.trim() && !m.error && !m.note && get(pdf).sideRunning[id] !== m.id) await noteAsk(pdf, m.id, id)
}

/** 停下旁支正在答的那一问 */
export function stopSide(pdf: string, id: string) {
  const ai = get(pdf).sideRunning[id]
  if (ai !== undefined) void window.cnReading.stop(ai)
}

/**
 * 旧记录（没有 older）：以前「+」只在同一段里插一条「新对话」分隔线，newChatAt 之前的问答（连它们开的旁支）挪成以前的一段；
 * 旁支跟着它所在的那条回答走
 */
function splitLegacy(s: ReadingState): { msgs: ReadingMsg[]; sides: ReadingSide[]; older: ReadingChat[] } {
  const sides = s.sides ?? []
  if (s.older) return { msgs: s.msgs, sides, older: s.older }
  const at = s.newChatAt
  const before = at ? s.msgs.filter((m) => m.time < at) : []
  if (!at || !before.length) return { msgs: s.msgs, sides, older: [] }
  const ids = new Set(before.map((m) => m.id))
  return { msgs: s.msgs.filter((m) => m.time >= at), sides: sides.filter((x) => !ids.has(x.msg)), older: [{ id: at, msgs: before, sides: sides.filter((x) => ids.has(x.msg)) }] }
}

/** 现在这段问过就收进「之前的对话」（新的在后）；空的不收 */
function shelve(s: ReadingState): ReadingChat[] {
  const older = s.older ?? []
  return s.msgs.length ? [...older, { id: Date.now(), msgs: s.msgs, ...(s.sides?.length ? { sides: s.sides } : {}), ...(s.pick ? { pick: s.pick } : {}) }] : older
}

/** 有一问正在答（主对话或旁支）：这时不换段（回答会写进看不见的那段） */
export const busy = (r: Reading) => r.running !== null || Object.keys(r.sideRunning).length > 0

/**
 * 新对话（和 AI 对话那边的「+」一样是一段空的）：现在这段收进头上对话菜单「之前的对话」，点了能切回；
 * AI 换一个新会话（重新读全文），选的模型和 effort 回到「AI 对话」那一行。问过的地方（PDF 上的框）、配对笔记都不动
 */
export async function newChat(pdf: string) {
  if (busy(get(pdf))) return
  await window.cnReading.forget(pdf)
  update(pdf, (r) => {
    const { pick: _pick, ...state } = r.state
    void _pick
    return { activeThread: null, side: { open: null, flash: null }, convo: null, state: { ...state, msgs: [], sides: [], older: shelve(r.state), newChatAt: Date.now() } }
  })
  save(pdf)
}

/**
 * 切回以前的一段（对话菜单「之前的对话」里点的）：现在这段问过就收起来，那段放回来接着问。
 * AI 开新会话，主进程按对话记录补上那段最近几轮；那段里开旁支不从主会话分叉（newChatAt 记成现在）
 */
export async function switchChat(pdf: string, id: number): Promise<boolean> {
  const r = get(pdf)
  const pick = r.state.older?.find((c) => c.id === id)
  if (!pick || busy(r)) return false
  await window.cnReading.forget(pdf)
  update(pdf, (x) => {
    const { pick: _pick, ...state } = x.state
    void _pick
    const last = [...pick.msgs].reverse().find((m) => m.role === 'user')
    const older = shelve(x.state).filter((c) => c.id !== id)
    return { activeThread: last?.thread ?? null, side: { open: null, flash: null }, convo: null, state: { ...state, msgs: pick.msgs, sides: pick.sides ?? [], ...(pick.pick ? { pick: pick.pick } : {}), older, newChatAt: Date.now() } }
  })
  save(pdf)
  await syncNoted(pdf).catch((e: unknown) => console.error('认记过的问没认成', e))
  return true
}

/** 收起来的那几段里有这条消息（现在这段里没有）的那段，新的先找：笔记里「回到 AI 对话」「完整对话」点回来时切过去 */
export function olderWith(pdf: string, f: (m: ReadingMsg) => boolean): number | null {
  const s = get(pdf).state
  if (s.msgs.some(f)) return null
  return [...(s.older ?? [])].reverse().find((c) => c.msgs.some(f))?.id ?? null
}

/** 停下 = 全停：正在答的停掉，排着的那一问也不发（框的那块留在待问区，字还回输入框） */
export function stop(pdf: string) {
  const id = get(pdf).running
  update(pdf, dropQueue)
  if (id !== null) void window.cnReading.stop(id)
}

/**
 * 回答上面那一行：读了第几页；网页上问的「读了网页这一段」（中间开着 PDF 时「· 对上第 5 页」）；
 * 贴截图问的（how）：「看的是第 3 页（按截图认出）」「看的是第 3 页（你正看着的这页）」「没认出截图是哪一页」
 */
function readOf(th: ReadingThread, answer: string, sections: AskSection[] = [], how?: ReadingThread['found']): string {
  if (th.web?.t !== undefined) return `接着${fmtTime(th.web.t)}那一问`
  if (th.web && /^https?:/i.test(th.web.url)) return `读了网页这一段${th.page > 0 ? ` · 对上第${th.page}页` : ''}`
  if (th.web) return `看了框的这一块`
  if (how === 'none') return '没认出截图是哪一页'
  const line = answer ? readLine(th.page, answer, sections) : `读了第${th.page}页`
  if (how === 'ocr') return line.replace(/^读了第\d+页/, `看的是第${th.page}页（按截图认出）`)
  if (how === 'view') return line.replace(/^读了第\d+页/, `看的是第${th.page}页（你正看着的）`)
  return line
}

// ---------- 贴截图问的定在哪一页（0.5.9，shared/locate.ts） ----------

/** 材料里贴进来的截图（粘贴、拖进来的，不知道哪一页的）：第一张 */
function shotOf(mats: Material[]): string | undefined {
  return mats.find((m): m is Extract<Material, { kind: 'image' }> => m.kind === 'image' && !m.page && PASTED_NAME.test(m.name))?.name
}

/**
 * 截图是哪一页：① 认图里的字去 PDF 文字层里找；② 找不到、又不像别处的截图（没认出几个字：公式、图），照问的时候正看着的那页；
 * ③ 认出的字一半以上这份 PDF 里没有（别处的截图）、中间没开着这份 PDF：没定位（page 0）
 */
async function placeShot(pdf: string, name: string, viewing: number): Promise<{ page: number; rect?: Rect; found: NonNullable<ReadingThread['found']> }> {
  const r = get(pdf)
  const text = await window.cnReading.ocr(name).catch((e: unknown) => {
    console.error('截图认字没成', e)
    return ''
  })
  const pages = Array.from({ length: r.pages }, (_x, i) => r.blocks[i + 1] ?? [])
  const at = text.trim() ? locateShot(text, pages) : ({ page: 0, foreign: false } as const)
  const doc = pdfDoc(pdf)
  if (at.page > 0) {
    let rect: Rect | undefined
    if ('blocks' in at && doc) {
      const size = await pageText(doc, at.page).catch(() => null)
      if (size) rect = blocksRect(at.blocks, { w: size.width, h: size.height })
    }
    return { page: at.page, ...(rect ? { rect } : {}), found: 'ocr' }
  }
  if (!('foreign' in at && at.foreign) && doc && viewing > 0) return { page: viewing, found: 'view' }
  return { page: 0, found: 'none' }
}

/**
 * 「放到第 N 页」（没定位、照正看着的那页定的那一问）：这一处挪到第 page 页；记进笔记了的从原来那节拿掉、记进第 page 页那一节
 */
export async function moveAsk(pdf: string, aiId: number, page: number) {
  const r = get(pdf)
  const ai = r.state.msgs.find((m) => m.id === aiId)
  const th = ai && r.state.threads.find((t) => t.id === ai.thread)
  if (!ai || !th || page < 1 || th.page === page) return
  // 这一处记进笔记的每一问都挪（按顺序拿掉、再按顺序记）
  const noted = r.state.msgs.filter((m) => m.thread === th.id && m.role === 'ai' && m.notePath).map((m) => m.id)
  for (const id of noted) await unnoteAsk(pdf, id)
  const { rect: _r, ...rest } = th
  void _r
  update(pdf, (x) => ({
    state: {
      ...x.state,
      // 挪过来的（moved）：笔记里不写「—— 第 N 页」来源行，截图不是从这一页截的
      threads: x.state.threads.map((t) => (t.id === th.id ? { ...rest, page, found: 'moved' as const } : t)),
      msgs: x.state.msgs.map((m) => (m.thread === th.id ? { ...m, page } : m)),
    },
  }))
  save(pdf)
  for (const id of noted) await noteAsk(pdf, id)
}

// ---------- 记进笔记（2026-11-24 新写法，shared/ai-note.ts） ----------

/** 一条消息（主对话的，或旁支里的）记笔记那几样改一下 */
function patchNote(pdf: string, id: number, side: string | undefined, p: Partial<ReadingMsg>) {
  if (side) patchSideMsg(pdf, side, id, () => p)
  else patchMsg(pdf, id, p)
}

/** 这一问记进笔记时的二级标题：PDF「第 28 页 · 那页第一行大字」（取不到只写页码），HTML 是文件名，网页是网页标题，视频是视频名 */
async function headingOf(src: string, th: ReadingThread): Promise<string> {
  if (th.web?.t !== undefined) return th.web.title
  // 网页标题去掉站名那一截（「2.2. 数据预处理 — 动手学深度学习」写「2.2. 数据预处理」）
  if (isWebSrc(src)) return pageHead(th.web?.title || get(src).webTitle, th.web?.url ?? src.slice(4))
  // 贴截图问的、没认出是哪一页：记进「没定位的问答」一节（回答下面「放到第 N 页」挪走）。不翻：写进文件的字
  if (/\.pdf$/i.test(src) && th.page < 1 && th.found === 'none') return UNPLACED
  if (!/\.pdf$/i.test(src) || th.page < 1) return (src.split('/').pop() ?? src).replace(/\.[^.]+$/, '')
  const doc = pdfDoc(src)
  const title = doc ? pageTitle(await pageText(doc, th.page).catch(() => null)) : ''
  // 不翻：写进文件的字（和旧写法的「第 N 页」一样）
  return `第 ${th.page} 页${title ? ` · ${title}` : ''}`
}

/**
 * 读 PDF 时不挂在论文任何一处的一问（前置知识标签）：没框没选、没引原文，贴的截图也没认出是哪一页（只照正看着的那页、或没定位）。
 * 这种一问 AI 标了前置知识时记进笔记末尾「## 前置知识」一节；挂在某处的照旧记在那一页、带标签
 */
function looseOf(src: string, th: ReadingThread): boolean {
  if (!/\.pdf$/i.test(src) || th.rect || th.quote?.trim() || th.crop || th.web) return false
  return th.found === undefined || th.found === 'view' || th.found === 'none'
}

/** 来源行：网页回那一段、视频回那一秒（PDF、库里的 HTML 主进程照那一页那一块写） */
function fromOf(src: string, th: ReadingThread): { label: string; url: string } | undefined {
  const w = th.web
  if (!w || !/^https?:/i.test(w.url)) return undefined
  if (w.t !== undefined) {
    const v = videoOf(w.url)
    return { label: `▶ ${fmtTime(w.t)} · ${w.title}`, url: v ? timeUrl(v, w.t) : w.url }
  }
  const passage = th.quote ?? w.text ?? ''
  if (passage.trim()) return { label: `${backLabel({ ...(w.head ? { head: w.head } : {}), title: w.title, url: w.url })} ↩`, url: fragmentUrl(w.url, passage) }
  return { label: `${pageHead(w.title, w.url)} ↩`, url: w.url }
}

/**
 * 记一问进笔记（答完、补进去、⋯「记进《…》」、旁支标签拨成记进）：aiId 是那条回答（side：旁支编号，aiId 是旁支里那条）。
 * 记在那条回答上：在记 → 记进了哪篇（notePath）/ 没记成；同一条记过不再写（主进程认）。记好底栏说一句（PDF）
 */
export async function noteAsk(pdf: string, aiId: number, sideId?: string): Promise<void> {
  const r = get(pdf)
  const side = sideId ? sidesOf(r).find((s) => s.id === sideId) : undefined
  const msgs = side ? side.msgs : r.state.msgs
  const i = msgs.findIndex((m) => m.id === aiId)
  const ai = msgs[i]
  const user = msgs[i - 1]
  if (!ai || ai.role !== 'ai' || user?.role !== 'user' || !ai.text.trim() || ai.error || ai.note === 'writing') return
  const th = r.state.threads.find((t) => t.id === (side?.thread ?? ai.thread))
  if (!th) return
  patchNote(pdf, aiId, sideId, { note: 'writing', noteError: undefined })
  try {
    const tg = await noteTarget(pdf, th)
    if (!tg) {
      // 还没定记进哪篇、选了只问不记：这一问不记
      patchNote(pdf, aiId, sideId, { note: undefined })
      return
    }
    // 旁支：它那一问的原话（在笔记里写「在「…」的回答里」）
    const at = side ? r.state.msgs.findIndex((m) => m.id === side.msg) : -1
    const parent = side && at > 0 && r.state.msgs[at - 1]?.role === 'user' ? r.state.msgs[at - 1]!.text : undefined
    const from = side ? undefined : fromOf(pdf, th)
    // 选中小条上自己加的那颗问的（task-26nz7）：这一处的第一问标题写那颗的名字，不写一长段提示词
    const firstCmd = !side && th.cmd && !r.state.msgs.some((m) => m.thread === th.id && m.role === 'user' && m.time < user.time)
    const res = await window.cnReading.noteAsk({
      src: pdf,
      note: tg.note,
      key: readKey(pdf),
      thread: th,
      user: firstCmd ? { ...user, text: th.cmd!, mats: [] } : user,
      ai,
      // 同一条旁支接着问的不再引一遍那一句（笔记里接在它前一问后面，读回来归成同一条旁支）；这条旁支还没记过的照样引
      ...(side ? { side: { quote: side.msgs.some((m) => m.notePath && m.id !== aiId) ? '' : side.quote, ...(parent ? { parent } : {}), of: side.msg } } : {}),
      place: !side && ai.pre && looseOf(pdf, th) ? { heading: PREREQ } : { heading: await headingOf(pdf, th), ...(/\.pdf$/i.test(pdf) && th.page > 0 ? { page: th.page } : {}) },
      ...(from ? { from } : {}),
      ...(tg.create ? { create: tg.create } : {}),
      ...(tg.inline ? { inline: true } : {}),
      ...(/\.pdf$/i.test(pdf) && get(pdf).pages ? { pages: get(pdf).pages } : {}),
    })
    // 写进那篇本身的（网页、视频）：拼好的那几行插进去（光标处或末尾）、提交
    if (res.md !== undefined) {
      if (!parents) throw new Error('记笔记还没准备好')
      await parents.put(res.note, res.md, { files: res.files ?? [], subject: firstCmd ? th.cmd! : user.text, src: pdf })
    }
    patchNote(pdf, aiId, sideId, { note: 'done', notePath: res.note })
    if (!isWebSrc(pdf)) {
      await reloadNote(pdf)
      update(pdf, () => ({ fresh: true }))
      if (!res.had) told(pdf, th, side ? { quote: side.quote, ...(parent ? { ask: parent } : {}) } : undefined)
    }
    window.dispatchEvent(new CustomEvent(NOTE_WRITTEN, { detail: res.note }))
  } catch (e) {
    patchNote(pdf, aiId, sideId, { note: 'error', noteError: noteErr(e) })
  }
}

/** 记了一问（任何一处）：右栏网页的「笔记」那几条重读（detail 是那篇的路径） */
export const NOTE_WRITTEN = 'cn:reading-note-written'

/** 撤回、⋯「从《…》拿掉」：只拿掉写进去的那几行（主对话那一问连着它的旁支），这条回答回到没记 */
export async function unnoteAsk(pdf: string, aiId: number, sideId?: string): Promise<void> {
  const r = get(pdf)
  const msgs = sideId ? (sidesOf(r).find((s) => s.id === sideId)?.msgs ?? []) : r.state.msgs
  const m = msgs.find((x) => x.id === aiId)
  if (!m?.notePath) return
  const note = m.notePath
  await window.cnReading.noteRemove({ note, key: readKey(pdf), msg: aiId })
  patchNote(pdf, aiId, sideId, { note: undefined, notePath: undefined })
  // 主对话那一问拿掉时它的旁支一起拿掉了（removeAsk）：那几条也回到没记
  if (!sideId) for (const s of sidesOf(get(pdf)).filter((x) => x.msg === aiId)) for (const x of s.msgs) if (x.notePath === note) patchSideMsg(pdf, s.id, x.id, () => ({ note: undefined, notePath: undefined }))
  if (!isWebSrc(pdf)) await reloadNote(pdf)
  window.dispatchEvent(new CustomEvent(NOTE_WRITTEN, { detail: note }))
}

/**
 * 「已记进」照笔记里认（重开软件、笔记被改过以后），不靠内存：问主进程那几篇里记着这段对话的哪几条，
 * 记着的标成记进了那篇；以前记过、笔记里已经没有的回到没记。旧版记的（旧写法，没有 notePath）不动；在记的不动
 */
async function syncNoted(pdf: string) {
  const r = get(pdf)
  const key = readKey(pdf)
  const all = [...r.state.msgs, ...sidesOf(r).flatMap((s) => s.msgs)]
  const paths = new Set(all.flatMap((m) => (m.notePath ? [m.notePath] : [])))
  const tg = noteTargetNow(pdf)
  if (tg) paths.add(tg.note)
  const has = new Map<number, string>()
  for (const p of paths) for (const id of await window.cnReading.noteHas(p, key)) has.set(id, p)
  const fix = (m: ReadingMsg): Partial<ReadingMsg> | null => {
    if (m.role !== 'ai' || m.note === 'writing') return null
    const at = has.get(m.id)
    if (at) return m.note === 'done' && m.notePath === at ? null : { note: 'done', notePath: at, noteError: undefined }
    return m.notePath ? { note: undefined, notePath: undefined } : null
  }
  for (const m of get(pdf).state.msgs) {
    const p = fix(m)
    if (p) patchMsg(pdf, m.id, p)
  }
  for (const s of sidesOf(get(pdf)))
    for (const m of s.msgs) {
      const p = fix(m)
      if (p) patchSideMsg(pdf, s.id, m.id, () => p)
    }
}

/** 没记成的原因：主进程给的中文原样说；软件自己的错（英文的 TypeError 这些）说一句中文，原话进控制台 */
function noteErr(e: unknown): string {
  const raw = String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  if (/[\u4e00-\u9fff]/.test(raw)) return raw
  console.error('记笔记出错', e)
  return '软件出了错，这段没记进去'
}

// ---------- 做个可视化（后台做，做好挂进笔记） ----------

export async function makeViz(pdf: string, aiId: number) {
  const r = get(pdf)
  const msg = r.state.msgs.find((m) => m.id === aiId)
  const thread = msg && r.state.threads.find((t) => t.id === msg.thread)
  if (!msg || !thread) return
  patchMsg(pdf, aiId, { viz: { state: 'making' } })
  try {
    const blocks = await blocksOf(pdf, thread.page)
    const msgs = r.state.msgs.filter((m) => m.thread === thread.id && m.time <= msg.time)
    const v = await window.cnReading.viz({ pdf, engine: engineNow, thread, msgs, pageText: blocksText(blocks) })
    patchMsg(pdf, aiId, { viz: { state: 'done', path: v.path, title: v.title } })
    await reloadNote(pdf)
    update(pdf, () => ({ fresh: true }))
  } catch (e) {
    patchMsg(pdf, aiId, { viz: { state: 'error', error: noteErr(e) } })
  }
}

// ---------- 跳转 ----------

export function jumpTo(pdf: string, page: number, rect?: Rect, text?: string) {
  update(pdf, () => ({ jump: { page, ...(rect ? { rect } : {}), ...(text ? { text } : {}), seq: nextSeq() } }))
}

export function focusSection(pdf: string, id: string) {
  update(pdf, () => ({ focus: { id, seq: nextSeq() }, fresh: false }))
}

export function showConvo(pdf: string, id: string) {
  const go = () => update(pdf, () => ({ convo: { id, seq: nextSeq() } }))
  // 那一处的问答在以前收起的一段里：先切回那段
  const old = olderWith(pdf, (m) => m.thread === id)
  if (old === null) return go()
  void switchChat(pdf, old).then(go)
}

/** 补截图那一句：说出来，或者点 × 收起（null） */
export function setFilled(pdf: string, text: string | null) {
  update(pdf, () => ({ filled: text }))
}

export function seenNotes(pdf: string) {
  if (get(pdf).fresh) update(pdf, () => ({ fresh: false }))
}
