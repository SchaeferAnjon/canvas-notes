/**
 * 白板笔迹怎么画（Mac 照 笔迹.ink 的点列画，iPad 那边是 PencilKit 自己画）：一笔先算好一个填充轮廓（Path2D，按组原点的坐标），
 * 之后每帧只是平移缩放再 fill，卡挪了、白板拖了都不用重算。
 *
 * 照 PencilKit 画（macOS PencilKit 实测，2026-11-25，scratch 的 pk/width.swift、alpha.swift）：
 * - 控制点是三次均匀 B 样条（PencilKit 文档），两头各重复一次；
 * - 钢笔、monoline：画出来的宽 = 2 ×（点宽 − 2），点宽不到 2.5 是发丝线（宽 0.5、淡）；力、速度、倾斜都不影响宽；
 * - 荧光笔：扁头，顺着方位角那一边长 1.18 × 点宽、横着 0.32 × 点宽（软边会往外扩一点，量出来的扁头是 1.5 × 和 0.5 ×），画出来的宽看笔走的方向（两个插值点之间扫过的凸包）；
 * - 书法钢笔：扁头，顺着方位角 2 ×（点宽 − 2）、横着它的四分之一；
 * - 铅笔、水彩、蜡笔：宽约 1.55 × 点宽（和 PencilKit 出图比墨水像素最接近），满色，纸纹不画；
 * - 荧光笔浅色不透明度 0.8、深色 0.95（PencilKit 两边量出来约 0.77、0.95），边上软一点（模糊，PencilKit 的边过渡约 5 个屏幕点）；
 * - 深色主题：颜色照 PencilKit 反亮度（@cn/format darkInk）。
 * 缩到 40% 以下画简化的（只连控制点、不插样条、宽取平均），一屏几千笔也快。
 */
import { darkInk, inkColor, type InkStroke } from '@cn/format'

/** 一笔算好的样子：轮廓、简化的轮廓、外框（组原点的坐标）、插好的中线（点到线的距离判断点中没有） */
export interface InkGeom {
  path: Path2D
  lod: Path2D
  box: [number, number, number, number]
  /** 中线：x、y、半宽 一组三个 */
  mid: Float32Array
  /** 平均画出来的宽（简化的那条用） */
  w: number
  alpha: number
  /** 荧光笔：深色下更不透明、边是软的（paintInk） */
  marker: boolean
}

type Nib = { kind: 'round'; w: (s: number) => number } | { kind: 'flat'; along: (s: number) => number; across: (s: number) => number }

/** 每种笔的笔尖（宽是画出来的全宽）和不透明度 */
export function nibOf(pen: string): { nib: Nib; alpha: number } {
  if (pen === 'marker') return { nib: { kind: 'flat', along: (s) => 1.18 * s, across: (s) => 0.32 * s }, alpha: 0.8 }
  if (pen === 'fountain') return { nib: { kind: 'flat', along: (s) => Math.max(0.5, 2 * (s - 2)), across: (s) => Math.max(0.5, 0.5 * (s - 2)) }, alpha: 1 }
  if (pen === 'pencil' || pen === 'watercolor' || pen === 'crayon') return { nib: { kind: 'round', w: (s) => 1.55 * s }, alpha: 1 }
  return { nib: { kind: 'round', w: (s) => Math.max(0.5, 2 * (s - 2)) }, alpha: 1 }
}

/** 钢笔发丝线（点宽不到 2.5）在 PencilKit 里是淡的：这一笔的不透明度按最粗的那点打折 */
function hairAlpha(pen: string, maxW: number): number {
  if (pen === 'marker' || pen === 'pencil' || pen === 'watercolor' || pen === 'crayon' || pen === 'fountain') return 1
  const w = 2 * (maxW - 2)
  return w >= 1 ? 1 : Math.max(0.16, w)
}

/** 三次均匀 B 样条：控制点（两头各重复一次）每段插 k 个点；值是 [x, y, s, az] 一组四个 */
function spline(c: Float64Array, n: number): Float64Array {
  if (n < 2) return c.slice(0, n * 4)
  const ext = (i: number, j: number) => c[Math.max(0, Math.min(n - 1, i - 1)) * 4 + j]!
  const out: number[] = []
  // 扩出来的控制点 i = 0..n+1（0 和 n+1 是两头重复的），段 i 用 i..i+3
  for (let i = 0; i + 3 <= n + 2; i++) {
    const len = Math.hypot(ext(i + 2, 0) - ext(i + 1, 0), ext(i + 2, 1) - ext(i + 1, 1))
    const k = Math.max(1, Math.min(6, Math.ceil(len / 1.5)))
    const last = i + 3 === n + 2
    for (let q = 0; q < k + (last ? 1 : 0); q++) {
      const u = q / k
      const u2 = u * u
      const u3 = u2 * u
      const b0 = (1 - u) ** 3 / 6
      const b1 = (3 * u3 - 6 * u2 + 4) / 6
      const b2 = (-3 * u3 + 3 * u2 + 3 * u + 1) / 6
      const b3 = u3 / 6
      for (let j = 0; j < 4; j++) out.push(b0 * ext(i, j) + b1 * ext(i + 1, j) + b2 * ext(i + 2, j) + b3 * ext(i + 3, j))
    }
  }
  return Float64Array.from(out)
}

