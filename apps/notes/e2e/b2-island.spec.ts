/**
 * 外壳的两处缝（书摘区设计复审转来，0.4.2）：B 左栏收起、右栏关着时，中间岛和图标栏之间也留 6（同小样 .isl.mid left:50px / right:50px），
 * 不贴着图标栏；长文档的滚动条不让版心往左偏（笔记正文两边留一样的位置，scrollbar-gutter: stable both-edges）。
 * 真按 ⌘\、真点右图标栏，窗口不上屏。
 */
import { expect, test, type Page } from '@playwright/test'
import { launch, rail, tabOn } from './app'

const box = (page: Page, sel: string) =>
  page
    .locator(sel)
    .first()
    .evaluate((e) => {
      const r = e.getBoundingClientRect()
      return { l: r.left, r: r.right, mid: (r.left + r.right) / 2 }
    })

test('B：左栏收起、右栏关着，中间岛离两边图标栏都是 6；开着右栏离右栏 6；长文档版心正居中', async () => {
  const long = '# 长文档\n\n' + Array.from({ length: 120 }, (_, i) => `第${i + 1}段：神经元由树突、胞体、轴突组成，膜电位平时在−70mV附近，超过阈值就放出一个脉冲。`).join('\n\n') + '\n'
  const run = await launch({ '长文档.md': long })
  const { page } = run
  try {
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('长文档')
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('长文档')
    await expect(page.locator('main.center .cm-content').first()).toBeVisible()
    const left = await box(page, '.abar.left')
    const right = await box(page, '.abar.right')
    // 右栏关着：中间岛右边离右图标栏 6
    expect(Math.round(right.l - (await box(page, 'main.center')).r)).toBe(6)
    // 长文档出了滚动条，版心照样在中间岛正中（以前右边滚动条占 11、版心往左偏 5.5）
    const body = page.locator('main.center .pane[data-path] > .body').first()
    expect(await body.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true)
    expect(Math.abs((await box(page, 'main.center .cm-content')).mid - (await box(page, 'main.center')).mid)).toBeLessThanOrEqual(1)

    // ⌘\ 收起左栏：中间岛左边离左图标栏 6，不贴着；版心还在正中
    await page.keyboard.press('Meta+Backslash')
    await expect(page.locator('.win')).toHaveClass(/side-hidden/)
    await expect.poll(async () => Math.round((await box(page, 'main.center')).l - left.r)).toBe(6)
    expect(Math.abs((await box(page, 'main.center .cm-content')).mid - (await box(page, 'main.center')).mid)).toBeLessThanOrEqual(1)

    // 开右栏（历史）：中间岛和右栏之间照旧 6
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hist = page.getByRole('complementary', { name: '历史' })
    await expect(hist).toBeVisible()
    await expect.poll(async () => Math.round((await box(page, 'aside.right[aria-label="历史"]')).l - (await box(page, 'main.center')).r)).toBe(6)
  } finally {
    await run.close()
  }
})
