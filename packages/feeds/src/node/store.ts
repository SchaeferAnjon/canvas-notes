/**
 * 本机库：node:sqlite（Node 22.5+、Electron 主进程自带，不用编原生模块），一个文件 feeds.sqlite，WAL。
 *
 * 两层：
 * - 同步那层：events（所有设备的记录，按设备 + 序号去重）、lww（每个字段赢的那次写，规矩见 ../sync.ts）、marks（整源已读）。
 *   订阅表、文件夹、已读、星标、稍后读、划线都由这一层「物化」出来（matFeed、matFolder、matState、matHighlight），
 *   本机的操作也是先写成一条记录再走同一条路，所以本机改的和别的设备同步来的结果一样。
 * - 抓取那层：feeds 的抓取状态（etag、下次抓、失败次数，只在本机）、articles（正文、摘要、全文缓存）、articles_fts（搜索）、gone（清掉过的，别再抓回来）。
 *
 * 迁移：PRAGMA user_version 记到第几步，MIGRATIONS 里按顺序往后加，只加不改。
 */
import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import { articleIdOf, contentHash, dedupeKey } from '../ids'
import type { ParsedFeed } from '../parse'
import { sanitizeHtml } from '../sanitize'
import { Clock, effectsOf, marksOf, ordOf, type ArticleSnap, type SyncEvent, type SyncOp } from '../sync'
import { htmlToText, summaryOf } from '../text'
import type { ArticleDetail, ArticleQuery, ArticleRow, Counts, Enclosure, Feed, FeedKind, FeedMode, Folder, Highlight, SearchHit, ViewId } from '../types'
import { DEFAULT_DIGEST_EVERY, FEED_KINDS, FEED_MODES, MIN_INTERVAL_MIN } from '../types'
import { decodeCursor, encodeCursor, pageLimit } from '../view'

export const MIGRATIONS: string[] = [
  // 1：第一版
  `
  CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE events(device TEXT NOT NULL, seq INTEGER NOT NULL, ord TEXT NOT NULL, line TEXT NOT NULL, PRIMARY KEY(device, seq));
  CREATE TABLE lww(key TEXT PRIMARY KEY, ord TEXT NOT NULL, val TEXT);
  CREATE TABLE marks(feed_id TEXT NOT NULL, before INTEGER NOT NULL, ord TEXT NOT NULL, PRIMARY KEY(feed_id, ord));
  CREATE TABLE folders(id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE feeds(
    id TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'article', folder_id TEXT,
    interval_min INTEGER NOT NULL DEFAULT 30, added_at INTEGER NOT NULL,
    fetch_url TEXT, feed_title TEXT, site_url TEXT, icon_url TEXT, description TEXT,
    etag TEXT, last_modified TEXT, last_fetched_at INTEGER, next_fetch_at INTEGER,
    error_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, broken INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE articles(
    id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, guid TEXT, url TEXT, title TEXT NOT NULL, author TEXT,
    published_at INTEGER NOT NULL, updated_at INTEGER, fetched_at INTEGER NOT NULL,
    summary TEXT NOT NULL, content_html TEXT NOT NULL, content_hash TEXT NOT NULL, image_url TEXT, enclosures TEXT NOT NULL DEFAULT '[]',
    full_html TEXT, full_md TEXT, full_url TEXT, full_title TEXT, byline TEXT, site_name TEXT, full_fetched_at INTEGER,
    dup_of TEXT
  );
  CREATE INDEX articles_feed_time ON articles(feed_id, published_at DESC, id DESC);
  CREATE INDEX articles_time ON articles(published_at DESC, id DESC);
  CREATE INDEX articles_url ON articles(url);
  CREATE INDEX articles_hash ON articles(feed_id, content_hash);
  CREATE TABLE state(article_id TEXT PRIMARY KEY, read INTEGER NOT NULL DEFAULT 0, read_ord TEXT, starred INTEGER NOT NULL DEFAULT 0, later INTEGER NOT NULL DEFAULT 0, snap TEXT);
  CREATE INDEX state_flags ON state(starred, later);
  CREATE TABLE highlights(id TEXT PRIMARY KEY, article_id TEXT NOT NULL, anchor TEXT NOT NULL, note TEXT, color TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
  CREATE INDEX highlights_article ON highlights(article_id);
  CREATE TABLE gone(id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, at INTEGER NOT NULL);
  CREATE TABLE sync_files(device TEXT PRIMARY KEY, offset INTEGER NOT NULL);
  CREATE VIRTUAL TABLE articles_fts USING fts5(title, body, content='', contentless_delete=1, tokenize='trigram');
  `,
  // 2：源进不进列表（逐条 / 静音 / 汇总）、汇总每几篇
  `
  ALTER TABLE feeds ADD COLUMN mode TEXT NOT NULL DEFAULT 'normal';
  ALTER TABLE feeds ADD COLUMN digest_every INTEGER NOT NULL DEFAULT 20;
  `,
]

/** 一篇正文最多存多少（源里给的、抓的全文各自） */
export const MAX_CONTENT = 512 * 1024
export const MAX_FULL = 1024 * 1024
/** 一次抓最多收几条 */
export const MAX_ITEMS = 500
const DAY = 86_400_000

type Row = Record<string, SQLInputValue>

