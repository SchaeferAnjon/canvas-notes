/**
 * ⌘K 的自定义（DESIGN.v3 第 3 节，cmdk 方案方向 A「就地改」，2026-11-21 用户选）：
 * 每组有哪几条、什么顺序（钉住的就是第一组）、自己建的组、藏起的、别名、快捷键、自己加的命令，
 * 还有网页「⋯」藏起的和组里的顺序。存在库里的 .canvas-notes/命令.json（跟着 Git 走，换台 Mac 也在）。
 *
 * 自己加的命令现在有「打开一处」「打开网址」两种；kind 是 ai 的（「把一段对话存成自己的 AI 命令」，task-9womr）
 * 照同一个样子存：id、name、kind、target，再加它自己要的字段。这一版不认识的字段原样写回，以后的版本存的东西不会被这一版抹掉。
 * 纯函数，主进程和界面都用；不依赖 Electron。
 */
import { isCombo, keyProblem } from './cmd-keys'

export const COMMANDS_FILE = '.canvas-notes/命令.json'
export const COMMANDS_VERSION = 1

export type BuiltinGroup = 'pin' | 'recent' | 'go' | 'new' | 'ai' | 'web' | 'lib' | 'app'

/** 八组，从近到远（「最近打开」是最近开过的几篇，不放命令） */
export const GROUPS: readonly { id: BuiltinGroup; name: string }[] = [
  { id: 'pin', name: '钉住的' },
  { id: 'recent', name: '最近打开' },
  { id: 'go', name: '去哪' },
  { id: 'new', name: '新建和导入' },
  { id: 'ai', name: '让AI做' },
  { id: 'web', name: '网页' },
  { id: 'lib', name: '库和同步' },
  { id: 'app', name: '设置和外观' },
]

/** 没改过时每组有哪几条（命令的 id）；只在某些时候才有的（我的疑惑、检查更新、重启更新）也写着，没有时不画 */
export const DEFAULT_ITEMS: Readonly<Record<Exclude<BuiltinGroup, 'recent'>, readonly string[]>> = {
  pin: ['new-note', 'ask-ai', 'goto'],
  go: ['home', 'inbox', 'folders', 'recent', 'open-web', 'dream-report', 'doubts', 'archive'],
  new: ['new-board', 'new-course', 'capture', 'import'],
  ai: ['tidy-inbox', 'sum-board', 'article', 'dream-now'],
  web: ['clip-page', 'translate', 'bookmarks'],
  lib: ['commit', 'sync', 'history', 'dup'],
  app: ['restart-update', 'settings', 'theme', 'edit-home', 'update'],
}

const LAYOUT_IDS = Object.keys(DEFAULT_ITEMS) as Exclude<BuiltinGroup, 'recent'>[]
const isBuiltinGroup = (id: string): boolean => (LAYOUT_IDS as string[]).includes(id)
/** 自己建的组：g- 开头 */
const isOwnGroup = (id: unknown): id is string => typeof id === 'string' && /^g-[\w-]{1,40}$/.test(id)
const isCmdId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200

export interface GroupEntry {
  id: string
  /** 自己建的组才有名字；八组的名字是固定的 */
  name?: string
  items: string[]
}

export type OwnKind = 'open' | 'url' | 'ai'

export interface OwnCommand {
  /** own- 开头 */
  id: string
  name: string
  /** open：打开库里一处（文件夹、笔记、PDF）；url：右栏网页打开网址；ai：交给 AI 的一句话（以后的「存成自己的 AI 命令」） */
  kind: OwnKind | (string & {})
  /** open：库里的路径；url：网址；ai：交给 AI 的话 */
  target: string
  [k: string]: unknown
}

export interface WebMenuConfig {
  /** 藏起的项（插件… 不能藏） */
  hidden: string[]
  /** 组（page、site、bookmarks、browser）→ 里面的顺序 */
  order: Record<string, string[]>
}

export interface CmdConfig {
  /** 每组有哪几条、什么顺序；null = 没改过，用 DEFAULT_ITEMS */
  groups: GroupEntry[] | null
  /** 藏起的（按藏的先后） */
  hidden: string[]
  alias: Record<string, string>
  /** 命令 → 快捷键；空串 = 默认的键拿掉了（给了别人，或者自己清掉了） */
  keys: Record<string, string>
  /** 取消钉住回到哪一组（挪过、钉住之前在哪） */
  homes: Record<string, string>
  own: OwnCommand[]
  web: WebMenuConfig
  /** 不认识的字段：原样写回 */
  rest: Record<string, unknown>
}

