/**
 * 数据库 AI 列在界面这一边的状态（第三批 task-i921u「AI 生成一列」方向 B「右栏一页」）：
 * - 右栏「AI 列」标签开的是哪一张表的哪一列（null 是还没建：「AI 生成一列」的表单），在不在改要求；
 * - 每一列正在跑的那一批：每格排队 / 在写 / 写好了 / 停下了 / 没写出来，几/几；跑完、停下时底部提示能撤回；
 * - 表格（BaseTable）把自己的块、视图里的先后、算好的 ctx、改块的口子登记进来，右栏照这个画、照这个改块。
 *
 * 只管状态和跑：右栏的样子在 AiColPane.tsx，格子在 ai-cells.tsx；问 AI、写盘、提交在主进程 main/ai-column.ts。
 * 跑的时候按 esc 停（有浮层开着时 esc 先收浮层）。新加的一讲自动填：表格读好以后问主进程这一列第一次见到哪几条（正文空着的不算，写了字再填）。
 */
import { type AiRunMode, aiColOf, aiQueue, aiSourceKey, type BaseCtx, undoWrites } from '@cn/format'
import { useSyncExternalStore } from 'react'
import type { AiColDone, AiColProgress } from '../../shared/api'
import { t, tv } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { app } from '../ctx/actions'
import { composing } from '../ime'

/** 一张表登记进来的 */
export interface AiTable {
  id: string
  /** ```base 块的 YAML（最新的） */
  src: string
  folder: string | null
  /** 当前视图里看到的先后（路径）：样例取前 3 条、全跑照这个先后 */
  order: string[]
  /** 表格现在摆出来的列（新的 AI 列插在这里面） */
  columns: string[]
  /** 当前视图（视图标签条上的那个，新的 AI 列写进这个视图的列） */
  view: number
  ctx: BaseCtx | null
  /** 改这一块的 YAML（表格的 edit.src） */
  edit(next: (src: string) => string): void
  /** 这一块在哪（自动化用：「文档路径#第几个 base 块」）；白板上展开的卡不知道是哪篇时 null */
  where?: string | null
}

/** 右栏开着的 */
export interface AiOpen {
  table: string
  /** null：还没建，右栏是「AI 生成一列」的表单 */
  col: string | null
  /** 改要求（表单带着原来的要求） */
  editing: boolean
  /** 新的一列插在第几列前面 */
  index: number
}

export type CellRun = AiColProgress['state']

export interface ColRun {
  job: number | null
  mode: AiRunMode | 'one'
  /** 这一批每一格 */
  cells: Record<string, { state: CellRun; error?: string }>
  /** 这一批跑完 / 停下了：停下时右栏写「停在 几/几」 */
  stopped: boolean
  /** 上一批是样例（右栏底下「不要这一列 · 全跑剩下 N 条」） */
  sampled: boolean
}

const tables = new Map<string, AiTable>()
const runs = new Map<string, ColRun>()
/** 读的时候的样子（「原文改过」）：「数据源|列」→ 那一条 → aiSourceKey */
const sources = new Map<string, Record<string, string>>()
let open: AiOpen | null = null
const subs = new Set<() => void>()
const openSubs = new Set<() => void>()
let version = 0

/**
 * 告诉画着的几处重画：攒到这一轮事件末尾一起发（表格是在编辑器建块时 flushSync 画的，这时同步叫别的组件重画，
 * 会让 App 在一篇 NoteDoc 还没建完时就去读它）
 */
let pending = false
function emit() {
  version++
  if (pending) return
  pending = true
  queueMicrotask(() => {
    pending = false
    for (const f of [...subs]) f()
  })
}

export const colKey = (folder: string | null, col: string) => `${folder ?? ''}|${col}`

/** 表格登记、跟上（块改了、读好了）；返回拿掉的口子 */
export function aiTable(tb: AiTable): () => void {
  const had = tables.get(tb.id)
  tables.set(tb.id, tb)
  if (!had || had.src !== tb.src || had.ctx !== tb.ctx || had.order.join('\n') !== tb.order.join('\n')) {
    emit()
    if (tb.ctx && had?.ctx !== tb.ctx) void afterLoad(tb)
  }
  return () => {
    if (tables.get(tb.id) === tb) tables.delete(tb.id)
  }
}

/** 表格读好了：每一列 AI 列读「原文改过」用的样子；新加的一讲（自动填开着）填上 */
async function afterLoad(tb: AiTable) {
  const ctx = tb.ctx!
  for (const [col, d] of Object.entries(ctx.doc.props)) {
    if (d.type !== 'ai' || !tb.folder) continue
    const key = colKey(tb.folder, col)
    void window.cn.aiColSources(tb.folder, col).then((m) => {
      sources.set(key, m)
      emit()
    })
    if (d.newRows !== 'auto' || runs.get(key)?.job) continue
    // 正文空着的（刚点「+ 新建」的）先不算见过：写了字再填
    const ready = ctx.recs.filter((r) => r.text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim()).map((r) => r.path)
    const fresh = await window.cn.aiColFresh(tb.folder, col, ready)
    const todo = aiQueue(ctx, col, 'empty', fresh)
    if (todo.length) void runColumn(tb.id, col, 'empty', { paths: todo, label: tv('数据库 AI 列「{col}」：新加的 {n} 条自动填', { col, n: todo.length }) })
  }
}

