// 真网页验「剪藏不丢公式」（要联网，平时跳过）：zh.d2l.ai「2.3. 线性代数」那一页（MathJax）。
//   CN_REAL_WEB=1 CN_SHOTS=<目录> npx playwright test e2e/real-clip-math.spec.ts
// 剪带「行索引 i 和列索引 j」「形状为 m×n 的矩阵」的两段、引用一段、整页剪，2.3.9 标题和下面两段拖选剪下来（中间的 (2.3.7) 两个矩阵）；
// 文件里是 $…$、$$…$$，文档里画成公式
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, rail, type Running, waitSaved, webAboveAi } from './app'

test.skip(!process.env.CN_REAL_WEB, '真网页才跑：CN_REAL_WEB=1')
test.setTimeout(6 * 60_000)

const URL = 'https://zh.d2l.ai/chapter_preliminaries/linear-algebra.html'
const NOTE = '课程/学习笔记.md'
const TITLE = '学习笔记'
const DIR = process.env.CN_SHOTS ?? ''
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = <T = unknown>(page: Page, code: string) =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>

async function shot(run: Running, name: string) {
  if (!DIR) return
  mkdirSync(DIR, { recursive: true })
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `real-${name}.png`), Buffer.from(b64, 'base64'))
}

/** 网页里从 from（找得到这段字的那个元素的开头）拖到 to（那个元素的末尾）：真拖 */
async function dragText(page: Page, from: string, to: string) {
  const find = (t: string) => `[...document.querySelectorAll('p, h1, h2, h3, h4, li')].find((e) => e.textContent.includes(${JSON.stringify(t)}))`
  await guest(page, `${find(from)}.scrollIntoView({ block: 'start' }); scrollBy(0, -80)`)
  await page.waitForTimeout(400)
  const w = (await web(page).locator('webview.on').boundingBox())!
  const p = await guest<number[]>(
    page,
    `(() => { const a = ${find(from)}, b = ${find(to)}; const ra = document.createRange(); ra.selectNodeContents(a); const rb = document.createRange(); rb.selectNodeContents(b); const f = ra.getClientRects()[0], l = [...rb.getClientRects()].pop(); return [f.left + 2, f.top + f.height / 2, l.right - 2, l.top + l.height / 2] })()`,
  )
  await page.mouse.move(w.x + p[0]!, w.y + p[1]!)
  await page.mouse.down()
  await page.mouse.move(w.x + p[2]!, w.y + p[3]!, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
}
async function clickBar(page: Page, sel: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const p = await guest<{ x: number; y: number }>(page, `(() => { const r = document.getElementById('cn-clip-host').shadowRoot.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await page.mouse.click(w.x + p.x, w.y + p.y)
}

test('zh.d2l.ai 2.3：剪两段、引用一段、2.3.9 连着 (2.3.7) 两个矩阵拖选剪下来、整页剪，公式都是 $…$ / $$…$$，文档里画成公式', async () => {
  const run = await launch({ [NOTE]: `---\nread-along: https://zh.d2l.ai/\n---\n# ${TITLE}\n\n线性代数。\n` }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, NOTE), 'utf8')
  try {
    await openNote(page, TITLE)
    await pane(page).locator('.cm-line', { hasText: '线性代数。' }).click()
    await page.keyboard.press('End')
    if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(URL)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState'), { timeout: 60_000 }).toBe('complete')
    // MathJax 排完版
    await expect.poll(() => guest<number>(page, `document.querySelectorAll('mjx-container, .MathJax').length`), { timeout: 60_000 }).toBeGreaterThan(20)
    await dragText(page, '行索引', '行索引')
    await shot(run, '选中带公式的一段')
    await clickBar(page, 'button.clip')
    await expect(page.locator('.toast-cn')).toContainText(`剪进《${TITLE}》`)
    await expect.poll(() => file()).toMatch(/\$i\$/)
    expect(file()).toMatch(/\$j\$/)
    await dragText(page, '形状为', '形状为')
    await clickBar(page, 'button.clip')
    await expect.poll(() => file()).toMatch(/\$m ?\\times ?n\$/)
    // 截图 r52 那样：从 2.3.9 标题拖到下面 (2.3.7) 那个大矩阵公式上松手（原生选区停在公式前面的字上）
    await guest(page, `[...document.querySelectorAll('h2, h3')].find((e) => e.textContent.includes('2.3.9')).scrollIntoView({ block: 'start' }); scrollBy(0, -80)`)
    await page.waitForTimeout(400)
    const w2 = (await web(page).locator('webview.on').boundingBox())!
    const pts = await guest<number[]>(page, `(() => { const h = [...document.querySelectorAll('h2, h3')].find((e) => e.textContent.includes('2.3.9')); const m = [...document.querySelectorAll('mjx-container[display="true"], .MathJax_Display')].find((e) => e.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING); const a = h.getBoundingClientRect(), b = m.getBoundingClientRect(); return [a.left + 4, a.top + a.height / 2, b.left + b.width / 2, b.top + b.height / 2] })()`)
    await page.mouse.move(w2.x + pts[0]!, w2.y + pts[1]!)
    await page.mouse.down()
    await page.mouse.move(w2.x + pts[2]!, w2.y + pts[3]!, { steps: 12 })
    await page.mouse.up()
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`)).toBe('block')
    await expect.poll(() => guest<number>(page, `document.querySelectorAll('.cn-selblock').length`)).toBeGreaterThan(0)
    await shot(run, '拖选2.3.9连着公式')
    await clickBar(page, 'button.clip')
    await expect.poll(() => file()).toMatch(/> \$\$\n> [\s\S]*?\\begin\{bmatrix\}/)
    await waitSaved(page)
    // Sphinx 的式号写进公式的 \tag，不单独占一行
    expect(file()).toContain('\\tag{2.3.7}')
    expect(file()).not.toMatch(/^> \(2\.3\.7\)/m)
    // 引用一段
    await dragText(page, '行索引', '行索引')
    await clickBar(page, 'button.qt')
    await webAboveAi(page)
    await expect(page.getByRole('complementary', { name: '边读边问 AI' }).getByTestId('ai-mat').first()).toContainText('$')
    // 文档里画成公式
    await pane(page).locator('.cm-line', { hasText: '线性代数。' }).click()
    await expect.poll(() => pane(page).locator('.cm-math, .cm-math-block').count()).toBeGreaterThan(3)
    // 引文里的整行公式画成一整块（式号在右），文档里不露 TeX 原文
    await expect(pane(page).locator('.cm-math-inquote .cm-math-block .katex-tag').first()).toContainText('2.3.7')
    await expect(pane(page).locator('.cm-line', { hasText: 'begin{bmatrix}' })).toHaveCount(0)
    await shot(run, '文档里画成公式')
    console.log('剪进那篇的：\n' + file())
    // 整页剪进收件箱
    const wc = await page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())
    await run.app.evaluate(({ webContents }, id) => {
      const w = webContents.fromId(id)!
      w.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['meta', 'shift'] })
      w.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['meta', 'shift'] })
    }, wc)
    const inbox = join(vault, '收件箱')
    const newest = () => {
      try {
        const mds = (readdirSync(inbox, { recursive: true }) as string[]).filter((f) => f.endsWith('.md')).map((f) => join(inbox, f))
        return mds.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null
      } catch {
        return null
      }
    }
    await expect.poll(() => newest(), { timeout: 60_000 }).not.toBeNull()
    await expect.poll(() => readFileSync(newest()!, 'utf8'), { timeout: 20_000 }).toMatch(/\$\$\n[\s\S]*?\\begin\{bmatrix\}/)
    expect(readFileSync(newest()!, 'utf8')).toMatch(/\$m ?\\times ?n\$/)
  } finally {
    await run.close()
  }
})
