/**
 * 生长图在界面这一头要的（task-h7oy8）：数据到了先整理一次（按出生排、按天排、邻接、文件夹、点选用的格子），
 * 之后每一帧（拖时间轴、播放）只按「这一天、这个文件夹、选中谁、只看周围」算哪些亮、哪些淡、每篇几条线，几千篇不到一毫秒。
 * 点选、拖、缩放交给 force-graph（graph.ts）。
 */
import { type GrowthData, type GrowthNight, GROUP_LABEL_MIN } from '../../shared/growth'

export interface Model {
  d: GrowthData
  /** 时间轴从哪天到哪天 */
  start: number
  end: number
  /** 有事的日子（有笔记加进来、有梦游、有链接长出来），播放时空着的日子跳过 */
  events: number[]
  /** 每天库里一共几篇（时间轴的灰底曲线）：cum[d - start] */
  cum: Int32Array
  /** 每篇连着的链接（links 的下标） */
  adj: number[][]
  nightByDay: Map<number, GrowthNight>
  /** 「只看一个文件夹」能选的：篇数够多的文件夹（最多三层） */
  folders: { dir: string; count: number }[]
  /** 位置的范围（看全部用） */
  box: { x0: number; y0: number; x1: number; y1: number }
}

export function makeModel(d: GrowthData): Model {
  const n = d.notes.length
  const adj: number[][] = Array.from({ length: n }, () => [])
  d.links.forEach((l, i) => {
    adj[l.a]!.push(i)
    adj[l.b]!.push(i)
  })
  // 起点：最早的那篇（个别写错年份的老日期不把时间轴拉得很长：取第 1% 那篇）
  const borns = d.notes.map((x) => x.born).sort((a, b) => a - b)
  const start = borns.length ? borns[Math.min(borns.length - 1, Math.floor(borns.length * 0.01))]! : d.today
  const end = Math.max(d.today, start + 1)
  const cum = new Int32Array(end - start + 1)
  for (const b of borns) cum[Math.max(0, Math.min(end, b) - start)]!++
  for (let i = 1; i < cum.length; i++) cum[i]! += cum[i - 1]!
  const ev = new Set<number>()
  for (const b of borns) ev.add(Math.max(start, b))
  for (const nt of d.nights) ev.add(nt.day)
  for (const l of d.links) ev.add(Math.max(start, l.day))
  const fc = new Map<string, number>()
  for (const x of d.notes) {
    const s = x.path.split('/').slice(0, -1)
    for (let k = 1; k <= Math.min(s.length, 3); k++) {
      const p = s.slice(0, k).join('/')
      fc.set(p, (fc.get(p) ?? 0) + 1)
    }
  }
  const minFolder = n > 300 ? 15 : 2
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  d.notes.forEach((x) => {
    x0 = Math.min(x0, x.x)
    y0 = Math.min(y0, x.y)
    x1 = Math.max(x1, x.x)
    y1 = Math.max(y1, x.y)
  })
  if (!n) [x0, y0, x1, y1] = [-50, -50, 50, 50]
  return {
    d,
    start,
    end,
    events: [...ev].filter((x) => x >= start && x <= end).sort((a, b) => a - b),
    cum,
    adj,
    nightByDay: new Map(d.nights.map((x) => [x.day, x])),
    folders: [...fc].filter(([, c]) => c >= minFolder).map(([dir, count]) => ({ dir, count })).sort((a, b) => a.dir.localeCompare(b.dir, 'zh')),
    box: { x0, y0, x1, y1 },
  }
}

/** 这一刻要看什么 */
export interface ViewOpts {
  t: number
  /** 只看这个文件夹（空是全库） */
  folder: string
  /** 选中的那篇（-1 没有） */
  sel: number
  /** 只看选中那篇两步以内 */
  local: boolean
  /** 停在某一晚：那晚连的线加粗、动过的笔记加圈 */
  night: GrowthNight | null
}

/** 算出来的这一帧：vis 0 不画、1 淡着画（文件夹外连着的、两步远的）、2 照常；deg 每篇这一刻几条线；edges 画哪几条 */
export interface Scene {
  vis: Uint8Array
  deg: Uint16Array
  edges: number[]
  notes: number
  links: number
  dreamLinks: number
  touched: Set<number>
}

