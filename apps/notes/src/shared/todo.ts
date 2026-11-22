/**
 * 待办三处同一份、同一套样子（task-pd1d1，原型 05-任务软件/todo-demo.html，用户 2026-11-22「可以就这么做吧」）：
 * 左边图标栏「待办」格、文件夹首页的待办卡、名字叫「待办」的笔记打开时的任务界面。
 * 任务就是库里笔记中的一行「- [ ]」，读和改那一行用画布今日的 @cn/tasks（只换那几个字）；这里是三处共用的纯计算：
 * 哪篇算「待办」、按 过期 / 今天 / 明天 / 以后 / 没定日子 分组、行尾日子小块怎么写、按文件夹分组、加一条时那行「认出来：…」。
 */
import { addDays, diffDays, parseQuick, type Prio, weekday } from '@cn/tasks'
import { categoryRank, isCategory } from './categories'
import { t as tNow, uiLang } from './i18n'

/** 快速加的、没写在哪篇里的进这一篇（和画布今日的 INBOX_NOTE 同一篇） */
export const INBOX_TODO = '收件箱/待办.md' // 不翻：磁盘上的文件

/** 名字正好叫「待办」的笔记：默认用任务界面打开，文件树、首页文件列表、「最近」里不列（设置能打开） */
export const isTodoNote = (path: string) => path.split('/').pop() === '待办.md' // 不翻：磁盘上的文件名

/** 一个文件夹的那篇「待办」（首页卡加一条写进它，没有就建） */
// 不翻：磁盘上的文件名
export const todoNoteOf = (folder: string) => (folder ? `${folder}/待办.md` : '待办.md')

/** 「写作/待办」：每个文件夹都有一篇「待办」，标签上、「打开 写作/待办 ›」里带上文件夹才分得开 */
export const todoLabel = (path: string) => path.replace(/\.md$/i, '')

/** 笔记的名字（文件名去掉 .md）：首页卡标题后面的灰色出处「· 小论文计划」 */
export const noteName = (path: string) => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** 库里的一条待办（某篇笔记的某一行），主进程扫出来交给界面 */
export interface TodoItem {
  /** 笔记路径#行号（行号从 0 数）；行号变了名字就变 */
  key: string
  /** 🆔：有编号的才有 */
  id: string | null
  path: string
  line: number
  /** 这一行原文（不带换行） */
  raw: string
  title: string
  done: boolean
  /** [-] 取消了的：不算没做完，也不算做完 */
  cancelled: boolean
  date: string | null
  time: string | null
  remind: string | null
  repeat: string | null
  prio: Prio
  /** 上一层待办的 key（子任务才有） */
  parent: string | null
}

/** 改一行（只换那几个字，@cn/tasks）：勾掉 / 取消、日子、钟点、提醒、重复 */
export type TodoOp =
  | { op: 'done'; done: boolean }
  | { op: 'date'; date: string | null }
  | { op: 'time'; time: string | null }
  | { op: 'remind'; remind: string | null }
  | { op: 'repeat'; repeat: string | null }

export interface TodoEditReq {
  path: string
  line: number
  /** 界面看到的那一行原文：文件里这一行不是它了（外面改过），按原文、🆔 去找，找不到就不改 */
  raw: string
  edit: TodoOp
}

export type TodoEditResult =
  | { ok: true; undo: string; path: string; line: number; raw: string; next?: { line: number; date: string } }
  | { ok: false; reason: 'gone' | 'readonly' | 'failed'; message?: string }

/** 加一条写进哪：收件箱/待办.md（左边格子）、这一篇（任务界面）、<文件夹>/待办.md（首页卡，没有就建） */
export type TodoWhere = { inbox: true } | { note: string } | { folder: string }

export type TodoAddResult =
  | { ok: true; undo: string; path: string; line: number; raw: string; title: string; date: string | null; time: string | null; created: boolean }
  | { ok: false; reason: 'empty' | 'readonly' | 'failed'; message?: string }

export type TodoUndoResult = { ok: true } | { ok: false; reason: 'changed' | 'gone' | 'failed'; message?: string }

/** 首页卡里存在 .首页.json 的旧待办搬进 <文件夹>/待办.md（一次提交，能撤回） */
export type TodoMigrateResult = { moved: number; path: string; undo: string; commitError?: string } | null

