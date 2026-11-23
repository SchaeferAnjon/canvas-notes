// 微信读书（录屏 ① CN-36、CN-37、CN-53）：
// - 右竖条「网页」下面一格「微信读书」，点开右栏打开书架，已经开着就切过去；亮着时再点收起右栏；插件关掉时这格没有；
// - 插件问网页版接口（weread.qq.com，用右栏网页里的登录），不再问手机 App 那套；登录超时先续一次 cookie 再问；
// - 设置里：没登录时「还没登录微信读书 · 在右栏打开登录」，在右栏扫码登录后 3 秒内自己变成「已登录」；
// - 打开书那一次没取成，紧接着划的第一条照样插进文档；插不进去时右下角说原因。
// 微信读书是本机假的（e2e/fixtures/fake-weread.ts），不碰用户真的账号。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { editorText, launch, openNote, pane, rail, type Running, waitSaved } from './app'
import { BOOK, type FakeWeread, PARAS, READER, startFakeWeread, VID } from './fixtures/fake-weread'

let fake: FakeWeread
test.beforeAll(async () => {
  fake = await startFakeWeread()
})
test.afterAll(() => fake.server.close())
test.beforeEach(() => {
  fake.loggedOut = false
  fake.skey = 'skey-1'
  fake.failBookmarks = 0
  fake.hideBookId = false
  fake.staleState = false
  for (const [id, list] of fake.marks) fake.marks.set(id, list.slice(0, 1))
})

const env = () => ({ CN_WEREAD_ORIGIN: fake.base })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const entry = (page: Page) => rail(page).getByRole('button', { name: '微信读书' })
const withFrame = (frame: 'a' | 'b', skin = 'sky') => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame } }))
}
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      // dom-ready 之前不让跑：当作还没有
      return null
    }
  }, code)
/**
 * 像人一样先把鼠标挪到网页里的那个元素上，网页收到了鼠标再点。
 * 网页刚载完的头几十毫秒里 webview 还没接上鼠标，机器忙时那一下点击会丢（人点不到这么快）。
 */
