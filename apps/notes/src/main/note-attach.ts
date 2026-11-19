/**
 * 一篇笔记的附件（见 shared/attach.ts）：列出来、删笔记时连同只有它在用的图一起移到废纸篓、撤回。
 * 撤回靠删之前在软件设置目录 trash-undo/<号>/ 里留的一份（废纸篓里的东西没法按路径拿回来）；软件下次启动时清掉。
 */
import { attachmentDir, decodeNote, imageRefs, linkedPaths } from '@cn/format'
import * as git from '@cn/git'
import { ipcMain, shell } from 'electron'
import { copyFile, mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AttachItem, NoteAttachments, TrashResult } from '../shared/attach'
import { COVER_DIR } from '../shared/home'
import { pinNote, readPins, repin } from './pins'
import type { Vault } from './vault'

const SKIP = new Set(['.git', 'node_modules', '.trash', '.obsidian'])

function needNote(note: unknown): string {
  if (typeof note !== 'string' || !/\.md$/i.test(note) || note.startsWith('/') || note.split('/').some((s) => !s || s === '..')) throw new Error(`笔记不对：${String(note)}`)
  return note
}

/** 文件夹里所有文件（不算 . 开头的），库里的路径；没有这个文件夹是空的 */
async function filesUnder(v: Vault, dir: string): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string) => {
    let ents
    try {
      ents = await readdir(v.abs(d), { withFileTypes: true })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return
      throw e
    }
    for (const e of ents) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) await walk(`${d}/${e.name}`)
      else if (e.isFile()) out.push(`${d}/${e.name}`)
    }
  }
  await walk(dir)
  return out
}

/**
 * 库里所有 md（不进 . 开头的文件夹和附件/）；读 PDF 时记的完整对话（.canvas-notes/对话/）也算，
 * 那里链着的截图删笔记时不一起删
 */
async function allMd(v: Vault): Promise<string[]> {
  const out: string[] = []
  const walk = async (d: string) => {
    let ents
    try {
      ents = await readdir(d ? v.abs(d) : v.root, { withFileTypes: true })
    } catch (e) {
      if (d && (e as NodeJS.ErrnoException).code === 'ENOENT') return
      throw e
    }
    for (const e of ents) {
      if (e.name.startsWith('.') || SKIP.has(e.name) || (!d && e.name === '附件')) continue
      const rel = d ? `${d}/${e.name}` : e.name
      if (e.isDirectory()) await walk(rel)
      else if (e.isFile() && /\.md$/i.test(e.name)) out.push(rel)
    }
  }
  await walk('')
  await walk('.canvas-notes/对话')
  return out
}

const sizeOf = (v: Vault, p: string) => stat(v.abs(p)).then((s) => (s.isFile() ? s.size : null), () => null)

export async function noteAttachments(v: Vault, noteArg: unknown, shared: boolean): Promise<NoteAttachments> {
  const note = needNote(noteArg)
  const text = decodeNote(await readFile(v.abs(note))).text
  const dir = attachmentDir(note)
  const inDir = (p: string) => p.startsWith(dir + '/')
  // 跟着这篇走的：自己文件夹里的，和放在 附件/ 别处、文中用到的（首页和文件夹的封面不算）
  const goesWith = (p: string) => inDir(p) || (p.startsWith('附件/') && !p.startsWith(COVER_DIR + '/'))
  const items: AttachItem[] = []
  const seen = new Set<string>()
  for (const r of imageRefs(text, note)) {
    const bytes = await sizeOf(v, r.path)
    if (bytes === null || seen.has(r.path)) continue
    seen.add(r.path)
    items.push({ path: r.path, bytes, where: r.where, offset: r.offset, own: inDir(r.path), mine: goesWith(r.path) })
  }
  const own = (await filesUnder(v, dir)).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
  for (const p of own) {
    if (seen.has(p)) continue
    items.push({ path: p, bytes: (await sizeOf(v, p)) ?? 0, where: null, offset: null, own: true, mine: true })
  }
  if (shared && items.some((i) => i.mine)) {
    const mine = new Set(items.filter((i) => i.mine).map((i) => i.path))
    for (const other of await allMd(v)) {
      if (other === note) continue
      const links = linkedPaths(decodeNote(await readFile(v.abs(other))).text, other)
      for (const p of links) if (mine.has(p)) (items.find((i) => i.path === p)!.sharedWith ??= []).push(other)
    }
  }
  const dirExists = (await stat(v.abs(dir)).catch(() => null))?.isDirectory() ?? false
  return { dir, dirExists, items, bytes: items.reduce((s, i) => s + i.bytes, 0) }
}