export const aiTableOf = (id: string) => tables.get(id) ?? null
/** 登记着的每一张表（右栏「自动化」按数据源找开着的那一张） */
export const aiTablesNow = (): AiTable[] => [...tables.values()]
export const aiOpenNow = () => open
export const aiRunOf = (folder: string | null, col: string) => runs.get(colKey(folder, col)) ?? null
export const aiSourcesOf = (folder: string | null, col: string) => sources.get(colKey(folder, col)) ?? {}

/** 「原文改过」：AI 写的这一格，那一条的正文和 AI 读的时候不一样了 */
export function sourceChanged(folder: string | null, col: string, path: string, text: string): boolean {
  const was = sources.get(colKey(folder, col))?.[path]
  return !!was && was !== aiSourceKey(text)
}

/** 右栏开「AI 列」：col 是 null 时是新建的表单 */
export function openAiCol(o: Omit<AiOpen, 'editing' | 'index'> & Partial<Pick<AiOpen, 'editing' | 'index'>>) {
  open = { editing: false, index: Number.MAX_SAFE_INTEGER, ...o }
  emit()
  for (const f of [...openSubs]) f()
}

/** 右栏这一页换个样子（建好了这一列、改要求、收起改要求） */
export function setAiOpen(next: Partial<AiOpen>) {
  if (!open) return
  open = { ...open, ...next }
  emit()
}

export function closeAiCol() {
  if (!open) return
  open = null
  emit()
}

/** 有人要开右栏的「AI 列」（App 开那个标签、换到前面） */
export function onAiColOpen(f: () => void): () => void {
  openSubs.add(f)
  return () => openSubs.delete(f)
}

export function subscribe(f: () => void): () => void {
  subs.add(f)
  return () => subs.delete(f)
}

/** 跟着 AI 列的状态重画（哪一格在写、右栏开着哪一列、表格登记的块） */
export const useAiCol = (): number => useSyncExternalStore(subscribe, () => version)

// ---------------------------------------------------------------- 跑

/** 正在跑的那几批：job → 哪一列（进度回来时找） */
const jobCol = new Map<number, { key: string; table: string; col: string; label: string; total: number }>()

/**
 * 跑一批：sample 前 3 条、rest / empty 空着的（只跑空着和没跑完的）、all 整列（你改过的不动）、one 指定的那一条。
 * src：刚改过的块（建列的那一下还没画回表格，直接给新的）
 */
export async function runColumn(tableId: string, col: string, mode: AiRunMode | 'one', opts: { paths?: string[]; src?: string; label?: string } = {}): Promise<boolean> {
  const tb = tables.get(tableId)
  if (!tb?.ctx || !tb.folder) {
    app().notice(t('先打开放这个数据库的那篇文档'))
    return false
  }
  const key = colKey(tb.folder, col)
  if (runs.get(key)?.job) return false
  const order = tb.order.length ? tb.order : tb.ctx.recs.map((r) => r.path)
  const paths = opts.paths ?? (mode === 'one' ? [] : aiQueue(tb.ctx, col, mode, order))
  if (!paths.length) {
    app().notice(mode === 'all' ? t('这一列的格子都是你改过的，整列重跑不动它们') : t('没有空着的'))
    return false
  }
  const src = opts.src ?? tb.src
  const label =
    opts.label ??
    (mode === 'sample'
      ? tv('数据库 AI 列「{col}」：先跑前 {n} 条', { col, n: paths.length })
      : mode === 'one'
        ? tv('数据库 AI 列「{col}」：重跑「{name}」这一格', { col, name: titleOf(paths[0]!) })
        : mode === 'all'
          ? tv('数据库 AI 列「{col}」：整列重跑', { col })
          : tv('数据库 AI 列「{col}」：跑空着的 {n} 条', { col, n: paths.length }))
  const run: ColRun = { job: null, mode, cells: Object.fromEntries(paths.map((p) => [p, { state: 'queued' as const }])), stopped: false, sampled: mode === 'sample' }
  // 重跑一格时别的格子的样子留着（上一批停下的还是「停下了」）
  const prev = runs.get(key)
  if (prev && mode === 'one') {
    for (const [p, c] of Object.entries(prev.cells)) if (!run.cells[p] && c.state === 'stopped') run.cells[p] = c
    run.sampled = prev.sampled
  }
  runs.set(key, run)
  emit()
  const r = await window.cn.aiColRun({ src, col, paths, all: tb.ctx.recs.map((x) => x.path), label })
  if ('error' in r) {
    runs.delete(key)
    emit()
    app().notice(r.error)
    return false
  }
  run.job = r.job
  jobCol.set(r.job, { key, table: tableId, col, label, total: paths.length })
  // 进度可能比 aiColRun 的回话先到：先到的那几条这时补上
  const mine = early.filter((x) => x.job === r.job)
  early.splice(0, early.length, ...early.filter((x) => x.job !== r.job))
  for (const p of mine) progress(p)
  const fin = earlyDone.find((x) => x.job === r.job)
  if (fin) void done(fin)
  emit()
  return true
}

