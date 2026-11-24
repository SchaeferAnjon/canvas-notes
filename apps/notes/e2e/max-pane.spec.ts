/**
 * 每一栏都能占满（用户 2026-11-24「每个框都能占满」，截图：左边白板、中间网页、右边 AI 各一栏）：
 * - 每栏标签条最右一颗「占满」：点了这一栏盖住整个窗口，别的栏看不见；再点、点顶上提示、Esc 回原样，别的栏宽度、滚动位置照旧；
 * - ⌃⌘\ 占满当前这栏（焦点在网页里也行），双击标签条空处也占满；
 * - 分屏两格各能占满一格；占满时按 ⌃\ 先回原样再分屏，⌘\ 先回原样再开关左栏；
 * - Esc 在编辑器、输入框里不算（那是打字的）。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { acts, launch, leftView, openNote, pane, type Running } from './app'
import { skinned } from './fixtures/book-digest'
import { shotWindow } from './shots'
import { KEY_FILES, openWeb, pressInWeb } from './keys-checks'

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const p = Array.from({ length: 40 }, (_, i) => `<p>第 ${i + 1} 段：把平移不变性和局部性写进模型，全连接层就变成了卷积层，一个小窗口在图上滑动。</p>`).join('')
    res.end(`<title>6.1 从全连接层到卷积</title><body style="font:17px/1.7 -apple-system,sans-serif;padding:24px 40px;max-width:760px;margin:auto"><h1>6.1 从全连接层到卷积</h1><input id="q" placeholder="搜">${p}</body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const center = (page: Page) => page.locator('.win > main.center')
const col = (page: Page, id: string) => page.locator(`.dcol[data-col="${id}"]`)
const hint = (page: Page) => page.getByTestId('max-hint')
const webview = (page: Page) => page.locator('.win > .dview[data-view="web"]')
const aiView = (page: Page) => page.locator('.win > .dview[data-view="ai"]')
const side = (page: Page) => page.locator('.win > .side')
const KEY = '⌃⌘\\'
const w = async (l: Locator) => Math.round((await l.boundingBox())!.width)
const inWeb = <R,>(page: Page, js: string) => page.evaluate((js) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<R> }).executeJavaScript(js), js)

/** 照用户截图摆：中间（白板、文档）在最左，网页一栏，AI 一栏；左栏开着 */
async function layout(run: Running) {
  const { page } = run
  await page.addInitScript(() =>
    localStorage.setItem(
      'cn.dock',
      JSON.stringify({ v: 1, cols: [{ id: 'center' }, { id: 'c1', w: 460, groups: [{ id: 'g1', views: ['web'], active: 'web', f: 1 }] }, { id: 'c2', w: 380, groups: [{ id: 'g2', views: ['ai'], active: 'ai', f: 1 }] }], floats: [], hidden: null }),
    ),
  )
  // 中间留 500 来宽（挤到最窄 420 时中间那颗收起，见 max.css）
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1700, 1000))
  await page.reload()
  await expect(page.getByRole('textbox', { name: '问 AI' })).toBeVisible()
  await leftView(page, '最近')
  await openNote(page, '草稿')
  await openWeb(page, `${base}/`)
}

/** 各栏现在多宽（左栏、中间、网页那栏、AI 那栏、两样内容） */
const widths = async (page: Page) => ({ side: await w(side(page)), center: await w(center(page)), c1: await w(col(page, 'c1')), c2: await w(col(page, 'c2')), web: await w(webview(page)), ai: await w(aiView(page)) })
/** 窗口里能给各栏的宽：左栏左边到最后一栏右边 */
const area = async (page: Page) => {
  const s = (await side(page).boundingBox())!
  const c = (await col(page, 'c2').boundingBox())!
  return Math.round(c.x + c.width - s.x)
}

