/**
 * 梦游前后小图的时间线（设计页 154 版本 A）：先按加进来的先后长出梦游前，停一下，再一处一处讲（前 4 处一处 1.4 秒，
 * 名字先淡入，动作 0.7 秒，停一下再淡出），超过 4 处的其余一起画上，最后停在梦游后。
 * 这里只出「谁、哪个值、从几到几、第几秒、多久、什么缓动」的表（不依赖动画库），DreamReplay 原样交给 Motion 的 animate() 播。
 */
import type { DreamScene } from './dream-scene'

export const T = { grow: 1.2, hold: 1.8, step: 1.4, lin: 0.15, act: 0.7, lout: 0.15, one: 4, batch: 0.7 }
/** 讲的时候别的退到多淡 */
export const DIM = 0.22

/** 每个点动起来的值：大小 s、位置、名字 lab、正在讲它 f、原处空心圈 ghost（画在 gx, gy）、挪过去了 mv、新点外圈 ring、名字写在哪一侧 */
export interface NodeState {
  s: number
  x: number
  y: number
  lab: number
  f: number
  ghost: number
  gx: number
  gy: number
  mv: number
  ring: number
  side: 1 | -1
}
export interface EdgeState {
  p: number
  sign: 1 | -1
}

export interface Tween {
  target: object
  values: Record<string, [number, number]>
  at: number
  duration: number
  ease: 'spring' | 'out' | 'in' | 'inout' | 'linear'
  bounce?: number
}

export interface Timeline {
  ns: Map<string, NodeState>
  es: EdgeState[]
  bg: { dim: number }
  tw: Tween[]
  /** 播完是第几秒 */
  end: number
  /** 第几处从第几秒开始讲 */
  stepAt: (i: number) => number
}

