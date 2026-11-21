/**
 * 快捷键（task-spsmf）的交付截图：只在给了 CN_SHOTS 时截（目录），天青、深湖各一组。
 * 设置 › 快捷键（和邻页「外观」）、⌘K 的设快捷键小弹层（撞了键能两个对调、能清掉和回到默认）、活动栏和右图标栏的提示写着键。
 */
import { expect, type Page, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, type Running } from './app'
import { KEY_FILES, palette } from './keys-checks'

const dir = process.env.CN_SHOTS
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })

async function shoot(run: Running, name: string) {
  await run.page.waitForTimeout(350)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir!, `${name}.png`), Buffer.from(b64, 'base64'))
}

for (const [skin, tone] of [
  ['sky', '天青'],
  ['petrol', '深湖'],
] as const) {
  test(`快捷键交付截图 · ${tone}`, async () => {
    test.skip(!dir, '只在给了 CN_SHOTS 时截')
    const run = await launch(KEY_FILES)
    const { page } = run
    try {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.evaluate((skin) => window.cn.setSettings({ appearance: { followSystem: false, skin } }), skin)
      await page.reload()
      await page.locator('.vault b').waitFor()
      // 设置 › 快捷键、邻页「外观」
      await page.keyboard.press('Meta+Comma')
      const nav = dlg(page).getByRole('navigation', { name: '设置分页' })
      await nav.getByRole('button', { name: '外观', exact: true }).click()
      await shoot(run, `${tone}-设置-外观`)
      await nav.getByRole('button', { name: '快捷键', exact: true }).click()
      await expect(dlg(page).locator('[data-row="k-cmd-left-files"]')).toBeVisible()
      await shoot(run, `${tone}-设置-快捷键`)
      writeFileSync(join(dir!, `${tone}-设置-快捷键.rects.json`), JSON.stringify({ dlg: await dlg(page).boundingBox() }))
      // 撞键：「新建白板」录 ⌘N，说撞了「新建笔记」、能两个对调
      await dlg(page).locator('[data-row="k-cmd-new-board"]').getByRole('button', { name: '改 新建白板 的快捷键' }).click()
      await page.keyboard.press('Meta+n')
      await expect(dlg(page).locator('[data-row="k-cmd-new-board"]').getByRole('alert')).toBeVisible()
      await dlg(page).locator('[data-row="k-cmd-new-board"]').scrollIntoViewIfNeeded()
      await shoot(run, `${tone}-设置-快捷键-撞键`)
      // 搜「左栏」
      await page.keyboard.press('Escape')
      await dlg(page).getByRole('textbox', { name: '搜快捷键' }).fill('左栏')
      await shoot(run, `${tone}-设置-快捷键-搜索`)
      // 改过的键：「左栏：文件」换成 ⌥⌘E，这一行右边多「回到默认」
      await dlg(page).locator('[data-row="k-cmd-left-files"]').getByRole('button', { name: '改 左栏：文件 的快捷键' }).click()
      await page.keyboard.press('Alt+Meta+KeyE')
      await expect(dlg(page).locator('[data-row="k-cmd-left-files"]').getByRole('button', { name: '左栏：文件 回到默认' })).toBeVisible()
      await page.mouse.move(10, 10)
      await shoot(run, `${tone}-设置-快捷键-改过`)
      await page.keyboard.press('Escape')
      await expect(dlg(page)).toHaveCount(0)

      // ⌘K 设快捷键：撞了「新建笔记」（两个对调）、有键时清掉和回到默认
      await page.keyboard.press('Meta+k')
      await palette(page).getByRole('textbox').fill('新建白板')
      const row = palette(page).locator('.pal-row').filter({ has: page.locator('.nm', { hasText: /^新建白板$/ }) }).first()
      await row.click({ button: 'right' })
      await page.getByRole('menu').filter({ has: page.locator('.pal-mhead') }).getByRole('menuitem', { name: /设快捷键/ }).click()
      const mini = page.getByRole('dialog', { name: '设快捷键' })
      await expect(mini).toBeVisible()
      await shoot(run, `${tone}-⌘K-设快捷键`)
      await page.keyboard.press('Meta+n')
      await expect(mini.getByRole('button', { name: '两个对调' })).toBeVisible()
      await shoot(run, `${tone}-⌘K-设快捷键-撞键`)
      await page.keyboard.press('Escape')
      // 改过键的那一条：清掉、回到默认 ⇧⌘E
      await palette(page).getByRole('textbox').fill('左栏：文件')
      await palette(page).locator('.pal-row').filter({ has: page.locator('.nm', { hasText: /^左栏：文件$/ }) }).first().click({ button: 'right' })
      await page.getByRole('menu').filter({ has: page.locator('.pal-mhead') }).getByRole('menuitem', { name: /设快捷键/ }).click()
      await expect(mini.getByRole('button', { name: '回到默认 ⇧⌘E' })).toBeVisible()
      await shoot(run, `${tone}-⌘K-设快捷键-改过`)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')

      // 提示上写着键：活动栏「文件」、右图标栏「历史」
      await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).hover()
      await expect(page.getByTestId('tooltip')).toBeVisible()
      await shoot(run, `${tone}-提示-文件`)
      // 「在哪」标注图要的几块位置（窗口坐标，1440 × 900）
      const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!
      const rects = {
        tip: await box(page.getByTestId('tooltip')),
        files: await box(page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true })),
        back: await box(page.getByRole('button', { name: '后退' })),
        forward: await box(page.getByRole('button', { name: '前进' })),
        search: await box(page.getByRole('button', { name: '搜索' })),
        rail: await box(page.getByRole('navigation', { name: '右栏' })),
      }
      writeFileSync(join(dir!, `${tone}-提示-文件.rects.json`), JSON.stringify(rects))
      await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '历史', exact: true }).hover()
      await expect(page.getByTestId('tooltip')).toContainText('历史')
      await shoot(run, `${tone}-提示-历史`)
    } finally {
      await run.close()
    }
  })
}
