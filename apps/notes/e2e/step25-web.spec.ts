// 发版前第 1 轮（实用 · 读与 AI）：右栏网页的地址栏 esc、新网页「开着的网页」和快捷书签空着时那句、三个标签分得出谁是谁
import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, rail, widenRight } from './app'
import { shotPart, shotTone, shotWindow } from './shots'

let server: Server
let base = ''
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const n = req.url?.slice(1) || '0'
    res.end(`<title>第 ${n} 页 - 雷克雅未克</title><body style="font:16px sans-serif;padding:20px"><h1>第 ${n} 页</h1></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })
const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>

async function go(page: Page, u: string) {
  await addr(page).fill(u)
  await addr(page).press('Enter')
  await expect(webTabs(page).and(page.locator('.on'))).toContainText(/第 \d+ 页/)
}

test('地址栏打了字按 esc：还原成正在看的网址并全选；再按 esc 离开地址栏，地址栏写的还是这一页', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${base}/1`)
    await addr(page).click()
    await page.keyboard.type('乱打的')
    await expect(addr(page)).toHaveValue('乱打的')
    await page.keyboard.press('Escape')
    await expect(addr(page)).toHaveValue(`${base}/1`)
    expect(await addr(page).evaluate((i: HTMLInputElement) => [i.selectionStart, i.selectionEnd, i.value.length])).toEqual([0, `${base}/1`.length, `${base}/1`.length])
    await page.keyboard.press('Escape')
    await expect(addr(page)).not.toBeFocused()
    await expect(addr(page)).toHaveValue(`${base.replace(/^https?:\/\//, '')}/1`)
  } finally {
    await run.close()
  }
})

test('新网页「开着的网页」：网站名写 127.0.0.1 不写成「127 0 0 1」；一个网站时头上只写「1个网站」，「关掉这2个」只有卡片里一颗', async () => {
  const icloud = mkdtempSync(join(tmpdir(), 'cn-icloud-'))
  const run = await launch({ 'a.md': '# a\n' }, { CN_ICLOUD_CONTAINER: icloud })
  const { page } = run
  try {
    await shotTone(page)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${base}/1`)
    await web(page).locator('button.wnew').click()
    await go(page, `${base}/2`)
    await web(page).locator('button.wnew').click()
    await expect(webTabs(page)).toHaveCount(3)
    await expect.poll(() => guest(page, `document.querySelector('#openTabsMissions .mission-name')?.textContent ?? ''`)).toBe('127.0.0.1')
    expect(await guest(page, `document.getElementById('openTabsSectionCount').textContent.replace(/\\s+/g, ' ').trim()`)).toBe('1个网站')
    expect(await guest(page, `[...document.querySelectorAll('#openTabsSection .close-tabs')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim())`)).toEqual(['关掉这2个'])
    await guest(page, `document.getElementById('openTabsSection').scrollIntoView()`)
    // 新网页有入场动画（fadeUp），等它放完再截
    await expect.poll(() => guest(page, `getComputedStyle(document.querySelector('#openTabsSection .section-header')).opacity`)).toBe('1')
    await shotWindow(run, 'r1-newtab-open-tabs')
  } finally {
    await run.close()
    rmSync(icloud, { recursive: true, force: true })
  }
})

test('新网页只有它一个标签：快捷书签空着那句不指向看不见的「开着的网页」，说先开几个网页；开了网页再回来，指向下面那一栏', async () => {
  const icloud = mkdtempSync(join(tmpdir(), 'cn-icloud-'))
  const run = await launch({ 'a.md': '# a\n' }, { CN_ICLOUD_CONTAINER: icloud })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await expect.poll(() => guest(page, `document.querySelector('.bk-quick-empty')?.innerText ?? ''`)).toBe('还没有快捷书签。先开几个网页，再回到新网页，在「开着的网页」里点网页旁边的星星，就加进来了。')
    expect(await guest(page, `getComputedStyle(document.getElementById('openTabsSection')).display`)).toBe('none')
    await go(page, `${base}/1`)
    await web(page).locator('button.wnew').click()
    await expect.poll(() => guest(page, `document.querySelector('.bk-quick-empty')?.innerText ?? ''`)).toBe('还没有快捷书签。在下面「开着的网页」里点网页旁边的星星，就加进来了。')
  } finally {
    await run.close()
    rmSync(icloud, { recursive: true, force: true })
  }
})

test('右栏开 3 个网页：窄（默认 380）时别的标签只剩图标、悬停看名字；拉宽到 720 以上每个标签的名字至少留 48 像素（四个字上下），分得出谁是谁', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page } = run
  try {
    await shotTone(page)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${base}/1`)
    for (const n of [2, 3]) {
      await web(page).locator('button.wnew').click()
      await go(page, `${base}/${n}`)
    }
    await expect(webTabs(page)).toHaveCount(3)
    // 窄：别的标签只剩图标（task-sta8n 方向 A，原型 .narrow），名字在悬停提示里
    const others = webTabs(page).and(page.locator(':not(.on)'))
    for (const w of await others.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))) expect(w).toBeLessThanOrEqual(32)
    await expect(others.first()).toHaveAttribute('title', /第 \d 页 - 雷克雅未克/)
    // 收起左栏、网页栏拉宽到 720 以上：名字摆出来
    await page.locator('main.center').click({ position: { x: 300, y: 300 } })
    await page.keyboard.press('Meta+Backslash')
    await widenRight(page, 500)
    await expect(web(page)).toHaveClass(/w-wide/)
    await shotPart(web(page).getByRole('tablist', { name: '网页标签' }), 'r1-web-three-tabs')
    const widths = await others.locator('.tl .truncate').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))
    expect(widths).toHaveLength(2)
    for (const w of widths) expect(w).toBeGreaterThanOrEqual(48)
    // 不是当前的标签：悬停时 × 出来，点它能关
    await webTabs(page).nth(0).hover()
    await expect(webTabs(page).nth(0).getByRole('button', { name: '关闭网页标签' })).toHaveCSS('opacity', '1')
    await shotPart(web(page).getByRole('tablist', { name: '网页标签' }), 'r1-web-tab-hover')
    await webTabs(page).nth(0).getByRole('button', { name: '关闭网页标签' }).click()
    await expect(webTabs(page)).toHaveCount(2)
  } finally {
    await run.close()
  }
})