export class Store {
  readonly db: DatabaseSync
  readonly clock: Clock

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;')
    this.migrate()
    this.clock = new Clock(Number(this.meta('clock') ?? 0))
  }

  close() {
    this.db.close()
  }

  get version(): number {
    return Number((this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version)
  }

  private migrate() {
    for (let v = this.version; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[v]!)
        this.db.exec(`PRAGMA user_version = ${v + 1}`)
      })
    }
  }

  private depth = 0
  tx<T>(f: () => T): T {
    if (this.depth) return f()
    this.depth++
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = f()
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    } finally {
      this.depth--
    }
  }

  private all<T>(sql: string, ...args: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...args) as T[]
  }
  private get<T>(sql: string, ...args: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...args) as T | undefined
  }
  /** 返回改了几行。lastInsertRowid 按 BigInt 读：FTS5 自己的表行号很大，按 number 读会报错 */
  private run(sql: string, ...args: SQLInputValue[]): { changes: number } {
    const st = this.db.prepare(sql)
    st.setReadBigInts(true)
    return { changes: Number(st.run(...args).changes) }
  }

  meta(key: string): string | undefined {
    return this.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key)?.value
  }
  setMeta(key: string, value: string) {
    this.run('INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value)
  }

  // ------------------------------------------------------------ 同步那层

  /** 本机做了一件事：写成一条记录（本机的序号、时钟往前走）并物化 */
  local(device: string, op: SyncOp, now: number): SyncEvent {
    return this.tx(() => {
      const s = Number(this.meta(`seq:${device}`) ?? 0) + 1
      this.setMeta(`seq:${device}`, String(s))
      const t = this.clock.tick(now)
      this.setMeta('clock', String(t))
      const ev = { v: 1, d: device, s, t, ...op } as SyncEvent
      this.apply(ev)
      return ev
    })
  }

  /** 一条记录（本机的或别的设备的）进库；已经有了返回 false */
  apply(ev: SyncEvent): boolean {
    return this.tx(() => {
      const ord = ordOf(ev)
      const r = this.run('INSERT INTO events(device, seq, ord, line) VALUES(?, ?, ?, ?) ON CONFLICT DO NOTHING', ev.d, ev.s, ord, JSON.stringify(ev))
      if (!r.changes) return false
      if (ev.t > this.clock.value) {
        this.clock.see(ev.t)
        this.setMeta('clock', String(ev.t))
      }
      for (const e of effectsOf(ev)) {
        const w = this.run('INSERT INTO lww(key, ord, val) VALUES(?, ?, ?) ON CONFLICT(key) DO UPDATE SET ord = excluded.ord, val = excluded.val WHERE excluded.ord > lww.ord', e.key, ord, JSON.stringify(e.val))
        if (w.changes) this.materialize(e.key)
      }
      for (const m of marksOf(ev)) {
        this.run('INSERT INTO marks(feed_id, before, ord) VALUES(?, ?, ?) ON CONFLICT DO NOTHING', m.feedId, m.before, m.ord)
        // 盖住的文章：比它们现在的已读决定晚的，标已读
        this.run(
          `INSERT INTO state(article_id, read, read_ord) SELECT id, 1, ? FROM articles WHERE feed_id = ? AND published_at <= ?
           ON CONFLICT(article_id) DO UPDATE SET read = 1, read_ord = excluded.read_ord WHERE state.read_ord IS NULL OR state.read_ord < excluded.read_ord`,
          m.ord,
          m.feedId,
          m.before,
        )
      }
      return true
    })
  }

  private lww(key: string): { ord: string; val: unknown } | undefined {
    const r = this.get<{ ord: string; val: string | null }>('SELECT ord, val FROM lww WHERE key = ?', key)
    return r ? { ord: r.ord, val: r.val === null ? null : JSON.parse(r.val) } : undefined
  }

  private materialize(key: string) {
    const [kind, id] = key.split(':') as [string, string]
    if (kind === 'sub' || kind === 'feed') this.matFeed(id)
    else if (kind === 'folder') this.matFolder(id)
    else if (kind === 'read' || kind === 'star' || kind === 'later') this.matState(id)
    else if (kind === 'hl') this.matHighlight(id)
  }

  private matFeed(id: string) {
    const w = this.lww(`sub:${id}`)
    const sub = w?.val as { url: string; siteUrl?: string } | null | undefined
    if (!w || !sub) {
      if (this.get('SELECT 1 FROM feeds WHERE id = ?', id)) this.dropFeed(id)
      return
    }
    const title = (this.lww(`feed:${id}:title`)?.val as string | undefined) ?? ''
    const kind = (this.lww(`feed:${id}:kind`)?.val as FeedKind | undefined) ?? 'article'
    const folder = (this.lww(`feed:${id}:folder`)?.val as string | null | undefined) ?? null
    const interval = Math.max(MIN_INTERVAL_MIN, Number(this.lww(`feed:${id}:interval`)?.val ?? 30))
    const modeVal = this.lww(`feed:${id}:mode`)?.val as FeedMode | undefined
    const mode = modeVal && FEED_MODES.includes(modeVal) ? modeVal : 'normal'
    const every = Math.max(2, Math.round(Number(this.lww(`feed:${id}:digest`)?.val ?? DEFAULT_DIGEST_EVERY)))
    // 订阅的时间：赢的那次 sub 的时钟
    const added = parseInt(w.ord.split('|')[0]!, 36)
    this.run(
      `INSERT INTO feeds(id, url, title, kind, folder_id, interval_min, added_at, site_url, mode, digest_every) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET url = excluded.url, title = excluded.title, kind = excluded.kind, folder_id = excluded.folder_id,
         interval_min = excluded.interval_min, added_at = excluded.added_at, site_url = COALESCE(feeds.site_url, excluded.site_url),
         mode = excluded.mode, digest_every = excluded.digest_every`,
      id,
      sub.url,
      title,
      FEED_KINDS.includes(kind) ? kind : 'article',
      folder,
      interval,
      added,
      sub.siteUrl ?? null,
      mode,
      every,
    )
  }

  /** 退订：文章清掉（星标、稍后读、划线过的留着），抓取状态没了；状态表留着（再订回来还认） */
  private dropFeed(id: string) {
    const ids = this.all<{ id: string; rowid: number }>(
      `SELECT a.id, a.rowid FROM articles a LEFT JOIN state s ON s.article_id = a.id
       WHERE a.feed_id = ? AND COALESCE(s.starred, 0) = 0 AND COALESCE(s.later, 0) = 0 AND NOT EXISTS (SELECT 1 FROM highlights h WHERE h.article_id = a.id)`,
      id,
    )
    for (const r of ids) {
      this.run('DELETE FROM articles_fts WHERE rowid = ?', r.rowid)
      this.run('DELETE FROM articles WHERE id = ?', r.id)
    }
    this.run('DELETE FROM feeds WHERE id = ?', id)
  }

  private matFolder(id: string) {
    const alive = this.lww(`folder:${id}`)?.val
    if (!alive) {
      this.run('DELETE FROM folders WHERE id = ?', id)
      return
    }
    const name = (this.lww(`folder:${id}:name`)?.val as string | undefined) ?? '文件夹'
    const order = Number(this.lww(`folder:${id}:order`)?.val ?? 0)
    this.run('INSERT INTO folders(id, name, sort) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort = excluded.sort', id, name, order)
  }

  /** 一篇的已读、星标、稍后读（已读看自己的写和盖住它的整源已读，ord 大的赢） */
  matState(id: string) {
    const read = this.lww(`read:${id}`)
    const star = this.lww(`star:${id}`)
    const later = this.lww(`later:${id}`)
    const art = this.get<{ feed_id: string; published_at: number }>('SELECT feed_id, published_at FROM articles WHERE id = ?', id)
    const snapVal = [star?.val, later?.val].find((v) => v && typeof v === 'object') as ArticleSnap | undefined
    const where = art ?? (snapVal ? { feed_id: snapVal.feedId, published_at: snapVal.publishedAt } : undefined)
    let best = read ? { ord: read.ord, on: read.val === true } : null
    if (where) {
      const m = this.get<{ ord: string }>('SELECT ord FROM marks WHERE feed_id = ? AND before >= ? ORDER BY ord DESC LIMIT 1', where.feed_id, where.published_at)
      if (m && (!best || m.ord > best.ord)) best = { ord: m.ord, on: true }
    }
    const hasHl = !!this.get('SELECT 1 FROM highlights WHERE article_id = ?', id)
    if (!best && !star?.val && !later?.val && !hasHl) {
      this.run('DELETE FROM state WHERE article_id = ?', id)
      return
    }
    const old = this.get<{ snap: string | null }>('SELECT snap FROM state WHERE article_id = ?', id)
    const snap = snapVal ? JSON.stringify(snapVal) : (old?.snap ?? null)
    this.run(
      `INSERT INTO state(article_id, read, read_ord, starred, later, snap) VALUES(?, ?, ?, ?, ?, ?)
       ON CONFLICT(article_id) DO UPDATE SET read = excluded.read, read_ord = excluded.read_ord, starred = excluded.starred, later = excluded.later, snap = excluded.snap`,
      id,
      best?.on ? 1 : 0,
      best?.ord ?? null,
      star?.val ? 1 : 0,
      later?.val ? 1 : 0,
      snap,
    )
  }

  private matHighlight(id: string) {
    const v = this.lww(`hl:${id}`)?.val as (Highlight & { art?: ArticleSnap }) | null | undefined
    const old = this.get<{ article_id: string }>('SELECT article_id FROM highlights WHERE id = ?', id)
    if (!v) {
      this.run('DELETE FROM highlights WHERE id = ?', id)
      if (old) this.matState(old.article_id)
      return
    }
    this.run(
      `INSERT INTO highlights(id, article_id, anchor, note, color, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET anchor = excluded.anchor, note = excluded.note, color = excluded.color, updated_at = excluded.updated_at`,
      id,
      v.articleId,
      JSON.stringify(v.anchor),
      v.note ?? null,
      v.color ?? null,
      v.createdAt,
      v.updatedAt,
    )
    if (v.art && !this.get('SELECT 1 FROM state WHERE article_id = ? AND snap IS NOT NULL', v.articleId)) {
      this.run('INSERT INTO state(article_id, snap) VALUES(?, ?) ON CONFLICT(article_id) DO UPDATE SET snap = excluded.snap', v.articleId, JSON.stringify(v.art))
    }
  }

  /** 这台设备在某个库里已经写出去的最大序号之后的本机记录 */
  ownEvents(device: string, afterSeq: number): SyncEvent[] {
    return this.all<{ line: string }>('SELECT line FROM events WHERE device = ? AND seq > ? ORDER BY seq', device, afterSeq).map((r) => JSON.parse(r.line) as SyncEvent)
  }

  // ------------------------------------------------------------ 订阅表

  listFolders(): Folder[] {
    return this.all<{ id: string; name: string; sort: number }>('SELECT id, name, sort FROM folders ORDER BY sort, name').map((r) => ({ id: r.id, name: r.name, order: r.sort }))
  }

  folderExists(id: string) {
    return !!this.get('SELECT 1 FROM folders WHERE id = ?', id)
  }

  listFeeds(): Feed[] {
    const unread = this.unreadByFeed()
    return this.all<FeedDb>(`SELECT f.*, fo.id AS folder_ok FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id ORDER BY f.title COLLATE NOCASE, f.id`).map((r) => feedOf(r, unread[r.id] ?? 0))
  }

  getFeed(id: string): Feed | null {
    const r = this.get<FeedDb>('SELECT f.*, fo.id AS folder_ok FROM feeds f LEFT JOIN folders fo ON fo.id = f.folder_id WHERE f.id = ?', id)
    return r ? feedOf(r, this.unreadByFeed(id)[id] ?? 0) : null
  }

  /** 抓取状态（只在本机） */
  feedFetch(id: string): FetchRow | undefined {
    return this.get<FetchRow>('SELECT id, url, fetch_url, etag, last_modified, interval_min, error_count, next_fetch_at, site_url FROM feeds WHERE id = ?', id)
  }

  allFetch(): FetchRow[] {
    return this.all<FetchRow>('SELECT id, url, fetch_url, etag, last_modified, interval_min, error_count, next_fetch_at, site_url FROM feeds')
  }

  setFetched(id: string, p: Partial<{ fetch_url: string | null; etag: string | null; last_modified: string | null; last_fetched_at: number; next_fetch_at: number; error_count: number; last_error: string | null; broken: number; feed_title: string; site_url: string; icon_url: string; description: string }>) {
    const keys = Object.keys(p) as (keyof typeof p)[]
    if (!keys.length) return
    this.run(`UPDATE feeds SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => (p[k] ?? null) as SQLInputValue), id)
  }

  // ------------------------------------------------------------ 抓到的文章进库

  /** 返回新进来的那几篇的编号 */
  ingest(feedId: string, parsed: ParsedFeed, now: number, retentionDays: number): string[] {
    return this.tx(() => {
      const feed = this.feedFetch(feedId)
      if (!feed) return []
      const cut = now - retentionDays * DAY
      const added: string[] = []
      const items = parsed.items.slice(0, MAX_ITEMS)
      items.forEach((item, i) => {
        const key = dedupeKey(item)
        const id = articleIdOf(feedId, key)
        if (this.get('SELECT 1 FROM gone WHERE id = ?', id)) return
        const raw = item.contentHtml ?? item.summaryHtml ?? ''
        const hash = contentHash({ title: item.title, contentHtml: raw, ...(item.summaryHtml ? { summary: item.summaryHtml } : {}) })
        const old = this.get<{ content_hash: string; published_at: number }>('SELECT content_hash, published_at FROM articles WHERE id = ?', id)
        const base = item.url ?? feed.site_url ?? feed.fetch_url ?? feed.url
        const content = () => sanitizeHtml(raw.length > MAX_CONTENT ? raw.slice(0, MAX_CONTENT) : raw, base.startsWith('rsshub:') ? 'https://localhost/' : base)
        const summary = summaryOf(item.summaryHtml || raw)
        if (old) {
          if (old.content_hash === hash) return
          // 同一篇改过（guid 一样、内容变了）：换正文，已读这些不动
          const html = content()
          this.run('UPDATE articles SET title = ?, url = ?, author = ?, updated_at = ?, summary = ?, content_html = ?, content_hash = ?, image_url = ? WHERE id = ?', item.title, item.url ?? null, item.author ?? null, item.updatedAt ?? now, summary, html, hash, item.imageUrl ?? null, id)
          this.reindex(id)
          return
        }
        // guid 换了写法但链接一样、或者都没有但内容一样：当同一篇
        if (item.url && this.get('SELECT 1 FROM articles WHERE feed_id = ? AND url = ?', feedId, item.url)) return
        if (!item.url && this.get('SELECT 1 FROM articles WHERE feed_id = ? AND content_hash = ?', feedId, hash)) return
        let published = item.publishedAt ?? now - i
        if (published > now + 2 * DAY) published = now - i
        if (published < cut) return
        const dup = item.url ? this.get<{ id: string }>('SELECT id FROM articles WHERE url = ? AND feed_id <> ? AND dup_of IS NULL LIMIT 1', item.url, feedId) : undefined
        this.run(
          `INSERT INTO articles(id, feed_id, guid, url, title, author, published_at, updated_at, fetched_at, summary, content_html, content_hash, image_url, enclosures, dup_of)
           VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          feedId,
          item.guid ?? null,
          item.url ?? null,
          item.title,
          item.author ?? null,
          published,
          item.updatedAt ?? null,
          now,
          summary,
          content(),
          hash,
          item.imageUrl ?? null,
          JSON.stringify(item.enclosures),
          dup?.id ?? null,
        )
        this.reindex(id)
        if (this.get('SELECT 1 FROM lww WHERE key IN (?, ?, ?)', `read:${id}`, `star:${id}`, `later:${id}`) || this.get('SELECT 1 FROM marks WHERE feed_id = ? AND before >= ?', feedId, published)) this.matState(id)
        added.push(id)
      })
      return added
    })
  }

  /** 搜索表里这一篇重写一遍（标题、正文、全文） */
  reindex(id: string) {
    const r = this.get<{ rowid: number; title: string; content_html: string; full_html: string | null; summary: string }>('SELECT rowid, title, content_html, full_html, summary FROM articles WHERE id = ?', id)
    if (!r) return
    this.run('DELETE FROM articles_fts WHERE rowid = ?', r.rowid)
    const body = [htmlToText(r.content_html) || r.summary, r.full_html ? htmlToText(r.full_html) : ''].filter(Boolean).join('\n')
    this.run('INSERT INTO articles_fts(rowid, title, body) VALUES(?, ?, ?)', r.rowid, r.title, body)
  }

  setFull(id: string, f: { html: string; markdown: string; url: string; title: string; byline?: string; siteName?: string }, now: number) {
    this.tx(() => {
      this.run(
        'UPDATE articles SET full_html = ?, full_md = ?, full_url = ?, full_title = ?, byline = ?, site_name = ?, full_fetched_at = ? WHERE id = ?',
        f.html.length > MAX_FULL ? f.html.slice(0, MAX_FULL) : f.html,
        f.markdown.length > MAX_FULL ? f.markdown.slice(0, MAX_FULL) : f.markdown,
        f.url,
        f.title,
        f.byline ?? null,
        f.siteName ?? null,
        now,
        id,
      )
      this.reindex(id)
    })
  }

  full(id: string): { html: string; markdown: string; url: string; title: string; byline?: string; siteName?: string } | null {
    const r = this.get<{ full_html: string | null; full_md: string | null; full_url: string | null; full_title: string | null; byline: string | null; site_name: string | null }>('SELECT full_html, full_md, full_url, full_title, byline, site_name FROM articles WHERE id = ?', id)
    if (!r?.full_html || r.full_md === null) return null
    return { html: r.full_html, markdown: r.full_md, url: r.full_url ?? '', title: r.full_title ?? '', ...(r.byline ? { byline: r.byline } : {}), ...(r.site_name ? { siteName: r.site_name } : {}) }
  }

  // ------------------------------------------------------------ 清理

  /** 太旧的（没星标、没稍后读、没划线）和每个源超出上限的清掉，记进 gone 别再抓回来；返回清掉几篇 */
  prune(now: number, retentionDays: number, maxPerFeed: number): number {
    return this.tx(() => {
      const keep = `COALESCE(s.starred, 0) = 0 AND COALESCE(s.later, 0) = 0 AND NOT EXISTS (SELECT 1 FROM highlights h WHERE h.article_id = a.id)`
      const old = this.all<{ id: string; rowid: number; feed_id: string }>(`SELECT a.id, a.rowid, a.feed_id FROM articles a LEFT JOIN state s ON s.article_id = a.id WHERE a.published_at < ? AND ${keep}`, now - retentionDays * DAY)
      const over = this.all<{ id: string; rowid: number; feed_id: string }>(
        `SELECT id, rowid, feed_id FROM (SELECT a.id, a.rowid, a.feed_id, ROW_NUMBER() OVER (PARTITION BY a.feed_id ORDER BY a.published_at DESC, a.id DESC) AS n, ${keep} AS can
         FROM articles a LEFT JOIN state s ON s.article_id = a.id) WHERE n > ? AND can`,
        maxPerFeed,
      )
      const seen = new Set<string>()
      for (const r of [...old, ...over]) {
        if (seen.has(r.id)) continue
        seen.add(r.id)
        this.run('DELETE FROM articles_fts WHERE rowid = ?', r.rowid)
        this.run('DELETE FROM articles WHERE id = ?', r.id)
        this.run('INSERT INTO gone(id, feed_id, at) VALUES(?, ?, ?) ON CONFLICT(id) DO UPDATE SET at = excluded.at', r.id, r.feed_id, now)
        this.run('DELETE FROM state WHERE article_id = ? AND starred = 0 AND later = 0', r.id)
      }
      // 一年前清掉的不用再记（源里不会留一年前的条目）
      this.run('DELETE FROM gone WHERE at < ?', now - 400 * DAY)
      return seen.size
    })
  }

  // ------------------------------------------------------------ 列表、计数、搜索

  private unreadByFeed(only?: string): Record<string, number> {
    const rows = this.all<{ feed_id: string; n: number }>(
      `SELECT a.feed_id, count(*) AS n FROM articles a LEFT JOIN state s ON s.article_id = a.id WHERE COALESCE(s.read, 0) = 0 ${only ? 'AND a.feed_id = ?' : ''} GROUP BY a.feed_id`,
      ...(only ? [only] : []),
    )
    return Object.fromEntries(rows.map((r) => [r.feed_id, Number(r.n)]))
  }

  counts(): Counts {
    const views = { all: 0, later: 0, starred: 0, highlights: 0 } as Record<ViewId, number>
    for (const k of FEED_KINDS) views[k] = 0
    const byFeed: Record<string, number> = {}
    const byFolder: Record<string, number> = {}
    for (const f of this.all<{ id: string }>('SELECT id FROM feeds')) byFeed[f.id] = 0
    const rows = this.all<{ id: string; kind: FeedKind; mode: FeedMode; folder: string | null; n: number; nodup: number }>(
      `SELECT f.id, f.kind, f.mode, fo.id AS folder, count(a.id) AS n, sum(CASE WHEN a.dup_of IS NULL THEN 1 ELSE 0 END) AS nodup
       FROM feeds f JOIN articles a ON a.feed_id = f.id LEFT JOIN state s ON s.article_id = a.id LEFT JOIN folders fo ON fo.id = f.folder_id
       WHERE COALESCE(s.read, 0) = 0 GROUP BY f.id`,
    )
    for (const r of rows) {
      byFeed[r.id] = Number(r.n)
      // 静音、汇总的源不进「全部」、类型视图和文件夹的未读数（点开这个源才看得到）
      if (r.mode !== 'normal') continue
      if (r.folder) byFolder[r.folder] = (byFolder[r.folder] ?? 0) + Number(r.n)
      views.all += Number(r.nodup)
      views[r.kind] += Number(r.nodup)
    }
    const shown = `(s.snap IS NOT NULL OR EXISTS (SELECT 1 FROM articles a WHERE a.id = s.article_id))`
    views.later = Number(this.get<{ n: number }>(`SELECT count(*) AS n FROM state s WHERE s.later = 1 AND ${shown}`)!.n)
    views.starred = Number(this.get<{ n: number }>(`SELECT count(*) AS n FROM state s WHERE s.starred = 1 AND ${shown}`)!.n)
    views.highlights = Number(this.get<{ n: number }>('SELECT count(DISTINCT article_id) AS n FROM highlights')!.n)
    return { feeds: byFeed, folders: byFolder, views }
  }

  listArticles(q: ArticleQuery): { rows: ArticleRow[]; next?: string } {
    const view = q.view ?? 'all'
    const limit = pageLimit(q)
    const after = decodeCursor(q.cursor)
    const where: string[] = []
    const args: SQLInputValue[] = []
    const flagView = view === 'later' || view === 'starred' || view === 'highlights'
    if (view === 'later') where.push('later = 1')
    else if (view === 'starred') where.push('starred = 1')
    else if (view === 'highlights') where.push('hl > 0')
    else {
      where.push('subscribed = 1')
      if (view !== 'all') {
        where.push('kind = ?')
        args.push(view)
      }
      if (!q.feedId) where.push('dup_of IS NULL')
      // 静音、汇总的源：只在点开这个源时逐篇列
      if (!q.feedId) where.push("fmode = 'normal'")
    }
    if (q.feedId) {
      where.push('feed_id = ?')
      args.push(q.feedId)
    }
    if (q.folderId) {
      where.push('folder_id = ?')
      args.push(q.folderId)
    }
    if (q.unreadOnly) where.push('read = 0')
    if (after) {
      where.push('(published_at < ? OR (published_at = ? AND id < ?))')
      args.push(after.publishedAt, after.publishedAt, after.id)
    }
    const sql = `SELECT * FROM (${articleRowsSql(flagView)}) WHERE ${where.join(' AND ') || '1'} ORDER BY published_at DESC, id DESC LIMIT ?`
    const rows = this.all<ArticleDb>(sql, ...args, limit + 1).map(rowOf)
    const page = rows.slice(0, limit)
    return rows.length > limit ? { rows: page, next: encodeCursor(page[page.length - 1]!) } : { rows: page }
  }

  article(id: string): ArticleDetail | null {
    const r = this.get<ArticleDb & { content_html: string | null; full_html: string | null; full_fetched_at: number | null }>(
      `SELECT r.*, a.content_html, a.full_html, a.full_fetched_at FROM (${articleRowsSql(true)}) r LEFT JOIN articles a ON a.id = r.id WHERE r.id = ?`,
      id,
    )
    if (!r) return null
    const d: ArticleDetail = { ...rowOf(r), contentHtml: r.content_html ?? '' }
    if (r.full_html) d.fullHtml = r.full_html
    if (r.full_fetched_at) d.fullFetchedAt = r.full_fetched_at
    return d
  }

  /** 已读用：把去重藏起来的那几篇（别的源里的同一篇）一起带上 */
  withDuplicates(ids: string[]): string[] {
    if (!ids.length) return ids
    const extra = this.all<{ id: string }>(`SELECT id FROM articles WHERE dup_of IN (${ids.map(() => '?').join(',')})`, ...ids).map((r) => r.id)
    return [...new Set([...ids, ...extra])]
  }

  /** 范围里 before 以前发表、还没读的源 */
  feedsIn(scope: { feedId: string } | { folderId: string } | { view: string }): string[] {
    if ('feedId' in scope) return this.get('SELECT 1 FROM feeds WHERE id = ?', scope.feedId) ? [scope.feedId] : []
    if ('folderId' in scope) return this.all<{ id: string }>('SELECT id FROM feeds WHERE folder_id = ?', scope.folderId).map((r) => r.id)
    if (scope.view === 'all') return this.all<{ id: string }>('SELECT id FROM feeds').map((r) => r.id)
    return this.all<{ id: string }>('SELECT id FROM feeds WHERE kind = ?', scope.view).map((r) => r.id)
  }

  snapOf(id: string): ArticleSnap | undefined {
    const a = this.get<{ feed_id: string; title: string; url: string | null; published_at: number }>('SELECT feed_id, title, url, published_at FROM articles WHERE id = ?', id)
    if (a) return { feedId: a.feed_id, title: a.title, ...(a.url ? { url: a.url } : {}), publishedAt: a.published_at }
    const s = this.get<{ snap: string | null }>('SELECT snap FROM state WHERE article_id = ?', id)
    return s?.snap ? (JSON.parse(s.snap) as ArticleSnap) : undefined
  }

  highlights(articleId?: string): Highlight[] {
    const rows = this.all<{ id: string; article_id: string; anchor: string; note: string | null; color: string | null; created_at: number; updated_at: number }>(
      `SELECT * FROM highlights ${articleId ? 'WHERE article_id = ?' : ''} ORDER BY created_at, id`,
      ...(articleId ? [articleId] : []),
    )
    return rows.map((r) => ({ id: r.id, articleId: r.article_id, anchor: JSON.parse(r.anchor), ...(r.note ? { note: r.note } : {}), ...(r.color ? { color: r.color } : {}), createdAt: r.created_at, updatedAt: r.updated_at }))
  }

  /** 搜索：三个字以上的词走 trigram 全文索引，短词（「缓存」）用 LIKE 在候选里筛；按发表时间新的在前 */
  search(query: string, limit = 50, feedId?: string): SearchHit[] {
    const terms = [...new Set(query.trim().split(/\s+/).filter(Boolean))].slice(0, 8)
    if (!terms.length) return []
    const long = terms.filter((t) => [...t].length >= 3)
    const short = terms.filter((t) => [...t].length < 3)
    const where: string[] = []
    const args: SQLInputValue[] = []
    if (long.length) {
      where.push('a.rowid IN (SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?)')
      args.push(long.map((t) => `"${t.replace(/"/g, '""')}"`).join(' '))
    }
    for (const t of short) {
      const like = `%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`
      where.push(`(a.title LIKE ? ESCAPE '\\' OR a.summary LIKE ? ESCAPE '\\' OR a.content_html LIKE ? ESCAPE '\\' OR COALESCE(a.full_html, '') LIKE ? ESCAPE '\\')`)
      args.push(like, like, like, like)
    }
    if (feedId) {
      where.push('a.feed_id = ?')
      args.push(feedId)
    }
    const ids = this.all<{ id: string; title: string; content_html: string; full_html: string | null }>(
      `SELECT a.id, a.title, a.content_html, a.full_html FROM articles a WHERE ${where.join(' AND ')} ORDER BY a.published_at DESC, a.id DESC LIMIT ?`,
      ...args,
      Math.max(1, Math.min(200, limit)),
    )
    const out: SearchHit[] = []
    for (const r of ids) {
      const row = this.listOne(r.id)
      if (!row) continue
      out.push({ row, snippet: snippet(`${r.title}\n${htmlToText(r.content_html)}\n${r.full_html ? htmlToText(r.full_html) : ''}`, terms) })
    }
    return out
  }

  private listOne(id: string): ArticleRow | null {
    const r = this.get<ArticleDb>(`SELECT * FROM (${articleRowsSql(true)}) WHERE id = ?`, id)
    return r ? rowOf(r) : null
  }

  stats(): { feeds: number; broken: number; nextRunAt?: number; lastRunAt?: number } {
    const r = this.get<{ n: number; broken: number; next: number | null; last: number | null }>('SELECT count(*) AS n, sum(broken) AS broken, min(next_fetch_at) AS next, max(last_fetched_at) AS last FROM feeds')!
    return { feeds: Number(r.n), broken: Number(r.broken ?? 0), ...(r.next !== null ? { nextRunAt: Number(r.next) } : {}), ...(r.last !== null ? { lastRunAt: Number(r.last) } : {}) }
  }

  /** 每台设备几条记录、最后一条的时间（同步状态用） */
  deviceStats(): { id: string; events: number; lastAt: number }[] {
    return this.all<{ device: string; n: number; ord: string }>('SELECT device, count(*) AS n, max(ord) AS ord FROM events GROUP BY device ORDER BY device').map((r) => ({ id: r.device, events: Number(r.n), lastAt: parseInt(r.ord.split('|')[0]!, 36) }))
  }

  /** 这台设备一共做了几条（最大序号） */
  ownSeq(device: string): number {
    return Number(this.meta(`seq:${device}`) ?? 0)
  }

  syncOffset(device: string): number {
    return Number(this.get<{ offset: number }>('SELECT offset FROM sync_files WHERE device = ?', device)?.offset ?? 0)
  }
  setSyncOffset(device: string, offset: number) {
    this.run('INSERT INTO sync_files(device, offset) VALUES(?, ?) ON CONFLICT(device) DO UPDATE SET offset = excluded.offset', device, offset)
  }
  resetSyncOffsets() {
    this.run('DELETE FROM sync_files')
  }
}

