/**
 * 「最近删掉的」（task-5yp97，用户看图选「只列 30 天」）：从 Git 历史读，不另存一份。
 * - 列：30 天里提交删掉的文件（git log -M --diff-filter=D：挪动、改名 git 认得出来，不算删），加上已经删了、还没提交的
 *   （工作区里没了、上一版有的，界面写「刚才」）；软件自己的文件（.canvas-notes/、.首页.json、.gitkeep）不列；
 *   同一个文件夹里现在有一样内容的不列（放回过的、又建了一样的）；同一份内容在同一个文件夹里删过几次只列最近那次。新的在前。
 *   删笔记时连着删掉的图（同一次删的：它自己的附件文件夹里的、文中用到的）不单列，跟着那一篇（with），放回时一起回来。
 * - 看一看：删掉前那一版（还没提交的是上一次提交里的），md 给字、图片给 data: 网址，别的只说多大。
 * - 放回走 restore.ts 的 restoreDeleted（那次删掉的这一篇从前一版取回原处，一次提交「放回：…」，撤回是 git revert）；
 *   还没提交的删除先单独提交这一篇的删除（commitPendingDelete），再放回，照样一次「放回」提交、能撤回。
 */
import * as git from '@cn/git'
import { attachmentDir, decodeNote, fmValue, imageRefs } from '@cn/format'
import { spawn } from 'node:child_process'
import { ipcMain } from 'electron'
import type { TrashItem, TrashPreview } from '../shared/api'
import { blob } from './diff'
import type { Vault } from './vault'

/** 列多少天里删的 */
export const TRASH_DAYS = 30
const DAY_MS = 86400_000
const HASH = /^[0-9a-f]{7,40}$/
const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic)$/i
const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic' }
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** 30 天里提交删掉的：哪次、什么时候、哪几个文件（新的在前） */
async function committed(root: string, since: number): Promise<{ commit: string; at: number; paths: string[] }[]> {
  let out: string
  try {
    out = await git.git(root, ['log', `--since=${new Date(since).toISOString()}`, '-M', '--diff-filter=D', '--name-only', '-z', '--format=%x01%H%x02%ct'])
  } catch (e) {
    if (e instanceof git.GitError && /does not have any commits|bad default revision/.test(e.stderr)) return []
    throw e
  }
  const res: { commit: string; at: number; paths: string[] }[] = []
  for (const rec of out.split('\x01')) {
    const end = rec.indexOf('\0')
    if (end < 0) continue
    const [commit, ct] = rec.slice(0, end).split('\x02')
    if (!commit || !HASH.test(commit)) continue
    const paths = rec
      .slice(end + 1)
      .replace(/^\n/, '')
      .split('\0')
      .filter((p) => p && !git.isInternalPath(p))
    if (paths.length) res.push({ commit, at: Number(ct) * 1000, paths })
  }
  return res
}

/** 一个版本里这几个文件的 blob（ls-tree） */
async function blobsAt(root: string, rev: string, paths: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  if (!paths.length) return m
  const out = await git.git(root, ['ls-tree', '-r', '-z', rev, '--', ...paths])
  for (const rec of out.split('\0')) {
    const tab = rec.indexOf('\t')
    if (tab < 0) continue
    const [, type, sha] = rec.slice(0, tab).split(' ')
    if (type === 'blob' && sha) m.set(rec.slice(tab + 1), sha)
  }
  return m
}

/** 一次读好几个 blob（git cat-file --batch，一个进程）：几百篇删过的白板认颜色也不慢 */
function catBlobs(root: string, shas: string[]): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    const m = new Map<string, Buffer>()
    if (!shas.length) return resolve(m)
    const p = spawn('git', ['cat-file', '--batch'], { cwd: root, env: { ...process.env, PATH: git.gitPath(), GIT_TERMINAL_PROMPT: '0' } })
    const chunks: Buffer[] = []
    const timer = setTimeout(() => (p.kill(), reject(new Error('读删掉的文件太久没回音'))), 30_000)
    p.stdout.on('data', (d: Buffer) => chunks.push(d))
    p.on('error', (e) => (clearTimeout(timer), reject(e)))
    p.on('close', () => {
      clearTimeout(timer)
      const all = Buffer.concat(chunks)
      let i = 0
      while (i < all.length) {
        const nl = all.indexOf(0x0a, i)
        if (nl < 0) break
        const [sha, type, size] = all.subarray(i, nl).toString('utf8').split(' ')
        if (type === 'missing' || !size) {
          i = nl + 1
          continue
        }
        const n = Number(size)
        m.set(sha!, all.subarray(nl + 1, nl + 1 + n))
        i = nl + 1 + n + 1
      }
      resolve(m)
    })
    p.stdin.end(shas.join('\n') + '\n')
  })
}

/** 现在库里每个文件夹有哪些内容（「文件夹\0blob」）：放回过的、又建了一样的认得出；工作区里已经删了（还没提交）的不算 */
async function contentNow(root: string, gone: Set<string>): Promise<Set<string>> {
  const out = await git.git(root, ['ls-files', '-s', '-z'])
  const s = new Set<string>()
  for (const rec of out.split('\0')) {
    const tab = rec.indexOf('\t')
    if (tab < 0) continue
    const path = rec.slice(tab + 1)
    const sha = rec.slice(0, tab).split(' ')[1]
    if (sha && !gone.has(path)) s.add(`${dirOf(path)}\0${sha}`)
  }
  return s
}

