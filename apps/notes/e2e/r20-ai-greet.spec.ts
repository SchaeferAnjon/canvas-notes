// AI 空对话打招呼、快捷命令放底部（task-0tgz2，用户 r20：「这里可以变成像你打招呼, 然后shortcut可以放在底部」；
// 小样 design/ai-empty 方向 A「贴着输入框」）：空对话是引擎标志 + 钟点问候 + 跟着在看的东西走的一句，不再有「想让它做什么？」、
// 那段「这里是…的对话」和三个通栏大按钮；输入框上面一排小按钮，点了就是选了那条 / 命令；放不下收进「⋯」；发了第一问问候和那一排都收起
import { expect, test, type Page } from '@playwright/test'
import { createServer } from 'node:http'
import { launch, leftView, openNote, rail, tabOn, webAboveAi, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'

const files = {
  '随手记.md': '# 随手记\n\n我叫小明，今天天气很好。\n',
  '写作/白板草稿.md': '---\ntype: board\n---\n# 白板草稿\n\n## 想法\n\n一张卡。\n\n## 素材\n\n另一张卡。\n',
  '周记/2026-W47.md': '# 2026-W47\n\n这周主要在读 ECP。\n',
  '收件箱/菜谱.md': '# 菜谱\n\n番茄炒蛋。\n',
  '收件箱/机票.md': '# 机票\n\n冰岛的机票订好了。\n',
  '课程/线代/第3讲.pdf': LECTURE,
}

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const greet = (page: Page) => chat(page).getByTestId('ai-greet')
const quick = (page: Page) => chat(page).getByTestId('ai-quick')
const chips = (page: Page) => quick(page).locator('.qc:not(.more):visible')
const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!
const HELLO = /^(夜深了|早上好|中午好|下午好|晚上好)$/
const helloNow = () => {
  const h = new Date().getHours()
  return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 13 ? '中午好' : h < 18 ? '下午好' : '晚上好'
}

async function open(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
}

test('文档的空对话：标志 + 钟点问候 +「要对《随手记》做点什么？」，没有大标题、那段说明和大按钮；底部一排「翻译 · 整理收件箱」贴着输入框，真点「翻译」就是 /翻译，发了以后问候和那一排收起', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    await expect(ai).toBeVisible()
    // 问候：引擎标志（Claude）+ 宋体 600 22 的钟点问候，下面 13 号一句
    await expect(greet(page).locator('h2')).toHaveText(HELLO)
    expect(await greet(page).locator('h2').textContent()).toBe(helloNow())
    await expect(greet(page).locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    expect(await greet(page).locator('h2').evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight])).toEqual(['22px', '600'])
    await expect(greet(page).locator('p')).toHaveText('要对《随手记》做点什么？')
    expect(await greet(page).locator('p').evaluate((e) => getComputedStyle(e).fontSize)).toBe('13px')
    // 旧的不要了
    await expect(ai).not.toContainText('想让它做什么？')
    await expect(ai).not.toContainText('别处问过的在上面')
    await expect(ai.locator('.ai-empty .sug')).toHaveCount(0)
    // 快捷命令：收件箱里有两条，所以有整理收件箱；字不带「/」，悬停说是哪条命令
    await expect(chips(page)).toHaveText(['翻译', '整理收件箱'])
    await expect(chips(page).first()).toHaveAttribute('title', '/翻译 · 翻译文档里选中的那段；没选就翻整篇')
    const c0 = await box(chips(page).first())
    expect(Math.round(c0.height)).toBe(28)
    expect(await chips(page).first().evaluate((e) => getComputedStyle(e).borderRadius)).toBe('8px')
    expect(await chips(page).first().locator('svg').getAttribute('width')).toBe('14')
    await expect(quick(page).getByRole('button', { name: '更多命令' })).toBeHidden()
    // 摆法 A：问候靠底，下面紧跟那一排，那一排下面 8 就是输入框；左边和输入框外沿对齐
    const input = await box(ai.locator('.aiin'))
    expect(Math.round(input.y - (c0.y + c0.height))).toBe(8)
    expect(Math.round(c0.x - input.x)).toBe(0)
    const g = await box(greet(page))
    const gap = c0.y - (g.y + g.height)
    expect(gap).toBeGreaterThanOrEqual(8)
    expect(gap).toBeLessThanOrEqual(32)
    const msgs = await box(ai.locator('.msgs'))
    expect(Math.round(g.x - msgs.x)).toBe(16)

    // 打字时那一排先藏起来（斜杠菜单、@ 菜单从这里往上弹），清空回来
    const ta = ai.getByRole('textbox', { name: '问 AI' })
    await ta.fill('随便')
    await expect(quick(page)).toBeHidden()
    await ta.fill('')
    await expect(quick(page)).toBeVisible()

    // 真点「翻译」：就是发了 /翻译，翻的是这篇
    await chips(page).filter({ hasText: '翻译' }).click()
    await expect(ai.locator('.um').last()).toHaveText('/翻译')
    const a = ai.getByTestId('ai-msg').last()
    await expect(a.locator('.txt')).toHaveText('（译文）Seek wealth, not money or status.')
    await expect(a.locator('.read .rd')).toHaveText('读了 随手记.md')
    // 发了第一问：问候和那一排都收起，输入框还在原处
    await expect(greet(page)).toHaveCount(0)
    await expect(quick(page)).toHaveCount(0)
    expect(Math.round((await box(ai.locator('.aiin'))).y)).toBe(Math.round(input.y))
    // 新对话：问候和那一排回来
    await ai.getByRole('button', { name: '新对话' }).click()
    await expect(greet(page).locator('p')).toHaveText('要对《随手记》做点什么？')
    await expect(chips(page)).toHaveText(['翻译', '整理收件箱'])
  } finally {
    await run.close()
  }
})

