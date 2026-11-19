// 读 PDF 的笔记把「我框的」写成 `![我框的|268](…)`（框在 PDF 上 100% 时的宽，CN-111，Obsidian 的写法）。
// 这篇笔记在中间当文档打开时：说明只露「我框的」，图照 268 宽显示；改说明时宽度跟着留下。
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, pane, tabOn } from './app'
import { solidPng } from './fixtures/png'

// 400 × 120 的灰色 PNG
const PNG = solidPng(400, 120, [200, 200, 200])

test('中间打开读 PDF 笔记：「我框的|245」说明只露前半，图 245 宽；改说明时 |245 留着', async () => {
  const note = '课程/线代/第3讲 笔记.md'
  const r = await launch({
    [note]: '# 第3讲 笔记\n\n## 第 2 页 · 旋转矩阵\n\n![我框的|245](../../附件/第3讲/p2-1.png)\n\n> [!question] 给我讲解一下\n\n回答原文。\n',
    '附件/第3讲/p2-1.png': PNG,
  })
  const { page, vault } = r
  try {
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('第3讲 笔记')
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText(/第3讲 笔记/)
    const fig = pane(page).locator('.cm-image').first()
    await expect(fig.locator('img')).toBeVisible()
    await expect(fig.locator('.cm-image-cap')).toHaveText('我框的')
    const w = await fig.locator('img').evaluate((e) => Math.round(e.getBoundingClientRect().width))
    expect(w).toBe(245)
    // 改说明：只改前半，宽度那一截留着
    await fig.hover()
    await fig.locator('.cm-image-cap').click()
    const input = pane(page).getByRole('textbox', { name: '图片说明' })
    await expect(input).toHaveValue('我框的')
    await input.press('End')
    await page.keyboard.type('那块')
    await page.keyboard.press('Enter')
    await expect.poll(() => readFileSync(join(vault, note), 'utf8')).toContain('![我框的那块|245](../../附件/第3讲/p2-1.png)')
    await expect(pane(page).locator('.cm-image-cap').first()).toHaveText('我框的那块')
  } finally {
    await r.close()
  }
})
