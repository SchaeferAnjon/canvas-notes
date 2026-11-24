/**
 * 框一块问的问框（task-sta8n，方向 A，原型 /private/tmp/canvas-notes-webbar/proto.html#dir=a；和旁支 A「就地展开」同一套样子）：
 * 框好一块 → 问框（框住那块的小图、带上前后字幕、四个建议、多行输入、谁来答 · 模型 · effort、记到哪）；
 * 回车：问框里就地长出回答（主进程边答边推）。答好一问记一问进「记到哪」那篇下面挂的那篇本身
 * （2026-11-24 方向 A，shared/ai-note.ts：小标题是视频名、一问一个小标题、框住那块的小图、回到那一秒的来源行、一块 AI 回答；
 * 视频的「记笔记」关着、「记到哪」选了只问不记就不记，按第一问发问那一刻定）；「在 AI 标签里聊」把问答带去 AI 标签。问框的样子在 AskCard.tsx。
 */
import { type DocAiBlock, docAiBlocks, parseChatLink, webSrc } from '@cn/format'
import { useSyncExternalStore } from 'react'
import { type Dest, fmtTime, timeUrl, videoOf } from '../../shared/video'
import type { Box } from '../../shared/video-api'
import { writeAskInto } from '../web-notes/flow'
import { readKey } from '../../shared/ai-chats'
import { titleOf } from '../../shared/layout'
import { withoutEffort } from '../../shared/ai-features'
import { askDestNow } from './actions'
import { videoParent } from './note-parent'
import { centerNow, clearBox, videoHost, videoStateOf } from './store'
import { noteSwitchNow } from '../ai-note-switch'
import * as Reading from '../reading/store'

const errText = (e: unknown) => String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 问框里的一问：问的话、已经到了的回答（边答边长）、在等 / 答好 / 出错 */
export interface AskTurn {
  q: string
  a: string
  state: 'wait' | 'done' | 'error'
  error?: string
  /** 谁答的「Claude Code · Opus 5.5 · Low」 */
  by: string
  /** 这一问的编号：记进笔记时「回到 AI 对话」认它，带去 AI 标签时那条回答照用 */
  id: number
}

export interface AskCardState {
  /** 每开一次加一（React 的 key、晚到的结果认人） */
  seq: number
  wcId: number
  key: string
  url: string
  title: string
  box: Box
  /** 框的时候视频在网页里的位置（问框贴着视频下沿） */
  rect: { x: number; y: number; w: number; h: number }
  /** 主进程截好的那一帧（问、接着问、想建议都用它）；还没截好是 null */
  card: number | null
  t: number | null
  thumb: string | null
  /** 小活现想的两颗建议（还没想好、想不出是空的） */
  sugg: string[]
  /** 带上前后字幕 */
  ctx: boolean
  turns: AskTurn[]
  /** 记进了哪（第一问答好以后）：「记到哪」那篇（dest 是它自己，显示名字用）；只问不记是 'none' */
  saved: { dest: Dest; path: string } | 'none' | null
  /** 第一问记进笔记时那一帧存在库里的哪（带去 AI 标签时附上） */
  image?: string
  /** 截帧出错（视频没在放、网页关了） */
  error?: string
}

let state: AskCardState | null = null
let seq = 0
const subs = new Set<() => void>()
const set = (next: AskCardState | null) => {
  state = next
  subs.forEach((f) => f())
}
const patch = (s: number, p: Partial<AskCardState> | ((c: AskCardState) => Partial<AskCardState>)) => {
  if (!state || state.seq !== s) return
  set({ ...state, ...(typeof p === 'function' ? p(state) : p) })
}
const patchTurn = (s: number, i: number, p: Partial<AskTurn>) => patch(s, (c) => ({ turns: c.turns.map((t, j) => (j === i ? { ...t, ...p } : t)) }))

export const askCardNow = () => state

/**
 * 旁支（task-4edsc「旁支就地展开」）接问框的回答用：第 i 问的问话、回答、哪个视频第几秒、那一帧（库里的路径，只问不记时没有）、记进了哪一篇。
 * 回答那块在 AskCard.tsx 里是 .ak-an[data-side-host="video-ask"][data-turn=i]
 */
export function askTurnFor(i: number): { q: string; a: string; url: string; title: string; t: number; image?: string; note?: string } | null {
  const c = state
  const turn = c?.turns[i]
  if (!c || !turn || turn.state !== 'done') return null
  return { q: turn.q, a: turn.a, url: c.url, title: c.title, t: c.t ?? 0, ...(c.image ? { image: c.image } : {}), ...(c.saved && c.saved !== 'none' ? { note: c.saved.path } : {}) }
}
/** 那一问记进笔记的那块 [!ai]（块头「回到 AI 对话」链接里是这一问的编号）：旁支挂在它下面（task-p90ra）；找不到是 null */
export function findAskBlock(text: string, msg: number): DocAiBlock | null {
  const lines = text.split('\n')
  return (
    docAiBlocks(text).find((b) => {
      for (const m of (lines[b.head] ?? '').matchAll(/\]\((canvas-notes:\/\/chat\?[^)\s]+)\)/g)) if (parseChatLink(m[1]!)?.msg === msg) return true
      return false
    }) ?? null
  )
}

