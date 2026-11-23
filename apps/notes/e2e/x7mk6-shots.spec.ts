/**
 * 交付对照图（task-x7mk6 梦游对照里的链接能点）：整窗 1440×887，浮岛书桌，改之前、改之后同一串操作各截一组。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青），CN_SHOT_TAG 加在文件名里（old / new）。平时跳过。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, type Running } from './app'
import { DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const OLD = process.env.CN_SHOT_TAG === 'old'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const tag = `${process.env.CN_SHOT_TAG ?? 'new'}-${DARK ? 'dark' : 'light'}`
const prepare = (vault: string) => {
  prepareDream2(vault)
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(700)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${tag}.png`), Buffer.from(b64, 'base64'))
}

test('梦游对照里点双链、⌘点、梦游分支上才有的那篇', async () => {
  test.setTimeout(180_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, prepare)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    const home = page.getByTestId('dream-card')
    await home.getByRole('button', { name: '现在梦游' }).click()
    await expect(home.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
    await home.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    const dtab = page.locator('[data-testid="dream-tab"]:not([hidden])')
    const card = page.getByRole('dialog', { name: '引用' })

    // 用户截图那一处：收下后那一栏末尾「相关：[[极光预报]]」，点一下
    await panel.getByTestId('dream-item').filter({ hasText: '↔ [[极光预报]]' }).click()
    const link = dtab.locator('.cm-merge-b .cm-wikilink', { hasText: '极光预报' })
    await expect(link).toBeVisible()
    await page.waitForTimeout(1800)
    await link.click()
    if (!OLD) await expect(card).toBeVisible()
    await shot(run, '1-click')
    await page.keyboard.press('Escape')

    // ⌘点：中间开那一篇
    await link.click({ modifiers: ['Meta'] })
    await page.mouse.move(700, 870)
    await shot(run, '2-cmd-click')

    // 改名还没收下：冰岛行程里换成的 [[极光 2]]
    await panel.getByTestId('dream-item').filter({ hasText: '原名「极光」' }).click()
    await panel.getByTestId('dream-detail').getByTestId('dream-change').filter({ hasText: '冰岛行程' }).click()
    const b = dtab.locator('.cm-merge-b .cm-wikilink[data-target="极光 2"]').first()
    await expect(b).toBeVisible()
    await page.waitForTimeout(1800)
    await b.click()
    if (!OLD) await expect(card.locator('.ex p').first()).toBeVisible()
    await shot(run, '3-branch')
  } finally {
    await run.close()
  }
})
