import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeBody } from '../src/encoding'
import { inferKind } from '../src/kind'
import { NotAFeedError, parseFeed } from '../src/parse'
import { parseDate } from '../src/dates'
import { sanitizeHtml } from '../src/sanitize'

const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name))
const parse = (name: string, url = 'https://feed.example.test/feed.xml') => parseFeed(decodeBody(fx(name)).text, url)

describe('RSS 2.0', () => {
  const f = parse('rss2.xml')
  it('源的信息', () => {
    expect(f).toMatchObject({ format: 'rss', title: '示例周刊 & 朋友', siteUrl: 'https://example.test/', description: '每周五发布', selfUrl: 'https://example.test/feed.xml', ttlMin: 60 })
    expect(f.items).toHaveLength(3)
  })
  it('content:encoded 当正文、description 当摘要、guid 不是网址时用 link', () => {
    const a = f.items[0]!
    expect(a).toMatchObject({ guid: 'post-374', url: 'https://example.test/2026/local-first.html', author: '张三', title: '本地优先软件的第二春', categories: ['软件', '本地优先'] })
    expect(a.publishedAt).toBe(Date.UTC(2026, 10, 24, 2, 0))
    expect(a.contentHtml).toContain('<b>本地优先软件</b>')
    expect(a.summaryHtml).toBe('这一期讲本地优先软件为什么又流行起来。')
    // 正文里的相对地址相对文章本身
    expect(a.imageUrl).toBe('https://example.test/img/desk.jpg')
  })
  it('没有 link 时 guid 是网址就当链接；转义过的 HTML 描述；音频附件、时长、缩略图', () => {
    const p = f.items[1]!
    expect(p.url).toBe('https://example.test/podcast/400')
    expect(p.contentHtml).toBe('<p>这一期请到一位<em>编辑</em>。</p>')
    expect(p.enclosures).toEqual([{ url: 'https://cdn.example.test/400.mp3', type: 'audio/mpeg', length: 12345678, duration: 3723 }])
    expect(p.imageUrl).toBe('https://cdn.example.test/400.jpg')
  })
  it('两位年份、没有秒、EST', () => {
    expect(f.items[2]!.publishedAt).toBe(Date.UTC(2026, 10, 23, 4, 59))
  })
})

describe('Atom', () => {
  const f = parse('atom.xml')
  it('xml:base 补全地址、type=html 的标题去标签、摘要和正文分开、图片附件当缩略图', () => {
    expect(f).toMatchObject({ format: 'atom', title: "Simon's notes", siteUrl: 'https://blog.example.test/', selfUrl: 'https://blog.example.test/atom.xml', iconUrl: 'https://blog.example.test/favicon.ico' })
    const a = f.items[0]!
    expect(a).toMatchObject({ title: 'Prompt caching saves money', url: 'https://blog.example.test/2026/caching', author: 'Simon', categories: ['LLMs'], imageUrl: 'https://cdn.example.test/chart.png' })
    expect(a.publishedAt).toBe(Date.UTC(2026, 10, 24, 8, 30))
    expect(a.updatedAt).toBe(Date.UTC(2026, 10, 24, 11, 0))
    expect(a.summaryHtml).toBe('<p>A month of bills, cached.</p>')
    expect(a.enclosures).toEqual([])
  })
  it('条目自己的 xml:base、xhtml 正文、没有 published 用 updated', () => {
    const b = f.items[1]!
    expect(b.url).toBe('https://blog.example.test/2026/xhtml-entry')
    expect(b.contentHtml).toBe('<p>Hello <strong>xhtml</strong> &amp; friends.</p><img src="pic.jpg">')
    expect(b.imageUrl).toBe('https://blog.example.test/2026/pic.jpg')
    expect(b.author).toBe('Guest')
    expect(b.publishedAt).toBe(Date.UTC(2026, 10, 23, 8))
  })
  it('纯文字正文转义成段落，作者用源的', () => {
    expect(f.items[2]).toMatchObject({ contentHtml: '<p>Line one &lt;not a tag&gt;</p><p>Line two</p>', author: 'Simon' })
  })
  it('YouTube：media:group 里的缩略图和说明', () => {
    const y = parse('youtube.xml')
    expect(y.items[0]).toMatchObject({ url: 'https://www.youtube.com/watch?v=abc', imageUrl: 'https://i1.ytimg.com/vi/abc/hqdefault.jpg', contentHtml: '<p>Why is ice slippery?<br>The answer took 150 years.</p>' })
    expect(inferKind('https://www.youtube.com/feeds/videos.xml?channel_id=UC123', y)).toBe('video')
  })
})

