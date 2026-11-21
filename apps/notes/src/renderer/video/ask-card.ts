/**
 * 框一块问的问框（task-sta8n，方向 A，原型 /private/tmp/canvas-notes-webbar/proto.html#dir=a；和旁支 A「就地展开」同一套样子）：
 * 框好一块 → 问框（框住那块的小图、带上前后字幕、四个建议、多行输入、谁来答 · 模型 · effort、记到哪）；
 * 回车：问框里就地长出回答（主进程边答边推），同时照旧写进文档的 AI 讲解块（光标处先出占位，答好换成问答块和 [!ai] 提示块，一次提交）；
 * 接着问也写进同一块讲解；「在 AI 标签里聊」把问答带去 AI 标签。问框的样子在 AskCard.tsx。
 */
import { EditorView } from '@codemirror/view'
import { useSyncExternalStore } from 'react'
import { aiErrorView } from '../../shared/ai-errors'
import { askCalloutEnd, askHead, type Dest, fmtTime } from '../../shared/video'
import type { Box } from '../../shared/video-api'
import { askDestNow, place, placeAsk, videoCardFor } from './actions'
import { beginAsk } from './ask-pending'
import { prepareDest } from './dest'
import { centerNow, clearBox, videoHost, videoStateOf } from './store'
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
  /** 记进了哪（第一问答好以后）：那一篇；只问不记是 'none' */
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

/**
 * 问（空着是「讲解这一块」）：第一问时按「记到哪」先开好那一篇、光标处出占位；问出去焦点回到视频（空格照样播放暂停）。
 * 答好：第一问那块问答写进文档（一次提交），接着问的接在那块讲解后面（一次提交）；只问不记的只在问框里
 */
export async function askCardQuestion(text: string, pick: VisionPick) {
  const c = state
  const st = c ? videoStateOf(c.wcId) : null
  const center = centerNow()
  if (!c || !st || !center || c.turns.some((t) => t.state === 'wait')) return
  const q = text.trim() || '讲解这一块'
  const s = c.seq
  const i = c.turns.length
  const first = i === 0
  const prior = c.turns.filter((t) => t.state === 'done').map((t) => ({ q: t.q, a: t.a }))
  patch(s, (x) => ({ turns: [...x.turns, { q, a: '', state: 'wait', by: '' }] }))
  // 焦点回到视频：空格照样暂停 / 播放（弹窗不抢焦点）
  videoHost()?.focus(c.wcId)
  let stopped = false
  let wait: ReturnType<typeof beginAsk> | null = null
  stopNow = () => {
    stopped = true
    wait?.end()
  }
  try {
    const want = first ? askDestNow(st) : c.saved && c.saved !== 'none' ? c.saved.dest : null
    let dest: Dest | null = want
    let from: string | null = null
    let inDoc = false
    let noteText = ''
    if (first && want) {
      // 「记到哪」是新建一篇、或是没起名的那篇：先建好 / 改好名（视频组的 prepareDest）
      const p = await prepareDest(want, st)
      dest = p.dest
      from = p.from
      const doc = center.doc()
      inDoc = dest.kind === 'doc' && !!doc && doc.path === dest.path && !doc.readOnly
      noteText = doc && doc.path === dest.path ? doc.text : ''
      wait = beginAsk({
        view: inDoc ? doc!.view : null,
        label: `AI正在看${c.t !== null ? fmtTime(c.t) : ''}这一帧…`,
        job: `AI在记笔记 · ${dest.title}`,
        onStop: stopAskCard,
      })
    }
    if (stopped) return
    const r = await window.cnVideo.ask({
      wcId: c.wcId,
      dest,
      box: c.box,
      question: q,
      noteText,
      ...(c.card !== null ? { card: c.card } : {}),
      subs: c.ctx,
      model: pick.model,
      ...(pick.effort ? { effort: pick.effort } : {}),
      ...(prior.length ? { prior } : {}),
    })
    if (stopped || state?.seq !== s) return
    patchTurn(s, i, { a: r.answer, state: 'done', by: r.by })
    if (first) {
      if (!dest) patch(s, { saved: 'none' })
      else {
        let path = dest.path
        if (dest.kind !== 'inbox') {
          const card = videoCardFor(st, dest)
          path = inDoc ? placeAsk(dest, st.key, r.block, card, wait?.pos() ?? null) : place(dest, st.key, r.block, card)
          await centerNow()?.doc()?.save()
          await window.cnVideo.commit([path, ...(from ? [from] : []), ...r.files], `视频：问 AI ${fmtTime(r.t)}《${st.title.slice(0, 40)}》→ ${dest.title}`, { wcId: c.wcId, t: r.t, note: dest.title, asked: true, text: q })
        }
        patch(s, { saved: { dest, path }, ...(r.image ? { image: r.image } : {}) })
        center.refresh()
      }
    } else if (dest && dest.kind !== 'inbox' && r.follow) {
      await appendFollow(dest, st.key, r.t, r.follow)
      await window.cnVideo.commit([dest.path], `视频：接着问 ${fmtTime(r.t)}《${st.title.slice(0, 40)}》→ ${dest.title}`, { wcId: c.wcId, t: r.t, note: dest.title, asked: true, text: c.turns[0]?.q ?? q })
      center.refresh()
    }
  } catch (e) {
    if (stopped) return
    patchTurn(s, i, { state: 'error', error: aiErrorView(errText(e), { id: 'claude', label: 'Claude Code' }).title })
  } finally {
    wait?.end()
    if (state?.seq === s) stopNow = null
  }
}

