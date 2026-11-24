/**
 * 网页图拖进对话：右栏网页里的图拖进 AI 输入框当贴图附上（来源「图 6.2.1 · 网站」，SVG 画成 PNG，发出去 AI 收到图），
 * 拖进左边文档当剪藏（存进附件、说明是图注、来源回到那张图、网页上那张图标「剪过」）；拖着时输入框亮「松手附上这张图」、文档出插入线；
 * 右键「问 AI 这张图」「剪进文档」；右键「拷贝图片」再在输入框 ⌘V 贴得上。
 * 拖的那一下照真拖时网页报上来的走：网页里 dragstart → drag（指针到了界面哪里）→ dragend（落点），界面在落点补发 dragover / drop。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { launch, openAi, openNote, pane, rail, waitSaved, webAboveAi, type Running } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { solidPng } from './fixtures/png'
import { shotPart, shotWindow } from './shots'

const PNG = solidPng(120, 80, [40, 90, 160])
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="40" viewBox="0 0 60 40"><rect x="5" y="5" width="50" height="30" fill="#2a6"/></svg>'
const TITLE = '6.2. 图像卷积 — 动手学深度学习 2.0.0 documentation'
const CAP1 = '图6.2.1 二维互相关运算。阴影部分是第一个输出元素，以及用于计算输出的输入张量元素和核张量元素。'
const CAP2 = '图6.2.2 卷积核。'
let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/corr.png') {
      res.setHeader('content-type', 'image/png')
      return res.end(PNG)
    }
    if (req.url === '/kernel.svg') {
      res.setHeader('content-type', 'image/svg+xml')
      return res.end(SVG)
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    // 照 d2l 的 Sphinx 写法：div.figure 里一张图、下面 p.caption（图号 + 图注）
    res.end(`<title>${TITLE}</title><body style="font:15px sans-serif;padding:12px">
      <h2>6.2.1. 互相关运算<a class="headerlink" href="#x">¶</a></h2>
      <p>在二维互相关运算中，卷积窗口从输入张量的左上角开始，从左到右、从上到下滑动。</p>
      <div class="figure align-default"><img id="png" src="/corr.png" alt="../_images/correlation.svg" width="120" height="80" style="display:block">
      <p class="caption"><span class="caption-number">图6.2.1 </span><span class="caption-text">二维互相关运算。阴影部分是第一个输出元素，以及用于计算输出的输入张量元素和核张量元素。</span></p></div>
      <div class="figure align-default"><img id="svg" src="/kernel.svg" alt="" width="60" height="40" style="display:block">
      <p class="caption"><span class="caption-number">图6.2.2 </span><span class="caption-text">卷积核。</span></p></div>
      <p>${'输出张量的四个元素由二维互相关运算得到。'.repeat(8)}</p></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('aside webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

async function openWeb(page: Page, url: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
  await expect(web(page).locator('webview.on')).toBeVisible()
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${url}`)
}

/** 网页里那张图的中心（界面坐标） */
async function imgAt(page: Page, id: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('${id}').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

/** 网页里按住那张图开始拖（网页报 cn:drag），指针挪到界面上 (x, y)（网页报 cn:dragmove） */
async function dragTo(page: Page, id: string, x: number, y: number) {
  await settled(page)
  const w = (await web(page).locator('webview.on').boundingBox())!
  await guest(
    page,
    `(() => { const img = document.getElementById('${id}');
      window.__cnDrag = img;
      img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
      img.dispatchEvent(new DragEvent('drag', { bubbles: true, clientX: ${x - w.x}, clientY: ${y - w.y} })) })()`,
  )
}

/** 在 (x, y) 松手（网页报 cn:dragend 和落点） */
async function dropAt(page: Page, x: number, y: number) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  await guest(page, `window.__cnDrag.dispatchEvent(new DragEvent('dragend', { bubbles: true, clientX: ${x - w.x}, clientY: ${y - w.y} }))`)
}

/** 网页那一格挪到上半以后等它停稳（位置两次量一样、网页载完），再按坐标点 */
async function settled(page: Page) {
  let last = ''
  await expect
    .poll(async () => {
      const b = JSON.stringify(await web(page).locator('webview.on').boundingBox())
      const same = b === last
      last = b
      return same && (await guest(page, 'document.readyState')) === 'complete'
    })
    .toBe(true)
}

