// 第二段（task-mzstv）：旧主题自动换成新主题；导入 VS Code 主题（出现在主题卡里、用上、能删）；读不懂的文件说原因
import { expect, test, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch } from './app'

const files = { '所思所想.md': '# 所思所想\n\n## 第一节\n\n**粗体** 和 `代码`。\n\n> 一句引文\n' }
const FIX = join(__dirname, '../test/fixtures/vscode-themes')
const settingsDialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
// 量主题的 --win：中间岛在 B 有背景图的首页一类页上是半透明的（task-kzr3n），直接量 main.center 会是透明，所以用一个临时块量 var(--win)
const winBg = (page: Page) =>
  page.evaluate(() => {
    const p = document.createElement('div')
    p.style.background = 'var(--win)'
    document.body.append(p)
    const c = getComputedStyle(p).backgroundColor
    p.remove()
    return c
  })
const oldSettings = (appearance: object) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance }))
}

test('旧版的深海蓝换成深湖、深海光换成极光照片；纯白跟着系统的白天换成石白', async () => {
  const run = await launch(files, {}, oldSettings({ followSystem: false, skin: 'deepsea', day: 'white', night: 'black', winBg: 'glow', frame: 'b' }))
  const { page } = run
  try {
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'petrol')
    await expect(page.locator('html')).toHaveAttribute('data-tabmark', 'bottom')
    await expect(page.locator('html')).toHaveAttribute('data-winbg', 'photo')
    await expect.poll(() => winBg(page)).toBe('rgb(0, 43, 54)')
    const s = await page.evaluate(() => window.cn.settings())
    expect(s.appearance).toMatchObject({ skin: 'petrol', day: 'stone', night: 'graphite', winBg: 'aurora' })
  } finally {
    await run.close()
  }
})

test('导入 VS Code 主题：选 .json → 主题卡里多一组「导入的」、马上用上，文档跟着它的语法色；读不懂的说原因；删掉回到默认', async () => {
  const run = await launch(files, {}, oldSettings({ followSystem: false, skin: 'mint' }))
  const { app, page, userData } = run
  try {
    // Monokai 拷到一个临时文件夹，从那里导（导完原文件删掉也不影响）
    const src = join(dirname(userData), 'downloads')
    mkdirSync(src)
    copyFileSync(join(FIX, 'monokai-color-theme.json'), join(src, 'monokai-color-theme.json'))
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, join(src, 'monokai-color-theme.json'))

    await page.keyboard.press('Meta+,')
    const dlg = settingsDialog(page)
    await expect(dlg).toBeVisible()
    // 设置方向 A：⌘, 打开上次那页（第一次是「一般」），主题在「外观」
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '外观', exact: true }).click()
    await dlg.getByRole('button', { name: '导入VS Code主题…' }).click()
    await expect(page.getByText('导入了「Monokai」，已经用上')).toBeVisible()
    await expect(dlg.getByText('导入的VS Code主题')).toBeVisible()
    const card = dlg.locator('[data-skin-card="vsc-monokai"]')
    await expect(card).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'vsc-monokai')
    await expect(page.locator('html')).toHaveAttribute('data-tone', 'dark')
    await expect.poll(() => winBg(page)).toBe('rgb(39, 40, 34)')
    // 存在设置目录 themes/，不进库
    expect(readdirSync(join(userData, 'themes'))).toEqual(['vsc-monokai.json'])
    await page.screenshot({ path: test.info().outputPath('monokai-settings.png') })
    await page.keyboard.press('Escape')
    // 文档里的标题、粗体跟着 Monokai 的语法色
    await page.getByTestId('ab-files').click()
    await page.locator('.ft-row', { hasText: '所思所想' }).first().click()
    const heading = page.locator('.pane:not([hidden]) .cm-h2').first()
    await expect(heading).toBeVisible()
    const md = JSON.parse(readFileSync(join(userData, 'themes', 'vsc-monokai.json'), 'utf8')).vars['md-heading'] as string | undefined
    if (md) {
      const rgb = md.match(/[0-9a-f]{2}/gi)!.map((h) => parseInt(h, 16)).join(', ')
      await expect.poll(() => heading.evaluate((el) => getComputedStyle(el).color)).toBe(`rgb(${rgb})`)
    }
    await page.screenshot({ path: test.info().outputPath('monokai-doc.png') })

    // 读不懂的文件：说原因，不换主题
    writeFileSync(join(src, 'broken.json'), '[1, 2, 3]')
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, join(src, 'broken.json'))
    await page.keyboard.press('Meta+,')
    await dlg.getByRole('button', { name: '导入VS Code主题…' }).click()
    await expect(page.getByText(/导入失败：.*不是VS Code主题文件/)).toBeVisible()
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'vsc-monokai')

    // 删掉：鼠标移上卡片出垃圾桶，点了回到默认（薄荷），文件没了
    await dlg.locator('.sk:has([data-skin-card="vsc-monokai"])').hover()
    await dlg.getByRole('button', { name: '删掉 Monokai' }).click()
    await expect(dlg.locator('[data-skin-card="vsc-monokai"]')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-skin', 'mint')
    expect(existsSync(join(userData, 'themes', 'vsc-monokai.json'))).toBe(false)
  } finally {
    await run.close()
  }
})
