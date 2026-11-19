// 左栏重组（2026-11-17）的交付截图：A「照 VS Code」/ B「浮岛书桌」× 浅（天青）/ 深（深湖），每种截几屏。
// 只在给了 CN_SHOTS（截图放哪）时跑：CN_SHOTS=<文件夹> npx playwright test step23-left-shots
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, pane, tabOn, type Running } from './app'
import { LEFT_VAULT, withTimes } from './fixtures/left-vault'
import { armMenus, pickMenu } from './menu'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截交付图时跑（给 CN_SHOTS）')

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

for (const frame of ['b', 'a'] as const)
  for (const tone of ['light', 'dark'] as const)
    test(`截图 ${frame.toUpperCase()} ${tone === 'light' ? '浅色' : '深色'}`, async () => {
      const tag = `${frame.toUpperCase()}-${tone === 'light' ? '浅' : '深'}`
      const run = await launch(LEFT_VAULT, {}, (vault) => {
        withTimes(vault)
        const ud = join(dirname(vault), 'user-data')
        mkdirSync(ud, { recursive: true })
        writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: tone === 'light' ? 'sky' : 'petrol', frame } }))
      })
      const { page } = run
      try {
        await armMenus(run)
        // ① 文件：树 + 冰岛旅行的首页
        await leftView(page, '文件')
        const tree = page.getByRole('tree', { name: '全部文件' })
        const row = (name: string) => tree.getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
        await row('剪藏').locator('.ft-tw').click()
        await row('冰岛旅行').click()
        await expect(tabOn(page)).toHaveText('冰岛旅行')
        // 写作置顶、冰岛旅行设地图绿
        await row('写作').click({ button: 'right' })
        await pickMenu(run, '置顶')
        await row('冰岛旅行').click({ button: 'right' })
        await pickMenu(run, '换图标和颜色…')
        const pick = page.getByRole('dialog', { name: '换图标和颜色' })
        await pick.getByRole('option', { name: 'map', exact: true }).click()
        await pick.getByRole('option', { name: '绿', exact: true }).click()
        await page.keyboard.press('Escape')
        await expect(pane(page).getByTestId('folder-content').locator('.fc-tcard img').first()).toBeVisible({ timeout: 15_000 })
        await shot(run, `1-文件-${tag}`)
        // ② 排序菜单
        await page.locator('aside.side').getByRole('button', { name: '排序' }).click()
        await shot(run, `2a-排序菜单-${tag}`)
        await page.keyboard.press('Escape')
        // ② 换图标和颜色
        await row('极光摄影').click({ button: 'right' })
        await pickMenu(run, '换图标和颜色…')
        await pick.getByRole('option', { name: 'device-camera' }).click()
        await pick.getByRole('option', { name: '紫', exact: true }).click()
        await shot(run, `2c-换图标和颜色-${tag}`)
        await page.keyboard.press('Escape')
        // ③ 最近：左栏 + 中间整页
        await leftView(page, '最近')
        await page.locator('aside.side').getByRole('button', { name: '在中间打开' }).click()
        await expect(tabOn(page)).toHaveText('最近')
        await shot(run, `3-最近-${tag}`)
        // ④ 写作那一格（分类默认都在左边）：左栏是写作那一枝，中间开写作的首页
        await leftView(page, '文件')
        const ab = page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '写作', exact: true })
        await ab.click()
        await expect(ab).toHaveAttribute('aria-pressed', 'true')
        await ab.click({ button: 'right' })
        await pickMenu(run, '换图标和颜色…')
        await pick.getByRole('option', { name: 'edit', exact: true }).click()
        await pick.getByRole('option', { name: '橙', exact: true }).click()
        await page.keyboard.press('Escape')
        await page.locator('aside.side').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^游记$/ }) }).locator('.ft-tw').click()
        await expect(tabOn(page)).toHaveText('写作')
        await shot(run, `4a-摘出来的写作-${tag}`)
      } finally {
        await run.close()
      }
    })
