// 并排对照图（task-kbnc0，长期一起看的网页和笔记）：同一个窗口（1440×887）、浅色天青、深色深湖各一套，左原型（/private/tmp/canvas-notes-webpair/proto.html），右软件。
// A：配对提示、配成一对的小窗、配好了（对着看、两处小标、底栏）、对着看的菜单、点这篇网页回到那段、网页改版了；
// B：存成书桌、左栏书桌、打开书桌、⌘K 书桌一组；另加收起中间栏（原型里没有）和交回报告开头的「在哪」图。
// 平时跳过：CN_SHOTS=<目录> npx playwright test e2e/w4-read-along-shots.spec.ts（原型那边用 CN_CHROMIUM 指的 Chromium）
import { chromium, expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, leftView, rail, type Running } from './app'
import { skinned } from './fixtures/book-digest'
import { fakeBook, type FakeBook, TARGET } from './fixtures/fake-book'

const SHOTS = process.env.CN_SHOTS
test.skip(!SHOTS, '截对照图才跑：CN_SHOTS=<目录>')
test.setTimeout(10 * 60_000)

const PROTO = 'file:///private/tmp/canvas-notes-webpair/proto.html'
const CHROMIUM = { ...(process.env.CN_CHROMIUM ? { executablePath: process.env.CN_CHROMIUM } : {}) }
const W = 1440
const H = 887
const NOTE = '课程/study project/学习笔记：动手学深度学习.md'
const NOTE_TEXT = '# 学习笔记：动手学深度学习\n\n## 前言\n\n这本书每一节都是能跑的 Jupyter 记事本：先讲为什么，再给代码。\n\n- 三部分：基础和预备知识、现代深度学习技术、效率和应用。\n\n## 2.1 数据操作\n\n张量 = n 维数组；比 NumPy 多两样：GPU 加速、自动微分。\n\n- 一个轴叫向量，两个轴叫矩阵。\n- reshape 只改形状，不改元素。\n\n## 2.2 数据预处理\n\n先用 pandas 读 CSV，缺的值用均值填，再转成张量。\n'
const FILES = {
  [NOTE]: NOTE_TEXT,
  '课程/study project/小论文计划.md': '---\ntype: board\ncolor: "#3f7fd0"\n---\n# 小论文计划\n',
  '课程/ecp/第一讲.md': '# 第一讲\n',
  '.canvas-notes/书桌/小论文计划.json': JSON.stringify({ name: '小论文计划', notes: ['课程/study project/小论文计划.md'], web: [{ url: 'https://example.com/a', title: 'a' }, { url: 'https://example.com/b', title: 'b' }, { url: 'https://example.com/c', title: 'c' }], auto: true, saved: '2026-11-20T19:14:00.000Z' }, null, 2) + '\n',
}

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

/** 原型那边：照方向 A、B 点到同样的状态，截 1440×887 */
async function protoShots(theme: 'light' | 'dark'): Promise<Record<string, Buffer>> {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  const out: Record<string, Buffer> = {}
  const snap = async (n: string) => (await p.waitForTimeout(350), (out[n] = await p.screenshot()))
  await p.goto(`${PROTO}#scene=a&theme=${theme}`)
  await p.waitForTimeout(400)
  await snap('a1-hint')
  await p.click('#pairBtn')
  await snap('a2-pair')
  await p.click('#po')
  await snap('a3-paired')
  await p.click('#pairChip')
  await snap('a7-menu')
  await p.keyboard.press('Escape')
  await p.click('#restart')
  await p.click('#noteRow')
  await p.waitForTimeout(150)
  out['a5-back'] = await p.screenshot()
  await p.click('#changed')
  await p.click('#restart')
  await p.click('#noteRow')
  await p.waitForTimeout(700)
  await snap('a6-changed')
  await p.goto(`${PROTO}#scene=b&theme=${theme}`)
  await p.reload()
  await p.waitForTimeout(400)
  await p.click('#deskBtn')
  await snap('b1-save')
  await p.click('#do')
  await p.click('#restart')
  await p.click('[data-l="desks"]')
  await snap('b2-desks')
  await p.click('[data-desk="d2l"]')
  await p.waitForTimeout(300)
  await snap('b3-back')
  await p.click('#restart')
  await p.keyboard.press('Meta+k')
  await snap('b4-cmdk')
  await b.close()
  return out
}

async function openTreeNote(page: Page) {
  await leftView(page, '文件')
  for (const f of ['课程', 'study project']) {
    const t = tree(page).getByRole('treeitem').filter({ hasText: new RegExp(`^${f}`) }).first().getByRole('button', { name: `展开 ${f}` })
    if (await t.count()) await t.click()
  }
  await tree(page).locator(`[data-path="${NOTE}"]`).click()
}

async function go(page: Page, u: string) {
  await addr(page).click()
  await addr(page).fill(u)
  await addr(page).press('Enter')
  await expect.poll(() => guest(page, 'location.href')).toBe(u)
}