test('三栏各点「占满」再回去：占满的盖住整个窗口、别的看不见，顶上有提示；回去宽度、网页滚动位置照旧；点按钮、点提示、Esc 都能回去', async () => {
  test.setTimeout(150_000)
  const run = await launch(KEY_FILES)
  try {
    const { page } = run
    await layout(run)
    await inWeb(page, 'scrollTo(0, 600)')
    await expect.poll(() => inWeb<number>(page, 'Math.round(scrollY)')).toBe(600)
    const was = await widths(page)
    const full = await area(page)
    expect(was.c1).toBe(460)

    // 中间（截图里最左那栏）：按钮在标签条最右，提示写着键
    const cBtn = page.getByTestId('max-center-0')
    await expect(cBtn).toHaveAccessibleName('占满：中间这栏')
    await expect(cBtn).toHaveAttribute('data-key', KEY)
    await cBtn.click()
    await expect(page.locator('.win')).toHaveClass(/maxed/)
    await expect.poll(() => w(center(page))).toBeGreaterThan(full - 4)
    await expect(col(page, 'c1')).toBeHidden()
    await expect(col(page, 'c2')).toBeHidden()
    await expect(webview(page)).toBeHidden()
    await expect(side(page)).toBeHidden()
    await expect(hint(page)).toBeVisible()
    await expect(hint(page)).toHaveText(`草稿 占满 · ${KEY} 或 Esc 回去`)
    // 提示在占满那一栏上面，不压住它
    expect((await hint(page).boundingBox())!.y + 20).toBeLessThanOrEqual((await center(page).boundingBox())!.y + 4)
    await expect(cBtn).toHaveAccessibleName('还原')
    await cBtn.click()
    await expect(hint(page)).toHaveCount(0)
    expect(await widths(page)).toEqual(was)

    // 网页那一组：组头最右那颗；占满以后网页宽成整个窗口，中间、AI 让开；点顶上提示回去
    await page.getByTestId('max-g1').click()
    await expect.poll(() => w(webview(page))).toBeGreaterThan(full - 4)
    await expect(center(page)).toBeHidden()
    await expect(center(page)).toHaveClass(/folded/)
    await expect(aiView(page)).toBeHidden()
    await expect(hint(page)).toHaveText(`网页 占满 · ${KEY} 或 Esc 回去`)
    await hint(page).click()
    await expect(hint(page)).toHaveCount(0)
    expect(await widths(page)).toEqual(was)
    await expect.poll(() => inWeb<number>(page, 'Math.round(scrollY)')).toBe(600)

    // AI 那一组：占满，Esc（焦点在刚点的按钮上，不是输入框）回去；网页没跟着变宽、滚动位置照旧
    await page.getByTestId('max-g2').click()
    await expect.poll(() => w(aiView(page))).toBeGreaterThan(full - 4)
    await expect(webview(page)).toBeHidden()
    await expect(hint(page)).toHaveText(`AI 占满 · ${KEY} 或 Esc 回去`)
    expect(await w(webview(page))).toBe(was.web)
    await page.keyboard.press('Escape')
    await expect(hint(page)).toHaveCount(0)
    expect(await widths(page)).toEqual(was)
    expect(await inWeb<number>(page, 'Math.round(scrollY)')).toBe(600)
  } finally {
    await run.close()
  }
})

