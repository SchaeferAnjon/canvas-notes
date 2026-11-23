/**
 * 白板上讲的一轮（task-yvabi 方向 B，② 界面线）：一轮存在文档里的一节（shared/feynman/doc.ts），问 AI、守规矩、算判定在 ① 的
 * window.cnFeynman（main/feynman.ts）。这里只记界面上的一时状态：正在列要点、学生在想（esc 先停它）、边写边出的字、
 * 刚写进来要一点点长出来的那一段、标出来的那一句、回答框是哪一种、按住看一眼、当场再讲哪几处。
 *
 * 盖住什么照这一节注释里的 cover、from（白板卡、导图那一支、配对的网页、那份 PDF）；暂停、讲完了露出来。
 * 讲的时候按住「看一眼」：松手又盖上，每按一次记一次「看过材料」（已定 4）；暂停后接着讲也记一次（已定 5）。
 */
import { useSyncExternalStore } from 'react'
import { headOf } from '../../shared/feynman/material'
import {
  addRound,
  appendEntry,
  type Candidate,
  type Draft,
  type ExtractReq,
  findRounds,
  type FeynmanMeta,
  type MaterialRef,
  newMeta,
  newPointId,
  passesBefore,
  putBlock,
  resumed,
  roundById,
  roundsIn,
  type RoundSection,
  roundsOf,
  type Scope,
  setMeta,
  withPeek,
} from '../../shared/feynman'
import { t as tNow } from '../../shared/i18n'
import { NoteDoc } from '../note-doc'

/** 回答框是哪一种：先讲一段（讲完了）、回答追问（回）、问完了（讲完了，看判定）、当场再讲这几处 */
export type InputKind = 'explain' | 'reply' | 'end' | 'redo'

export interface Live {
  id: string
  path: string
  /** 学生在想、在评分：esc 先停它 */
  thinking: { word: string; req: number; judging?: boolean } | null
  /** 学生边说边出的字（AI 边写边给） */
  stream: string
  /** 刚写进来的那一段（这一节里第几段）：一点点长出来 */
  fresh: number | null
  /** 你讲的那一句被引了：标出来 */
  hl: string | null
  input: InputKind | null
  /** 当场再讲这几处（核心的编号） */
  redo: string[] | null
  peeking: boolean
  /** 列底一句（停下了、出错了） */
  note?: string
}

/** 还没写进文档的一轮：正在列要点、先挑一个点（PDF 单子、导图子枝、核心超过 5 条分成的几个点）、出错 */
export interface Pending {
  key: string
  path: string
  /** 摆在哪（白板坐标）；导图白板不给，摆在导图右边 */
  at?: { x: number; y: number }
  word: string
  pick?: { why: 'pdf' | 'many-cores' | 'branch'; title: string; items: Candidate[]; chain?: Candidate }
  error?: string
  req: StartReq
  reqId: number
}

export interface StartReq {
  path: string
  from: MaterialRef[]
  /** 摆在哪（白板坐标）：选中的东西旁边；导图白板不给 */
  at?: { x: number; y: number }
  scope?: Scope
  /** 新的一节插在哪（导图白板：卡片块前面）；不给接在文末 */
  insertAt?: (text: string) => number | undefined
  /** 同一节里的几个知识点（导图那一支的同级）：列头这一节的进度；抽要点没给时用它 */
  siblings?: string[]
}

let lives = new Map<string, Live>()
let pendings: Pending[] = []
/** 列头第二行（抽要点时给的「照导图「范数」这一支和配对的网页核对」，不进文件） */
const labels = new Map<string, string>()
/** 摆放：新加的一轮写进文档后，白板把这一列摆到这里（列的位置行由白板写） */
const places = new Map<string, { x: number; y: number }>()
let version = 0
const subs = new Set<() => void>()
function bump() {
  version++
  for (const f of subs) f()
}
export function subscribe(f: () => void) {
  subs.add(f)
  return () => void subs.delete(f)
}
export const useFeynman = () => useSyncExternalStore(subscribe, () => version)

export const liveOf = (id: string) => lives.get(id)
export const pendingOf = (path: string) => pendings.filter((p) => p.path === path)
export const labelOf = (id: string) => labels.get(id)
export const placeOf = (id: string) => places.get(id)
export const takePlace = (id: string) => {
  const p = places.get(id)
  places.delete(id)
  return p
}

function patch(id: string, p: Partial<Live>) {
  const l = lives.get(id)
  if (!l) return
  lives = new Map(lives).set(id, { ...l, ...p })
  bump()
}

