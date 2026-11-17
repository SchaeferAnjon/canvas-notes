/**
 * 一份 PDF 读着时的状态，PDF 标签（中间栏）和右栏的 AI、笔记共用：
 * 对话、问过的地方、框好还没发的那块、笔记读回来的段、要跳到哪、要看笔记哪一段。
 * 存盘的部分（看到哪页、对话）交给主进程存在软件设置目录；笔记本身在库里。
 */
import { type AskSection, blocksText, decorativeImages, documentBlocks, type FigureBox, locateFigure, mineruFigure, notePathFor, parseReadingNote, type PdfBlock, pageBlocks, type Rect, remapBlockIds, toPageRect } from '@cn/format'
import type { MineruJob } from '../../shared/mineru'
import { useSyncExternalStore } from 'react'
import type { EngineId } from '../../shared/agent'
import { type ReadingMsg, type ReadingState, type ReadingThread, readLine, withoutVizMark } from '../../shared/reading'
import { titleOf } from '../../shared/layout'
import { fmtTime } from '../../shared/video'
import { pageText, pdfDoc, renderCrop } from './pdf'
import { webHost } from '../plugins/host'
import { centerNow } from '../video/store'
import { clearWebBox } from './web-bridge'

/** 框好、还没发的那一块（右栏输入框里那张小图） */
export interface Pending {
  page: number
  rect?: Rect
  quote?: string
  /** 截好的图（blob 网址和字节）；选字问的没有 */
  url?: string
  png?: Uint8Array
  /** 库里已经有的图（视频问答块「接着问」：那一问框的那一帧），直接附上，不另存 */
  image?: string
  /** 改问法：输入框不预填「给我讲解一下」 */
  blank?: boolean
  /** 马上就发（工具条按钮、问这一页、⌘↵）：输入框不预填，也不抢焦点 */
  direct?: boolean
  /** 在右栏网页上框的（或库里的 HTML）：网址、标题、框里的字 */
  web?: { url: string; title: string; text?: string; /** 视频问答块「接着问」：那一问在视频第几秒 */ t?: number; /** 「接着问」：那一问 AI 当时的回答 */ answer?: string }
}

/** 输入框里打了自己的问题再按 ⌘↵：PDF 标签带上这一页（HTML 带上这一屏）问这句。detail：{ src, text } */
export const ASK_PAGE = 'cn:reading-ask-page'

/** 来源是右栏网页（中间栏没开 PDF、HTML 时框着问）：「web:<网址>」 */
export const isWebSrc = (src: string) => src.startsWith('web:')

/** 排着的一问。page：答的时候按 ⌘↵ 排上的，发出时和平时的 ⌘↵ 一样带上那一页 */
export interface Queued {
  text: string
  pasted: string[]
  page?: number
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
  /** 排着的那几问不发了（点了停下、点了「不发了」、换了一块）：它们的字和贴的图接回输入框（输入框里已经有的字不动） */
  restore: { text: string; pasted: string[]; seq: number } | null
  note: { path: string; text: string; sections: AskSection[] }
  /** 让 PDF 翻过去、框闪两下 */
  jump: { page: number; rect?: Rect; seq: number } | null
  /** 让笔记滚到那一段、外圈亮一下 */
  focus: { id: string; seq: number } | null
  /** 让 AI 滚到那次对话、外圈亮一下 */
  convo: { id: string; seq: number } | null
  /** 有新记的笔记还没看（竖条「笔记」上的小点） */
  fresh: boolean
  /** 刚记好的那一段（笔记里外圈亮 2 秒） */
  justWritten: string | null
  /** 正在后台写的几段 */
  writing: string[]
  /** 发出去过几次：输入框看到它变了就清掉预填的字（不管是从哪里发的） */
  sent: number
  /** 块是谁认的：pdf.js 拼的，还是 PDF 精读增强（MinerU） */
  layout: 'pdfjs' | 'mineru'
  /** PDF 精读增强在后台识别这一份的进度（没装、没在识别是 null） */
  mineru: MineruJob | null
  /** 换成 MinerU 的块后，AI 提过的旧图编号 → 新编号（下一问告诉 AI 一次） */
  renamed: Record<string, string> | null
}

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
  note: { path: notePathFor(pdf), text: '', sections: [] },
  jump: null,
  focus: null,
  convo: null,
  fresh: false,
  justWritten: null,
  writing: [],
  sent: 0,
  layout: 'pdfjs',
  mineru: null,
  renamed: null,
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

