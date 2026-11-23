/**
 * 文档编辑器（G2，录屏 86 条里的编辑器那组）：插入后光标和焦点、不露 md 原文、块部件不用外边距、窄栏换行、
 * 「刚插进来」的竖线。都在测试模式里真点、真拖、真按键。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { acts, editorText, launch, openNote, pane, rail, shownText, waitSaved, widenRight } from './app'
import { EDITOR_FILES } from './fixtures/editor-doc'
import { solidPng } from './fixtures/png'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { fragmentUrl, sourceLabel } from '../src/shared/web-link'
import { webAskBlock } from '../src/shared/web-notes'
import { setViewFilter, setViewSort } from '@cn/format'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<title>雷克雅未克 - 维基百科</title><body style="font:16px sans-serif;padding:20px">
      <p id="p1">Seek wealth, not money or status.</p></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

/** 光标（选区的焦点）所在那一行看得到的字 */
const caretLine = (page: Page) =>
  page.evaluate(() => {
    const n = document.getSelection()?.focusNode
    const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null
    return el?.closest('.cm-line')?.textContent ?? ''
  })

const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()

test('CN-64 上面有视频卡、时刻块、问答块时，点哪一行光标就落在哪一行', async () => {
  const run = await launch(EDITOR_FILES)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '未命名 3')
    await expect(pane(page).locator('[data-part="问答块"]')).toBeVisible()
    await line(page, 'ToT 用').scrollIntoViewIfNeeded()
    for (const t of ['IO：', 'CoT：', 'CoT-SC', 'ToT：', 'ToT 用']) {
      const b = (await line(page, t).boundingBox())!
      await page.mouse.click(b.x + 120, b.y + b.height / 2)
      await expect.poll(() => caretLine(page)).toContain(t)
    }
    // 块部件不用上下外边距（CodeMirror 量块高不算外边距）
    const margins = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pane:not([hidden]) .cm-content > *'))
        .filter((e) => !e.classList.contains('cm-line'))
        .map((e) => getComputedStyle(e).marginTop + '/' + getComputedStyle(e).marginBottom),
    )
    expect(margins.length).toBeGreaterThanOrEqual(3)
    expect(new Set(margins)).toEqual(new Set(['0px/0px']))
  } finally {
    await run.close()
  }
})

test('CN-65 / CN-68 拖选三行列表：拖的时候和松开后圆点不变成「- 」，行不变高，下面不跳', async () => {
  const run = await launch(EDITOR_FILES)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '未命名 3')
    const last = line(page, '问的是「给我讲解一下」')
    await last.scrollIntoViewIfNeeded()
    // 量相对正文顶上的位置：拖到靠下时外面的栏会跟着滚（时刻块截图 170×96 以后整篇高了一点），滚动不算「跳」
    const top = async () => (await pane(page).locator('.cm-content').boundingBox())!.y
    const rel = async () => (await last.boundingBox())!.y - (await top())
    const y0 = await rel()
    const a = (await line(page, 'IO：').boundingBox())!
    const c = (await line(page, 'CoT-SC').boundingBox())!
    await page.mouse.move(a.x + 60, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 160, a.y + a.height / 2, { steps: 5 })
    await page.mouse.move(c.x + 200, c.y + c.height / 2, { steps: 8 })
    const listText = () => pane(page).locator('.cm-line.cm-li').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
    for (const t of await listText()) expect(t.startsWith('- ')).toBe(false)
    expect(await rel()).toBe(y0)
    await page.mouse.up()
    expect(await page.evaluate(() => document.getSelection()?.toString() ?? '')).toContain('CoT：中间加入')
    for (const t of await listText()) expect(t.startsWith('- ')).toBe(false)
    expect(await pane(page).locator('.cm-bullet').count()).toBe(5)
    expect(await rel()).toBe(y0)
    // 光标停在一处加粗、链接上（没有选区）才露那一处的记号
    await line(page, 'CoT-SC').click()
    expect(await pane(page).locator('.cm-bullet').count()).toBe(5)
  } finally {
    await run.close()
  }
})

