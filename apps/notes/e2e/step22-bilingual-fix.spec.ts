// CN-31：PDF 对照读——并排不再整页空白、并排里译文对齐原页那一段、重排不收 Logo 这类装饰
import { expect, test, type Page } from '@playwright/test'
import { acts, launch, tabOn } from './app'
import { lecturePdf } from './fixtures/pdf'

const PDF = '课程/ecp/Lecture05.pdf'
// 43 页的课件：每页右上角同一个位置一个 Logo（小图），正文两段
const PAGES = Array.from({ length: 43 }, (_, i) => ({
  title: `Part ${i + 1} Computation`,
  // 第二段在页面下半（中间空 14 行）：并排时右边的译文要跟着落到下半
  lines: [`Paragraph one of page ${i + 1} explains physics-inspired learning.`, 'It goes on for a second line in the same paragraph.', ...Array(14).fill(''), `Second paragraph of page ${i + 1} is about surrogate models.`],
  lineGap: 20,
  image: { x: 500, y: 730, w: 80, h: 45 },
  // 图多的课件：每页画起来要一会儿
  heavy: 30000,
}))
const files = { [PDF]: lecturePdf(PAGES) }

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const mode = (page: Page) => acts(page).getByTestId('bi-mode')
const bar = (page: Page) => pdfPane(page).getByRole('toolbar', { name: '双语工具条' })
const reflow = (page: Page) => pdfPane(page).getByTestId('reflow')

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('Lecture05')
  await page.locator('.pal-row', { hasText: 'Lecture05' }).first().click()
  await expect(tabOn(page)).toHaveText('Lecture05.pdf')
  await expect(pdfPane(page).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文43页', { timeout: 30_000 })
}

/** 中间栏里看得到的那几页里，至少有一页画好了（不是整页空白） */
async function shownPage(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const view = document.querySelector('.pdfpane:not([hidden]) [data-testid="pdf-view"]') as HTMLElement | null
    if (!view || view.hidden || !view.clientWidth) return null
    const vb = view.getBoundingClientRect()
    for (const el of view.querySelectorAll<HTMLElement>('.pdfpage')) {
      const b = el.getBoundingClientRect()
      if (b.bottom < vb.top + 40 || b.top > vb.bottom - 40) continue
      if (el.querySelector('canvas[data-ready="1"]')) return Number(el.dataset.page)
    }
    return null
  })
}

test('CN-31：重排 ↔ 并排来回切 5 次（第 1 页、第 20 页），每次 1 秒内都出原页；重排里没有 Logo 卡片；并排里译文顶边对齐原页那一段', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page } = run
  try {
    await openPdf(page)
    await mode(page).getByRole('button', { name: '原文 / 对照 / 只看译文' }).click()
    await acts(page).getByRole('radiogroup', { name: '原文 对照 只看译文' }).getByRole('radio', { name: '对照' }).click()
    await expect(bar(page).getByRole('radio', { name: '重排' })).toHaveAttribute('aria-checked', 'true')
    await expect(reflow(page)).toBeVisible()
    // 重排：每页右上角的 Logo 不当成「公式和图」
    await expect(reflow(page).locator('[data-group="p1"] .fb').first()).toBeVisible()
    await expect(reflow(page).locator('.fc')).toHaveCount(0)

    for (const target of [20, 1, 20, 1, 20]) {
      // 在重排里滚到第 target 页
      await reflow(page).locator(`[data-group="p${target}"]`).scrollIntoViewIfNeeded()
      await page.waitForTimeout(150)
      const t0 = Date.now()
      await bar(page).getByRole('radio', { name: '并排' }).click()
      await expect.poll(() => shownPage(page), { timeout: 1000, intervals: [50] }).not.toBeNull()
      const shown = (await shownPage(page))!
      expect(Math.abs(shown - target)).toBeLessThanOrEqual(1)
      expect(Date.now() - t0).toBeLessThan(1500)
      await bar(page).getByRole('radio', { name: '重排' }).click()
      await expect(reflow(page)).toBeVisible()
    }

    // 并排：右边每段译文的顶边和左边原页那一段相差不超过一行
    await bar(page).getByRole('radio', { name: '并排' }).click()
    await expect.poll(() => shownPage(page)).not.toBeNull()
    const n = (await shownPage(page))!
    const row = pdfPane(page).locator(`.pdfpage[data-page="${n}"]`).locator('xpath=../..')
    const col = row.getByTestId('bi-side')
    await expect(col.locator('.sb').nth(1)).toContainText('译文：', { timeout: 10_000 })
    const pb = (await pdfPane(page).locator(`.pdfpage[data-page="${n}"]`).boundingBox())!
    const scale = pb.height / 792
    // 第二段正文在原页上的顶边：第 17 行（下标 16）的基线 150 + 16*20 往上一个字高
    const srcTop = pb.y + (150 + 16 * 20 - 13) * scale
    const trTop = (await col.locator('.sb', { hasText: 'Second paragraph' }).boundingBox())!.y
    expect(Math.abs(trTop - srcTop)).toBeLessThan(22)
  } finally {
    await run.close()
  }
})