const inFolder = (p: string, f: string) => !f || p.startsWith(f + '/')

export function scene(m: Model, o: ViewOpts): Scene {
  const { d } = m
  const n = d.notes.length
  const vis = new Uint8Array(n)
  const deg = new Uint16Array(n)
  let notes = 0
  for (let i = 0; i < n; i++)
    if (d.notes[i]!.born <= o.t) {
      vis[i] = 2
      notes++
    }
  let edges: number[] = []
  let links = 0
  let dreamLinks = 0
  d.links.forEach((l, i) => {
    if (l.day > o.t || !vis[l.a] || !vis[l.b]) return
    edges.push(i)
    links++
    if (l.dream) dreamLinks++
  })
  if (o.folder) {
    const keep = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (vis[i] && inFolder(d.notes[i]!.path, o.folder)) keep[i] = 2
    for (const e of edges) {
      const l = d.links[e]!
      if (keep[l.a] === 2 && !keep[l.b]) keep[l.b] = 1
      if (keep[l.b] === 2 && !keep[l.a]) keep[l.a] = 1
    }
    vis.set(keep)
  }
  if (o.local && o.sel >= 0 && vis[o.sel]) {
    const dist = new Map<number, number>([[o.sel, 0]])
    let front = [o.sel]
    for (let s = 1; s <= 2; s++) {
      const next: number[] = []
      for (const u of front)
        for (const e of m.adj[u]!) {
          const l = d.links[e]!
          if (l.day > o.t) continue
          const v = l.a === u ? l.b : l.a
          if (!dist.has(v) && vis[v]) {
            dist.set(v, s)
            next.push(v)
          }
        }
      front = next
    }
    for (let i = 0; i < n; i++) vis[i] = dist.has(i) ? (dist.get(i) === 2 ? 1 : 2) : 0
  }
  if (o.folder || o.local) {
    edges = edges.filter((e) => vis[d.links[e]!.a] && vis[d.links[e]!.b])
    // 只看一部分时，左上的数是这一部分的：照常画的那些篇、两头都照常画的线
    notes = 0
    for (let i = 0; i < n; i++) if (vis[i] === 2) notes++
    const full = edges.filter((e) => vis[d.links[e]!.a] === 2 && vis[d.links[e]!.b] === 2)
    links = full.length
    dreamLinks = full.filter((e) => d.links[e]!.dream).length
  }
  for (const e of edges) {
    const l = d.links[e]!
    deg[l.a] = deg[l.a]! + 1
    deg[l.b] = deg[l.b]! + 1
  }
  return { vis, deg, edges, notes, links, dreamLinks, touched: new Set(o.night?.touched ?? []) }
}

/** 点越大链接越多（屏幕上的半径，跟缩放走一点） */
export const radius = (deg: number, k: number) => Math.min(14, Math.min(10, 1.7 + Math.sqrt(deg) * 0.75) * (k / Math.sqrt(Math.max(1, k * 0.6))))

/** 群名：这一刻看得见的每一群的中心和篇数（够多的才写） */
export function groupCenters(m: Model, s: Scene): { g: number; at: number; c: number }[] {
  const acc = new Map<number, number[]>()
  m.d.notes.forEach((nd, i) => {
    if (s.vis[i] !== 2 || nd.group < 0) return
    ;(acc.get(nd.group) ?? acc.set(nd.group, []).get(nd.group)!).push(i)
  })
  // 中间取中位数（散在外圈的几篇不把名字拉走），名字挂在离它最近的那一篇上（不落在没有点的空白处）
  const mid = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1]!
  const out: { g: number; at: number; c: number }[] = []
  for (const [g, ids] of acc) {
    if (ids.length < GROUP_LABEL_MIN) continue
    const cx = mid(ids.map((i) => m.d.notes[i]!.x))
    const cy = mid(ids.map((i) => m.d.notes[i]!.y))
    let at = ids[0]!
    let best = Infinity
    for (const i of ids) {
      const dd = (m.d.notes[i]!.x - cx) ** 2 + (m.d.notes[i]!.y - cy) ** 2
      if (dd < best) [best, at] = [dd, i]
    }
    out.push({ g, at, c: ids.length })
  }
  return out.sort((a, b) => b.c - a.c)
}