test('CN-86 光标从下面走进问答块也一直是卡片：↑ 跨过整块；块下面行首退格先选中，再按才删', async () => {
  const run = await launch(EDITOR_FILES)
  const { page, app, vault } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '未命名 3')
    const ask = pane(page).locator('[data-part="问答块"]')
    const para = line(page, '这一帧在讲快餐品牌的两难')
    await para.click({ position: { x: 2, y: 6 } })
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(ask).toBeVisible()
    const shown = await shownText(page)
    expect(shown).not.toContain('<!-- moment')
    expect(shown).not.toContain('附件/')
    await page.keyboard.press('ArrowUp')
    await expect(ask).toBeVisible()
    expect(await shownText(page)).not.toContain('<!-- moment')
    // 再往上就到了时刻块上面：光标不会停在块的原文里
    expect(await caretLine(page)).not.toContain('我的疑惑')

    // 块下面那一段段首按退格：先选中这一块，文字不变；再按一次才删（task-ys1rr 起块和块之间的空行不停光标，「块下面」就是下面那一段的段首）
    await para.click({ position: { x: 2, y: 6 } })
    await page.keyboard.press('Backspace')
    await expect(pane(page).locator('.cm-blk-selbg')).toHaveCount(1)
    await expect(ask).toBeVisible()
    // 选中底不比正文宽：正文不会被横着滚走一截
    expect(await pane(page).locator('.cm-scroller').evaluate((e) => [e.scrollLeft, e.scrollWidth - e.clientWidth])).toEqual([0, 0])
    await page.keyboard.press('Backspace')
    await expect(ask).toHaveCount(0)
    // 块菜单「改写法」（方向 A 块上露写法）：只在这一块露出它的原文，esc 收回、「完成」写回
    const card = pane(page).locator('[data-part="时刻块"]')
    await expect(async () => {
      const box = (await card.boundingBox())!
      await page.mouse.move(box.x + 40, box.y + 20)
      await page.mouse.move(box.x + 60, box.y + 24)
      await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click({ timeout: 1000 })
      await expect(page.getByRole('menu', { name: '块菜单' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
    const bmenu = page.getByRole('menu', { name: '块菜单' })
    await expect(bmenu.getByRole('menuitem')).toHaveText(['改写法', '上移⌥⇧↑', '下移⌥⇧↓', '复制一块⌘D', '问 AI 这一块', '删除⌫'])
    await bmenu.getByRole('menuitem', { name: '改写法' }).click()
    const raw = pane(page).getByRole('textbox', { name: '这一块的写法' })
    await expect(raw).toBeFocused()
    expect(await raw.inputValue()).toContain('<!-- moment video=youtube:7CVYBBX_zxA t=1.1 -->')
    await expect(pane(page).locator('[data-part="时刻块"]')).toHaveCount(0)
    // 改一个字点「完成」：写回这一块
    await raw.fill((await raw.inputValue()).replace('t=1.1 -->', 't=1.2 -->'))
    await pane(page).getByRole('button', { name: '完成' }).click()
    await expect(card).toBeVisible()
    await waitSaved(page)
    const md = readFileSync(join(vault, '未命名 3.md'), 'utf8')
    expect(md).not.toContain('moment-ask')
    expect(md).toContain('<!-- moment video=youtube:7CVYBBX_zxA t=1.2 -->')
  } finally {
    await run.close()
  }
})

test('CN-72 / CN-73 / CN-83 窗口 700 宽、开着左栏：正文和卡片跟着中间栏收，没有横向滚动条', async () => {
  const run = await launch(EDITOR_FILES)
  const { page, app } = run
  try {
    await openNote(page, '未命名 3')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(700, 800))
    await page.waitForTimeout(500)
    const m = await page.evaluate(() => {
      const sc = document.querySelector('.pane:not([hidden]) .cm-scroller') as HTMLElement
      const r = sc.getBoundingClientRect()
      const over = Array.from(sc.querySelectorAll('.cm-line, .cm-vmoment, .cm-vcard, .cm-image')).filter((e) => e.getBoundingClientRect().right > r.right + 0.5).length
      return { sw: sc.scrollWidth, cw: sc.clientWidth, over }
    })
    expect(m.sw).toBe(m.cw)
    expect(m.over).toBe(0)
    await page.screenshot({ path: 'test-results/g2-72-narrow.png' })
  } finally {
    await run.close()
  }
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('webview') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function guestRect(page: Page, code: string) {
  const w = (await web(page).locator('webview').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(${code}.getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

// task-6cxtc 起小条第一颗是「讲解一下」，剪藏是「剪藏 ⌘S」（button.clip）；这个网站还没和哪篇配对，第一次剪先问「记到哪篇」，
// 点「记到这篇」顺手给这篇写上 read-along 配成一对，然后才剪进光标处；来源一行是「小标题 · 书名」+ 回到这一段的链接
test('CN-13 / CN-17 / CN-58 剪进文档：只有左边一道竖线、没有框；不点文档直接回车打字；出处行是链接不露网址', async () => {
  const run = await launch({ '所思所想.md': '# 所思所想\n\n财富是靠专长、杠杆。\n\n最后一段。\n' })
  const { page, vault } = run
  const label = sourceLabel({ title: '雷克雅未克 - 维基百科', url: `${base}/wiki` })
  try {
    await openNote(page, '所思所想')
    await line(page, '财富是靠专长').click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/wiki`)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
    const p = await guestRect(page, `document.getElementById('p1')`)
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(p.x, p.y, { clickCount: 3 })
      if (await expect.poll(() => guest(page, 'getSelection().toString().length'), { timeout: 1000 }).toBeGreaterThan(0).then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
    // 焦点在网页上：文档里的插入点是一条半透明、不闪的强调色竖线，标出剪进来落在哪
    const ip = pane(page).locator('.cm-insertpoint')
    await expect(ip).toBeVisible()
    expect(await ip.evaluate((e) => getComputedStyle(e).opacity)).toBe('0.45')
    const b = await guestRect(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('button.clip')`)
    await page.mouse.click(b.x, b.y)
    const dlg = page.getByRole('dialog', { name: '记到哪篇' })
    await expect(dlg).toBeVisible()
    await expect(dlg.getByRole('radio').nth(0)).toBeChecked()
    await expect(dlg.getByRole('radio').nth(0)).toHaveAccessibleName(/所思所想/)
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.locator('.toast-cn')).toContainText('剪进《所思所想》光标处')
    // 0.3 秒内：只有一道竖线，没有任何外圈
    await expect(pane(page).locator('.cm-flashbar:not([hidden])')).toHaveCount(1)
    const rings = await pane(page).evaluate((el) => Array.from(el.querySelectorAll('.cm-content, .cm-content *')).filter((e) => /0px 0px 0px 2px/.test(getComputedStyle(e).boxShadow)).length)
    expect(rings).toBe(0)
    const bar = (await pane(page).locator('.cm-flashbar').boundingBox())!
    const q = (await line(page, 'Seek wealth').boundingBox())!
    const src = (await line(page, label).boundingBox())!
    expect(bar.width).toBe(2)
    expect(bar.x).toBeLessThan(q.x)
    expect(Math.abs(bar.y - q.y)).toBeLessThan(4)
    expect(Math.abs(bar.y + bar.height - (src.y + src.height))).toBeLessThan(4)
    await page.screenshot({ path: 'test-results/g2-13-flashbar.png' })
    // 出处行：链接，不露 ]( 和百分号网址
    const srcText = (await line(page, label).textContent())!
    expect(srcText).not.toContain('](')
    expect(srcText).not.toContain('%')
    // 2.5 秒后竖线没了
    await expect(pane(page).locator('.cm-flashbar:not([hidden])')).toHaveCount(0, { timeout: 2500 })
    // 不点文档，直接回车、打字：落在文档里，网页里没打进字
    await page.keyboard.press('Enter')
    await page.keyboard.type('x')
    await waitSaved(page)
    const md = readFileSync(join(vault, '所思所想.md'), 'utf8')
    const quote = 'Seek wealth, not money or status.'
    const srcMd = `[${label}](${fragmentUrl(`${base}/wiki`, quote)})`
    expect(md).toBe(`---\nread-along: ${base}/\n---\n# 所思所想\n\n财富是靠专长、杠杆。\n\n> ${quote}\n—— ${srcMd}\n\n\nx\n\n最后一段。\n`)
    expect(await guest(page, `document.body.innerText.includes('x\\n') || document.activeElement?.tagName`)).not.toBe(true)
    // 光标走到链接文字上：后面什么都不露（cmdk 方案 A：CN-58 的域名小块拿掉了，网址在指着出的链接卡上）
    await line(page, label).click({ position: { x: 60, y: 8 } })
    await expect(pane(page).locator('.cm-urlchip')).toHaveCount(0)
    expect(await line(page, label).textContent()).not.toContain('127.0.0.1')
    expect(await editorText(page)).toBe(md)
  } finally {
    await run.close()
  }
})

test('CN-59 / CN-25 提示块画成带图标的块、折叠块画成一行能点开，看不到 [!question] 和 HTML 标签；[!ai] 能收起；打开再保存文件不变', async () => {
  const ai = '\n> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 3 页\n> AI 的第一句讲解。\n> 每个格子单独算。\n'
  const run = await launch({ ...EDITOR_FILES, '未命名 3.md': EDITOR_FILES['未命名 3.md'] + ai })
  const { page, vault } = run
  try {
    await openNote(page, '未命名 3')
    await pane(page).locator('.body:has(.cm-editor)').evaluate((e) => (e.scrollTop = e.scrollHeight))
    await expect(line(page, '最后一段')).toBeVisible()
    const shown = await shownText(page)
    for (const raw of ['!question', '!success', '[!ai]', '<details', '</summary', '</details']) expect(shown).not.toContain(raw)
    await expect(pane(page).locator('.cm-callout-head')).toHaveCount(3)
    await expect(pane(page).locator('.cm-callout-question .cm-callout-icon svg')).toHaveCount(1)
    // 折叠块：默认收着，点开看到旧讲法，可以照常编辑；再点收起
    const fold = pane(page).locator('.cm-fold-head')
    await expect(fold).toHaveText('没讲通 · 第 1 版：用 CPU 和 GPU 跑矩阵乘法')
    await expect(line(page, '旧讲法')).toHaveCount(0)
    await fold.click()
    await expect(line(page, '旧讲法')).toBeVisible()
    await expect(line(page, '旧讲法')).toHaveClass(/cm-fold-body/)
    // 展开的标题行不比正文宽：没有横向滚动
    expect(await pane(page).locator('.cm-scroller').evaluate((e) => e.scrollWidth - e.clientWidth)).toBe(0)
    await page.screenshot({ path: 'test-results/g2-59-callout.png' })
    // 展开着时标题字能就地改，收起点标题前的 chevron
    await pane(page).locator('.cm-fold-chev').click()
    await expect(line(page, '旧讲法')).toHaveCount(0)
    // [!ai]：右端收起，正文藏起来；再点展开
    await expect(line(page, 'AI 的第一句讲解')).toBeVisible()
    await pane(page).locator('.cm-callout-ai .cm-callout-fold').click()
    await expect(line(page, 'AI 的第一句讲解')).toHaveCount(0)
    await pane(page).locator('.cm-callout-ai .cm-callout-fold').click()
    await expect(line(page, 'AI 的第一句讲解')).toBeVisible()
    await page.waitForTimeout(1200)
    expect(readFileSync(join(vault, '未命名 3.md'), 'utf8')).toBe(EDITOR_FILES['未命名 3.md'] + ai)
  } finally {
    await run.close()
  }
})

test('task-6cxtc 复审 7（和 task-83vl3 合成一套，md-widgets.ts calloutWidgets）：提示块（[!ai]）里的围栏代码和表格照块外的画：看不到 ``` 和 |---、行首「> 」；代码是等宽的一块，表格画成表格；点进代码那一行光标在代码里、露原文，点表格露原文，点出去又画回去；打开再保存文件不变', async () => {
  const ai = [
    '',
    '> [!ai] 讲解一下 · Claude Code · Opus 5.5 · [2.2.1 读取数据集 ↩](http://127.0.0.1:9/pandas.html#:~:text=a)',
    '> 先看代码：',
    '>',
    '> ```python',
    '> import pandas as pd',
    '> data = pd.read_csv(data_file)',
    '> ```',
    '>',
    '> | NumRooms | Alley | Price |',
    '> |----|----|----|',
    '> | NA | Pave | 127500 |',
    '> | 2 | NA | 106000 |',
    '>',
    '> 读回来就是这张表。',
    '',
    '块外的一段。',
    '',
  ].join('\n')
  const md = EDITOR_FILES['未命名 3.md'] + ai
  const run = await launch({ ...EDITOR_FILES, '未命名 3.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '未命名 3')
    await pane(page).locator('.body:has(.cm-editor)').evaluate((e) => (e.scrollTop = e.scrollHeight))
    await expect(line(page, '读回来就是这张表')).toBeVisible()
    await line(page, '块外的一段').click()
    await page.screenshot({ path: 'test-results/g2-callout-code-table.png' })
    const shown = await shownText(page)
    for (const raw of ['```', '|---', '|----|', '| NumRooms', '> import']) expect(shown).not.toContain(raw)
    // 代码：两行画成等宽的一块（--card 底），行首没有「>」
    const code = pane(page).locator('.cm-inquote-code')
    await expect(code).toHaveCount(1)
    expect(await code.evaluate((e) => (e as HTMLElement).innerText.trim())).toBe('import pandas as pd\ndata = pd.read_csv(data_file)')
    expect(await code.evaluate((e) => getComputedStyle(e).fontFamily)).toMatch(/mono|Menlo|SF Mono|monospace/i)
    // 块里有表格（块部件把看得见的范围隔成两段）时块头也只画一遍：名字一层、整个露着（以前套两层被截成「讲…」）
    const head = pane(page).locator('.cm-callout-ai.cm-callout-head')
    await expect(head.locator('.cm-callout-name')).toHaveCount(1)
    expect(await head.locator('.cm-callout-name').evaluate((e) => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().width > 40)).toBe(true)
    // 表格：3 个表头、6 个格子
    const table = pane(page).locator('.cm-inquote .cm-table')
    await expect(table).toHaveCount(1)
    await expect(table.locator('th')).toHaveText(['NumRooms', 'Alley', 'Price'])
    await expect(table.locator('td')).toHaveText(['NA', 'Pave', '127500', '2', 'NA', '106000'])
    // 点进代码第一行：光标放进那一行原文、这一块露出原文能改；点出去又画回去
    await code.click({ position: { x: 40, y: 18 } })
    await expect.poll(() => caretLine(page)).toContain('import pandas as pd')
    await expect(code).toHaveCount(0)
    await line(page, '块外的一段').click()
    await expect(code).toHaveCount(1)
    // 点表格：露出原文，光标在表格里；点出去又是表格
    await table.locator('td', { hasText: 'Pave' }).click()
    await expect(line(page, '| NA | Pave | 127500 |')).toBeVisible()
    await expect(table).toHaveCount(0)
    await line(page, '块外的一段').click()
    await expect(pane(page).locator('.cm-inquote .cm-table td')).toHaveCount(6)
    await page.screenshot({ path: 'test-results/g2-callout-code-table-after.png' })
    await page.waitForTimeout(1200)
    expect(readFileSync(join(vault, '未命名 3.md'), 'utf8')).toBe(md)
  } finally {
    await run.close()
  }
})

test('CN-38 引文下面写了「我的评价」才连上一道弯钩和小标签；没写评价什么都不显示', async () => {
  const doc = '# 读书\n\n> 夫天地者，万物之逆旅。\n—— [《春夜宴桃李园序》 · 第一段](https://example.com/a)\n\n我的评价：时间是过客。\n\n> 只是一段引用。\n—— [出处](https://example.com/b)\n\n下一段。\n'
  const run = await launch({ '读书.md': doc })
  const { page } = run
  try {
    await openNote(page, '读书')
    await expect(pane(page).locator('.cm-review')).toHaveCount(1)
    // 小标签只写「我的评价」，文件里的冒号藏起来（CN-121 方向 A 小样）
    await expect(pane(page).locator('.cm-review-tag')).toHaveText('我的评价')
    await expect(pane(page).locator('.cm-review-gap')).toHaveCount(1)
    const shown = await shownText(page)
    expect(shown).not.toMatch(/写点想法|写评价/)
    await page.screenshot({ path: 'test-results/g2-38-review.png' })
  } finally {
    await run.close()
  }
})

test('CN-66 / CN-67 拖选只涂选中的字（强调色 24%），什么都不弹；⇧⌘M 和右键「高亮」写成 ==文字==、再按取消；⌘J 带着这段打开 AI 不自动发', async () => {
  const doc = '# 读书\n\n夫天地者，万物之逆旅；光阴者，百代之过客。\n\n第二段。\n'
  const run = await launch({ '读书.md': doc }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '读书.md'), 'utf8')
  try {
    await armMenus(run)
    await openNote(page, '读书')
    const l = line(page, '夫天地者')
    const b = (await l.boundingBox())!
    const before = await page.evaluate(() => document.querySelectorAll('[role=dialog], [role=tooltip], .ed-pop:not([hidden])').length)
    // 从「万」拖到「旅」
    const range = await l.evaluate((el) => {
      const t = el.firstChild as Text
      const r = document.createRange()
      const s = t.data.indexOf('万')
      r.setStart(t, s)
      r.setEnd(t, s + 1)
      const a = r.getBoundingClientRect()
      r.setStart(t, s + 4)
      r.setEnd(t, s + 5)
      const z = r.getBoundingClientRect()
      return { x0: a.left + 2, x1: z.right - 1, y: a.top + a.height / 2 }
    })
    await page.mouse.move(range.x0, range.y)
    await page.mouse.down()
    await page.mouse.move(range.x1, range.y, { steps: 6 })
    await page.mouse.up()
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe('万物之逆旅')
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => document.querySelectorAll('[role=dialog], [role=tooltip], .ed-pop:not([hidden])').length)).toBe(before)
    // 系统选区，不铺到行尾：没有 CodeMirror 的整行选区层；颜色是强调色 24%
    expect(await pane(page).locator('.cm-selectionLayer .cm-selectionBackground').count()).toBe(0)
    const selBg = await l.evaluate((el) => getComputedStyle(el, '::selection').backgroundColor)
    const acc = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim())
    expect(selBg).toMatch(/0\.24\)$/)
    await page.screenshot({ path: 'test-results/g2-66-select.png', clip: { x: b.x - 60, y: b.y - 40, width: 760, height: 140 } })
    expect(acc).not.toBe('')

    // ⇧⌘M 高亮，再按取消
    await page.keyboard.press('Meta+Shift+M')
    await expect.poll(file).toContain('==万物之逆旅==')
    await expect(pane(page).locator('.cm-hl')).toHaveText('万物之逆旅')
    await page.screenshot({ path: 'test-results/g2-67-highlight.png', clip: { x: b.x - 60, y: b.y - 40, width: 760, height: 140 } })
    await page.keyboard.press('Meta+Shift+M')
    await expect.poll(file).toBe(doc)

    // 右键：「高亮」带快捷键、「问 AI 这段 ⌘J」「翻译这段」
    await page.mouse.move(range.x0, range.y)
    await page.mouse.down()
    await page.mouse.move(range.x1, range.y, { steps: 6 })
    await page.mouse.up()
    await l.click({ button: 'right', position: { x: range.x0 - b.x + 10, y: range.y - b.y } })
    expect(menuLabels(await openedMenu(run))).toEqual(expect.arrayContaining(['高亮', '问 AI 这段', '翻译这段']))
    const accels = await run.app.evaluate(() => {
      const g = globalThis as unknown as { cnMenu: { menu: Electron.Menu } }
      return Object.fromEntries(g.cnMenu.menu.items.map((i) => [i.label, String(i.accelerator ?? '')]))
    })
    // 写的是命令表里的键（task-spsmf，菜单的写法 Command，macOS 上同 CommandOrControl）
    expect(accels['高亮']).toBe('Shift+Command+M')
    expect(accels['问 AI 这段']).toBe('Command+J')
    await pickMenu(run, '高亮')
    await expect.poll(file).toContain('==万物之逆旅==')
    await line(page, '夫天地者').click({ button: 'right', position: { x: range.x0 - b.x + 30, y: range.y - b.y } })
    expect(menuLabels(await openedMenu(run))).toContain('取消高亮')
    await pickMenu(run, '取消高亮')
    await expect.poll(file).toBe(doc)

    // ⌘J：选中的这段带进 AI 输入框，光标在输入框，不自动发
    await page.mouse.move(range.x0, range.y)
    await page.mouse.down()
    await page.mouse.move(range.x1, range.y, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.press('Meta+j')
    const box = page.getByRole('textbox', { name: '问 AI' })
    // 第 2b 段（多段引用方向 B）：这段成为输入框顶上那一排的第一块引用（来源「《读书》」），字里是编号，光标在它后面
    await expect(box).toHaveValue('①')
    await expect(page.getByTestId('ai-mat').locator('.ct')).toHaveText('万物之逆旅')
    await expect(page.getByTestId('ai-mat').locator('.cs')).toHaveText('《读书》')
    await expect(box).toBeFocused()
    await page.waitForTimeout(500)
    await expect(page.getByTestId('ai-msg')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('CN-39 / CN-40 粘贴一张截图：100 毫秒内看到图、只存一张、存进这篇的附件文件夹叫「截图 1」、没有「image」说明；悬停加说明；改名附件跟着走', async () => {
  const run = await launch({ '未命名 3.md': '# 未命名 3\n\n第一段。\n\n第二段。\n' })
  const { page, vault, app } = run
  const file = (p = '未命名 3.md') => readFileSync(join(vault, p), 'utf8')
  try {
    await openNote(page, '未命名 3')
    await line(page, '第一段').click()
    await page.keyboard.press('End')
    const png = [...solidPng(320, 180, [200, 120, 60])]
    // 一次粘贴（剪贴板里只有这张图，文件名就叫 image.png，和 macOS 截图一样）；同一帧开始量多久看到图
    const ms = await page.evaluate(async (bytes) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }))
      const t0 = performance.now()
      document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      for (;;) {
        if (document.querySelector('.pane:not([hidden]) .cm-image img')) return performance.now() - t0
        await new Promise((r) => requestAnimationFrame(r))
      }
    }, png)
    expect(ms).toBeLessThan(100)
    await expect(pane(page).locator('.cm-image-pending')).toHaveCount(0)
    await waitSaved(page)
    // 贴完光标落在图下面空出来的一段（接着打的字在图下面，第 1 轮修）
    // 图下面一个空块放光标（gap-lines.ts 的数法：一道缝加一个空块是两个空行，task-axoxy）
    expect(file()).toBe('# 未命名 3\n\n第一段。\n\n![](附件/未命名%203/截图%201.png)\n\n\n第二段。\n')
    expect(readdirSync(join(vault, '附件', '未命名 3'))).toEqual(['截图 1.png'])
    expect(existsSync(join(vault, '附件', 'image.png'))).toBe(false)
    // 图下面没有「image」；平时也看不到「加说明…」
    const img = pane(page).locator('.cm-image').first()
    await expect(img.locator('img')).toBeVisible()
    await expect(img).not.toContainText('image')
    const cap = img.locator('.cm-image-cap')
    expect(await cap.evaluate((e) => getComputedStyle(e).visibility)).toBe('hidden')
    // 悬停：「加说明…」和存在哪；点「加说明…」就地写
    await img.hover()
    expect(await cap.evaluate((e) => getComputedStyle(e).visibility)).toBe('visible')
    await expect(cap).toHaveText('加说明…')
    await expect(img.locator('.cm-image-tag span')).toHaveText('附件 / 未命名 3 / 截图 1.png')
    await page.screenshot({ path: 'test-results/g2-40-hover.png' })
    await img.locator('.cm-image-tag button').click()
    expect(await app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('|'))).toContain('附件/未命名 3/截图 1.png')
    await img.hover()
    await cap.click()
    await page.keyboard.type('黑沙滩')
    await page.keyboard.press('Enter')
    await expect.poll(() => file()).toContain('![黑沙滩](附件/未命名%203/截图%201.png)')
    await expect(pane(page).locator('.cm-image-cap')).toHaveText('黑沙滩')
    // 改名：附件文件夹跟着改名，链接跟着改
    await waitSaved(page)
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('F2')
    const input = page.getByRole('textbox', { name: '笔记名字' })
    await input.fill('冰岛')
    await input.press('Enter')
    await expect.poll(() => existsSync(join(vault, '附件', '冰岛', '截图 1.png'))).toBe(true)
    await expect.poll(() => (existsSync(join(vault, '冰岛.md')) ? file('冰岛.md') : '')).toContain('![黑沙滩](附件/冰岛/截图%201.png)')
    await expect(pane(page).locator('.cm-image img')).toHaveAttribute('src', /%E5%86%B0%E5%B2%9B/)
  } finally {
    await run.close()
  }
})

test('CN-26 长文档右边一列目录短横线，悬停展开目录、点一项滚过去、⌥⌘O 在右栏打开；不自动开右栏；「⋯ › 宽版」正文变宽', async () => {
  const para = '这一讲从为什么要专用硬件讲起：通用 CPU 能做所有事，但做矩阵乘法时大部分晶体管在搬数据。'.repeat(4)
  const heads = ['第 1 页 · 这一讲讲什么', '第 3 页 · 计算栈的九层结构', '第 5 页 · 加速器为何又快又省', '第 7 页 · 脉动阵列', '第 9 页 · 数据复用', '第 10 页 · 小结']
  const long = '# Lecture05 笔记\n\n' + heads.map((h) => `## ${h}\n\n${[para, para, para].join('\n\n')}\n`).join('\n')
  const run = await launch({ 'Lecture05 笔记.md': long, '短的.md': '# 短的\n\n## 一\n\n## 二\n\n## 三\n' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await armMenus(run)
    await openNote(page, '短的')
    await expect(pane(page).locator('.doc-toc')).toHaveCount(0)
    await openNote(page, 'Lecture05 笔记')
    const rail = pane(page).locator('.doc-toc')
    await expect(rail.locator('i')).toHaveCount(6)
    // 不自动打开右栏大纲
    await expect(page.getByRole('complementary', { name: '大纲' })).toHaveCount(0)
    await rail.hover()
    const pop = page.getByRole('navigation', { name: '目录' })
    await expect(pop).toBeVisible({ timeout: 1000 })
    await page.screenshot({ path: 'test-results/g2-26-toc.png' })
    await pop.getByRole('button', { name: '第 7 页 · 脉动阵列' }).click()
    await expect(pop).toHaveCount(0)
    const h = pane(page).locator('.cm-line', { hasText: '第 7 页 · 脉动阵列' })
    await expect(h).toBeVisible()
    const body = (await pane(page).locator('.body:has(.cm-editor)').boundingBox())!
    expect((await h.boundingBox())!.y - body.y).toBeLessThan(120)
    await expect.poll(() => rail.locator('i').evaluateAll((els) => els.findIndex((e) => e.classList.contains('on')))).toBe(3)
    // 浮层头一行：在右栏打开大纲
    await rail.hover()
    await pop.getByRole('button', { name: '⌥⌘O 在右栏打开' }).click()
    await expect(page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: /^大纲/ })).toHaveAttribute('aria-pressed', 'true')
    // 宽版
    const doc = pane(page).locator('.doc')
    const w0 = (await doc.boundingBox())!.width
    await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: /^大纲/ }).click()
    await acts(page).getByRole('button', { name: '更多' }).click()
    const m = await openedMenu(run)
    expect(m.find((i) => i.label === '宽版')?.checked).toBe(false)
    await pickMenu(run, '宽版')
    await expect(doc).toHaveClass(/wide/)
    expect((await doc.boundingBox())!.width).toBeGreaterThan(w0 + 100)
    // ⌥⌘O 也能开
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Alt+Meta+KeyO')
    await expect(page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: /^大纲/ })).toHaveAttribute('aria-pressed', 'true')
  } finally {
    await run.close()
  }
})