// ---------------------------------------------------------------- 行 → 对象

export interface FetchRow {
  id: string
  url: string
  fetch_url: string | null
  etag: string | null
  last_modified: string | null
  interval_min: number
  error_count: number
  next_fetch_at: number | null
  site_url: string | null
}

interface FeedDb {
  id: string
  url: string
  title: string
  kind: FeedKind
  folder_id: string | null
  folder_ok: string | null
  interval_min: number
  added_at: number
  mode: FeedMode
  digest_every: number
  feed_title: string | null
  site_url: string | null
  icon_url: string | null
  description: string | null
  last_fetched_at: number | null
  next_fetch_at: number | null
  error_count: number
  last_error: string | null
  broken: number
}

function feedOf(r: FeedDb, unread: number): Feed {
  const f: Feed = {
    id: r.id,
    url: r.url,
    title: r.title || r.feed_title || r.url,
    kind: r.kind,
    folderId: r.folder_ok ? r.folder_id : null,
    intervalMin: Number(r.interval_min),
    mode: r.mode ?? 'normal',
    digestEvery: Number(r.digest_every ?? DEFAULT_DIGEST_EVERY),
    addedAt: Number(r.added_at),
    errorCount: Number(r.error_count),
    broken: !!r.broken,
    unread,
  }
  if (r.site_url) f.siteUrl = r.site_url
  if (r.icon_url) f.iconUrl = r.icon_url
  if (r.description) f.description = r.description
  if (r.last_fetched_at !== null) f.lastFetchedAt = Number(r.last_fetched_at)
  if (r.next_fetch_at !== null) f.nextFetchAt = Number(r.next_fetch_at)
  if (r.last_error) f.lastError = r.last_error
  return f
}

