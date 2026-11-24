// task-m55m7 的交付截图（只在给了 CN_SHOTS=<目录> 时跑；CN_SHOT_TONE=dark 截深色：天青 / 深湖）。
// 用假的命令行摆出几种样子：Claude Code 9.9.0 有一个参数不认了、Codex 有新版本、Gemini 没装、OpenCode 能用；每张都是真点出来的。
import { expect, test, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running } from './app'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
test.setTimeout(180_000)

const FAKE = join(__dirname, '../../../packages/ai-engines/test/fixtures/fake-cli.mjs')
const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const item = (page: Page, menu: string, name: string) => page.getByRole('menu', { name: menu, exact: true }).getByRole('menuitemradio').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) })

/** 交付页「在哪」标注图要的框（窗口里的 CSS 像素）：图名 → [编号, 框] */
const boxes: Record<string, [string, { x: number; y: number; width: number; height: number } | null][]> = {}
async function mark(page: Page, shotName: string, label: string, sel: string) {
  ;(boxes[shotName] ??= []).push([label, await page.locator(sel).first().boundingBox()])
}

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${DARK ? 'dark' : 'light'}.png`), Buffer.from(b64, 'base64'))
}

test('截图：设置 › AI 的选择器和各家命令行、AI 输入框底下的三颗', async () => {
  mkdirSync(DIR!, { recursive: true })
  const home = mkdtempSync(join(tmpdir(), 'cn-e2e-home-'))
  const state = join(home, 'fake-state')
  mkdirSync(state)
  const put = (name: string, st: object) => {
    const p = join(home, '.local/bin', name)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${FAKE}" ${name} "$@"\n`)
    chmodSync(p, 0o755)
    writeFileSync(join(state, `${name}.json`), JSON.stringify(st))
  }
  put('claude', { version: '9.9.0', unknown: ['--mcp-config'] })
  put('codex', { models: ['GPT-7 Nova', 'GPT-7.1 Comet', 'GPT-6.5 Luna'].map((n, i) => ({ id: n.toLowerCase().replace(/ /g, '-'), model: n.toLowerCase().replace(/ /g, '-'), displayName: n, isDefault: i === 0, defaultReasoningEffort: 'medium', efforts: ['low', 'medium', 'high'] })) })
  put('opencode', { models: [{ id: 'glm-5', providerID: 'zai', name: 'GLM-5', variants: { low: {}, high: {} } }, { id: 'big-pickle', providerID: 'opencode', name: 'Big Pickle', variants: {} }] })
  // 发布的最新：Claude Code 就是装着的 9.9.0（没有更新）、Codex 有 0.170.0、OpenCode 就是装着的
  const latest: Record<string, string> = { '@anthropic-ai/claude-code': '9.9.0', '@openai/codex': '0.170.0', 'opencode-ai': '1.19.3' }
  const server = createServer((req, res) => {
    const v = latest[decodeURIComponent((req.url ?? '').replace(/^\//, '').replace(/\/latest$/, ''))]
    res.statusCode = v ? 200 : 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(v ? { version: v } : {}))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const look = (vault: string) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
  }
  const run = await launch(
    { '随手记.md': '# 随手记\n\n一段字。\n' },
    { HOME: home, ZDOTDIR: home, SHELL: '/bin/zsh', PATH: '/usr/bin:/bin', CN_REAL_FIND: '1', CN_CLI_HOME_ONLY: '1', CN_ENGINE_WATCH: '1', FAKE_CLI_STATE: state, CN_NPM_REGISTRY: `http://127.0.0.1:${(server.address() as AddressInfo).port}` },
    look,
  )
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    await expect.poll(async () => (await page.evaluate(() => window.cn.aiEngines())).engines.find((e) => e.id === 'claude')?.health?.state, { timeout: 20_000 }).toBe('bad')
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    await expect(dialog(page).getByTestId('ai-default')).toBeVisible()
    // 小活单独指定 Claude Code · Haiku 9 · Low，翻译只用 Codex：几种样子都露出来
    await dialog(page).getByTestId('ai-pick-quick-effort').click()
    await item(page, '想多久（effort）', 'Low').click()
    await mark(page, '1-设置AI', '1', '[data-testid="ai-default"] .aipk')
    await mark(page, '1-设置AI', '2', '[role="group"][aria-label="各功能用哪个"]')
    await shot(run, '1-设置AI')
    await dialog(page).getByTestId('ai-default-pick').click()
    await shot(run, '2-设置AI-默认-家')
    await page.keyboard.press('Escape')
    await dialog(page).getByTestId('ai-pick-chat').click()
    await item(page, 'AI对话用哪一家', 'Claude Code').click()
    await dialog(page).getByTestId('ai-pick-chat-model').click()
    await shot(run, '3-设置AI-AI对话-模型')
    await item(page, '模型', 'Sonnet 9').click()
    await dialog(page).getByTestId('ai-pick-chat-effort').click()
    await shot(run, '4-设置AI-AI对话-想多久')
    await item(page, '想多久（effort）', 'Low').click()
    await dialog(page).getByRole('group', { name: '各家命令行' }).scrollIntoViewIfNeeded()
    await mark(page, '5-设置AI-各家命令行', '3', '[role="group"][aria-label="各家命令行"]')
    await shot(run, '5-设置AI-各家命令行')
    await page.keyboard.press('Escape')

    await openNote(page, '随手记')
    await openAi(page)
    await chat(page).getByTestId('ai-engine').click()
    await shot(run, '6-输入框-谁来答')
    await page.keyboard.press('Escape')
    await chat(page).getByTestId('ai-model').click()
    await shot(run, '7-输入框-模型')
    await page.keyboard.press('Escape')
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('你好')
    await box.press('Enter')
    await expect(chat(page).getByTestId('ai-error')).toBeVisible({ timeout: 20_000 })
    await mark(page, '8-输入框-不兼容', '4', '[data-testid="ai-error"]')
    await mark(page, '8-输入框-不兼容', '5', '.aiin .ft')
    await shot(run, '8-输入框-不兼容')
    writeFileSync(join(DIR!, `boxes-${DARK ? 'dark' : 'light'}.json`), JSON.stringify(boxes, null, 1))
    await chat(page).getByTestId('ai-error').getByRole('button', { name: '换一家' }).click()
    await shot(run, '9-输入框-换一家')
  } finally {
    await run.close()
    server.close()
    rmSync(home, { recursive: true, force: true })
  }
})
