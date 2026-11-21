// 美学挑错第 2 轮（task-mzstv）：窄处放得下。
// 标签多了当前标签始终整个露着（页面说明晚一步出来也一样）、能滚的那一侧渐隐；页面说明最宽 220 / 140，省略号 + 悬停看全句；
// 右栏 340 宽的 AI 头（读 PDF 和别处同一个头）整个放得下；右栏地址栏网址放不下时末尾省略号、悬停看完整网址。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { acts, launch, openAi, rail, tabOn, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'

const INBOX_MAP =
  '---\ntype: board\n白板样式: 导图\n类型: 导图\n课程: 线性代数\n第几讲: 3\n来源: 照片\n日期: 2026-11-15\n---\n# 导图 11-15 21∶40\n\n- 线性映射\n  - 定义\n  - 核与像\n'
const NAMES = ['思考，快与慢', '冰岛环岛', '第2讲 导图', '线性代数总复习', '概率论第一讲', '毕业论文大纲', '周末购物清单', '极光预报']
const VAULT: Record<string, string | Buffer> = {
  ...Object.fromEntries(NAMES.map((n) => [`笔记/${n}.md`, `# ${n}\n\n正文。\n`])),
  '收件箱/导图 11-15 21∶40.md': INBOX_MAP,
  '课程/线性代数/第3讲 线性映射.pdf': LECTURE,
}
const frame = (f: 'a' | 'b') => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { frame: f } }))
}
const palBox = (page: Page) => page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' })
async function open(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await palBox(page).fill(name)
  const exact = new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\.pdf)?$')
  await page.locator('.pal-row', { has: page.locator('.nm', { hasText: exact }) }).first().click()
  await expect(tabOn(page)).toContainText(name)
}
/** 当前标签在标签条可见区里露着多少（左右各差多少，负数是被切掉的） */
const activeFit = (page: Page) =>
  page.getByTestId('tab-list').evaluate((l) => {
    const t = l.querySelector('.tab.on')!.getBoundingClientRect()
    const r = l.getBoundingClientRect()
    return { left: Math.round(t.left - r.left), right: Math.round(r.right - t.right) }
  })

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<title>长网址</title><h1>${decodeURIComponent(req.url ?? '/')}</h1>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

for (const f of ['a', 'b'] as const) {
  test(`${f.toUpperCase()}：1100 宽开 9 个标签，页面说明晚出来也不把当前标签挤出去；能滚的一侧渐隐；说明省略号、悬停看全句`, async () => {
    const run = await launch(VAULT, { CN_AI_FAKE: '1' }, frame(f))
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 900))
      for (const n of NAMES) await open(page, n)
      // 最后开收件箱里的导图：标签条右端多出「收件箱 · 今晚梦游时归类、起名」
      await open(page, '导图 11-15 21∶40')
      const note = acts(page).getByTestId('page-note')
      await expect(note).toHaveText('收件箱 · 今晚梦游时归类、起名')
      // 当前标签整个露着（右边不被切），左边有藏着的标签：只画左边渐隐
      await expect.poll(async () => (await activeFit(page)).right).toBeGreaterThanOrEqual(0)
      expect((await activeFit(page)).left).toBeGreaterThanOrEqual(0)
      await expect(page.getByTestId('tab-list')).toHaveClass(/\bmore-l\b/)
      await expect(page.getByTestId('tab-list')).not.toHaveClass(/\bmore-r\b/)
      // 中间窄于 900：说明最宽 140，放不下是省略号，悬停看全句
      const nb = (await note.boundingBox())!
      expect(nb.width).toBeLessThanOrEqual(141)
      await expect(note).toHaveCSS('text-overflow', 'ellipsis')
      await note.hover()
      await expect(page.getByTestId('tooltip')).toHaveText('收件箱 · 今晚梦游时归类、起名')

      // 回到第一个标签：像人一样先把标签条滚回开头再点（不靠 Playwright 自己把它滚到正中：白板标签的动作区多一颗缩放，换标签时标签条宽度会变），只画右边渐隐
      await page.getByTestId('tab-list').evaluate((l) => (l.scrollLeft = 0))
      await page.locator('.tab', { hasText: NAMES[0]! }).locator('.tl').click()
      await expect(tabOn(page)).toHaveText(NAMES[0]!)
      await expect.poll(async () => (await activeFit(page)).left).toBeGreaterThanOrEqual(0)
      await expect(page.getByTestId('tab-list')).toHaveClass(/\bmore-r\b/)
      await expect(page.getByTestId('tab-list')).not.toHaveClass(/\bmore-l\b/)
      // 滚到中间：两边都渐隐
      await page.getByTestId('tab-list').evaluate((l) => (l.scrollLeft = 260))
      await expect(page.getByTestId('tab-list')).toHaveClass(/\bmore-l\b.*\bmore-r\b|\bmore-r\b.*\bmore-l\b/)

      // 关到只剩三个（首页、第一篇、导图）：放得下就不渐隐
      for (const n of NAMES.slice(1)) await page.locator('.tab', { hasText: n }).getByRole('button', { name: '关闭标签' }).click()
      await expect(page.locator('.tabs .tab')).toHaveCount(3)
      await expect(page.getByTestId('tab-list')).not.toHaveClass(/\bmore-l\b|\bmore-r\b/)
    } finally {
      await run.close()
    }
  })
}