interface ArticleDb {
  id: string
  feed_id: string
  url: string | null
  title: string
  author: string | null
  published_at: number
  fetched_at: number
  summary: string
  image_url: string | null
  enclosures: string
  read: number
  starred: number
  later: number
  hl: number
}

/**
 * 列表要的一行：抓到的文章，加上只有快照的（别的设备星标、稍后读、划线了、这台还没抓到或已经退订的）。
 * withSnaps 为 false 时只要抓到的（全部和五种类型的视图）。
 */
function articleRowsSql(withSnaps: boolean): string {
  const hl = `(SELECT count(*) FROM highlights h WHERE h.article_id = %ID%)`
  const fetched = `SELECT a.id, a.feed_id, a.url, a.title, a.author, a.published_at, a.fetched_at, a.summary, a.image_url, a.enclosures, a.dup_of,
      COALESCE(s.read, 0) AS read, COALESCE(s.starred, 0) AS starred, COALESCE(s.later, 0) AS later, ${hl.replace('%ID%', 'a.id')} AS hl,
      f.kind, fo.id AS folder_id, CASE WHEN f.id IS NULL THEN 0 ELSE 1 END AS subscribed, COALESCE(f.mode, 'normal') AS fmode
    FROM articles a LEFT JOIN feeds f ON f.id = a.feed_id LEFT JOIN folders fo ON fo.id = f.folder_id LEFT JOIN state s ON s.article_id = a.id`
  if (!withSnaps) return fetched
  return `${fetched} UNION ALL
    SELECT s.article_id, json_extract(s.snap, '$.feedId'), json_extract(s.snap, '$.url'), json_extract(s.snap, '$.title'), NULL, json_extract(s.snap, '$.publishedAt'), 0, '', NULL, '[]', NULL,
      s.read, s.starred, s.later, ${hl.replace('%ID%', 's.article_id')}, f.kind, fo.id, CASE WHEN f.id IS NULL THEN 0 ELSE 1 END, COALESCE(f.mode, 'normal')
    FROM state s LEFT JOIN feeds f ON f.id = json_extract(s.snap, '$.feedId') LEFT JOIN folders fo ON fo.id = f.folder_id
    WHERE s.snap IS NOT NULL AND NOT EXISTS (SELECT 1 FROM articles a WHERE a.id = s.article_id)`
}

function rowOf(r: ArticleDb): ArticleRow {
  const row: ArticleRow = {
    id: r.id,
    feedId: r.feed_id,
    title: r.title ?? '',
    publishedAt: Number(r.published_at),
    fetchedAt: Number(r.fetched_at),
    summary: r.summary ?? '',
    enclosures: JSON.parse(r.enclosures || '[]') as Enclosure[],
    read: !!r.read,
    starred: !!r.starred,
    later: !!r.later,
    highlightCount: Number(r.hl),
  }
  if (r.url) row.url = r.url
  if (r.author) row.author = r.author
  if (r.image_url) row.imageUrl = r.image_url
  return row
}

/** 命中的那一小段：第一个词前 30 字、后 60 字，所有词用 ⟪ ⟫ 括起来 */
export function snippet(text: string, terms: string[]): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const lower = flat.toLowerCase()
  let at = -1
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase())
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0) return flat.slice(0, 90)
  const from = Math.max(0, at - 30)
  let piece = flat.slice(from, at + 90)
  const re = new RegExp(terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
  piece = piece.replace(re, (m) => `⟪${m}⟫`)
  return (from ? '…' : '') + piece + (at + 90 < flat.length ? '…' : '')
}
