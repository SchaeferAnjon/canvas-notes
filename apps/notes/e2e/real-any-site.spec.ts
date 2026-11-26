// 真网站（只读，不登录）：网页翻译、视频字幕在几类真网站上都能用。CN_REAL_VIDEO=1 才跑，要能上网；翻译是假的（CN_AI_FAKE），不花额度。
// YouTube（用户在学的视频）、B 站公开视频（中文界面会跳到 /zh-Hans/video/）、Vimeo 公开视频（<track> 挂的 VTT）、一篇英文新闻（BBC）。
// CN_SHOTS=<文件夹> 截图、CN_SHOT_TAG 给截图名加前缀（修前 / 修后各一套）。网站改版了这几条会先挂，照着改。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, rail, type Running } from './app'

test.skip(process.env.CN_REAL_VIDEO !== '1', '要上网：CN_REAL_VIDEO=1 才跑')
test.setTimeout(300_000)
// 网站（YouTube 的 BotGuard）看到 navigator.webdriver 就不给字幕：真用户的软件里没有这个标记，测试里也去掉
process.env.CN_E2E_ARGS = '--disable-blink-features=AutomationControlled'

const TAG = process.env.CN_SHOT_TAG ?? ''
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const subsBtn = (page: Page) => strip(page).getByRole('button', { name: '字幕', exact: true })
const trBtn = (page: Page) => web(page).getByRole('button', { name: '双语翻译', exact: true })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
/** 网页里的译文（连同 shadow DOM、同源 iframe 里的） */
const allTr = (page: Page) =>
  guest(page, `(() => { const out = []; const walk = (r) => { for (const el of r.querySelectorAll('*')) { if (el.tagName === 'CN-TR' && !el.hasAttribute('data-st')) out.push(el.textContent); if (el.shadowRoot) walk(el.shadowRoot); if (el.tagName === 'IFRAME') { try { if (el.contentDocument) walk(el.contentDocument) } catch {} } } }; walk(document); return out })()`) as Promise<string[]>
const subLines = (page: Page) => guest(page, `[...(document.getElementById('cn-video-host')?.shadowRoot?.querySelectorAll('.subs span') ?? [])].map((s) => s.className).join('|')`)

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await run.page.waitForTimeout(600)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${TAG}${name}.png`), Buffer.from(b64, 'base64'))
}

/** 开网页；欧洲第一次打开常有「同意 Cookie」，点「全部拒绝」（临时的测试实例） */
async function open(run: Running, url: string) {
  const { page } = run
  await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
  await page.waitForTimeout(5000)
  for (let k = 0; k < 6; k++) {
    const hit = await guest(page, `(() => { const b = [...document.querySelectorAll('button, [role=button]')].find((b) => /^(Reject all|Alle ablehnen|全部拒绝|I do not agree|Reject)$/i.test(b.textContent.trim())); if (b) { b.click(); return true } return false })()`).catch(() => false)
    if (hit) break
    await page.waitForTimeout(1000)
  }
  await page.waitForTimeout(2000)
}

async function play(page: Page, t: number) {
  await guest(page, `(() => { const v = [...document.querySelectorAll('video')].sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0]; if (!v) return false; v.muted = true; v.currentTime = ${t}; v.play().catch(() => {}); return true })()`)
}

test('真 YouTube：点双语翻译，标题翻了，字幕双语', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page } = run
  try {
    await open(run, 'https://www.youtube.com/watch?v=gVEr2cnDE_8')
    await expect(subsBtn(page)).toContainText('→中', { timeout: 150_000 })
    await trBtn(page).click()
    await expect.poll(() => allTr(page), { timeout: 30_000 }).toContainEqual(expect.stringContaining('How AI Learned to Teach Itself'))
    await play(page, 60)
    await expect.poll(() => subLines(page), { timeout: 30_000 }).toBe('t|o')
    await shot(run, 'any-youtube')
  } finally {
    await run.close()
  }
})

test('真 B 站（不登录）：视频条出来（/zh-Hans/video/ 地址也认），网页标题翻了', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page } = run
  try {
    await open(run, 'https://www.bilibili.com/video/BV1ys411472E')
    console.log('B 站地址：', await guest(page, 'location.pathname'))
    await expect(strip(page)).toBeVisible({ timeout: 60_000 })
    await expect(subsBtn(page)).not.toContainText('读取中', { timeout: 60_000 })
    console.log('B 站字幕：', await subsBtn(page).textContent())
    await trBtn(page).click()
    // 中文网页：翻成英文（和翻成的同一种就换一种）
    await expect.poll(async () => (await allTr(page)).length, { timeout: 30_000 }).toBeGreaterThan(2)
    console.log('B 站译文：', (await allTr(page)).slice(0, 4))
    await shot(run, 'any-bilibili')
  } finally {
    await run.close()
  }
})

test('真 Vimeo：视频条出来，字幕从视频自己的字幕轨读，画面上双语；网页标题翻了', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page } = run
  try {
    await open(run, 'https://vimeo.com/76979871')
    await play(page, 5)
    await expect(strip(page)).toBeVisible({ timeout: 60_000 })
    await expect(subsBtn(page)).toContainText('→中', { timeout: 60_000 })
    console.log('Vimeo 字幕：', await subsBtn(page).textContent())
    await play(page, 12)
    await expect.poll(() => subLines(page), { timeout: 30_000 }).toBe('t|o')
    await trBtn(page).click()
    await expect.poll(() => allTr(page), { timeout: 30_000 }).toContainEqual(expect.stringContaining('The New Vimeo Player'))
    await shot(run, 'any-vimeo')
  } finally {
    await run.close()
  }
})

test('真英文新闻（BBC 新闻首页）：点双语翻译，标题和导语都出译文', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page } = run
  try {
    await open(run, process.env.CN_REAL_NEWS || 'https://www.bbc.com/news')
    await trBtn(page).click()
    await expect.poll(async () => (await allTr(page)).length, { timeout: 30_000 }).toBeGreaterThan(3)
    console.log('新闻译文：', (await allTr(page)).slice(0, 4))
    await shot(run, 'any-news')
  } finally {
    await run.close()
  }
})