async function wheelTo(page: Page, text: string) {
  const box = (await web(page).locator('webview.on').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 200; i++) {
    const w = await guest<{ top: number; bottom: number; vh: number } | null>(page, `(() => { const el = [...document.querySelectorAll('p')].find((p) => p.textContent.includes(${JSON.stringify(text.slice(0, 20))})); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight } })()`)
    const line = w ? w.vh * 0.18 : 0
    if (w && w.top <= line - 4 && w.bottom >= line + 4) return page.waitForTimeout(800)
    await page.mouse.wheel(0, w && w.top < line ? -40 : 40)
    await page.waitForTimeout(30)
  }
}

/** 交回报告开头的「在哪」图：在真窗口上照元素的位置画编号框 */
async function mark(page: Page, boxes: { sel: string; n: number }[]) {
  await page.evaluate((list) => {
    for (const b of list) {
      const el = [...document.querySelectorAll(b.sel)].pop()
      if (!el) throw new Error(`找不到 ${b.sel}`)
      const r = el.getBoundingClientRect()
      const box = document.createElement('div')
      box.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;border:2.5px solid #e8590c;border-radius:8px;z-index:99999;pointer-events:none`
      const tag = document.createElement('div')
      tag.textContent = String(b.n)
      tag.style.cssText = `position:fixed;left:${Math.max(2, r.left - 16)}px;top:${Math.max(2, r.top - 16)}px;width:24px;height:24px;border-radius:12px;background:#e8590c;color:#fff;font:600 14px/24px -apple-system;text-align:center;z-index:100000;pointer-events:none`
      document.body.append(box, tag)
    }
  }, boxes)
}

for (const theme of ['light', 'dark'] as const) {
  test(`并排对照：方向 A、B（${theme === 'light' ? '浅色天青' : '深色深湖'}）`, async () => {
    const proto = await protoShots(theme)
    const run = await launch(FILES, {}, skinned(theme === 'light' ? 'sky' : 'petrol'))
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setContentSize(s.w, s.h), { w: W, h: H })
      await page.waitForTimeout(300)
      // 这周已经一起开过 3 次：标题下出「配成一对？」
      await page.evaluate(({ n }) => localStorage.setItem('cn.coopen', JSON.stringify({ [`${n}\n127.0.0.1`]: [Date.now() - 3 * 864e5, Date.now() - 2 * 864e5, Date.now() - 864e5] })), { n: NOTE })
      await openTreeNote(page)
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      await go(page, `${book.base}/chapter_preliminaries/ndarray.html`)
      await expect(page.getByRole('note', { name: '配成一对？' })).toBeVisible()
      await pair(`a1-hint-${theme}`, proto['a1-hint']!, await winShot(run))
      await page.getByRole('note', { name: '配成一对？' }).getByRole('button', { name: '配成一对' }).click()
      await expect(page.getByRole('dialog', { name: '和网页配成一对' })).toBeVisible()
      await pair(`a2-pair-${theme}`, proto['a2-pair']!, await winShot(run))
      await page.getByRole('dialog', { name: '和网页配成一对' }).getByRole('button', { name: '配成一对', exact: true }).click()
      await wheelTo(page, TARGET)
      await page.getByTestId('toast').waitFor()
      await pair(`a3-paired-${theme}`, proto['a3-paired']!, await winShot(run))
      await page.locator('.pane:not([hidden])').getByRole('button', { name: /^对着看/ }).click()
      await pair(`a7-menu-${theme}`, proto['a7-menu']!, await winShot(run))
      await page.keyboard.press('Escape')
      // 收起网页、回首页：再点这篇，网页回到那段、亮一下
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      await page.locator('.tab', { hasText: '首页' }).first().click()
      await go2tree(page)
      await expect.poll(async () => guest(page, `!!document.querySelector('[data-cn-flash]')`)).toBe(true)
      await pair(`a5-back-${theme}`, proto['a5-back']!, await winShot(run))
      // 网站改了版
      book.changed = true
      await go(page, `${book.base}/chapter_preliminaries/pandas.html`)
      await go2tree(page)
      await expect(web(page).getByRole('alert')).toBeVisible({ timeout: 10_000 })
      await pair(`a6-changed-${theme}`, proto['a6-changed']!, await winShot(run))
      book.changed = false
      await web(page).getByRole('alert').getByRole('button', { name: '关掉这一句' }).click()

      // B：存成书桌 → 左栏书桌 → 打开 → ⌘K
      await page.locator('main.center').click({ position: { x: 300, y: 400 } })
      await page.keyboard.press('Meta+k')
      await page.getByRole('dialog', { name: '搜索和命令' }).getByRole('textbox').fill('存成书桌')
      await page.getByRole('dialog', { name: '搜索和命令' }).getByRole('option').filter({ hasText: '存成书桌…' }).first().click()
      await expect(page.getByRole('dialog', { name: '存成书桌' })).toBeVisible()
      await pair(`b1-save-${theme}`, proto['b1-save']!, await winShot(run))
      await page.getByRole('dialog', { name: '存成书桌' }).getByRole('button', { name: '存成书桌', exact: true }).click()
      await page.locator('.tab', { hasText: '首页' }).first().click()
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      await page.waitForTimeout(500)
      await pair(`b2-desks-${theme}`, proto['b2-desks']!, await winShot(run))
      await page.locator('aside.side[aria-label="书桌"]').getByRole('button', { name: /^书桌「动手学深度学习」/ }).click()
      await expect(page.getByTestId('toast')).toContainText('打开了书桌')
      await pair(`b3-back-${theme}`, proto['b3-back']!, await winShot(run))
      await page.locator('main.center').click({ position: { x: 300, y: 400 } })
      await page.keyboard.press('Meta+k')
      await expect(page.getByRole('dialog', { name: '搜索和命令' })).toBeVisible()
      await pair(`b4-cmdk-${theme}`, proto['b4-cmdk']!, await winShot(run))
      await page.keyboard.press('Escape')

      // 网页占满（原型里没有；task-05p2w 起是右上角那颗）：只截软件
      await page.getByTestId('tb-web').click()
      writeFileSync(join(SHOTS!, `fold-${theme}.png`), await winShot(run))
      await page.getByTestId('tb-web').click()

      if (theme === 'light') {
        // 「在哪」：1 标题下「对着看」 2 目录树这一行的小标 3 网页标签上的小标 4 左栏「书桌」 5 网页占满
        await leftView(page, '文件')
        await page.waitForTimeout(400)
        await mark(page, [
          { sel: '.pane:not([hidden]) .cm-ra', n: 1 },
          { sel: '.ftree .ft-pair', n: 2 },
          { sel: '.right.web .wpm', n: 3 },
          { sel: 'nav[aria-label="左栏"] button[aria-label="书桌"]', n: 4 },
          { sel: '[data-testid="tb-web"]', n: 5 },
        ])
        writeFileSync(join(SHOTS!, 'where.png'), await winShot(run))
      }
    } finally {
      await run.close()
    }
  })
}

