/**
 * 左栏怎么组织（2026-11-17 用户定，`左栏按维度组织`）：活动栏上「文件」按位置、「最近」按时间，
 * 分隔线下面是从文件里摘出来、单独占一格的文件夹（默认 课程、收件箱；任意文件夹右键「放到左边」也能摘上来）。
 * 摘了哪些、什么顺序，和每个文件夹的图标、颜色，存在库里的 .canvas-notes/左栏.json（跟着 Git 走）。
 * 纯函数，主进程和界面都用。
 */

export const LEFT_FILE = '.canvas-notes/左栏.json'

/** 没设过时摘在左边的 */
export const DEFAULT_LEFT = ['课程', '收件箱'] as const

/** 8 个低饱和色（`方块配色别太艳`）：树上的图标、首页的图标方块、活动栏（活动栏只用单色符号）都用它 */
export const FOLDER_COLORS = {
  sky: '#2e7fa3',
  green: '#3f8a6e',
  orange: '#b8743a',
  red: '#b5534f',
  purple: '#7b62a8',
  pink: '#b05a82',
  olive: '#8a7d2e',
  slate: '#5f7380',
} as const
export type FolderColor = keyof typeof FOLDER_COLORS
export const COLOR_NAMES: Record<FolderColor, string> = { sky: '天青', green: '绿', orange: '橙', red: '红', purple: '紫', pink: '粉', olive: '橄榄', slate: '石板' }

/** 图标弹层里先摆出来的 32 个 Codicons；上面的搜索框能搜整套 */
export const PICK_ICONS = [
  'folder', 'folder-library', 'inbox', 'edit', 'book', 'notebook', 'map', 'globe',
  'device-camera', 'heart', 'star-full', 'rocket', 'beaker', 'mortar-board', 'briefcase', 'home',
  'lightbulb', 'flame', 'coffee', 'tools', 'music', 'calendar', 'target', 'checklist',
  'compass', 'mail', 'organization', 'archive', 'quote', 'symbol-color', 'pinned', 'file-media',
] as const

export interface FolderLook {
  /** Codicon 的名字 */
  icon?: string
  color?: FolderColor
}

export interface LeftConfig {
  /** 摘到活动栏的文件夹，按顺序 */
  left: string[]
  /** 文件夹 → 自己设的图标和颜色 */
  looks: Record<string, FolderLook>
}

export const defaultLeft = (): LeftConfig => ({ left: [...DEFAULT_LEFT], looks: {} })

/** 库里的文件夹路径：不能空、不能 .. 跳出去、不能是 . 开头的（.git、.canvas-notes） */
export function isFolderPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && p.length < 400 && !p.startsWith('/') && !p.endsWith('/') && p.split('/').every((s) => s !== '' && s !== '..' && !s.startsWith('.'))
}

const isIcon = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) && v.length < 60
const isColor = (v: unknown): v is FolderColor => typeof v === 'string' && v in FOLDER_COLORS

/** 读出来的可能被手改过、合并冲突过：不认识的丢掉；没有「左边」这一项是还没设过，用默认 */
export function normalizeLeft(raw: unknown): LeftConfig {
  if (!raw || typeof raw !== 'object') return defaultLeft()
  const r = raw as Record<string, unknown>
  const left: string[] = []
  if (Array.isArray(r['左边'])) for (const p of r['左边']) if (isFolderPath(p) && !left.includes(p) && left.length < 20) left.push(p)
  const looks: Record<string, FolderLook> = {}
  const rl = r['图标'] && typeof r['图标'] === 'object' ? (r['图标'] as Record<string, unknown>) : {}
  for (const [k, v] of Object.entries(rl)) {
    if (!isFolderPath(k) || !v || typeof v !== 'object') continue
    const look: FolderLook = {}
    const lv = v as Record<string, unknown>
    if (isIcon(lv.icon)) look.icon = lv.icon
    if (isColor(lv.color)) look.color = lv.color
    if (look.icon || look.color) looks[k] = look
  }
  return { left: Array.isArray(r['左边']) ? left : [...DEFAULT_LEFT], looks }
}

/** 写进文件的样子：中文键、两格缩进、最后一个换行 */
export function leftJson(c: LeftConfig): string {
  const n = normalizeLeft({ 左边: c.left, 图标: c.looks })
  return JSON.stringify({ 左边: n.left, 图标: n.looks }, null, 2) + '\n'
}

export const sameAsDefault = (c: LeftConfig) => leftJson(c) === leftJson(defaultLeft())

export const putLeft = (c: LeftConfig, folder: string): LeftConfig => (c.left.includes(folder) ? c : { ...c, left: [...c.left, folder] })
export const takeLeft = (c: LeftConfig, folder: string): LeftConfig => ({ ...c, left: c.left.filter((f) => f !== folder) })

/** 上移（-1）、下移（+1）；到头了不动 */
export function moveLeft(c: LeftConfig, folder: string, by: -1 | 1): LeftConfig {
  const i = c.left.indexOf(folder)
  const j = i + by
  if (i < 0 || j < 0 || j >= c.left.length) return c
  const left = [...c.left]
  ;[left[i], left[j]] = [left[j]!, left[i]!]
  return { ...c, left }
}

/** 拖着排：把 folder 放到 before 前面（before 是 null 放最后） */
export function dropLeft(c: LeftConfig, folder: string, before: string | null): LeftConfig {
  if (!c.left.includes(folder) || folder === before) return c
  const rest = c.left.filter((f) => f !== folder)
  const i = before === null ? rest.length : rest.indexOf(before)
  return i < 0 ? c : { ...c, left: [...rest.slice(0, i), folder, ...rest.slice(i)] }
}

/** 设图标和颜色；look 是 null =「恢复默认」 */
export function setLook(c: LeftConfig, folder: string, look: FolderLook | null): LeftConfig {
  const { [folder]: _old, ...rest } = c.looks
  return { ...c, looks: look && (look.icon || look.color) ? { ...rest, [folder]: look } : rest }
}

/** 文件夹改名、挪走（map 给新路径）、删掉（map 给 null）：左边和图标跟着换；不相干的 map 给 undefined */
export function remapLeft(c: LeftConfig, map: (p: string) => string | null | undefined): LeftConfig {
  const to = (p: string) => {
    const m = map(p)
    return m === undefined ? p : m
  }
  const left = c.left.flatMap((p) => {
    const t = to(p)
    return t ? [t] : []
  })
  const looks: Record<string, FolderLook> = {}
  for (const [k, v] of Object.entries(c.looks)) {
    const t = to(k)
    if (t) looks[t] = v
  }
  return { left: [...new Set(left)], looks }
}

/** 没自己设过时的图标：课程和每门课是书架，收件箱是收件箱，别的普通文件夹 */
export function defaultIcon(folder: string): string {
  if (folder === '课程' || /^课程\/[^/]+$/.test(folder)) return 'folder-library'
  if (folder === '收件箱') return 'inbox'
  return 'folder'
}

export const lookOf = (c: LeftConfig, folder: string): { icon: string; color: string | null } => {
  const l = c.looks[folder]
  return { icon: l?.icon ?? defaultIcon(folder), color: l?.color ? FOLDER_COLORS[l.color] : null }
}

// ---------- 文件夹置顶：和笔记的置顶同一个 .canvas-notes/置顶.json，文件夹写成「写作/」 ----------

export const folderPinKey = (folder: string) => folder + '/'
export const isFolderPin = (p: string) => p.endsWith('/')
