/**
 * 待办三处的主进程（task-pd1d1）：左边「待办」格、文件夹首页的待办卡、名字叫「待办」的笔记的任务界面用的是同一份——库里每篇笔记的「- [ ]」。
 * list 从 Vault 的全文缓存里扫（每篇按文字记一份，没变的不再认）；改一行、加一条走 Vault 的先比后写（换行、BOM 照原样），
 * 写完告诉界面（note:changed 让开着的编辑器合进去，files:changed 让三处和别的列表重读），记一份撤销（三方合并只退那一处）。
 * 首页卡以前存在 .首页.json 的待办，打开首页时一次搬进 <文件夹>/待办.md（一次提交，能撤回）。
 * 画布今日也开着同一个库时：它改了文件，Vault 的监听报 files:changed，界面重读，几百毫秒内三处都变。
 */
import * as git from '@cn/git'
import { appendLines, lineAt, makeId, newTaskLine, parseQuick } from '@cn/tasks'
import { app, type BrowserWindow, ipcMain, shell } from 'electron'
import { readFile, rm } from 'node:fs/promises'
import { homeFileOf, type FolderHome } from '../shared/folder-home'
import { INBOX_TODO, noteName, type TodoAddResult, type TodoEditReq, type TodoEditResult, type TodoItem, type TodoMigrateResult, type TodoUndoResult, type TodoWhere, todoNoteOf } from '../shared/todo'
import { readFolderHome, writeFolderHome } from './folder-home'
import { E2E } from './test-mode'
import { addTodoText, editTodoText, idTodoText, legacyTodoLines, localToday, locateTodo, mayHaveTodos, revertText, todoItems } from './todo-edit'
import type { Vault } from './vault'

const newId = () => makeId(Math.random)

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

const isNoteRel = (p: string) => typeof p === 'string' && /\.md$/i.test(p) && !p.startsWith('/') && !p.split('/').some((s) => s === '..' || s.startsWith('.'))

export function registerTodo(o: { vault: () => Vault | null; win: () => BrowserWindow | null }) {
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

  ipcMain.handle('todo:list', async (): Promise<TodoItem[]> => {
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
      for (const t of m.items) out.push(t)
    }
    for (const p of [...memo.keys()]) if (!texts.has(p)) memo.delete(p)
    return out
  })

  ipcMain.handle('todo:edit', async (_e, req: TodoEditReq): Promise<TodoEditResult> => {
    if (!req || !isNoteRel(req.path) || typeof req.raw !== 'string' || !Number.isInteger(req.line) || !req.edit) return { ok: false, reason: 'failed', message: '参数不对' }
    try {
      const v = need(o.vault())
      /** 认得出那一行、改了等于没改（本来就是这一天）：不写文件，也不算「那一行没了」 */
      const same: { at: { line: number; raw: string } | null } = { at: null }
      const r = await change(v, req.path, (cur) => {
        if (cur === null) return null
        const x = editTodoText(cur, req.line, req.raw, req.edit, localToday(), newId)
        if (!x) {
          const n = locateTodo(cur, req.line, req.raw)
          if (n !== null) same.at = { line: n, raw: lineAt(cur, n) ?? req.raw }
        }
        return x && { text: x.text, result: x }
      })
      if (!r) return same.at ? { ok: true, undo: '', path: req.path, ...same.at } : { ok: false, reason: 'gone' }
      return { ok: true, undo: remember([r.change]), path: req.path, line: r.result.line, raw: r.result.raw, ...(r.result.next ? { next: r.result.next } : {}) }
    } catch (err) {
      if (err instanceof ReadOnlyError) return { ok: false, reason: 'readonly', message: err.message }
      return { ok: false, reason: 'failed', message: String((err as Error).message ?? err) }
    }
  })

  ipcMain.handle('todo:add', async (_e, text: unknown, where: TodoWhere): Promise<TodoAddResult> => {
    if (typeof text !== 'string' || !where || typeof where !== 'object') return { ok: false, reason: 'failed', message: '参数不对' }
    try {
      const v = need(o.vault())
      const today = localToday()
      const q = parseQuick(text.trim(), today)
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
      const line = newTaskLine({ title, date: q.date, time: q.time, repeat: q.repeat, prio: q.prio })
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

  /** 装了画布今日没有：认 canvas-today:// 的软件。测试模式里看 CN_TODAY_INSTALLED（不看这台 Mac 上真装没装） */
  ipcMain.handle('todo:todayInstalled', () => (E2E ? process.env.CN_TODAY_INSTALLED === '1' : !!app.getApplicationNameForProtocol('canvas-today://')))

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
}
