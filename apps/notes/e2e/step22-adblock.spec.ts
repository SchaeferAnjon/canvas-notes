// 拦广告（内置插件，录屏 ① CN-51）：本机假规则（EasyList 的写法）+ 本机假页面，一个广告脚本、一个 .ad-banner 广告位。
// 开着时两样都不出现；「⋯ › 在 <网站> 不拦广告」只对这个网站（127.0.0.1 不拦，localhost 照样拦）；设置里关掉插件后都出现。
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { launch, rail, type Running } from './app'

let server: Server
let port = 0
let listUrl = ''
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/lists/easylist.txt') return res.writeHead(200, { 'content-type': 'text/plain' }).end('[Adblock Plus 2.0]\n! 假规则\n/adframe/banner.js$script\n##.ad-banner\n')
    if (req.url === '/adframe/banner.js') return res.writeHead(200, { 'content-type': 'text/javascript' }).end('window.__ad = 1')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<title>旅行杂志</title><body style="font:16px sans-serif;padding:20px">
      <div class="ad-banner" id="ad" style="height:90px;background:#fc0">广告位：买机票送酒店</div><p id="p">冰岛南岸的黑沙滩。</p><script src="/adframe/banner.js"></script></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  port = (server.address() as { port: number }).port
  listUrl = `http://127.0.0.1:${port}/lists/easylist.txt`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>
/** 这一页的广告：脚本跑了没有、广告位看得见没有 */
const ads = (page: Page) => guest<string>(page, `(window.__ad ? '脚本' : '') + '|' + (getComputedStyle(document.getElementById('ad')).display === 'none' ? '' : '广告位')`)
async function go(page: Page, u: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}
async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

test('开着时广告脚本和广告位都不出现；「在 127.0.0.1 不拦广告」只对它；设置里关掉插件后都出现', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_ADBLOCK_LISTS: listUrl })
  const { page } = run
  try {
    // 开软件不取规则（用户还没去任何网站）；第一次去网站时才取，这一页等规则取回来再放行，广告照样拦住
    const state = async () => (await page.evaluate(() => window.cnPlugins.call<{ state: string }>('adblock', 'status'))).state
    await page.waitForTimeout(1000)
    expect(await state()).toBe('idle')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const a = `http://127.0.0.1:${port}/`
    await go(page, a)
    expect(await state()).toBe('ok')
    await expect.poll(() => ads(page)).toBe('|')
    await shot(run, 'adblock-on')

    // ⋯ › 在 127.0.0.1 不拦广告：这一页重新载入，广告出来
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    const item = web(page).getByRole('menu', { name: '更多', exact: true }).getByRole('menuitemcheckbox', { name: '在127.0.0.1不拦广告' })
    await expect(item).toHaveAttribute('aria-checked', 'false')
    await shot(run, 'adblock-menu')
    await item.click()
    await expect.poll(() => ads(page)).toBe('脚本|广告位')
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    await expect(web(page).getByRole('menu', { name: '更多', exact: true }).getByRole('menuitemcheckbox', { name: '在127.0.0.1不拦广告' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')

    // 别的网站（localhost）照样拦
    await web(page).locator('button.wnew').click()
    await go(page, `http://localhost:${port}/`)
    await expect.poll(() => ads(page)).toBe('|')

    // 设置 › 插件 › 拦广告：规则数、拦了几个、不拦的网站
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: '插件' }).click()
    const sec = page.getByRole('region', { name: '拦广告' })
    await expect(sec.getByLabel('规则')).toContainText(/EasyList \+ EasyPrivacy · 2条规则 · .*更新 · 这次打开拦了[1-9]\d*个/)
    await expect(sec.getByRole('list', { name: '不拦的网站' }).getByRole('listitem')).toHaveText(['127.0.0.1'])
    await sec.scrollIntoViewIfNeeded()
    await shot(run, 'adblock-settings')
    // 关掉插件：localhost 重新载入后广告也出来
    await sec.getByRole('switch', { name: '启用 拦广告' }).click()
    await page.keyboard.press('Meta+,')
    await web(page).getByRole('button', { name: '重新载入' }).click()
    await expect.poll(() => ads(page)).toBe('脚本|广告位')
  } finally {
    await run.close()
  }
})
