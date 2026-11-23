/**
 * 工作区布局（2026-11-20 方向 A「拖到哪就在哪」，原型 design/workspace/proto-a.html，DESIGN.v3 1.9）：
 * 窗口中间是几栏，其中一栏是中间的内容（center），别的栏一栏几组、一组几个标签（网页、笔记、AI、大纲、历史）；
 * 再加几个浮窗。一个标签只在一个地方。这里全是纯函数：给一个布局、返回新的布局（没变就返回原来那个），界面和单元测试都用。
 */

/**
 * record：数据库里点开的一条（数据库第三批第 4 块，标签上写那一条的名字）；aicol：数据库 AI 列的右栏一页（「AI 生成一列」，标签上写列名）；
 * auto：数据库的「自动化」一页（规则、记录、编辑一条、按钮列做的事）
 */
export type ViewId = 'web' | 'note' | 'ai' | 'outline' | 'history' | 'record' | 'aicol' | 'auto'
/** 恢复默认时标签的先后（照原型：网页、笔记、AI，再是大纲、历史；数据库点开的一条在最后） */
export const VIEW_ORDER: readonly ViewId[] = ['web', 'note', 'ai', 'outline', 'history', 'aicol', 'auto', 'record']
export const VIEW_NAME: Record<ViewId, string> = { web: '网页', note: '笔记', ai: 'AI', outline: '大纲', history: '历史', record: '记录', aicol: 'AI 列', auto: '自动化' }

export interface Group {
  id: string
  views: ViewId[]
  active: ViewId
  /** 这一组占这一栏高的几分之几（一栏里加起来是 1） */
  f: number
}
export interface SideCol {
  id: string
  w: number
  groups: Group[]
}
export interface CenterCol {
  id: 'center'
}
export type Col = CenterCol | SideCol
export interface FloatWin {
  id: string
  views: ViewId[]
  active: ViewId
  x: number
  y: number
  w: number
  h: number
}
export interface Dock {
  v: 1
  cols: Col[]
  floats: FloatWin[]
  /** 标题栏最右、⌥⌘\ 收起了整个右边：收起前的几栏和浮窗 */
  hidden?: { cols: SideCol[]; floats: FloatWin[] } | null
  /** 收完最后一样、整栏没了时那一栏的宽：再开一栏还是这个宽（右栏拖宽了，下次打开还是这个宽度） */
  lastW?: number
}

/** 新开一栏的宽（没拖过时，A、B 一样） */
export const COL_DEFAULT = 380
/** 一栏最窄 300；最宽不设死数，只让中间至少留 420（界面拖的时候量着管，窗口窄时 fitCols 让；2026-11-21 用户要网页能看得更大，task-zligc） */
export const COL_MIN = 300
/** 拖到一组的左右两边：新的一栏 320；拖到中间的左右两边：340（照原型） */
export const COL_BESIDE = 320
export const COL_CENTER_SIDE = 340
export const FLOAT_W = 380
export const FLOAT_H = 500
export const FLOAT_MIN_W = 300
export const FLOAT_MIN_H = 260
/** 浮窗挪出窗口时至少留这么多在里面 */
export const FLOAT_KEEP = 60
/** 上下分时一组最矮占几分之几 */
export const SPLIT_MIN = 0.18

export type Zone = 'center' | 'top' | 'bottom' | 'left' | 'right'
export type DropTarget = { kind: 'group'; group: string; zone: Zone } | { kind: 'center'; side: 'left' | 'right' } | { kind: 'float'; x: number; y: number }
export interface Bounds {
  w: number
  h: number
}

export const isCenter = (c: Col): c is CenterCol => c.id === 'center'
export const sideCols = (d: Dock): SideCol[] => d.cols.filter((c): c is SideCol => !isCenter(c))
export const emptyDock = (): Dock => ({ v: 1, cols: [{ id: 'center' }], floats: [], hidden: null })
const clone = (d: Dock): Dock => JSON.parse(JSON.stringify(d)) as Dock
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
/** 比例留四位小数（存起来好看、比较不出 0.8200000000000001） */
const r4 = (x: number) => Math.round(x * 10000) / 10000

