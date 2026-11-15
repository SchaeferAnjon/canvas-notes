import { expect, test } from '@playwright/test'
import { launch } from './app'

// AI 浮窗打开时，首页（A 和 B）的背景要铺满整个中间栏，不能在右边空出一条（用户 2026-11-15 报的 bug）
for (const style of ['a', 'b'] as const) {
  test(`AI 浮着时首页 ${style.toUpperCase()} 的背景铺满中间栏，内容让出浮窗的位置`, async () => {
    const run = await launch({ 'a.md': '# a\n' })
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
      await page.evaluate((s) => (window as unknown as { cn: { setSettings(p: unknown): Promise<unknown> } }).cn.setSettings({ appearance: { homeStyle: s } }), style)
      await page.reload()
      await expect(page.locator('.hscroll')).toBeVisible()
      await page.getByRole('button', { name: '打开 AI' }).click()
      await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
      const center = (await page.locator('.center').boundingBox())!
      const bg = (await page.locator('.hscroll').boundingBox())!
      expect(Math.abs(center.x + center.width - (bg.x + bg.width))).toBeLessThan(20)
      const content = (await page.locator('.hwrap').boundingBox())!
      const panel = (await page.getByRole('complementary', { name: 'AI 对话' }).boundingBox())!
      expect(content.x + content.width).toBeLessThanOrEqual(panel.x + 4)
    } finally {
      await run.close()
    }
  })
}
