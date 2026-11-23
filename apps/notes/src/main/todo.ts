/**
 * 待办三处的主进程（task-pd1d1）：左边「待办」格、文件夹首页的待办卡、名字叫「待办」的笔记的任务界面用的是同一份——库里每篇笔记的「- [ ]」。
 * list 从 Vault 的全文缓存里扫（每篇按文字记一份，没变的不再认）；改一行、加一条走 Vault 的先比后写（换行、BOM 照原样），
 * 写完告诉界面（note:changed 让开着的编辑器合进去，files:changed 让三处和别的列表重读），记一份撤销（三方合并只退那一处）。
 * 首页卡以前存在 .首页.json 的待办，打开首页时一次搬进 <文件夹>/待办.md（一次提交，能撤回）。
 * 画布今日也开着同一个库时：它改了文件，Vault 的监听报 files:changed，界面重读，几百毫秒内三处都变。
 */
import * as git from '@cn/git'
import { appendLines, type CopyEdit, copiesOf, editCopy, isISODate, lineAt, makeId, newTaskLine, normTime, parseQuick, parseRemind, parseRepeat, parseTaskLine, sameTasks, type When } from '@cn/tasks'
import { app, type BrowserWindow, ipcMain, shell } from 'electron'
import { readFile, rm } from 'node:fs/promises'
import { homeFileOf, type FolderHome } from '../shared/folder-home'
import { INBOX_TODO, noteName, type TodoAddResult, type TodoEditReq, type TodoEditResult, type TodoItem, type TodoMigrateResult, type TodoOp, type TodoUndoResult, type TodoWhere, todoNoteOf } from '../shared/todo'
import { readFolderHome, writeFolderHome } from './folder-home'
import { BRAND } from '../shared/brand'
import { E2E } from './test-mode'
import { addTodoText, editTodoText, idTodoText, legacyTodoLines, localNow, localToday, locateTodo, mayHaveTodos, revertText, todoItems } from './todo-edit'
import type { Vault } from './vault'
import type { Installed } from '@cn/family'

const newId = () => makeId(Math.random)

/** 官网上画布今日那一节：介绍和下载（apps/today/brand.json 的 site） */
export const TODAY_SITE = `${BRAND.site}/#today`

/** 一次改动：哪一篇、改之前（null 是本来没有）、改之后 */
interface Change {
  path: string
  before: string | null
  after: string
}

class ReadOnlyError extends Error {
  constructor(path: string) {
    super(`「${noteName(path)}」只能只读打开（有软件读不懂的字节），改不了`)
  }
}

/** 没打开库就调：界面不该走到这里 */
function need(v: Vault | null): Vault {
  if (!v) throw new Error('还没有打开库')
  return v
}

/** 这种改法抄了好几遍的另外几份要不要跟着改、怎么改（@cn/tasks dupes.ts，和画布今日一样）；null 是只改点的那一份 */
function copyEdit(e: TodoOp): CopyEdit | null {
  switch (e.op) {
    case 'done':
      return { op: 'done', done: e.done }
    case 'date':
      return { op: 'when', date: e.date }
    case 'time':
      return { op: 'when', time: e.time }
    case 'when':
      return { op: 'when', date: e.date, ...(e.time !== undefined ? { time: e.time } : {}) }
    case 'schedule':
      return { op: 'when', date: e.when.date, ...(e.when.date ? { time: e.when.time } : {}) }
    case 'delete':
      return { op: 'delete' }
    default:
      return null
  }
}

/** 同一篇改了几次的并成一次（撤回时按「改之前、改之后」退，一篇只能有一份） */
function oneEach(changes: Change[]): Change[] {
  const by = new Map<string, Change>()
  for (const c of changes) {
    const had = by.get(c.path)
    by.set(c.path, had ? { path: c.path, before: had.before, after: c.after } : c)
  }
  return [...by.values()]
}

