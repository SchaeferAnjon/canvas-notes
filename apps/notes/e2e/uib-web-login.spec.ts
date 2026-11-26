/**
 * ui-b A11（用户：网页里经常要点「导入 Chrome 登录」）：内置浏览器的登录重开软件后要还在。
 * 本机假网站登录时发两个 cookie：持久的 keep（Max-Age 一天）和会话的 tab（没有过期时间，很多网站的登录就是它）。
 * - 正常退出重开：两个都在（以前会话 cookie 一退出就没了：Electron 不把会话 cookie 写盘）；
 * - 登录后 1.5 秒强杀（SIGKILL，像崩溃、强制退出）重开：两个都在（以前 Chromium 攒 30 秒才写一次盘，强杀丢掉刚登录的）；
 * - 从 Chrome 导入（持久的和会话的各一个）后强杀重开：都在。
 * 全在测试模式里真开网页、真点「⋯ › 导入Chrome登录」，同一个设置目录重开软件，网站自己看 Cookie 头。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, rail, type Running, webMore } from './app'
import { FAKE_PASSWORD, makeFakeChrome } from './fake-chrome'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/login') {
      res.setHeader('set-cookie', ['keep=k1; Max-Age=86400; Path=/; HttpOnly', 'tab=t1; Path=/; HttpOnly'])
      return res.end('<title>登录好了</title><p id="who">登录好了</p>')
    }
    // 网站看到的 cookie（服务器收到的 Cookie 头，HttpOnly 的也算）
    const got = (req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).sort().join(' ')
    res.end(`<title>我是谁</title><p id="who">${got || '没登录'}</p>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => new Promise<void>((r) => server.close(() => r())))

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('webview') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

async function openWeb(page: Page, url: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  // 右栏网页已经开着就不再点（再点是收起）
  if (!(await addr.isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  await addr.fill(url)
  await addr.press('Enter')
  await expect(web(page).locator('webview')).toBeVisible()
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${url}`)
}

/** 网站看到的登录（打开「我是谁」那一页读出来） */
async function who(page: Page) {
  await openWeb(page, `${base}/whoami?${Date.now()}`)
  return String(await guest(page, `document.getElementById('who').textContent`))
}

/** 强杀软件（SIGKILL，不走退出），等它真的没了；临时库删掉，设置目录留着重开用 */
async function kill(run: Running) {
  const proc = run.app.process()
  const gone = new Promise<void>((r) => (proc.exitCode !== null ? r() : proc.once('exit', () => r())))
  proc.kill('SIGKILL')
  await gone
  rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
}

test('A11 网站自己设的登录（持久 cookie + 会话 cookie）：正常退出重开还在', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cn-uib-ud-'))
  try {
    // 登录 → 正常退出（⌘Q 一样的路：app.close）→ 重开，再退再开一次
    let run = await launch({ 'a.md': 'a\n' }, { CN_USER_DATA: userData })
    await openWeb(run.page, `${base}/login`)
    expect(await who(run.page)).toBe('keep=k1 tab=t1')
    await run.close()
    for (const round of ['正常退出重开', '再退再开']) {
      run = await launch({ 'a.md': 'a\n' }, { CN_USER_DATA: userData })
      expect(await who(run.page), round).toBe('keep=k1 tab=t1')
      await run.close()
    }
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('A11 网站自己设的登录：登录后 1.5 秒强杀（SIGKILL）重开还在', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cn-uib-ud-'))
  try {
    let run = await launch({ 'a.md': 'a\n' }, { CN_USER_DATA: userData })
    await openWeb(run.page, `${base}/login`)
    expect(await who(run.page)).toBe('keep=k1 tab=t1')
    await run.page.waitForTimeout(1500)
    await kill(run)
    run = await launch({ 'a.md': 'a\n' }, { CN_USER_DATA: userData })
    expect(await who(run.page), '强杀重开').toBe('keep=k1 tab=t1')
    await run.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})

test('A11 从 Chrome 导入的登录（持久的、会话的各一个）：导入后强杀重开、再正常退出重开都还在', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cn-uib-ud-'))
  const chrome = mkdtempSync(join(tmpdir(), 'cn-fake-chrome-'))
  makeFakeChrome(chrome, [
    { host: '127.0.0.1', name: 'csid', value: 'chrome-keep' },
    { host: '127.0.0.1', name: 'ctab', value: 'chrome-tab', session: true },
  ])
  const env = { CN_USER_DATA: userData, CN_CHROME_ROOT: chrome, CN_TEST_KEYCHAIN_PASSWORD: FAKE_PASSWORD }
  try {
    let run = await launch({ 'a.md': 'a\n' }, env)
    expect(await who(run.page)).toBe('没登录')
    await webMore(run.page, '导入Chrome登录')
    await run.page.getByRole('menu', { name: '选 Chrome 用户' }).getByRole('menuitem', { name: /工作/ }).click()
    await expect(run.page.locator('.toast-cn')).toContainText('导入了2个登录信息')
    expect(await who(run.page)).toBe('csid=chrome-keep ctab=chrome-tab')
    await run.page.waitForTimeout(1500)
    await kill(run)
    run = await launch({ 'a.md': 'a\n' }, env)
    expect(await who(run.page), '导入后强杀重开').toBe('csid=chrome-keep ctab=chrome-tab')
    await run.close()
    run = await launch({ 'a.md': 'a\n' }, env)
    expect(await who(run.page), '再正常退出重开').toBe('csid=chrome-keep ctab=chrome-tab')
    await run.close()
  } finally {
    rmSync(userData, { recursive: true, force: true })
    rmSync(chrome, { recursive: true, force: true })
  }
})
