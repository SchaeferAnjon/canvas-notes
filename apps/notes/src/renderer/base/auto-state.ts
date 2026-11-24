/**
 * 右栏「自动化」一页在界面这一边的状态（task-i921u「当……就……」方向 B）：开的是哪个数据库、看规则还是记录、在编辑哪一条
 * （新的一条、说一句填出来的、按钮列做的事），这个数据库的规则跑过几次（list）和记录（log）。
 * 表格（BaseTable）登记在 ai-col.ts 的那张表里（带 where：哪篇文档的第几个 base 块），这里按 id / 数据源找。
 * 样子在 AutoPane.tsx；问主进程在 auto-ipc.ts。
 */
import { useSyncExternalStore } from 'react'
import { type AiTable, aiTableOf, aiTablesNow, subscribe as tablesChanged } from './ai-col'
import { t } from '../../shared/i18n'
import { libPlace, runIn } from '../commands/handoff'
import { app } from '../ctx/actions'
import { type AutoListing, type AutoLogRow, type AutoRule, type AutoStep, listing, onChanged, onCommand, onDone, runLog, undoRun } from './auto-ipc'
import './auto.css'

export type AutoEdit =
  /** index 是 null：新的一条。said：说一句填出来的（filling：AI 还在填） */
  | { kind: 'rule'; index: number | null; draft: AutoRule; said: string | null; filling: boolean; problems: string[] }
  /** 按钮列做的事（isNew：加一列菜单里刚点的「按钮」，还没存；index：新的一列插在第几列前面） */
  | { kind: 'button'; col: string; draft: AutoStep[]; isNew: boolean; index: number }

export interface AutoOpen {
  /** 开它的那张表（没有时按数据源找一张开着的） */
  table: string | null
  folder: string
  /** 库里的规则（.canvas-notes/自动化.md，设置 › 自动化里建、改的）：没有表 */
  lib: boolean
  /** 设置里「在数据库里改」：按「文档路径#第几块」找那张表（文档刚打开，表还没登记） */
  at: string | null
  pane: 'list' | 'log' | 'edit'
  edit: AutoEdit | null
  /** 说一句的框里写的 */
  say: string
}

let open: AutoOpen | null = null
let version = 0
const subs = new Set<() => void>()
const openSubs = new Set<() => void>()
/** where → 列表（跑过几次、上次、问题）、记录 */
const lists = new Map<string, AutoListing>()
const logs = new Map<string, AutoLogRow[]>()

function emit() {
  version++
  queueMicrotask(() => {
    for (const f of [...subs]) f()
  })
}

export const autoOpenNow = () => open

/** 开着的这一页在哪：库里的是 'lib'，数据库的是那张表的 where（还没找到表时 null） */
export function autoWhere(): string | null {
  if (!open) return null
  return open.lib ? 'lib' : (autoTable()?.where ?? null)
}

/** 开着的这一页对着的那张表：开它的那张还在用它，不然找同一个数据源开着的 */
export function autoTable(): AiTable | null {
  if (!open || open.lib) return null
  if (open.at) return aiTablesNow().find((x) => x.where === open!.at && x.ctx) ?? null
  const tb = open.table ? aiTableOf(open.table) : null
  if (tb && tb.folder === open.folder && tb.ctx) return tb
  return aiTablesNow().find((x) => x.folder === open!.folder && x.ctx) ?? null
}

/** 右栏开「自动化」：表头那一颗、按钮列的列头、设置里「在数据库里改」 */
export function openAuto(o: { table: string | null; folder: string; lib?: boolean; at?: string; pane?: AutoOpen['pane']; edit?: AutoEdit | null }) {
  const lib = !!o.lib
  const same = open?.folder === o.folder && open.lib === lib && open.at === (o.at ?? null)
  open = { table: o.table, folder: o.folder, lib, at: o.at ?? null, pane: o.pane ?? (o.edit ? 'edit' : 'list'), edit: o.edit ?? null, say: same ? open!.say : '' }
  emit()
  for (const f of [...openSubs]) f()
}

export function setAuto(next: Partial<AutoOpen>) {
  if (!open) return
  open = { ...open, ...next }
  emit()
}

/** 编辑那一条里改了一点（草稿，不写文件；点「存」才写） */
export function setDraft(f: (e: AutoEdit) => AutoEdit) {
  if (!open?.edit) return
  open = { ...open, edit: f(open.edit) }
  emit()
}

export function closeAuto() {
  open = null
  emit()
}

export function onAutoOpen(f: () => void): () => void {
  openSubs.add(f)
  return () => openSubs.delete(f)
}

export function subscribe(f: () => void): () => void {
  subs.add(f)
  const off = tablesChanged(f)
  return () => (subs.delete(f), off())
}

export const useAuto = (): number => useSyncExternalStore(subscribe, () => version)

export const listOf = (where: string | null) => (where ? (lists.get(where) ?? null) : null)
export const logOf = (where: string | null) => (where ? (logs.get(where) ?? null) : null)

/** 读这个数据库的规则列表（跑过几次、上次、下次、问题）和记录：打开这一页、规则文件或记录变了 */
export async function reload(where: string | null) {
  if (!where) return
  const [l, g] = await Promise.all([listing(where), runLog(where)])
  lists.set(where, l)
  logs.set(where, g)
  emit()
}

let wired = false
/**
 * App 一开就接上（自动化在后台跑，右栏不开也要说）：
 * - 规则文件、记录变了（跑完一次、别处改了）：读过的那几处重读；
 * - 跑完一次（按钮的由点它的那一处说）：底部一句「「交报销单」跑了：…」带「看记录」「撤回」；
 * - 「运行一条存过的命令」：交给 AI 对话那一格照命令自己的做法跑（commands/handoff.ts）。
 */
export function wireAuto() {
  if (wired) return
  wired = true
  onChanged(() => {
    for (const w of new Set([...lists.keys(), ...logs.keys()])) void reload(w)
  })
  onDone((d) => {
    const e = d.entry
    if (e.by === 'button' || e.skipped) return
    if (!e.ok) return app().notice(t('自动化「{name}」停下了：{why}', { name: e.rule, why: e.error ?? '' }))
    const look = () => (e.where === 'lib' ? openAuto({ table: null, folder: '', lib: true, pane: 'log' }) : openAuto({ table: null, folder: '', at: e.where, pane: 'log' }))
    app().toast({
      text: t('{why} · 自动化「{name}」跑了：{did}', { why: e.why, name: e.rule, did: e.did.join('，') }),
      icon: 'symbol-event',
      act: { label: t('看记录'), icon: 'history', run: look },
      undo: e.undoable ? () => void undoRun(e.id) : undefined,
    })
  })
  // 同步来源自己拉到了新的（开软件时、到点，设计页 61）：一句带「看一眼」「撤回」
  window.cn.sources.onDone((s) =>
    app().toast({
      text: t('{name}：{did}', { name: s.name, did: s.did }),
      icon: 'cloud-download',
      act: s.first ? { label: t('看一眼'), icon: 'go-to-file', run: () => app().openFile(s.first!) } : undefined,
      undo: s.log ? () => void undoRun(s.log!) : undefined,
    }),
  )
  onCommand((c) => {
    const name = c.command.replace(/^\//, '')
    runIn(libPlace(name).key, c.command)
    app().notice(t('自动化交给 AI 对话跑「{cmd}」', { cmd: c.command }), 'symbol-event')
  })
}

/** 规则的空样子（「自己一格格选」） */
export const emptyRule = (): AutoRule => ({ name: '', on: true, when: [], if: null, missed: null, do: [] })
