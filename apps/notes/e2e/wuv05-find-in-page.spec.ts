import { expect, type Locator, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { launch, pane, rail, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

// 全软件统一「在这一页里找」= ⇧⌘F（2026-11-22 用户：「Shift command+F 在当前页面找 然后呢 command+F就是全局」）：
// 焦点在哪一栏就找哪一栏——文档、白板、PDF、右栏网页、中间栏的宽网页；导图的在 wuv05-mindmap-b2.spec.ts。
// 菜单栏「编辑 › 在这一页里找」点了一样；⌘F 照旧开全库搜索。都是真按键。

const NOTE = `# 线性代数复习

矩阵乘法就是线性映射的复合。

<!-- 这里的矩阵不该找到 -->
同一个矩阵，换一组基写出来不一样。

最后一句：矩阵。
`
const BOARD = `---
type: board
---
# 复习白板

## 第一列

讲矩阵乘法的一张卡。

一张别的卡。

## 第二列

又一个矩阵。
`
const PDF = '课程/线代/第3讲.pdf'
const FILES = { '线代复习.md': NOTE, '复习白板.md': BOARD, [PDF]: LECTURE }

const bar = (page: Page) => page.getByTestId('find-bar')
const count = (page: Page) => bar(page).getByTestId('find-count')
const read = (run: Running, p: string) => readFileSync(join(run.vault, p), 'utf8')

async function open(page: Page, name: string, tab = name) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(tab)
}

/**
 * 焦点在网页里时按键：照真键盘走的那条路，从这个网页的 webContents 进（sendInputEvent，主进程 before-input-event 认出软件的键转给界面）。
 * page.keyboard 是 DevTools 发的键，网页拿着焦点时直接进了网页、不经过 before-input-event，主进程转不了；
 * 网页还在载入、焦点没进去时又落在外面那一页上自己接住。所以以前「中间宽网页第一次 ⇧⌘F 偶尔不出」只看那一刻焦点进没进网页；
 * 真键盘的键走 before-input-event（和 sendInputEvent 同一条），焦点在网页里时照样转给界面
 */
async function pressInWeb(run: Running, webview: Locator, key: string, modifiers: ('meta' | 'shift')[]) {
  const id = await webview.evaluate((w) => (w as unknown as { getWebContentsId(): number }).getWebContentsId())
  await run.app.evaluate(
    ({ webContents }, [wid, k, mods]) => {
      const wc = webContents.fromId(wid as number)!
      wc.sendInputEvent({ type: 'keyDown', keyCode: k as string, modifiers: mods as ('meta' | 'shift')[] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k as string, modifiers: mods as ('meta' | 'shift')[] })
    },
    [id, key, modifiers] as const,
  )
}

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>测试网页</title><body style="font:16px sans-serif;padding:20px"><h1>线性映射</h1><p>矩阵是线性映射的表。</p><p>再说一次矩阵。</p><p>最后一个矩阵。</p></body>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

test('文档：⇧⌘F 出找的条（注释里的不算），↵ / ⇧↵ 走，替换一处、全部替换（⌘Z 一下撤回）；esc 关掉光标回正文；⌘F 照旧是全库搜索', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    await open(page, '线代复习')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+Shift+F')
    await expect(bar(page)).toBeVisible()
    await expect(bar(page).getByRole('textbox', { name: '在这一篇里找' })).toBeFocused()
    await page.keyboard.type('矩阵')
    // 正文里 3 处（HTML 注释里那一处不算）
    await expect(count(page)).toHaveText('1/3')
    await expect(pane(page).locator('.cm-find')).toHaveCount(3)
    await expect(pane(page).locator('.cm-find-cur')).toHaveText('矩阵')
    await page.keyboard.press('Enter')
    await expect(count(page)).toHaveText('2/3')
    await page.keyboard.press('Shift+Enter')
    await expect(count(page)).toHaveText('1/3')
    // 替换一处：换掉第一处，下一处顶上来
    await bar(page).getByRole('textbox', { name: '换成' }).fill('Matrix')
    await bar(page).getByRole('button', { name: '替换', exact: true }).click()
    await expect.poll(() => read(run, '线代复习.md')).toContain('Matrix乘法就是线性映射的复合。')
    await expect(count(page)).toHaveText('1/2')
    // 全部替换：一次改动
    await bar(page).getByRole('button', { name: '全部替换' }).click()
    await expect.poll(() => read(run, '线代复习.md')).toBe(NOTE.replace('矩阵乘法', 'Matrix乘法').replace('同一个矩阵', '同一个Matrix').replace('最后一句：矩阵', '最后一句：Matrix'))
    await expect(count(page)).toHaveText('0')
    // esc 关掉：光标回正文；⌘Z 一下撤回全部替换
    await page.keyboard.press('Escape')
    await expect(bar(page)).toHaveCount(0)
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run, '线代复习.md')).toBe(NOTE.replace('矩阵乘法', 'Matrix乘法'))
    // ⌘F 照旧开全库搜索
    await page.keyboard.press('Meta+f')
    await expect(page.getByRole('dialog', { name: '搜索和命令' })).toBeVisible()
    await page.keyboard.press('Escape')
    // 菜单栏「编辑 › 在这一页里找」：写着 ⇧⌘F，点了一样
    const item = await run.app.evaluate(({ Menu }) => {
      const edit = Menu.getApplicationMenu()!.items.find((i) => i.label === '编辑')!
      const it = edit.submenu!.items.find((i) => i.label === '在这一页里找')!
      return { accel: it.accelerator, labels: edit.submenu!.items.map((i) => i.label || i.role) }
    })
    expect(item.accel).toBe('Shift+Command+F')
    expect(item.labels).toContain('Copy')
    await pane(page).locator('.cm-content').click()
    await run.app.evaluate(({ Menu, BrowserWindow }) => {
      const edit = Menu.getApplicationMenu()!.items.find((i) => i.label === '编辑')!
      edit.submenu!.items.find((i) => i.label === '在这一页里找')!.click(undefined, BrowserWindow.getAllWindows()[0], undefined)
    })
    await expect(bar(page)).toBeVisible()
  } finally {
    await run.close()
  }
})

