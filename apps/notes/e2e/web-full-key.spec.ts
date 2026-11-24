/**
 * 网页占满的快捷键 ⌃⌘\（0.5.3 里按了没反应，用户截图：左文档、中间网页、右栏 AI 各一栏）：
 * - 焦点在网页、文档、白板、AI 输入框里各按一次进占满，再按一次还原；
 * - macOS 上菜单栏那一项的键总是注册着，一下真按键会从窗口的 keydown 和菜单栏两条路都到：只跑一次，不来回抵消；
 * - ⌃\ 是中间栏分屏，不是占满；菜单栏、按钮提示、设置 › 快捷键写的都是 ⌃⌘\。
 * 主窗口里用 Playwright 的真按键，网页里从主进程往网页送真的按键（Playwright 的键盘到不了 webview 里）。
 */
import { expect, type Page, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { acts, launch, leftView, openNote, pane, type Running, tabOn } from './app'
import { skinned } from './fixtures/book-digest'
import { shotWindow } from './shots'
import { type Ctx, KEY_FILES, type KeyRun, openWeb, press } from './keys-checks'

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(
      '<title>6.1 从全连接层到卷积</title><body style="font:17px/1.7 -apple-system,sans-serif;padding:24px 40px;max-width:760px;margin:auto"><h1>6.1 从全连接层到卷积</h1>' +
        '<p>多层感知机处理表格数据很合适：行是样本，列是特征。到了图像，每个像素都是一个特征，一张百万像素的照片接一个一千单元的隐藏层，光这一层就有十亿个参数。</p>' +
        '<h2>6.1.1 不变性</h2><p>平移不变性：不管猫在图片的哪个位置，检测它的那组权重都应该一样。局部性：判断某个位置有什么，只需要看它周围一小块。</p>' +
        '<p>把这两条写进模型，全连接层就变成了卷积层：一个小窗口在图上滑动，每到一处把窗口里的像素和卷积核对应相乘再加起来。</p></body>',
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const center = (page: Page) => page.locator('.win > main.center')
/** 网页那一组组头最右的「占满」（每一栏都能占满起，标题栏那颗拿掉了） */
const tbWeb = (page: Page) => page.locator('.dhead:has([data-testid="dtab-web"]) .maxbtn')
const win = (page: Page) => page.locator('.win')
const KEY = '⌃⌘\\'

/** 照用户截图摆：中间文档，右边网页一栏、AI 一栏 */
async function layout(run: Running): Promise<KeyRun> {
  const { page } = run
  // 软件退出前会把手上的布局写回去：在页面脚本跑之前放好
  await page.addInitScript(() =>
    localStorage.setItem(
      'cn.dock',
      JSON.stringify({ v: 1, cols: [{ id: 'center' }, { id: 'c1', w: 420, groups: [{ id: 'g1', views: ['web'], active: 'web', f: 1 }] }, { id: 'c2', w: 360, groups: [{ id: 'g2', views: ['ai'], active: 'ai', f: 1 }] }], floats: [], hidden: null }),
    ),
  )
  // 和用户截图一样宽，三栏放得下（窗口不上屏）
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000))
  await page.reload()
  await expect(page.getByRole('textbox', { name: '问 AI' })).toBeVisible()
  const k = { run, base }
  await leftView(page, '最近')
  await openNote(page, '草稿')
  await openWeb(page, `${base}/`)
  await expect(page.getByRole('textbox', { name: '问 AI' })).toBeVisible()
  await expect(tbWeb(page)).toBeVisible()
  return k
}

/**
 * 摆好这种焦点（不按 esc：AI 输入框有焦点时 esc 收起 AI 那一栏；keys-checks 的 focusCtx 会按）。
 * 网页那种由 press 让网页拿焦点（主进程 wc.focus）
 */
async function focusIn(page: Page, ctx: Ctx) {
  if (ctx === 'editor' || ctx === 'board') {
    const want = ctx === 'editor' ? '草稿' : '路线'
    if ((await tabOn(page).textContent()) !== want) await openNote(page, want)
    const tab = acts(page).getByRole('tab', { name: ctx === 'editor' ? '文档' : '白板' })
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click()
    if (ctx === 'editor') {
      await pane(page).locator('.cm-content').click()
      await expect(pane(page).locator('.cm-content')).toBeFocused()
    } else {
      const board = pane(page).getByTestId('doc-board')
      await expect(board).toBeVisible()
      const b = (await board.boundingBox())!
      await page.mouse.click(b.x + b.width - 30, b.y + b.height - 30)
    }
  } else if (ctx === 'ai') {
    const ask = page.getByRole('textbox', { name: '问 AI' })
    await ask.click()
    await expect(ask).toBeFocused()
  }
}

/** 菜单栏「显示 › 网页占满 / 还原」：真按键时 macOS 菜单栏也接到这一下（和 accelerator 一样从主进程点它） */
/** 菜单栏那一项跑一次：byKey 是按键触发的（真按 ⌃⌘\ 时菜单栏收到的那一下，triggeredByAccelerator），否则是鼠标点的 */
const clickMenuItem = (run: Running, byKey = true) =>
  run.app.evaluate(({ Menu }, byKey) => {
    const find = (m: Electron.Menu): Electron.MenuItem | null => {
      for (const i of m.items) {
        if (i.label === '当前这栏占满 / 还原') return i
        const s = i.submenu && find(i.submenu)
        if (s) return s
      }
      return null
    }
    const it = find(Menu.getApplicationMenu()!)!
    it.click({ triggeredByAccelerator: byKey } as unknown as Electron.KeyboardEvent)
    return it.accelerator
  }, byKey)

