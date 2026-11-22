/**
 * 弹层放在哪（task-c22p9，「数据库加列菜单被栏边截掉一半」）：贴着一个按钮、一格弹出来的小浮层都用这一个函数放。
 * 浮层挂在 body 上（position: fixed、窗口坐标），不画在编辑器、白板卡、中栏里面：
 * CodeMirror 的滚动区自成一层（z-index: 0），右栏（z-index: 5）盖在它上面，伸出中栏的半截看起来就像被截掉；
 * 白板的画布有 CSS zoom，画在里面的 fixed 跟着缩放、坐标也被乘。
 *
 * 规则：贴着触发点下面（gap），下面放不下、上面放得下就翻到上面，都放不下就贴着窗口底；
 * 默认左边对齐触发点，右边放不下就往左翻（右边对齐触发点的右边）；align: 'end' 反过来。最后夹进框里，四边留 8。
 * 框是触发点所在的那一栏（中栏、右栏的一格），不出那一栏的可视区域；那一栏比浮层还窄时才用整个窗口。
 * 比窗口还高的浮层限高、里面滚。
 */
import { type HTMLAttributes, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface PopAnchor {
  left: number
  top: number
  bottom: number
  /** 不给就当触发点没有宽（只往里挪，不翻） */
  right?: number
  /** 浮层要待在里面的框（触发点所在的那一栏）；不给就是整个窗口 */
  box?: { left: number; top: number; right: number; bottom: number }
}

export const EDGE = 8

/** 一栏：中栏、右栏（或拖到中间的）一格、左栏 */
const COLUMN = 'main.center, .dview, .dcol, aside.side'

export const anchorOf = (el: Element): PopAnchor => {
  const r = el.getBoundingClientRect()
  const c = el.closest(COLUMN)?.getBoundingClientRect()
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, ...(c ? { box: { left: c.left, top: c.top, right: c.right, bottom: c.bottom } } : {}) }
}

export function popPlace(w: number, h: number, a: PopAnchor, opts: { align?: 'start' | 'end'; gap?: number; vw?: number; vh?: number } = {}) {
  const vw = opts.vw ?? window.innerWidth
  const vh = opts.vh ?? window.innerHeight
  const gap = opts.gap ?? 4
  // 框：那一栏和窗口重叠的部分；放不下这个浮层的那一边用窗口
  const b = a.box
  let x0 = Math.max(0, b?.left ?? 0) + EDGE
  let x1 = Math.min(vw, b?.right ?? vw) - EDGE
  if (x1 - x0 < w) (x0 = EDGE), (x1 = vw - EDGE)
  let y0 = Math.max(0, b?.top ?? 0) + EDGE
  let y1 = Math.min(vh, b?.bottom ?? vh) - EDGE
  if (y1 - y0 < h) (y0 = EDGE), (y1 = vh - EDGE)
  const right = a.right ?? a.left
  const end = opts.align === 'end'
  let left = end ? right - w : a.left
  if (end ? left < x0 : left + w > x1) left = end ? a.left : right - w
  left = Math.max(x0, Math.min(left, x1 - w))
  let top = a.bottom + gap
  if (top + h > y1) top = a.top - gap - h >= y0 ? a.top - gap - h : y1 - h
  top = Math.max(y0, top)
  return { left, top, maxHeight: vh - 2 * EDGE }
}

/** 量好浮层自己的宽高再放（同一帧里画出来再挪，不闪） */
export function placePop(el: HTMLElement, a: PopAnchor, opts: { align?: 'start' | 'end'; gap?: number } = {}) {
  el.style.maxHeight = ''
  const p = popPlace(el.offsetWidth, el.offsetHeight, a, opts)
  el.style.left = p.left + 'px'
  el.style.top = p.top + 'px'
  el.style.right = 'auto'
  if (el.offsetHeight > p.maxHeight) {
    el.style.maxHeight = p.maxHeight + 'px'
    el.style.overflowY = 'auto'
  }
}

/**
 * React 里的浮层：挂到 body，画出来后按触发点放好（at 变了、里面长高了都重放）。
 * 事件照 React 的树往上冒（白板展开的表上 onMouseDown 拦着的，照样拦得住）
 */
export function FloatPop(props: HTMLAttributes<HTMLDivElement> & { at: PopAnchor; align?: 'start' | 'end'; gap?: number }) {
  const { at, align, gap, ...rest } = props
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => placePop(el, at, { align, gap })
    place()
    // 里面长高了（筛选加了一条、选项打字筛出更少）：再放一次，往上翻的不压住按钮
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [at, align, gap])
  return createPortal(<div ref={ref} {...rest} />, document.body)
}
