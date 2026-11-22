/**
 * 文档里的 Tab（task-busas）：刚剪进来的一段后面按 Tab 直接写「我的评价」，回车换了新行再 Tab 是普通的缩进；
 * 列表 Tab / ⇧Tab、代码块里 Tab、空评价 ⇧Tab 撤掉、输入法选字时不抢、键在设置 › 快捷键里能改。
 * 都在测试模式里真剪（右栏网页选字、点小条上的「剪藏」）、真按键，读磁盘上的文件对。
 * 这篇先和网站配好对（read-along），剪藏直接剪进这篇光标处、不问记到哪篇（task-6cxtc）。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { acts, editorText, launch, openNote, pane, rail, type Running, waitSaved } from './app'
import { fragmentUrl } from '../src/shared/web-link'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<title>2.3. 线性代数</title><body style="font:16px sans-serif;padding:20px">
      <p id="p1">向量只是一个数字数组。</p></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const FILE = '学习笔记.md'
const BODY = '# 学习笔记\n\n这就是向量的感觉。\n'
/** 和这个网站配好对的那篇（剪藏剪进它） */
const START = () => `---\nread-along: ${base}/\n---\n${BODY}`
const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, js: string) => web(page).locator('webview').evaluate((w, code) => (w as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(code), js)
async function guestRect(page: Page, js: string) {
  const box = (await web(page).locator('webview').boundingBox())!
  const r = (await guest(page, `(() => { const r = (${js}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)) as { x: number; y: number }
  return { x: box.x + r.x, y: box.y + r.y }
}
const file = (run: Running) => readFileSync(join(run.vault, FILE), 'utf8')
/** 来源一行：这一页的名字 · 网站（页名里没写书名时用网站名），链接回到这一段 */
const CLIPPED = () => `${START()}\n> 向量只是一个数字数组。\n—— [2.3. 线性代数 · ${new URL(base).hostname}](${fragmentUrl(`${base}/d2l`, '向量只是一个数字数组。')})\n`
const caretLine = (page: Page) =>
  page.evaluate(() => {
    const n = document.getSelection()?.focusNode
    const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null
    return el?.closest('.cm-line')?.textContent ?? ''
  })
const inEditor = (page: Page) => page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false)

/** 打开这篇、光标放在末尾，右栏网页选中一段、点「剪藏」：光标停在剪进来那段下面（隔一个空行） */
async function clipOne(page: Page) {
  await openNote(page, '学习笔记')
  await line(page, '这就是向量的感觉').click()
  await page.keyboard.press('End')
  // 配好对的这篇一打开，右栏网页就跟着开了：没开才点
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/d2l`)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
  const p = await guestRect(page, `document.getElementById('p1')`)
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(p.x, p.y, { clickCount: 3 })
    if (await expect.poll(() => guest(page, 'getSelection().toString().length'), { timeout: 1000 }).toBeGreaterThan(0).then(() => true, () => false)) break
  }
  await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
  const b = await guestRect(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('button.clip')`)
  await page.mouse.click(b.x, b.y)
  await expect(page.locator('.toast-cn')).toContainText('剪进《学习笔记》光标处')
  await expect(line(page, '向量只是一个数字数组')).toBeVisible()
}

test('刚剪进来的一段后面按 Tab：开一段「我的评价」、光标在里面，打的字写进文件；再按 Tab 不动；空评价 ⇧Tab 撤掉、文件回到原样', async () => {
  const run = await launch({ [FILE]: START() })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await clipOne(page)
    await waitSaved(page)
    expect(file(run)).toBe(CLIPPED() + '\n')
    // 不点文档，直接 Tab：出评价标签，灰字占位，光标在评价那一行
    await page.keyboard.press('Tab')
    const tag = pane(page).locator('.cm-review-tag')
    await expect(tag).toHaveText('我的评价')
    await expect(pane(page).locator('.cm-review-ph')).toHaveText('写下你对这一段的看法…')
    expect(await inEditor(page)).toBe(true)
    expect(await caretLine(page)).toContain('我的评价')
    await page.screenshot({ path: 'test-results/busas-tab-open.png' })
    // ⇧Tab：空着的评价撤掉，光标回到剪进来时停的那一行，文件不变
    await page.keyboard.press('Shift+Tab')
    await expect(tag).toHaveCount(0)
    expect(await inEditor(page)).toBe(true)
    await page.keyboard.type('a')
    await expect.poll(() => editorText(page)).toBe(CLIPPED() + '\na')
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(file(run)).toBe(CLIPPED() + '\n')
    // 再 Tab、打字：写进「我的评价：」后面
    await page.keyboard.press('Tab')
    await page.keyboard.type('数组有长度，就是维度。')
    // 评价里再按 Tab：什么都不做，光标不离开正文
    await page.keyboard.press('Tab')
    expect(await inEditor(page)).toBe(true)
    await waitSaved(page)
    expect(file(run)).toBe(`${CLIPPED()}\n我的评价：数组有长度，就是维度。\n\n`)
    await expect(pane(page).locator('.cm-review')).toHaveCount(1)
    await page.screenshot({ path: 'test-results/busas-tab-typed.png' })
    // 有字的评价里 ⇧Tab：不撤、字不变
    await page.keyboard.press('Shift+Tab')
    await page.waitForTimeout(300)
    expect(await editorText(page)).toBe(`${CLIPPED()}\n我的评价：数组有长度，就是维度。\n\n`)
    // 光标回到引文出处行末尾按 Tab：已有评价，光标跳到评价末尾
    await line(page, '2.3. 线性代数').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    await page.keyboard.type('！')
    await expect.poll(() => editorText(page)).toBe(`${CLIPPED()}\n我的评价：数组有长度，就是维度。！\n\n`)
  } finally {
    await run.close()
  }
})

test('剪进来以后先回车换了新行再 Tab：不出评价，普通段落不动；列表 Tab 进一级、⇧Tab 退回；代码块里 Tab 插两个空格', async () => {
  const run = await launch({ [FILE]: START(), '代码.md': '# 代码\n\n```py\nx = 1\n```\n' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await clipOne(page)
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    expect(await inEditor(page)).toBe(true)
    await expect(pane(page).locator('.cm-review-tag')).toHaveCount(0)
    await page.keyboard.type('- 一')
    await page.keyboard.press('Enter')
    await page.keyboard.type('二')
    await page.keyboard.press('Tab')
    await waitSaved(page)
    expect(file(run)).toBe(`${CLIPPED()}\n\n- 一\n  - 二`)
    await page.keyboard.press('Shift+Tab')
    await waitSaved(page)
    expect(file(run)).toBe(`${CLIPPED()}\n\n- 一\n- 二`)
    // 普通段落末尾 Tab：字不变
    await line(page, '这就是向量的感觉').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    expect(await editorText(page)).toBe(`${CLIPPED()}\n\n- 一\n- 二`)
    // 代码块里：Tab 插两个空格，⇧Tab 退回
    await openNote(page, '代码')
    await line(page, 'x = 1').click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Tab')
    await page.keyboard.type('y')
    await waitSaved(page)
    expect(readFileSync(join(run.vault, '代码.md'), 'utf8')).toBe('# 代码\n\n```py\n  yx = 1\n```\n')
    await page.keyboard.press('Shift+Tab')
    await waitSaved(page)
    expect(readFileSync(join(run.vault, '代码.md'), 'utf8')).toBe('# 代码\n\n```py\nyx = 1\n```\n')
  } finally {
    await run.close()
  }
})

test('输入法正在选字时按 Tab 不抢；打开再保存文件不变；Tab 在设置 › 快捷键里能改成别的键', async () => {
  const doc = `# 学习笔记\n\n> 向量只是一个数字数组。\n—— [2.3. 线性代数](http://127.0.0.1/d2l)\n\n`
  const run = await launch({ [FILE]: doc, '清单.md': '# 清单\n\n- 一\n- 二\n' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, '学习笔记')
    await line(page, '2.3. 线性代数').click()
    // 打开再保存：文件一个字节不变
    await page.keyboard.press('Meta+s')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'saved')
    expect(file(run)).toBe(doc)
    // 光标在出处行末尾（这里按 Tab 会开评价），输入法开始拼字（「ni」），这时按 Tab：归输入法，不开评价；选好字照常进文档
    await page.keyboard.press('End')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
    await page.keyboard.press('Tab')
    await page.waitForTimeout(300)
    await expect(pane(page).locator('.cm-review-tag')).toHaveCount(0)
    await cdp.send('Input.insertText', { text: '你' })
    // 模拟的输入法在 Tab 时把拼音先交了（真输入法 Tab 在它自己那里换候选），要紧的是没开评价、字还在文档里
    await expect.poll(() => editorText(page)).toMatch(/\/d2l\)(ni)?你\n\n$/)
    await expect(pane(page).locator('.cm-review-tag')).toHaveCount(0)
    expect(await inEditor(page)).toBe(true)
    for (const _ of /\)((ni)?你)/.exec(await editorText(page))![1]!) await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(file(run)).toBe(doc)
    // 设置 › 快捷键：「缩进 / 写评价」默认 ⇥，改成 ⌃]
    await page.keyboard.press('Meta+Comma')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
    const row = dlg.locator('[data-row="k-cmd-indent"]')
    await expect(row.locator('.sa-keyb')).toHaveText('⇥')
    await expect(dlg.locator('[data-row="k-cmd-outdent"] .sa-keyb')).toHaveText('⇧⇥')
    await row.getByRole('button', { name: '改 缩进 / 写评价 的快捷键' }).click()
    await page.keyboard.press('Control+BracketRight')
    await expect(row.locator('.sa-keyb')).toHaveText('⌃]')
    await page.screenshot({ path: 'test-results/busas-tab-keys.png' })
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    // 新键在列表里缩进；Tab 不再做事（光标照样不离开正文）
    await openNote(page, '清单')
    await line(page, '二').click()
    await page.keyboard.press('Tab')
    expect(await inEditor(page)).toBe(true)
    await page.waitForTimeout(300)
    expect(await editorText(page)).toBe('# 清单\n\n- 一\n- 二\n')
    await page.keyboard.press('Control+BracketRight')
    await expect.poll(() => editorText(page)).toBe('# 清单\n\n- 一\n  - 二\n')
  } finally {
    await run.close()
  }
})
