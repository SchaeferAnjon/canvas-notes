/**
 * 「没人用的附件」（2026-11-23 附件跟着笔记走）：以前删笔记、删文件夹时附件没跟着走，留在 附件/ 里没人用。
 * 「最近删掉的」左栏列一组，按原来属于哪篇分组、带缩略图，用户点一下一起移到废纸篓（一次提交、底栏撤回），不自动删。
 *
 * 「没人用」宁可少列不可误列，下面任何一条认得出就算有人用：
 * - 归一篇还在的：附件/<路径>/ 的某一层对得上库里的 <路径>.md 或 <路径> 这个文件（PDF 的截图在 附件/<PDF>/）；
 * - 它在的文件夹和库里哪个用户自己的文件同名（iPad 手写存在 附件/手写/<文档名>/，按名字不按路径）；
 * - 库里任何一个文字文件（md、白板、JSON、HTML、软件自己的 .canvas-notes/ 里的，附件/ 里的也算）提到它：
 *   md 链接、[[嵌入]]、HTML 的 src、属性里的封面、写坏了的链接按名字认（format 的 fileRefs / refHits）；
 * - 首页和文件夹的封面（附件/封面/）、网页里下载下来的（附件/下载/，本来就没有哪篇用，清理没用到的附件也当拿不准）不列；
 *   不算附件的（@cn/format 的 isAppFile：. 开头的、白板笔迹 附件/<白板>/笔迹.ink）不列。
 * 原来属于哪篇：附件/<路径>/ 对得上 Git 历史里删掉的 <路径>.md 就是它；对不上的看最近删掉的笔记里谁链着这组图。
 */
import * as git from '@cn/git'
import { ATTACHMENTS_DIR, attachOwner, decodeNote, fileNameIndex, fileRefs, isAppFile, linkedPaths, refHits } from '@cn/format'
import { ipcMain, shell } from 'electron'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { OrphanGroup } from '../shared/attach'
import { COVER_DIR } from '../shared/home'
import { commitPendingUnder, commitTouched, testTrash } from './folder-ops'
import { putAttachments } from './note-attach'
import { blobsAt, catBlobs } from './trash-recent'
import type { Vault } from './vault'

