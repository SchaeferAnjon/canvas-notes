// 没装 Claude Code 时的 AI（task-587os 收口第 2 条，设计页 64）：测试模式里假装这台 Mac 上一个命令行都没有（CN_AI_FAKE_CLI 四家 missing），
// 本机模型的地址指到关着的端口（没找到）。真点：AI 栏第一次打开就是三选一卡、输入框写「还没接 AI」、全能开关灰着；
// 本机模型没找到的提示和两个官网链接；填 Key（假的 Anthropic 接口：错的 Key 回 401、对的列模型）→ 接上了、全能模式和梦游各一句 → 开始用；
// 设置 › AI 的三组、选 AI 的菜单按三条路分组、梦游那一行写门槛 0.85。
// 真的那一段（CN_TEST_ANTHROPIC_API_KEY 有、本机有 opencode 时）：用真 Key 走一遍卡，先发出去的那一问在「开始用」后接着发，
// 交给软件自带的 OpenCode 真动手改一篇笔记（Sonnet 5.5，一问），改动提交成一次「AI：…」。
// CN_SHOTS=<目录> 时存对照图（交付页 71）。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { launch } from './app'

const NO_CLI = { CN_AI_FAKE: '1', CN_AI_FAKE_CLI: 'claude=missing,codex=missing,gemini=missing,opencode=missing', CN_LOCAL_BASE_OLLAMA: 'http://127.0.0.1:9', CN_LOCAL_BASE_LMSTUDIO: 'http://127.0.0.1:9' }
// 编的 Key，拆成两段写，免得公开导出的密钥扫描当成真的
const FAKE = (rest: string) => 'sk-ant-' + rest
const GOOD = FAKE('good-test-key-1234')

const shots = process.env.CN_SHOTS
async function shot(page: Page, name: string, el?: ReturnType<Page['locator']>) {
  if (!shots) return
  mkdirSync(shots, { recursive: true })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  await (el ?? page).screenshot({ path: join(shots, `${name}.png`) })
}

let server: Server
let base = ''
test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/v1/models')) {
      if (req.headers['x-api-key'] !== GOOD) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end('{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}')
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5' }] }))
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => new Promise<void>((r) => server.close(() => r())))

