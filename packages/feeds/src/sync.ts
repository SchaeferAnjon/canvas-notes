/**
 * 多台设备同步：库里 `.canvas-feeds/<设备>.jsonl`，每台设备只往自己那份末尾加，一行一条记录（Git 合并永远不打架）。
 * 读的时候把所有设备的记录合起来重放。
 *
 * 一条记录：{ v: 1, d: 设备, s: 这台设备的第几条, t: 时间（毫秒，混合逻辑时钟）, op: …, … }
 *   sub / unsub          订阅、退订一个源（带地址、名字、类型、文件夹、间隔）
 *   feed                 改源的名字、文件夹、类型、间隔、进不进列表（mode：逐条 / 静音 / 汇总，digestEvery）（只写改了的）
 *   folder / unfolder    建（改名、排序）、删文件夹
 *   read                 一批文章标成已读 / 未读
 *   readAll              一批源里 before 以前发表的都标已读
 *   star / later         星标、稍后读（带文章的快照：别的设备还没抓到这篇时也列得出来）
 *   hl / unhl            加或改、删一条划线
 *
 * 合并规矩（和读文件的先后、哪台设备先同步都无关）：
 * 1. 每条记录有一个全序的键 ord = (t, d, s)：先比时间，同一毫秒比设备名，再比序号。
 * 2. 每条记录拆成几个「字段写」（effects）：sub:<源>、feed:<源>:title、folder:<夹>:name、read:<文章>、star:<文章>、hl:<划线>……
 *    每个字段只认 ord 最大的那一次写（后写的赢，LWW）。所以同一组记录不管按什么顺序、重放几遍，结果都一样。
 * 3. readAll 不是字段写：每一条都留着；一篇文章是不是已读 = 它自己的 read 写和所有盖住它的 readAll（同一个源、发表时间 ≤ before）里
 *    ord 最大的那一个说了算。新抓进来的文章也照这个算（别的设备先「整源已读」，这台后抓到的旧文章也是已读）。
 * 4. 时钟：t = max(现在, 这台设备见过的最大 t + 1)。读到别的设备更晚的记录就把「见过的最大 t」往上推，
 *    所以「在 A 上看到星标、到 B 上取消」即使 B 的钟慢，取消也排在后面。
 * 5. 删了的文件夹里的源挪到「没有文件夹」；退订后再订是新的一次 sub，ord 更大的赢。
 *
 * 压缩（以后做）：一台设备把自己那份重写成「还在赢的那些字段写 + 还有用的 readAll」，序号不变；
 * 别的设备发现文件变短就从头读，按 (d, s) 去重，结果不变。
 */
import type { FeedKind, FeedMode, Highlight } from './types'

export const SYNC_DIR = '.canvas-feeds'
export const syncFile = (device: string) => `${SYNC_DIR}/${device}.jsonl`

/** 文章快照：星标、稍后读、划线带上，别的设备没抓到这篇时也能列出来 */
export interface ArticleSnap {
  feedId: string
  title: string
  url?: string
  publishedAt: number
}

export interface SubFeed {
  id: string
  url: string
  title: string
  kind: FeedKind
  folderId: string | null
  intervalMin: number
  siteUrl?: string
}

export type SyncOp =
  | { op: 'sub'; feed: SubFeed }
  | { op: 'unsub'; feedId: string }
  | { op: 'feed'; feedId: string; title?: string; folderId?: string | null; kind?: FeedKind; intervalMin?: number; mode?: FeedMode; digestEvery?: number }
  | { op: 'folder'; id: string; name?: string; order?: number }
  | { op: 'unfolder'; id: string }
  | { op: 'read'; ids: string[]; on: boolean }
  | { op: 'readAll'; feedIds: string[]; before: number }
  | { op: 'star'; id: string; on: boolean; art?: ArticleSnap }
  | { op: 'later'; id: string; on: boolean; art?: ArticleSnap }
  | { op: 'hl'; h: Highlight; art?: ArticleSnap }
  | { op: 'unhl'; id: string; articleId: string }

export type SyncEvent = { v: 1; d: string; s: number; t: number } & SyncOp

/** 全序的键，写成能直接按字符串比的样子（存进 SQLite 也按它比） */
export function ordOf(e: Pick<SyncEvent, 't' | 'd' | 's'>): string {
  return `${e.t.toString(36).padStart(10, '0')}|${e.d}|${e.s.toString(36).padStart(8, '0')}`
}

export interface Effect {
  key: string
  /** null 表示「没有 / 关」 */
  val: unknown
}

