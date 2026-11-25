import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { FeedsCore } from '../src'
import { parseOpml, writeOpml } from '../src/opml'
import type { Feed, Folder } from '../src/types'
import { openTest, tempDir } from './helpers'

const folo = readFileSync(join(__dirname, 'fixtures/folo.opml'), 'utf8')

describe('OPML 读写（纯函数）', () => {
  it('Folo 导出的：文件夹套文件夹拼成一个名字、type=link 不算、坏地址也交出去让调的人判', () => {
    const doc = parseOpml(folo)
    expect(doc.title).toBe('Folo 导出')
    expect(doc.feeds.map((f) => [f.folder, f.title, f.url])).toEqual([
      ['科技', 'Simon Willison', 'https://simonwillison.net/atom/everything/'],
      ['科技 / AI', 'OpenAI News', 'https://openai.com/news/rss.xml'],
      ['社交', 'B站 · 影视飓风', 'https://rsshub.app/bilibili/user/video/946974'],
      ['社交', '微博', 'rsshub://weibo/user/1195230310'],
      [null, '阮一峰的网络日志', 'https://www.ruanyifeng.com/blog/atom.xml'],
      [null, '坏地址', 'not a url'],
    ])
    expect(doc.feeds[0]!.siteUrl).toBe('https://simonwillison.net/')
    expect(() => parseOpml('<rss></rss>')).toThrow('不是 OPML')
  })

  it('写出去再读回来一样（名字里的特殊字、RSSHub 路由、类型、文件夹）', () => {
    const folders: Folder[] = [
      { id: 'd_2', name: '社交 & "朋友"', order: 1 },
      { id: 'd_1', name: '科技', order: 0 },
    ]
    const base = { addedAt: 0, errorCount: 0, broken: false, unread: 0, intervalMin: 30, mode: 'normal' as const, digestEvery: 20 }
    const feeds: Feed[] = [
      { ...base, id: 'f_1', url: 'https://a.test/feed?x=1&y=2', title: 'A <源>', kind: 'article', folderId: 'd_1', siteUrl: 'https://a.test/' },
      { ...base, id: 'f_2', url: 'rsshub://weibo/user/1', title: '微博', kind: 'social', folderId: 'd_2' },
      { ...base, id: 'f_3', url: 'https://c.test/podcast.xml', title: '播客', kind: 'audio', folderId: null },
    ]
    const xml = writeOpml(feeds, folders, { resolve: (u) => u.replace('rsshub://', 'http://nas.local:1200/'), created: new Date(Date.UTC(2026, 10, 25)) })
    expect(xml).toContain('<dateCreated>Wed, 25 Nov 2026 00:00:00 GMT</dateCreated>')
    expect(xml).toContain('xmlUrl="http://nas.local:1200/weibo/user/1" cnRoute="weibo/user/1" cnKind="social"')
    expect(xml.indexOf('科技')).toBeLessThan(xml.indexOf('社交'))
    const back = parseOpml(xml)
    expect(back.feeds).toEqual([
      { url: 'https://a.test/feed?x=1&y=2', folder: '科技', title: 'A <源>', siteUrl: 'https://a.test/' },
      { url: 'rsshub://weibo/user/1', folder: '社交 & "朋友"', title: '微博', kind: 'social' },
      { url: 'https://c.test/podcast.xml', folder: null, title: '播客', kind: 'audio' },
    ])
    // 同样的输入写两次一字不差
    expect(writeOpml(feeds, folders, { resolve: (u) => u.replace('rsshub://', 'http://nas.local:1200/'), created: new Date(Date.UTC(2026, 10, 25)) })).toBe(xml)
  })
})

describe('导入导出（真的核心）', () => {
  let tmp: ReturnType<typeof tempDir>
  let core: FeedsCore
  beforeEach(async () => {
    tmp = tempDir()
    core = await openTest(tmp.dir)
  })
  afterEach(async () => {
    await core.close()
    tmp.done()
  })

  it('导入不联网：建文件夹、rsshub.app 的地址认回路由、坏地址进 failed；再导一次全是 existing；导出再导进新库一样', async () => {
    const r = await core.importOpml(folo)
    expect(r.added.map((f) => [f.title, f.url, f.kind])).toEqual([
      ['Simon Willison', 'https://simonwillison.net/atom/everything/', 'article'],
      ['OpenAI News', 'https://openai.com/news/rss.xml', 'article'],
      ['B站 · 影视飓风', 'rsshub://bilibili/user/video/946974', 'video'],
      ['微博', 'rsshub://weibo/user/1195230310', 'social'],
      ['阮一峰的网络日志', 'https://www.ruanyifeng.com/blog/atom.xml', 'article'],
    ])
    expect(r.failed).toEqual([{ url: 'not a url', reason: '地址不对' }])
    expect(r.folders.map((f) => f.name)).toEqual(['科技', '科技 / AI', '社交'])
    const again = await core.importOpml(folo)
    expect(again.added).toEqual([])
    expect(again.existing).toHaveLength(5)

    const out = await core.exportOpml()
    // 没填 RSSHub 地址：照样写 rsshub://
    expect(out).toContain('xmlUrl="rsshub://weibo/user/1195230310"')
    const tmp2 = tempDir()
    const other = await openTest(tmp2.dir)
    try {
      await other.importOpml(out)
      const shape = async (c: FeedsCore) => {
        const folders = new Map((await c.listFolders()).map((f) => [f.id, f.name]))
        return (await c.listFeeds()).map((f) => [f.id, f.title, f.url, f.kind, f.folderId ? folders.get(f.folderId) : null]).sort()
      }
      expect(await shape(other)).toEqual(await shape(core))
      expect(await other.exportOpml()).toBe(out)
    } finally {
      await other.close()
      tmp2.done()
    }
  })
})
