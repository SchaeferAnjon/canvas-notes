/**
 * 左栏右边缘的分隔线（DESIGN：左栏 200 到 400 可拖，记住宽度）：拖它改 --side-w，松手记在本机 cn.sideW；
 * 双击回到默认（A 252；B 248，含岛右边 6 的缝，DESIGN.v3 1.3）。中间至少留 420。左栏收起时不出。
 */
import { useState } from 'react'

export const SIDE_KEY = 'cn.sideW'
export const SIDE_MIN = 200
export const SIDE_MAX = 400
/** 没拖过时的宽（shell.css 的 --side-w：A 252，B 248） */
export const SIDE_DEFAULT = { a: 252, b: 248 } as const
export const CENTER_MIN = 420
/** 右栏拖不窄于 300（App 的右栏分隔线） */
export const RIGHT_MIN = 300
/** 右栏没拖过时的宽（A、B 一样；2026-11-19 从 340 改成 380，照 AI 和读 PDF 的小样） */
export const RIGHT_DEFAULT = 380

export function loadSideW(): number | null {
  try {
    const v = Number(localStorage.getItem(SIDE_KEY))
    return v ? clampSideW(v, Infinity, 0, 0) : null
  } catch {
    return null
  }
}

/**
 * 窗口变窄时左右栏实际画多宽（记住的宽度不改，窗口再拉宽就回来）：中间至少留 420；
 * 先收右栏（到 300），再收左栏（到 200），还不够右栏接着让。side、right 是 0 表示收起着。
 */
export function fitPanels(winW: number, abars: number, side: number, right: number): { side: number; right: number } {
  let over = abars + side + right + CENTER_MIN - winW
  if (over <= 0) return { side, right }
  const cut = (w: number, min: number) => {
    const c = Math.min(over, Math.max(0, w - min))
    over -= c
    return w - c
  }
  let r = right > 0 ? cut(right, RIGHT_MIN) : 0
  const s = side > 0 ? cut(side, SIDE_MIN) : 0
  if (over > 0 && r > 0) r = cut(r, 0)
  return { side: Math.round(s), right: Math.round(r) }
}

/** 拖到 want 宽：夹在 200–400，窗口窄时再让中间至少留 420 */
export function clampSideW(want: number, winW: number, abars: number, rightW: number): number {
  const room = winW - abars - rightW - CENTER_MIN
  return Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, room, want)))
}

export function SideSash(props: { frame: 'a' | 'b'; rightW: number; width: number | null; onWidth(w: number | null): void }) {
  const [drag, setDrag] = useState(false)
  const abar = props.frame === 'a' ? 48 : 44
  const save = (w: number | null) => {
    try {
      if (w === null) localStorage.removeItem(SIDE_KEY)
      else localStorage.setItem(SIDE_KEY, String(w))
    } catch {
      // 记不住宽度不影响使用
    }
  }
  return (
    <div
      className={'hsplit' + (drag ? ' dragging' : '')}
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整左栏宽度"
      aria-valuemin={SIDE_MIN}
      aria-valuemax={SIDE_MAX}
      aria-valuenow={props.width ?? SIDE_DEFAULT[props.frame]}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        setDrag(true)
        document.body.classList.add('resizing', 'resizing-left')
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
        // B 的左栏岛右边有 6 的缝，分隔线在缝正中
        const want = e.clientX - abar + (props.frame === 'b' ? 3 : 0)
        props.onWidth(clampSideW(want, window.innerWidth, 2 * abar, props.rightW))
      }}
      onPointerUp={(e) => {
        document.body.classList.remove('resizing', 'resizing-left')
        setDrag(false)
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
        save(props.width)
      }}
      onDoubleClick={() => {
        props.onWidth(null)
        save(null)
      }}
    />
  )
}