/** 新的 id：同一种前缀里最大的数加一（读回来的布局接着编，不撞） */
function nid(d: Dock, prefix: 'c' | 'g' | 'f'): string {
  let max = 0
  const see = (id: string) => {
    const m = new RegExp(`^${prefix}(\\d+)$`).exec(id)
    if (m) max = Math.max(max, Number(m[1]))
  }
  const cols = [...d.cols, ...(d.hidden?.cols ?? [])]
  const floats = [...d.floats, ...(d.hidden?.floats ?? [])]
  for (const c of cols) {
    see(c.id)
    if (!isCenter(c)) for (const g of c.groups) see(g.id)
  }
  for (const f of floats) see(f.id)
  return prefix + (max + 1)
}

export interface Found {
  /** 在栏里的一组；在浮窗里是 null */
  col: SideCol | null
  group: Group | FloatWin
  float: boolean
}

/** 这个标签在哪（收起来的不算） */
export function findView(d: Dock, v: ViewId): Found | null {
  for (const c of sideCols(d)) for (const g of c.groups) if (g.views.includes(v)) return { col: c, group: g, float: false }
  for (const f of d.floats) if (f.views.includes(v)) return { col: null, group: f, float: true }
  return null
}

/** 一组（或一个浮窗）按 id 找 */
export function findGroup(d: Dock, id: string): Found | null {
  for (const c of sideCols(d)) for (const g of c.groups) if (g.id === id) return { col: c, group: g, float: false }
  for (const f of d.floats) if (f.id === id) return { col: null, group: f, float: true }
  return null
}

export const isOpen = (d: Dock, v: ViewId) => !!findView(d, v)
/** 看得见：开着、是它那一组前面那个 */
export function isShown(d: Dock, v: ViewId): boolean {
  const f = findView(d, v)
  return !!f && f.group.active === v
}
/** 右边有没有开着的栏（浮窗不算：它不占中间的宽） */
export const hasSide = (d: Dock) => d.cols.some((c) => !isCenter(c))

/** 去掉空的组、空的栏、空的浮窗；每栏的比例加起来回到 1 */
function cleanup(d: Dock): void {
  for (const c of sideCols(d)) {
    c.groups = c.groups.filter((g) => g.views.length)
    if (!c.groups.length) d.lastW = c.w
    const t = c.groups.reduce((a, g) => a + g.f, 0)
    for (const g of c.groups) g.f = r4(t > 0 ? g.f / t : 1 / c.groups.length)
  }
  d.cols = d.cols.filter((c) => isCenter(c) || c.groups.length)
  d.floats = d.floats.filter((f) => f.views.length)
}

/** 从它在的那一组拿掉（不清理），前面那个换成这一组剩下的最后一个 */
function take(d: Dock, v: ViewId): void {
  const f = findView(d, v)
  if (!f) return
  f.group.views = f.group.views.filter((x) => x !== v)
  if (f.group.active === v) f.group.active = f.group.views[f.group.views.length - 1]!
}

/** 收起了整个右边时先开回来 */
function unhide(d: Dock): void {
  if (!d.hidden) return
  const ci = d.cols.findIndex(isCenter)
  d.cols.splice(ci + 1, 0, ...d.hidden.cols)
  d.floats.push(...d.hidden.floats)
  d.hidden = null
}

/**
 * 开一个标签：开着就换到它；没开就放进中间右边第一栏的第一组（右边没有栏就用左边最近那栏），
 * 一栏都没有就在中间右边新开一栏（COL_DEFAULT 宽）。收起着整个右边时先开回来
 */
export function openView(d0: Dock, v: ViewId, w = COL_DEFAULT): Dock {
  if (isShown(d0, v) && !d0.hidden) return d0
  const d = clone(d0)
  unhide(d)
  const f = findView(d, v)
  if (f) {
    f.group.active = v
    return d
  }
  const ci = d.cols.findIndex(isCenter)
  const right = d.cols.slice(ci + 1).find((c): c is SideCol => !isCenter(c))
  const left = d.cols.slice(0, ci).reverse().find((c): c is SideCol => !isCenter(c))
  const col = right ?? left
  if (col) {
    const g = col.groups[0]!
    g.views.push(v)
    g.active = v
  } else d.cols.splice(ci + 1, 0, { id: nid(d, 'c'), w: Math.max(COL_MIN, Math.round(d.lastW ?? w)), groups: [{ id: nid(d, 'g'), views: [v], active: v, f: 1 }] })
  return d
}

export function closeView(d0: Dock, v: ViewId): Dock {
  if (!isOpen(d0, v)) return d0
  const d = clone(d0)
  take(d, v)
  cleanup(d)
  return d
}

