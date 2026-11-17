// 发版前第 1 轮（实用 · 读与 AI）存疑几条：窗口变窄 PDF 页码不自己跳；历史里看得到还没提交的改动
import { expect, test, type Page } from '@playwright/test'
import { acts, launch, openNote, pane, rail, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { shotTone, shotWindow } from './shots'

const PDF = '课程/线代/第3讲 线性映射.pdf'

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(page.locator('.pdfpane:not([hidden]) canvas[data-ready="1"]').first()).toBeAttached({ timeout: 15_000 })
}

test('窗口从 1440 拉到 900 宽：没翻页，PDF 页码还是「1 / 5」，AI「看得到」也是第 1 页', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await openPdf(page)
    for (const w of [1440, 1100, 900]) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 900), w)
      await page.waitForTimeout(700)
      await expect(acts(page).getByTestId('pdf-pager')).toHaveText('1 / 5')
    }
    await expect(page.getByRole('complementary', { name: '边读边问 AI' }).getByTestId('reading-sees')).toContainText('第1页')
  } finally {
    await run.close()
  }
})

test('历史：刚打的字还没到自动提交，最上面一行「还没提交的改动」写着是哪篇；点「现在提交」就成了第一条提交', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' })
  const { page } = run
  try {
    await shotTone(page)
    await openNote(page, '随手记')
    await pane(page).getByText('一段字。').click()
    await page.keyboard.press('End')
    await page.keyboard.type('刚打的字')
    await expect(page.getByTestId('git-changed')).toContainText('1处没提交', { timeout: 10_000 })
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hist = page.getByRole('complementary', { name: '历史' })
    const row = hist.getByTestId('history-pending')
    await expect(row).toContainText('还没提交的改动')
    await expect(row).toContainText(/^还没提交的改动随手记 · 每\d+(分钟|小时)自动提交/)
    await shotWindow(run, 'r1-history-pending')
    await row.getByRole('button', { name: '现在提交' }).click()
    await expect(row).toHaveCount(0)
    await expect(hist.locator('.commit .subj').first()).toContainText('随手记')
  } finally {
    await run.close()
  }
})