test('邻页对照（浅色天青）：左栏「最近」对「书桌」；剪藏来的那篇（标题下「剪自」）对配好对的那篇（标题下「对着看」）', async () => {
  const clip = '剪藏/网页/前言 — 动手学深度学习.md'
  const run = await launch(
    { ...FILES, [clip]: `---\nsource: ${'https://zh.d2l.ai/chapter_preface/index.html'}\ncreated: 2026-11-21 20:00\n---\n# 前言 — 动手学深度学习\n\n> 这本书想让深度学习平易近人。\n`, [NOTE]: `---\nread-along: ${book.base}/\n---\n${NOTE_TEXT}` },
    {},
    skinned('sky'),
  )
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setContentSize(s.w, s.h), { w: W, h: H })
    await leftView(page, '最近')
    await page.waitForTimeout(500)
    const recent = await winShot(run)
    await leftView(page, '书桌')
    await page.waitForTimeout(500)
    await pair2('n1-left-recent-vs-desks', ['邻页：左栏「最近」', recent], ['这次：左栏「书桌」', await winShot(run)])
    await leftView(page, '文件')
    for (const f of ['剪藏', '网页']) {
      const t = tree(page).getByRole('treeitem').filter({ hasText: new RegExp(`^${f}`) }).first().getByRole('button', { name: `展开 ${f}` })
      if (await t.count()) await t.click()
    }
    await tree(page).locator(`[data-path="${clip}"]`).click()
    await page.waitForTimeout(600)
    const clipped = await winShot(run)
    await go2tree(page)
    await expect(page.locator('.pane:not([hidden])').getByRole('button', { name: /^对着看/ })).toBeVisible()
    await page.waitForTimeout(800)
    await pair2('n2-meta-clip-vs-readalong', ['邻页：剪藏来的那篇（剪自）', clipped], ['这次：配好对的那篇（对着看）', await winShot(run)])
  } finally {
    await run.close()
  }
})

/** 左右拼成一张，上面写各自是什么 */
async function pair2(name: string, left: [string, Buffer], right: [string, Buffer]) {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: W * 2 + 24, height: H + 40 } })
  const img = (x: Buffer) => `data:image/png;base64,${x.toString('base64')}`
  const col = ([t, x]: [string, Buffer]) => `<div><div style="height:32px;line-height:32px;color:#fff;padding-left:8px">${t}</div><img src="${img(x)}" style="width:${W}px;height:${H}px;display:block"></div>`
  await p.setContent(`<body style="margin:0;background:#888;font:14px -apple-system"><div style="display:flex;gap:24px">${col(left)}${col(right)}</div></body>`)
  await p.waitForTimeout(200)
  writeFileSync(join(SHOTS!, `${name}.png`), await p.screenshot({ fullPage: true }))
  await b.close()
}

/** 从目录树点这篇（中间、网页都按点这篇的样子来） */
async function go2tree(page: Page) {
  await openTreeNote(page)
}