test('一个命令行都没有：三选一卡、本机模型没找到、填错 Key 一句人话、填对接上、全能模式和梦游各一句、设置 › AI 三组', async () => {
  const run = await launch({ '甲.md': '# 甲\n\n第一段。\n', '收件箱/乙.md': '# 乙\n' }, { ...NO_CLI, CN_API_BASE_ANTHROPIC: base })
  const { page } = run
  try {
    expect(await page.evaluate(async () => (await window.cn.aiEngines()).none)).toBe(true)
    await page.keyboard.press('Meta+j')
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    const card = ai.getByTestId('ai-setup')
    await expect(card).toBeVisible()
    await expect(card.getByRole('heading', { name: '先接上一个AI' })).toBeVisible()
    // 三条路：填 Key 第一个、标推荐，本机模型第二，装 Claude Code 第三
    const opts = card.locator('.aiset-opt')
    await expect(opts).toHaveCount(3)
    await expect(opts.nth(0)).toContainText('填一个API Key推荐')
    await expect(opts.nth(1)).toContainText('用这台Mac上的模型')
    await expect(opts.nth(2)).toContainText('装Claude Code')
    // 问候前面不画任何一家的标志；输入框底行写「还没接 AI」；全能开关灰着
    await expect(ai.getByTestId('ai-greet').locator('.eng-logo')).toHaveCount(0)
    await expect(ai.getByTestId('ai-noai')).toHaveText('还没接AI')
    await expect(ai.getByRole('switch', { name: '全能模式' })).toBeDisabled()
    await shot(page, '01-pick', ai)

    // 发一句：不发出去，卡还在，没有一条消息
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('帮我看看今天该整理什么')
    await box.press('Enter')
    await expect(card).toBeVisible()
    await expect(ai.getByTestId('ai-msg')).toHaveCount(0)

    // 本机模型：Ollama、LM Studio 都没开 → 说清要做什么，两个官网链接（测试模式记下「用浏览器打开」），再找一遍
    await card.getByTestId('setup-local').click()
    await expect(card.getByTestId('setup-local-none')).toContainText('装一个，开着它，再点「再找一遍」')
    await card.getByRole('button', { name: '装Ollama' }).click()
    await expect.poll(() => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('\n'))).toContain('用浏览器打开 https://ollama.com/download')
    await card.getByTestId('setup-local-again').click()
    await expect(card.getByTestId('setup-local-none')).toBeVisible()
    await shot(page, '02-local-none', ai)
    await card.getByRole('button', { name: '换一种' }).click()

    // 填 Key：选一家（Anthropic 默认选着）→ 粘错的 → 一句人话 + 红色图标，不存
    await card.getByTestId('setup-key').click()
    await expect(card.getByRole('radio', { name: /Anthropic/ })).toHaveAttribute('aria-checked', 'true')
    await shot(page, '03-provider', ai)
    await card.getByTestId('setup-next').click()
    await expect(card.getByTestId('setup-key-input')).toHaveAttribute('type', 'password')
    await expect(card.getByTestId('setup-key-input')).toHaveAttribute('placeholder', 'sk-ant-…')
    await card.getByTestId('setup-key-input').fill(FAKE('wrong-key-0000'))
    await card.getByTestId('setup-verify').click()
    await expect(card.getByTestId('setup-key-error')).toHaveText('这把Key Anthropic不认（401）：再拷一遍，注意前后的空格。')
    await expect(card.getByTestId('setup-key-error').locator('.bic')).toBeVisible()
    expect(await page.evaluate(async () => (await window.cn.aiEngines()).none)).toBe(true)
    await shot(page, '04-key-bad', ai)

    // 粘对的：接上了 · Claude API · Sonnet 5.5；全能模式一句、梦游一句（钱数按这个库的篇数现算），不要求点同意
    await card.getByTestId('setup-key-input').fill(`  ${GOOD} `)
    await card.getByTestId('setup-verify').click()
    await expect(card.getByTestId('setup-done')).toContainText('接上了：Claude API · Sonnet 5.5')
    await expect(card.getByTestId('setup-omni')).toContainText('全能模式开着：AI能读写这台Mac上的文件、跑命令、上网')
    await expect(card.getByTestId('setup-dream')).toContainText('用Haiku 5.5，按用量算在你的Key上：一晚50篇约$0.1，第一次补全库约$0.01')
    // 接上以后：输入框底行三颗（Claude API · Sonnet 5.5 · Medium），全能开关能点、开着
    await expect(ai.getByTestId('ai-engine')).toHaveText('Claude API')
    await expect(ai.getByTestId('ai-model')).toHaveText('Sonnet 5.5')
    await expect(ai.getByTestId('ai-effort')).toHaveText('Medium')
    await expect(ai.getByRole('switch', { name: '全能模式' })).toBeEnabled()
    await expect(ai.getByRole('switch', { name: '全能模式' })).toHaveAttribute('aria-checked', 'true')
    await shot(page, '05-key-done', ai)
    const prefs = await page.evaluate(() => window.cn.aiPrefs())
    expect(prefs.prefs.default).toEqual({ engine: 'anthropic', model: 'claude-sonnet-5-5', effort: 'medium' })
    expect(prefs.prefs.features.dream).toEqual({ engine: 'anthropic', model: 'claude-haiku-5-5', effort: 'low' })
    expect(prefs.prefs.features.quick).toEqual({ engine: 'anthropic', model: 'claude-haiku-5-5' })
    // Key 只放内存（测试实例不碰钥匙串），界面只拿得到后 4 位
    const info = await page.evaluate(async () => (await window.cn.aiEngines()).engines.find((e) => e.id === 'anthropic')!)
    expect(info).toMatchObject({ route: 'api', tail: '1234', path: 'api:anthropic' })
    expect(existsSync(join(run.userData, 'ai/keys.json'))).toBe(false)

    // 开始用：卡收起，回到空对话（先发出去的那一问在这里接着发，真问在下面那条用真 Key 的里走）
    await card.getByTestId('setup-start').click()
    await expect(card).toHaveCount(0)
    expect(await page.evaluate(async () => (await window.cn.aiEngines()).intro)).toEqual({ ai: true, dream: true })

    // 选 AI 的菜单按三条路分组，组名写谁付钱；没装、没填 Key 的灰着
    await ai.getByTestId('ai-engine').click()
    const menu = page.getByRole('menu', { name: 'AI 引擎' })
    await expect(menu.locator('.mh.grp')).toHaveText(['本机命令行 · 订阅', 'API Key · 按用量', '本机模型 · 不花钱'])
    await expect(menu.getByRole('menuitemradio').filter({ hasText: 'Claude API' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByRole('menuitemradio').filter({ hasText: 'Claude Code' })).toBeDisabled()
    await expect(menu.getByRole('menuitemradio').filter({ hasText: 'DeepSeek API' })).toContainText('没填Key')
    await shot(page, '06-menu', menu)
    await page.keyboard.press('Escape')

    // 设置 › AI：先三组（各家命令行、API Key、本机模型），再默认；梦游那一行写门槛 0.85
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const set = page.getByRole('dialog', { name: '设置' })
    await expect(set.getByText('能用 · ••••1234 · 存在钥匙串')).toBeVisible()
    await expect(set.locator('[data-row="cliClaude"]')).toContainText('没找到')
    await expect(set.getByTestId('cli-how-claude')).toHaveText('怎么装')
    await expect(set.locator('[data-row="localOllama"]')).toContainText('没找到')
    await expect(set.locator('[data-row="fDream"]')).toContainText('门槛0.85')
    await expect(set.getByText('不用工具的活直接问接口；动手（改笔记、全能模式）由软件自带的OpenCode 1.19（MIT）执行。')).toBeVisible()
    await shot(page, '07-settings', set)
    // 换 Key：填错的说一句，不换
    await set.getByTestId('key-change-anthropic').click()
    await set.getByTestId('key-input-anthropic').fill(FAKE('wrong-again'))
    await set.getByRole('button', { name: '验证并用它' }).click()
    await expect(set.locator('.aisrc-err')).toContainText('不认（401）')
    await shot(page, '08-settings-key', set)
  } finally {
    await run.close()
  }
})

test('英文界面：三选一卡说得通（没有漏翻的中文）', async () => {
  const run = await launch({ '甲.md': '# 甲\n' }, { ...NO_CLI, CN_API_BASE_ANTHROPIC: base, CN_LANG: 'en' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+j')
    const ai = page.locator('aside.ai')
    const card = ai.getByTestId('ai-setup')
    await expect(card).toContainText('Connect an AI first')
    await expect(card).toContainText('Recommended')
    expect(await card.innerText()).not.toMatch(/\p{Script=Han}/u)
    await expect(ai.getByTestId('ai-noai')).toHaveText('No AI yet')
    await shot(page, '09-pick-en', ai)
    await card.getByTestId('setup-key').click()
    await card.getByTestId('setup-next').click()
    await card.getByTestId('setup-key-input').fill(GOOD)
    await card.getByTestId('setup-verify').click()
    await expect(card.getByTestId('setup-done')).toContainText('Connected:')
    expect(await card.innerText()).not.toMatch(/\p{Script=Han}/u)
    await shot(page, '10-done-en', ai)
  } finally {
    await run.close()
  }
})

test('本机模型找到了：列模型和大小，用这个模型 → 三句实话、全能开关灰着；装 Claude Code：命令原样摆出来、输出一行行、登录后接上；深色', async () => {
  test.setTimeout(180_000)
  // 假的 Ollama：/api/tags 列两个模型，聊天回一句
  const ollama = createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ models: [{ name: 'qwen3.5:9b', size: 7_086_000_000 }, { name: 'gemma4:12b', size: 8_700_000_000 }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    res.end('data: {"choices":[{"delta":{"content":"本机模型的回答"}}]}\n\ndata: [DONE]\n\n')
  })
  // 先占一个空端口，软件起来时那里还没人听（本机模型没开、出卡），点「用这台Mac上的模型」之前再开
  await new Promise<void>((r) => ollama.listen(0, '127.0.0.1', r))
  const port = (ollama.address() as AddressInfo).port
  await new Promise<void>((r) => ollama.close(() => r()))
  const run = await launch({ '甲.md': '# 甲\n' }, { ...NO_CLI, CN_LOCAL_BASE_OLLAMA: `http://127.0.0.1:${port}` })
  const { page } = run
  try {
    await page.keyboard.press('Meta+j')
    await expect(page.getByRole('complementary', { name: 'AI 对话' }).getByTestId('ai-setup')).toBeVisible()
    await new Promise<void>((r) => ollama.listen(port, '127.0.0.1', r))
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    const card = ai.getByTestId('ai-setup')
    await card.getByTestId('setup-local').click()
    await expect(card).toContainText('Ollama开着，有2个模型')
    await expect(card).toContainText('LM Studio没开')
    await expect(card.getByRole('radio', { name: /qwen3.5:9b/ })).toHaveAttribute('aria-checked', 'true')
    await expect(card.getByRole('radio', { name: /qwen3.5:9b/ })).toContainText('6.6 GB')
    await shot(page, '14-local-found', ai)
    await card.getByTestId('setup-local-use').click()
    await expect(card.getByTestId('setup-done')).toContainText('接上了：Ollama · qwen3.5:9b')
    await expect(card).toContainText('本机模型只聊天、做小活，不动手改笔记')
    await expect(card).toContainText('梦游不用本机模型')
    await expect(ai.getByRole('switch', { name: '全能模式' })).toBeDisabled()
    await shot(page, '15-local-done', ai)
    await card.getByTestId('setup-start').click()
    // 问一句：本机模型答（只聊天）
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('你好')
    await box.press('Enter')
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toHaveText('本机模型的回答', { timeout: 15_000 })
    // 梦游不用本机模型：设置 › AI 梦游那一行的菜单里没有 Ollama
    expect((await page.evaluate(() => window.cn.aiPrefs())).prefs.features.dream).toBeUndefined()
  } finally {
    await run.close()
    ollama.close()
  }

  // 装 Claude Code（测试实例假装装好）：命令原样摆出来，输出一行行给人看，登录后接上 Claude Code；深色主题
  const run2 = await launch({ '甲.md': '# 甲\n' }, NO_CLI)
  try {
    const page2 = run2.page
    await page2.evaluate(() => window.cn.setSettings({ appearance: { followSystem: false, skin: 'pine' } }))
    await page2.reload()
    await page2.locator('.vault b').waitFor()
    await page2.keyboard.press('Meta+j')
    const ai = page2.getByRole('complementary', { name: 'AI 对话' })
    const card = ai.getByTestId('ai-setup')
    await shot(page2, '16-pick-dark', ai)
    await card.getByTestId('setup-cc').click()
    await expect(card.locator('.aiset-code')).toHaveText('curl -fsSL https://claude.ai/install.sh | bash')
    await card.getByTestId('setup-cc-install').click()
    await expect(card.getByTestId('setup-cc-log')).toContainText('Installed to ~/.local/bin/claude')
    await expect(card.getByTestId('setup-cc-login')).toBeEnabled()
    await shot(page2, '17-cc-installed-dark', ai)
    await card.getByTestId('setup-cc-login').click()
    await expect(card.getByTestId('setup-done')).toContainText('接上了：Claude Code · Opus 5.5')
    await expect(card.getByTestId('setup-dream')).toContainText('用Sonnet 5.5，占你的订阅额度')
    await shot(page2, '18-cc-done-dark', ai)
    expect(await page2.evaluate(async () => (await window.cn.aiEngines()).none)).toBe(false)
  } finally {
    await run2.close()
  }
})

// 真的：真 Key 走一遍卡，先发出去的那一问「开始用」后接着发，自带 OpenCode 真动手改一篇笔记（额度很小：Sonnet 5.5 一问）
const KEY = process.env.CN_TEST_ANTHROPIC_API_KEY
const OPENCODE = process.env.CN_TEST_OPENCODE || ['/opt/homebrew/lib/node_modules/opencode-ai/bin/opencode.exe'].find((p) => existsSync(p))
test('真 Key：卡上接上 Claude API，先问的那句接着发，自带 OpenCode 真改了一篇笔记、提交成一次', async () => {
  test.skip(!KEY || !OPENCODE, '要 CN_TEST_ANTHROPIC_API_KEY 和本机的 opencode')
  test.setTimeout(240_000)
  const run = await launch({ '甲.md': '# 甲\n\n第一段。\n' }, { ...NO_CLI, CN_BUNDLED_OPENCODE: OPENCODE! })
  const { page } = run
  try {
    await page.keyboard.press('Meta+j')
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    const card = ai.getByTestId('ai-setup')
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('用 canvas 的 note_write 工具在「甲.md」末尾加一段，正文只写「来自 Claude API 的一行」。做完只回答「好了」。')
    await box.press('Enter')
    await card.getByTestId('setup-key').click()
    await card.getByTestId('setup-next').click()
    await card.getByTestId('setup-key-input').fill(KEY!)
    await card.getByTestId('setup-verify').click()
    await expect(card.getByTestId('setup-done')).toContainText('Claude API · Sonnet 5.5', { timeout: 30_000 })
    await card.getByTestId('setup-start').click()
    // 接着发：用户那句出现，AI 动手改了甲.md，提交成一次「AI：…」
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toContainText('好了', { timeout: 200_000 })
    await expect.poll(() => readFileSync(join(run.vault, '甲.md'), 'utf8'), { timeout: 20_000 }).toContain('来自 Claude API 的一行')
    // 这一轮答完再提交（字先流出来，提交在后）
    await expect.poll(() => execFileSync('git', ['-C', run.vault, 'log', '--format=%s', '-3'], { encoding: 'utf8' }), { timeout: 30_000 }).toMatch(/^AI：/m)
    await expect(ai.getByTestId('ai-msg').last()).toContainText('改了1个文件')
    await shot(page, '11-real-opencode', ai)
    // 用的是软件自己那一份 OpenCode 设置目录，不碰用户自己装的 OpenCode
    expect(existsSync(join(run.userData, 'ai/opencode/data'))).toBe(true)
  } finally {
    await run.close()
  }
})