test('右栏 340 宽：读 PDF 和别处的 AI 是同一行对话（同一个位置、一样高），「名字 ⌄ · +」整个露着（「AI」在标签上）；没有引擎胶囊、「改动可撤回」', async () => {
  const run = await launch(VAULT, { CN_AI_FAKE: '1' })
  const { page, app } = run
  /** 头里每一样都整个在头里面，头不横着溢出 */
  const fits = (aside: ReturnType<Page['getByRole']>) =>
    aside.locator('.aih').evaluate((h) => {
      const a = h.getBoundingClientRect()
      const parts = [...h.querySelectorAll('b, .conv, .acts button')]
      return parts.length === 2 && h.scrollWidth <= h.clientWidth && parts.every((e) => {
        const r = e.getBoundingClientRect()
        return r.width > 0 && r.left >= a.left - 0.5 && r.right <= a.right + 0.5
      })
    })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1512, 945))
    await open(page, '第3讲 线性映射')
    await openAi(page)
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(ai).toBeVisible()
    // 默认 380 以后，拖窄到 340 看窄的时候放不放得下
    await widenRight(page, -40)
    expect(Math.round((await ai.boundingBox())!.width)).toBe(340)
    expect(await fits(ai)).toBe(true)
    await expect(ai.getByTestId('ai-conv')).toHaveText('第3讲 线性映射.pdf')
    await expect(page.getByTestId('dtab-ai')).toHaveText('AI')
    await expect(ai.getByTestId('ai-undo-hint')).toHaveCount(0)
    await expect(ai.locator('.aih').getByTestId('ai-engine')).toHaveCount(0)
    // 引擎在输入框底行
    await expect(ai.locator('.aiin .ft').getByTestId('ai-engine')).toHaveText('Claude Code')
    const h1 = (await ai.locator('.aih').boundingBox())!
    const i1 = (await ai.locator('.aiin').boundingBox())!

    await open(page, NAMES[0]!)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    await expect(chat).toBeVisible()
    expect(await fits(chat)).toBe(true)
    await expect(chat.getByTestId('ai-undo-hint')).toHaveCount(0)
    await expect(chat.locator('.aiin .ft').getByTestId('ai-engine')).toHaveText('Claude Code')
    const h2 = (await chat.locator('.aih').boundingBox())!
    const i2 = (await chat.locator('.aiin').boundingBox())!
    expect([h2.x, h2.y, h2.width, h2.height].map(Math.round)).toEqual([h1.x, h1.y, h1.width, h1.height].map(Math.round))
    // 输入框同一个位置：左右边、底边一样
    expect(Math.round(i2.x)).toBe(Math.round(i1.x))
    expect(Math.round(i2.width)).toBe(Math.round(i1.width))
    expect(Math.round(i2.y + i2.height)).toBe(Math.round(i1.y + i1.height))
  } finally {
    await run.close()
  }
})

test('右栏 340 宽的地址栏：网址放不下时末尾是省略号，悬停看完整网址；点进去是完整网址可以改', async () => {
  const run = await launch(VAULT, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    const addr = web.getByRole('textbox', { name: '网址' })
    const long = `${base}/iceland/ring-road/winter-driving-guide`
    await addr.fill(long)
    await addr.press('Enter')
    await expect(web.getByRole('tablist', { name: '网页标签' }).getByRole('tab').first()).toContainText('长网址')
    await page.locator('.center').click({ position: { x: 300, y: 300 } })
    await expect(addr).not.toBeFocused()
    await expect(addr).toHaveValue(long.replace(/^http:\/\//, ''))
    await expect(addr).toHaveCSS('text-overflow', 'ellipsis')
    expect(await addr.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true)
    await addr.hover()
    // 悬停：完整网址打头，后面一句「点一下改地址」（task-sta8n 起当前标签就是地址块）
    await expect(page.getByTestId('tooltip')).toContainText(long)
    await expect(page.getByTestId('tooltip')).toContainText('点一下改地址')
    // 点进去：完整网址、全选，提示收起
    await addr.click()
    await expect(addr).toHaveValue(long)
    await expect(page.getByTestId('tooltip')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
