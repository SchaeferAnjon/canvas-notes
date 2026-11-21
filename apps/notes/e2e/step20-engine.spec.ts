// 第 3 轮挑毛病：设置 › AI 的默认引擎也用各家自己的标志（偏好「Agent 用自己的图标」）；AI 引擎菜单按 Esc 收起、浮窗还开着
import { expect, test } from '@playwright/test'
import { launch } from './app'

test('设置 › AI 默认引擎每行有标志；引擎菜单按 Esc 收起，AI 浮窗不关', async () => {
  const run = await launch({ '甲.md': '# 甲\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    // 默认那一行先选家（task-m55m7：同一家只列一次，不再把 Claude Code 按模型列三遍）：每一项前面是各家自己的标志
    await page.getByTestId('ai-default-pick').click()
    const rows = page.getByRole('menu', { name: '默认用哪一家' }).getByRole('menuitemradio')
    await expect(rows).toHaveCount(4)
    for (let i = 0; i < 4; i++) await expect(rows.nth(i).locator(':scope > .eng-logo, :scope > svg.ci')).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: '默认用哪一家' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Meta+j')
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    await expect(ai).toBeVisible()
    await ai.getByTestId('ai-engine').click()
    const menu = page.getByRole('menu', { name: 'AI 引擎' })
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(ai).toBeVisible()
  } finally {
    await run.close()
  }
})
