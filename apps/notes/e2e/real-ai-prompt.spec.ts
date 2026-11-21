// 真的 Claude Code：设置 › AI「给AI的长期说明」真的带进了一问（设置方向 A 第一批新加，task-f7rib）。在本机跑：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-ai-prompt.spec.ts
// （去掉父会话的 CLAUDE_* 环境变量，像从访达打开的软件一样）。测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。
// 跑完只删这次产生的 Claude 会话记录（~/.claude/projects 下按临时库路径起名的那个文件夹）。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(240_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

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

test('真 Claude Code：长期说明里要它每次回答都以「收到长期说明」开头，问一句随便的话，回答真的这样开头', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' }, { CN_AI_MODEL: 'sonnet' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+,')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: 'AI', exact: true }).click()
    const box = dlg.getByRole('textbox', { name: '给AI的长期说明' })
    await box.fill('每次回答的第一行都只写「收到长期说明」这六个字，第二行起再正常回答。')
    await dlg.getByTestId('settings-head').click()
    await expect(dlg.getByTestId('settings-toast')).toContainText('已存 · 给AI的长期说明')
    await page.keyboard.press('Escape')
    await openAi(page)
    await chat(page).getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
    const input = chat(page).getByRole('textbox', { name: '问 AI' })
    await input.fill('一加一等于几？')
    await input.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 200_000 })
    const answer = (await chat(page).getByTestId('ai-msg').last().innerText()).trim()
    console.log('回答：', answer)
    expect(answer).toContain('收到长期说明')
    expect(answer).toMatch(/2|二/)
  } finally {
    await run.close()
    forgetSessions(run)
  }
})
