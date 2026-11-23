/**
 * 数据库第三批第 5 块的对照图（task-i921u）：和原型 proto-a.html 同一个状态（表格、关联的选择、汇总的列菜单、公式框、加一列）。
 * CN_SHOTS_DIR=目录 才截；CN_SHOT_TONE=dark 用深湖，不然天青。不截图时照样把每一屏点开一遍、看得见。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ECP_DOC, EXERCISES, LECTURES } from '../../../packages/format/test/base-samples'
import { launch, openNote, pane } from './app'

const SHOTS = process.env.CN_SHOTS_DIR
const TONE = process.env.CN_SHOT_TONE === 'dark' ? 'dark' : 'light'
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: TONE === 'dark' ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}-${TONE}.png`) })
}
/** 先滚到它、停一下再点（滚动事件晚到会把刚开的浮层收起） */
async function clickSteady(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  await el.click()
}
const EX_DOC = '# ecp 练习册\n\n```base\nfilters:\n  and:\n    - file.inFolder("课程/ecp/练习")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 做完\n```\n'
const FILES = { '课程/ecp/ecp 课程计划.md': ECP_DOC, '课程/ecp/ecp 练习册.md': EX_DOC, ...LECTURES, ...EXERCISES }

test('对照图：表格、关联的选择、汇总列菜单、公式框、加一列', async () => {
  test.setTimeout(120_000)
  const run = await launch(FILES, {}, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
    await openNote(page, 'ecp 课程计划')
    const db = pane(page).locator('[data-part="数据库块"]').first()
    await expect(db.locator('tbody tr')).toHaveCount(8)
    // 数据库块滚到和原型差不多的位置（块头在窗口 400 上下）
    await db.evaluate((el) => {
      const sc = el.closest('.cm-scroller') as HTMLElement | null
      if (sc) sc.scrollTop += el.getBoundingClientRect().top - 280
    })
    await page.waitForTimeout(300)
    await shot(page, 'table')

    const c = db.locator('tbody tr', { hasText: '第3讲' }).locator('td[data-col="练习"]')
    // 文档版心比原型窄，表格横着滚到「练习」整列露出来，再点这一格小块右边的空处
    await c.evaluate((td) => {
      const sc = td.closest('.base-scroll') as HTMLElement
      sc.scrollLeft += td.getBoundingClientRect().right - sc.getBoundingClientRect().right + 40
    })
    await page.waitForTimeout(200)
    const b = (await c.boundingBox())!
    // 单击只选中一格（task-cle3x 格子焦点），再点一下开选择
    await page.mouse.click(b.x + b.width - 8, b.y + b.height / 2)
    await page.mouse.click(b.x + b.width - 8, b.y + b.height / 2)
    await expect(page.getByRole('dialog', { name: '第3讲 生产 · 练习' })).toBeVisible()
    await page.mouse.move(0, 0)
    await shot(page, 'relation')
    await page.keyboard.press('Escape')

    await clickSteady(page, db.getByRole('button', { name: '做完几题', exact: true }))
    await expect(page.getByRole('menu', { name: '做完几题 这一列' })).toBeVisible()
    await shot(page, 'rollup')
    await page.keyboard.press('Escape')

    await clickSteady(page, db.getByRole('button', { name: '进度', exact: true }))
    await page.getByRole('menu', { name: '进度 这一列' }).getByRole('menuitem', { name: '改公式…' }).click()
    const fx = page.getByRole('dialog', { name: '写公式' })
    await fx.getByRole('group', { name: '常用' }).getByRole('button').nth(2).click()
    await expect(fx.getByRole('table')).toBeVisible()
    await shot(page, 'formula')
    await page.keyboard.press('Escape')

    await clickSteady(page, db.getByRole('button', { name: '加一列' }))
    await expect(page.getByRole('dialog', { name: '加一列' })).toBeVisible()
    await shot(page, 'addcol')
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})
