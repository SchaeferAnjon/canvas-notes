/**
 * 顶级分类在主进程这边（分类表在 shared/categories.ts）：
 * - 每类「放什么」那句话改过的存在库里 .canvas-notes/分类.json（没改过不建文件）；
 * - 打开老库时整理一次（2026-11-18 用户定）：「素材/」改名「剪藏/」，「素材/微信读书/」挪到最外层的「阅读/」，
 *   链接、附件文件夹、置顶、左栏跟着改，一次提交「整理顶级分类」。新库、整理过的库什么都不做；
 *   还没有的分类文件夹不建（树和活动栏照样画一行空的，往里放第一篇时才有这个文件夹）。
 */
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { CATEGORY_FILE, type CategoryDescs, descsJson, isCategory, normalizeDescs } from '../shared/categories'
import { LEFT_FILE } from '../shared/left'
import { PINS_FILE } from '../shared/sidebar'
import { writeFileAtomic } from './atomic'
import * as git from '@cn/git'
import { commitPendingUnder, commitTouched, moveManyNow, planMoveMany, planRelocate, relocateNow } from './folder-ops'
import type { Vault } from './vault'

/** 以前的名字 */
export const OLD_CLIPS = '素材'
const OLD_WEREAD = '微信读书'

export async function readDescs(v: Vault): Promise<CategoryDescs> {
  try {
    return normalizeDescs(JSON.parse(await readFile(v.abs(CATEGORY_FILE), 'utf8')))
  } catch (e) {
    // 没有文件是没改过；文件坏了（手改、合并冲突）当没改过
    if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return {}
    throw e
  }
}

/** 改一类的「放什么」：写回分类.json（别的几句原样留着）；text 空了是恢复默认 */
export async function writeDesc(v: Vault, name: unknown, text: unknown): Promise<CategoryDescs> {
  if (typeof name !== 'string' || !isCategory(name)) throw new Error(`不是自带的分类：${String(name)}`)
  if (typeof text !== 'string') throw new Error('「放什么」不对')
  const cur = await readDescs(v)
  const next = normalizeDescs({ 放什么: { ...cur, [name]: text } })
  if (!text.trim()) delete next[name]
  await writeFileAtomic(v.abs(CATEGORY_FILE), descsJson(next))
  return next
}

const isDir = (abs: string) => stat(abs).then((s) => s.isDirectory(), () => false)
const kids = async (abs: string) => (await readdir(abs)).filter((n) => !n.startsWith('.'))

export interface Organized {
  commit: string | null
  /** 挪了哪些文件夹（旧 → 新），界面拿它换开着的标签、左栏记着的那一页 */
  moves: { from: string; to: string }[]
}

/**
 * 打开库时看一眼：还有「素材/」就整理一次（一次提交）；没有就什么都不做，返回 null。
 * 先「素材/微信读书/」→「阅读/」，再「素材/」→「剪藏/」；新名字已经有同名文件夹时一样一样挪进去，
 * 挪不进去（重名）的留在原处，不覆盖任何东西。moved：每个文件挪了（本机记着的读 PDF 进度跟着换）
 */
export async function organizeCategories(v: Vault, moved?: (from: string, to: string) => void): Promise<Organized | null> {
  if (!(await isDir(v.abs(OLD_CLIPS)))) return null
  // 用户还没提交的字先单独提交一次（只在动手之前一次），这次整理的提交里只有整理：素材、剪藏、阅读和它们的附件、提到它们的笔记、置顶、左栏
  const near = (p: string) => [OLD_CLIPS, '剪藏', '阅读'].some((d) => p === d || p.startsWith(d + '/') || p.startsWith(`附件/${d}/`)) || p === PINS_FILE || p === LEFT_FILE
  const mentions = new Set<string>()
  for (const s of await git.status(v.root)) if (s.path.endsWith('.md') && !near(s.path)) {
    const text = await readFile(v.abs(s.path), 'utf8').catch(() => '')
    if (text.includes(OLD_CLIPS) || text.includes(OLD_WEREAD)) mentions.add(s.path)
  }
  await commitPendingUnder(v.root, (p) => near(p) || mentions.has(p))
  const moves: { from: string; to: string }[] = []
  const touched: ((p: string) => boolean)[] = []
  /** 整个文件夹改名（新名字还没有时），或者一样一样挪进去（新名字已经有了时，重名的留着） */
  const relocate = async (from: string, to: string) => {
    if (!(await isDir(v.abs(from)))) return
    if (!(await isDir(v.abs(to)))) {
      const p = await planRelocate(v, from, to)
      const rel = new Set(await relocateNow(v, p, moved))
      touched.push((x) => p.inFolder(x) || rel.has(x) || x === PINS_FILE || x === LEFT_FILE)
      moves.push({ from, to })
      return
    }
    const free: string[] = []
    for (const n of await kids(v.abs(from))) if (!(await stat(v.abs(`${to}/${n}`)).catch(() => null))) free.push(`${from}/${n}`)
    if (!free.length) return
    const plan = await planMoveMany(v, free, to)
    const r = await moveManyNow(v, plan, moved)
    touched.push(r.touched)
    moves.push(...r.moves)
  }
  await relocate(`${OLD_CLIPS}/${OLD_WEREAD}`, '阅读')
  await relocate(OLD_CLIPS, '剪藏')
  if (!moves.length) return null
  // 素材/ 里一样一样挪完了、空了：收掉
  if ((await isDir(v.abs(OLD_CLIPS))) && !(await kids(v.abs(OLD_CLIPS))).length) await rm(v.abs(OLD_CLIPS), { recursive: true, force: true })
  const said: string[] = []
  for (const m of moves) {
    const slash = (await isDir(v.abs(m.to))) ? '/' : ''
    said.push(`${m.from}${slash} → ${m.to}${slash}`)
  }
  const commit = await commitTouched(v.root, (p) => touched.some((t) => t(p)) || p.startsWith(OLD_CLIPS + '/'), `整理顶级分类：${said.join('，')}（链接、附件、置顶、左栏跟着改）`)
  return { commit, moves }
}
