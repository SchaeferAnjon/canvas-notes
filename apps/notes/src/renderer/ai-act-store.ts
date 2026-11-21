/**
 * AI 动手时在哪亮（DESIGN.v3 2.3，流光方向 A2）：主进程 ai:act 说的开始、只亮一处、去拿、做完 / 停下，记在这里；
 * 白板、文档、网页上的那层（ai-act.tsx）、文档里那一段（ai-spot.ts）、AI 输入框边上那一圈（composer.tsx）都读它。
 * 做完、停下以后还留一会儿：光收成一圈再淡掉，提示条换成「整理好了 · 挪了N张卡 · 撤回」1.8 秒后收起。
 * AI 没在动手时这里是空的，什么都不画、不跑。
 */
import type { AiAct, AiActArea } from '../shared/agent'
import type { ActTally } from '../shared/ai-act'

export interface ActEnd {
  stopped: boolean
  commit: string | null
  tally: ActTally
  /**
   * 收尾走到哪一步。整块做完：0 光加速跑 0.6 秒 → 1 整圈亮成一圈 0.4 秒 → 2 光淡掉、提示条「整理好了…撤回」1.8 秒 → 3 提示条退场；
   * 整块停下：2 光淡掉、「停下了 · 做完的N步留着」1.6 秒 → 3；只亮一处：1 那一圈停住 → 2 淡掉（停下的：那一处说「停下了」1.6 秒 → 3）
   */
  step: 0 | 1 | 2 | 3
  /** 点了提示条上的「撤回」 */
  undone?: boolean
}

export interface ActEntry {
  turn: number
  area: AiActArea
  path: string | null
  /** 整块亮（四边一道光、顶上提示条）；false 是只亮一处 */
  whole: boolean
  /** 按了停下，等这一步做完 */
  stopping: boolean
  /** 只亮一处时是哪几样（白板卡片的 id）；文档那一段由编辑器自己记 */
  spot: { ids: string[]; seq: number } | null
  end: ActEnd | null
}

export type Grab = Extract<AiAct, { kind: 'grab' }> & { seq: number }

let list: ActEntry[] = []
let grab: Grab | null = null
let version = 0
let seq = 0
const subs = new Set<() => void>()
const emit = () => {
  version++
  for (const f of subs) f()
}

export const actEntries = (): readonly ActEntry[] => list
export const actVersion = () => version
export const lastGrab = () => grab
export function onActs(f: () => void): () => void {
  wireActs()
  subs.add(f)
  return () => subs.delete(f)
}
/** 有没有正在动手的（还没做完的）：AI 输入框边上那圈光这时让给动手的地方 */
const acting = () => list.some((e) => !e.end)
/** 减少动态：光不走、不绕，只有不动的一圈 */
export const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const same = (a: ActEntry, b: { turn: number; area: AiActArea; path: string | null }) => a.turn === b.turn && a.area === b.area && a.path === b.path

function patch(e: ActEntry, p: Partial<ActEntry>) {
  list = list.map((x) => (x === e ? { ...x, ...p } : x))
  return list.find((x) => same(x, e))!
}

/** 收尾的几步；时间照原型 A（做完 0.65 → 1.05 → 2.85 → 3.15 秒；停下 1.6 → 1.9 秒；一处 0.25 → 1.5 秒） */
function finish(turn: number, end: Omit<ActEnd, 'step'>) {
  const rm = still()
  for (const e of list.filter((x) => x.turn === turn && !x.end)) {
    const key = { turn: e.turn, area: e.area, path: e.path }
    const at = (ms: number, step: ActEnd['step']) =>
      setTimeout(() => {
        const cur = list.find((x) => same(x, key))
        if (!cur?.end) return
        patch(cur, { end: { ...cur.end, step } })
        emit()
      }, ms)
    const drop = (ms: number) =>
      setTimeout(() => {
        const before = list.length
        list = list.filter((x) => !(same(x, key) && x.end))
        if (list.length !== before) emit()
      }, ms)
    if (e.whole && !end.stopped) {
      patch(e, { end: { ...end, step: rm ? 1 : 0 } })
      if (!rm) at(650, 1)
      at(rm ? 300 : 1050, 2)
      at(rm ? 2100 : 2850, 3)
      drop(rm ? 2400 : 3150)
    } else if (e.whole) {
      patch(e, { end: { ...end, step: 2 } })
      at(1600, 3)
      drop(1900)
    } else if (!end.stopped) {
      patch(e, { end: { ...end, step: 1 } })
      at(250, 2)
      drop(1500)
    } else {
      patch(e, { end: { ...end, step: 1 } })
      at(1600, 3)
      drop(1900)
    }
  }
}

function on(e: AiAct) {
  if (e.kind === 'start' || e.kind === 'spot') {
    // 同一块上一轮还在收尾：让给这一轮
    list = list.filter((x) => !(x.end && x.area === e.area && x.path === e.path))
    const cur = list.find((x) => same(x, e))
    const spot = e.kind === 'spot' && e.ids ? { ids: e.ids, seq: ++seq } : null
    if (!cur) list = [...list, { turn: e.turn, area: e.area, path: e.path, whole: e.kind === 'start', stopping: false, spot, end: null }]
    else if (e.kind === 'start') patch(cur, { whole: true, spot: null })
    else if (!cur.whole && spot) patch(cur, { spot })
  } else if (e.kind === 'grab') grab = { ...e, seq: ++seq }
  else {
    if (grab?.turn === e.turn) grab = null
    finish(e.turn, { stopped: e.stopped, commit: e.commit, tally: e.tally })
  }
  emit()
}

let wired = false
export function wireActs() {
  if (wired) return
  wired = true
  window.cn.onAiAct(on)
  // esc：AI 在动手时就是「停下」，比别处的 esc（关浮窗、关弹层）先接住
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing || !acting()) return
      e.preventDefault()
      e.stopImmediatePropagation()
      stopActing()
    },
    true,
  )
}

/** 按了停下（esc、提示条或那一处的「停下」）：这一轮当前这一步做完就停 */
export function stopActing() {
  const turns = [...new Set(list.filter((e) => !e.end).map((e) => e.turn))]
  if (!turns.length) return
  list = list.map((e) => (e.end ? e : { ...e, stopping: true }))
  emit()
  for (const t of turns) void window.cn.aiTurnStop(t)
}

/**
 * 提示条上的「撤回」：交给 AI 对话里这一轮的那条消息去撤（它的改动预览跟着变「已撤回」，不会撤两次）；
 * 那条消息不在（AI 标签关了）时直接撤这次提交
 */
export function undoActing(e: ActEntry) {
  if (!e.end?.commit || e.end.undone) return
  const ev = new CustomEvent('cn:ai-undo', { detail: { turn: e.turn, commit: e.end.commit }, cancelable: true })
  if (window.dispatchEvent(ev)) void window.cn.aiRevert(e.end.commit)
  const cur = list.find((x) => same(x, e))
  if (cur?.end) patch(cur, { end: { ...cur.end, undone: true } })
  emit()
}
