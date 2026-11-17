/**
 * 库里的文件夹：新建（放一个看不见的 .gitkeep，Git 才记得住空文件夹）、改名（库里写着旧路径的链接、置顶一起改）、
 * 移到废纸篓。每样做完就是一次提交，历史里能撤回。
 *
 * 空文件夹为什么能在目录树里看到：主进程列文件时本来就把文件夹也列出来（main/files.ts），
 * .gitkeep 只是给 Git 的：没有它，空文件夹不进提交，换台电脑就没了。
 */
import * as git from '@cn/git'
import { ATTACHMENTS_DIR, decodeNote, encodeNote, folderMap, remapLinks } from '@cn/format'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkFolderName } from '../shared/folder-home'
import { fixedFolder } from '../shared/files'
import { PINS_FILE } from '../shared/sidebar'
import { LEFT_FILE } from '../shared/left'
import { relookAll } from './left'
import { repinAll } from './pins'
import type { Vault } from './vault'

export { fixedFolder }
export const GITKEEP = '.gitkeep'
const SKIP = new Set(['.git', 'node_modules', '.trash', '.obsidian'])

const exists = (p: string) => stat(p).then(() => true, () => false)
const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const join2 = (dir: string, name: string) => (dir ? `${dir}/${name}` : name)

function needFolder(folder: unknown): string {
  if (typeof folder !== 'string' || !folder || folder.split('/').some((s) => !s || s === '.' || s === '..')) throw new Error(`文件夹不对：${String(folder)}`)
  return folder
}

