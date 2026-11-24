// ParaRead 写进库里的配对笔记（「<PDF 名> 笔记.md」），画布笔记认得对（ParaRead 联动第一步，写法共用 @cn/format）：
// 右栏「笔记」一处一轮、出卡数对；在文档里打开显示成问题段、身份注释藏起来、⌘点页码链接翻到那页；打开、打一个字再删、保存，一个字节不变。
// 默认用 ParaRead 的写法函数（apps/pararead/src/shared/pairedNote.ts）写的样本 fixtures/pararead-note.md；
// PR_VAULT=<库> 时用 ParaRead 软件真写出来的那份（apps/pararead/scripts/e2e/cn-note.mjs 写的库：论文/<名>.pdf 和它的笔记）。
import { expect, test, type Page } from '@playwright/test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { cropGaps, doubtItems, parseReadingNote } from '@cn/format'
import { acts, gitStatus, launch, openNote, pane, rail, tabOn, waitSaved } from './app'
import { LECTURE } from './fixtures/pdf'

const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')

interface Sample {
  files: Record<string, Uint8Array | string>
  pdf: string
  note: string
}

/** ParaRead 的写法函数写的样本（e2e/fixtures/pararead-note.md，test/pararead-sample.test.ts 核对它就是写法函数现在写出来的） */
function generated(): Sample {
  const pdf = '论文/lecture.pdf'
  const note = '论文/lecture 笔记.md'
  return { files: { [pdf]: LECTURE, [note]: readFileSync(join(__dirname, 'fixtures/pararead-note.md'), 'utf8') }, pdf, note }
}

/** ParaRead 软件真写出来的库：里面的 PDF 和它的配对笔记原样拷进测试库 */
function fromPararead(dir: string): Sample {
  const files: Record<string, Uint8Array | string> = {}
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f)
      if (statSync(p).isDirectory()) walk(p)
      else files[relative(dir, p)] = readFileSync(p)
    }
  }
  walk(dir)
  const note = Object.keys(files).find((f) => f.endsWith(' 笔记.md'))
  const pdf = Object.keys(files).find((f) => f.endsWith('.pdf'))
  if (!note || !pdf) throw new Error(`${dir} 里要有一篇 PDF 和它的「… 笔记.md」`)
  return { files, pdf, note }
}

const sample = () => (process.env.PR_VAULT ? fromPararead(process.env.PR_VAULT) : generated())
// 画布笔记打开这篇或那份 PDF 时，给框了位置却没截图的段补一张「我框的」（设计如此，单独提交一次，task-yp8l7）；没框的不补。
// ParaRead 写的问题段原文在问题块里，不算选字问，带框的也补。除了插进来的这几行，ParaRead 写的字一个不动
const framed = (md: string, note: string) => cropGaps(md, note).filter((g) => g.rect).length
const pics = (t: string) => (t.match(/^!\[我框的[^\]]*\]\([^)]*\)$/gm) ?? []).length
const strip = (t: string) => t.replace(/^!\[我框的[^\]]*\]\([^)]*\)\n/gm, '').replace(/\n{3,}/g, '\n\n')
const text = (v: Uint8Array | string) => (typeof v === 'string' ? v : Buffer.from(v).toString('utf8'))
const base = (p: string) => p.split('/').pop()!.replace(/\.[^.]+$/, '')

test('ParaRead 写的配对笔记：在文档里打开显示成问题段、身份注释藏着；画布笔记补完截图以后，打一个字再删、保存、关掉，一个字节不变', async () => {
  const s = sample()
  const md = text(s.files[s.note]!)
  const sections = parseReadingNote(md, s.note)
  const run = await launch(s.files)
  const { page, vault } = run
  try {
    await openNote(page, base(s.note))
    await expect(tabOn(page)).toHaveText(base(s.note))
    // 先等画布笔记补完截图、提交完：之后这一篇就是「打开再保存」要比的样子
    await expect.poll(() => pics(readFileSync(join(vault, s.note), 'utf8')), { timeout: 30_000 }).toBe(framed(md, s.note))
    await expect.poll(() => gitStatus(vault), { timeout: 10_000 }).toBe('')
    const filled = readFileSync(join(vault, s.note), 'utf8')
    expect(strip(filled)).toBe(strip(md))
    const doc = pane(page).locator('.cm-content')
    await expect(doc).toContainText('看不懂：')
    await expect(doc).toContainText('有质疑：')
    // 提示块画成提示块（头上不留「[!question]」记号），行尾的身份注释看不见
    await expect(pane(page).locator('.cm-callout, [class*="callout"]').first()).toBeVisible()
    expect(await doc.innerText()).not.toContain('cn:thread')
    await page.screenshot({ path: test.info().outputPath('pararead-note-doc.png') })
    await doc.focus()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('x')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'dirty')
    await page.keyboard.press('Backspace')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)
    expect(readFileSync(join(vault, s.note), 'utf8')).toBe(filled)
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(800)
    expect(readFileSync(join(vault, s.note), 'utf8')).toBe(filled)
    expect(gitStatus(vault)).toBe('')
    // 页码链接是画布笔记认的写法：⌘点「第 N 页」打开那份 PDF 翻到那页（不开空白的「#page=」标签）。放在最后：打开 PDF 会补截图、改这篇
    await openNote(page, base(s.note))
    const first = sections[0]!
    await pane(page).locator('.cm-link', { hasText: `第 ${first.page} 页` }).first().click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText(base(s.pdf) + '.pdf')
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText(new RegExp(`^${first.page} / \\d+$`), { timeout: 15_000 })
    await expect(page.getByTestId('tab-list').locator(':scope > .tab', { hasText: '#page=' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('ParaRead 写的配对笔记：打开那篇 PDF，右栏「笔记」一处一轮、标题对、出卡数对；画布笔记只补截图，ParaRead 写的字一个不动', async () => {
  const s = sample()
  const md = text(s.files[s.note]!)
  const sections = parseReadingNote(md, s.note)
  const asks = sections.flatMap((x) => doubtItems(s.pdf, x)).length
  expect(sections.length).toBeGreaterThanOrEqual(3)
  const run = await launch(s.files)
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(base(s.pdf))
    await page.locator('.pal-row', { hasText: base(s.pdf) + '.pdf' }).first().click()
    await expect(tabOn(page)).toHaveText(base(s.pdf) + '.pdf')
    await expect(pdfPane(page).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 20_000 })
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const n = notes(page)
    await expect(n.getByTestId('note-round')).toHaveCount(sections.length)
    await expect(n.getByTestId('cards-open')).toHaveText(`出卡 · ${asks}问`)
    const titles = await n.getByTestId('note-round').locator('.rh h3').allInnerTexts()
    for (const x of sections) expect(titles.some((t) => t.replace(/\s/g, '').includes(x.title.replace(/\s/g, '').replace(/…$/, '')))).toBe(true)
    await page.screenshot({ path: test.info().outputPath('pararead-note-pdf.png') })
    const gaps = framed(md, s.note)
    expect(gaps).toBeGreaterThan(0)
    await expect.poll(() => pics(readFileSync(join(vault, s.note), 'utf8')), { timeout: 30_000 }).toBe(gaps)
    expect(strip(readFileSync(join(vault, s.note), 'utf8'))).toBe(strip(md))
    await expect.poll(() => gitStatus(vault), { timeout: 10_000 }).toBe('')
  } finally {
    await run.close()
  }
})
