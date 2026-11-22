/**
 * 白板的缩放和收件箱挪进白板右上角（task-wz7gb）的改前 / 改后截图：A、B 两种风格，天青（浅）/ 深湖（深）。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TAG=before|after，CN_SHOT_TONE=dark 截深色。交互的验收在 wz7gb-board-corner.spec.ts。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, widenRight } from './app'
import { board, FILES, openBoard } from './fixtures/board-doc'

const DIR = process.env.CN_SHOTS
const TAG = process.env.CN_SHOT_TAG ?? 'after'
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const name = (frame: string, n: string) => join(DIR!, `${TAG}-${frame}-${n}-${DARK ? 'dark' : 'light'}.png`)

const MAP = '---\ntype: board\n白板样式: 导图\n类型: 导图\n---\n# 导图 11-15 21∶40\n\n- 线性映射\n  - 定义\n  - 核与像\n'

async function start(frame: 'a' | 'b') {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ ...FILES, '收件箱/导图 11-15 21∶40.md': MAP }, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame, winBg: 'aurora' } }))
  })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  await openBoard(run.page, '冰岛十天环岛')
  await expect(board(run.page)).toBeVisible()
  return run
}

/** 中栏这一块：标签条到白板上面 340 */
async function clip(page: Page) {
  const pane = (await page.locator('.pane:not([hidden])').boundingBox())!
  const bar = (await acts(page).boundingBox())!
  return { x: pane.x - 8, y: bar.y - 10, width: pane.width + 16, height: 360 }
}

for (const frame of ['a', 'b'] as const) {
  test(`${frame.toUpperCase()}：白板看法、文档看法；收件箱开着`, async () => {
    const run = await start(frame)
    const { page } = run
    try {
      await page.mouse.move(700, 880)
      await page.waitForTimeout(400)
      const c = await clip(page)
      await page.screenshot({ path: name(frame, 'board'), clip: c })
      await acts(page).getByRole('tab', { name: '文档' }).click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: name(frame, 'doc'), clip: c })
      await acts(page).getByRole('tab', { name: '任务' }).click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: name(frame, 'task'), clip: c })
      await acts(page).getByRole('tab', { name: '白板' }).click()
      await expect(board(page)).toBeVisible()
      await page.getByTestId('db-inbox').click()
      const pop = board(page).getByRole('dialog', { name: '收件箱' })
      await expect(pop).toBeVisible()
      await pop.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
      await page.mouse.move(700, 880)
      await page.screenshot({ path: name(frame, 'inbox'), clip: { ...c, height: 560 } })
      await page.keyboard.press('Escape')
    } finally {
      await run.close()
    }
  })

  test(`${frame.toUpperCase()}：中栏 420（顶上那条说明还在）`, async () => {
    const run = await start(frame)
    const { page } = run
    try {
      // 中栏 420：右栏开「历史」拉宽
      await page.keyboard.press('Meta+y')
      for (let i = 0; i < 3; i++) {
        const bw = (await board(page).boundingBox())!.width
        if (Math.abs(bw - 420) < 1) break
        await widenRight(page, bw - 420)
        await page.waitForTimeout(200)
      }
      await page.mouse.move(700, 880)
      await page.waitForTimeout(300)
      await page.screenshot({ path: name(frame, 'narrow'), clip: { ...(await clip(page)), height: 420 } })
    } finally {
      await run.close()
    }
  })

  test(`${frame.toUpperCase()}：导图（自由白板）`, async () => {
    const run = await start(frame)
    const { page } = run
    try {
      await openBoard(page, '导图 11-15 21∶40')
      await page.mouse.move(700, 880)
      await page.waitForTimeout(600)
      await page.screenshot({ path: name(frame, 'map'), clip: await clip(page) })
    } finally {
      await run.close()
    }
  })
}
