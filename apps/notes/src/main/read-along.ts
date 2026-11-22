/**
 * 长期一起看的网页和笔记（task-kbnc0）：读到哪（库里 .canvas-notes/读到哪.json）、书桌（库里 .canvas-notes/书桌/<名字>.json）的读写。
 * 都在库里，跟着 Git 走：这里只写文件，不单独提交，跟着下一次自动提交（或「现在提交」、退出前那次）进去。
 * 笔记改名、挪走（软件自己改的、访达里改的、文件夹改名）：书桌里记着的路径跟着换（Vault.onMoved）。
 */
import { ipcMain } from 'electron'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { type Desk, DESK_DIR, deskFile, deskJson, deskNameOfFile, isPairUrl, normalizeDesk, normalizePositions, positionsJson, READ_POS_FILE, type ReadPos, type ReadPositions, remapDesk, samePos } from '../shared/read-along'
import { safeName } from '../shared/file-name'
import { writeFileAtomic } from './atomic'
import type { Vault } from './vault'

/** 读到哪.json 和书桌文件的写排一个队：连着记几次（滚得快、几张书桌一起改）不互相盖掉 */
let turn: Promise<unknown> = Promise.resolve()
function inTurn<T>(fn: () => Promise<T>): Promise<T> {
  const run = turn.then(fn, fn)
  turn = run.catch(() => undefined)
  return run
}

async function readText(p: string): Promise<string | null> {
  return readFile(p, 'utf8').catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return null
    throw e
  })
}

export async function readPositions(vault: Vault): Promise<ReadPositions> {
  const text = await readText(vault.abs(READ_POS_FILE))
  if (text === null) return {}
  try {
    return normalizePositions(JSON.parse(text))
  } catch (e) {
    // 文件坏了（手改、合并冲突）：当还没记过，不挡着打开网页；下一次记的时候整份重写
    if (e instanceof SyntaxError) return {}
    throw e
  }
}

/** 记一本书读到哪：和记着的是同一处就不写（免得 Git 里多出假改动） */
export function setPosition(vault: Vault, book: string, raw: unknown): Promise<void> {
  if (!isPairUrl(book)) throw new Error(`不是书的网址：${String(book)}`)
  const pos = normalizePositions({ [book]: raw })[book]
  if (!pos) throw new Error('读到哪的参数不对')
  return inTurn(async () => {
    const all = await readPositions(vault)
    const was = all[book]
    if (was && samePos(was, pos) && (was.book ?? '') === (pos.book ?? '') && (was.title ?? '') === (pos.title ?? '')) return
    await writeFileAtomic(vault.abs(READ_POS_FILE), positionsJson({ ...all, [book]: pos }))
  })
}

/** 书桌文件只许在 .canvas-notes/书桌/ 下面、一层、.json */
function deskPath(vault: Vault, file: unknown): string {
  if (typeof file !== 'string' || !file.startsWith(DESK_DIR + '/') || !/\.json$/i.test(file) || file.slice(DESK_DIR.length + 1).includes('/') || file.includes('..')) throw new Error(`书桌文件不对：${String(file)}`)
  return vault.abs(file)
}

const exists = (p: string) =>
  stat(p).then(
    () => true,
    (e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return false
      throw e
    },
  )

