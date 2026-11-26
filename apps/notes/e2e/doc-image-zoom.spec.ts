// 文档里点图放大看（2026-11-26，用户：「这里的话不能点击之后放大显示，而是只能在访达中打开，这个也需要先修复」）。
// 真点：文档里 3 张图和 1 张动图，点第 2 张出「看大图」、写「第2张，共4张」，→ 到第 3 张，← 回第 2 张，Esc 关；点空处也关；
// 全程不进访达、不用系统程序打开；右键菜单里「在访达中显示」还在；文件一个字没变。
import { expect, test } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, type Running } from './app'
import { solidPng } from './fixtures/png'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const NOTE = '# 小组项目\n\n第一张：\n\n![](附件/小组项目/a.png)\n\n第二张，白板截图：\n\n![白板：调研计划](附件/小组项目/b.png)\n\n第三张：\n\n![](附件/小组项目/c.png)\n\n一张动图：\n\n![演示](附件/小组项目/d.gif)\n\n结尾。\n'
/** 两帧的动图（1×1，红、绿两帧各 0.1 秒，一直循环）：看大图里放的是这个原文件，照样在动 */
const GIF = Buffer.from(
  '474946383961010001008001' + 'ff0000' + '00ff00' + '21ff0b4e45545343415045322e300301000000' +
    '21f90404' + '0a0000' + '00' + '2c00000000010001000002024401' + '00' +
    '21f90404' + '0a0000' + '00' + '2c0000000001000100000202' + '4c01' + '00' + '3b',
  'hex',
)
const VAULT: Record<string, string | Buffer> = {
  '小组项目.md': NOTE,
  '附件/小组项目/a.png': solidPng(160, 100, [40, 120, 200]),
  '附件/小组项目/b.png': solidPng(1600, 600, [200, 120, 40]),
  '附件/小组项目/c.png': solidPng(100, 100, [90, 160, 90]),
  '附件/小组项目/d.gif': GIF,
}
const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('|'))
const SHOTS = process.env.CN_SHOTS
async function shot(run: Running, name: string) {
  if (!SHOTS) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

test('文档里点第 2 张图：软件里看大图「第2张，共4张」，→ 到第 3 张、← 回来，Esc 关、点空处关；不进访达、不用系统打开；右键「在访达中显示」还在；文件不变', async () => {
  const run = await launch(VAULT)
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '小组项目')
    const imgs = pane(page).locator('.cm-content .cm-image img')
    await expect(imgs).toHaveCount(4)
    await shot(run, '1-文档里三张图')

    await imgs.nth(1).click()
    const big = page.getByRole('dialog', { name: '看大图' })
    await expect(big.locator('img')).toBeVisible()
    await expect(big.locator('img')).toHaveAttribute('src', /b\.png$/)
    await expect(big.locator('p')).toHaveText('b.png · 第2张，共4张')
    // 图按长宽比撑到窗口里放得下的最大（1600×600 的宽图：宽是窗口的 92%）
    const w = await big.locator('img').evaluate((e) => e.getBoundingClientRect().width / window.innerWidth)
    expect(w).toBeGreaterThan(0.9)
    await shot(run, '2-点第2张看大图')

    await page.keyboard.press('ArrowRight')
    await expect(big.locator('img')).toHaveAttribute('src', /c\.png$/)
    await expect(big.locator('p')).toHaveText('c.png · 第3张，共4张')
    await shot(run, '3-右键头到第3张')
    // 第 4 张是动图：放的是原文件（不是缩略图），原图大小读得出来
    await page.keyboard.press('ArrowRight')
    await expect(big.locator('p')).toHaveText('d.gif · 第4张，共4张')
    await expect(big.locator('img')).toHaveAttribute('src', /d\.gif$/)
    expect(await big.locator('img').evaluate((e: HTMLImageElement) => [e.complete, e.naturalWidth])).toEqual([true, 1])
    // 到最后一张再 → 回到第一张，← 回最后一张
    await page.keyboard.press('ArrowRight')
    await expect(big.locator('p')).toHaveText('a.png · 第1张，共4张')
    await page.keyboard.press('ArrowLeft')
    await expect(big.locator('p')).toHaveText('d.gif · 第4张，共4张')

    await page.keyboard.press('Escape')
    await expect(big).toHaveCount(0)

    // 文档里直接点那张动图：也进看大图
    await imgs.nth(3).click()
    await expect(big.locator('p')).toHaveText('d.gif · 第4张，共4张')
    await page.keyboard.press('Escape')
    await expect(big).toHaveCount(0)

    // 点图外的空处也关
    await imgs.nth(0).click()
    await expect(big.locator('p')).toHaveText('a.png · 第1张，共4张')
    await big.click({ position: { x: 10, y: 10 } })
    await expect(big).toHaveCount(0)

    // 左右键、Esc 没进文档：一个字没改
    await page.waitForTimeout(1200)
    expect(readFileSync(join(vault, '小组项目.md'), 'utf8')).toBe(NOTE)
    // 全程没有进访达、没有交给系统程序
    expect(await screen(run)).not.toMatch(/在访达中显示|打开 /)

    // 右键图：「在访达中显示」还在，点了才进访达
    await imgs.nth(1).click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('在访达中显示')
    await pickMenu(run, '在访达中显示')
    await expect.poll(() => screen(run)).toMatch(/在访达中显示 .*\/附件\/小组项目\/b\.png/)
  } finally {
    await run.close()
  }
})
