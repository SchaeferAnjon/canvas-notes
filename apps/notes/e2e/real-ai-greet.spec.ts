// 用本机真的 Claude Code 点一遍底部快捷命令（task-0tgz2）：文档的「翻译」；左栏多选 3 篇「问AI」→「合成一篇」，真建一篇、一次提交、能撤回。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-ai-greet.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量）。测试模式、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。
// 跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, leftView, openNote, type Running } from './app'
import { pickQuick } from './ai-quick'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

/** 这次在 ~/.claude 下留的会话记录（同 real-ai-cmds.spec.ts）：只删按这次临时库路径起名的 */
function forgetSessions(run: Running) {
  const claude = join(homedir(), '.claude')
  const projects = join(claude, 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  const mine = existsSync(projects) ? readdirSync(projects).filter((d) => d.includes(stamp)) : []
  const ids = mine.flatMap((d) => readdirSync(join(projects, d)).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)))
  for (const d of mine) rmSync(join(projects, d), { recursive: true, force: true })
  for (const sub of ['session-env', 'file-history', 'todos', 'tasks']) {
    const dir = join(claude, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (ids.some((id) => f.startsWith(id))) rmSync(join(dir, f), { recursive: true, force: true })
  }
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.join('、') || '无'}）`)
}

const files = {
  '随手记.md': '# 随手记\n\nSeek wealth, not money or status.\n',
  '冰岛-机票.md': '# 冰岛-机票\n\n机票订好了：12 月 3 日去，12 月 12 日回。\n',
  '冰岛-住宿.md': '# 冰岛-住宿\n\n雷克雅未克住两晚，维克住一晚，还差阿克雷里。\n',
  '冰岛-路线.md': '# 冰岛-路线\n\n顺时针环岛，先走南岸，看冰河湖。\n',
}

test('真 Claude Code：文档的空对话点「翻译」，回答是译文', async () => {
  const run = await launch(files, { CN_AI_MODEL: 'sonnet' })
  const { page } = run
  try {
    await openNote(page, '随手记')
    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    await expect(ai.getByTestId('ai-greet').locator('p')).toHaveText('要对《随手记》做点什么？')
    await pickQuick(ai, '翻译')
    await expect(ai.locator('.um').last()).toHaveText('/翻译')
    const a = ai.getByTestId('ai-msg').last()
    await expect(a.locator('.txt')).toContainText(/财富|钱|地位/, { timeout: 180_000 })
    await expect(ai.getByTestId('ai-greet')).toHaveCount(0)
    console.log('翻译：', await a.locator('.txt').textContent())
  } finally {
    forgetSessions(run)
    await run.close()
  }
})

test('真 Claude Code：左栏多选 3 篇「问AI」→「合成一篇」，真建一篇新笔记、一次提交，撤回能拿掉', async () => {
  const run = await launch(files, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  try {
    await leftView(page, '文件')
    const tree = page.locator('aside.side').getByRole('tree')
    const row = (n: string) => tree.getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${n}$`) }) })
    await row('冰岛-机票').click()
    // ⌘ 点从空开始，正在看的那篇不算进选中（task-cqia6）：三篇都 ⌘ 点
    await row('冰岛-机票').click({ modifiers: ['Meta'] })
    await row('冰岛-住宿').click({ modifiers: ['Meta'] })
    await row('冰岛-路线').click({ modifiers: ['Meta'] })
    await page.locator('aside.side').getByRole('toolbar', { name: '选中的' }).getByRole('button', { name: '问AI' }).click()
    const ai = chat(page)
    await expect(ai.getByTestId('ai-picked')).toHaveText('选中的3个')
    // effort 选 Low（便宜）
    await ai.getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(ai.getByTestId('ai-effort')).toHaveText('Low')
    const before = git(vault, 'rev-parse', 'HEAD')
    await pickQuick(ai, '合成一篇')
    await expect(ai.locator('.um').last()).toHaveText('把选中的这几篇合成一篇新笔记')
    const a = ai.getByTestId('ai-msg').last()
    await expect(a.getByTestId('ai-change')).toBeVisible({ timeout: 300_000 })
    const added = git(vault, 'diff', '--name-status', before, 'HEAD').split('\n').filter((l) => l.startsWith('A\t')).map((l) => l.slice(2))
    console.log('回答：', await a.locator('.txt').textContent())
    console.log('新建的：', added, '提交：', git(vault, 'log', '-1', '--format=%s'))
    expect(added.length).toBeGreaterThanOrEqual(1)
    const made = added.find((p) => p.endsWith('.md'))!
    const body = readFileSync(join(vault, made), 'utf8')
    for (const w of ['12 月 3 日', '阿克雷里', '冰河湖']) expect(body.replace(/\s/g, '')).toContain(w.replace(/\s/g, ''))
    // 撤回：新建的那篇没了
    await a.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, made))).toBe(false)
  } finally {
    forgetSessions(run)
    await run.close()
  }
})