export function dreamTimeline(sc: DreamScene): Timeline {
  const byId = new Map(sc.nodes.map((n) => [n.id, n]))
  const n1 = Math.min(T.one, sc.steps.length)
  const batchAt = T.hold + n1 * T.step
  const stepAt = (i: number) => (i < T.one ? T.hold + i * T.step + T.lin : batchAt)
  const stepDur = (i: number) => (i < T.one ? T.act : T.batch)
  const old = sc.nodes.filter((n) => !n.isNew)
  const bornAt = (order: number) => 0.05 + (order / Math.max(1, old.length - 1)) * (T.grow - 0.45)
  const ns = new Map<string, NodeState>(sc.nodes.map((n) => [n.id, { s: 0, x: n.x, y: n.y, lab: 0, f: 0, ghost: 0, gx: n.x, gy: n.y, mv: 0, ring: 0, side: n.x > sc.W * 0.75 ? -1 : 1 }]))
  const es: EdgeState[] = sc.edges.map((_, i) => ({ p: 0, sign: i % 2 ? 1 : -1 }))
  const bg = { dim: 1 }
  const tw: Tween[] = []
  const add = (target: object, values: Tween['values'], at: number, duration: number, ease: Tween['ease'], bounce?: number) => tw.push({ target, values, at, duration, ease, ...(bounce !== undefined ? { bounce } : {}) })
  const N = (id: string) => ns.get(id)!
  // 一篇这一处开始时在哪（先挪了再被合并的，从挪到的地方合过去）
  const cur = new Map(sc.nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
  // 字写在离这一处的线、去处远的那一侧
  const side = (id: string, other: { x: number }) => (N(id).side = other.x > byId.get(id)!.x ? -1 : 1)
  for (const n of old) add(N(n.id), { s: [0, 1] }, bornAt(n.order), 0.5, 'spring', 0.45)
  sc.edges.forEach((e, i) => {
    if (e.kind === 'old') add(es[i]!, { p: [0, 1] }, Math.max(bornAt(byId.get(e.a)!.order), bornAt(byId.get(e.b)!.order)) + 0.12, 0.4, 'out')
  })
  if (sc.steps.length) add(bg, { dim: [1, DIM] }, T.hold, 0.3, 'inout')
  sc.steps.forEach((s, i) => {
    const at = stepAt(i)
    const dur = stepDur(i)
    const one = i < T.one
    const ends = s.kind === 'link' ? [s.a, s.b] : s.kind === 'merge' ? [s.node, s.into] : s.kind === 'move' ? [s.node] : [s.node, ...s.links]
    if (s.kind === 'link') {
      side(s.a, byId.get(s.b)!)
      side(s.b, byId.get(s.a)!)
    }
    if (s.kind === 'merge') side(s.into, byId.get(s.node)!)
    if (s.kind === 'move') side(s.node, byId.get(s.node)!.to!)
    if (s.kind === 'new') {
      const me = byId.get(s.node)!
      const cx = s.links.reduce((a, id) => a + byId.get(id)!.x, 0) / s.links.length
      N(s.node).side = cx > me.x ? -1 : 1
      for (const id of s.links) side(id, me)
    }
    if (one)
      for (const id of ends) {
        // 被并掉那篇不写名字（两个名字叠在一起），只写并进去的那篇；旁白里写了是谁
        const quiet = s.kind === 'merge' && id === s.node
        add(N(id), { lab: [0, quiet ? 0 : 1], f: [0, 1] }, at - T.lin, T.lin, 'linear')
        add(N(id), { lab: [quiet ? 0 : 1, 0] }, at + dur + 0.35, T.lout, 'linear')
        add(N(id), { f: [1, 0] }, at + dur + 0.35, T.lout, 'linear')
      }
    else
      for (const id of ends) {
        add(N(id), { f: [0, 1] }, at, 0.2, 'linear')
        add(N(id), { f: [1, 0] }, at + dur, 0.3, 'linear')
      }
    if (s.kind === 'link') {
      const k = sc.edges.findIndex((e) => e.kind === 'new' && e.step === s.i)
      add(es[k]!, { p: [0, 1] }, at, dur, 'inout')
    }
    const mover = s.kind === 'merge' || s.kind === 'move' ? s.node : null
    const from = mover ? cur.get(mover)! : null
    if (mover && from) {
      // 原处的空心虚圈：动的时候在（画在这一处开始时的位置），落定以后 0.6 秒内淡掉
      const g = N(mover)
      add(g, { gx: [g.gx, from.x], gy: [g.gy, from.y] }, at, 0.01, 'linear')
      g.gx = from.x
      g.gy = from.y
      add(g, { ghost: [0, 1] }, at, 0.2, 'linear')
      add(g, { ghost: [1, 0] }, at + dur + 0.2, 0.4, 'linear')
    }
    if (s.kind === 'merge') {
      const a = from!
      const b = cur.get(s.into)!
      add(N(s.node), { x: [a.x, b.x], y: [a.y, b.y] }, at, dur, 'inout')
      cur.set(s.node, { ...b })
      add(N(s.node), { s: [1, 0] }, at + dur * 0.7, dur * 0.3, 'linear')
      add(N(s.into), { s: [1, 1.4] }, at + dur * 0.75, 0.18, 'out')
      add(N(s.into), { s: [1.4, 1] }, at + dur * 0.75 + 0.18, 0.5, 'spring', 0.5)
    }
    if (s.kind === 'move') {
      // 沿弧线走：横着匀着走，竖着先往上再落下
      const a = from!
      const to = byId.get(s.node)!.to!
      cur.set(s.node, { ...to })
      // 上面留不出弧（会顶到左上角那行字、出小图）就往下弯
      const up = Math.min(a.y, to.y) - 40
      const top = up >= 50 ? up : Math.min(sc.H - 30, Math.max(a.y, to.y) + 40)
      add(N(s.node), { x: [a.x, to.x] }, at, dur, 'inout')
      add(N(s.node), { y: [a.y, top] }, at, dur / 2, 'out')
      add(N(s.node), { y: [top, to.y] }, at + dur / 2, dur / 2, 'in')
      add(N(s.node), { mv: [0, 1] }, at + dur / 2, 0.01, 'linear')
    }
    if (s.kind === 'new') {
      add(N(s.node), { s: [0, 1], ring: [0, 1] }, at, 0.55, 'spring', 0.5)
      sc.edges.forEach((e, k) => {
        if (e.kind === 'new' && e.step === s.i) add(es[k]!, { p: [0, 1] }, at + 0.2 + 0.07 * (k % 4), 0.45, 'inout')
      })
    }
  })
  if (sc.steps.length) add(bg, { dim: [DIM, 1] }, batchAt + (sc.steps.length > T.one ? T.batch : 0), 0.35, 'inout')
  // 停在梦游后：最后一个动作做完再停 0.4 秒（最后一格占位，时间线一直排到 end）
  const end = Math.max(batchAt + (sc.steps.length > T.one ? T.batch : 0) + 0.4, ...tw.map((w) => w.at + w.duration + 0.1))
  add(bg, { dim: [1, 1] }, end - 0.05, 0.05, 'linear')
  return { ns, es, bg, tw, end, stepAt }
}

/** 停在第几秒是哪一段：梦游前、第 i 处、其余一起、梦游后 */
export function phaseAt(sc: DreamScene, tl: Timeline, t: number): { kind: 'before' } | { kind: 'step'; i: number } | { kind: 'rest' } | { kind: 'after' } {
  if (!sc.steps.length || t < T.hold) return t >= tl.end - 0.2 && sc.steps.length ? { kind: 'after' } : { kind: 'before' }
  const n1 = Math.min(T.one, sc.steps.length)
  for (let i = 0; i < n1; i++) {
    const s0 = T.hold + i * T.step
    if (t >= s0 && t < s0 + T.step) return { kind: 'step', i }
  }
  if (t < tl.end - 0.2 && sc.steps.length > T.one) return { kind: 'rest' }
  return { kind: 'after' }
}
