/**
 * 生长图的位置（task-h7oy8）：按现在的全库用 d3-force 算一次，存下来；以后新加的笔记只在旁边找位置（老的钉住不动），
 * 回放时位置一直不变，只是一颗颗亮起（设计页「位置一次算好、不再挪」）。在后台进程里算，几千篇几秒。
 * 链接把讲同一件事的拉到一起；每一大类（顶层文件夹）有个落脚点排成一圈，没连上的笔记散在它那一类的外圈。
 */
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force'

interface N extends SimulationNodeDatum {
  i: number
  area: number
}

/** 可重复的随机数（同一个库每次摆出来一样） */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}

/** 新加的笔记超过这个比例就整个重排（库变了大样，比如刚导入几千篇） */
export const RELAYOUT_SHARE = 0.5

/**
 * keys：每篇在缓存里认它的名字（路径）；prev：上次的位置。返回每篇的位置和这次是不是整个重排的
 */
export function placeNotes(
  keys: readonly string[],
  areas: readonly number[],
  links: readonly { a: number; b: number }[],
  prev: ReadonlyMap<string, [number, number]>,
): { pos: [number, number][]; full: boolean } {
  const n = keys.length
  const known = keys.map((k) => prev.get(k))
  const have = known.filter(Boolean).length
  const full = have < n * (1 - RELAYOUT_SHARE) || have === 0
  const rnd = lcg(42)
  const areaCount = Math.max(1, ...areas.map((a) => a + 1))
  // 大类的落脚点：一圈，大的先排
  const R = 10 * Math.sqrt(Math.max(n, 30))
  const anchor: [number, number][] = []
  for (let a = 0; a < areaCount; a++) {
    const ang = (a / areaCount) * Math.PI * 2 - Math.PI / 2
    anchor.push([Math.cos(ang) * R, Math.sin(ang) * R])
  }
  if (!full) {
    // 已有的那些在哪一大类的平均位置当落脚点（老的不挪，新的往自己那一类靠）
    const sum = anchor.map(() => [0, 0, 0])
    known.forEach((p, i) => {
      if (!p) return
      const s = sum[areas[i]!]!
      s[0]! += p[0]
      s[1]! += p[1]
      s[2]!++
    })
    sum.forEach((s, a) => s[2] && (anchor[a] = [s[0]! / s[2]!, s[1]! / s[2]!]))
  }
  const nodes: N[] = keys.map((_, i) => {
    const p = full ? undefined : known[i]
    if (p) return { i, area: areas[i]!, x: p[0], y: p[1], fx: p[0], fy: p[1] }
    const [ax, ay] = anchor[areas[i]!]!
    return { i, area: areas[i]!, x: ax + (rnd() - 0.5) * 200, y: ay + (rnd() - 0.5) * 200 }
  })
  if (!full) {
    // 新的：放到已经有位置的邻居中间
    const nb = new Map<number, number[]>()
    for (const l of links) {
      ;(nb.get(l.a) ?? nb.set(l.a, []).get(l.a)!).push(l.b)
      ;(nb.get(l.b) ?? nb.set(l.b, []).get(l.b)!).push(l.a)
    }
    for (const d of nodes) {
      if (d.fx !== undefined) continue
      const ps = (nb.get(d.i) ?? []).map((j) => known[j]).filter((p): p is [number, number] => !!p)
      if (!ps.length) continue
      d.x = ps.reduce((s, p) => s + p[0], 0) / ps.length + (rnd() - 0.5) * 20
      d.y = ps.reduce((s, p) => s + p[1], 0) / ps.length + (rnd() - 0.5) * 20
    }
  }
  const moving = full ? n : n - have
  if (moving > 0) {
    const ticks = full ? (n > 8000 ? 200 : 300) : 120
    const sim = forceSimulation(nodes)
      .force('link', forceLink<N, { source: number; target: number }>(links.map((l) => ({ source: l.a, target: l.b }))).id((d) => d.i).distance(14).strength(0.25))
      .force('charge', forceManyBody<N>().strength(-9).distanceMax(260).theta(0.95))
      .force('x', forceX<N>((d) => anchor[d.area]![0]).strength(0.045))
      .force('y', forceY<N>((d) => anchor[d.area]![1]).strength(0.045))
      .alphaDecay(1 - Math.pow(0.001, 1 / ticks))
      .randomSource(lcg(7))
      .stop()
    if (!full) sim.alpha(0.5)
    // 防重叠只在最后一段加（几千篇时它最费时；前面散开时用不上）
    const late = Math.floor(ticks * 0.6)
    for (let k = 0; k < ticks; k++) {
      if (k === late) sim.force('collide', forceCollide<N>(3.2))
      sim.tick()
    }
  }
  return { pos: nodes.map((d) => [Math.round(d.x! * 10) / 10, Math.round(d.y! * 10) / 10]), full }
}