test('快捷命令跟着在看的东西换：白板四条、窄了收进「⋯」（列出收起的和「全部命令」）、宽了都露着；文件夹、收件箱、右栏开着网页各是各的', async () => {
  const server = createServer((_q, r) => r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>读书页</title><p>一段字</p>'))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/book`
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await open(page, '白板草稿')
    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    await expect(greet(page).locator('p')).toHaveText('要对白板《白板草稿》做点什么？')
    // 默认 380 宽放不下四颗：后面的收进「⋯」，不换第二排
    const all = ['整理当前白板', '总结这块白板', '写成文章', '整理收件箱']
    const more = quick(page).getByRole('button', { name: '更多命令' })
    await expect(more).toBeVisible()
    const shown = await chips(page).allTextContents()
    expect(shown.length).toBeLessThan(4)
    expect(shown.length).toBeGreaterThanOrEqual(2)
    expect(shown).toEqual(all.slice(0, shown.length))
    const ys = await quick(page).locator('.qc:visible').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().y)))
    expect(new Set(ys).size).toBe(1)
    // 「⋯」：先列收起的几条，一道线，最后「全部命令 /」
    await more.click()
    const menu = page.getByRole('menu', { name: '更多命令' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText([...all.slice(shown.length), '全部命令/'])
    // 「全部命令」就是在输入框打「/」，斜杠菜单出来
    await menu.getByRole('menuitem', { name: /全部命令/ }).click()
    await expect(menu).toHaveCount(0)
    await expect(ai.getByRole('textbox', { name: '问 AI' })).toHaveValue('/')
    await expect(ai.getByRole('listbox', { name: '命令' })).toBeVisible()
    await ai.getByRole('textbox', { name: '问 AI' }).fill('')
    // 点外面收起
    await more.click()
    await expect(menu).toBeVisible()
    await ai.locator('.msgs').click({ position: { x: 20, y: 20 } })
    await expect(menu).toHaveCount(0)
    // 拉宽到 600：四颗都露着，没有「⋯」
    await widenRight(page, 220)
    await expect(chips(page)).toHaveText(all)
    await expect(more).toBeHidden()

    // 文件夹页：这个文件夹自己的几条（收件箱有和周记有关的才放「挪进来」，这里没有）
    await leftView(page, '文件')
    await page.locator('aside.side').getByRole('tree').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^周记$/ }) }).first().click()
    await expect(greet(page).locator('p')).toHaveText('要对「周记」做点什么？')
    await expect(chips(page).first()).toHaveText('把这周的周记总结成三句话')

    // 文档 + 右栏开着网页：剪藏这一页排第一
    await openNote(page, '随手记')
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = page.getByRole('complementary', { name: '网页' }).getByRole('textbox', { name: '网址' })
    await addr.fill(url)
    await addr.press('Enter')
    await page.getByTestId('dtab-ai').click()
    await expect(chips(page)).toHaveText(['剪藏这一页', '翻译', '整理收件箱'])
    await expect(chips(page).first()).toHaveAttribute('title', '/剪藏这一页 · 把右栏开着的整个网页剪进收件箱')
  } finally {
    await run.close()
    server.close()
  }
})

