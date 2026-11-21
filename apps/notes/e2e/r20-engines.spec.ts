// 选 AI 先选家再选模型、模型列表自动拉、命令行更新后自查兼容（task-m55m7，用户 r20「这里同一家没必要都列出来」）。
// 设置 › AI 的默认和五个功能、AI 输入框底下用同一个选择器：先选家（同一家只列一次），再选这一家的模型，再选想多久。
// 后两条用假的命令行（test/fixtures/fake-cli.mjs，放在临时家目录的 ~/.local/bin，只在家目录里找）：
// 假的会报版本、模型、不认某个参数、跑「更新」，测试中途改它的状态文件就是「命令行换了」。不碰这台 Mac 上真的 AI，不联网。
import { expect, test, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote } from './app'

const files = { '随手记.md': '# 随手记\n\n一段字。\n' }
const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
/** 设置 › AI「各家命令行」那一组的一行（设置方向 A：data-row 是 cliClaude、cliCodex…） */
const cli = (page: Page, id: string) => dialog(page).getByRole('group', { name: '各家命令行' }).locator(`[data-row="cli${id.charAt(0).toUpperCase()}${id.slice(1)}"]`)
const menu = (page: Page, name: string) => page.getByRole('menu', { name, exact: true })
/** 菜单里名字正好是 name 的那一项（右边的小字不算） */
const item = (page: Page, menuName: string, name: string | RegExp) => menu(page, menuName).getByRole('menuitemradio').filter({ has: page.locator('.nm', { hasText: typeof name === 'string' ? new RegExp(`^${name}$`) : name }) })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

async function openAiSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
  await expect(dialog(page).getByTestId('ai-default')).toBeVisible()
}

/** 一行里点 家 → 模型 → 想多久（testid 是这一行家那一段的，模型、想多久那两段加 -model、-effort） */
async function choose(page: Page, testid: string, menuName: string, family: string, model?: string, effort?: string) {
  await dialog(page).getByTestId(testid).click()
  await item(page, menuName, family).click()
  await expect(menu(page, menuName)).toHaveCount(0)
  if (model) {
    await dialog(page).getByTestId(`${testid}-model`).click()
    await item(page, '模型', model).click()
  }
  if (effort) {
    await dialog(page).getByTestId(`${testid}-effort`).click()
    await item(page, '想多久（effort）', effort).click()
  }
}

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  return chat(page).getByTestId('ai-msg').last()
}

