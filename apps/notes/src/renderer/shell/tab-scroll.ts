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

/** 一个标签在标签条内容里的左边和宽（offsetLeft、offsetWidth） */
export type TabBox = { left: number; width: number }

/**
 * 停靠点（标签多了方向 A「停在标签边上」）：标签条只停在这些地方。左端停在某个标签的开头、离左沿 TAB_FADE
 * （让出箭头和渐隐，左端不露半个标签）；第一个标签停在 0
 */
export function tabStops(tabs: TabBox[]): number[] {
  return tabs.map((t, i) => (i === 0 ? 0 : Math.max(0, Math.round(t.left - TAB_FADE))))
}

/**
 * 滚到最右时左端也要停在标签边上：能滚的最远处不是停靠点，就在标签后面补一段空（返回补多宽，0 是不用补）。
 * 最后一个标签比可见区还宽（加上左边让的 24）时停不齐，不补
 */
export function tabTail(tabs: TabBox[], clientWidth: number): number {
  const last = tabs[tabs.length - 1]
  if (!last) return 0
  const max = last.left + last.width - clientWidth
  if (max <= 0) return 0
  const s = tabStops(tabs).find((x) => x >= max - 0.5)
  return s === undefined ? 0 : Math.max(0, Math.round(s - max))
}

/** 标签右边要让出的渐隐：最后一个贴着尽头，不让 */
const padR = (tabs: TabBox[], i: number) => (i === tabs.length - 1 ? 0 : TAB_FADE)

/**
 * 把第 i 个标签（当前标签）整个滚进来，停在停靠点上；已经整个露着、又停在停靠点上就原样返回，
 * 能停的有好几个时挑离现在最近的。标签放得下、加上两边渐隐放不下（标签条被动作区挤得很窄）：标签整个露着，少让一点渐隐
 */
export function revealLeft(scrollLeft: number, clientWidth: number, tabs: TabBox[], i: number): number {
  const t = tabs[i]
  if (!t) return scrollLeft
  const stops = tabStops(tabs)
  const lo = t.left + t.width + padR(tabs, i) - clientWidth
  const hi = stops[i]!
  const ok = stops.filter((s) => s >= lo - 0.5 && s <= hi)
  if (!ok.length) return Math.max(0, Math.round(t.width <= clientWidth ? Math.min(t.left, t.left + t.width - clientWidth + padR(tabs, i)) : hi))
  return ok.reduce((a, b) => (Math.abs(b - scrollLeft) < Math.abs(a - scrollLeft) ? b : a))
}

/**
 * 滚一下、点一下两端的箭头：挪一整个标签，停在停靠点上（照方向 A 小样）。
 * 往右：右边第一个没整个露出来的标签整个滚进来（右边留出渐隐，左端照样停在标签开头）；往左：左边第一个被盖住的标签整个滚进来
 */
export function snapLeft(scrollLeft: number, clientWidth: number, tabs: TabBox[], dir: 1 | -1): number {
  // 只被渐隐压住几像素的不算藏着：不然一下只挪几像素，看着像没动
  const SLACK = 12
  const stops = tabStops(tabs)
  if (dir > 0) {
    const i = tabs.findIndex((x, k) => x.left + x.width + padR(tabs, k) > scrollLeft + clientWidth + SLACK)
    if (i < 0) return scrollLeft
    const lo = tabs[i]!.left + tabs[i]!.width + padR(tabs, i) - clientWidth
    const s = stops.find((x) => x >= lo - 0.5)
    // 这个标签比可见区还宽：右边贴齐它
    return s === undefined || s > stops[i]! ? Math.max(0, Math.round(lo)) : s
  }
  let k = tabs.length - 1
  while (k > 0 && !(tabs[k]!.left < scrollLeft + TAB_FADE - SLACK)) k--
  return stops[k] ?? 0
}
