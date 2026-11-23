import { expect, test, type Page } from '@playwright/test'
import { launch, acts, openAi, tabOn, openNote, rail, railItems } from './app'
import { solidPng } from './fixtures/png'
import { LECTURE, lecturePdf } from './fixtures/pdf'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 录屏 86 条里 AI 与 PDF 这一组（G3）：发出去以后输入框空、粘贴图片、表格、出错的说法
const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const files = { [PDF]: LECTURE }

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const box = (page: Page) => ai(page).getByRole('textbox', { name: '问 AI' })

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await openAi(page)
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
}

/** 等这一问答完（发送键回来了） */
async function answered(page: Page, n: number) {
  await expect(ai(page).getByTestId('reading-msg')).toHaveCount(n)
  await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).not.toBeEmpty()
  await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible()
}

test('CN-23/28/30：讲解一下、翻译 + 讲一讲、问这一页、⌘↵ 发出后输入框是空的、没有附件小图；引用：图成为带编号的材料、预填清掉、光标在里面', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    const cap = pdfPane(page).getByRole('toolbar', { name: '框好的这块' })

    // 1. 框一块 → 工具条「讲解一下」：直接发出
    await drawBox(page, 3, [0.08, 0.25], [0.6, 0.42])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await expect(box(page)).toHaveValue('给我讲解一下')
    await cap.getByRole('button', { name: /讲解一下/ }).click()
    await answered(page, 1)
    await expect(ai(page).locator('.um-wrap').last().locator('.um')).toHaveText('给我讲解一下')
    await expect(box(page)).toHaveValue('')
    await expect(ai(page).getByTestId('reading-att')).toHaveCount(0)

    // 2. 框一块 → 翻译 + 讲一讲
    await drawBox(page, 2, [0.1, 0.2], [0.7, 0.5])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await cap.getByRole('button', { name: '翻译 + 讲一讲' }).click()
    await answered(page, 2)
    await expect(box(page)).toHaveValue('')
    await expect(ai(page).getByTestId('reading-att')).toHaveCount(0)

    // 3. 标签条「问这一页」
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    await answered(page, 3)
    await expect(ai(page).locator('.um-wrap').last().locator('.um')).toHaveText('给我讲解一下这一页')
    await expect(box(page)).toHaveValue('')
    await expect(ai(page).getByTestId('reading-att')).toHaveCount(0)

    // 4. ⌘↵（在 PDF 上）
    await pdfPage(page, 2).click({ position: { x: 20, y: 20 } })
    await page.keyboard.press('Meta+Enter')
    await answered(page, 4)
    await expect(box(page)).toHaveValue('')
    await expect(ai(page).getByTestId('reading-att')).toHaveCount(0)

    // 5. 引用（task-6cxtc 原来的「改问法」合成这一颗）：预填的「给我讲解一下」清掉，图成为输入框顶上带编号的一块材料，
    // 字里一个 ①、光标在它后面，框收起
    await drawBox(page, 4, [0.1, 0.2], [0.6, 0.45])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await expect(box(page)).toHaveValue('给我讲解一下')
    await cap.getByRole('button', { name: /^引用/ }).click()
    await expect(box(page)).toHaveValue('①')
    await expect(box(page)).toBeFocused()
    await expect(ai(page).getByTestId('reading-att')).toHaveCount(0)
    await expect(ai(page).getByTestId('ai-mat')).toHaveCount(1)
    await expect(ai(page).getByTestId('ai-mat').locator('img')).toBeVisible()
    await expect(ai(page).getByTestId('ai-mat')).toHaveAttribute('data-src', '第4页 · 我框的')
    await expect(cap).toHaveCount(0)
    // 自己打的字发出去也清掉，材料一排跟着收起
    await page.keyboard.type('这里的箭头是什么意思')
    await expect(box(page)).toHaveValue('①这里的箭头是什么意思')
    await box(page).press('Enter')
    await answered(page, 5)
    await expect(box(page)).toHaveValue('')
    await expect(ai(page).getByTestId('ai-mat')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('CN-75：AI 报英文错时面板上是一句中文和「再问一次」「换个问法」，看不到 req_ / msg_，点「看原话」才看到；CN-29：表格排成表，右栏 340 宽不出框', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await box(page).fill('假装被拦：讲讲这页')
    await box(page).press('Enter')
    const err = ai(page).getByTestId('ai-error')
    await expect(err).toBeVisible()
    await expect(err).toHaveAttribute('data-code', 'blocked')
    await expect(err).toContainText('被Claude的安全检查拦下了，常是误拦')
    await expect(ai(page).locator('.msgs')).not.toContainText('req_')
    await expect(ai(page).locator('.msgs')).not.toContainText('msg_')
    await expect(err.getByRole('button', { name: '再问一次' })).toBeVisible()
    await err.getByRole('button', { name: '看原话' }).click()
    await expect(err.locator('pre.raw')).toContainText('Request ID: req_011FAKE')
    // 换个问法：原话放回输入框，光标在里面
    await err.getByRole('button', { name: '换个问法' }).click()
    await expect(box(page)).toHaveValue('假装被拦：讲讲这页')
    await expect(box(page)).toBeFocused()

    // 表格：排成 <table>，右栏 340 宽时表不撑宽面板
    await box(page).fill('给个对照表')
    await box(page).press('Enter')
    const table = ai(page).getByTestId('reading-msg').last().locator('.md-table table')
    await expect(table).toBeVisible()
    await expect(table.locator('th').first()).toHaveText('原文')
    await expect(table.locator('td b').first()).toHaveText('physics-inspired')
    await expect(ai(page).getByTestId('reading-msg').last()).not.toContainText('|---')
    const panel = (await ai(page).boundingBox())!
    const wrap = (await ai(page).getByTestId('reading-msg').last().locator('.md-table').boundingBox())!
    expect(wrap.x + wrap.width).toBeLessThanOrEqual(panel.x + panel.width + 0.5)
    const sw = await ai(page).locator('.msgs').evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(sw).toBe(0)
  } finally {
    await run.close()
  }
})