test('设置 › AI：默认和五个功能都是先选家、再选模型、再选想多久，同一家只列一次；AI 对话选 Claude Code · Sonnet · Low 后输入框底下跟着变，问一句回答头上写着', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openAiSettings(page)
    // 默认那一行：家这一列四家各一行，Claude Code 不再按模型列三遍
    await dialog(page).getByTestId('ai-default-pick').click()
    await expect(menu(page, '默认用哪一家').getByRole('menuitemradio').locator('.nm')).toHaveText(['Claude Code', 'Codex', 'Gemini', 'OpenCode'])
    // 设置的内容区滚一下：菜单跟着按钮走，不收（以前一滚就收，接着按 esc 关掉了整个设置）
    await page.locator('.set-body').evaluate((el) => (el.scrollTop += 30))
    await expect(menu(page, '默认用哪一家')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu(page, '默认用哪一家')).toHaveCount(0)
    await expect(dialog(page)).toBeVisible()
    // 默认那一行的另两段：模型、想多久
    await expect(dialog(page).getByTestId('ai-default-pick-model')).toHaveText('Opus 5.5')
    // 默认没选过档：写「默认档」（AI 对话里是 High，梦游这些用命令行自己的）
    await expect(dialog(page).getByTestId('ai-default-pick-effort')).toHaveText('默认档')

    // AI 对话：第一项还是「跟默认」，选 Claude Code → Sonnet → Low
    await dialog(page).getByTestId('ai-pick-chat').click()
    await expect(menu(page, 'AI对话用哪一家').getByRole('menuitemradio').first()).toContainText('跟默认')
    await expect(menu(page, 'AI对话用哪一家').getByRole('menuitemradio').filter({ hasText: 'Claude Code' })).toHaveCount(2) // 跟默认（Claude Code · Opus 5.5）和 Claude Code 本身
    await page.keyboard.press('Escape')
    await choose(page, 'ai-pick-chat', 'AI对话用哪一家', 'Claude Code', 'Sonnet', 'Low')
    await expect(dialog(page).getByTestId('ai-pick-chat')).toHaveText('Claude Code')
    await expect(dialog(page).getByTestId('ai-pick-chat-model')).toHaveText('Sonnet')
    await expect(dialog(page).getByTestId('ai-pick-chat-effort')).toHaveText('Low')

    // 别的几行同样：梦游 Codex · GPT-6-Luna · Medium；小活 Claude Code · Haiku · Low
    await choose(page, 'ai-pick-dream', '梦游用哪一家', 'Codex', 'GPT-6-Luna', 'Medium')
    await expect(dialog(page).getByTestId('ai-pick-dream-model')).toHaveText('GPT-6-Luna')
    await choose(page, 'ai-pick-quick', '小活用哪一家', 'Claude Code', 'Haiku', 'Low')
    // 看图问只有 Claude Code 能做：家这一列只有它（和跟默认）
    await dialog(page).getByTestId('ai-pick-vision').click()
    await expect(menu(page, '看图问用哪一家').getByRole('menuitemradio').locator('.nm')).toHaveText(['跟默认', 'Claude Code'])
    await page.keyboard.press('Escape')
    // 翻译：第一项「按顺序」保留，再是只用某一家；只用 Codex 时能选 Codex 的模型
    await dialog(page).getByTestId('ai-pick-translate').click()
    await expect(menu(page, '翻译用哪一家').getByRole('menuitemradio').first()).toContainText('按顺序')
    await item(page, '翻译用哪一家', '只用Codex').click()
    await dialog(page).getByTestId('ai-pick-translate-model').click()
    await item(page, '模型', 'GPT-6.1 Terra').click()
    await expect(dialog(page).getByTestId('ai-pick-translate-model')).toHaveText('GPT-6.1 Terra')

    const v = await page.evaluate(() => window.cn.aiPrefs())
    expect(v.prefs.features).toEqual({ chat: { engine: 'claude', model: 'sonnet', effort: 'low' }, dream: { engine: 'codex', model: 'gpt-6-luna', effort: 'medium' }, quick: { engine: 'claude', model: 'haiku', effort: 'low' } })
    const tr = await page.evaluate(async () => (await window.cnPlugins.list()).find((p) => p.id === 'translate')!.settings)
    expect(tr).toMatchObject({ engineMode: 'pick', pick: 'codex', pickModel: 'gpt-6.1-terra' })
    await page.keyboard.press('Escape')

    // 输入框底下跟着变：Claude Code · Sonnet · Low；问一句真的用它答，回答头上写着
    await openNote(page, '随手记')
    await openAi(page)
    await expect(chat(page).getByTestId('ai-engine')).toHaveText('Claude Code')
    await expect(chat(page).getByTestId('ai-model')).toHaveText('Sonnet')
    await expect(chat(page).getByTestId('ai-effort')).toHaveText('Low')
    const msg = await ask(page, '你用的什么模型')
    await expect(msg.locator('.txt')).toHaveText('模型：sonnet，effort：low（Claude Code）', { timeout: 15_000 })
    await expect(msg.locator('.read')).toHaveText('Claude Code · Sonnet · Low')

    // 默认换成 Codex · GPT-6.1 Terra：跟默认的那几行（看图问除外）当场写着
    await openAiSettings(page)
    await choose(page, 'ai-default-pick', '默认用哪一家', 'Codex', 'GPT-6.1 Terra')
    await expect(dialog(page).getByTestId('ai-default')).toContainText('Codex')
    await expect(dialog(page).getByTestId('ai-default-pick-model')).toHaveText('GPT-6.1 Terra')
    await choose(page, 'ai-pick-chat', 'AI对话用哪一家', '跟默认')
    await expect(dialog(page).getByTestId('ai-pick-chat')).toContainText('跟默认Codex · GPT-6.1 Terra')
    await expect(dialog(page).getByTestId('ai-pick-chat-model')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

/** 放一个能执行的小脚本 */
function script(p: string, body: string) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

const FAKE = join(__dirname, '../test/fixtures/fake-cli.mjs')

/** 临时家目录的 ~/.local/bin 里放假的命令行（状态写在 fake-state/<家>.json），只在家目录里找，后台拉模型、自查打开 */
function fakeHome(states: Record<string, object>) {
  const home = mkdtempSync(join(tmpdir(), 'cn-e2e-home-'))
  const dir = join(home, 'fake-state')
  mkdirSync(dir)
  for (const [name, st] of Object.entries(states)) {
    script(join(home, '.local/bin', name), `exec "${process.execPath}" "${FAKE}" ${name} "$@"`)
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(st))
  }
  const set = (name: string, patch: object) => writeFileSync(join(dir, `${name}.json`), JSON.stringify({ ...JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')), ...patch }))
  const log = (name: string) => {
    try {
      return readFileSync(join(dir, `${name}.log`), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as string[])
    } catch {
      return []
    }
  }
  const env = { HOME: home, ZDOTDIR: home, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', CN_REAL_FIND: '1', CN_CLI_HOME_ONLY: '1', CN_ENGINE_WATCH: '1', FAKE_CLI_STATE: dir }
  return { home, dir, env, set, log, done: () => rmSync(home, { recursive: true, force: true }) }
}

const codexModel = (model: string, displayName: string, isDefault = false) => ({ id: model, model, displayName, isDefault, defaultReasoningEffort: 'medium', efforts: ['low', 'medium', 'high'] })

test('模型列表从命令行自动拉：假 Claude Code 报的模型名进菜单和回答头上；假 Codex 换了列表，点「检查更新」后输入框底下出新模型；菜单底下写「刚拉的」', async () => {
  const fake = fakeHome({ claude: {}, codex: { models: [codexModel('gpt-7-nova', 'GPT-7 Nova', true)] } })
  const run = await launch(files, { CN_AI_FAKE: '1', ...fake.env })
  const { page } = run
  const labels = (id: string) => page.evaluate(async (i) => (await window.cn.aiEngines()).engines.find((e) => e.id === i)!.models.map((m) => m.label), id)
  try {
    // 启动后在后台拉：Claude Code 报的 Opus 9 / Sonnet 9 / Haiku 9 换掉自带的三个
    await expect.poll(() => labels('claude'), { timeout: 15_000 }).toEqual(['Opus 9', 'Sonnet 9', 'Haiku 9'])
    await expect.poll(() => labels('codex'), { timeout: 15_000 }).toEqual(['Codex 默认模型', 'GPT-7 Nova'])
    expect(fake.log('claude').some((a) => a.includes('--input-format') && a.includes('stream-json'))).toBe(true)

    await openNote(page, '随手记')
    await openAi(page)
    await chat(page).getByTestId('ai-model').click()
    // 选着的（设置里存的 claude-opus-5-5）不在这次拉到的里：放在第一行打勾，写「这次没拉到」
    await expect(menu(page, '模型').locator('.nm')).toHaveText(['Opus 5.5', 'Opus 9', 'Sonnet 9', 'Haiku 9'])
    await expect(menu(page, '模型').getByRole('menuitemradio').first()).toHaveAttribute('aria-checked', 'true')
    await expect(menu(page, '模型').getByRole('menuitemradio').first()).toContainText('这次没拉到')
    await expect(menu(page, '模型')).toContainText('刚拉的')
    await item(page, '模型', 'Sonnet 9').click()
    await chat(page).getByTestId('ai-effort').click()
    await item(page, '想多久（effort）', 'Low').click()
    const msg = await ask(page, '你用的什么模型')
    await expect(msg.locator('.txt')).toHaveText('模型：sonnet，effort：low（Claude Code）', { timeout: 15_000 })
    // 回答头上用拉到的模型名
    await expect(msg.locator('.read')).toHaveText('Claude Code · Sonnet 9 · Low')

    // 换成 Codex：模型菜单是它报的
    await chat(page).getByTestId('ai-engine').click()
    await item(page, 'AI 引擎', 'Codex').click()
    await chat(page).getByTestId('ai-model').click()
    await expect(menu(page, '模型').locator('.nm')).toHaveText(['Codex 默认模型', 'GPT-7 Nova'])
    await page.keyboard.press('Escape')

    // Codex 那边多了一个模型：设置 › AI 那一家的一行点「检查更新」，重新拉
    fake.set('codex', { models: [codexModel('gpt-7-nova', 'GPT-7 Nova', true), codexModel('gpt-7.1-comet', 'GPT-7.1 Comet')] })
    await openAiSettings(page)
    const codexRow = cli(page, 'codex')
    await expect(codexRow).toContainText('0.163.0 · 能用')
    // 量 DOM：五个选择器的框和默认那一个一样宽（300）、右边齐；「各家命令行」的按钮一样宽、右边也在这条线上（偏好「设置里下拉要对齐」）
    const rect = (sel: string) => dialog(page).locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) })))
    const boxes = await rect('.aipk')
    expect(boxes.length).toBe(6)
    for (const b of boxes) expect({ w: b.w, r: b.r }, JSON.stringify(boxes)).toEqual({ w: 300, r: boxes[0]!.r })
    const btns = await rect('.aipk-cli-btn')
    expect(btns.length).toBe(2)
    for (const b of btns) expect({ w: b.w, r: b.r }, JSON.stringify(btns)).toEqual({ w: btns[0]!.w, r: boxes[0]!.r })
    await codexRow.getByRole('button', { name: '检查更新' }).click()
    await expect(codexRow).toContainText('2个模型', { timeout: 15_000 })
    await page.keyboard.press('Escape')
    await chat(page).getByTestId('ai-model').click()
    await expect(menu(page, '模型').locator('.nm')).toHaveText(['Codex 默认模型', 'GPT-7 Nova', 'GPT-7.1 Comet'])
  } finally {
    await run.close()
    fake.done()
  }
})

