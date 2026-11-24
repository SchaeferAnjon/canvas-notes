// 第 2a 段（D 组「只有一个 AI」）；2026-11-20 工作区方向 A：AI 是右栏里的一个标签，右下角圆钮（画正在用的那家的标志）或 ⌘J 开关；
// 网页和 AI 默认叠在同一组，拖网页到上半才上下各一半；换页面位置宽度不变；读 PDF 和别处同一个头、同一行「看得到」；每个文件、文件夹、首页、收件箱各存各的对话，
// 头上「周记 ⌄」翻得到别处问过的（含读 PDF 的），点开看的时候头下一行「这是在「X」问的 · 回到「周记」」；以前全库一份的对话迁成「以前的对话」。
import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { execFileSync } from 'node:child_process'
import { launch, leftView, openNote, pane, rail, tabOn, webAboveAi } from './app'
import { pickQuick, quickTexts } from './ai-quick'
import { BOOK, DOC as BOOK_DOC, PATH as BOOK_PATH } from './fixtures/book-digest'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const files = { '周记/2026-W47.md': '# 2026-W47\n\n这周主要在读 ECP，冰岛的机票订好了。\n', '随手记.md': '# 随手记\n\n一段字。\n', [PDF]: LECTURE }

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const notesCell = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const fab = (page: Page) => rail(page).locator('.ai-fab')
const convMenu = (page: Page) => page.getByRole('menu', { name: '对话' })
const tree = (page: Page) => page.locator('aside.side').getByRole('tree')
const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!

async function openFolder(page: Page, name: string) {
  await leftView(page, '文件')
  await tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) }).first().click()
  await expect(pane(page)).toHaveAttribute('data-folder', name)
}

async function openDoc(page: Page, name: string) {
  await leftView(page, '文件')
  await tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) }).first().click()
  await expect(tabOn(page)).toHaveText(name)
}

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

/** 右图标栏那一列（右栏的左边是它） */
const railX = async (page: Page) => (await box(rail(page))).x

