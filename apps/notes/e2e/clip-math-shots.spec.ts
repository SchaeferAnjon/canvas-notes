// 剪藏保留公式和代码块的复审截图（task-6cxtc 第二轮）：拖选时碰到的公式整块铺系统选区色、角上「引用」「剪藏」（块级在块里右上角、
// 行内在下面）、⋯ 里「剪整节」排第一、剪进文档后引文里的整行公式画成一整块（式号 \tag 画在右边）。
// 天青 / 深湖 × 浅色网页 / 深色网页，1440 × 887 窗口，真软件、临时库、假 AI、本机假网页（fixtures/math-page.ts）。
// 只在给了 CN_SHOTS=<目录> 时跑：CN_SHOTS=/private/tmp/canvas-notes-build4/clip-math/round2 npx playwright test e2e/clip-math-shots.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane, rail, type Running, waitSaved, widenRight } from './app'
import { mathSite, type MathSite } from './fixtures/math-page'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '复审截图：CN_SHOTS=<目录> 才跑')
test.setTimeout(240_000)

const NOTE = '课程/学习笔记.md'
const TITLE = '学习笔记'

let site: MathSite
test.beforeAll(async () => {
  site = await mathSite()
})
test.afterAll(() => site.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = <T = unknown>(page: Page, code: string) =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code) as Promise<T>

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function openWeb(page: Page, u: string) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

/** 从 #a 第一个字拖到 #b 最后一个字（真拖），小条出来 */
async function dragSelect(page: Page, a: string, b: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  for (let i = 0; i < 3; i++) {
    const p = await guest<number[]>(
      page,
      `(() => { const f = document.createRange(); const a = document.getElementById(${JSON.stringify(a)}).firstChild; f.setStart(a, 0); f.setEnd(a, 1); const l = document.createRange(); const t = document.getElementById(${JSON.stringify(b)}).lastChild; l.setStart(t, t.data.length - 1); l.setEnd(t, t.data.length); const r1 = f.getClientRects()[0], r2 = l.getClientRects()[0]; return [r1.left + 1, r1.top + r1.height / 2, r2.right - 1, r2.top + r2.height / 2] })()`,
    )
    await page.mouse.move(w.x + p[0]!, w.y + p[1]!)
    await page.mouse.down()
    await page.mouse.move(w.x + p[2]!, w.y + p[3]!, { steps: 10 })
    await page.mouse.up()
    if (await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display`), { timeout: 1500 }).toBe('block').then(() => true, () => false)) return
  }
  throw new Error('小条没出来')
}

async function hover(page: Page, code: string) {
  // 选区收起、小条收了才出角上那颗
  await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.style.display ?? 'none'`)).toBe('none')
  const w = (await web(page).locator('webview.on').boundingBox())!
  await page.mouse.move(w.x + 5, w.y + 5)
  const p = await guest<{ x: number; y: number }>(page, `(() => { const r = (${code}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await page.mouse.move(w.x + p.x, w.y + p.y)
  await expect.poll(() => guest(page, `document.getElementById('cn-block-host')?.style.display`)).toBe('block')
}

async function barClick(page: Page, sel: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const p = await guest<{ x: number; y: number }>(page, `(() => { const r = document.getElementById('cn-clip-host').shadowRoot.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  await page.mouse.click(w.x + p.x, w.y + p.y)
}

for (const skin of ['sky', 'petrol'] as const) {
  test(`复审截图：${skin}`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const run = await launch({ [NOTE]: `---\nread-along: ${site.base}/\n---\n# ${TITLE}\n\n先看矩阵。\n` }, { CN_AI_FAKE: '1' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openNote(page, TITLE)
      await pane(page).locator('.cm-line', { hasText: '先看矩阵' }).click()
      await page.keyboard.press('End')
      await openWeb(page, site.url)
      await widenRight(page, 270)
      await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 })
      for (const look of ['light', 'dark'] as const) {
        const tag = `${skin}-${look}`
        await openWeb(page, look === 'dark' ? `${site.url}?dark` : site.url)
        await guest(page, `document.getElementById('m1').scrollIntoView({ block: 'start' }); scrollBy(0, -60)`)
        // ① 拖选碰到公式、代码块：整块铺系统选区色
        await dragSelect(page, 'm1', 'm4')
        await shot(run, `1-选中-${tag}`)
        // ② 停在块级公式上：角上那颗在块里右上角
        await guest(page, 'getSelection().removeAllRanges()')
        await hover(page, `document.querySelector('mjx-container[display="true"]')`)
        await shot(run, `2-块级角上-${tag}`)
        // ③ 停在行内公式上：放在它下面
        await hover(page, `document.querySelectorAll('.katex')[2]`)
        await shot(run, `3-行内下面-${tag}`)
        // ④ 选着标题：⋯ 里「剪整节」排第一
        await guest(page, `document.getElementById('h-mat').scrollIntoView({ block: 'start' }); scrollBy(0, -120)`)
        await dragSelect(page, 'h-mat', 'h-mat')
        await barClick(page, 'button.more')
        await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('.menu').style.display`)).toBe('block')
        await shot(run, `4-剪整节-${tag}`)
        await barClick(page, 'button.more')
        await guest(page, 'getSelection().removeAllRanges()')
      }
      // ⑤ 剪一段进文档：引文里的整行公式画成一整块，式号在右边
      await openWeb(page, site.url)
      await guest(page, `document.getElementById('m1').scrollIntoView({ block: 'start' }); scrollBy(0, -60)`)
      await dragSelect(page, 'm1', 'm4')
      await barClick(page, 'button.clip')
      await expect(page.locator('.toast-cn')).toContainText(`剪进《${TITLE}》`)
      await waitSaved(page)
      await pane(page).locator('.cm-line', { hasText: '先看矩阵' }).click()
      await expect(pane(page).locator('.cm-math-inquote .cm-math-block')).toHaveCount(1)
      await page.mouse.move(700, 880)
      await shot(run, `5-文档里-${skin}`)
    } finally {
      await run.close()
    }
  })
}