/** 往输入框里粘图：照浏览器的粘贴事件来（不碰这台 Mac 真的剪贴板） */
async function pasteImage(page: Page, selector: string, n = 1) {
  const png = [...solidPng(40, 30, [200, 80, 60])]
  await page.evaluate(
    ([sel, bytes, count]) => {
      const el = document.querySelector(sel as string) as HTMLElement
      el.focus()
      const dt = new DataTransfer()
      for (let i = 0; i < (count as number); i++) dt.items.add(new File([new Uint8Array(bytes as number[])], `截图${i}.png`, { type: 'image/png' }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    },
    [selector, png, n] as const,
  )
}

test('CN-24：读 PDF 的输入框和别处的 AI 对话都能 ⌘V 粘图：输入框上面一张附件小图「粘贴的图」，发出去 AI 收到这张图；最多 4 张', async () => {
  const run = await launch({ ...files, '随手记.md': '# 随手记\n\n一段字。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await pasteImage(page, '.reading-in textarea')
    // 第 2b 段（多段引用方向 B）：粘的图是输入框顶上那一排的一块材料（来源「粘贴的图」），字里在光标处多一个编号
    const att = ai(page).getByTestId('ai-mat')
    await expect(att).toHaveCount(1)
    await expect(att).toHaveAttribute('data-src', '粘贴的图')
    await expect(att.locator('img')).toHaveJSProperty('complete', true)
    expect(await att.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(40)
    await expect(box(page)).toHaveValue('①')
    await expect(box(page)).toBeFocused()
    await box(page).fill('这张截图讲的是什么')
    await box(page).press('Enter')
    await answered(page, 1)
    await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).toContainText('图 1 张')
    await expect(att).toHaveCount(0)
    await expect(ai(page).locator('.um-wrap').last().locator('img[alt="粘贴的图"]')).toBeVisible()
    // 一次最多 4 张：粘 5 张只收 4 张，底栏说一声
    await pasteImage(page, '.reading-in textarea', 5)
    await expect(att).toHaveCount(4)
    await expect(page.getByText('最多4张')).toBeVisible()
    await att.first().getByRole('button', { name: '删掉这块' }).click()
    await expect(att).toHaveCount(3)

    // 别处的 AI 对话（同一格，AI 开着就还开着）：开一篇文档，粘图，发出去
    await openNote(page, '随手记')
    await openAi(page)
    const float = page.getByRole('complementary', { name: 'AI 对话' })
    await expect(float).toBeVisible()
    await pasteImage(page, '.ai:not(.reading-ai):not([hidden]) textarea')
    await expect(float.getByTestId('ai-mat')).toHaveCount(1)
    await float.getByRole('textbox', { name: '问 AI' }).fill('看看这张')
    await float.getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(float.getByTestId('ai-msg').last()).toContainText('图 1 张', { timeout: 15_000 })
    await expect(float.getByTestId('ai-mat')).toHaveCount(0)
    await expect(float.locator('.um.mq .fni img[alt="粘贴的图"]')).toBeVisible()
    // 从访达拖一张图进输入区：一样变成附件小图
    const png = [...solidPng(20, 20, [10, 120, 90])]
    await page.evaluate((bytes) => {
      const el = document.querySelector('.ai:not(.reading-ai):not([hidden]) .aiin')!
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(bytes)], '拖进来.png', { type: 'image/png' }))
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }))
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    }, png)
    await expect(float.getByTestId('ai-mat')).toHaveCount(1)
  } finally {
    await run.close()
  }
})

