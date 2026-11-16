/**
 * 一份 PDF 读着时的状态，PDF 标签（中间栏）和右栏的 AI、笔记共用：
 * 对话、问过的地方、框好还没发的那块、笔记读回来的段、要跳到哪、要看笔记哪一段。
 * 存盘的部分（看到哪页、对话）交给主进程存在软件设置目录；笔记本身在库里。
 */
import { type AskSection, blocksText, documentBlocks, notePathFor, parseReadingNote, type PdfBlock, pageBlocks, type Rect } from '@cn/format'
import { useSyncExternalStore } from 'react'
import type { EngineId } from '../../shared/agent'
import { type ReadingMsg, type ReadingState, type ReadingThread, readLine, withoutVizMark } from '../../shared/reading'
import { titleOf } from '../../shared/layout'
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
  /** 改问法：输入框不预填「给我讲解一下」 */
  blank?: boolean
  /** 在右栏网页上框的（或库里的 HTML）：网址、标题、框里的字 */
  web?: { url: string; title: string; text?: string }
}

/** 来源是右栏网页（中间栏没开 PDF、HTML 时框着问）：「web:<网址>」 */
export const isWebSrc = (src: string) => src.startsWith('web:')

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
  /** 正在问的那一轮 */
  running: number | null
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
  note: { path: notePathFor(pdf), text: '', sections: [] },
  jump: null,
  focus: null,
  convo: null,
  fresh: false,
  justWritten: null,
  writing: [],
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
export const setEngine = (e: EngineId) => (engineNow = e)

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

/** 框好了：右栏 AI 输入框里放上截图 */
export function stage(pdf: string, p: Pending) {
  const old = get(pdf).pending
  if (old?.url) URL.revokeObjectURL(old.url)
  update(pdf, () => ({ pending: p }))
}

export function unstage(pdf: string) {
  const old = get(pdf).pending
  if (old?.url) URL.revokeObjectURL(old.url)
  update(pdf, () => ({ pending: null }))
}

/** 截一块：按 PDF 本身重新画，不受屏幕上的缩放影响 */
export async function cropOf(pdf: string, page: number, rect?: Rect) {
  const doc = pdfDoc(pdf)
  if (!doc) throw new Error('PDF 还没打开')
  return renderCrop(doc, page, rect)
}

/**
 * 发出去：有框好的那块就新开一处；没有就接着上一处追问（还没问过的话，问的是正在看的这一页）。
 * 回答出来以后在后台记进笔记，不让人等。
 */
export async function send(pdf: string, text: string) {
  const engine = engineNow
  const r = get(pdf)
  if (r.running !== null || !text.trim()) return
  const now = Date.now()
  let thread: ReadingThread | undefined
  let image: string | undefined
  const p = r.pending
  if (p) {
    const id = await window.cnReading.newThread(pdf, p.page)
    if (p.png) image = await window.cnReading.saveCrop(pdf, p.page, p.png)
    thread = { id, page: p.page, ...(p.rect ? { rect: p.rect } : {}), ...(p.quote ? { quote: p.quote } : {}), ...(image ? { crop: image } : {}), ...(p.web ? { web: p.web } : {}), createdAt: now }
    unstage(pdf)
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
  const userMsg: ReadingMsg = { id: nextSeq(), role: 'user', thread: th.id, text: text.trim(), time: now, page: th.page, ...(image ? { image } : {}) }
  const aiId = nextSeq()
  const aiMsg: ReadingMsg = { id: aiId, role: 'ai', thread: th.id, text: '', time: now, page: th.page, engine, read: readOf(th, '') }
  update(pdf, (x) => ({
    running: aiId,
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
    pageText: blocksText(blocks),
    pages: get(pdf).pages,
  })
  const full = res.text || get(pdf).state.msgs.find((m) => m.id === aiId)?.text || ''
  const { text: answer, viz } = withoutVizMark(full)
  patchMsg(pdf, aiId, { text: answer, read: readOf(th, answer, get(pdf).note.sections), ...(viz && !res.error ? { vizOk: true } : {}), ...(res.error ? { error: res.error } : {}) })
  update(pdf, () => ({ running: null }))
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

export function stop(pdf: string) {
  const id = get(pdf).running
  if (id !== null) void window.cnReading.stop(id)
}

/** 回答上面那一行：读了第几页；网页上问的「读了网页这一段」（中间开着 PDF 时「· 对上第 5 页」） */
function readOf(th: ReadingThread, answer: string, sections: AskSection[] = []): string {
  if (th.web && /^https?:/i.test(th.web.url)) return `读了网页这一段${th.page > 0 ? ` · 对上第 ${th.page} 页` : ''}`
  if (th.web) return `看了框的这一块`
  return answer ? readLine(th.page, answer, sections) : `读了第 ${th.page} 页`
}

// ---------- 后台记笔记 ----------

async function writeNote(pdf: string, threadId: string, aiId: number, engine: EngineId) {
  patchMsg(pdf, aiId, { note: 'writing' })
  update(pdf, (r) => ({ writing: [...r.writing.filter((w) => w !== threadId), threadId] }))
  try {
    const r = get(pdf)
    const thread = r.state.threads.find((t) => t.id === threadId)!
    const blocks = isWebSrc(pdf) || thread.web ? [] : await blocksOf(pdf, thread.page)
    const msgs = r.state.msgs.filter((m) => m.thread === threadId)
    const sum = await window.cnReading.summarize({ pdf, engine, thread, msgs, blocks })
    let figurePng: Uint8Array | undefined
    const section = sum.section
    if (sum.figure) {
      const b = blocks.find((x) => x.id === sum.figure!.block)
      const doc = pdfDoc(pdf)
      if (b && doc) {
        const pg = await doc.getPage(thread.page)
        const vp = pg.getViewport({ scale: 1 })
        const pad = 4
        const rect: Rect = [(b.x - pad) / vp.width, (b.y - pad) / vp.height, (b.w + pad * 2) / vp.width, (b.h + pad * 2) / vp.height]
        const crop = await renderCrop(doc, thread.page, clamp(rect), 600)
        URL.revokeObjectURL(crop.url)
        figurePng = crop.png
        section.figures = [{ path: '', caption: `第 ${thread.page} 页 · ${sum.figure.caption}` }]
      }
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
        d.insertAtCursor(res.markdown.trimEnd() + '\n')
        await d.save()
        await window.cnReading.commit([res.note, ...(res.files ?? [])], `笔记：网页「${thread.web?.title ?? ''}」· ${section.title} → ${titleOf(res.note)}`)
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
    patchMsg(pdf, aiId, { note: 'error', noteError: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
  } finally {
    update(pdf, (r) => ({ writing: r.writing.filter((w) => w !== threadId) }))
  }
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
    patchMsg(pdf, aiId, { viz: { state: 'error', error: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') } })
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
