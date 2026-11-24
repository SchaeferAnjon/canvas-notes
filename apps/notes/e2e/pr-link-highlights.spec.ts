// ParaRead 联动（画布笔记这一侧，设计 20-pararead联动「两边看到的完全一样」「划线颜色带含义」）：
// 读 PDF 真鼠标选字、点小条上带名字的四颗划四种线 → 配对笔记里「第 1 页 · 划的线」三条、看不懂写成问题段；PDF 纸面上画出来；
// 右栏按含义筛；看不懂那一段「问 AI」（假 AI）答完回答接在那一问下面；笔记属性「读到」跟上；
// ParaRead（另一个软件）往笔记里写的一条，这边纸面上、右栏照样出来；出卡里「定义」那一条默认勾上
import { expect, type Page, test } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, rail, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

test.setTimeout(240_000)

const A = '课程/线代/第3讲 线性映射.pdf'
const NOTE = '课程/线代/第3讲 线性映射 笔记.md'
const files = { [A]: LECTURE }

const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
/** 纸面上的线画在这一页那一格的 .pdfover 里（和 .pdfpage 同一格） */
const hlOn = (page: Page, n: number) => pdfPane(page).locator('.pdfslot').nth(n - 1)
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })

/** 真鼠标在第 n 页上从含 a 的那段字的开头拖到含 b 的那段字的末尾（选字） */
async function selectText(page: Page, n: number, a: string, b = a) {
  const span = (t: string) => pdfPage(page, n).locator('.textLayer span', { hasText: t }).first()
  await pdfPage(page, n).scrollIntoViewIfNeeded()
  await expect(span(a)).toBeAttached({ timeout: 15_000 })
  await span(a).scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const s = (await span(a).boundingBox())!
  const e = (await span(b).boundingBox())!
  await page.mouse.move(s.x + 1, s.y + s.height / 2)
  await page.mouse.down()
  await page.mouse.move((s.x + e.x + e.width) / 2, e.y + e.height / 2, { steps: 4 })
  await page.mouse.move(e.x + e.width - 1, e.y + e.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(pdfPane(page).getByRole('toolbar', { name: '框好的这块' })).toBeVisible()
}

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲 线性映射')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射.pdf' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

test('读 PDF 划四种线：写进配对笔记、纸面上画出来、右栏按含义筛、看不懂一键问 AI、ParaRead 写的这边也看得到', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  // 笔记写完（原子写，带 fsync）再提交以前文件还没有：当空的，让 expect.poll 接着等
  const note = () => (existsSync(join(vault, NOTE)) ? readFileSync(join(vault, NOTE), 'utf8') : '')
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await armMenus(run)
    await openPdf(page)

    // 1. 重点：选一句，小条上第一颗「重点」（带名字），点它
    await selectText(page, 1, 'A linear map sends sums')
    const pick = pdfPane(page).getByTestId('hl-pick')
    await expect(pick).toHaveText(['重点', '定义', '想引用', '看不懂'])
    await pick.filter({ hasText: '重点' }).click()
    await expect.poll(() => note(), { timeout: 10_000 }).toContain('== · 重点 · [第 1 页](第3讲%20线性映射.pdf#page=1&rect=')
    expect(note()).toMatch(/\n## 第 1 页 · 划的线\n- ==A linear map sends sums to sums and scalings to scalings\.== · 重点 · \[第 1 页\]\([^)]+\) <!-- cn:hl=p1-h1 k=key -->\n/)
    await expect(hlOn(page, 1).locator('[data-testid=\"pdf-hl\"][data-k="key"]').first()).toBeVisible()
    // 画的地方就是那句字：和文字层那一段上下对得上
    const spanBox = (await pdfPage(page, 1).locator('.textLayer span', { hasText: 'A linear map sends sums' }).first().boundingBox())!
    const hlBox = (await hlOn(page, 1).locator('[data-testid=\"pdf-hl\"][data-k="key"]').first().boundingBox())!
    // 竖着：线的正中在那段字里；横着：左边对齐
    expect(hlBox.y + hlBox.height / 2).toBeGreaterThan(spanBox.y)
    expect(hlBox.y + hlBox.height / 2).toBeLessThan(spanBox.y + spanBox.height)
    expect(Math.abs(hlBox.x - spanBox.x)).toBeLessThanOrEqual(3)

    // 2. 定义：键 2 也行
    await selectText(page, 2, 'Both rules together')
    await page.keyboard.press('2')
    await expect.poll(() => note()).toContain('k=def -->')
    // 3. 想引用
    await selectText(page, 2, 'T(c u) = c T(u)')
    await pick.filter({ hasText: '想引用' }).click()
    await expect.poll(() => note()).toContain('k=cite -->')
    // 4. 看不懂：写成一段问题段，右栏笔记翻到那一段，「问 AI」在那一问右边
    await selectText(page, 4, 'The kernel is the set')
    await pick.filter({ hasText: '看不懂' }).click()
    await expect.poll(() => note()).toMatch(/\n## 第 4 页 · 看不懂：The kernel is the set of vec…\n\[第 4 页\]\([^)]+\) · \d\d:\d\d <!-- cn:thread=第3讲 线性映射-p4-1 -->\n\n> \[!question\] 看不懂\n> ==The kernel is the set of vectors sent to zero\.== <!-- cn:hl=p4-h1 k=confused -->\n/)
    await expect(notes(page)).toBeVisible()
    const confused = notes(page).getByTestId('note-confused')
    await expect(confused).toContainText('The kernel is the set of vectors sent to zero.')
    await expect(hlOn(page, 4).locator('[data-testid=\"pdf-hl\"][data-k="confused"]').first()).toBeAttached()

    // 右栏：每页先列划的线；按含义筛
    await expect(notes(page).getByTestId('note-hl')).toHaveCount(3)
    const filter = notes(page).getByTestId('hl-filter')
    await expect(filter.getByRole('tab')).toHaveText(['重点1', '定义1', '想引用1', '看不懂1'])
    await filter.getByRole('tab', { name: /定义/ }).click()
    await expect(notes(page).getByTestId('note-hl')).toHaveCount(1)
    await expect(notes(page).getByTestId('note-hl')).toContainText('Both rules together keep linear combinations.')
    await filter.getByRole('tab', { name: /看不懂/ }).click()
    await expect(notes(page).getByTestId('note-hl')).toContainText('还没问')
    await filter.getByRole('tab', { name: /看不懂/ }).click()

    // 看不懂一键问 AI（假 AI）：回答接在看不懂那一问下面，那一问还是原文和身份注释
    await notes(page).getByTestId('note-confused').getByTestId('hl-ask').click()
    await expect(ai(page)).toBeVisible()
    await expect(ai(page).getByTestId('reading-msg').last().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
    await expect.poll(() => note()).toMatch(/> \[!question\] 看不懂\n> ==The kernel is the set of vectors sent to zero\.== <!-- cn:hl=p4-h1 k=confused -->\n\n\S/)
    expect(note()).not.toContain('这句看不懂：')

    // ParaRead（另一个软件）往同一篇写一条「想引用」：这边重读，纸面上、右栏都有
    const md = note().replace('<!-- cn:hl=p1-h1 k=key -->\n', '<!-- cn:hl=p1-h1 k=key -->\n- ==We write T: V -> W for a map between vector spaces.== · 想引用 · [第 1 页](第3讲%20线性映射.pdf#page=1) <!-- cn:hl=p1-h2 k=cite -->\n')
    writeFileSync(join(vault, NOTE), md)
    await rail(page).getByRole('button', { name: '笔记' }).first().click().catch(() => undefined)
    await expect(notes(page).getByTestId('note-hl').filter({ hasText: 'We write T: V -> W' })).toBeVisible({ timeout: 15_000 })
    await pdfPane(page).getByTestId('pdf-view').evaluate((el) => (el.scrollTop = 0))
    await expect(hlOn(page, 1).locator('[data-testid=\"pdf-hl\"][data-k="cite"]').first()).toBeAttached({ timeout: 10_000 })

    // 右键一条线：换成「定义」
    const one = hlOn(page, 1).locator('[data-testid=\"pdf-hl\"][data-k="key"]').first()
    const ob = (await one.boundingBox())!
    await page.mouse.click(ob.x + ob.width / 2, ob.y + ob.height / 2, { button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m).slice(0, 5)).toEqual(['换成「重点」', '换成「定义」', '换成「想引用」', '删掉这条划线', '在笔记里看'])
    await pickMenu(run, '换成「定义」')
    await expect.poll(() => note()).toContain('<!-- cn:hl=p1-h1 k=def -->')
    expect(note()).toContain('· 定义 · [第 1 页]')

    // 读到哪：翻过的页写进库里两个软件共用的那份（by canvas-notes），读了多久每 15 秒记一次
    await expect.poll(() => readFileSync(join(vault, '.canvas-notes/读到哪.json'), 'utf8'), { timeout: 10_000 }).toContain('"by": "canvas-notes"')
    const at = JSON.parse(readFileSync(join(vault, '.canvas-notes/读到哪.json'), 'utf8')).files['课程/线代/第3讲 线性映射.pdf']
    expect(at.pages).toBe(5)
    // 关掉 PDF：配对笔记的属性「读到」跟上
    await pdfPane(page).getByTestId('pdf-view').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Meta+w')
    await expect.poll(() => note(), { timeout: 10_000 }).toMatch(/\n读到: "?\d+%"?\n/)

    // 设置 › 读PDF › 划线颜色：「定义」改叫「术语」，问一次要不要把已写的 2 处一起改
    await page.keyboard.press('Meta+Comma')
    const set = page.getByRole('dialog', { name: '设置' })
    await set.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '读PDF', exact: true }).click()
    const kindsBox = set.getByTestId('hl-kinds')
    await expect(kindsBox.getByRole('textbox')).toHaveCount(4)
    const defName = kindsBox.getByRole('textbox', { name: '第2种颜色的名字' })
    await expect(defName).toHaveValue('定义')
    await defName.fill('术语')
    await defName.press('Enter')
    await expect(set.getByTestId('hl-rename-ask')).toContainText('库里已经写了2处，一起改成「术语」？')
    await set.getByTestId('hl-rename-ask').getByRole('button', { name: '一起改' }).click()
    await expect.poll(() => note().match(/ · 术语 · /g)?.length ?? 0).toBe(2)
    expect(note()).not.toContain(' · 定义 · ')
    expect(JSON.parse(readFileSync(join(vault, '.canvas-notes/划线颜色.json'), 'utf8')).kinds[1]).toEqual({ key: 'def', name: '术语', color: 'green' })
  } finally {
    await run.close()
  }
})
