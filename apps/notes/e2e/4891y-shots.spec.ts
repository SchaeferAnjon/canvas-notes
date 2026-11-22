/**
 * 交付对照图（task-4891y 左栏只加不改）：软件摆成 /private/tmp/canvas-notes-visual/06-文件管理/4-加进左栏-浅.png 那个样子，整窗 1440×887 截。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青），CN_SHOT_FRAME=a 截 A（不给是 B）。
 * CN_SHOT_OLD=1 是改之前的代码：只截两张（树、拖着停在「项目」上），新加的东西那时还没有。平时跳过。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, type Running } from './app'
import { DB_NOTE, INBOX_NOTE, treeAddVault } from './fixtures/tree-add'
import { armMenus, pickMenu } from './menu'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const FRAME = process.env.CN_SHOT_FRAME === 'a' ? 'a' : 'b'
const OLD = process.env.CN_SHOT_OLD === '1'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const tag = `${FRAME}-${DARK ? 'dark' : 'light'}`
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: FRAME, winBg: 'aurora' } }))
}

async function shot(run: Running, name: string, mouse = true) {
  if (mouse) await run.page.mouse.move(700, 870)
  await run.page.waitForTimeout(600)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${tag}.png`), Buffer.from(b64, 'base64'))
}

test('左栏只加不改：树、找文件、移到…、拖着停一下', async () => {
  test.setTimeout(120_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(treeAddVault({ pins: true }), {}, look)
  const { page } = run
  const item = (path: string) => page.locator('aside.side [role="tree"]').locator(`[role="treeitem"][data-path="${path}"]`)
  const expand = async (path: string) => {
    const r = item(path)
    if ((await r.getAttribute('aria-expanded')) !== 'true') await r.locator('.ft-tw').first().click()
    await expect(r).toHaveAttribute('aria-expanded', 'true')
  }
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    await armMenus(run)
    await leftView(page, '文件')
    await expand('课程')
    await expand('课程/study project')
    await item(DB_NOTE).locator('.ft-tw').click()
    await expand('课程/study project 2')
    // 中间开着 study project 的首页（同图）
    await item('课程/study project').locator('.truncate').click()
    await shot(run, '1-tree')

    if (!OLD) {
      // 找文件的框：打 stu
      await page.keyboard.press('Alt+Meta+KeyF')
      await page.keyboard.type('stu')
      await shot(run, '2-find')
      await page.keyboard.press('Escape')
      // 移到…：先挪一篇进 study project 2（「刚挪去过」里有它），再对「周三组会要问的」打 stu
      await expand('收件箱')
      await item('收件箱/Kindle 导出的标注.md').click({ button: 'right' })
      await pickMenu(run, '移到…')
      await page.getByRole('dialog', { name: '移到' }).getByRole('searchbox').fill('study project 2')
      await page.keyboard.press('Enter')
      await expect(page.getByRole('dialog', { name: '移到' })).toHaveCount(0)
      await item(INBOX_NOTE).click({ button: 'right' })
      await pickMenu(run, '移到…')
      await expect(page.getByRole('dialog', { name: '移到' }).getByRole('searchbox')).toBeFocused()
      await page.keyboard.type('stu')
      await shot(run, '3-move')
      await page.keyboard.press('Escape')
    } else await expand('收件箱')

    // 拖着「周三组会要问的」停在收着的「项目」上 0.9 秒
    const b = (await item(INBOX_NOTE).boundingBox())!
    await page.mouse.move(b.x + 60, b.y + 14)
    await page.mouse.down()
    await page.mouse.move(b.x + 70, b.y + 24, { steps: 3 })
    const p = (await item('项目').boundingBox())!
    await page.mouse.move(p.x + 80, p.y + 14, { steps: 5 })
    // 停着：Playwright 送的拖动只在鼠标动时才有 dragover（真鼠标停着时 Chromium 每 50 毫秒发一次），每 60 毫秒挪 1 像素
    for (let t = 0; t < 900; t += 60) {
      await page.waitForTimeout(60)
      await page.mouse.move(p.x + 80 + ((t / 60) % 2), p.y + 14)
    }
    await shot(run, '4-drag', false)
    await page.mouse.move(1000, 500, { steps: 3 })
    await page.mouse.up()
  } finally {
    await run.close()
  }
})
