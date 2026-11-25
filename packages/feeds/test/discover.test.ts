/** 找源：纯函数（网页里的链接、常见站点、RSSHub 规则）和真的核心走本机服务器 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { FeedsCore } from '../src'
import { findFeedLinks, guessUrls, knownFeeds } from '../src/discover'
import { normalizeBase, resolveRoute, suggestRoutes, toRoute } from '../src/rsshub'
import { openTest, rssOf, tempDir } from './helpers'
import { send, startServer } from './server'

describe('网页里写着的源', () => {
  it('<link rel=alternate> 按先后、补全地址、评论源排后、<a> 链接也算', () => {
    const html = `<html><head><base href="https://blog.test/sub/">
      <link rel="alternate" type="application/rss+xml" title="评论" href="/comments/feed/">
      <link rel="alternate" type="application/rss+xml" title="文章" href="feed/">
      <link rel="alternate" type="application/atom+xml" href="https://blog.test/atom.xml">
      <link rel="alternate" type="application/json" href="/api/data.json">
      <link rel="alternate" type="application/feed+json" href="/feed.json">
      <link rel="stylesheet" href="/style.css">
      </head><body><a href="/rss.xml">订阅 RSS</a><a href="/about">关于</a><a href="https://blog.test/?feed=rss2">WordPress</a></body></html>`
    const links = findFeedLinks(html, 'https://blog.test/post/1')
    expect(links.map((l) => [l.url, l.via, l.format, l.title])).toEqual([
      ['https://blog.test/sub/feed/', 'link', 'rss', '文章'],
      ['https://blog.test/atom.xml', 'link', 'atom', undefined],
      ['https://blog.test/feed.json', 'link', 'json', undefined],
      ['https://blog.test/comments/feed/', 'link', 'rss', '评论'],
      ['https://blog.test/rss.xml', 'anchor', undefined, '订阅 RSS'],
      ['https://blog.test/?feed=rss2', 'anchor', undefined, 'WordPress'],
    ])
    expect(findFeedLinks(readFileSync(join(__dirname, 'fixtures/page-article.html'), 'utf8'), 'https://example.test/2026/x.html')[0]).toMatchObject({ url: 'https://example.test/feed.xml', title: '示例周刊' })
  })
  it('常见站点和试一试的路径', () => {
    expect(knownFeeds('https://www.youtube.com/channel/UC123').map((k) => k.url)).toEqual(['https://www.youtube.com/feeds/videos.xml?channel_id=UC123'])
    expect(knownFeeds('https://github.com/RSSNext/Folo/issues').map((k) => k.url)).toEqual(['https://github.com/RSSNext/Folo/releases.atom', 'https://github.com/RSSNext/Folo/commits.atom'])
    expect(knownFeeds('https://www.reddit.com/r/rss/')[0]!.url).toBe('https://www.reddit.com/r/rss/.rss')
    expect(guessUrls('https://site.test/blog/post.html').slice(0, 2)).toEqual(['https://site.test/feed', 'https://site.test/rss'])
    expect(guessUrls('https://site.test/blog/post.html')).toContain('https://site.test/blog/feed')
  })
})

describe('RSSHub', () => {
  it('网页地址 → 路由；路由 → 用户自己的实例；公共实例和自己实例的地址认回路由；不填地址就没有默认值', () => {
    expect(suggestRoutes('https://space.bilibili.com/946974/video').map((r) => [r.url, r.kind])).toEqual([
      ['rsshub://bilibili/user/video/946974', 'video'],
      ['rsshub://bilibili/user/dynamic/946974', 'social'],
    ])
    expect(suggestRoutes('https://weibo.com/u/1195230310')[0]!.url).toBe('rsshub://weibo/user/1195230310')
    expect(suggestRoutes('https://x.com/karpathy')[0]!.url).toBe('rsshub://twitter/user/karpathy')
    expect(suggestRoutes('https://x.com/home')).toEqual([])
    // 2026-11-25 照 RSSHub 官方仓库的路由定义核对过的几条（radar 的 source → 路由）
    expect(suggestRoutes('https://m.weibo.cn/u/1195230310')[0]!.url).toBe('rsshub://weibo/user/1195230310')
    expect(suggestRoutes('https://m.weibo.cn/profile/1195230310')[0]!.url).toBe('rsshub://weibo/user/1195230310')
    expect(suggestRoutes('https://twitter.com/_RSSHub')[0]).toMatchObject({ url: 'rsshub://twitter/user/_RSSHub', hint: expect.stringContaining('TWITTER_AUTH_TOKEN') })
    expect(suggestRoutes('https://m.okjike.com/users/3EE02BC9-C5B3-4209-8750-4ED1EE0F67BB')[0]!.url).toBe('rsshub://jike/user/3EE02BC9-C5B3-4209-8750-4ED1EE0F67BB')
    expect(suggestRoutes('https://zhuanlan.zhihu.com/googledevelopers')[0]!.url).toBe('rsshub://zhihu/zhuanlan/googledevelopers')
    expect(suggestRoutes('https://zhuanlan.zhihu.com/p/123456')).toEqual([])
    expect(suggestRoutes('https://www.xiaohongshu.com/user/profile/593032945e87e77791e03696')[0]!.url).toBe('rsshub://xiaohongshu/user/593032945e87e77791e03696/notes')
    expect(suggestRoutes('https://t.me/s/awesomeRSSHub')[0]!.url).toBe('rsshub://telegram/channel/awesomeRSSHub')
    expect(suggestRoutes('https://www.instagram.com/stefaniejoosten/')[0]!.url).toBe('rsshub://instagram/user/stefaniejoosten')
    expect(suggestRoutes('https://example.test/')).toEqual([])
    expect(normalizeBase('nas.local:1200/')).toBe('https://nas.local:1200')
    expect(normalizeBase('')).toBe('')
    expect(resolveRoute('rsshub://weibo/user/1', 'http://nas.local:1200/')).toBe('http://nas.local:1200/weibo/user/1')
    expect(resolveRoute('rsshub://weibo/user/1?limit=5', 'http://nas.local:1200', 'k&y')).toBe('http://nas.local:1200/weibo/user/1?limit=5&key=k%26y')
    expect(() => resolveRoute('rsshub://weibo/user/1', '')).toThrow(/RSSHub/)
    expect(toRoute('https://rsshub.app/bilibili/user/video/1', '')).toBe('rsshub://bilibili/user/video/1')
    expect(toRoute('http://nas.local:1200/weibo/user/1?key=secret', 'http://nas.local:1200')).toBe('rsshub://weibo/user/1')
    expect(toRoute('https://example.test/feed', 'http://nas.local:1200')).toBeNull()
  })
})

describe('真的找源（本机服务器）', () => {
  let srv: Awaited<ReturnType<typeof startServer>>
  let tmp: ReturnType<typeof tempDir>
  let core: FeedsCore
  beforeAll(async () => {
    const feed = rssOf('站点的源', [{ guid: '1', title: '一篇', link: 'https://site.test/1' }])
    srv = await startServer({
      '/blog/': send(`<html><head><title>博客</title><link rel="alternate" type="application/rss+xml" title="博客的源" href="/blog/feed.xml"><link rel="alternate" type="application/rss+xml" href="/dead.xml"></head><body></body></html>`, 'text/html'),
      '/blog/feed.xml': send(feed),
      '/plain/': send('<html><head><title>没写源的网页</title></head><body>hi</body></html>', 'text/html'),
      '/feed': send(feed),
      '/direct.xml': send(feed),
    })
  })
  afterAll(() => srv.close())
  beforeEach(async () => {
    tmp = tempDir()
    core = await openTest(tmp.dir)
  })
  afterEach(async () => {
    await core.close()
    tmp.done()
  })

  it('本身就是源：direct', async () => {
    const r = await core.discover(srv.url('/direct.xml'))
    expect(r.candidates).toEqual([{ url: srv.url('/direct.xml'), title: '站点的源', format: 'rss', kind: 'article', via: 'direct' }])
  })
  it('网页里写着：挨个抓一下验证，打不开的不要', async () => {
    const r = await core.discover(srv.url('/blog/'))
    expect(r.candidates.map((c) => [c.url, c.title, c.via])).toEqual([[srv.url('/blog/feed.xml'), '站点的源', 'link']])
  })
  it('网页里没写：试常见路径', async () => {
    const r = await core.discover(srv.url('/plain/'))
    expect(r.candidates.map((c) => [c.url, c.via])).toEqual([[srv.url('/feed'), 'guess']])
  })
  it('订过的标出来；打不开、不像网址的说原因', async () => {
    const f = await core.subscribe({ url: srv.url('/direct.xml') })
    expect((await core.discover(srv.url('/direct.xml'))).candidates[0]!.subscribedAs).toBe(f.id)
    expect((await core.discover(srv.url('/nothing-here'))).error).toBe('这个网址打不开')
    expect((await core.discover('不是网址')).error).toBe('这不像一个网址')
  })
  it('B 站空间：给 RSSHub 路由，没填地址时标 needsRsshub，不联网', async () => {
    const hits = srv.hits.length
    const r = await core.discover('https://space.bilibili.com/946974')
    expect(r.candidates.map((c) => [c.url, c.kind, c.needsRsshub])).toEqual([
      ['rsshub://bilibili/user/video/946974', 'video', true],
      ['rsshub://bilibili/user/dynamic/946974', 'social', true],
    ])
    expect(srv.hits.length).toBe(hits)
    await core.setSettings({ rsshubBase: 'http://nas.local:1200' })
    expect((await core.discover('https://space.bilibili.com/946974')).candidates[0]!.needsRsshub).toBeUndefined()
  })
})
