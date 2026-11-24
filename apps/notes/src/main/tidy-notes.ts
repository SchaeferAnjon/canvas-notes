/**
 * 老库整理一次（2026-11-20「一个 PDF 一篇笔记」，task-9okg5，DESIGN.v3 1.7、docs/DEVELOPMENT.md）：打开库时跑，一次提交，能撤回。
 * - 「我的疑惑.md」「视频里的疑惑.md」不再是文件（一门课的在课程首页「我的疑惑」组件、⌘K「我的疑惑」，都直接读笔记）：
 *   软件生成、没改过的删掉；改过的改名「我的疑惑（我改过的）.md」留在原处。只看 front matter 写着「生成: 软件」的，自己起名叫「我的疑惑」的不碰。
 *   没改过 = 现在的字是软件写过的某一版：和按笔记重新算的一样（我的疑惑），或者工作区里没再改、和软件某次提交（笔记：/送进 Anki：/视频：/整理顶级分类）里的一样。
 * - 同一份 PDF（HTML）两篇以上笔记（「X 笔记 2.md」、「来源」写着这份 PDF 的笔记、段落链着这份 PDF 的笔记，同一个文件夹里）：
 *   按每段的身份合进「X 笔记.md」（packages/format 的 mergeReadingNotes），合完别的那几篇收掉；没有「X 笔记.md」时第一篇改名成它。
 * 整理过就在库里 .canvas-notes/整理.json 记一笔（撤回不撤它）：以后不再整理。没有要整理的什么都不做、不提交、不记。
 */
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import * as git from '@cn/git'
import { decodeNote, doubtsNote, mergeReadingNotes, notePathFor, parseReadingNote, prop } from '@cn/format'
import { commitPendingUnder } from './folder-ops'
import { collectDoubts, courseName, dirOf, readAnkiState } from './reading/doubts'
import type { Vault } from './vault'
import { atomicWrite } from '@cn/atomic'

export const TIDY_FILE = '.canvas-notes/整理.json'
const KEY = '一个PDF一篇笔记'
const SUMMARIES = ['我的疑惑.md', '视频里的疑惑.md']
/** 软件写这两篇时那次提交的说明开头：记笔记、送 Anki、视频框一块问、整理顶级分类时改链接 */
const OURS = /^(笔记：|送进 Anki：|视频：|整理顶级分类)/
const CN = ['零', '一', '两', '三', '四', '五', '六', '七', '八', '九', '十']

export interface Tidied {
  commit: string | null
  /** 底栏那一句（「整理好了：」后面的） */
  said: string
  /** 这次动过的路径（撤回只撤它们；不含整理.json） */
  paths: string[]
  /** 撤回以后说的那句 */
  back: string
  /** 开着的标签换路径：改名的、合进去的；删掉的 to 是 null */
  moves: { from: string; to: string | null }[]
}

const nameOf = (p: string) => p.split('/').pop() ?? p
const stemOf = (p: string) => nameOf(p).replace(/\.[^.]+$/, '')
const exists = (abs: string) => stat(abs).then(() => true, () => false)
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function readMarker(v: Vault): Promise<Record<string, unknown>> {
  try {
    const j = JSON.parse(await readFile(v.abs(TIDY_FILE), 'utf8')) as unknown
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return {}
    throw e
  }
}

/** 库里的 md、PDF、HTML（点开头的、node_modules、附件/ 不看），按文件夹分 */
async function listByFolder(v: Vault): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  const walk = async (dir: string) => {
    for (const ent of await readdir(dir ? v.abs(dir) : v.root, { withFileTypes: true })) {
      if (ent.name.startsWith('.') || ent.name === 'node_modules') continue
      const p = dir ? `${dir}/${ent.name}` : ent.name
      if (ent.isDirectory()) {
        if (p !== '附件') await walk(p)
      } else if (ent.isFile() && /\.(md|pdf|html?)$/i.test(ent.name)) {
        const list = out.get(dir) ?? []
        list.push(p)
        out.set(dir, list)
      }
    }
  }
  await walk('')
  return out
}

/** 软件生成的这一篇现在的字是不是软件写过的某一版 */
async function untouched(v: Vault, path: string, text: string): Promise<boolean> {
  if (nameOf(path) === '我的疑惑.md') {
    const folder = dirOf(path)
    const sent = new Set(Object.keys((await readAnkiState(v)).sent))
    if (doubtsNote(folder, courseName(folder), await collectDoubts(v, folder), sent) === text) return true
  }
  if ((await git.status(v.root)).some((s) => s.path === path)) return false
  for (const c of await git.log(v.root, 30, undefined, [path])) {
    if (!OURS.test(c.subject)) continue
    const was = await git.git(v.root, ['show', `${c.hash}:${path}`]).catch(() => null)
    if (was === text) return true
  }
  return false
}

/** 改名不撞：「我的疑惑（我改过的）.md」已经有了就加「 2」 */
async function freeName(v: Vault, path: string): Promise<string> {
  const dir = dirOf(path)
  const base = `${stemOf(path)}（我改过的）`
  for (let n = 1; ; n++) {
    const p = `${dir ? dir + '/' : ''}${base}${n > 1 ? ` ${n}` : ''}.md`
    if (!(await exists(v.abs(p)))) return p
  }
}