test('⌃⌘\\ 在网页、文档、白板、AI 输入框里都能进网页占满、再按还原；⌃\\ 是分屏', async () => {
  test.setTimeout(150_000)
  const run = await launch(KEY_FILES)
  try {
    const { page } = run
    const k = await layout(run)
    // 写着的键和实际一致：按钮、按钮提示、菜单栏
    await expect(tbWeb(page)).toHaveAttribute('data-key', KEY)
    const accel = await run.app.evaluate(({ Menu }) => {
      const show = Menu.getApplicationMenu()!.items.find((i) => i.label === '显示')!.submenu!
      return show.items.find((i) => i.label === '当前这栏占满 / 还原')?.accelerator
    })
    expect(accel).toBe('Control+Command+\\')

    for (const ctx of ['web', 'editor', 'board', 'ai'] as Ctx[]) {
      await test.step(ctx, async () => {
        await focusIn(page, ctx)
        await expect(center(page)).not.toHaveClass(/folded/)
        await press(k, ctx, KEY)
        // 每一栏都能占满起：占满的是焦点所在那一栏
        const name = { web: '网页', editor: '草稿', board: '路线', ai: 'AI' }[ctx]
        await expect(page.getByTestId('max-hint')).toHaveText(`${name} 占满 · ${KEY} 或 Esc 回去`)
        if (ctx === 'web') await expect(tbWeb(page)).toHaveAccessibleName('还原')
        await press(k, ctx, KEY)
        await expect(win(page)).not.toHaveClass(/maxed/)
        await expect(tbWeb(page)).toHaveAccessibleName('占满：网页')
      })
    }

    // ⌃\：中间栏分屏，不占满
    await focusIn(page, 'editor')
    await page.keyboard.press('Control+Backslash')
    await expect(center(page)).toHaveClass(/\bsplit\b/)
    await expect(win(page)).not.toHaveClass(/maxed/)
    await page.keyboard.press('Control+Backslash')
    await expect(center(page)).not.toHaveClass(/\bsplit\b/)
  } finally {
    await run.close()
  }
})

test('一下 ⌃⌘\\ 从窗口和菜单栏两条路都到（macOS 真按键的样子）：只占满一次，不来回抵消', async () => {
  test.setTimeout(120_000)
  const run = await launch(KEY_FILES)
  try {
    const { page } = run
    const k = await layout(run)

    // 文档里按住 ⌃⌘\：keydown 到了窗口，菜单栏那一项也跑了，才松开
    await focusIn(page, 'editor')
    for (const step of ['in', 'out'] as const) {
      await page.keyboard.down('Control')
      await page.keyboard.down('Meta')
      await page.keyboard.down('Backslash')
      expect(await clickMenuItem(run)).toBe('Control+Command+\\')
      await page.keyboard.up('Backslash')
      await page.keyboard.up('Meta')
      await page.keyboard.up('Control')
      if (step === 'in') await expect(win(page)).toHaveClass(/maxed/)
      else await expect(win(page)).not.toHaveClass(/maxed/)
      await page.waitForTimeout(150)
      if (step === 'in') await expect(win(page)).toHaveClass(/maxed/)
      else await expect(win(page)).not.toHaveClass(/maxed/)
    }

    // 网页里按住：网页转回来的那一下和菜单栏那一下（真按键时菜单栏收不到，这里先后不定也只算一次），只算一次；马上再按一次照样还原
    const id = await page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())
    const inWeb = (type: 'keyDown' | 'keyUp') =>
      run.app.evaluate(({ webContents }, { id, type }) => {
        const wc = webContents.fromId(id)!
        wc.focus()
        wc.sendInputEvent({ type, keyCode: '\\', modifiers: ['control', 'meta'] })
      }, { id, type })
    await inWeb('keyDown')
    await clickMenuItem(run)
    await inWeb('keyUp')
    await expect(win(page)).toHaveClass(/maxed/)
    await page.waitForTimeout(150)
    await expect(win(page)).toHaveClass(/maxed/)
    await inWeb('keyDown')
    await inWeb('keyUp')
    await expect(win(page)).not.toHaveClass(/maxed/)

    // 只点菜单栏（没按键）：照样开关，紧接着连点两下各算一次
    await page.waitForTimeout(450)
    await clickMenuItem(run, false)
    await expect(win(page)).toHaveClass(/maxed/)
    await clickMenuItem(run, false)
    await expect(win(page)).not.toHaveClass(/maxed/)
    // 刚按完键马上用鼠标点菜单栏：鼠标点的不和按键算一对，照样跑（按完 ⌘W 马上点「文件 › 关闭」也一样）
    await page.keyboard.press('Control+Meta+Backslash')
    await expect(win(page)).toHaveClass(/maxed/)
    await clickMenuItem(run, false)
    await expect(win(page)).not.toHaveClass(/maxed/)
  } finally {
    await run.close()
  }
})

// 交付截图（只在给了 CN_SHOTS 时跑）：薄荷主题、B 风格，真按 ⌃⌘\ 占满以后的样子
test('截图：薄荷主题下按 ⌃⌘\ 网页占满', async () => {
  test.skip(!process.env.CN_SHOTS, '截交付图才跑：CN_SHOTS=<目录>')
  test.setTimeout(90_000)
  const run = await launch(KEY_FILES, {}, skinned('mint'))
  try {
    const { page } = run
    await layout(run)
    await page.locator('.titlebar').click({ position: { x: 400, y: 10 } })
    await page.keyboard.press('Control+Meta+Backslash')
    await expect(center(page)).toHaveClass(/folded/)
    await expect(tbWeb(page)).toHaveAccessibleName('还原')
    await shotWindow(run, '网页占满-薄荷')
  } finally {
    await run.close()
  }
})
