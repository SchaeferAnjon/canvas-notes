import { expect, test, type Page } from '@playwright/test'
import { launch, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { armMenus, clipboardText, menuLabels, openedMenu, pickMenu } from './menu'

// PDF 里的右键：选了字拷贝、讲解；页面上问这一页、跳到笔记

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const pdfPage = (page: Page, n: number) => page.locator('.pdfpane:not([hidden])').locator(`.pdfpage[data-page="${n}"]`)

async function selectSpan(page: Page) {
  const span = pdfPage(page, 2).locator('.textLayer span', { hasText: 'for every scalar c' })
  await span.scrollIntoViewIfNeeded()
  const sb = (await span.boundingBox())!
  await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
  await page.mouse.down()
  await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
  await page.mouse.up()
  return sb
}

test('PDF：选了字右键「拷贝」「讲解一下」；问过的页右键「跳到笔记」', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await armMenus(run)
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')

    let sb = await selectSpan(page)
    await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2, { button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['拷贝', '问 AI', '讲解一下', '翻译 + 讲一讲', '问这一页（第 2 页）', '在访达中显示'])
    await pickMenu(run, '拷贝')
    await expect.poll(() => clipboardText(run)).toContain('for every scalar c')

    // 点一下页边空白取消选中，再重新选
    await pdfPage(page, 2).click({ position: { x: 8, y: 8 } })
    sb = await selectSpan(page)
    await page.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2, { button: 'right' })
    await pickMenu(run, '讲解一下')
    await expect(ai(page).locator('.uq').last()).toContainText('scalar')
    await expect(ai(page).getByTestId('reading-msg').last().locator('.noted')).toContainText('已记进笔记 · 第2页', { timeout: 15_000 })

    // 第 2 页问过了：页面上右键有「跳到笔记」
    await pdfPage(page, 2).click({ button: 'right', position: { x: 8, y: 8 } })
    const m2 = await openedMenu(run)
    expect(menuLabels(m2)).toEqual(['问这一页（第 2 页）', '跳到笔记', '在访达中显示'])
    await pickMenu(run, '跳到笔记')
    await expect(notes(page)).toBeVisible()
  } finally {
    await run.close()
  }
})