/** 删掉以后空了的文件夹一层层往上收掉（到 附件/ 为止） */
async function pruneEmpty(v: Vault, dir: string) {
  for (let d = dir; d.includes('/'); d = dirname(d)) {
    try {
      const left = (await readdir(v.abs(d))).filter((n) => n !== '.DS_Store')
      if (left.length) return
      await rm(join(v.abs(d), '.DS_Store'), { force: true })
      await rmdir(v.abs(d))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw e
    }
  }
}

export async function trashNoteWith(v: Vault, noteArg: unknown, withImages: unknown, stageRoot: string, put: (abs: string) => Promise<void>): Promise<TrashResult> {
  const note = needNote(noteArg)
  const a = withImages === true ? await noteAttachments(v, note, true) : null
  const images = a ? a.items.filter((i) => i.mine && !i.sharedWith?.length).map((i) => i.path) : []
  const kept = a ? a.items.filter((i) => i.mine && i.sharedWith?.length).length : 0
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const stage = join(stageRoot, id)
  const files = [note, ...images]
  for (const f of files) {
    await mkdir(dirname(join(stage, f)), { recursive: true })
    await copyFile(v.abs(f), join(stage, f))
  }
  const pinned = (await readPins(v)).includes(note)
  await writeFile(join(stage, '.删掉的.json'), JSON.stringify({ files, pinned }))
  for (const f of files) await put(v.abs(f))
  // 删空了的附件文件夹一层层收掉（自己的、别处的都一样，到 附件/ 为止）
  for (const d of new Set(images.map((p) => dirname(p)))) await pruneEmpty(v, d)
  await repin(v, note, null)
  return { id, images: images.length, kept }
}

export async function undoTrash(v: Vault, id: unknown, stageRoot: string): Promise<void> {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw new Error('撤回的号不对')
  const stage = join(stageRoot, id)
  let saved: { files: string[]; pinned: boolean }
  try {
    saved = JSON.parse(await readFile(join(stage, '.删掉的.json'), 'utf8'))
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('撤回不了了：留的那份已经清掉（软件重开过）。去访达的废纸篓里找')
    throw e
  }
  for (const f of saved.files) {
    const to = v.abs(f)
    if (await stat(to).catch(() => null)) continue
    await mkdir(dirname(to), { recursive: true })
    // 先拷成旁边一个隐藏的临时文件再改名：文件一出现就是完整的（看着库的监视、开着的标签不会读到拷了一半的空文件）
    const tmp = join(dirname(to), `.${basename(to)}.撤回中`)
    await copyFile(join(stage, f), tmp)
    await rename(tmp, to)
  }
  if (saved.pinned) await pinNote(v, saved.files[0]!, true)
  await rm(stage, { recursive: true, force: true })
}

export function registerNoteAttach(getVault: () => Vault, userData: string, changed: () => void) {
  const stageRoot = join(userData, 'trash-undo')
  // 上次开着时留的撤回用的那份：重开以后用不上了
  void rm(stageRoot, { recursive: true, force: true })
  // 测试把「废纸篓」换成临时文件夹，不往用户真的废纸篓里放东西
  const put = async (abs: string) => {
    const dir = process.env.CN_TRASH_DIR
    if (dir) await rename(abs, join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${abs.split('/').pop()}`))
    else await shell.trashItem(abs)
  }
  ipcMain.handle('attach:of', (_e, note: unknown, shared: unknown) => noteAttachments(getVault(), note, shared === true))
  ipcMain.handle('attach:trash-note', async (_e, note: unknown, withImages: unknown) => {
    try {
      // 删之前把这篇（和它的图）没提交的改动先提交：确认框说「Git 里也留着这一版」，就得真留着刚打的字
      const v = getVault()
      const p = needNote(note)
      const dir = attachmentDir(p) + '/'
      // 连图一起删时：这些图没提交的也先提交（「Git 里也留着这一版」）
      const with_ = withImages === true ? new Set((await noteAttachments(v, p, false)).items.filter((i) => i.mine).map((i) => i.path)) : new Set<string>()
      const pending = (await git.status(v.root)).filter((s) => s.path === p || s.path.startsWith(dir) || with_.has(s.path))
      if (pending.length) await git.commitPaths(v.root, pending.map((s) => s.path), git.describeChanges(pending))
      return await trashNoteWith(v, note, withImages, stageRoot, put)
    } finally {
      changed()
    }
  })
  ipcMain.handle('attach:undo', async (_e, id: unknown) => {
    try {
      await undoTrash(getVault(), id, stageRoot)
    } finally {
      changed()
    }
  })
}
