/**
 * CN-60：用真的 Claude Code 问一页带矢量图的公开 PDF，看它在回答里给的配图框能不能把图裁对。
 * 会联网（下载 PDF、问 AI）、花一点额度，平时跳过；要跑：CN_REAL_AI=1 npx playwright test e2e/real-figure.spec.ts
 * 默认用 arXiv 1706.03762（Transformer 论文）第 3 页的结构图（矢量画的，PDF 里没有图片块）；
 * CN_REAL_PDF_URL / CN_REAL_PDF_PAGE 能换；模型用 CN_AI_MODEL（这里默认 haiku，便宜）。CN_SHOTS_DIR 给了就把裁下来的图拷过去。
 */
import { expect, test } from '@playwright/test'
import { copyFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, tabOn } from './app'

test.skip(process.env.CN_REAL_AI !== '1', '要真的 AI 和网络：CN_REAL_AI=1 才跑')
test.setTimeout(300_000)

const URL_ = process.env.CN_REAL_PDF_URL || 'https://arxiv.org/pdf/1706.03762v7'
const PAGE = Number(process.env.CN_REAL_PDF_PAGE || 3)

test('真的问：带矢量图的那页，AI 给框，笔记里裁下来的是那张图', async () => {
  const res = await fetch(URL_, { signal: AbortSignal.timeout(60_000) })
  expect(res.ok).toBe(true)
  const pdf = new Uint8Array(await res.arrayBuffer())
  const run = await launch({ '课程/公开课/讲义.pdf': pdf }, { CN_AI_MODEL: process.env.CN_AI_MODEL || 'haiku' })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('讲义')
    await page.locator('.pal-row', { hasText: '讲义' }).first().click()
    await expect(tabOn(page)).toHaveText('讲义.pdf')
    const view = page.locator('.pdfpane:not([hidden])')
    await expect(view.locator(`.pdfpage[data-page="${PAGE}"]`)).toBeAttached({ timeout: 30_000 })
    await view.locator(`.pdfpage[data-page="${PAGE}"]`).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await expect(acts(page).getByTestId('pdf-pager')).toContainText(`${PAGE} /`)
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    const msg = ai.getByTestId('reading-msg').last()
    await expect(msg.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 240_000 })
    const md = readFileSync(join(vault, '课程/公开课/讲义 笔记.md'), 'utf8')
    console.log(md)
    const fig = new RegExp(`!\\[第 ${PAGE} 页 · ([^\\]]+)\\]\\(\\.\\./\\.\\./附件/讲义/(p${PAGE}-\\d+-fig\\.png)\\)`).exec(md)
    expect(fig, '笔记里应该配了一张图').not.toBeNull()
    const png = readFileSync(join(vault, '附件/讲义', fig![2]!))
    const w = png.readUInt32BE(16)
    const h = png.readUInt32BE(20)
    console.log(`配图「${fig![1]}」${w}×${h}`)
    // 是一块图，不是整页：宽高都比整页小一截
    expect(w * h).toBeGreaterThan(40_000)
    if (process.env.CN_SHOTS_DIR) copyFileSync(join(vault, '附件/讲义', fig![2]!), join(process.env.CN_SHOTS_DIR, 'real-figure.png'))
  } finally {
    await run.close()
  }
})