/** 文件夹里的文件（不算 . 开头的），给确认框数个数 */
export async function countFiles(v: Vault, folder: string): Promise<number> {
  let n = 0
  const walk = async (dir: string) => {
    for (const e of await readdir(v.abs(dir), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      if (e.isDirectory()) await walk(`${dir}/${e.name}`)
      else n++
    }
  }
  await walk(folder)
  return n
}

/** 这几处用户还没提交的字先单独提交，后面那次提交里只有这一步的改动（撤回才不带走用户的字） */
async function commitPendingUnder(root: string, inside: (p: string) => boolean) {
  const pending = (await git.status(root)).filter((s) => inside(s.path))
  if (pending.length) await git.commitPaths(root, pending.map((s) => s.path), git.describeChanges(pending))
}

/** 提交这一步碰过的路径（用 status 里真有的路径，删掉的、新建的都在） */
async function commitTouched(root: string, inside: (p: string) => boolean, message: string): Promise<string | null> {
  const paths = (await git.status(root)).filter((s) => inside(s.path)).map((s) => s.path)
  return git.commitPaths(root, paths, message)
}

/** 在 parent 里新建文件夹（名字重了加「 2」），放 .gitkeep，提交；返回新文件夹 */
export async function makeFolder(v: Vault, parent: string, name: string): Promise<string> {
  if (parent) needFolder(parent)
  const bad = checkFolderName(name)
  if (bad) throw new Error(bad)
  const base = join2(parent, name.trim())
  let f = base
  for (let n = 2; await exists(v.abs(f)); n++) f = `${base} ${n}`
  await mkdir(v.abs(f), { recursive: true })
  await writeFile(v.abs(`${f}/${GITKEEP}`), '')
  await git.commitPaths(v.root, [`${f}/${GITKEEP}`], `新建文件夹：${f}`)
  return f
}

/** 库里所有 md（含 .canvas-notes 里的完整对话），相对路径 */
async function allMd(v: Vault): Promise<string[]> {
  const out: string[] = []
  const walk = async (dir: string) => {
    for (const e of await readdir(dir ? v.abs(dir) : v.root, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue
      const rel = join2(dir, e.name)
      if (e.isDirectory()) await walk(rel)
      else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(rel)
    }
  }
  await walk('')
  return out
}

export interface RenameResult {
  to: string
  /** 改了链接的笔记（新路径） */
  relinked: string[]
  commit: string | null
}

/**
 * 文件夹改名：挪过去，库里写着旧路径的相对链接、带路径的双链、置顶、左栏都换成新路径，一次提交。
 * moved：里面每个文件挪了（读 PDF 记在本机的进度和会话跟着换）。
 */
export async function renameFolder(v: Vault, folder: unknown, name: unknown, moved?: (from: string, to: string) => void): Promise<RenameResult> {
  const from = needFolder(folder)
  if (typeof name !== 'string') throw new Error('名字不对')
  if (fixedFolder(from)) throw new Error(`「${from}」是固定的文件夹，不改名`)
  const bad = checkFolderName(name)
  if (bad) throw new Error(bad)
  const to = join2(parentOf(from), name.trim())
  if (to === from) return { to, relinked: [], commit: null }
  // 只改大小写（ecp → ECP）在 Mac 上是同一个文件夹，不算重名
  if (to.toLowerCase() !== from.toLowerCase() && (await exists(v.abs(to)))) throw new Error(`已经有「${name.trim()}」了`)
  return relocate(v, from, to, `文件夹改名：${from} → ${to}`, moved)
}

/** 文件夹挪进另一个文件夹（右键「移到 ›」；parent 是 '' 挪到库的最外层）：链接、置顶、左栏一起换，一次提交 */
export async function moveFolder(v: Vault, folder: unknown, parent: unknown, moved?: (from: string, to: string) => void): Promise<RenameResult> {
  const from = needFolder(folder)
  if (typeof parent !== 'string') throw new Error('文件夹不对')
  if (parent) needFolder(parent)
  if (fixedFolder(from)) throw new Error(`「${from}」是固定的文件夹，不挪`)
  if (parent === from || parent.startsWith(from + '/')) throw new Error('不能挪进它自己里面')
  const to = join2(parent, from.split('/').pop()!)
  if (to === from) return { to, relinked: [], commit: null }
  if (await exists(v.abs(to))) throw new Error(`「${parent || '库的最外层'}」里已经有「${from.split('/').pop()}」了`)
  return relocate(v, from, to, `移动文件夹：${from} → ${to}`, moved)
}

async function relocate(v: Vault, from: string, to: string, message: string, moved?: (from: string, to: string) => void): Promise<RenameResult> {
  if (!(await stat(v.abs(from)).catch(() => null))?.isDirectory()) throw new Error(`没有这个文件夹：${from}`)

  // 里面笔记的附件按笔记路径放在 附件/<文件夹>/…：一起挪，链接一起换
  const attFrom = `${ATTACHMENTS_DIR}/${from}`
  const attTo = `${ATTACHMENTS_DIR}/${to}`
  const inner = folderMap(from, to)
  const att = folderMap(attFrom, attTo)
  let attOk = false
  const map = (p: string) => inner(p) ?? (attOk ? att(p) : null)
  const seg = from.split('/').pop()!
  const mentions = (t: string) => t.includes(seg) || t.includes(seg.replace(/ /g, '%20')) || t.includes(encodeURI(seg))
  const under = (p: string, d: string) => p === d || p.startsWith(d + '/')
  const inFolder = (p: string) => [from, to, attFrom, attTo].some((d) => under(p, d))
  // 先把会碰到的笔记里没提交的字提交掉：提到旧文件夹名的、文件夹里的、置顶
  const before = await allMd(v)
  const candidates = new Set<string>()
  for (const p of before) if (inFolder(p) || mentions(decodeNote(await readFile(v.abs(p))).text)) candidates.add(p)
  await commitPendingUnder(v.root, (p) => inFolder(p) || candidates.has(p) || p === PINS_FILE || p === LEFT_FILE)

  const files: string[] = []
  const walk = async (dir: string) => {
    for (const e of await readdir(v.abs(dir), { withFileTypes: true })) {
      if (e.isDirectory()) await walk(`${dir}/${e.name}`)
      else files.push(`${dir}/${e.name}`)
    }
  }
  await walk(from)
  await rename(v.abs(from), v.abs(to))
  const attMoved = (await stat(v.abs(attFrom)).catch(() => null))?.isDirectory() && !(await exists(v.abs(attTo)))
  if (attMoved) {
    attOk = true
    await mkdir(v.abs(parentOf(attTo) || ATTACHMENTS_DIR), { recursive: true })
    await rename(v.abs(attFrom), v.abs(attTo))
  }
  v.movedFolder(from, to)
  for (const f of files) moved?.(f, map(f)!)

  const relinked: string[] = []
  for (const oldPath of candidates) {
    const newPath = map(oldPath) ?? oldPath
    const bytes = await readFile(v.abs(newPath))
    const { text, meta } = decodeNote(bytes)
    if (meta.readOnly) continue
    const next = remapLinks(text, oldPath, newPath, map)
    if (next === text) continue
    await writeFile(v.abs(newPath), encodeNote(next, meta))
    relinked.push(newPath)
  }
  await repinAll(v, (p) => map(p) ?? undefined)
  await relookAll(v, (p) => inner(p) ?? undefined)
  const touched = new Set(relinked)
  const commit = await commitTouched(v.root, (p) => inFolder(p) || touched.has(p) || p === PINS_FILE || p === LEFT_FILE, message)
  return { to, relinked, commit }
}

/**
 * 文件夹移到废纸篓（put：真的挪进废纸篓，测试换成临时文件夹），里面的置顶拿掉，一次提交。
 * 返回挪走了几个文件。
 */
export async function trashFolder(v: Vault, folder: unknown, put: (abs: string) => Promise<void>): Promise<number> {
  const f = needFolder(folder)
  if (fixedFolder(f)) throw new Error(`「${f}」是固定的文件夹，不能删`)
  const n = await countFiles(v, f)
  const inside = (p: string) => p === f || p.startsWith(f + '/')
  await commitPendingUnder(v.root, (p) => inside(p) || p === PINS_FILE || p === LEFT_FILE)
  await put(v.abs(f))
  await repinAll(v, (p) => (inside(p) ? null : undefined))
  await relookAll(v, (p) => (inside(p) ? null : undefined))
  await commitTouched(v.root, (p) => inside(p) || p === PINS_FILE || p === LEFT_FILE, `移到废纸篓：${f}（${n} 个文件）`)
  return n
}

/** 测试用的「废纸篓」：挪进那个文件夹，不往用户真的废纸篓里放 */
export const testTrash = (dir: string) => async (abs: string) => {
  await rename(abs, join(dir, `${Date.now()}-${abs.split('/').pop()}`))
}
