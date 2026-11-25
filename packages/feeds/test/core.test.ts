/** 真的核心（openFeeds）从订阅到已读、星标、划线、去重、清理、搜索、抓取退避和定时器，全在本机服务器上 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FeedsCore } from '../src'
import { BROKEN_AFTER } from '../src/schedule'
import { clock, openTest, rssOf, tempDir } from './helpers'
import { startServer, type Handler } from './server'

const H = 3600_000
const DAY = 24 * H
let srv: Awaited<ReturnType<typeof startServer>>
let feedA = ''
let etagA = '"a1"'
let failing: number = 500
const T0 = Date.UTC(2026, 10, 25, 8, 0)

beforeAll(async () => {
  const a: Handler = (req, res) => {
    if (req.headers['if-none-match'] === etagA) {
      res.writeHead(304)
      return void res.end()
    }
    res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8', etag: etagA })
    res.end(feedA)
  }
  srv = await startServer({
    '/a.xml': a,
    '/b.xml': (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/rss+xml' })
      res.end(rssOf('B 源', [{ guid: 'b1', title: '同一篇（转载）', link: 'https://site.test/shared', date: T0 - 2 * H }]))
    },
    '/fail.xml': (_req, res) => {
      res.writeHead(failing, failing === 429 ? { 'retry-after': '7200' } : {})
      res.end()
    },
    '/page.html': (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(`<html><head><title>页面</title><link rel="alternate" type="application/rss+xml" href="/a.xml"></head><body>hi</body></html>`)
    },
  })
})
afterAll(() => srv.close())

let tmp: ReturnType<typeof tempDir>
let c: ReturnType<typeof clock>
let core: FeedsCore
beforeEach(async () => {
  tmp = tempDir()
  c = clock(T0)
  etagA = '"a1"'
  feedA = rssOf('A 源', [
    { guid: 'a1', title: '缓存省下的钱', link: 'https://site.test/a1', date: T0 - H, body: '<p>提示词缓存把一个月的账单从 412 美元降到 47 美元。</p>' },
    { guid: 'a2', title: 'Local-first software', link: 'https://site.test/a2', date: T0 - 3 * H, body: '<p>Sync engines matured.</p>' },
    { guid: 'a3', title: '同一篇（原文）', link: 'https://site.test/shared', date: T0 - 4 * H },
  ])
  core = await openTest(tmp.dir, { now: c.now })
})
afterEach(async () => {
  await core.close()
  tmp.done()
})

describe('订阅和列表', () => {
  it('订阅：抓一次、记下标题和类型、文章进库，未读数对', async () => {
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    expect(f).toMatchObject({ title: 'A 源', kind: 'article', folderId: null, intervalMin: 30, errorCount: 0, broken: false, unread: 3, siteUrl: 'https://site.test/' })
    expect(srv.count('/a.xml')).toBeGreaterThanOrEqual(1)
    const page = await core.listArticles({})
    expect(page.rows.map((r) => r.title)).toEqual(['缓存省下的钱', 'Local-first software', '同一篇（原文）'])
    expect(page.rows[0]!.summary).toBe('提示词缓存把一个月的账单从 412 美元降到 47 美元。')
    // 再订一次同一个地址：还是那个，不重复
    expect((await core.subscribe({ url: srv.url('/a.xml') })).id).toBe(f.id)
    expect(await core.listFeeds()).toHaveLength(1)
  })

  it('给网页地址：找到页里的源再订', async () => {
    const f = await core.subscribe({ url: srv.url('/page.html') })
    expect(f.url).toBe(srv.url('/a.xml'))
  })

  it('翻页：每页 2 条，三页拼起来和一次全拿一样', async () => {
    await core.subscribe({ url: srv.url('/a.xml') })
    const p1 = await core.listArticles({ limit: 2 })
    expect(p1.rows).toHaveLength(2)
    const p2 = await core.listArticles({ limit: 2, cursor: p1.next! })
    expect(p2.next).toBeUndefined()
    expect([...p1.rows, ...p2.rows].map((r) => r.id)).toEqual((await core.listArticles({})).rows.map((r) => r.id))
  })

  it('文件夹：建、挪进去、按文件夹列和计数、删了文件夹源回到没有文件夹', async () => {
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    const d = await core.addFolder('科技')
    await core.updateFeed(f.id, { folderId: d.id })
    expect((await core.counts()).folders[d.id]).toBe(3)
    expect((await core.listArticles({ folderId: d.id })).rows).toHaveLength(3)
    await core.renameFolder(d.id, '科技新闻')
    expect((await core.listFolders())[0]!.name).toBe('科技新闻')
    await core.removeFolder(d.id)
    expect((await core.getFeed(f.id))!.folderId).toBeNull()
    expect(await core.listFolders()).toEqual([])
  })
})

describe('已读、星标、稍后读、划线', () => {
  it('标已读改未读数；整源已读只标那时以前的；后来进来的照样未读', async () => {
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    const rows = (await core.listArticles({})).rows
    await core.markRead([rows[0]!.id])
    expect((await core.counts()).feeds[f.id]).toBe(2)
    expect((await core.listArticles({ unreadOnly: true })).rows.map((r) => r.id)).not.toContain(rows[0]!.id)
    await core.markRead([rows[0]!.id], false)
    expect((await core.counts()).views.all).toBe(3)

    await core.markAllRead({ feedId: f.id })
    expect((await core.counts()).views.all).toBe(0)
    // 新文章进来（时间在标已读之后）
    c.add(H)
    feedA = rssOf('A 源', [{ guid: 'a4', title: '新的一篇', link: 'https://site.test/a4', date: c.now() }])
    etagA = '"a2"'
    const sum = await core.refresh([f.id])
    expect(sum).toEqual({ fetched: 1, notModified: 0, failed: 0, newArticles: 1 })
    expect((await core.listArticles({ unreadOnly: true })).rows.map((r) => r.title)).toEqual(['新的一篇'])
  })

  it('星标、稍后读、划线进各自的视图和计数；划线能改能删', async () => {
    await core.subscribe({ url: srv.url('/a.xml') })
    const [a, b] = (await core.listArticles({})).rows
    await core.setStarred(a!.id, true)
    await core.setLater(b!.id, true)
    const h = await core.addHighlight(a!.id, { quote: '412 美元', prefix: '账单从 ', suffix: '降到' }, { note: '记一下', color: 'yellow' })
    let counts = await core.counts()
    expect([counts.views.starred, counts.views.later, counts.views.highlights]).toEqual([1, 1, 1])
    expect((await core.listArticles({ view: 'starred' })).rows.map((r) => r.id)).toEqual([a!.id])
    expect((await core.listArticles({ view: 'later' })).rows.map((r) => r.id)).toEqual([b!.id])
    expect((await core.listArticles({ view: 'highlights' })).rows[0]).toMatchObject({ id: a!.id, highlightCount: 1, starred: true })
    const changed = await core.updateHighlight(h.id, { note: '' })
    expect(changed.note).toBeUndefined()
    expect((await core.listHighlights(a!.id))[0]).toMatchObject({ id: h.id, anchor: { quote: '412 美元' }, color: 'yellow' })
    await core.removeHighlight(h.id)
    await core.setStarred(a!.id, false)
    counts = await core.counts()
    expect([counts.views.starred, counts.views.highlights]).toEqual([0, 0])
  })

  it('退订：文章清掉，星标的留在星标里', async () => {
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    const [a] = (await core.listArticles({})).rows
    await core.setStarred(a!.id, true)
    await core.unsubscribe(f.id)
    expect(await core.listFeeds()).toEqual([])
    expect((await core.listArticles({})).rows).toEqual([])
    expect((await core.listArticles({ view: 'starred' })).rows.map((r) => r.title)).toEqual(['缓存省下的钱'])
  })
})

describe('去重', () => {
  it('同一个 guid 内容改了：换正文不算新文章、已读不丢；guid 换了链接一样：不重复；两个源里同一个链接：全部视图里只出一次', async () => {
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    const first = (await core.listArticles({})).rows[0]!
    await core.markRead([first.id])
    feedA = rssOf('A 源', [
      { guid: 'a1', title: '缓存省下的钱（更新）', link: 'https://site.test/a1', date: T0 - H, body: '<p>改过的正文</p>' },
      { guid: 'a1-new-format', title: '缓存省下的钱', link: 'https://site.test/a1', date: T0 - H },
      { guid: 'a2', title: 'Local-first software', link: 'https://site.test/a2', date: T0 - 3 * H, body: '<p>Sync engines matured.</p>' },
    ])
    etagA = '"a3"'
    expect((await core.refresh([f.id])).newArticles).toBe(0)
    const again = await core.getArticle(first.id)
    expect(again).toMatchObject({ title: '缓存省下的钱（更新）', read: true, contentHtml: '<p>改过的正文</p>' })

    const b = await core.subscribe({ url: srv.url('/b.xml') })
    expect((await core.listArticles({ feedId: b.id })).rows).toHaveLength(1)
    const all = (await core.listArticles({})).rows
    expect(all.filter((r) => r.url === 'https://site.test/shared')).toHaveLength(1)
    // 标了原文已读，转载那篇也算读了
    const original = all.find((r) => r.url === 'https://site.test/shared')!
    await core.markRead([original.id])
    expect((await core.counts()).feeds[b.id]).toBe(0)
  })
})

describe('清理和大小', () => {
  it('90 天没动的清掉（星标的留着），清掉的不会再抓回来；超过 90 天的旧条目不进库', async () => {
    feedA = rssOf('A 源', [
      { guid: 'new', title: '新的', link: 'https://site.test/new', date: T0 - DAY },
      { guid: 'mid', title: '中间的', link: 'https://site.test/mid', date: T0 - 30 * DAY },
      { guid: 'star', title: '星标的', link: 'https://site.test/star', date: T0 - 31 * DAY },
      { guid: 'ancient', title: '远古的', link: 'https://site.test/ancient', date: T0 - 200 * DAY },
    ])
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    expect((await core.listArticles({})).rows.map((r) => r.title)).toEqual(['新的', '中间的', '星标的'])
    const star = (await core.listArticles({})).rows[2]!
    await core.setStarred(star.id, true)
    c.add(70 * DAY)
    etagA = '"x"'
    await core.refresh([f.id])
    expect((await core.listArticles({})).rows.map((r) => r.title)).toEqual(['新的', '星标的'])
    // 源里还留着「中间的」：不会被当成新文章抓回来
    etagA = '"y"'
    expect((await core.refresh([f.id])).newArticles).toBe(0)
  })

  it('每个源最多留 maxPerFeed 篇', async () => {
    await core.setSettings({ maxPerFeed: 50 })
    feedA = rssOf('A 源', Array.from({ length: 60 }, (_, i) => ({ guid: `g${i}`, title: `第 ${i} 篇`, link: `https://site.test/${i}`, date: T0 - i * 60_000 })))
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    await core.refresh([f.id])
    const rows = (await core.listArticles({ limit: 200 })).rows
    expect(rows).toHaveLength(50)
    expect(rows.at(-1)!.title).toBe('第 49 篇')
  })
})

describe('搜索', () => {
  it('三个字以上走全文索引；两个字的中文也搜得到；几个词都要有；摘一小段', async () => {
    await core.subscribe({ url: srv.url('/a.xml') })
    expect((await core.search('账单从')).map((h) => h.row.title)).toEqual(['缓存省下的钱'])
    expect((await core.search('缓存')).map((h) => h.row.title)).toEqual(['缓存省下的钱'])
    expect((await core.search('sync engines')).map((h) => h.row.title)).toEqual(['Local-first software'])
    expect(await core.search('缓存 engines')).toEqual([])
    expect((await core.search('412'))[0]!.snippet).toContain('⟪412⟫')
    expect(await core.search('   ')).toEqual([])
  })
})

describe('抓取：条件请求、退避、坏了、定时器', () => {
  it('第二次抓带 If-None-Match，回 304 算成功', async () => {
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    const sum = await core.refresh([f.id])
    expect(sum).toEqual({ fetched: 1, notModified: 1, failed: 0, newArticles: 0 })
    expect(srv.hits.filter((h) => h.path === '/a.xml').at(-1)!.headers['if-none-match']).toBe('"a1"')
  })

  it('失败一次比一次等得久，连着 8 次标坏，好了自己恢复；429 照 Retry-After 等', async () => {
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    // 把这个源换成会失败的地址：直接改抓取地址模拟（源搬家后旧地址坏了）
    await core.importOpml(`<opml version="2.0"><body><outline type="rss" text="坏源" xmlUrl="${srv.url('/fail.xml')}"/></body></opml>`)
    const bad = (await core.listFeeds()).find((x) => x.title === '坏源')!
    failing = 500
    const waits: number[] = []
    for (let i = 1; i <= BROKEN_AFTER; i++) {
      await core.refresh([bad.id])
      const now = await core.getFeed(bad.id)
      expect(now!.errorCount).toBe(i)
      waits.push(now!.nextFetchAt! - c.now())
    }
    // 每次翻倍（抖动 ±10%，所以至少 1.6 倍），到 24 小时封顶
    for (let i = 1; i < waits.length; i++) expect(waits[i]!).toBeGreaterThanOrEqual(Math.min(waits[i - 1]! * 1.6, 24 * H * 0.9))
    const broken = (await core.getFeed(bad.id))!
    expect(broken).toMatchObject({ broken: true, lastError: '源的服务器出错（HTTP 500）' })
    expect(waits.at(-1)).toBeLessThanOrEqual(24 * H * 1.1)
    expect((await core.status()).brokenFeeds).toBe(1)

    failing = 429
    await core.refresh([bad.id])
    expect((await core.getFeed(bad.id))!.nextFetchAt! - c.now()).toBeGreaterThanOrEqual(2 * H * 0.9)
    expect((await core.getFeed(f.id))!.errorCount).toBe(0)
  })

  it('定时器：开起来就抓到点的（新导入的从来没抓过）', async () => {
    await core.importOpml(`<opml version="2.0"><body><outline type="rss" text="A" xmlUrl="${srv.url('/a.xml')}"/></body></opml>`)
    const before = srv.count('/a.xml')
    core.startScheduler()
    for (let i = 0; i < 100 && srv.count('/a.xml') === before; i++) await new Promise((r) => setTimeout(r, 20))
    for (let i = 0; i < 100 && (await core.status()).running; i++) await new Promise((r) => setTimeout(r, 20))
    core.stopScheduler()
    expect(srv.count('/a.xml')).toBe(before + 1)
    expect((await core.counts()).views.all).toBe(3)
    const f = (await core.listFeeds())[0]!
    expect(f.nextFetchAt! - c.now()).toBeGreaterThan(25 * 60_000)
  })

  it('RSSHub 源：没填地址时不联网、说清楚原因；填了自己的地址就拼上去抓', async () => {
    await expect(core.subscribe({ url: 'rsshub://test/route' })).rejects.toThrow(/RSSHub/)
    await core.importOpml(`<opml version="2.0"><body><outline type="rss" text="社交" xmlUrl="rsshub://a.xml"/></body></opml>`)
    const f = (await core.listFeeds())[0]!
    expect(f.url).toBe('rsshub://a.xml')
    const hits = srv.hits.length
    await core.refresh([f.id])
    expect(srv.hits.length).toBe(hits)
    expect((await core.getFeed(f.id))!.lastError).toMatch(/RSSHub 地址/)
    await core.setSettings({ rsshubBase: srv.base + '/' })
    await core.refresh([f.id])
    expect((await core.getFeed(f.id))!.errorCount).toBe(0)
    expect((await core.counts()).feeds[f.id]).toBe(3)
  })
})

describe('存过以后再补进那一篇', () => {
  it('存进去以后再划的线补进「## 划线」一节（已有的不重写），问答接在文末；一次一提交；那篇没了就不补', async () => {
    const { mkdirSync, readFileSync, rmSync } = await import('node:fs')
    const { join } = await import('node:path')
    const vault = join(tmp.dir, 'vault')
    mkdirSync(vault)
    const msgs: string[] = []
    await core.close()
    core = await openTest(tmp.dir, { now: c.now, vaultDir: vault, commit: async (_d, _p, m) => (msgs.push(m), 'abc') })
    const f = await core.subscribe({ url: srv.url("/a.xml") })
    const art = (await core.listArticles({ feedId: f.id })).rows.find((r) => r.title === '缓存省下的钱')!
    expect(await core.savedNote(art.id)).toBeNull()
    expect(await core.appendToNote(art.id, { highlights: true })).toBeNull()
    await core.addHighlight(art.id, { quote: '412 美元' }, { note: '贵' })
    const res = await core.saveToNotes(art.id, { fullText: false, images: false, extra: '### 问过的\n\n> [!ai] AI 回答\n> 答过的' })
    expect(await core.savedNote(art.id)).toBe(res.path)
    let md = readFileSync(join(vault, res.path), 'utf8')
    expect(md).toContain('## 划线\n\n- ==412 美元==\n  贵\n')
    expect(md.trimEnd().endsWith('> 答过的')).toBe(true)
    // 再划一条：补在划线那一节末尾，不在问答后面；第一条不重写
    await core.addHighlight(art.id, { quote: '47 美元' })
    const r1 = await core.appendToNote(art.id, { highlights: true, message: '划线：缓存省下的钱' })
    expect(r1).toMatchObject({ path: res.path, added: 1, commit: 'abc' })
    md = readFileSync(join(vault, res.path), 'utf8')
    expect(md).toContain('- ==412 美元==\n  贵\n- ==47 美元==\n')
    expect(md.match(/412 美元==/g)!.length).toBe(1)
    expect(md.indexOf('==47 美元==')).toBeLessThan(md.indexOf('### 问过的'))
    // 没有新的：不写、不提交
    expect(await core.appendToNote(art.id, { highlights: true })).toMatchObject({ added: 0, commit: null })
    // 问答接在文末
    await core.appendToNote(art.id, { text: '### 又问一句\n\n> [!ai] AI 回答\n> 又答', message: '笔记：问答' })
    expect(readFileSync(join(vault, res.path), 'utf8').trimEnd().endsWith('> 又答')).toBe(true)
    expect(msgs).toEqual(['存进画布笔记：缓存省下的钱', '划线：缓存省下的钱', '笔记：问答'])
    // 那篇被删了：不补
    rmSync(join(vault, res.path))
    expect(await core.savedNote(art.id)).toBeNull()
    expect(await core.appendToNote(art.id, { highlights: true })).toBeNull()
  })
})

describe('源进不进列表（逐条 / 静音 / 汇总）', () => {
  it('静音、汇总的源不进全部和类型视图、不算未读数；点开这个源照样逐篇列；会同步（feed 记录带 mode）', async () => {
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    expect(f).toMatchObject({ mode: 'normal', digestEvery: 20 })
    expect((await core.listArticles({})).rows).toHaveLength(3)
    const g = await core.updateFeed(f.id, { mode: 'digest', digestEvery: 5 })
    expect(g).toMatchObject({ mode: 'digest', digestEvery: 5 })
    expect((await core.listArticles({})).rows).toHaveLength(0)
    expect((await core.listArticles({ view: 'article' })).rows).toHaveLength(0)
    expect((await core.listArticles({ feedId: f.id })).rows).toHaveLength(3)
    const c = await core.counts()
    expect(c.views.all).toBe(0)
    expect(c.feeds[f.id]).toBe(3)
    await core.updateFeed(f.id, { mode: 'muted' })
    expect((await core.getFeed(f.id))!.mode).toBe('muted')
    await core.updateFeed(f.id, { mode: 'normal' })
    expect((await core.listArticles({})).rows).toHaveLength(3)
  })
})

describe('同步状态', () => {
  it('没有库：dir 是 null、没有待写；有库：同步完写上时间、待写清零、列出读到过的设备；写不进去记下原因', async () => {
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    expect(await core.syncStatus()).toMatchObject({ dir: null, pending: 0, syncing: false })
    const vault = join(tmp.dir, 'vault2')
    mkdirSync(vault)
    await core.close()
    core = await openTest(tmp.dir, { now: c.now, vaultDir: vault, pushDelayMs: 60_000 })
    const f = await core.subscribe({ url: srv.url('/a.xml') })
    const art = (await core.listArticles({ feedId: f.id })).rows[0]!
    await core.setStarred(art.id, true)
    const before = await core.syncStatus()
    expect(before.dir).toBe(join(vault, '.canvas-feeds'))
    expect(before.pending).toBeGreaterThanOrEqual(2)
    await core.sync()
    const after = await core.syncStatus()
    expect(after).toMatchObject({ pending: 0, lastAt: c.now() })
    expect(after.lastError).toBeUndefined()
    expect(after.devices.map((d) => d.id)).toEqual([after.device])
    // .canvas-feeds 被一个同名文件占了：同步没成，记下原因
    await core.close()
    const bad = join(tmp.dir, 'vault3')
    mkdirSync(bad)
    writeFileSync(join(bad, '.canvas-feeds'), 'x')
    core = await openTest(tmp.dir, { now: c.now, vaultDir: bad, pushDelayMs: 60_000 })
    await expect(core.sync()).rejects.toThrow()
    expect((await core.syncStatus()).lastError).toBeTruthy()
  })
})
