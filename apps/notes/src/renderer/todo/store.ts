/**
 * 待办三处共用的一份（task-pd1d1）：库里所有笔记的「- [ ]」（主进程 todo:list）。文件一变就重读：外面改了（画布今日、Git）、
 * 软件自己改了、编辑器存了字都走 App 的 refreshNotes → refreshTodos。改一行、加一条交给主进程（只换那几个字），回来重读，
 * 底栏提示带「撤回」。刚勾掉的几条记在 keep 里：三处都划线留在原处（原型 S.just），这一次开软件里一直这样。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { dayName, isOpen, listed, type TodoItem, type TodoOp, type TodoWhere, whenText } from '../../shared/todo'
import { app } from '../ctx/actions'
import { NoteDoc } from '../note-doc'
import { t as tNow } from '../../shared/i18n'

interface State {
  items: TodoItem[]
  loaded: boolean
  /** 刚勾掉、划线留在原处的（路径#行号） */
  keep: ReadonlySet<string>
  /** 刚加的、刚改了日子的那一条亮一下（路径#行号） */
  flash: string | null
}

let state: State = { items: [], loaded: false, keep: new Set(), flash: null }
const subs = new Set<() => void>()
let seq = 0
let watching = 0

function set(p: Partial<State>) {
  state = { ...state, ...p }
  for (const f of subs) f()
}

/** 现在的一份（拖动这种在 React 外面的地方用） */
export const itemsNow = (): readonly TodoItem[] => state.items

/** 重读（App 的 refreshNotes 里也调：编辑器存了字、外面改了文件） */
export function refreshTodos() {
  const mine = ++seq
  void window.cnTodo.list().then(
    (items) => mine === seq && set({ items, loaded: true }),
    (e: Error) => console.error('读待办没成功', e),
  )
}

export function useTodos(): State {
  const s = useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => state,
  )
  useEffect(() => {
    if (watching++ === 0 && !state.loaded) refreshTodos()
    return () => void watching--
  }, [])
  return s
}

/** 本地的今天 */
export function isoToday(ms = Date.now()): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 今天（过了半夜跟着换：分组、日子小块都按它算） */
export function useToday(): string {
  const [d, setD] = useState(isoToday)
  useEffect(() => {
    const t = setInterval(() => setD((x) => (x === isoToday() ? x : isoToday())), 30_000)
    return () => clearInterval(t)
  }, [])
  return d
}

/** 今天（含过期）没做的几条：图标栏「待办」格的数字、格子头上「今天 N」 */
export function todayCount(items: readonly TodoItem[], today: string): number {
  return items.filter((t) => isOpen(t) && listed(t) && t.date !== null && t.date <= today).length
}

/** 只要数字的地方（App 的图标栏）：数字变了才重画 */
export function useTodayCount(): number {
  const today = useToday()
  const n = useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => todayCount(state.items, today),
  )
  useEffect(() => {
    if (!state.loaded) refreshTodos()
  }, [])
  return n
}

let flashTimer: ReturnType<typeof setTimeout> | undefined
function flashKey(key: string) {
  clearTimeout(flashTimer)
  set({ flash: key })
  flashTimer = setTimeout(() => set({ flash: null }), 1500)
}

const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** 底栏说一句；真改了文件的带「撤回」 */
function say(text: string, undoId: string, title: string) {
  if (undoId) app().noticeUndo(text, () => void undo(undoId, title))
  else app().notice(text)
}

/** 撤回一次改动（提示条上的「撤回」、⌘Z） */
async function undo(id: string, title: string) {
  const r = await window.cnTodo.undo(id).catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: errText(e) }))
  if (!r.ok) app().notice(r.reason === 'changed' ? tNow('「{title}」那一行后来又被改过，撤不回了', { title }) : r.reason === 'gone' ? tNow('撤不回了') : tNow('没撤回：{err}', { err: r.message ?? '' }))
  app().refresh()
}

