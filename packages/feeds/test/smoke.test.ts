/**
 * 真联网的冒烟测试：默认跳过（单元测试不碰外网）。要跑：
 *   FEEDS_SMOKE=1 pnpm vitest run packages/feeds/test/smoke.test.ts
 * 订一个真的 Atom 源、找一个真网页里的源、抓一篇全文。网站改版或连不上时会失败，那不算代码坏了。
 */
import { expect, it } from 'vitest'
import { openTest, tempDir } from './helpers'

it.skipIf(!process.env['FEEDS_SMOKE'])('真的源：订阅、条件请求、找源、抓全文', { timeout: 120_000 }, async () => {
  const tmp = tempDir()
  const core = await openTest(tmp.dir, { http: { hostGapMs: 1000, timeoutMs: 30_000 } })
  try {
    const feed = await core.subscribe({ url: 'https://simonwillison.net/atom/everything/' })
    expect(feed.unread).toBeGreaterThan(5)
    const again = await core.refresh([feed.id])
    expect(again.failed).toBe(0)
    const found = await core.discover('https://www.ruanyifeng.com/blog/')
    expect(found.candidates.length).toBeGreaterThan(0)
    const [first] = (await core.listArticles({ feedId: feed.id, limit: 1 })).rows
    const r = await core.readable(first!.id, { full: true })
    expect(r.textLength).toBeGreaterThan(200)
    console.log(`冒烟：${feed.title}，${feed.unread} 篇；再抓 ${JSON.stringify(again)}；找到 ${found.candidates.map((c) => c.url).join(', ')}；全文 ${r.textLength} 字`)
  } finally {
    await core.close()
    tmp.done()
  }
})
