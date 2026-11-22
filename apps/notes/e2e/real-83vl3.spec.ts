// 用本机真的 Claude Code 验 task-83vl3：真回答里有长行内代码、宽表格、长代码块时整条回答不横着滑；回答下面那排拷贝、插进文档真能用。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-83vl3.spec.ts
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet、Low。跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running } from './app'
import { clipboardText } from './menu'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(6 * 60_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

function lowDefault(vault: string) {
  const dir = join(dirname(vault), 'user-data', 'ai')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ engine: 'claude', prefs: { default: { engine: 'claude', model: 'sonnet', effort: 'low' }, features: {} } }))
}

/** 这次在 ~/.claude 下留的会话记录：projects 下按临时库路径起名的那个文件夹整个删掉，和这几个会话的附带记录（同 real-ai-grow） */
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

test('真 AI：长行内代码、宽表、长代码块的回答不整条横滑；拷贝、插进文档真能用', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_MODEL: 'sonnet' }, lowDefault)
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill(
      '不要用工具，直接用 Markdown 回答，三样都要：1. 一句话里放这段行内代码 `torch.tensor(inputs.to_numpy(dtype=float)).reshape(-1,1).to(device)`；2. 一张 8 列 3 行的表格，比较 pandas、numpy、torch 的 8 个方面；3. 一个 python 代码块，里面有一行 120 个字符以上的长代码。',
    )
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    console.log('回答：', await msg.innerText())
    if (await msg.getByText('看原话').count()) {
      await msg.getByText('看原话').click()
      console.log('原话：', await msg.innerText())
    }
    await page.screenshot({ path: test.info().outputPath('real-answer.png') })
    await expect(msg.locator('.txt table')).toHaveCount(1)
    await expect(msg.locator('.txt pre')).not.toHaveCount(0)
    const m = await msg.evaluate((el) => {
      const list = el.closest('.msgs') as HTMLElement
      const txt = el.querySelector('.txt') as HTMLElement
      return {
        list: [list.scrollWidth, list.clientWidth],
        txt: [txt.scrollWidth, txt.clientWidth],
        pre: [...txt.querySelectorAll('pre')].map((p) => [p.scrollWidth, p.clientWidth]),
        table: [...txt.querySelectorAll('.md-table')].map((t) => [t.scrollWidth, t.clientWidth, t.className]),
      }
    })
    console.log(JSON.stringify(m))
    expect(m.list[0]).toBeLessThanOrEqual(m.list[1]!)
    expect(m.txt[0]).toBeLessThanOrEqual(m.txt[1]!)

    const row = msg.getByTestId('ai-ans-acts')
    await row.getByRole('button', { name: '拷贝' }).click()
    const clip = await clipboardText(run)
    expect(clip).toContain('torch.tensor(inputs.to_numpy(dtype=float))')
    expect(clip).toContain('|')
    await row.getByRole('button', { name: '插进文档' }).click()
    const file = join(vault, '学习笔记.md')
    await expect.poll(() => readFileSync(file, 'utf8'), { timeout: 15_000 }).toMatch(/^> \[!ai\] AI 回答 · Claude Code · .* · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=file%3A.*&msg=\d+\)$/m)
    expect(readFileSync(file, 'utf8')).toContain(clip.split('\n')[0]!)
  } finally {
    forgetSessions(run)
    await run.close()
  }
})