/** preload 暴露成 window.cnTodo（实现在 main/todo.ts） */
export interface CnTodoApi {
  /** 库里所有笔记的待办 */
  list(): Promise<TodoItem[]>
  edit(req: TodoEditReq): Promise<TodoEditResult>
  add(text: string, where: TodoWhere): Promise<TodoAddResult>
  undo(id: string): Promise<TodoUndoResult>
  /** 首页卡里的旧待办搬进 <文件夹>/待办.md；没有要搬的是 null。force：撤回过的（todosKept）也搬（卡里那句「搬进…」） */
  migrate(folder: string, force?: boolean): Promise<TodoMigrateResult>
  /** 撤回搬家：两个文件回到搬之前，卡里留一句「还有 N 条旧待办 · 搬进…」 */
  unmigrate(id: string): Promise<TodoUndoResult>
  /** 装了画布今日没有（详情里「在画布今日里打开」只在装了时出） */
  todayInstalled(): Promise<boolean>
  /** 在画布今日里打开这一条（没有 🆔 的先给它一个，只加那几个字） */
  openInToday(req: Omit<TodoEditReq, 'edit'>): Promise<TodoEditResult>
}

export type Bucket = 'over' | 'today' | 'tom' | 'later' | 'none'

/** 分组的先后（原型 BK） */
export const BUCKETS: readonly Bucket[] = ['over', 'today', 'tom', 'later', 'none']

/** 分组的名字（跟界面语言） */
export const bucketName = (b: Bucket): string =>
  b === 'over' ? tNow('过期') : b === 'today' ? tNow('今天') : b === 'tom' ? tNow('明天') : b === 'later' ? tNow('以后') : tNow('没定日子')

export const isOpen = (t: Pick<TodoItem, 'done' | 'cancelled'>) => !t.done && !t.cancelled
/** 列出来的：最上层的，加上自己写了日子的子任务（和画布今日一样） */
export const listed = (t: Pick<TodoItem, 'parent' | 'date'>) => t.parent === null || t.date !== null

export function bucketOf(t: Pick<TodoItem, 'date'>, today: string): Bucket {
  if (!t.date) return 'none'
  if (t.date < today) return 'over'
  if (t.date === today) return 'today'
  return t.date === addDays(today, 1) ? 'tom' : 'later'
}

/** 拖到这一组上改成哪天（原型 bkDate）：过期那组不收（null），以后是后天，没定日子是拿掉日子（''） */
export function bucketDrop(b: Bucket, today: string): string | null {
  if (b === 'over') return null
  if (b === 'none') return ''
  return addDays(today, b === 'today' ? 0 : b === 'tom' ? 1 : 2)
}

/** 组里的先后：日子、钟点（没钟点的在后），再照文件里的先后 */
export const byWhen = (a: TodoItem, b: TodoItem) =>
  (a.date ?? '9999-99-99').localeCompare(b.date ?? '9999-99-99') || (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.path.localeCompare(b.path) || a.line - b.line

export interface TodoGroup {
  bucket: Bucket
  name: string
  items: TodoItem[]
  red: boolean
  /** 拖到组名上改成哪天（null 不收，'' 拿掉日子） */
  drop: string | null
}

/**
 * 分组（原型 groups()）：只列没做完的；空的组不出，dropEmpty 时今天、明天、以后空着也出（当落点）。
 * keep：刚勾掉的（这一次开软件里在这几处勾的），划线留在原处，不进「已完成」
 */
export function todoGroups(list: readonly TodoItem[], today: string, opts: { dropEmpty?: boolean; keep?: ReadonlySet<string> } = {}): { groups: TodoGroup[]; done: TodoItem[] } {
  const keep = opts.keep ?? new Set<string>()
  const shown = list.filter(listed)
  const groups: TodoGroup[] = []
  for (const b of BUCKETS) {
    const items = shown.filter((t) => (isOpen(t) || (t.done && keep.has(t.key))) && bucketOf(t, today) === b).sort(byWhen)
    if (!items.length && !(opts.dropEmpty && b !== 'over' && b !== 'none')) continue
    groups.push({ bucket: b, name: bucketName(b), items, red: b === 'over', drop: bucketDrop(b, today) })
  }
  const done = shown.filter((t) => t.done && !keep.has(t.key)).sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
  return { groups, done }
}

const WK = '日一二三四五六' // 不翻：中文的星期写法
const EN_DAY = { wk: new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }), md: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) }
/** 「2026-11-25」当 UTC 的那一天（只拿来出英文的周几、月日） */
const utc = (d: string) => new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))))