export function useAskCard(): AskCardState | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
}

// 主进程边答边推来的回答：认那一帧的编号
let listening = false
function listen() {
  if (listening || !window.cnVideo) return
  listening = true
  window.cnVideo.onAskText((card, text) => {
    const c = state
    if (!c || c.card !== card) return
    const i = c.turns.length - 1
    if (i >= 0 && c.turns[i]!.state === 'wait') patchTurn(c.seq, i, { a: text })
  })
}

/** ⌥D、视频那一行的「框一块问」：画面变成拖框（开着的问框先收起，同原型的 startBox）；拖框的线用主题的强调色 */
export function startAsk(wcId: number) {
  closeAskCard()
  const acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim()
  const h = videoHost()
  h?.cmd(wcId, 'box', acc || undefined)
  // 焦点交给视频网页：esc 取消拖框（网页预加载接），拖完问框再把焦点拿到输入框
  h?.focus(wcId)
  // 焦点还在软件里时按 esc 也取消拖框（框好了、开了问框以后不再管）
  boxingWc = wcId
  if (!escHooked) {
    escHooked = true
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || boxingWc === null || e.isComposing) return
        e.preventDefault()
        videoHost()?.cmd(boxingWc, 'boxDone')
        boxingWc = null
      },
      true,
    )
  }
}
/** 在拖框的那个网页（问框还没开）；问框开了、拖框取消了是 null */
let boxingWc: number | null = null
let escHooked = false
/** 网页里按 esc 取消了拖框（网页报来的） */
export const boxCanceled = () => {
  boxingWc = null
}
/** 拖框中途换了网页标签：那边的拖框收掉 */
export function cancelBoxing() {
  if (boxingWc === null) return
  videoHost()?.cmd(boxingWc, 'boxDone')
  boxingWc = null
}

/** 框好了（网页报来框的位置）：开问框，截那一帧、做小图，小活现想两颗建议 */
export function openAskCard(wcId: number, box: Box, rect: { x: number; y: number; w: number; h: number }) {
  listen()
  boxingWc = null
  const st = videoStateOf(wcId)
  if (!st) return
  const s = ++seq
  set({ seq: s, wcId, key: st.key, url: watchOf(st), title: st.title, box, rect, card: null, t: null, thumb: null, sugg: [], ctx: true, turns: [], saved: null })
  void window.cnVideo
    .peek({ wcId, box })
    .then(async (p) => {
      patch(s, { card: p.card, t: p.t, thumb: p.thumb })
      const sugg = await window.cnVideo.suggest(p.card)
      patch(s, (c) => (c.turns.length ? {} : { sugg }))
    })
    .catch((e) => patch(s, { error: errText(e) }))
}

const watchOf = (st: { site: string; id: string; p?: number }) =>
  st.site === 'youtube' ? `https://www.youtube.com/watch?v=${st.id}` : `https://www.bilibili.com/video/${st.id}${st.p && st.p > 1 ? `?p=${st.p}` : ''}`

export function setAskCtx(on: boolean) {
  if (state) patch(state.seq, { ctx: on })
}

/** 收起问框、拿掉画面上的框；在答的那一问一起停下（文档里不留半截） */
export function closeAskCard() {
  const c = state
  if (!c) return
  if (c.turns.some((t) => t.state === 'wait')) stopAskCard()
  else {
    set(null)
    videoHost()?.cmd(c.wcId, 'boxDone')
    clearBox()
  }
}

/** 在答时停下（问框里「停下 esc」、文档占位上的、在网页里按 esc）：这一问不记 */
let stopNow: (() => void) | null = null
export function stopAskCard() {
  const c = state
  if (!c) return
  stopNow?.()
  stopNow = null
  void window.cnVideo.askStop(c.wcId)
  set(null)
  videoHost()?.cmd(c.wcId, 'boxDone')
  clearBox()
  centerNow()?.notice('停下了，这一问没记')
}

/** 选的模型、effort（问框底下那两颗；看图问只有 Claude Code） */
export interface VisionPick {
  model: string
  effort?: string
}

let turnSeq = Date.now()

/**
 * 问（空着是「讲解这一块」）：问出去焦点回到视频（空格照样播放暂停）。
 * 答好：记一问进「记到哪」那篇本身（中间看得见插在光标处，不然接在末尾）（第一问带框住那块的小图，一次提交；收件箱那篇还没有时先建好）；只问不记的只在问框里
 */
