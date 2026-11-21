// 用本机真的 Claude Code 验 /写成文章 和 /整理当前白板（task-9womr）：草稿真落在白板所在的文件夹、提交说明是命令名和白板名；
// /整理收件箱 和梦游同一套归法：剪藏进剪藏/<主题>、周记草稿进周记（或写作）、课程笔记进课程/机器学习。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-ai-cmds.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量）。测试模式、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。
// 跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openInboxTab, tabOn, type Running } from './app'
import { ICELAND } from './fixtures/board'
import { TIDY_EXPECT, TIDY_VAULT } from './fixtures/inbox'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

async function openByName(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
  await page.locator('.pal-row', { has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first().click()
  await expect(tabOn(page)).toHaveText(name)
}

async function slash(page: Page, typed: string, name: string) {
  await chat(page).getByRole('textbox', { name: '问 AI' }).click()
  await page.keyboard.type('/' + typed)
  await chat(page).getByRole('listbox', { name: '命令' }).getByRole('option').filter({ has: page.locator('.n', { hasText: new RegExp(`^${name}$`) }) }).click()
}

async function lowEffort(page: Page) {
  await chat(page).getByTestId('ai-effort').click()
  await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
  await expect(chat(page).getByTestId('ai-effort')).toHaveText('Low')
}

/** 这次在 ~/.claude 下留的会话记录：projects 下按临时库路径起名的文件夹，和这几个会话号在 session-env、file-history、todos、tasks 下的 */
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

test('真 Claude Code：/写成文章 的草稿落在白板所在的文件夹，/整理当前白板 的提交说明是命令名和白板名', async () => {
  const run = await launch({ '课程/机器学习/冰岛自驾.md': ICELAND, '计划.md': ICELAND.replace('冰岛环岛前', '计划里') }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  try {
    await openByName(page, '冰岛自驾')
    await openAi(page)
    await lowEffort(page)

    // /写成文章：课程/机器学习 里的白板，草稿就在课程/机器学习
    let t = Date.now()
    await slash(page, '写成', '写成文章')
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.dprev .dmeta code')).toBeVisible({ timeout: 5 * 60_000 })
    const shown = await msg.locator('.dprev .dmeta code').innerText()
    console.log(`\n【/写成文章 · ${((Date.now() - t) / 1000).toFixed(0)} 秒】卡片上写：${shown}；改动块：${(await msg.getByTestId('ai-change').locator('.fr').allInnerTexts()).join(' | ')}`)
    console.log(`  提交说明：${git(vault, 'log', '-1', '--format=%s')}；改的文件：${git(vault, 'log', '-1', '--format=', '--name-only')}`)
    expect(shown).toBe('课程/机器学习/冰岛自驾：文章草稿.md')
    expect(readFileSync(join(vault, shown), 'utf8')).toMatch(/^---\ndraft: true\nfrom: "\[\[冰岛自驾\]\]"\n---\n# /)
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('AI：/写成文章 · 冰岛自驾')
    expect(git(vault, 'ls-files', '--', '冰岛自驾：文章草稿.md')).toBe('')
    await page.screenshot({ path: process.env.CN_SHOT_DIR ? join(process.env.CN_SHOT_DIR, 'real-写成文章.png') : test.info().outputPath('real-写成文章.png') })

    // 库最外层的白板：进收件箱
    await openByName(page, '计划')
    t = Date.now()
    await slash(page, '写成', '写成文章')
    const msg2 = chat(page).getByTestId('ai-msg').last()
    await expect(msg2.locator('.dprev .dmeta code')).toBeVisible({ timeout: 5 * 60_000 })
    const shown2 = await msg2.locator('.dprev .dmeta code').innerText()
    console.log(`\n【/写成文章（库最外层的白板）· ${((Date.now() - t) / 1000).toFixed(0)} 秒】卡片上写：${shown2}；提交说明：${git(vault, 'log', '-1', '--format=%s')}`)
    expect(shown2).toBe('收件箱/计划：文章草稿.md')

    // /整理当前白板：真 AI 用 board_* 工具动手，提交说明是「AI：/整理当前白板 · 冰岛自驾」
    await openByName(page, '冰岛自驾')
    t = Date.now()
    await slash(page, '整理当前', '整理当前白板')
    await expect(chat(page).getByRole('button', { name: '停下' })).toBeVisible()
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const m3 = chat(page).getByTestId('ai-msg').last()
    const steps = await m3.getByTestId('ai-step').allInnerTexts()
    console.log(`\n【/整理当前白板 · ${((Date.now() - t) / 1000).toFixed(0)} 秒】步骤：${steps.join(' / ')}\n  回答：${((await m3.locator('.txt').textContent()) ?? '').replace(/\n+/g, ' ⏎ ')}`)
    console.log(`  提交说明：${git(vault, 'log', '-1', '--format=%s')}；改的文件：${git(vault, 'log', '-1', '--format=', '--name-only')}`)
    await expect(m3.getByTestId('ai-change').locator('.hd')).toContainText('改了1个文件')
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('AI：/整理当前白板 · 冰岛自驾')
    await page.screenshot({ path: process.env.CN_SHOT_DIR ? join(process.env.CN_SHOT_DIR, 'real-整理当前白板.png') : test.info().outputPath('real-整理当前白板.png') })
    console.log(`\n历史（新的在前）：\n${git(vault, 'log', '--format=%h %s')}`)
  } finally {
    await run.close()
    forgetSessions(run)
  }
})

test('真 Claude Code：/整理收件箱 和梦游同一套归法，剪藏、周记草稿、课程笔记各去各的地方，点同意一次挪好，撤回回来', async () => {
  const run = await launch(TIDY_VAULT, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  try {
    await openInboxTab(page)
    await openAi(page)
    await lowEffort(page)
    const t = Date.now()
    await slash(page, '整理收', '整理收件箱')
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg.locator('.mv').first()).toBeVisible({ timeout: 5 * 60_000 })
    const rows = await msg.locator('.mv').evaluateAll((els) => els.map((e) => [e.querySelector('.truncate')!.textContent!, e.querySelector('.to')!.textContent!.replace(/^→ /, '')] as const))
    console.log(`\n【/整理收件箱 · ${((Date.now() - t) / 1000).toFixed(0)} 秒】${((await msg.locator('.txt').textContent()) ?? '').replace(/\n+/g, ' ⏎ ')}`)
    for (const [name, to] of rows) console.log(`  ${name} → ${to}`)
    await page.screenshot({ path: process.env.CN_SHOT_DIR ? join(process.env.CN_SHOT_DIR, 'real-整理收件箱.png') : test.info().outputPath('real-整理收件箱.png') })
    const got = Object.fromEntries(rows)
    for (const [name, re] of Object.entries(TIDY_EXPECT)) expect(got[name], name).toMatch(re)
    await msg.getByRole('button', { name: '同意，挪过去' }).click()
    await expect(msg).toContainText(`挪好了${rows.length}条`)
    console.log(`  提交说明：${git(vault, 'log', '-1', '--format=%s')}\n  改的文件：${git(vault, '-c', 'core.quotepath=false', 'show', '--name-status', '-M', '--format=', 'HEAD').replace(/\n/g, ' | ')}`)
    expect(git(vault, 'log', '-1', '--format=%s')).toBe(`AI：/整理收件箱 · ${rows.length}条`)
    for (const [name, to] of rows) expect(existsSync(join(vault, to, `${name}.md`))).toBe(true)
    await msg.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change')).toContainText('已撤回')
    for (const name of Object.keys(TIDY_EXPECT)) expect(existsSync(join(vault, '收件箱', `${name}.md`))).toBe(true)
  } finally {
    await run.close()
    forgetSessions(run)
  }
})
