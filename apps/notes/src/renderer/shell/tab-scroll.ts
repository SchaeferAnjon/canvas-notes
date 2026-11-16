/**
 * 标签条横着滚（照 VS Code）：当前标签要整个露出来，能滚的那一侧画 24 的渐隐。
 * 只算数，不碰 DOM，App 里量好宽度和位置交进来。
 */

/** 渐隐的宽度：当前标签露出来时也要躲开它 */
export const TAB_FADE = 24

/** 哪一侧还有藏着的标签（差 1px 以内算到头，免得小数点让渐隐一直挂着） */
export function tabEdges(scrollLeft: number, scrollWidth: number, clientWidth: number): { left: boolean; right: boolean } {
  return { left: scrollLeft > 1, right: scrollLeft + clientWidth < scrollWidth - 1 }
}

/**
 * 把当前标签整个滚进来要的 scrollLeft；已经整个露着就原样返回。
 * tabLeft 是标签相对标签条内容开头的位置（offsetLeft）。不在两头时让出渐隐那 24，标签字不被渐隐盖住。
 */
export function revealLeft(scrollLeft: number, clientWidth: number, scrollWidth: number, tabLeft: number, tabWidth: number): number {
  const max = Math.max(0, scrollWidth - clientWidth)
  const padL = tabLeft <= 0 ? 0 : TAB_FADE
  const padR = tabLeft + tabWidth >= scrollWidth ? 0 : TAB_FADE
  let next = scrollLeft
  if (tabLeft - padL < scrollLeft) next = tabLeft - padL
  else if (tabLeft + tabWidth + padR > scrollLeft + clientWidth) next = tabLeft + tabWidth + padR - clientWidth
  // 标签比可见区还宽时先保住它的开头
  if (tabWidth + padL + padR > clientWidth) next = tabLeft - padL
  return Math.min(max, Math.max(0, Math.round(next)))
}
