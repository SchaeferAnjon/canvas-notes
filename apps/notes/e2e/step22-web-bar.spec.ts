// 右栏网页标签栏（录屏 ① CN-15、16、32、35，方案 A；2026-11-21 task-sta8n 方向 A「紧凑两档」标签和地址并成一行）：
// 「占满 / 还原」在网页那一组组头最右（每一栏都能占满起；以前在标题栏最右，task-05p2w 方向 A）；当前标签就是地址块，+ 跟在标签后面；没有收起网页的 ×；
// 右栏的当前网页标签不画主题的标记，靠地址块的 --fill 底和别的标签分开。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { launch, rail, type Running } from './app'
import { SKINS } from '../src/shared/appearance'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const n = req.url?.slice(1) || '0'
    res.end(`<title>第 ${n} 页 - 雷克雅未克</title><body style="font:16px sans-serif;padding:20px"><h1>第 ${n} 页</h1><p>据《殖民之书》记载，公元 874 年英格尔夫·阿纳尔松在雷克雅未克建立定居点。</p></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const titleBar = (page: Page) => page.getByRole('banner')
const settingsWith = (appearance: object) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...appearance } }))
}

async function go(page: Page, u: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  await addr.press('Enter')
  await expect(webTabs(page).and(page.locator('.on'))).toContainText(/第 \d+ 页/)
}

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

for (const frame of ['b', 'a'] as const)
  test(`风格 ${frame.toUpperCase()}：网页那一组组头的「占满」让网页占满（中间那篇让出地方），同一颗变成「还原」，再点回原样（task-05p2w 方向 A，每一栏都能占满）`, async () => {
    const run = await launch({ 'a.md': '# a\n\n正文\n' }, {}, settingsWith({ skin: 'sky', frame }))
    const { page } = run
    try {
      // 每一栏都能占满起：这颗在网页那一组组头最右（标题栏那颗拿掉了）；没开网页时没有
      const full = page.locator('.dhead:has([data-testid="dtab-web"]) .maxbtn')
      await expect(full).toHaveCount(0)
      await expect(titleBar(page).getByTestId('tb-web')).toHaveCount(0)
      await rail(page).getByRole('button', { name: '网页' }).click()
      await go(page, `${base}/1`)
      await expect(full).toHaveAccessibleName('占满：网页')
      await expect(full).toHaveAttribute('data-key', '⌃⌘\\')
      // 在「这一栏的布局」⋯ 右边、组头最右（三栏一律「把手 · ⋯ · 占满」）
      const box1 = (await full.boundingBox())!
      const more = (await page.locator('.dhead:has([data-testid="dtab-web"]) .dmore').boundingBox())!
      expect(box1.x).toBeGreaterThan(more.x + more.width - 1)
      const w1 = (await web(page).boundingBox())!.width
      await shot(run, `webbar-${frame}-right`)
      await full.click()
      // 网页还在右栏，宽到占满；中间那一栏收着
      await expect(page.locator('.win > main.center')).toHaveClass(/folded/)
      await expect.poll(async () => (await web(page).boundingBox())!.width).toBeGreaterThan(w1 + 300)
      await expect(page.locator('.wpane')).toHaveCount(0)
      await expect(full).toHaveAccessibleName('还原')
      await shot(run, `webbar-${frame}-full`)
      await full.click()
      await expect(page.locator('.win > main.center')).not.toHaveClass(/folded/)
      await expect(webTabs(page)).toHaveText(['第 1 页 - 雷克雅未克'])
      await expect(full).toHaveAccessibleName('占满：网页')
      // 网页收起：这颗跟着没了
      await titleBar(page).getByRole('button', { name: '收起右栏' }).click()
      await expect(full).toHaveCount(0)
    } finally {
      await run.close()
    }
  })

test('地址栏点进去以后网页才载完（或跳了一页）：地址栏不被换掉，接着打的字不会接在旧网址后面；没打字就离开，地址栏补回现在的网址', async () => {
  const run = await launch({ 'a.md': '# a\n' }, {}, settingsWith({ skin: 'sky', frame: 'b' }))
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${base}/1`)
    const addr = web(page).getByRole('textbox', { name: '网址' })
    const jump = (n: number) =>
      page.evaluate((u) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(`location.href = ${JSON.stringify(u)}`), `${base}/${n}`)
    // 点进地址栏不打字，这时网页自己跳到第 2 页、载完；离开地址栏后它写的是现在这一页
    await addr.click()
    await jump(2)
    await expect(webTabs(page).and(page.locator('.on'))).toContainText('第 2 页')
    await page.locator('.center').click({ position: { x: 300, y: 300 } })
    await expect(addr).toHaveValue(/\/2$/)
    // 点进地址栏（全选），网页跳到第 3 页、载完，再打字：打的字换掉全选的网址，不接在旧网址后面
    await addr.click()
    await jump(3)
    await expect(webTabs(page).and(page.locator('.on'))).toContainText('第 3 页')
    await page.keyboard.type('冰岛')
    await expect(addr).toHaveValue('冰岛')
  } finally {
    await run.close()
  }
})

