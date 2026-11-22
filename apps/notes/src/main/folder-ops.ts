/**
 * 库里的文件夹：新建（放一个看不见的 .gitkeep，Git 才记得住空文件夹）、改名（库里写着旧路径的链接、置顶一起改）、
 * 移到废纸篓。每样做完就是一次提交，历史里能撤回。
 *
 * 空文件夹为什么能在目录树里看到：主进程列文件时本来就把文件夹也列出来（main/files.ts），
 * .gitkeep 只是给 Git 的：没有它，空文件夹不进提交，换台电脑就没了。
 */
import * as git from '@cn/git'
import { ATTACHMENTS_DIR, baseFoldersIn, decodeNote, encodeNote, folderMap, remapLinks } from '@cn/format'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkFolderName } from '../shared/folder-home'
import { baseOwner, fixedFolder } from '../shared/files'
import { PINS_FILE } from '../shared/sidebar'
import { LEFT_FILE } from '../shared/left'
import { relookAll } from './left'
import { repin, repinAll } from './pins'
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
export async function commitPendingUnder(root: string, inside: (p: string) => boolean) {
  const pending = (await git.status(root)).filter((s) => inside(s.path))
  if (pending.length) await git.commitPaths(root, pending.map((s) => s.path), git.describeChanges(pending))
}

