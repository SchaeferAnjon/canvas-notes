// 网页里选中一段后按键 = 点小条上那一颗（录屏 ① CN-42）。task-6cxtc 起：⌘S = 「剪藏」（剪进这个网页正在剪进去的那篇，没配对时先问记到哪篇），
// ⌘↵ = 「引用」（这段成为 AI 输入框顶上的一块材料）；小条上写出这两个键；焦点在网页的输入框里时都不拦，网页自己的 ⌘↵、⌘S 照常用。
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, rail, type Running, waitSaved, webAboveAi, widenRight } from './app'
import { fragmentUrl, sourceLabel } from '../src/shared/web-link'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<title>乔治·赫伯特·沃克·布什 - 维基百科</title><body style="font:16px sans-serif;padding:20px">
      <p id="p1">乔治·赫伯特·沃克·布什，美国政治人物，第41任美国总统。</p>
      <textarea id="c" rows="3" cols="40"></textarea><p id="sent"></p>
      <p id="saved"></p>
      <script>document.getElementById('c').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.metaKey) document.getElementById('sent').textContent = '网页提交了：' + e.target.value
        if (e.key.toLowerCase() === 's' && e.metaKey) { e.preventDefault(); document.getElementById('saved').textContent = '网页存了：' + e.target.value }
      })</script></body>`)
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

test('选中一段按 ⌘S：这个网站记进《布什》，文档光标处多一段带来源的引文；再选一段按 ⌘↵ 是引用，进 AI 输入框、文档不变；在网页的文本框里按 ⌘↵、⌘S，网页照常处理、文档不变', async () => {
  const run = await launch({ '布什.md': '# 布什\n\n笔记：\n' })
  const { page, vault } = run
  const selectP1 = async () => {
    const p = await guestRect(page, `document.getElementById('p1')`)
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(p.x, p.y, { clickCount: 3 })
      if (await expect.poll(() => guest(page, 'getSelection().toString().length'), { timeout: 1000 }).toBeGreaterThan(0).then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
  }
  try {
    // 这个网站记进《布什》（同「记到这篇」；剪藏去处规则：没配对、没选文件夹时 ⌘S 进收件箱）
    await page.evaluate(([b, p]) => localStorage.setItem('cn.webTarget', JSON.stringify({ [b!]: p })), [base, '布什.md'])
    await openNote(page, '布什')
    await pane(page).locator('.cm-line', { hasText: '笔记：' }).click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/bush`)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${base}/bush`)
    // 真的鼠标三击选中一段
    await selectP1()
    // 小条写出键：剪藏 ⌘S、引用 ⌘↵
    expect(await guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('button.clip kbd').textContent`)).toBe('⌘S')
    expect(await guest(page, `[...document.getElementById('cn-clip-host').shadowRoot.querySelectorAll('.bar > button')].find((b) => b.textContent.trim().startsWith('引用')).querySelector('kbd').textContent`)).toBe('⌘↵')
    // 右栏 340 宽里整条小条都在网页里（放不下时先藏键帽，再只留图标、收进「⋯」）
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
    await pressInPage(run, 'S', ['meta'])
    await expect(page.getByRole('dialog', { name: '记到哪篇' })).toHaveCount(0)
    await expect(page.locator('.toast-cn')).toContainText('剪进《布什》光标处')
    await waitSaved(page)
    // 引文后面补一个空段落放光标（编辑器组 CN-17：插入后光标落到下面新空段）；来源一行是回到这一段的链接；配成一对写上 read-along
    const quote = '乔治·赫伯特·沃克·布什，美国政治人物，第41任美国总统。'
    const src = `[${sourceLabel({ title: '乔治·赫伯特·沃克·布什 - 维基百科', url: `${base}/bush` })}](${fragmentUrl(`${base}/bush`, quote)})`
    const want = `# 布什\n\n笔记：\n\n> ${quote}\n—— ${src}\n\n`
    expect(await editorText(page)).toBe(want)
    expect(readFileSync(join(vault, '布什.md'), 'utf8')).toBe(want)
    // 小条收起、选区清掉
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').style.display`)).toBe('none')

    // 再选这段按 ⌘↵：引用，不是剪藏。这段成为网页那一处 AI 输入框顶上的一块材料、光标在输入框，文档不变
    await selectP1()
    await pressInPage(run, 'Enter', ['meta'])
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    const ta = ai.getByRole('textbox', { name: '问 AI' })
    await expect(ta).toHaveValue('①')
    await expect(ta).toBeFocused()
    await expect(ai.getByTestId('ai-mat').locator('.ct')).toHaveText(quote)
    expect(await editorText(page)).toBe(want)
    // AI 和网页叠在一组、AI 在前面：像人一样把网页拖到上半，接着在网页里打字
    await webAboveAi(page)

    // 网页自己的文本框：⌘↵、⌘S 都交给网页
    // 剪藏后焦点交回了文档（CN-17）、引用后在 AI 输入框：点网页里的文本框，等焦点真的到了文本框再打字。
    // 不等的话机器忙时第一下只把焦点给了 webview，⌘A 全选的是整页正文，按键就照规矩把整页选区剪走、引走了
    const c = await guestRect(page, `document.getElementById('c')`)
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(c.x, c.y)
      if (await expect.poll(() => guest(page, `document.activeElement && document.activeElement.id`), { timeout: 1000 }).toBe('c').then(() => true, () => false)) break
    }
    expect(await guest(page, `document.activeElement && document.activeElement.id`)).toBe('c')
    await run.app.evaluate(({ webContents }, id) => webContents.fromId(id)!.insertText('写一条评论'), await wcId(page))
    // 文本框里选中自己打的字，再按 ⌘↵、⌘S：还是网页的
    await pressInPage(run, 'A', ['meta'])
    await pressInPage(run, 'Enter', ['meta'])
    await expect.poll(() => guest(page, `document.getElementById('sent').textContent`)).toBe('网页提交了：写一条评论')
    await pressInPage(run, 'S', ['meta'])
    await expect.poll(() => guest(page, `document.getElementById('saved').textContent`)).toBe('网页存了：写一条评论')
    await page.waitForTimeout(500)
    expect(await editorText(page)).toBe(want)
    await expect(ai.getByTestId('ai-mat')).toHaveCount(1)
    await expect(page.getByRole('dialog', { name: '记到哪篇' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})