/** 日子的叫法（原型 day()）：今天、明天、昨天，一周以内说周几，再远「11月25日」；英文「Today」「Tomorrow」「Thu」「Nov 25」 */
export function dayName(d: string, today: string): string {
  const n = diffDays(d, today)
  if (n === 0) return tNow('今天')
  if (n === 1) return tNow('明天')
  if (n === -1) return tNow('昨天')
  const en = uiLang() === 'en'
  if (Math.abs(n) < 7) return en ? EN_DAY.wk.format(utc(d)) : '周' + WK[weekday(d)] // 不翻：中文的星期写法
  return en ? EN_DAY.md.format(utc(d)) : `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` // 不翻：中文的日子写法
}

/** 行尾日子小块的字（原型 chip()）：今天有钟点只写钟点；别的日子写哪天，七天以内（含过去）再带钟点 */
export function chipText(t: Pick<TodoItem, 'date' | 'time'>, today: string): string {
  if (!t.date) return ''
  if (t.date === today) return t.time ?? tNow('今天')
  return dayName(t.date, today) + (t.time && diffDays(t.date, today) < 7 ? ' ' + t.time : '')
}

/** 「改到明天 15:00」这种（改日子的提示） */
export const whenText = (date: string | null, time: string | null, today: string) => (date ? dayName(date, today) + (time ? ' ' + time : '') : tNow('不定日期'))

export interface FolderGroup {
  folder: string
  /** 「课程 › ecp」 */
  name: string
  /** 这个文件夹的那篇「待办」（有的话）：点文件夹名、「打开 写作/待办 ›」开它 */
  todo: string | null
  items: TodoItem[]
  /** 没做完的几条（组名右边的数） */
  open: number
}

/**
 * 「待办」格选「按文件夹」：每篇笔记所在的文件夹一组（原型 FOLDERS）。收件箱在最前，有「待办」那篇的文件夹在前，
 * 再照顶级分类的先后、名字；只剩做完的文件夹不出（刚勾掉留在原处的那几条除外）。notes：库里有哪些笔记（认哪个文件夹有「待办」）
 */
export function byFolder(items: readonly TodoItem[], notes: ReadonlySet<string>, keep?: ReadonlySet<string>): FolderGroup[] {
  const map = new Map<string, TodoItem[]>()
  for (const t of items) {
    const f = folderOf(t.path)
    const list = map.get(f)
    if (list) list.push(t)
    else map.set(f, [t])
  }
  const collator = new Intl.Collator('zh-Hans-CN', { numeric: true })
  const top = (f: string) => {
    const first = f.split('/')[0]!
    return isCategory(first) ? categoryRank(first) : 99
  }
  return [...map]
    .map(([folder, list]) => ({
      folder,
      name: folder ? folder.split('/').join(' › ') : tNow('最外层'),
      todo: notes.has(todoNoteOf(folder)) ? todoNoteOf(folder) : null,
      items: list,
      open: list.filter((t) => isOpen(t) && listed(t)).length,
    }))
    .filter((g) => g.open > 0 || g.items.some((t) => keep?.has(t.key)))
    // 不翻：磁盘上的文件夹名
    .sort((a, b) => Number(b.folder === '收件箱') - Number(a.folder === '收件箱') || Number(!!b.todo) - Number(!!a.todo) || top(a.folder) - top(b.folder) || collator.compare(a.folder, b.folder))
}

const prioName = (p: number) => (p === 3 ? tNow('优先级高') : p === 2 ? tNow('优先级中') : tNow('优先级低'))

/** 加一条时输入框下面那行（原型 hintQa）：认出来的日子钟点、重复、标题，回车加进哪；空着是 '' */
export function quickHint(text: string, today: string, where: string): string {
  const v = text.trim()
  if (!v) return ''
  const q = parseQuick(v, today)
  const parts = [tNow('认出来：{when}', { when: q.date ? dayName(q.date, today) + (q.time ? ' ' + q.time : '') : tNow('没定日子') })]
  if (q.repeat) parts.push(q.repeat)
  if (q.prio) parts.push(prioName(q.prio))
  parts.push(tNow('「{title}」', { title: q.title }))
  parts.push(q.list ? tNow('回车加进「#{list}」那篇', { list: q.list }) : tNow('回车加进{where}', { where }))
  return parts.join(' · ')
}
