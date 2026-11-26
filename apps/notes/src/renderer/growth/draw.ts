/**
 * 生长图怎么画（task-h7oy8）：Canvas 2D，一种颜色、一种样子的点和线各拼成一条路径一次画（几千篇、上万条线一帧几毫秒）。
 * 位置、动到哪由 force-graph 和 Motion 给（graph.ts）。颜色全从主题取（换主题跟着换）：
 * 三大类用导图「彩虹」那组里过得了色弱检查的三个（--mm-b5 / --mm-b4 / --mm-b0），别的灰；梦游连的线、那晚动过的笔记用强调色；
 * 图上直接写群名（不只靠颜色分，色弱也看得出哪团是哪门课）。
 */
import { type Model, radius, type Scene, groupCenters, type ViewOpts } from './model'
import { curveTo, FONT } from './paint'

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
}

/** 这一帧每篇、每条线动到哪了（force-graph 一边排一边动，Motion 管弹出来和线伸过去） */
export interface Live {
  /** 现在在图上的哪（没出现的 null） */
  pos(i: number): { x: number; y: number } | null
  /** 弹出来到多大（0–1，弹簧会过 1 一点） */
  scale(i: number): number
  /** 线伸到哪（0–1） */
  linkP(e: number): number
  /** 刚冒出来的新点：强调色外圈多亮（0 不画） */
  fresh(i: number): number
}

const TAU = Math.PI * 2

/**
 * 画一帧（设计页 154 版本 A）：线是弯线（往一侧弯 18%），新线从一头沿弯线伸过去；点从连着的那篇旁边弹出来；
 * 点、字按屏幕像素定大小（2–14），字不互相压；几千个点时线变淡；选中一篇时别的淡到 22%、连着它的线照常（灰，不加深；2026-11-25 用户「线不用加深」）、别的线退下去、它外面一圈强调色。
 * 一种颜色、一种样子的点和线各拼成一条路径一次画（几千篇一帧几毫秒），正在动的那几个单独画。画在屏幕坐标里（不清空画布：force-graph 清）
 */
