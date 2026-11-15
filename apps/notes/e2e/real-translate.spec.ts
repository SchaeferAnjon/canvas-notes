/**
 * 用真的 AI 命令行（Claude Code · Haiku）翻一篇真的维基百科条目，量首批译文多久出来。
 * 会联网、花一点 Claude 额度，平时跳过；要跑：CN_REAL_AI=1 npx playwright test e2e/real-translate.spec.ts
 * CN_SHOT_DIR=<文件夹> 时把截图存进去。
 */
import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, rail, type Running } from './app'

const URL = process.env.CN_REAL_URL || 'https://en.wikipedia.org/wiki/Iceland'

test.skip(process.env.CN_REAL_AI !== '1', '要真的 AI 和网络：CN_REAL_AI=1 才跑')
test.setTimeout(180_000)

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

/** 网页本身的截图（从主进程截 webview，不受窗口在屏幕外的影响） */
async function shootPage(run: Running, file: string) {
  const id = await run.page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())
  const b64 = await run.app.evaluate(async ({ webContents }, wcId) => (await webContents.fromId(wcId)!.capturePage()).toPNG().toString('base64'), id)
  writeFileSync(file, Buffer.from(b64, 'base64'))
}

test('真网页翻译：维基百科条目首屏', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page } = run
  const shots = process.env.CN_SHOT_DIR
  try {
    await page.setViewportSize({ width: 1500, height: 960 }).catch(() => undefined)
    await rail(page).getByRole('button', { name: '网页' }).click()
    // 右栏拉宽一些，像读文章时那样
    const sep = (await page.getByRole('separator', { name: '拖动调整右栏宽度' }).boundingBox())!
    await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
    await page.mouse.down()
    await page.mouse.move(700, sep.y + 300, { steps: 8 })
    await page.mouse.up()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(URL)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState'), { timeout: 60_000 }).toBe('complete')
    await page.waitForTimeout(1500)
    if (shots) await page.screenshot({ path: join(shots, 'real-before.png') })
    if (shots) await shootPage(run, join(shots, 'real-page-before.png'))

    const t0 = Date.now()
    await web(page).getByRole('toolbar', { name: '插件按钮' }).getByRole('button', { name: '双语翻译' }).click()
    const doneCount = () => guest(page, `Array.from(document.querySelectorAll('cn-tr')).filter(e => !/^(翻译中|没翻成)/.test(e.textContent)).length`) as Promise<number>
    await expect.poll(doneCount, { timeout: 60_000, intervals: [100] }).toBeGreaterThan(0).catch(async (e: Error) => {
      console.log('没出译文：', await guest(page, `JSON.stringify(Array.from(document.querySelectorAll('cn-tr')).slice(0, 5).map(e => e.textContent))`), await page.locator('.toast-cn').textContent({ timeout: 300 }).catch(() => ''))
      throw e
    })
    const first = Date.now() - t0
    // 首屏的段落都翻完（没有「翻译中」了）
    await expect.poll(() => guest(page, `Array.from(document.querySelectorAll('cn-tr')).filter(e => e.textContent === '翻译中…').length`), { timeout: 90_000, intervals: [200] }).toBe(0)
    const all = Date.now() - t0
    const n = await doneCount()
    const sample = await guest(page, `Array.from(document.querySelectorAll('cn-tr')).slice(0, 3).map(e => e.parentElement.innerText.slice(0, 400)).join('\\n---\\n')`)
    const stats = await page.evaluate(() => window.cnPlugins.call('translate', 'stats'))
    const engine = await page.evaluate(() => window.cnPlugins.call('translate', 'engine'))
    console.log(JSON.stringify({ url: URL, engine, firstMs: first, firstScreenMs: all, paragraphs: n, stats }))
    console.log(sample)
    if (shots) await page.screenshot({ path: join(shots, 'real-after.png') })
    if (shots) await shootPage(run, join(shots, 'real-page-after.png'))

    // 滚下去，接着翻
    await guest(page, 'window.scrollBy(0, 2400)')
    const t1 = Date.now()
    await expect.poll(async () => (await doneCount()) > n, { timeout: 60_000, intervals: [100] }).toBe(true)
    console.log(JSON.stringify({ afterScrollFirstMs: Date.now() - t1 }))
    await page.waitForTimeout(4000)
    if (shots) await shootPage(run, join(shots, 'real-page-scrolled.png'))
  } finally {
    await run.close()
  }
})
