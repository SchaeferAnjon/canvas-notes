// 页码链接跳到段：读 PDF 时 AI 回答里的「第 2 页」以前只翻到那一页（用户：「能不能跳到对应的页码的具体的某一段?」）。
// 现在 AI 在链接里带上引的那句原文（[第 2 页](#page=2&text=We%20additionally…)），软件在那一页的文字里找是哪一段：
// ⌘点（或卡上「翻到这段」）PDF 滚到那段、那段上沿在视口上方三分之一处、那段闪；找不到那句只翻到页、整页闪。
// 记进配对笔记的问答里同一个链接，在笔记里 ⌘点也跳到那一段。真点。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, rail, tabOn } from './app'
import { lecturePdf } from './fixtures/pdf'

const PDF = '课程/c72/YitingWei_2026_C72_BST-GATNet.pdf'
const NOTE = '课程/c72/YitingWei_2026_C72_BST-GATNet 笔记.md'
const SHOTS = '/private/tmp/canvas-notes-visual/109-页码链接跳到段'

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
const flash = (page: Page) => pdfPane(page).getByTestId('pdf-flash')

/** 闪的那块：在第几页、是不是整页、上沿离 PDF 那一栏顶多远（占这一栏高的几成） */
async function flashAt(page: Page) {
  return flash(page).evaluate((f) => {
    const pageEl = f.closest('.pdfslot')!.querySelector<HTMLElement>('.pdfpage')!
    const a = f.getBoundingClientRect()
    const s = f.closest('[data-testid="pdf-view"]')!.getBoundingClientRect()
    return { page: Number(pageEl.dataset.page), whole: f.classList.contains('whole'), top: (a.top - s.top) / s.height, h: a.height }
  })
}

test('读 PDF 的 AI 回答：「第 2 页」⌘点滚到引的那一段（视口上方三分之一）、那段闪；那句找不到的「第 3 页」只翻到页；配对笔记里 ⌘点同样跳到段', async () => {
  const run = await launch({ [PDF]: BST }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
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
    await expect(msgs(page)).toHaveCount(1, { timeout: 20_000 })
    await expect(msgs(page).first().getByTestId('reading-ans-acts')).toBeVisible({ timeout: 20_000 })
    const p2 = msgs(page).first().locator('a.pg', { hasText: '第 2 页' })
    const p3 = msgs(page).first().locator('a.pg', { hasText: '第 3 页' })
    await expect(p2).toHaveAttribute('data-text', 'We additionally extract a static feature stream')

    // 点一下：预览卡，按钮写「翻到这段」
    await p2.click()
    const card = page.getByRole('dialog', { name: '引用' })
    await expect(card).toBeVisible()
    await expect(card).toContainText('翻到这段')
    await page.keyboard.press('Escape')

    // ⌘点：第 2 页那一段闪（不是整页），滚停后那段上沿在这一栏上方三分之一处
    await p2.click({ modifiers: ['Meta'] })
    await expect(flash(page)).toBeVisible()
    await expect.poll(async () => (await flashAt(page)).page).toBe(2)
    await page.waitForTimeout(700)
    const f2 = await flashAt(page)
    expect(f2.whole).toBe(false)
    expect(f2.top).toBeGreaterThan(0.25)
    expect(f2.top).toBeLessThan(0.42)
    // 框的是「B. Static Feature Stream」那一段（小标题连着下面那段），不是整页那么高
    const pageH = await pdfPane(page).locator('.pdfpage[data-page="2"]').evaluate((e) => e.getBoundingClientRect().height)
    expect(f2.h).toBeLessThan(pageH * 0.2)
    const lay = await pdfPane(page).locator('.pdfpage[data-page="2"]').evaluate((tl, fTop) => {
      const sp = [...tl.querySelectorAll('.textLayer span')].find((s) => s.textContent?.startsWith('We additionally extract'))
      return sp ? sp.getBoundingClientRect().top - fTop : null
    }, await flash(page).evaluate((f) => f.getBoundingClientRect().top))
    expect(lay).not.toBeNull()
    expect(lay!).toBeGreaterThan(0)
    expect(lay!).toBeLessThan(f2.h)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: join(SHOTS, '1-点第2页跳到那一段.png') })
    await expect(flash(page)).toHaveCount(0, { timeout: 4000 })

    // 那句在 PDF 里找不到：只翻到第 3 页、整页闪
    await p3.click({ modifiers: ['Meta'] })
    await expect(flash(page)).toBeVisible()
    await expect.poll(async () => (await flashAt(page)).page).toBe(3)
    expect((await flashAt(page)).whole).toBe(true)
    await expect(flash(page)).toHaveCount(0, { timeout: 4000 })

    // 配对笔记里记下的同一个链接：⌘点也跳到那一段
    await expect(msgs(page).first().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    expect(readFileSync(join(run.vault, NOTE), 'utf8')).toContain('[第 2 页](#page=2&text=We%20additionally%20extract%20a%20static%20feature%20stream)')
    // 右栏「笔记」：配对笔记（读 PDF 时它就在这里），⌘点回答里记下的那个「第 2 页」（以前这里的页码小牌点了什么都不做）
    const notes = page.getByRole('complementary', { name: '笔记', exact: true })
    if (!(await notes.isVisible())) await rail(page).getByRole('button', { name: '笔记' }).first().click()
    await pdfPane(page).getByTestId('pdf-view').evaluate((e) => (e.scrollTop = 0))
    const inNote = notes.locator('a.pg', { hasText: '第 2 页' }).last()
    await expect(inNote).toBeVisible()
    await inNote.click({ modifiers: ['Meta'] })
    await expect(flash(page)).toBeVisible({ timeout: 5000 })
    await expect.poll(async () => (await flashAt(page)).page).toBe(2)
    expect((await flashAt(page)).whole).toBe(false)
  } finally {
    await run.close()
  }
})

test('笔记在中间开着：正文里「[第 2 页](x.pdf#page=2&text=…)」⌘点打开 PDF 跳到那一段', async () => {
  const md = '# 读后感\n\n静态流见[第 2 页](YitingWei_2026_C72_BST-GATNet.pdf#page=2&text=We%20additionally%20extract%20a%20static%20feature%20stream)。\n'
  const run = await launch({ [PDF]: BST, '课程/c72/读后感.md': md })
  const { page } = run
  try {
    await openNote(page, '读后感')
    await page.locator('.pane:not([hidden]) .cm-link', { hasText: '第 2 页' }).click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('YitingWei_2026_C72_BST-GATNet.pdf')
    await expect(flash(page)).toBeVisible({ timeout: 8000 })
    await expect.poll(async () => (await flashAt(page)).page).toBe(2)
    expect((await flashAt(page)).whole).toBe(false)
  } finally {
    await run.close()
  }
})