/** 半宽：圆头就是宽的一半；扁头看这一段的走向和方位角（椭圆在法线方向上的支撑长度） */
function halfWidth(nib: Nib, s: number, az: number, dx: number, dy: number): number {
  if (nib.kind === 'round') return nib.w(s) / 2
  const a = nib.along(s) / 2
  const b = nib.across(s) / 2
  const th = Math.atan2(dy, dx) - az
  const sn = Math.sin(th)
  const cs = Math.cos(th)
  return Math.sqrt(a * a * sn * sn + b * b * cs * cs)
}

/** 中线点列（x、y、半宽）连成一个填充轮廓：两边各偏半宽，两头半圆 */
function outline(m: Float32Array): Path2D {
  const p = new Path2D()
  const n = m.length / 3
  if (n === 0) return p
  if (n === 1) {
    p.arc(m[0]!, m[1]!, Math.max(0.25, m[2]!), 0, Math.PI * 2)
    return p
  }
  const L: number[] = []
  const R: number[] = []
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1)
    const b = Math.min(n - 1, i + 1)
    let nx = -(m[b * 3 + 1]! - m[a * 3 + 1]!)
    let ny = m[b * 3]! - m[a * 3]!
    const l = Math.hypot(nx, ny) || 1
    nx /= l
    ny /= l
    const h = m[i * 3 + 2]!
    L.push(m[i * 3]! + nx * h, m[i * 3 + 1]! + ny * h)
    R.push(m[i * 3]! - nx * h, m[i * 3 + 1]! - ny * h)
  }
  p.moveTo(L[0]!, L[1]!)
  for (let i = 1; i < n; i++) p.lineTo(L[i * 2]!, L[i * 2 + 1]!)
  const e = n - 1
  const he = m[e * 3 + 2]!
  const ae = Math.atan2(L[e * 2 + 1]! - m[e * 3 + 1]!, L[e * 2]! - m[e * 3]!)
  p.arc(m[e * 3]!, m[e * 3 + 1]!, he, ae, ae + Math.PI, true)
  for (let i = n - 1; i >= 0; i--) p.lineTo(R[i * 2]!, R[i * 2 + 1]!)
  const h0 = m[2]!
  const a0 = Math.atan2(R[1]! - m[1]!, R[0]! - m[0]!)
  p.arc(m[0]!, m[1]!, h0, a0, a0 + Math.PI, true)
  p.closePath()
  return p
}

const cache = new Map<string, InkGeom | null>()
/** 同一份读进来的笔画对象每帧都用：先按对象找（不用每帧拼一遍长长的点列当键） */
const byStroke = new WeakMap<InkStroke, InkGeom | null>()

/** 一笔的样子（按笔种和点列缓存；点列写坏了是 null，不画） */
export function geomOf(s: InkStroke): InkGeom | null {
  const own = byStroke.get(s)
  if (own !== undefined) return own
  const key = s.pen + '|' + s.p
  let g = cache.get(key)
  if (g === undefined) {
    g = build(s)
    if (cache.size > 50_000) cache.clear()
    cache.set(key, g)
  }
  byStroke.set(s, g)
  return g
}