/** 右栏 AI 头上选的引擎（框好直接点「讲解一下」时也用它） */
let engineNow: EngineId = 'claude'
/** 「Claude Code · Opus 5.5」：回答上面那一行写是哪家哪个模型答的（CN-54） */
let byNow = ''
export const setEngine = (e: EngineId, by?: string) => {
  engineNow = e
  if (by !== undefined) byNow = by
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
      const r = get(pdf)
      if (r.loaded) void window.cnReading.saveState(r.state)
    }, 300),
  )
}

let listening = false

export async function load(pdf: string) {
  if (!listening) {
    listening = true
    window.cnReading.onAsk((id, e) => onAskText(id, e.delta))
    window.cnMineru.onJob(onMineruJob)
    // 刚装好 PDF 精读增强：开着的 PDF 接着用它识别
    window.cnMineru.onInstalled(() => {
      for (const [p, r] of docs) if (r.layout === 'pdfjs' && r.readN === r.pages && r.pages) void enhance(p)
    })
  }
  if (get(pdf).loaded) return
  const [state, note] = await Promise.all([window.cnReading.state(pdf), window.cnReading.readNote(pdf)])
  // 上次关软件时没答完的那条记成停下了
  const msgs = state.msgs.map((m) =>
    m.role === 'ai' && !m.text && !m.error
      ? { ...m, error: '没答完（软件关了）' }
      : m.note === 'writing' || m.viz?.state === 'making'
        ? { ...m, ...(m.note === 'writing' ? { note: undefined } : {}), ...(m.viz?.state === 'making' ? { viz: { state: 'error' as const, error: '软件关了，没做完' } } : {}) }
        : m,
  )
  const last = [...msgs].reverse().find((m) => m.role === 'user')
  update(pdf, () => ({ loaded: true, state: { ...state, msgs }, activeThread: last?.thread ?? null, note: { ...note, sections: parseReadingNote(note.text, note.path) } }))
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
}

const patchMsg = (pdf: string, id: number, p: Partial<ReadingMsg>) => {
  update(pdf, (r) => ({ state: { ...r.state, msgs: r.state.msgs.map((m) => (m.id === id ? { ...m, ...p } : m)) } }))
  save(pdf)
}

// ---------- 读全文 ----------

