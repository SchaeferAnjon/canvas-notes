/**
 * 图标栏放不下时收几格进「⋯」（task-2okp6）：不靠「放不下就再收一格、重画、再量」一步步试，
 * 而是拿栏现在有多高、一格多高、一道分隔线多高直接算出来；窗口每变一次尺寸都重算一遍，变矮变高一样。
 * 不碰 DOM，ActivityBar 量好数字传进来；渲染和计算共用 barLayout，算的就是画出来的样子。
 */

export interface FoldCell {
  id: string
  /** 窗口矮、放不下时能收进「⋯」的格子：从最后一格往前收 */
  fold?: boolean
}

/** 收了 folded 格以后画成什么样：每段剩下的格子（空段不画，除了放「⋯」的那一段）、「⋯」跟在哪一段后面 */
export function barLayout<T extends FoldCell>(groups: T[][], folded: number) {
  const foldable = groups.flat().filter((it) => it.fold)
  const hidden = folded ? foldable.slice(-folded) : []
  const hide = new Set(hidden.map((it) => it.id))
  // 「⋯」放在最先收的那一格原来所在的那一段末尾
  const moreGroup = folded ? groups.findIndex((g) => g.includes(foldable[foldable.length - folded]!)) : -1
  const shown = groups.map((g, i) => [g.filter((it) => !hide.has(it.id)), i] as const).filter(([g, i]) => g.length || i === moreGroup)
  return { foldable, hidden, hide, moreGroup, shown }
}

/** 收了 folded 格以后，分隔线以上这些格子一共多高（每段前面一道分隔线，第一段没有；「⋯」也是一格） */
export function barHeight<T extends FoldCell>(groups: T[][], folded: number, m: { cell: number; sep: number }): number {
  const { shown } = barLayout(groups, folded)
  const cells = shown.reduce((n, [g]) => n + g.length, 0) + (folded ? 1 : 0)
  return cells * m.cell + Math.max(0, shown.length - 1) * m.sep
}

/** 放得下 avail 高的最少收几格；全收了也放不下就全收 */
export function fitFold<T extends FoldCell>(groups: T[][], avail: number, m: { cell: number; sep: number }): number {
  const n = groups.flat().filter((it) => it.fold).length
  for (let f = 0; f < n; f++) if (barHeight(groups, f, m) <= avail + 0.5) return f
  return n
}