test('标签和地址一行（task-sta8n 方向 A）：当前标签就是地址块，+ 跟在标签后面，没有收起网页的 ×；标签多了横着滚，地址块整个看得见，+ 还在栏里', async () => {
  const run = await launch({ 'a.md': '# a\n' }, {}, settingsWith({ skin: 'sky', frame: 'b' }))
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    await go(page, `${base}/1`)
    await expect(web(page).getByRole('button', { name: '收起网页' })).toHaveCount(0)
    await expect(web(page).getByRole('button', { name: '网页占满' })).toHaveCount(0)
    const list = web(page).getByRole('tablist', { name: '网页标签' })
    const plus = list.getByRole('button', { name: '新网页' })
    // 当前标签就是地址块
    await expect(list.getByRole('tab', { selected: true }).getByRole('textbox', { name: '网址' })).toBeVisible()
    const panel = (await web(page).boundingBox())!
    for (let i = 2; i <= 6; i++) {
      await plus.click()
      await go(page, `${base}/${i}`)
    }
    await expect(webTabs(page)).toHaveCount(6)
    // 6 个放不下：标签那一段横着滚，当前（最后一个，地址块）滚进来整个看得见，+ 在它右边、还在栏里
    const scroll = web(page).locator('.wtlist')
    const sw = await scroll.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sl: el.scrollLeft }))
    expect(sw.sw).toBeGreaterThan(sw.cw)
    expect(sw.sl).toBeGreaterThan(0)
    const lb = (await scroll.boundingBox())!
    const cur = (await list.getByRole('tab', { selected: true }).boundingBox())!
    expect(cur.x).toBeGreaterThanOrEqual(lb.x - 1)
    expect(cur.x + cur.width).toBeLessThanOrEqual(lb.x + lb.width + 1)
    const p = (await plus.boundingBox())!
    expect(p.x).toBeGreaterThanOrEqual(cur.x + cur.width - 1)
    expect(p.x + p.width).toBeLessThanOrEqual(panel.x + panel.width)
    await shot(run, 'webbar-six-tabs')
  } finally {
    await run.close()
  }
})

for (const skin of SKINS)
  test(`主题 ${skin.name}：右栏当前网页标签（地址块）没有彩色标记，--fill 底，和别的标签分得清`, async () => {
    const run = await launch({ 'a.md': '# a\n' }, {}, settingsWith({ skin: skin.id, frame: 'b' }))
    const { page } = run
    try {
      await rail(page).getByRole('button', { name: '网页' }).click()
      await go(page, `${base}/1`)
      await web(page).locator('button.wnew').click()
      await go(page, `${base}/2`)
      const on = web(page).locator('.wtabs .tab.on')
      const off = web(page).locator('.wtabs .tab:not(.on)')
      const mark = await on.evaluate((el) => getComputedStyle(el, '::before').content)
      expect(mark).toBe('none')
      const bg = (l: typeof on) => l.evaluate((el) => getComputedStyle(el).backgroundColor)
      // 地址块是 --fill 底（量 --fill 的颜色：同一个元素上取）
      const fill = await on.locator('.addr').evaluate((el) => {
        const probe = document.createElement('i')
        probe.style.background = 'var(--fill)'
        el.appendChild(probe)
        const c = getComputedStyle(probe).backgroundColor
        probe.remove()
        return c
      })
      expect(await bg(on.locator('.addr'))).toBe(fill)
      expect(await bg(off)).not.toBe(fill)
      // 中间栏的标签条照旧画主题标记
      if (skin.tab === 'top' || skin.tab === 'bottom') expect(await page.locator('.center .tabs .tab.on').evaluate((el) => getComputedStyle(el, '::before').content)).not.toBe('none')
      await shot(run, `webtab-${skin.id}`)
    } finally {
      await run.close()
    }
  })
