/**
 * 首次问AI引导登录：问 AI 时 Claude Code 没登录，右栏那一问的回答处是一张引导卡（不是「在终端里运行 claude」那行红字）：
 * 一句说明 +「用Claude会员登录」→ 跑 claude auth login --claudeai，授权页交给系统浏览器（测试模式里是记录器）→ 登好了刚才那句接着发、有回答，
 * 问话不重复一遍。「取消」停下等浏览器；没装 Claude Code 时同一张卡先装再登；登过的问一句不出卡；英文界面。
 * 假的 claude（packages/ai-engines/test/fixtures/fake-cli.mjs，loggedIn: false 照 2.1.332 没登录时的原话）放在临时家目录的 ~/.local/bin，
 * 不开 CN_AI_FAKE：问 AI 真的起这个假命令行，不碰这台 Mac 上真的 Claude Code。
 * CN_SHOTS=<目录>：另外截十套主题的卡（交付对照图），平时跳过那一条。
 */
import { expect, test, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openNote, type Running } from './app'

const FAKE = join(__dirname, '../../../packages/ai-engines/test/fixtures/fake-cli.mjs')
const files = { '随手记.md': '# 随手记\n\n一段字。\n' }
const ANSWER = /^这是假 Claude Code 2\.1\.330 的回答/

function script(p: string, body: string) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

