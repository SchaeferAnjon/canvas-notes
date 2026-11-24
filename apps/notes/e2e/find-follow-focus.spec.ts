/**
 * 查找跟着焦点走（⇧⌘F「在这一页里找」，2026-11-24 用户：「当我聚焦在哪个窗口的时候 按这个快捷键就在哪个窗口搜索」）。
 * 用户截图那样摆：中间文档，右边网页一栏、AI 一栏。焦点在哪一栏（点进去过的、点过它的标签条、网页里点进正文的）就在哪一栏找：
 * - 网页里点进正文按 ⇧⌘F：网页里出条，「1/3」、↵ ⇧↵ 上下跳、区分大小写、esc 关掉焦点回网页；
 * - 以前坏的那条：焦点还在 AI 输入框（或文档）里，点一下网页的标签条再按，条出在中间的文档上；现在出在网页里；
 * - 点文档按出在文档里；AI 对话有字时焦点在 AI 输入框里按，在这段对话里找；
 * - 网页自己拿到焦点（窗口没在前面时直接点进网页，界面收不到 blur）：主进程报 web:focused，当前栏跟着换；
 * - 中间栏分屏，一格文档一格宽网页：各按各的。
 * 主窗口里用 Playwright 的真按键，网页里从主进程往网页送真的按键（Playwright 的键盘到不了 webview 里，同 web-full-key）。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { launch, leftView, openNote, pane, type Running } from './app'
import { skinned } from './fixtures/book-digest'
import { KEY_FILES, openWeb, web } from './keys-checks'
import { shotWindow } from './shots'

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(
      '<title>Join Us</title><body style="font:16px/1.6 -apple-system,sans-serif;padding:20px 28px"><h1>Join Us</h1>' +
        '<table border="1" cellpadding="8" style="border-collapse:collapse"><tr><th>Topic</th><th>Supervisor</th></tr>' +
        '<tr><td>Design and Optimization of Memristor-Based Stateful Logic Units</td><td>Gulafshan</td></tr>' +
        '<tr><td>Reliability-Aware Design for memristor Logic Circuits</td><td>Gulafshan</td></tr>' +
        '<tr><td>Cross-Platform Implementation of Memristor Models in LTspice</td><td>Gulafshan</td></tr>' +
        '<tr><td>Graph-based network analysis of emotion-related physiological signals</td><td>Mostafa Haghi</td></tr></table></body>',
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const webview = (page: Page) => web(page).locator('webview.on')
const webBar = (page: Page) => web(page).getByTestId('find-bar')
const docBar = (page: Page) => page.locator('main.center').getByTestId('find-bar')
const ai = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const ask = (page: Page) => page.getByRole('textbox', { name: '问 AI' })
const allBars = (page: Page) => page.getByTestId('find-bar')

/** 照用户截图摆：中间文档，右边网页一栏、AI 一栏 */
async function layout(run: Running) {
  const { page } = run
  await page.addInitScript(() =>
    localStorage.setItem(
      'cn.dock',
      JSON.stringify({ v: 1, cols: [{ id: 'center' }, { id: 'c1', w: 460, groups: [{ id: 'g1', views: ['web'], active: 'web', f: 1 }] }, { id: 'c2', w: 380, groups: [{ id: 'g2', views: ['ai'], active: 'ai', f: 1 }] }], floats: [], hidden: null }),
    ),
  )
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000))
  await page.reload()
  await expect(ask(page)).toBeVisible()
  await leftView(page, '最近')
  await openNote(page, '草稿')
  await openWeb(page, `${base}/`)
}

/** 网页那个 <webview> 的 webContents id */
const wcOf = (v: Locator) => v.evaluate((w) => (w as unknown as { getWebContentsId(): number }).getWebContentsId())

/** 点进网页正文（标题那一行，网页从这儿往下找），等网页拿到焦点 */
async function clickIntoWeb(run: Running, v: Locator) {
  const b = (await v.boundingBox())!
  await run.page.mouse.click(b.x + 40, b.y + 34)
  await expect.poll(() => run.page.evaluate(() => document.activeElement?.tagName)).toBe('WEBVIEW')
}

