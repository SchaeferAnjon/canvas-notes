/**
 * 梦游对照「并排」上下滚动卡（梦游对比滚动）。用户（0.5.8 截图：一条「可以建的词条页」，对照是两篇长笔记并排、改了 36 处）：
 * 「这里上下滑动的时候感觉好卡」。
 * 样本照那一条的规模造（e2e/fixtures/dream-long.ts：两篇各三千多行、36 处改动），真点报告里那一条开对照，
 * 从顶上一帧一帧往下滚到底（每帧 40px，像触控板慢慢滑），量两样：
 * - 帧率：requestAnimationFrame 两次之间隔多久（一秒几帧）；
 * - 每帧主线程花多久：Chromium 自己记的脚本、排版、算样式累计时间（CDP Performance.getMetrics），滚之前、滚完以后相减，除以帧数。
 *   里面是滚动事件、CodeMirror 量高度和重画看得见的行、样式、排版。无头时帧率跟着合成器走不一定准，这一样才是硬指标（< 8 ms）。
 *   先原地不滚走 120 帧当对照（idle）。
 * 窗口不上屏（CN_E2E），都是真点。数写进 perf.json（附件）。
 */
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { acts, launch } from './app'
import { LONG_CHANGES, LONG_VAULT, prepareLong } from './fixtures/dream-long'

interface Run {
  frames: number
  fps: number
  /** 平均每帧：脚本、排版、算样式各几毫秒（Chromium 自己记的累计时间，滚之前和滚完之后相减） */
  scriptMs: number
  layoutMs: number
  styleMs: number
  /** 最长的一帧隔了多久 */
  longestGapMs: number
}

/** 从顶上一帧一帧滚到底：每帧 step 像素（step 0：不滚，原地走 frames 帧当对照）；回来帧率和每帧主线程花在哪 */
async function scrollThrough(page: Page, step: number, frames = 0): Promise<Run> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const m0 = await metrics()
  const r = await page.evaluate(
    ([step, frames]) =>
      new Promise<{ frames: number; fps: number; longestGapMs: number }>((done) => {
        const sc = document.querySelector<HTMLElement>('[data-testid="dream-tab"]:not([hidden]) [data-testid="dream-scroll"]')!
        sc.scrollTop = 0
        const stamps: number[] = []
        const tick = (ts: number) => {
          stamps.push(ts)
          if (step ? sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 1 : stamps.length > frames) {
            const gaps = stamps.slice(1).map((t, i) => t - stamps[i]!)
            const total = stamps[stamps.length - 1]! - stamps[0]!
            done({
              frames: gaps.length,
              fps: Math.round((gaps.length / total) * 10000) / 10,
              longestGapMs: Math.round(Math.max(...gaps)),
            })
            return
          }
          sc.scrollTop += step
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(() => requestAnimationFrame(tick))
      }),
    [step, frames] as const,
  )
  const m1 = await metrics()
  await cdp.detach()
  const per = (k: string) => Math.round(((m1[k]! - m0[k]!) * 1000 * 100) / r.frames) / 100
  return {
    ...r,
    scriptMs: per('ScriptDuration'),
    layoutMs: per('LayoutDuration'),
    styleMs: per('RecalcStyleDuration'),
  }
}

/** 脚本 + 排版 + 样式，平均每帧 */
const work = (r: Run) => Math.round((r.scriptMs + r.layoutMs + r.styleMs) * 100) / 100