test('白板：⇧⌘F 找卡片里的字，跳到那张卡、闪一下；⇧⌘F 改了键也跟着（设置 › 快捷键）', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    await open(page, '复习白板')
    const board = pane(page).getByTestId('doc-board')
    await expect(board.locator('.db-card')).toHaveCount(3)
    await board.focus()
    await page.keyboard.press('Meta+Shift+F')
    await expect(bar(page)).toBeVisible()
    await page.keyboard.type('矩阵')
    await expect(count(page)).toHaveText('1/2')
    const first = board.locator('.db-card', { hasText: '讲矩阵乘法的一张卡' })
    await expect(first).toHaveClass(/cn-find-flash/)
    await page.keyboard.press('Enter')
    await expect(count(page)).toHaveText('2/2')
    await expect(board.locator('.db-card', { hasText: '又一个矩阵' })).toHaveClass(/cn-find-flash/)
    // CSS 高亮：两处都标着，当前一处
    const hl = await page.evaluate(() => {
      const reg = (CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights
      return { all: reg.get('cn-find')?.size ?? 0, cur: [...(reg.get('cn-find-cur') ?? [])].map((r) => r.toString()) }
    })
    expect(hl).toEqual({ all: 2, cur: ['矩阵'] })
    await page.keyboard.press('Escape')
    await expect(bar(page)).toHaveCount(0)
    expect(await page.evaluate(() => (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has('cn-find'))).toBe(false)

    // 改键：设置 › 快捷键「在这一页里找」改成 ⌥⇧⌘F，新键能用、旧键不再开
    await page.keyboard.press('Meta+Comma')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
    const row = dlg.locator('[data-row="k-cmd-find-in-page"]')
    await expect(row).toContainText('在这一页里找')
    await row.getByRole('button', { name: '改 在这一页里找 的快捷键' }).click()
    await page.keyboard.press('Alt+Shift+Meta+KeyF')
    await expect(row.locator('.sa-keyb')).toHaveText('⌥⇧⌘F')
    // 第一下 esc 退出按键框，第二下关设置
    await page.keyboard.press('Escape')
    if (await dlg.count()) await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    expect(await page.evaluate(() => (window as unknown as { cnKeys: { keysFor(id: string): string[] } }).cnKeys.keysFor('find-in-page'))).toEqual(['⌥⇧⌘F'])
    await board.focus()
    await page.keyboard.press('Meta+Shift+F')
    await page.waitForTimeout(300)
    await expect(bar(page)).toHaveCount(0)
    await page.keyboard.press('Alt+Shift+Meta+KeyF')
    await expect(bar(page)).toBeVisible()
  } finally {
    await run.close()
  }
})