/** 开着、在别的标签后面：换到它 */
export function activateView(d0: Dock, v: ViewId): Dock {
  const f = findView(d0, v)
  if (!f || f.group.active === v) return d0
  const d = clone(d0)
  findView(d, v)!.group.active = v
  return d
}

/**
 * 开在 under 那一组的后面（AI 开网页：AI 还在前面，用户点「网页」看，想两样一起看自己拖开）。
 * 已经开着不动；under 没开照常开
 */
export function addBehind(d0: Dock, v: ViewId, under: ViewId): Dock {
  if (isOpen(d0, v)) return d0
  if (!findView(d0, under)) return openView(d0, v)
  const d = clone(d0)
  findView(d, under)!.group.views.push(v)
  return d
}

/** 图标栏、⌘J：看得见再点是收起，开着在后面是换到它，没开是开 */
export const toggleView = (d: Dock, v: ViewId): Dock => (isShown(d, v) && !d.hidden ? closeView(d, v) : openView(d, v))

/** 浮窗的位置：横着、竖着都至少留 FLOAT_KEEP 在窗口里，头不跑到窗口上面去 */
function keepFloat(f: FloatWin, b: Bounds): void {
  f.x = Math.round(clamp(f.x, FLOAT_KEEP - f.w, b.w - FLOAT_KEEP))
  f.y = Math.round(clamp(f.y, 0, b.h - FLOAT_KEEP))
}

/** 浮起来：从它在的地方拿走，放进一个新浮窗（380 × 500）；x、y 是浮窗左上角（照原型：横着 60 起、竖着 48 起，放得下） */
export function floatView(d0: Dock, v: ViewId, at: { x: number; y: number }, b: Bounds): Dock {
  const d = clone(d0)
  unhide(d)
  take(d, v)
  cleanup(d)
  const x = Math.max(60, Math.min(at.x, b.w - FLOAT_W - 40))
  const y = Math.max(48, Math.min(at.y, b.h - FLOAT_H - 40))
  d.floats.push({ id: nid(d, 'f'), views: [v], active: v, x: Math.round(x), y: Math.round(y), w: FLOAT_W, h: FLOAT_H })
  return d
}

/**
 * 拖一个标签放下：放到一组的上半 / 下半（这一组一分为二）、左右两边（旁边新开一栏 320）、中间（叠成标签）；
 * 放到中间内容的左右两边（新开一栏 340）、中间（浮起来）。拖到自己独占的那一组上什么都不变
 */
export function dropView(d0: Dock, v: ViewId, t: DropTarget, b: Bounds = { w: 1440, h: 900 }): Dock {
  if (t.kind === 'float') return floatView(d0, v, t, b)
  if (t.kind === 'group') {
    const tg = findGroup(d0, t.group)
    if (!tg) return d0
    if (tg.group.views.length === 1 && tg.group.views[0] === v) return d0
  }
  const d = clone(d0)
  unhide(d)
  take(d, v)
  cleanup(d)
  if (t.kind === 'center') {
    const ci = d.cols.findIndex(isCenter)
    d.cols.splice(t.side === 'left' ? ci : ci + 1, 0, { id: nid(d, 'c'), w: COL_CENTER_SIDE, groups: [{ id: nid(d, 'g'), views: [v], active: v, f: 1 }] })
    return d
  }
  const at = findGroup(d, t.group)
  if (!at) return d0
  if (t.zone === 'center' || at.float) {
    at.group.views.push(v)
    at.group.active = v
    return d
  }
  const col = at.col!
  const g = at.group as Group
  if (t.zone === 'top' || t.zone === 'bottom') {
    const i = col.groups.indexOf(g)
    const half = g.f / 2
    g.f = half
    col.groups.splice(t.zone === 'top' ? i : i + 1, 0, { id: nid(d, 'g'), views: [v], active: v, f: half })
    return d
  }
  const ci = d.cols.indexOf(col)
  d.cols.splice(t.zone === 'left' ? ci : ci + 1, 0, { id: nid(d, 'c'), w: COL_BESIDE, groups: [{ id: nid(d, 'g'), views: [v], active: v, f: 1 }] })
  return d
}