/** 提交这一步碰过的路径（用 status 里真有的路径，删掉的、新建的都在） */
export async function commitTouched(root: string, inside: (p: string) => boolean, message: string): Promise<string | null> {
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

/** 文件夹挪进另一个文件夹（右键「移到 ›」；parent 是 '' 挪到最外层）：链接、置顶、左栏一起换，一次提交 */
export async function moveFolder(v: Vault, folder: unknown, parent: unknown, moved?: (from: string, to: string) => void): Promise<RenameResult> {
  const from = needFolder(folder)
  if (typeof parent !== 'string') throw new Error('文件夹不对')
  if (parent) needFolder(parent)
  if (fixedFolder(from)) throw new Error(`「${from}」是固定的文件夹，不挪`)
  if (parent === from || parent.startsWith(from + '/')) throw new Error('不能挪进它自己里面')
  const to = join2(parent, from.split('/').pop()!)
  if (to === from) return { to, relinked: [], commit: null }
  if (await exists(v.abs(to))) throw new Error(`「${parent || v.name}」里已经有「${from.split('/').pop()}」了`)
  return relocate(v, from, to, `移动文件夹：${from} → ${to}`, moved)
}

async function relocate(v: Vault, from: string, to: string, message: string, moved?: (from: string, to: string) => void): Promise<RenameResult> {
  const plan = await planRelocate(v, from, to)
  // 先把会碰到的笔记里没提交的字提交掉：提到旧文件夹名的、文件夹里的、置顶
  await commitPendingUnder(v.root, plan.touches)
  const relinked = await relocateNow(v, plan, moved)
  const touched = new Set(relinked)
  const commit = await commitTouched(v.root, (p) => plan.inFolder(p) || touched.has(p) || p === PINS_FILE || p === LEFT_FILE, message)
  return { to, relinked, commit }
}

/** 挪一个文件夹要碰到哪些：文件夹里的、它的附件文件夹、提到它名字的笔记、置顶、左栏 */
export interface RelocatePlan {
  from: string
  to: string
  inFolder(p: string): boolean
  /** 会被改到的路径（挪之前先把这些上面没提交的字提交掉） */
  touches(p: string): boolean
  candidates: Set<string>
}

export async function planRelocate(v: Vault, from: string, to: string): Promise<RelocatePlan> {
  if (!(await stat(v.abs(from)).catch(() => null))?.isDirectory()) throw new Error(`没有这个文件夹：${from}`)
  const attFrom = `${ATTACHMENTS_DIR}/${from}`
  const attTo = `${ATTACHMENTS_DIR}/${to}`
  const seg = from.split('/').pop()!
  const mentions = (t: string) => t.includes(seg) || t.includes(seg.replace(/ /g, '%20')) || t.includes(encodeURI(seg))
  const under = (p: string, d: string) => p === d || p.startsWith(d + '/')
  const inFolder = (p: string) => [from, to, attFrom, attTo].some((d) => under(p, d))
  const candidates = new Set<string>()
  for (const p of await allMd(v)) if (inFolder(p) || mentions(decodeNote(await readFile(v.abs(p))).text)) candidates.add(p)
  return { from, to, inFolder, candidates, touches: (p) => inFolder(p) || candidates.has(p) || p === PINS_FILE || p === LEFT_FILE }
}

/**
 * 挪过去：文件夹和它的附件文件夹（附件/<文件夹>/…）一起挪，库里写着旧路径的相对链接、带路径的双链、置顶、左栏跟着换。
 * 不提交（调的人自己提交）；返回改了链接的笔记（新路径）
 */
export async function relocateNow(v: Vault, plan: RelocatePlan, moved?: (from: string, to: string) => void): Promise<string[]> {
  const { from, to, candidates } = plan
  const attFrom = `${ATTACHMENTS_DIR}/${from}`
  const attTo = `${ATTACHMENTS_DIR}/${to}`
  const inner = folderMap(from, to)
  const att = folderMap(attFrom, attTo)
  let attOk = false
  const map = (p: string) => inner(p) ?? (attOk ? att(p) : null)

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
  return relinked
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

/**
 * PDF、HTML、图片这些（不是笔记、不是文件夹）移到废纸篓，当场单独一次提交（「删除 N 个文件：…」，历史里能撤回）。
 * 不当场提交的话，删除挂在工作区里，会被下一次随便什么提交顺带进去（0.4.4 被扫进了 AI 那次提交，task-1df7j）。
 * 删之前这几个文件上没提交的（刚粘进来还没提交的图）先提交，历史里放回来的是删之前的样子。
 * 返回删除那次的提交号；都没进过 Git 时没有
 */
export async function trashFiles(v: Vault, paths: unknown, put: (abs: string) => Promise<void>): Promise<string | null> {
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string' || /\.md$/i.test(p))) throw new Error('要删的不对')
  const list = [...new Set(paths as string[])]
  for (const p of list) if (!(await stat(v.abs(p))).isFile()) throw new Error(`不是文件：${p}`)
  const these = new Set(list)
  const touched = (p: string) => these.has(p) || p === PINS_FILE
  await commitPendingUnder(v.root, touched)
  for (const p of list) {
    await put(v.abs(p))
    await repin(v, p, null)
  }
  const gone = (await git.status(v.root)).filter((s) => touched(s.path))
  return git.commitPaths(v.root, gone.map((s) => s.path), git.describeChanges(gone))
}

/** 测试用的「废纸篓」：挪进那个文件夹，不往用户真的废纸篓里放（同名的几个一起删不互相盖掉） */
export const testTrash = (dir: string) => async (abs: string) => {
  await rename(abs, join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${abs.split('/').pop()}`))
}

/**
 * 文件树里选了好几个，一起挪进一个文件夹（CN-105）：笔记（md）连它的附件文件夹（和挂在它下面的数据库记录文件夹）、文件夹连它里面的和附件一起挪，
 * 库里别的笔记里指向它们的相对链接、置顶、左栏跟着改，一次提交。选了的东西在另一个选了的文件夹里面时只挪外面那个。
 * PDF、HTML 和单个右键一样不挪（返回 skipped）。返回每个挪了的（旧 → 新）
 */
export async function moveMany(v: Vault, paths: unknown, folder: unknown, moved?: (from: string, to: string) => void): Promise<{ moves: Moved[]; skipped: string[]; commit: string | null }> {
  const plan = await planMoveMany(v, paths, folder)
  if (!plan.dirs.length && !plan.notes.length) return { moves: [], skipped: plan.skipped, commit: null }
  // 会被改到的：挪的这些（和它们的附件文件夹）、提到它们名字的笔记、置顶、左栏；先把上面没提交的字提交掉
  await commitPendingUnder(v.root, plan.touches)
  const { moves, touched } = await moveManyNow(v, plan, moved)
  const own = moves.filter((m) => !m.with)
  const names = own.map((m) => m.from.split('/').pop()!.replace(/\.md$/i, ''))
  const carried = moves.filter((m) => m.with).map((m) => m.from.split('/').pop()!)
  const commit = await commitTouched(
    v.root,
    touched,
    `移动 ${own.length} 个：${names.slice(0, 5).join('、')}${names.length > 5 ? ' 等' : ''} → ${plan.folder || v.name}${carried.length ? `（${own.length > 1 ? '它们' : '它'}的数据库跟着挪：${carried.join('、')}）` : ''}`,
  )
  return { moves, skipped: plan.skipped, commit }
}

/** 挪了的一样：from → to；with 是跟着哪篇（挪到的新路径）一起挪的数据库记录文件夹 */
export interface Moved {
  from: string
  to: string
  with?: string
}

/**
 * 挂在这篇下面的数据库记录文件夹（task-5yp97「藏之后」）：挪这篇时跟着挪。照目录树的规矩（shared/files 的 baseOwner）：
 * 这篇的 ```base 用它、它就在这篇旁边、旁边用它的几篇里这篇名字排最前；最外层固定的分类不算。读磁盘上现在的字（刚改过名的也认得）
 */
export async function hungFolders(v: Vault, note: string): Promise<string[]> {
  const dir = parentOf(note)
  const ok = (f: string) => parentOf(f) === dir && f.split('/').every((s) => s && s !== '.' && s !== '..') && !fixedFolder(f)
  const mine = baseFoldersIn(decodeNote(await readFile(v.abs(note))).text).filter(ok)
  if (!mine.length) return []
  const users = new Map<string, string[]>()
  for (const e of await readdir(dir ? v.abs(dir) : v.root, { withFileTypes: true })) {
    if (!e.isFile() || !/\.md$/i.test(e.name)) continue
    const p = join2(dir, e.name)
    const text = decodeNote(await readFile(v.abs(p))).text
    if (!text.includes('```base')) continue
    for (const f of baseFoldersIn(text)) if (mine.includes(f)) users.set(f, [...(users.get(f) ?? []), p])
  }
  const out: string[] = []
  for (const f of mine) if (baseOwner(f, users.get(f) ?? []) === note && (await stat(v.abs(f)).catch(() => null))?.isDirectory()) out.push(f)
  return out
}

/** 好几个一起挪的打算：挪哪些文件夹、哪几篇笔记，会碰到哪些路径（挪之前先提交这些上面没提交的字） */
export interface MovePlan {
  folder: string
  dirs: string[]
  notes: string[]
  /** 挂在挪的笔记下面的数据库记录文件夹：跟着那篇挪（那里有同名的换成「库 2」） */
  carry: { from: string; to: string; note: string }[]
  skipped: string[]
  candidates: Set<string>
  touches(p: string): boolean
}

export async function planMoveMany(v: Vault, paths: unknown, folder: unknown): Promise<MovePlan> {
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string')) throw new Error('要挪的不对')
  if (typeof folder !== 'string') throw new Error('文件夹不对')
  if (folder) needFolder(folder)
  const list = [...new Set(paths as string[])]
  for (const p of list) v.abs(p)
  const inside = (p: string, d: string) => p.startsWith(d + '/')
  const top = list.filter((p) => !list.some((d) => d !== p && inside(p, d)))
  const dirs: string[] = []
  const notes: string[] = []
  const skipped: string[] = []
  for (const p of top) {
    const st = await stat(v.abs(p)).catch(() => null)
    if (!st) continue
    if (st.isDirectory()) {
      if (fixedFolder(p)) throw new Error(`「${p}」是固定的文件夹，不挪`)
      if (folder === p || inside(folder, p)) throw new Error(`不能把「${p.split('/').pop()}」挪进它自己里面`)
      if (parentOf(p) !== folder) dirs.push(p)
    } else if (/\.md$/i.test(p)) {
      if (parentOf(p) !== folder) notes.push(p)
    } else skipped.push(p)
  }
  for (const d of dirs) if (await exists(v.abs(join2(folder, d.split('/').pop()!)))) throw new Error(`「${folder || v.name}」里已经有「${d.split('/').pop()}」了`)
  // 挂在笔记下面的数据库记录文件夹跟着那篇走（目录树里它就在那篇下面）：自己也选了的照文件夹挪
  const taken = new Set(dirs.map((d) => join2(folder, d.split('/').pop()!)))
  const carry = await carryTargets(v, notes, () => folder, (f) => dirs.some((d) => f === d || inside(f, d)), taken)
  const stems = [...notes.map((p) => fileStem(p)), ...[...dirs, ...carry.map((c) => c.from)].map((d) => d.split('/').pop()!)]
  const mentions = (t: string) => stems.some((s) => t.includes(s) || t.includes(s.replace(/ /g, '%20')) || t.includes(encodeURI(s)))
  const under = (p: string, d: string) => p === d || p.startsWith(d + '/')
  const olds = oldPaths(notes, dirs, carry)
  const candidates = new Set<string>()
  if (dirs.length || notes.length) for (const p of await allMd(v)) if (olds.some((d) => under(p, d)) || mentions(decodeNote(await readFile(v.abs(p))).text)) candidates.add(p)
  return { folder, dirs, notes, carry, skipped, candidates, touches: (p) => olds.some((d) => under(p, d)) || candidates.has(p) || p === PINS_FILE || p === LEFT_FILE }
}

/**
 * 挂在这几篇下面的记录文件夹要挪去哪（folderOf：那篇要挪进的文件夹）。挪进它自己里面的不带（那篇成了其中一条）；skip 的不带（自己也选了，照文件夹挪）；
 * 那里已经有同名的不报错，换成「库 2」（不因为重名挪不了那篇）；taken 是这一次里别的已经要用的名字
 */
async function carryTargets(v: Vault, notes: string[], folderOf: (note: string) => string, skip: (f: string) => boolean, taken: Set<string>): Promise<MovePlan['carry']> {
  const out: MovePlan['carry'] = []
  for (const note of notes) {
    const folder = folderOf(note)
    for (const f of await hungFolders(v, note)) {
      if (skip(f) || folder === f || folder.startsWith(f + '/')) continue
      const name = f.split('/').pop()!
      let to = join2(folder, name)
      for (let n = 2; taken.has(to) || (await exists(v.abs(to))); n++) to = join2(folder, `${name} ${n}`)
      taken.add(to)
      out.push({ from: f, to, note })
    }
  }
  return out
}

/** 跟着那篇挪的记录文件夹挪过去（那篇已经挪好了，这时再查谁提到它）：附件文件夹跟着，数据库块里的路径、指向里面的链接改好；不提交 */
async function relocateCarried(v: Vault, c: { from: string; to: string }, moved?: (from: string, to: string) => void): Promise<{ relinked: string[]; inFolder(p: string): boolean }> {
  const plan = await planRelocate(v, c.from, c.to)
  return { relinked: await relocateNow(v, plan, moved), inFolder: plan.inFolder }
}

/**
 * AI 改动里挪的几篇（收件箱整理那两条命令，main/index.ts 的 ai:change，用的是 vault.move）：挂在它们下面的记录文件夹也跟着挪，
 * 和文件树里挪同一条规矩。挪之前调：touches 是挪之前要先把用户的字提交掉的路径。那几篇都挪好以后调 run（和 moveManyNow 一样先挪笔记：
 * 单点名挪走的记录先走，文件夹再带着剩下的），返回要进这次提交的路径（旧的、新的、改了数据库块的）
 */
export async function planCarry(v: Vault, moves: { from: string; toFolder: string }[]): Promise<{ touches(p: string): boolean; run(moved?: (from: string, to: string) => void): Promise<string[]> }> {
  const dest = new Map(moves.map((m) => [m.from, m.toFolder]))
  const carry = await carryTargets(v, [...dest.keys()], (n) => dest.get(n)!, () => false, new Set())
  const pre = await Promise.all(carry.map((c) => planRelocate(v, c.from, c.to)))
  return {
    touches: (p) => pre.some((x) => x.touches(p)),
    async run(moved) {
      const out: string[] = []
      for (const c of carry) {
        const r = await relocateCarried(v, c, moved)
        out.push(...(await git.status(v.root)).filter((x) => r.inFolder(x.path)).map((x) => x.path), ...r.relinked)
      }
      return out
    },
  }
}

/** 挪之前的路径：笔记和它们的附件文件夹、文件夹（连跟着挪的记录文件夹）和它们的附件文件夹 */
const oldPaths = (notes: string[], dirs: string[], carry: MovePlan['carry']) => {
  const ds = [...dirs, ...carry.map((c) => c.from)]
  return [...notes, ...notes.map((p) => `${ATTACHMENTS_DIR}/${p.replace(/\.md$/i, '')}`), ...ds, ...ds.map((d) => `${ATTACHMENTS_DIR}/${d}`)]
}

/**
 * 照打算挪（不提交）：文件夹整个挪（附件文件夹跟着），笔记用 vault.move（附件文件夹、它自己的链接跟着），
 * 别的笔记里指向它们的相对链接改好。返回挪了哪些、这一步碰过哪些路径（提交用）
 */
export async function moveManyNow(v: Vault, plan: MovePlan, moved?: (from: string, to: string) => void): Promise<{ moves: Moved[]; touched(p: string): boolean }> {
  const { folder, dirs, notes, carry, candidates } = plan
  const under = (p: string, d: string) => p === d || p.startsWith(d + '/')
  const olds = oldPaths(notes, dirs, carry)
  const moves: Moved[] = []
  const touched = new Set<string>()
  for (const d of dirs) {
    const plan = await planRelocate(v, d, join2(folder, d.split('/').pop()!))
    for (const r of await relocateNow(v, plan, moved)) touched.add(r)
    moves.push({ from: d, to: plan.to })
  }
  // 挪过的文件夹里的笔记现在在新地方：后面按新路径读
  const remap = (p: string) => {
    for (const m of moves) if (under(p, m.from)) return m.to + p.slice(m.from.length)
    return p
  }
  for (const p of notes) {
    const to = await v.move(remap(p), folder)
    await repin(v, remap(p), to)
    moved?.(p, to)
    moves.push({ from: p, to })
  }
  // 跟着笔记挪的记录文件夹：整个挪（附件文件夹跟着），数据库块里的路径、指向里面的链接改好；排在笔记后面（moves[0] 还是挪的那一样）
  for (const c of carry) {
    for (const r of (await relocateCarried(v, c, moved)).relinked) touched.add(r)
    moves.push({ from: c.from, to: c.to, with: moves.find((m) => m.from === c.note)?.to ?? c.note })
  }
  // 别的笔记里指向挪走的笔记、它们的附件的相对链接：按新位置改（挪走的笔记自己的链接 vault.move 改过了）
  const noteMoves = moves.filter((m) => /\.md$/i.test(m.from))
  const map = (p: string): string | null => {
    for (const m of noteMoves) {
      if (p === m.from) return m.to
      const af = `${ATTACHMENTS_DIR}/${m.from.replace(/\.md$/i, '')}`
      if (under(p, af)) return `${ATTACHMENTS_DIR}/${m.to.replace(/\.md$/i, '')}` + p.slice(af.length)
    }
    return null
  }
  const movedNow = new Set(noteMoves.map((m) => m.to))
  for (const c of candidates) {
    const now = remap(c)
    if (movedNow.has(now) || noteMoves.some((m) => m.from === c)) continue
    const bytes = await readFile(v.abs(now)).catch(() => null)
    if (!bytes) continue
    const { text, meta } = decodeNote(bytes)
    if (meta.readOnly) continue
    const next = remapLinks(text, now, now, map)
    if (next === text) continue
    await writeFile(v.abs(now), encodeNote(next, meta))
    touched.add(now)
  }
  const news = moves.flatMap((m) => [m.to, `${ATTACHMENTS_DIR}/${m.to.replace(/\.md$/i, '')}`])
  return { moves, touched: (p) => olds.some((d) => under(p, d)) || news.some((d) => under(p, d)) || touched.has(p) || p === PINS_FILE || p === LEFT_FILE }
}

const fileStem = (p: string) => p.split('/').pop()!.replace(/\.md$/i, '')
