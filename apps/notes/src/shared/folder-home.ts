/**
 * 文件夹首页（设计稿 design-mindmap 第 9 节）：每门课（课程/<课>/）、每个项目（项目/<项目>/）、生活/、写作/ 各有一页，
 * 复用主页的组件网格。页面只是看法：删组件、换排法、恢复默认都不删不挪任何文件。
 * 设置存在那个文件夹里的 .首页.json（跟着 Git 走）；模板存在 课程/.首页模板.json、项目/.首页模板.json。纯函数，主线和界面都用。
 */
import type { Cover } from './home'

export type FolderKind = 'course' | 'project' | 'life' | 'writing'

export const KIND_LABEL: Record<FolderKind, string> = { course: '课程', project: '项目', life: '生活', writing: '写作' }

/** 哪些文件夹有首页：课程、项目下面一层；生活、写作本身。课程/、项目/ 这两层只展开 */
export function folderKind(folder: string): FolderKind | null {
  const p = folder.split('/')
  if (p.some((x) => x === '' || x === '.' || x === '..' || x.startsWith('.'))) return null
  if (p.length === 2 && p[0] === '课程') return 'course'
  if (p.length === 2 && p[0] === '项目') return 'project'
  if (p.length === 1 && p[0] === '生活') return 'life'
  if (p.length === 1 && p[0] === '写作') return 'writing'
  return null
}

/** 左栏「文件夹」里一行：哪个文件夹、什么类、它首页选的图标和颜色 */
export interface FolderEntry {
  folder: string
  kind: FolderKind
  icon: string
  color: string | null
}

const KIND_ORDER: FolderKind[] = ['course', 'project', 'life', 'writing']
/** 按 课程、项目、生活、写作 排，同类按名字 */
export const sortFolders = <T extends { folder: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => KIND_ORDER.indexOf(folderKind(a.folder)!) - KIND_ORDER.indexOf(folderKind(b.folder)!) || a.folder.localeCompare(b.folder, 'zh-CN'))

/** 从文件路径认出有首页的文件夹（梦游预览里挪进来的新课也算） */
export function foldersOfPaths(paths: string[]): string[] {
  const out = new Set<string>()
  for (const p of paths) {
    const x = p.split('/')
    const two = x.length >= 3 ? `${x[0]}/${x[1]}` : null
    if (two && folderKind(two)) out.add(two)
    else if (x.length >= 2 && folderKind(x[0]!)) out.add(x[0]!)
  }
  return sortFolders([...out].map((folder) => ({ folder }))).map((f) => f.folder)
}

/** 新建的课程、项目起名：不能带斜杠、冒号，不能点开头；返回不行的原因 */
export function checkFolderName(name: string): string | null {
  const n = name.trim()
  if (!n) return '名字不能是空的'
  if (/[/\\:]/.test(n) || n.startsWith('.')) return '名字里不能有 / \\ :，也不能用点开头'
  if (n.length > 60) return '名字太长了'
  return null
}

export const homeFileOf = (folder: string) => `${folder}/.首页.json`
/** 课程、项目各一份模板；生活、写作只有一页，不要模板 */
export const templateFileOf = (kind: FolderKind) => (kind === 'course' ? '课程/.首页模板.json' : kind === 'project' ? '项目/.首页模板.json' : null)

export type FWidget =
  | 'slides'
  | 'review'
  | 'exam'
  | 'notes'
  | 'doubts'
  | 'viz'
  | 'cal'
  | 'todo'
  | 'links'
  | 'board'
  | 'text'
  | 'recent'
  | 'progress'
  | 'calendar'
  | 'drafts'
  | 'clips'
  | 'list'

export type FSize = 1 | 2 | 4

