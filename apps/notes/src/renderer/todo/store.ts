/**
 * 待办三处共用的一份（task-pd1d1）：库里所有笔记的「- [ ]」（主进程 todo:list）。文件一变就重读：外面改了（画布今日、Git）、
 * 软件自己改了、编辑器存了字都走 App 的 refreshNotes → refreshTodos。改一行、加一条交给主进程（只换那几个字），回来重读，
 * 底栏提示带「撤回」。刚勾掉的几条记在 just 里 2 秒：几处都在原处留一行「已完成 · 撤回」，过了就从过期 / 今天 / 文件夹里拿掉、进「已完成」
 * （2026-11-24 用户「我点了对勾之后，这个任务是不是应该就要消失，到“已完成”里面」；以前整次开软件都划线留着，过期越堆越长）。
 */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { copiesOf, type When, type WhenFields } from '@cn/tasks'
import { dayName, isOpen, listed, type TodoItem, type TodoOp, type TodoWhere, whenText } from '../../shared/todo'
import { app } from '../ctx/actions'
import { NoteDoc } from '../note-doc'
import { t as tNow } from '../../shared/i18n'

interface State {
  items: TodoItem[]
  loaded: boolean
  /** 刚勾掉、2 秒里还在原处留一行「已完成 · 撤回」的（路径#行号） */
  just: ReadonlySet<string>
  /** 刚加的、刚改了日子的那一条亮一下（路径#行号） */
  flash: string | null
}

let state: State = { items: [], loaded: false, just: new Set(), flash: null }
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

/** 本地的现在「2026-11-22T16:05」（认时间：只写了钟点、今天已经过了的算明天，task-pd289） */
export function nowLocal(ms = Date.now()): string {
  const d = new Date(ms)
  return `${isoToday(ms)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
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
  // 抄了好几遍的同一条：主进程会把另外几份一起改，那几篇也算软件自己改的
  NoteDoc.expectOwnChange([t.path, ...copiesOf(state.items, t).map((c) => c.path)])
  const r = await window.cnTodo.edit({ path: t.path, line: t.line, raw: t.raw, edit: op }).catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: errText(e) }))
  if (!r.ok) {
    app().notice(r.reason === 'gone' ? tNow('「{title}」那一行刚被别处改了，没改', { title: t.title }) : r.reason === 'readonly' ? (r.message ?? tNow('这一篇只能只读打开')) : tNow('没改成：{err}', { err: r.message ?? '' }))
    app().refresh()
    return null
  }
  app().refresh()
  return r
}

/** 刚勾掉的留在原处多久 */
export const JUST_MS = 2000
/** just 里每一条的撤回编号、底栏那句话（行里点「撤回」时底栏那句一起收） */
const justUndo = new Map<string, { undo: string; said: string; title: string; timer: ReturnType<typeof setTimeout> }>()
function dropJust(key: string) {
  const j = justUndo.get(key)
  if (j) clearTimeout(j.timer)
  justUndo.delete(key)
  if (!state.just.has(key)) return
  const just = new Set(state.just)
  just.delete(key)
  set({ just })
}

/** 勾掉 / 取消勾选：勾掉的在原处留 2 秒「已完成 · 撤回」，然后进「已完成」 */
export async function tickTodo(t: TodoItem) {
  // 取消了的 [-] 点一下改回没做完
  const done = !t.done && !t.cancelled
  const r = await edit(t, { op: 'done', done })
  if (!r) return
  const key = `${r.path}#${r.line}`
  const said = done
    ? r.next
      ? tNow('勾掉了「{title}」 · 下一次{when}', { title: t.title, when: dayName(r.next.date, isoToday()) })
      : r.copies
        ? tNow('勾掉了「{title}」，{n}处一起勾上了', { title: t.title, n: r.copies + 1 })
        : tNow('勾掉了「{title}」', { title: t.title })
    : tNow('取消勾选「{title}」', { ctx: '提示', title: t.title })
  dropJust(key)
  if (done && r.undo) {
    justUndo.set(key, { undo: r.undo, said, title: t.title, timer: setTimeout(() => dropJust(key), JUST_MS) })
    set({ just: new Set(state.just).add(key) })
  }
  say(said, r.undo, t.title)
}

/** 刚勾掉那一行上的「撤回」：撤回这一次勾掉，底栏同一句收掉 */
export function undoJust(key: string) {
  const j = justUndo.get(key)
  if (!j) return
  dropJust(key)
  app().noticeDrop(j.said)
  void undo(j.undo, j.title)
}

/** 改日子（详情里点「明天」、拖到「明天」那组上）：钟点留着；null 是拿掉日子 */
export async function dateTodo(t: TodoItem, date: string | null) {
  const r = await edit(t, { op: 'date', date })
  if (!r) return
  flashKey(`${r.path}#${r.line}`)
  say(tNow('「{title}」改到{when}', { title: t.title, when: whenText(date, date ? t.time : null, isoToday()) }), r.undo, t.title)
}

/** 日历格里拖到某天（某个钟点）：日子和钟点一起改，一次撤回；time undefined 是钟点不动、null 是拿掉钟点 */
export async function whenTodo(t: TodoItem, date: string, time?: string | null) {
  const r = await edit(t, { op: 'when', date, ...(time !== undefined ? { time } : {}) })
  if (!r) return
  flashKey(`${r.path}#${r.line}`)
  const tm = time === undefined ? t.time : time
  say(tNow('「{title}」改到{when}', { title: t.title, when: whenText(date, tm, isoToday()) }), r.undo, t.title)
}

