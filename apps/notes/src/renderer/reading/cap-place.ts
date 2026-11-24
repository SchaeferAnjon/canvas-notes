/**
 * PDF、HTML 上选一段、框一块的小条（.capbar 34 高）放哪（task-6cxtc 复审，同网页小条）：在选区上方 6，上面放不下才放到选区下面 6；
 * 左右限在这一栏看得见的那块里（两边各留 8，不算竖滚动条，所以不把滚动区撑宽、栏底不出横向滚动条）；
 * 整条放不下时先藏划线那几颗的名字只留点（.nohl，ParaRead 联动「窄了只留点」），还放不下再藏键帽（.nokbd），五颗照样整个露着。
 */
import { type DependencyList, type RefObject, useLayoutEffect, useState } from 'react'

export interface Area {
  left: number
  top: number
  right: number
  bottom: number
}

/** 小条相对它的定位容器（offsetParent）的位置；nohl：划线那几颗只留点；nokbd：键帽藏起来 */
export interface CapAt {
  left: number
  top: number
  nohl: boolean
  nokbd: boolean
}

const GAP = 6
const EDGE = 8

/** sel、view 都是窗口里的位置；返回小条左上角在窗口里的位置 */
export function placeCap(sel: Area, bar: { w: number; h: number }, view: Area): { x: number; y: number } {
  const above = sel.top - GAP - bar.h
  const y = above >= view.top ? above : sel.bottom + GAP
  const x = Math.max(view.left + EDGE, Math.min(sel.left, view.right - EDGE - bar.w))
  return { x, y }
}

/** 滚动区看得见的那块（不算滚动条）在窗口里的位置 */
export function clientArea(el: HTMLElement): Area {
  const r = el.getBoundingClientRect()
  const left = r.left + el.clientLeft
  const top = r.top + el.clientTop
  return { left, top, right: left + el.clientWidth, bottom: top + el.clientHeight }
}

/**
 * 量好小条放哪：measure 给选区和这一栏在窗口里的位置（还没有就是 null）。小条出来、deps 变了重量一次。
 * 量之前（null）小条先藏着画一遍（visibility: hidden），量完在浏览器画出来之前就放好
 */
export function useCapPlace(ref: RefObject<HTMLElement | null>, measure: () => { sel: Area; view: Area } | null, deps: DependencyList): CapAt | null {
  const [at, setAt] = useState<CapAt | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const m = el && measure()
    if (!el || !m) return setAt(null)
    el.classList.remove('nohl', 'nokbd')
    const room = m.view.right - m.view.left - 2 * EDGE
    const nohl = el.offsetWidth > room
    el.classList.toggle('nohl', nohl)
    const nokbd = el.offsetWidth > room
    el.classList.toggle('nokbd', nokbd)
    const { x, y } = placeCap(m.sel, { w: el.offsetWidth, h: el.offsetHeight }, m.view)
    const o = (el.offsetParent ?? document.body).getBoundingClientRect()
    const next = { left: Math.round(x - o.left), top: Math.round(y - o.top), nohl, nokbd }
    setAt((p) => (p && p.left === next.left && p.top === next.top && p.nohl === next.nohl && p.nokbd === next.nokbd ? p : next))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return at
}

/** 小条的 style：还没量好时藏着 */
export const capStyle = (at: CapAt | null) => (at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' as const })
