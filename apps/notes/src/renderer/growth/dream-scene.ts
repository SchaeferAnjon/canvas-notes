/**
 * 梦游前后小图的「戏」（动效照设计页 154 版本 A，2026-11-25 用户选）：这晚动过的几篇和一步以内的邻居（最多 40 篇），
 * 位置先用 d3-force 算好写死（重播、拖进度每次一样），再按报告里的条目排成几处：补双链、可能重复（合成一个）、挪文件夹、新词条。
 * 只算数，不画、不依赖 DOM：DreamReplay 拿去交给 Motion 排时间线、交给 force-graph 画。
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'
import type { DreamReport } from '../../shared/api'
import { folderLabel } from '../../shared/growth'
import type { Model } from './model'

export interface DNode {
  id: string
  title: string
  /** 顶层文件夹（群）：梦游前在哪 */
  group: string
  /** 颜色：areas 里的那一档（0–2 三种颜色，-1 灰） */
  color: number
  x: number
  y: number
  deg: number
  /** 梦游前出现的先后（0 起） */
  order: number
  /** 新词条：梦游后才有 */
  isNew?: boolean
  /** 挪去的文件夹里落到哪（可能重复的合成一个在时间线里按那时的位置算） */
  to?: { x: number; y: number }
  /** 挪走以后的颜色 */
  toColor?: number
}

export interface DEdge {
  a: string
  b: string
  kind: 'old' | 'new'
  /** 新线是第几处加的 */
  step?: number
  /** 收下了（画实线，没收下画虚线） */
  taken?: boolean
}

export type DStep =
  | { i: number; kind: 'link'; a: string; b: string; taken: boolean }
  | { i: number; kind: 'merge'; node: string; into: string }
  | { i: number; kind: 'move'; node: string; to: string }
  | { i: number; kind: 'new'; node: string; name: string; links: string[] }

export interface DreamScene {
  W: number
  H: number
  clusters: { name: string; x: number; y: number }[]
  nodes: DNode[]
  edges: DEdge[]
  steps: DStep[]
}

/** 小图最多画几篇（这晚动过的优先，再是连得多的邻居） */
export const MAX_NODES = 40
const NEW_ID = '\0new:'

const topOf = (p: string) => (p.includes('/') ? p.slice(0, p.indexOf('/')) : '')
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const titleOf = (p: string) => p.replace(/\.md$/i, '').split('/').pop()!

interface SimN extends SimulationNodeDatum {
  id: string
  group: string
}

/**
 * 报告 + 生长图数据 → 小图的戏。W 固定 480，H 按小图的宽高比给（左栏多宽都撑满）；
 * 报告里画不出来的条目（可视化、周记、附件、别名、复查）不进戏
 */
