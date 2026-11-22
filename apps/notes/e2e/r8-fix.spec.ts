/**
 * 第 8 轮用户截图（0.4.4，task-j120y）查出来的几处，都是真点、真打字：
 * 1. 文档里的图：白板「ttravel」文档看法里卡片的 `![](../../附件/…png)`、收件箱剪藏里套着链接的网络图 `[![](https://…)](…)` 画成图；
 *    整页剪藏顺手把图存进附件、正文写相对路径；
 * 2. 白板用文档看法打开，不露 `<!-- card … -->`、`<!-- column … -->`，列名画成小节标题；
 * 3. 白板新建的列改名时按 ⌫ 只删字，列还在；
 * 4. 「未整理」里收件箱的剪藏卡：标题、来源、摘要各占各的地方，「收件箱」小字不压正文；
 * 5. 右栏网页「⋯」第一项「剪藏这一页」，点了整页进收件箱，底部提示带「打开」。
 * 网络图片用本机起的 http 服务，不连外网。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { acts, editorText, foldInbox, gitStatus, inboxPop, launch, openNote, pane, rail, tabOn, waitSaved } from './app'
import { solidPng } from './fixtures/png'
import { shotTone, shotWindow } from './shots'

let server: Server
let base: string
const NET_PNG = solidPng(250, 180, [70, 110, 150])

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/thumb/')) {
      res.setHeader('content-type', 'image/png')
      return res.end(NET_PNG)
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    // 像维基百科：图套着指向「File:」页的链接，src 是相对地址
    res.end(`<title>Geography of Iceland - Wikipedia</title><body style="font:16px sans-serif;padding:20px;max-width:640px">
      <article><h1>Geography of Iceland</h1>
      <p>Iceland is an island country at the confluence of the North Atlantic and Arctic oceans, east of Greenland and immediately south of the Arctic Circle.</p>
      <figure><a href="/wiki/File:Dettifoss.jpg"><img src="/thumb/250px-Dettifoss.png?utm_source=x" alt="" width="250" height="180"></a><figcaption>Dettifoss, located in northeast Iceland.</figcaption></figure>
      <h2>Statistics</h2>
      <p>${'Its total size is 103,125 km2 and it possesses an exclusive economic zone. '.repeat(12)}</p></article></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const PNG = solidPng(64, 48, [40, 90, 160])
const BOARD = `---
type: board
color: #A85A6E
---
# ttravel

<!-- card id=6ese9x in=jgroeq -->
Physical geography

<!-- column id=d87h1r x=384 y=60 w=300 title=地图与图片 -->

<!-- card id=dsh8ps in=d87h1r -->
![](../../附件/剪藏/冰岛旅行/ttravel/250px-Iceland_sat_cleaned.png)
—— [Iceland sat cleaned - Geography of Iceland - Wikipedia](https://en.wikipedia.org/wiki/Geography_of_Iceland#/media/File:Iceland_sat_cleaned.png)

<!-- card id=zlh0q1 in=d87h1r -->
![](../../附件/剪藏/冰岛旅行/ttravel/500px-Map_of_Iceland_highlands-en.svg.png)
—— [Geography of Iceland - Wikipedia](https://en.wikipedia.org/wiki/Geography_of_Iceland)
`
const clipDoc = () => `---
created: 2026-11-20 11:59
source: https://en.wikipedia.org/wiki/Geography_of_Iceland
---
# Geography of Iceland

—— [Geography of Iceland](https://en.wikipedia.org/wiki/Geography_of_Iceland) · Contributors to Wikimedia projects

Iceland is an island country at the confluence of the North Atlantic and Arctic oceans.

## Statistics

[![](${base}/thumb/250px-Iceland_Dettifoss_1972-4.png?utm_source=en.wikipedia.org&utm_campaign=parser)](https://en.wikipedia.org/wiki/File:Iceland_Dettifoss_1972-4.jpg)

Dettifoss, located in northeast Iceland.
`

const files = () => ({
  '剪藏/冰岛旅行/ttravel.md': BOARD,
  '附件/剪藏/冰岛旅行/ttravel/250px-Iceland_sat_cleaned.png': PNG,
  '附件/剪藏/冰岛旅行/ttravel/500px-Map_of_Iceland_highlands-en.svg.png': PNG,
  '收件箱/Geography of Iceland.md': clipDoc(),
})

const board = (page: Page) => pane(page).getByTestId('board')
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

/** 中间文档里画出来的图：几张、每张的 naturalWidth */
const shownImages = (page: Page) => pane(page).locator('.cm-content .cm-image img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).naturalWidth))

async function openBoard(page: Page, name: string) {
  await page
    .locator('.nav .si')
    .filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
    .first()
    .click()
  await expect(tabOn(page)).toHaveText(name)
  await expect(board(page)).toBeVisible()
}

test('以前写法的白板（撤回了转写法，记在旧写法名单里）文档看法：卡片里的相对路径图、收件箱剪藏里套着链接的网络图都画成图；不露 <!-- -->，列名是小节标题；打开再保存文件不变', async () => {
  const run = await launch({ ...files(), '.canvas-notes/白板旧写法.json': JSON.stringify({ 版本: 1, 白板: ['剪藏/冰岛旅行/ttravel.md'] }) }, {})
  const { page, vault } = run
  try {
    await shotTone(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, 'ttravel')
    // 两张库里的图都画出来，量 naturalWidth（图真的读到了）
    await expect.poll(() => shownImages(page)).toEqual([64, 64])
    const text = await pane(page).locator('.cm-content').innerText()
    expect(text).not.toContain('<!--')
    expect(text).not.toContain('![')
    expect(text).toContain('Physical geography')
    await expect(pane(page).locator('.cm-colhead')).toHaveText('地图与图片')
    const head = await pane(page).locator('.cm-colhead').evaluate((el) => getComputedStyle(el).fontWeight)
    expect(Number(head)).toBeGreaterThanOrEqual(600)
    // 来源行照旧是字
    await expect(pane(page).locator('.cm-content')).toContainText('Iceland sat cleaned - Geography of Iceland - Wikipedia')
    await shotWindow(run, 'r8-1-白板文档看法')

    // 光标点到列名上、按 ⌫ 和 Delete：注释一个字不少
    await pane(page).locator('.cm-colhead').click()
    for (const k of ['Backspace', 'Delete', 'Backspace']) await page.keyboard.press(k)
    expect(await editorText(page)).toBe(BOARD)
    // 列名上面那段末尾按 Delete 三下：最多并掉空行，列名那一行、卡片行一个字不少
    await pane(page).locator('.cm-line', { hasText: 'Physical geography' }).click()
    await page.keyboard.press('End')
    for (let i = 0; i < 3; i++) await page.keyboard.press('Delete')
    expect(await editorText(page)).toContain('<!-- column id=d87h1r x=384 y=60 w=300 title=地图与图片 -->\n\n<!-- card id=dsh8ps in=d87h1r -->\n![](')
    await expect(pane(page).locator('.cm-colhead')).toHaveText('地图与图片')
    await expect.poll(() => shownImages(page)).toEqual([64, 64])
    // 按过的键里有改了字的（图和来源并进一段的那种）：⌘Z 撤回到原样
    for (let i = 0; i < 6; i++) await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(BOARD)
    await page.waitForTimeout(1500)
    expect(readFileSync(join(vault, '剪藏/冰岛旅行/ttravel.md'), 'utf8')).toBe(BOARD)

    // 收件箱的剪藏：套着链接的网络图（本机 http 服务）画出来
    await openNote(page, 'Geography of Iceland')
    await expect.poll(() => shownImages(page)).toEqual([250])
    expect(await pane(page).locator('.cm-content').innerText()).not.toContain('![')
    await shotWindow(run, 'r8-1-剪藏网络图')
    // 打开、看过，文件一个字节都不变
    expect(readFileSync(join(vault, '收件箱/Geography of Iceland.md'), 'utf8')).toBe(clipDoc())
    expect(readFileSync(join(vault, '剪藏/冰岛旅行/ttravel.md'), 'utf8')).toBe(BOARD)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

/** 以前写法里最常见的样子：列那一行下面紧挨着卡片行（board.ts 写出来的就是这样），列名和第一张卡的注释算一整块 */
const TIGHT = `---
type: board
---
# 列紧挨卡

<!-- card id=a1 x=120 y=300 w=280 -->
上面一段字

<!-- column id=c1 x=500 y=80 w=280 title="要订的" -->
<!-- card id=a2 in=c1 -->
列里第一张卡

<!-- card id=a3 in=c1 -->
列里第二张卡
`

test('白板文档看法点列名再按各种删除键（⌫、Delete、⌥⌫、⌘⌫、⌥Delete、Ctrl+D）：文件一个字节都不变，上一段、空行、下面的卡一个字不少；列名选中着打字、粘贴、剪切也不改字', async () => {
  const run = await launch({ ...files(), '剪藏/冰岛旅行/列紧挨卡.md': TIGHT, '.canvas-notes/白板旧写法.json': JSON.stringify({ 版本: 1, 白板: ['剪藏/冰岛旅行/ttravel.md', '剪藏/冰岛旅行/列紧挨卡.md'] }) }, {})
  const { page, vault } = run
  const KEYS = ['Backspace', 'Delete', 'Alt+Backspace', 'Meta+Backspace', 'Alt+Delete', 'Control+d']
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const [name, md, rel, above, below] of [
      ['ttravel', BOARD, '剪藏/冰岛旅行/ttravel.md', 'Physical geography', 'Iceland sat cleaned - Geography of Iceland - Wikipedia'],
      ['列紧挨卡', TIGHT, '剪藏/冰岛旅行/列紧挨卡.md', '上面一段字', '列里第一张卡'],
    ] as const) {
      await openNote(page, name)
      const head = pane(page).locator('.cm-colhead')
      await expect(head).toHaveCount(1)
      const box = (await head.boundingBox())!
      for (const key of KEYS) {
        // 光标先放在上面那段末尾、下面那张卡里（点列名前光标在哪，点了以后都一样）；列名的左边、正中、右边各点一次
        for (const [from, fx] of [
          [above, 0.05],
          [below, 0.5],
          [above, 0.95],
        ] as const) {
          await pane(page).locator('.cm-line', { hasText: from }).first().click()
          await page.keyboard.press('End')
          await page.mouse.click(box.x + box.width * fx, box.y + box.height / 2)
          for (let i = 0; i < 3; i++) await page.keyboard.press(key)
          expect(await editorText(page), `${name}：点列名后按 ${key}（点之前光标在「${from}」）`).toBe(md)
        }
      }
      await expect(head).toBeVisible()
      await page.waitForTimeout(1200)
      expect(readFileSync(join(vault, rel), 'utf8')).toBe(md)
    }
    // 列名选中着打字、粘贴、剪切：列名只看不改，一个字都不进；第一张卡的字照旧在
    await head0(page).click()
    // 选中着铺一层 --fill2 底（比版心左右各宽 8），看得出点中了；点别处就没了
    await expect(head0(page)).toHaveClass(/\bpicked\b/)
    const pickedBg = await head0(page)
      .locator('.cm-colhead-t')
      .evaluate((e) => {
        const r = e.getBoundingClientRect()
        const p = e.parentElement!.getBoundingClientRect()
        return { bg: getComputedStyle(e).backgroundColor, radius: getComputedStyle(e).borderRadius, left: r.left - p.left, right: r.right - p.right }
      })
    expect(pickedBg.bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(pickedBg).toMatchObject({ radius: '6px', left: -8, right: 8 })
    await page.keyboard.type('新的一段', { delay: 20 })
    for (const k of ['Enter', 'Meta+x', 'Meta+v']) await page.keyboard.press(k)
    expect(await editorText(page)).toBe(TIGHT)
    await expect(head0(page)).toHaveText('要订的')
    // 点进下面那张卡打字照常（只拦列名选中着的那一下）；⌘Z 回到原样
    await pane(page).locator('.cm-line', { hasText: '列里第一张卡' }).click()
    await expect(head0(page)).not.toHaveClass(/\bpicked\b/)
    await page.keyboard.press('End')
    await page.keyboard.type('X')
    expect(await editorText(page)).toBe(TIGHT.replace('列里第一张卡', '列里第一张卡X'))
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(TIGHT)
    await page.waitForTimeout(1200)
    expect(readFileSync(join(vault, '剪藏/冰岛旅行/列紧挨卡.md'), 'utf8')).toBe(TIGHT)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
const head0 = (page: Page) => pane(page).locator('.cm-colhead')

test('以前写法的白板改列名：输入框里按 ⌫ / Delete 只删字，列和卡片都在；卡片、待办改字时 ⌫ 也不删卡', async () => {
  const run = await launch({ ...files(), '.canvas-notes/白板旧写法.json': JSON.stringify({ 版本: 1, 白板: ['剪藏/冰岛旅行/ttravel.md'] }) })
  const { page, vault } = run
  const md = () => readFileSync(join(vault, '剪藏/冰岛旅行/ttravel.md'), 'utf8')
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openBoard(page, 'ttravel')
    await foldInbox(page)
    const cols = board(page).locator('.bcol')
    await expect(cols).toHaveCount(1)
    // 工具板「列」点一下：新的列放在空处、选中
    await board(page).locator('.bpal').getByRole('button', { name: '列' }).click()
    await expect(cols).toHaveCount(2)
    const fresh = cols.filter({ hasText: '新的列' })
    await fresh.locator('h3').dblclick()
    const input = board(page).getByRole('textbox', { name: '列名' })
    await expect(input).toBeFocused()
    // 全选着「新的列」按 ⌫：只把字删了，列还在
    await page.keyboard.press('Backspace')
    await expect(input).toHaveValue('')
    await expect(cols).toHaveCount(2)
    await page.keyboard.type('地图', { delay: 30 })
    await page.keyboard.press('Backspace')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Delete')
    await expect(input).toHaveValue('')
    await expect(cols).toHaveCount(2)
    await page.keyboard.type('交通', { delay: 30 })
    await page.keyboard.press('Enter')
    await expect(cols.filter({ hasText: '交通' })).toHaveCount(1)
    await waitSaved(page)
    expect(md()).toMatch(/<!-- column id=\w+ x=\d+ y=\d+ w=300 title=交通 -->/)
    // 选中那一列、焦点不在输入框时 ⌫ 照旧删列（白板的快捷键还在）
    await cols.filter({ hasText: '交通' }).locator('h3').click()
    await page.keyboard.press('Backspace')
    await expect(cols).toHaveCount(1)
    await waitSaved(page)
    expect(md()).not.toContain('title=交通')

    // 卡片改字、待办标题：⌫ 删字，卡片都在
    const cards = board(page).locator('.bcard')
    const n = await cards.count()
    await board(page).locator('.bpal').getByRole('button', { name: '卡片' }).click()
    await expect(cards).toHaveCount(n + 1)
    await page.keyboard.type('abc', { delay: 30 })
    for (let i = 0; i < 2; i++) await page.keyboard.press('Backspace')
    await expect(cards).toHaveCount(n + 1)
    await expect(board(page).locator('.card-edit')).toContainText('a')
    await board(page).locator('.bpal').getByRole('button', { name: '待办' }).click()
    await expect(cards).toHaveCount(n + 2)
    const todo = board(page).getByRole('textbox', { name: '待办标题' })
    await todo.click()
    await page.keyboard.type('xy', { delay: 30 })
    for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace')
    await expect(todo).toHaveValue('')
    await expect(cards).toHaveCount(n + 2)
  } finally {
    await run.close()
  }
})

test('白板收件箱弹窗里的剪藏：干净的卡（标题、两行摘要、来源），三块上下排开不压字', async () => {
  const run = await launch(files())
  const { page } = run
  try {
    await shotTone(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    // 先开一次设置（设置页的样式表载进来过，以前它的 .mini 把这张卡压成 72 高）
    await page.keyboard.press('Meta+,')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await page.locator('.nav .si', { hasText: /^ttravel/ }).first().click()
    const drawer = await inboxPop(page)
    const card = drawer.getByRole('listitem').filter({ hasText: 'Geography of Iceland' })
    await expect(card).toHaveCount(1)
    await expect(card.locator('.dbr-ttl')).toHaveText('Geography of Iceland')
    await expect(card.locator('.dbr-src')).toContainText('en.wikipedia.org')
    await expect(card.locator('.dbr-sum')).toContainText('Iceland is an island country')
    for (const raw of ['](', '![', '——', '<!--']) await expect(card).not.toContainText(raw)
    // 量：三块上下排开、互不重叠、都在卡里
    const box = async (sel: string) => (await card.locator(sel).boundingBox())!
    const c = (await card.boundingBox())!
    const t = await box('.dbr-ttl')
    const s = await box('.dbr-sum')
    const src = await box('.dbr-src')
    expect(t.y + t.height).toBeLessThanOrEqual(s.y + 0.5)
    expect(s.y + s.height).toBeLessThanOrEqual(src.y + 0.5)
    expect(src.y + src.height).toBeLessThanOrEqual(c.y + c.height + 0.5)
    // 摘要最多三行
    const lines = await card.locator('.dbr-sum').evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)))
    expect(lines).toBeLessThanOrEqual(2)
    await shotWindow(run, 'r8-4-未整理卡')
  } finally {
    await run.close()
  }
})

test('网页「⋯」第一项「剪藏这一页」：整页进收件箱，图存进附件、正文写相对路径；底部提示带「打开」，打开后图画得出来', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  try {
    await shotTone(page)
    await page.setViewportSize({ width: 1440, height: 900 })
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/wiki/Geography_of_Iceland`)
    await addr.press('Enter')
    await expect(web(page).locator('webview.on')).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<string> }).executeJavaScript('document.readyState')))
      .toBe('complete')
    // 地址栏旁的引号按钮和菜单项同一个名字
    await expect(web(page).getByRole('button', { name: '剪藏这一页', exact: true })).toBeVisible()
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    const menu = web(page).getByRole('menu', { name: '更多', exact: true })
    const first = menu.getByRole('menuitem').first()
    await expect(first).toHaveText('剪藏这一页')
    await shotWindow(run, 'r8-5-网页菜单')
    await first.click()
    await expect(menu).toHaveCount(0)
    const note = web(page).locator('.wnote')
    await expect(note).toContainText('整页存进收件箱了：Geography of Iceland')
    await expect(note.getByRole('button', { name: '打开' })).toBeVisible()
    expect(readdirSync(join(vault, '收件箱'))).toEqual(['Geography of Iceland.md'])
    const md = readFileSync(join(vault, '收件箱', 'Geography of Iceland.md'), 'utf8')
    // 图存进这篇的附件文件夹，正文是相对路径（不套链接）
    // 图注写成图的说明（显示在图下面一行小字），不再是图下面一段正文
    expect(md).toContain('![Dettifoss, located in northeast Iceland.](../附件/收件箱/Geography%20of%20Iceland/250px-Dettifoss.png)')
    expect(md.match(/Dettifoss, located/g)).toHaveLength(1)
    expect(md).not.toContain('](/wiki/File:')
    expect(md).not.toContain(`${base}/thumb`)
    expect(existsSync(join(vault, '附件/收件箱/Geography of Iceland/250px-Dettifoss.png'))).toBe(true)
    const log = execFileSync('git', ['-C', vault, 'log', '--format=%s', '--name-only', '-1'], { encoding: 'utf8' })
    expect(log).toContain('剪藏整页：Geography of Iceland')
    expect(log).toContain('附件/收件箱/Geography of Iceland/250px-Dettifoss.png')
    expect(gitStatus(vault)).toBe('')
    await note.getByRole('button', { name: '打开' }).click()
    await expect(tabOn(page)).toHaveText('Geography of Iceland')
    if ((await acts(page).getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) === 'true') await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect.poll(() => shownImages(page)).toEqual([250])
    await expect(pane(page).locator('.cm-image-cap')).toHaveText('Dettifoss, located in northeast Iceland.')

    // ⌘K「剪藏这一页」：同一个名字、同一套（网页面板底部提示带「打开」），收件箱多一篇
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('剪藏这一页')
    await pal.getByRole('option').filter({ has: page.locator('.nm', { hasText: /^剪藏这一页$/ }) }).click()
    await expect(note).toContainText('整页存进收件箱了：Geography of Iceland 2')
    await expect(note.getByRole('button', { name: '打开' })).toBeVisible()
    expect(readdirSync(join(vault, '收件箱')).sort()).toEqual(['Geography of Iceland 2.md', 'Geography of Iceland.md'])
  } finally {
    await run.close()
  }
})

/** 设置那一页里几样东西的左边、宽、右边（屏幕像素，取整） */
const rects = (page: Page, sel: string) =>
  page
    .locator('.set[aria-label="设置"]')
    .locator(sel)
    .evaluateAll((els) => els.map((e) => ({ l: Math.round(e.getBoundingClientRect().left), w: Math.round(e.getBoundingClientRect().width), r: Math.round(e.getBoundingClientRect().right) })))

for (const look of [
  { tag: 'A-浅', frame: 'a', skin: 'sky' },
  { tag: 'A-深', frame: 'a', skin: 'petrol' },
  { tag: 'B-浅', frame: 'b', skin: 'sky' },
  { tag: 'B-深', frame: 'b', skin: 'petrol' },
]) {
  test(`设置 › AI「各功能用哪个」五个下拉一样宽、左右对齐；Git 页标签后面的框起点对齐（${look.tag}）`, async () => {
    const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' }, (v) => {
      const ud = join(dirname(v), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, frame: look.frame, skin: look.skin } }))
    })
    const { page } = run
    try {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.keyboard.press('Meta+,')
      // A 风格设置开成标签（region），B 风格是对话框
      const dlg = page.locator('.set[aria-label="设置"]')
      await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
      // 设置方向 A：「各功能用哪个」一张细线表五行（data-row fChat…fQuick），右边一列放下拉
      const featureRows = dlg.locator('[role="group"][aria-label="各功能用哪个"] .sa-row')
      await expect(featureRows).toHaveCount(5)
      // task-m55m7：右边一列是选择器的框（先选家、再选模型、再选想多久，一个框三段），五个框一样宽、对齐
      const drops = await rects(page, '[role="group"][aria-label="各功能用哪个"] .sa-row .aipk')
      expect(drops).toHaveLength(5)
      for (const d of drops) expect(d, JSON.stringify(drops)).toEqual(drops[0])
      // 附加的说明（只有它能看图、排顺序）还在，挪到说明那一行，不挤下拉
      await expect(dlg.locator('[data-row="fVision"]')).toContainText('只有Claude Code能看图')
      await expect(dlg.locator('[data-row="fTrans"]').getByRole('button', { name: '排顺序' })).toBeVisible()
      const rows = await rects(page, '[role="group"][aria-label="各功能用哪个"] .sa-row')
      // 下拉靠右，离行的右沿一样远
      expect(new Set(drops.map((d, i) => rows[i]!.r - d.r)).size).toBe(1)
      await shotWindow(run, `r8-6-设置AI-${look.tag}`)

      // Git 页（设置方向 A）：每张表右边那一列的下拉一样宽、左右都对齐，开关贴着同一条右边
      await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'Git和同步', exact: true }).click()
      const ctl = await rects(page, '.sa-row .sa-cc > select.sa-sel')
      expect(ctl.length, JSON.stringify(ctl)).toBeGreaterThanOrEqual(3)
      for (const c of ctl) expect({ l: c.l, r: c.r }, JSON.stringify(ctl)).toEqual({ l: ctl[0]!.l, r: ctl[0]!.r })
      const sw = await rects(page, '.sa-row .sa-cc > [role="switch"]')
      for (const c of sw) expect(c.r, JSON.stringify(sw)).toBe(ctl[0]!.r)
      await shotWindow(run, `r8-6-设置Git-${look.tag}`)

      // 梦游页：靠右的下拉一样宽、左右都对齐（「没人动多久算闲」「两次之间至少隔」一组，每步「一晚最多」一组）
      await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '梦游', exact: true }).click()
      for (const sel of ['.dset-list .row select', '.dset-step select']) {
        const ss = await rects(page, sel)
        expect(ss.length, sel).toBeGreaterThanOrEqual(2)
        for (const x of ss) expect(x, `${sel} ${JSON.stringify(ss)}`).toEqual(ss[0])
      }
      await shotWindow(run, `r8-6-设置梦游-${look.tag}`)
    } finally {
      await run.close()
    }
  })
}
