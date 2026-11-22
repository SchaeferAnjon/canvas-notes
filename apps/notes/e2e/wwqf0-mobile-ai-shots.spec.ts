// 设置 › AI「iPhone 和 iPad」那一节的截图（task-wwqf0），天青、深湖各一套：开关开着出二维码、配好一台以后。给设计复审对照用，平时跳过：
//   CN_SHOTS=<目录> npx playwright test e2e/wwqf0-mobile-ai-shots.spec.ts
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pairWith } from '../src/main/mobile-ai/client'
import { parsePairLink } from '../src/main/mobile-ai/protocol'
import { launch } from './app'

const DIR = process.env.CN_SHOTS ?? ''
test.skip(!DIR, '截图才跑：CN_SHOTS=<目录>')

for (const skin of ['sky', 'petrol']) {
  test(`设置 › AI · iPhone 和 iPad（${skin}）`, async () => {
    const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_AI_FAKE: '1', CN_MAC_NAME: 'Schaefer 的 MacBook Pro' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.keyboard.press('Meta+,')
      await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
      const dlg = page.getByRole('dialog', { name: '设置' })
      const group = dlg.getByRole('group', { name: 'iPhone 和 iPad' })
      await group.getByRole('switch', { name: '让iPhone / iPad用这台Mac的AI' }).click()
      const qr = group.getByRole('img', { name: '配对二维码' })
      await expect(qr).toBeVisible()
      await group.scrollIntoViewIfNeeded()
      await page.waitForTimeout(400)
      mkdirSync(DIR, { recursive: true })
      await dlg.screenshot({ path: join(DIR, `mac-settings-qr-${skin}.png`) })
      // 配好一台：设置里多一行，二维码换成「配一台新的」
      const link = parsePairLink((await qr.getAttribute('data-link'))!)
      await pairWith(link, `http://127.0.0.1:${link.port}`, 'iPad', 'iPad')
      await expect(group.locator('[data-row^="mobileAiDev-"]')).toHaveCount(1)
      await page.waitForTimeout(300)
      await dlg.screenshot({ path: join(DIR, `mac-settings-paired-${skin}.png`) })
    } finally {
      await run.close()
    }
  })
}