const SKIP = new Set(['.git', 'node_modules', '.trash', '.DS_Store'])
/** 读来找引用的文字文件 */
const TEXT = /\.(md|markdown|txt|json|jsonl|canvas|base|ya?ml|html?|svg|xml|csv|tsv|css|js)$/i
const MAX_TEXT = 5 * 1024 * 1024
const dirOf = (p: string) => p.slice(0, p.lastIndexOf('/'))
const stemOf = (p: string) => p.slice(p.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')

async function walkAll(root: string): Promise<{ path: string; bytes: number }[]> {
  const out: { path: string; bytes: number }[] = []
  const walk = async (dir: string) => {
    for (const e of await readdir(dir ? join(root, dir) : root, { withFileTypes: true })) {
      if (SKIP.has(e.name)) continue
      const rel = dir ? `${dir}/${e.name}` : e.name
      if (e.isDirectory()) await walk(rel)
      else if (e.isFile()) out.push({ path: rel, bytes: (await stat(join(root, rel)).catch(() => null))?.size ?? 0 })
    }
  }
  await walk('')
  return out
}

/** 库里没人用的附件（按所在文件夹分组；不分原来属于哪篇） */
export async function orphanFiles(root: string): Promise<{ path: string; bytes: number }[]> {
  const all = await walkAll(root)
  const fileSet = new Set(all.map((f) => f.path))
  const atts = all.filter((f) => f.path.startsWith(ATTACHMENTS_DIR + '/') && !f.path.startsWith(COVER_DIR + '/') && !f.path.startsWith(`${ATTACHMENTS_DIR}/下载/`) && !isAppFile(f.path))
  if (!atts.length) return []
  const attSet = new Set(atts.map((f) => f.path))
  const byName = fileNameIndex(attSet)
  // 用户自己的文件（软件的 .canvas-notes/ 不算：字幕缓存按视频号起名，视频笔记删了它还在）
  const stems = new Set(all.filter((f) => !f.path.startsWith(ATTACHMENTS_DIR + '/') && !f.path.split('/').some((s) => s.startsWith('.'))).map((f) => stemOf(f.path)))
  const used = new Set<string>()
  for (const f of all) {
    if (!TEXT.test(f.path) || f.bytes > MAX_TEXT) continue
    const text = /\.md$/i.test(f.path) ? decodeNote(await readFile(join(root, f.path))).text : await readFile(join(root, f.path), 'utf8')
    for (const p of refHits(fileRefs(text, f.path), attSet, byName)) used.add(p)
  }
  return atts.filter((f) => {
    if (used.has(f.path)) return false
    // 某一层是还在的笔记（附件/<笔记>/）或别的文件（附件/<PDF>/）
    if (attachOwner(f.path, (n) => fileSet.has(n) || fileSet.has(n.replace(/\.md$/i, '')))) return false
    // 所在文件夹和库里哪个文件同名（附件/手写/<文档名>/）
    const parent = dirOf(f.path)
    return parent === ATTACHMENTS_DIR || !stems.has(parent.slice(parent.lastIndexOf('/') + 1))
  })
}

/** Git 历史里删掉过的笔记：路径 → 最后一次删它的提交（新的在前） */
async function deletedNotes(root: string): Promise<Map<string, string>> {
  let out: string
  try {
    out = await git.git(root, ['log', '-M', '--diff-filter=D', '--name-only', '-z', '--format=%x01%H'])
  } catch (e) {
    if (e instanceof git.GitError && /does not have any commits|bad default revision|not a git repository/i.test(e.stderr)) return new Map()
    throw e
  }
  const m = new Map<string, string>()
  for (const rec of out.split('\x01')) {
    const [head, ...rest] = rec.split('\0')
    const commit = head?.trim()
    if (!commit || !/^[0-9a-f]{40}$/.test(commit)) continue
    for (const p of rest.map((s) => s.replace(/^\n/, '')).filter((p) => /\.md$/i.test(p))) if (!m.has(p)) m.set(p, commit)
  }
  return m
}

/** 最近删掉的笔记看几篇（认「这组图原来属于哪篇」：附件文件夹对不上名字的） */
const LOOK_BACK = 200

export async function orphanGroups(v: Vault): Promise<OrphanGroup[]> {
  const files = await orphanFiles(v.root)
  if (!files.length) return []
  const by = new Map<string, { path: string; bytes: number }[]>()
  for (const f of files) by.set(dirOf(f.path), [...(by.get(dirOf(f.path)) ?? []), f])
  const gone = await deletedNotes(v.root)
  const groups: OrphanGroup[] = [...by].map(([dir, items]) => {
    const guess = dir.slice(ATTACHMENTS_DIR.length + 1) + '.md'
    return { dir, note: dir !== ATTACHMENTS_DIR && gone.has(guess) ? guess : null, items: items.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN', { numeric: true })) }
  })
  // 对不上名字的（附件/视频/<视频号>/ 这种）：最近删掉的笔记里谁链着这组的图
  const open = groups.filter((g) => !g.note)
  if (open.length && gone.size) {
    const recent = [...gone].slice(0, LOOK_BACK)
    const byCommit = new Map<string, string[]>()
    for (const [p, c] of recent) byCommit.set(c, [...(byCommit.get(c) ?? []), p])
    const shaOf = new Map<string, string>()
    for (const [c, paths] of byCommit) for (const [p, sha] of await blobsAt(v.root, `${c}^`, paths)) shaOf.set(p, sha)
    const bodies = await catBlobs(v.root, [...new Set(shaOf.values())])
    for (const g of open) {
      const mine = new Set(g.items.map((i) => i.path))
      for (const [p] of recent) {
        const b = shaOf.get(p) && bodies.get(shaOf.get(p)!)
        if (!b) continue
        const links = linkedPaths(decodeNote(b).text, p)
        if ([...mine].some((x) => links.has(x))) {
          g.note = p
          break
        }
      }
    }
  }
  // 原来属于哪篇认得出的在前，再按个数多的在前
  return groups.sort((a, b) => Number(!a.note) - Number(!b.note) || b.items.length - a.items.length || a.dir.localeCompare(b.dir, 'zh-CN'))
}

/**
 * 选中的这些没人用的附件移到废纸篓、一次提交（「移到废纸篓：没人用的附件 N 个」，底栏撤回 = 反向提交）。
 * 移之前再查一遍：这会儿又有人在用的（刚写了链接）不动。返回那次提交、移了几个
 */
export async function trashOrphans(v: Vault, pathsArg: unknown, put: (abs: string) => Promise<void>): Promise<{ commit: string | null; n: number }> {
  if (!Array.isArray(pathsArg) || pathsArg.some((p) => typeof p !== 'string')) throw new Error('要删的不对')
  const want = new Set(pathsArg as string[])
  const now = new Set((await orphanFiles(v.root)).map((f) => f.path))
  const go = [...want].filter((p) => now.has(p))
  if (!go.length) return { commit: null, n: 0 }
  const goes = new Set(go)
  await commitPendingUnder(v.root, (p) => goes.has(p))
  const byDir = new Map<string, string[]>()
  for (const p of go) byDir.set(dirOf(p), [...(byDir.get(dirOf(p)) ?? []), p])
  for (const [dir, list] of byDir) await putAttachments(v, list, put, dir === ATTACHMENTS_DIR ? undefined : dir)
  const commit = await commitTouched(v.root, (p) => goes.has(p), `移到废纸篓：没人用的附件 ${go.length} 个`)
  return { commit, n: go.length }
}

/** trashed：每移走一个说一声（库里的相对路径；正在答的 AI 那一轮不把它算成 AI 删的） */
export function registerOrphans(getVault: () => Vault, changed: () => void, trashed: (rel: string) => void = () => {}) {
  ipcMain.handle('attach:orphans', () => orphanGroups(getVault()))
  ipcMain.handle('attach:trash-orphans', async (_e, paths: unknown) => {
    // 测试把「废纸篓」换成临时文件夹，不往用户真的废纸篓里放东西
    const dir = process.env.CN_TRASH_DIR
    const toTrash = dir ? testTrash(dir) : (abs: string) => shell.trashItem(abs)
    const v = getVault()
    const put = (abs: string) => {
      if (abs.startsWith(v.root + '/')) trashed(abs.slice(v.root.length + 1))
      return toTrash(abs)
    }
    try {
      return await trashOrphans(v, paths, put)
    } finally {
      changed()
    }
  })
}
