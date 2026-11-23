// 配对笔记每一节带上框的那块（task-yp8l7）：每条问法真鼠标走一遍，读盘核笔记那一节——
// 拖框问（工具条「讲解一下」「翻译 + 讲一讲」、自己加的那颗、输入框回车、接着问）：那一节第一问上面一张「我框的」图；⌘↵ 整页问是「整页」图；
// 选字问（「翻译 + 讲一讲」、自己加的那颗）：原文写成第一问上面的引用块，不截图。
// 文档看法、白板看法、右栏笔记里都显示这张图，点图回 PDF 那一页、框闪一下。一律无头、假 AI。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, rail, tabOn } from './app'
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
/** 笔记里这一处的一段（到下一个 ## 为止） */
const sectionOf = (vault: string, name: string) => {
  const t = md(vault)
  const at = t.lastIndexOf('\n## ', t.indexOf(`<!-- cn:thread=${name} -->`))
  const end = t.indexOf('\n## ', at + 1)
  return t.slice(at + 1, end < 0 ? undefined : end)
}

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await page.keyboard.press('Meta+j')
  await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')
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
  await expect(ai(page).getByTestId('reading-msg').nth(n - 1).locator('.noted')).toContainText('已记进笔记', { timeout: 20_000 })
}
/** 图在问题上面：一节里图那一行在第一问那一行前面，中间只隔一个空行 */
function cropAbove(section: string, cap: '我框的' | '整页', file: string, q: string) {
  const m = new RegExp(`<!-- cn:thread=[^>]+ -->\\n\\n!\\[${cap}\\|(\\d+)\\]\\(\\.\\./\\.\\./附件/第3讲/${file}\\)\\n\\n> \\[!question\\] ${q}\\n`).exec(section)
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
    const w2 = cropAbove(sectionOf(vault, '第3讲-p2-1'), '我框的', 'p2-1.png', '给我讲解一下')
    expect(Math.abs(w2 - 612 * 0.31)).toBeLessThanOrEqual(2)
    expect(existsSync(join(vault, '附件/第3讲/p2-1.png'))).toBe(true)

    await drawBox(page, 3, [0.11, 0.085], [0.6, 0.2])
    await cap(page).getByRole('button', { name: '翻译 + 讲一讲' }).click()
    await noted(page, ++n)
    cropAbove(sectionOf(vault, '第3讲-p3-1'), '我框的', 'p3-1.png', '先把这块翻译成中文，再讲一讲')

    await drawBox(page, 4, [0.11, 0.085], [0.6, 0.2])
    await cap(page).getByRole('button', { name: MINE }).click()
    await noted(page, ++n)
    cropAbove(sectionOf(vault, '第3讲-p4-1'), '我框的', 'p4-1.png', '先把这块翻译成中文，再讲一讲框下来的那张图')

    // 框好以后在右栏输入框里回车（预填的「给我讲解一下」），再接着问一句：图还是一张，在第一问上面
    await drawBox(page, 5, [0.11, 0.08], [0.6, 0.2])
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    await noted(page, ++n)
    await ai(page).getByTestId('reading-msg').last().getByRole('button', { name: '还是不懂' }).click()
    await noted(page, ++n)
    const s5 = sectionOf(vault, '第3讲-p5-1')
    cropAbove(s5, '我框的', 'p5-1.png', '给我讲解一下')
    expect(s5.split('![').length - 1).toBe(1)
    expect(s5).toContain('> [!question] 还是不懂')

    // ⌘↵ 整页问（焦点在 PDF 上、没框）：整页的图，说明写「整页」，宽 612
    await pdfPage(page, 1).scrollIntoViewIfNeeded()
    await pdfPage(page, 1).click({ position: { x: 6, y: 6 } })
    await page.keyboard.press('Meta+Enter')
    await noted(page, ++n)
    expect(cropAbove(sectionOf(vault, '第3讲-p1-1'), '整页', 'p1-1.png', '给我讲解一下这一页')).toBe(612)

    // 右栏笔记：最近一段展开，点图回 PDF
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const round = notes(page).locator('[data-sec$="第3讲-p1-1.md"]')
    await expect(round.locator('.crop img')).toBeVisible()
    await pdfPage(page, 4).scrollIntoViewIfNeeded()
    await round.locator('.crop').first().click()
    await backToPdf(page, 1)

    // 文档看法：第 2 页那一节的图在第一问上面，点图回 PDF 第 2 页、框闪一下
    await openNote(page, '第3讲 笔记')
    const img = pane(page).locator('.cm-image img.jump[src*="p2-1.png"]')
    await img.scrollIntoViewIfNeeded()
    await expect(img).toBeVisible()
    // 图下面（跳过空行）紧跟的就是这一节的第一问
    const below = await img.evaluate((el) => {
      let n = el.closest('.cm-image')!.nextElementSibling
      while (n && !n.textContent!.trim()) n = n.nextElementSibling
      return n?.textContent ?? ''
    })
    expect(below).toContain('给我讲解一下')
    await img.click()
    await backToPdf(page, 2)

    // 白板看法：每张问答卡里有那张图（照框的宽），点图回 PDF 那一页、框闪一下
    await page.getByTestId('tab-list').locator('.tab', { hasText: '第3讲 笔记' }).click()
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const crops = pane(page).getByTestId('doc-board').locator('a.db-ask-crop img')
    await expect(crops).toHaveCount(5)
    const card2 = pane(page).getByTestId('doc-board').locator('.db-card', { hasText: '测试小标题 p2' })
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
    const q1 = /<!-- cn:thread=第3讲-p1-1 -->\n\n> ([^\n]+)\n\n> \[!question\] 先把这块翻译成中文，再讲一讲\n/.exec(s1)?.[1] ?? ''
    // 原文是鼠标选中的那段（选到这一行最后一个字前面）
    expect(q1.length).toBeGreaterThan(20)
    expect(said1.startsWith(q1)).toBe(true)
    expect(s1).not.toContain('![')

    const said5 = await selectLine(page, 5, 1)
    await cap(page).getByRole('button', { name: MINE }).click()
    await noted(page, 2)
    const s5 = sectionOf(vault, '第3讲-p5-1')
    const q5 = /<!-- cn:thread=第3讲-p5-1 -->\n\n> ([^\n]+)\n\n> \[!question\] 先把这块翻译成中文，再讲一讲([^\n]+)\n/.exec(s5)
    expect(q5?.[1]).toBe(q5?.[2])
    expect(said5.startsWith(q5![1]!)).toBe(true)
    expect(s5).not.toContain('![')

    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const quote = notes(page).locator('[data-sec$="第3讲-p5-1.md"] .nquote')
    await expect(quote).toHaveText(q5![1]!)
    await pdfPage(page, 1).scrollIntoViewIfNeeded()
    await quote.click()
    await backToPdf(page, 5)

    // 白板看法：卡里是那段原文，没有图
    await openNote(page, '第3讲 笔记')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = pane(page).getByTestId('doc-board').locator('.db-card', { hasText: '测试小标题 p5' })
    await expect(card.locator('.db-ask-quote')).toHaveText(q5![1]!)
    await expect(card.locator('.db-ask-crop')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
