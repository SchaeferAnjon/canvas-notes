// 新网页标签（软件自带的 BookmarkKeeper，录屏 ① CN-33、CN-34、CN-61）：
// - 全是中文（问候和日期和首页一样），问候区下面不再空一大段，「开着 2 个新网页」的提示条贴着问候；颜色跟主题（十套各截一张）；
// - 只用软件自带的那份（不设 CN_BOOKMARKKEEPER_DIR 也是它）；
// - 网站小图标：网页里写的 <link rel=icon> 能用；/favicon.ico 跳登录页、回 1×1 透明图的给地球；Chrome 图标库里有的用它；没有空白。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, rail, type Running } from './app'
import { solidPng } from './fixtures/png'
import { SKINS } from '../src/shared/appearance'

const ICON = solidPng(32, 32, [30, 120, 200])
const servers: Server[] = []
const site: Record<'link' | 'login' | 'blank' | 'chrome', string> = { link: '', login: '', blank: '', chrome: '' }

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const s = createServer(handler)
  servers.push(s)
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`
}

test.beforeAll(async () => {
  // 学校网站：图标只写在网页里，根目录没有 favicon.ico
  site.link = await serve((req, res) => {
    if (req.url === '/static/logo.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(ICON)
    if (req.url === '/favicon.ico') return res.writeHead(404).end()
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>教务处</title><link rel="icon" href="/static/logo.png"><h1>教务处</h1>')
  })
  // 要登录的网站：/favicon.ico 跳到登录页
  site.login = await serve((req, res) => {
    if (req.url === '/login') return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>统一身份认证</title><form>登录</form>')
    res.writeHead(302, { location: '/login' }).end()
  })
  // 回一张标着 image/png 的 1×1 透明图
  site.blank = await serve((req, res) => {
    if (req.url === '/favicon.ico') return res.writeHead(200, { 'content-type': 'image/png' }).end(solidPng(1, 1, [0, 0, 0]))
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>邮箱</title>')
  })
  // 什么都不回的网站：只有 Chrome 的图标库里有它的图标
  site.chrome = await serve((_req, res) => res.writeHead(404).end())
})
test.afterAll(() => servers.forEach((s) => s.close()))

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      // dom-ready 之前不让跑：当作还没有
      return null
    }
  }, code) as Promise<T>
async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}
const prepare = (appearance: object) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...appearance } }))
}
/** 新标签页里出现的英文词（网站名、书签名除外）：页面上看得见的字里连着 2 个以上的拉丁字母 */
const englishWords = (page: Page) =>
  guest<string[]>(
    page,
    `(() => { const skip = new Set(['Tab', 'Out', 'Zara']); const t = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { const el = n.parentElement; if (!el || el.closest('.bk-t-title, .chip-text, .mission-name, .bk-r-title, script, style') || !el.getClientRects().length || getComputedStyle(el).visibility === 'hidden') continue; for (const m of n.textContent.matchAll(/[A-Za-z]{2,}/g)) if (!skip.has(m[0])) t.push(m[0]) } return t })()`,
  )

test('新网页全是中文：问候、日期和首页一样；问候区底线到书签标题不超过 40；开两个新网页时提示条贴着问候；用的是软件自带的那份', async () => {
  const icloud = mkdtempSync(join(tmpdir(), 'cn-icloud-'))
  const run = await launch({ 'a.md': '# a\n' }, { CN_ICLOUD_CONTAINER: icloud }, prepare({ skin: 'sky', frame: 'b' }))
  const { page } = run
  try {
    expect(await page.evaluate(() => window.cnWeb.newtab())).toMatchObject({ from: 'bundled' })
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await expect.poll(() => guest(page, `document.getElementById('greeting')?.textContent`)).toMatch(/^(早上好|中午好|下午好|晚上好|夜深了)$/)
    expect(await guest(page, `document.getElementById('dateDisplay').textContent`)).toMatch(/^\d{1,2}月\d{1,2}日 · 星期[日一二三四五六]$/)
    expect(await guest(page, `getComputedStyle(document.getElementById('dateDisplay')).textTransform`)).toBe('none')
    await expect.poll(() => guest(page, `!!document.querySelector('#bkSection h2')`)).toBe(true)
    const gap = () => guest<number>(page, `document.querySelector('#bkSection h2').getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom`)
    expect(await gap()).toBeLessThanOrEqual(40)
    expect(await englishWords(page)).toEqual([])

    // 第二个新网页：提示条「开着 2 个新网页，只留这一个？」贴着问候
    await web(page).locator('button.wnew').click()
    await expect(webTabs(page)).toHaveCount(2)
    await expect.poll(() => guest(page, `getComputedStyle(document.getElementById('tabOutDupeBanner')).display`)).toBe('flex')
    expect(await guest(page, `document.querySelector('.tab-cleanup-text').textContent.replace(/\\s+/g, ' ').trim()`)).toBe('开着2个新网页，只留这一个？')
    expect(await guest(page, `document.querySelector('.tab-cleanup-btn').textContent.trim()`)).toBe('关掉多余的')
    // 提示条出来时有 0.5 秒往上浮的动画（style.css fadeUp），机器忙时量到半路：等它落定再量
    await expect.poll(() => guest<number>(page, `document.getElementById('tabOutDupeBanner').getBoundingClientRect().top - document.querySelector('header').getBoundingClientRect().bottom`)).toBeLessThanOrEqual(16)
    expect(await englishWords(page)).toEqual([])
    await shot(run, 'newtab-zh')
    // 点「关掉多余的」：只剩这一个
    await guest(page, `document.querySelector('.tab-cleanup-btn').click()`)
    await expect(webTabs(page)).toHaveCount(1)
  } finally {
    await run.close()
    rmSync(icloud, { recursive: true, force: true })
  }
})

for (const skin of SKINS)
  test(`主题 ${skin.name}：新网页的底色和字色跟着主题`, async () => {
    const icloud = mkdtempSync(join(tmpdir(), 'cn-icloud-'))
    const run = await launch({ 'a.md': '# a\n' }, { CN_ICLOUD_CONTAINER: icloud }, prepare({ skin: skin.id, frame: 'b' }))
    const { page } = run
    try {
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      await expect.poll(() => guest(page, `document.getElementById('greeting')?.textContent ?? ''`)).not.toBe('')
      // 主题的 --win、--t1 在软件里算成 rgb，和新网页里的比
      const want = await page.evaluate(() => {
        const el = document.createElement('div')
        el.style.cssText = 'background: var(--win); color: var(--t1)'
        document.body.appendChild(el)
        const cs = getComputedStyle(el)
        const r = { bg: cs.backgroundColor, fg: cs.color }
        el.remove()
        return r
      })
      await expect.poll(() => guest(page, `getComputedStyle(document.body).backgroundColor`)).toBe(want.bg)
      expect(await guest(page, `getComputedStyle(document.getElementById('greeting')).color`)).toBe(want.fg)
      await shot(run, `newtab-${skin.id}`)
    } finally {
      await run.close()
      rmSync(icloud, { recursive: true, force: true })
    }
  })

test('书签的网站小图标：网页里写的能用；跳登录页、1×1 透明图的给地球；Chrome 图标库里有的用它；没有一个空白；网页报过的图标记进 icons.json', async () => {
  const icloud = mkdtempSync(join(tmpdir(), 'cn-icloud-'))
  const chrome = mkdtempSync(join(tmpdir(), 'cn-fake-chrome-'))
  mkdirSync(join(chrome, 'Default'))
  const db = new DatabaseSync(join(chrome, 'Default', 'Favicons'))
  db.exec(`CREATE TABLE icon_mapping (id INTEGER PRIMARY KEY, page_url TEXT, icon_id INTEGER);
    CREATE TABLE favicon_bitmaps (id INTEGER PRIMARY KEY, icon_id INTEGER, last_updated INTEGER, image_data BLOB, width INTEGER, height INTEGER);`)
  db.prepare('INSERT INTO icon_mapping (page_url, icon_id) VALUES (?, 1)').run(`${site.chrome}/home`)
  db.prepare('INSERT INTO favicon_bitmaps (icon_id, image_data, width, height) VALUES (1, ?, 32, 32)').run(solidPng(32, 32, [200, 40, 40]))
  db.close()
  const run = await launch({ 'a.md': '# a\n' }, { CN_ICLOUD_CONTAINER: icloud, CN_CHROME_ROOT: chrome }, prepare({ skin: 'sky', frame: 'b' }))
  const { page, userData } = run
  try {
    const books = [
      { title: '教务处', url: `${site.link}/` },
      { title: '统一身份认证', url: `${site.login}/` },
      { title: '邮箱', url: `${site.blank}/` },
      { title: '课程平台', url: `${site.chrome}/course/7` },
    ]
    for (const b of books) await page.evaluate((x) => window.cnWeb.addBookmark({ ...x, folder: '书签栏 / 学校' }), b)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await expect.poll(() => guest(page, `document.getElementById('greeting')?.textContent ?? ''`)).not.toBe('')
    // 新标签页自己的 /_favicon/ 接口（和它画书签时用的同一个）
    const kind = (u: string) =>
      guest<string>(page, `fetch('/_favicon/?pageUrl=' + encodeURIComponent(${JSON.stringify(u)}) + '&size=32').then(async (r) => r.headers.get('content-type') + '|' + (await r.arrayBuffer()).byteLength)`)
    expect(await kind(books[0]!.url)).toBe(`image/png|${ICON.length}`)
    expect(await kind(books[1]!.url)).toMatch(/^image\/svg\+xml\|\d+$/)
    expect(await kind(books[2]!.url)).toMatch(/^image\/svg\+xml\|\d+$/)
    expect(await kind(books[3]!.url)).toMatch(/^image\/png\|\d+$/)
    // 「全部文件夹」里「学校」那一组：每个图标都画得出来（没有空白）
    await guest(page, `document.getElementById('bkFoldersToggle').click()`)
    await expect
      .poll(() => guest<number[]>(page, `[...document.querySelectorAll('#bkCards img')].map((i) => (i.complete ? i.naturalWidth : -1))`), { timeout: 10_000 })
      .toEqual(expect.arrayContaining([expect.any(Number)]))
    await expect.poll(async () => (await guest<number[]>(page, `[...document.querySelectorAll('#bkCards img')].map((i) => (i.complete ? i.naturalWidth : -1))`)).every((w) => w > 0)).toBe(true)
    await shot(run, 'newtab-favicons')
    // 右栏打开教务处：网页报的图标记进 icons.json（重开软件还在）
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${site.link}/`)
    await addr.press('Enter')
    const host = new URL(site.link).host
    await expect.poll(() => {
      try {
        return (JSON.parse(readFileSync(join(userData, 'web', 'icons.json'), 'utf8')) as Record<string, string>)[host] ?? ''
      } catch {
        return ''
      }
    }).toBe(`${site.link}/static/logo.png`)
  } finally {
    await run.close()
    rmSync(icloud, { recursive: true, force: true })
    rmSync(chrome, { recursive: true, force: true })
  }
})