const isNoteRel = (p: string) => typeof p === 'string' && /\.md$/i.test(p) && !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s.startsWith('.'))

/** 界面交来的 AI 认出来的那一份：照 @cn/tasks 的写法再验一遍，不对的那项丢掉；没有标题、什么都不剩是 null */
function aiWhen(x: unknown): When | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const s = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : null)
  const title = s('title')
  if (!title) return null
  const date = s('date') && isISODate(s('date')!) ? s('date') : null
  const time = s('time') ? normTime(s('time')!) : null
  const remind = s('remind') && parseRemind(s('remind')!) ? s('remind') : null
  const repeat = s('repeat') && parseRepeat(s('repeat')!) ? s('repeat') : null
  if (!date && !time && !remind && !repeat) return null
  return { title, date: date ?? (time ? localToday() : null), time, remind, repeat, hits: [] }
}

export function registerTodo(o: { vault: () => Vault | null; win: () => BrowserWindow | null; family: { installed(): Promise<Installed> } }) {
  /** 每篇认出来的待办，按文字记着（文字没变就不再认） */
  const memo = new Map<string, { text: string; items: TodoItem[] }>()
  /** 撤销：编号 → 那一次改的几篇（最多留 100 次） */
  const undos = new Map<string, { changes: Change[]; migrate?: { folder: string; home: { before: string; after: string }; moved: number } }>()
  let undoSeq = 0
  /** 每篇排队：读 → 改 → 写 一篇一篇来，连着点两下不会互相盖掉 */
  const queues = new Map<string, Promise<unknown>>()
  const inTurn = <T>(path: string, f: () => Promise<T>): Promise<T> => {
    const run = (queues.get(path) ?? Promise.resolve()).then(f, f)
    queues.set(
      path,
      run.catch(() => undefined),
    )
    return run
  }

  const tell = (path: string, text: string | null) => {
    const w = o.win()
    if (!w) return
    if (text !== null) w.webContents.send('note:changed', path, text)
    w.webContents.send('files:changed')
  }

  /** 盘上这一篇现在的字（Vault 读的：换行统一成 \n、去掉了 BOM）；不在是 null */
  async function current(v: Vault, path: string): Promise<{ text: string; readOnly: boolean } | null> {
    try {
      const n = await v.read(path)
      return { text: n.text, readOnly: n.readOnly }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  /**
   * 改一篇：f 拿到盘上现在的字（没有是 null），交回改完的（null 不改）。先比后写，读和写之间别处改了就用新的再来一次。
   * 写完告诉界面；返回这次改动（没改是 null）和 f 的结果
   */
  async function change<R>(v: Vault, path: string, f: (cur: string | null) => { text: string; result: R } | null): Promise<{ change: Change; result: R } | null> {
    return inTurn(path, async () => {
      for (let i = 0; i < 3; i++) {
        const cur = await current(v, path)
        if (cur?.readOnly) throw new ReadOnlyError(path)
        const r = f(cur?.text ?? null)
        if (!r || r.text === cur?.text) return null
        const w = await v.write(path, r.text, cur?.text ?? '')
        if (!w.ok) continue
        tell(path, r.text)
        return { change: { path, before: cur?.text ?? null, after: r.text }, result: r.result }
      }
      throw new Error(`「${noteName(path)}」一直在被别处改，没改成，再试一次`)
    })
  }

  const remember = (changes: Change[], migrate?: { folder: string; home: { before: string; after: string }; moved: number }) => {
    const id = `t${++undoSeq}`
    undos.set(id, { changes, ...(migrate ? { migrate } : {}) })
    if (undos.size > 100) undos.delete(undos.keys().next().value!)
    return id
  }

  /** 退回几篇：盘上还是改完的样子就换回去（本来没有的删掉），后来又改过的三方合并只退这一处；有一篇合不了就都不退 */
  async function revert(v: Vault, changes: Change[]): Promise<boolean> {
    const plan: { path: string; to: string | null; cur: string }[] = []
    for (const c of changes) {
      const cur = await current(v, c.path)
      if (!cur || cur.readOnly) return false
      if (c.before === null) {
        if (cur.text !== c.after) return false
        plan.push({ path: c.path, to: null, cur: cur.text })
        continue
      }
      const to = revertText(c.before, c.after, cur.text)
      if (to === null) return false
      plan.push({ path: c.path, to, cur: cur.text })
    }
    for (const p of plan) {
      if (p.to === null) {
        await rm(v.abs(p.path), { force: true })
        tell(p.path, null)
      } else {
        const w = await v.write(p.path, p.to, p.cur)
        if (!w.ok) return false
        tell(p.path, p.to)
      }
    }
    return true
  }

  const list = async (): Promise<TodoItem[]> => {
    const v = o.vault()
    if (!v) return []
    const texts = await v.texts()
    const out: TodoItem[] = []
    for (const [path, text] of texts) {
      if (!isNoteRel(path)) continue
      let m = memo.get(path)
      if (!m || m.text !== text) {
        m = { text, items: mayHaveTodos(text) ? todoItems(path, text) : [] }
        memo.set(path, m)
      }
      for (const t of m.items) out.push({ ...t, dupOf: null, dups: [] })
    }
    for (const p of [...memo.keys()]) if (!texts.has(p)) memo.delete(p)
    // 抄了好几遍的同一条：全库只显示一份（文件不动）
    const groups = sameTasks(out.map((t) => ({ key: t.key, path: t.path, line: t.line, title: t.title, date: t.date, block: parseTaskLine(t.raw)?.block ?? null, done: t.done, cancelled: t.cancelled })))
    for (const t of out) {
      const g = groups.get(t.key)
      if (!g) continue
      if (g.rep === t.key) t.dups = g.all.filter((k) => k !== t.key)
      else t.dupOf = g.rep
    }
    return out
  }
  ipcMain.handle('todo:list', list)

  ipcMain.handle('todo:edit', async (_e, req: TodoEditReq): Promise<TodoEditResult> => {
    if (!req || !isNoteRel(req.path) || typeof req.raw !== 'string' || !Number.isInteger(req.line) || !req.edit) return { ok: false, reason: 'failed', message: '参数不对' }
    try {
      const v = need(o.vault())
      const today = localToday()
      // 抄了好几遍的同一条：勾掉、改日子钟点、删掉写到每一份上（一个撤回），别的只改点的这一份
      const ce = copyEdit(req.edit)
      const copies = ce ? copiesOf(await list(), req) : []
      /** 认得出那一行、改了等于没改（本来就是这一天）：不写文件，也不算「那一行没了」 */
      const same: { at: { line: number; raw: string } | null } = { at: null }
      const r = await change(v, req.path, (cur) => {
        if (cur === null) return null
        const x = editTodoText(cur, req.line, req.raw, req.edit, today, newId)
        if (!x) {
          const n = locateTodo(cur, req.line, req.raw)
          if (n !== null) same.at = { line: n, raw: lineAt(cur, n) ?? req.raw }
        }
        return x && { text: x.text, result: x }
      })
      const more: Change[] = []
      for (const c of copies) {
        // 只读的那一篇改不了：跳过它，点的那一份和别的几份照样改、照样记撤回
        const rc = await change(v, c.path, (cur) => {
          const k = cur === null ? null : locateTodo(cur, c.line, c.raw)
          return k === null ? null : { text: editCopy(cur!, k, ce!, today), result: null }
        }).catch((e: unknown) => {
          if (e instanceof ReadOnlyError) return null
          throw e
        })
        if (rc) more.push(rc.change)
      }
      if (!r && !more.length) return same.at ? { ok: true, undo: '', path: req.path, ...same.at } : { ok: false, reason: 'gone' }
      const undo = remember(oneEach([...(r ? [r.change] : []), ...more]))
      const copied = more.length ? { copies: more.length } : {}
      if (!r) return { ok: true, undo, path: req.path, line: same.at?.line ?? req.line, raw: same.at?.raw ?? req.raw, ...copied }
      return { ok: true, undo, path: req.path, line: r.result.line, raw: r.result.raw, ...(r.result.next ? { next: r.result.next } : {}), ...copied }
    } catch (err) {
      if (err instanceof ReadOnlyError) return { ok: false, reason: 'readonly', message: err.message }
      return { ok: false, reason: 'failed', message: String((err as Error).message ?? err) }
    }
  })

  ipcMain.handle('todo:add', async (_e, text: unknown, where: TodoWhere, day: unknown, when: unknown): Promise<TodoAddResult> => {
    if (typeof text !== 'string' || !where || typeof where !== 'object' || (day !== undefined && day !== null && (typeof day !== 'string' || !isISODate(day)))) return { ok: false, reason: 'failed', message: '参数不对' }
    try {
      const v = need(o.vault())
      const today = localToday()
      const q = parseQuick(text.trim(), localNow())
      // AI 认出来的（task-pd289）：标题、日子、钟点、提醒、重复照它（界面上「认出来」那一行写的就是它），#清单、!优先级照旧从原话认
      const w = aiWhen(when)
      if (w) Object.assign(q, { title: w.title, date: w.date, time: w.time, remind: w.date ? w.remind : null, repeat: w.repeat })
      // 待办首页只看某一天时加的：没写哪天就加到那天（task-kzr3n）
      if (!q.date && day) q.date = day
      let title = q.title
      let path = 'note' in where ? where.note : 'folder' in where ? todoNoteOf(where.folder) : INBOX_TODO
      // #清单：对上库里哪篇的名字就写进哪篇（和画布今日一样）；对不上 # 那几个字留在标题里
      if (q.list) {
        const want = q.list.toLowerCase()
        const hit = [...(await v.texts()).keys()].find((p) => isNoteRel(p) && noteName(p).toLowerCase() === want)
        if (hit) path = hit
        else title = `${title} #${q.list}`.trim()
      }
      if (!isNoteRel(path)) return { ok: false, reason: 'failed', message: `写不进「${path}」` }
      if (!title) return { ok: false, reason: 'empty' }
      const line = newTaskLine({ title, date: q.date, time: q.time, remind: q.date ? q.remind : null, repeat: q.repeat, prio: q.prio })
      const r = await change(v, path, (cur) => {
        const a = addTodoText(cur, noteName(path), line)
        return { text: a.text, result: { line: a.line, created: cur === null } }
      })
      if (!r) return { ok: false, reason: 'failed' }
      return { ok: true, undo: remember([r.change]), path, line: r.result.line, raw: line, title, date: q.date, time: q.time, created: r.result.created }
    } catch (err) {
      if (err instanceof ReadOnlyError) return { ok: false, reason: 'readonly', message: err.message }
      return { ok: false, reason: 'failed', message: String((err as Error).message ?? err) }
    }
  })

  ipcMain.handle('todo:undo', async (_e, id: unknown): Promise<TodoUndoResult> => {
    const u = typeof id === 'string' ? undos.get(id) : undefined
    if (!u || u.migrate) return { ok: false, reason: 'gone' }
    try {
      const v = need(o.vault())
      const ok = await inTurn(u.changes[0]!.path, () => revert(v, u.changes))
      if (!ok) return { ok: false, reason: 'changed' }
      undos.delete(id as string)
      return { ok: true }
    } catch (err) {
      return { ok: false, reason: 'failed', message: String((err as Error).message ?? err) }
    }
  })

  /**
   * 首页卡里以前存在 .首页.json 的待办（没撤回过的）：一次搬进 <文件夹>/待办.md（接在最后一条后面，没有就建），
   * 卡里的拿掉，两个文件一次提交「首页待办卡里的N条搬进了「…」」
   */
  ipcMain.handle('todo:migrate', async (_e, folder: unknown, force: unknown): Promise<TodoMigrateResult> => {
    if (typeof folder !== 'string' || !folder) return null
    const v = need(o.vault())
    const homePath = homeFileOf(folder)
    let before: string
    try {
      before = await readFile(v.abs(homePath), 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
    const { home } = await readFolderHome(v, folder)
    const ids = Object.keys(home.widgets).filter((id) => home.widgets[id]!.type === 'todo' && home.widgets[id]!.todos?.length && (force === true || !home.widgets[id]!.todosKept))
    const lines = ids.flatMap((id) => legacyTodoLines(home.widgets[id]!.todos!))
    if (!lines.length) return null
    const todoPath = todoNoteOf(folder)
    const r = await change(v, todoPath, (cur) => ({ text: appendLines(cur ?? `# ${noteName(todoPath)}\n\n`, lines).text, result: true }))
    if (!r) return null
    const next: FolderHome = { ...home, widgets: { ...home.widgets } }
    for (const id of ids) {
      const { todos: _t, todosKept: _k, ...rest } = next.widgets[id]!
      next.widgets[id] = rest
    }
    await writeFolderHome(v, folder, next)
    const after = await readFile(v.abs(homePath), 'utf8')
    const said = `首页待办卡里的${lines.length}条搬进了「${todoPath}」`
    let commitError: string | undefined
    await git.commitPaths(v.root, [todoPath, homePath], said).catch((e: Error) => (commitError = String(e.message ?? e)))
    tell(todoPath, r.change.after)
    return { moved: lines.length, path: todoPath, undo: remember([r.change], { folder, home: { before, after }, moved: lines.length }), ...(commitError ? { commitError } : {}) }
  })

  /** 撤回搬家：待办.md 退回搬之前（本来没有的删掉），.首页.json 换回原来的、那几条记上 todosKept（不再自动搬），一次提交 */
  ipcMain.handle('todo:unmigrate', async (_e, id: unknown): Promise<TodoUndoResult> => {
    const u = typeof id === 'string' ? undos.get(id) : undefined
    if (!u?.migrate) return { ok: false, reason: 'gone' }
    const v = need(o.vault())
    const m = u.migrate
    const homePath = homeFileOf(m.folder)
    const homeNow = await readFile(v.abs(homePath), 'utf8').catch(() => null)
    if (homeNow !== m.home.after) return { ok: false, reason: 'changed' }
    const c = u.changes[0]!
    const ok = await inTurn(c.path, () => revert(v, u.changes))
    if (!ok) return { ok: false, reason: 'changed' }
    const raw = JSON.parse(m.home.before) as { widgets?: Record<string, Record<string, unknown>> }
    for (const w of Object.values(raw.widgets ?? {})) if (w && w.type === 'todo' && Array.isArray(w.todos) && w.todos.length) w.todosKept = true
    await writeFolderHome(v, m.folder, raw)
    await git.commitPaths(v.root, [c.path, homePath], `撤回：首页待办卡里的${m.moved}条搬进了「${c.path}」`).catch((e: Error) => console.error('撤回搬家没提交上', e))
    undos.delete(id as string)
    o.win()?.webContents.send('files:changed')
    return { ok: true }
  })

  /**
   * 装了画布今日没有：和设置 › 软件家族同一个认法（按身份号问系统，只认「应用程序」里的，开发机上项目文件夹里打包出来的那份不算；
   * 以前按 canvas-today:// 认，会把那份认成装了）。测试模式里看 CN_TODAY_INSTALLED 或 CN_FAMILY_INSTALLED_FILE
   */
  ipcMain.handle('todo:todayInstalled', async () => !!(await o.family.installed())['canvas-today'])

  /** AI 排进空着的时间收下（task-kzr3n）：按篇分，每篇一次改完，几篇记成一次撤回 */
  ipcMain.handle('todo:times', async (_e, items: unknown): Promise<TodoEditResult> => {
    if (!Array.isArray(items) || !items.length) return { ok: false, reason: 'failed', message: '参数不对' }
    const ok = items.every((x) => x && isNoteRel(x.path) && Number.isInteger(x.line) && typeof x.raw === 'string' && typeof x.time === 'string' && /^\d{2}:\d{2}$/.test(x.time))
    if (!ok) return { ok: false, reason: 'failed', message: '参数不对' }
    try {
      const v = need(o.vault())
      const today = localToday()
      const changes: Change[] = []
      const byPath = new Map<string, { line: number; raw: string; time: string }[]>()
      for (const x of items as { path: string; line: number; raw: string; time: string }[]) byPath.set(x.path, [...(byPath.get(x.path) ?? []), x])
      for (const [path, list] of byPath) {
        const r = await change(v, path, (cur) => {
          if (cur === null) return null
          let text = cur
          for (const x of list) {
            const e = editTodoText(text, x.line, x.raw, { op: 'time', time: x.time }, today, newId)
            if (e) text = e.text
          }
          return text === cur ? null : { text, result: null }
        })
        if (r) changes.push(r.change)
      }
      if (!changes.length) return { ok: false, reason: 'gone' }
      const first = items[0] as { path: string; line: number; raw: string }
      return { ok: true, undo: remember(changes), path: first.path, line: first.line, raw: first.raw }
    } catch (err) {
      if (err instanceof ReadOnlyError) return { ok: false, reason: 'readonly', message: err.message }
      return { ok: false, reason: 'failed', message: String((err as Error).message ?? err) }
    }
  })

  /**
   * 打开画布今日（task-kzr3n，左栏头上那一颗）：找到认 canvas-today:// 的那个软件，打开它（已经开着就换到前面）；
   * canvas-today:// 不带哪一条时画布今日不换到前面，所以直接开那个 App。测试模式里不看这台 Mac 上装没装，记一笔「打开 Canvas Today.app」
   */
  ipcMain.handle('todo:openToday', async (): Promise<void> => {
    const path = E2E ? 'Canvas Today.app' : (await app.getApplicationInfoForProtocol('canvas-today://')).path
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  })

  /** 没装画布今日：开官网上画布今日那一节（下载在那里） */
  ipcMain.handle('todo:aboutToday', () => shell.openExternal(TODAY_SITE))

  /** 在画布今日里打开这一条：canvas-today://task/<🆔>；没有 🆔 的先给它一个（只加那几个字，能撤回） */
  ipcMain.handle('todo:openInToday', async (_e, req: Omit<TodoEditReq, 'edit'>): Promise<TodoEditResult> => {
    if (!req || !isNoteRel(req.path) || typeof req.raw !== 'string' || !Number.isInteger(req.line)) return { ok: false, reason: 'failed', message: '参数不对' }
    try {
      const v = need(o.vault())
      /** 已经有 🆔 的：不用改文件，change 交回 null，认出来的那一条记在这里 */
      const box: { hit: { line: number; raw: string; id: string } | null } = { hit: null }
      const r = await change(v, req.path, (cur) => {
        if (cur === null) return null
        const x = idTodoText(cur, req.line, req.raw, newId)
        box.hit = x
        return x && { text: x.text, result: x }
      })
      const hit = r?.result ?? box.hit
      if (!hit) return { ok: false, reason: 'gone' }
      await shell.openExternal(`canvas-today://task/${encodeURIComponent(hit.id)}`)
      return { ok: true, undo: r ? remember([r.change]) : '', path: req.path, line: hit.line, raw: hit.raw }
    } catch (err) {
      if (err instanceof ReadOnlyError) return { ok: false, reason: 'readonly', message: err.message }
      return { ok: false, reason: 'failed', message: String((err as Error).message ?? err) }
    }
  })
  return { list }
}