/** 一条记录拆成的字段写（readAll 不在这里，见 marksOf） */
export function effectsOf(e: SyncOp): Effect[] {
  switch (e.op) {
    case 'sub': {
      const f = e.feed
      return [
        { key: `sub:${f.id}`, val: { url: f.url, ...(f.siteUrl ? { siteUrl: f.siteUrl } : {}) } },
        { key: `feed:${f.id}:title`, val: f.title },
        { key: `feed:${f.id}:folder`, val: f.folderId },
        { key: `feed:${f.id}:kind`, val: f.kind },
        { key: `feed:${f.id}:interval`, val: f.intervalMin },
      ]
    }
    case 'unsub':
      return [{ key: `sub:${e.feedId}`, val: null }]
    case 'feed': {
      const out: Effect[] = []
      if (e.title !== undefined) out.push({ key: `feed:${e.feedId}:title`, val: e.title })
      if (e.folderId !== undefined) out.push({ key: `feed:${e.feedId}:folder`, val: e.folderId })
      if (e.kind !== undefined) out.push({ key: `feed:${e.feedId}:kind`, val: e.kind })
      if (e.intervalMin !== undefined) out.push({ key: `feed:${e.feedId}:interval`, val: e.intervalMin })
      if (e.mode !== undefined) out.push({ key: `feed:${e.feedId}:mode`, val: e.mode })
      if (e.digestEvery !== undefined) out.push({ key: `feed:${e.feedId}:digest`, val: e.digestEvery })
      return out
    }
    case 'folder': {
      const out: Effect[] = [{ key: `folder:${e.id}`, val: true }]
      if (e.name !== undefined) out.push({ key: `folder:${e.id}:name`, val: e.name })
      if (e.order !== undefined) out.push({ key: `folder:${e.id}:order`, val: e.order })
      return out
    }
    case 'unfolder':
      return [{ key: `folder:${e.id}`, val: null }]
    case 'read':
      return e.ids.map((id) => ({ key: `read:${id}`, val: e.on }))
    case 'readAll':
      return []
    case 'star':
      return [{ key: `star:${e.id}`, val: e.on ? (e.art ?? true) : null }]
    case 'later':
      return [{ key: `later:${e.id}`, val: e.on ? (e.art ?? true) : null }]
    case 'hl':
      return [{ key: `hl:${e.h.id}`, val: { ...e.h, ...(e.art ? { art: e.art } : {}) } }]
    case 'unhl':
      return [{ key: `hl:${e.id}`, val: null }]
  }
}

export interface ReadMark {
  feedId: string
  before: number
  ord: string
}

export const marksOf = (e: SyncEvent): ReadMark[] => (e.op === 'readAll' ? e.feedIds.map((feedId) => ({ feedId, before: e.before, ord: ordOf(e) })) : [])

/** 一行 → 一条记录；不认识、写坏的（最后一行没写完）返回 null */
export function parseLine(line: string): SyncEvent | null {
  const s = line.trim()
  if (!s) return null
  let e: unknown
  try {
    e = JSON.parse(s)
  } catch {
    return null
  }
  if (!e || typeof e !== 'object') return null
  const o = e as Record<string, unknown>
  if (o['v'] !== 1 || typeof o['d'] !== 'string' || !Number.isInteger(o['s']) || typeof o['t'] !== 'number' || typeof o['op'] !== 'string') return null
  if (!OPS.has(o['op'])) return null
  return e as SyncEvent
}
const OPS = new Set(['sub', 'unsub', 'feed', 'folder', 'unfolder', 'read', 'readAll', 'star', 'later', 'hl', 'unhl'])

export const formatLine = (e: SyncEvent) => JSON.stringify(e) + '\n'

// ---------------------------------------------------------------- 纯重放（测试和 iPad 版照它；本机库是同一套规矩的增量版）

export interface Replayed {
  /** 字段 → 赢的那次写 */
  fields: Map<string, { ord: string; val: unknown }>
  marks: ReadMark[]
}

export function replay(events: Iterable<SyncEvent>): Replayed {
  const fields = new Map<string, { ord: string; val: unknown }>()
  const marks: ReadMark[] = []
  const seen = new Set<string>()
  for (const e of events) {
    const id = `${e.d}|${e.s}`
    if (seen.has(id)) continue
    seen.add(id)
    const ord = ordOf(e)
    for (const f of effectsOf(e)) {
      const cur = fields.get(f.key)
      if (!cur || ord > cur.ord) fields.set(f.key, { ord, val: f.val })
    }
    marks.push(...marksOf(e))
  }
  marks.sort((a, b) => (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : a.feedId.localeCompare(b.feedId)))
  return { fields, marks }
}

/** 一篇文章是不是已读：自己的 read 写和盖住它的 readAll 里 ord 最大的说了算 */
export function isRead(r: Replayed, article: { id: string; feedId: string; publishedAt: number }): boolean {
  const own = r.fields.get(`read:${article.id}`)
  let best = own ? { ord: own.ord, read: own.val === true } : null
  for (const m of r.marks) if (m.feedId === article.feedId && article.publishedAt <= m.before && (!best || m.ord > best.ord)) best = { ord: m.ord, read: true }
  return best?.read ?? false
}

/** 重放的结果变成一张便于比较的表（测试：两台设备不管怎么合，这张表都一样） */
export function snapshotOf(r: Replayed): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of [...r.fields].sort(([a], [b]) => (a < b ? -1 : 1))) out[k] = v.val
  out['#marks'] = r.marks.map((m) => `${m.feedId}<=${m.before}@${m.ord}`)
  return out
}

/** 混合逻辑时钟 */
export class Clock {
  constructor(private last = 0) {}
  get value() {
    return this.last
  }
  tick(now: number): number {
    this.last = Math.max(now, this.last + 1)
    return this.last
  }
  see(t: number) {
    if (t > this.last) this.last = t
  }
}
