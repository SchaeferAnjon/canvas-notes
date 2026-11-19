/**
 * 历史里把删掉的文件放回来（CN-108 方向 A「放回文件」）：只把那次提交删掉、现在又不在的文件从那次的前一版取回原处，
 * 单独提交一次「放回：…」；不碰那之后的任何改动，所以删完又改过左栏、建过别的文件夹也照样放得回（整次撤回在那种时候会冲突）。
 *
 * - 「现在又不在」：同一个文件夹里没有一样内容的文件（按 Git 的 blob 比）。放回过的不再算；原处已经有一篇同名的（内容不同）也能放回，放成「名字 2」。
 * - 放回整次时，那次一起删掉的软件自己的文件（文件夹的 .首页.json、.gitkeep）跟着回来，不单独列；左栏位置、置顶只加回那次被拿掉的那一项，不整份回滚。
 * - 撤回「放回」：再做一次反向提交（git revert），又回到删掉的样子。
 */
import * as git from '@cn/git'
import { ipcMain } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { type LeftConfig, leftJson, LEFT_FILE, normalizeLeft } from '../shared/left'
import { normalizePins, pinsJson, PINS_FILE } from '../shared/sidebar'
import type { RestoreResult } from '../shared/api'
import { blob } from './diff'
import type { Vault } from './vault'

const HASH = /^[0-9a-f]{7,40}$/
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
const exists = (p: string) => stat(p).then(() => true, () => false)

/** 那次提交删掉的文件（挪走的不算：git 认得出改名）；第一次提交没有父提交，什么都没删 */
async function deletedIn(root: string, hash: string): Promise<string[]> {
  const parents = (await git.git(root, ['rev-list', '--parents', '-n', '1', hash])).trim().split(' ').slice(1)
  if (!parents.length) return []
  const out = await git.git(root, ['-c', 'core.quotepath=false', 'diff', '--name-only', '-z', '-M', '--diff-filter=D', `${hash}^`, hash])
  return out.split('\0').filter(Boolean)
}

/** 那次之前的版本里这几个文件的 blob */
async function blobsBefore(root: string, hash: string, paths: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (!paths.length) return m
  const out = await git.git(root, ['-c', 'core.quotepath=false', 'ls-tree', '-r', '-z', `${hash}^`, '--', ...paths])
  for (const rec of out.split('\0')) {
    const tab = rec.indexOf('\t')
    if (tab < 0) continue
    const [, type, sha] = rec.slice(0, tab).split(' ')
    if (type === 'blob' && sha) m.set(rec.slice(tab + 1), sha)
  }
  return m
}

/** 现在每个文件夹里有哪些内容（「文件夹\0blob」）：放回过的、放成「名字 2」的都认得出 */
async function contentNow(root: string): Promise<Set<string>> {
  const out = await git.git(root, ['-c', 'core.quotepath=false', 'ls-files', '-s', '-z'])
  const s = new Set<string>()
  for (const rec of out.split('\0')) {
    const tab = rec.indexOf('\t')
    if (tab < 0) continue
    const sha = rec.slice(0, tab).split(' ')[1]
    if (sha) s.add(`${dirOf(rec.slice(tab + 1))}\0${sha}`)
  }
  return s
}

interface Plan {
  /** 那次删掉的用户文件（不算软件自己的） */
  deleted: string[]
  /** 其中现在还能放回的 */
  available: string[]
  /** 那次一起删掉、现在不在的软件自己的文件（.首页.json、.gitkeep；.canvas-notes 里的不在这里，按项加回） */
  internal: string[]
  blobs: Map<string, string>
}

