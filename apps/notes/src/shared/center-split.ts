/**
 * 中间栏分屏（2026-11-23，「中间栏分屏」，规则见 design/split/README.md）：照 VS Code、Obsidian 把中间的标签拖到边上分成两格。
 * 最多两格，左右（row）或上下（col）。标签还是 App 里那一串（顺序就是标签条上的顺序），这里只记哪些在第二格、
 * 不是当前格的那一格前面是哪个、分隔条在几成。当前格前面的标签就是 App 的 active。
 * 纯数据和纯函数（单元测试 test/center-split.test.ts），不依赖 Electron、DOM。
 */

/** row：左右两格；col：上下两格 */
export type SplitDir = 'row' | 'col'
export type PaneNo = 0 | 1
/** 拖到中间内容的哪一边 */
export type Side = 'left' | 'right' | 'top' | 'bottom'

export interface Split {
  dir: SplitDir
  /** 第一格（左 / 上）占几成，0.2 到 0.8 */
  ratio: number
  /** 第二格（右 / 下）里的标签 id */
  second: string[]
  /** 不是当前格的那一格前面的标签 */
  other: string
}

export const RATIO_MIN = 0.2
export const RATIO_MAX = 0.8
export const clampRatio = (r: number) => Math.min(RATIO_MAX, Math.max(RATIO_MIN, Number.isFinite(r) ? r : 0.5))

export const paneOf = (s: Split | null, id: string | null): PaneNo => (s && id && s.second.includes(id) ? 1 : 0)

/** 一格里的标签，照标签条的顺序 */
export const paneIds = (ids: readonly string[], s: Split | null, p: PaneNo): string[] => ids.filter((id) => paneOf(s, id) === p)

/** 上一次对上的样子：哪些标签、当前格前面是哪个、当前格是哪一格 */
export interface Prev {
  ids: readonly string[]
  active: string | null
  focus: PaneNo
}

/** 离 near 最近的那个（near 在 before 里排第几，就取 list 里第几个，超出取最后一个） */
function nearest(list: string[], before: readonly string[], near: string | null): string {
  if (near && list.includes(near)) return near
  const k = near ? before.indexOf(near) : -1
  if (k < 0) return list[list.length - 1]!
  // 原来在它前面、现在还在这一格的个数，就是它关掉以后接上的位置
  const at = before.slice(0, k).filter((id) => list.includes(id)).length
  return list[Math.min(at, list.length - 1)]!
}

/**
 * 标签、当前标签变了以后把分屏对上：新开的标签落在当前格（上一次的当前格）；关掉、挪走的从第二格拿掉；
 * 一格空了就合回一格（返回 null）；不是当前格的那一格前面的标签没了就换成挨着的。没变返回原来那个对象。
 */
export function settle(s: Split | null, ids: readonly string[], active: string | null, prev: Prev): Split | null {
  if (!s) return null
  const had = new Set(prev.ids)
  const fresh = prev.focus === 1 ? ids.filter((id) => !had.has(id)) : []
  const second = [...s.second.filter((id) => ids.includes(id)), ...fresh]
  const first = ids.filter((id) => !second.includes(id))
  if (!first.length || !second.length) return null
  const focus: PaneNo = active && second.includes(active) ? 1 : 0
  const otherList = focus === 0 ? second : first
  // 换了当前格：刚才的当前标签成了那一格前面的；不然照旧，没了换挨着的
  const want = focus !== prev.focus ? prev.active : s.other
  const other = nearest(otherList, prev.ids, want)
  const same = other === s.other && second.length === s.second.length && second.every((id, i) => id === s.second[i])
  return same ? s : { ...s, second, other }
}

/**
 * 关掉 id 以后当前格前面换成哪个：同一格里挨着的；这一格没别的了，就是另一格前面那个（这一格空了，合回一格）
 */
export function afterClose(ids: readonly string[], s: Split | null, active: string | null, id: string): string | null {
  if (active !== id) return active
  const p = paneOf(s, id)
  const mine = paneIds(ids, s, p)
  const rest = mine.filter((x) => x !== id)
  if (rest.length) return rest[Math.min(mine.indexOf(id), rest.length - 1)]!
  if (s) return s.other
  const all = ids.filter((x) => x !== id)
  return all[Math.min(ids.indexOf(id), all.length - 1)] ?? null
}

/** 能不能拖到边上分出一格：没分屏、这一格不止它一个 */
export const canSplitOut = (ids: readonly string[], s: Split | null) => !s && ids.length > 1

/**
 * 把 id 拖到中间内容的一边（没分屏时）：它自己成一格，别的留在另一格。返回新的分屏和当前标签（就是它）
 */
export function splitOut(ids: readonly string[], active: string | null, id: string, side: Side): { split: Split; active: string } | null {
  if (!ids.includes(id) || ids.length < 2) return null
  const dir: SplitDir = side === 'left' || side === 'right' ? 'row' : 'col'
  const rest = ids.filter((x) => x !== id)
  const other = active && active !== id ? active : nearest(rest, ids, id)
  const second = side === 'right' || side === 'bottom' ? [id] : rest
  return { split: { dir, ratio: 0.5, second, other }, active: id }
}

/** 照着当前标签复制一个（copy，已经排在 ids 里它后面）放到右边 / 下面成一格：快捷键、右键「向右分屏」 */
export function splitCopy(active: string, copy: string, dir: SplitDir): { split: Split; active: string } {
  return { split: { dir, ratio: 0.5, second: [copy], other: active }, active: copy }
}

/**
 * 把 id 挪到第 to 格、排在 before 前面（null：排在那一格最后）：拖到标签条上、拖到另一格的内容上。
 * 返回新的标签顺序和分屏（id 成了当前标签；它原来那一格空了的话由 settle 合回）
 */
export function moveTab(ids: readonly string[], s: Split | null, id: string, to: PaneNo, before: string | null): { ids: string[]; split: Split | null } {
  const rest = ids.filter((x) => x !== id)
  let at: number
  if (before && before !== id && rest.includes(before)) at = rest.indexOf(before)
  else {
    const last = paneIds(rest, s, to).pop()
    at = last ? rest.indexOf(last) + 1 : rest.length
  }
  const next = [...rest.slice(0, at), id, ...rest.slice(at)]
  if (!s) return { ids: next, split: null }
  const second = to === 1 ? [...s.second.filter((x) => x !== id), id] : s.second.filter((x) => x !== id)
  return { ids: next, split: { ...s, second } }
}

/** 本机存的分屏（cn.split:<库>）；坏的、对不上的当没分屏 */
export function parseSplit(raw: string | null): Split | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<Split> | null
    if (!v || (v.dir !== 'row' && v.dir !== 'col') || !Array.isArray(v.second) || typeof v.other !== 'string') return null
    const second = v.second.filter((x): x is string => typeof x === 'string' && !!x)
    if (!second.length) return null
    return { dir: v.dir, ratio: clampRatio(Number(v.ratio)), second, other: v.other }
  } catch {
    return null
  }
}
