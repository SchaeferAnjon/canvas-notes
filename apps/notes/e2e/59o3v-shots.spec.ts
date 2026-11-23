/**
 * 设置 › 软件家族（task-59o3v）的对照截图：只在给了 CN_SHOTS 时截（目录）。和原型同一个窗口大小（1440 × 887，设置弹窗 960 × 680），
 * 天青、深湖各一组：装了画布今日、ParaRead（同原型「装了画布今日、ParaRead」那一档）/ 一个都没装，各截页顶和翻到底。
 */
import { type Page, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from './app'

const dir = process.env.CN_SHOTS
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const SOME = { 'canvas-today': '0.3.0', pararead: '0.1.4', bookmarkkeeper: '0.8.0', askfree: '1.2.0', dispatch: '0.9.5' }

for (const [skin, tone] of [
  ['sky', '天青'],
  ['petrol', '深湖'],
] as const) {
  for (const [state, apps] of [
    ['some', SOME],
    ['none', {}],
  ] as const) {
    test(`软件家族对照截图 · ${tone} · ${state}`, async () => {
      test.skip(!dir, '只在给了 CN_SHOTS 时截')
      const file = join(mkdtempSync(join(tmpdir(), 'cn-fam-shot-')), 'installed.json')
      writeFileSync(file, JSON.stringify(apps))
      const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_FAMILY_INSTALLED_FILE: file })
      const { page } = run
      try {
        await page.setViewportSize({ width: 1440, height: 887 })
        await page.evaluate((skin) => window.cn.setSettings({ appearance: { followSystem: false, skin } }), skin)
        await page.reload()
        await page.locator('.vault b').waitFor()
        await page.keyboard.press('Meta+Comma')
        await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '软件家族', exact: true }).click()
        await dlg(page).locator('.fm-card').first().waitFor()
        await page.mouse.move(0, 0)
        await page.waitForTimeout(400)
        const set = dlg(page)
        await set.screenshot({ path: join(dir!, `notes-${state}-${tone}-top.png`) })
        await set.locator('.set-body').evaluate((e) => (e.scrollTop = 99999))
        await page.waitForTimeout(200)
        await set.screenshot({ path: join(dir!, `notes-${state}-${tone}-bottom.png`) })
      } finally {
        await run.close()
      }
    })
  }
}
