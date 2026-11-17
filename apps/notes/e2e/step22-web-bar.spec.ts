// 右栏网页标签栏（录屏 ① CN-15、16、32、35，方案 A）：
// 「移到中间 / 放回右栏」在标题栏最右、「收起右栏」左边，网页在哪它都不挪；标签条最右固定一个 +；没有收起网页的 ×；
// 右栏的当前网页标签不画主题的标记，只靠底色和地址栏连成一块。
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
  test(`风格 ${frame.toUpperCase()}：标题栏「移到中间」把网页开到中间，同一个位置变成「放回右栏」，再点回右栏`, async () => {
    const run = await launch({ 'a.md': '# a\n\n正文\n' }, {}, settingsWith({ skin: 'sky', frame }))
    const { page } = run
    try {
      // 没开网页时没有这颗按钮
      await expect(titleBar(page).getByTestId('tb-web')).toHaveCount(0)
      await rail(page).getByRole('button', { name: '网页' }).click()
      await go(page, `${base}/1`)
      const move = titleBar(page).getByTestId('tb-web')
      await expect(move).toHaveAccessibleName('移到中间')
      // 紧挨着「收起右栏」的左边
      const box1 = (await move.boundingBox())!
      const fold = (await titleBar(page).getByRole('button', { name: '收起右栏' }).boundingBox())!
      expect(fold.x - (box1.x + box1.width)).toBeLessThanOrEqual(4)
      expect(fold.x).toBeGreaterThan(box1.x)
      // B 带字，A 只有图标
      if (frame === 'b') await expect(move).toContainText('移到中间')
      else expect(Math.round(box1.width)).toBe(28)
      await shot(run, `webbar-${frame}-right`)
      await move.click()
      // 网页到了中间的宽标签，右栏没别的网页就收起
      await expect(page.locator('.wpane:not([hidden]) webview')).toBeVisible()
      await expect(page.locator('.center .tabs .tab.on')).toContainText('第 1 页')
      await expect(web(page)).toBeHidden()
      await expect(move).toHaveAccessibleName('放回右栏')
      const box2 = (await move.boundingBox())!
      // 右边对齐（B 里字数一样，整颗按钮像素一样）
      expect(Math.round(box2.x + box2.width)).toBe(Math.round(box1.x + box1.width))
      if (frame === 'b') expect(Math.round(box2.x)).toBe(Math.round(box1.x))
      await shot(run, `webbar-${frame}-center`)
      await move.click()
      await expect(page.locator('.wpane')).toHaveCount(0)
      await expect(web(page)).toBeVisible()
      await expect(webTabs(page)).toHaveText(['第 1 页 - 雷克雅未克'])
      await expect(move).toHaveAccessibleName('移到中间')
      // 新网页（书签首页）不是 http 网页：没有「移到中间」
      await web(page).locator('button.wnew').click()
      await expect(webTabs(page)).toHaveCount(2)
      await expect(move).toHaveCount(0)
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

test('标签条：+ 固定在最右（1、3、6 个标签位置一样），没有收起网页的 ×；标签多了横着滚，+ 不跟着滚', async () => {
  const run = await launch({ 'a.md': '# a\n' }, {}, settingsWith({ skin: 'sky', frame: 'b' }))
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    await go(page, `${base}/1`)
    await expect(web(page).getByRole('button', { name: '收起网页' })).toHaveCount(0)
    await expect(web(page).getByRole('button', { name: '移到中间' })).toHaveCount(0)
    const plus = web(page).getByRole('tablist', { name: '网页标签' }).getByRole('button', { name: '新网页' })
    const at = async () => {
      const b = (await plus.boundingBox())!
      return Math.round(b.x)
    }
    const x1 = await at()
    const panel = (await web(page).boundingBox())!
    // 最右，离右栏右边不超过 12
    expect(panel.x + panel.width - (x1 + 28)).toBeLessThanOrEqual(12)
    for (let i = 2; i <= 3; i++) {
      await plus.click()
      await go(page, `${base}/${i}`)
    }
    await expect(webTabs(page)).toHaveCount(3)
    expect(await at()).toBe(x1)
    for (let i = 4; i <= 6; i++) {
      await plus.click()
      await go(page, `${base}/${i}`)
    }
    await expect(webTabs(page)).toHaveCount(6)
    expect(await at()).toBe(x1)
    // 6 个放不下：标签那一段横着滚，当前（最后一个）滚进来看得见，+ 还在原地
    const list = web(page).locator('.wtlist')
    const sw = await list.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth, sl: el.scrollLeft }))
    expect(sw.sw).toBeGreaterThan(sw.cw)
    expect(sw.sl).toBeGreaterThan(0)
    const last = (await webTabs(page).nth(5).boundingBox())!
    expect(last.x + last.width).toBeLessThanOrEqual(x1 + 1)
    await list.evaluate((el) => (el.scrollLeft = 0))
    expect(await at()).toBe(x1)
    await shot(run, 'webbar-six-tabs')
  } finally {
    await run.close()
  }
})

for (const skin of SKINS)
  test(`主题 ${skin.name}：右栏当前网页标签没有彩色标记，底色和地址栏一样，和别的标签分得清`, async () => {
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
      const head = await web(page).locator('.rhead').evaluate((el) => {
        // 地址行自己透明时看它下面右栏的底
        let e: Element | null = el
        while (e && ['rgba(0, 0, 0, 0)', 'transparent'].includes(getComputedStyle(e).backgroundColor)) e = e.parentElement
        return e ? getComputedStyle(e).backgroundColor : ''
      })
      expect(await bg(on)).toBe(head)
      expect(await bg(off)).not.toBe(await bg(on))
      // 中间栏的标签条照旧画主题标记
      if (skin.tab === 'top' || skin.tab === 'bottom') expect(await page.locator('.center .tabs .tab.on').evaluate((el) => getComputedStyle(el, '::before').content)).not.toBe('none')
      await shot(run, `webtab-${skin.id}`)
    } finally {
      await run.close()
    }
  })