/** 组件库：名字、一句说明、默认宽、分类（课程的、通用的、按条件列出的） */
export const FWIDGETS: { type: FWidget; name: string; desc: string; size: FSize; cat: 'course' | 'common' | 'cond' }[] = [
  { type: 'slides', name: '课件进度', desc: '每份 PDF 问到第几页，点了接着读', size: 2, cat: 'course' },
  { type: 'review', name: '今天要复习', desc: 'Anki 里这门课今天到期几张', size: 1, cat: 'course' },
  { type: 'exam', name: '考试倒计时', desc: '填个日期，还有几天；下次上课', size: 1, cat: 'course' },
  { type: 'notes', name: '笔记和导图', desc: '这门课的笔记和导图，按第几讲排', size: 2, cat: 'course' },
  { type: 'doubts', name: '我的疑惑', desc: '读课件时问过的，按讲排', size: 2, cat: 'course' },
  { type: 'viz', name: '可视化', desc: '做好的可视化，缩略图墙', size: 2, cat: 'course' },
  { type: 'cal', name: '学习日历', desc: '这学期每天问了多少', size: 4, cat: 'course' },
  { type: 'todo', name: '待办', desc: '作业、要交的', size: 1, cat: 'common' },
  { type: 'links', name: '快捷链接', desc: '课程网站、老师邮箱、提交页', size: 1, cat: 'common' },
  { type: 'board', name: '嵌一块白板', desc: '这个文件夹的总导图', size: 2, cat: 'common' },
  { type: 'text', name: '自由文本', desc: '老师、教室、考试范围', size: 2, cat: 'common' },
  { type: 'recent', name: '最近改的', desc: '这个文件夹里最近动过的 5 个', size: 2, cat: 'common' },
  { type: 'progress', name: '进度', desc: '阶段和百分比', size: 2, cat: 'common' },
  { type: 'calendar', name: '日历', desc: '本月，有事的日子标一个点', size: 2, cat: 'common' },
  { type: 'drafts', name: '草稿', desc: '草稿 是 是 的', size: 2, cat: 'cond' },
  { type: 'clips', name: '素材', desc: '剪藏和书摘，只列书名和条数', size: 2, cat: 'common' },
  { type: 'list', name: '按条件列出', desc: '自己定条件：类型、第几讲、改过……', size: 2, cat: 'cond' },
]
export const wInfo = (t: FWidget) => FWIDGETS.find((w) => w.type === t)!

// ---------- 按条件列出 ----------

export type CondProp = '类型' | '第几讲' | '改过' | '草稿' | '课程' | '来源'
export const COND_OPS: Record<CondProp, string[]> = {
  类型: ['是其中', '不是'],
  第几讲: ['≥', '=', '≤'],
  改过: ['在'],
  草稿: ['是'],
  课程: ['是', '不是'],
  来源: ['包含'],
}
export interface CondRule {
  prop: CondProp
  op: string
  /** 「是其中」用逗号隔开几个 */
  value: string
}
export interface Cond {
  name: string
  scope: 'folder' | 'vault'
  all: boolean
  rules: CondRule[]
  sort: { prop: '第几讲' | '改过' | '名字'; dir: 'asc' | 'desc' }
  view: 'list' | 'cards' | 'table'
  limit: number
}

/** 一个文件和它的属性（主线读出来给界面的） */
export interface PropFile {
  path: string
  mtimeMs: number
  props: Record<string, string>
}

const DAY = 86400_000
function startOf(span: string, now: Date): number {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (span === '这周') d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  if (span === '这个月') d.setDate(1)
  return d.getTime()
}

export function matchRule(f: PropFile, r: CondRule, now: Date): boolean {
  const v = f.props[r.prop] ?? ''
  switch (r.prop) {
    case '类型':
    case '课程': {
      const set = r.value.split(/[,，、]\s*/).map((s) => s.trim()).filter(Boolean)
      const hit = set.includes(v)
      return r.op === '不是' ? !hit : hit
    }
    case '第几讲': {
      const n = Number(v)
      const want = Number(r.value)
      if (!v || !Number.isFinite(n) || !Number.isFinite(want)) return false
      return r.op === '≥' ? n >= want : r.op === '≤' ? n <= want : n === want
    }
    case '改过':
      return f.mtimeMs >= startOf(r.value, now) && f.mtimeMs <= now.getTime() + DAY
    case '草稿':
      return (/^(true|是|yes)$/i.test(f.props.draft ?? f.props['草稿'] ?? '')) === (r.value !== '否')
    case '来源':
      return v.includes(r.value)
  }
}

export function runCond(files: PropFile[], c: Cond, now = new Date()): PropFile[] {
  const hit = files.filter((f) => (c.rules.length === 0 ? true : c.all ? c.rules.every((r) => matchRule(f, r, now)) : c.rules.some((r) => matchRule(f, r, now))))
  const key = (f: PropFile) => (c.sort.prop === '第几讲' ? Number(f.props['第几讲']) || 0 : c.sort.prop === '改过' ? f.mtimeMs : 0)
  const name = (f: PropFile) => f.path.split('/').pop()!
  const byName = (a: PropFile, b: PropFile) => name(a).localeCompare(name(b), 'zh-CN')
  // 一样大的（同一讲的几篇）按名字排，每次打开顺序都一样
  hit.sort((a, b) => (c.sort.prop === '名字' ? byName(a, b) : key(a) - key(b)) * (c.sort.dir === 'asc' ? 1 : -1) || byName(a, b))
  return hit
}

