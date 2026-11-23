/**
 * 待办三处改库里那一行（task-pd1d1）：主进程这边的纯计算，不碰文件和 Electron（main/todo.ts 读写文件、排队、撤销）。
 * 改一行只换那几个字（画布今日的 @cn/tasks：editLine、setDone、setDate…，别的字节一个不动）；
 * 先认行：还是界面看到的那一行原文就改它，外面在上面加了几行就按原文找最近的一样的行，再按 🆔 找，都找不到不改。
 * 文字是 Vault 读出来的（换行统一成 \n、去掉了 BOM，写回时照原样恢复）。
 */
import { merge3 } from '@cn/format'
import { addDays, appendTask, completeTask, editLine, type ISODate, lineAt, parseTaskLine, removeBlock, scanTasks, setDate, setDone, setId, setRemind, setRepeat, setTime, setWhen, splitLines } from '@cn/tasks'
import type { TodoItem, TodoOp } from '../shared/todo'

/** 文字里认那一行：先看原来的行号，再找原文一样、离得最近的，再按 🆔（和画布今日 main/edits.ts 的 locate 一样） */
export function locateTodo(text: string, line: number, raw: string): number | null {
  if (lineAt(text, line) === raw) return line
  const lines = splitLines(text)
  let best: number | null = null
  for (let i = 0; i < lines.length; i++) {
    if (lineAt(text, i) !== raw) continue
    if (best === null || Math.abs(i - line) < Math.abs(best - line)) best = i
  }
  if (best !== null) return best
  const id = parseTaskLine(raw)?.id
  if (id) for (let i = 0; i < lines.length; i++) if (parseTaskLine(lineAt(text, i) ?? '')?.id === id) return i
  return null
}

/**
 * 改一行：返回改完的整篇、这一条现在在第几行和它的原文；勾掉重复的那条时 next 是下面新加的下一次。
 * 认不出那一行、改了等于没改是 null
 */
export function editTodoText(text: string, line: number, raw: string, e: TodoOp, today: ISODate, newId: () => string): { text: string; line: number; raw: string; next?: { line: number; date: string } } | null {
  const n = locateTodo(text, line, raw)
  if (n === null) return null
  let after: string
  let next: { line: number; date: string } | undefined
  switch (e.op) {
    case 'done':
      if (e.done) {
        const c = completeTask(text, n, today, newId)
        after = c.text
        next = c.next
      } else after = editLine(text, n, (l) => setDone(l, false, today))
      break
    case 'date':
      after = editLine(text, n, (l) => setDate(l, e.date))
      break
    case 'time':
      after = editLine(text, n, (l) => setTime(l, e.time, today))
      break
    case 'remind':
      // 有提醒的那条给一个 🆔（提醒记录、提醒事项镜像、canvas-today:// 链接都靠它认，和画布今日一样）
      after = editLine(text, n, (l) => {
        const x = setRemind(l, e.remind)
        return e.remind && !parseTaskLine(x)!.id ? setId(x, newId()) : x
      })
      break
    case 'repeat':
      after = editLine(text, n, (l) => setRepeat(l, e.repeat))
      break
    case 'when':
      after = editLine(text, n, (l) => {
        const x = setDate(l, e.date)
        return e.time === undefined ? x : setTime(x, e.time, today)
      })
      break
    case 'schedule':
      // 选择器（task-pd289）：四样一起写，有提醒没 🆔 的给一个
      after = editLine(text, n, (l) => setWhen(l, e.when, newId))
      break
    case 'delete':
      // 右键「删除」（task-kzr3n）：这一行连它下面缩进的子任务一起拿掉
      after = removeBlock(text, n).text
      break
  }
  if (after === text) return null
  return { text: after, line: n, raw: e.op === 'delete' ? '' : (lineAt(after, n) ?? ''), ...(next ? { next } : {}) }
}

/** 给这一条一个 🆔（在画布今日里打开要它）；已经有了原样返回 */
export function idTodoText(text: string, line: number, raw: string, newId: () => string): { text: string; line: number; raw: string; id: string } | null {
  const n = locateTodo(text, line, raw)
  if (n === null) return null
  const t = parseTaskLine(lineAt(text, n) ?? '')
  if (!t) return null
  if (t.id) return { text, line: n, raw: lineAt(text, n)!, id: t.id }
  const id = newId()
  const after = editLine(text, n, (l) => setId(l, id))
  return { text: after, line: n, raw: lineAt(after, n) ?? '', id }
}

/** 加一条：接在这篇最后一条待办（连子任务）后面；这一篇还没有（cur 是 null）就建「# 标题」打头的一篇 */
export function addTodoText(cur: string | null, title: string, taskLine: string): { text: string; line: number } {
  return appendTask(cur ?? `# ${title}\n\n`, taskLine)
}

/** 撤回：盘上还是改完的样子就换回去；后来又改过的照三方合并只退这一处，合不了是 null */
export function revertText(before: string, after: string, cur: string): string | null {
  if (cur === after) return before
  const m = merge3(after, cur, before)
  return m.conflict ? null : m.text
}

/** 文件夹首页卡里存在 .首页.json 的旧待办（一行一条，「[x] 」开头的是做完的）→ 待办行，字原样 */
export function legacyTodoLines(todos: readonly string[]): string[] {
  return todos.flatMap((t) => {
    const done = /^\[x\]/i.test(t)
    const text = t.replace(/^\[x\]\s*/i, '').replace(/[\r\n]+/g, ' ').trim()
    return text ? [`- [${done ? 'x' : ' '}] ${text}`] : []
  })
}

/** 一篇里的待办 → 界面要的样子（key 是 路径#行号） */
export function todoItems(path: string, text: string): TodoItem[] {
  const key = (line: number) => `${path}#${line}`
  return scanTasks(text).map((t) => ({
    key: key(t.line),
    id: t.task.id,
    path,
    line: t.line,
    raw: t.raw,
    title: t.task.title,
    done: t.task.done,
    cancelled: t.task.cancelled,
    date: t.task.date,
    time: t.task.time,
    remind: t.task.remind,
    repeat: t.task.repeat,
    prio: t.task.prio,
    parent: t.parent === null ? null : key(t.parent),
  }))
}

/** 这篇里可能有待办吗（「- [ ]」「1. [x]」这种开头的行）：没有就不必一行行认 */
export const mayHaveTodos = (text: string) => /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[^\[\]]\]/m.test(text)

/** 本地的现在「2026-11-22T16:05」（快速加一条只写了钟点、今天已经过了的算明天，task-pd289） */
export function localNow(ms = Date.now()): string {
  const d = new Date(ms)
  return `${localToday(ms)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** 本地的今天（写 ✅ 用；和界面上分组用的是同一个钟） */
export function localToday(ms = Date.now()): ISODate {
  const d = new Date(ms)
  return addDays(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, 0)
}