/** 现在软件里有的命令：id、它自己那一组（默认钉住的三条也有，取消钉住回到这里）、默认的快捷键 */
export interface Avail {
  id: string
  home?: string
  keys?: string
}

/** preload 暴露成 window.cnCmds（实现在 main/commands.ts） */
export interface CnCmdsApi {
  get(): Promise<CmdConfig>
  /** 交文件里的样子（commandsJson 出来的那份），回读进来的样子 */
  set(json: Record<string, unknown>): Promise<CmdConfig>
  /** forward：网页、视频有焦点时要转给界面的组合键；menu：菜单栏上拍一张导图、设置… 显示的键（null 是没有键） */
  keys(k: { forward: string[]; menu: { capture: string | null; settings: string | null } }): Promise<void>
}

/** 网页「⋯」里一直在的（从菜单回到调整得先有入口） */
export const WEB_LOCKED = 'extensions'

export const defaultCommands = (): CmdConfig => ({ groups: null, hidden: [], alias: {}, keys: {}, homes: {}, own: [], web: { hidden: [], order: {} }, rest: {} })

const uniq = (xs: string[]) => [...new Set(xs)]
const strings = (v: unknown, max = 500): string[] => (Array.isArray(v) ? uniq(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= max)) : [])
const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

const defaultLayout = (): GroupEntry[] => LAYOUT_IDS.map((id) => ({ id, items: [...DEFAULT_ITEMS[id]] }))

function normalizeGroups(v: unknown): GroupEntry[] | null {
  if (!Array.isArray(v)) return null
  const seen = new Set<string>()
  const byId = new Map<string, GroupEntry>()
  const own: GroupEntry[] = []
  for (const raw of v) {
    const g = record(raw)
    const id = g.id
    if (typeof id !== 'string' || byId.has(id) || !(isBuiltinGroup(id) || isOwnGroup(id))) continue
    const items = strings(g.items, 200).filter((x) => !seen.has(x) && (seen.add(x), true))
    const entry: GroupEntry = isOwnGroup(id) ? { id, name: typeof g.name === 'string' && g.name.trim() ? g.name.trim().slice(0, 40) : '我的一组', items } : { id, items }
    byId.set(id, entry)
    if (isOwnGroup(id)) own.push(entry)
  }
  // 八组按固定的先后，缺的补上（空的）；自己建的接在后面
  return [...LAYOUT_IDS.map((id) => byId.get(id) ?? { id, items: [] }), ...own]
}

/** 读 命令.json：坏的、手改错的只留对的那几样，整个读不出当没改过 */
export function normalizeCommands(raw: unknown): CmdConfig {
  const o = record(raw)
  const known = new Set(['version', 'groups', 'hidden', 'alias', 'keys', 'homes', 'own', 'webMenu'])
  const rest = Object.fromEntries(Object.entries(o).filter(([k]) => !known.has(k)))
  const alias: Record<string, string> = {}
  for (const [k, v] of Object.entries(record(o.alias))) if (isCmdId(k) && typeof v === 'string' && v.trim() && v.trim().length <= 20) alias[k] = v.trim()
  const keys: Record<string, string> = {}
  for (const [k, v] of Object.entries(record(o.keys))) if (isCmdId(k) && (v === '' || (isCombo(v) && !keyProblem(v)))) keys[k] = v as string
  const homes: Record<string, string> = {}
  for (const [k, v] of Object.entries(record(o.homes))) if (isCmdId(k) && typeof v === 'string' && (isBuiltinGroup(v) || isOwnGroup(v))) homes[k] = v
  const ownIds = new Set<string>()
  const own: OwnCommand[] = []
  for (const raw of Array.isArray(o.own) ? o.own : []) {
    const c = record(raw)
    if (typeof c.id !== 'string' || !/^own-[\w-]{1,40}$/.test(c.id) || ownIds.has(c.id)) continue
    if (typeof c.name !== 'string' || !c.name.trim() || typeof c.kind !== 'string' || !c.kind || typeof c.target !== 'string' || !c.target.trim() || c.target.length > 4000) continue
    ownIds.add(c.id)
    own.push({ ...c, id: c.id, name: c.name.trim().slice(0, 60), kind: c.kind, target: c.target })
  }
  const wm = record(o.webMenu)
  const order: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(record(wm.order))) if (/^[a-z]{1,20}$/.test(k)) order[k] = strings(v, 60)
  return {
    groups: normalizeGroups(o.groups),
    hidden: strings(o.hidden, 200),
    alias,
    keys,
    homes,
    own,
    web: { hidden: strings(wm.hidden, 60).filter((x) => x !== WEB_LOCKED), order },
    rest,
  }
}