async function plan(v: Vault, hash: string): Promise<Plan> {
  if (typeof hash !== 'string' || !HASH.test(hash)) throw new Error('提交号不对')
  const all = await deletedIn(v.root, hash)
  const blobs = await blobsBefore(v.root, hash, all)
  const now = await contentNow(v.root)
  const gone = (p: string) => !now.has(`${dirOf(p)}\0${blobs.get(p) ?? ''}`)
  const deleted = all.filter((p) => !git.isInternalPath(p))
  const available = deleted.filter(gone)
  const internal: string[] = []
  for (const p of all) if (git.isInternalPath(p) && !p.startsWith('.canvas-notes/') && !(await exists(v.abs(p)))) internal.push(p)
  return { deleted, available, internal, blobs }
}

/** 右键时问：那次删了哪些（用户的）文件、哪些现在还能放回 */
export async function restorable(v: Vault, hash: string): Promise<{ deleted: string[]; available: string[] }> {
  const p = await plan(v, hash)
  return { deleted: p.deleted, available: p.available }
}

/** 原处有文件时放成「名字 2」「名字 3」 */
async function freeTarget(v: Vault, p: string, taken: Set<string>): Promise<string> {
  if (!taken.has(p) && !(await exists(v.abs(p)))) return p
  const dot = p.lastIndexOf('.')
  const cut = dot > p.lastIndexOf('/') + 1 ? dot : p.length
  for (let n = 2; ; n++) {
    const t = `${p.slice(0, cut)} ${n}${p.slice(cut)}`
    if (!taken.has(t) && !(await exists(v.abs(t)))) return t
  }
}

async function showText(root: string, rev: string, path: string): Promise<string | null> {
  const b = await blob(root, rev, path)
  return b ? b.toString('utf8') : null
}

/** 左栏：那次被拿掉、这回放回的文件夹，加回原来的位置（图标和颜色一起） */
async function leftBack(v: Vault, hash: string, folders: Set<string>): Promise<boolean> {
  if (!folders.size) return false
  const [before, after] = await Promise.all([showText(v.root, `${hash}^`, LEFT_FILE), showText(v.root, hash, LEFT_FILE)])
  if (before === null) return false
  const was = normalizeLeft(JSON.parse(before))
  const then = normalizeLeft(after === null ? null : JSON.parse(after))
  const cur = normalizeLeft(await readFile(v.abs(LEFT_FILE), 'utf8').then((t) => JSON.parse(t) as unknown, () => null))
  const next: LeftConfig = { left: [...cur.left], looks: { ...cur.looks } }
  was.left.forEach((f, i) => {
    if (!folders.has(f) || then.left.includes(f) || next.left.includes(f)) return
    next.left.splice(Math.min(i, next.left.length), 0, f)
  })
  for (const [f, look] of Object.entries(was.looks)) if (folders.has(f) && !then.looks[f] && !next.looks[f]) next.looks[f] = look
  if (leftJson(next) === leftJson(cur)) return false
  await mkdir(dirname(v.abs(LEFT_FILE)), { recursive: true })
  await writeFile(v.abs(LEFT_FILE), leftJson(next))
  return true
}

/** 置顶：那次被拿掉、这回放回的（原名放回的文件，整个放回的文件夹「写作/」），加回原来的位置 */
async function pinsBack(v: Vault, hash: string, keys: Set<string>): Promise<boolean> {
  if (!keys.size) return false
  const [before, after] = await Promise.all([showText(v.root, `${hash}^`, PINS_FILE), showText(v.root, hash, PINS_FILE)])
  if (before === null) return false
  const was = normalizePins(JSON.parse(before))
  const then = normalizePins(after === null ? [] : JSON.parse(after))
  const cur = normalizePins(await readFile(v.abs(PINS_FILE), 'utf8').then((t) => JSON.parse(t) as unknown, () => []))
  const next = [...cur]
  was.forEach((p, i) => {
    if (!keys.has(p) || then.includes(p) || next.includes(p)) return
    next.splice(Math.min(i, next.length), 0, p)
  })
  if (next.join('\n') === cur.join('\n')) return false
  await mkdir(dirname(v.abs(PINS_FILE)), { recursive: true })
  await writeFile(v.abs(PINS_FILE), pinsJson(next))
  return true
}

