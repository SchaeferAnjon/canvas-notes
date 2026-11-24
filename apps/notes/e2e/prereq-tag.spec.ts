// 前置知识标签（2026-11-24 用户批「可以的」，偏好「前置知识就地加标签」）：读 PDF 时 AI 答的是论文外的基础知识，
// 回答末尾〔前置知识〕（不显示）→ 记进配对笔记那一问的小标题末尾 #前置知识；由论文某处引出的记在那一页，
// 没挂在哪一处的进笔记末尾「## 前置知识」；右栏「笔记」能按前置知识筛，问题条、白板卡带小标签；打开再保存一字不变。无头、真点。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, rail, waitSaved } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'
const SHOTS = '/private/tmp/canvas-notes-visual/110-前置知识标签'

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const pdfPage = (page: Page, n: number) => page.locator(`.pdfpane:not([hidden]) .pdfpage[data-page="${n}"]`)
const msgs = (page: Page) => ai(page).getByTestId('reading-msg')
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const read = (vault: string) => readFileSync(join(vault, NOTE), 'utf8')

/** 第一条测试真问出来的那篇笔记（第二条拿它开软件看白板、打开再保存） */
let written = ''
test.describe.configure({ mode: 'serial' })

async function ask(page: Page, q: string, n: number) {
  const box = ai(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(q)
  await box.press('Enter')
  await expect(msgs(page)).toHaveCount(n, { timeout: 20_000 })
  await expect(msgs(page).nth(n - 1).getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
}

test('AI 标了前置知识：挂在第 2 页的那一问带标签、没挂在哪的进末尾一节；回答里不露标记；右栏筛得出、问题条带小标签', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.keyboard.press('Meta+j')
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')

    // 1. 没框没选直接问的背景问题：进笔记末尾「## 前置知识」，不写回到哪一页的来源行；回答里看不到〔前置知识〕
    await ask(page, '什么是 softmax', 1)
    await expect(msgs(page).first()).toContainText('这是论文外的前置知识')
    await expect(msgs(page).first()).not.toContainText('〔前置知识〕')
    await expect(msgs(page).first()).not.toContainText('〔前置')
    let md = read(vault)
    expect(md).toMatch(/\n## 前置知识\n\n### 什么是 softmax #前置知识\n\n> \[!ai\] AI 回答 · /)
    expect(md).not.toContain('〔前置知识〕')

    // 2. 框第 2 页一块问「这个 O 是怎么算的」：由论文这一处引出，记在第 2 页那一节、带标签；第 2 页那节排在「前置知识」前面
    const p2 = pdfPage(page, 2)
    await p2.scrollIntoViewIfNeeded()
    const r = (await p2.boundingBox())!
    await page.mouse.move(r.x + r.width * 0.11, r.y + r.height * 0.085)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width * 0.42, r.y + r.height * 0.135, { steps: 6 })
    await page.mouse.up()
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await ask(page, '这个 O 是怎么算的', 2)
    md = read(vault)
    expect(md).toMatch(/\n## 第 2 页( · .+)?\n\n### 这个 O 是怎么算的 #前置知识\n\n!\[我框的\|\d+\]\([^)]+\)\n\n—— \[第 2 页\]\(第3讲\.pdf#page=2&rect=[\d.,]+\)\n\n> \[!ai\] /)
    expect(md.indexOf('## 第 2 页')).toBeLessThan(md.indexOf('## 前置知识'))
    // 3. 同一处接着问、不是前置知识的：不带标签
    await ask(page, '还是不懂', 3)
    md = read(vault)
    expect(md).toContain('\n### 还是不懂\n\n> [!ai] ')
    expect(md.match(/#前置知识/g)).toHaveLength(2)
    await expect.poll(() => gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')

    // 4. 右栏「笔记」：问题条带小标签；筛「前置知识」只剩那两问
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notes(page)).toBeVisible()
    await expect(notes(page).locator('.qs .pre-tag')).toHaveCount(2)
    await expect(notes(page).locator('.qs', { hasText: '还是不懂' }).locator('.pre-tag')).toHaveCount(0)
    await notes(page).getByRole('tab', { name: '前置知识' }).click()
    await expect(notes(page).getByTestId('note-q')).toHaveCount(2)
    await expect(notes(page).getByTestId('note-q').locator('.q')).toHaveText([/什么是 softmax/, /这个 O 是怎么算的/])
    if (process.env.CN_SHOTS) {
      mkdirSync(SHOTS, { recursive: true })
      await page.screenshot({ path: join(SHOTS, '1-右栏筛前置知识.png') })
    }
    await notes(page).getByRole('tab', { name: '全部' }).click()
    if (process.env.CN_SHOTS) await page.screenshot({ path: join(SHOTS, '2-右栏问题条小标签.png') })

    written = read(vault)
  } finally {
    await run.close()
  }
})

test('白板看法：带前置知识标签的那两问列头有同样的小标签；白板、文档来回切、保存，一字不变', async () => {
  expect(written).toContain('#前置知识')
  const run = await launch({ [PDF]: LECTURE, [NOTE]: written }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '第3讲 笔记')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    await expect(board.getByTestId('board-pre-tag')).toHaveCount(2)
    await expect(board.locator('.db-col', { has: page.getByTestId('board-pre-tag') }).locator('h3 .truncate')).toHaveText([/这个 O 是怎么算的/, /什么是 softmax/])
    // 「还是不懂」那一列没有
    await expect(board.locator('.db-col', { has: page.locator('h3 .truncate', { hasText: '还是不懂' }) }).getByTestId('board-pre-tag')).toHaveCount(0)
    if (process.env.CN_SHOTS) await page.screenshot({ path: join(SHOTS, '3-白板列头小标签.png') })
    // 打开再保存：切回文档、⌘S，一字不变
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    expect(read(vault)).toBe(written)
    await expect.poll(() => gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')
  } finally {
    await run.close()
  }
})
