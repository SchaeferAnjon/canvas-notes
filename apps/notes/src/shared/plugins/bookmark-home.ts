/**
 * 书签首页（新开网页标签时的那一页）的数据：快捷书签怎么摆、稍后再看、打开的标签按网站分组。
 * 纯函数，主进程（存）和界面（摆）都用。
 *
 * 快捷书签 = 「书签栏」里的书签和它的一级子文件夹：子文件夹就是分组（「书签栏 / 冰岛」显示成一个 2×2 小图标的格子）。
 * 拖一个到另一个上 = 新建「书签栏 / 新分组」把两个挪进去；先后记在书签的 order 上。
 * 所以书签栏、书签和历史面板、从 Chrome 导进来的文件夹，和这里看到的是同一份。
 * 下面这些函数只算出「哪个书签挪到哪个文件夹、排第几」（Arrange），主进程一次写盘。
 */
import type { Bookmark } from '../web-api'

export const BAR = '书签栏'
export const OTHER = '其他书签'
/** 快捷书签最多摆几个（分组算一个） */
export const QUICK_MAX = 40

export type QuickTile = { kind: 'link'; key: string; b: Bookmark } | { kind: 'group'; key: string; folder: string; name: string; items: Bookmark[] }

/** 改一个书签的文件夹和 / 或先后 */
export interface Arrange {
  id: string
  folder?: string
  order?: number
}

export interface LaterItem {
  id: string
  url: string
  title: string
  addedMs: number
  /** 看完了（打了勾） */
  done?: boolean
}

const SEP = ' / '
const groupKey = (folder: string) => `f:${folder}`
export const lastName = (folder: string) => folder.split(SEP).pop() ?? folder
const inside = (folder: string, group: string) => folder === group || folder.startsWith(group + SEP)

/** 书签栏下一级的子文件夹（更深的算进它的上一级分组里） */
function groupFolderOf(folder: string): string | null {
  if (!folder.startsWith(BAR + SEP)) return null
  const first = folder.slice(BAR.length + SEP.length).split(SEP)[0]
  return first ? BAR + SEP + first : null
}

/** 按书签算出现在摆着的格子：有 order 的按 order，没有的按加进来的先后排在后面 */
export function quickTiles(bookmarks: Bookmark[]): QuickTile[] {
  const rank = new Map(bookmarks.map((b, i) => [b.id, b.order ?? 1e6 + i]))
  const tiles: (QuickTile & { rank: number })[] = []
  const groups = new Map<string, Bookmark[]>()
  for (const b of bookmarks) {
    if (b.folder === BAR) tiles.push({ kind: 'link', key: b.id, b, rank: rank.get(b.id)! })
    else {
      const g = groupFolderOf(b.folder)
      if (g) groups.set(g, [...(groups.get(g) ?? []), b])
    }
  }
  for (const [folder, items] of groups) {
    const sorted = [...items].sort((a, b) => rank.get(a.id)! - rank.get(b.id)!)
    tiles.push({ kind: 'group', key: groupKey(folder), folder, name: lastName(folder), items: sorted, rank: rank.get(sorted[0]!.id)! })
  }
  return tiles
    .sort((a, b) => a.rank - b.rank)
    .slice(0, QUICK_MAX)
    .map(({ rank: _, ...t }) => t as QuickTile)
}

