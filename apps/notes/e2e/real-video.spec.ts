// 真网站上的视频（只读，不登录任何账号）：CN_REAL_VIDEO=1 才跑，要能上网。
// YouTube：视频条出来、从播放器自己的请求里读到字幕、记下这一刻截得到帧；B 站：不登录时说「登录 B 站后才有字幕」、照样能截帧、播放器跟右栏同宽。
// 翻译用假的（CN_AI_FAKE），不花 AI 额度；CN_SHOTS 给了就截图。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, rail, type Running } from './app'

test.skip(process.env.CN_REAL_VIDEO !== '1', '要上网：CN_REAL_VIDEO=1 才跑')
test.setTimeout(240_000)
// 网站（YouTube 的 BotGuard）看到 navigator.webdriver 就不给字幕：真用户的软件里没有这个标记，测试里也去掉
process.env.CN_E2E_ARGS = '--disable-blink-features=AutomationControlled'

const YT = process.env.CN_REAL_YT || 'https://www.youtube.com/watch?v=kYB8IZa5AuE'
const BILI = process.env.CN_REAL_BILI || 'https://www.bilibili.com/video/BV1ys411472E'

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function open(page: Page, url: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  // 右栏拉到 480 宽（和原型一样）
  const sep = (await page.getByRole('separator', { name: '拖动调整右栏宽度' }).boundingBox())!
  await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
  await page.mouse.down()
  await page.mouse.move(sep.x - 60, sep.y + 300, { steps: 6 })
  await page.mouse.up()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 60_000 })
}

test('真 YouTube：读到字幕、双语、记下这一刻', async () => {
  const run = await launch({ '第3讲 笔记.md': '# 第3讲 笔记\n\n看视频。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page, vault } = run
  try {
    await open(page, YT)
    expect(await guest(page, 'String(navigator.webdriver)')).toBe('false')
    // 欧洲第一次打开有「同意 Cookie」页：点「全部拒绝」（临时的测试实例，不是用户的账号）
    await page.waitForTimeout(3000)
    if (await guest(page, `!!document.querySelector('form[action*="consent"], ytd-consent-bump-v2-lightbox, .eom-buttons')`))
      await guest(page, `[...document.querySelectorAll('button, [role=button]')].find((b) => /Reject all|Alle ablehnen|全部拒绝/.test(b.textContent))?.click(), true`)
    const sub = strip(page).getByRole('button', { name: '字幕' })
    // 有广告时要等广告放完播放器才去取字幕
    await expect(sub).toContainText('→中', { timeout: 150_000 })
    console.log('YouTube 字幕：', await sub.textContent())
    // 跳过开头、播起来
    await guest(page, `(() => { const v = document.querySelector('video'); v.muted = true; v.currentTime = 222; v.play(); return true })()`)
    await expect.poll(() => guest(page, `document.querySelector('video').currentTime > 224`), { timeout: 60_000 }).toBe(true)
    // 画面上的双语字幕：译文（假翻译「译文：…」）和原文
    await expect.poll(() => guest(page, `document.getElementById('cn-video-host')?.shadowRoot?.querySelector('.subs')?.textContent ?? ''`), { timeout: 20_000 }).toContain('译文：')
    console.log('画面上：', await guest(page, `document.getElementById('cn-video-host').shadowRoot.querySelector('.subs').textContent`))
    await shot(run, 'real-yt')
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('记进了', { timeout: 30_000 })
    const dir = join(vault, '附件/视频/youtube-kYB8IZa5AuE')
    expect(existsSync(dir) && readdirSync(dir).some((f) => /^0\d-\d\d\.jpg$/.test(f))).toBe(true)
    await shot(run, 'real-yt-moment')
  } finally {
    await run.close()
  }
})

test('真 B 站（不登录）：视频条出来，字幕菜单说要登录；截得到帧；播放器不比右栏宽', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await open(page, BILI)
    const sub = strip(page).getByRole('button', { name: '字幕' })
    await expect(sub).not.toContainText('读取中', { timeout: 60_000 })
    console.log('B 站字幕：', await sub.textContent())
    const w = await guest(page, `JSON.stringify({ inner: innerWidth, video: document.querySelector('video')?.getBoundingClientRect().width, scroll: document.documentElement.scrollWidth })`)
    console.log('B 站宽度：', w)
    await shot(run, 'real-bili')
    await guest(page, `(() => { const v = document.querySelector('video'); v.muted = true; v.currentTime = 60; v.play(); return true })()`)
    await page.waitForTimeout(3000)
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    // 中间没开文档：新建《视频标题》开在中间（CN-70）
    await expect(page.locator('.vtoast')).toContainText(/记进了|新建了/, { timeout: 30_000 })
    expect(readdirSync(join(vault, '附件/视频')).some((d) => d.startsWith('bilibili-BV1ys411472E'))).toBe(true)
    await strip(page).getByRole('button', { name: '字幕' }).click()
    await shot(run, 'real-bili-menu')
  } finally {
    await run.close()
  }
})
