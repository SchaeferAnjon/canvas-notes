/**
 * 生长图动效（设计页 154 版本 A：force-graph + Motion，2026-11-25 用户选）：打开先从头长一遍（新点从连着的那篇旁边弹出来、线伸过去），
 * 拖点（坐标跟着手）、拖画布、滚轮缩放（放大倍数变）、点一篇（「连着 N 篇」、别的淡下去、镜头飞近）、点空白回去；减弱动态时直接是结果。
 * 都是真点、真拖、真滚，窗口不上屏（CN_E2E=1），样本库是编的（fixtures/growth-history）。
 */
import { expect, test, type Page } from '@playwright/test'
import { launch, leftView, tabOn } from './app'
import { prepareHistory, TOTAL } from './fixtures/growth-history'

type Perf = { at(p: string): { x: number; y: number } | null; zoom(): number; points(): { x: number; y: number }[]; dimmed: number }
const perf = <T,>(page: Page, f: (p: Perf) => T) => page.evaluate(`(${f.toString()})(window.cnGrowthPerf)`) as Promise<T>
const at = (page: Page, path: string) => page.evaluate((p) => (window as unknown as { cnGrowthPerf: Perf }).cnGrowthPerf.at(p), path)
const canvas = (page: Page) => page.getByTestId('growth-canvas')
const num = async (page: Page, attr: string) => Number(await canvas(page).getAttribute(attr))
const AMDAHL = '课程/HPDC/Amdahl定律.md'

async function openGrowth(page: Page) {
  await leftView(page, '梦游报告')
  await page.getByTestId('dream-seg-growth').click()
  await expect(tabOn(page)).toContainText('生长')
}

/** 画布上一处空白：离每一篇都 40 像素以上、上面没盖着浮层 */
async function blank(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as { cnGrowthPerf: Perf }).cnGrowthPerf
    const pts = p.points()
    const host = document.querySelector('[data-testid="growth-canvas"]')!
    const r = host.getBoundingClientRect()
    for (let y = r.top + r.height * 0.3; y < r.bottom - 80; y += 17)
      for (let x = r.left + r.width * 0.25; x < r.right - 80; x += 23) {
        const el = document.elementFromPoint(x, y)
        if (!el || el.tagName !== 'CANVAS' || !host.contains(el)) continue
        if (pts.every((q) => Math.hypot(q.x - x, q.y - y) > 40)) return { x, y }
      }
    return null
  })
}