async function rightClick(page: Page, id: string) {
  await settled(page)
  const p = await imgAt(page, id)
  await page.mouse.click(p.x, p.y, { button: 'right' })
}

/** 网页上剪过的图有几个小标（shadow DOM 里的 .mk[data-img]） */
const imgMarks = (page: Page) => guest(page, `(() => { const h = document.getElementById('cn-mark-host'); return h ? h.shadowRoot.querySelectorAll('.mk[data-img]').length : 0 })()`)

const pasted = (run: Running) => (existsSync(join(run.userData, 'pasted')) ? readdirSync(join(run.userData, 'pasted')) : [])
const isPng = (b: Buffer) => b[0] === 0x89 && b.subarray(1, 4).toString() === 'PNG'

test('网页图拖进 AI 输入框：拖着输入框亮「松手附上这张图」，松手附上缩略图带来源「图 6.2.1 · 网站」，SVG 画成 PNG；发出去假 AI 收到两张图', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n\n第二段。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, '学习笔记')
    await openWeb(page, `${base}/fig`)
    await openAi(page)
    // 网页在上、AI 在下，两个都看得见（和截图里用户那样）
    await webAboveAi(page)
    const ai = chat(page)
    const box = ai.getByTestId('ai-input')
    await expect(box).toBeVisible()
    const b = (await box.boundingBox())!
    const into = { x: b.x + b.width / 2, y: b.y + b.height / 2 }

    await dragTo(page, 'png', into.x, into.y)
    await expect(ai.getByTestId('ai-drop-say')).toHaveText('松手附上这张图')
    await expect(box).toHaveClass(/\bhot\b/)
    await shotWindow(run, '1-拖着输入框亮')
    await shotPart(box, '1b-拖着输入框亮-近看')
    await dropAt(page, into.x, into.y)
    await expect(ai.getByTestId('ai-drop-say')).toHaveCount(0)
    const chips = ai.getByTestId('ai-mat')
    await expect(chips).toHaveCount(1)
    await expect(chips.first()).toHaveAttribute('data-src', `图 6.2.1 · 127.0.0.1`)
    await expect(chips.first().getByTestId('ai-mat-src')).toHaveText('127.0.0.1图 6.2.1')
    await expect.poll(() => chips.first().locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120)
    // 输入框里没被插进图的网址
    await expect(ai.getByRole('textbox', { name: '问 AI' })).toHaveValue('①')

    // SVG：画成 PNG（小图放大两倍画）
    await dragTo(page, 'svg', into.x, into.y)
    await expect(ai.getByTestId('ai-drop-say')).toBeVisible()
    await dropAt(page, into.x, into.y)
    await expect(chips).toHaveCount(2)
    await expect(chips.nth(1)).toHaveAttribute('data-src', `图 6.2.2 · 127.0.0.1`)
    await expect.poll(() => chips.nth(1).locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120)
    const files = pasted(run)
    expect(files).toHaveLength(2)
    for (const f of files) {
      expect(f).toMatch(/\.png$/)
      expect(isPng(readFileSync(join(run.userData, 'pasted', f)))).toBe(true)
    }
    await shotPart(box, '2-附上后缩略图带来源')

    // 拖回网页里松手：什么都不附，亮着的收起
    await dragTo(page, 'png', into.x, into.y)
    await expect(ai.getByTestId('ai-drop-say')).toBeVisible()
    const p = await imgAt(page, 'png')
    await dropAt(page, p.x, p.y)
    await expect(ai.getByTestId('ai-drop-say')).toHaveCount(0)
    await expect(chips).toHaveCount(2)

    // 发出去：AI 收到两张图（假 AI 回「图 2 张」），材料一行写着来源
    await ai.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const um = ai.locator('.um.mq').last()
    await expect(um.locator('.fnl .fni').nth(0)).toContainText('图 6.2.1 · 127.0.0.1')
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toContainText('图 2 张', { timeout: 15_000 })
    await expect(chips).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('网页图拖进左边文档：出插入线，松手存进这篇的附件，说明是图注、来源「图 6.2.1 · 动手学深度学习」回到那张图；网页上那张图标「剪过」', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n\n第二段。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记')
    await openWeb(page, `${base}/fig`)
    const line = (await pane(page).locator('.cm-line', { hasText: '第一段' }).boundingBox())!
    const at = { x: line.x + 30, y: line.y + line.height / 2 }
    await dragTo(page, 'png', at.x, at.y)
    const drop = pane(page).getByTestId('doc-drop-line')
    await expect(drop).toBeVisible()
    // 插入线在「第一段」和「第二段」中间
    const d = (await drop.boundingBox())!
    const next = (await pane(page).locator('.cm-line', { hasText: '第二段' }).boundingBox())!
    expect(d.y).toBeGreaterThan(line.y + line.height - 2)
    expect(d.y).toBeLessThan(next.y + 2)
    await shotWindow(run, '3-拖进文档出插入线')
    await dropAt(page, at.x, at.y)
    await expect(drop).toBeHidden()
    await waitSaved(page)
    const want = `${base}/fig#:~:text=图6.2.1%20二维互相关运算。阴影部分是第一个输出元素，以及用于计算输出的输入张`
    await expect
      .poll(() => readFileSync(join(vault, '学习笔记.md'), 'utf8'))
      .toBe(`# 学习笔记\n\n第一段。\n\n![${CAP1}](附件/学习笔记/corr.png)\n\n—— [图 6.2.1 · 动手学深度学习](${want})\n\n第二段。\n`)
    expect(readFileSync(join(vault, '附件', '学习笔记', 'corr.png')).equals(PNG)).toBe(true)
    await expect(pane(page).locator('.cm-content img[src^="cn-file://vault/"]')).toHaveCount(1)
    // 网页上那张图标「剪过」（这个网页还没定记进哪篇：拖进来的这篇就是）
    await expect.poll(() => imgMarks(page)).toBe(1)
    await shotWindow(run, '4-拖进文档后')
  } finally {
    await run.close()
  }
})

