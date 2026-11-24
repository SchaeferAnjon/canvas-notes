/**
 * 梦游报告的「现在看哪一条」（task-m552v）：左栏报告、中间的梦游对照、目录树（这条改的文件后面一个小点、没收下的可视化）共用一份，
 * 不一层层传 props。最新的报告也在这里（订主进程的 dream:changed，和 App 的 useDream 是同一份数）。
 * 收下、丢掉、撤回、打开一条这几件事 App 登记跑法（setDreamActs），哪里点的都走同一条路。
 */
import { useSyncExternalStore } from 'react'
import type { DreamItem, DreamReport } from '../../shared/api'
import { nextPending, stepFrom } from '../../shared/dream-order'
import { ipcOn } from '../crash/ipc'

export interface DreamActs {
  /** 中间开这一条（focus：开到它的哪个文件） */
  open(id: string, focus?: string): void
  /** 做完给新报告（没做成是 null，原因已经在底栏说了） */
  take(it: DreamItem): Promise<DreamReport | null>
  drop(it: DreamItem): Promise<DreamReport | null>
  undo(it: DreamItem): Promise<DreamReport | null>
}

interface State {
  report: DreamReport | null
  /** 现在看的这一条（左栏高亮、展开小卡；中间开着的那条） */
  cur: string | null
  /** 中间开着它的哪个文件（左栏小卡里那一行左边一道竖线） */
  file: string | null
  /** 打开过的（顶上进度「看过」），按报告的分支记在本机 */
  seen: ReadonlySet<string>
}

let state: State = { report: null, cur: null, file: null, seen: new Set() }
const subs = new Set<() => void>()
const emit = (s: Partial<State>) => {
  state = { ...state, ...s }
  for (const f of subs) f()
}
let acts: DreamActs | null = null

const seenKey = (r: DreamReport) => `cn.dreamSeen.${r.branch}.${r.started}`
function loadSeen(r: DreamReport | null): Set<string> {
  if (!r) return new Set()
  try {
    const v = JSON.parse(localStorage.getItem(seenKey(r)) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

let started = false
/** 头一次有人用时去要报告、订变化 */
function start() {
  if (started || typeof window === 'undefined' || !window.cn?.onDream) return
  started = true
  void window.cn.dreamReport().then((r) => setReport(r))
  ipcOn(window.cn.onDream, 'cn.onDream')((r) => setReport(r))
}

export function setReport(r: DreamReport | null) {
  const same = r && state.report && r.branch === state.report.branch && r.started === state.report.started
  emit({ report: r, seen: same ? state.seen : loadSeen(r), ...(r && state.cur && !r.items.some((i) => i.id === state.cur) ? { cur: null } : {}) })
}

export function useDreamNav(): State {
  start()
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => state,
  )
}

export const dreamNow = () => state

/** 现在看这一条（中间开了它、左栏点了它）：记成看过 */
export function setCur(id: string | null) {
  if (id === state.cur && (!id || state.seen.has(id))) return
  const seen = id && !state.seen.has(id) ? new Set([...state.seen, id]) : state.seen
  if (id && seen !== state.seen && state.report)
    try {
      localStorage.setItem(seenKey(state.report), JSON.stringify([...seen]))
    } catch {
      // 记不住看过哪几条不影响使用
    }
  emit({ cur: id, seen })
}

/** 中间开着这一条的哪个文件 */
export function setCurFile(path: string | null) {
  if (path !== state.file) emit({ file: path })
}

export const setDreamActs = (a: DreamActs | null) => (acts = a)
export const dreamActs = () => acts

/** 打开一条：中间开它、左栏跟着亮（自己点开了哪条，收下后那 0.7 秒的往下走就作罢） */
export function openDream(id: string, focus?: string) {
  holdAdvance()
  setCur(id)
  acts?.open(id, focus)
}

/** J / K：下一条、上一条（到头了不动） */
export function stepDream(d: 1 | -1) {
  const items = state.report?.items ?? []
  const n = stepFrom(items, state.cur, d)
  if (n) openDream(n.id)
}

let advance: ReturnType<typeof setTimeout> | undefined
/** 收下后那 0.7 秒里点了哪儿（打开这一篇、撤回、换个文件……）：不往下走了 */
function holdAdvance() {
  clearTimeout(advance)
  advance = undefined
  window.removeEventListener('pointerdown', holdAdvance, true)
}
/**
 * 收下、丢掉一条以后：0.7 秒后往下走到下一条没处理的（下面都处理完了才绕回上面），不跳回第一条（task-m552v）；
 * 这 0.7 秒里看了别的、点了哪儿就不动（不然刚点开的那篇会被拉走）
 */
export function advanceFrom(id: string) {
  holdAdvance()
  window.addEventListener('pointerdown', holdAdvance, true)
  advance = setTimeout(() => {
    holdAdvance()
    if (state.cur !== id) return
    const n = nextPending(state.report?.items ?? [], id)
    if (n) openDream(n.id)
  }, 700)
}

/** 收下、丢掉现在这一条（左栏、中间的按钮和 ⌘↵ ⌘⌫ 都走这里），做完往下走一条 */
export async function actOn(kind: 'take' | 'drop', it: DreamItem) {
  if (!acts || it.state !== 'pending') return
  const r = await acts[kind](it)
  if (r) setReport(r)
  const now = (r ?? state.report)?.items.find((i) => i.id === it.id)
  if (now && now.state !== 'pending') advanceFrom(it.id)
}

export async function undoItem(it: DreamItem) {
  if (!acts) return
  const r = await acts.undo(it)
  if (r) setReport(r)
}
