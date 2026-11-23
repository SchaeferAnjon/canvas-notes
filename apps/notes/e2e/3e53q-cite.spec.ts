// task-3e53q：AI 回答里的引用能点开。用户截图（读 PDF 时右栏 AI 的旁支回答里「小论文计划里排」带下划线点不开）：
// AI 写的是 [小论文计划里排](课程/小论文计划.md…)，md-render.tsx 把它画成一个光秃秃的 <u>，谁都不接点击。
// 现在：点一下出预览卡（标题 + 引到的那几行）；⌘点打开（笔记到那几行、闪一下；PDF 翻到那页、框闪一下）；⇧⌘点开在后面的新标签、不切走。
// AI 对话、读 PDF 的 AI 的旁支、白板卡、文档里都真点一遍。一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { acts, launch, openAi, openNote, pane, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PLAN = '课程/小论文计划.md'
const PLAN_MD = ['# 小论文计划', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 条：先放着。`), 'SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。', '', ...Array.from({ length: 30 }, (_, i) => `后面第 ${i + 1} 行。`)].join('\n') + '\n'
const PDF = '课程/线代/第3讲.pdf'
const NOTE3 = '课程/线代/第3讲 笔记.md'
const NOTE3_MD = '# 第3讲 笔记\n\n' + Array.from({ length: 40 }, (_, i) => `开头第 ${i + 1} 段。\n`).join('\n') + '\n## 定义\n线性：加起来再变和变了再加一样。\n'
const HERE = '收件箱/随手.md'
const files = { [PLAN]: PLAN_MD, [PDF]: LECTURE, [NOTE3]: NOTE3_MD, [HERE]: '# 随手\n\n问问 AI。\n' }

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const card = (page: Page) => page.getByRole('dialog', { name: '引用' })
const tabs = (page: Page) => page.getByTestId('tab-list').locator(':scope > .tab')
const flashBar = (page: Page) => pane(page).locator('.cm-flashbar:not([hidden])')
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')

async function askCites(page: Page) {
  await openNote(page, '随手')
  await openAi(page)
  const ta = chat(page).getByRole('textbox', { name: '问 AI' })
  await ta.fill('列出引用')
  await ta.press('Enter')
  const msg = chat(page).getByTestId('ai-msg').last()
  await expect(msg).toContainText('没有这篇', { timeout: 15_000 })
  return msg
}

/** 编辑器里第 n 行（1 起）在不在看得见的地方 */
const lineShown = (page: Page, text: string) => expect(pane(page).locator('.cm-line', { hasText: text })).toBeInViewport()

test('AI 对话：引用画成能点的链接；点一下出预览卡（标题 + 那几行），⌘点开到那两行、闪一下；只写名字的、绝对路径的也认；库里没有的照实说', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const msg = await askCites(page)
    const link = msg.locator('a.cite', { hasText: '小论文计划里排' })
    await expect(link).toBeVisible()
    // 以前是 <u>，现在是链接：鼠标变手
    await expect(msg.locator('u')).toHaveCount(0)
    expect(await link.evaluate((e) => getComputedStyle(e).cursor)).toBe('pointer')

    // 点一下：预览卡，不开标签
    const before = await tabs(page).count()
    await link.click()
    await expect(card(page)).toBeVisible()
    await expect(card(page).locator('.top b')).toHaveText('小论文计划')
    await expect(card(page).locator('.u')).toHaveText('课程 · 第 42–43 行')
    await expect(card(page).locator('.ex p')).toHaveText(['SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。'])
    await expect(card(page).locator('.acts button')).toHaveText(['打开 ⌘点', '新标签打开 ⇧⌘点', '拷贝'])
    expect(await tabs(page).count()).toBe(before)
    // 卡收在右栏里，离两边至少 8（不伸进中间栏）
    const col = (await chat(page).boundingBox())!
    const cb = (await card(page).boundingBox())!
    expect(cb.x).toBeGreaterThanOrEqual(col.x + 7)
    expect(cb.x + cb.width).toBeLessThanOrEqual(col.x + col.width - 7)
    // esc 收起
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)

    // ⌘点：中间开《小论文计划》，滚到第 42–43 行，左边闪一下
    await link.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
    await lineShown(page, 'SAGE 排第 2 篇')
    await expect(flashBar(page)).toBeVisible()
    await expect(tabs(page).filter({ hasText: '#L' })).toHaveCount(0)

    // AI 对话跟着中间那一篇走：回到问的那篇
    await tabs(page).filter({ hasText: '随手' }).click()
    // 绝对路径（AI 用 cd 进库里读文件时这样写）：一样认成库里那篇
    await msg.locator('a.cite', { hasText: /^小论文计划$/ }).click()
    await expect(card(page).locator('.top b')).toHaveText('小论文计划')
    await expect(card(page).locator('.u')).toHaveText('课程')
    await expect(card(page).locator('.ex p').first()).toHaveText('第 1 条：先放着。')
    // 卡上点「打开」= ⌘点
    await card(page).getByRole('button', { name: /^打开/ }).click()
    await expect(card(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('小论文计划')
    await tabs(page).filter({ hasText: '随手' }).click()

    // 库里没有的：卡上照实说，⌘点底栏说一句，不开空白标签
    const n = await tabs(page).count()
    await msg.locator('a.cite', { hasText: '没有这篇' }).click()
    await expect(card(page).locator('.u')).toHaveText('库里没找到这一篇')
    await expect(card(page).getByRole('button', { name: /^打开/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await msg.locator('a.cite', { hasText: '没有这篇' }).click({ modifiers: ['Meta'] })
    await expect(page.getByTestId('toast')).toContainText('库里没找到')
    expect(await tabs(page).count()).toBe(n)
  } finally {
    await run.close()
  }
})

test('AI 对话：⇧⌘点 [[笔记#标题]] 开在后面的新标签、不切走，切过去时滚到那一段闪一下；⌘点 PDF 那块翻到第 4 页、框闪；网页那段卡上写网址和那句，⌥⌘点在中间栏开', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const msg = await askCites(page)
    const wiki = msg.locator('a.cite.wl', { hasText: '第3讲 笔记' })
    // 不露 md 记号：「笔记 › 标题」
    await expect(wiki).toHaveText('第3讲 笔记 › 定义')
    await wiki.click()
    await expect(card(page).locator('.u')).toHaveText('课程/线代 · 第 83–84 行')
    await expect(card(page).locator('.ex p')).toHaveText(['定义', '线性：加起来再变和变了再加一样。'])
    await page.keyboard.press('Escape')

    const before = await tabs(page).count()
    await wiki.click({ modifiers: ['Meta', 'Shift'] })
    await expect(tabs(page)).toHaveCount(before + 1)
    // ⇧ 点不把回答里的字扩选上
    expect(await page.evaluate(() => window.getSelection()?.isCollapsed ?? true)).toBe(true)
    await expect(tabOn(page)).toHaveText('随手')
    await tabs(page).filter({ hasText: '第3讲 笔记' }).click()
    await expect(tabOn(page)).toHaveText('第3讲 笔记')
    await lineShown(page, '线性：加起来再变')
    await expect(flashBar(page)).toBeVisible()

    await tabs(page).filter({ hasText: '随手' }).click()
    // PDF 某页某块（页码小牌，和读 PDF、白板上的一样）：点一下就翻到第 4 页，那块闪一下（以前在 AI 对话里点了没反应）
    await msg.locator('a.pg.cite', { hasText: '第 4 页那块' }).click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('4 / 5', { timeout: 10_000 })
    await expect(pdfPane(page).getByTestId('pdf-flash')).toBeVisible()
    await tabs(page).filter({ hasText: '随手' }).click()

    // 网页某一段：卡上写网址（不带 #:~:text）和那一句；⇧⌘点在中间栏开一个网页标签
    const web = msg.locator('a.cite', { hasText: '注意力那段' })
    await web.click()
    await expect(card(page).locator('.u')).toHaveText('example.com/attn.html')
    await expect(card(page).locator('.ex p')).toHaveText(['注意力'])
    await expect(card(page).locator('.acts button')).toHaveText(['右栏打开 ⌘点', '中间栏打开 ⌥⌘点', '拷贝'])
    await page.keyboard.press('Escape')
    const n = await tabs(page).count()
    await web.click({ modifiers: ['Meta', 'Alt'] })
    await expect(tabs(page)).toHaveCount(n + 1)
  } finally {
    await run.close()
  }
})

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const side = (page: Page) => ai(page).getByRole('region', { name: '旁支' })
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })

async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const n = w.currentNode as Text
        const i = n.data.indexOf(a!)
        const j = n.data.indexOf(b!, i)
        if (i < 0 || j < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, j + b!.length)
        n.parentElement!.scrollIntoView({ block: 'center' })
        const rs = r.getClientRects()
        const f = rs[0]!
        const l = rs[rs.length - 1]!
        return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
      }
      throw new Error('没找到那一句')
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

test('用户截图那一处：读 PDF 时 AI 回答里开旁支，旁支回答里的「小论文计划里排」点了出预览卡，⌘点开到那两行', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(pdfPane(page).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.keyboard.press('Meta+j')
    await expect(ai(page)).toBeVisible()
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    const msg = ai(page).getByTestId('reading-msg').last()
    await expect(msg.locator('.txt')).toContainText('列就是基向量去哪', { timeout: 20_000 })
    await selectText(page, msg.locator('.txt'), '列就是', '去哪')
    await expect(askbox(page)).toBeVisible()
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('列出引用')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    const ans = side(page).getByTestId('side-msg').last()
    await expect(ans).toContainText('没有这篇', { timeout: 20_000 })

    const link = ans.locator('a.cite', { hasText: '小论文计划里排' })
    await link.click()
    await expect(card(page).locator('.ex p')).toHaveText(['SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。'])
    // 点了链接不算选字：没出「选中的这句」小框
    await expect(askbox(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await link.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
    await lineShown(page, 'SAGE 排第 2 篇')
    await expect(flashBar(page)).toBeVisible()
    // 旁支还开着（回到 PDF 时它在）
    await tabs(page).filter({ hasText: '第3讲.pdf' }).click()
    await expect(side(page)).toBeVisible()
  } finally {
    await run.close()
  }
})

test('白板卡里的 [字](相对这篇的链接)：点一下出预览卡、不拖不选卡；⌘点开到那一行。文档里 ⌘点「笔记.md#L42」开到那一行，不开「#L42」空标签', async () => {
  const BOARD = '课程/线代/板书.md'
  const run = await launch({ ...files, [BOARD]: '# 板书\n\n见[计划那两句](../小论文计划.md#L42-L43)。\n\n另一张卡。\n' })
  const { page } = run
  try {
    await openNote(page, '板书')
    // 文档：⌘点
    const docLink = pane(page).locator('.cm-link', { hasText: '计划那两句' })
    await docLink.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
    await lineShown(page, 'SAGE 排第 2 篇')
    await expect(flashBar(page)).toBeVisible()
    await expect(tabs(page).filter({ hasText: '#L' })).toHaveCount(0)

    // 白板看法
    await tabs(page).filter({ hasText: '板书' }).click()
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    const link = board.locator('a.cite', { hasText: '计划那两句' })
    const cardEl = board.locator('.db-card', { has: page.locator('a.cite', { hasText: '计划那两句' }) })
    const at = await cardEl.boundingBox()
    await link.click()
    await expect(card(page).locator('.ex p')).toHaveText(['SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。'])
    expect(await cardEl.boundingBox()).toEqual(at)
    await page.keyboard.press('Escape')
    await link.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
    await expect(flashBar(page)).toBeVisible()
  } finally {
    await run.close()
  }
})