function build(s: InkStroke): InkGeom | null {
  const c = scanPoints(s.p)
  if (!c || !c.length) return null
  const { nib, alpha } = nibOf(s.pen)
  const n = c.length / 4
  let maxW = 0
  for (let i = 2; i < c.length; i += 4) maxW = Math.max(maxW, c[i]!)
  const sp = spline(c, n)
  const k = sp.length / 4
  const mid = new Float32Array(k * 3)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = 0; i < k; i++) {
    const a = Math.max(0, i - 1)
    const b = Math.min(k - 1, i + 1)
    const h = halfWidth(nib, sp[i * 4 + 2]!, sp[i * 4 + 3]!, sp[b * 4]! - sp[a * 4]!, sp[b * 4 + 1]! - sp[a * 4 + 1]!)
    mid[i * 3] = sp[i * 4]!
    mid[i * 3 + 1] = sp[i * 4 + 1]!
    mid[i * 3 + 2] = h
    x0 = Math.min(x0, sp[i * 4]! - h)
    y0 = Math.min(y0, sp[i * 4 + 1]! - h)
    x1 = Math.max(x1, sp[i * 4]! + h)
    y1 = Math.max(y1, sp[i * 4 + 1]! + h)
  }
  // 简化的：只用控制点（每隔几个取一个），宽取平均，连成粗线
  const lod = new Path2D()
  const step = Math.max(1, Math.floor(n / 12))
  lod.moveTo(c[0]!, c[1]!)
  for (let i = step; i < n; i += step) lod.lineTo(c[i * 4]!, c[i * 4 + 1]!)
  lod.lineTo(c[(n - 1) * 4]!, c[(n - 1) * 4 + 1]!)
  let sum = 0
  for (let i = 2; i < mid.length; i += 3) sum += mid[i]!
  return { path: nib.kind === 'flat' ? chisel(nib, sp) : outline(mid), lod, box: [x0, y0, x1, y1], mid, w: (2 * sum) / k, alpha: alpha * hairAlpha(s.pen, maxW), marker: s.pen === 'marker' }
}

/**
 * 扁头（荧光笔、书法钢笔）：笔尖是一个顺着方位角的小长方形，两个插值点之间扫过的是这两个长方形的凸包；
 * 每块凸包都按逆时针加进同一个 Path2D，非零规则填一次就是并起来（同一笔自己叠的地方不会更深，和 PencilKit 一样）；两头是平的
 */
function chisel(nib: Extract<Nib, { kind: 'flat' }>, sp: Float64Array): Path2D {
  const p = new Path2D()
  const k = sp.length / 4
  const corners = (i: number): number[] => {
    const x = sp[i * 4]!
    const y = sp[i * 4 + 1]!
    const s = sp[i * 4 + 2]!
    const az = sp[i * 4 + 3]!
    const ax = (Math.cos(az) * nib.along(s)) / 2
    const ay = (Math.sin(az) * nib.along(s)) / 2
    const bx = (-Math.sin(az) * nib.across(s)) / 2
    const by = (Math.cos(az) * nib.across(s)) / 2
    return [x + ax + bx, y + ay + by, x + ax - bx, y + ay - by, x - ax - bx, y - ay - by, x - ax + bx, y - ay + by]
  }
  const poly = (q: number[]) => {
    p.moveTo(q[0]!, q[1]!)
    for (let j = 2; j < q.length; j += 2) p.lineTo(q[j]!, q[j + 1]!)
    p.closePath()
  }
  if (k === 1) {
    poly(hull(corners(0)))
    return p
  }
  let prev = corners(0)
  for (let i = 1; i < k; i++) {
    const next = corners(i)
    poly(hull([...prev, ...next]))
    prev = next
  }
  return p
}

/** 平面点集的凸包（单调链），逆时针；输入输出都是 x、y 交替 */
function hull(xy: number[]): number[] {
  const pts: [number, number][] = []
  for (let i = 0; i < xy.length; i += 2) pts.push([xy[i]!, xy[i + 1]!])
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: [number, number][] = []
  for (const q of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, q) <= 0) lower.pop()
    lower.push(q)
  }
  const upper: [number, number][] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const q = pts[i]!
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, q) <= 0) upper.pop()
    upper.push(q)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)].flat()
}

/**
 * 快读点列：只要 x、y、宽、方位角（白板上画、量外框用），一个字一个字扫，不切字符串、不跑正则（5000 笔打开时省下大半时间）。
 * 规矩和 @cn/format 的 decodePoints 一样（每点 5、7 或 9 个整数、一笔里个数一样、第一点之后记差），写法不对返回 null
 */
export function scanPoints(p: string): Float64Array | null {
  if (p === '') return new Float64Array(0)
  const out: number[] = []
  let n = -1
  let k = 0
  let v = 0
  let neg = false
  let digits = 0
  const acc = [0, 0, 0, 0, 0, 0, 0]
  const end = (): boolean => {
    if (!digits || k >= 9) return false
    if (k < 7) acc[k]! += neg ? -v : v
    k++
    v = 0
    neg = false
    digits = 0
    return true
  }
  const point = (): boolean => {
    if (n === -1) n = k
    if (k !== n || (n !== 5 && n !== 7 && n !== 9)) return false
    out.push(acc[0]! / 100, acc[1]! / 100, acc[2]! / 100, n >= 7 ? acc[5]! / 100 : 0)
    k = 0
    return true
  }
  for (let i = 0; i < p.length; i++) {
    const c = p.charCodeAt(i)
    if (c >= 48 && c <= 57) {
      v = v * 10 + (c - 48)
      digits++
    } else if (c === 45 && !digits && !neg) neg = true
    else if (c === 44) {
      if (!end()) return null
    } else if (c === 59) {
      if (!end() || !point()) return null
    } else return null
  }
  if (!end() || !point()) return null
  return Float64Array.from(out)
}