export function moveFloat(d0: Dock, id: string, x: number, y: number, b: Bounds): Dock {
  const d = clone(d0)
  const f = d.floats.find((x) => x.id === id)
  if (!f) return d0
  f.x = x
  f.y = y
  keepFloat(f, b)
  return d
}

export function resizeFloat(d0: Dock, id: string, w: number, h: number): Dock {
  const d = clone(d0)
  const f = d.floats.find((x) => x.id === id)
  if (!f) return d0
  f.w = Math.round(Math.max(FLOAT_MIN_W, w))
  f.h = Math.round(Math.max(FLOAT_MIN_H, h))
  return d
}

/** 窗口变小：浮窗跟着挪回来（每个都留 FLOAT_KEEP 在里面） */
export function keepFloats(d0: Dock, b: Bounds): Dock {
  const d = clone(d0)
  for (const f of d.floats) keepFloat(f, b)
  return JSON.stringify(d) === JSON.stringify(d0) ? d0 : d
}

/** 「停靠」：浮窗里的标签放回右栏（同 openView 的地方），浮窗里前面那个还在前面 */
export function dockFloat(d0: Dock, id: string): Dock {
  const f = d0.floats.find((x) => x.id === id)
  if (!f) return d0
  let d = clone(d0)
  d.floats = d.floats.filter((x) => x.id !== id)
  for (const v of f.views.filter((x) => x !== f.active)) d = openView(d, v)
  return openView(d, f.active)
}

/** 整栏挪：把第 from 栏挪到第 to 栏前面（to 可以等于栏数：挪到最后）；挪到原处不变 */
export function moveCol(d0: Dock, from: number, to: number): Dock {
  if (to === from || to === from + 1 || from < 0 || from >= d0.cols.length || to < 0 || to > d0.cols.length) return d0
  const d = clone(d0)
  const [c] = d.cols.splice(from, 1)
  d.cols.splice(to > from ? to - 1 : to, 0, c!)
  return d
}

/** 整栏挪（按 id）：把 colId 那栏挪到 before 那栏前面，before 是 null 就挪到最后 */
export function moveColBefore(d: Dock, colId: string, before: string | null): Dock {
  const from = d.cols.findIndex((c) => c.id === colId)
  const to = before === null ? d.cols.length : d.cols.findIndex((c) => c.id === before)
  if (from < 0 || to < 0) return d
  return moveCol(d, from, to)
}

export function setColWidth(d0: Dock, colId: string, w: number): Dock {
  const d = clone(d0)
  const c = sideCols(d).find((x) => x.id === colId)
  if (!c) return d0
  c.w = Math.round(Math.max(COL_MIN, w))
  return c.w === sideCols(d0).find((x) => x.id === colId)!.w ? d0 : d
}

/**
 * 拖挨着的两栏（都不是中间）之间的缝：两栏合起来 total 宽不变，左边那栏 a 拿 aW，右边那栏 b 拿剩下的；每栏最窄 COL_MIN，不设上限
 * （中间不动，task-rbtrz：以前这条缝只改一栏、宽只能从中间要，中间到 420 时拖不动）。合起来不够两个 COL_MIN（窗口太窄）时不动
 */
export function setPairWidths(d0: Dock, aId: string, bId: string, aW: number, total: number): Dock {
  if (total < 2 * COL_MIN) return d0
  const d = clone(d0)
  const a = sideCols(d).find((x) => x.id === aId)
  const b = sideCols(d).find((x) => x.id === bId)
  if (!a || !b) return d0
  a.w = Math.round(clamp(aW, COL_MIN, total - COL_MIN))
  b.w = Math.round(total) - a.w
  const a0 = sideCols(d0).find((x) => x.id === aId)!
  const b0 = sideCols(d0).find((x) => x.id === bId)!
  return a.w === a0.w && b.w === b0.w ? d0 : d
}

/** 两组（同一栏里挨着的）按 id 找：a 在上、b 在下 */
function pair(d: Dock, aId: string, bId: string): [Group, Group] | null {
  for (const c of sideCols(d)) {
    const a = c.groups.find((g) => g.id === aId)
    const b = c.groups.find((g) => g.id === bId)
    if (a && b) return [a, b]
  }
  return null
}

/**
 * 拖上下两组之间的缝：a 占这两组合起来的 ratio（0 到 1），b 占剩下的；一组最矮占整栏的 SPLIT_MIN。
 * 按 id 认（画出来的样子里藏着笔记那一组时，比例照样记在布局里那两组上）
 */