test('CN-19 打 /数据库 插一个 ```base 表格：每条是一篇 md；新一条、就地改属性、点列头排序、整页打开', async () => {
  const run = await launch({ '读书计划.md': '# 读书计划\n\n今年想读完的书。\n' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '读书计划.md'), 'utf8')
  try {
    await openNote(page, '读书计划')
    await line(page, '今年想读完的书').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/数据库')
    await expect(page.locator('.slash-menu button.on')).toContainText('数据库')
    await page.keyboard.press('Enter')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db).toBeVisible()
    await expect.poll(file).toContain('```base\nfilters:\n  and:\n    - file.inFolder("未命名数据库")')
    expect(existsSync(join(vault, '未命名数据库', '第一条.md'))).toBe(true)
    await expect(db.locator('tbody tr')).toHaveCount(1)
    await expect(db.locator('.base-foot')).toHaveText('每条是「未命名数据库」里的一篇笔记')
    await expect(db.locator('.base-count')).toHaveText('1 条')
    // 新一条
    await db.getByRole('button', { name: '新一条' }).click()
    await expect(db.locator('tbody tr')).toHaveCount(2)
    expect(existsSync(join(vault, '未命名数据库', '未命名.md'))).toBe(true)
    // 就地改属性：写进那一篇的 frontmatter
    // 「状态」是选项列（照 Notion）：点格子弹选项小框，打一个新的回车就建、写进去
    // 单击只选中一格（task-cle3x 格子焦点），双击进编辑 / 开选项
    await db.locator('tbody tr', { hasText: '第一条' }).locator('td').nth(1).dblclick()
    const cell = page.getByRole('dialog', { name: '第一条 · 状态' }).getByRole('textbox', { name: '找一个，或者打一个新的' })
    await cell.fill('在读')
    await cell.press('Enter')
    await expect.poll(() => readFileSync(join(vault, '未命名数据库', '第一条.md'), 'utf8')).toMatch(/^---\n状态: 在读\n日期: \d{4}-\d{2}-\d{2}\n---\n$/)
    await expect(db.locator('tbody tr', { hasText: '第一条' }).locator('.base-sel')).toHaveText('在读')
    // 点列头出菜单，「升序」写进代码块
    await db.getByRole('button', { name: '状态', exact: true }).click()
    await page.getByRole('menu', { name: '状态 这一列' }).getByRole('menuitemcheckbox', { name: '升序' }).click()
    await expect.poll(file).toContain('    sort:\n      - property: 状态\n        direction: ASC')
    await page.screenshot({ path: 'test-results/g2-19-base.png' })
    // 整页打开，esc 收回
    await pane(page).locator('[data-part="数据库块"]').getByRole('button', { name: '整页打开' }).click()
    const full = page.getByRole('dialog', { name: '数据库 未命名数据库' })
    await expect(full).toBeVisible()
    await expect(full.locator('tbody tr')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(full).toHaveCount(0)
    // 点名字：右栏开那一条（数据库第三批第 4 块）；⌘ 点在中间新标签打开那一篇
    await pane(page).locator('[data-part="数据库块"]').getByRole('button', { name: '第一条', exact: true }).click()
    await expect(page.getByTestId('dtab-record')).toHaveText('第一条')
    await pane(page).locator('[data-part="数据库块"]').getByRole('button', { name: '第一条', exact: true }).click({ modifiers: ['Meta'] })
    await expect(page.getByTestId('tab-on')).toHaveText('第一条')
  } finally {
    await run.close()
  }
})

