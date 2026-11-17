/**
 * 「最近」：按时间看笔记（2026-11-17 左栏重组）。不管放在哪个文件夹，最近动过的排在前面：
 * 置顶 → 今天 → 这周 → 按月收起（十月、九月……一年以前的并成「更早」）。左栏和中间的「最近」页共用。纯函数。
 */
import type { NoteFile } from './api'
import { DAY_MS, isArchived, type ArchiveDays } from './sidebar'

/** 每组先列这么多，多的点「再显示」（别把上万条全铺开） */
export const RECENT_PAGE = 100

export interface RecentGroup {
  /** today / week / 2026-10 / older */
  key: string
  label: string
  items: NoteFile[]
}

export interface RecentModel {
  pinned: NoteFile[]
  /** 今天、这周，然后每个月一组，最后「更早」；空的组不出现 */
  groups: RecentGroup[]
  /** 归档了的（左栏不列，底下「归档 N 篇」） */
  archived: number
  total: number
}

const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']
const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

/**
 * 分组。keep：类型筛选；withArchived：中间的「最近」页列全部（找东西用），左栏不列归档了的。
 * 这周 = 最近 7 天里不是今天的（不是从周一算：周一早上也不会突然空掉）；一年以前的并成「更早」。
 */
export function recentOf(
  notes: NoteFile[],
  opts: { pins: readonly string[]; now: number; archiveDays: ArchiveDays; keep?: (n: NoteFile) => boolean; withArchived?: boolean },
): RecentModel {
  const now = new Date(opts.now)
  const pinSet = new Set(opts.pins)
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startWeek = opts.now - 7 * DAY_MS
  const yearAgo = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1).getTime()
  const byPath = new Map(notes.map((n) => [n.path, n]))
  const pool = opts.keep ? notes.filter(opts.keep) : notes
  const pinned = opts.pins.map((p) => byPath.get(p)).filter((n): n is NoteFile => !!n && (!opts.keep || opts.keep(n)))
  let archived = 0
  const today: NoteFile[] = []
  const week: NoteFile[] = []
  const months = new Map<string, NoteFile[]>()
  const older: NoteFile[] = []
  for (const n of [...pool].sort((a, b) => b.mtimeMs - a.mtimeMs)) {
    if (pinSet.has(n.path)) continue
    if (isArchived(n, opts.now, opts.archiveDays, pinSet)) {
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
  const groups: RecentGroup[] = []
  if (today.length) groups.push({ key: 'today', label: '今天', items: today })
  if (week.length) groups.push({ key: 'week', label: '这周', items: week })
  for (const [k, items] of months) {
    const [y, m] = k.split('-').map(Number) as [number, number]
    groups.push({ key: k, label: y === now.getFullYear() ? MONTHS[m - 1]! : `${y}年${MONTHS[m - 1]}`, items })
  }
  if (older.length) groups.push({ key: 'older', label: '更早', items: older })
  return { pinned, groups, archived, total: pool.length }
}
