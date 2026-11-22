// 并排对照图（task-05p2w，方向 A「网页占满」）：同一个窗口（1440×887）、浅色天青、深色深湖各一套，左原型
// （/private/tmp/canvas-notes-visual/13-收起中间栏和移到中间/proto.html?dir=a），右软件：原样、占满、占满后剪一段、点开「记进」小牌、
// 占满时网页 ⋯、在中间开成一页、那一页的 ⋯。
// 平时跳过：CN_SHOTS=<目录> npx playwright test e2e/05p2w-shots.spec.ts（原型那边用 CN_CHROMIUM 指的 Chromium）
import { chromium, expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, leftView, rail, type Running } from './app'
import { skinned } from './fixtures/book-digest'
import { fakeBook, type FakeBook, TARGET2 } from './fixtures/fake-book'

const SHOTS = process.env.CN_SHOTS
test.skip(!SHOTS, '截对照图才跑：CN_SHOTS=<目录>')
test.setTimeout(10 * 60_000)

const PROTO = 'file:///private/tmp/canvas-notes-visual/13-%E6%94%B6%E8%B5%B7%E4%B8%AD%E9%97%B4%E6%A0%8F%E5%92%8C%E7%A7%BB%E5%88%B0%E4%B8%AD%E9%97%B4/proto.html'
const CHROMIUM = { ...(process.env.CN_CHROMIUM ? { executablePath: process.env.CN_CHROMIUM } : {}) }
const W = 1440
const H = 887
const NOTE = '课程/学习笔记：动手学深度学习.md'
const BODY = '# 学习笔记：动手学深度学习\n\n这个网页和这个文档我会长期一起看：读到哪、记到哪。\n\n### 2.2 数据预处理\n\n- 读表 → 分出特征和标签 → 填补缺失 → 转成张量\n\n### 2.3 线性代数\n\n标量、向量、矩阵、张量。\n'

let book: FakeBook
test.beforeAll(async () => {
  book = await fakeBook()
  mkdirSync(SHOTS!, { recursive: true })
})
test.afterAll(() => book.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>

async function winShot(run: Running): Promise<Buffer> {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  return Buffer.from(b64, 'base64')
}

/** 左右拼成一张，上面一行写哪边是哪边 */
async function pair(name: string, left: Buffer, right: Buffer) {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: W * 2 + 24, height: H + 40 } })
  const img = (x: Buffer) => `data:image/png;base64,${x.toString('base64')}`
  const col = (t: string, x: Buffer) => `<div><div style="height:32px;line-height:32px;color:#fff;padding-left:8px">${t}</div><img src="${img(x)}" style="width:${W}px;height:${H}px;display:block"></div>`
  await p.setContent(`<body style="margin:0;background:#888;font:14px -apple-system"><div style="display:flex;gap:24px">${col('原型', left)}${col('软件', right)}</div></body>`)
  await p.waitForTimeout(200)
  writeFileSync(join(SHOTS!, `${name}.png`), await p.screenshot({ fullPage: true }))
  await b.close()
}

/** 原型那边：方向 A 点到同样的状态 */
async function protoShots(theme: 'light' | 'dark'): Promise<Record<string, Buffer>> {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  const out: Record<string, Buffer> = {}
  const at = async (hash: string) => {
    await p.goto('about:blank')
    await p.goto(`${PROTO}?dir=a&theme=${theme}#${hash}`)
    await p.waitForTimeout(400)
  }
  const snap = async (n: string) => (await p.waitForTimeout(300), (out[n] = await p.screenshot()))
  await at('normal')
  await snap('1-normal')
  await at('fold')
  await snap('2-full')
  await at('clip')
  await snap('3-clip')
  await at('chip')
  await snap('4-chip')
  await at('fold')
  await p.click('#wmore')
  await snap('5-menu')
  await at('center')
  await snap('6-center')
  await p.click('#cmore')
  await snap('7-center-menu')
  await b.close()
  return out
}

/** 在网页上选一段，点小条上的「剪藏」 */
async function clipFromPage(page: Page, text: string) {
  await guest(page, `(() => { const p = [...document.querySelectorAll('p')].find((x) => x.textContent.includes(${JSON.stringify(text)})); p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
  const where = `(() => { const h = document.getElementById('cn-clip-host'); if (!h || h.style.display === 'none') return null; const b = h.shadowRoot.querySelector('button.clip').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`
  await expect.poll(() => guest(page, where)).not.toBeNull()
  const at = (await guest<{ x: number; y: number }>(page, where))!
  const wv = (await web(page).locator('webview.on').boundingBox())!
  await page.mouse.click(wv.x + at.x, wv.y + at.y)
}

for (const theme of ['light', 'dark'] as const) {
  test(`并排对照：方向 A 网页占满（${theme === 'light' ? '浅色天青' : '深色深湖'}）`, async () => {
    const proto = await protoShots(theme)
    const run = await launch({ [NOTE]: `---\nread-along: ${book.base}/\n---\n${BODY}` }, {}, skinned(theme === 'light' ? 'sky' : 'petrol'))
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setContentSize(s.w, s.h), { w: W, h: H })
      await page.waitForTimeout(300)
      await leftView(page, '文件')
      const t = tree(page).getByRole('treeitem').filter({ hasText: /^课程/ }).first().getByRole('button', { name: '展开 课程' })
      if (await t.count()) await t.click()
      await tree(page).locator(`[data-path="${NOTE}"]`).click()
      if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      await addr(page).click()
      await addr(page).fill(`${book.base}/chapter_preliminaries/pandas.html`)
      await addr(page).press('Enter')
      await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
      await leftView(page, '最近')
      await page.locator('main.center .cm-content').click({ position: { x: 40, y: 10 } })
      await pair(`1-原样-${theme}`, proto['1-normal']!, await winShot(run))

      await page.getByTestId('tb-web').click()
      await expect(page.getByTestId('full-chip')).toBeVisible()
      await pair(`2-网页占满-${theme}`, proto['2-full']!, await winShot(run))

      await clipFromPage(page, TARGET2.slice(0, 16))
      await expect(page.getByTestId('toast')).toContainText('记进《')
      await pair(`3-占满后剪一段-${theme}`, proto['3-clip']!, await winShot(run))

      await page.getByTestId('full-chip').click()
      await expect(page.getByRole('menu', { name: '记进哪篇' })).toBeVisible()
      await pair(`4-点开记进小牌-${theme}`, proto['4-chip']!, await winShot(run))
      await page.keyboard.press('Escape')

      await web(page).getByRole('button', { name: '更多', exact: true }).click()
      await expect(web(page).getByRole('menu', { name: '更多' })).toBeVisible()
      await pair(`5-占满时网页⋯-${theme}`, proto['5-menu']!, await winShot(run))

      await web(page).getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: /在中间开成一页/ }).click()
      await expect(page.locator('.wpane:not([hidden]) webview')).toBeVisible()
      await page.waitForTimeout(1200)
      await pair(`6-在中间开成一页-${theme}`, proto['6-center']!, await winShot(run))

      await acts(page).getByRole('button', { name: '更多' }).click()
      await expect(page.getByRole('dialog', { name: '这一页' })).toBeVisible()
      await pair(`7-这一页⋯放回右栏-${theme}`, proto['7-center-menu']!, await winShot(run))
    } finally {
      await run.close()
    }
  })
}