/** 停下（esc、底下「停下」）：在写的那几格停下，没跑到的写「停下了，没写」；写好的都存了 */
export function stopColumn(folder: string | null, col: string) {
  const job = runs.get(colKey(folder, col))?.job
  if (job) void window.cn.aiColStop(job)
}

/** 有一批在跑 */
const anyRunning = () => [...runs.values()].some((r) => r.job !== null)

/** 回话还没到（不知道是哪一列）时先到的进度、跑完 */
const early: AiColProgress[] = []
const earlyDone: AiColDone[] = []

function progress(p: AiColProgress) {
  const j = jobCol.get(p.job)
  if (!j) {
    early.push(p)
    return
  }
  const run = runs.get(j.key)
  if (!run || run.job !== p.job) return
  run.cells = { ...run.cells, [p.path]: { state: p.state, ...(p.error ? { error: p.error } : {}) } }
  emit()
  // 写好一格：表格重读（格子里出来）
  if (p.state === 'done') window.dispatchEvent(new CustomEvent('cn-base-wrote', { detail: j.key.slice(0, j.key.lastIndexOf('|')) }))
}

let wired = false
/** 接上主进程的进度（第一次画 AI 列时） */
export function wireAiCol() {
  if (wired) return
  wired = true
  window.cn.onAiColProgress(progress)
  window.cn.onAiColDone((d) => {
    if (jobCol.has(d.job)) void done(d)
    else earlyDone.push(d)
  })
  // esc 停下：先于别处收（编辑器、右栏都会拿 esc 去做自己的事）；开着浮层、菜单、对话框时让它们先收
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || composing(e) || !anyRunning()) return
      if (document.querySelector('[role="dialog"]:not([data-testid="toast"]), [role="menu"], [role="listbox"]')) return
      e.preventDefault()
      e.stopPropagation()
      for (const r of runs.values()) if (r.job) void window.cn.aiColStop(r.job)
    },
    true,
  )
}

async function done(d: AiColDone) {
  const j = jobCol.get(d.job)
  if (!j) return
  jobCol.delete(d.job)
  const at = earlyDone.indexOf(d)
  if (at >= 0) earlyDone.splice(at, 1)
  const run = runs.get(j.key)
  const folder = j.key.slice(0, j.key.lastIndexOf('|'))
  if (run && run.job === d.job) {
    run.job = null
    run.stopped = d.stopped
    if (!d.stopped) for (const [p, c] of Object.entries(run.cells)) if (c.state === 'queued') run.cells[p] = { state: 'stopped' }
  }
  if (folder) {
    void window.cn.aiColSources(folder, j.col).then((m) => {
      sources.set(j.key, m)
      emit()
    })
    window.dispatchEvent(new CustomEvent('cn-base-wrote', { detail: folder }))
  }
  emit()
  if (d.commitError) return app().notice(d.commitError)
  if (!d.writes.length) {
    if (d.failed) app().notice(t('{n} 格没写出来：指着格子看原因，点重跑再试', { n: d.failed }))
    else if (d.stopped) app().notice(t('停下了：这一批还没写好一格，什么都没改'))
    return
  }
  const ctx = tables.get(j.table)?.ctx
  const isNote = !!ctx && aiColOf(ctx, j.col)?.output === 'note'
  const notes = d.created ? t('新建 {n} 篇笔记，', { n: d.created }) : ''
  const said =
    run?.mode === 'one'
      ? t('重跑了「{name}」这一格 · {what}', { name: titleOf(Object.keys(run.cells).find((p) => run.cells[p]!.state === 'done') ?? ''), what: isNote ? t('只换了那篇里 AI 那一块') : t('算一次提交') })
      : d.stopped
        ? t('停在 {n}/{all}，写好的都存了 · {notes}算一次提交', { n: d.done, all: j.total, notes })
        : run?.mode === 'sample'
          ? t('前 {n} 条写好了 · {notes}算一次提交', { n: d.done, notes })
          : t('「{col}」{n} 格写好了 · {notes}算一次提交', { col: j.col, n: d.done, notes })
  app().noticeUndo(d.failed ? t('{said} · {n} 格没写出来', { said, n: d.failed }) : said, () => void undo(d.writes, j.label, folder))
}

/** 撤回一批：每个文件换回这一批之前（AI 新建的那几篇删掉），一次提交 */
async function undo(writes: AiColDone['writes'], label: string, folder: string) {
  const r = await window.cn.aiColUndo(undoWrites(writes), tv('撤回：{what}', { what: label }))
  window.dispatchEvent(new CustomEvent('cn-base-wrote', { detail: folder }))
  if (!r.ok) return app().notice(t('《{name}》刚被别处改过，没撤回', { name: titleOf(r.path) }))
  for (const run of runs.values()) if (!run.job) run.cells = {}
  emit()
  app().notice(t('撤回了：文件回到这次之前的样子'))
}
