/**
 * 数据库第三批第 3 块（task-i921u）的对照截图：和原型方向 A（proto-a.html）同样的数据、同样的几个状态，
 * B 浮岛书桌、天青（浅）/ 深湖（深）。只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色。交互的验收在 i921u-views.spec.ts。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ECP_DOC, EXERCISES, LECTURES } from '../../../packages/format/test/base-samples'
import { launch, openNote, pane } from './app'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const skin = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const name = (n: string) => join(DIR!, `app-${DARK ? 'dark' : 'light'}-${n}.png`)
const db = (page: Page) => pane(page).locator('[data-part="数据库块"]')
const tool = (page: Page, n: string) => db(page).locator('.base-tools').getByRole('button', { name: n, exact: true })

async function shot(page: Page, n: string) {
  await page.mouse.move(1430, 880)
  await page.waitForTimeout(350)
  await page.screenshot({ path: name(n) })
}

test('原型方向 A 的七个状态', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ '课程/ecp/ecp 课程计划.md': ECP_DOC, ...LECTURES, ...EXERCISES }, {}, skin)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, 'ecp 课程计划')
    await expect(db(page).locator('.base-count')).toHaveText('8 条')
    await db(page).evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await shot(page, '1-全部')

    await db(page).getByRole('button', { name: '加一个视图' }).click()
    await shot(page, '7-加一个视图')
    await page.keyboard.press('Escape')

    await tool(page, '排序').click()
    await shot(page, '6-排序面板')
    await page.keyboard.press('Escape')

    await db(page).getByRole('tab', { name: '没学完的' }).click()
    await db(page).getByRole('tab', { name: '没学完的' }).click()
    await shot(page, '2-视图菜单')
    await page.keyboard.press('Escape')

    await tool(page, '筛选').click()
    await shot(page, '3-筛选面板')
    await page.keyboard.press('Escape')

    // 「全部」上加一条筛选：底部提示「改了筛选，存进了「全部」」
    await db(page).getByRole('tab', { name: '全部' }).click()
    await tool(page, '筛选').click()
    const panel = page.getByRole('dialog', { name: '筛选' })
    await panel.getByRole('button', { name: '加一条' }).click()
    await panel.getByRole('combobox', { name: '值' }).selectOption('在学')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('toast')).toContainText('改了筛选')
    await shot(page, '5-改了就存提示')
    await db(page).getByRole('button', { name: '去掉筛选' }).click()

    await tool(page, '分组').click()
    await page.getByRole('menu', { name: '分组' }).getByRole('menuitemradio', { name: '状态' }).click()
    await expect(db(page).locator('tr.base-grp')).toHaveCount(3)
    await db(page).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.waitForTimeout(6500)
    await shot(page, '4-分组')
  } finally {
    await run.close()
  }
})