let reqSeq = 1
/** 学生边写边给的字：哪一问是哪一轮的 */
const streams = new Map<number, string>()
let listening = false
function listen() {
  if (listening) return
  listening = true
  window.cnFeynman.onText((reqId, delta) => {
    const id = streams.get(reqId)
    const l = id ? lives.get(id) : undefined
    if (l?.thinking?.req === reqId) patch(l.id, { stream: l.stream + delta })
  })
}

// ---------- 读写这一篇 ----------

function docOf(path: string): NoteDoc | undefined {
  return [...NoteDoc.open].find((d) => d.path === path && !d.readOnly)
}

/** 这一篇现在的全文（开着的编辑器里的） */
export function textOf(path: string): string | null {
  return docOf(path)?.text ?? null
}

function edit(path: string, f: (text: string) => string): boolean {
  const d = docOf(path)
  if (!d) return false
  const next = f(d.text)
  if (next !== d.text) {
    d.setText(next)
    // 盖不盖、右栏那一句跟着文档里的状态走：写完叫订阅的界面重画
    bump()
  }
  return true
}

function roundOf(path: string, id: string): RoundSection | null {
  const t = textOf(path)
  return t === null ? null : roundById(t, id)
}

function writeMeta(path: string, id: string, f: (m: FeynmanMeta) => FeynmanMeta) {
  edit(path, (t) => {
    const r = roundById(t, id)
    return r ? setMeta(t, f(r.meta)) : t
  })
}

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

// ---------- 开始 ----------

/**
 * 点「费曼学习」/「费曼讲这几张」/ 导图一支 / 写一个词：先在白板上出一列「在列要点…」，AI 抽完要点写成文档里新的一节（还没开讲），
 * 列里出「这次要讲到」。一整份 PDF、导图一支超过 5 个子枝、核心超过 5 条：先列单子挑一个（pickOne）
 */
export async function start(req: StartReq): Promise<void> {
  listen()
  const key = Math.random().toString(36).slice(2)
  const pdfOnly = req.from.length === 1 && req.from[0]!.kind === 'pdf' && !req.from[0]!.pages
  const p: Pending = { key, path: req.path, ...(req.at ? { at: req.at } : {}), word: pdfOnly ? tNow('在列这一讲的知识点…') : tNow('在列这次要讲到的…'), req, reqId: reqSeq++ }
  pendings = [...pendings, p]
  bump()
  // 主进程读的是盘上的文件：白板上刚改的先存下
  await NoteDoc.saveAll()
  await runExtract(key, { refs: req.from, board: req.path, ...(req.scope ? { scope: req.scope } : {}) })
}

async function runExtract(key: string, ex: ExtractReq) {
  const p = pendings.find((x) => x.key === key)
  if (!p) return
  try {
    const r = await window.cnFeynman.extract(p.reqId, ex)
    if (!pendings.some((x) => x.key === key)) return
    if (r.kind === 'pick') {
      pendings = pendings.map((x) => (x.key === key ? { ...x, pick: { why: r.why, title: r.title, items: r.items, ...(r.chain ? { chain: r.chain } : {}) } } : x))
      return bump()
    }
    addDraft(key, r.draft)
  } catch (e) {
    pendings = pendings.map((x) => (x.key === key ? { ...x, error: errText(e) } : x))
    bump()
  }
}

/** 单子里挑了一个 */
export async function pickOne(key: string, c: Candidate) {
  const p = pendings.find((x) => x.key === key)
  if (!p) return
  pendings = pendings.map((x) => (x.key === key ? { ...x, pick: undefined, word: tNow('在列这次要讲到的…') } : x))
  bump()
  await runExtract(key, { refs: c.refs, board: p.path, pick: c })
}

export function dropPending(key: string) {
  const p = pendings.find((x) => x.key === key)
  if (p) void window.cnFeynman.stop(p.reqId)
  pendings = pendings.filter((x) => x.key !== key)
  bump()
}

