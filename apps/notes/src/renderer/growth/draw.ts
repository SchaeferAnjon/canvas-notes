/**
 * 生长图怎么画（task-h7oy8）：Canvas 2D，一种颜色、一种样子的点和线各拼成一条路径一次画（几千篇、上万条线一帧几毫秒）。
 * 中间的大图和左栏报告顶上那晚的小图用同一个函数。颜色全从主题取（换主题跟着换）：
 * 三大类用导图「彩虹」那组里过得了色弱检查的三个（--mm-b5 / --mm-b4 / --mm-b0），别的灰；梦游连的线、那晚动过的笔记用强调色；
 * 图上直接写群名（不只靠颜色分，色弱也看得出哪团是哪门课）。
 */
import { type Model, radius, type Scene, groupCenters, type ViewOpts } from './model'

export interface Colors {
  cat: [string, string, string]
  other: string
  acc: string
  t1: string
  t2: string
  t3: string
  /** 字的描边（底色）、线的颜色 */
  halo: string
  edge: string
}

/** 主题变量算成画布认得的颜色（变量里有 light-dark()、color-mix() 时画布不认，先让浏览器算一遍） */
export function readColors(host: HTMLElement): Colors {
  const probe = document.createElement('i')
  probe.style.display = 'none'
  host.appendChild(probe)
  const get = (v: string) => {
    probe.style.color = `var(${v})`
    return getComputedStyle(probe).color
  }
  const c: Colors = {
    cat: [get('--mm-b5'), get('--mm-b4'), get('--mm-b0')],
    other: get('--t3'),
    acc: get('--acc'),
    t1: get('--t1'),
    t2: get('--t2'),
    t3: get('--t3'),
    halo: get('--board'),
    edge: get('--t2'),
  }
  probe.remove()
  return c
}

/** 屏幕 = 画布坐标 × k + (x, y) */
export interface Xf {
  x: number
  y: number
  k: number
}

export interface DrawOpts {
  w: number
  h: number
  dpr: number
  xf: Xf
  colors: Colors
  /** 用修改时间估的画成空心 */
  hollow: boolean
  /** 小图：不写字、线细一点 */
  thumb?: boolean
  /** 正在播放：刚加进来的那几天外面一圈淡淡的光 */
  fresh?: boolean
}

const TAU = Math.PI * 2

