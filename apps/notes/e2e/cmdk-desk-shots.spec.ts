/**
 * ⌘K「书桌」一组和「更多命令 ›」的截图（task-xy89o，只在给了 CN_CMDK_DESK_SHOTS=<目录> 时跑）：B 浮岛书桌，浅色天青、深色深湖（CN_SHOT_TONE=dark），1440×887。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, type Running } from './app'

const DIR = process.env.CN_CMDK_DESK_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在给了 CN_CMDK_DESK_SHOTS 时截图')

const FILES: Record<string, string> = {
  '课程/study project/学习笔记：动手学深度学习.md': '# 学习笔记：动手学深度学习\n\n## 2.3 线性代数\n\n标量、向量、矩阵、张量。\n',
  '收件箱/第一条.md': '# 第一条\n\n剪藏来的网页先放这里。\n',
  '阅读/杀死一只知更鸟.md': '# 杀死一只知更鸟\n\n读后感。\n',
}

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(350)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}${DARK ? '-dark' : ''}.png`), Buffer.from(b64, 'base64'))
}

test('⌘K 书桌一组、更多命令', async () => {
  test.setTimeout(180_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(FILES)
  const { page, app } = run
  try {
    await page.evaluate((dark) => window.cn.setSettings({ appearance: { followSystem: false, skin: dark ? 'petrol' : 'sky' } }), DARK)
    await page.reload()
    await page.locator('.vault b').waitFor()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await page.waitForTimeout(400)
    await openNote(page, '学习笔记：动手学深度学习')

    // 1 没有书桌：书桌一组只有「存成书桌…」
    await page.keyboard.press('Meta+k')
    await expect(pal(page)).toBeVisible()
    await page.mouse.move(5, 5)
    await shot(run, '01-no-desk')
    // 2 点它存一张
    await pal(page).locator('.pal-sec[data-g="desks"] .pal-row', { hasText: '存成书桌…' }).click()
    const dlg = page.getByRole('dialog', { name: '存成书桌' })
    await dlg.getByRole('textbox', { name: '书桌的名字' }).fill('动手学深度学习')
    await shot(run, '02-save-dialog')
    await dlg.getByRole('button', { name: '存成书桌', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    // 3 存了以后：书桌在前、「存成书桌…」在最后
    await page.keyboard.press('Meta+k')
    await expect(pal(page)).toBeVisible()
    await page.mouse.move(5, 5)
    await shot(run, '03-with-desk')
    // 4 翻到底：「更多命令 ›」收成一行
    await pal(page).locator('.pal-row.allcmds').scrollIntoViewIfNeeded()
    await page.mouse.move(5, 5)
    await shot(run, '04-more-folded')
    // 5 点开
    await pal(page).locator('.pal-row.allcmds').click()
    await page.mouse.move(5, 5)
    await shot(run, '05-more-open')
  } finally {
    await run.close()
  }
})