export function setSplit(d0: Dock, aId: string, bId: string, ratio: number): Dock {
  const d = clone(d0)
  const p = pair(d, aId, bId)
  if (!p) return d0
  const [a, b] = p
  const tot = a.f + b.f
  a.f = r4(clamp(ratio * tot, Math.min(SPLIT_MIN, tot / 2), tot - Math.min(SPLIT_MIN, tot / 2)))
  b.f = r4(tot - a.f)
  return d
}

/** 双击缝：上下两组各一半 */
export function resetSplit(d0: Dock, aId: string, bId: string): Dock {
  const d = clone(d0)
  const p = pair(d, aId, bId)
  if (!p) return d0
  const [a, b] = p
  a.f = b.f = r4((a.f + b.f) / 2)
  return d
}

/** 现在开着的标签（栏里、浮窗里、收起着的），按 VIEW_ORDER */
export function openViews(d: Dock): ViewId[] {
  const cols = [...sideCols(d), ...(d.hidden?.cols ?? [])]
  const floats = [...d.floats, ...(d.hidden?.floats ?? [])]
  const all = new Set([...cols.flatMap((c) => c.groups.flatMap((g) => g.views)), ...floats.flatMap((f) => f.views)])
  return VIEW_ORDER.filter((v) => all.has(v))
}

/** 恢复默认：中间右边一栏（380），开着的几样叠成一组，浮窗停回来；AI 看得见就还是 AI 在前面，不然是原来看得见的第一个 */
export function resetDock(d0: Dock): Dock {
  const views = openViews(d0)
  if (!views.length) return emptyDock()
  const shown = views.filter((v) => isShown(d0, v) || !!d0.hidden?.cols.some((c) => c.groups.some((g) => g.active === v)) || !!d0.hidden?.floats.some((f) => f.active === v))
  const active = shown.includes('ai') ? 'ai' : (shown[0] ?? views[views.length - 1]!)
  return { v: 1, cols: [{ id: 'center' }, { id: 'c1', w: COL_DEFAULT, groups: [{ id: 'g1', views, active, f: 1 }] }], floats: [], hidden: null }
}

/** 标题栏最右、⌥⌘\：收起整个右边（几栏、浮窗一起）；收着时再按开回来 */
export function hideAll(d0: Dock): Dock {
  const d = clone(d0)
  if (d.hidden) {
    unhide(d)
    return d
  }
  if (!hasSide(d) && !d.floats.length) return d0
  d.hidden = { cols: sideCols(d), floats: d.floats }
  d.cols = d.cols.filter(isCenter)
  d.floats = []
  return d
}

/** 画出来的样子：用不上的标签（不读 PDF 时的笔记）先拿掉（它独占的那一组、那一栏一起不画），布局里照旧记着 */
export function shownDock(d0: Dock, ok: (v: ViewId) => boolean): Dock {
  if (openViews(d0).every(ok)) return d0
  const d = clone(d0)
  for (const v of VIEW_ORDER) if (!ok(v)) take(d, v)
  cleanup(d)
  return d
}

/**
 * 窗口窄时右边各栏实际画多宽（记住的宽不改）：room 是给这几栏的宽（不含缝）。先把最外面那栏收到 COL_MIN，再收里面的，
 * 都到 COL_MIN 还不够就从最外面那栏起接着收（可以到 0）
 */
export function fitCols(d: Dock, room: number): Record<string, number> {
  const ci = d.cols.findIndex(isCenter)
  const cols = d.cols.map((c, i) => ({ c, i })).filter((x): x is { c: SideCol; i: number } => !isCenter(x.c))
  const out: Record<string, number> = {}
  for (const { c } of cols) out[c.id] = c.w
  let over = cols.reduce((a, x) => a + x.c.w, 0) - room
  if (over <= 0) return out
  // 最外面的先收：离中间越远越先；一样远时右边的先
  const order = [...cols].sort((a, b) => Math.abs(b.i - ci) - Math.abs(a.i - ci) || b.i - a.i)
  for (const min of [COL_MIN, 0])
    for (const { c } of order) {
      if (over <= 0) break
      const cut = Math.min(over, Math.max(0, out[c.id]! - min))
      out[c.id]! -= cut
      over -= cut
    }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k]!)
  return out
}

// ---------------------------------------------------------------- 存、读

