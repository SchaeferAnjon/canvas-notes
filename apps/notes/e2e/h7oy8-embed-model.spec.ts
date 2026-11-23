/**
 * 找候选用的本机模型换 bge-m3（task-h7oy8）：测试模式下载走假的（不联网，几秒走完），「bge-m3」是 e5 换了个名字（bge-m3-fake）。
 * 走一遍：e5 先用着 → 假下载有进度 → 后台建索引 → 换过去；换的过程中「意思相近」照样有结果；
 * 换完 searchRelated 给每篇最像的几篇和那一对段落，报的模型是 bge-m3-fake；「按意思找」关了 searchRelated 是 null，状态写 semantic false。
 */
import { expect, test } from '@playwright/test'
import { launch } from './app'

type Status = { phase: string; model: string | null; semantic: boolean; got: number; size: number; done: number; total: number; fake?: boolean }
type Win = { cn: { embedStatus(): Promise<Status>; onEmbed(cb: (s: Status) => void): () => void; setSettings(p: unknown): Promise<unknown> }; cnSearch: { meaning(q: string): Promise<{ path: string }[]>; status(): Promise<{ phase: string }> }; seen: Status[] }

const VOL = '冰岛的火山和板块裂谷：大西洋中脊从岛上穿过，板块每年分开两厘米，岩浆从裂缝里涌出来。'
const FILES = {
  '旅行/冰岛.md': `# 冰岛\n\n${VOL}\n`,
  '地理/大西洋中脊.md': '# 大西洋中脊\n\n大西洋中脊是板块分开的地方，岩浆涌出来形成新的地壳，冰岛就在中脊上，火山很多。\n',
  '生活/购物.md': '# 购物\n\n今天的购物清单：牛奶、鸡蛋、面包。\n',
  '项目/周报.md': '# 周报\n\n这周把登录页改完了，下周做支付。\n',
}

test('假下载 → 后台建索引 → 换成「bge-m3」；searchRelated 给最像的几篇', async () => {
  test.setTimeout(180_000)
  const run = await launch(FILES, { CN_EMBED_FAKE_MS: '2500' })
  const { page, app } = run
  try {
    await page.evaluate(() => {
      const w = window as unknown as Win
      w.seen = []
      w.cn.onEmbed((s) => w.seen.push(s))
    })
    const status = () => page.evaluate(() => (window as unknown as Win).cn.embedStatus())
    expect((await status()).semantic).toBe(true)
    expect((await status()).fake).toBe(true)

    // 换过去之前：意思相近照样能用（e5 的索引）
    await expect.poll(() => page.evaluate(() => (window as unknown as Win).cnSearch.status().then((s) => s.phase)), { timeout: 60_000 }).toBe('ready')
    const before = await page.evaluate(() => (window as unknown as Win).cnSearch.meaning('火山和板块'))
    expect(before.map((h) => h.path)).toContain('旅行/冰岛.md')

    await expect.poll(async () => (await status()).phase, { timeout: 90_000 }).toBe('ready')
    const done = await status()
    expect(done.model).toBe('bge-m3-fake')
    const seen = await page.evaluate(() => (window as unknown as Win).seen)
    // 进度一步步推上来：下载中途（没下完）、在校验、建索引
    expect(seen.some((s) => s.phase === 'downloading' && s.got > 0 && s.got < s.size)).toBe(true)
    expect(seen.some((s) => s.phase === 'verifying')).toBe(true)
    expect(seen.some((s) => s.phase === 'indexing')).toBe(true)
    // 换过去以前用的是 e5（刚打开时搜索进程还在载模型，model 先是 null）
    expect(seen.filter((s) => s.phase !== 'ready').some((s) => s.model === 'multilingual-e5-small-int8')).toBe(true)
    expect(seen.filter((s) => s.phase !== 'ready').every((s) => s.model !== 'bge-m3-fake')).toBe(true)

    // 换过去以后：搜索状态还是建好的，意思相近照样有结果
    expect(await page.evaluate(() => (window as unknown as Win).cnSearch.status().then((s) => s.phase))).toBe('ready')
    const after = await page.evaluate(() => (window as unknown as Win).cnSearch.meaning('火山和板块'))
    expect(after.map((h) => h.path)).toEqual(before.map((h) => h.path))

    const rel = await app.evaluate(async () => {
      const r = await (globalThis as unknown as { cnSearchRelated(p: string[], k?: number): Promise<(Map<string, { path: string; score: number; mine: string; theirs: string }[]> & { model: string }) | null> }).cnSearchRelated(['旅行/冰岛.md', '没有这篇.md'], 2)
      return r && { model: r.model, ice: r.get('旅行/冰岛.md'), none: r.get('没有这篇.md') }
    })
    expect(rel).not.toBeNull()
    expect(rel!.model).toBe('bge-m3-fake')
    expect(rel!.ice).toHaveLength(2)
    expect(rel!.ice![0]).toMatchObject({ path: '地理/大西洋中脊.md', mine: VOL })
    expect(rel!.ice![0]!.theirs).toContain('大西洋中脊是板块分开的地方')
    expect(rel!.ice![0]!.score).toBeGreaterThan(rel!.ice![1]!.score)
    expect(rel!.none).toEqual([])

    // 「按意思找」关了：状态写关着，searchRelated 是 null
    await page.evaluate(() => (window as unknown as Win).cn.setSettings({ editor: { semantic: false } }))
    await expect.poll(async () => (await status()).semantic, { timeout: 10_000 }).toBe(false)
    expect((await status()).model).toBeNull()
    await expect
      .poll(() => app.evaluate(async () => (await (globalThis as unknown as { cnSearchRelated(p: string[]): Promise<unknown> }).cnSearchRelated(['旅行/冰岛.md'])) === null), { timeout: 20_000 })
      .toBe(true)

    // 再打开：「bge-m3」那份建完过，直接用它，不再下（假下载每次打开都走一遍，几秒）
    await page.evaluate(() => (window as unknown as Win).cn.setSettings({ editor: { semantic: true } }))
    await expect.poll(async () => (await status()).phase, { timeout: 60_000 }).toBe('ready')
    expect((await status()).model).toBe('bge-m3-fake')
  } finally {
    await run.close()
  }
})