describe('JSON Feed 和 RDF', () => {
  it('JSON Feed 1.1：作者、附件、纯文字正文、坏的条目跳过', () => {
    const f = parse('feed.json', 'https://json.example.test/feed.json')
    expect(f).toMatchObject({ format: 'json', title: 'JSON 周报', siteUrl: 'https://json.example.test/', iconUrl: 'https://json.example.test/icon.png' })
    expect(f.items).toHaveLength(2)
    expect(f.items[0]).toMatchObject({ guid: '1', author: '李四', summaryHtml: '一句话摘要', imageUrl: 'https://json.example.test/1.jpg', categories: ['json', 'feed'] })
    expect(f.items[1]).toMatchObject({ guid: '2', url: 'https://other.example.test/two', title: '', author: '王五', contentHtml: '<p>只有纯文字。</p><p>第二段。</p>' })
    expect(f.items[1]!.enclosures).toEqual([{ url: 'https://json.example.test/2.mp4', type: 'video/mp4', length: 1000, duration: 90 }])
  })
  it('RSS 1.0：item 和 channel 是兄弟，rdf:about 当 guid，dc:date', () => {
    const f = parse('rdf.xml')
    expect(f).toMatchObject({ format: 'rdf', title: 'RDF 站', siteUrl: 'https://rdf.example.test/' })
    expect(f.items.map((i) => i.guid)).toEqual(['https://rdf.example.test/a', 'https://rdf.example.test/b'])
    expect(f.items[0]).toMatchObject({ author: '鈴木', publishedAt: Date.UTC(2026, 10, 23, 22) })
  })
})

describe('坏的源', () => {
  it('开头有垃圾、标题没闭合、HTML 实体、裸 &、CDATA 标题、看不懂的时间、空条目都扛得住', () => {
    const f = parse('broken.xml')
    expect(f.title).toBe('坏掉的源 Broken')
    expect(f.items.map((i) => i.title)).toEqual(['没闭合的标题', 'CDATA 标题 加粗', '', '中文日期'])
    expect(f.items[0]).toMatchObject({ url: 'https://broken.example.test/1' })
    expect(f.items[0]!.contentHtml).toBe('描述里有   和 © 这种 HTML 实体，还有裸的 & 符号')
    expect(f.items[1]!.publishedAt).toBeUndefined()
    expect(f.items[2]!.contentHtml).toContain('只有正文')
    expect(f.items[3]!.publishedAt).toBe(new Date(2026, 10, 20, 8, 30).getTime())
  })
  it('网页、空文件、不是源的 JSON 报 NotAFeedError，网页认得出是网页', () => {
    expect(() => parseFeed('<!doctype html><html><head><title>x</title></head><body></body></html>', 'https://x.test/')).toThrow(NotAFeedError)
    try {
      parseFeed('<html><body>hi</body></html>', 'https://x.test/')
    } catch (e) {
      expect((e as NotAFeedError).looksLikeHtml).toBe(true)
    }
    expect(() => parseFeed('', 'https://x.test/')).toThrow(NotAFeedError)
    expect(() => parseFeed('{"hello": 1}', 'https://x.test/')).toThrow(NotAFeedError)
    expect(() => parseFeed('{not json', 'https://x.test/')).toThrow(NotAFeedError)
  })
})

describe('编码', () => {
  it('<?xml encoding="gbk"?> 声明的 GBK', () => {
    const d = decodeBody(fx('gbk-declared.xml'))
    expect(d.charset).toBe('gbk')
    expect(parseFeed(d.text, 'http://gbk.test/feed').items[0]!.title).toBe('第一篇：你好世界')
  })
  it('服务器说 UTF-8、文件里没写、其实是 GBK：读不通就换 GB18030', () => {
    const d = decodeBody(fx('gbk-mislabeled.xml'), 'text/xml; charset=utf-8')
    expect(d.charset).toBe('gb18030')
    expect(d.text).toContain('这是用 GBK 写的正文。')
  })
  it('HTTP 头的 charset 优先；Big5；BOM', () => {
    expect(decodeBody(fx('big5.xml')).text).toContain('這是用 Big5 寫的正文。')
    expect(decodeBody(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]), 'text/html; charset=GB2312')).toEqual({ text: '你好', charset: 'gbk' })
    expect(decodeBody(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toEqual({ text: 'A', charset: 'utf-8' })
    expect(decodeBody(new TextEncoder().encode('<meta charset="utf-8">中')).text).toBe('<meta charset="utf-8">中')
  })
})