const isDraft = (f: PropFile) => /^(true|是|yes)$/i.test(f.props.draft ?? f.props['草稿'] ?? '')

/** 首页标题下那一句：「课程 · 5 讲 · 12 个文件 · 问到第 3 讲」「项目 · 9 个文件 · 这周改了 3 个」「写作 · 2 篇草稿 · 这个月写完 1 篇」 */
export function leadOf(kind: FolderKind, files: PropFile[], now = new Date()): string {
  if (!files.length) return `${KIND_LABEL[kind]} · 还没有文件`
  const n = `${files.length} 个文件`
  if (kind === 'course') {
    const lectures = new Set(files.map((f) => Number(f.props['第几讲'])).filter((x) => x > 0))
    const asked = Math.max(0, ...files.filter((f) => Number(f.props['问到']) > 0).map((f) => Number(f.props['第几讲']) || 0))
    return ['课程', ...(lectures.size ? [`${lectures.size} 讲`] : []), n, ...(asked ? [`问到第 ${asked} 讲`] : [])].join(' · ')
  }
  if (kind === 'project') {
    const week = files.filter((f) => f.mtimeMs >= startOf('这周', now)).length
    return `项目 · ${n}${week ? ` · 这周改了 ${week} 个` : ''}`
  }
  if (kind === 'writing') {
    const done = files.filter((f) => !isDraft(f) && f.mtimeMs >= startOf('这个月', now)).length
    return `写作 · ${files.filter(isDraft).length} 篇草稿${done ? ` · 这个月写完 ${done} 篇` : ''}`
  }
  return `生活 · ${n}`
}

export const NOTES_COND: Cond = {
  name: '笔记和导图',
  scope: 'folder',
  all: true,
  rules: [{ prop: '类型', op: '是其中', value: '笔记, 导图' }],
  sort: { prop: '第几讲', dir: 'desc' },
  view: 'list',
  limit: 4,
}
export const DRAFTS_COND: Cond = { name: '草稿', scope: 'folder', all: true, rules: [{ prop: '草稿', op: '是', value: '是' }], sort: { prop: '改过', dir: 'desc' }, view: 'list', limit: 5 }
export const NEW_COND: Cond = { name: '按条件列出', scope: 'folder', all: true, rules: [{ prop: '改过', op: '在', value: '这周' }], sort: { prop: '改过', dir: 'desc' }, view: 'list', limit: 5 }
/** 组件库里「按条件列出」的预设 */
export const COND_PRESETS: Cond[] = [
  { ...NEW_COND, name: '这周问过的' },
  { name: '第 3 讲以后的导图', scope: 'folder', all: true, rules: [{ prop: '类型', op: '是其中', value: '导图' }, { prop: '第几讲', op: '≥', value: '3' }], sort: { prop: '第几讲', dir: 'asc' }, view: 'list', limit: 5 },
  { name: '这个月写完的', scope: 'folder', all: true, rules: [{ prop: '草稿', op: '是', value: '否' }, { prop: '改过', op: '在', value: '这个月' }], sort: { prop: '改过', dir: 'desc' }, view: 'list', limit: 5 },
]

// ---------- 一页的设置 ----------

export interface WidgetData {
  type: FWidget
  /** 按条件列出（笔记和导图、草稿也是它加预设条件） */
  cond?: Cond
  /** 自由文本 */
  text?: string
  /** 考试倒计时：日期 YYYY-MM-DD、叫什么、下次上课 */
  date?: string
  label?: string
  next?: string
  /** 待办：一行一条，[x] 开头是做完的 */
  todos?: string[]
  /** 快捷链接：名字 和 网址 */
  links?: { name: string; url: string }[]
  /** 嵌一块白板：库里的路径 */
  board?: string
  /** 进度：阶段名和百分比 */
  stages?: { name: string; pct: number }[]
}

export interface FolderHome {
  style: 'a' | 'b'
  cover: Cover
  coverY: number
  /** Lucide 图标名（sigma、atom、flask…） */
  icon: string
  /** 图标方块的颜色；null = 不要颜色 */
  color: string | null
  /** 首页上的组件 id，按顺序 */
  order: string[]
  /** 收起来的组件 */
  hidden: string[]
  sizes: Record<string, FSize>
  widgets: Record<string, WidgetData>
}