test('网页图右键：「问 AI 这张图」附进右栏开着的 AI 输入框，「剪进文档」插在文档光标处、网页上那张图标「剪过」', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '学习笔记')
    // 光标放在「第一段。」后面（剪进文档插在光标处）
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await page.keyboard.press('End')
    await openWeb(page, `${base}/fig`)
    await openAi(page)
    await webAboveAi(page)
    const ai = chat(page)
    const chips = ai.getByTestId('ai-mat')

    await rightClick(page, 'svg')
    const m = await openedMenu(run)
    expect(menuLabels(m).slice(0, 6)).toEqual(['拷贝图片', '拷贝图片地址', '存进附件', '剪进文档', '问 AI 这张图', '后退'])
    await pickMenu(run, '问 AI 这张图')
    await expect(chips).toHaveCount(1)
    await expect(chips.first()).toHaveAttribute('data-src', '图 6.2.2 · 127.0.0.1')
    await expect.poll(() => chips.first().locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120)

    await rightClick(page, 'svg')
    await pickMenu(run, '剪进文档')
    await waitSaved(page)
    await expect
      .poll(() => readFileSync(join(vault, '学习笔记.md'), 'utf8'))
      .toContain(`![${CAP2}](附件/学习笔记/kernel.svg)\n\n—— [图 6.2.2 · 动手学深度学习](${base}/fig#:~:text=图6.2.2%20卷积核。)`)
    expect(readFileSync(join(vault, '附件', '学习笔记', 'kernel.svg'), 'utf8')).toBe(SVG)
    await expect.poll(() => imgMarks(page)).toBe(1)

  } finally {
    await run.close()
  }
})

test('网页图右键「拷贝图片」，再点进 AI 输入框按 ⌘V：成为一块「粘贴的图」（真按一次 ⌘V，用系统剪贴板）', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await armMenus(run)
    await openNote(page, '学习笔记')
    await openWeb(page, `${base}/fig`)
    await openAi(page)
    await webAboveAi(page)
    const ai = chat(page)
    const chips = ai.getByTestId('ai-mat')
    // 拷贝图片（系统剪贴板）→ 点进 AI 输入框 ⌘V：成为一块「粘贴的图」
    await rightClick(page, 'png')
    await pickMenu(run, '拷贝图片')
    await expect.poll(() => run.app.evaluate(async ({ clipboard }) => (await clipboard.read()).flatMap((i) => i.types).includes('image/png'))).toBe(true)
    const ta = ai.getByRole('textbox', { name: '问 AI' })
    await ta.click()
    await ta.press('End')
    await page.keyboard.press('Meta+v')
    await expect(chips).toHaveCount(1)
    await expect(chips.nth(0)).toHaveAttribute('data-src', '粘贴的图')
    await expect.poll(() => chips.nth(0).locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(120)
  } finally {
    await run.close()
  }
})