/** 第一次打开：后台一页一页读出段落块（问的时候已经能问），读完交给主进程按内容指纹缓存 */
export async function readAll(pdf: string, hash: string, pages: number) {
  update(pdf, () => ({ hash, pages, readN: 0 }))
  // 读过的（按内容指纹缓存着）直接拿来
  const cached = await window.cnReading.getText(hash)
  if (cached && cached.length === pages) {
    const byMineru = cached.some((p) => p.some((b) => b.by === 'mineru'))
    update(pdf, () => ({ blocks: Object.fromEntries(cached.map((b, i) => [i + 1, b])), readN: pages, layout: byMineru ? 'mineru' : 'pdfjs' }))
    if (!byMineru) void enhance(pdf)
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
  void enhance(pdf)
}

// ---------- PDF 精读增强（MinerU）：pdf.js 的块先出，它在后台认完再换 ----------

/** 有能用的 MinerU 就排进后台识别；没装、测试实例里关着返回 null，什么都不变。fresh：「重试」 */
export async function enhance(pdf: string, fresh = false) {
  const r = get(pdf)
  if (!/\.pdf$/i.test(pdf) || !r.pages || r.layout === 'mineru') return
  const job = await window.cnMineru.enhance(pdf, r.pages, fresh)
  if (job) onMineruJob(job)
  else update(pdf, () => ({ mineru: null }))
}

function onMineruJob(j: MineruJob) {
  for (const [pdf, r] of docs) {
    if (r.hash !== j.hash) continue
    update(pdf, () => ({ mineru: j }))
    if (j.status === 'done' && r.layout !== 'mineru') void swapIn(pdf)
  }
}

/** 换成 MinerU 的块：AI 已经在会话里看过的旧图编号，按框的重叠对到新块，下一问告诉它 */
async function swapIn(pdf: string) {
  const r = get(pdf)
  const pages = await window.cnReading.getText(r.hash)
  if (!pages || pages.length !== r.pages || !pages.some((p) => p.some((b) => b.by === 'mineru'))) return
  const asked = r.state.msgs.some((m) => m.role === 'ai' && m.text)
  const seen = new Set(Object.values(r.blocks).flatMap((p) => p.filter((b) => b.kind === 'image').map((b) => b.id)))
  const map = Object.fromEntries(Object.entries(remapBlockIds(r.blocks, pages)).filter(([a]) => seen.has(a)))
  update(pdf, (x) => ({
    blocks: Object.fromEntries(pages.map((b, i) => [i + 1, b])),
    readN: x.pages,
    layout: 'mineru',
    renamed: asked && Object.keys(map).length ? { ...(x.renamed ?? {}), ...map } : x.renamed,
  }))
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

/** 排着的这几问不发了：字（一问一段，空一行）和贴的图交回输入框 */
const giveBack = (qs: Queued[]): Reading['restore'] =>
  qs.length ? { text: qs.map((q) => q.text).join('\n\n'), pasted: qs.flatMap((q) => q.pasted), seq: nextSeq() } : null
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

/** 这份 PDF（HTML）的标签关了：排着的那一问不发、不记笔记；正在答的那一问照常答完记下 */
export function closed(pdf: string) {
  if (!docs.has(pdf)) return
  const old = get(pdf).pending
  if (old?.url) URL.revokeObjectURL(old.url)
  update(pdf, () => ({ pending: null, queued: [], restore: null }))
}

/** 截一块：按 PDF 本身重新画，不受屏幕上的缩放影响 */
export async function cropOf(pdf: string, page: number, rect?: Rect) {
  const doc = pdfDoc(pdf)
  if (!doc) throw new Error('PDF还没打开')
  return renderCrop(doc, page, rect)
}

/**
 * 发出去：有框好的那块就新开一处；没有就接着上一处追问（还没问过的话，问的是正在看的这一页）。
 * 回答出来以后在后台记进笔记，不让人等。
 */
export async function send(pdf: string, text: string, pasted: string[] = [], o: { page?: number } = {}) {
  const engine = engineNow
  const r = get(pdf)
  if (!text.trim()) return
  if (r.running !== null) {
    // 还在答上一问：排在队尾，答完依次发（CN-28/30）。点浮条按钮、输入框回车、⌘↵ 都走这里
    update(pdf, (x) => ({ queued: [...x.queued, { text: text.trim(), pasted, ...(o.page ? { page: o.page } : {}) }] }))
    return
  }
  // 一开始就记下「在发了」（不等建对话、存截图那几步）：连点两下第二下进不来；
  // 输入框清掉预填的字；待问区清空，晚到的截图不再放回去
  const aiId = nextSeq()
  const p = r.pending
  update(pdf, (x) => ({ running: aiId, sent: x.sent + 1, pending: null }))
  try {
    await ask(pdf, aiId, engine, p, text, pasted)
  } finally {
    if (p?.url) URL.revokeObjectURL(p.url)
    update(pdf, () => ({ running: null }))
  }
  // 答的时候排着的：发排在最前的那一问，后面的接着排（点了停下、标签关了的，queued 已经清掉了）
  const [q, ...rest] = get(pdf).queued
  if (!q) return
  update(pdf, () => ({ queued: rest }))
  if (q.page) void sendWithPage(pdf, q)
  else void send(pdf, q.text, q.pasted)
}

/**
 * 排着的 ⌘↵：和平时的 ⌘↵ 一样带上那一页。PDF 在这里截那一页；HTML 的「这一屏」要它的标签来截（标签不在前面截不了时只发字）
 */
async function sendWithPage(pdf: string, q: Queued) {
  if (/\.pdf$/i.test(pdf)) {
    try {
      const c = await cropOf(pdf, q.page!)
      update(pdf, () => ({ pending: { page: q.page!, url: c.url, png: c.png, direct: true } }))
    } catch {
      // PDF 已经关了、还没打开：只发字，不丢这一问
    }
    return send(pdf, q.text, q.pasted)
  }
  const ask = new CustomEvent<{ src: string; text: string; taken?: boolean }>(ASK_PAGE, { detail: { src: pdf, text: q.text } })
  window.dispatchEvent(ask)
  if (!ask.detail.taken) return send(pdf, q.text, q.pasted)
}

async function ask(pdf: string, aiId: number, engine: EngineId, p: Pending | null, text: string, pasted: string[]) {
  const r = get(pdf)
  const now = Date.now()
  let thread: ReadingThread | undefined
  let image: string | undefined
  if (p) {
    const id = await window.cnReading.newThread(pdf, p.page)
    if (p.image) image = p.image
    else if (p.png) image = await window.cnReading.saveCrop(pdf, p.page, p.png)
    // 视频「接着问」附的那一帧文档里那块问答已经有了，笔记里不再放一遍
    thread = { id, page: p.page, ...(p.rect ? { rect: p.rect } : {}), ...(p.quote ? { quote: p.quote } : {}), ...(image && !p.image ? { crop: image } : {}), ...(p.web ? { web: p.web } : {}), createdAt: now }
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
  const userMsg: ReadingMsg = { id: nextSeq(), role: 'user', thread: th.id, text: text.trim(), time: now, page: th.page, ...(image ? { image } : {}), ...(pasted.length ? { pasted } : {}) }
  const aiMsg: ReadingMsg = { id: aiId, role: 'ai', thread: th.id, text: '', time: now, page: th.page, engine, read: readOf(th, ''), ...(byNow ? { by: byNow } : {}) }
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
    images: image ? [image] : [],
    ...(pasted.length ? { pasted } : {}),
    pageText: blocksText(blocks),
    pages: get(pdf).pages,
    ...(get(pdf).renamed ? { renamed: get(pdf).renamed! } : {}),
  })
  if (get(pdf).renamed) update(pdf, () => ({ renamed: null }))
  const full = res.text || get(pdf).state.msgs.find((m) => m.id === aiId)?.text || ''
  const { text: answer, viz, figure } = withoutVizMark(full)
  // 配图的框：附的是框的那块就换成整页上的比例（附的是整页就原样）
  const fig = figure && image && !isWebSrc(pdf) ? { rect: toPageRect(figure.rect, th.rect), caption: figure.caption } : null
  patchMsg(pdf, aiId, { text: answer, read: readOf(th, answer, get(pdf).note.sections), ...(viz && !res.error ? { vizOk: true } : {}), ...(fig ? { fig } : {}), ...(res.error ? { error: res.error } : {}) })
  if (!res.error && res.text.trim()) void writeNote(pdf, th.id, aiId, engine)
}

/** 边生成边显示：主进程一小段一小段给字 */
export function onAskText(id: number, delta: string) {
  for (const [pdf, r] of docs) {
    if (r.running !== id) continue
    update(pdf, (x) => ({ state: { ...x.state, msgs: x.state.msgs.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)) } }))
  }
}