/** 接着问的那几行接在那块讲解后面：那一篇开着就在编辑器里插（光标不动），没开着直接改文件 */
async function appendFollow(dest: Dest, key: string, t: number, follow: string) {
  const doc = centerNow()?.doc()
  if (doc && doc.path === dest.path && !doc.readOnly) {
    const at = askCalloutEnd(doc.text, key, t)
    if (at < 0) throw new Error(`《${dest.title}》里找不到这一问的讲解了，接着问没记进去`)
    // 白板看法改的是同一段字（setText）；文档在编辑器里插，光标不动
    if (dest.kind === 'board') doc.setText(doc.text.slice(0, at) + '\n' + follow + doc.text.slice(at))
    else doc.view.dispatch({ changes: { from: at, insert: '\n' + follow }, userEvent: 'input.clip' })
    await doc.save()
    return
  }
  const cur = await window.cn.readNote(dest.path)
  const at = askCalloutEnd(cur.text, key, t)
  if (at < 0) throw new Error(`《${dest.title}》里找不到这一问的讲解了，接着问没记进去`)
  const w = await window.cn.writeNote(dest.path, cur.text.slice(0, at) + '\n' + follow + cur.text.slice(at), cur.text)
  if (!w.ok) throw new Error(`《${dest.title}》刚被改了，接着问没记进去，再问一次`)
}

/** 「已记进《…》›」：文档滚到那块问答（屏幕正中）、外圈闪一下；那一篇没开着就先在中间打开 */
export function goToSaved() {
  const c = state
  if (!c || !c.saved || c.saved === 'none') return
  const path = c.saved.path
  const center = centerNow()
  if (!center) return
  const doc = center.doc()
  if (!doc || doc.path !== path) {
    center.open(path)
    return
  }
  const view = doc.view
  const head = view.state.doc.toString().indexOf(askHead(c.key, c.t ?? 0))
  if (head < 0) return
  view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
  requestAnimationFrame(() => {
    const el = [...view.dom.querySelectorAll<HTMLElement>('[data-part="问答块"]')].find((x) => Math.abs(view.posAtDOM(x) - head) < 4)
    if (!el) return
    el.classList.remove('ak-flash')
    void el.offsetWidth
    el.classList.add('ak-flash')
  })
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
  await Reading.adoptVideoQa(`web:${pageUrl}`, { url: c.url, title: c.title, t: c.t ?? 0, ...(c.image ? { image: c.image } : {}), qa: done.map((t) => ({ q: t.q, a: t.a, by: t.by })) })
  centerNow()?.askInRight()
}