export async function askCardQuestion(text: string, pick: VisionPick, pageUrl = '') {
  const c = state
  const st = c ? videoStateOf(c.wcId) : null
  const center = centerNow()
  if (!c || !st || !center || c.turns.some((t) => t.state === 'wait')) return
  const q = text.trim() || '讲解这一块'
  const s = c.seq
  const i = c.turns.length
  const first = i === 0
  const id = ++turnSeq
  const prior = c.turns.filter((t) => t.state === 'done').map((t) => ({ q: t.q, a: t.a }))
  patch(s, (x) => ({ turns: [...x.turns, { q, a: '', state: 'wait', by: '', id }] }))
  // 焦点回到视频：空格照样暂停 / 播放（弹窗不抢焦点）
  videoHost()?.focus(c.wcId)
  let stopped = false
  stopNow = () => {
    stopped = true
  }
  try {
    // 记不记按第一问发问那一刻定：视频的「记笔记」开着、「记到哪」不是只问不记；接着问的跟第一问
    const record = first ? noteSwitchNow('video').main && !!askDestNow(st) : !!c.saved && c.saved !== 'none'
    const r = await window.cnVideo.ask({
      wcId: c.wcId,
      dest: null,
      ...(record ? { keep: true } : {}),
      box: c.box,
      question: q,
      noteText: '',
      ...(c.card !== null ? { card: c.card } : {}),
      subs: c.ctx,
      model: pick.model,
      ...(pick.effort ? { effort: pick.effort } : {}),
      ...(prior.length ? { prior } : {}),
    })
    if (stopped || state?.seq !== s) return
    patchTurn(s, i, { a: r.answer, state: 'done', by: r.by })
    if (!record) {
      if (first) patch(s, { saved: 'none' })
      return
    }
    const was = state.saved && state.saved !== 'none' ? state.saved.path : null
    // 写进「记到哪」那篇本身（偏好「剪藏和AI笔记同一篇」）：中间看得见那篇插在光标处，不然接在末尾
    const note = was ?? (await videoParent(c.url, st.title))
    if (!note) {
      patch(s, { saved: 'none' })
      return
    }
    const v = videoOf(c.url)
    const res = await window.cnReading.noteAppend({
      note,
      ask: {
        // 和「在 AI 标签里聊」带过去的那段对话同一个（右栏网页的网址）
        key: readKey(`web:${pageUrl || c.url}`),
        msg: id,
        q,
        a: r.answer,
        by: withoutEffort(r.by),
        ...(first && r.image ? { crop: { path: r.image } } : {}),
        src: webSrc(note, `▶ ${fmtTime(r.t)} · ${c.title}`, v ? timeUrl(v, r.t) : c.url),
      },
      place: { heading: c.title },
      inline: true,
      files: first && r.image ? [r.image] : [],
    })
    if (res.md !== undefined) await writeAskInto(res.note, res.md, { files: res.files ?? [], subject: q })
    // 视频条刻度上记一个「问过」的空心圆（只记这一刻，不再提交：上面已经提交过了）
    if (first) await window.cnVideo.commit([], '', { wcId: c.wcId, t: r.t, note: titleOf(res.note), asked: true, text: q })
    if (state?.seq === s) patch(s, { saved: { dest: { kind: 'doc', path: res.note, title: titleOf(res.note) }, path: res.note }, ...(r.image ? { image: r.image } : {}) })
    center.refresh()
  } catch (e) {
    if (stopped) return
    // 原话存着：问框里 AiError 认原因、写一句中文，原话收进「看原话」（task-eavzx）
    patchTurn(s, i, { state: 'error', error: errText(e) })
  } finally {
    if (state?.seq === s) stopNow = null
  }
}

/** 「再问一次」之前：没答出来的最后那一问拿掉（重问的还是那一问，第一问没答出来时照样记进笔记） */
export function dropFailedTurn() {
  const c = state
  if (!c || c.turns[c.turns.length - 1]?.state !== 'error') return
  patch(c.seq, (x) => ({ turns: x.turns.slice(0, -1) }))
}

/** 「已记进《…》›」：在中间打开记进的那篇 */
export function goToSaved() {
  const c = state
  if (!c || !c.saved || c.saved === 'none') return
  centerNow()?.open(c.saved.path)
}

/**
 * 「在 AI 标签里聊」：问答都带去 AI 标签（这个视频的那一份对话，web:<网址>）：几问几答照原样摆成消息，第一问带着框的那一帧；
 * 接着在 AI 标签里问，接的就是这一处（AI 看得到那一帧、那几问和回答、前后字幕）
 */
export async function chatInAiTab(pageUrl: string) {
  const c = state
  if (!c) return
  const done = c.turns.filter((t) => t.state === 'done')
  if (!done.length) return
  await Reading.adoptVideoQa(`web:${pageUrl}`, { url: c.url, title: c.title, t: c.t ?? 0, ...(c.image ? { image: c.image } : {}), ...(c.saved && c.saved !== 'none' ? { note: c.saved.path } : {}), qa: done.map((t) => ({ q: t.q, a: t.a, by: t.by, id: t.id })) })
  centerNow()?.askInRight()
}
