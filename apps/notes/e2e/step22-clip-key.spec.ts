// 网页里选中一段后 ⌘↵ = 点小条上的「剪进文档」（录屏 ① CN-42）；小条写出 ⌘↵；焦点在网页的输入框里时不拦，网页自己的 ⌘↵ 照常用。
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, rail, type Running, waitSaved, widenRight } from './app'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<title>乔治·赫伯特·沃克·布什 - 维基百科</title><body style="font:16px sans-serif;padding:20px">
      <p id="p1">乔治·赫伯特·沃克·布什，美国政治人物，第41任美国总统。</p>
      <textarea id="c" rows="3" cols="40"></textarea><p id="sent"></p>
      <script>document.getElementById('c').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.metaKey) document.getElementById('sent').textContent = '网页提交了：' + e.target.value })</script></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
async function guestRect(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(${code}.getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}
const wcId = (page: Page) => page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())
/** 在网页里按键：Playwright 的 keyboard 到不了 webview 里的网页，从主进程往当前网页送真的按键（走网页预加载的监听） */
async function pressInPage(run: Running, key: string, modifiers: ('alt' | 'meta' | 'shift')[] = []) {
  await run.app.evaluate(
    ({ webContents }, [id, k, mods]) => {
      const wc = webContents.fromId(id as number)!
      wc.sendInputEvent({ type: 'keyDown', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
    },
    [await wcId(run.page), key, modifiers] as const,
  )
}
async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(250)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

test('选中一段按 ⌘↵：文档光标处多一段带来源的引文；在网页的文本框里按 ⌘↵，网页照常提交、文档不变', async () => {
  const run = await launch({ '布什.md': '# 布什\n\n笔记：\n' })
  const { page, vault } = run
  try {
    await openNote(page, '布什')
    await pane(page).locator('.cm-line', { hasText: '笔记：' }).click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/bush`)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${base}/bush`)
    // 真的鼠标三击选中一段
    const p = await guestRect(page, `document.getElementById('p1')`)
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(p.x, p.y, { clickCount: 3 })
      if (await expect.poll(() => guest(page, 'getSelection().toString().length'), { timeout: 1000 }).toBeGreaterThan(0).then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
    expect(await guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('button.clip kbd').textContent`)).toBe('⌘↵')
    // 右栏 340 宽里整条小条都在网页里（放不下时先藏键帽，再藏「· 插到：…」）
    expect(await guest(page, `(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector('.bar').getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth })()`)).toBe(true)
    await shot(run, 'clip-key-bar-narrow')
    // 右栏拉宽：键帽露出来
    await widenRight(page, 260)
    for (let i = 0; i < 3; i++) {
      const q = await guestRect(page, `document.getElementById('p1')`)
      await page.mouse.click(q.x, q.y, { clickCount: 3 })
      if (await expect.poll(() => guest(page, `getComputedStyle(document.getElementById('cn-clip-host').shadowRoot.querySelector('button.clip kbd')).display`), { timeout: 1500 }).not.toBe('none').then(() => true, () => false)) break
    }
    expect(await guest(page, `getComputedStyle(document.getElementById('cn-clip-host').shadowRoot.querySelector('button.clip kbd')).display`)).not.toBe('none')
    await shot(run, 'clip-key-bar')
    await pressInPage(run, 'Enter', ['meta'])
    await expect(page.locator('.toast-cn')).toContainText('插到「布什」光标处')
    await waitSaved(page)
    // 引文后面补一个空段落放光标（编辑器组 CN-17：插入后光标落到下面新空段）
    const want = `# 布什\n\n笔记：\n\n> 乔治·赫伯特·沃克·布什，美国政治人物，第41任美国总统。\n—— [乔治·赫伯特·沃克·布什 - 维基百科](${base}/bush)\n\n`
    expect(await editorText(page)).toBe(want)
    expect(readFileSync(join(vault, '布什.md'), 'utf8')).toBe(want)
    // 小条收起、选区清掉
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').style.display`)).toBe('none')

    // 网页自己的文本框：⌘↵ 交给网页
    // 剪进文档后焦点交回了文档（CN-17）：点网页里的文本框，等焦点真的到了文本框再打字。
    // 不等的话机器忙时第一下只把焦点给了 webview，⌘A 全选的是整页正文，⌘↵ 就照规矩把整页选区剪进文档了
    const c = await guestRect(page, `document.getElementById('c')`)
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(c.x, c.y)
      if (await expect.poll(() => guest(page, `document.activeElement && document.activeElement.id`), { timeout: 1000 }).toBe('c').then(() => true, () => false)) break
    }
    expect(await guest(page, `document.activeElement && document.activeElement.id`)).toBe('c')
    await run.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.insertText('写一条评论'), await wcId(page))
    // 文本框里选中自己打的字，再按 ⌘↵：还是网页的
    await pressInPage(run, 'A', ['meta'])
    await pressInPage(run, 'Enter', ['meta'])
    await expect.poll(() => guest(page, `document.getElementById('sent').textContent`)).toBe('网页提交了：写一条评论')
    await page.waitForTimeout(500)
    expect(await editorText(page)).toBe(want)
  } finally {
    await run.close()
  }
})