test('打开先长一遍；拖点、拖画布、滚轮缩放、点一篇看邻居、点空白回去', async () => {
  test.setTimeout(150_000)
  const run = await launch({}, {}, prepareHistory)
  const { page } = run
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // CSP（script-src 'self'，没有 unsafe-eval）下能跑：没有拦下来的脚本
  page.on('console', (m) => /Content Security Policy|unsafe-eval/i.test(m.text()) && errors.push(m.text()))
  try {
    await openGrowth(page)
    // 从头长：在播，篇数一路变多，长完停在现在
    await expect(canvas(page)).toHaveAttribute('data-playing', '1', { timeout: 30_000 })
    const n1 = await num(page, 'data-notes')
    await page.waitForTimeout(500)
    const n2 = await num(page, 'data-notes')
    expect(n2).toBeGreaterThan(n1)
    expect(n1).toBeLessThan(TOTAL)
    await page.screenshot({ path: test.info().outputPath('growing.png') })
    await expect(canvas(page)).toHaveAttribute('data-playing', '', { timeout: 15_000 })
    await expect(canvas(page)).toHaveAttribute('data-notes', String(TOTAL))
    await page.waitForTimeout(1200)

    // 拖点：按住 Amdahl定律 拖开，拖着的时候它跟着手；松手弹回自己的位置
    const p0 = (await at(page, AMDAHL))!
    await page.mouse.move(p0.x, p0.y)
    await page.mouse.down()
    await page.mouse.move(p0.x + 30, p0.y + 20, { steps: 4 })
    await page.mouse.move(p0.x + 90, p0.y + 60, { steps: 8 })
    const pd = (await at(page, AMDAHL))!
    expect(Math.abs(pd.x - (p0.x + 90))).toBeLessThan(4)
    expect(Math.abs(pd.y - (p0.y + 60))).toBeLessThan(4)
    await page.mouse.up()
    // 拖完不算点了它（没出卡片）
    await expect(page.getByTestId('growth-card')).toHaveCount(0)
    await expect.poll(async () => { const q = (await at(page, AMDAHL))!; return Math.hypot(q.x - p0.x, q.y - p0.y) }, { timeout: 5000 }).toBeLessThan(6)

    // 拖画布：从空白处按住拖 (120, -60)，整张跟着挪
    const b = (await blank(page))!
    expect(b).not.toBeNull()
    const k0 = await perf(page, (p) => p.zoom())
    const before = (await at(page, AMDAHL))!
    await page.mouse.move(b.x, b.y)
    await page.mouse.down()
    await page.mouse.move(b.x + 60, b.y - 30, { steps: 5 })
    await page.mouse.move(b.x + 120, b.y - 60, { steps: 5 })
    await page.mouse.up()
    const after = (await at(page, AMDAHL))!
    expect(Math.abs(after.x - before.x - 120)).toBeLessThan(3)
    expect(Math.abs(after.y - before.y + 60)).toBeLessThan(3)
    await expect(page.getByTestId('growth-card')).toHaveCount(0)

    // 滚轮放大：放大倍数变大，鼠标下那一点不动
    const b2 = (await blank(page))!
    await page.mouse.move(b2.x, b2.y)
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -120)
    await expect.poll(() => perf(page, (p) => p.zoom())).toBeGreaterThan(k0 * 1.3)
    const kz = await perf(page, (p) => p.zoom())
    // 滚回来（缩小）
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 120)
    await expect.poll(() => perf(page, (p) => p.zoom())).toBeLessThan(kz * 0.8)
    // 看全部回到起点
    await page.getByRole('button', { name: '看全部' }).click()
    await page.waitForTimeout(300)
    const kFit = await perf(page, (p) => p.zoom())

    // 点 Amdahl定律：卡片写「连着 5 篇」，别的淡下去（这一帧淡了 TOTAL - 6 篇），镜头飞近它和连着的，邻居写上名字
    const pa = (await at(page, AMDAHL))!
    await page.mouse.click(pa.x, pa.y)
    const card = page.getByTestId('growth-card')
    await expect(card.locator('h3')).toHaveText('Amdahl定律')
    await expect(card).toContainText('连着5篇')
    await expect(canvas(page)).toHaveAttribute('data-sel', AMDAHL)
    await expect.poll(() => perf(page, (p) => p.dimmed)).toBe(TOTAL - 6)
    await expect.poll(() => perf(page, (p) => p.zoom()), { timeout: 3000 }).toBeGreaterThan(kFit * 1.2)
    await expect.poll(async () => (await canvas(page).getAttribute('data-labels')) ?? '').toContain('第5讲')
    await page.waitForTimeout(700)
    await page.screenshot({ path: test.info().outputPath('selected.png') })

    // 点空白处：不选了、别的回来、镜头回到点之前
    const b3 = (await blank(page))!
    await page.mouse.click(b3.x, b3.y)
    await expect(card).toHaveCount(0)
    await expect(canvas(page)).toHaveAttribute('data-sel', '')
    await expect.poll(() => perf(page, (p) => p.dimmed)).toBe(0)
    await expect.poll(async () => Math.abs((await perf(page, (p) => p.zoom())) - kFit), { timeout: 3000 }).toBeLessThan(0.01)
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})

test('系统「减少动态效果」开着：打开生长图直接是现在的全库，不从头长', async () => {
  test.setTimeout(150_000)
  const run = await launch({}, {}, prepareHistory)
  const { page } = run
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openGrowth(page)
    await expect(canvas(page)).toHaveAttribute('data-notes', String(TOTAL), { timeout: 30_000 })
    const seen: string[] = []
    for (let i = 0; i < 6; i++) {
      seen.push((await canvas(page).getAttribute('data-playing')) ?? '')
      expect(await num(page, 'data-notes')).toBe(TOTAL)
      await page.waitForTimeout(150)
    }
    expect(seen.every((x) => x === '')).toBe(true)
  } finally {
    await run.close()
  }
})
