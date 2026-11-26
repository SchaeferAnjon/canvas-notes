/**
 * 生长图动效的帧率（设计页 154 版本 A）：合成库 200 篇、2000 篇，打开时从头长一遍的那几秒、长完拖着画布平移 2 秒，
 * 各数浏览器走了几帧（requestAnimationFrame，平均和 0.5 秒一格里最少的那格）。数写进 fps.json，交付页照这个写。窗口不上屏。
 */
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { launch, leftView, tabOn } from './app'
import { prepareSynth } from './fixtures/growth-history'

async function startCount(page: Page) {
  await page.evaluate(() => {
    // 每次数一轮新的：上一轮还排着的那一帧认出不是自己的就停（不然两轮叠在一起，数出 240）
    const w = window as unknown as { cnRaf: number[]; cnRafOn: boolean; cnRafRun: number }
    const run = (w.cnRafRun = (w.cnRafRun ?? 0) + 1)
    w.cnRaf = []
    w.cnRafOn = true
    const tick = (t: number) => {
      if (w.cnRafRun !== run) return
      w.cnRaf.push(t)
      if (w.cnRafOn) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}
async function stopCount(page: Page) {
  const raf = await page.evaluate(() => {
    const w = window as unknown as { cnRaf: number[]; cnRafOn: boolean }
    w.cnRafOn = false
    return w.cnRaf
  })
  const span = raf[raf.length - 1]! - raf[0]!
  let min = Infinity
  for (let s = raf[0]!; s + 500 <= raf[raf.length - 1]!; s += 250) min = Math.min(min, raf.filter((t) => t >= s && t < s + 500).length * 2)
  return { avg: Math.round(((raf.length - 1) / span) * 1000), min: min === Infinity ? 0 : min, seconds: Math.round(span / 100) / 10 }
}

for (const n of [200, 2000]) {
  test(`合成库 ${n} 篇：长的时候、拖画布时一秒几帧`, async () => {
    test.setTimeout(240_000)
    const run = await launch({}, {}, prepareSynth(n))
    const { page } = run
    try {
      await leftView(page, '梦游报告')
      await startCount(page)
      await page.getByTestId('dream-seg-growth').click()
      await expect(tabOn(page)).toContainText('生长')
      const canvas = page.getByTestId('growth-canvas')
      await expect(canvas).toHaveAttribute('data-playing', '1', { timeout: 120_000 })
      // 从开始长量起（之前那一段是后台在算位置）
      await stopCount(page)
      await startCount(page)
      await expect(canvas).toHaveAttribute('data-playing', '', { timeout: 30_000 })
      const grow = await stopCount(page)
      await expect(canvas).toHaveAttribute('data-notes', String(n + 1))
      await page.waitForTimeout(800)
      await page.screenshot({ path: test.info().outputPath(`synth-${n}.png`) })
      // 拖着画布绕圈 2 秒
      const box = (await page.locator('.gr-stage').boundingBox())!
      await startCount(page)
      await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.2)
      await page.mouse.down()
      const t0 = Date.now()
      let k = 0
      while (Date.now() - t0 < 2000) {
        k++
        await page.mouse.move(box.x + box.width * 0.6 + Math.sin(k / 6) * 150, box.y + box.height * 0.4 + Math.cos(k / 6) * 90)
      }
      await page.mouse.up()
      const pan = await stopCount(page)
      const out = { notes: n + 1, grow, pan }
      console.log('帧率', JSON.stringify(out))
      writeFileSync(test.info().outputPath('fps.json'), JSON.stringify(out, null, 2))
      expect(grow.avg).toBeGreaterThanOrEqual(30)
      expect(pan.avg).toBeGreaterThanOrEqual(30)
    } finally {
      await run.close()
    }
  })
}