const isView = (v: unknown): v is ViewId => typeof v === 'string' && (VIEW_ORDER as readonly string[]).includes(v)
const num = (v: unknown, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? v : dflt)
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 40

/** 读回来时理一遍：认不出的标签名不要，一个标签只留第一处，空的组、栏、浮窗不要，比例加起来回到 1，没有中间那栏补上 */
function normalize(raw: unknown): Dock | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.v !== 1 || !Array.isArray(r.cols)) return null
  const seen = new Set<ViewId>()
  const views = (x: unknown): ViewId[] => (Array.isArray(x) ? x.filter((v): v is ViewId => isView(v) && !seen.has(v) && (seen.add(v), true)) : [])
  const group = (g: unknown): Group | null => {
    if (!g || typeof g !== 'object') return null
    const o = g as Record<string, unknown>
    const vs = views(o.views)
    if (!str(o.id) || !vs.length) return null
    return { id: o.id, views: vs, active: isView(o.active) && vs.includes(o.active) ? o.active : vs[vs.length - 1]!, f: Math.max(0.01, num(o.f, 1)) }
  }
  const side = (c: Record<string, unknown>): SideCol | null => {
    if (!str(c.id) || c.id === 'center' || !Array.isArray(c.groups)) return null
    const groups = c.groups.map(group).filter((g): g is Group => !!g)
    return groups.length ? { id: c.id, w: Math.round(Math.max(COL_MIN, num(c.w, COL_DEFAULT))), groups } : null
  }
  const float = (f: unknown): FloatWin | null => {
    if (!f || typeof f !== 'object') return null
    const o = f as Record<string, unknown>
    const vs = views(o.views)
    if (!str(o.id) || !vs.length) return null
    return {
      id: o.id,
      views: vs,
      active: isView(o.active) && vs.includes(o.active) ? o.active : vs[vs.length - 1]!,
      x: Math.round(num(o.x, 100)),
      y: Math.round(num(o.y, 100)),
      w: Math.round(Math.max(FLOAT_MIN_W, num(o.w, FLOAT_W))),
      h: Math.round(Math.max(FLOAT_MIN_H, num(o.h, FLOAT_H))),
    }
  }
  const cols: Col[] = []
  let center = false
  for (const c of r.cols) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    if (o.id === 'center') {
      if (!center) cols.push({ id: 'center' })
      center = true
      continue
    }
    const s = side(o)
    if (s) cols.push(s)
  }
  if (!center) cols.unshift({ id: 'center' })
  const floats = (Array.isArray(r.floats) ? r.floats : []).map(float).filter((f): f is FloatWin => !!f)
  let hidden: Dock['hidden'] = null
  if (r.hidden && typeof r.hidden === 'object') {
    const h = r.hidden as Record<string, unknown>
    const hc = (Array.isArray(h.cols) ? h.cols : []).map((c) => (c && typeof c === 'object' ? side(c as Record<string, unknown>) : null)).filter((c): c is SideCol => !!c)
    const hf = (Array.isArray(h.floats) ? h.floats : []).map(float).filter((f): f is FloatWin => !!f)
    if (hc.length || hf.length) hidden = { cols: hc, floats: hf }
  }
  const d: Dock = { v: 1, cols, floats, hidden, ...(typeof r.lastW === 'number' && Number.isFinite(r.lastW) ? { lastW: Math.round(Math.max(COL_MIN, r.lastW)) } : {}) }
  cleanup(d)
  return d
}

/**
 * 读本机记着的布局（localStorage 的 cn.dock）；没有、坏了的时候用以前的两个开关（cn.aiOpen：1 开着 AI、notes 只开了笔记；cn.rightW：右栏宽）
 */
export function loadDock(raw: string | null, legacy: { aiOpen?: string | null; rightW?: string | null }, onDrop: (why: string) => void = () => {}): Dock {
  if (raw) {
    // 坏的：当没有，记一行（task-pyb39）
    try {
      const d = normalize(JSON.parse(raw))
      if (d) return d
      onDrop('右栏布局对不上格式')
    } catch (e) {
      onDrop(`右栏布局读不出来：${(e as Error).message}`)
    }
  }
  const w = Number(legacy.rightW) || COL_DEFAULT
  if (legacy.aiOpen === '1') return openView(emptyDock(), 'ai', w)
  if (legacy.aiOpen === 'notes') return openView(emptyDock(), 'note', w)
  return emptyDock()
}
