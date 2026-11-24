// AI 看得到公式（2026-11-24）：读 PDF 问 AI 时，文字层里拆散的公式按版面框截下来带给 AI（假 AI 收到几张图、是哪几块）
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, tabOn } from './app'
import { FORMULA_PDF } from './fixtures/pdf'
import { shotPart, shotTone } from './shots'

const PDF = '课程/图网络/第7讲 图注意力.pdf'
const files = { [PDF]: FORMULA_PDF }

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const box = (page: Page) => ai(page).getByRole('textbox', { name: '问 AI' })
const msgs = (page: Page) => ai(page).getByTestId('reading-msg')

async function ask(page: Page, text: string, n: number) {
  await box(page).fill(text)
  await box(page).press('Enter')
  await expect(msgs(page)).toHaveCount(n, { timeout: 15_000 })
  await expect(msgs(page).last().locator('.txt')).not.toBeEmpty()
  await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
}

test('问「公式 (1) 是什么」：第 1 页没有，去第 2 页找到公式 (1) 那块截图带给 AI，回答头写「看了公式图」；不问公式的接着问不带', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, userData } = run
  try {
    await shotTone(page)
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第7讲')
    await page.locator('.pal-row', { hasText: '第7讲 图注意力' }).first().click()
    await expect(tabOn(page)).toHaveText('第7讲 图注意力.pdf')
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await openAi(page)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文3页')

    // 1. 在第 1 页问公式 (1)：假 AI 收到一张图，说明里写的是第 2 页公式 (1)
    await ask(page, '公式 (1) 是什么', 1)
    const last = msgs(page).last()
    await expect(last.locator('.txt')).toContainText('收到公式截图（第 1 页，图 1 张')
    await expect(last.locator('.txt')).toContainText('第 2 页公式 (1)')
    await expect(last.locator('.read')).toContainText('看了公式图')
    // 截图存在软件设置目录 pasted/（不进库）
    const pasted = join(userData, 'pasted')
    expect(existsSync(pasted) && readdirSync(pasted).filter((f) => f.endsWith('.png')).length).toBe(1)
    await shotPart(ai(page), 'formula-crops-asked')

    // 2. 接着问一句不问公式的：不带公式截图
    await ask(page, '这一段在说什么', 2)
    await expect(msgs(page).last().locator('.txt')).toContainText('图 0 张')
    await expect(msgs(page).last().locator('.read')).not.toContainText('公式图')
  } finally {
    await run.close()
  }
})
