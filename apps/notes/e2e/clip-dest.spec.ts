/**
 * 剪藏去处（2026-11-25，页 142 推荐甲 + 用户「这里再加一个可以选目录。其他的没问题，修复。」），全是真点、真按 ⌘S、真右键：
 * 1. 「⋯ › 剪到哪篇…」第三种「放进一个文件夹…」：弹选文件夹（能新建），选了以后这个网站剪的每次一张卡片进那个文件夹，写法同收件箱；
 *    弹层里写着选的文件夹，随时能换回收件箱、一篇；
 * 2. 地址栏一直挂剪藏去处小牌：收件箱 / 某篇 / 某文件夹写对、点开能改；中间开着文件夹首页时多一项「放进这个文件夹」；
 * 3. 142 列的不一致：右键「剪进文档」带 md（公式）和回到那段的链接；右键图「剪成卡片」进收件箱；AI 剪整页抽正文、存图；
 *    剪成卡片的网页上也打 💬，点了打开那张卡片。
 * 本机假网页（自己起的小服务器、fixtures/d2l-conv），无头（CN_E2E=1），不上网。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { launch, leftView, openNote, pane, tabOn } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { guest, inboxFiles, openPickTarget, openWeb, pressInPage, read, selectPara, toast, web } from './clip-web'
import { d2lConv, type D2lSite, XIJ } from './fixtures/d2l-conv'
import { solidPng } from './fixtures/png'

test.setTimeout(240_000)

const P = [
  '数据预处理的第一步是把原始数据读进来，常见的格式是逗号分隔的表格文件，每一行是一条记录。',
  '读进来以后先看有没有缺失值，缺失值可以用均值填补，也可以直接删掉那一行，看数据多少再定。',
  '接着把类别变量换成独热编码，这样每一类都成了一列零或一，模型才认得出来。',
  '最后把整张表换成张量，交给后面的模型去训练，这一步要注意数据类型是不是浮点数。',
]
const CAP = '图1.1 数据预处理的流程'
const PNG = solidPng(120, 80, [40, 160, 120])

let server: Server
let base: string
let conv: D2lSite
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/flow.png') {
      res.setHeader('content-type', 'image/png')
      return res.end(PNG)
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><html><head><meta charset="utf-8"><title>1.1 数据预处理 · 小书</title></head>
      <body style="font:15px sans-serif;padding:12px;max-width:640px"><article>
      <h1>1.1 数据预处理</h1>
      <h2>1.1.1 读数据</h2>
      <p id="p1">${P[0]}</p>
      <p id="p2">${P[1]}</p>
      <figure><img id="img" src="/flow.png" alt="flow" width="120" height="80" style="display:block"><figcaption>${CAP}</figcaption></figure>
      <h2>1.1.2 换成张量</h2>
      <p id="p3">${P[2]}</p>
      <p id="p4">${P[3]}</p>
      <p>${'这一节讲的都是动手之前的准备工作。'.repeat(12)}</p>
      </article></body></html>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  conv = await d2lConv()
})
test.afterAll(async () => {
  server.close()
  await conv.close()
})

const NOTE = '课程/读书笔记.md'
const dlg = (page: Page) => page.getByRole('dialog', { name: '记到哪篇' })
const picker = (page: Page) => page.getByRole('dialog', { name: '移到' })
const chip = (page: Page) => page.getByTestId('full-chip')

const chipMenu = (page: Page) => web(page).getByRole('menu', { name: '剪到哪' })
const mdIn = (vault: string, dir: string) => (existsSync(join(vault, dir)) ? readdirSync(join(vault, dir)).filter((f) => f.endsWith('.md')).sort() : [])
/** 卡片去掉创建时间那一行 */
const noStamp = (s: string) => s.replace(/^created: .*\n/m, '')
/** 卡片的样子：去掉创建时间、引文里的字、来源里 #:~:text= 后面的字（比两张不同段的卡片写法是不是一样） */
const shape = (s: string) =>
  noStamp(s)
    .replace(/^> .*$/gm, '> …')
    .replace(/#:~:text=[^)\s]+/g, '#:~:text=…')

async function clipPara(run: Awaited<ReturnType<typeof launch>>, id: string) {
  await selectPara(run.page, id)
  await pressInPage(run, 'S', ['meta'])
}

test('「剪到哪篇…」放进一个文件夹：新建文件夹、剪两次都进它（写法同收件箱），弹层写着它；换一个已有的文件夹、换回收件箱都生效', async () => {
  const run = await launch({ [NOTE]: '# 读书笔记\n\n第一段。\n', '剪藏/视频/字幕.md': '# 字幕\n' })
  const { page, vault } = run
  try {
    await openNote(page, '读书笔记')
    await openWeb(page, `${base}/book`)
    const before = read(vault, NOTE)

    // ⋯ › 剪到哪篇…：弹层四项（中间那篇、选别的一篇、收件箱、放进一个文件夹…）；点「放进一个文件夹…」弹选文件夹
    await selectPara(page, 'p1')
    await openPickTarget(page)
    await expect(dlg(page)).toBeVisible()
    await expect(dlg(page).getByRole('radio')).toHaveText([/读书笔记/, /选别的一篇/, /放进收件箱/, /放进一个文件夹…/])
    await dlg(page).getByRole('radio', { name: /放进一个文件夹/ }).click()
    await expect(picker(page)).toBeVisible()
    await expect(picker(page)).toContainText('这个网站剪的放进哪个文件夹…')
    // 最后一行「新建文件夹…」：没选哪个就建在最外层；输名字回车
    await picker(page).getByRole('menuitem', { name: '新建文件夹…' }).click()
    await expect(picker(page)).toContainText('建在最外层')
    await picker(page).getByRole('textbox', { name: '新文件夹的名字' }).fill('网页摘录')
    await picker(page).getByRole('textbox', { name: '新文件夹的名字' }).press('Enter')
    await expect(picker(page)).toHaveCount(0)
    await expect.poll(() => existsSync(join(vault, '网页摘录'))).toBe(true)
    // 弹层还开着：那一项写「网页摘录 · 选的文件夹」，选着它；按钮「放进这个文件夹」
    const dirOpt = dlg(page).getByRole('radio', { name: /网页摘录/ })
    await expect(dirOpt).toHaveAttribute('aria-checked', 'true')
    await expect(dirOpt).toContainText('选的文件夹')
    await expect(dlg(page)).toContainText('以后这个网站剪的每段一张卡片，放进「网页摘录」')
    await expect(dlg(page).locator('.wh-go')).toHaveText(/放进这个文件夹/)
    await dlg(page).locator('.wh-go').click()
    await expect(dlg(page)).toHaveCount(0)
    await expect(toast(page)).toContainText('这个网站以后剪进「网页摘录」')
    await expect(chip(page)).toHaveText(/^剪进 网页摘录$/)

    // 剪两次：都进 网页摘录/，一段一张卡片；那篇一个字不动、收件箱没有
    await clipPara(run, 'p1')
    await expect(toast(page)).toContainText('剪成卡片，放进「网页摘录」了')
    await expect.poll(() => mdIn(vault, '网页摘录').length).toBe(1)
    await clipPara(run, 'p3')
    await expect.poll(() => mdIn(vault, '网页摘录').length).toBe(2)
    const cards = mdIn(vault, '网页摘录').map((f) => read(vault, `网页摘录/${f}`))
    expect(cards.some((c) => c.includes(`> ${P[0]}`))).toBe(true)
    expect(cards.some((c) => c.includes(`> ${P[2]}`))).toBe(true)
    for (const c of cards) expect(c).toMatch(/\n—— \[[^\]]+\]\(http:\/\/127\.0\.0\.1:\d+\/book#:~:text=[^)]+\)/)
    expect(inboxFiles(vault)).toEqual([])
    await page.waitForTimeout(600)
    expect(read(vault, NOTE)).toBe(before)

    // 再开「剪到哪篇…」：右边写 网页摘录，弹层先选着它；点它换一个已有的文件夹「剪藏/视频」（打字找）
    await selectPara(page, 'p2')
    expect(await openPickTarget(page)).toContain('网页摘录')
    await expect(dlg(page).getByRole('radio', { name: /网页摘录/ })).toHaveAttribute('aria-checked', 'true')
    await dlg(page).getByRole('radio', { name: /网页摘录/ }).click()
    await expect(picker(page)).toBeVisible()
    await picker(page).getByRole('searchbox', { name: '挪到哪个文件夹' }).fill('视频')
    await picker(page).getByRole('menuitem', { name: /视频/ }).click()
    await expect(dlg(page).getByRole('radio', { name: /剪藏\/视频/ })).toHaveAttribute('aria-checked', 'true')
    await dlg(page).locator('.wh-go').click()
    await expect(toast(page)).toContainText('这个网站以后剪进「剪藏/视频」')
    await clipPara(run, 'p2')
    await expect.poll(() => mdIn(vault, '剪藏/视频').length).toBe(2)
    const inVideo = read(vault, `剪藏/视频/${mdIn(vault, '剪藏/视频').find((f) => f !== '字幕.md')!}`)
    expect(inVideo).toContain(`> ${P[1]}`)

    // 换回收件箱：再剪进收件箱，卡片写法和文件夹里的一样
    await selectPara(page, 'p4')
    expect(await openPickTarget(page)).toContain('剪藏/视频')
    await dlg(page).getByRole('radio', { name: /放进收件箱/ }).click()
    await dlg(page).locator('.wh-go').click()
    await expect(toast(page)).toContainText('这个网站以后剪进收件箱')
    await clipPara(run, 'p4')
    await expect(toast(page)).toContainText('剪成卡片，放进收件箱了')
    await expect.poll(() => inboxFiles(vault).length).toBe(1)
    const inInbox = read(vault, `收件箱/${inboxFiles(vault)[0]}`)
    expect(inInbox).toContain(`> ${P[3]}`)
    expect(shape(inInbox)).toBe(shape(cards[0]!))
    expect(mdIn(vault, '网页摘录').length).toBe(2)
  } finally {
    await run.close()
  }
})

test('地址栏小牌一直挂着：收件箱 / 中间那篇 / 文件夹写对，点开能改；开着文件夹首页多一项「放进这个文件夹」', async () => {
  const run = await launch({ [NOTE]: '# 读书笔记\n\n第一段。\n', '剪藏/视频/字幕.md': '# 字幕\n', '课程/线代/a.md': '# a\n' })
  const { page, vault } = run
  try {
    // 什么都没开：网页一开，地址栏就挂「剪进 收件箱」（不只是网页占满时）
    await openWeb(page, `${base}/book`)
    await expect(chip(page)).toHaveText(/^剪进 收件箱$/)

    // 中间开着《读书笔记》、这个网站还没定：照旧写「剪进 收件箱」（剪藏去处规则），菜单第一项列着中间那篇、没打勾
    await openNote(page, '读书笔记')
    await expect(chip(page)).toHaveText(/^剪进 收件箱$/)
    await chip(page).click()
    await expect(chipMenu(page).getByRole('menuitemradio', { name: /读书笔记/ })).toHaveAttribute('aria-checked', 'false')
    await expect(chipMenu(page).getByRole('menuitem', { name: '放进这个文件夹' })).toHaveCount(0)

    // 放进一个文件夹…：弹选文件夹，选「课程/线代」：小牌写「剪进 课程/线代」，⌘S 进它
    await chipMenu(page).getByRole('menuitem', { name: '放进一个文件夹…' }).click()
    await expect(picker(page)).toBeVisible()
    await picker(page).getByRole('searchbox', { name: '挪到哪个文件夹' }).fill('线代')
    await picker(page).getByRole('menuitem', { name: /线代/ }).click()
    await expect(chip(page)).toHaveText(/^剪进 课程\/线代$/)
    await expect(toast(page)).toContainText('这个网站以后剪进「课程/线代」')
    await clipPara(run, 'p1')
    await expect(toast(page)).toContainText('剪成卡片，放进「课程/线代」了')
    await expect.poll(() => mdIn(vault, '课程/线代').length).toBe(2)

    // 菜单：选着的文件夹打勾；换成「剪成卡片，放进收件箱」
    await chip(page).click()
    await expect(chipMenu(page).getByRole('menuitemradio', { name: /课程\/线代/ })).toHaveAttribute('aria-checked', 'true')
    await chipMenu(page).getByRole('menuitemradio', { name: '剪成卡片，放进收件箱' }).click()
    await expect(chip(page)).toHaveText(/^剪进 收件箱$/)
    await clipPara(run, 'p2')
    await expect.poll(() => inboxFiles(vault).length).toBe(1)

    // 菜单第一项那篇：点了「记进《读书笔记》」，打勾，⌘S 不问直接进它
    await chip(page).click()
    await chipMenu(page).getByRole('menuitemradio', { name: /读书笔记/ }).click()
    await expect(chip(page)).toHaveText(/^记进 读书笔记$/)
    await expect(toast(page)).toContainText('这个网站以后记进《读书笔记》')
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await clipPara(run, 'p3')
    await expect(dlg(page)).toHaveCount(0)
    await expect.poll(() => read(vault, NOTE)).toContain(P[2])

    // 中间开着文件夹首页（左栏点「剪藏」）：菜单多一项「放进这个文件夹 剪藏」，点了小牌写「剪进 剪藏」，⌘S 进它
    await leftView(page, '文件')
    await page.getByRole('tree', { name: '全部文件' }).locator('[data-path="剪藏"]').first().click()
    await expect(tabOn(page)).toHaveText('剪藏')
    await chip(page).click()
    const here = chipMenu(page).getByRole('menuitem', { name: /放进这个文件夹/ })
    await expect(here).toContainText('剪藏')
    await here.click()
    await expect(chip(page)).toHaveText(/^剪进 剪藏$/)
    await clipPara(run, 'p4')
    await expect.poll(() => mdIn(vault, '剪藏').length).toBe(1)
    expect(read(vault, `剪藏/${mdIn(vault, '剪藏')[0]}`)).toContain(`> ${P[3]}`)
    // 已经选着它：菜单里打勾那一项是它，不再列「放进这个文件夹」
    await chip(page).click()
    await expect(chipMenu(page).getByRole('menuitemradio', { name: /剪藏/ })).toHaveAttribute('aria-checked', 'true')
    await expect(chipMenu(page).getByRole('menuitem', { name: /放进这个文件夹/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

test('右键「剪进文档」和 ⌘S 一样：公式写成 $…$、来源带回到那段的链接、小标题', async () => {
  const run = await launch({ [NOTE]: '# 读书笔记\n\n第一段。\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '读书笔记')
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await page.keyboard.press('End')
    await openWeb(page, conv.url)
    await selectPara(page, 'p2')
    const w = (await web(page).locator('webview.on').boundingBox())!
    const r = await guest<{ x: number; y: number }>(page, `(() => { const t = document.getElementById('p2').firstChild; const g = document.createRange(); g.setStart(t, 0); g.setEnd(t, 1); const b = g.getBoundingClientRect(); return { x: b.right + 2, y: b.top + b.height / 2 } })()`)
    await page.mouse.click(w.x + r.x, w.y + r.y, { button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('剪进文档')
    await pickMenu(run, '剪进文档')
    // 用户点明了「剪进文档」：进中间开着的这篇光标处，不问
    await expect(dlg(page)).toHaveCount(0)
    await expect(toast(page)).toContainText('剪进《读书笔记》')
    await expect.poll(() => read(vault, NOTE)).toContain(`$${XIJ}$`)
    const md = read(vault, NOTE)
    expect(md).toMatch(/\n—— \[[^\]]+ · [^\]]+\]\(http:\/\/[^)]+#:~:text=[^)]+\)/)
  } finally {
    await run.close()
  }
})

test('右键图「剪成卡片」进收件箱（图存进卡片的附件、图注、来源回到那张图）；收件箱里剪的网页上也打 💬，点了打开那张卡片', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openWeb(page, `${base}/book`)

    // 图上右键：拷贝、存进附件……后面「剪成卡片」
    await guest(page, `document.getElementById('img').scrollIntoView({ block: 'center' })`)
    const w = (await web(page).locator('webview.on').boundingBox())!
    const b = await guest<{ x: number; y: number }>(page, `(() => { const r = document.getElementById('img').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
    await page.mouse.click(w.x + b.x, w.y + b.y, { button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('剪成卡片')
    await pickMenu(run, '剪成卡片')
    await expect(toast(page)).toContainText('图剪成卡片，放进收件箱了')
    await expect.poll(() => inboxFiles(vault).length).toBe(1)
    const name = inboxFiles(vault)[0]!
    const card = read(vault, `收件箱/${name}`)
    expect(card).toMatch(/^---\ncreated: .+\nsource: http:\/\/127\.0\.0\.1:\d+\/book/)
    expect(card).toContain(`![${CAP}](../附件/收件箱/`)
    expect(card).toMatch(/\.png\)\n\n—— \[图 ?1\.1 · [^\]]+\]\(http:\/\/127\.0\.0\.1:\d+\/book#:~:text=[^)]+\)/)
    const att = /\(\.\.\/(附件\/收件箱\/[^)]+)\)/.exec(card)![1]!
    expect(existsSync(join(vault, decodeURIComponent(att)))).toBe(true)

    // 选一段 ⌘S（没定、中间没文档）：进收件箱；网页上那段打 💬（以前收件箱里的不算）
    await clipPara(run, 'p2')
    await expect.poll(() => inboxFiles(vault).length).toBe(2)
    const marks = () => guest<number>(page, `(() => { const h = document.getElementById('cn-mark-host'); return h && h.shadowRoot ? h.shadowRoot.querySelectorAll('[data-ids]').length : 0 })()`)
    await expect.poll(marks, { timeout: 10_000 }).toBeGreaterThanOrEqual(2)
    // 点那段的 💬：中间打开那张卡片
    const cardOf = inboxFiles(vault).find((f) => f !== name)!
    await guest(page, `getSelection().removeAllRanges(); document.getElementById('p2').scrollIntoView({ block: 'center' })`)
    await page.waitForTimeout(400)
    const m = await guest<{ x: number; y: number } | null>(
      page,
      `(() => { const h = document.getElementById('cn-mark-host').shadowRoot; const p = document.getElementById('p2').getBoundingClientRect(); const bs = [...h.querySelectorAll('[data-ids]')].map((e) => e.getBoundingClientRect()).filter((r) => r.height && Math.abs(r.top + r.height / 2 - (p.top + p.height / 2)) < p.height); const r = bs[0]; return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null })()`,
    )
    expect(m, '那段旁边有 💬').not.toBeNull()
    await page.mouse.click(w.x + m!.x, w.y + m!.y)
    await expect(tabOn(page)).toHaveText(cardOf.replace(/\.md$/, ''))
  } finally {
    await run.close()
  }
})

test('AI 剪整页（web_clip whole=true）：抽正文成一篇，图存进附件，不再整页 innerText 当一段引文', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openWeb(page, `${base}/book`)
    await page.keyboard.press('Meta+j')
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('把这个网页整页剪进收件箱')
    await box.press('Enter')
    await expect(ai.getByTestId('ai-msg').last()).toContainText('剪好了', { timeout: 60_000 })
    await expect.poll(() => inboxFiles(vault).length, { timeout: 20_000 }).toBe(1)
    const name = inboxFiles(vault)[0]!
    expect(name).toBe('1.1 数据预处理.md')
    const md = read(vault, `收件箱/${name}`)
    // 整页文章的写法：标题、来源一行、正文分段（小标题还是小标题），图是附件里的相对路径
    expect(md).toMatch(/^---\ncreated: .+\nsource: http:\/\/127\.0\.0\.1:\d+\/book\n---\n# 1\.1 数据预处理 · 小书\n\n—— \[/)
    expect(md).toMatch(/^#{2,3} 1\.1\.1 读数据$/m)
    expect(md).toContain(P[0])
    expect(md).toMatch(/\]\(\.\.\/附件\/收件箱\/[^)]+\.png\)/)
    expect(md).not.toMatch(/^> /m)
  } finally {
    await run.close()
  }
})