/** 30 天里删掉的（新的在前）；now 给测试用 */
export async function recentDeleted(v: Vault, now = Date.now()): Promise<TrashItem[]> {
  const since = now - TRASH_DAYS * DAY_MS
  const [done, st] = await Promise.all([committed(v.root, since), git.status(v.root)])
  // 还没提交的删除：工作区里没了（' D'）或者删除已经暂存（'D '）
  const pending = st.filter((s) => (s.code[0] === 'D' || s.code[1] === 'D') && !git.isInternalPath(s.path)).map((s) => s.path)
  const found: (TrashItem & { sha: string })[] = []
  if (pending.length) {
    const shas = await blobsAt(v.root, 'HEAD', pending)
    for (const p of pending) if (shas.get(p)) found.push({ path: p, commit: null, at: now, sha: shas.get(p)! })
  }
  for (const c of done) {
    const shas = await blobsAt(v.root, `${c.commit}^`, c.paths)
    for (const p of c.paths) if (shas.get(p)) found.push({ path: p, commit: c.commit, at: c.at, sha: shas.get(p)! })
  }
  const have = await contentNow(v.root, new Set(pending))
  const seen = new Set<string>()
  const list = found.filter((f) => {
    const key = `${dirOf(f.path)}\0${f.sha}`
    if (have.has(key) || seen.has(key)) return false
    seen.add(key)
    return true
  })
  const mds = list.filter((f) => /\.md$/i.test(f.path))
  const bodies = await catBlobs(v.root, [...new Set(mds.map((f) => f.sha))])
  // 删笔记时连着删的图（同一次删的）：跟着那一篇，不单列
  const sameTime = (a: TrashItem, b: TrashItem) => a.commit === b.commit
  const taken = new Set<TrashItem>()
  const withOf = new Map<TrashItem, string[]>()
  for (const m of mds) {
    const b = bodies.get(m.sha)
    const refs = new Set(b ? imageRefs(decodeNote(b).text, m.path).map((r) => r.path) : [])
    const own = attachmentDir(m.path) + '/'
    const att = list.filter((f) => f !== m && !/\.md$/i.test(f.path) && sameTime(f, m) && !taken.has(f) && (f.path.startsWith(own) || refs.has(f.path)))
    for (const a of att) taken.add(a)
    if (att.length) withOf.set(m, att.map((a) => a.path))
  }
  return list
    .filter((f) => !taken.has(f))
    .map((f) => {
      const { sha, ...item } = f
      const w = withOf.get(f)
      const out: TrashItem = w ? { ...item, with: w } : item
      // 白板：列表里画它自己的颜色方块（和目录树一样：属性里的 color，没写是灰的）
      const b = bodies.get(sha)
      if (!b) return out
      const text = decodeNote(b).text
      if (fmValue(text, 'type') !== 'board') return out
      return { ...out, board: fmValue(text, 'color')?.replace(/^["']|["']$/g, '') ?? '#8E8E96' }
    })
}

/** 删掉前那一版：md 给字，图片给 data: 网址（8 MB 以内），别的只说多大 */
export async function previewDeleted(v: Vault, path: string, commit: string | null): Promise<TrashPreview> {
  if (typeof path !== 'string' || !path || path.startsWith('/') || path.split('/').includes('..')) throw new Error('路径不对')
  if (commit !== null && (typeof commit !== 'string' || !HASH.test(commit))) throw new Error('提交号不对')
  const b = await blob(v.root, commit ? `${commit}^` : 'HEAD', path)
  if (!b) throw new Error(`那一版里没有 ${path}`)
  if (/\.md$/i.test(path)) return { text: decodeNote(b).text, bytes: b.length }
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  if (IMAGE.test(path) && MIME[ext] && b.length <= 8 * 1024 * 1024) return { image: `data:${MIME[ext]};base64,${b.toString('base64')}`, bytes: b.length }
  return { bytes: b.length }
}

/** 还没提交的删除：单独提交这一篇（和跟着它删的图）的删除（放回之前要有「删掉的那一次」），返回那次的提交号 */
export async function commitPendingDelete(v: Vault, paths: string[]): Promise<string> {
  if (!Array.isArray(paths) || !paths.length || paths.some((p) => typeof p !== 'string' || !p || p.startsWith('/') || p.split('/').includes('..'))) throw new Error('路径不对')
  const all = await git.status(v.root)
  const st = paths.map((p) => all.find((s) => s.path === p))
  const bad = paths.find((p, i) => !st[i] || (st[i]!.code[0] !== 'D' && st[i]!.code[1] !== 'D'))
  if (bad) throw new Error(`${bad} 没有还没提交的删除`)
  const hash = await git.commitPaths(v.root, paths, git.describeChanges(st as git.FileStatus[]))
  if (!hash) throw new Error(`${paths[0]} 的删除没提交上`)
  return hash
}

export function registerTrash(getVault: () => Vault, changed: () => void) {
  ipcMain.handle('trash:recent', () => recentDeleted(getVault()))
  ipcMain.handle('trash:preview', (_e, path: unknown, commit: unknown) => previewDeleted(getVault(), path as string, (commit ?? null) as string | null))
  ipcMain.handle('trash:commit-pending', async (_e, paths: unknown) => {
    const h = await commitPendingDelete(getVault(), paths as string[])
    changed()
    return h
  })
}