export const ICONS = ['sigma', 'atom', 'flask-conical', 'graduation-cap', 'book-open', 'code', 'briefcase', 'pen-line', 'coffee', 'leaf', 'music', 'globe'] as const
export const COLORS = ['#7C8A9E', '#8E7C9E', '#9E7C86', '#9E8C70', '#7C9E8A', '#6F8FA8', '#A08A6A'] as const

const DEFAULTS: Record<FolderKind, { icon: string; order: FWidget[]; hidden: FWidget[]; cover: Cover }> = {
  course: { icon: 'sigma', order: ['slides', 'review', 'exam', 'notes', 'doubts', 'viz', 'todo', 'links', 'cal'], hidden: ['board', 'text'], cover: { kind: 'builtin', id: 'myvatn' } },
  project: { icon: 'briefcase', order: ['todo', 'progress', 'recent', 'links', 'text'], hidden: [], cover: { kind: 'builtin', id: 'mist' } },
  writing: { icon: 'pen-line', order: ['drafts', 'clips', 'recent', 'list'], hidden: [], cover: { kind: 'builtin', id: 'paper' } },
  life: { icon: 'coffee', order: ['todo', 'calendar', 'recent', 'text'], hidden: [], cover: { kind: 'builtin', id: 'kirkjufell' } },
}

function seed(t: FWidget, kind: FolderKind): WidgetData {
  if (t === 'notes') return { type: t, cond: NOTES_COND }
  if (t === 'drafts') return { type: t, cond: DRAFTS_COND }
  if (t === 'list') return { type: t, cond: kind === 'writing' ? COND_PRESETS[2]! : NEW_COND }
  return { type: t }
}

export function defaultFolderHome(kind: FolderKind): FolderHome {
  const d = DEFAULTS[kind]
  const widgets: Record<string, WidgetData> = {}
  for (const t of [...d.order, ...d.hidden]) widgets[t] = seed(t, kind)
  return { style: 'a', cover: d.cover, coverY: 50, icon: d.icon, color: null, order: [...d.order], hidden: [...d.hidden], sizes: {}, widgets }
}

const isType = (v: unknown): v is FWidget => FWIDGETS.some((w) => w.type === v)
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : undefined)

function normCond(raw: unknown): Cond | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const rules = (Array.isArray(r.rules) ? r.rules : [])
    .filter((x): x is CondRule => !!x && typeof x === 'object' && (x as CondRule).prop in COND_OPS && COND_OPS[(x as CondRule).prop].includes((x as CondRule).op) && typeof (x as CondRule).value === 'string')
    .slice(0, 8)
    .map((x) => ({ prop: x.prop, op: x.op, value: x.value.slice(0, 200) }))
  const s = (r.sort ?? {}) as Record<string, unknown>
  return {
    name: str(r.name, 40) || '按条件列出',
    scope: r.scope === 'vault' ? 'vault' : 'folder',
    all: r.all !== false,
    rules,
    sort: { prop: s.prop === '第几讲' || s.prop === '名字' ? s.prop : '改过', dir: s.dir === 'asc' ? 'asc' : 'desc' },
    view: r.view === 'cards' || r.view === 'table' ? r.view : 'list',
    limit: Math.min(50, Math.max(1, Math.round(Number(r.limit)) || 5)),
  }
}

function normWidget(raw: unknown): WidgetData | null {
  if (!raw || typeof raw !== 'object' || !isType((raw as WidgetData).type)) return null
  const r = raw as Record<string, unknown>
  const w: WidgetData = { type: r.type as FWidget }
  const cond = normCond(r.cond)
  if (cond) w.cond = cond
  for (const k of ['text', 'date', 'label', 'next', 'board'] as const) if (str(r[k])) w[k] = str(r[k])
  if (Array.isArray(r.todos)) w.todos = r.todos.filter((x): x is string => typeof x === 'string').slice(0, 100).map((x) => x.slice(0, 300))
  if (Array.isArray(r.links)) w.links = r.links.filter((x) => x && typeof x.name === 'string' && typeof x.url === 'string' && /^(https?:|mailto:)/.test(x.url)).slice(0, 20)
  if (Array.isArray(r.stages)) w.stages = r.stages.filter((x) => x && typeof x.name === 'string').slice(0, 10).map((x) => ({ name: String(x.name).slice(0, 40), pct: Math.min(100, Math.max(0, Number(x.pct) || 0)) }))
  return w
}