/** 本机假的「最新版本」：npm 注册表那两个网址，版本从 latest 里拿 */
async function registry(latest: Record<string, string>): Promise<{ url: string; server: Server }> {
  const pkg: Record<string, string> = { '@anthropic-ai/claude-code': 'claude', '@openai/codex': 'codex' }
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '').replace(/^\//, '').replace(/\/latest$/, ''))
    const id = pkg[name]
    if (!id || !latest[id]) {
      res.statusCode = 404
      return res.end('{}')
    }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ name, version: latest[id] }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server }
}

test('假 Claude Code 更新到 9.9.0 后不认 --mcp-config：设置里那一行出警告，AI 对话发一问说清楚、给「换一家」，换成 Codex 照样答；「检查更新」→「更新到 9.9.1」跑它自己的更新，跑完自查变「能用」；更新失败照实说', async () => {
  const fake = fakeHome({
    claude: { version: '9.9.0', unknown: ['--mcp-config'], update: { to: '9.9.1', then: { unknown: [] } } },
    codex: { models: [codexModel('gpt-7-nova', 'GPT-7 Nova', true)], update: { fail: 'npm ERR! code EACCES：没有权限写 /usr/local/lib/node_modules' } },
  })
  // 一开始 Claude Code 发布的最新就是装着的 9.9.0（没有更新）；Codex 已经有 0.170.0
  const latest = { claude: '9.9.0', codex: '0.170.0' }
  const reg = await registry(latest)
  // 不用假 AI：AI 对话真的起假的 claude、codex（和用户机器上一样的接法）
  const run = await launch(files, { ...fake.env, CN_NPM_REGISTRY: reg.url })
  const { page } = run
  try {
    await openAiSettings(page)
    const claude = cli(page, 'claude')
    // 版本变了：后台自查一次，--mcp-config 不认了
    await expect(claude.locator('.sa-ds')).toHaveText('9.9.0 · 有一个参数不认了：--mcp-config，AI 对话可能出错', { timeout: 20_000 })
    await expect(cli(page, 'gemini').locator('.sa-ds')).toHaveText('没找到')
    await page.keyboard.press('Escape')

    // AI 对话：输入框底下谁来答那一颗带着提醒；发一问，说清楚是命令行不兼容，给「换一家」
    await openNote(page, '随手记')
    await openAi(page)
    await expect(chat(page).getByTestId('ai-engine')).toHaveAttribute('data-warn', /有一个参数不认了/)
    const msg = await ask(page, '你好')
    const err = msg.getByTestId('ai-error')
    await expect(err).toHaveAttribute('data-code', 'incompatible', { timeout: 20_000 })
    await expect(err).toContainText('Claude Code 9.9.0 有一个参数不认了：--mcp-config，这一问没答上')
    await err.getByRole('button', { name: '换一家' }).click()
    await expect(menu(page, 'AI 引擎')).toBeVisible()
    await item(page, 'AI 引擎', 'Codex').click()
    await expect(chat(page).getByTestId('ai-engine')).toHaveText('Codex')
    const again = await ask(page, '你好')
    await expect(again.locator('.txt')).toContainText('线程', { timeout: 20_000 })

    // 检查更新：这会儿还是最新；Claude Code 发了 9.9.1 以后再点，出「更新到 9.9.1」；点了跑 claude update，跑完重新自查，变「能用」
    await openAiSettings(page)
    await claude.getByRole('button', { name: '检查更新' }).click()
    await expect(claude.locator('.sa-ds')).toContainText('已是最新')
    latest.claude = '9.9.1'
    await claude.getByRole('button', { name: '检查更新' }).click()
    await expect(claude.getByRole('button', { name: '更新到 9.9.1' })).toBeVisible({ timeout: 15_000 })
    // 不兼容、又有新版：这一家的按钮是实心的「更新到 9.9.1」
    await expect(claude.getByRole('button', { name: '更新到 9.9.1' })).toHaveClass(/primary/)
    await claude.getByRole('button', { name: '更新到 9.9.1' }).click()
    await expect(claude.locator('.sa-ds')).toHaveText(/^9\.9\.1 · 能用/, { timeout: 30_000 })
    await expect(claude.locator('.sa-ds')).toContainText('刚从 9.9.0 更新到 9.9.1')
    expect(fake.log('claude').some((a) => a[0] === 'update')).toBe(true)
    // 9.9.1 不是核过的版本：自查时真问了一个字（假的，不花钱）
    expect(fake.log('claude').some((a) => a.includes('--system-prompt') && a[a.indexOf('--system-prompt') + 1] === '只回一个字。' && a[a.indexOf('--model') + 1] === 'haiku')).toBe(true)
    await page.keyboard.press('Escape')
    // 输入框底下换回 Claude Code：不再标红，问一句答得上
    await chat(page).getByTestId('ai-engine').click()
    await expect(item(page, 'AI 引擎', 'Claude Code')).toContainText('9.9.1')
    await expect(item(page, 'AI 引擎', 'Claude Code')).not.toContainText('不认')
    await item(page, 'AI 引擎', 'Claude Code').click()
    await expect(chat(page).getByTestId('ai-engine')).not.toHaveAttribute('data-warn', /./)
    const ok = await ask(page, '你好')
    await expect(ok.locator('.txt')).toContainText('这是假 Claude Code 9.9.1 的回答', { timeout: 20_000 })

    // Codex 有 0.170.0（后台看到的）：它能用，说明里写「有新版」，按钮是次按钮「更新」（实心黑的只给不兼容又有新版的那一家）；
    // 它自己的更新失败了：照实说原话，不假装好了
    await openAiSettings(page)
    const codexRow = cli(page, 'codex')
    await expect(codexRow.locator('.sa-ds')).toContainText('有新版 0.170.0')
    await expect(codexRow.getByRole('button', { name: '更新到 0.170.0' })).toHaveText('更新')
    await expect(codexRow.getByRole('button', { name: '更新到 0.170.0' })).not.toHaveClass(/primary/)
    await codexRow.getByRole('button', { name: '更新到 0.170.0' }).click()
    await expect(codexRow.locator('.sa-ds')).toContainText('没更新成：npm ERR! code EACCES', { timeout: 30_000 })
    expect(fake.log('codex').some((a) => a[0] === 'update')).toBe(true)
  } finally {
    await run.close()
    reg.server.close()
    fake.done()
  }
})
