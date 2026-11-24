/**
 * 同步来源（设计页 61）的对照截图：只在给了 CN_SHOTS 时截（目录）。和原型同一个窗口大小 1440 × 887（700 宽另截一张），
 * 天青、深湖各一组：没接时的库页、小菜单、填 Key、Key 错了、第一次连上、拉完的子页（上、下）、接上后的库页、设置 › 自动化那一行。
 * Get笔记 是本机的假服务。
 */
import { type Page, test } from '@playwright/test'
import { join } from 'node:path'
import { launch } from './app'
import { type FakeGetnote, GN_CLIENT, GN_KEY, sampleNotes, startFakeGetnote, VAULT_HAS } from './fixtures/fake-getnote'

const dir = process.env.CN_SHOTS
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
let fake: FakeGetnote
test.beforeAll(async () => {
  fake = await startFakeGetnote(sampleNotes())
})
test.afterAll(() => fake.server.close())

for (const [skin, tone] of [
  ['sky', '浅'],
  ['petrol', '深'],
] as const) {
  test(`同步来源对照截图 · ${tone}`, async () => {
    test.skip(!dir, '只在给了 CN_SHOTS 时截')
    fake.notes = sampleNotes()
    const run = await launch(VAULT_HAS, { CN_GETNOTE_API: fake.base, CN_GETNOTE_GAP_MS: '200' })
    const { page } = run
    const shot = async (name: string, whole = false) => {
      await page.mouse.move(0, 0)
      await page.waitForTimeout(300)
      await (whole ? page : dlg(page)).screenshot({ path: join(dir!, `${tone}-${name}.png`) })
    }
    try {
      await page.setViewportSize({ width: 1440, height: 887 })
      await page.evaluate((skin) => window.cn.setSettings({ appearance: { followSystem: false, skin } }), skin)
      await page.reload()
      await page.locator('.vault b').waitFor()
      await page.keyboard.press('Meta+Comma')
      await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '库', exact: true }).click()
      await shot('1-库页没接')
      await dlg(page).getByRole('button', { name: '接一个…' }).click()
      await shot('2-接一个')
      await dlg(page).getByRole('menuitem', { name: /Get笔记/ }).click()
      await shot('3-填Key')
      await dlg(page).getByLabel('API Key', { exact: true }).fill('gk_live_wrongkey0001')
      await dlg(page).getByLabel('Client ID', { exact: true }).fill(GN_CLIENT)
      await dlg(page).getByRole('button', { name: '连上' }).click()
      await dlg(page).getByRole('alert').waitFor()
      await shot('4-Key错了')
      await dlg(page).getByLabel('API Key', { exact: true }).fill(GN_KEY)
      await dlg(page).getByRole('button', { name: '连上' }).click()
      const first = page.getByRole('dialog', { name: /连上了/ })
      await first.waitFor()
      await first.getByRole('button', { name: '展开勾几篇' }).click()
      await shot('5-第一次连上', true)
      await first.getByRole('button', { name: /^拉\d/ }).click()
      await page.waitForTimeout(250)
      await shot('6-在拉', true)
      await first.waitFor({ state: 'detached', timeout: 20_000 })
      await dlg(page).locator('[data-row^="sourceRun-"]').first().waitFor()
      await dlg(page).locator('.set-body').evaluate((e) => (e.scrollTop = 0))
      await shot('7-子页上', true)
      await dlg(page).locator('.set-body').evaluate((e) => (e.scrollTop = 99999))
      await shot('8-子页下')
      await dlg(page).getByRole('button', { name: '断开…' }).click()
      await shot('9-断开确认', true)
      await page.getByRole('alertdialog').getByRole('button', { name: '不断开' }).click()
      await dlg(page).getByRole('button', { name: '回到库' }).click()
      await shot('10-库页接上了')
      await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '自动化', exact: true }).click()
      await dlg(page).locator('[data-row="autoSource-getnote"]').waitFor()
      await dlg(page).locator('[data-row="autoSource-getnote"]').scrollIntoViewIfNeeded()
      await shot('11-自动化页')
      if (tone === '浅') {
        await page.setViewportSize({ width: 700, height: 887 })
        await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '库', exact: true }).click()
        await dlg(page).locator('[data-source="getnote"] .src-t').click()
        await dlg(page).getByRole('heading', { name: 'Get笔记' }).waitFor()
        await shot('12-700宽子页', true)
      }
    } finally {
      await run.close()
    }
  })
}
