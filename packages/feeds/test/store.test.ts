/** 本机库的迁移、退避的数、阅读视图要的正文、不碰 Electron 的规矩 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS, Store } from '../src/node/store'
import { BROKEN_AFTER, dueFeeds, jitter, MAX_BACKOFF_MS, plan, retryAfterMs } from '../src/schedule'
import { openTest, rssOf, tempDir } from './helpers'
import { send, startServer } from './server'

describe('迁移', () => {
  it('新库直接到最新；再打开不重跑；以后加一步只跑新的那一步，旧数据还在', () => {
    const tmp = tempDir()
    const file = join(tmp.dir, 'feeds.sqlite')
    try {
      const a = new Store(file)
      expect(a.version).toBe(MIGRATIONS.length)
      a.setMeta('x', '1')
      a.close()
      const b = new Store(file)
      expect(b.version).toBe(MIGRATIONS.length)
      expect(b.meta('x')).toBe('1')
      b.close()
      MIGRATIONS.push(`ALTER TABLE feeds ADD COLUMN note TEXT; CREATE TABLE extra(id TEXT);`)
      try {
        const c = new Store(file)
        expect(c.version).toBe(MIGRATIONS.length)
        expect(c.meta('x')).toBe('1')
        expect(() => c.db.exec('SELECT note FROM feeds; SELECT id FROM extra')).not.toThrow()
        c.close()
      } finally {
        MIGRATIONS.pop()
      }
    } finally {
      tmp.done()
    }
  })

  it('迁移中途出错整步回滚，库还停在上一步', () => {
    const tmp = tempDir()
    const file = join(tmp.dir, 'feeds.sqlite')
    try {
      new Store(file).close()
      MIGRATIONS.push(`CREATE TABLE half(id TEXT); THIS IS NOT SQL;`)
      try {
        expect(() => new Store(file)).toThrow()
      } finally {
        MIGRATIONS.pop()
      }
      const raw = new DatabaseSync(file)
      expect((raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(MIGRATIONS.length)
      expect(raw.prepare(`SELECT name FROM sqlite_master WHERE name = 'half'`).get()).toBeUndefined()
      raw.close()
    } finally {
      tmp.done()
    }
  })
})

describe('退避', () => {
  const feed = { id: 'f_x', intervalMin: 30, errorCount: 0 }
  it('成功：按间隔（ttl 更长听 ttl，最多 6 小时），抖动 ±10% 固定', () => {
    const p = plan(feed, { ok: true }, 0)
    expect(p).toEqual({ nextFetchAt: Math.round(30 * 60_000 * jitter('f_x')), errorCount: 0, broken: false })
    expect(jitter('f_x')).toBe(jitter('f_x'))
    expect(jitter('f_x')).toBeGreaterThanOrEqual(0.9)
    expect(jitter('f_x')).toBeLessThanOrEqual(1.1)
    expect(plan(feed, { ok: true, ttlMin: 120 }, 0).nextFetchAt).toBeGreaterThan(100 * 60_000)
    expect(plan(feed, { ok: true, ttlMin: 100000 }, 0).nextFetchAt).toBeLessThanOrEqual(6.6 * 3600_000)
    expect(plan({ ...feed, intervalMin: 1 }, { ok: true }, 0).nextFetchAt).toBeGreaterThanOrEqual(13.5 * 60_000)
  })
  it('失败：翻倍、封顶 24 小时、连着 8 次标坏；410 马上标坏；404 三次；Retry-After', () => {
    let f = feed
    const waits: number[] = []
    for (let i = 0; i < BROKEN_AFTER; i++) {
      const p = plan(f, { ok: false, status: 503 }, 0)
      waits.push(p.nextFetchAt)
      f = { ...f, errorCount: p.errorCount }
      expect(p.broken).toBe(i + 1 >= BROKEN_AFTER)
    }
    expect(waits[0]).toBeGreaterThan(54 * 60_000)
    expect(waits[1]).toBeGreaterThan(108 * 60_000)
    expect(Math.max(...waits)).toBeLessThanOrEqual(MAX_BACKOFF_MS * 1.1)
    expect(plan(feed, { ok: false, status: 410 }, 0).broken).toBe(true)
    expect(plan({ ...feed, errorCount: 1 }, { ok: false, status: 404 }, 0).broken).toBe(false)
    expect(plan({ ...feed, errorCount: 2 }, { ok: false, status: 404 }, 0).broken).toBe(true)
    expect(plan(feed, { ok: false, status: 429, retryAfterMs: 5 * 3600_000 }, 0).nextFetchAt).toBeGreaterThanOrEqual(4.5 * 3600_000)
    expect(retryAfterMs('120', 0)).toBe(120_000)
    expect(retryAfterMs(new Date(60_000).toUTCString(), 0)).toBe(60_000)
    expect(retryAfterMs('soon', 0)).toBeUndefined()
  })
  it('到点的：没抓过的最先', () => {
    expect(dueFeeds([{ id: 'b', nextFetchAt: 50 }, { id: 'a' }, { id: 'c', nextFetchAt: 500 }], 100).map((f) => f.id)).toEqual(['a', 'b'])
  })
})

describe('阅读视图的正文', () => {
  let srv: Awaited<ReturnType<typeof startServer>>
  beforeAll(async () => {
    const page = readFileSync(join(__dirname, 'fixtures/page-article.html'), 'utf8')
    srv = await startServer({
      '/feed.xml': (req, res) => send(rssOf('周刊', [{ guid: '1', title: '本地优先软件的第二春', link: `http://${req.headers.host}/post`, body: '<p onclick="x()">只有摘要<script>bad()</script></p>' }]))(req, res),
      '/post': send(page, 'text/html; charset=utf-8'),
    })
  })
  afterAll(() => srv.close())

  it('默认源里的（清洗过）；抓全文后存起来，第二次不再联网，也搜得到全文里的字', async () => {
    const tmp = tempDir()
    const core = await openTest(tmp.dir)
    try {
      const feed = await core.subscribe({ url: srv.url('/feed.xml') })
      const [a] = (await core.listArticles({ feedId: feed.id })).rows
      const r1 = await core.readable(a!.id)
      expect(r1).toMatchObject({ source: 'feed', html: '<p>只有摘要</p>', textLength: 4 })
      expect(await core.search('条件请求')).toEqual([])
      const r2 = await core.readable(a!.id, { full: true })
      expect(r2.source).toBe('full')
      expect(r2.byline).toBe('张三')
      expect(r2.html).toContain('<h2>阅读器为什么适合本地优先</h2>')
      expect(r2.html).not.toMatch(/<script|广告|首页/)
      const hits = srv.count('/post')
      await core.readable(a!.id, { full: true })
      expect(srv.count('/post')).toBe(hits)
      expect((await core.getArticle(a!.id))!.fullHtml).toBe(r2.html)
      expect((await core.search('条件请求')).map((h) => h.row.id)).toEqual([a!.id])
    } finally {
      await core.close()
      tmp.done()
    }
  })
})

describe('包的规矩', () => {
  it('纯函数那一半不碰 Electron、Node 的模块和系统时间；node 那一半也不碰 Electron', () => {
    const src = join(__dirname, '../src')
    for (const f of readdirSync(src).filter((x) => x.endsWith('.ts'))) {
      const code = readFileSync(join(src, f), 'utf8')
      expect(code, f).not.toMatch(/from ['"](electron|node:|fs|path|child_process|os)['"/]/)
      expect(code, f).not.toMatch(/\bDate\.now\(\)|new Date\(\)/)
    }
    for (const f of readdirSync(join(src, 'node'))) expect(readFileSync(join(src, 'node', f), 'utf8'), f).not.toMatch(/from ['"]electron['"]/)
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'))
    expect(Object.keys(pkg.dependencies)).not.toContain('electron')
  })
})
