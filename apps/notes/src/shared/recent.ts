/**
 * 「最近」：按时间看笔记（2026-11-17 左栏重组）。不管放在哪个文件夹，最近动过的排在前面：
 * 置顶 → 今天 → 这周 → 按月收起（十月、九月……一年以前的并成「更早」）。左栏和中间的「最近」页共用。纯函数。
 */
import { notePathFor } from '@cn/format'
import type { NoteFile } from './api'
import type { FileEntry } from './files'
import { DAY_MS, isArchived, type ArchiveDays } from './sidebar'
import { isTodoNote } from './todo'

/** 每组先列这么多，多的点「再显示」（别把上万条全铺开） */
export const RECENT_PAGE = 100

/**
 * 打开过的 PDF、HTML 和右栏看过的网页（2026-11-24 用户「最近里不能显示 PDF」「网页也放进去」）：
 * PDF、HTML 按最后打开的时间排；有配对笔记（「<名字> 笔记.md」）的合成一条，时间取 PDF 打开和笔记修改里晚的那个，
 * 笔记那一行不再单列（只开过笔记、没开过 PDF 的照旧列笔记）。网页是网址和标题，时间是最后看的时候
 */
export interface RecentOpened {
  opened: 'pdf' | 'html' | 'web'
  /** 库里的路径；网页是网址 */
  path: string
  /** 网页的标题（PDF、HTML 用文件名） */
  title?: string
  mtimeMs: number
  /** 配对笔记的路径（库里有这篇时） */
  note?: string
  /** PDF 问到第几页 */
  progress?: FileEntry['progress']
}

export type RecentItem = NoteFile | RecentOpened

export const isOpened = (x: RecentItem): x is RecentOpened => 'opened' in x

/**
 * 「最近」要列的：笔记 + 打开过的 PDF、HTML（openedAt：库里路径 → 最后打开的时间）+ 看过的网页。
 * 配对笔记并进 PDF 那一条；库里已经没有的 PDF、HTML 不列
 */
export function recentItems(notes: NoteFile[], files: readonly FileEntry[], openedAt: ReadonlyMap<string, number>, web: readonly { url: string; title: string; lastVisit: number }[] = []): RecentItem[] {
  const byPath = new Map(notes.map((n) => [n.path, n]))
  const merged = new Set<string>()
  const docs: RecentOpened[] = []
  for (const f of files) {
    if (f.kind !== 'pdf' && f.kind !== 'html') continue
    const at = openedAt.get(f.path)
    if (at === undefined) continue
    const note = byPath.get(f.note?.path ?? notePathFor(f.path))
    if (note) merged.add(note.path)
    docs.push({ opened: f.kind, path: f.path, mtimeMs: Math.max(at, note?.mtimeMs ?? 0), ...(note ? { note: note.path } : {}), ...(f.progress ? { progress: f.progress } : {}) })
  }
  const pages: RecentOpened[] = web.map((w) => ({ opened: 'web', path: w.url, title: w.title, mtimeMs: w.lastVisit }))
  return [...(merged.size ? notes.filter((n) => !merged.has(n.path)) : notes), ...docs, ...pages]
}

export interface RecentGroup<T extends RecentItem = NoteFile> {
  /** today / week / 2026-10 / older */
  key: string
  label: string
  items: T[]
}

export interface RecentModel<T extends RecentItem = NoteFile> {
  pinned: T[]
  /** 今天、这周，然后每个月一组，最后「更早」；空的组不出现 */
  groups: RecentGroup<T>[]
  /** 归档了的（左栏不列，底下「归档 N 篇」） */
  archived: number
  total: number
}

const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * 分组。keep：类型筛选；withArchived：中间的「最近」页列全部（找东西用），左栏不列归档了的；
 * hideTodo：名字叫「待办」的笔记不列（设置 › 文件「文件树里显示待办」没开时，task-pd1d1）。
 * 这周 = 最近 7 天里不是今天的（不是从周一算：周一早上也不会突然空掉）；一年以前的并成「更早」。
 */
export function recentOf<T extends RecentItem = NoteFile>(
  notes: T[],
  opts: { pins: readonly string[]; now: number; archiveDays: ArchiveDays; keep?: (n: T) => boolean; withArchived?: boolean; hideTodo?: boolean },
): RecentModel<T> {
  const now = new Date(opts.now)
  const pinSet = new Set(opts.pins)
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startWeek = opts.now - 7 * DAY_MS
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1).getTime()
  const byPath = new Map(notes.map((n) => [n.path, n]))
  const ok = (n: T) => (!opts.keep || opts.keep(n)) && !(opts.hideTodo && !isOpened(n) && isTodoNote(n.path))
  const pool = opts.keep || opts.hideTodo ? notes.filter(ok) : notes
  const pinned = opts.pins.map((p) => byPath.get(p)).filter((n): n is T => !!n && !isOpened(n) && ok(n))
  // 打开过的 PDF、网页：多少天没再打开也一样归档（和笔记同一个天数）
  const archivedOf = (n: T) => (isOpened(n) ? opts.archiveDays !== 0 && opts.now - n.mtimeMs > opts.archiveDays * DAY_MS : isArchived(n, opts.now, opts.archiveDays, pinSet))
  let archived = 0
  const today: T[] = []
  const week: T[] = []
  const months = new Map<string, T[]>()
  const older: T[] = []
  for (const n of [...pool].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    if (pinSet.has(n.path)) continue
    if (archivedOf(n)) {
      archived++
      if (!opts.withArchived) continue
    }
    if (n.mtimeMs >= startToday) today.push(n)
    else if (n.mtimeMs >= startWeek) week.push(n)
    else if (n.mtimeMs >= yearAgo) {
      const k = monthKey(new Date(n.mtimeMs))
      const list = months.get(k)
      if (list) list.push(n)
      else months.set(k, [n])
    } else older.push(n)
  }
  const groups: RecentGroup<T>[] = []
  if (today.length) groups.push({ key: 'today', label: '今天', items: today })
  if (week.length) groups.push({ key: 'week', label: '这周', items: week })
  for (const [k, items] of months) {
    const [y, m] = k.split('-').map(Number) as [number, number]
    groups.push({ key: k, label: y === now.getFullYear() ? MONTHS[m - 1]! : `${y}年${MONTHS[m - 1]}`, items })
  }
  if (older.length) groups.push({ key: 'older', label: '更早', items: older })
  return { pinned, groups, archived, total: pool.length }
}