/** 改一行：先把开着的编辑器存好（盘上是最新的），这一篇接下来的改动是软件自己的（不说「外部改动合并进来了」） */
async function edit(t: TodoItem, op: TodoOp) {
  await NoteDoc.saveAll()
  NoteDoc.expectOwnChange([t.path])
  const r = await window.cnTodo.edit({ path: t.path, line: t.line, raw: t.raw, edit: op }).catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: errText(e) }))
  if (!r.ok) {
    app().notice(r.reason === 'gone' ? tNow('「{title}」那一行刚被别处改了，没改', { title: t.title }) : r.reason === 'readonly' ? (r.message ?? tNow('这一篇只能只读打开')) : tNow('没改成：{err}', { err: r.message ?? '' }))
    app().refresh()
    return null
  }
  app().refresh()
  return r
}

/** 勾掉 / 取消勾选：勾掉的划线留在原处 */
export async function tickTodo(t: TodoItem) {
  const done = !t.done
  const r = await edit(t, { op: 'done', done })
  if (!r) return
  const key = `${r.path}#${r.line}`
  const keep = new Set(state.keep)
  if (done) keep.add(key)
  else keep.delete(key)
  set({ keep })
  const said = done
    ? r.next
      ? tNow('勾掉了「{title}」 · 下一次{when}', { title: t.title, when: dayName(r.next.date, isoToday()) })
      : tNow('勾掉了「{title}」', { title: t.title })
    : tNow('取消勾选「{title}」', { ctx: '提示', title: t.title })
  say(said, r.undo, t.title)
}

/** 改日子（详情里点「明天」、拖到「明天」那组上）：钟点留着；null 是拿掉日子 */
export async function dateTodo(t: TodoItem, date: string | null) {
  const r = await edit(t, { op: 'date', date })
  if (!r) return
  flashKey(`${r.path}#${r.line}`)
  say(tNow('「{title}」改到{when}', { title: t.title, when: whenText(date, date ? t.time : null, isoToday()) }), r.undo, t.title)
}

type Field = 'time' | 'remind' | 'repeat'

/** 详情里改钟点、提醒、重复（'' 是不要） */
export async function fieldTodo(t: TodoItem, k: Field, v: string) {
  const value = v || null
  const r = await edit(t, k === 'time' ? { op: 'time', time: value } : k === 'remind' ? { op: 'remind', remind: value } : { op: 'repeat', repeat: value })
  if (!r) return
  const title = t.title
  say(k === 'time' ? tNow('「{title}」改了钟点', { title }) : k === 'remind' ? tNow('「{title}」改了提醒', { title }) : tNow('「{title}」改了重复', { title }), r.undo, title)
}

/** 加一条（认「明天下午三点」）；加上了返回 true，输入框清空 */
export async function addTodo(text: string, where: TodoWhere): Promise<boolean> {
  if (!text.trim()) return false
  await NoteDoc.saveAll()
  const r = await window.cnTodo.add(text, where).catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: errText(e) }))
  if (!r.ok) {
    app().notice(r.reason === 'empty' ? tNow('只认出了日子，没有要做什么') : r.reason === 'readonly' ? (r.message ?? tNow('这一篇只能只读打开')) : tNow('没加上：{err}', { err: r.message ?? '' }))
    return false
  }
  flashKey(`${r.path}#${r.line}`)
  say(r.date ? tNow('加上了「{title}」 · {when}', { title: r.title, when: whenText(r.date, r.time, isoToday()) }) : tNow('加上了「{title}」', { title: r.title }), r.undo, r.title)
  app().refresh()
  return true
}

/** 在画布今日里打开这一条（没有 🆔 的先给它一个） */
export async function openInToday(t: TodoItem) {
  await NoteDoc.saveAll()
  NoteDoc.expectOwnChange([t.path])
  const r = await window.cnTodo.openInToday({ path: t.path, line: t.line, raw: t.raw }).catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: errText(e) }))
  if (!r.ok) app().notice(r.reason === 'gone' ? tNow('「{title}」那一行刚被别处改了', { title: t.title }) : tNow('没打开：{err}', { err: r.message ?? '' }))
  app().refresh()
}

let installed: Promise<boolean> | null = null
/** 装了画布今日没有（问一次） */
export function useTodayInstalled(): boolean {
  const [v, setV] = useState(false)
  useEffect(() => {
    installed ??= window.cnTodo.todayInstalled().catch(() => false)
    let live = true
    void installed.then((x) => live && setV(x))
    return () => void (live = false)
  }, [])
  return v
}

/** 这一行亮一下（「打开笔记，到这一行」落在任务界面时） */
export const flashTodo = flashKey