/** AI 排进空着的时间「收下」：几条一起写上钟点 */
export async function timesTodo(items: { t: TodoItem; time: string }[]): Promise<boolean> {
  await NoteDoc.saveAll()
  NoteDoc.expectOwnChange([...new Set(items.map((x) => x.t.path))])
  const r = await window.cnTodo.times(items.map((x) => ({ path: x.t.path, line: x.t.line, raw: x.t.raw, time: x.time }))).catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: errText(e) }))
  app().refresh()
  if (!r.ok) {
    app().notice(r.reason === 'gone' ? tNow('那几行刚被别处改了，没写上') : tNow('没改成：{err}', { err: r.message ?? '' }))
    return false
  }
  say(tNow('排好了{n}条 · 这几行的 📅 日子后面加上了钟点', { n: items.length }), r.undo, items[0]!.t.title)
  return true
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

/**
 * 定日子和时间的选择器里改了一项（task-pd289）：四样一起照 w 写进那一行（只换那几个字），不说话，交回改完以后这一行在哪、原文和撤销编号
 * （选择器关上时 sayWhen 一起说一句、一起撤回）
 */
export async function scheduleTodo(t: Pick<TodoItem, 'path' | 'line' | 'raw' | 'title'>, w: WhenFields): Promise<{ line: number; raw: string; undo: string } | null> {
  const r = await edit(t as TodoItem, { op: 'schedule', when: w })
  if (!r) return null
  flashKey(`${r.path}#${r.line}`)
  return { line: r.line, raw: r.raw, undo: r.undo }
}

/** 选择器关上：底栏说一句改成了什么，带「撤回」（这一回改的几次倒着一起撤） */
export function sayWhen(title: string, w: WhenFields, undos: string[]) {
  const ids = undos.filter(Boolean)
  if (!ids.length) return
  const said = w.date ? tNow('「{title}」改到{when}', { title, when: whenText(w.date, w.time, isoToday()) + (w.remind ? ' · 🔔 ' + w.remind : '') + (w.repeat ? ' · 🔁 ' + w.repeat : '') }) : tNow('「{title}」拿掉了日子', { title })
  app().noticeUndo(said, () => {
    void (async () => {
      for (const id of [...ids].reverse()) {
        const r = await window.cnTodo.undo(id).catch(() => ({ ok: false as const, reason: 'failed' as const }))
        if (!r.ok) {
          app().notice(tNow('「{title}」那一行后来又被改过，撤不回了', { title }))
          break
        }
      }
      app().refresh()
    })()
  })
}

/** 加一条（认「明天下午三点」）；加上了返回 true，输入框清空。day：没写哪天时加到这天（待办首页只看某一天时）；when：AI 认出来的（task-pd289） */
export async function addTodo(text: string, where: TodoWhere, day?: string | null, when?: When | null): Promise<boolean> {
  if (!text.trim()) return false
  await NoteDoc.saveAll()
  const r = await window.cnTodo.add(text, where, day, when).catch((e: unknown) => ({ ok: false as const, reason: 'failed' as const, message: errText(e) }))
  if (!r.ok) {
    app().notice(r.reason === 'empty' ? tNow('只认出了日子，没有要做什么') : r.reason === 'readonly' ? (r.message ?? tNow('这一篇只能只读打开')) : tNow('没加上：{err}', { err: r.message ?? '' }))
    return false
  }
  flashKey(`${r.path}#${r.line}`)
  say(r.date ? tNow('加上了「{title}」 · {when}', { title: r.title, when: whenText(r.date, r.time, isoToday()) }) : tNow('加上了「{title}」', { title: r.title }), r.undo, r.title)
  app().refresh()
  return true
}

/** 右键「删除」：整行拿掉（连子任务），底栏带「撤回」 */
export async function deleteTodo(t: TodoItem) {
  const r = await edit(t, { op: 'delete' })
  if (!r) return
  say(tNow('删掉了「{title}」', { title: t.title }), r.undo, t.title)
}

/** 打开画布今日（左栏头上那一颗） */
export function openTodayApp() {
  void window.cnTodo.openToday().catch((e: unknown) => app().notice(tNow('没打开画布今日：{err}', { err: errText(e) })))
}

/** 没装画布今日：开官网上介绍和下载它的那一节 */
export function aboutToday() {
  void window.cnTodo.aboutToday().catch((e: unknown) => app().notice(tNow('没打开：{err}', { err: errText(e) })))
}

/**
 * 文档里一行待办点「看详情」（task-kzr3n）：先把开着的编辑器存好、重读一次，再按 路径 + 行号 + 原文 认是哪一条
 * （行号对不上时找同一篇里原文一样、离得最近的）；认不出是 null
 */
export async function findTodoAt(path: string, line: number, raw: string): Promise<TodoItem | null> {
  await NoteDoc.saveAll()
  const items = await window.cnTodo.list()
  set({ items, loaded: true })
  const same = items.filter((t) => t.path === path && t.raw === raw)
  return same.find((t) => t.line === line) ?? same.sort((a, b) => Math.abs(a.line - line) - Math.abs(b.line - line))[0] ?? null
}

/** 在画布今日里打开这一条（没有 🆔 的先给它一个） */
export async function openInToday(t: Pick<TodoItem, 'path' | 'line' | 'raw' | 'title'>) {
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