export async function listDesks(vault: Vault): Promise<{ file: string; desk: Desk }[]> {
  let names: string[]
  try {
    names = await readdir(vault.abs(DESK_DIR))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
  const out: { file: string; desk: Desk }[] = []
  for (const n of names.filter((x) => /\.json$/i.test(x) && !x.startsWith('.'))) {
    const file = `${DESK_DIR}/${n}`
    const text = await readText(vault.abs(file))
    if (text === null) continue
    let raw: unknown = null
    try {
      raw = JSON.parse(text)
    } catch (e) {
      // 坏了的一张（手改、合并冲突）照样列出来，名字用文件名，里面当空的
      if (!(e instanceof SyntaxError)) throw e
    }
    out.push({ file, desk: normalizeDesk(raw, deskNameOfFile(file)) })
  }
  // 最近存的在前面
  return out.sort((a, b) => b.desk.saved.localeCompare(a.desk.saved) || a.desk.name.localeCompare(b.desk.name, 'zh'))
}

/** 名字重了：加「 2」「 3」，返回不撞的文件和名字 */
async function freeDesk(vault: Vault, name: string, keep?: string): Promise<{ file: string; name: string }> {
  for (let n = 1; ; n++) {
    const nm = n === 1 ? safeName(name) : `${safeName(name)} ${n}`
    const file = deskFile(nm)
    if (file === keep || !(await exists(vault.abs(file)))) return { file, name: nm }
  }
}

export function saveDesk(vault: Vault, raw: unknown, file?: unknown): Promise<string> {
  return inTurn(async () => {
    const d = normalizeDesk(raw, '书桌')
    if (file !== undefined && file !== null) {
      const p = deskPath(vault, file)
      await writeFileAtomic(p, deskJson(d))
      return file as string
    }
    const free = await freeDesk(vault, d.name)
    await writeFileAtomic(vault.abs(free.file), deskJson({ ...d, name: free.name }))
    return free.file
  })
}

export function renameDesk(vault: Vault, file: unknown, name: unknown): Promise<string> {
  if (typeof name !== 'string' || !name.trim()) throw new Error('书桌的名字是空的')
  return inTurn(async () => {
    const p = deskPath(vault, file)
    const text = await readText(p)
    if (text === null) throw new Error('这张书桌已经不在了')
    let raw: unknown = null
    try {
      raw = JSON.parse(text)
    } catch (e) {
      if (!(e instanceof SyntaxError)) throw e
    }
    const free = await freeDesk(vault, name.trim(), file as string)
    const d = { ...normalizeDesk(raw, name.trim()), name: free.name }
    await writeFileAtomic(vault.abs(free.file), deskJson(d))
    if (free.file !== file) await rm(p, { force: true })
    return free.file
  })
}

/** 删掉一张：只删这个文件，笔记和网页都不动；返回原文（撤回时原样放回） */
export function removeDesk(vault: Vault, file: unknown): Promise<string> {
  return inTurn(async () => {
    const p = deskPath(vault, file)
    const text = await readText(p)
    if (text === null) throw new Error('这张书桌已经不在了')
    await rm(p, { force: true })
    return text
  })
}

export function restoreDesk(vault: Vault, file: unknown, text: unknown): Promise<void> {
  if (typeof text !== 'string') throw new Error('书桌的内容不对')
  return inTurn(() => writeFileAtomic(deskPath(vault, file), text))
}

/** 笔记改名、挪走、文件夹改名：书桌里记着的路径跟着换（排在写书桌的队里，不和自动记下打架） */
export function remapDesks(vault: Vault, map: (p: string) => string | null | undefined): Promise<boolean> {
  return inTurn(async () => {
    let any = false
    for (const { file, desk } of await listDesks(vault)) {
      const next = remapDesk(desk, map)
      if (!next) continue
      await writeFileAtomic(vault.abs(file), deskJson(next))
      any = true
    }
    return any
  })
}

/** 挂在 Vault.onMoved 上：改了书桌就让界面重读 */
export const followMoves = (vault: Vault, changed: () => void) => (map: (p: string) => string | null | undefined) =>
  void remapDesks(vault, map).then(
    (any) => any && changed(),
    (e) => console.error('书桌跟着改路径没成功', e),
  )

export function registerReadAlong(vault: () => Vault) {
  ipcMain.handle('readpos:all', () => readPositions(vault()))
  ipcMain.handle('readpos:set', (_e, book: string, pos: ReadPos) => setPosition(vault(), book, pos))
  ipcMain.handle('desk:list', () => listDesks(vault()))
  ipcMain.handle('desk:save', (_e, desk: unknown, file?: unknown) => saveDesk(vault(), desk, file))
  ipcMain.handle('desk:rename', (_e, file: unknown, name: unknown) => renameDesk(vault(), file, name))
  ipcMain.handle('desk:remove', (_e, file: unknown) => removeDesk(vault(), file))
  ipcMain.handle('desk:restore', (_e, file: unknown, text: unknown) => restoreDesk(vault(), file, text))
}
