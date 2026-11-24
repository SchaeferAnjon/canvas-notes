/**
 * 文档的任务看法里点一条待办的文字：切回文档看法、滚到那一行、那一行左边闪一下（同「打开笔记，到这一行」）；
 * 点勾选框照旧只是勾，不跳。长文档上中下三条，点最下面那条。一律真点，无头（CN_E2E=1），临时库。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, pane } from './app'

const filler = (tag: string) => Array.from({ length: 70 }, (_, i) => `${tag}第 ${i + 1} 段，随便写点字占地方。`).join('\n\n')
const NOTE = `# 待办\n\n- [ ] 最上面的事\n\n${filler('上')}\n\n- [ ] 中间的事\n\n${filler('下')}\n\n- [ ] 最下面的事\n`
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const view = (page: Page) => pane(page).getByTestId('task-view')
const row = (page: Page, title: string) => view(page).locator('.td-r').filter({ has: page.locator('.td-t', { hasText: new RegExp(`^${esc(title)}$`) }) })
const tab = (page: Page, name: string) => acts(page).getByRole('tab', { name, exact: true })

test('任务看法里点第三条的文字：切到文档、那一行在眼前、闪一下；点勾选框只是勾，不跳', async () => {
  const run = await launch({ '写作/待办.md': NOTE })
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('待办')
    await pal.getByRole('option').filter({ hasText: '待办' }).filter({ hasText: '写作' }).first().click()
    await expect(view(page)).toBeVisible()
    await expect(tab(page, '任务')).toHaveAttribute('aria-selected', 'true')

    // 点勾选框：只勾，还在任务看法
    await row(page, '中间的事').getByRole('checkbox').click()
    await expect.poll(() => readFileSync(join(run.vault, '写作/待办.md'), 'utf8')).toMatch(/- \[x\] 中间的事 ✅ \d{4}-\d\d-\d\d\n/)
    await page.waitForTimeout(300)
    await expect(view(page)).toBeVisible()
    await expect(tab(page, '任务')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('dialog', { name: '详情' })).toHaveCount(0)

    // 点第三条的文字：文档看法，那一行滚到眼前、左边闪
    await row(page, '最下面的事').locator('.td-t').click()
    await expect(tab(page, '文档')).toHaveAttribute('aria-selected', 'true')
    await expect(view(page)).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '详情' })).toHaveCount(0)
    const line = pane(page).locator('.cm-line', { hasText: '最下面的事' })
    await expect(line).toBeInViewport()
    const bar = pane(page).locator('.cm-flashbar:not([hidden])')
    await expect(bar).toBeVisible()
    const [lb, bb] = [(await line.boundingBox())!, (await bar.boundingBox())!]
    expect(Math.abs(lb.y - bb.y)).toBeLessThan(lb.height)
    // 最上面那条已经滚出去了
    await expect(pane(page).locator('.cm-line', { hasText: '最上面的事' })).not.toBeInViewport()

    // 只这一次换到文档：标签条上点回「任务」还是任务看法，点行里空白处照旧开详情小卡
    await tab(page, '任务').click()
    await expect(view(page)).toBeVisible()
    const tt = row(page, '最上面的事').locator('.td-tt')
    const box = (await tt.boundingBox())!
    await tt.click({ position: { x: box.width - 4, y: box.height / 2 } })
    await expect(page.getByRole('dialog', { name: '详情' })).toBeVisible()
    await expect(tab(page, '任务')).toHaveAttribute('aria-selected', 'true')
  } finally {
    await run.close()
  }
})
