// 页码链接跳到段（功能小三件 2）：按住 ⌘ 悬停「第 2 页」弹出的预览浮窗、点一下出的预览卡，缩略图上也把那一段框出来
// （找法和点了跳过去同一个 @cn/format quoteRect；AI 引的那句找不到时只出那一页、不框）。PDF 开着、没开着（中间笔记里的链接）都认。真悬停、真按 ⌘。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, tabOn } from './app'
import { lecturePdf } from './fixtures/pdf'

const PDF = '课程/c72/YitingWei_2026_C72_BST-GATNet.pdf'
const NOTE = '课程/c72/YitingWei_2026_C72_BST-GATNet 笔记.md'
const SHOTS = '/private/tmp/canvas-notes-visual/117-功能小三件'

const filler = (n: number) => [
  `Paragraph ${n} talks about driver stress and physiological signals in general,`,
  'which matters for safety because stressed drivers react more slowly and',
  'narrow their attention while the road keeps changing around them.',
  '',
]
// 第 2 页：前面三段别的，下面才是「B. Static Feature Stream」和它那一段（离页顶远，看得出是滚到段、不是滚到页顶）
const PAGE2 = [
  ...filler(1),
  ...filler(2),
  ...filler(3),
  'B. Static Feature Stream',
  '',
  'We additionally extract a static feature stream composed of low-frequency',
  'statistical descriptors computed over each 30-second window, which',
  'complements the dynamic stream with slow trends such as heart rate level.',
  '',
  ...filler(4),
]
const BST = lecturePdf([
  { title: 'BST-GATNet', lines: ['Driver stress detection with graph attention.', 'Bi-LSTM models the temporal evolution.'] },
  { title: 'III. Method', lines: PAGE2 },
  { title: 'III-B-3 Static Feature Stream', lines: ['Descriptors: mean, standard deviation, min and max.'] },
])

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const msgs = (page: Page) => ai(page).getByTestId('reading-msg')
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const peek = (page: Page) => page.locator('.pk[data-depth="0"]')

/** 框在那一页图上的哪儿（占图高的几成） */
const boxAt = (box: ReturnType<Page['locator']>) =>
  box.evaluate((b) => {
    const img = b.parentElement!.querySelector('img')!.getBoundingClientRect()
    const r = b.getBoundingClientRect()
    return { top: (r.top - img.top) / img.height, h: r.height / img.height, w: r.width / img.width }
  })

test('读 PDF 的 AI 回答：按住 ⌘ 悬停「第 2 页」浮窗里那一页框出引的那一段，点一下的预览卡缩略图也框；那句找不到的「第 3 页」只出页不框；中间笔记里（PDF 没开着）⌘ 悬停同样框', async () => {
  const run = await launch({ [PDF]: BST, '课程/c72/读后感.md': '# 读后感\n\n静态流见[第 2 页](YitingWei_2026_C72_BST-GATNet.pdf#page=2&text=We%20additionally%20extract%20a%20static%20feature%20stream)。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    mkdirSync(SHOTS, { recursive: true })
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('BST-GATNet')
    await page.locator('.pal-row', { hasText: 'BST-GATNet.pdf' }).first().click()
    await expect(tabOn(page)).toHaveText('YitingWei_2026_C72_BST-GATNet.pdf')
    await expect(pdfPane(page).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.keyboard.press('Meta+j')
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文3页', { timeout: 15_000 })
    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('这两种输入 我怎么在之前看的时候没看到有两种输入呢')
    await box.press('Enter')
    await expect(msgs(page).first().getByTestId('reading-ans-acts')).toBeVisible({ timeout: 20_000 })
    const p2 = msgs(page).first().locator('a.pg', { hasText: '第 2 页' })
    const p3 = msgs(page).first().locator('a.pg', { hasText: '第 3 页' })
    await expect(p2).toHaveAttribute('data-text', 'We additionally extract a static feature stream')

    // 按住 ⌘ 悬停「第 2 页」：浮窗里第 2 页，框住「B. Static Feature Stream」那一段（页中间往下、不是整页）
    await p2.hover()
    await page.keyboard.down('Meta')
    await expect(peek(page).getByTestId('peek-pdf')).toBeVisible()
    const pb = peek(page).getByTestId('peek-pdf-box')
    await expect(pb).toBeVisible({ timeout: 10_000 })
    const a = await boxAt(pb)
    expect(a.top).toBeGreaterThan(0.2)
    expect(a.h).toBeGreaterThan(0.03)
    expect(a.h).toBeLessThan(0.25)
    expect(a.w).toBeLessThan(1)
    // 框滚到浮窗中间看得见
    const seen = await pb.evaluate((b) => {
      const body = b.closest('.pk-body')!.getBoundingClientRect()
      const r = b.getBoundingClientRect()
      return r.top >= body.top - 1 && r.bottom <= body.bottom + 1
    })
    expect(seen).toBe(true)
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(SHOTS, '3-悬停第2页框出那一段.png') })
    await page.keyboard.up('Meta')
    await expect(page.getByTestId('peek')).toHaveCount(0, { timeout: 3000 })

    // 那句在 PDF 里找不到的「第 3 页」：浮窗只出那一页，不框
    await p3.hover()
    await page.keyboard.down('Meta')
    await expect(peek(page).getByTestId('peek-pdf').locator('img')).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(300)
    await expect(peek(page).getByTestId('peek-pdf-box')).toHaveCount(0)
    await page.keyboard.up('Meta')
    await expect(page.getByTestId('peek')).toHaveCount(0, { timeout: 3000 })

    // 点一下「第 2 页」：预览卡缩略图上也框那一段，按钮写「翻到这段」
    await p2.click()
    const card = page.getByRole('dialog', { name: '引用' })
    await expect(card).toContainText('翻到这段')
    const cb = card.getByTestId('cite-thumb-box')
    await expect(cb).toBeVisible({ timeout: 10_000 })
    const inThumb = await cb.evaluate((b) => {
      const th = b.closest('[data-testid="cite-thumb"]')!.getBoundingClientRect()
      const r = b.getBoundingClientRect()
      return { inside: r.top >= th.top - 1 && r.bottom <= th.bottom + 1, h: r.height / th.height }
    })
    expect(inThumb.inside).toBe(true)
    expect(inThumb.h).toBeLessThan(0.9)
    await page.screenshot({ path: join(SHOTS, '4-预览卡缩略图框出那一段.png') })
    await page.keyboard.press('Escape')

    // 中间开一篇笔记（PDF 换走了）：正文里带文件的页码链接 ⌘ 悬停，浮窗里同样框那一段
    await openNote(page, '读后感')
    const link = pane(page).locator('.cm-link', { hasText: '第 2 页' })
    await link.hover()
    await page.keyboard.down('Meta')
    const nb = peek(page).getByTestId('peek-pdf-box')
    await expect(nb).toBeVisible({ timeout: 10_000 })
    const b = await boxAt(nb)
    expect(Math.abs(b.top - a.top)).toBeLessThan(0.01)
    await page.keyboard.up('Meta')
  } finally {
    await run.close()
  }
})