export function drawGrowth(ctx: CanvasRenderingContext2D, m: Model, s: Scene, v: ViewOpts, o: DrawOpts): { labels: string[] } {
  const { d } = m
  const { xf, colors: C, dpr } = o
  const k = xf.k
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, o.w, o.h)
  const X = (x: number) => x * k + xf.x
  const Y = (y: number) => y * k + xf.y
  // 只看周围时不叠「那一晚」的明暗（两样一起，邻居也被压暗）
  const night = v.local && v.sel >= 0 ? null : v.night
  // ---- 线：正文里的（灰）、淡着的、梦游连的（强调色）、停着的那一晚连的（粗） ----
  const plain = new Path2D()
  const faint = new Path2D()
  const dream = new Path2D()
  const tonight = new Path2D()
  const local = v.local && v.sel >= 0
  for (const e of s.edges) {
    const l = d.links[e]!
    // 只看周围：两步远的那一圈只淡淡画点，它们的线不画（只画中心到邻居、邻居之间的）
    if (local && (s.vis[l.a] !== 2 || s.vis[l.b] !== 2)) continue
    const a = d.notes[l.a]!
    const b = d.notes[l.b]!
    const p = night && l.dream && l.day === night.day ? tonight : s.vis[l.a] !== 2 || s.vis[l.b] !== 2 ? faint : l.dream ? dream : plain
    p.moveTo(X(a.x), Y(a.y))
    p.lineTo(X(b.x), Y(b.y))
  }
  const lw = o.thumb ? 0.5 : Math.max(0.5, Math.min(1.2, 0.6 * Math.sqrt(k)))
  ctx.lineCap = 'round'
  ctx.lineWidth = lw
  ctx.strokeStyle = C.edge
  ctx.globalAlpha = 0.07
  ctx.stroke(faint)
  // 停在一晚：别的都退下去，那晚连的才看得见
  ctx.globalAlpha = night ? 0.05 : local ? 0.12 : 0.2
  ctx.stroke(plain)
  ctx.strokeStyle = C.acc
  ctx.globalAlpha = night ? 0.08 : 0.3
  ctx.stroke(dream)
  if (night) {
    ctx.globalAlpha = 1
    ctx.lineWidth = o.thumb ? 1.4 : 2.2
    ctx.stroke(tonight)
  }
  ctx.globalAlpha = 1
  // ---- 点：按颜色、深浅、实心空心分桶 ----
  const buckets = new Map<string, Path2D>()
  const bucket = (key: string) => buckets.get(key) ?? buckets.set(key, new Path2D()).get(key)!
  const colorOf = (i: number) => {
    const c = d.areas[d.notes[i]!.area]?.color ?? -1
    return c >= 0 ? c : 3
  }
  const rk = o.thumb ? Math.min(k, 0.7) : k
  // 屏幕上至少 2（空心 2.5），铺开整个库时早期那一小团也看得见；只看周围时空心圈最大 8，不叠成一片
  const r = (i: number) => {
    const hollow = o.hollow && d.notes[i]!.est
    const rr = radius(s.deg[i]!, rk) * (o.thumb ? 0.8 : 1)
    return o.thumb ? rr : Math.max(hollow ? 2.5 : 2, local && hollow ? Math.min(8, rr) : rr)
  }
  for (let i = 0; i < d.notes.length; i++) {
    const vi = s.vis[i]
    if (!vi) continue
    const nd = d.notes[i]!
    const alpha = vi === 1 ? 1 : night && !s.touched.has(i) ? 2 : 0
    const hollow = o.hollow && nd.est ? 1 : 0
    const p = bucket(`${colorOf(i)}|${alpha}|${hollow}`)
    const x = X(nd.x)
    const y = Y(nd.y)
    const rr = r(i)
    p.moveTo(x + rr, y)
    p.arc(x, y, rr, 0, TAU)
  }
  const fills = [...C.cat, C.other]
  // 「别的」那几类淡一点（灰的不该比三种颜色还抢眼）
  const otherAlpha = 0.55
  for (const [key, p] of buckets) {
    const [c, a, h] = key.split('|').map(Number) as [number, number, number]
    ctx.globalAlpha = a === 1 ? (local ? 0.1 : 0.28) : a === 2 ? 0.2 : 1
    if (c === 3) ctx.globalAlpha *= otherAlpha
    if (h) {
      ctx.strokeStyle = fills[c]!
      ctx.lineWidth = o.thumb ? 0.7 : 1.1
      ctx.stroke(p)
    } else {
      ctx.fillStyle = fills[c]!
      ctx.fill(p)
    }
  }
  ctx.globalAlpha = 1
  // 刚加进来的：外面一圈淡淡的光（播放时看得出哪些是这几天亮起来的）
  if (o.fresh && !night) {
    for (let i = 0; i < d.notes.length; i++) {
      const age = v.t - d.notes[i]!.born
      if (!s.vis[i] || age < 0 || age >= 8) continue
      ctx.globalAlpha = 0.55 * (1 - age / 8)
      ctx.strokeStyle = fills[colorOf(i)]!
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(X(d.notes[i]!.x), Y(d.notes[i]!.y), r(i) + 4, 0, TAU)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  // 那一晚动过的：强调色一圈
  if (night) {
    const ring = new Path2D()
    for (const i of s.touched) {
      if (!s.vis[i]) continue
      const nd = d.notes[i]!
      const rr = o.thumb ? r(i) + 1.5 : Math.max(r(i) + 3, 6)
      ring.moveTo(X(nd.x) + rr, Y(nd.y))
      ring.arc(X(nd.x), Y(nd.y), rr, 0, TAU)
    }
    ctx.strokeStyle = C.acc
    ctx.lineWidth = o.thumb ? 1 : 2
    ctx.stroke(ring)
  }
  // 选中的：--t1 一圈
  if (v.sel >= 0 && s.vis[v.sel]) {
    const nd = d.notes[v.sel]!
    ctx.strokeStyle = C.t1
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(X(nd.x), Y(nd.y), r(v.sel) + 3.5, 0, TAU)
    ctx.stroke()
  }
  if (o.thumb) return { labels: [] }
  // ---- 字：选中那篇、群名、放大了以后链接多的几篇 ----
  const placed: [number, number, number, number][] = []
  const labels: string[] = []
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  const label = (txt: string, x: number, y: number, size: number, color: string, weight: number, align: CanvasTextAlign, force = false) => {
    ctx.font = `${weight} ${size}px -apple-system, "PingFang SC", "Helvetica Neue", sans-serif`
    ctx.textAlign = align
    const w = ctx.measureText(txt).width
    const x0 = align === 'center' ? x - w / 2 : x
    const bb: [number, number, number, number] = [x0 - 3, y - size / 2 - 3, x0 + w + 3, y + size / 2 + 3]
    if (bb[2] < 0 || bb[0] > o.w || bb[3] < 0 || bb[1] > o.h) return
    if (!force && placed.some((q) => bb[0] < q[2] && bb[2] > q[0] && bb[1] < q[3] && bb[3] > q[1])) return
    placed.push(bb)
    labels.push(txt)
    ctx.lineWidth = 3.5
    ctx.strokeStyle = C.halo
    ctx.globalAlpha = 0.92
    ctx.strokeText(txt, x, y)
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.fillText(txt, x, y)
  }
  const name = (i: number) => d.notes[i]!.path.replace(/\.md$/i, '').split('/').pop()!
  // 只看周围：点占的地方也算上，篇名不压在点上
  if (local) for (let i = 0; i < d.notes.length; i++) if (s.vis[i] === 2) {
    const rr = r(i)
    placed.push([X(d.notes[i]!.x) - rr, Y(d.notes[i]!.y) - rr, X(d.notes[i]!.x) + rr, Y(d.notes[i]!.y) + rr])
  }
  if (v.sel >= 0 && s.vis[v.sel]) {
    const nd = d.notes[v.sel]!
    label(name(v.sel), X(nd.x) + r(v.sel) + 7, Y(nd.y), 13, C.t1, 600, 'left', true)
  }
  // 群名写在离那一团中间最近的那一篇上方
  if (!local) for (const g of groupCenters(m, s)) label(d.groups[g.g]!.name, X(d.notes[g.at]!.x), Y(d.notes[g.at]!.y) - r(g.at) - 10, 13, C.t1, 600, 'center')
  if (k > 2.2 || (v.local && v.sel >= 0)) {
    const ids: number[] = []
    for (let i = 0; i < d.notes.length; i++) if (i !== v.sel && (local ? s.vis[i] === 2 : s.vis[i] && s.deg[i]! >= 6)) ids.push(i)
    ids.sort((a, b) => s.deg[b]! - s.deg[a]!)
    for (const i of ids.slice(0, local ? 40 : 400)) {
      const nd = d.notes[i]!
      const t = name(i)
      label(t.length > 22 ? t.slice(0, 21) + '…' : t, X(nd.x) + r(i) + 5, Y(nd.y), 11, C.t2, 400, 'left')
    }
  }
  return { labels }
}

/** 时间轴：灰底是笔记总数的曲线，走过的部分加深；下面强调色的小竖线是每一晚梦游；导入那天一道虚线；现在停在哪一天一根竖线 */
export function drawTimeline(ctx: CanvasRenderingContext2D, m: Model, t: number, o: { w: number; h: number; dpr: number; colors: Colors; pad: number; years: (y: number) => string; month: (mo: number) => string }) {
  const { w, h, dpr, colors: C, pad } = o
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const span = Math.max(1, m.end - m.start)
  const tx = (d: number) => pad + ((d - m.start) / span) * (w - 2 * pad)
  const max = Math.max(1, m.cum[m.cum.length - 1]!)
  const base = h - 16
  const y = (v: number) => base - (v / max) * (base - 6)
  const area = new Path2D()
  area.moveTo(tx(m.start), base)
  const step = Math.max(1, Math.floor(m.cum.length / Math.max(1, w)))
  for (let i = 0; i < m.cum.length; i += step) area.lineTo(tx(m.start + i), y(m.cum[i]!))
  area.lineTo(tx(m.end), y(m.cum[m.cum.length - 1]!))
  area.lineTo(tx(m.end), base)
  area.closePath()
  ctx.fillStyle = C.t3
  ctx.globalAlpha = 0.18
  ctx.fill(area)
  ctx.save()
  ctx.beginPath()
  ctx.rect(0, 0, tx(t), h)
  ctx.clip()
  ctx.fillStyle = C.t2
  ctx.globalAlpha = 0.32
  ctx.fill(area)
  ctx.restore()
  ctx.globalAlpha = 1
  // 导入那天：虚线（左边的时间是估的）
  ctx.strokeStyle = C.t3
  ctx.lineWidth = 1
  ctx.setLineDash([3, 3])
  for (const im of m.d.imports) {
    if (im.day < m.start || im.day > m.end) continue
    ctx.beginPath()
    ctx.moveTo(Math.round(tx(im.day)) + 0.5, 2)
    ctx.lineTo(Math.round(tx(im.day)) + 0.5, base)
    ctx.stroke()
  }
  ctx.setLineDash([])
  // 每一晚梦游
  ctx.fillStyle = C.acc
  for (const n of m.d.nights) if (n.day >= m.start) ctx.fillRect(Math.round(tx(n.day)) - 1, base + 1, 2, 7)
  // 年份、半年
  ctx.fillStyle = C.t3
  ctx.font = '11px -apple-system, "PingFang SC", sans-serif'
  ctx.textBaseline = 'bottom'
  ctx.textAlign = 'left'
  const s = new Date(m.start * 86_400_000)
  const e = new Date(m.end * 86_400_000)
  const months = (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + e.getUTCMonth() - s.getUTCMonth()
  const every = months > 36 ? 12 : months > 14 ? 6 : months > 5 ? 3 : 1
  let lastX = -100
  for (let yr = s.getUTCFullYear(); yr <= e.getUTCFullYear(); yr++)
    for (let mo = 0; mo < 12; mo += every) {
      const d = Math.floor(Date.UTC(yr, mo, 1) / 86_400_000)
      if (d < m.start || d > m.end) continue
      const x = tx(d)
      // 刻度在曲线底下，字放在刻度下面、从刻度往右
      ctx.fillRect(Math.round(x), base, 1, 3)
      const txt = mo === 0 ? o.years(yr) : o.month(mo + 1)
      if (x - lastX < ctx.measureText(txt).width + 10) continue
      ctx.fillText(txt, x, h)
      lastX = x
    }
  // 现在停在的那天
  const cx = Math.round(tx(t))
  ctx.fillStyle = C.t1
  ctx.fillRect(cx - 1, 2, 2, base - 2)
  ctx.beginPath()
  ctx.arc(cx, 4, 4, 0, TAU)
  ctx.fill()
}