/** 打开库时整理一次；没有要整理的、整理过的返回 null */
export async function tidyNotes(v: Vault): Promise<Tidied | null> {
  const marker = await readMarker(v)
  if (marker[KEY]) return null
  const byFolder = await listByFolder(v)
  const text = async (p: string) => decodeNote(await readFile(v.abs(p))).text

  // ---- 打算：哪几篇「我的疑惑」删、哪几篇改名；哪几份 PDF 的笔记要合
  const drop: string[] = []
  const keep: { from: string; to: string }[] = []
  for (const files of byFolder.values())
    for (const p of files) {
      if (!SUMMARIES.includes(nameOf(p))) continue
      const t = await text(p)
      if (prop(t, '生成') !== '软件') continue
      if (await untouched(v, p, t)) drop.push(p)
      else keep.push({ from: p, to: '' })
    }
  const merges: { pdf: string; into: string; from: string[]; had: boolean }[] = []
  const taken = new Set<string>()
  for (const files of byFolder.values()) {
    const docs = files.filter((p) => /\.(pdf|html?)$/i.test(p)).sort()
    if (!docs.length) continue
    const primaries = new Set(docs.map(notePathFor))
    const mds = files.filter((p) => /\.md$/i.test(p) && !primaries.has(p) && !SUMMARIES.includes(nameOf(p)))
    for (const pdf of docs) {
      const into = notePathFor(pdf)
      const dup = new RegExp(`^${escRe(stemOf(pdf))} 笔记 \\d+\\.md$`)
      const from: string[] = []
      for (const m of mds) {
        if (taken.has(m)) continue
        const t = await text(m)
        const mine = dup.test(nameOf(m)) || (prop(t, '类型') === '笔记' && prop(t, '来源') === `[[${nameOf(pdf)}]]`) || parseReadingNote(t, m).some((s) => s.file === pdf)
        if (mine) (from.push(m), taken.add(m))
      }
      if (from.length) merges.push({ pdf, into, from: from.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })), had: files.includes(into) })
    }
  }
  if (!drop.length && !keep.length && !merges.length) return null

  // ---- 动手之前：这几篇还没提交的字先单独提交（这次整理的提交里只有整理）
  const touched = new Set([...drop, ...keep.map((k) => k.from), ...merges.flatMap((m) => [m.into, ...m.from])])
  await commitPendingUnder(v.root, (p) => touched.has(p))

  for (const p of drop) await rm(v.abs(p))
  for (const k of keep) {
    k.to = await freeName(v, k.from)
    await rename(v.abs(k.from), v.abs(k.to))
  }
  for (const m of merges) {
    const list = [...m.from]
    let md = m.had ? await text(m.into) : await text(list.shift()!)
    for (const f of list) md = mergeReadingNotes(md, await text(f), m.into, f)
    await atomicWrite(v.abs(m.into), md)
    for (const f of m.from) await rm(v.abs(f))
  }
  await mkdir(dirname(v.abs(TIDY_FILE)), { recursive: true })
  await atomicWrite(v.abs(TIDY_FILE), JSON.stringify({ ...marker, [KEY]: new Date().toISOString().slice(0, 10) }, null, 2) + '\n')

  // ---- 说一句、一次提交
  const names = [...new Set([...drop, ...keep.map((k) => k.from)].map(nameOf))].sort((a, b) => SUMMARIES.indexOf(a) - SUMMARIES.indexOf(b))
  const parts: string[] = []
  if (names.length) parts.push(`${names.map((n) => `「${n.replace(/\.md$/, '')}」`).join('')}改在课程首页看`)
  if (keep.length) parts.push(`改过的${[...new Set(keep.map((k) => nameOf(k.from)))].map((n) => `「${n.replace(/\.md$/, '')}」`).join('')}改名留着`)
  const count = (m: (typeof merges)[number]) => m.from.length + (m.had ? 1 : 0)
  if (merges.length === 1) parts.push(`${CN[count(merges[0]!)] ?? count(merges[0]!)}篇《${stemOf(merges[0]!.into)}》并成一篇`)
  else if (merges.length > 1) parts.push(`${merges.length}份 PDF 的笔记各并成一篇`)
  const said = parts.join('，')
  const paths = [...drop, ...keep.flatMap((k) => [k.from, k.to]), ...merges.flatMap((m) => [m.into, ...m.from])]
  const commit = await git.commitPaths(v.root, [...paths, TIDY_FILE], `整理：${said}`)
  const gone = merges.flatMap((m) => (m.had ? m.from : m.from.slice(1)).map((f) => `《${stemOf(f)}》`))
  const backNames = names.map((n) => `「${n}」`).join('')
  const back = `撤回了这次整理：${[backNames, gone.join('')].filter(Boolean).join('和')}回来了`
  const moves = [...drop.map((from) => ({ from, to: null })), ...keep.map((k) => ({ from: k.from, to: k.to })), ...merges.flatMap((m) => m.from.map((from) => ({ from, to: m.into })))]
  return { commit, said, paths, back, moves }
}

/** 撤回这次整理：只撤动过的那几篇（整理.json 留着，不再整理），返回底栏说的那句 */
export async function undoTidy(v: Vault, t: Pick<Tidied, 'commit' | 'paths' | 'back'>): Promise<string> {
  if (!t.commit) throw new Error('这次整理没有提交，撤不回')
  for (const p of t.paths) v.abs(p)
  await git.revertPaths(v.root, t.commit, t.paths, `撤回整理：${t.back.replace(/^撤回了这次整理：/, '')}`)
  return t.back
}
