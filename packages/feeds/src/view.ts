/**
 * 列表和计数的规矩（真实现在 SQL 里照这里写，假实现直接调这些函数；两边的测试跑同一组用例）。
 * - 视图 all：所有文章；五种类型：源的 kind 是它的文章；later / starred：标了的；highlights：有划线的。
 * - 排序：发表时间新的在前，同一时间按编号；翻页的 cursor 是上一页最后一条的「时间|编号」。
 * - 计数：all 和五种类型数未读，later / starred / highlights 数总数。
 */
import type { ArticleQuery, ArticleRow, Counts, Feed, FeedKind, ViewId } from './types'
import { FEED_KINDS } from './types'

export const PAGE_DEFAULT = 50
export const PAGE_MAX = 200

export function pageLimit(q: ArticleQuery): number {
  return Math.max(1, Math.min(PAGE_MAX, Math.floor(q.limit ?? PAGE_DEFAULT)))
}

export const encodeCursor = (row: Pick<ArticleRow, 'publishedAt' | 'id'>) => `${row.publishedAt}|${row.id}`

export function decodeCursor(cursor: string | undefined): { publishedAt: number; id: string } | null {
  if (!cursor) return null
  const i = cursor.indexOf('|')
  const t = Number(cursor.slice(0, i))
  if (i < 0 || !Number.isFinite(t)) throw new Error('cursor 不对')
  return { publishedAt: t, id: cursor.slice(i + 1) }
}

/** a 排在 b 前面时是负数 */
export const compareRows = (a: Pick<ArticleRow, 'publishedAt' | 'id'>, b: Pick<ArticleRow, 'publishedAt' | 'id'>) =>
  b.publishedAt - a.publishedAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

export function inView(row: ArticleRow, view: ViewId, kindOf: (feedId: string) => FeedKind | undefined): boolean {
  switch (view) {
    case 'all':
      return true
    case 'later':
      return row.later
    case 'starred':
      return row.starred
    case 'highlights':
      return row.highlightCount > 0
    default:
      return kindOf(row.feedId) === view
  }
}

/** 照 ArticleQuery 从全部文章里挑一页（假实现用；真实现是一条 SQL） */
export function selectPage(all: ArticleRow[], q: ArticleQuery, feeds: Map<string, Feed>): { rows: ArticleRow[]; next?: string } {
  const after = decodeCursor(q.cursor)
  const limit = pageLimit(q)
  const kindOf = (id: string) => feeds.get(id)?.kind
  const rows = all
    .filter(
      (r) =>
        inView(r, q.view ?? 'all', kindOf) &&
        (!q.feedId || r.feedId === q.feedId) &&
        // 静音、汇总的源：全部、类型视图、文件夹里不逐篇列（只在点开这个源时）
        (q.feedId || ['later', 'starred', 'highlights'].includes(q.view ?? 'all') || (feeds.get(r.feedId)?.mode ?? 'normal') === 'normal') &&
        (!q.folderId || feeds.get(r.feedId)?.folderId === q.folderId) &&
        (!q.unreadOnly || !r.read) &&
        (!after || compareRows(after, r) < 0),
    )
    .sort(compareRows)
  const page = rows.slice(0, limit)
  return rows.length > limit ? { rows: page, next: encodeCursor(page[page.length - 1]!) } : { rows: page }
}

export function countRows(all: ArticleRow[], feeds: Map<string, Feed>): Counts {
  const views = { all: 0, later: 0, starred: 0, highlights: 0 } as Record<ViewId, number>
  for (const k of FEED_KINDS) views[k] = 0
  const byFeed: Record<string, number> = {}
  const byFolder: Record<string, number> = {}
  for (const f of feeds.values()) byFeed[f.id] = 0
  for (const r of all) {
    const feed = feeds.get(r.feedId)
    if (!feed) continue
    if (!r.read) {
      byFeed[feed.id] = (byFeed[feed.id] ?? 0) + 1
      if ((feed.mode ?? 'normal') === 'normal') {
        views.all++
        views[feed.kind]++
        if (feed.folderId) byFolder[feed.folderId] = (byFolder[feed.folderId] ?? 0) + 1
      }
    }
    if (r.later) views.later++
    if (r.starred) views.starred++
    if (r.highlightCount > 0) views.highlights++
  }
  return { feeds: byFeed, folders: byFolder, views }
}
