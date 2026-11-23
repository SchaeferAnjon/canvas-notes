/**
 * PDF 的缩放（r82）：比例是 PDF 上的 100%（1 个 PDF 点 = 1 个 CSS 像素）的几倍，25% 到 500%。
 * 「适合宽度」「适合整页」跟着栏宽、栏高变，其余是定死的比例；每份 PDF 记自己的（本机 localStorage，不写进库）。
 * ⌘+ / ⌘− 照档位走，捏合和 ⌘ / ⌃ 滚轮连续变（同白板 board-zoom.ts 的手感）。
 */
import type { PdfPrefs } from '../../shared/prefs'

export type PdfZoom = 'width' | 'page' | number

export const SCALE_MIN = 0.25
export const SCALE_MAX = 5
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5]
/** 「100% ▾」菜单里直接点的几档 */
export const PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3]

export const clampScale = (s: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(s * 1000) / 1000))

/** ⌘+ / ⌘−：下一档（不在档位上时先到最近的那一档） */
export function stepScale(s: number, dir: 1 | -1): number {
  if (dir > 0) return STEPS.find((x) => x > s + 0.001) ?? SCALE_MAX
  return [...STEPS].reverse().find((x) => x < s - 0.001) ?? SCALE_MIN
}

/** 捏合、⌘ 滚轮：deltaY 往上（负）是放大；一次最多按 10 算（实体鼠标一格 deltaY 上百，一格变 10% 左右） */
export const wheelScale = (s: number, deltaY: number) => clampScale(s * Math.exp(-Math.max(-10, Math.min(10, deltaY)) * 0.01))

/** 这一栏里放得下的比例：适合宽度看最宽那页；适合整页让这一页整页放得下 */
export function fitScale(fit: 'width' | 'page', view: { w: number; h: number }, maxW: number, page: { w: number; h: number }): number {
  const byW = view.w / maxW
  if (fit === 'width') return byW
  return Math.min(view.w / page.w, view.h / page.h)
}

const KEY = (p: string) => `cn.pdfScale:${p}`
/** 0.5.x 以前记的是「适合宽度的几倍」 */
const OLD_KEY = (p: string) => `cn.pdfZoom:${p}`

/** 这份 PDF 记着的缩放；没记过照设置 › 读PDF「新打开的PDF缩放」。旧写法（适合宽度的几倍）给 rel，量好栏宽后换成比例 */
export function loadZoom(path: string, first: PdfPrefs['zoom']): { zoom: PdfZoom; rel?: number } {
  try {
    const v = localStorage.getItem(KEY(path))
    if (v === 'width' || v === 'page') return { zoom: v }
    if (v && Number(v) > 0) return { zoom: clampScale(Number(v)) }
    const old = Number(localStorage.getItem(OLD_KEY(path)))
    if (old > 0) return old === 1 ? { zoom: 'width' } : { zoom: 'width', rel: old }
  } catch {
    // 读不到当第一次打开
  }
  return { zoom: first === 'actual' ? 1 : first }
}

export function saveZoom(path: string, z: PdfZoom) {
  try {
    localStorage.setItem(KEY(path), String(z))
    localStorage.removeItem(OLD_KEY(path))
  } catch {
    // 记不住缩放不影响看
  }
}