async function guestClick(page: Page, sel: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(document.querySelector('${sel}').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  const x = w.x + r.x + r.width / 2
  const y = w.y + r.y + r.height / 2
  await guest(page, `window.__cnHover = false; addEventListener('mousemove', () => (window.__cnHover = true), { once: true }); 1`)
  let dx = 0
  await expect
    .poll(async () => {
      dx = dx ? 0 : 1
      await page.mouse.move(x + dx, y)
      return guest(page, 'window.__cnHover')
    })
    .toBe(true)
  await page.mouse.click(x, y)
}
async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}
async function cookieLogin(run: Running) {
  await run.app.evaluate(async ({ session }, [url, vid, skey]) => {
    const c = session.fromPartition('persist:web').cookies
    await c.set({ url, name: 'wr_vid', value: vid })
    await c.set({ url, name: 'wr_skey', value: skey })
  }, [fake.base, VID, fake.skey] as const)
}
async function openReader(page: Page) {
  await entry(page).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${fake.base}${READER}`)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + location.pathname')).toBe(`complete${READER}`)
}
/** 在阅读页里真的拖选第 i 段的前 chars 个字，再点微信读书自己的「划线」 */
async function highlight(page: Page, i: number, chars: number) {
  const wv = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `(() => { const p = document.getElementById('p${i}'); const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, ${chars}); const a = range.getClientRects()[0]; const rs = range.getClientRects(); const b = rs[rs.length - 1]; return JSON.stringify({ x0: a.left + 1, y0: a.top + a.height / 2, x1: b.right - 1, y1: b.top + b.height / 2 }) })()`))) as { x0: number; y0: number; x1: number; y1: number }
  for (let k = 0; k < 3; k++) {
    await page.mouse.move(wv.x + r.x0, wv.y + r.y0)
    await page.mouse.down()
    await page.mouse.move(wv.x + r.x1, wv.y + r.y1, { steps: 8 })
    await page.mouse.up()
    if (String(await guest(page, 'String(getSelection())')).trim()) break
    await page.waitForTimeout(300)
  }
  expect(String(await guest(page, 'String(getSelection())')).trim().length, '没选中字').toBeGreaterThan(0)
  const sent = () => fake.requests.filter((u) => u.startsWith('/web/book/addBookmark')).length
  const before = sent()
  await guestClick(page, '#mark')
  await expect.poll(sent).toBe(before + 1)
}

test('风格 A：设置里「还没登录 · 在右栏打开登录」→ 右栏是微信读书的扫码页 → 扫完码，设置里 3 秒内自己变成「已登录」', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env(), withFrame('a'))
  const { page } = run
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '插件' }).click()
    const sec = page.getByRole('region', { name: '微信读书' })
    const acct = sec.getByRole('group', { name: '微信读书登录' })
    await expect(acct).toContainText('还没登录微信读书')
    await expect(acct).toContainText('插件用右栏网页里的登录；扫一次码就记住')
    await expect(acct.locator('.bad')).toHaveCount(0)
    await shot(run, 'weread-settings-out')
    await acct.getByRole('button', { name: '在右栏打开登录' }).click()
    // A 的设置是中间的一个标签：不关，右栏开微信读书自己的扫码页
    await expect(sec).toBeVisible()
    await expect(web(page)).toBeVisible()
    await expect.poll(() => guest(page, `document.querySelector('h1')?.textContent`)).toBe('微信扫码登录')
    await expect(entry(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(rail(page).getByRole('button', { name: '网页', exact: true })).toHaveAttribute('aria-pressed', 'false')
    // 扫码（假网站上点「模拟扫码」= 微信读书种下登录的 cookie）：不点「现在同步」，3 秒内变
    await guestClick(page, '#scan')
    await expect.poll(() => guest(page, `document.getElementById('shelf')?.textContent ?? ''`)).toBe('我的书架')
    await expect(acct).toContainText('已登录', { timeout: 3000 })
    await expect(acct).toContainText('（读书的人）：用的是右栏网页里登录的微信读书')
    await expect(acct.getByRole('button', { name: '现在同步' })).toBeEnabled()
    await shot(run, 'weread-settings-in')
    await acct.getByRole('button', { name: '现在同步' }).click()
    await expect(acct).toContainText('已同步2本书、2条划线 · 上次 今天')
    // 只问网页版的接口；手机 App 那套一次没问
    expect(fake.requests.some((r) => r.startsWith('/api/user/notebook'))).toBe(true)
    expect(fake.requests.filter((r) => /^\/(book|review|user)\//.test(r))).toEqual([])
  } finally {
    await run.close()
  }
})

test('风格 B：设置弹窗里「在右栏打开登录」关掉弹窗、右栏开扫码页', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env(), withFrame('b', 'petrol'))
  const { page } = run
  try {
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '插件' }).click()
    const acct = page.getByRole('region', { name: '微信读书' }).getByRole('group', { name: '微信读书登录' })
    await expect(acct).toContainText('还没登录微信读书')
    await shot(run, 'weread-settings-out-dark')
    await acct.getByRole('button', { name: '在右栏打开登录' }).click()
    await expect(page.getByRole('dialog', { name: '设置' })).toHaveCount(0)
    await expect.poll(() => guest(page, `document.querySelector('h1')?.textContent`)).toBe('微信扫码登录')
  } finally {
    await run.close()
  }
})

test('右竖条「微信读书」：在网页下面；点开书架，再点收起，再点回到同一个标签；开着别的网页时点它切回微信读书那个标签；插件关掉这格就没有', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env(), withFrame('b'))
  const { page } = run
  try {
    await cookieLogin(run)
    // 名字后面的快捷键、变淡时说的为什么都不算（右图标栏方向 A：「笔记」一直在最上面，用不上时变淡）
    const labels = () => rail(page).locator('button.ab').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')!.replace(/ · .*/, '').replace(/（.*）$/, '')))
    await expect.poll(labels).toEqual(['笔记', '大纲', '网页', '微信读书', '记录', '自动化', '历史'])
    await entry(page).click()
    await expect(web(page)).toBeVisible()
    await expect.poll(() => guest(page, `document.getElementById('shelf')?.textContent ?? ''`)).toBe('我的书架')
    await expect(entry(page)).toHaveAttribute('aria-pressed', 'true')
    await shot(run, 'weread-entry')
    // 进一本书，接着读的地方
    // 右栏刚打开时第一下点网页有时落空（step15 拖选也是这样），没跳就再点一下
    for (let i = 0; i < 3; i++) {
      await guestClick(page, '#b1')
      if (await expect.poll(() => guest(page, 'location.pathname'), { timeout: 1500 }).toBe(READER).then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, 'location.pathname')).toBe(READER)
    // 再点 = 收起右栏
    await entry(page).click()
    await expect(web(page)).toBeHidden()
    // 再点：回到同一个标签、还是那本书，不另开
    await entry(page).click()
    await expect(web(page)).toBeVisible()
    await expect(webTabs(page)).toHaveCount(1)
    await expect.poll(() => guest(page, 'location.pathname')).toBe(READER)
    // 开一个别的网页，再点「微信读书」：切回那个标签
    await web(page).locator('button.wnew').click()
    await expect(webTabs(page)).toHaveCount(2)
    await expect(entry(page)).toHaveAttribute('aria-pressed', 'false')
    await entry(page).click()
    await expect(webTabs(page)).toHaveCount(2)
    await expect(webTabs(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => guest(page, 'location.pathname')).toBe(READER)
    // 设置里关掉微信读书插件：这一格没了
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '插件' }).click()
    await page.getByRole('region', { name: '微信读书' }).getByRole('switch', { name: '启用 微信读书' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(labels).toEqual(['笔记', '大纲', '网页', '记录', '自动化', '历史'])
  } finally {
    await run.close()
  }
})

test('划线：打开书那次没取成，紧接着划的第一条照样插进文档；登录超时先续一次 cookie 再取，照样插', async () => {
  const run = await launch({ '读书笔记.md': '# 读书笔记\n\n' }, env())
  const { page } = run
  try {
    await cookieLogin(run)
    await openNote(page, '读书笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    fake.failBookmarks = 1
    await openReader(page)
    // 打开书那一次（取划线）回了 500
    await expect.poll(() => fake.failBookmarks).toBe(0)
    await highlight(page, 1, 16)
    await expect(page.locator('#wr-toast')).toHaveText('已加到《读书笔记》')
    await waitSaved(page)
    expect(await editorText(page)).toContain(`> ${PARAS[1]!.slice(0, 16)}`)
    // 原来那条（早就有的）没被当成新的插进来
    expect(await editorText(page)).not.toContain(`> ${PARAS[0]}`)

    // 登录超时：网站换了 wr_skey，我们手里的旧了 → 回 -2012 → HEAD 续一次（网站种新 cookie）→ 再取，照样插
    const heads = fake.heads
    fake.skey = 'skey-expired'
    await highlight(page, 2, 10)
    await expect.poll(() => editorText(page), { timeout: 10_000 }).toContain(`> ${PARAS[2]!.slice(0, 10)}`)
    expect(fake.heads).toBeGreaterThan(heads)
    expect(fake.requests.filter((r) => /^\/(book|review|user)\//.test(r))).toEqual([])
  } finally {
    await run.close()
  }
})

test('阅读页的 __INITIAL_STATE__ 写的是别的书（真网站上这样）：按地址认书，划的这一段带的是这本书的书名和划线', async () => {
  const run = await launch({ '读书笔记.md': '# 读书笔记\n\n' }, env())
  const { page } = run
  try {
    await cookieLogin(run)
    fake.staleState = true
    await openNote(page, '读书笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await openReader(page)
    await highlight(page, 1, 14)
    await expect(page.locator('#wr-toast')).toHaveText('已加到《读书笔记》')
    await waitSaved(page)
    const md = await editorText(page)
    expect(md).toContain(`> ${PARAS[1]!.slice(0, 14)}\n—— [《${BOOK.title}》`)
    // 问的是这本书的划线，不是 __INITIAL_STATE__ 里那本
    expect(fake.requests.some((r) => r.startsWith(`/web/book/bookmarklist?bookId=${BOOK.bookId}`))).toBe(true)
  } finally {
    await run.close()
  }
})

test('插不进去时中间岛底部说原因：没登录（带「去登录」）、没认出这本书（网页改版了）', async () => {
  const run = await launch({ '读书笔记.md': '# 读书笔记\n\n' }, env())
  const { page } = run
  try {
    await openNote(page, '读书笔记')
    await openReader(page)
    await highlight(page, 1, 8)
    const toast = page.locator('#wr-toast')
    await expect(toast.locator('.t')).toHaveText('没登录微信读书')
    await expect(toast.getByRole('button', { name: '去登录' })).toBeVisible()
    await shot(run, 'weread-toast-login')
    // 点「去登录」：右栏切到微信读书（这里已经开着它的阅读页，就是这一页），提示收起
    await toast.getByRole('button', { name: '去登录' }).click()
    await expect(toast).not.toHaveClass(/\bon\b/)
    await expect(entry(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(webTabs(page)).toHaveCount(1)

    await cookieLogin(run)
    fake.hideBookId = true
    // 地址也认不出来的阅读页（微信读书改了地址的编法，网页里也没有书的编号）
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${fake.base}/web/reader/0000broken`)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
    await page.waitForTimeout(500)
    await highlight(page, 0, 8)
    await expect(toast).toHaveText('没认出这本书（网页改版了）')
    expect(await editorText(page)).not.toContain('> ')
  } finally {
    await run.close()
  }
})

test(`没登录过：打开软件不联网（不 HEAD 微信读书）；${BOOK.title} 之类的数据都不碰`, async () => {
  const before = fake.requests.length
  const run = await launch({ 'a.md': '# a\n' }, env())
  try {
    await run.page.waitForTimeout(800)
    expect(fake.requests.slice(before)).toEqual([])
  } finally {
    await run.close()
  }
})
