/**
 * 一份 PDF 读着时的状态，PDF 标签（中间栏）和右栏的 AI、笔记共用：
 * 对话、问过的地方、框好还没发的那块、笔记读回来的段、要跳到哪、要看笔记哪一段。
 * 存盘的部分（看到哪页、对话）交给主进程存在软件设置目录；笔记本身在库里。
 */
import { type AskSection, blocksText, CONFUSED, confusedAsk, confusedOf, DEFAULT_KINDS, type HlKind, decorativeImages, documentBlocks, type FigureBox, insideCrop, locateFigure, notePathFor, parseReadingNote, type PdfBlock, pageBlocks, type Rect, toPageRect } from '@cn/format'
import { useSyncExternalStore } from 'react'
import { setHlKindsNow } from './hl-kinds'
import type { EngineId, ToolStep } from '../../shared/agent'
import { type AiPick, convPick, pickLabel, pickReq } from '../../shared/ai-features'
import { imageNames, type Material, shiftMarks } from '../../shared/materials'
import { type AskResult, type ReadingMsg, type ReadingSide, type ReadingState, type ReadingThread, readLine, withoutVizMark } from '../../shared/reading'
import { titleOf } from '../../shared/layout'
import { fmtTime } from '../../shared/video'
import { pageText, pdfDoc, renderCrop } from './pdf'
import { webHost } from '../plugins/host'
import { centerNow } from '../video/store'
import { clearWebBox } from './web-bridge'
import { ASK_THIS, sideName as nameOf } from '../side/name'
import { backLabel } from '../../shared/web-link'

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
/** 一问答好以后一问一块写进这个网页正在剪进去的那篇（task-6cxtc）：网页那一处、不是视频问答块「接着问」那一串（带着视频时刻 t，照旧记进那块问答所在的那篇） */
const toWebNote = (src: string, web: { t?: number } | undefined) => isWebSrc(src) && web?.t === undefined
/** 这会儿发一问会不会写进网页的那篇（要先定记到哪篇）：看待问的那块，没有就看接着的那一串 */
export function sendsToWebNote(src: string): boolean {
  const r = get(src)
  return toWebNote(src, r.pending ? r.pending.web : r.state.threads.find((t) => t.id === r.activeThread)?.web)
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
  jump: { page: number; rect?: Rect; seq: number } | null
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
async function pickNow(pdf: string): Promise<{ pick: AiPick; by: string; doc: string; req: { model?: string; effort?: string } }> {
  const ai = await window.cn.aiEngines()
  const pick = convPick(ai.engines, ai.chat, get(pdf).state.pick)
  engineNow = pick.engine
  const models = ai.engines.find((e) => e.id === pick.engine)?.models
  // 写进文档的块头不带档（同视频框一块问写进文档的讲解）
  return { pick, by: pickLabel(pick, models), doc: pickLabel({ engine: pick.engine, ...(pick.model ? { model: pick.model } : {}) }, models), req: pickReq(pick) }
}

/**
 * 网页上问的（不是视频「接着问」）答完以后写进这个网页正在剪进去的那篇（task-6cxtc）：一问一块 [!ai]。
 * 写法和记到哪篇在 web-notes/flow.ts（它登记进来，免得两边互相引用）；返回记进了哪篇，没记（这次只问不记、还没定）是 null
 */
export interface WebNote {
  src: string
  thread: ReadingThread
  question: ReadingMsg
  answer: string
  by: string
}
type WebNoteWriter = (n: WebNote) => Promise<{ path: string; title: string } | null>
let webNoteWriter: WebNoteWriter | null = null
/** 这个网页选了「这次只问，不记」（问了也不写进哪篇） */
let webSkips: ((url: string) => boolean) | null = null
export const setWebNoteWriter = (w: WebNoteWriter | null, skips: ((url: string) => boolean) | null = null) => {
  webNoteWriter = w
  webSkips = skips
}

async function writeWebNote(pdf: string, th: ReadingThread, user: ReadingMsg, aiId: number, by: string) {
  if (!webNoteWriter) return
  patchMsg(pdf, aiId, { note: 'writing' })
  try {
    const answer = withoutVizMark(get(pdf).state.msgs.find((m) => m.id === aiId)?.text ?? '').text
    const r = await webNoteWriter({ src: pdf, thread: th, question: user, answer, by })
    patchMsg(pdf, aiId, r ? { note: 'done', noteTo: `《${r.title}》` } : { note: undefined })
  } catch (e) {
    patchMsg(pdf, aiId, { note: 'error', noteError: noteErr(e) })
  }
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
  const msgs = state.msgs.map(settled)
  // 旁支照旧在（CN-90）：没问过的空旁支不留
  const sides = (state.sides ?? []).filter((s) => s.msgs.length).map((s) => ({ ...s, msgs: s.msgs.map(settled) }))
  const last = [...msgs].reverse().find((m) => m.role === 'user')
  update(pdf, () => ({ loaded: true, state: { ...state, msgs, sides }, activeThread: last?.thread ?? null, note: { ...note, sections: parseReadingNote(note.text, note.path) } }))
}

export async function reloadNote(pdf: string) {
  const note = await window.cnReading.readNote(pdf)
  update(pdf, () => ({ note: { ...note, sections: parseReadingNote(note.text, note.path) } }))
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

/**
 * 记笔记用的块：去掉校徽、页眉 logo 这类小图和每页重复的图（CN-60），AI 挑配图时看不到它们；
 * 这一页挑不出图时就不放第二张图（上面已经有整页或框选的截图）
 */
async function figureBlocks(pdf: string, page: number): Promise<PdfBlock[]> {
  const blocks = await blocksOf(pdf, page)
  const doc = pdfDoc(pdf)
  if (!doc || !blocks.some((b) => b.kind === 'image')) return blocks
  const vp = (await doc.getPage(page)).getViewport({ scale: 1 })
  const drop = decorativeImages(blocks, { w: vp.width, h: vp.height }, Object.values(get(pdf).blocks))
  return blocks.filter((b) => !drop.has(b.id))
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
export async function adoptVideoQa(src: string, v: { url: string; title: string; t: number; image?: string; qa: { q: string; a: string; by: string }[] }) {
  if (!v.qa.length) return
  await load(src)
  const now = Date.now()
  const id = await window.cnReading.newThread(src, 0)
  const answer = v.qa.map((x, i) => (i ? `接着问：${x.q}\n${x.a}` : x.a)).join('\n\n')
  const th: ReadingThread = { id, page: 0, quote: v.qa[0]!.q, ...(v.image ? { crop: v.image } : {}), web: { url: v.url, title: v.title, t: v.t, answer: answer.slice(0, 4000) }, createdAt: now }
  const read = `看了 ${fmtTime(v.t)} 这一帧`
  const msgs: ReadingMsg[] = v.qa.flatMap((x, i): ReadingMsg[] => [
    { id: nextSeq(), role: 'user', thread: id, text: x.q, time: now, page: 0, ...(i === 0 && v.image ? { image: v.image } : {}) },
    { id: nextSeq(), role: 'ai', thread: id, text: x.a, time: now, page: 0, read, by: x.by },
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
  const { pick, by, doc, req } = await pickNow(pdf)
  const engine = pick.engine
  // 材料里的图和粘贴的图一样附上（按顺序，排在框的那块后面）
  const images = [...pasted, ...imageNames(mats).filter((n) => !pasted.includes(n))]
  let thread: ReadingThread | undefined
  let image: string | undefined
  if (p) {
    const id = await window.cnReading.newThread(pdf, p.page)
    if (p.image) image = p.image
    // 网页上框着问、这个网站选了「这次只问，不记」（task-6cxtc）：截图不进库（不会写进哪篇，进库就成了没人用的附件），当粘贴的图附上
    else if (p.png && isWebSrc(pdf) && webSkips?.(p.web?.url ?? pdf.slice(4))) {
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
    if (!thread) {
      const page = r.state.page
      thread = { id: await window.cnReading.newThread(pdf, page), page, createdAt: now }
    }
  }
  const th = thread
  // 视频问框带过来的那一处（adoptVideoQa）：在这里第一次问 AI 时附上框的那一帧（之后接着这个会话，不再附）
  const carried = !p && th.web?.t !== undefined && th.crop && !r.state.msgs.some((m) => m.thread === th.id && m.role === 'ai' && m.engine) ? th.crop : undefined
  const userMsg: ReadingMsg = {
    id: nextSeq(),
    role: 'user',
    thread: th.id,
    text: text.trim(),
    time: now,
    page: th.page,
    ...(image ? { image } : {}),
    ...(pasted.length ? { pasted } : {}),
    ...(mats.length ? { mats } : {}),
  }
  const aiMsg: ReadingMsg = { id: aiId, role: 'ai', thread: th.id, text: '', time: now, page: th.page, engine, read: readOf(th, ''), by }
  update(pdf, (x) => ({
    activeThread: th.id,
    state: { ...x.state, threads: x.state.threads.some((t) => t.id === th.id) ? x.state.threads : [...x.state.threads, th], msgs: [...x.state.msgs, userMsg, aiMsg] },
  }))
  save(pdf)
  const blocks = isWebSrc(pdf) ? [] : /\.html?$/i.test(pdf) ? (get(pdf).blocks[1] ?? []) : await blocksOf(pdf, th.page)
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
  })
  const full = res.text || get(pdf).state.msgs.find((m) => m.id === aiId)?.text || ''
  const { text: answer, viz, figure } = withoutVizMark(full)
  // 配图的框：附的是框的那块就换成整页上的比例（附的是整页就原样）
  const fig = figure && image && !isWebSrc(pdf) ? { rect: toPageRect(figure.rect, th.rect), caption: figure.caption } : null
  patchMsg(pdf, aiId, {
    text: answer,
    read: readOf(th, answer, get(pdf).note.sections),
    ...(viz && !res.error ? { vizOk: true } : {}),
    ...(fig ? { fig } : {}),
    ...(res.error ? { error: res.error } : {}),
    ...changeOf(res),
  })
  if (res.commit || res.failed) window.dispatchEvent(new CustomEvent(AI_CHANGED))
  if (res.error || !res.text.trim()) return
  // 选中小条上那颗选了「只在 AI 栏答」（task-26nz7）：答在这里，不写进笔记
  if (th.noNote) return
  // 网页上问的（中间没开 PDF、HTML）：一问一块写进这个网页正在剪进去的那篇（task-6cxtc）；视频问答块「接着问」照旧
  if (toWebNote(pdf, th.web)) void writeWebNote(pdf, th, userMsg, aiId, doc)
  else void writeNote(pdf, th.id, aiId, engine)
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
  const at = th.page > 0 ? `第${th.page}页` : ''
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

/** 删掉一条旁支：对话记录里拿掉，笔记里那一处跟着重写（这条旁支的问答不在了） */
export function deleteSide(pdf: string, id: string) {
  const side = sidesOf(get(pdf)).find((s) => s.id === id)
  if (!side) return
  const running = get(pdf).sideRunning[id]
  if (running !== undefined) void window.cnReading.stop(running)
  update(pdf, (x) => ({ state: { ...x.state, sides: sidesOf(x).filter((s) => s.id !== id) }, side: x.side.open === id ? { open: null, flash: null } : x.side }))
  save(pdf)
  if (side.msgs.some((m) => m.role === 'ai' && m.text.trim()) && get(pdf).note.sections.some((s) => s.id === side.thread)) void writeNote(pdf, side.thread, null, engineNow)
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
  const user: ReadingMsg = { id: nextSeq(), role: 'user', thread: th.id, text: q, time: now, ...(mats.length ? { mats } : {}) }
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
  const full = withoutVizMark(res.text || sofar).text
  patchSideMsg(pdf, id, aiId, () => ({ text: full, ...(res.error ? { error: res.error } : {}), ...changeOf(res) }))
  if (res.commit || res.failed) window.dispatchEvent(new CustomEvent(AI_CHANGED))
  update(pdf, (x) => {
    const { [id]: _done, ...rest } = x.sideRunning
    void _done
    return { sideRunning: rest }
  })
  // 记进笔记（挂在被问那一问的回答后面）；网页上框着问的没有笔记，旁支只在对话记录里（不再插一份进文档、收件箱）
  if (!res.error && full.trim() && !isWebSrc(pdf)) void writeNote(pdf, th.id, null, pick.engine, { quote: side.quote, ...(ask ? { ask } : {}) })
}

/** 停下旁支正在答的那一问 */
export function stopSide(pdf: string, id: string) {
  const ai = get(pdf).sideRunning[id]
  if (ai !== undefined) void window.cnReading.stop(ai)
}

/** 新对话：AI 换一个新会话（重新读全文），选的模型和 effort 回到「AI 对话」那一行；问过的、笔记都留着 */
export async function newChat(pdf: string) {
  await window.cnReading.forget(pdf)
  update(pdf, (r) => {
    const { pick: _pick, ...state } = r.state
    void _pick
    return { activeThread: null, state: { ...state, newChatAt: Date.now() } }
  })
  save(pdf)
}

/** 停下 = 全停：正在答的停掉，排着的那一问也不发（框的那块留在待问区，字还回输入框） */
export function stop(pdf: string) {
  const id = get(pdf).running
  update(pdf, dropQueue)
  if (id !== null) void window.cnReading.stop(id)
}

/** 回答上面那一行：读了第几页；网页上问的「读了网页这一段」（中间开着 PDF 时「· 对上第 5 页」） */
function readOf(th: ReadingThread, answer: string, sections: AskSection[] = []): string {
  if (th.web?.t !== undefined) return `接着${fmtTime(th.web.t)}那一问`
  if (th.web && /^https?:/i.test(th.web.url)) return `读了网页这一段${th.page > 0 ? ` · 对上第${th.page}页` : ''}`
  if (th.web) return `看了框的这一块`
  return answer ? readLine(th.page, answer, sections) : `读了第${th.page}页`
}

// ---------- 后台记笔记 ----------

/** 同一处连着记了几次（主对话、旁支差不多同时答完）：标题小结写好时已经有更新的一次在记了，这一次不再写（那一次带着全部的问答） */
const noteGen = new Map<string, number>()

/**
 * 记进笔记（CN-93–96）：问题原话、回答原文、旁支挂在被问那一问后面，主进程照这一处的对话收成一段。
 * 这一段已经在笔记里时，答完马上先写一次（问答马上长出来），再让快的模型写这一轮的标题和一句小结，写好再写一次、提交。
 * aiId：主对话那条回答（下面「已记进笔记」那一行跟着变）；旁支答完、删掉旁支时是 null。
 * side：旁支答完记的（底栏说挂在哪一问下面）；主对话记好、旁支记好都在底栏说一句（told），删掉旁支重写的不说
 */
async function writeNote(pdf: string, threadId: string, aiId: number | null, engine: EngineId, side?: { quote: string; ask?: string }) {
  const key = `${pdf}\0${threadId}`
  const gen = (noteGen.get(key) ?? 0) + 1
  noteGen.set(key, gen)
  if (aiId !== null) patchMsg(pdf, aiId, { note: 'writing' })
  update(pdf, (r) => ({ writing: [...r.writing.filter((w) => w !== threadId), threadId] }))
  /** 这一处现在的问答（每次写都用最新的，不用开始时的那一份） */
  const now = () => {
    const r = get(pdf)
    return { thread: r.state.threads.find((t) => t.id === threadId)!, msgs: r.state.msgs.filter((m) => m.thread === threadId), sides: sidesOf(r).filter((s) => s.thread === threadId && s.msgs.length) }
  }
  try {
    let cur = now()
    const thread = cur.thread
    const web = isWebSrc(pdf)
    const old = get(pdf).note.sections.find((s) => s.id === threadId)
    const pages = /\.pdf$/i.test(pdf) ? get(pdf).pages : 0
    if (old && !web) {
      await window.cnReading.writeSection({ pdf, thread, msgs: cur.msgs, sides: cur.sides, pages, commit: false })
      await reloadNote(pdf)
      update(pdf, () => ({ fresh: true }))
    }
    const blocks = web || thread.web ? [] : await figureBlocks(pdf, thread.page)
    const sum = await window.cnReading.summarize({ pdf, engine, thread, msgs: cur.msgs, sides: cur.sides, blocks, ...(old?.title ? { title: old.title } : {}) })
    if (noteGen.get(key) !== gen) {
      if (aiId !== null) patchMsg(pdf, aiId, { note: 'done' })
      return
    }
    cur = now()
    // 配图（CN-60）：AI 回答里给的框；这一段已经配过图就不再截；就在我框的那块里的不配（「我框的」截图已经是它）
    let figure: { figurePng: Uint8Array; figureCaption: string } | null = null
    if (!web && !thread.web && !old?.figures.length) {
      const fig = await pickFigure(pdf, thread.page, cur.msgs)
      if (fig && !(thread.rect && insideCrop(fig.rect, thread.rect))) {
        const crop = await renderCrop(pdfDoc(pdf)!, thread.page, clamp(fig.rect), 600)
        URL.revokeObjectURL(crop.url)
        figure = { figurePng: crop.png, figureCaption: `第 ${thread.page} 页 · ${fig.caption}` }
      }
    }
    if (web) {
      // 网页上问的：中间栏开着文档插到光标处，没开进收件箱
      const c = centerNow()
      const doc = c?.center.kind === 'doc' ? c.doc() : null
      const target = doc && c?.center.kind === 'doc' && doc.path === c.center.path && !doc.readOnly ? ({ kind: 'doc', path: doc.path } as const) : ({ kind: 'inbox' } as const)
      const res = await window.cnReading.writeSection({ pdf, title: sum.title, recap: sum.recap, thread, msgs: cur.msgs, sides: cur.sides, pages: 0, target })
      if (res.markdown !== undefined) {
        const d = centerNow()?.doc()
        if (!d || d.path !== res.note) throw new Error('那篇文档关了，没记进去')
        d.insertAtCursor(res.markdown.trimEnd(), { focus: false })
        await d.save()
        const from = thread.web?.t !== undefined ? `视频「${thread.web.title} · ${fmtTime(thread.web.t)}」` : `网页「${thread.web?.title ?? ''}」`
        await window.cnReading.commit([res.note, ...(res.files ?? [])], `笔记：${from}· ${sum.title} → ${titleOf(res.note)}`)
        centerNow()?.refresh()
      }
      if (aiId !== null) patchMsg(pdf, aiId, { note: 'done', noteTo: res.markdown !== undefined ? `《${titleOf(res.note)}》` : `收件箱《${titleOf(res.note)}》` })
      return
    }
    await window.cnReading.writeSection({ pdf, title: sum.title, recap: sum.recap, thread, msgs: cur.msgs, sides: cur.sides, pages, ...(figure ?? {}) })
    await reloadNote(pdf)
    if (aiId !== null) patchMsg(pdf, aiId, { note: 'done', ...(thread.web && /^https?:/i.test(thread.web.url) ? { noteTo: `网页（记在${titleOf(get(pdf).note.path)}里）` } : {}) })
    update(pdf, () => ({ fresh: true }))
    if (!thread.web && (aiId !== null || side)) told(pdf, thread, side)
  } catch (e) {
    if (aiId !== null) patchMsg(pdf, aiId, { note: 'error', noteError: noteErr(e) })
    else console.error('旁支没记进笔记', e)
  } finally {
    if (noteGen.get(key) === gen) update(pdf, (r) => ({ writing: r.writing.filter((w) => w !== threadId) }))
  }
}

/** 没记成的原因：主进程给的中文原样说；软件自己的错（英文的 TypeError 这些）说一句中文，原话进控制台 */
function noteErr(e: unknown): string {
  const raw = String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
  if (/[\u4e00-\u9fff]/.test(raw)) return raw
  console.error('记笔记出错', e)
  return '软件出了错，这段没记进去'
}

/**
 * 笔记配哪张图（CN-60）：AI 回答里给的框（矢量画的图也框得到）；框不合理或没给就不配（记笔记那一步只写标题和小结，不再挑图）
 */
async function pickFigure(pdf: string, page: number, msgs: ReadingMsg[]): Promise<FigureBox | null> {
  if (!pdfDoc(pdf) || page < 1) return null
  const fromAi = [...msgs].reverse().find((m) => m.role === 'ai' && m.fig)?.fig ?? null
  return locateFigure([{ name: 'AI 回答里的框', locate: () => fromAi }])
}

function clamp(r: Rect): Rect {
  const x = Math.max(0, r[0])
  const y = Math.max(0, r[1])
  return [x, y, Math.min(1 - x, r[2]), Math.min(1 - y, r[3])]
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

export function jumpTo(pdf: string, page: number, rect?: Rect) {
  update(pdf, () => ({ jump: { page, ...(rect ? { rect } : {}), seq: nextSeq() } }))
}

export function focusSection(pdf: string, id: string) {
  update(pdf, () => ({ focus: { id, seq: nextSeq() }, fresh: false }))
}

export function showConvo(pdf: string, id: string) {
  update(pdf, () => ({ convo: { id, seq: nextSeq() } }))
}

/** 补截图那一句：说出来，或者点 × 收起（null） */
export function setFilled(pdf: string, text: string | null) {
  update(pdf, () => ({ filled: text }))
}

export function seenNotes(pdf: string) {
  if (get(pdf).fresh) update(pdf, () => ({ fresh: false }))
}
