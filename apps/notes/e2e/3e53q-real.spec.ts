// 用本机真的 Claude Code 验 AI 回答里的引用能点开（task-3e53q）：问它 SAGE 在库里哪篇笔记哪几行，看它写的链接软件认不认、点得开点不开。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/3e53q-real.spec.ts
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running, tabOn } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

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

test('真 Claude Code：回答里写的库里笔记链接是 a.cite，点一下预览卡认得出那篇，⌘点打开', async () => {
  const plan = ['# 小论文计划', '', '先读完这 5 篇。', '', '## 排第 1 篇', 'C72 BST-GATNet。', '', '## 排第 2 篇', 'SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠。', ''].join('\n')
  const run = await launch({ '课程/study project 2/小论文计划.md': plan, '收件箱/随手.md': '# 随手\n\n问问 AI。\n' }, { CN_AI_MODEL: 'sonnet' })
  const { page } = run
  try {
    await openNote(page, '随手')
    await openAi(page)
    await chat(page).getByTestId('ai-effort').first().click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
    const ta = chat(page).getByRole('textbox', { name: '问 AI' })
    await ta.fill('SAGE 在库里哪篇笔记的哪几行提到了？只回答一句话，把那篇笔记写成 Markdown 链接。')
    await ta.press('Enter')
    const msg = chat(page).getByTestId('ai-msg').last()
    // 答完：停下键没了、发送键回来
    await expect(chat(page).getByRole('button', { name: '停下' })).toBeVisible({ timeout: 60_000 })
    await expect(chat(page).getByRole('button', { name: '停下' })).toHaveCount(0, { timeout: 5 * 60_000 })
    console.log('回答：', (await msg.textContent())?.replace(/\n+/g, ' ⏎ '))
    if (await msg.getByText('看原话').count()) {
      await msg.getByText('看原话').click()
      console.log('原话：', (await chat(page).textContent())?.slice(-1500))
    }
    const links = msg.locator('a.cite')
    console.log('链接：', await links.evaluateAll((as) => as.map((a) => `${a.textContent} → ${(a as HTMLElement).dataset.href ?? '[[' + (a as HTMLElement).dataset.wiki + ']]'}`)))
    expect(await links.count()).toBeGreaterThan(0)
    await links.first().click()
    const card = page.getByRole('dialog', { name: '引用' })
    await expect(card).toBeVisible()
    console.log('预览卡：', (await card.textContent())?.replace(/\s+/g, ' '))
    await expect(card.locator('.top b')).toHaveText('小论文计划')
    await page.keyboard.press('Escape')
    await links.first().click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('小论文计划')
  } finally {
    await run.close()
    forgetSessions(run)
  }
})