/** 焦点在网页里真按一个键：从这个网页的 webContents 进，主进程 before-input-event 认出软件的键转给界面 */
async function keyInWeb(run: Running, v: Locator, keyCode: string, modifiers: ('meta' | 'shift')[]) {
  const id = await wcOf(v)
  await run.app.evaluate(
    ({ webContents }, { id, keyCode, modifiers }) => {
      const wc = webContents.fromId(id)!
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    },
    { id, keyCode, modifiers },
  )
}

const count = (bar: Locator) => bar.getByTestId('find-count')

test('焦点在哪栏 ⇧⌘F 就在哪栏找：网页（1/3、↵ ⇧↵、区分大小写、esc）、点过网页标签条、文档、AI 对话、网页自己拿到焦点', async () => {
  test.setTimeout(150_000)
  const run = await launch(KEY_FILES, { CN_AI_FAKE: '1' })
  try {
    const { page } = run
    await layout(run)

    await test.step('网页里点进正文按 ⇧⌘F：网页里出条，跳到第一处、计数对', async () => {
      await clickIntoWeb(run, webview(page))
      await keyInWeb(run, webview(page), 'F', ['shift', 'meta'])
      await expect(webBar(page)).toBeVisible()
      await expect(allBars(page)).toHaveCount(1)
      await expect(webBar(page).getByRole('textbox')).toBeFocused()
      await page.keyboard.type('memristor')
      await expect(count(webBar(page))).toHaveText('1/3')
      // 网页找的时候拿走焦点又放回框里：接着打字不丢
      await expect(webBar(page).getByRole('textbox')).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(count(webBar(page))).toHaveText('2/3')
      await page.keyboard.press('Enter')
      await expect(count(webBar(page))).toHaveText('3/3')
      await page.keyboard.press('Enter')
      await expect(count(webBar(page))).toHaveText('1/3')
      await page.keyboard.press('Shift+Enter')
      await expect(count(webBar(page))).toHaveText('3/3')
      // 区分大小写：大写开头的两处不算了
      const cs = webBar(page).getByRole('button', { name: '区分大小写' })
      await cs.click()
      await expect(cs).toHaveAttribute('aria-pressed', 'true')
      await expect(count(webBar(page))).toHaveText('1/1')
      await webBar(page).getByRole('textbox').fill('Memristor')
      await expect(count(webBar(page))).toHaveText(/^[12]\/2$/)
      await cs.click()
      await expect(count(webBar(page))).toHaveText(/^[123]\/3$/)
      // esc 关掉，焦点回网页
      await webBar(page).getByRole('textbox').press('Escape')
      await expect(webBar(page)).toHaveCount(0)
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('WEBVIEW')
    })

    await test.step('焦点在 AI 输入框，点一下网页的标签条再按：在网页里找（以前落到中间的文档上）', async () => {
      await ask(page).click()
      await expect(ask(page)).toBeFocused()
      await web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab').first().click()
      await page.keyboard.press('Shift+Meta+KeyF')
      await expect(webBar(page)).toBeVisible()
      await expect(allBars(page)).toHaveCount(1)
      await page.keyboard.type('Mostafa')
      await expect(count(webBar(page))).toHaveText('1/1')
      await page.keyboard.press('Escape')
      await expect(webBar(page)).toHaveCount(0)
    })

    await test.step('点进文档按 ⇧⌘F：在文档里找', async () => {
      await pane(page).locator('.cm-content').click()
      await page.keyboard.press('Shift+Meta+KeyF')
      await expect(docBar(page)).toBeVisible()
      await expect(allBars(page)).toHaveCount(1)
      await page.keyboard.type('一段')
      await expect(count(docBar(page))).toHaveText('1/1')
      await page.keyboard.press('Escape')
      await expect(docBar(page)).toHaveCount(0)
    })

    await test.step('AI 对话里有字时，焦点在 AI 输入框按 ⇧⌘F：在这段对话里找', async () => {
      await ask(page).fill('列出引用')
      await ask(page).press('Enter')
      await expect(ai(page).getByTestId('ai-msg').last()).not.toHaveAttribute('aria-busy', 'true', { timeout: 15_000 })
      await ask(page).click()
      await page.keyboard.press('Shift+Meta+KeyF')
      const aiBar = ai(page).getByTestId('find-bar')
      await expect(aiBar).toBeVisible()
      await expect(allBars(page)).toHaveCount(1)
      await expect(aiBar.getByRole('textbox')).toHaveAttribute('placeholder', '在这段对话里找')
      await page.keyboard.type('列出引用')
      await expect(count(aiBar)).toHaveText(/^1\/\d+$/)
      // 找到的那一处铺上淡底（CSS 高亮），在条下面看得见（第一条消息在最顶上，对话顶上让出了条的高度）；对话目录也挪到条下面
      const pos = await page.evaluate(() => {
        const hl = (CSS as unknown as { highlights: Map<string, Iterable<Range>> }).highlights.get('cn-find-cur')
        const r = hl ? [...hl][0]!.getBoundingClientRect() : null
        const bar = document.querySelector('.aicell [data-testid="find-bar"]')!.getBoundingClientRect()
        const toc = document.querySelector('.aicell .chat-toc-wrap')?.getBoundingClientRect() ?? null
        const list = document.querySelector('.aicell .msgs')!.getBoundingClientRect()
        return { hit: r && { top: r.top, bottom: r.bottom }, barBottom: bar.bottom, tocTop: toc?.top ?? null, listBottom: list.bottom }
      })
      expect(pos.hit).not.toBeNull()
      expect(pos.hit!.top).toBeGreaterThanOrEqual(pos.barBottom)
      expect(pos.hit!.bottom).toBeLessThanOrEqual(pos.listBottom)
      if (pos.tocTop !== null) expect(pos.tocTop).toBeGreaterThanOrEqual(pos.barBottom)
      await expect(aiBar.getByRole('button', { name: '区分大小写' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(aiBar).toHaveCount(0)
      // 关掉焦点回 AI 输入框
      await expect(ask(page)).toBeFocused()
    })

    await test.step('网页自己拿到焦点（界面收不到 blur 的那种）：当前栏换成网页那一栏，⇧⌘F 在网页里找', async () => {
      await pane(page).locator('.cm-content').click()
      await expect(page.locator('.win')).toHaveAttribute('data-pane', 'center')
      const id = await wcOf(webview(page))
      // 无头窗口不是系统的当前窗口，网页拿到焦点时主进程收不到 webContents 的 focus：照它发一下（就是真点进去时那一下），再让网页拿焦点
      await run.app.evaluate(({ webContents }, id) => {
        const wc = webContents.fromId(id)!
        wc.focus()
        wc.emit('focus')
      }, id)
      await expect(page.locator('.win')).toHaveAttribute('data-pane', 'g1')
      await keyInWeb(run, webview(page), 'F', ['shift', 'meta'])
      await expect(webBar(page)).toBeVisible()
      await expect(allBars(page)).toHaveCount(1)
      await page.keyboard.press('Escape')
    })
  } finally {
    await run.close()
  }
})

test('中间栏分屏，一格文档一格宽网页：焦点在哪格就在哪格找', async () => {
  test.setTimeout(120_000)
  const run = await launch(KEY_FILES)
  try {
    const { page } = run
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000))
    await leftView(page, '最近')
    await openNote(page, '草稿')
    await openWeb(page, `${base}/`)
    // 网页「⋯」里「在中间开成一页」：中间多一个宽网页标签
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    await web(page).getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name: /在中间开成一页/ }).click()
    const wide = page.locator('main.center .wpane:not([hidden]) webview')
    await expect(wide).toBeVisible({ timeout: 15_000 })
    // ⌃\ 分屏：宽网页在一格，另一格是文档
    await page.locator('main.center .wpane:not([hidden]) .tool').click({ position: { x: 4, y: 4 } })
    await page.keyboard.press('Control+Backslash')
    await expect(page.locator('main.center')).toHaveClass(/\bsplit\b/)
    // 照 VS Code，右边那格先也是这个网页：在右边那格里 ⌘O 打开「草稿」，成了一格宽网页、一格文档
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('草稿')
    await page.waitForTimeout(150)
    await page.keyboard.press('Enter')
    const slotOf = (sel: string) => page.locator(`main.center > .cslot:not([hidden]):has(${sel})`)
    const webSlot = slotOf('.wpane')
    const docSlot = slotOf('.pane .cm-content')
    await expect(webSlot).toHaveCount(1)
    await expect(docSlot).toHaveCount(1)
    expect(await webSlot.getAttribute('data-pane')).not.toBe(await docSlot.getAttribute('data-pane'))

    // 文档那格
    await docSlot.locator('.cm-content').click()
    await page.keyboard.press('Shift+Meta+KeyF')
    await expect(docSlot.getByTestId('find-bar')).toBeVisible()
    await expect(allBars(page)).toHaveCount(1)
    await page.keyboard.type('小标题')
    await expect(count(docSlot.getByTestId('find-bar'))).toHaveText('1/1')
    await page.keyboard.press('Escape')

    // 网页那格：点进正文，网页里按
    await clickIntoWeb(run, webSlot.locator('webview'))
    await expect(webSlot).toHaveAttribute('data-on', '')
    await keyInWeb(run, webSlot.locator('webview'), 'F', ['shift', 'meta'])
    const wbar = webSlot.getByTestId('find-bar')
    await expect(wbar).toBeVisible()
    await expect(allBars(page)).toHaveCount(1)
    await page.keyboard.type('memristor')
    await expect(count(wbar)).toHaveText('1/3')
    await page.keyboard.press('Escape')
    await expect(wbar).toHaveCount(0)

    // 回文档那格再按：又在文档里
    await docSlot.locator('.cm-content').click()
    await page.keyboard.press('Shift+Meta+KeyF')
    await expect(docSlot.getByTestId('find-bar')).toBeVisible()
    await expect(allBars(page)).toHaveCount(1)
  } finally {
    await run.close()
  }
})