test('PDF：⇧⌘F 读各页的字找，「1/2」，↵ 跳到那一页，文字层上铺淡底；esc 关掉清掉', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    const pdf = page.locator('.pdfpane:not([hidden])')
    await expect(pdf.locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.getByTestId('pdf-view').focus()
    await page.keyboard.press('Meta+Shift+F')
    await expect(bar(page)).toBeVisible()
    // 「rotated」只在第 3 页，两处
    await page.keyboard.type('rotated')
    await expect(count(page)).toHaveText('1/2')
    await expect(pdf.locator('.pdfpage[data-page="3"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await expect
      .poll(() => page.evaluate(() => [...((CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('cn-find-cur') ?? [])].map((r) => r.toString())))
      .toEqual(['rotated'])
    // 当前那一处在看得见的地方
    const pos = await page.evaluate(() => {
      const r = [...(CSS as unknown as { highlights: Map<string, Set<Range>> }).highlights.get('cn-find-cur')!][0]!.getBoundingClientRect()
      const v = document.querySelector('.pdfpane:not([hidden]) [data-testid="pdf-view"]')!.getBoundingClientRect()
      return r.top >= v.top && r.bottom <= v.bottom
    })
    expect(pos).toBe(true)
    await page.keyboard.press('Enter')
    await expect(count(page)).toHaveText('2/2')
    // 「linear」好几页都有
    await bar(page).getByRole('textbox').fill('linear')
    await expect(count(page)).toHaveText(/^1\/[3-9]$/)
    await page.keyboard.press('Escape')
    await expect(bar(page)).toHaveCount(0)
    expect(await page.evaluate(() => (CSS as unknown as { highlights: Map<string, unknown> }).highlights.has('cn-find'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('网页：焦点在右栏网页里按 ⇧⌘F 找的是网页（不是中间的文档），「1/3」、↵ 下一处；中间栏的宽网页也一样', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    await open(page, '线代复习')
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    const addr = web.getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/a`)
    await addr.press('Enter')
    await expect(web.getByRole('tablist', { name: '网页标签' }).getByRole('tab').first()).toContainText('测试网页')
    // 点进网页正文：焦点在网页里
    const box = (await web.locator('webview.on').boundingBox())!
    await page.mouse.click(box.x + 200, box.y + 160)
    await pressInWeb(run, web.locator('webview.on'), 'F', ['meta', 'shift'])
    const wbar = web.getByTestId('find-bar')
    await expect(wbar).toBeVisible()
    await expect(pane(page).getByTestId('find-bar')).toHaveCount(0)
    await page.keyboard.type('矩阵')
    // 网页自己从点过的地方往下找：第几处看点在哪，一共 3 处
    await expect(wbar.getByTestId('find-count')).toHaveText(/^[123]\/3$/)
    const n0 = Number((await wbar.getByTestId('find-count').textContent())!.split('/')[0])
    // 网页找的时候焦点被拿走又放回框里：接着打字不丢
    await expect(wbar.getByRole('textbox')).toBeFocused()
    await expect(wbar.getByRole('textbox')).toHaveValue('矩阵')
    await page.keyboard.press('Enter')
    await expect(wbar.getByTestId('find-count')).toHaveText(`${(n0 % 3) + 1}/3`)
    await page.keyboard.press('Shift+Enter')
    await expect(wbar.getByTestId('find-count')).toHaveText(`${n0}/3`)
    await page.keyboard.press('Escape')
    await expect(wbar).toHaveCount(0)

    // 中间栏的宽网页（task-05p2w 起在网页 ⋯ 里「在中间开成一页」；标题栏那颗是「网页占满」）
    await web.getByRole('button', { name: '更多', exact: true }).click()
    await web.getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name: /在中间开成一页/ }).click()
    const wide = page.locator('.wpane:not([hidden])')
    await expect(wide.locator('webview')).toBeVisible({ timeout: 15_000 })
    // 点进中间这个网页：焦点在它上面（不是右栏那个）再按
    const wb = (await wide.locator('webview').boundingBox())!
    await page.mouse.click(wb.x + 200, wb.y + 160)
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.wpane'))).toBe(true)
    const cbar = wide.getByTestId('find-bar')
    // 按一下就出（以前「没出来就再按一下」：见 pressInWeb）
    await pressInWeb(run, wide.locator('webview'), 'F', ['meta', 'shift'])
    await expect(cbar).toBeVisible()
    await page.keyboard.type('矩阵')
    await expect(cbar.getByTestId('find-count')).toHaveText(/^[123]\/3$/)
    await page.keyboard.press('Escape')
    await expect(cbar).toHaveCount(0)
  } finally {
    await run.close()
  }
})
