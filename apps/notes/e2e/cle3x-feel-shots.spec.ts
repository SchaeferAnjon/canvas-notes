/**
 * 数据库表格照 Notion 改手感（task-cle3x）改完以后的截图：同一张「读过的论文」表、同一个窗口（1440 × 887，浮岛书桌 · 天青 / 深湖），
 * 和对照页 41-表格对照Notion和Tolaria 里「我们」那一行一一对上（改前的图就是那一页 raw/ours-*）。
 * 只在出交付页时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane } from './app'
import { FILES, skin } from './papers'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TONE = DARK ? 'dark' : 'light'
test.skip(!DIR, '只在出交付页时跑（CN_SHOTS=目录）')
test.setTimeout(300_000)

test('读过的论文：改完以后的样子', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(FILES, {}, skin(DARK))
  const { page } = run
  const db = pane(page).locator('[data-part="数据库块"]').first()
  const shot = async (name: string, target: 'db' | 'pane' | 'win' = 'pane') => {
    await page.waitForTimeout(350)
    const path = join(DIR!, `after-${name}-${TONE}.png`)
    if (target === 'db') await db.screenshot({ path })
    else if (target === 'pane') await page.screenshot({ path, clip: (await pane(page).boundingBox())! })
    else await page.screenshot({ path })
  }
  const cell = (name: string, col: string) => db.locator('tbody tr', { has: page.locator(`td[data-col="file.name"] button`, { hasText: name }) }).locator(`td[data-col="${col}"]`)
  const top = (p: Page) => p.evaluate(() => (document.querySelector('.pane:not([hidden]) .body') as HTMLElement).scrollTo({ top: 0 }))
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
    await openNote(page, '读过的论文')
    await expect(db.locator('tbody tr')).toHaveCount(16)
    await page.mouse.move(2, 400)

    // 1 整体：表往右伸到栏宽，竖线、长名字两行
    await shot('overall', 'win')
    // 2 单击选中一格（蓝框）
    await cell('GLocks', '作者').click()
    await shot('select')
    // 3 方向键走到「年份」，回车进编辑
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await shot('edit')
    await page.keyboard.press('Escape')
    // 4 从正文按 ↓ 选中整块，再 ↓ 进第一格
    await pane(page).locator('.cm-line', { hasText: '这学期读的' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowDown')
    await shot('kbd-block')
    await page.keyboard.press('ArrowDown')
    await shot('kbd-into')
    // 5 日期格：回车出能打字的浮层、小月历
    await top(page)
    await cell('GLocks', '读完日期').click()
    await page.keyboard.press('Enter')
    await shot('date')
    await page.keyboard.press('Escape')
    // 6 多选格：回车出小框，↓ 挪到第二项（亮着）
    await cell('GLocks', '标签').click()
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await shot('multi')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // 7 很多行：文档里滚下去，表头吸在栏顶
    await openNote(page, '很多行')
    await page.waitForTimeout(600)
    const box = (await db.locator('tbody').boundingBox())!
    await page.mouse.move(box.x + 200, box.y + 200)
    for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300)
    await page.waitForTimeout(500)
    await shot('sticky-inline', 'win')
    // 8 整页打开，滚下去表头也吸顶
    await db.getByRole('button', { name: '整页打开' }).click()
    await page.waitForTimeout(600)
    const fb = (await page.locator('.base-full tbody').boundingBox())!
    await page.mouse.move(fb.x + 200, fb.y + 200)
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 300)
    await page.waitForTimeout(500)
    await shot('sticky-full', 'win')
  } finally {
    await run.close()
  }
})
