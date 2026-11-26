// 真 YouTube（只读，不登录）：收件箱「视频 ai 放大之后消失」「youtube 不能翻译」两条在真网站上真点一遍。CN_REAL_VIDEO=1 才跑，要能上网。
// 视频默认是用户在学的 https://www.youtube.com/watch?v=gVEr2cnDE_8（CN_REAL_YT 能换）；翻译、问 AI 都是假的（CN_AI_FAKE），不花额度。
// CN_SHOTS=<文件夹> 截图，CN_SHOT_TAG 给截图名加前缀（修前 / 修后各截一套对照）。
// 查的是网站结构没变：问框头上只有「×」、网页全屏和占满退出后问框还在；地址栏「双语翻译」翻了标题和简介、字幕开着双语。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, rail, type Running } from './app'

test.skip(process.env.CN_REAL_VIDEO !== '1', '要上网：CN_REAL_VIDEO=1 才跑')
test.setTimeout(300_000)
// 网站（YouTube 的 BotGuard）看到 navigator.webdriver 就不给字幕：真用户的软件里没有这个标记，测试里也去掉
process.env.CN_E2E_ARGS = '--disable-blink-features=AutomationControlled'

const YT = process.env.CN_REAL_YT || 'https://www.youtube.com/watch?v=gVEr2cnDE_8'
const TAG = process.env.CN_SHOT_TAG ?? ''
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const askCard = (page: Page) => web(page).getByRole('dialog', { name: '问 AI' })
const guest = (page: Page, code: string, gesture = false) =>
  page.evaluate(([c, g]) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string, g: boolean): Promise<unknown> }).executeJavaScript(c as string, g as boolean), [code, gesture] as const)

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await run.page.waitForTimeout(600)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${TAG}${name}.png`), Buffer.from(b64, 'base64'))
}

/** 开视频页：欧洲第一次打开有「同意 Cookie」，点「全部拒绝」（临时的测试实例）；等字幕读好 */
async function openVideo(run: Running) {
  const { page } = run
  await openNote(page, '看视频的笔记')
  await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(YT)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 60_000 })
  for (let k = 0; k < 8; k++) {
    if (await guest(page, `!!document.querySelector('form[action*="consent"], ytd-consent-bump-v2-lightbox, .eom-buttons')`)) {
      await guest(page, `[...document.querySelectorAll('button, [role=button]')].find((b) => /Reject all|Alle ablehnen|全部拒绝/.test(b.textContent))?.click(), true`)
      break
    }
    await page.waitForTimeout(1000)
  }
  await expect(strip(page).getByRole('button', { name: '字幕', exact: true })).not.toContainText(/读取中/, { timeout: 150_000 })
  await guest(page, `(() => { const v = document.querySelector('video'); v.muted = true; v.currentTime = 60; v.pause(); return true })()`)
  await page.waitForTimeout(1500)
}

test('真 YouTube：框一块问的问框头上只有「×」；网页全屏、网页占满再退出，问框还在原处', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n跟着视频记。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page } = run
  try {
    await openVideo(run)
    await strip(page).getByRole('button', { name: '框一块问' }).click()
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host')?.shadowRoot?.querySelector('.box')`)).toBe(true)
    const r = (await guest(page, `(() => { const b = document.getElementById('movie_player').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })()`)) as { x: number; y: number; w: number; h: number }
    const wv = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + r.x + r.w * 0.1, wv.y + r.y + r.h * 0.15)
    await page.mouse.down()
    await page.mouse.move(wv.x + r.x + r.w * 0.7, wv.y + r.y + r.h * 0.6, { steps: 10 })
    await page.mouse.up()
    await expect(askCard(page)).toBeVisible()
    await shot(run, 'zoom-1-card')
    console.log('问框头上的按钮：', await askCard(page).locator('.ak-x button').evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')).join('、')))
    // 像放大的那颗（重框）点了问框就没了：修好后它不在了
    const rebox = askCard(page).getByRole('button', { name: '重框' })
    if (await rebox.count()) {
      await rebox.click()
      await page.waitForTimeout(800)
      await shot(run, 'zoom-2-after-click')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(800)
      await shot(run, 'zoom-3-after-esc')
    }
    await expect(askCard(page).getByRole('button', { name: '重框' })).toHaveCount(0)
    await expect(askCard(page)).toBeVisible()

    // 网页全屏（播放器右下角那颗）再退出
    await guest(page, `document.querySelector('.ytp-fullscreen-button').click(), true`, true)
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName ?? '')).toBe('WEBVIEW')
    await guest(page, `document.exitFullscreen().then(() => true)`, true)
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName ?? '')).toBe('')
    await expect(askCard(page)).toBeVisible()
    // 网页这一组占满：问框跟着；还原
    await page.getByRole('button', { name: '占满：网页' }).click()
    await expect(askCard(page)).toBeVisible()
    await shot(run, 'zoom-4-max')
    await page.getByTestId('max-hint').click()
    await expect(askCard(page)).toBeVisible()
    await shot(run, 'zoom-5-back')
  } finally {
    await run.close()
  }
})

test('真 YouTube：点地址栏「双语翻译」，标题、简介翻了，字幕开着双语', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n跟着视频记。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page } = run
  try {
    await openVideo(run)
    const subs = strip(page).getByRole('button', { name: '字幕', exact: true })
    console.log('点之前字幕：', await subs.textContent())
    await shot(run, 'tr-1-before')
    await web(page).getByRole('button', { name: '双语翻译', exact: true }).click()
    await page.waitForTimeout(8000)
    await shot(run, 'tr-2-after')
    const got = (await guest(page, `JSON.stringify({ title: document.querySelector('h1.ytd-watch-metadata cn-tr')?.textContent ?? '', desc: document.querySelector('#description-inline-expander cn-tr')?.textContent ?? '' })`)) as string
    console.log('点之后字幕：', await subs.textContent(), '网页译文：', got)
    const t = JSON.parse(got) as { title: string; desc: string }
    expect(t.title).toMatch(/^译文：/)
    expect(t.desc).toMatch(/^译文：/)
    await expect(subs).toContainText('→中')
    // 展开简介：整段简介也翻
    await guest(page, `document.querySelector('#description-inline-expander #expand')?.click(), true`)
    await page.waitForTimeout(3000)
    // 简介的译文在整段末尾：滚到它
    await guest(page, `(document.querySelector('#description-inline-expander #expanded cn-tr') || document.querySelector('#description-inline-expander cn-tr'))?.scrollIntoView({ block: 'center' }), true`)
    await page.waitForTimeout(800)
    await shot(run, 'tr-3-desc')
  } finally {
    await run.close()
  }
})