test('文件夹页按 ⌘J：AI 在右栏一格，看得到「文件夹：周记 · 1篇」和能动手，对话是空的「周记」；头照小样；圆钮一直在、画引擎标志、开着多一圈', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openFolder(page, '周记')
    // 圆钮：右图标栏最下面，34 圆，里面是 Claude 的标志（18），关着时没有外圈
    await expect(fab(page)).toBeVisible()
    await expect(fab(page)).toHaveAttribute('aria-label', '打开 AI')
    await expect(fab(page).locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    const fb = await box(fab(page))
    expect([Math.round(fb.width), Math.round(fb.height)]).toEqual([34, 34])
    const logo = await box(fab(page).locator('.eng-logo'))
    expect([Math.round(logo.width), Math.round(logo.height)]).toEqual([18, 18])
    expect(await fab(page).evaluate((e) => getComputedStyle(e).borderRadius)).toBe('50%')

    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    await expect(ai).toBeVisible()
    // 在右栏：中间栏右边、右图标栏左边，不浮在中间栏上
    const a = await box(ai)
    // 圆钮的下沿比右栏岛的下沿高 4（小样：不落到底栏那一行）
    const fb2 = await box(fab(page))
    expect(Math.round(a.y + a.height - (fb2.y + fb2.height))).toBe(4)
    const c = await box(page.locator('main.center'))
    expect(a.x).toBeGreaterThanOrEqual(c.x + c.width)
    // 没拖过的右栏 380 宽（照 AI、读 PDF 的小样；以前 340 时引擎名、快捷键提示、旁支头被挤掉）
    expect(Math.round(a.width)).toBe(380)
    expect(Math.abs(a.x + a.width - (await railX(page)))).toBeLessThanOrEqual(1)
    await expect(page.locator('.ai.floating')).toHaveCount(0)
    // 圆钮还在，开着时多一圈 1.5px 强调色
    await expect(fab(page)).toBeVisible()
    await expect(fab(page)).toHaveClass(/\bon\b/)
    await expect(fab(page)).toHaveAttribute('aria-label', '收起 AI')
    expect(await fab(page).evaluate((e) => getComputedStyle(e).boxShadow)).toMatch(/0px 0px 0px 1\.5px/)

    // 标签「AI」（前面是那家的标志）；对话那一行 40 高：「周记 ⌄」胶囊 26 高圆角 6 + 新对话；「AI」两个字、「收起 ⌘J」不在这一行（工作区方向 A）
    await expect(page.getByTestId('dtab-ai')).toHaveText('AI')
    await expect(page.getByTestId('dtab-ai').locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    const head = ai.locator('.aih')
    expect(Math.round((await box(head)).height)).toBe(40)
    await expect(head.locator('b')).toHaveCount(0)
    const conv = ai.getByTestId('ai-conv')
    await expect(conv).toHaveText('周记')
    expect(Math.round((await box(conv)).height)).toBe(26)
    expect(await conv.evaluate((e) => getComputedStyle(e).borderRadius)).toBe('6px')
    await expect(head.getByRole('button', { name: '新对话' })).toBeVisible()
    await expect(head.getByRole('button', { name: '收起 AI' })).toHaveCount(0)
    await expect(head.getByTestId('ai-engine')).toHaveCount(0)
    await expect(head.getByTestId('ai-undo-hint')).toHaveCount(0)

    // 看得到：文件夹（带圆点）+ 能动手（cursor 图标，透明底、1px 描边）；不再写「没打开笔记」
    const sees = ai.getByTestId('ai-sees')
    await expect(sees.locator('.chip').first()).toHaveText('文件夹：周记 · 1篇')
    await expect(sees.locator('.chip').first().locator('.dot')).toBeVisible()
    await expect(sees.locator('.chip.hands')).toHaveText('能动手：整理、归类、写小结')
    await expect(sees).not.toContainText('没打开笔记')
    const chip = sees.locator('.chip').first()
    expect(Math.round((await box(chip)).height)).toBe(22)
    expect(await chip.evaluate((e) => getComputedStyle(e).borderRadius)).toBe('6px')

    // 空对话打招呼（task-0tgz2）：引擎标志 + 宋体 600 22 的钟点问候、下面一句「要对「周记」做点什么？」；
    // 输入框上面一排快捷命令是这个文件夹自己的（收件箱空着：没有「挪进来」）
    const greet = ai.getByTestId('ai-greet')
    await expect(greet.locator('h2')).toHaveText(/^(夜深了|早上好|中午好|下午好|晚上好)$/)
    expect(await greet.locator('h2').evaluate((e) => [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight])).toEqual(['22px', '600'])
    await expect(greet.locator('p')).toHaveText('要对「周记」做点什么？')
    await expect(ai).not.toContainText('想让它做什么？')
    expect(await quickTexts(ai)).toEqual(['把这周的周记总结成三句话', '照上周的样子开一篇 2026-W48'])
    const qc = ai.getByTestId('ai-quick').locator('.qc:not(.more):visible')
    expect(await qc.locator('svg').evaluateAll((els) => els.map((e) => e.getAttribute('width')))).toEqual((await qc.allTextContents()).map(() => '14'))
    expect(Math.round((await box(qc.first())).height)).toBe(28)
    expect(await qc.first().evaluate((e) => getComputedStyle(e).borderRadius)).toBe('8px')

    // 标签上的 × 收起，圆钮的外圈没了
    await page.getByTestId('dtab-ai').hover()
    await page.getByTestId('dtab-ai').getByRole('button', { name: '收起AI' }).click()
    await expect(ai).toBeHidden()
    await expect(fab(page)).not.toHaveClass(/\bon\b/)
    // 圆钮再开
    await fab(page).click()
    await expect(ai).toBeVisible()
  } finally {
    await run.close()
  }
})