/** 读出来的可能被手改过、合并冲突过：不认识的丢掉，少的补默认 */
export function normalizeFolderHome(raw: unknown, kind: FolderKind): FolderHome {
  const d = defaultFolderHome(kind)
  if (!raw || typeof raw !== 'object') return d
  const r = raw as Record<string, unknown>
  const widgets: Record<string, WidgetData> = {}
  const rw = (r.widgets && typeof r.widgets === 'object' ? r.widgets : {}) as Record<string, unknown>
  for (const [id, v] of Object.entries(rw)) {
    const w = normWidget(v)
    if (w && /^[a-z]+(-\d+)?$/.test(id)) widgets[id] = w
  }
  const seen = new Set<string>()
  const ids = (v: unknown) => (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!widgets[x] && !seen.has(x) && !!seen.add(x))
  const order = ids(r.order)
  const hidden = ids(r.hidden)
  for (const id of Object.keys(widgets)) if (!seen.has(id)) hidden.push(id)
  const sizes: Record<string, FSize> = {}
  const rs = (r.sizes && typeof r.sizes === 'object' ? r.sizes : {}) as Record<string, unknown>
  for (const [id, s] of Object.entries(rs)) if (widgets[id] && (s === 1 || s === 2 || s === 4)) sizes[id] = s
  const c = (r.cover ?? {}) as Record<string, unknown>
  const cover: Cover = c.kind === 'file' && typeof c.path === 'string' && !c.path.split('/').includes('..') && /\.(png|jpe?g|webp|gif|avif)$/i.test(c.path) ? { kind: 'file', path: c.path } : c.kind === 'builtin' && typeof c.id === 'string' ? (c as Cover) : d.cover
  const y = Number(r.coverY)
  return {
    style: r.style === 'b' ? 'b' : 'a',
    cover,
    coverY: Number.isFinite(y) ? Math.min(100, Math.max(0, Math.round(y))) : d.coverY,
    icon: (ICONS as readonly string[]).includes(r.icon as string) ? (r.icon as string) : d.icon,
    color: (COLORS as readonly string[]).includes(r.color as string) ? (r.color as string) : null,
    order,
    hidden,
    sizes,
    widgets,
  }
}

export const folderHomeJson = (h: FolderHome) => JSON.stringify(h, null, 2) + '\n'

export const sizeOfW = (h: FolderHome, id: string): FSize => h.sizes[id] ?? wInfo(h.widgets[id]!.type).size

/** 从组件库加一个，放在最后：收在抽屉里的同类就把它放回来（设置还在）；按条件列出能加好几个，用新 id */
export function addWidget(h: FolderHome, type: FWidget, kind: FolderKind, cond?: Cond): { home: FolderHome; id: string } {
  const tucked = type === 'list' ? undefined : h.hidden.find((x) => h.widgets[x]!.type === type)
  if (tucked) return { home: { ...showW(h, tucked) }, id: tucked }
  let id: string = type
  for (let n = 2; h.widgets[id]; n++) id = `${type}-${n}`
  const w = seed(type, kind)
  if (cond) w.cond = cond
  return { home: { ...h, order: [...h.order, id], hidden: h.hidden.filter((x) => x !== id), widgets: { ...h.widgets, [id]: w } }, id }
}

/** 删掉一个组件：只是从这页拿掉，文件一个不动 */
export function removeWidget(h: FolderHome, id: string): FolderHome {
  const { [id]: _gone, ...widgets } = h.widgets
  const { [id]: _s, ...sizes } = h.sizes
  return { ...h, order: h.order.filter((x) => x !== id), hidden: h.hidden.filter((x) => x !== id), widgets, sizes }
}

export function moveW(h: FolderHome, id: string, before: string | null): FolderHome {
  if (id === before || !h.order.includes(id)) return h
  const rest = h.order.filter((x) => x !== id)
  const i = before === null ? rest.length : rest.indexOf(before)
  return i < 0 ? h : { ...h, order: [...rest.slice(0, i), id, ...rest.slice(i)] }
}
export const hideW = (h: FolderHome, id: string): FolderHome => (h.order.includes(id) ? { ...h, order: h.order.filter((x) => x !== id), hidden: [...h.hidden, id] } : h)
export const showW = (h: FolderHome, id: string): FolderHome => (h.hidden.includes(id) ? { ...h, hidden: h.hidden.filter((x) => x !== id), order: [...h.order, id] } : h)
export function resizeW(h: FolderHome, id: string): FolderHome {
  const s = sizeOfW(h, id)
  return { ...h, sizes: { ...h.sizes, [id]: s === 1 ? 2 : s === 2 ? 4 : 1 } }
}
export const setWidget = (h: FolderHome, id: string, patch: Partial<WidgetData>): FolderHome => ({ ...h, widgets: { ...h.widgets, [id]: { ...h.widgets[id]!, ...patch } } })
