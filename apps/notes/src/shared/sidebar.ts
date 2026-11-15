/**
 * 左栏只放「活着的」：置顶的、这周动过的、最近的白板；其余收进「全部笔记」和「归档」。
 * 不管库里 7 篇还是 7 万篇，左栏都只有二三十行（不算置顶最多 29 行：导航 4、白板 5、文档 10 加「还有几篇」、
 * 素材主题 6、底部 3）。纯函数，主进程和界面都用。
 *
 * 归档 = 很久没改过（按修改时间）。不挪文件、不改内容，只是左栏不显示；置顶的永不归档；
 * 收件箱不归档（那是等着整理的，藏起来就看不见堆了多少）。一编辑修改时间就变了，自然回到左栏。
 */
import type { NoteFile } from './api'

export const DAY_MS = 86400_000

/** 设置里能选的天数；0 = 不自动归档 */
export const ARCHIVE_CHOICES = [30, 60, 90, 180, 0] as const
export type ArchiveDays = (typeof ARCHIVE_CHOICES)[number]
export const DEFAULT_ARCHIVE_DAYS: ArchiveDays = 90
export const isArchiveDays = (v: unknown): v is ArchiveDays => ARCHIVE_CHOICES.includes(v as ArchiveDays)
export const archiveLabel = (d: ArchiveDays) => (d === 0 ? '不自动归档' : `${d} 天没改过`)

/** 「这周动过的」：最近 7 天（不是从周一算，周一早上左栏也不会突然空掉） */
export const RECENT_DAYS = 7
/** 每组最多几行 */
export const MAX_BOARDS = 5
export const MAX_WORKS = 10
export const MAX_TOPICS = 6
/** 收件箱超过这么多条就提醒 */
export const INBOX_WARN = 20

export function isArchived(n: NoteFile, now: number, days: ArchiveDays, pinned: ReadonlySet<string>): boolean {
  if (days === 0 || n.kind === 'inbox' || pinned.has(n.path)) return false
  return now - n.mtimeMs > days * DAY_MS
}

export interface SidebarModel {
  /** 置顶的，按置顶的先后 */
  pinned: NoteFile[]
  /** 最近的白板（没归档、没置顶），新改的在前 */
  boards: NoteFile[]
  /** 这周动过的文档（没置顶），新改的在前 */
  works: NoteFile[]
  /** 这周动过、但超出行数没显示的文档 */
  moreWorks: number
  /** 素材的主题：有没归档的素材的，最近剪过的在前；count 是这个主题一共几段 */
  topics: { topic: string; count: number }[]
  inbox: number
  all: number
  archived: number
}

export function sidebarOf(notes: NoteFile[], pins: readonly string[], now: number, days: ArchiveDays): SidebarModel {
  const pinSet = new Set(pins)
  const byPath = new Map(notes.map((n) => [n.path, n]))
  const pinned = pins.map((p) => byPath.get(p)).filter((n): n is NoteFile => !!n)
  const newest = (a: NoteFile, b: NoteFile) => b.mtimeMs - a.mtimeMs
  const live = notes.filter((n) => !pinSet.has(n.path) && !isArchived(n, now, days, pinSet))
  const boards = live.filter((n) => n.board).sort(newest).slice(0, MAX_BOARDS)
  const recent = live.filter((n) => n.kind === 'work' && !n.board && now - n.mtimeMs <= RECENT_DAYS * DAY_MS).sort(newest)
  const topicLatest = new Map<string, number>()
  const topicCount = new Map<string, number>()
  for (const n of notes) {
    if (n.kind !== 'clip') continue
    topicCount.set(n.topic!, (topicCount.get(n.topic!) ?? 0) + 1)
    if (!isArchived(n, now, days, pinSet)) topicLatest.set(n.topic!, Math.max(topicLatest.get(n.topic!) ?? 0, n.mtimeMs))
  }
  const topics = [...topicLatest]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOPICS)
    .map(([topic]) => ({ topic, count: topicCount.get(topic)! }))
  return {
    pinned,
    boards,
    works: recent.slice(0, MAX_WORKS),
    moreWorks: Math.max(0, recent.length - MAX_WORKS),
    topics,
    inbox: notes.filter((n) => n.kind === 'inbox').length,
    all: notes.length,
    archived: notes.filter((n) => isArchived(n, now, days, pinSet)).length,
  }
}

// ---------- 置顶：库里的 .canvas-notes/置顶.json，跟着 Git 走 ----------

export const PINS_FILE = '.canvas-notes/置顶.json'

/** 读出来的可能被手改过或合并冲突过：只留 .md 路径，去重，不许 .. 跳出库 */
export function normalizePins(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const p of raw) {
    if (typeof p !== 'string' || !/\.md$/i.test(p) || p.startsWith('/') || p.split('/').includes('..') || out.includes(p)) continue
    out.push(p)
  }
  return out
}

/** 写进文件的样子：两格缩进、最后一个换行 */
export const pinsJson = (pins: readonly string[]) => JSON.stringify(normalizePins(pins), null, 2) + '\n'

/** 置顶排到最后，取消就拿掉 */
export function setPin(pins: readonly string[], path: string, on: boolean): string[] {
  const rest = pins.filter((p) => p !== path)
  return on ? [...rest, path] : rest
}

/** 改名、挪走：置顶跟着换路径；删掉（to 是 null）就拿掉 */
export function movePin(pins: readonly string[], from: string, to: string | null): string[] {
  return pins.flatMap((p) => (p !== from ? [p] : to ? [to] : []))
}