test('两篇各三千多行、改了 36 处的对照「并排」：折着、全展开、合一都从顶滚到底，一秒 ≥ 50 帧，每帧脚本 + 排版 + 样式 < 8 ms', async () => {
  test.setTimeout(300_000)
  const run = await launch(LONG_VAULT, {}, prepareLong)
  const { page } = run
  try {
    await page.getByTestId('dream-card').getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByTestId('dream-item').filter({ hasText: '《动手学深度学习》' }).click()
    const t = page.locator('[data-testid="dream-tab"]:not([hidden])')
    await expect(t).toBeVisible()
    // 用户截图里的看法：并排、文档样子；对照是历史那一套（没改的折成「展开没改的 N 行」）
    await expect(acts(page).getByRole('tab', { name: '并排' })).toHaveAttribute('aria-selected', 'true')
    await expect(t.locator('.dv-diff.doc-look')).toBeVisible()
    await expect(t.locator('.cm-merge-b .cm-changedLine').first()).toBeVisible()
    await expect(t.getByTestId('dream-fbar')).toContainText(new RegExp(`改了\\s*${LONG_CHANGES}\\s*处`))
    const folds = t.locator('.cm-collapsedLines')
    await expect(folds.first()).toBeVisible()
    // 下一处：一处一处往下跳（36 处，折着的也跳得到）
    const sc0 = t.getByTestId('dream-scroll')
    await sc0.evaluate((el) => (el.scrollTop = 0))
    let last = 0
    for (let i = 0; i < 5; i++) {
      await acts(page).getByRole('button', { name: '下一处' }).click()
      await expect.poll(() => sc0.evaluate((el) => el.scrollTop)).toBeGreaterThan(last)
      last = await sc0.evaluate((el) => el.scrollTop)
    }
    await acts(page).getByRole('button', { name: '上一处' }).click()
    await expect.poll(() => sc0.evaluate((el) => el.scrollTop)).toBeLessThan(last)
    await page.waitForTimeout(500)
    const idle = await scrollThrough(page, 0, 120)
    await scrollThrough(page, 40)
    const folded = await scrollThrough(page, 40)
    await expect(t.locator('.cm-merge-b .cm-line').last()).toBeInViewport()
    await page.screenshot({ path: test.info().outputPath('folded.png') })
    // 一路展开到整篇（真点每一条「展开没改的 N 行」），再从顶滚到底
    // （编辑器只画看得见的那一截：从顶往下一屏一屏找，见到一条点一条）
    const sc = t.getByTestId('dream-scroll')
    await sc.evaluate((el) => (el.scrollTop = 0))
    let opened = 0
    for (let i = 0; i < 400; i++) {
      if (await folds.count()) {
        await folds.first().click()
        opened++
        await page.waitForTimeout(30)
        continue
      }
      const end = await sc.evaluate((el) => {
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return true
        el.scrollTop += el.clientHeight
        return false
      })
      if (end) break
      await page.waitForTimeout(30)
    }
    expect(opened).toBeGreaterThan(LONG_CHANGES / 2)
    await expect(t.locator('.cm-collapsedLines')).toHaveCount(0)
    await scrollThrough(page, 40)
    const whole = await scrollThrough(page, 40)
    // 滚到底以后：末尾那几行画出来了（不是空白），画着的只是看得见的那几十行
    await expect(t.locator('.cm-merge-b .cm-line').last()).toBeInViewport()
    const linesInDom = await t.evaluate((el) => el.querySelectorAll('.cm-merge-a .cm-line, .cm-merge-b .cm-line').length)
    await page.screenshot({ path: test.info().outputPath('whole-bottom.png') })
    // 合一
    await acts(page).getByRole('tab', { name: '合一' }).click()
    await expect(t.locator('.dv-unified .cm-changedLine').first()).toBeVisible()
    await page.waitForTimeout(300)
    await scrollThrough(page, 40)
    const unified = await scrollThrough(page, 40)
    await acts(page).getByRole('tab', { name: '并排' }).click()
    const res = { idle, folded, whole, unified, linesInDom, opened }
    writeFileSync(test.info().outputPath('perf.json'), JSON.stringify(res, null, 2))
    console.log('perf', JSON.stringify(res))
    expect(linesInDom).toBeLessThan(400)
    for (const r of [folded, whole, unified]) {
      expect(r.fps).toBeGreaterThanOrEqual(50)
      expect(work(r)).toBeLessThan(8)
    }
  } finally {
    await run.close()
  }
})