/** 写进 命令.json 的样子（空的几样不写）；不认识的字段原样带上 */
export function commandsJson(c: CmdConfig): string {
  const out: Record<string, unknown> = { version: COMMANDS_VERSION }
  if (c.groups) out.groups = c.groups.map((g) => (g.name !== undefined ? { id: g.id, name: g.name, items: g.items } : { id: g.id, items: g.items }))
  if (c.hidden.length) out.hidden = c.hidden
  if (Object.keys(c.alias).length) out.alias = c.alias
  if (Object.keys(c.keys).length) out.keys = c.keys
  if (Object.keys(c.homes).length) out.homes = c.homes
  if (c.own.length) out.own = c.own
  if (c.web.hidden.length || Object.keys(c.web.order).length) out.webMenu = { ...(c.web.hidden.length ? { hidden: c.web.hidden } : {}), ...(Object.keys(c.web.order).length ? { order: c.web.order } : {}) }
  return JSON.stringify({ ...out, ...c.rest }, null, 2) + '\n'
}

/** 还是没改过的样子：没有文件就不建 */
export function sameAsDefault(c: CmdConfig): boolean {
  return commandsJson(c) === commandsJson(defaultCommands())
}

// ---------------------------------------------------------------- 分组

/** 存着的分组（没改过是默认的） */
export const layoutOf = (c: CmdConfig): GroupEntry[] => c.groups ?? defaultLayout()

/**
 * 现在的分组：存着的，加上现在有、哪组都没写的命令（插件后加的、自己加的，接在它那一组最后）。
 * 存着的、现在没有的（我的疑惑、关掉的插件）照样留在原处，有了又回到那里
 */
export function materialize(c: CmdConfig, avail: readonly Avail[]): GroupEntry[] {
  const L = layoutOf(c).map((g) => ({ ...g, items: [...g.items] }))
  const placed = new Set(L.flatMap((g) => g.items))
  for (const a of avail) {
    if (placed.has(a.id)) continue
    const want = c.homes[a.id] ?? a.home ?? 'app'
    const g = L.find((x) => x.id === want) ?? L.find((x) => x.id === 'app')!
    g.items.push(a.id)
    placed.add(a.id)
  }
  return L
}

export const groupOf = (L: readonly GroupEntry[], id: string): GroupEntry | undefined => L.find((g) => g.items.includes(id))

/** 自己建的组空了就拿掉（keep：正在往里放的那一组） */
const prune = (L: GroupEntry[], keep?: string) => L.filter((g) => isBuiltinGroup(g.id) || g.items.length || g.id === keep)

/** 挪到 gid 组里 before 那一条前面（null 是最后）；挪到钉住的以外的组，取消钉住时回到这里 */
export function moveCmd(c: CmdConfig, avail: readonly Avail[], id: string, gid: string, before: string | null): CmdConfig {
  const L = materialize(c, avail)
  const to = L.find((g) => g.id === gid)
  if (!to) return c
  for (const g of L) g.items = g.items.filter((x) => x !== id)
  const at = before ? to.items.indexOf(before) : -1
  if (at >= 0) to.items.splice(at, 0, id)
  else to.items.push(id)
  return { ...c, groups: prune(L, gid), homes: gid === 'pin' ? c.homes : { ...c.homes, [id]: gid } }
}

/** 钉住：放到钉住的最后，记下原来在哪一组 */
export function pinCmd(c: CmdConfig, avail: readonly Avail[], id: string): CmdConfig {
  const L = materialize(c, avail)
  const from = groupOf(L, id)
  if (from?.id === 'pin') return c
  const next = moveCmd(c, avail, id, 'pin', null)
  return from ? { ...next, homes: { ...next.homes, [id]: from.id } } : next
}

/** 取消钉住：回到原来那一组的最前（照小样）；没记过的回到它自己那一组 */
export function unpinCmd(c: CmdConfig, avail: readonly Avail[], id: string): CmdConfig {
  const L = materialize(c, avail)
  const want = c.homes[id] ?? avail.find((a) => a.id === id)?.home ?? 'go'
  const to = L.find((g) => g.id === want && g.id !== 'pin') ?? L.find((g) => g.id === 'go')!
  return moveCmd(c, avail, id, to.id, to.items.find((x) => x !== id) ?? null)
}

/** 新的一组（放在最后，先空着；接着把一条挪进去） */
export function newGroup(c: CmdConfig, avail: readonly Avail[], name: string, id: string): CmdConfig {
  const L = materialize(c, avail)
  return { ...c, groups: [...L, { id, name: name.trim().slice(0, 40) || '我的一组', items: [] }] }
}