test('⌃⌘\\ 占满当前这栏（焦点在网页里也行）；网页里按 Esc 回去，网页输入框里按的不算；编辑器里 Esc 不算；双击标签条空处占满', async () => {
  test.setTimeout(150_000)
  const run = await launch(KEY_FILES)
  try {
    const { page } = run
    await layout(run)
    const was = await widths(page)

    // 焦点在网页里：真按键从主进程送进网页，转回来占满网页那一组
    await pressInWeb(run, KEY)
    await expect(center(page)).toHaveClass(/folded/)
    await expect(hint(page)).toHaveText(`网页 占满 · ${KEY} 或 Esc 回去`)
    await expect(aiView(page)).toBeHidden()
    // 网页的输入框里按 Esc：是网页自己的，不回去
    await inWeb(page, "document.getElementById('q').focus()")
    await pressInWeb(run, 'Escape')
    await page.waitForTimeout(600)
    await expect(hint(page)).toBeVisible()
    // 焦点在网页正文：Esc 回去
    await inWeb(page, "document.activeElement.blur()")
    await pressInWeb(run, 'Escape')
    await expect(hint(page)).toHaveCount(0)
    expect(await widths(page)).toEqual(was)

    // 焦点在文档编辑器里按 ⌃⌘\：占满中间；Esc 是编辑器的，不回去；再按 ⌃⌘\ 回去
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Control+Meta+Backslash')
    await expect(hint(page)).toHaveText(`草稿 占满 · ${KEY} 或 Esc 回去`)
    await expect(col(page, 'c1')).toBeHidden()
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await expect(hint(page)).toBeVisible()
    await page.keyboard.press('Control+Meta+Backslash')
    await expect(hint(page)).toHaveCount(0)
    expect(await widths(page)).toEqual(was)

    // 焦点在 AI 输入框里按 ⌃⌘\：占满 AI 那一组
    await page.getByRole('textbox', { name: '问 AI' }).click()
    await page.keyboard.press('Control+Meta+Backslash')
    await expect(hint(page)).toHaveText(`AI 占满 · ${KEY} 或 Esc 回去`)
    await page.keyboard.press('Control+Meta+Backslash')
    await expect(hint(page)).toHaveCount(0)

    // 双击中间标签条空处：占满；再双击回去（按住拖整栏是按下挪过才算，两下点不会拖）
    // 空处：最后一个标签右边（窗口放宽，中间的标签条上留出空处）
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(2000, 1000))
    const list = page.getByTestId('tab-list')
    const empty = async () => {
      const lb = (await list.boundingBox())!
      const last = (await list.locator('.tab').last().boundingBox())!
      expect(lb.x + lb.width - (last.x + last.width)).toBeGreaterThan(40)
      return { x: (last.x + last.width + lb.x + lb.width) / 2, y: lb.y + lb.height / 2 }
    }
    const was2 = await widths(page)
    let at = await empty()
    await page.mouse.dblclick(at.x, at.y)
    await expect(hint(page)).toHaveText(`草稿 占满 · ${KEY} 或 Esc 回去`)
    at = await empty()
    await page.mouse.dblclick(at.x, at.y)
    await expect(hint(page)).toHaveCount(0)
    expect(await widths(page)).toEqual(was2)
    // 双击 AI 那一组组头空处
    const space = col(page, 'c2').locator('.dspace')
    await space.dblclick()
    await expect(hint(page)).toHaveText(`AI 占满 · ${KEY} 或 Esc 回去`)
    await space.dblclick()
    await expect(hint(page)).toHaveCount(0)
    // 布局没被当成拖整栏挪过
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cn.dock')!).cols.map((c: { id: string }) => c.id))).toEqual(['center', 'c1', 'c2'])
    expect(await widths(page)).toEqual(was2)
    await expect(page.getByTestId('tab-list').locator('.tab')).toHaveCount(2)
  } finally {
    await run.close()
  }
})

test('分屏两格各占满一格，回去分屏比例照旧；占满时 ⌃\\ 先回原样再分屏、⌘\\ 先回原样再收左栏', async () => {
  test.setTimeout(150_000)
  const run = await launch(KEY_FILES)
  try {
    const { page } = run
    await layout(run)
    // 分成两格还要放得下各自的标签条：窗口再宽一点
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(2000, 1000))
    // 占满时按 ⌃\：回原样、分成两格
    await page.getByTestId('max-g2').click()
    await expect(hint(page)).toBeVisible()
    await page.keyboard.press('Control+Backslash')
    await expect(hint(page)).toHaveCount(0)
    await expect(center(page)).toHaveClass(/split/)
    await expect(col(page, 'c2')).toBeVisible()

    const strip = (p: 0 | 1) => page.locator(`.win > main.center > .tabs.p${p}`)
    const was = { a: await w(strip(0)), b: await w(strip(1)), split: await center(page).evaluate((e) => e.style.getPropertyValue('--split')), ...(await widths(page)) }
    for (const p of [0, 1] as const) {
      const btn = page.getByTestId(`max-center-${p}`)
      await expect(btn).toHaveAccessibleName(p === 0 ? '占满：左边这格' : '占满：右边这格')
      await btn.click()
      await expect(hint(page)).toBeVisible()
      await expect.poll(() => w(strip(p))).toBeGreaterThan((await area(page)) - 4)
      await expect(strip(p === 0 ? 1 : 0)).toBeHidden()
      await expect(col(page, 'c1')).toBeHidden()
      // 那一格的内容也铺满
      await expect.poll(() => w(page.locator(`.win > main.center > .cslot.p${p}:not([hidden])`).first())).toBeGreaterThan((await area(page)) - 4)
      await btn.click()
      await expect(hint(page)).toHaveCount(0)
      expect({ a: await w(strip(0)), b: await w(strip(1)), split: await center(page).evaluate((e) => e.style.getPropertyValue('--split')), ...(await widths(page)) }).toEqual(was)
    }

    // 占满时 ⌘\：回原样、左栏收起
    await page.getByTestId('max-center-0').click()
    await expect(hint(page)).toBeVisible()
    await page.keyboard.press('Meta+Backslash')
    await expect(hint(page)).toHaveCount(0)
    await expect(side(page)).toBeHidden()
    await expect(page.locator('.win')).toHaveClass(/side-hidden/)
    // 占满时 ⌥⌘\：回原样、右边几栏收起
    await page.getByTestId('max-center-1').click()
    await expect(hint(page)).toBeVisible()
    await page.keyboard.press('Alt+Meta+Backslash')
    await expect(hint(page)).toHaveCount(0)
    await expect(col(page, 'c1')).toHaveCount(0)
    await expect(center(page)).toBeVisible()
  } finally {
    await run.close()
  }
})