test('CN-22 / 工作区方向 A：读 PDF 时 AI 是右栏的一个标签，竖条上没有 AI；右下角的圆钮一直在、开着时多一圈强调色；标签上的 × 收起；圆钮在窗口右下角', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await expect.poll(() => railItems(page)).toEqual(['笔记', '大纲', '相关', '网页', '微信读书', '记录', '自动化', '历史'])
    const fab = rail(page).locator('.ai-fab')
    await expect(ai(page)).toBeVisible()
    await expect(fab).toBeVisible()
    await expect(fab).toHaveClass(/\bon\b/)
    await expect(fab).toHaveAttribute('aria-label', '收起 AI')
    // 屏上的 AI 入口只有这个圆钮：右图标栏里没有 AI 那一格，A 款底栏那一项不在 B 里
    await expect(page.locator('.abar .ab[aria-label="AI"], .ai-corner')).toHaveCount(0)
    await expect(ai(page).getByRole('button', { name: '收起 AI' })).toHaveCount(0)
    await page.getByTestId('dtab-ai').hover()
    await page.getByTestId('dtab-ai').getByRole('button', { name: '收起AI' }).click()
    await expect(ai(page)).toHaveCount(0)
    await expect(fab).toBeVisible()
    await expect(fab).not.toHaveClass(/\bon\b/)
    await expect(fab).toHaveAttribute('aria-label', '打开 AI')
    // 圆钮钉在窗口右下角
    const fb = (await fab.boundingBox())!
    const vw = await page.evaluate(() => [window.innerWidth, window.innerHeight])
    expect(vw[0]! - (fb.x + fb.width)).toBeLessThan(16)
    expect(vw[1]! - (fb.y + fb.height)).toBeLessThan(48)
    // 点圆钮开回来，再点收起；⌘J 一样
    await fab.click()
    await expect(ai(page)).toBeVisible()
    await expect(fab).toHaveClass(/\bon\b/)
    await fab.click()
    await expect(ai(page)).toHaveCount(0)
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toBeVisible()
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toHaveCount(0)
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toBeVisible()
    // 笔记标签到前面（和 AI 叠在一组）：圆钮不亮，点它换回 AI
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(fab).not.toHaveClass(/\bon\b/)
    await fab.click()
    await expect(ai(page)).toBeVisible()
  } finally {
    await run.close()
  }
})

/** PNG 的宽高（文件头里读） */
const pngSize = (buf: Buffer) => [buf.readUInt32BE(16), buf.readUInt32BE(20)] as const

// 第 1 页下半是一张矢量画的图（一堆小色块，没有图片块），老办法挑不出图
const VECTOR = lecturePdf([{ title: 'Computation Stack', lines: ['The stack has nine layers from applications to physics.'], heavy: 400 }, { title: 'Next', lines: ['More.'] }])

test('CN-60：AI 回答里给配图的框，笔记按框从重新画的页面裁图（矢量画的图也裁得到）；框是整页不算配图（后台只写标题和小结，不再另挑图，CN-94）', async () => {
  const run = await launch({ '课程/ecp/Lecture05.pdf': VECTOR, [PDF]: LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_FIGURE_MARK: '〔配图 0.03,0.52,0.94,0.42 · 测试结构图〕' })
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('Lecture05')
    await page.locator('.pal-row', { hasText: 'Lecture05' }).first().click()
    await expect(tabOn(page)).toHaveText('Lecture05.pdf')
    await openAi(page)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文2页', { timeout: 15_000 })
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    const msg = ai(page).getByTestId('reading-msg').last()
    await expect(msg.locator('.noted')).toContainText('已记进笔记', { timeout: 15_000 })
    // 那一行不显示
    await expect(msg.locator('.txt')).not.toContainText('配图')
    const md = readFileSync(join(vault, '课程/ecp/Lecture05 笔记.md'), 'utf8')
    expect(md).toMatch(/!\[第 1 页 · 测试结构图\]\(\.\.\/\.\.\/附件\/Lecture05\/p1-1-fig\.png\)/)
    // 裁下来的就是那个框：宽高比和框一样（0.94×612 : 0.42×792）
    const [w, h] = pngSize(readFileSync(join(vault, '附件/Lecture05/p1-1-fig.png')))
    expect(Math.abs(w / h - (0.94 * 612) / (0.42 * 792))).toBeLessThan(0.05)
  } finally {
    await run.close()
  }

  // 框是整页：不算配图；后台不再从图片块里另挑（CN-94：后台只剩标题和小结），这一段只有附的整页截图
  const run2 = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_FIGURE_MARK: '〔配图 0,0,1,1 · 整页〕' })
  try {
    await openPdf(run2.page)
    // 翻到第 3 页，问这一页（附的是整页，框 0,0,1,1 就是整页）
    await pdfPage(run2.page, 3).evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await expect(acts(run2.page).getByTestId('pdf-pager')).toHaveText('3 / 5')
    await acts(run2.page).getByRole('button', { name: /问这一页/ }).click()
    await expect(ai(run2.page).getByTestId('reading-msg').last().locator('.noted')).toContainText('已记进笔记', { timeout: 15_000 })
    const md = readFileSync(join(run2.vault, '课程/线性代数/第3讲 线性映射 笔记.md'), 'utf8')
    expect(md).not.toContain('-fig.png')
    // AI 给的「整页」框没被当配图（附的整页截图本身写「整页」，宽是这一页 100% 时的宽，CN-111）
    expect(md).not.toContain('第 3 页 · 整页')
    expect(md).toContain('![整页|612](../../附件/第3讲%20线性映射/p3-1.png)')
  } finally {
    await run2.close()
  }
})
