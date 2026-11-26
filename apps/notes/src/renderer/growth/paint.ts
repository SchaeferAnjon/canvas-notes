/**
 * 梦游小图和生长图共用的画法小件（Canvas 2D，坐标是图上的，字和线宽按屏幕像素换算）：弯线、带描边的字、主题颜色。
 */

const lerp = (a: number, b: number, k: number) => a + (b - a) * k

/**
 * 弯线：往一侧弯线长的 18%，只画从 A 到 u（0–1）那一截（线「伸过去」）。sign 定往哪边弯。
 * 不 beginPath / stroke：调用的人决定一条一画还是拼成一条路径一次画
 */
export function curveTo(p: CanvasPath, ax: number, ay: number, bx: number, by: number, u: number, sign: number) {
  const cx = (ax + bx) / 2 - (by - ay) * 0.18 * sign
  const cy = (ay + by) / 2 + (bx - ax) * 0.18 * sign
  p.moveTo(ax, ay)
  if (u >= 0.999) return p.quadraticCurveTo(cx, cy, bx, by)
  const q1x = lerp(ax, cx, u)
  const q1y = lerp(ay, cy, u)
  const q2x = lerp(cx, bx, u)
  const q2y = lerp(cy, by, u)
  p.quadraticCurveTo(q1x, q1y, lerp(q1x, q2x, u), lerp(q1y, q2y, u))
}

export const FONT = '-apple-system, "PingFang SC", "Helvetica Neue", sans-serif'

/** 带底色描边的字（压在线上也看得清）；px 是一个屏幕像素在图上多长 */
export function haloText(ctx: CanvasRenderingContext2D, txt: string, x: number, y: number, o: { size: number; px: number; color: string; halo: string; weight?: number; align?: CanvasTextAlign }) {
  ctx.font = `${o.weight ?? 500} ${o.size * o.px}px ${FONT}`
  ctx.textAlign = o.align ?? 'left'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = 3 * o.px
  ctx.strokeStyle = o.halo
  ctx.strokeText(txt, x, y)
  ctx.fillStyle = o.color
  ctx.fillText(txt, x, y)
}

/** 系统「减少动态效果」开着 */
export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** 换主题、换深浅色时调 again（颜色要重新取） */
export function onThemeChange(again: () => void): () => void {
  const mo = new MutationObserver(again)
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-skin'] })
  const mq = matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', again)
  return () => (mo.disconnect(), mq.removeEventListener('change', again))
}
