// 检查更新（用户 2026-11-15「给软件做上检查更新」）。开发版、端到端测试不查更新：设置页写「开发版」，按钮是灰的，⌘K 里没有这条；
// 应用菜单里有「检查更新…」（灰）和「设置…」，⌘C ⌘V 这些编辑菜单还在。真的下载、安装在打好的包上测（见 docs/DEVELOPMENT.md）
import { expect, test } from '@playwright/test'
import { launch } from './app'

test('设置 › 更新：开发版不查更新；应用菜单有检查更新、设置和编辑菜单', async () => {
  const run = await launch({ '甲.md': '# 甲\n' })
  const { page, app } = run
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '更新' }).click()
    const card = page.getByTestId('update-card')
    await expect(card).toContainText('Canvas Notes')
    await expect(page.getByTestId('update-line')).toHaveText('开发版，不自动更新')
    await expect(card.getByRole('button', { name: '检查更新' })).toBeDisabled()
    await expect(page.getByText('开发版和自己打的包不查更新')).toBeVisible()
    await expect(page.getByTestId('update-bar')).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('更新')
    await expect(page.locator('.pal-list')).not.toContainText('检查更新')
    await page.keyboard.press('Escape')

    const menu = await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()!.items.map((m) => ({ label: m.label, role: m.role, items: m.submenu?.items.map((i) => ({ label: i.label, enabled: i.enabled })) ?? [] })),
    )
    const first = menu[0]!.items
    expect(first.find((i) => i.label === '检查更新…')).toEqual({ label: '检查更新…', enabled: false })
    expect(first.some((i) => i.label === '设置…')).toBe(true)
    expect(menu.map((m) => m.role)).toEqual(expect.arrayContaining(['editmenu', 'windowmenu']))
  } finally {
    await run.close()
  }
})