export function drawGrowth(ctx: CanvasRenderingContext2D, m: Model, s: Scene, v: ViewOpts, o: DrawOpts, live: Live): { labels: string[]; dimmed: number } {
  const { d } = m
  const { xf, colors: C, dpr } = o
  const k = xf.k
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  const X = (x: number) => x * k + xf.x
  const Y = (y: number) => y * k + xf.y
  const local = v.local && v.sel >= 0
  // 只看周围时不叠「那一晚」的明暗（两样一起，邻居也被压暗）
  const night = local ? null : v.night
  // 选中一篇（不是「只看周围」）：它和连着它的照常，别的淡到 22%
  const focus = !local && v.sel >= 0 && s.vis[v.sel] ? new Set<number>([v.sel]) : null
  if (focus)
    for (const e of s.edges) {
      const l = d.links[e]!
      if (l.a === v.sel) focus.add(l.b)
      else if (l.b === v.sel) focus.add(l.a)
    }
  let shown = 0
  for (let i = 0; i < s.vis.length; i++) if (s.vis[i]) shown++
  // ---- 线 ----
  const plain = new Path2D()
  const faint = new Path2D()
  const dream = new Path2D()
  const tonight = new Path2D()
  // 选中一篇时连着它的线：照常画（不跟着别的退下去，也不加深）
  const hot = new Path2D()
  const hotDream = new Path2D()
  const growing: { e: number; p: number; ax: number; ay: number; bx: number; by: number; dream: boolean }[] = []
  for (const e of s.edges) {
    const l = d.links[e]!
    // 只看周围：两步远的那一圈只淡淡画点，它们的线不画
    if (local && (s.vis[l.a] !== 2 || s.vis[l.b] !== 2)) continue
    const a = live.pos(l.a)
    const b = live.pos(l.b)
    if (!a || !b) continue
    const sign = (l.a + l.b) % 2 ? 1 : -1
    const p = live.linkP(e)
    if (p <= 0.001) continue
    const ax = X(a.x)
    const ay = Y(a.y)
    const bx = X(b.x)
    const by = Y(b.y)
    if (p < 0.999) {
      growing.push({ e, p, ax, ay, bx, by, dream: l.dream })
      continue
    }
    const path = focus && (l.a === v.sel || l.b === v.sel) ? (l.dream ? hotDream : hot) : night && l.dream && l.day === night.day ? tonight : s.vis[l.a] !== 2 || s.vis[l.b] !== 2 ? faint : l.dream ? dream : plain
    curveTo(path, ax, ay, bx, by, 1, sign)
  }
  const lw = Math.max(0.5, Math.min(1.2, 0.6 * Math.sqrt(k)))
  // 几千个点时线变淡（不糊成一片灰）
  const plainA = shown > 2000 ? 0.07 : shown > 800 ? 0.12 : 0.2
  ctx.lineCap = 'round'
  ctx.lineWidth = lw
  ctx.strokeStyle = C.edge
  ctx.globalAlpha = 0.07
  ctx.stroke(faint)
  // 停在一晚、选中一篇：别的线都退下去
  ctx.globalAlpha = night || focus ? 0.05 : local ? 0.12 : plainA
  ctx.stroke(plain)
  ctx.strokeStyle = C.acc
  ctx.globalAlpha = night || focus ? 0.08 : 0.3
  ctx.stroke(dream)
  if (night) {
    ctx.globalAlpha = 1
    ctx.lineWidth = 2.2
    ctx.stroke(tonight)
  }
  if (focus) {
    // 邻居线：照常的灰和梦游的强调色（DESIGN 2.5a「邻居线灰」），只是不退下去
    ctx.lineWidth = lw
    ctx.strokeStyle = C.edge
    ctx.globalAlpha = plainA
    ctx.stroke(hot)
    ctx.strokeStyle = C.acc
    ctx.globalAlpha = 0.3
    ctx.stroke(hotDream)
  }
  // 正在伸过去的线：一条一画
  for (const g of growing) {
    const l = d.links[g.e]!
    ctx.strokeStyle = g.dream ? C.acc : C.edge
    ctx.globalAlpha = g.dream ? 0.5 : Math.max(plainA, 0.3)
    ctx.lineWidth = lw
    ctx.beginPath()
    curveTo(ctx, g.ax, g.ay, g.bx, g.by, g.p, (l.a + l.b) % 2 ? 1 : -1)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
  // ---- 点：按颜色、深浅、实心空心分桶 ----
  const buckets = new Map<string, Path2D>()
  const bucket = (key: string) => buckets.get(key) ?? buckets.set(key, new Path2D()).get(key)!
  const colorOf = (i: number) => {
    const c = d.areas[d.notes[i]!.area]?.color ?? -1
    return c >= 0 ? c : 3
  }
  // 屏幕上至少 2（空心 2.5）、最大 14；只看周围时空心圈最大 8，不叠成一片
  const r = (i: number) => {
    const hollow = o.hollow && d.notes[i]!.est
    const rr = radius(s.deg[i]!, k)
    return Math.max(hollow ? 2.5 : 2, local && hollow ? Math.min(8, rr) : rr)
  }
  const fills = [...C.cat, C.other]
  const pts: { i: number; x: number; y: number; r: number }[] = []
  for (let i = 0; i < d.notes.length; i++) {
    const vi = s.vis[i]
    if (!vi) continue
    const q = live.pos(i)
    if (!q) continue
    const nd = d.notes[i]!
    const alpha = vi === 1 ? 1 : focus && !focus.has(i) ? 3 : night && !s.touched.has(i) ? 2 : 0
    const hollow = o.hollow && nd.est ? 1 : 0
    const x = X(q.x)
    const y = Y(q.y)
    const sc = live.scale(i)
    if (sc <= 0.01) continue
    const rr = r(i) * sc
    pts.push({ i, x, y, r: rr })
    const p = bucket(`${colorOf(i)}|${alpha}|${hollow}`)
    p.moveTo(x + rr, y)
    p.arc(x, y, rr, 0, TAU)
  }
  // 「别的」那几类淡一点（灰的不该比三种颜色还抢眼）
  const otherAlpha = 0.55
  for (const [key, p] of buckets) {
    const [c, a, h] = key.split('|').map(Number) as [number, number, number]
    ctx.globalAlpha = a === 1 ? (local ? 0.1 : 0.28) : a === 2 ? 0.2 : a === 3 ? 0.22 : 1
    if (c === 3) ctx.globalAlpha *= otherAlpha
    if (h) {
      ctx.strokeStyle = fills[c]!
      ctx.lineWidth = 1.1
      ctx.stroke(p)
    } else {
      ctx.fillStyle = fills[c]!
      ctx.fill(p)
    }
  }
  ctx.globalAlpha = 1
  // 刚冒出来的新点：强调色外圈，慢慢淡掉；同时最多亮最新的 4 个（一串气泡就看不出哪颗是新的了）
  if (!night) {
    ctx.strokeStyle = C.acc
    ctx.lineWidth = 1.5
    const fresh = pts.map((p) => ({ p, f: live.fresh(p.i) })).filter((x) => x.f > 0.01).sort((a, b) => b.f - a.f).slice(0, 4)
    for (const { p, f } of fresh) {
      ctx.globalAlpha = 0.9 * f
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r + 3, 0, TAU)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  const at = new Map(pts.map((p) => [p.i, p]))
  // 那一晚动过的：强调色一圈
  if (night) {
    const ring = new Path2D()
    for (const i of s.touched) {
      const p = at.get(i)
      if (!p) continue
      const rr = Math.max(p.r + 3, 6)
      ring.moveTo(p.x + rr, p.y)
      ring.arc(p.x, p.y, rr, 0, TAU)
    }
    ctx.strokeStyle = C.acc
    ctx.lineWidth = 2
    ctx.stroke(ring)
  }
  // 选中的：强调色一圈
  const selP = v.sel >= 0 ? at.get(v.sel) : undefined
  if (selP) {
    ctx.strokeStyle = C.acc
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(selP.x, selP.y, selP.r + 3.5, 0, TAU)
    ctx.stroke()
  }
  // ---- 字：选中那篇和它连着的、群名、放大了以后链接多的几篇 ----
  const placed: [number, number, number, number][] = []
  const labels: string[] = []
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  /** 点占的地方（群名不压在点上） */
  const dots = pts.map((p): [number, number, number, number] => [p.x - p.r - 1, p.y - p.r - 1, p.x + p.r + 1, p.y + p.r + 1])
  const label = (txt: string, x: number, y: number, size: number, color: string, weight: number, align: CanvasTextAlign, force = false, avoidDots = false): boolean => {
    ctx.font = `${weight} ${size}px ${FONT}`
    ctx.textAlign = align
    const w = ctx.measureText(txt).width
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x
    const bb: [number, number, number, number] = [x0 - 3, y - size / 2 - 3, x0 + w + 3, y + size / 2 + 3]
    if (bb[2] < 0 || bb[0] > o.w || bb[3] < 0 || bb[1] > o.h) return false
    const over = (q: [number, number, number, number]) => bb[0] < q[2] && bb[2] > q[0] && bb[1] < q[3] && bb[3] > q[1]
    if (!force && (placed.some(over) || (avoidDots && dots.some(over)))) return false
    placed.push(bb)
    labels.push(txt)
    ctx.lineWidth = 3.5
    ctx.strokeStyle = C.halo
    ctx.globalAlpha = 0.92
    ctx.strokeText(txt, x, y)
    ctx.globalAlpha = 1
    ctx.fillStyle = color
    ctx.fillText(txt, x, y)
    return true
  }
  const name = (i: number) => d.notes[i]!.path.replace(/\.md$/i, '').split('/').pop()!
  const short = (t: string) => (t.length > 22 ? t.slice(0, 21) + '…' : t)
  // 只看周围、选中一篇：点占的地方也算上，篇名不压在点上
  if (local || focus) for (const p of pts) if (local ? s.vis[p.i] === 2 : focus!.has(p.i)) placed.push([p.x - p.r, p.y - p.r, p.x + p.r, p.y + p.r])
  if (selP) label(name(v.sel), selP.x + selP.r + 7, selP.y, 13, C.t1, 600, 'left', true)
  // 群名写在离那一团中间最近的那一篇上方（选中一篇时不写，让给它的邻居）
  // 那里压着点就挪到这一团最上面那篇的上方，再不行写在最下面那篇的下方
  if (!local && !focus) {
    const members = new Map<number, { x: number; y: number; r: number }[]>()
    for (const p of pts) {
      const gi = d.notes[p.i]!.group
      if (gi >= 0) (members.get(gi) ?? members.set(gi, []).get(gi)!).push(p)
    }
    for (const g of groupCenters(m, s)) {
      const p = at.get(g.at)
      const ms = members.get(g.g) ?? []
      if (!p || !ms.length) continue
      const topP = ms.reduce((a, b) => (b.y - b.r < a.y - a.r ? b : a))
      const botP = ms.reduce((a, b) => (b.y + b.r > a.y + a.r ? b : a))
      const name = d.groups[g.g]!.name
      void (label(name, p.x, p.y - p.r - 14, 13, C.t1, 600, 'center', false, true) || label(name, topP.x, topP.y - topP.r - 14, 13, C.t1, 600, 'center', false, true) || label(name, botP.x, botP.y + botP.r + 14, 13, C.t1, 600, 'center', false, true))
    }
  }
  if (focus) {
    // 邻居的名字：写在离选中那篇远的一侧
    const ids = [...focus].filter((i) => i !== v.sel && at.has(i)).sort((a, b) => s.deg[b]! - s.deg[a]!)
    for (const i of ids.slice(0, 40)) {
      const p = at.get(i)!
      const right = !selP || p.x >= selP.x
      label(short(name(i)), right ? p.x + p.r + 5 : p.x - p.r - 5, p.y, 11, C.t2, 400, right ? 'left' : 'right')
    }
  } else if (k > 2.2 || local) {
    const ids: number[] = []
    for (const p of pts) if (p.i !== v.sel && (local ? s.vis[p.i] === 2 : s.deg[p.i]! >= 6)) ids.push(p.i)
    ids.sort((a, b) => s.deg[b]! - s.deg[a]!)
    for (const i of ids.slice(0, local ? 40 : 400)) {
      const p = at.get(i)!
      label(short(name(i)), p.x + p.r + 5, p.y, 11, C.t2, 400, 'left')
    }
  }
  return { labels, dimmed: focus ? pts.filter((p) => !focus.has(p.i)).length : 0 }
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
