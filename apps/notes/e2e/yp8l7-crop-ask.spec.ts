// 配对笔记每一节带上框的那块（task-yp8l7）：每条问法真鼠标走一遍，读盘核笔记那一节——
// 拖框问（工具条「讲解一下」「翻译 + 讲一讲」、自己加的那颗、输入框回车、接着问）：那一节第一问上面一张「我框的」图；⌘↵ 整页问是「整页」图；
// 选字问（「翻译 + 讲一讲」、自己加的那颗）：原文写成第一问上面的引用块，不截图。
// 文档看法、白板看法、右栏笔记里都显示这张图，点图回 PDF 那一页、框闪一下。一律无头、假 AI。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, pane, rail, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'
const CMDS = '.canvas-notes/命令.json'
const MINE = '先把这块翻译成中文'
const cmds =
  JSON.stringify({
    version: 1,
    own: [{ id: 'own-tr', name: MINE, kind: 'ai', target: '1. 先把这块翻译成中文，再讲一讲{选中的字}', rules: [{ t: '先把这块翻译成中文，再讲一讲{选中的字}' }], prompt: '先把这块翻译成中文，再讲一讲{选中的字}', out: 'note', where: ['pdf'], write: 'answer', desc: '翻译再讲' }],
    bar: { on: ['explain', 'translate', 'quote', 'own-tr'], more: ['only', 'copy'], off: [], enabled: true },
  }) + '\n'

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const cap = (page: Page) => page.getByRole('toolbar', { name: '框好的这块' })
const pager = (page: Page) => acts(page).getByTestId('pdf-pager')
const md = (vault: string) => readFileSync(join(vault, NOTE), 'utf8')
/** 笔记里这一处的一段（到下一个 ## 为止）：新写法里认这一处是 AI 块头「回到 AI 对话」链接里的 th（AI 对话记笔记开关） */
const sectionOf = (vault: string, name: string) => {
  const t = md(vault)
  const mark = `&th=${encodeURIComponent(name)})`
  expect(t, `笔记里没有 ${name} 这一处`).toContain(mark)
  const at = t.lastIndexOf('\n## ', t.indexOf(mark))
  const end = t.indexOf('\n## ', at + 1)
  return t.slice(at + 1, end < 0 ? undefined : end)
}
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await page.keyboard.press('Meta+j')
  await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')
}
/** 开配对笔记：左栏「最近」里配对笔记并进 PDF 那一行，点那一行右边的「笔记」小字（同 paste-img-locate）；开在文档看法 */
async function openPairNote(page: Page) {
  const row = page.locator('aside.side .nav .si').filter({ hasText: '第3讲' }).filter({ has: page.locator('.s-note') })
  await row.first().locator('.s-note').click()
  await expect(tabOn(page)).toHaveText('第3讲 笔记')
  if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) === 'true') await acts(page).getByRole('tab', { name: '文档' }).click()
  await expect(pane(page).locator('.cm-content')).toBeVisible()
}
async function drawBox(page: Page, n: number, a: [number, number], b: [number, number]) {
  const el = pdfPage(page, n)
  await el.scrollIntoViewIfNeeded()
  const r = (await el.boundingBox())!
  await page.mouse.move(r.x + r.width * a[0], r.y + r.height * a[1])
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * b[0], r.y + r.height * b[1], { steps: 6 })
  await page.mouse.up()
  await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
}
/** 在第 n 页上用鼠标选第 k 行字（textLayer 里的一个 span） */
async function selectLine(page: Page, n: number, k: number) {
  await pdfPage(page, n).scrollIntoViewIfNeeded()
  const span = pdfPage(page, n).locator('.textLayer span').nth(k)
  await span.scrollIntoViewIfNeeded()
  const b = (await span.boundingBox())!
  await page.mouse.move(b.x + 2, b.y + b.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width - 2, b.y + b.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect(cap(page)).toBeVisible()
  return (await span.textContent())!.trim()
}
async function noted(page: Page, n: number) {
  await expect(ai(page).getByTestId('reading-msg').nth(n - 1).getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
}
/**
 * 图在第一问下面（新写法 packages/format/src/ai-note.ts）：一节里第一个 ### 是这一问，紧跟框的图（说明、宽度、附件路径），
 * 再是回到 PDF 那一页的来源行，然后才是这一问的 AI 回答块；返回图的宽
 */
function cropAbove(section: string, cap: '我框的' | '整页', file: string, q: string, page: number) {
  const first = /^### (.+)$/m.exec(section)
  expect(first?.[1], section).toBe(q)
  const m = new RegExp(`\\n### ${esc(q)}\\n\\n!\\[${cap}\\|(\\d+)\\]\\(\\.\\./\\.\\./附件/第3讲/${esc(file)}\\)\\n\\n—— \\[第 ${page} 页\\]\\(第3讲\\.pdf#page=${page}[^)]*\\)\\n\\n> \\[!ai\\] AI 回答 · `).exec(section)
  expect(m, section).not.toBeNull()
  return Number(m![1])
}
async function backToPdf(page: Page, n: number) {
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(pager(page)).toHaveText(`${n} / 5`, { timeout: 10_000 })
  await expect(pdfPane(page).getByTestId('pdf-flash')).toBeVisible()
}

test('拖框问：工具条两颗、自己加的那颗、输入框回车、接着问，笔记那一节第一问上面都有「我框的」图；⌘↵ 整页问是「整页」图；文档、白板、右栏里点图回 PDF 那一页、框闪一下', async () => {
  test.setTimeout(180_000)
  const run = await launch({ [PDF]: LECTURE, [CMDS]: cmds }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await openPdf(page)
    let n = 0
    await drawBox(page, 2, [0.11, 0.085], [0.42, 0.135])
    await cap(page).getByRole('button', { name: '讲解一下' }).click()
    await noted(page, ++n)
    const w2 = cropAbove(sectionOf(vault, '第3讲-p2-1'), '我框的', 'p2-1.png', '给我讲解一下', 2)
    expect(Math.abs(w2 - 612 * 0.31)).toBeLessThanOrEqual(2)
    expect(existsSync(join(vault, '附件/第3讲/p2-1.png'))).toBe(true)

    await drawBox(page, 3, [0.11, 0.085], [0.6, 0.2])
    await cap(page).getByRole('button', { name: '翻译 + 讲一讲' }).click()
    await noted(page, ++n)
    cropAbove(sectionOf(vault, '第3讲-p3-1'), '我框的', 'p3-1.png', '先把这块翻译成中文，再讲一讲', 3)

    await drawBox(page, 4, [0.11, 0.085], [0.6, 0.2])
    await cap(page).getByRole('button', { name: MINE }).click()
    await noted(page, ++n)
    // 自己加的那颗：这一处第一问的标题写那颗的名字，不写一长段提示词（task-26nz7）
    cropAbove(sectionOf(vault, '第3讲-p4-1'), '我框的', 'p4-1.png', MINE, 4)

    // 框好以后在右栏输入框里回车（预填的「给我讲解一下」），再接着问一句：图还是一张，在第一问上面
    await drawBox(page, 5, [0.11, 0.08], [0.6, 0.2])
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    await noted(page, ++n)
    await ai(page).getByTestId('reading-msg').last().getByRole('button', { name: '还是不懂' }).click()
    await noted(page, ++n)
    const s5 = sectionOf(vault, '第3讲-p5-1')
    cropAbove(s5, '我框的', 'p5-1.png', '给我讲解一下', 5)
    expect(s5.split('![').length - 1).toBe(1)
    // 接着问的那一问接在后面，不再带图、不再写来源行
    expect(s5).toMatch(/\n### 还是不懂\n\n> \[!ai\] AI 回答 · /)

    // ⌘↵ 整页问（焦点在 PDF 上、没框）：整页的图，说明写「整页」，宽 612
    await pdfPage(page, 1).scrollIntoViewIfNeeded()
    await pdfPage(page, 1).click({ position: { x: 6, y: 6 } })
    await page.keyboard.press('Meta+Enter')
    await noted(page, ++n)
    expect(cropAbove(sectionOf(vault, '第3讲-p1-1'), '整页', 'p1-1.png', '给我讲解一下这一页', 1)).toBe(612)

    // 右栏笔记：最近一段展开，点图回 PDF
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const round = notes(page).locator('[data-sec$="第3讲-p1-1.md"]')
    await expect(round.locator('.crop img')).toBeVisible()
    await pdfPage(page, 4).scrollIntoViewIfNeeded()
    await round.locator('.crop').first().click()
    await backToPdf(page, 1)

    // 文档看法：第 2 页那一节第一问的标题下面就是那张图，图下面是回到第 2 页的来源行；点图回 PDF 第 2 页、框闪一下
    await openPairNote(page)
    const img = pane(page).locator('.cm-image img.jump[src*="p2-1.png"]')
    await img.scrollIntoViewIfNeeded()
    await expect(img).toBeVisible()
    const near = await img.evaluate((el) => {
      const fig = el.closest('.cm-image')!
      const step = (n: Element | null, up: boolean) => {
        n = up ? n!.previousElementSibling : n!.nextElementSibling
        while (n && !n.textContent!.trim()) n = up ? n.previousElementSibling : n.nextElementSibling
        return n?.textContent ?? ''
      }
      return { above: step(fig, true), below: step(fig, false) }
    })
    expect(near.above).toContain('给我讲解一下')
    expect(near.below).toContain('第 2 页')
    await img.click()
    await backToPdf(page, 2)

    // 白板看法：每张问答卡里有那张图（照框的宽），点图回 PDF 那一页、框闪一下
    await page.getByTestId('tab-list').locator('.tab', { hasText: '第3讲 笔记' }).click()
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const crops = pane(page).getByTestId('doc-board').locator('a.db-ask-crop img')
    await expect(crops).toHaveCount(5)
    // 一处一列（配对笔记白板分列）：标题在列头，图在这一列第一张卡里
    const card2 = pane(page).getByTestId('doc-board').locator('.db-col', { hasText: '第2页 · ' })
    await expect(card2.locator('a.db-ask-crop img')).toHaveAttribute('style', `width: ${w2}px;`)
    await card2.locator('a.db-ask-crop').click()
    await backToPdf(page, 2)
  } finally {
    await run.close()
  }
})

test('选字问：工具条「翻译 + 讲一讲」、自己加的那颗，原文写成第一问上面的引用块、不截图；右栏笔记里是一段原文，点了回 PDF', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [PDF]: LECTURE, [CMDS]: cmds }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await openPdf(page)
    const said1 = await selectLine(page, 1, 1)
    await cap(page).getByRole('button', { name: '翻译 + 讲一讲' }).click()
    await noted(page, 1)
    const s1 = sectionOf(vault, '第3讲-p1-1')
    // 新写法：问的原话做小标题，下面是选的那段原文（引用块）和回到 PDF 那一页的来源行，再是 AI 回答块
    const q1 = /\n### 先把这块翻译成中文，再讲一讲\n\n> ([^\n]+)\n> —— \[第 1 页\]\(第3讲\.pdf#page=1[^)]*\)\n\n> \[!ai\] AI 回答 · /.exec(s1)?.[1] ?? ''
    // 原文是鼠标选中的那段（选到这一行最后一个字前面）
    expect(q1.length).toBeGreaterThan(20)
    expect(said1.startsWith(q1)).toBe(true)
    expect(s1).not.toContain('![')

    const said5 = await selectLine(page, 5, 1)
    await cap(page).getByRole('button', { name: MINE }).click()
    await noted(page, 2)
    const s5 = sectionOf(vault, '第3讲-p5-1')
    // 自己加的那颗：标题写那颗的名字（task-26nz7），下面照样是选的那段原文和来源行
    const q5 = new RegExp(`\\n### ${MINE}\\n\\n> ([^\\n]+)\\n> —— \\[第 5 页\\]\\(第3讲\\.pdf#page=5[^)]*\\)\\n\\n> \\[!ai\\] AI 回答 · `).exec(s5)
    expect(q5, s5).not.toBeNull()
    expect(q5![1]!.length).toBeGreaterThan(20)
    expect(said5.startsWith(q5![1]!)).toBe(true)
    expect(s5).not.toContain('![')

    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const quote = notes(page).locator('[data-sec$="第3讲-p5-1.md"] .nquote')
    await expect(quote).toHaveText(q5![1]!)
    await pdfPage(page, 1).scrollIntoViewIfNeeded()
    await quote.click()
    await backToPdf(page, 5)

    // 白板看法：卡里是那段原文，没有图
    await openPairNote(page)
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = pane(page).getByTestId('doc-board').locator('.db-col', { hasText: '第5页 · ' })
    await expect(card.locator('.db-ask-quote')).toHaveText(q5![1]!)
    await expect(card.locator('.db-ask-crop')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
