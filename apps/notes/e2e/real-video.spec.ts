// 真网站上的视频（只读，不登录任何账号）：CN_REAL_VIDEO=1 才跑，要能上网。
// YouTube：视频条出来、从播放器自己的请求里读到字幕、记下这一刻截得到帧；B 站：不登录时说「登录 B 站后才有字幕」、照样能截帧、播放器跟右栏同宽。
// 翻译用假的（CN_AI_FAKE），不花 AI 额度；CN_SHOTS 给了就截图。最后一条「真翻」用真的 Claude Code（再加 CN_REAL_AI=1）。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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

// 真 Claude Code 翻字幕、写摘要（task-5tc8i）：再给 CN_REAL_AI=1 才跑，花一点 Haiku 额度。在 Claude Code 的终端里跑要去掉父会话的 CLAUDE_* 环境变量：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_VIDEO=1 CN_REAL_AI=1 CN_AI_MODEL=sonnet CN_SHOTS=<文件夹> npx playwright test e2e/real-video.spec.ts -g 真翻
// CN_REAL_AI_YT 换视频。用户报的 rEJHzg2nW84 不登录 YouTube 时不给字幕（yt-dlp --list-subs 也说没有），默认用一个不登录也给字幕的同题视频（26 分钟）。
// 字幕全文那一篇开在中间，等字幕翻到「好了」（没有百分比、没有「没翻成」）、摘要写出来，记下各用了多久。
// 翻译和摘要都带 --no-session-persistence，不留 Claude 会话记录。
test('真翻：真 Claude Code 把字幕翻到好了、摘要写出来，开着的字幕全文跟着变', async () => {
  test.skip(process.env.CN_REAL_AI !== '1', '要真的 AI：CN_REAL_AI=1 才跑')
  test.setTimeout(20 * 60_000)
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_MODEL: process.env.CN_AI_MODEL || 'sonnet' })
  const { page, vault } = run
  try {
    await open(page, process.env.CN_REAL_AI_YT || 'https://www.youtube.com/watch?v=5F--cT8Pn3o')
    // 欧洲第一次打开有「同意 Cookie」页：点「全部拒绝」（临时的测试实例，不是用户的账号）
    await page.waitForTimeout(3000)
    await guest(page, `[...document.querySelectorAll('button, [role=button]')].find((b) => /Reject all|Alle ablehnen|全部拒绝/.test(b.textContent))?.click(), true`)
    const sub = strip(page).locator('button.vsub')
    await expect(sub).not.toContainText('读取中', { timeout: 150_000 })
    console.log('字幕：', await sub.textContent())
    // 原文是中文（翻成跟着设置是简体中文，不用翻）：照用户那样在字幕菜单里改翻成 English
    if (/^字幕 中$/.test((await sub.textContent()) ?? '')) {
      await sub.click()
      await web(page).getByRole('dialog', { name: '字幕' }).getByRole('radiogroup', { name: '翻成' }).getByRole('radio', { name: 'English', exact: true }).click()
      await expect(sub).toContainText('中→英')
      await sub.click()
    }
    const t0 = Date.now()
    // 字幕全文那一篇开在中间（用户就是开着它等摘要的）
    const dir = join(vault, '剪藏/视频')
    await expect.poll(() => existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.md')), { timeout: 60_000 }).toBe(true)
    const name = readdirSync(dir).find((f) => f.endsWith('.md'))!.replace(/\.md$/, '')
    await page.locator('.nav .si').filter({ hasText: name.slice(0, 12) }).first().click()
    const doc = page.locator('.pane:not([hidden]) .cm-content')
    await expect(doc).toContainText('AI 摘要')
    let summaryAt = 0
    let doneAt = 0
    let retries = 0
    for (let i = 0; i < 200 && !(summaryAt && doneAt); i++) {
      await page.waitForTimeout(5000)
      const lab = (await sub.textContent()) ?? ''
      const text = (await doc.textContent()) ?? ''
      // 摘要写好了：那一篇里「AI 摘要」下是条目，开着的编辑器里也看得到第一条
      const first = /## AI 摘要\n- \[\d\d:\d\d\]\(\S+\) (.+)/.exec(readFileSync(join(dir, `${name}.md`), 'utf8'))?.[1]
      if (!summaryAt && first && !text.includes('AI 在写摘要') && text.includes(first.slice(0, 12))) summaryAt = Date.now()
      if (!doneAt && !/%|没翻成/.test(lab)) doneAt = Date.now()
      // 有句子没翻成：说出来、带原因，照用户那样点「再试一次」补上（最多 3 次）
      if (/没翻成/.test(lab)) {
        if (++retries > 3) throw new Error(`重试了 3 次还没翻完：${lab}`)
        await sub.click()
        const why = (await web(page).getByRole('dialog', { name: '字幕' }).getByTestId('tr-error').textContent()) ?? ''
        console.log(`${Math.round((Date.now() - t0) / 1000)}s ${lab}；菜单里：${why}`)
        await shot(run, `real-yt-ai-failed-${retries}`)
        await web(page).getByRole('dialog', { name: '字幕' }).getByTestId('tr-error').getByRole('button', { name: '再试一次' }).click()
        await sub.click()
        await expect(sub).not.toContainText('没翻成')
      }
      if (i % 6 === 0) console.log(`${Math.round((Date.now() - t0) / 1000)}s ${lab}`)
    }
    console.log(`摘要 ${Math.round((summaryAt - t0) / 1000)} 秒写出来；字幕 ${Math.round((doneAt - t0) / 1000)} 秒翻好（点了 ${retries} 次重试）：${await sub.textContent()}`)
    expect(summaryAt && doneAt).toBeTruthy()
    const md = readFileSync(join(dir, `${name}.md`), 'utf8')
    const summary = /## AI 摘要\n([\s\S]*?)\n\n## /.exec(md)![1]!
    console.log('摘要：\n' + summary)
    expect(summary).toMatch(/^- \[\d\d:\d\d\]/)
    // 开着的编辑器里是写好的那份，不是「AI 在写摘要…」
    await expect(doc).toContainText(/\) (.+)$/m.exec(summary.split('\n')[0]!)![1]!.slice(0, 12))
    await shot(run, 'real-yt-ai-done')
    await sub.click()
    await shot(run, 'real-yt-ai-menu')
  } finally {
    await run.close()
  }
})
