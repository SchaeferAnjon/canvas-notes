/**
 * 白板框选（task-5ryf9，17-白板框选 方向 A）里不碰界面的几样：框碰到了哪几张、对齐和等距算出的新坐标。
 * 用户定「碰到就选」（FigJam 的做法）：框和卡有一点重叠就选上；框只选卡，不选整列、不选连线。
 */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** 拖出来的框（两个角，哪个方向拖都行） */
export const boxOf = (a: { x: number; y: number }, b: { x: number; y: number }): Box => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  right: Math.max(a.x, b.x),
  bottom: Math.max(a.y, b.y),
})

/** 碰到就选：有一点重叠就算（只贴着边不算） */
export const touches = (a: Box, b: Box) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

/** 框碰到的那几张 */
export function hitKeys(box: Box, cards: readonly { key: string; r: Box }[]): string[] {
  return cards.filter((c) => touches(box, c.r)).map((c) => c.key)
}

export type AlignKind = 'left' | 'hc' | 'right' | 'top' | 'vc' | 'bottom' | 'dh' | 'dv' | 'tidy'

export interface Placed {
  key: string
  x: number
  y: number
  w: number
  h: number
}

/** 等距、排整齐时两张之间最少空多少 */
const MIN_GAP = 16
/** 排整齐：一张一张之间空 24（和右键「排整齐」一样） */
const TIDY_GAP = 24

/**
 * 只挪空白处的那几张：左 / 水平居中 / 右对齐、顶 / 垂直居中 / 底对齐、横着 / 竖着等距（三张起）、排整齐（照原来从上到下、从左到右排成方阵）。
 * 返回每张的新坐标（白板坐标，取整）；没动的也在里面
 */
export function alignPlaced(cards: readonly Placed[], kind: AlignKind, colW: number): Map<string, { x: number; y: number }> {
  const out = new Map(cards.map((c) => [c.key, { x: c.x, y: c.y }]))
  if (cards.length < 2) return out
  const L = Math.min(...cards.map((c) => c.x))
  const R = Math.max(...cards.map((c) => c.x + c.w))
  const T = Math.min(...cards.map((c) => c.y))
  const B = Math.max(...cards.map((c) => c.y + c.h))
  const set = (c: Placed, p: Partial<{ x: number; y: number }>) => out.set(c.key, { ...out.get(c.key)!, ...p })
  switch (kind) {
    case 'left':
      for (const c of cards) set(c, { x: L })
      break
    case 'right':
      for (const c of cards) set(c, { x: R - c.w })
      break
    case 'hc':
      for (const c of cards) set(c, { x: (L + R) / 2 - c.w / 2 })
      break
    case 'top':
      for (const c of cards) set(c, { y: T })
      break
    case 'bottom':
      for (const c of cards) set(c, { y: B - c.h })
      break
    case 'vc':
      for (const c of cards) set(c, { y: (T + B) / 2 - c.h / 2 })
      break
    case 'dh': {
      if (cards.length < 3) break
      const o = [...cards].sort((a, b) => a.x - b.x)
      const gap = Math.max((R - L - o.reduce((s, c) => s + c.w, 0)) / (o.length - 1), MIN_GAP)
      let x = L
      for (const c of o) {
        set(c, { x })
        x += c.w + gap
      }
      break
    }
    case 'dv': {
      if (cards.length < 3) break
      const o = [...cards].sort((a, b) => a.y - b.y)
      const gap = Math.max((B - T - o.reduce((s, c) => s + c.h, 0)) / (o.length - 1), MIN_GAP)
      let y = T
      for (const c of o) {
        set(c, { y })
        y += c.h + gap
      }
      break
    }
    case 'tidy': {
      const o = [...cards].sort((a, b) => a.y - b.y || a.x - b.x)
      const per = Math.ceil(Math.sqrt(o.length))
      let y = T
      for (let r = 0; r * per < o.length; r++) {
        const row = o.slice(r * per, r * per + per)
        row.forEach((c, i) => set(c, { x: L + i * (colW + TIDY_GAP), y }))
        y += Math.max(...row.map((c) => c.h)) + TIDY_GAP
      }
      break
    }
  }
  for (const [k, p] of out) out.set(k, { x: Math.round(p.x), y: Math.round(p.y) })
  return out
}
