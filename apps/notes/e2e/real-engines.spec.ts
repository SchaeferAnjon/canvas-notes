// 用本机真的命令行验 task-m55m7（模型从命令行拉、读版本、自查；选 Claude Code · Sonnet · Low 真问一句看回答头上）。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 [CN_SHOTS=<目录>] npx playwright test e2e/real-engines.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量，像从访达打开的软件一样）。
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；不点「更新」（不升级本机的命令行）。新版本从 npm、Claude Code 的发布地址读（只读）。
// 跑完只删这次产生的 Claude 会话记录（~/.claude/projects 下按临时库路径起名的那个文件夹）。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const SHOTS = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })
const item = (page: Page, menu: string, name: string) => page.getByRole('menu', { name: menu, exact: true }).getByRole('menuitemradio').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) })

async function shot(run: Running, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `real-${name}-${DARK ? 'dark' : 'light'}.png`), Buffer.from(b64, 'base64'))
}

/** 这次在 ~/.claude 下留的会话记录：projects 下按临时库路径起名的文件夹，和这几个会话按会话号起名的 */
function forgetSessions(run: Running) {
  const claude = join(homedir(), '.claude')
  const projects = join(claude, 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  const mine = readdirSync(projects).filter((d) => d.includes(stamp))
  const ids = mine.flatMap((d) => readdirSync(join(projects, d)).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)))
  for (const d of mine) rmSync(join(projects, d), { recursive: true, force: true })
  for (const sub of ['session-env', 'file-history', 'todos', 'tasks']) {
    const dir = join(claude, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (ids.some((id) => f.startsWith(id))) rmSync(join(dir, f), { recursive: true, force: true })
  }
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.join('、') || '无'}）`)
}

test('真命令行：Claude Code、Codex 拉模型、读版本、自查；选 Claude Code · Sonnet · Low 问一句，回答头上用拉到的模型名', async () => {
  const look = (vault: string) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
  }
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' }, { CN_ENGINE_WATCH: '1', CN_NPM_REGISTRY: 'https://registry.npmjs.org', CN_CLAUDE_DIST: 'https://downloads.claude.ai/claude-code-releases' }, look)
  const { page, app } = run
  const info = () => page.evaluate(async () => (await window.cn.aiEngines()).engines)
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    // 后台拉：Claude Code、Codex 都拉到了，版本读到了，自查完了
    const t = Date.now()
    await expect.poll(async () => (await info()).filter((e) => (e.id === 'claude' || e.id === 'codex') && e.pulledCount && e.health).length, { timeout: 120_000 }).toBe(2)
    console.log(`后台拉模型、读版本、自查用了 ${((Date.now() - t) / 1000).toFixed(1)} 秒`)
    for (const e of await info()) {
      console.log(`${e.label}：${e.path ?? '没找到'} · 版本 ${e.version ?? '—'} · 自查 ${e.health ? `${e.health.state}${e.health.problems.length ? ` ${JSON.stringify(e.health.problems)}` : ''}${e.health.note ? `（${e.health.note}）` : ''}` : '—'} · 模型 ${e.pulledCount ?? 0} 个（${e.pulled ?? ''}）· 新版本 ${e.latest ?? e.latestNote ?? '没有'}`)
      console.log(`  模型：${e.models.map((m) => `${m.label}=${m.id || '默认'}${m.efforts.length ? `[${m.efforts.map((x) => x.id).join(',')}]` : ''}`).slice(0, 20).join('；')}${e.models.length > 20 ? ` …共 ${e.models.length} 个` : ''}`)
    }
    const claude = (await info()).find((e) => e.id === 'claude')!
    expect(claude.version).toMatch(/^\d+\.\d+\.\d+/)
    const sonnet = claude.models.find((m) => m.id === 'sonnet')!
    expect(sonnet.label).toMatch(/^Sonnet \d/)

    // 设置 › AI：各家命令行那一组
    await page.keyboard.press('Meta+,')
    await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const group = dialog(page).getByRole('group', { name: '各家命令行' })
    await group.scrollIntoViewIfNeeded()
    await expect(group.locator('[data-row="cliClaude"] .sa-ds')).toContainText(`${claude.version} · 能用`)
    await shot(run, '设置AI-各家命令行')
    await dialog(page).getByTestId('ai-default-pick').click()
    await shot(run, '设置AI-默认-家')
    await page.keyboard.press('Escape')
    await dialog(page).getByTestId('ai-default-pick-model').click()
    await shot(run, '设置AI-默认-模型')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')

    // AI 对话：Claude Code → 拉到的 Sonnet → Low，问一句
    await openNote(page, '随手记')
    await openAi(page)
    await chat(page).getByTestId('ai-model').click()
    await expect(page.getByRole('menu', { name: '模型' })).toContainText('刚拉的')
    await shot(run, '输入框-模型')
    await item(page, '模型', sonnet.label).click()
    await chat(page).getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(chat(page).getByTestId('ai-model')).toHaveText(sonnet.label)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('只回一个字：好')
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    console.log(`回答：${await msg.locator('.txt').textContent()} · 头上：${await msg.locator('.read').textContent()}`)
    await expect(msg.locator('.read')).toHaveText(`Claude Code · ${sonnet.label} · Low`)
    await expect(msg.locator('.txt')).not.toBeEmpty()
    await shot(run, '输入框-回答头上')
  } finally {
    await run.close({ keep: true })
    forgetSessions(run)
    rmSync(dirname(run.vault), { recursive: true, force: true })
  }
})
