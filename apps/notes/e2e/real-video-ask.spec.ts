// 真 YouTube + 真 Claude Code 框一块问一次（task-sta8n 的问框）：CN_REAL_VIDEO=1 和 CN_REAL_AI=1 才跑，要上网、花一点额度，不登录任何账号。
// 在 Claude Code 的终端里跑要去掉父会话的 CLAUDE_* 环境变量，模型用便宜的：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_VIDEO=1 CN_REAL_AI=1 CN_AI_MODEL=sonnet CN_SHOTS=<文件夹> npx playwright test e2e/real-video-ask.spec.ts
// 问框里真点「想多久」选 Low；回答在问框里一边答一边长出来，文档里写进 AI 讲解块；⋯ 里「到 AI 对话里接着聊」带过去（只看，不在那里再问）。
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, rail, type Running } from './app'

test.skip(process.env.CN_REAL_VIDEO !== '1' || process.env.CN_REAL_AI !== '1', '要上网、真问 AI：CN_REAL_VIDEO=1 CN_REAL_AI=1 才跑')
test.setTimeout(420_000)
// 网站（YouTube 的 BotGuard）看到 navigator.webdriver 就不给字幕：真用户的软件里没有这个标记，测试里也去掉
process.env.CN_E2E_ARGS = '--disable-blink-features=AutomationControlled'

const YT = process.env.CN_REAL_YT || 'https://www.youtube.com/watch?v=kYB8IZa5AuE'
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

test('真 YouTube + 真 Claude Code：框一块问，回答在问框里长出来、写进文档，选 Low，带去 AI 标签', async () => {
  const run = await launch({ '看视频的笔记.md': '# 看视频的笔记\n\n跟着视频记。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('跟着视频记。').click()
    await page.keyboard.press('End')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    // 网页栏拉到 600（和原型一样）
    const sep = (await page.getByRole('separator', { name: '拖动调整右栏宽度' }).boundingBox())!
    await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
    await page.mouse.down()
    await page.mouse.move(sep.x - 220, sep.y + 300, { steps: 8 })
    await page.mouse.up()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(YT)
    await addr.press('Enter')
    await expect(strip(page)).toBeVisible({ timeout: 60_000 })
    expect(await guest(page, 'String(navigator.webdriver)')).toBe('false')
    // 欧洲第一次打开有「同意 Cookie」页：点「全部拒绝」（临时的测试实例，不是用户的账号）
    await page.waitForTimeout(3000)
    if (await guest(page, `!!document.querySelector('form[action*="consent"], ytd-consent-bump-v2-lightbox, .eom-buttons')`))
      await guest(page, `[...document.querySelectorAll('button, [role=button]')].find((b) => /Reject all|Alle ablehnen|全部拒绝/.test(b.textContent))?.click(), true`)
    // 有广告时等广告放完（task-sta8n：放广告时不再定成「没有字幕」）
    const sub = strip(page).getByRole('button', { name: '字幕', exact: true })
    await expect(sub).not.toContainText(/读取中/, { timeout: 150_000 })
    console.log('字幕：', await sub.textContent())
    await guest(page, `(() => { const v = document.querySelector('video'); v.muted = true; v.currentTime = 222; v.pause(); return true })()`)
    await page.waitForTimeout(1500)
    // ⌥D，在画面左上到中间拖一个框
    await pane(page).getByText('跟着视频记。').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host')?.shadowRoot?.querySelector('.box')`)).toBe(true)
    const r = (await guest(page, `(() => { const b = document.getElementById('movie_player').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height } })()`)) as { x: number; y: number; w: number; h: number }
    const wv = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + r.x + r.w * 0.1, wv.y + r.y + r.h * 0.15)
    await page.mouse.down()
    await page.mouse.move(wv.x + r.x + r.w * 0.7, wv.y + r.y + r.h * 0.6, { steps: 10 })
    await page.mouse.up()
    const ask = web(page).getByRole('dialog', { name: '问 AI' })
    await expect(ask).toBeVisible()
    // 小活现想的两颗建议（真 Haiku 看图）：等一会儿，想不出也照样问
    await page.waitForTimeout(12_000)
    console.log('建议：', await ask.getByTestId('ak-sug').innerText())
    await shot(run, 'real-ask-card')
    // 想多久：真点，选 Low
    await ask.getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /Low/ }).click()
    await expect(ask.getByTestId('ai-effort')).toContainText('Low')
    await ask.getByRole('textbox', { name: '想问什么' }).fill('框住的这一块在讲什么？用两三句说。')
    await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
    await expect(ask.getByTestId('ak-wait')).toBeVisible()
    const started = Date.now()
    // 回答一边答一边长出来：先看到半截，再答完
    let partial = ''
    await expect
      .poll(
        async () => {
          const t = (await ask.getByTestId('ak-answer').count()) ? await ask.getByTestId('ak-answer').innerText() : ''
          if (t && !partial && !(await ask.getByRole('button', { name: /已记进/ }).count())) partial = t
          return t.length
        },
        { timeout: 180_000, intervals: [300] },
      )
      .toBeGreaterThan(10)
    await expect(ask.getByRole('button', { name: /已记进/ })).toBeVisible({ timeout: 180_000 })
    const answer = await ask.getByTestId('ak-answer').innerText()
    console.log(`答好用了 ${Math.round((Date.now() - started) / 1000)} 秒；边答时看到的半截：${JSON.stringify(partial.slice(0, 60))}`)
    console.log('回答：', answer)
    console.log('头上：', await ask.getByTestId('ak-meta').innerText())
    await expect(ask.getByTestId('ak-meta')).toContainText('Claude Code · Sonnet · Low')
    // 长回答从头读得到：问的那句还在问框里露着（没跟着滚到最下面）
    const qShown = await ask.getByRole('log', { name: '回答' }).evaluate((b) => {
      const q = b.lastElementChild!.querySelector('.ak-q')!.getBoundingClientRect()
      const r = b.getBoundingClientRect()
      return q.top >= r.top - 1 && q.bottom <= r.bottom + 1
    })
    expect(qShown).toBe(true)
    await shot(run, 'real-ask-answer')
    const md = readFileSync(join(vault, '看视频的笔记.md'), 'utf8')
    expect(md).toContain('> [!ai] AI 讲解 · Claude Code · Sonnet · 看了')
    // ⋯ 里「到 AI 对话里接着聊」（task-eavzx 以前叫「在 AI 标签里聊」）：问答带过去
    await ask.getByTestId('ak-ans-acts').locator('[data-act="more"]').click()
    await page.getByRole('menuitem', { name: '到 AI 对话里接着聊' }).click()
    const reading = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(reading).toContainText('框住的这一块在讲什么？')
    await shot(run, 'real-ask-ai-tab')
  } finally {
    await run.close()
  }
})