export function dreamScene(report: DreamReport, m: Model, aspect = 480 / 300): DreamScene {
  const W = 480
  const H = Math.round(W / Math.max(1.2, Math.min(3, aspect)))
  const d = m.d
  const byPath = new Map(d.notes.map((n, i) => [n.path, i]))
  // 收下了的挪动已经落进库里：报告里别的条目写的还是旧路径（补双链的那篇、可能重复的那篇），按挪动换成现在的
  const renamed = new Map<string, string>()
  for (const it of report.items) if (it.group === 'file' && it.move && it.state !== 'dropped') renamed.set(it.move.from, it.move.to)
  const now = (p: string | undefined) => (p && !byPath.has(p) && renamed.has(p) ? renamed.get(p)! : p)
  const has = (p: string | undefined): p is string => !!p && byPath.has(p)
  const steps: DStep[] = []
  const moveTo = new Map<string, string>()
  /** 挪的那篇梦游前在哪（收下了以后库里只有新路径） */
  const fromOf = new Map<string, string>()
  const newNodes: { id: string; name: string; links: string[] }[] = []
  for (const it of report.items) {
    if (it.state === 'dropped') continue
    const i = steps.length
    if ((it.group === 'link' || it.group === 'unsure') && it.commit) {
      const a = now(it.judged?.a.path ?? it.files[0])
      const b = now(it.judged?.b.path ?? it.wiki?.links[0]?.path)
      if (has(a) && has(b) && a !== b) steps.push({ i, kind: 'link', a, b, taken: it.state === 'taken' })
    } else if (it.group === 'file' && it.move) {
      const node = has(it.move.from) ? it.move.from : has(it.move.to) ? it.move.to : null
      if (node && dirOf(it.move.from) !== dirOf(it.move.to)) {
        steps.push({ i, kind: 'move', node, to: dirOf(it.move.to) })
        moveTo.set(node, it.move.to)
        fromOf.set(node, it.move.from)
      }
    } else if (it.group === 'dup' && it.files.length >= 2) {
      const a = now(it.files[0])
      const b = now(it.files[1])
      if (has(a) && has(b) && a !== b) steps.push({ i, kind: 'merge', node: a, into: b })
    } else if (it.group === 'entry' && it.entry) {
      const links = [...new Set(it.entry.notes.map(now))].filter(has).slice(0, 6)
      if (links.length) {
        const id = NEW_ID + it.entry.name
        steps.push({ i, kind: 'new', node: id, name: it.entry.name, links })
        newNodes.push({ id, name: it.entry.name, links })
      }
    }
  }
  const colorOfTop = (top: string) => d.areas.find((a) => a.dir === top)?.color ?? -1
  /** 梦游前在哪个顶层文件夹 */
  const topBefore = (p: string) => topOf(fromOf.get(p) ?? p)
  // 这晚动过的 + 一步以内的邻居
  const touched = new Set<string>()
  for (const s of steps) {
    if (s.kind === 'link') touched.add(s.a).add(s.b)
    else if (s.kind === 'merge') touched.add(s.node).add(s.into)
    else if (s.kind === 'move') touched.add(s.node)
    else for (const l of s.links) touched.add(l)
  }
  const keep = [...touched].slice(0, MAX_NODES)
  const kept = new Set(keep)
  // 动过的超过 40 篇（导入一大批、一晚挪几百篇）：画不下的那几篇的条目不进戏，后面按那一篇找位置、找节点就不会落空
  const drawn = steps.flatMap((s): DStep[] => {
    if (s.kind === 'link') return kept.has(s.a) && kept.has(s.b) ? [s] : []
    if (s.kind === 'merge') return kept.has(s.node) && kept.has(s.into) ? [s] : []
    if (s.kind === 'move') return kept.has(s.node) ? [s] : []
    const links = s.links.filter((l) => kept.has(l))
    return links.length ? [{ ...s, links }] : []
  })
  steps.splice(0, steps.length, ...drawn.map((s, i) => ({ ...s, i })))
  for (const p of [...moveTo.keys()]) if (!kept.has(p)) (moveTo.delete(p), fromOf.delete(p))
  newNodes.splice(0, newNodes.length, ...steps.flatMap((s) => (s.kind === 'new' ? [{ id: s.node, name: s.name, links: s.links }] : [])))
  const score = new Map<number, number>()
  for (const p of keep)
    for (const e of m.adj[byPath.get(p)!]!) {
      const l = d.links[e]!
      const o = l.a === byPath.get(p) ? l.b : l.a
      if (!kept.has(d.notes[o]!.path)) score.set(o, (score.get(o) ?? 0) + 1)
    }
  const nb = [...score].sort((x, y) => y[1] - x[1] || m.adj[y[0]]!.length - m.adj[x[0]]!.length || x[0] - y[0])
  for (const [o] of nb) {
    if (keep.length >= MAX_NODES) break
    keep.push(d.notes[o]!.path)
    kept.add(d.notes[o]!.path)
  }
  // 挪去的文件夹在小图里一篇都没有：从那儿挑两三篇，那一团才看得出来
  for (const [, to] of moveTo) {
    const top = topOf(to)
    if (keep.some((p) => topBefore(p) === top && !moveTo.has(p))) continue
    const pool = d.notes.map((n, i) => ({ n, i })).filter((x) => topOf(x.n.path) === top && !kept.has(x.n.path) && x.n.path !== to)
    pool.sort((a, b) => m.adj[b.i]!.length - m.adj[a.i]!.length || a.i - b.i)
    for (const x of pool.slice(0, 3)) {
      if (keep.length >= MAX_NODES + 3) break
      keep.push(x.n.path)
      kept.add(x.n.path)
    }
  }
  const nodes: DNode[] = keep.map((p) => {
    const n = d.notes[byPath.get(p)!]!
    const from = fromOf.get(p)
    return { id: p, title: titleOf(from ?? p), group: topBefore(p), color: from ? colorOfTop(topOf(from)) : (d.areas[n.area]?.color ?? -1), x: 0, y: 0, deg: 0, order: 0 }
  })
  // 梦游前的线（这晚补的那几条不算：收下了的也在库里了）
  const added = new Set<string>()
  const pair = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`)
  for (const s of steps) if (s.kind === 'link') added.add(pair(s.a, s.b))
  const edges: DEdge[] = []
  const seen = new Set<string>()
  for (const p of keep)
    for (const e of m.adj[byPath.get(p)!]!) {
      const l = d.links[e]!
      const a = d.notes[l.a]!.path
      const b = d.notes[l.b]!.path
      const k = pair(a, b)
      if (!kept.has(a) || !kept.has(b) || seen.has(k) || added.has(k)) continue
      seen.add(k)
      edges.push({ a, b, kind: 'old' })
    }
  // 出现的先后：按加进来的日子
  const born = (p: string) => d.notes[byPath.get(p)!]!.born
  ;[...nodes].sort((a, b) => born(a.id) - born(b.id) || a.id.localeCompare(b.id)).forEach((n, k) => (n.order = k))

  // ---- 位置：每一群一个落脚点，d3-force 排；挪的、新长的梦游后再找位置 ----
  // 小图是横的（报告里约 2:1）：三群以内横着一字排开（最大的在中间），再多绕一圈椭圆
  const groups = [...new Set([...nodes.map((n) => n.group), ...[...moveTo.values()].map(topOf)])]
  const size = (g: string) => nodes.filter((n) => n.group === g).length
  groups.sort((a, b) => size(b) - size(a) || a.localeCompare(b))
  const anchor = new Map<string, [number, number]>()
  const row = groups.length === 3 ? [groups[1]!, groups[0]!, groups[2]!] : groups
  row.forEach((g, i) => {
    if (groups.length <= 3) return anchor.set(g, [(W * (i + 1)) / (groups.length + 1), H / 2 + (i % 2 ? -1 : 1) * H * 0.06 * (groups.length > 1 ? 1 : 0)])
    const ang = Math.PI + (i / groups.length) * Math.PI * 2
    anchor.set(g, [W / 2 + Math.cos(ang) * W * 0.32, H / 2 + Math.sin(ang) * H * 0.28])
  })
  const run = (ns: SimN[], es: { source: string; target: string }[], ticks: number) => {
    const sim = forceSimulation(ns)
      .force('link', forceLink<SimN, { source: string; target: string }>(es).id((x) => x.id).distance(40).strength(0.5))
      .force('charge', forceManyBody<SimN>().strength(-40))
      .force('x', forceX<SimN>((x) => anchor.get(x.group)![0]).strength(0.12))
      .force('y', forceY<SimN>((x) => anchor.get(x.group)![1]).strength(0.16))
      .force('collide', forceCollide<SimN>(10))
      .stop()
    for (let k = 0; k < ticks; k++) sim.tick()
  }
  const before: SimN[] = nodes.map((n) => ({ id: n.id, group: n.group }))
  run(before, edges.map((e) => ({ source: e.a, target: e.b })), 300)
  const pos = new Map(before.map((n) => [n.id, { x: n.x!, y: n.y! }]))
  const after: SimN[] = before.map((n) => ({ id: n.id, group: n.group, x: n.x, y: n.y, fx: n.x, fy: n.y }))
  const ae = edges.map((e) => ({ source: e.a, target: e.b }))
  for (const [p, to] of moveTo) {
    const n = after.find((x) => x.id === p)!
    n.group = topOf(to)
    delete n.fx
    delete n.fy
    const [ax, ay] = anchor.get(n.group)!
    const same = topBefore(p) === n.group
    // 同一个顶层文件夹里挪（收件箱/a → 收件箱/b）：往旁边挪一截，看得出动了
    n.x = ax + (same ? 46 : 0)
    n.y = ay + (same ? -24 : 18)
  }
  for (const nn of newNodes) {
    const ps = nn.links.map((l) => pos.get(l)!)
    const cx = ps.reduce((s, q) => s + q.x, 0) / ps.length
    const cy = ps.reduce((s, q) => s + q.y, 0) / ps.length
    const g = nodes.find((x) => x.id === nn.links[0])!.group
    after.push({ id: nn.id, group: g, x: cx + 18, y: cy - 18 })
    for (const l of nn.links) ae.push({ source: nn.id, target: l })
  }
  if (moveTo.size || newNodes.length) run(after, ae, 200)
  const afterPos = new Map(after.map((n) => [n.id, { x: n.x!, y: n.y! }]))
  for (const n of nodes) Object.assign(n, pos.get(n.id))
  for (const [p, to] of moveTo) {
    const n = nodes.find((x) => x.id === p)!
    n.to = { ...afterPos.get(p)! }
    n.toColor = colorOfTop(topOf(to))
  }
  for (const nn of newNodes) {
    const g = nodes.find((x) => x.id === nn.links[0])!
    nodes.push({ id: nn.id, title: nn.name, group: g.group, color: g.color, ...afterPos.get(nn.id)!, deg: 0, order: nodes.length, isNew: true })
  }
  // 新线
  for (const s of steps) {
    if (s.kind === 'link') edges.push({ a: s.a, b: s.b, kind: 'new', step: s.i, taken: s.taken })
    if (s.kind === 'new') for (const l of s.links) edges.push({ a: s.node, b: l, kind: 'new', step: s.i })
  }
  // 撑满小图：所有位置（连挪去、并去的地方）一起缩进边距里；左右留出写名字的地方，上面留出角上那行字
  const pts = nodes.flatMap((n) => (n.to ? [n, n.to] : [n]))
  if (pts.length) {
    const x0 = Math.min(...pts.map((p) => p.x))
    const x1 = Math.max(...pts.map((p) => p.x))
    const y0 = Math.min(...pts.map((p) => p.y))
    const y1 = Math.max(...pts.map((p) => p.y))
    const mx = 80
    const top = 46
    // 下面留出「虚线是还没收下的」小图例那一行
    const bottom = 58
    const k = Math.min((W - 2 * mx) / Math.max(1, x1 - x0), (H - top - bottom) / Math.max(1, y1 - y0), 3)
    const ox = (W - (x1 - x0) * k) / 2
    const oy = top + (H - top - bottom - (y1 - y0) * k) / 2
    const done = new Set<object>()
    for (const p of pts) {
      if (done.has(p)) continue
      done.add(p)
      p.x = Math.round((ox + (p.x - x0) * k) * 10) / 10
      p.y = Math.round((oy + (p.y - y0) * k) * 10) / 10
    }
  }
  const deg = new Map<string, number>()
  for (const e of edges) {
    deg.set(e.a, (deg.get(e.a) ?? 0) + 1)
    deg.set(e.b, (deg.get(e.b) ?? 0) + 1)
  }
  for (const n of nodes) n.deg = deg.get(n.id) ?? 0
  // 群名挂在离那一团中间最近的那一篇上（画的时候写在它上方；不垫方框，偏好「生长图别垫方框」）；那一团只有挪进来的，就挂在挪去的地方
  const clusters: DreamScene['clusters'] = []
  for (const g of groups) {
    const mem = nodes.filter((n) => n.group === g && !n.isNew)
    const dest = [...moveTo].filter(([p, to]) => topOf(to) === g && topBefore(p) !== g).map(([p]) => nodes.find((x) => x.id === p)!.to!)
    const ps = mem.length ? mem : dest
    if (!ps.length) continue
    const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length
    const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length
    const at = ps.reduce((b, p) => ((p.x - cx) ** 2 + (p.y - cy) ** 2 < (b.x - cx) ** 2 + (b.y - cy) ** 2 ? p : b))
    clusters.push({ name: g ? folderLabel(g) : '', x: at.x, y: at.y })
  }
  return { W, H, clusters, nodes, edges, steps }
}
