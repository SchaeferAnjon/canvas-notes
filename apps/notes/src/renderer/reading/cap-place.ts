/**
 * PDF、HTML 上选一段、框一块的小条（.capbar 34 高）放哪（task-6cxtc 复审，同网页小条）：在选区上方 6，上面放不下才放到选区下面 6；
 * 左右限在这一栏看得见的那块里（两边各留 8，不算竖滚动条，所以不把滚动区撑宽、栏底不出横向滚动条）；
 * 整条放不下时先藏划线那几颗的名字只留点（.nohl，ParaRead 联动「窄了只留点」），还放不下再藏键帽（.nokbd），五颗照样整个露着。
 * PDF 选字的小条（fixed，0.5.5）：用户定了 9 颗都留着、不收颗数；藏完名字和键帽这一栏还放不下时，小条浮在上面伸出这一栏，
 * 但不出窗口（贴着窗口边收住），上下照旧在选区上方或下方、不盖住选中的字。它是 position: fixed，不撑宽滚动区，滚动时跟着选区走，
 * 选区滚出这一栏就先藏着。
 */
import { type DependencyList, type RefObject, useLayoutEffect, useState } from 'react'

export interface Area {
  left: number
  top: number
  right: number
  bottom: number
}

/** 小条相对它的定位容器（offsetParent）的位置；nohl：划线那几颗只留点；nokbd：键帽藏起来；out：伸出了这一栏（fixed 的才会） */
export interface CapAt {
  left: number
  top: number
  nohl: boolean
  nokbd: boolean
  out: boolean
}

const GAP = 6
const EDGE = 8

/**
 * sel、view 都是窗口里的位置；返回小条左上角在窗口里的位置。给了 win（窗口）时：这一栏放不下就伸出这一栏，但收在窗口里（两边各留 8）
 */
export function placeCap(sel: Area, bar: { w: number; h: number }, view: Area, win?: Area): { x: number; y: number } {
  const above = sel.top - GAP - bar.h
  const y = above >= view.top ? above : sel.bottom + GAP
  const x = Math.max(view.left + EDGE, Math.min(sel.left, view.right - EDGE - bar.w))
  return { x: win ? Math.max(win.left + EDGE, Math.min(x, win.right - EDGE - bar.w)) : x, y }
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
export function useCapPlace(
  ref: RefObject<HTMLElement | null>,
  measure: () => { sel: Area; view: Area } | null,
  deps: DependencyList,
  /** 给了：小条是 position: fixed，放不下时伸出这一栏、收在窗口里；这个滚动区滚动时重量 */
  fixedIn?: RefObject<HTMLElement | null>,
): CapAt | null {
  const [at, setAt] = useState<CapAt | null>(null)
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current
      const m = el && measure()
      if (!el || !m) return setAt(null)
      // 选区滚出这一栏（fixed 的不会被滚动区裁掉）：先藏着
      if (fixedIn && (m.sel.bottom <= m.view.top || m.sel.top >= m.view.bottom)) return setAt(null)
      el.classList.remove('nohl', 'nokbd')
      const room = m.view.right - m.view.left - 2 * EDGE
      const nohl = el.offsetWidth > room
      el.classList.toggle('nohl', nohl)
      const nokbd = el.offsetWidth > room
      el.classList.toggle('nokbd', nokbd)
      const win = fixedIn ? { left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight } : undefined
      const { x, y } = placeCap(m.sel, { w: el.offsetWidth, h: el.offsetHeight }, m.view, win)
      const o = fixedIn ? { left: 0, top: 0 } : (el.offsetParent ?? document.body).getBoundingClientRect()
      const out = x < m.view.left || x + el.offsetWidth > m.view.right
      const next = { left: Math.round(x - o.left), top: Math.round(y - o.top), nohl, nokbd, out }
      setAt((p) => (p && p.left === next.left && p.top === next.top && p.nohl === next.nohl && p.nokbd === next.nokbd && p.out === next.out ? p : next))
    }
    place()
    const sc = fixedIn?.current
    if (!sc) return
    sc.addEventListener('scroll', place, { passive: true })
    window.addEventListener('resize', place)
    return () => {
      sc.removeEventListener('scroll', place)
      window.removeEventListener('resize', place)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return at
}

/** 小条的 style：还没量好时藏着 */
export const capStyle = (at: CapAt | null) => (at ? { left: at.left, top: at.top } : { left: 0, top: 0, visibility: 'hidden' as const })
