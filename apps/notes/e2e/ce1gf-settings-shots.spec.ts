/**
 * iPhone / iPad 设置照 Mac 重做（task-ce1gf）的对照截图：只在给了 CN_SHOTS 时截（目录），天青、深湖各一组，
 * Mac 设置 15 页每页一张（只截设置那块弹窗），和 iPad 同一页并排。
 */
import { type Page, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch } from './app'
import { SETTINGS_PAGES } from '../src/shared/settings-index'

const dir = process.env.CN_SHOTS
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })

for (const [skin, tone] of [
  ['sky', '天青'],
  ['petrol', '深湖'],
] as const) {
  test(`设置 15 页对照截图 · ${tone}`, async () => {
    test.skip(!dir, '只在给了 CN_SHOTS 时截')
    const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' })
    const { page } = run
    try {
      await page.setViewportSize({ width: 1200, height: 820 })
      await page.evaluate((skin) => window.cn.setSettings({ appearance: { followSystem: false, skin } }), skin)
      await page.reload()
      await page.locator('.vault b').waitFor()
      await page.keyboard.press('Meta+Comma')
      const nav = dlg(page).getByRole('navigation', { name: '设置分页' })
      for (const [i, p] of SETTINGS_PAGES.entries()) {
        await nav.getByRole('button', { name: p.name, exact: true }).click()
        await page.waitForTimeout(400)
        await dlg(page).screenshot({ path: join(dir!, `mac-${tone}-${String(i + 1).padStart(2, '0')}-${p.id}.png`) })
      }
      writeFileSync(join(dir!, `mac-${tone}.json`), JSON.stringify(SETTINGS_PAGES.map((p) => p.id)))
    } finally {
      await run.close()
    }
  })
}