test('右栏开着网页时网页和 AI 是同一组两个标签（不硬切两截），拖网页到上半才上下各一半；开关网页 AI 的 x 和宽不变；换页面（文件夹、文档、PDF）AI 的位置和宽度不变', async () => {
  const server = createServer((_q, r) => r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>读书页</title><p>一段字</p>'))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/book`
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openFolder(page, '周记')
    // 圆钮钉在窗口右下角（右图标栏最下面）：开关 AI、开网页上下分、只开网页、拖宽右栏，一像素不动
    const fabAt = async () => {
      const b = await box(fab(page))
      return [b.x, b.y, b.width, b.height]
    }
    const f0 = await fabAt()
    const vp = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    expect(vp.width - (f0[0]! + f0[2]!)).toBeLessThan(16)
    expect(vp.height - (f0[1]! + f0[3]!)).toBeLessThan(48)
    await page.keyboard.press('Meta+j')
    expect(await fabAt()).toEqual(f0)
    const b1 = await box(chat(page))
    await openDoc(page, '随手记')
    const b2 = await box(chat(page))
    await openPdf(page)
    // 读 PDF：同一格换成读 PDF 的 AI（原来开着就还开着）
    await expect(reading(page)).toBeVisible()
    const b3 = await box(reading(page))
    for (const b of [b2, b3]) {
      expect(Math.abs(b.x - b1.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.width - b1.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.y - b1.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(b.height - b1.height)).toBeLessThanOrEqual(1)
    }

    // 开网页：和 AI 同一组的第二个标签，网页在前面、占满整栏（不硬切两截）；点「AI」标签换回来，位置大小不变
    await openDoc(page, '随手记')
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    await expect(web).toBeVisible()
    const addr = web.getByRole('textbox', { name: '网址' })
    await addr.fill(url)
    await addr.press('Enter')
    await expect(web.getByRole('tablist', { name: '网页标签' }).getByRole('tab').first()).toContainText('读书页')
    await expect(chat(page)).toBeHidden()
    const w0 = await box(web)
    expect(Math.abs(w0.y - b1.y - (b1.height - w0.height))).toBeLessThanOrEqual(1)
    expect(Math.abs(w0.x - b1.x) + Math.abs(w0.width - b1.width)).toBeLessThanOrEqual(2)
    await page.getByTestId('dtab-ai').click()
    await expect(chat(page)).toBeVisible()
    const a0 = await box(chat(page))
    expect([a0.x, a0.y, a0.width, a0.height].map(Math.round)).toEqual([b1.x, b1.y, b1.width, b1.height].map(Math.round))
    // 拖网页到这一组的上半：网页在上、AI 在下，各一半高；AI 的 x 和宽不变
    await webAboveAi(page)
    const w = await box(web)
    const a = await box(chat(page))
    expect(await fabAt()).toEqual(f0)
    expect(Math.abs(a.x - b1.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.width - b1.width)).toBeLessThanOrEqual(1)
    expect(Math.abs(w.x - a.x)).toBeLessThanOrEqual(1)
    expect(w.y).toBeLessThan(a.y)
    expect(Math.abs(w.height - a.height)).toBeLessThanOrEqual(2)
    expect(Math.abs(a.y + a.height - (b1.y + b1.height))).toBeLessThanOrEqual(1)
    // 右栏开着网页时「看得到」多一颗网页（写清是右栏的），能动手换成网页的（AI网页工具）
    await expect(chat(page).getByTestId('ai-sees').locator('.chip').nth(1)).toHaveText('右栏网页：127.0.0.1')
    // 下半格矮：快捷命令那一排还在，「剪藏这一页」排第一，文档不出「总结这块白板」；收件箱空着不放整理收件箱（task-0tgz2）
    expect(await quickTexts(chat(page))).toEqual(['剪藏这一页', '翻译'])
    await expect(chat(page).getByTestId('ai-quick').locator('.qc').first()).toBeVisible()
    await expect(chat(page).getByTestId('ai-sees').locator('.chip.hands')).toHaveText('能动手：在右栏网页点、填表、剪藏')
    // 只开网页（AI 收起）：圆钮还在原处；再开 AI 回到它原来那一组（中间右边第一栏的第一组：网页那一组，叠成标签）
    await page.keyboard.press('Meta+j')
    await expect(chat(page)).toBeHidden()
    expect(await fabAt()).toEqual(f0)
    await page.keyboard.press('Meta+j')
    await expect(chat(page)).toBeVisible()
    // 拖宽右栏：圆钮不动
    const sep = await box(page.getByRole('separator', { name: '拖动调整右栏宽度' }))
    await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
    await page.mouse.down()
    await page.mouse.move(sep.x + sep.width / 2 - 120, sep.y + 300, { steps: 6 })
    await page.mouse.up()
    expect(await fabAt()).toEqual(f0)
    // 关网页（标签上的 ×）：AI 占满整栏，x 和宽不变（右栏宽是刚拖的）
    await page.getByTestId('dtab-web').hover()
    await page.getByTestId('dtab-web').getByRole('button', { name: '收起网页' }).click()
    await expect(web).toBeHidden()
    const a2 = await box(chat(page))
    expect(Math.abs(a2.x + a2.width - (b1.x + b1.width))).toBeLessThanOrEqual(1)
    expect(Math.abs(a2.width - (b1.width + 120))).toBeLessThanOrEqual(2)
    expect(Math.abs(a2.height - b1.height)).toBeLessThanOrEqual(1)
    expect(await fabAt()).toEqual(f0)
    await expect(chat(page).getByTestId('ai-sees')).not.toContainText('网页：')
  } finally {
    await run.close()
    server.close()
  }
})

test('按地方存对话：PDF 上问过一句，文件夹页是空的「周记」，「周记 ⌄」里翻得到 PDF 那条，点开头下写「这是在…问的」、发问接着那里，点「回到」回来；各页各存一份，重开软件还在', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const root = dirname(vault)
  try {
    await openPdf(page)
    await page.keyboard.press('Meta+j')
    const q = reading(page).getByRole('textbox', { name: '问 AI' })
    await q.fill('给我讲讲这一页')
    await q.press('Enter')
    await expect(reading(page).getByTestId('reading-msg').last().locator('.txt')).toContainText('这是讲解', { timeout: 15_000 })
    // 读 PDF 也是同一个头：AI +「第3讲.pdf ⌄」
    await expect(reading(page).getByTestId('ai-conv')).toHaveText('第3讲.pdf')

    // 换到文件夹页：右栏留着 PDF 那段（AI 对话绑页面，换页不换走），头上「切到《周记》的 AI ⌥⌘J」，点了才换
    await openFolder(page, '周记')
    await expect(reading(page).getByTestId('ai-away')).toHaveText('这是在《第3讲.pdf》问的切到《周记》的 AI⌥⌘J')
    await reading(page).getByTestId('ai-follow').click()
    const ai = chat(page)
    await expect(ai).toBeVisible()
    await expect(ai.getByTestId('ai-greet').locator('p')).toHaveText('要对「周记」做点什么？')
    await expect(ai.getByTestId('ai-msg')).toHaveCount(0)

    // 「周记 ⌄」：这里（打勾、还没问过）、最近在别处问的（第3讲.pdf、今天 几点）、全部对话…
    await ai.getByTestId('ai-conv').click()
    const menu = convMenu(page)
    await expect(menu).toBeVisible()
    expect(Math.round((await box(menu)).width)).toBe(316)
    await expect(menu.locator('.mh')).toHaveText(['这里', '最近在别处问的'])
    const here = menu.getByRole('menuitemradio').first()
    await expect(here).toHaveAttribute('aria-checked', 'true')
    await expect(here.locator('.lb')).toHaveText('周记')
    await expect(here.locator('.r')).toHaveText('还没问过')
    const pdfRow = menu.getByRole('menuitemradio').filter({ hasText: '第3讲.pdf' })
    // 一行一页（对话菜单按页归组）：页名 + 灰色路径「课程 › 线代」+「1 段 · 今天 几点」
    await expect(pdfRow.locator('.path')).toHaveText('课程 › 线代')
    await expect(pdfRow.locator('.r')).toHaveText(/^1 段 · 今天 \d\d:\d\d$/)
    await expect(menu.getByRole('menuitem', { name: '全部对话…' })).toBeVisible()
    // 菜单点外面收起，再点胶囊是收起不是重开
    await ai.locator('.msgs').click()
    await expect(menu).toHaveCount(0)
    await ai.getByTestId('ai-conv').click()
    await expect(menu).toBeVisible()
    await ai.getByTestId('ai-conv').click()
    await expect(menu).toHaveCount(0)

    // 点 PDF 那条：用读 PDF 那一套显示，头下一行「这是在「第3讲.pdf」问的 · 回到「周记」」
    await ai.getByTestId('ai-conv').click()
    await menu.getByRole('menuitemradio').filter({ hasText: '第3讲.pdf' }).click()
    const away = reading(page)
    await expect(away).toBeVisible()
    await expect(away.getByTestId('ai-away')).toHaveText('这是在《第3讲.pdf》问的回到《周记》')
    await expect(away.getByTestId('reading-sees')).toHaveCount(0)
    await expect(away.getByTestId('ai-conv')).toHaveText('第3讲.pdf')
    await expect(away.locator('.um').first()).toHaveText('给我讲讲这一页')
    // 发问接着那里的对话
    const q2 = away.getByRole('textbox', { name: '问 AI' })
    await q2.fill('还是不懂')
    await q2.press('Enter')
    await expect(away.getByTestId('reading-msg').last().locator('.txt')).toContainText('换个方式讲', { timeout: 15_000 })
    // 回到「周记」
    await away.getByTestId('ai-away').getByRole('button', { name: '回到《周记》' }).click()
    await expect(chat(page)).toBeVisible()
    await expect(chat(page).getByTestId('ai-conv')).toHaveText('周记')
    await expect(chat(page).getByTestId('ai-sees')).toContainText('文件夹：周记 · 1篇')

    // 在周记问一句；换到随手记是它自己的空对话；回来还在
    const box1 = chat(page).getByRole('textbox', { name: '问 AI' })
    await box1.fill('周记里写了什么')
    await box1.press('Enter')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
    await openDoc(page, '随手记')
    // 周记那段问过：留着，头上点「切到《随手记》的 AI」才换
    await expect(chat(page).getByTestId('ai-away')).toHaveText('这是在《周记》问的切到《随手记》的 AI⌥⌘J')
    await chat(page).getByTestId('ai-follow').click()
    await expect(chat(page).getByTestId('ai-sees').locator('.chip').first()).toHaveText('文档：随手记')
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(0)
    await expect(chat(page).getByTestId('ai-greet').locator('p')).toHaveText('要对《随手记》做点什么？')
    expect(await quickTexts(chat(page))).toEqual(['翻译'])
    // 菜单里周记（1问之后成了别处）、第3讲.pdf 都在，按时间排，周记在前
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu.getByRole('menuitemradio').locator('.lb')).toHaveText(['随手记', '周记', '第3讲.pdf'])
    // 全部对话…：同一个菜单里列全部，能滚
    await menu.getByRole('menuitem', { name: '全部对话…' }).click()
    await expect(menu.locator('.mh')).toHaveText(['全部对话'])
    // 按文件夹、页归组：组头「课程 › 线代 › 第3讲.pdf · 1 段」，一行是那段第一问
    await expect(menu.locator('.gh')).toHaveText(['周记 · 1 段', '课程 › 线代 › 第3讲.pdf · 1 段'])
    await expect(menu.getByRole('menuitemradio').locator('.lb')).toHaveText(['周记里写了什么', '给我讲讲这一页'])
    expect(await menu.locator('.all').evaluate((e) => getComputedStyle(e).overflowY)).toBe('auto')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await openFolder(page, '周记')
    await expect(chat(page).locator('.um')).toHaveText(['周记里写了什么'])
    // 这里那一行写「1问」
    await chat(page).getByTestId('ai-conv').click()
    await expect(menu.getByRole('menuitemradio').first().locator('.r')).toHaveText(/1问$/)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(600)

    // 重开软件：AI 还开着，停在周记，对话还在；对话存在软件设置目录、不进库
    await run.app.close()
    const app2 = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: join(root, 'user-data'), CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19' },
    })
    try {
      const p2 = await app2.firstWindow()
      await expect(chat(p2)).toBeVisible()
      await expect(chat(p2).getByTestId('ai-conv')).toHaveText('周记')
      await expect(chat(p2).locator('.um')).toHaveText(['周记里写了什么'])
      // 别处的对话存在软件设置目录（userData/ai/chats/），库里哪个文件都没有这句
      const all = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.name === '.git' ? [] : e.isDirectory() ? all(join(dir, e.name)) : [join(dir, e.name)]))
      expect(all(vault).filter((f) => readFileSync(f, 'utf8').includes('周记里写了什么'))).toEqual([])
      expect(all(join(root, 'user-data/ai/chats')).some((f) => readFileSync(f, 'utf8').includes('周记里写了什么'))).toBe(true)
    } finally {
      await app2.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('以前全库只存一份的对话迁成一条「以前的对话」，列在别处里，点开还能接着问', async () => {
  let ud = ''
  const run = await launch(files, { CN_AI_FAKE: '1' }, (vault) => {
    ud = join(dirname(vault), 'user-data')
    mkdirSync(join(ud, 'ai'), { recursive: true })
    const h = createHash('sha1').update(vault).digest('hex').slice(0, 12)
    const msgs = [
      { id: 1, role: 'user', text: '冰岛几月去最好' },
      { id: 2, role: 'ai', text: '九月到三月看极光。', engine: 'claude', by: 'Claude Code · Opus 5.5' },
    ]
    writeFileSync(join(ud, 'ai', `chat-${h}.json`), JSON.stringify({ vault, msgs, sessions: { claude: 'old-session' } }))
  })
  const { page } = run
  try {
    await openDoc(page, '随手记')
    await page.keyboard.press('Meta+j')
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(0)
    await chat(page).getByTestId('ai-conv').click()
    const old = convMenu(page).getByRole('menuitemradio').filter({ hasText: '以前的对话' })
    await expect(old).toBeVisible()
    await old.click()
    await expect(chat(page).getByTestId('ai-away')).toHaveText('这是在《以前的对话》问的回到《随手记》')
    await expect(chat(page).locator('.um')).toHaveText(['冰岛几月去最好'])
    await expect(chat(page).getByTestId('ai-msg').locator('.txt')).toHaveText(['九月到三月看极光。'])
    // 接着问：进的是以前那段对话
    const q = chat(page).getByRole('textbox', { name: '问 AI' })
    await q.fill('那住哪')
    await q.press('Enter')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
    await expect(chat(page).locator('.um')).toHaveText(['冰岛几月去最好', '那住哪'])
    // 旧文件迁走了，不再是全库一份
    await page.waitForTimeout(600)
    expect(readdirSync(join(ud, 'ai')).filter((f) => /^chat-[0-9a-f]{12}\.json$/.test(f))).toEqual([])
    // 回到随手记：还是空的
    await chat(page).getByTestId('ai-away').getByRole('button', { name: '回到《随手记》' }).click()
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('打开 PDF 不再强制打开 AI，框一块照旧打开；读 PDF 时竖条「笔记」开笔记标签（和 AI 叠在同一组），再点收起回到 AI；看得到「第3讲.pdf · 第1页 | 读过全文5页」（还没记过笔记不画「笔记0轮」）', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await expect(reading(page)).toBeHidden()
    await expect(fab(page)).toHaveAttribute('aria-label', '打开 AI')
    // 框一块：AI 打开，框的那块在输入框里
    const pg = page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"]')
    const b = await box(pg)
    await page.mouse.move(b.x + b.width * 0.1, b.y + b.height * 0.2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.3, { steps: 4 })
    await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.4, { steps: 4 })
    await page.mouse.up()
    await expect(reading(page)).toBeVisible()
    await expect(reading(page).getByTestId('reading-att')).toContainText('第1页')
    const sees = reading(page).getByTestId('reading-sees')
    await expect(sees.locator('.chip').first()).toHaveText('第3讲.pdf · 第1页')
    await expect(sees).toContainText('读过全文5页', { timeout: 20_000 })
    await expect(sees.locator('.chip')).toHaveText(['第3讲.pdf · 第1页', '读过全文5页'])
    await expect(reading(page).getByTestId('pdf-progress')).toHaveCount(0)
    const ra = await box(reading(page))

    // 竖条「笔记」：同一组里多一个「笔记」标签、在前面（同一个位置），AI 在它后面
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notesCell(page)).toBeVisible()
    await expect(reading(page)).toBeHidden()
    await expect(page.getByTestId('dtab-note')).toHaveText('笔记')
    await expect(page.locator('.dgrp .dtab')).toHaveText(['AI', '笔记'])
    const nb = await box(notesCell(page))
    expect(Math.abs(nb.x - ra.x) + Math.abs(nb.width - ra.width) + Math.abs(nb.height - ra.height)).toBeLessThanOrEqual(2)
    await expect(rail(page).getByRole('button', { name: '笔记', exact: true })).toHaveAttribute('aria-pressed', 'true')
    // 笔记开着时圆钮不亮，点它回到 AI
    await expect(fab(page)).not.toHaveClass(/\bon\b/)
    // 再点「笔记」：收起笔记标签，回到 AI
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(reading(page)).toBeVisible()
    await expect(notesCell(page)).toHaveCount(0)
    // 笔记 → ⌘J：换到 AI（笔记还开着，在后面）；AI 看得见时 ⌘J 收起 AI，笔记到前面
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notesCell(page)).toBeVisible()
    await page.keyboard.press('Meta+j')
    await expect(reading(page)).toBeVisible()
    await expect(notesCell(page)).toBeHidden()
    await page.keyboard.press('Meta+j')
    await expect(reading(page)).toBeHidden()
    await expect(notesCell(page)).toBeVisible()
    await expect(page.locator('.dgrp .dtab')).toHaveText(['笔记'])
  } finally {
    await run.close()
  }
})