export const hideCmd = (c: CmdConfig, id: string): CmdConfig => (c.hidden.includes(id) ? c : { ...c, hidden: [...c.hidden, id] })
export const unhideCmd = (c: CmdConfig, id: string): CmdConfig => ({ ...c, hidden: c.hidden.filter((x) => x !== id) })

export function setAlias(c: CmdConfig, id: string, alias: string): CmdConfig {
  const a = alias.trim().slice(0, 20)
  const next = { ...c.alias }
  if (a) next[id] = a
  else delete next[id]
  return { ...c, alias: next }
}

// ---------------------------------------------------------------- 快捷键

/** 一条命令现在的键：设过的（空串是拿掉了）→ 默认的 */
export function effectiveKey(c: CmdConfig, id: string, def: string | undefined): string | null {
  const k = c.keys[id]
  if (k !== undefined) return k || null
  return def ?? null
}

/** 给 id 设 combo（null 是清掉）：别的命令现在用着它的，换给这一条（默认的记成空串，自己设的直接拿掉） */
export function setKey(c: CmdConfig, avail: readonly Avail[], id: string, combo: string | null): CmdConfig {
  const defOf = (x: string) => avail.find((a) => a.id === x)?.keys
  const keys = { ...c.keys }
  if (combo) {
    const ids = new Set([...avail.map((a) => a.id), ...Object.keys(keys)])
    for (const other of ids) {
      if (other === id || effectiveKey(c, other, defOf(other)) !== combo) continue
      if (defOf(other) === combo) keys[other] = ''
      else delete keys[other]
    }
  }
  const def = defOf(id)
  if ((combo ?? undefined) === def) delete keys[id]
  else keys[id] = combo ?? ''
  // 默认就没有键、又清掉了：不用记
  if (keys[id] === '' && !def) delete keys[id]
  return { ...c, keys }
}

// ---------------------------------------------------------------- 自己加的命令

export function addOwn(c: CmdConfig, avail: readonly Avail[], cmd: OwnCommand, gid: string): CmdConfig {
  const next = { ...c, own: [...c.own.filter((o) => o.id !== cmd.id), cmd] }
  return moveCmd(next, [...avail, { id: cmd.id, home: gid }], cmd.id, gid, null)
}

/** 改：名字、要做的事、放哪组（换了组才挪） */
export function updateOwn(c: CmdConfig, avail: readonly Avail[], cmd: OwnCommand, gid: string): CmdConfig {
  const next = { ...c, own: c.own.map((o) => (o.id === cmd.id ? { ...o, ...cmd } : o)) }
  const all = [...avail, { id: cmd.id, home: gid }]
  return groupOf(materialize(next, all), cmd.id)?.id === gid ? next : moveCmd(next, all, cmd.id, gid, null)
}

/** 删掉：连同它在哪组、别名、快捷键、藏起一起拿掉 */
export function deleteOwn(c: CmdConfig, id: string): CmdConfig {
  const drop = <T>(r: Record<string, T>) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== id))
  const groups = c.groups ? prune(c.groups.map((g) => ({ ...g, items: g.items.filter((x) => x !== id) }))) : null
  return { ...c, own: c.own.filter((o) => o.id !== id), groups, hidden: c.hidden.filter((x) => x !== id), alias: drop(c.alias), keys: drop(c.keys), homes: drop(c.homes) }
}

// ---------------------------------------------------------------- 网页「⋯」

/** 一组里现在的顺序：调过的在前（按调的顺序），这一版新有的接在后面 */
export function webMenuOrder(c: CmdConfig, group: string, ids: readonly string[]): string[] {
  const saved = (c.web.order[group] ?? []).filter((x) => ids.includes(x))
  return [...saved, ...ids.filter((x) => !saved.includes(x))]
}

export function toggleWebHidden(c: CmdConfig, id: string): CmdConfig {
  if (id === WEB_LOCKED) return c
  const hidden = c.web.hidden.includes(id) ? c.web.hidden.filter((x) => x !== id) : [...c.web.hidden, id]
  return { ...c, web: { ...c.web, hidden } }
}

/** 组里把 id 挪到 before 前面（null 是最后）；ids 是这组现在有的 */
export function moveWebItem(c: CmdConfig, group: string, ids: readonly string[], id: string, before: string | null): CmdConfig {
  const cur = webMenuOrder(c, group, ids).filter((x) => x !== id)
  const at = before ? cur.indexOf(before) : -1
  if (at >= 0) cur.splice(at, 0, id)
  else cur.push(id)
  return { ...c, web: { ...c.web, order: { ...c.web.order, [group]: cur } } }
}