/** 新分组的名字：「新分组」，有了就「新分组 2」「新分组 3」… */
export function newGroupName(bookmarks: Bookmark[], base = '新分组'): string {
  const taken = new Set(bookmarks.map((b) => groupFolderOf(b.folder)))
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base} ${i}`
    if (!taken.has(BAR + SEP + name)) return name
  }
}

/** 一格：group 是分组的文件夹，单个书签是 null */
interface Slot {
  key: string
  group: string | null
  items: Bookmark[]
}

const asSlots = (tiles: QuickTile[]): Slot[] => tiles.map((t) => (t.kind === 'link' ? { key: t.key, group: null, items: [t.b] } : { key: t.key, group: t.folder, items: t.items }))

/** 把一串格子（新的先后）写成每个书签的文件夹和 order；没变的不写 */
function layout(slots: Slot[]): Arrange[] {
  const out: Arrange[] = []
  slots
    .filter((s) => s.items.length > 0)
    .forEach((s, i) =>
      s.items.forEach((b, j) => {
        const folder = s.group ? (inside(b.folder, s.group) ? b.folder : s.group) : BAR
        const order = i + j / 1000
        if (b.order !== order || b.folder !== folder) out.push({ id: b.id, ...(b.folder !== folder ? { folder } : {}), order })
      }),
    )
  return out
}

/** 挪位置：drag 放到 target 前面（after 时后面） */
export function moveTile(tiles: QuickTile[], drag: string, target: string, after: boolean): Arrange[] {
  const slots = asSlots(tiles)
  const d = slots.find((t) => t.key === drag)
  if (!d || drag === target || !slots.some((t) => t.key === target)) return []
  const rest = slots.filter((t) => t !== d)
  rest.splice(rest.findIndex((t) => t.key === target) + (after ? 1 : 0), 0, d)
  return layout(rest)
}

/**
 * 拖 drag 到 target 上合并：书签拖到书签上 = 新建「书签栏 / <name>」把两个挪进去，放在 target 的位置；
 * 书签拖到分组上 = 加进那个分组。分组不能拖进别的格子（返回空）。
 */
export function mergeTiles(tiles: QuickTile[], drag: string, target: string, name: string): Arrange[] {
  const slots = asSlots(tiles)
  const d = slots.find((t) => t.key === drag)
  const t = slots.find((x) => x.key === target)
  if (!d || !t || d === t || d.group) return []
  const rest = slots.filter((x) => x !== d)
  const i = rest.indexOf(t)
  rest[i] = t.group ? { ...t, items: [...t.items, ...d.items] } : { key: groupKey(BAR + SEP + name), group: BAR + SEP + name, items: [...t.items, ...d.items] }
  return layout(rest)
}

/** 移出分组：放回书签栏，排在分组后面 */
export function removeFromGroup(tiles: QuickTile[], key: string, id: string): Arrange[] {
  const slots = asSlots(tiles)
  const i = slots.findIndex((t) => t.key === key)
  const g = slots[i]
  const b = g?.items.find((x) => x.id === id)
  if (!g || !b) return []
  slots.splice(i, 1, { ...g, items: g.items.filter((x) => x !== b) }, { key: b.id, group: null, items: [b] })
  return layout(slots)
}

/** 解散分组：里面的书签回到书签栏，在分组原来的位置 */
export function dissolve(tiles: QuickTile[], key: string): Arrange[] {
  const slots = asSlots(tiles)
  const i = slots.findIndex((t) => t.key === key)
  const g = slots[i]
  if (!g?.group) return []
  slots.splice(i, 1, ...g.items.map((b) => ({ key: b.id, group: null, items: [b] })))
  return layout(slots)
}

/** 分组改名：文件夹「书签栏 / 旧名」（连同更深的）换成新名字 */
export function renameGroup(bookmarks: Bookmark[], folder: string, name: string): Arrange[] {
  const n = name.replace(/\//g, '／').trim().slice(0, 40)
  if (!n) return []
  const to = BAR + SEP + n
  if (to === folder) return []
  return bookmarks.filter((b) => inside(b.folder, folder)).map((b) => ({ id: b.id, folder: to + b.folder.slice(folder.length) }))
}

/** 移出快捷书签：挪到「其他书签」（书签本身还在） */
export const takeOut = (ids: string[]): Arrange[] => ids.map((id) => ({ id, folder: OTHER }))

/** 加到快捷书签：挪进书签栏，排在最后 */
export function putIn(tiles: QuickTile[], b: Bookmark): Arrange[] {
  return layout([...asSlots(tiles), { key: b.id, group: null, items: [b] }])
}

// ---------------------------------------------------------------- 稍后再看

const isWebUrl = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u) && u.length < 8192

export function normalizeLater(raw: unknown): LaterItem[] {
  const out: LaterItem[] = []
  for (const x of Array.isArray(raw) ? raw : []) {
    const it = (x ?? {}) as Partial<Record<keyof LaterItem, unknown>>
    if (typeof it.id !== 'string' || !it.id || !isWebUrl(it.url) || out.some((y) => y.id === it.id)) continue
    out.push({
      id: it.id,
      url: it.url,
      title: typeof it.title === 'string' && it.title.trim() ? it.title.slice(0, 300) : it.url,
      addedMs: typeof it.addedMs === 'number' && Number.isFinite(it.addedMs) ? it.addedMs : 0,
      ...(it.done === true ? { done: true } : {}),
    })
    if (out.length >= 500) break
  }
  return out
}

/** 存一个到稍后再看：同网址已经有了就挪到最前、去掉勾 */
export function addLater(list: LaterItem[], page: { url: string; title: string }, now: number, id: string): LaterItem[] {
  if (!isWebUrl(page.url)) throw new Error('只能存 http(s) 网页')
  const old = list.find((x) => x.url === page.url)
  const item: LaterItem = { id: old?.id ?? id, url: page.url, title: page.title.trim().slice(0, 300) || page.url, addedMs: now }
  return [item, ...list.filter((x) => x.url !== page.url)].slice(0, 500)
}

/** 显示顺序：没看完的在前（新存的在前），看完的在后 */
export function sortLater(list: LaterItem[]): LaterItem[] {
  return [...list].sort((a, b) => Number(!!a.done) - Number(!!b.done) || b.addedMs - a.addedMs)
}

// ---------------------------------------------------------------- 打开的标签、文件夹

export function siteOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** 打开的标签按网站分组：标签多的网站在前，同样多的按第一次出现的先后 */
export function groupBySite<T extends { url: string }>(tabs: T[]): { site: string; tabs: T[] }[] {
  const m = new Map<string, T[]>()
  for (const t of tabs) {
    const s = siteOf(t.url)
    m.set(s, [...(m.get(s) ?? []), t])
  }
  return [...m].map(([site, list]) => ({ site, tabs: list })).sort((a, b) => b.tabs.length - a.tabs.length)
}

/** 所有文件夹和里面几个书签，按书签栏、其他书签、名字排 */
export function foldersOf(bookmarks: Bookmark[]): { path: string; count: number }[] {
  const m = new Map<string, number>()
  for (const b of bookmarks) m.set(b.folder, (m.get(b.folder) ?? 0) + 1)
  const top = (p: string) => (inside(p, BAR) ? 0 : 1)
  return [...m].map(([path, count]) => ({ path, count })).sort((a, b) => top(a.path) - top(b.path) || a.path.localeCompare(b.path, 'zh'))
}

/** 几天前（稍后再看、书签管家里用） */
export function ago(ms: number, now = Date.now()): string {
  if (!ms) return ''
  const d = Math.floor((now - ms) / 86400_000)
  if (d <= 0) return '今天'
  if (d === 1) return '昨天'
  if (d < 30) return `${d} 天前`
  const t = new Date(ms)
  return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()}`
}