test('只开了笔记（工作区布局记在 cn.dock）：换到文档笔记标签藏起来、右栏关着，回到 PDF 又是笔记；重开软件还是；点圆钮 AI 叠进同一组、在前面', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openPdf(page)
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notesCell(page)).toBeVisible()
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('cn.dock') ?? '{}').cols?.flatMap((c: { groups?: { views: string[] }[] }) => c.groups?.flatMap((g) => g.views) ?? []))).toEqual(['note'])
    // 换到文档：笔记标签藏起来（不换成这篇的 AI），右栏关着，圆钮写「打开 AI」
    await openDoc(page, '随手记')
    await expect(notesCell(page)).toHaveCount(0)
    await expect(chat(page)).toBeHidden()
    await expect(page.locator('.win')).not.toHaveClass(/with-right/)
    await expect(fab(page)).toHaveAttribute('aria-label', '打开 AI')
    // 回到 PDF：又是笔记
    await page.getByTestId('tab-list').getByRole('tab', { name: /第3讲\.pdf/ }).click()
    await expect(notesCell(page)).toBeVisible()
    await page.waitForTimeout(600)
    await run.app.close()
    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: run.userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19' },
    })
    try {
      const p2 = await app.firstWindow()
      await expect(tabOn(p2)).toHaveText('第3讲.pdf')
      await expect(notesCell(p2)).toBeVisible()
      // 点圆钮：AI 叠进同一组、在前面；布局里记着两样
      await fab(p2).click()
      await expect(reading(p2)).toBeVisible()
      await expect(p2.locator('.dgrp .dtab')).toHaveText(['笔记', 'AI'])
      await expect.poll(() => p2.evaluate(() => JSON.parse(localStorage.getItem('cn.dock') ?? '{}').cols?.flatMap((c: { groups?: { views: string[] }[] }) => c.groups?.flatMap((g) => g.views) ?? []))).toEqual(['note', 'ai'])
    } finally {
      await app.close()
    }
  } finally {
    rmSync(dirname(vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('圆钮和左栏「问AI」画的是正在用的那家的标志：设置 › AI 换成 Codex 当场变；A 款底栏最右那一项也能开关 AI', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await expect(fab(page).locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    // 左栏「最近」头上的「问AI」也是这一家的标志（15）
    const ask = page.locator('aside.side').getByRole('button', { name: '问AI' })
    await expect(ask.locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    expect(Math.round((await box(ask.locator('.eng-logo'))).width)).toBe(15)
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '设置' })
    await dialog.getByTestId('ai-default-pick').click()
    await page.getByRole('menu', { name: '默认用哪一家' }).getByRole('menuitemradio').filter({ hasText: 'Codex' }).click()
    await expect(dialog.getByTestId('ai-default')).toContainText('Codex')
    // 设置还开着，圆钮、左栏「问AI」已经换成 Codex 的标志
    await expect(fab(page).locator('.eng-logo')).toHaveAttribute('data-engine', 'codex')
    await expect(ask.locator('.eng-logo')).toHaveAttribute('data-engine', 'codex')
    await page.keyboard.press('Escape')

    // A 款：底栏最右一项写着 Codex，点了开、再点收
    await page.evaluate(() => (window as unknown as { cn: { setSettings(p: unknown): Promise<unknown> } }).cn.setSettings({ appearance: { frame: 'a' } }))
    await page.reload()
    await expect(page.locator('.win')).toHaveClass(/frame-a/)
    const item = page.getByRole('contentinfo').locator('.ai-corner')
    await expect(item).toHaveText('Codex')
    await expect(item.locator('.eng-logo')).toHaveAttribute('data-engine', 'codex')
    await item.click()
    await expect(chat(page)).toBeVisible()
    await expect(item).toHaveClass(/\bon\b/)
    await expect(item).toBeVisible()
    await item.click()
    await expect(chat(page)).toBeHidden()
    await expect(item).not.toHaveClass(/\bon\b/)
  } finally {
    await run.close()
  }
})

test('文件夹页的建议照小样三颗，每颗都真跑通：总结这周的周记、收件箱里和周记有关的挪进来（点同意才挪，一次提交）、照上周的样子开一篇 2026-W48（属性和小节照上周，开好就打开）', async () => {
  const w47 = '---\ncreated: 2026-11-12\n---\n# 2026-W47\n\n这周主要在读 ECP，冰岛的机票订好了。\n\n## 读了\n\n- 课：ECP 第 5 讲\n\n## 下周\n\n订住宿。\n'
  const run = await launch({ ...files, '周记/2026-W47.md': w47, '收件箱/周记里要写的.md': '# 周记里要写的\n\n周记里记一笔：机票订好了。\n', '收件箱/菜谱.md': '# 菜谱\n\n番茄炒蛋。\n' }, { CN_AI_FAKE: '1' })
  const { page, app, vault } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openFolder(page, '周记')
    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    // 输入框上面那排快捷命令（task-0tgz2）：放不下的收在「⋯」里，pickQuick 跟人一样先点「⋯」
    expect(await quickTexts(ai)).toEqual(['把这周的周记总结成三句话', '收件箱里和周记有关的挪进来', '照上周的样子开一篇 2026-W48'])
    // 1. 总结：问的那句照原话进对话，回答是 AI 的三句话，上面一行读了哪篇
    await pickQuick(ai, '把这周的周记总结成三句话')
    await expect(ai.locator('.um').last()).toHaveText('把这周的周记总结成三句话')
    const a1 = ai.getByTestId('ai-msg').last()
    await expect(a1.locator('.txt')).toHaveText('这周主要在读 ECP 的第 5 讲。冰岛的机票订好了。住宿还没定。')
    await expect(a1.locator('.read .rd')).toHaveText('读了「2026-W47」')
    // 2. 挪进来：新对话里点；列出和周记有关的那条（菜谱不列），点同意才挪
    await ai.getByRole('button', { name: '新对话' }).click()
    await pickQuick(ai, '收件箱里和周记有关的挪进来')
    const a2 = ai.getByTestId('ai-msg').last()
    await expect(a2.locator('.txt')).toHaveText('和周记有关的1条，挪进「周记」：')
    await expect(a2.locator('.mv')).toHaveText(['周记里要写的→ 周记'])
    expect(existsSync(join(vault, '周记/周记里要写的.md'))).toBe(false)
    await a2.getByRole('button', { name: '同意，挪过去' }).click()
    await expect(a2).toContainText('挪好了1条')
    // 下面的改动块写挪到哪、能撤回（以前挪文件的提交在历史里一个文件都不列，写「改了0个文件」）
    await expect(a2.getByTestId('ai-change').locator('.hd')).toContainText('改了1个文件')
    await expect(a2.getByTestId('ai-change').locator('.fr')).toHaveText([/^周记\/周记里要写的\.md移动\+0−0$/])
    await expect.poll(() => existsSync(join(vault, '周记/周记里要写的.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/周记里要写的.md'))).toBe(false)
    expect(existsSync(join(vault, '收件箱/菜谱.md'))).toBe(true)
    expect(execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('AI：把收件箱里1条挪进「周记」')
    // 3. 开一篇：照上周的属性和小节，内容空着；开好就打开
    await openFolder(page, '周记')
    await ai.getByRole('button', { name: '新对话' }).click()
    expect((await quickTexts(ai))[2]).toBe('照上周的样子开一篇 2026-W48')
    await pickQuick(ai, '照上周的样子开一篇 2026-W48')
    await expect(tabOn(page)).toHaveText('2026-W48')
    await expect.poll(() => (existsSync(join(vault, '周记/2026-W48.md')) ? readFileSync(join(vault, '周记/2026-W48.md'), 'utf8') : '')).toMatch(/^---\ncreated: \d{4}-\d{2}-\d{2}\n---\n# 2026-W48\n\n## 读了\n\n- 课：\n\n## 下周\n$/)
    expect(execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('照「2026-W47」开一篇「2026-W48」')
    // 回到周记：那条回答在，下一篇已经有了，建议换成 2026-W49
    await openFolder(page, '周记')
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toHaveText('开好了「2026-W48」，内容空着等你写。')
  } finally {
    await run.close()
  }
})

test('书摘开着时「看得到」写「书摘：趣说明朝276年」，对话胶囊和空对话那句也是短书名；右栏开着网页时「网页：」那颗不被挤到第二行', async () => {
  const server = createServer((_q, r) => r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>读书页</title><p>一段字</p>'))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/book`
  const run = await launch({ ...files, [BOOK_PATH]: BOOK_DOC }, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    // 和小样同一个窗口（1440×887 的内容区）
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, BOOK)
    await expect(tabOn(page)).toHaveText(BOOK)
    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    const sees = ai.getByTestId('ai-sees')
    await expect(sees.locator('.chip').first()).toHaveText('书摘：趣说明朝276年')
    await expect(sees.locator('.chip.hands')).toHaveText('能动手：改写、插入、挪块')
    await expect(ai.getByTestId('ai-conv')).toHaveText('趣说明朝276年')
    await expect(ai.getByTestId('ai-greet').locator('p')).toHaveText('要对《趣说明朝276年》做点什么？')
    // 右栏开着网页（拖到上半，AI 在下半）：「书摘：…」和「网页：…」在同一行
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = page.getByRole('complementary', { name: '网页' }).getByRole('textbox', { name: '网址' })
    await addr.fill(url)
    await addr.press('Enter')
    await webAboveAi(page)
    await expect(sees.locator('.chip').nth(1)).toHaveText('右栏网页：127.0.0.1')
    expect(Math.abs((await box(sees.locator('.chip').nth(0))).y - (await box(sees.locator('.chip').nth(1))).y)).toBeLessThanOrEqual(1)
    // 下半格：问候按放不放得下一级级收（先藏标志和那一行问候，再整个不画，task-0tgz2），哪一块都不被拦腰切；
    // 快捷命令在消息区外面，一直在；收起网页回到整栏高，问候整个回来
    const cut = () =>
      ai.locator('.msgs').evaluate((m) => {
        const b = m.getBoundingClientRect()
        return [...m.querySelectorAll<HTMLElement>('[data-testid="ai-greet"] h2, [data-testid="ai-greet"] p')]
          .filter((e) => e.getClientRects().length)
          .filter((e) => e.getBoundingClientRect().top < b.top - 0.5 || e.getBoundingClientRect().bottom > b.bottom + 0.5).length
      })
    expect(await cut()).toBe(0)
    expect(await quickTexts(ai)).toEqual(['剪藏这一页', '翻译'])
    await expect(ai.getByTestId('ai-quick').locator('.qc').first()).toBeVisible()
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(ai.getByTestId('ai-greet').locator('h2')).toBeVisible()
    expect(await cut()).toBe(0)
    await rail(page).getByRole('button', { name: '网页' }).click()
    await rail(page).getByRole('button', { name: '网页' }).click()
    // 普通文档照旧写「文档：」
    await openDoc(page, '随手记')
    await expect(sees.locator('.chip').first()).toHaveText('文档：随手记')
  } finally {
    await run.close()
    server.close()
  }
})