const boxes = new WeakMap<InkStroke, [number, number, number, number] | null>()

/**
 * 一笔大概占哪一块（组原点的坐标）：只解开控制点、按最粗的笔尖放宽，不插样条、不算轮廓。
 * 先用它挑出看得见的笔，只给这些算轮廓（打开一块 5000 笔的白板不用一次全算）
 */
export function roughBox(s: InkStroke): [number, number, number, number] | null {
  const own = boxes.get(s)
  if (own !== undefined) return own
  const pts = scanPoints(s.p)
  let b: [number, number, number, number] | null = null
  if (pts && pts.length) {
    const { nib } = nibOf(s.pen)
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    let w = 0
    for (let i = 0; i < pts.length; i += 4) {
      x0 = Math.min(x0, pts[i]!)
      y0 = Math.min(y0, pts[i + 1]!)
      x1 = Math.max(x1, pts[i]!)
      y1 = Math.max(y1, pts[i + 1]!)
      w = Math.max(w, pts[i + 2]!)
    }
    const h = (nib.kind === 'round' ? nib.w(w) : nib.along(w)) / 2 + 1
    b = [x0 - h, y0 - h, x1 + h, y1 + h]
  }
  boxes.set(s, b)
  return b
}

/** 中线上离 (x, y)（组原点的坐标）最近的那一段的距离减半宽：≤ 0 是点在笔上 */
export function distTo(g: InkGeom, x: number, y: number): number {
  const m = g.mid
  const n = m.length / 3
  let best = Infinity
  for (let i = 0; i < n; i++) {
    const ax = m[i * 3]!
    const ay = m[i * 3 + 1]!
    if (i === n - 1) {
      best = Math.min(best, Math.hypot(x - ax, y - ay) - m[i * 3 + 2]!)
      break
    }
    const bx = m[i * 3 + 3]!
    const by = m[i * 3 + 4]!
    const dx = bx - ax
    const dy = by - ay
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0
    const d = Math.hypot(x - ax - t * dx, y - ay - t * dy) - (m[i * 3 + 2]! + (m[i * 3 + 5]! - m[i * 3 + 2]!) * t)
    if (d < best) best = d
  }
  return best
}

/** 这一笔和框（组原点的坐标）碰上了吗：中线有一点在框里，或者框的四边穿过它（碰到就算，和框选卡一样） */
export function touchesBox(g: InkGeom, bx0: number, by0: number, bx1: number, by1: number): boolean {
  const [x0, y0, x1, y1] = g.box
  if (x1 < bx0 || x0 > bx1 || y1 < by0 || y0 > by1) return false
  const m = g.mid
  for (let i = 0; i < m.length; i += 3) {
    const h = m[i + 2]!
    if (m[i]! + h >= bx0 && m[i]! - h <= bx1 && m[i + 1]! + h >= by0 && m[i + 1]! - h <= by1) return true
  }
  return false
}

/** 画在画布上时用的颜色：深色主题照 PencilKit 反亮度 */
/** 画出来的颜色：文件里的旧红旧蓝照新值（inkColor），深色主题再照 PencilKit 反亮度 */
export const shownColor = (c: string, dark: boolean) => (dark ? darkInk(inkColor(c)) : inkColor(c))

/**
 * 画一笔：ctx 已经平移缩放到这一笔的组原点（白板坐标 × 缩放 × 设备像素比）；k 是一个白板点合几个画布像素（软边、细线用）。
 * 白板上（ink-layer.tsx）和对照 PencilKit 的小程序用的都是这一个
 */
export function paintInk(ctx: CanvasRenderingContext2D, g: InkGeom, color: string, o: { dark: boolean; k: number; lod?: boolean }): void {
  ctx.globalAlpha = g.marker ? (o.dark ? 0.95 : 0.8) : g.alpha
  if (o.lod) {
    ctx.strokeStyle = color
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(g.w, 1 / o.k)
    ctx.stroke(g.lod)
    return
  }
  ctx.fillStyle = color
  if (g.marker) {
    ctx.filter = `blur(${(1.2 * o.k).toFixed(2)}px)`
    ctx.fill(g.path)
    ctx.filter = 'none'
  } else ctx.fill(g.path)
}
