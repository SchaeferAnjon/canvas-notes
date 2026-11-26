/**
 * 白板缩放（CN-20）：用户自己选的比例，25% 到 300%（2026-11-25 用户「最多有160% 能不能加到300%」，以前到 200%）；⌘+ / ⌘− 照浏览器的档位走，捏合和 ⌘ 滚轮连续变。
 * 每块白板的比例记在本机（localStorage），不写进文件（守住「打开再保存文件不变」）。
 * 画布上真正的比例 = 用户比例 × 让位系数（AI 浮窗或右栏开着时 0.8）；右上角写的是用户比例，让位时悬停说实际多少（doc-board/corner.tsx）。
 * 放大用 CSS zoom 按比例重排（字、卡、贴纸是重新画的，不是放大位图）；PDF 页缩略图按比例换高清的那份（pdfThumbWidth）。
 */
export const ZOOM_MIN = 0.25
export const ZOOM_MAX = 3
const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

export const clampZoom = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 1000) / 1000))

/** ⌘+ / ⌘−：下一档（不在档位上时先到最近的那一档） */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return STEPS.find((s) => s > z + 0.001) ?? ZOOM_MAX
  return [...STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_MIN
}

/**
 * 捏合、⌘ 滚轮：deltaY 往上（负）是放大。触控板捏合每次只有几个单位，连续变；
 * 实体鼠标滚一格 deltaY 是 100 上下，照原样算一格就从 100% 到 37%：每次最多按 10 算，一格变 10% 左右
 */
export const wheelZoom = (z: number, deltaY: number) => clampZoom(z * Math.exp(-Math.max(-10, Math.min(10, deltaY)) * 0.01))

/** 适合窗口：内容（画布坐标）整个放进 view 宽高里，四周留 40；factor 是让位系数 */
export function fitZoom(content: { x: number; y: number; w: number; h: number } | null, view: { w: number; h: number }, factor: number): number {
  if (!content || content.w <= 0 || content.h <= 0) return 1
  const s = Math.min(view.w / (content.w + 80), view.h / (content.h + 80))
  return clampZoom(s / factor)
}

/** 白板上 PDF 某一页的缩略图画多宽（像素，2 倍屏）：100% 以内 560，放大到 200% 以内 1120，再大 1680，放大到 300% 字也清楚 */
export const pdfThumbWidth = (scale: number) => (scale > 2 ? 1680 : scale > 1 ? 1120 : 560)

const KEY = 'cn.boardZoom:'

export function loadZoom(path: string): number {
  try {
    const v = Number(localStorage.getItem(KEY + path))
    return v ? clampZoom(v) : 1
  } catch {
    return 1
  }
}

export function saveZoom(path: string, z: number) {
  try {
    if (z === 1) localStorage.removeItem(KEY + path)
    else localStorage.setItem(KEY + path, String(z))
  } catch {
    // 记不住比例不影响使用
  }
}
