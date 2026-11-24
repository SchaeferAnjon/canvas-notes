/**
 * 网页里的图、选中的字真拖进左边文档 / 白板（用户 0.5.11：「图怎么没办法从右边拖动到文档里了」）。
 * 真拖：网页里真按下、真移动（webview 的调试接口发鼠标，同 Playwright 拖拽的做法），Chromium 起拖时拦下系统拖拽，
 * 拿到网页给的真拖拽数据，再在界面上按真坐标发 dragEnter / dragOver / drop（系统拖拽送到界面的就是这几下）。
 * 页面照维基百科的写法：链接套着图、srcset 两档、figcaption、上面一个小标题。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { launch, openNote, pane, rail, waitSaved, type Running } from './app'
import { armMenus, pickMenu } from './menu'
import { solidPng } from './fixtures/png'
import { clipMarkdown } from '../src/shared/layout'
import { fragmentUrl, sourceLabel } from '../src/shared/web-link'

const PNG = solidPng(160, 100, [40, 90, 160])
const PNG2 = solidPng(320, 200, [40, 90, 160])
const TITLE = '过度捕捞 - 维基百科，自由的百科全书'
const PARA = '鱼群自然恢复的速度取决于该生态系统的条件是否适合鱼类生长。'
let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/tuna.png') return res.setHeader('content-type', 'image/png'), res.end(PNG)
    if (req.url === '/tuna-2x.png') return res.setHeader('content-type', 'image/png'), res.end(PNG2)
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(`<title>${TITLE}</title><body style="font:15px sans-serif;padding:12px">
      <p id="para">${PARA}</p>
      <h2>过捕情况及有关研究</h2>
      <figure typeof="mw:File/Thumb"><a href="/wiki/File:Tuna.jpg" class="mw-file-description"><img id="png" src="/tuna.png" srcset="/tuna-2x.png 2x" decoding="async" class="mw-file-element" width="160" height="100" style="display:block"></a><figcaption>北方蓝鳍金枪鱼</figcaption></figure>
      <p>${'2016年左右，全球超过85%的鱼类已经因过度捕鱼。'.repeat(6)}</p></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('aside webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

async function openWeb(page: Page) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/wiki`)
  await addr.press('Enter')
  await expect(web(page).locator('webview.on')).toBeVisible()
  await expect.poll(() => guest(page, 'document.readyState + "|" + document.getElementById("png").complete')).toBe('complete|true')
  // 网页那一格挪完再量坐标
  let last = ''
  await expect
    .poll(async () => {
      const b = JSON.stringify(await web(page).locator('webview.on').boundingBox())
      const same = b === last
      last = b
      return same
    })
    .toBe(true)
}

/** 网页里某个元素（或选区）中心的界面坐标 */
async function inWeb(page: Page, expr: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(${expr}.getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

/** 真拖：网页里按下 from、挪动到起拖，拦下的拖拽数据在界面上经过网页左边一点、走到 to 松手 */
async function realDrag(run: Running, page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold = 0) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const id = Number(await web(page).locator('webview.on').getAttribute('data-wc'))
  const got = await run.app.evaluate(
    async ({ webContents, BrowserWindow }, a) => {
      const g = webContents.fromId(a.id)!
      const host = BrowserWindow.getAllWindows()[0]!.webContents
      const gd = g.debugger
      const hd = host.debugger
      gd.attach('1.3')
      hd.attach('1.3')
      let data: unknown = null
      gd.on('message', (_e, m, p: { data?: unknown }) => {
        if (m === 'Input.dragIntercepted') data = p.data
      })
      try {
        await gd.sendCommand('Input.setInterceptDrags', { enabled: true })
        const gx = Math.round(a.from.x - a.w.x)
        const gy = Math.round(a.from.y - a.w.y)
        const m = (type: string, x: number, y: number, buttons = 1) => gd.sendCommand('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: 1 })
        await m('mouseMoved', gx, gy, 0)
        await m('mousePressed', gx, gy)
        // Mac 上拖选中的字要按住一会儿再挪（Chromium 的 text drag delay），拖图不用
        if (a.hold) await new Promise((r) => setTimeout(r, a.hold))
        for (let i = 1; i <= 10 && !data; i++) {
          await m('mouseMoved', gx - i * 6, gy)
          await new Promise((r) => setTimeout(r, 20))
        }
        if (!data) return false
        const dd = (type: string, x: number, y: number) => hd.sendCommand('Input.dispatchDragEvent', { type, x: Math.round(x), y: Math.round(y), data, modifiers: 0 })
        await dd('dragEnter', a.w.x - 10, a.from.y)
        for (const [x, y] of [[a.w.x - 10, a.from.y], [(a.w.x + a.to.x) / 2, (a.from.y + a.to.y) / 2], [a.to.x, a.to.y]] as const) {
          await dd('dragOver', x, y)
          await new Promise((r) => setTimeout(r, 60))
        }
        await dd('drop', a.to.x, a.to.y)
        // 拖拽在网页这边也收尾（网页收到 dragend，同系统拖拽结束），鼠标抬起来；不然下一次按下不算新的一拖
        await gd.sendCommand('Input.dispatchDragEvent', { type: 'dragCancel', x: 0, y: 0, data, modifiers: 0 }).catch(() => undefined)
        await m('mouseReleased', gx, gy, 0)
        return true
      } finally {
        await gd.sendCommand('Input.setInterceptDrags', { enabled: false }).catch(() => undefined)
        gd.detach()
        hd.detach()
      }
    },
    { id, from, to, w, hold },
  )
  expect(got).toBe(true)
}

const imgMarks = (page: Page) => guest(page, `(() => { const h = document.getElementById('cn-mark-host'); return h ? h.shadowRoot.querySelectorAll('.mk[data-img]').length : 0 })()`)
const file = (vault: string, rel: string) => readFileSync(join(vault, rel), 'utf8')

test('网页图真拖进文档：落在松手那一段后面（不是光标处），和右键「剪进文档」写的一字不差；剪过（💬）的再拖一次照样进；松在文末下面的空白里落到文末；AI 操作网页的边框亮着也能拖', async () => {
  const run = await launch({ '过度捕鱼.md': '# 过度捕鱼\n\n第一段。\n\n第二段。\n\n第三段。\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '过度捕鱼')
    // 光标放在最后（右键「剪进文档」插在光标处）
    await pane(page).locator('.cm-line', { hasText: '第三段' }).click()
    await page.keyboard.press('End')
    await openWeb(page)
    // 先照用户那样右键「剪进文档」剪一次：网页上那张图挂「💬1」
    const img = await inWeb(page, 'document.getElementById("png")')
    await page.mouse.click(img.x, img.y, { button: 'right' })
    await pickMenu(run, '剪进文档')
    await waitSaved(page)
    await expect.poll(() => file(vault, '过度捕鱼.md')).toContain('第三段。\n\n![')
    const byMenu = file(vault, '过度捕鱼.md').split('第三段。\n\n')[1]!.trim()
    expect(byMenu).toMatch(/^!\[北方蓝鳍金枪鱼\]\(附件\/过度捕鱼\/tuna-2x\.png\)\n\n—— \[过捕情况及有关研究 · .+\]\(.+#:~:text=北方蓝鳍金枪鱼\)$/)
    await expect.poll(() => imgMarks(page)).toBe(1)

    // 剪过的图真拖到「第一段」上：插在第一段后面，写法和右键剪的一样
    const line1 = (await pane(page).locator('.cm-line', { hasText: '第一段' }).boundingBox())!
    await realDrag(run, page, img, { x: line1.x + 30, y: line1.y + line1.height / 2 })
    await waitSaved(page)
    await expect.poll(() => file(vault, '过度捕鱼.md')).toContain('第一段。\n\n![')
    const after1 = file(vault, '过度捕鱼.md').split('第一段。\n\n')[1]!.split('\n\n第二段。')[0]!
    expect(after1.replace(/tuna-2x(-\d+)?\.png/, 'tuna-2x.png')).toBe(byMenu)

    // AI 操作右栏网页的边框亮着：图那里还是网页本身（边框不收鼠标），照样拖得进
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('ai:act', { turn: 990, kind: 'start', area: 'web', path: 'right' }))
    await expect(web(page).getByTestId('ai-act')).toBeVisible()
    expect(await page.evaluate(([x, y]: number[]) => document.elementFromPoint(x!, y!)?.tagName, [img.x, img.y])).toBe('WEBVIEW')
    // 松在版心左边的空白里（正文外面，「第二段」那一行旁边）：落到第二段后面
    const pb = (await pane(page).boundingBox())!
    const content = (await pane(page).locator('.cm-content').boundingBox())!
    const line2 = (await pane(page).locator('.cm-line', { hasText: '第二段' }).boundingBox())!
    const side = { x: (pb.x + content.x) / 2, y: line2.y + line2.height / 2 }
    expect(await page.evaluate(([x, y]: number[]) => !!document.elementFromPoint(x!, y!)?.closest('.cm-content'), [side.x, side.y])).toBe(false)
    await realDrag(run, page, img, side)
    await waitSaved(page)
    await expect.poll(() => file(vault, '过度捕鱼.md')).toContain('第二段。\n\n![')
    const after2 = file(vault, '过度捕鱼.md').split('第二段。\n\n')[1]!.split('\n\n第三段。')[0]!
    expect(after2.replace(/tuna-2x(-\d+)?\.png/, 'tuna-2x.png')).toBe(byMenu)
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.send('ai:act', { turn: 990, kind: 'end', stopped: false, commit: null, tally: { add: 0, del: 0 } }))
  } finally {
    await run.close()
  }
})

test('网页里选中的字真拖进文档：写成和点「剪藏」一样的一块（引用 + 来源回到那一段），落在松手那一段后面', async () => {
  const run = await launch({ '过度捕鱼.md': '# 过度捕鱼\n\n第一段。\n\n第二段。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '过度捕鱼')
    await openWeb(page)
    await guest(page, `(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('para')); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })()`)
    const from = await inWeb(page, 'getSelection().getRangeAt(0)')
    const line = (await pane(page).locator('.cm-line', { hasText: '第一段' }).boundingBox())!
    await realDrag(run, page, from, { x: line.x + 20, y: line.y + line.height / 2 }, 300)
    await waitSaved(page)
    const want = clipMarkdown(PARA, sourceLabel({ title: TITLE, url: `${base}/wiki` }), fragmentUrl(`${base}/wiki`, PARA))
    await expect.poll(() => file(vault, '过度捕鱼.md')).toBe(`# 过度捕鱼\n\n第一段。\n\n${want}\n\n第二段。\n`)
  } finally {
    await run.close()
  }
})

test('网页图真拖进白板的第一列：放成一张卡，写法和剪进文档一样（图注、回到那张图的来源），落在松手的那一列', async () => {
  const run = await launch({ '白板.md': '---\ntype: board\n---\n# 白板\n\n## 第一列\n\n卡一\n\n## 第二列\n\n卡二\n' })
  const { page, vault } = run
  try {
    await openNote(page, '白板')
    await page.getByTestId('tab-acts').getByRole('button', { name: '白板' }).click()
    const col1 = page.locator('.db-board').getByText('卡一', { exact: true }).first()
    await expect(col1).toBeVisible()
    await openWeb(page)
    const img = await inWeb(page, 'document.getElementById("png")')
    const c = (await col1.boundingBox())!
    const to = { x: c.x + c.width / 2, y: c.y + c.height / 2 }
    expect(await page.evaluate(([x, y]: number[]) => !!document.elementFromPoint(x!, y!)?.closest('.db-board'), [to.x, to.y])).toBe(true)
    await realDrag(run, page, img, to)
    await expect.poll(() => file(vault, '白板.md')).toContain('![北方蓝鳍金枪鱼]')
    const text = file(vault, '白板.md')
    const first = text.split('## 第二列')[0]!.split('## 第一列')[1]
    expect(first, text).toMatch(/!\[北方蓝鳍金枪鱼\]\(附件\/白板\/tuna-2x\.png\)\n+—— \[过捕情况及有关研究 · .+\]\(.+#:~:text=北方蓝鳍金枪鱼\)/)
    expect(text.split('## 第二列')[1] ?? '').not.toContain('北方蓝鳍金枪鱼')
    await expect.poll(() => imgMarks(page)).toBe(1)
  } finally {
    await run.close()
  }
})
