// CN-88（M1 录屏 0:43）：引擎菜单点空白处收不回去。公共的「点外面就收起」（@cn/ai-chat 的 use-dismiss.ts）：
// 点菜单和打开它的按钮以外任何地方（AI 回答正文、PDF、右图标栏）、按 esc、窗口失焦都收；再点胶囊是收起不是重开。
import { expect, test, type Page } from '@playwright/test'
import { launch, openAi, openNote, rail, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const menu = (page: Page) => page.getByRole('menu', { name: 'AI 引擎' })

test('CN-88：读 PDF 右栏的引擎菜单，点 AI 回答正文、PDF、右图标栏、按 esc、窗口失焦都收起（AI 面板还开着）；再点胶囊是收起不是重开', async () => {
  const run = await launch({ [PDF]: LECTURE, '随手记.md': '# 随手记\n\n正文。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    const pdfPage = page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"]')
    await expect(pdfPage.locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await openAi(page)
    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('给我讲讲这一页')
    await box.press('Enter')
    const answer = ai(page).getByTestId('reading-msg').last().locator('.txt')
    await expect(answer).toContainText('这是讲解', { timeout: 15_000 })
    const capsule = ai(page).getByRole('button', { name: '选 AI 引擎' })
    const open = async () => {
      await capsule.click()
      await expect(menu(page)).toBeVisible()
      await expect(capsule).toHaveAttribute('aria-expanded', 'true')
    }

    // 点 AI 回答正文
    await open()
    await answer.click()
    await expect(menu(page)).toHaveCount(0)
    // 点 PDF（只点一下，不拖）
    await open()
    const pb = (await pdfPage.boundingBox())!
    await page.mouse.click(pb.x + pb.width * 0.5, pb.y + pb.height * 0.85)
    await expect(menu(page)).toHaveCount(0)
    await expect(page.getByTestId('pdf-box')).toHaveCount(0)
    // 点右图标栏的空处
    await open()
    const rb = (await rail(page).boundingBox())!
    const spot = [rb.x + rb.width / 2, rb.y + rb.height * 0.6] as const
    // 点的是竖条本身的空处，不是上面的按钮
    expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('button, a') === null && !!document.elementFromPoint(x, y)?.closest('nav'), spot)).toBe(true)
    await page.mouse.click(...spot)
    await expect(menu(page)).toHaveCount(0)
    // esc：只收菜单，AI 面板还在
    await open()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(ai(page)).toBeVisible()
    // 窗口失焦（点进网页、PDF 里嵌的页面时窗口收不到 pointerdown）
    await open()
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(menu(page)).toHaveCount(0)
    // 再点胶囊是收起，不是先收再开
    await open()
    await capsule.click()
    await expect(menu(page)).toHaveCount(0)
    await expect(capsule).toHaveAttribute('aria-expanded', 'false')
    // 菜单里点一项照常选上（点在菜单里不收）
    await open()
    await menu(page).getByRole('menuitemradio').filter({ hasText: 'Codex' }).click()
    await expect(menu(page)).toHaveCount(0)
    await expect(capsule).toContainText('Codex')

    // 别处的 AI 对话（同一格，AI 还开着）的引擎菜单也一样：点文档正文收起，AI 还在
    await openNote(page, '随手记')
    await openAi(page)
    const float = page.getByRole('complementary', { name: 'AI 对话' })
    await float.getByTestId('ai-engine').click()
    await expect(menu(page)).toBeVisible()
    await page.locator('.pane:not([hidden]) .cm-content').click()
    await expect(menu(page)).toHaveCount(0)
    await expect(float).toBeVisible()
    await float.getByTestId('ai-engine').click()
    await expect(menu(page)).toBeVisible()
    await float.getByTestId('ai-engine').click()
    await expect(menu(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})
