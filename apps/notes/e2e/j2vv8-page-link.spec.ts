// task-j2vv8：读 PDF 的笔记正文里「第 3 页」这种链接（[第 3 页](#page=3)、[第 4 页](第3讲.pdf#page=4&rect=…)），
// ⌘点、链接卡「打开」、右键「打开」、白板卡里点：都是打开那份 PDF（开着就切过去）翻到那页，有 rect 时闪一下那块；
// 以前开出一个空白的「#page=3」「第3讲.pdf#page=4&rect=…」笔记标签（录屏 r26 03:16~03:28）。普通点只是光标进字里。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { acts, launch, openNote, pane, tabOn } from './app'
import { armMenus, pickMenu } from './menu'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'
const MD =
  '---\n类型: 笔记\n来源: "[[第3讲.pdf]]"\n---\n# 第3讲 笔记\n\n还是那个道理：细节都在[第 3 页](#page=3)。\n\n另见[第 4 页](第3讲.pdf#page=4&rect=0.1,0.2,0.5,0.2)。\n\n' +
  '## 第 2 页 · 定义\n[第 2 页](第3讲.pdf#page=2&rect=0.05,0.3,0.5,0.3) · 10:20 <!-- cn:thread=第3讲-p2-1 -->\n\n> [!question] 线性是什么意思\n\n加起来再变和变了再加一样，见[第 5 页](#page=5)。\n'

const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pager = (page: Page) => acts(page).getByTestId('pdf-pager')
const tabs = (page: Page) => page.getByTestId('tab-list').locator(':scope > .tab')
const link = (page: Page, text: string) => pane(page).locator('.cm-link', { hasText: text })

async function pdfAt(page: Page, n: number) {
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(pager(page)).toHaveText(`${n} / 5`, { timeout: 10_000 })
}

test('文档看法：⌘点「第 3 页」打开那份 PDF 翻到第 3 页，不开空白的「#page=3」；带文件和 rect 的翻过去、闪那块，PDF 开着就切过去', async () => {
  const run = await launch({ [PDF]: LECTURE, [NOTE]: MD })
  const { page } = run
  try {
    await openNote(page, '第3讲 笔记')
    // 普通点：光标进字里，不开标签
    const before = await tabs(page).count()
    await link(page, '第 3 页').click()
    await page.waitForTimeout(400)
    await expect(tabOn(page)).toHaveText('第3讲 笔记')
    expect(await tabs(page).count()).toBe(before)

    await link(page, '第 3 页').click({ modifiers: ['Meta'] })
    await pdfAt(page, 3)
    await expect(tabs(page).filter({ hasText: '#page=' })).toHaveCount(0)
    expect(await tabs(page).count()).toBe(before + 1)

    // 回到笔记，⌘点带文件、带 rect 的：切回开着的那个 PDF 标签（不再开一个），翻到第 4 页，那块闪一下
    await tabs(page).filter({ hasText: '第3讲 笔记' }).click()
    await expect(link(page, '第 4 页')).toBeVisible()
    await link(page, '第 4 页').click({ modifiers: ['Meta'] })
    await pdfAt(page, 4)
    await expect(pdfPane(page).getByTestId('pdf-flash')).toBeVisible()
    expect(await tabs(page).count()).toBe(before + 1)
    await expect(tabs(page).filter({ hasText: '#page=' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('链接卡「打开」、右键「打开」：同样打开 PDF 翻到那页', async () => {
  const run = await launch({ [PDF]: LECTURE, [NOTE]: MD })
  const { page } = run
  try {
    await armMenus(run)
    await openNote(page, '第3讲 笔记')
    // 指着问答那段回答里的「第 5 页」，链接卡上点「打开」
    await link(page, '第 5 页').hover()
    const card = page.getByRole('dialog', { name: '链接' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: /打开/ }).click()
    await pdfAt(page, 5)

    await tabs(page).filter({ hasText: '第3讲 笔记' }).click()
    await expect(link(page, '第 3 页')).toBeVisible()
    await link(page, '第 3 页').click({ button: 'right' })
    await pickMenu(run, '打开')
    await pdfAt(page, 3)
    await expect(tabs(page).filter({ hasText: '#page=' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('白板看法：卡里的「第 3 页」点一下出预览卡（task-3e53q 已定 1），⌘点打开 PDF 翻到那页；问答卡里回答的「第 5 页」是链接（不露 md 写法），⌘点翻到第 5 页', async () => {
  const run = await launch({ [PDF]: LECTURE, [NOTE]: MD })
  const { page } = run
  try {
    await openNote(page, '第3讲 笔记')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    // 点一下：预览卡（哪份 PDF 第几页），不翻
    await board.locator('a.pg', { hasText: '第 3 页' }).click()
    await expect(page.getByRole('dialog', { name: '引用' }).locator('.u')).toContainText('第3页')
    await expect(tabs(page).filter({ hasText: '第3讲.pdf' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await board.locator('a.pg', { hasText: '第 3 页' }).click({ modifiers: ['Meta'] })
    await pdfAt(page, 3)

    await tabs(page).filter({ hasText: '第3讲 笔记' }).click()
    // 一问一列以后一问分成好几张卡（问题、回答按小标题各一张，配对笔记白板分列）：哪张都不露写法，拿带「第 5 页」那张
    await expect(board.locator('.db-card[data-kind="ask"]', { hasText: '](#page=5)' })).toHaveCount(0)
    const ask = board.locator('.db-card[data-kind="ask"]').filter({ has: page.locator('a.pg', { hasText: '第 5 页' }) })
    await expect(ask).toHaveCount(1)
    // 问答卡里的页码和文字卡里的一个样子：颜色、整颗不折行
    const style = (l: Locator) => l.evaluate((e) => ({ c: getComputedStyle(e).color, w: getComputedStyle(e).whiteSpace, cur: getComputedStyle(e).cursor }))
    const inAsk = await style(ask.locator('a.pg', { hasText: '第 5 页' }))
    expect(inAsk).toEqual(await style(board.locator('a.pg', { hasText: '第 3 页' })))
    expect(inAsk).toMatchObject({ w: 'nowrap', cur: 'pointer' })
    await ask.locator('a.pg', { hasText: '第 5 页' }).click({ modifiers: ['Meta'] })
    await pdfAt(page, 5)

    // 带文件、带 rect 的「第 4 页」：也是能点的页码（以前是一段下划线字，点不动），翻到第 4 页、那块闪一下；页码整颗不折行
    await tabs(page).filter({ hasText: '第3讲 笔记' }).click()
    const p4 = board.locator('a.pg', { hasText: '第 4 页' })
    expect(await p4.evaluate((e) => getComputedStyle(e).whiteSpace)).toBe('nowrap')
    await p4.click({ modifiers: ['Meta'] })
    await pdfAt(page, 4)
    await expect(pdfPane(page).getByTestId('pdf-flash')).toBeVisible()
    await expect(tabs(page).filter({ hasText: '#page=' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('笔记旁边没有 PDF、也没写来源：⌘点「第 3 页」底栏说找不到是哪份 PDF，不开空白标签', async () => {
  const run = await launch({ '收件箱/随手.md': '# 随手\n\n细节都在[第 3 页](#page=3)。\n' })
  const { page } = run
  try {
    await openNote(page, '随手')
    const before = await tabs(page).count()
    await link(page, '第 3 页').click({ modifiers: ['Meta'] })
    await expect(page.getByTestId('toast')).toContainText('第 3 页')
    await expect(tabOn(page)).toHaveText('随手')
    expect(await tabs(page).count()).toBe(before)
  } finally {
    await run.close()
  }
})
