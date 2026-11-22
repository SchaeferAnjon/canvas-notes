import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acts, editorText, launch, openNote, pane, rail, waitSaved, webMore } from './app'
import { FAKE_PASSWORD, makeFakeChrome } from './fake-chrome'
import { ICELAND } from './fixtures/board'
import { fragmentUrl, sourceLabel } from '../src/shared/web-link'

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

const HOST = `document.getElementById('cn-clip-host')`
/**
 * 用鼠标三击选中一段，再点小条上的「剪藏」。task-6cxtc 起四处小条一个样：讲解一下 ↵ · 翻译 + 讲一讲 · 引用 ⌘↵ ｜ 剪藏 ⌘S · ⋯；
 * 剪到哪不再写在按钮上，指着「剪藏」0.3 秒出两行提示（tip：两行用 | 连起来）
 */
async function selectAndClip(page: Page, id: string, tip: string) {
  const p = await guestRect(page, `document.getElementById('${id}')`)
  // 刚载入的网页偶尔吞掉第一下点击（选区是空的），像人一样再选一次
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(p.x, p.y, { clickCount: 3 })
    if (await expect.poll(() => guest(page, 'getSelection().toString().length'), { timeout: 1000 }).toBeGreaterThan(0).then(() => true, () => false)) break
  }
  await expect
    .poll(() => guest(page, `(() => { const h = ${HOST}; return h ? [...h.shadowRoot.querySelectorAll('.bar > button')].map((b) => b.textContent.replace(/\\s+/g, ' ').trim()).join('|') + '|' + h.style.display : '' })()`))
    .toBe('讲解一下↵|翻译 + 讲一讲|引用⌘↵|剪藏⌘S||block')
  const b = await guestRect(page, `${HOST}.shadowRoot.querySelector('button.clip')`)
  await page.mouse.move(b.x, b.y)
  await expect.poll(() => guest(page, `${HOST}.shadowRoot.querySelector('.tip')?.innerText.replace(/\\n+/g, '|')`)).toBe(tip)
  await page.mouse.click(b.x, b.y)
}