test('数据库表头：筛选面板（且 / 或）改了就存进视图、面板里去掉一条、列头菜单降序 / 按这一列筛选 / 隐藏、eye-closed 勾回来；每一步和 packages/format 算的一样，只看不改文件不变', async () => {
  const yaml = 'filters:\n  and:\n    - file.inFolder("书单")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 作者\n      - 状态\n      - 评分\n      - 读完'
  const base = '```base\n' + yaml + '\n```'
  const doc = `# 读书\n\n今年想读完的书。\n\n${base}\n\n下一段。\n`
  const docWith = (y: string) => doc.replace(yaml, y)
  const books: Record<string, string> = {
    明朝那些事儿: '作者: 当年明月\n状态: 读完\n评分: 9\n读完: 2026-11-02',
    人类简史: '作者: 赫拉利\n状态: 在读\n评分: 9',
    '枪炮、病菌与钢铁': '作者: 戴蒙德\n状态: 在读\n评分: 8',
    置身事内: '作者: 兰小欢\n状态: 读完\n评分: 8\n读完: 2026-10-18',
    三体: '作者: 刘慈欣\n状态: 在读\n评分: 7',
    深度学习入门: '作者: 斋藤康毅\n状态: 想读',
  }
  const files: Record<string, string> = { '读书.md': doc }
  for (const [n, p] of Object.entries(books)) files[`书单/${n}.md`] = `---\n${p}\n---\n`
  const run = await launch(files)
  const { page, vault, app } = run
  const file = () => readFileSync(join(vault, '读书.md'), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '读书')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(6)
    // 只是看：文件一个字都不变
    await page.waitForTimeout(1200)
    expect(file()).toBe(doc)

    // 筛选面板：加一条「状态 是 在读」，值选了才写进视图（改了就存，task-i921u）
    const filterBtn = db.locator('.base-tools').getByRole('button', { name: '筛选', exact: true })
    await filterBtn.click()
    const panel = page.getByRole('dialog', { name: '筛选' })
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: '加一条' }).click()
    const row = (i: number) => panel.locator('.fbody > .frow').nth(i)
    await row(0).getByRole('combobox', { name: '列' }).selectOption('状态')
    await row(0).getByRole('combobox', { name: '条件' }).selectOption({ label: '是' })
    await row(0).getByRole('combobox', { name: '值' }).selectOption('在读')
    const c1 = { prop: '状态', op: '==' as const, value: '在读' }
    let y = setViewFilter(yaml, 0, { conj: 'and', items: [c1] })
    await expect.poll(file).toBe(docWith(y))
    await expect(db.locator('tbody tr')).toHaveCount(3)
    // 加一条：评分 ≥ 8（打字，停手后写回）
    await panel.getByRole('button', { name: '加一条' }).click()
    await row(1).getByRole('combobox', { name: '列' }).selectOption('评分')
    await row(1).getByRole('combobox', { name: '条件' }).selectOption({ label: '≥' })
    await row(1).getByRole('textbox', { name: '值' }).fill('8')
    const c2 = { prop: '评分', op: '>=' as const, value: '8' }
    y = setViewFilter(y, 0, { conj: 'and', items: [c1, c2] })
    await expect.poll(file).toBe(docWith(y))
    await expect(db.locator('tbody tr')).toHaveCount(2)
    await expect(db.locator('.base-count')).toHaveText('2 条 · 筛掉 4 条')
    await expect(filterBtn).toHaveText('筛选 2')
    await page.screenshot({ path: 'test-results/g2-19-filter.png' })
    // 或：满足任一条
    await row(1).getByRole('combobox', { name: '且还是或' }).selectOption('or')
    y = setViewFilter(y, 0, { conj: 'or', items: [c1, c2] })
    await expect.poll(file).toBe(docWith(y))
    await expect(db.locator('tbody tr')).toHaveCount(5)
    await row(1).getByRole('combobox', { name: '且还是或' }).selectOption('and')
    y = setViewFilter(y, 0, { conj: 'and', items: [c1, c2] })
    await expect.poll(file).toBe(docWith(y))
    await expect(db.locator('tbody tr')).toHaveCount(2)
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    // 小标签写着整个筛选；面板里去掉「评分 ≥ 8」
    await expect(db.locator('.base-fchip')).toHaveText(['状态 是 在读 且 评分 ≥ 8'])
    await db.locator('.base-fchip .t').click()
    await row(1).getByRole('button', { name: '去掉这一条' }).click()
    y = setViewFilter(y, 0, { conj: 'and', items: [c1] })
    await expect.poll(file).toBe(docWith(y))
    await expect(db.locator('tbody tr')).toHaveCount(3)
    await page.keyboard.press('Escape')

    // 列头菜单：评分 降序
    await db.getByRole('button', { name: '评分', exact: true }).click()
    const menu = page.getByRole('menu', { name: '评分 这一列' })
    await menu.getByRole('menuitemcheckbox', { name: '降序' }).click()
    y = setViewSort(y, 0, [{ prop: '评分', desc: true }])
    await expect.poll(file).toBe(docWith(y))
    await expect(db.locator('tbody tr').first()).toContainText('人类简史')
    // 隐藏「读完」：从 order 里拿掉；分组筛选排序前面 eye-closed 1，点开勾回来
    await db.getByRole('button', { name: '读完', exact: true }).click()
    await page.getByRole('menu', { name: '读完 这一列' }).getByRole('menuitem', { name: '隐藏这一列' }).click()
    await expect.poll(file).not.toContain('      - 读完\n')
    await expect(db.locator('th', { hasText: '读完' })).toHaveCount(0)
    await page.screenshot({ path: 'test-results/g2-19-hidden.png' })
    await db.getByRole('button', { name: '隐藏了 1 列' }).click()
    await page.getByRole('menu', { name: '隐藏的列' }).getByRole('menuitemcheckbox', { name: '读完' }).click()
    await expect.poll(file).toBe(docWith(y))
    // 按这一列筛选…：面板打开，先填好这一列
    await db.getByRole('button', { name: '作者', exact: true }).click()
    await page.getByRole('menu', { name: '作者 这一列' }).getByRole('menuitem', { name: '按这一列筛选…' }).click()
    await expect(panel).toBeVisible()
    await expect(row(1).getByRole('combobox', { name: '列' })).toHaveValue('作者')
    await row(1).getByRole('combobox', { name: '条件' }).selectOption({ label: '包含' })
    await row(1).getByRole('textbox', { name: '值' }).fill('赫')
    y = setViewFilter(y, 0, { conj: 'and', items: [c1, { prop: '作者', op: 'contains', value: '赫' }] })
    await expect.poll(file).toBe(docWith(y))
    await expect(db.locator('tbody tr')).toHaveCount(1)
    // 其余行原样：除了这个视图的 filters、sort，代码块和正文都没动
    expect(file().startsWith('# 读书\n\n今年想读完的书。\n\n```base\nfilters:\n  and:\n    - file.inFolder("书单")\nviews:\n')).toBe(true)
    expect(file().endsWith('```\n\n下一段。\n')).toBe(true)
  } finally {
    await run.close()
  }
})