function addDraft(key: string, d: Draft) {
  const p = pendings.find((x) => x.key === key)
  if (!p) return
  const text0 = textOf(p.path) ?? ''
  const nth = roundsOf(roundsIn([{ path: p.path, text: text0 }]), d.topic) + 1
  const sib = d.siblings?.length ? d.siblings : p.req.siblings
  const meta: FeynmanMeta = { ...newMeta(d, { today: today(), nth }), status: 'draft', ...(sib && sib.length > 1 ? { siblings: sib } : {}) }
  if (p.at) places.set(meta.id, p.at)
  labels.set(meta.id, d.basisLine)
  lives = new Map(lives).set(meta.id, blank(meta.id, p.path))
  const ok = edit(p.path, (t) => addRound(t, meta, { at: p.req.insertAt?.(t) }))
  pendings = pendings.filter((x) => x.key !== key)
  if (!ok) pendings = [...pendings, { ...p, error: tNow('这块白板是只读的，没法在上面讲') }]
  bump()
}

const blank = (id: string, path: string): Live => ({ id, path, thinking: null, stream: '', fresh: null, hl: null, input: null, redo: null, peeking: false })

function ensureLive(path: string, id: string): Live {
  let l = lives.get(id)
  if (!l) {
    l = blank(id, path)
    lives = new Map(lives).set(id, l)
  }
  return l
}

// ---------- 讲之前：改「这次要讲到」 ----------

export function movePoint(path: string, id: string, pid: string, to: 'core' | 'extra') {
  writeMeta(path, id, (m) => ({ ...m, points: m.points.map((p) => (p.id === pid ? { ...p, kind: to } : p)), edits: [...(m.edits ?? []), { op: 'move', id: pid, to }] }))
}
export function dropPoint(path: string, id: string, pid: string) {
  writeMeta(path, id, (m) => ({ ...m, points: m.points.filter((p) => p.id !== pid), edits: [...(m.edits ?? []), { op: 'drop', id: pid }] }))
}
export function addPoint(path: string, id: string, text: string) {
  writeMeta(path, id, (m) => {
    const pid = newPointId(m.points)
    // 不翻：写进文件的「凭什么」（和 ① 的 applyEdits 一样）
    return { ...m, points: [...m.points, { id: pid, kind: 'core', text, answer: '', basis: '你加的' }], edits: [...(m.edits ?? []), { op: 'add', id: pid, text }] }
  })
}

/** 「开始讲」：盖住材料，学生开口 */
export function begin(path: string, id: string) {
  listen()
  writeMeta(path, id, (m) => ({ ...m, status: 'talking', day: today() }))
  ensureLive(path, id)
  patch(id, { input: 'explain', note: undefined })
}

/** 不讲了（还没开讲时）：这一节连同前面的位置行从文档里拿掉 */
export function discard(path: string, id: string) {
  edit(path, (t) => {
    const r = roundById(t, id)
    if (!r) return t
    const before = t.slice(0, r.head.from)
    const m = /<!--\s*column\b[^\n]*-->\n$/.exec(before)
    const from = m ? r.head.from - m[0].length : r.head.from
    let to = r.end
    while (t[to] === '\n') to++
    const head = t.slice(0, from).replace(/\n+$/, '')
    const tail = t.slice(to)
    return head + (tail ? '\n\n' + tail : '\n')
  })
  forget(id)
}

// ---------- 讲、追问 ----------

const entriesOf = (r: RoundSection) => r.entries.map((e) => ({ kind: e.kind, text: e.text }))

/** 交一段（讲完了 / 回 / 当场再讲）；image：拍的手画的图 */
export async function send(path: string, id: string, text: string, image?: { mime: string; base64: string }) {
  const l = ensureLive(path, id)
  const body = text.trim()
  if (!body) return
  const kind = l.input
  edit(path, (t) => appendEntry(t, id, 'me', body))
  patch(id, { input: null, hl: null, note: undefined })
  await next(path, id, { ...(image ? { image } : {}), ...(kind === 'redo' && l.redo ? { only: l.redo } : {}) })
}

