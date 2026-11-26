/**
 * 首次问AI引导登录，真的 Claude Code（CN_REAL_AI=1 才跑）：
 * - 空的 CLAUDE_CONFIG_DIR（等于没登录）问一句：认出没登录、出引导卡；点「用Claude会员登录」真起 claude auth login --claudeai，
 *   授权页网址交到 shell.openExternal（测试模式里只记下，不开浏览器），再点「取消」停下，不真去登；
 * - 这台 Mac 上已登录的账号（保留 CLAUDE_CONFIG_DIR）问一句：不出卡，有回答。
 * 跑法（去掉 Claude Code 的会话变量和测试 Key）：
 *   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" [CLAUDE_CONFIG_DIR=…] CN_REAL_AI=1 npx playwright test e2e/real-login-ai.spec.ts
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { launch, openNote, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen)

async function ask(page: Page, q: string) {
  await openNote(page, '随手记')
  await page.keyboard.press('Meta+j')
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(q)
  await box.press('Enter')
}

test('空的 CLAUDE_CONFIG_DIR：真 claude 认出没登录、出引导卡；点登录授权页交给系统浏览器（只记下），取消后回到原样', async () => {
  const cfg = mkdtempSync('/private/tmp/cn-login-cfg-')
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' }, { CLAUDE_CONFIG_DIR: cfg })
  const { page } = run
  try {
    await expect.poll(() => page.evaluate(async () => (await window.cn.aiEngines()).engines.find((e) => e.id === 'claude')?.path ?? null), { timeout: 20_000 }).not.toBeNull()
    await ask(page, '你好')
    const card = chat(page).getByTestId('ai-login')
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toHaveAttribute('data-mode', 'login')
    await expect(chat(page).getByTestId('ai-error')).toHaveCount(0)
    expect(await page.evaluate(() => window.cn.aiCcStatus())).toEqual({ loggedIn: false })
    await card.getByTestId('login-go').click()
    await expect.poll(async () => (await screen(run)).find((s) => s.startsWith('用浏览器打开 ')) ?? '', { timeout: 20_000 }).toMatch(/^用浏览器打开 https:\/\/claude\.(com|ai)\/.*oauth\/authorize\?/)
    const url = (await screen(run)).find((s) => s.startsWith('用浏览器打开 '))!
    // 回调地址是本机端口，只登会员（--claudeai）那套权限
    expect(url).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A')
    console.log(`授权页：${url.replace(/(code_challenge|state)=[^&]+/g, '$1=…')}`)
    await card.getByTestId('login-cancel').click()
    await expect(card.getByTestId('login-go')).not.toHaveAttribute('aria-busy', 'true', { timeout: 15_000 })
    await expect(card.getByRole('alert')).toHaveCount(0)
  } finally {
    await run.close()
    rmSync(cfg, { recursive: true, force: true })
  }
})

test('已登录的账号：问一句直接答，不出卡', async () => {
  test.setTimeout(180_000)
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' })
  const { page } = run
  try {
    await expect.poll(() => page.evaluate(async () => (await window.cn.aiEngines()).engines.find((e) => e.id === 'claude')?.path ?? null), { timeout: 20_000 }).not.toBeNull()
    expect(await page.evaluate(() => window.cn.aiCcStatus())).toEqual({ loggedIn: true })
    await ask(page, '只回一个字：好')
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).not.toBeEmpty({ timeout: 150_000 })
    await expect(chat(page).getByTestId('ai-login')).toHaveCount(0)
    await expect(chat(page).getByTestId('ai-error')).toHaveCount(0)
    console.log(`回答：${await msg.locator('.txt').innerText()}`)
  } finally {
    await run.close()
  }
})