// 交付截图（只在给了 CN_SHOTS 时跑）：薄荷主题，中间那栏网页里的查找小条
test('截图：薄荷主题下网页里的查找小条', async () => {
  test.skip(!process.env.CN_SHOTS, '截交付图才跑：CN_SHOTS=<目录>')
  test.setTimeout(90_000)
  const run = await launch(KEY_FILES, { CN_AI_FAKE: '1' }, skinned('mint'))
  try {
    const { page } = run
    await layout(run)
    await clickIntoWeb(run, webview(page))
    await keyInWeb(run, webview(page), 'F', ['shift', 'meta'])
    await page.keyboard.type('memristor')
    await expect(count(webBar(page))).toHaveText('1/3')
    await page.keyboard.press('Enter')
    await expect(count(webBar(page))).toHaveText('2/3')
    await shotWindow(run, '网页里的查找小条-薄荷')
    // AI 对话里找：搜到的字在条下面看得见，对话目录挪到条下面
    await page.keyboard.press('Escape')
    await ask(page).fill('列出引用')
    await ask(page).press('Enter')
    await expect(ai(page).getByTestId('ai-msg').last()).not.toHaveAttribute('aria-busy', 'true', { timeout: 15_000 })
    await ask(page).click()
    await page.keyboard.press('Shift+Meta+KeyF')
    await page.keyboard.type('列出引用')
    await expect(count(ai(page).getByTestId('find-bar'))).toHaveText(/^1\/\d+$/)
    await shotWindow(run, 'AI对话里的查找小条-薄荷')
  } finally {
    await run.close()
  }
})