test('收件箱空着不放整理收件箱；收件箱页说有几条；读 PDF 是「要问《第3讲》哪里？框一块就能问。」+「问这一页」，点了就问这一页', async () => {
  const run = await launch({ '随手记.md': files['随手记.md'], '收件箱/菜谱.md': files['收件箱/菜谱.md'], '课程/线代/第3讲.pdf': LECTURE }, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('打开收件箱')
    await page.getByRole('dialog', { name: '搜索和命令' }).getByRole('option').filter({ hasText: /^打开收件箱/ }).first().click()
    await page.keyboard.press('Meta+j')
    await expect(greet(page).locator('p')).toHaveText('收件箱里有1条，要分一分吗？')
    await expect(chips(page)).toHaveText(['整理收件箱', '找重复', '现在梦游'])

    // 读 PDF：同一种问候，快捷命令是「问这一页」（前面是引擎标志）
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    const r = reading(page)
    await expect(r).toBeVisible()
    await expect(r.getByTestId('ai-greet').locator('h2')).toHaveText(HELLO)
    await expect(r.getByTestId('ai-greet').locator('p')).toHaveText('要问《第3讲》哪里？框一块就能问。')
    await expect(r).not.toContainText('想让它做什么？')
    const ask = r.getByTestId('ai-quick').locator('.qc:visible')
    await expect(ask).toHaveText(['问这一页'])
    await expect(ask.locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    await ask.click()
    await expect(r.locator('.um').first()).toContainText('给我讲解一下这一页')
    await expect(r.getByTestId('ai-greet')).toHaveCount(0)
    await expect(r.getByTestId('ai-quick')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('右栏上下两格、AI 在矮的下格：问候放不下先收，底部那一排快捷命令一直在', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 700))
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+j')
    await rail(page).getByRole('button', { name: '历史' }).click()
    await webAboveAi(page, 'history')
    const ai = chat(page)
    await expect(chips(page)).toHaveText(['翻译', '整理收件箱'])
    // 问候哪一块都不被拦腰切：要么整个露着，要么整个不画
    const cut = await ai.locator('.msgs').evaluate((m) => {
      const b = m.getBoundingClientRect()
      return [...m.querySelectorAll<HTMLElement>('[data-testid="ai-greet"] h2, [data-testid="ai-greet"] p')]
        .filter((e) => e.getClientRects().length)
        .filter((e) => {
          const r = e.getBoundingClientRect()
          return r.top < b.top - 0.5 || r.bottom > b.bottom + 0.5
        }).length
    })
    expect(cut).toBe(0)
    // 那一排整个在这一格里
    const q = await box(quick(page))
    const cell = await box(ai)
    expect(q.y).toBeGreaterThanOrEqual(cell.y)
    expect(q.y + q.height).toBeLessThanOrEqual(cell.y + cell.height)
  } finally {
    await run.close()
  }
})