test('CN-14 剪进来的引文出处行末尾回车一次就回到普通段落；⇧回车在引用里续行', async () => {
  const run = await launch(EDITOR_FILES)
  const { page } = run
  try {
    await openNote(page, '未命名 3')
    await line(page, '雷克雅未克 - 维基百科').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('普通一段')
    const typed = pane(page).locator('.cm-line', { hasText: '普通一段' })
    await expect(typed).not.toHaveClass(/cm-quote/)
    expect(await editorText(page)).toContain('%E5%85%8B)\n\n普通一段\n\n> [!question]')
    await line(page, '雷克雅未克是冰岛的首都').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('引用里的第二行')
    await expect(pane(page).locator('.cm-line', { hasText: '引用里的第二行' })).toHaveClass(/cm-quote/)
  } finally {
    await run.close()
  }
})

test('CN-18 正文里按 Tab 光标不离开正文、字不变；列表里 Tab 缩进一级、⇧Tab 退回', async () => {
  const run = await launch(EDITOR_FILES)
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '未命名 3.md'), 'utf8')
  try {
    await openNote(page, '未命名 3')
    const before = EDITOR_FILES['未命名 3.md']
    await line(page, '这一帧在讲快餐品牌的两难').click()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))).toBe(true)
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'saved')
    await page.waitForTimeout(1000)
    expect(file()).toBe(before)
    await line(page, 'CoT：').click()
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))).toBe(true)
    await expect.poll(file).toContain('\n  - CoT：')
    await line(page, 'CoT：').click()
    await page.keyboard.press('Shift+Tab')
    await expect.poll(file).toBe(before)
  } finally {
    await run.close()
  }
})