/** 临时家目录里一个假 claude（状态 fake-state/claude.json），只在家目录里找命令 */
function fakeClaude(st: object) {
  const home = mkdtempSync(join(tmpdir(), 'cn-e2e-home-'))
  const dir = join(home, 'fake-state')
  mkdirSync(dir)
  const bin = join(home, '.local/bin/claude')
  script(bin, `exec "${process.execPath}" "${FAKE}" claude "$@"`)
  writeFileSync(join(dir, 'claude.json'), JSON.stringify(st))
  const state = () => JSON.parse(readFileSync(join(dir, 'claude.json'), 'utf8')) as { loggedIn?: boolean }
  const log = () => readFileSync(join(dir, 'claude.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])
  const env = { HOME: home, ZDOTDIR: home, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', CN_REAL_FIND: '1', CN_CLI_HOME_ONLY: '1', FAKE_CLI_STATE: dir, CN_LOCAL_BASE_OLLAMA: 'http://127.0.0.1:9', CN_LOCAL_BASE_LMSTUDIO: 'http://127.0.0.1:9' }
  return { home, bin, env, state, log, done: () => rmSync(home, { recursive: true, force: true }) }
}

const chat = (page: Page) => page.getByRole('complementary', { name: /^(AI 对话|AI chat)$/ })
const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen)

async function ask(page: Page, q: string) {
  await openNote(page, '随手记')
  await page.keyboard.press('Meta+j')
  const box = chat(page).getByRole('textbox', { name: /^(问 AI|Ask AI)$/ })
  await box.fill(q)
  await box.press('Enter')
}

test('没登录：问一句出引导卡（没有红字那行）→ 点「用Claude会员登录」授权页交给系统浏览器 → 登好了刚才那句接着发、有回答，问话只有一条', async () => {
  const fake = fakeClaude({ loggedIn: false })
  const run = await launch(files, fake.env)
  const { page } = run
  try {
    await expect.poll(() => page.evaluate(async () => (await window.cn.aiEngines()).engines.find((e) => e.id === 'claude')?.path), { timeout: 15_000 }).toBe(fake.bin)
    await ask(page, '这一段讲的是什么')
    const ai = chat(page)
    const card = ai.getByTestId('ai-login')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card).toHaveAttribute('data-mode', 'login')
    await expect(card.locator('h3')).toHaveText('Claude Code还没登录')
    await expect(card).toContainText('用你的Claude会员账号（Pro、Max）登录一次，登好后刚才那句接着发出去。')
    await expect(card).toContainText('会打开浏览器，在Anthropic自己的页面登录。')
    // 不再是那行「在终端里运行claude登录一下」
    await expect(ai.getByTestId('ai-error')).toHaveCount(0)
    await expect(ai).not.toContainText('在终端里运行')
    const go = card.getByTestId('login-go')
    await expect(go).toHaveText('用Claude会员登录')
    await expect(go).toHaveClass(/btn-primary/)
    await expect(card.getByTestId('login-switch')).toHaveText('换一家')

    await go.click()
    // 授权页走 shell.openExternal（测试模式里记下来，不真开浏览器）
    await expect.poll(async () => (await screen(run)).find((s) => s.startsWith('用浏览器打开 ')), { timeout: 10_000 }).toMatch(/^用浏览器打开 https:\/\/claude\.com\/cai\/oauth\/authorize\?/)
    expect(fake.log().some((a) => a.join(' ') === 'auth login --claudeai')).toBe(true)
    // 登好了：卡没了，刚才那句接着发出去、有回答；问话只有一条（出错那一轮拿掉了）
    const msg = ai.getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toHaveText(ANSWER, { timeout: 15_000 })
    await expect(card).toHaveCount(0)
    await expect(ai.locator('.um')).toHaveText(['这一段讲的是什么'])
    await expect(ai.getByTestId('ai-msg')).toHaveCount(1)
    expect(fake.state().loggedIn).toBe(true)
    // 问话真的又交给了 claude -p 一次（第二次是登好以后）
    expect(fake.log().filter((a) => a.includes('-p')).length).toBe(2)
  } finally {
    await run.close()
    fake.done()
  }
})

test('等浏览器时点「取消」：停下登录、回到原样不报错；再点能接着登；登过的再问一句不出卡', async () => {
  const fake = fakeClaude({ loggedIn: false, loginMs: 60_000 })
  const run = await launch(files, fake.env)
  const { page } = run
  try {
    await ask(page, '你好')
    const card = chat(page).getByTestId('ai-login')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.getByTestId('login-go').click()
    await expect(card.getByTestId('login-go')).toHaveAttribute('aria-busy', 'true')
    await expect(card.getByTestId('login-go')).toHaveText('等浏览器里登好…')
    await expect(card.getByTestId('login-switch')).toHaveCount(0)
    await expect.poll(async () => (await screen(run)).some((s) => s.startsWith('用浏览器打开 https://claude.com/')), { timeout: 10_000 }).toBe(true)
    await card.getByTestId('login-cancel').click()
    await expect(card.getByTestId('login-go')).not.toHaveAttribute('aria-busy', 'true', { timeout: 10_000 })
    await expect(card.getByTestId('login-go')).toHaveText('用Claude会员登录')
    await expect(card.getByRole('alert')).toHaveCount(0)
    await expect(card.getByTestId('login-switch')).toBeVisible()
    expect(fake.state().loggedIn).toBe(false)

    // 在终端里登好了（状态改成登过）：再点一次不再开浏览器，直接接着发
    writeFileSync(join(fake.env.FAKE_CLI_STATE, 'claude.json'), JSON.stringify({ loggedIn: true }))
    const opens = (await screen(run)).filter((s) => s.startsWith('用浏览器打开')).length
    await card.getByTestId('login-go').click()
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText(ANSWER, { timeout: 15_000 })
    expect((await screen(run)).filter((s) => s.startsWith('用浏览器打开')).length).toBe(opens)

    // 登过的再问一句：直接答，不出卡（等上一问答完收尾：输入框右边回到「发送」）
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('再问一句')
    await box.press('Enter')
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(2, { timeout: 15_000 })
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText(ANSWER, { timeout: 15_000 })
    await expect(chat(page).getByTestId('ai-login')).toHaveCount(0)
  } finally {
    await run.close()
    fake.done()
  }
})

test('登录没成（命令行报错退出）：卡上一句「还没登好」，按钮能再点', async () => {
  const fake = fakeClaude({ loggedIn: false, loginFail: 'OAuth error: access_denied' })
  const run = await launch(files, fake.env)
  const { page } = run
  try {
    await ask(page, '你好')
    const card = chat(page).getByTestId('ai-login')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await card.getByTestId('login-go').click()
    await expect(card.getByRole('alert')).toHaveText('还没登好：在浏览器里登完，再点一次「用Claude会员登录」', { timeout: 10_000 })
    await expect(card.getByTestId('login-go')).toBeEnabled()
    await expect(card).toHaveAttribute('data-state', 'failed')
    // 再问一句还是没登录：只有最新那张能点，前一张收成一行（一屏一颗实心按钮）
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('再问一句')
    await box.press('Enter')
    await expect(chat(page).getByTestId('ai-login')).toHaveCount(1, { timeout: 15_000 })
    await expect(chat(page).getByTestId('ai-login-past')).toHaveText('Claude Code还没登录')
    await expect(chat(page).locator('.btn-primary')).toHaveCount(1)
  } finally {
    await run.close()
    fake.done()
  }
})

test('问的时候 claude 不见了（卸掉、挪走）：同一张卡先装 Claude Code，装好看登过了就接着发', async () => {
  const fake = fakeClaude({ loggedIn: true })
  const run = await launch(files, fake.env)
  const { page } = run
  try {
    await expect.poll(() => page.evaluate(async () => (await window.cn.aiEngines()).engines.find((e) => e.id === 'claude')?.path), { timeout: 15_000 }).toBe(fake.bin)
    // 软件启动时找到过，问之前挪走了
    const away = `${fake.bin}.away`
    renameSync(fake.bin, away)
    await ask(page, '你好')
    // 问到之前软件已经发现它不见了（一个 AI 都没有）就是三选一卡；先问到了就是那一问的「没装」卡。两种都要能装好接着发
    const card = chat(page).getByTestId('ai-login')
    const setup = chat(page).getByTestId('ai-setup')
    await expect(card.or(setup)).toBeVisible({ timeout: 15_000 })
    if (await card.count()) {
      await expect(card).toHaveAttribute('data-mode', 'install')
      await expect(card.locator('h3')).toHaveText('这台Mac上没装Claude Code')
      await expect(card.locator('.aiset-code')).toHaveText('curl -fsSL https://claude.ai/install.sh | bash')
      // 测试实例不真装（演几行输出）；装好的样子：claude 回来了
      renameSync(away, fake.bin)
      await card.getByTestId('login-install').click()
    } else {
      await setup.getByTestId('setup-cc').click()
      renameSync(away, fake.bin)
      await setup.getByTestId('setup-cc-install').click()
      await setup.getByTestId('setup-cc-login').click()
      await chat(page).getByTestId('setup-start').click()
    }
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText(ANSWER, { timeout: 15_000 })
    await expect(chat(page).locator('.um')).toHaveText(['你好'])
  } finally {
    await run.close()
    fake.done()
  }
})

test('英文界面：卡上的字是英文', async () => {
  const fake = fakeClaude({ loggedIn: false })
  const run = await launch(files, { ...fake.env, CN_LANG: 'en' })
  const { page } = run
  try {
    // 在首页问（openNote 认的是中文的标签名）
    await page.keyboard.press('Meta+j')
    const box = chat(page).getByRole('textbox').last()
    await box.fill('hello')
    await box.press('Enter')
    const card = chat(page).getByTestId('ai-login')
    await expect(card).toBeVisible({ timeout: 15_000 })
    await expect(card.locator('h3')).toHaveText('Claude Code isn’t signed in')
    await expect(card.getByTestId('login-go')).toHaveText('Sign in with Claude subscription')
    await expect(card.getByTestId('login-switch')).toHaveText('Switch AI')
    await expect(card).toContainText('Opens your browser to sign in on Anthropic’s own page.')
  } finally {
    await run.close()
    fake.done()
  }
})

// ---------------------------------------------------------------- 交付对照图
const DIR = process.env.CN_SHOTS
const SKINS = ['mint', 'sky', 'sakura', 'lilac', 'stone', 'pine', 'petrol', 'cocoa', 'ink', 'graphite']

/** 主题在启动前写进设置（运行中换主题要重载页面，对话里那张卡就没了） */
const lookOf = (skin: string) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
}

