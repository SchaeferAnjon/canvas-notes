// 真的 Claude Code：AI 回答用什么语言（task-zojmg，用户定：默认跟界面语言，用别的语言问就跟着问的语言答）。在本机跑：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CLAUDE_CODE_OAUTH_TOKEN="$DISPATCH_E2E_CLAUDE_TOKEN" CN_REAL_AI=1 npx playwright test e2e/real-zojmg-lang.spec.ts
// （去掉父会话的 CLAUDE_* 环境变量，像从访达打开的软件一样；登录用测试实例专用的订阅令牌）。测试模式（窗口不上屏幕）、临时库、临时设置目录；
// CN_AI_MODEL=sonnet，effort 选 Low。那个账号额度用完时加 CN_REAL_ENGINE=codex 用 Codex 验同一条规矩。
// 用一个看不出语言的问题（「123」）看默认用哪种语言答，再用另一种语言问一句。
// 跑完只删这次产生的 Claude 会话记录（~/.claude/projects 下按临时库路径起名的那个文件夹）；用 Codex 时删 ~/.codex/sessions 里带临时库路径的那几份。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(300_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const HAN = /\p{Script=Han}/u

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

async function ask(page: Page, q: string): Promise<string> {
  const msgs = chat(page).getByTestId('ai-msg')
  const before = await msgs.count()
  const input = chat(page).getByRole('textbox', { name: '问 AI' })
  await input.fill(q)
  await input.press('Enter')
  // 等这一问的回答出来、答完（发送键回来）：回答那一块头一行是「Claude Code · 模型 · 档」，后面才是字
  const body = async () => {
    if ((await msgs.count()) <= before) return ''
    return (await msgs.last().innerText()).trim().split('\n').slice(1).join('\n').trim()
  }
  await expect.poll(body, { timeout: 200_000 }).not.toBe('')
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 200_000 })
  const answer = await body()
  console.log(`问：${q}\n答：${answer}`)
  return answer
}

/** 默认用 Claude Code（Sonnet · Low）；CN_REAL_ENGINE=codex 时换成 Codex（Claude 的测试额度用完时用它验同一条规矩） */
async function lowEffort(page: Page) {
  await openAi(page)
  if (process.env.CN_REAL_ENGINE === 'codex') {
    await chat(page).getByTestId('ai-engine').click()
    await page
      .getByRole('menu', { name: 'AI 引擎', exact: true })
      .getByRole('menuitemradio')
      .filter({ has: page.locator('.nm', { hasText: /^Codex$/ }) })
      .click()
    await expect(chat(page).getByTestId('ai-engine')).toHaveText('Codex')
    return
  }
  await chat(page).getByTestId('ai-effort').click()
  await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
}

test('英文界面：默认用英文答；用中文问就用中文答', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' }, { CN_AI_MODEL: 'sonnet', CN_LANG: 'en' })
  const { page } = run
  try {
    await lowEffort(page)
    // 不说用什么语言、句子里也没有能认语言的词：照界面语言答
    // 打个招呼（看不出是哪种语言）：照界面语言答
    const a1 = await ask(page, '123')
    expect(a1).toMatch(/[A-Za-z]{3}/)
    expect(a1).not.toMatch(HAN)
    const a2 = await ask(page, '二加三等于几？一句话回答。')
    expect(a2).toMatch(HAN)
  } finally {
    await run.close()
    forgetSessions(run)
  }
})

test('中文界面：默认用中文答；用英文问就用英文答', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' }, { CN_AI_MODEL: 'sonnet' })
  const { page } = run
  try {
    await lowEffort(page)
    const a1 = await ask(page, '123')
    expect(a1).toMatch(HAN)
    const a2 = await ask(page, 'What is two plus three? Answer in one short sentence.')
    expect(a2).toMatch(/5|five/i)
    expect(a2).not.toMatch(HAN)
  } finally {
    await run.close()
    forgetSessions(run)
  }
})
