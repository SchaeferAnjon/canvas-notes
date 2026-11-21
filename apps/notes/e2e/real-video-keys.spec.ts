// 真 YouTube 视频 + 真 Claude Code 跑「视频要点带时间」（task-fw1f3）：每条要点的时间是不是字幕里真有的那一句开头、
// 和那一句讲的是不是一回事（把要点和那一秒的字幕并排写进日志，人对一遍）。不登录任何账号，测试模式、临时库、临时设置目录。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 CN_REAL_VIDEO=1 npx playwright test e2e/real-video-keys.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量）。CN_AI_MODEL=sonnet，effort 选 Low；CN_REAL_LOG 给了就把对照写进去。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, rail, type Running } from './app'

test.skip(!process.env.CN_REAL_AI || process.env.CN_REAL_VIDEO !== '1', '真 AI、真视频才跑：CN_REAL_AI=1 CN_REAL_VIDEO=1')
test.setTimeout(10 * 60_000)
// 网站（YouTube 的 BotGuard）看到 navigator.webdriver 就不给字幕
process.env.CN_E2E_ARGS = '--disable-blink-features=AutomationControlled'

const YT = process.env.CN_REAL_YT || 'https://www.youtube.com/watch?v=kYB8IZa5AuE'
const log = (s: string) => (process.env.CN_REAL_LOG ? appendFileSync(process.env.CN_REAL_LOG, s + '\n') : console.log(s))
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

function forgetSessions(run: Running) {
  const projects = join(homedir(), '.claude', 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  const mine = existsSync(projects) ? readdirSync(projects).filter((d) => d.includes(stamp)) : []
  for (const d of mine) rmSync(join(projects, d), { recursive: true, force: true })
  log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}`)
}

test('真 YouTube + 真 Claude Code：视频要点带时间，每条时间是字幕里那一句的开头', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(YT)
    await addr.press('Enter')
    await expect(strip(page)).toBeVisible({ timeout: 60_000 })
    await page.waitForTimeout(3000)
    // 欧洲第一次打开有「同意 Cookie」页：点「全部拒绝」（临时的测试实例，不是用户的账号）
    if (await guest(page, `!!document.querySelector('form[action*="consent"], ytd-consent-bump-v2-lightbox, .eom-buttons')`))
      await guest(page, `[...document.querySelectorAll('button, [role=button]')].find((b) => /Reject all|Alle ablehnen|全部拒绝/.test(b.textContent))?.click(), true`)
    await expect(strip(page).getByRole('button', { name: '字幕' })).toContainText('字幕 英', { timeout: 150_000 })
    const v = (await page.evaluate(() => window.cn.aiCmdVideo()))!
    expect(v.cues.length).toBeGreaterThan(20)
    log(`视频：${v.title}（${mmss(v.duration)}，${v.cues.length} 句字幕）`)

    await openAi(page)
    const rchat = page.getByRole('complementary', { name: '边读边问 AI' })
    await rchat.getByTestId('ai-effort').click()
    await page.getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(rchat.getByTestId('ai-effort')).toHaveText('Low')
    const t0 = Date.now()
    await rchat.getByRole('textbox', { name: '问 AI' }).click()
    await page.keyboard.type('/视频要点')
    await page.getByTestId('slash-menu').locator('.it:has(.n:text-is("视频要点带时间"))').click()
    await expect(rchat.getByTestId('reading-msg').last().getByTestId('ai-change')).toBeVisible({ timeout: 5 * 60_000 })
    const files = execFileSync('git', ['-C', vault, '-c', 'core.quotePath=false', 'log', '-1', '--format=', '--name-only'], { encoding: 'utf8' }).trim()
    const note = readFileSync(join(vault, files), 'utf8')
    const items = [...note.matchAll(/^- \[(\d\d):(\d\d)\]\(.+[&?]t=(\d+)s\) (.+)$/gm)].map((m) => ({ shown: Number(m[1]) * 60 + Number(m[2]), link: Number(m[3]), text: m[4]! }))
    log(`用了 ${Math.round((Date.now() - t0) / 1000)} 秒，${items.length} 条要点（要点 ｜ 字幕里那一秒开始的那一句）：`)
    expect(items.length).toBeGreaterThanOrEqual(3)
    for (const x of items) {
      expect(x.link).toBe(x.shown)
      const i = v.cues.findIndex((c) => Math.floor(c[0]) === x.link)
      // 时间落在某一句字幕的开头
      expect(i, `${mmss(x.link)} 不是哪一句字幕的开头`).toBeGreaterThanOrEqual(0)
      const around = v.cues.slice(i, i + 3).map((c) => c[2]).join(' ')
      log(`- [${mmss(x.link)}] ${x.text}\n    字幕 ${mmss(v.cues[i]![0])}：${around}`)
    }
    expect(new Set(items.map((x) => x.link)).size).toBe(items.length)
  } finally {
    forgetSessions(run)
    await run.close()
  }
})
