/**
 * 数据库里点一条，在右栏「记录」标签里打开（数据库第三批第 4 块，task-i921u，像 Notion 的侧边预览）。
 * 表格行、看板卡、日历条、画廊卡点开都调这里的 openRecord：同一时间右栏只有一条（再点别的一条换成那一条，同一条再点不重复开），
 * 从这一条的关联点进另一条时记着来路（头上「←」回去）。
 *
 * 只管「开的是哪一条」：右栏的样子在 RecordPeek.tsx，工作区里那个标签由 App 开（onRecordOpen）。
 * 开着哪一条记在本机（cn.record），下次打开软件还在；不写进任何文件。
 */
import { baseYaml, type BaseCtx, type Cell, type ColumnInfo, setPropDef } from '@cn/format'
import { type ReactNode, useSyncExternalStore } from 'react'

export interface RecordReq {
  /** 这一条：库里的相对路径（课程/ecp/课程计划/第3讲 生产.md） */
  path: string
  /** 它所在的数据库块（```base 里那段 YAML）：列的类型、公式、汇总、视图的顺序都从这里来 */
  src: string
  /** 从哪个视图点开的（↑ ↓ 照这个视图的顺序），默认第一个 */
  view?: number
  /** 开它的那张表（同一张表的块改了写法时用 syncRecord 跟上），没有就不跟 */
  from?: string
}

export interface RecordState extends RecordReq {
  view: number
  /** 从关联点过来的：上一条（头上「←」回去），最早的在前 */
  back: RecordReq[]
}

const KEY = 'cn.record'
let cur: RecordState | null = load()
const subs = new Set<() => void>()
const openSubs = new Set<() => void>()

function load(): RecordState | null {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as Partial<RecordState>
    if (typeof o.path !== 'string' || typeof o.src !== 'string') return null
    return { path: o.path, src: o.src, view: typeof o.view === 'number' ? o.view : 0, ...(typeof o.from === 'string' ? { from: o.from } : {}), back: [] }
  } catch {
    return null
  }
}

function set(next: RecordState | null) {
  if (next === cur) return
  cur = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify({ path: next.path, src: next.src, view: next.view, from: next.from }))
    else localStorage.removeItem(KEY)
  } catch {
    // 本机存储打不开：只是下次打开软件不再开着这一条
  }
  for (const f of [...subs]) f()
}

export const recordNow = (): RecordState | null => cur

/**
 * 在右栏打开这一条：已经开着这一条就只把标签换到前面（不重复开）；开着别的就换成这一条。
 * push：从这一条的关联点过去的，记着来路
 */
export function openRecord(req: RecordReq, opts: { push?: boolean } = {}) {
  const view = req.view ?? 0
  const same = cur && cur.path === req.path
  if (!same) {
    const back = opts.push && cur ? [...cur.back, { path: cur.path, src: cur.src, view: cur.view, ...(cur.from ? { from: cur.from } : {}) }] : []
    set({ ...req, view, back })
  } else if (cur && (cur.src !== req.src || cur.view !== view)) set({ ...cur, src: req.src, view, ...(req.from ? { from: req.from } : {}) })
  for (const f of [...openSubs]) f()
}

/** 头上「←」：回到从关联点过来之前那一条 */
export function recordBack() {
  if (!cur?.back.length) return
  const prev = cur.back[cur.back.length - 1]!
  set({ ...prev, view: prev.view ?? 0, back: cur.back.slice(0, -1) })
}

/** ↑ ↓：换成同一个数据库里的另一条（不记来路） */
export function recordGo(path: string) {
  if (!cur || cur.path === path) return
  set({ ...cur, path, back: [] })
}

/** 改了名、挪了地方：跟到新路径（来路里的也换） */
export function recordMoved(from: string, to: string) {
  if (!cur) return
  const map = (p: string) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
  if (map(cur.path) === cur.path && !cur.back.some((b) => map(b.path) !== b.path)) return
  set({ ...cur, path: map(cur.path), back: cur.back.map((b) => ({ ...b, path: map(b.path) })) })
}

/** 开它的那张表改了写法（加了列、换了视图）：跟上，不重新开 */
export function syncRecord(from: string, src: string, view = 0) {
  if (!cur || cur.from !== from || (cur.src === src && cur.view === view)) return
  set({ ...cur, src, view })
}

export function onRecord(f: () => void): () => void {
  subs.add(f)
  return () => subs.delete(f)
}

/** 有人要开一条（App 开右栏的「记录」标签、换到前面） */
export function onRecordOpen(f: () => void): () => void {
  openSubs.add(f)
  return () => openSubs.delete(f)
}

export const useRecord = (): RecordState | null => useSyncExternalStore(onRecord, recordNow)

/**
 * 从关联点进那边的一条：那边的数据库是关联连到的文件夹，没有自己的块时照这一列造一个（只认这个文件夹；两边都写的那一列连回这边）。
 * 用 packages/format 的 baseYaml、setPropDef 造，不另写一份写法
 */
export function linkedSrc(ctx: BaseCtx, prop: string): string {
  const def = ctx.doc.props[prop]
  if (def?.type !== 'relation') return ''
  const src = baseYaml(def.to, ['file.name'])
  return def.twoWay && ctx.doc.folder !== null ? setPropDef(src, def.twoWay, { type: 'relation', to: ctx.doc.folder, twoWay: prop }) : src
}

/**
 * 第 5 块（关联、公式、汇总的格子编辑）接进右栏属性行的地方：注册了就点格子开它，没注册的只读。
 * 编辑器自己写盘（关联两边写在主进程一次提交），写完叫 changed() 让右栏重读
 */
export interface PeekEditorProps {
  ctx: BaseCtx
  path: string
  col: ColumnInfo
  cell: Cell
  anchor: HTMLElement
  close(): void
  changed(): void
}
export type PeekEditor = (p: PeekEditorProps) => ReactNode
const editors: Partial<Record<'relation' | 'formula' | 'rollup', PeekEditor>> = {}
export function registerPeekEditor(type: 'relation' | 'formula' | 'rollup', f: PeekEditor) {
  editors[type] = f
}
export const peekEditor = (type: string): PeekEditor | undefined => (type === 'relation' || type === 'formula' || type === 'rollup' ? editors[type] : undefined)
