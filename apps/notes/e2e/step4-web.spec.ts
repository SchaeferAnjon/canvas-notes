import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, rail, waitSaved } from './app'
import { FAKE_PASSWORD, makeFakeChrome } from './fake-chrome'
import { ICELAND } from './fixtures/board'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/whoami') return res.end(`<title>who</title><p id="who">cookie=${req.headers.cookie ?? ''}</p>`)
    res.end(`<title>How to Get Rich</title><body style="font:16px sans-serif;padding:20px">
      <p id="p1">Seek wealth, not money or status.</p><p id="p2">Wealth is having assets that earn while you sleep.</p></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

async function openWeb(page: Page, url: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
  await expect(web(page).locator('webview')).toBeVisible()
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${url}`)
}

/** 在网页里跑一段 JS（只用来读位置和内容，点和选都用真的鼠标） */
function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('webview') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function guestRect(page: Page, code: string) {
  const w = (await web(page).locator('webview').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(${code}.getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

/** 用鼠标三击选中一段，再点工具条 */
async function selectAndClip(page: Page, id: string, expectLabel: string) {
  const p = await guestRect(page, `document.getElementById('${id}')`)
  // 刚载入的网页偶尔吞掉第一下点击（选区是空的），像人一样再选一次
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(p.x, p.y, { clickCount: 3 })
    if (await expect.poll(() => guest(page, 'getSelection().toString().length'), { timeout: 1000 }).toBeGreaterThan(0).then(() => true, () => false)) break
  }
  await expect.poll(() => guest(page, `(document.getElementById('cn-clip-host')?.shadowRoot?.querySelector('button')?.textContent ?? '') + '|' + document.getElementById('cn-clip-host')?.style.display`)).toBe(`${expectLabel}|block`)
  const b = await guestRect(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('button')`)
  await page.mouse.click(b.x, b.y)
}

test('文档里剪藏：选中一段点「剪进文档」，引文插到光标所在段后面，带来源；收件箱不变', async () => {
  const run = await launch({ '所思所想.md': '# 所思所想\n\n财富是靠专长、杠杆。\n\n最后一段。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '所思所想')
    await pane(page).locator('.cm-line', { hasText: '财富是靠专长' }).click()
    await page.keyboard.press('End')
    await openWeb(page, `${base}/rich`)
    // 网页开着时，文档光标是李子紫竖线
    await expect(page.locator('.win')).toHaveClass(/web-open/)
    await selectAndClip(page, 'p1', '剪进文档· 插到：所思所想 · 光标处')
    await expect(page.locator('.toast-cn')).toContainText('插到「所思所想」光标处')
    await expect(pane(page).locator('.cm-justclipped').first()).toBeVisible()
    await waitSaved(page)
    const want = `# 所思所想\n\n财富是靠专长、杠杆。\n\n> Seek wealth, not money or status.\n—— [How to Get Rich](${base}/rich)\n\n最后一段。\n`
    expect(readFileSync(join(vault, '所思所想.md'), 'utf8')).toBe(want)
    expect(await editorText(page)).toBe(want)
    expect(readdirSync(vault)).not.toContain('收件箱')
  } finally {
    await run.close()
  }
})

test('白板里剪藏：「剪成卡片 · 到：收件箱」，收件箱多一篇带来源，白板的未整理加一', async () => {
  const run = await launch({ '冰岛自驾.md': ICELAND })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    await expect(pane(page).getByTestId('unsorted')).toContainText('1 未整理')
    await openWeb(page, `${base}/rich`)
    await selectAndClip(page, 'p2', '剪成卡片· 到：收件箱')
    await expect(page.locator('.toast-cn')).toContainText('放进收件箱')
    await expect(pane(page).getByTestId('unsorted')).toContainText('2 未整理')
    const files = readdirSync(join(vault, '收件箱'))
    expect(files).toHaveLength(1)
    const md = readFileSync(join(vault, '收件箱', files[0]!), 'utf8')
    expect(md).toMatch(new RegExp(`^---\\ncreated: .+\\nsource: ${base.replace(/\./g, '\\.')}/rich\\n---\\n> Wealth is having assets that earn while you sleep\\.\\n—— \\[How to Get Rich\\]`))
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toBe(ICELAND)
    // 右栏开着时白板缩到 0.8
    await expect(pane(page).locator('.plane')).toHaveAttribute('style', /scale\(0\.8\)/)
  } finally {
    await run.close()
  }
})

test('一键导入 Chrome 登录：选 Chrome 用户，cookie 进内置浏览器，网站看到登录状态', async () => {
  const chrome = mkdtempSync(join(tmpdir(), 'cn-fake-chrome-'))
  makeFakeChrome(chrome, [
    { host: '127.0.0.1', name: 'session', value: 'logged-in-abc' },
    { host: '127.0.0.1', name: 'old', value: 'x', expired: true },
  ])
  const run = await launch({ 'a.md': 'a\n' }, { CN_CHROME_ROOT: chrome, CN_TEST_KEYCHAIN_PASSWORD: FAKE_PASSWORD })
  const { page } = run
  try {
    await openNote(page, 'a')
    await openWeb(page, `${base}/whoami`)
    await expect.poll(() => guest(page, `document.getElementById('who').textContent`)).toBe('cookie=')
    await web(page).getByRole('button', { name: '导入 Chrome 登录' }).click()
    const menu = page.getByRole('menu', { name: '选 Chrome 用户' })
    await expect(menu).toContainText('工作')
    await expect(menu).toContainText('me@example.com')
    await menu.getByRole('menuitem', { name: /工作/ }).click()
    await expect(page.locator('.toast-cn')).toContainText('导入了 1 个登录信息，1 个已过期没导')
    await expect.poll(() => guest(page, `document.getElementById('who')?.textContent`)).toBe('cookie=session=logged-in-abc')
  } finally {
    await run.close()
    rmSync(chrome, { recursive: true, force: true })
  }
})