test('浮窗也能占满：盖住整个窗口、不能拖也不能拉大小；回去还在原来的位置、原来的大小', async () => {
  test.setTimeout(120_000)
  const run = await launch(KEY_FILES)
  try {
    const { page } = run
    await page.addInitScript(() =>
      localStorage.setItem(
        'cn.dock',
        JSON.stringify({ v: 1, cols: [{ id: 'center' }, { id: 'c1', w: 460, groups: [{ id: 'g1', views: ['web'], active: 'web', f: 1 }] }], floats: [{ id: 'f1', views: ['ai'], active: 'ai', x: 700, y: 160, w: 400, h: 520 }], hidden: null }),
      ),
    )
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 1000))
    await page.reload()
    await expect(page.getByRole('textbox', { name: '问 AI' })).toBeVisible()
    const box = page.locator('.dfloat[data-group="f1"]')
    const was = (await box.boundingBox())!
    const cBox = (await center(page).boundingBox())!
    const c1 = (await col(page, 'c1').boundingBox())!
    await page.getByTestId('max-f1').click()
    await expect(hint(page)).toHaveText(`AI 占满 · ${KEY} 或 Esc 回去`)
    const full = (await box.boundingBox())!
    expect(Math.round(full.x)).toBeLessThanOrEqual(Math.round(cBox.x) + 1)
    expect(Math.round(full.x + full.width)).toBeGreaterThanOrEqual(Math.round(c1.x + c1.width) - 1)
    await expect.poll(() => w(aiView(page))).toBeGreaterThan(Math.round(c1.x + c1.width - cBox.x) - 8)
    await expect(box.locator('.drz')).toBeHidden()
    await expect(webview(page)).toBeHidden()
    await expect(center(page)).toBeHidden()
    await page.getByTestId('max-f1').click()
    await expect(hint(page)).toHaveCount(0)
    expect(await box.boundingBox()).toEqual(was)
  } finally {
    await run.close()
  }
})

// 交付截图（只在给了 CN_SHOTS 时跑）：薄荷、深湖，B 风格，右栏（AI）占满、最左那栏（中间的白板）占满
for (const [skin, name] of [['mint', '薄荷'], ['petrol', '深湖']] as const) {
  test(`截图：${name}主题下右栏占满、左栏占满`, async () => {
    test.skip(!process.env.CN_SHOTS, '截交付图才跑：CN_SHOTS=<目录>')
    test.setTimeout(120_000)
    const run = await launch(KEY_FILES, {}, skinned(skin as 'mint'))
    try {
      const { page } = run
      await layout(run)
      // 照用户截图：最左那栏是白板，左栏收着
      await openNote(page, '路线')
      const board = acts(page).getByRole('tab', { name: '白板' })
      if ((await board.getAttribute('aria-selected')) !== 'true') await board.click()
      await page.locator('.titlebar').click({ position: { x: 400, y: 10 } })
      await page.keyboard.press('Meta+Backslash')
      await expect(side(page)).toBeHidden()
      await shotWindow(run, `占满前-${name}`)
      await page.getByTestId('max-g2').click()
      await expect(hint(page)).toBeVisible()
      await shotWindow(run, `右栏占满-${name}`)
      await hint(page).click()
      await page.getByTestId('max-center-0').click()
      await expect(hint(page)).toBeVisible()
      await shotWindow(run, `左栏占满-${name}`)
      // 分屏一格占满（只截薄荷）
      if (skin === 'mint') {
        await hint(page).click()
        await page.keyboard.press('Control+Backslash')
        await expect(center(page)).toHaveClass(/split/)
        await shotWindow(run, `分屏前-${name}`)
        await page.getByTestId('max-center-1').click()
        await expect(hint(page)).toBeVisible()
        await shotWindow(run, `分屏一格占满-${name}`)
      }
    } finally {
      await run.close()
    }
  })
}
