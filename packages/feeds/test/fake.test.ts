import { describe, expect, it } from 'vitest'
import { createFakeFeeds, parseOpml } from '../src'

describe('假实现照接口办事', () => {
  it('演示数据：视图、计数、翻页', async () => {
    const core = createFakeFeeds()
    const feeds = await core.listFeeds()
    expect(feeds.length).toBeGreaterThan(5)
    const counts = await core.counts()
    expect(counts.views.all).toBe(feeds.reduce((s, f) => s + f.unread, 0))
    const social = await core.listArticles({ view: 'social' })
    const kinds = new Map(feeds.map((f) => [f.id, f.kind]))
    expect(social.rows.every((r) => kinds.get(r.feedId) === 'social')).toBe(true)

    const seen: string[] = []
    let cursor: string | undefined
    for (;;) {
      const page = await core.listArticles({ limit: 4, ...(cursor ? { cursor } : {}) })
      seen.push(...page.rows.map((r) => r.id))
      if (!page.next) break
      cursor = page.next
    }
    const all = await core.listArticles({ limit: 200 })
    expect(seen).toEqual(all.rows.map((r) => r.id))
    expect(new Set(seen).size).toBe(seen.length)
  })

  it('已读、星标、稍后读、划线都会改计数，也发通知', async () => {
    const core = createFakeFeeds()
    const events: string[] = []
    core.onChange((e) => events.push(e.what))
    const [first] = (await core.listArticles({ unreadOnly: true, limit: 1 })).rows
    const before = (await core.counts()).views.all
    await core.markRead([first!.id])
    expect((await core.counts()).views.all).toBe(before - 1)
    await core.setStarred(first!.id, true)
    await core.setLater(first!.id, true)
    const h = await core.addHighlight(first!.id, { quote: '缓存' }, { note: '想法' })
    const c = await core.counts()
    expect([c.views.starred, c.views.later, c.views.highlights]).toEqual([1, 1, 1])
    expect((await core.listArticles({ view: 'highlights' })).rows.map((r) => r.id)).toEqual([first!.id])
    await core.removeHighlight(h.id)
    expect((await core.counts()).views.highlights).toBe(0)
    expect(events).toEqual(['state', 'state', 'state', 'highlights', 'highlights'])
  })

  it('订阅、OPML 导出再导入、搜索、存进画布笔记', async () => {
    const core = createFakeFeeds({ vault: '/vault' })
    await expect(core.subscribe({ url: 'rsshub://bilibili/user/video/1' })).rejects.toThrow('RSSHub')
    const feed = await core.subscribe({ url: 'https://example.com/feed', title: '例子' })
    expect((await core.listArticles({ feedId: feed.id })).rows).toHaveLength(3)
    const opml = await core.exportOpml()
    expect(parseOpml(opml).feeds.some((f) => f.url === 'https://example.com/feed')).toBe(true)
    const again = await createFakeFeeds({ demo: false }).importOpml(opml)
    expect(again.added.length).toBe((await core.listFeeds()).length)

    const hits = await core.search('缓存')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.snippet).toContain('⟪缓存⟫')

    const res = await core.saveToNotes(hits[0]!.row.id)
    expect(res.path.startsWith('收件箱/')).toBe(true)
    expect(core.saved.get(res.path)).toMatch(/^---\ncreated: /)
  })
})