// task-6cxtc 起剪藏写进「这个网页正在剪进去的那篇」：这个网站还没和哪篇配对、中间开着文档时第一次剪先问「记到哪篇」，
// 「记到这篇」顺手配成一对（属性 read-along）；来源一行是「小标题 · 书名」+ 回到这一段的链接；底栏「剪进《X》光标处」
test('文档里剪藏：选中一段点「剪藏」，没配对先问记到哪篇，引文插到光标所在段后面，带回到这一段的来源；收件箱不变', async () => {
  const run = await launch({ '所思所想.md': '# 所思所想\n\n财富是靠专长、杠杆。\n\n最后一段。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '所思所想')
    await pane(page).locator('.cm-line', { hasText: '财富是靠专长' }).click()
    await page.keyboard.press('End')
    await openWeb(page, `${base}/rich`)
    // 网页开着时，文档光标是李子紫竖线
    await expect(page.locator('.win')).toHaveClass(/web-open/)
    await selectAndClip(page, 'p1', '剪进《所思所想》光标处|第一次剪先问一句记到哪篇；剪完能撤回、能换一篇')
    const dlg = page.getByRole('dialog', { name: '记到哪篇' })
    await expect(dlg).toBeVisible()
    await expect(dlg.getByRole('radio').nth(0)).toHaveAccessibleName(/所思所想/)
    await expect(dlg.getByRole('radio').nth(0)).toBeChecked()
    await expect(dlg.getByRole('radio').nth(2)).toHaveAccessibleName('剪成卡片，放进收件箱')
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(dlg).toHaveCount(0)
    await expect(page.locator('.toast-cn')).toContainText('剪进《所思所想》光标处')
    await expect(page.getByTestId('toast').getByRole('button', { name: '撤回' })).toBeVisible()
    await expect(pane(page).locator('.cm-flashbar:not([hidden])')).toHaveCount(1)
    await waitSaved(page)
    // 引文后面补了一个空段落放光标（CN-17）
    const quote = 'Seek wealth, not money or status.'
    const src = `[${sourceLabel({ title: 'How to Get Rich', url: `${base}/rich` })}](${fragmentUrl(`${base}/rich`, quote)})`
    const want = `---\nread-along: ${base}/\n---\n# 所思所想\n\n财富是靠专长、杠杆。\n\n> ${quote}\n—— ${src}\n\n\n\n最后一段。\n`
    expect(readFileSync(join(vault, '所思所想.md'), 'utf8')).toBe(want)
    expect(await editorText(page)).toBe(want)
    expect(readdirSync(vault)).not.toContain('收件箱')
    // 配好对了：再指着「剪藏」，说剪进这篇、能换一篇
    await selectAndClip(page, 'p2', '剪进《所思所想》光标处|剪完底栏说剪到了哪，能撤回、能换一篇')
    await expect(dlg).toHaveCount(0)
    await expect.poll(() => readFileSync(join(vault, '所思所想.md'), 'utf8')).toContain('> Wealth is having assets that earn while you sleep.')
  } finally {
    await run.close()
  }
})

// 中间是白板：不问记到哪篇，照旧剪成卡片放进收件箱（来源是回到这一段的链接）
test('白板里剪藏：指着「剪藏」说「剪成卡片，放进收件箱」，收件箱多一篇带来源，白板右上角「收件箱 N」加一', async () => {
  const run = await launch({ '冰岛自驾.md': ICELAND })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    // 收件箱一开始是空的（以前「1未整理」数的是这篇里开头那一段，现在它就在白板上）：不写数
    const inboxBtn = pane(page).getByTestId('db-inbox')
    await expect(inboxBtn).toHaveText('收件箱')
    // 以前的写法打开时转成「## 列名」：转好的这份就是这块白板，剪藏不碰它
    await expect.poll(() => readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).not.toBe(ICELAND)
    const converted = readFileSync(join(vault, '冰岛自驾.md'), 'utf8')
    await openWeb(page, `${base}/rich`)
    await selectAndClip(page, 'p2', '剪成卡片，放进收件箱|剪完底栏说剪到了哪，能撤回')
    await expect(page.getByRole('dialog', { name: '记到哪篇' })).toHaveCount(0)
    await expect(page.locator('.toast-cn')).toContainText('放进收件箱')
    await expect(inboxBtn).toHaveText('收件箱1')
    const files = readdirSync(join(vault, '收件箱'))
    expect(files).toHaveLength(1)
    const md = readFileSync(join(vault, '收件箱', files[0]!), 'utf8')
    const quote = 'Wealth is having assets that earn while you sleep.'
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(md).toMatch(new RegExp(`^---\\ncreated: .+\\nsource: ${esc(fragmentUrl(`${base}/rich`, quote))}\\n---\\n> ${esc(quote)}\\n—— \\[How to Get Rich\\]`))
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toBe(converted)
    // 右栏开着时白板缩到 0.8
    await expect.poll(() => pane(page).locator('.db-plane').evaluate((el) => (el as HTMLElement).style.zoom)).toBe('0.8')
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
    await webMore(page, '导入Chrome登录')
    const menu = page.getByRole('menu', { name: '选 Chrome 用户' })
    await expect(menu).toContainText('工作')
    await expect(menu).toContainText('me@example.com')
    await menu.getByRole('menuitem', { name: /工作/ }).click()
    await expect(page.locator('.toast-cn')).toContainText('导入了1个登录信息，1个已过期没导')
    await expect.poll(() => guest(page, `document.getElementById('who')?.textContent`)).toBe('cookie=session=logged-in-abc')
  } finally {
    await run.close()
    rmSync(chrome, { recursive: true, force: true })
  }
})
