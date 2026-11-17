// 首页整页背景用窗口背景那张图（录屏 ① CN-52，方案 B）：设置 › 外观 › 首页样式选 B 时多一行勾选；
// 勾上后首页整页背景就是窗口背景那张图（自己选的、换成冰洞也跟着换），首页里「换封面」变灰并说为什么；库里的首页设置不记图片路径；选回 A 这一行没了。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, type Running } from './app'
import { solidPng } from './fixtures/png'

const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const coverImg = (page: Page) => page.getByTestId('home').locator('.hscroll').evaluate((el) => (el as HTMLElement).style.getPropertyValue('--cover-img'))
async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

for (const skin of ['sky', 'petrol'])
  test(`${skin === 'sky' ? '浅色' : '深色'}：勾上「整页背景用窗口背景那张图」，首页用自己选的窗口背景，换成冰洞跟着换；换封面变灰；首页设置里没有图片路径`, async () => {
    const run = await launch({ 'a.md': '# a\n' }, {}, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', homeStyle: 'b' } }))
    })
    const { page, vault, userData } = run
    try {
      const pic = join(dirname(userData), '我的海.png')
      writeFileSync(pic, solidPng(320, 200, [20, 90, 140]))
      await run.app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
      }, pic)
      await expect(page.getByTestId('home')).toHaveAttribute('data-style', 'b')
      const before = await coverImg(page)

      await page.keyboard.press('Meta+,')
      await expect(dlg(page)).toBeVisible()
      // 外观：窗口背景「从电脑选」一张
      await dlg(page).getByRole('radiogroup', { name: '窗口背景' }).getByRole('radio', { name: '从电脑选' }).click()
      await expect(dlg(page).getByRole('radiogroup', { name: '窗口背景' }).getByRole('radio', { name: '从电脑选' })).toHaveAttribute('aria-checked', 'true')
      const row = dlg(page).getByRole('checkbox', { name: '整页背景用窗口背景那张图' })
      await expect(row).not.toBeChecked()
      await expect(dlg(page).locator('.hs-winbg')).toContainText('现在：从电脑选的那张')
      await row.click()
      await expect(row).toBeChecked()
      await row.scrollIntoViewIfNeeded()
      await shot(run, `home-winbg-settings-${skin}`)
      await page.keyboard.press('Escape')
      await expect.poll(() => coverImg(page)).toMatch(/^url\("cn-file:\/\/app\/backgrounds\/bg-\d+\.png"\)$/)
      expect(await coverImg(page)).not.toBe(before)
      // 图真的画得出来
      const url = (await coverImg(page)).slice(5, -2)
      expect(await page.evaluate(async (u) => {
        const img = new Image()
        img.src = u
        await img.decode()
        return img.naturalWidth
      }, url)).toBe(320)
      // 换封面变灰，点了说为什么，不开图库
      const change = page.getByTestId('home-cover').getByRole('button', { name: /^换封面/ })
      await expect(change).toHaveAttribute('aria-disabled', 'true')
      await shot(run, `home-winbg-${skin}`)
      await change.click({ force: true })
      await expect(page.getByText('首页现在用窗口背景那张图：设置 › 外观 › 首页样式 里取消「整页背景用窗口背景那张图」，就能换封面')).toBeVisible()
      await expect(page.getByRole('dialog', { name: '换封面' })).toHaveCount(0)

      // 窗口背景换成冰洞：首页跟着换
      await page.keyboard.press('Meta+,')
      await dlg(page).getByRole('radiogroup', { name: '窗口背景' }).getByRole('radio', { name: '冰洞照片' }).click()
      await expect(dlg(page).locator('.hs-winbg')).toContainText('现在：冰洞照片')
      await page.keyboard.press('Escape')
      await expect.poll(() => coverImg(page)).toMatch(/ice-cave|cave/)
      // 库里的首页设置不记图片路径（它跟着 Git 走，换电脑用那台电脑的窗口背景）
      const homeJson = join(vault, '.canvas-notes', '首页.json')
      if (existsSync(homeJson)) expect(readFileSync(homeJson, 'utf8')).not.toMatch(/backgrounds|cave|window/)
      // 选回 A：这一行没了，首页回到自己的封面
      await page.keyboard.press('Meta+,')
      await dlg(page).getByRole('radiogroup', { name: '首页样式' }).getByRole('radio', { name: /^A/ }).click()
      await expect(dlg(page).getByRole('checkbox', { name: '整页背景用窗口背景那张图' })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect.poll(() => coverImg(page)).toBe(before)
    } finally {
      await run.close()
    }
  })