/** 学生下一句：追问的等你回；问完了出「讲完了，看判定」；当场再讲问完了直接判 */
async function next(path: string, id: string, o: { image?: { mime: string; base64: string }; only?: string[] } = {}) {
  const r = roundOf(path, id)
  if (!r) return
  const req = reqSeq++
  streams.set(req, id)
  patch(id, { thinking: { word: tNow('学生在想…'), req }, stream: '' })
  let res
  try {
    res = await window.cnFeynman.turn({ reqId: req, meta: r.meta, entries: entriesOf(r), ...(o.image ? { image: o.image } : {}), ...(o.only ? { only: o.only } : {}) })
  } catch (e) {
    streams.delete(req)
    if (lives.get(id)?.thinking?.req !== req) return
    patch(id, { thinking: null, stream: '', note: errText(e), input: o.only ? 'redo' : 'reply' })
    return
  }
  streams.delete(req)
  // esc 停下了：这一问不要了
  if (lives.get(id)?.thinking?.req !== req) return
  const streamed = !!lives.get(id)?.stream
  let at: number | null = null
  edit(path, (t) => {
    let n = setMeta(t, res.meta)
    if (res.reveal) n = appendEntry(n, id, 'reveal', res.reveal, res.by)
    if (res.say) n = appendEntry(n, id, res.act === 'confirm' ? 'confirm' : 'student', res.say, res.by)
    const rr = roundById(n, id)
    at = rr ? rr.entries.length - 1 : null
    return n
  })
  patch(id, { thinking: null, stream: '', fresh: streamed ? null : at, hl: res.quote ?? null })
  if (res.act === 'done') {
    if (o.only) return finish(path, id)
    patch(id, { input: 'end' })
    return
  }
  patch(id, { input: o.only ? 'redo' : 'reply' })
}

// ---------- 判定 ----------

/** 「讲完了，看判定」（当场再讲问完了也走这里，只判那几处） */
export async function finish(path: string, id: string) {
  const r = roundOf(path, id)
  const l = ensureLive(path, id)
  if (!r) return
  const only = l.redo ?? undefined
  const req = reqSeq++
  patch(id, { input: null, thinking: { word: tNow('在评分：每条核心一个状态…'), req, judging: true }, hl: null, stream: '' })
  const text = textOf(path) ?? ''
  let res
  try {
    res = await window.cnFeynman.judge({ reqId: req, meta: r.meta, entries: entriesOf(r), today: today(), prevPasses: passesBefore(roundsIn([{ path, text }]), r.meta.topic, id), ...(only ? { only } : {}) })
  } catch (e) {
    if (lives.get(id)?.thinking?.req !== req) return
    patch(id, { thinking: null, input: only ? 'redo' : 'end', note: errText(e) })
    return
  }
  if (lives.get(id)?.thinking?.req !== req) return
  edit(path, (t) => {
    let n = setMeta(t, { ...res.meta, status: 'judged' })
    n = putBlock(n, id, 'verdict', res.blocks.verdict, res.by)
    n = putBlock(n, id, 'gaps', res.blocks.gaps, res.by)
    if (res.blocks.wording !== undefined) n = putBlock(n, id, 'wording', res.blocks.wording, res.by)
    if (res.blocks.full !== undefined) n = putBlock(n, id, 'full', res.blocks.full, res.by)
    return n
  })
  const still = only && !res.meta.redone
  patch(id, { thinking: null, input: null, redo: null, hl: null, peeking: false, note: still ? tNow('这几处还没讲清，缺口照旧；可以出卡，明天再讲。') : undefined })
}

// ---------- 缺口：出卡勾选、当场再讲 ----------

export function toggleCard(path: string, id: string, i: number) {
  writeMeta(path, id, (m) => ({ ...m, gaps: (m.gaps ?? []).map((g, k) => (k === i ? { ...g, card: !g.card } : g)) }))
}

/** 「再讲这几处」：当场只讲这几处，盖上材料 */
export function redo(path: string, id: string) {
  const r = roundOf(path, id)
  if (!r) return
  const pts = (r.meta.gaps ?? []).filter((g) => (g.kind === 'wrong' || g.kind === 'vague' || g.kind === 'missing') && !g.redone).map((g) => g.point)
  if (!pts.length) return
  listen()
  writeMeta(path, id, (m) => ({ ...m, status: 'talking' }))
  ensureLive(path, id)
  patch(id, { redo: pts, input: 'redo', note: undefined })
}

// ---------- 暂停、看一眼 ----------

/** esc：学生在想时先停下它；再按一次才暂停 */
export function esc(path: string, id: string): 'stopped' | 'paused' | null {
  const l = lives.get(id)
  if (l?.thinking) {
    void window.cnFeynman.stop(l.thinking.req)
    patch(id, { thinking: null, stream: '', input: l.thinking.judging ? (l.redo ? 'redo' : 'end') : l.redo ? 'redo' : 'reply', note: tNow('停下了：再按一次 esc 暂停') })
    return 'stopped'
  }
  const r = roundOf(path, id)
  if (r?.meta.status !== 'talking') return null
  pause(path, id)
  return 'paused'
}

export function pause(path: string, id: string) {
  const l = lives.get(id)
  if (l?.thinking) void window.cnFeynman.stop(l.thinking.req)
  writeMeta(path, id, (m) => ({ ...m, status: 'paused' }))
  if (l) patch(id, { thinking: null, stream: '', peeking: false, note: undefined })
}

