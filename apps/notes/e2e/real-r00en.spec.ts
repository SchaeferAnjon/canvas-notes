// 用本机真的 Claude Code 验 task-r00en 第 7 件：真回答下面那排的 ⋯ →「存进收件箱」，收件箱里多一篇、字就是这条回答。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-r00en.spec.ts
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet、Low。跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(6 * 60_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

function lowDefault(vault: string) {
  const dir = join(dirname(vault), 'user-data', 'ai')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ engine: 'claude', prefs: { default: { engine: 'claude', model: 'sonnet', effort: 'low' }, features: {} } }))
}

/** 这次在 ~/.claude 下留的会话记录：projects 下按临时库路径起名的那个文件夹整个删掉，和这几个会话的附带记录（同 real-83vl3） */
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

test('真 AI：回答下面那排 ⋯ →「存进收件箱」，收件箱一篇就是这条回答', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_MODEL: 'sonnet' }, lowDefault)
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('不要用工具，用两句中文说说什么是近似计算。')
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg).not.toHaveAttribute('aria-busy')
    console.log('这一条：', await msg.innerText())
    await page.screenshot({ path: test.info().outputPath('real-answer.png') })
    const answer = (await msg.locator('.txt').innerText()).trim()
    console.log('回答：', answer)
    expect(answer.length).toBeGreaterThan(10)
    const row = msg.getByTestId('ai-ans-acts')
    await row.getByRole('button', { name: '这条回答还能做什么' }).click()
    const menu = page.getByRole('menu', { name: '这条回答还能做什么' })
    await menu.getByRole('menuitem', { name: '存进收件箱' }).click()
    await expect(page.getByTestId('toast')).toContainText('存进了收件箱')
    const inbox = () => (existsSync(join(vault, '收件箱')) ? readdirSync(join(vault, '收件箱')).filter((f) => f.endsWith('.md')) : [])
    await expect.poll(inbox).toHaveLength(1)
    const saved = readFileSync(join(vault, '收件箱', inbox()[0]!), 'utf8')
    console.log('收件箱那篇：', saved)
    // 回答的头一句原样在里面（渲染出来的字和 md 原文比，去掉 md 记号）
    expect(saved.replace(/[*_`#>]/g, '')).toContain(answer.split('\n')[0]!.slice(0, 12))
  } finally {
    forgetSessions(run)
    await run.close()
  }
})