/** 新对话：AI 换一个新会话（重新读全文）；问过的、笔记都留着 */
export async function newChat(pdf: string) {
  await window.cnReading.forget(pdf)
  update(pdf, (r) => ({ activeThread: null, state: { ...r.state, newChatAt: Date.now() } }))
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

async function writeNote(pdf: string, threadId: string, aiId: number, engine: EngineId) {
  patchMsg(pdf, aiId, { note: 'writing' })
  update(pdf, (r) => ({ writing: [...r.writing.filter((w) => w !== threadId), threadId] }))
  try {
    const r = get(pdf)
    const thread = r.state.threads.find((t) => t.id === threadId)!
    const blocks = isWebSrc(pdf) || thread.web ? [] : await figureBlocks(pdf, thread.page)
    const msgs = r.state.msgs.filter((m) => m.thread === threadId)
    const sum = await window.cnReading.summarize({ pdf, engine, thread, msgs, blocks })
    let figurePng: Uint8Array | undefined
    const section = sum.section
    // 提示块头上写是哪家哪个模型讲的（CN-76、CN-54）
    const by = [...msgs].reverse().find((m) => m.role === 'ai' && m.by)?.by
    if (by) section.by = by
    const fig = isWebSrc(pdf) || thread.web ? null : await pickFigure(pdf, thread.page, msgs, blocks, sum.figure)
    if (fig) {
      const doc = pdfDoc(pdf)!
      const crop = await renderCrop(doc, thread.page, clamp(fig.rect), 600)
      URL.revokeObjectURL(crop.url)
      figurePng = crop.png
      section.figures = [{ path: '', caption: `第 ${thread.page} 页 · ${fig.caption}` }]
    }
    if (isWebSrc(pdf)) {
      // 网页上问的：中间栏开着文档插到光标处，没开进收件箱
      const c = centerNow()
      const doc = c?.center.kind === 'doc' ? c.doc() : null
      const target = doc && c?.center.kind === 'doc' && doc.path === c.center.path && !doc.readOnly ? ({ kind: 'doc', path: doc.path } as const) : ({ kind: 'inbox' } as const)
      const res = await window.cnReading.writeSection({ pdf, section, thread, msgs, pages: 0, target })
      if (res.markdown !== undefined) {
        const d = centerNow()?.doc()
        if (!d || d.path !== res.note) throw new Error('那篇文档关了，没记进去')
        d.insertAtCursor(res.markdown.trimEnd(), { focus: false })
        await d.save()
        const from = thread.web?.t !== undefined ? `视频「${thread.web.title} · ${fmtTime(thread.web.t)}」` : `网页「${thread.web?.title ?? ''}」`
        await window.cnReading.commit([res.note, ...(res.files ?? [])], `笔记：${from}· ${section.title} → ${titleOf(res.note)}`)
        centerNow()?.refresh()
      }
      patchMsg(pdf, aiId, { note: 'done', noteTo: res.markdown !== undefined ? `《${titleOf(res.note)}》` : `收件箱《${titleOf(res.note)}》` })
      return
    }
    await window.cnReading.writeSection({ pdf, section, thread, msgs, pages: /\.pdf$/i.test(pdf) ? get(pdf).pages : 0, ...(figurePng ? { figurePng } : {}) })
    await reloadNote(pdf)
    patchMsg(pdf, aiId, { note: 'done', ...(thread.web && /^https?:/i.test(thread.web.url) ? { noteTo: `网页（记在${titleOf(get(pdf).note.path)}里）` } : {}) })
    update(pdf, () => ({ fresh: true, justWritten: threadId }))
    setTimeout(() => update(pdf, (x) => (x.justWritten === threadId ? { justWritten: null } : {})), 2000)
  } catch (e) {
    patchMsg(pdf, aiId, { note: 'error', noteError: noteErr(e) })
  } finally {
    update(pdf, (r) => ({ writing: r.writing.filter((w) => w !== threadId) }))
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
 * 笔记配哪张图（CN-60）：先看 AI 回答里给的框（矢量画的图也框得到），框不合理或没给就退回 AI 从图片块里挑的那张。
 * 取框是可替换的一层（format 的 locateFigure）：以后装了 MinerU 增强包，它给的版面块排在最前面。
 */
async function pickFigure(pdf: string, page: number, msgs: ReadingMsg[], blocks: PdfBlock[], fromBlocks?: { block: string; caption: string }): Promise<FigureBox | null> {
  const doc = pdfDoc(pdf)
  if (!doc) return null
  const fromAi = [...msgs].reverse().find((m) => m.role === 'ai' && m.fig)?.fig ?? null
  const vp = (await doc.getPage(page)).getViewport({ scale: 1 })
  const hit = await locateFigure([
    // 装了 PDF 精读增强：它认出的图、表的框最准（矢量图也框得到）；挑哪一个看 AI 回答里的框，没有就看记笔记时 AI 挑的块
    {
      name: 'MinerU 的图框',
      locate: () => {
        const f = mineruFigure(blocks, { w: vp.width, h: vp.height }, { rect: fromAi?.rect ?? null, block: fromBlocks?.block ?? null })
        return f ? { rect: f.rect, caption: fromAi?.caption || fromBlocks?.caption || f.caption || '这页的图' } : null
      },
    },
    { name: 'AI 回答里的框', locate: () => fromAi },
  ])
  if (hit) return hit
  const b = fromBlocks && blocks.find((x) => x.id === fromBlocks.block)
  if (!b) return null
  const pad = 4
  return { rect: [(b.x - pad) / vp.width, (b.y - pad) / vp.height, (b.w + pad * 2) / vp.width, (b.h + pad * 2) / vp.height], caption: fromBlocks.caption }
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
    update(pdf, () => ({ fresh: true, justWritten: thread.id }))
    setTimeout(() => update(pdf, (x) => (x.justWritten === thread.id ? { justWritten: null } : {})), 2000)
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

export function seenNotes(pdf: string) {
  if (get(pdf).fresh) update(pdf, () => ({ fresh: false }))
}