/** 接着讲：再盖上，这次暂停记成看过一次材料（已定 5） */
export function resume(path: string, id: string) {
  listen()
  const l = ensureLive(path, id)
  writeMeta(path, id, resumed)
  const r = roundOf(path, id)
  const me = r?.entries.filter((e) => e.kind === 'me').length ?? 0
  const done = r?.meta.asked.at(-1)?.act === 'done' || (r?.entries.at(-1)?.kind !== 'me' && r?.meta.asked.length && !r.entries.at(-1)?.text.trim())
  const input: InputKind = l.redo ? 'redo' : me === 0 ? 'explain' : done ? 'end' : 'reply'
  patch(id, { input: l.input ?? input })
}

export function peek(id: string, on: boolean) {
  const l = lives.get(id)
  if (!l || l.peeking === on) return
  patch(id, { peeking: on })
  if (on) writeMeta(l.path, id, withPeek)
}

/** 一点点长出来的那段长完了 */
export const grown = (id: string) => lives.get(id)?.fresh != null && patch(id, { fresh: null })

// ---------- 盖住什么 ----------

export interface Covered {
  id: string
  path: string
  topic: string
  /** 白板上的卡（编号或开头的字） */
  cards: { id?: string; head: string }[]
  /** 导图的一支（pathKey 和字） */
  map: { node: string; text: string }[]
  web: string[]
  pdf: string[]
  peeking: boolean
}

/** 这一篇里正在讲的那一轮（status talking、这一次开软件里开讲的）要盖住的；重开软件后注释里还写着 talking 的当暂停：材料露着 */
export function coveredIn(path: string, text: string | null): Covered | null {
  if (text === null) return null
  const r = findRounds(text).find((x) => x.meta.status === 'talking' && lives.has(x.meta.id))
  return r ? coverOf(path, r) : null
}

function coverOf(path: string, r: RoundSection): Covered {
  const m = r.meta
  return {
    id: m.id,
    path,
    topic: m.topic,
    cards: m.cover.flatMap((c) => (c.kind === 'card' && c.path === path ? [{ ...(c.id ? { id: c.id } : {}), head: c.head }] : [])),
    map: m.from.flatMap((f) => (f.kind === 'map' && f.path === path ? [{ node: f.node, text: f.text }] : [])),
    web: m.cover.flatMap((c) => (c.kind === 'web' ? [c.url] : [])),
    pdf: [...m.cover.flatMap((c) => (c.kind === 'pdf' ? [c.path] : [])), ...m.from.flatMap((f) => (f.kind === 'pdf' ? [f.path] : []))],
    peeking: !!lives.get(m.id)?.peeking,
  }
}

/** 全软件正在讲的那一轮（网页和 PDF 盖不盖）：开着的文档里找 */
export function talkingNow(): Covered | null {
  for (const d of NoteDoc.open) {
    const c = coveredIn(d.path, d.text)
    if (c) return c
  }
  return null
}

/** 还没讲完的那一轮（讲着、暂停着；这一次开软件里开讲的）：右栏 AI 顶上那一句 */
export function openRound(): { id: string; topic: string } | null {
  for (const d of NoteDoc.open)
    for (const r of findRounds(d.text)) if ((r.meta.status === 'talking' || r.meta.status === 'paused') && lives.has(r.meta.id)) return { id: r.meta.id, topic: r.meta.topic }
  return null
}

/** 白板上一张卡算不算被盖住：编号对上，或者开头的字对上；id 是卡的编号（没编号的白板卡传 undefined） */
export function cardCovered(c: Covered | null, id: string | undefined, text: string): boolean {
  if (!c || c.peeking) return false
  const head = headOf(text)
  return c.cards.some((x) => (x.id && id ? x.id === id : false) || (!!x.head && (head === x.head || head.startsWith(x.head.slice(0, 20)))))
}

/** 网址比较：去掉 # 后面和结尾的 / */
export const sameUrl = (a: string, b: string) => a.replace(/#.*$/, '').replace(/\/$/, '') === b.replace(/#.*$/, '').replace(/\/$/, '')

/** 一时状态清掉（文档里的不动） */
export function forget(id: string) {
  const l = lives.get(id)
  if (l?.thinking) void window.cnFeynman.stop(l.thinking.req)
  lives = new Map(lives)
  lives.delete(id)
  bump()
}
