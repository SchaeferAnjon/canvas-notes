/**
 * 梦游前后对比动画（设计页 154 版本 A：force-graph + Motion，2026-11-25 用户选）：报告顶上的小图第一次打开自己播、能重播、暂停、拖进度，
 * 挪走的那篇沿弧线走、原处空心圈落定 0.6 秒内淡掉，再打开直接是梦游后；系统「减少动态效果」开着时直接是梦游后。
 * 都是真点（按钮、进度条），窗口不上屏（CN_E2E=1），样本库 dream2（编的）。会动的值从小图自己报的数里读（cnDreamReplay）。
 */
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { launch, leftView } from './app'
import { DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'

type Probe = { time(): number | null; end(): number | null; playing(): boolean; steps(): string[]; node(id: string): { x: number; y: number; scale: number; ghost: number } | null }
const probe = <T,>(page: Page, f: (r: Probe) => T) => page.evaluate(`(${f.toString()})(window.cnDreamReplay)`) as Promise<T>
const time = (page: Page) => probe(page, (r) => r.time()) as Promise<number>
const node = (page: Page, id: string) => page.evaluate((id) => (window as unknown as { cnDreamReplay: Probe }).cnDreamReplay.node(id), id)

const ICE = '收件箱/冰洞.md'
const AURORA = '收件箱/极光.md'

async function dreamAndOpen(page: Page) {
  const card = page.getByTestId('dream-card')
  await card.getByRole('button', { name: '现在梦游' }).click()
  await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
  await card.getByRole('button', { name: '看报告' }).click()
  const panel = page.getByRole('complementary', { name: '梦游报告' })
  await expect(panel.getByTestId('dream-replay')).toBeVisible({ timeout: 20_000 })
  return panel
}

/** 真点进度条上第 f 那一处（按下就跳到那里） */
async function clickRange(page: Page, f: number) {
  const r = (await page.getByTestId('dream-replay-range').boundingBox())!
  // 圆钮 12 宽：值是 (x - 左边 - 6) / (宽 - 12)
  await page.mouse.click(r.x + 6 + (r.width - 12) * f, r.y + r.height / 2)
  // Motion 拖到的那一秒在下一帧才落到值上：等两帧再读
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
}

test('第一次打开自己播；重播回到开头、暂停不动、拖进度到 60% 停在那一处；空心圈落定 0.6 秒内淡掉；再打开直接是梦游后', async () => {
  test.setTimeout(180_000)
  const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, prepareDream2)
  const { page } = run
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))
  // CSP（script-src 'self'，没有 unsafe-eval）下能跑：没有拦下来的脚本
  page.on('console', (m) => /Content Security Policy|unsafe-eval/i.test(m.text()) && errors.push(m.text()))
  try {
    const panel = await dreamAndOpen(page)
    const box = panel.getByTestId('dream-replay')
    // 这晚：挪了三篇、补了一条双链、一对可能重复（合成一个）
    expect(await probe(page, (r) => r.steps())).toEqual(['move', 'move', 'move', 'link', 'merge'])
    const end = (await probe(page, (r) => r.end())) as number
    // 前 4 处一处 1.4 秒、第 5 处和别的一起，最后一个动作（合并后空心圈淡掉）做完再停 0.4 秒
    expect(end).toBeGreaterThanOrEqual(8.5)
    expect(end).toBeLessThan(9.2)

    // 自己在播：隔 0.6 秒读两次，时间往前走；进度条跟着走
    expect(await probe(page, (r) => r.playing())).toBe(true)
    const t1 = await time(page)
    const v1 = Number(await page.getByTestId('dream-replay-range').inputValue())
    await page.waitForTimeout(600)
    const t2 = await time(page)
    expect(t2).toBeGreaterThan(t1 + 0.3)
    expect(Number(await page.getByTestId('dream-replay-range').inputValue())).toBeGreaterThan(v1)

    // 播到第一处：「冰洞」从收件箱沿弧线挪到剪藏，挪的时候 y 先往上（弧线顶）再落下
    await expect(box).toHaveAttribute('data-phase', 'step0', { timeout: 5000 })
    await expect(panel.getByTestId('dream-replay-corner')).toHaveText('第1处，共5处')
    await expect(panel.getByTestId('dream-replay-cap')).toContainText('挪到旅行：冰洞')
    // 量帧率：播着的时候 2 秒里浏览器走了几帧
    const fps = await page.evaluate(
      () =>
        new Promise<number>((done) => {
          let n = 0
          const t0 = performance.now()
          const tick = (t: number) => (t - t0 < 2000 ? (n++, requestAnimationFrame(tick)) : done(Math.round(n / ((t - t0) / 1000))))
          requestAnimationFrame(tick)
        }),
    )
    // 播完停在梦游后
    await expect(box).toHaveAttribute('data-phase', 'after', { timeout: 12_000 })
    await expect(panel.getByTestId('dream-replay-cap')).toContainText('挪了3篇')
    // 还有没收下的：图右下角一个「虚线是还没收下的」小图例
    await expect(panel.getByTestId('dream-replay-key')).toHaveText('虚线是还没收下的')
    await expect.poll(() => probe(page, (r) => r.playing())).toBe(false)
    expect(await time(page)).toBeCloseTo(end, 1)
    // 梦游后原处的空心圈都淡掉了（先挪走、后来又合并的「巴黎自由行」也是）
    for (const id of ['收件箱/冰洞.md', '收件箱/极光.md', '收件箱/巴黎自由行全景指南.md']) expect((await node(page, id))!.ghost).toBe(0)
    const iceEnd = (await node(page, ICE))!

    // 真点「重播」：回到开头，冰洞回到原处、还没长出来
    await panel.getByTestId('dream-replay-again').click()
    await page.waitForTimeout(250)
    expect(await time(page)).toBeLessThan(0.6)
    const iceStart = (await node(page, ICE))!
    expect(Math.abs(iceStart.x - iceEnd.x) + Math.abs(iceStart.y - iceEnd.y)).toBeGreaterThan(20)
    await expect(box).toHaveAttribute('data-phase', 'before')

    // 真点「暂停」：等 1 秒时间不动、冰洞不动；按钮变「播放」
    await page.waitForTimeout(400)
    await panel.getByTestId('dream-replay-toggle').click()
    await expect(panel.getByTestId('dream-replay-toggle')).toHaveAttribute('aria-label', '播放')
    const tp = await time(page)
    const ip = (await node(page, ICE))!
    await page.waitForTimeout(1000)
    expect(await time(page)).toBe(tp)
    expect(await node(page, ICE)).toEqual(ip)
    // 再点一下接着播
    await panel.getByTestId('dream-replay-toggle').click()
    await page.waitForTimeout(400)
    expect(await time(page)).toBeGreaterThan(tp + 0.2)

    // 真点进度条 60%：停在第三处（「极光」正沿弧线挪），不再自己走
    await clickRange(page, 0.6)
    const t60 = await time(page)
    expect(Math.abs(t60 - 0.6 * end)).toBeLessThan(0.4)
    expect(await probe(page, (r) => r.playing())).toBe(false)
    await expect(box).toHaveAttribute('data-phase', 'step2')
    await expect(panel.getByTestId('dream-replay-cap')).toContainText('极光')
    // 极光 4.75 秒起挪、0.7 秒挪完：中间那一刻它在原处和去处之间
    await clickRange(page, 4.9 / end)
    const tMid = await time(page)
    expect(tMid).toBeGreaterThan(4.8)
    expect(tMid).toBeLessThan(5.4)
    const a60 = (await node(page, AURORA))!
    await clickRange(page, 0.05)
    const a0 = (await node(page, AURORA))!
    await clickRange(page, 0.99)
    const a1 = (await node(page, AURORA))!
    // 不在原处也不在去处，而且不在两头连成的直线上（沿弧线走：上面有地方往上弯，没有往下弯）
    expect(Math.hypot(a60.x - a0.x, a60.y - a0.y)).toBeGreaterThan(3)
    expect(Math.hypot(a60.x - a1.x, a60.y - a1.y)).toBeGreaterThan(3)
    const off = Math.abs((a1.x - a0.x) * (a0.y - a60.y) - (a0.x - a60.x) * (a1.y - a0.y)) / Math.hypot(a1.x - a0.x, a1.y - a0.y)
    expect(off).toBeGreaterThan(3)
    // 动的时候原处有空心圈
    await clickRange(page, 0.6)
    expect((await node(page, AURORA))!.ghost).toBeGreaterThan(0)

    // 冰洞第一处 1.95 秒起挪、2.65 秒落定：2.6 秒时原处空心圈还在，3.6 秒（落定 0.95 秒后）没了
    await clickRange(page, 2.6 / end)
    const tg = await time(page)
    if (tg < 3.2) expect((await node(page, ICE))!.ghost).toBeGreaterThan(0)
    await clickRange(page, 3.6 / end)
    expect(await time(page)).toBeGreaterThan(3.25)
    expect((await node(page, ICE))!.ghost).toBe(0)
    await page.screenshot({ path: test.info().outputPath('seek.png') })

    // 换走再回来（重新打开报告）：这份播过了，直接是梦游后
    await leftView(page, '文件')
    await leftView(page, '梦游报告')
    await expect(panel.getByTestId('dream-replay')).toHaveAttribute('data-phase', 'after', { timeout: 10_000 })
    expect(await probe(page, (r) => r.playing())).toBe(false)
    expect(await time(page)).toBeCloseTo(end, 1)

    writeFileSync(test.info().outputPath('fps.json'), JSON.stringify({ dreamFps: fps }))
    console.log('梦游小图帧率', fps)
    expect(fps).toBeGreaterThanOrEqual(30)
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})

test('系统「减少动态效果」开着：打开报告直接是梦游后，不自己播', async () => {
  test.setTimeout(150_000)
  const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, prepareDream2)
  const { page } = run
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const panel = await dreamAndOpen(page)
    await expect(panel.getByTestId('dream-replay')).toHaveAttribute('data-phase', 'after', { timeout: 3000 })
    expect(await probe(page, (r) => r.playing())).toBe(false)
    expect(await time(page)).toBeCloseTo((await probe(page, (r) => r.end())) as number, 1)
    await expect(panel.getByTestId('dream-replay-corner')).toHaveText('梦游后')
    await page.screenshot({ path: test.info().outputPath('reduced.png') })
  } finally {
    await run.close()
  }
})