test('task-6cxtc 复审：[!ai] 块头固定两行：第一行「讲解一下」/「你问：原话」13/500 --t1，第二行「Claude Code · Opus 5.5 · 小标题 ↩」12 --t2、行首没有「·」；回到网页那一段的链接不断行，放不下先截小标题留住 ↩；md 一个字不变', async () => {
  const url = 'http://127.0.0.1:9/chapter_preliminaries/pandas.html#:~:text=%E4%B8%8B%E9%9D%A2'
  const ask = (label: string, head: string) =>
    webAskBlock({ label, by: 'Claude Code · Opus 5.5', links: [{ text: `${head} ↩`, url }], quotes: ['下面我们将数据集按行写入CSV文件中。'], answer: '这段在准备练习用的数据。' })
  const blocks = ['', ask('讲解一下', '2.2.1 读取数据集'), ask('你问：插值法和删除法各适合什么时候？', '2.2.2 处理缺失值'), ask('讲解一下', '2.2.3 转换为张量格式之前先把类别值变成两列再看看会怎样'), ''].join('\n\n')
  const md = EDITOR_FILES['未命名 3.md'] + blocks
  const run = await launch({ ...EDITOR_FILES, '未命名 3.md': md })
  const { page, app, vault } = run
  try {
    // 中间栏窄（约 444，同截图里网页开在右边、右栏拉宽 270）：A 风格里「2.2.2 处理缺｜失值 ↩」拆在字中间那种宽度
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, '未命名 3')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await widenRight(page, 270)
    await pane(page).locator('.body:has(.cm-editor)').evaluate((e) => (e.scrollTop = e.scrollHeight))
    const heads = pane(page).locator('.cm-callout-ai.cm-callout-head')
    await expect(heads).toHaveCount(3)
    for (let i = 0; i < 3; i++) {
      await heads.nth(i).scrollIntoViewIfNeeded()
      // 第三块小标题长：量好以后截（下一帧）
      if (i === 2) await expect(heads.nth(i).locator('.cm-cut')).toHaveCount(1)
      const m = await heads.nth(i).evaluate((h) => {
        const name = h.querySelector('.cm-callout-name') as HTMLElement
        const meta = h.querySelector('.cm-callout-meta') as HTMLElement
        const links = [...meta.querySelectorAll('.cm-link')] as HTMLElement[]
        const link = links[0]!
        const mr0 = meta.getBoundingClientRect()
        const cut = (link.closest('.cm-cut') ?? link.querySelector('.cm-cut')) as HTMLElement | null
        const outer = cut && cut.contains(link) ? cut : link
        const hr = h.getBoundingClientRect()
        const nr = name.getBoundingClientRect()
        const mr = meta.getBoundingClientRect()
        const cs = (e: Element) => getComputedStyle(e)
        const colorOf = (v: string) => {
          const p = document.createElement('span')
          p.style.color = `var(${v})`
          h.appendChild(p)
          const c = getComputedStyle(p).color
          p.remove()
          return c
        }
        return {
          nameTitle: name.title,
          nameH: nr.height,
          nameLh: parseFloat(cs(name).lineHeight),
          metaH: mr.height,
          metaLh: parseFloat(cs(meta).lineHeight),
          metaBelow: mr.top >= nr.bottom - 1,
          nameFont: `${cs(name).fontSize}/${cs(name).fontWeight}`,
          nameColor: cs(name).color === colorOf('--t1'),
          metaFont: cs(meta).fontSize,
          // 块头第二行整行 --t2，里面的链接和前面同色（editor-blocks.css「color: inherit」，task-6cxtc 复审定的，覆盖 dtc34 当时的 --t3），悬停 --t1
          metaColor: cs(meta).color === colorOf('--t2') && links.every((l) => cs(l).color === colorOf('--t2')),
          metaText: meta.innerText.trim(),
          linkRects: links.map((l) => l.getClientRects().length),
          // 链接的字是一整段（点「↩」、按字找都靠它）
          linkText: link.textContent,
          // ↩ 看得见：没截时是字里那个，截了是右端画的那个；整个链接在这一行里
          backShown: (cut ? getComputedStyle(cut, '::after').content === '"↩"' : /↩$/.test(link.textContent ?? '')) && outer.getBoundingClientRect().right <= mr0.right + 0.5,
          secCut: !!cut && cut.scrollWidth > cut.clientWidth + 1 && getComputedStyle(cut).textOverflow === 'ellipsis',
        }
      })
      expect(m.nameH, `第 ${i + 1} 块第一行只占一行`).toBeLessThan(m.nameLh * 1.5)
      expect(m.metaH, `第 ${i + 1} 块第二行只占一行`).toBeLessThan(m.metaLh * 1.5)
      expect(m.metaBelow).toBe(true)
      // 名字一行放不下时省略号，指着看全（你问的原话）
      expect(m.nameTitle).toBe(i === 1 ? '你问：插值法和删除法各适合什么时候？' : '讲解一下')
      expect(m.nameFont).toBe('13px/500')
      expect(m.nameColor).toBe(true)
      expect(m.metaFont).toBe('12px')
      expect(m.metaColor).toBe(true)
      expect(m.metaText.startsWith('Claude Code · Opus 5.5 · ')).toBe(true)
      expect(m.linkRects.every((n) => n === 1)).toBe(true)
      expect(m.backShown).toBe(true)
      expect(m.linkText).toMatch(/^2\.2\.\d .+ ↩$/)
      // 第三块小标题长：截小标题（省略号），↩ 还在
      expect(m.secCut).toBe(i === 2)
    }
    await page.screenshot({ path: 'test-results/g2-ai-head.png' })
    // 打开再保存文件不变
    await page.waitForTimeout(1200)
    expect(readFileSync(join(vault, '未命名 3.md'), 'utf8')).toBe(md)
  } finally {
    await run.close()
  }
})
