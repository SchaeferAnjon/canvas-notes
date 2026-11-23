/**
 * 数据库第三批第 4 块（task-i921u）的对照截图：和设计页 proto-a 的「右栏开一条」同一个库、同一个状态，
 * B 浮岛书桌、天青（浅）/ 深湖（深）。只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色。交互的验收在 i921u-record.spec.ts。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ECP_DOC, EXERCISES, LECTURES } from '../../../packages/format/test/base-samples'
import { launch, openNote, pane } from './app'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const FILES: Record<string, string> = { '课程/ecp/ecp 课程计划.md': ECP_DOC, ...LECTURES, ...EXERCISES }
const name = (n: string) => join(DIR!, `app-${n}-${DARK ? 'dark' : 'light'}.png`)

test('右栏开一条：第3讲、看写法、从关联点进练习 3.2', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(FILES, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
  })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, 'ecp 课程计划')
    const db = pane(page).locator('[data-part="数据库块"]')
    await db.getByRole('button', { name: '第3讲 生产', exact: true }).click()
    await expect(page.locator('.rpeek .rec-body .cm-content')).toContainText('短期只有劳动能变')
    await page.mouse.move(700, 880)
    await page.waitForTimeout(400)
    await page.screenshot({ path: name('peek') })
    await page.getByRole('button', { name: '看这篇的写法' }).click()
    await page.waitForTimeout(200)
    await page.screenshot({ path: name('peek-raw') })
    await page.getByRole('button', { name: '看这篇的写法' }).click()
    await page.locator('.rpeek .rec-rel', { hasText: '练习 3.2' }).click()
    await expect(page.getByTestId('dtab-record')).toHaveText('练习 3.2')
    await page.mouse.move(700, 880)
    await page.waitForTimeout(300)
    await page.screenshot({ path: name('peek-ex') })
  } finally {
    await run.close()
  }
})