/** 一串路径共同的文件夹（「课程/ecp」）；没有共同的是 '' */
function commonDir(paths: string[]): string {
  let d = dirOf(paths[0]!)
  for (const p of paths.slice(1)) while (d && !(p === d || p.startsWith(d + '/'))) d = dirOf(d)
  return d
}

/** 放回：only 不给 = 那次删掉、还能放回的全部；给了 = 只放这几篇（「放回这一篇」） */
export async function restoreDeleted(v: Vault, hash: string, only?: string[]): Promise<RestoreResult> {
  if (only !== undefined && (!Array.isArray(only) || only.some((p) => typeof p !== 'string'))) throw new Error('要放回的文件不对')
  const pl = await plan(v, hash)
  const pick = only ? pl.available.filter((p) => only.includes(p)) : pl.available
  if (!pick.length) throw new Error(pl.deleted.length ? '删掉的都已经放回来了' : '这次提交没有删掉文件')
  // 左栏、置顶里用户还没提交的改动先单独提交：「放回」那次只有放回这一步，撤回不带走别的
  const pending = (await git.status(v.root)).filter((s) => s.path === LEFT_FILE || s.path === PINS_FILE)
  if (pending.length) await git.commitPaths(v.root, pending.map((s) => s.path), git.describeChanges(pending))

  const taken = new Set<string>()
  const files: RestoreResult['files'] = []
  for (const from of pick) {
    const to = await freeTarget(v, from, taken)
    taken.add(to)
    const b = await blob(v.root, `${hash}^`, from)
    if (!b) throw new Error(`那次提交之前没有 ${from}`)
    await mkdir(dirname(v.abs(to)), { recursive: true })
    await writeFile(v.abs(to), b)
    files.push({ from, to })
  }
  // 整次放回：文件夹自己的首页设置、.gitkeep 跟着回来（不列出来）
  const extra: string[] = []
  if (!only)
    for (const p of pl.internal) {
      const b = await blob(v.root, `${hash}^`, p)
      if (!b) continue
      await mkdir(dirname(v.abs(p)), { recursive: true })
      await writeFile(v.abs(p), b)
      extra.push(p)
    }
  // 原名放回的才加回左栏位置和置顶（放成「名字 2」的是另一篇了）
  const same = files.filter((f) => f.from === f.to).map((f) => f.to)
  const folders = new Set<string>()
  if (!only) for (const p of [...same, ...extra]) for (let d = dirOf(p); d; d = dirOf(d)) folders.add(d)
  const touched: string[] = []
  if (await leftBack(v, hash, folders)) touched.push(LEFT_FILE)
  if (await pinsBack(v, hash, new Set([...same, ...[...folders].map((f) => f + '/')]))) touched.push(PINS_FILE)

  const targets = files.map((f) => f.to)
  const folder = targets.length > 1 ? commonDir(targets) : null
  const message = targets.length === 1 ? `放回：${targets[0]}` : `放回：${folder || '库的最外层'}（${targets.length} 个文件）`
  const commit = await git.commitPaths(v.root, [...targets, ...extra, ...touched], message)
  if (!commit) throw new Error('放回的文件没提交上')
  return { commit, files, folder }
}

/** 撤回「放回」：反向提交一次，文件又回到删掉的样子 */
export async function undoRestore(v: Vault, commit: string): Promise<void> {
  if (typeof commit !== 'string' || !HASH.test(commit)) throw new Error('提交号不对')
  await git.revert(v.root, commit)
}

export function registerRestore(getVault: () => Vault, changed: () => void) {
  ipcMain.handle('git:restorable', (_e, hash: unknown) => restorable(getVault(), hash as string))
  ipcMain.handle('git:restore', async (_e, hash: unknown, only?: unknown) => {
    const r = await restoreDeleted(getVault(), hash as string, only as string[] | undefined)
    changed()
    return r
  })
  ipcMain.handle('git:restore-undo', async (_e, commit: unknown) => {
    await undoRestore(getVault(), commit as string)
    changed()
  })
}