describe('时间', () => {
  it.each([
    ['2026-11-24T10:00:00Z', Date.UTC(2026, 10, 24, 10)],
    ['2026-11-24T10:00:00.123+08:00', Date.UTC(2026, 10, 24, 2, 0, 0, 123)],
    ['Tue, 24 Nov 2026 10:00:00 GMT', Date.UTC(2026, 10, 24, 10)],
    ['24 Nov 2026 10:00 +0100', Date.UTC(2026, 10, 24, 9)],
    ['Tue, 24 Nov 2026 10:00:00 UT', Date.UTC(2026, 10, 24, 10)],
    ['Wed, 24 Nov 2026 10:00:00 PST', Date.UTC(2026, 10, 24, 18)],
    ['Tue, 24 Sept 2026 10:00:00 Z', Date.UTC(2026, 8, 24, 10)],
  ])('%s', (s, t) => expect(parseDate(s)).toBe(t))
  it('没写时区按本机；读不懂是 undefined', () => {
    expect(parseDate('2026-11-24 10:00:00')).toBe(new Date(2026, 10, 24, 10).getTime())
    expect(parseDate('昨天')).toBeUndefined()
    expect(parseDate('')).toBeUndefined()
  })
})

describe('清洗正文', () => {
  it('去脚本、事件、javascript: 地址，补全相对地址，懒加载的图换真地址，只留视频站的 iframe', () => {
    const out = sanitizeHtml(
      `<p onclick="x()">你好 <a href="javascript:alert(1)">坏</a> <a href="/ok">好</a></p><script>alert(1)</script><style>p{}</style>
       <img src="data:image/gif;base64,AAA" data-src="/real.png" onerror="x()"><img src="javascript:x">
       <iframe src="https://evil.test/x"></iframe><iframe src="https://www.youtube.com/embed/abc"></iframe>
       <font color=red>字</font><pre class="language-ts other"><code>let a = 1 &lt; 2</code></pre><svg><script>x</script></svg><form><input value=1>表单</form>`,
      'https://site.test/post/1',
    )
    expect(out).not.toMatch(/onclick|onerror|javascript:|<script|<style|evil\.test|<font|<svg|<form|表单/)
    expect(out).toContain('<a rel="noopener noreferrer">坏</a>')
    expect(out).toContain('<a href="https://site.test/ok" rel="noopener noreferrer">好</a>')
    expect(out).toContain('<img src="https://site.test/real.png">')
    expect(out).toContain('<iframe src="https://www.youtube.com/embed/abc" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>')
    expect(out).toContain('字')
    expect(out).toContain('<pre class="language-ts"><code>let a = 1 &lt; 2</code></pre>')
  })
  it('没闭合的标签补上', () => {
    expect(sanitizeHtml('<p><b>粗<i>斜', 'https://x.test/')).toBe('<p><b>粗<i>斜</i></b></p>')
  })
})

describe('猜内容类型', () => {
  it('地址和内容', () => {
    expect(inferKind('rsshub://bilibili/user/video/1')).toBe('video')
    expect(inferKind('rsshub://bilibili/user/dynamic/1')).toBe('social')
    expect(inferKind('rsshub://weibo/user/1')).toBe('social')
    expect(inferKind('rsshub://instagram/user/nasa')).toBe('picture')
    expect(inferKind('rsshub://xiaoyuzhou/podcast/1')).toBe('audio')
    expect(inferKind('https://feed.example.test/feed.xml', parse('rss2.xml'))).toBe('article')
    const podcast = parse('rss2.xml')
    podcast.items = podcast.items.filter((i) => i.enclosures.length)
    expect(inferKind('https://feed.example.test/feed.xml', podcast)).toBe('audio')
    const social = parse('broken.xml')
    social.items = social.items.map((i) => ({ ...i, title: '' }))
    expect(inferKind('https://feed.example.test/feed.xml', social)).toBe('social')
  })
})