for (const skin of SKINS) {
  test(`对照图：${skin} 的引导卡（CN_SHOTS）`, async () => {
    test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
    mkdirSync(DIR!, { recursive: true })
    const stage = process.env.CN_SHOT_STAGE ?? 'after'
    const extra = stage === 'after' && (skin === 'mint' || skin === 'graphite')
    const fake = fakeClaude({ loggedIn: false, loginMs: 600_000 })
    const run = await launch(files, fake.env, lookOf(skin))
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 820))
      await ask(page, '这一段讲的是什么')
      const ai = chat(page)
      await expect(ai.getByTestId('ai-login').or(ai.getByTestId('ai-error'))).toBeVisible({ timeout: 15_000 })
      await page.mouse.move(0, 0)
      await page.waitForTimeout(400)
      await ai.screenshot({ path: join(DIR!, `${stage}-${skin}.png`) })
      if (!extra) return
      await ai.getByTestId('login-go').click()
      await expect(ai.getByTestId('login-cancel')).toBeVisible()
      await page.waitForTimeout(400)
      await ai.screenshot({ path: join(DIR!, `after-waiting-${skin}.png`) })
      await ai.getByTestId('login-cancel').click()
      await expect(ai.getByTestId('login-go')).toBeEnabled()
      // 没装的那一种
      renameSync(fake.bin, `${fake.bin}.away`)
      const box = ai.getByRole('textbox', { name: '问 AI' })
      await box.fill('再问一句')
      await box.press('Enter')
      await expect(ai.locator('[data-testid="ai-login"][data-mode="install"]')).toBeVisible({ timeout: 15_000 })
      await ai.locator('.msgs').evaluate((el) => el.scrollTo({ top: el.scrollHeight }))
      await page.waitForTimeout(400)
      await ai.screenshot({ path: join(DIR!, `after-install-${skin}.png`) })
    } finally {
      await run.close()
      fake.done()
    }
  })
}
