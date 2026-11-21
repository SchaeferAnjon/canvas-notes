// 用本机真的 Claude Code 验白板（task-vcov6，2026-11-21：白板就是这篇文档，AI 的 board_* 工具改的是这篇的节和段）。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-board.spec.ts
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。
// /整理当前白板：一堆还没分列的卡，AI 用 board_list / board_add_column / board_put_in_column 分成几列——文件里多了几节「## 列名」，
// 每张卡的字一个不少、一个不改，一次提交能撤回；/总结这块白板 →「存成卡片」：最左一组最上面一张卡，卡底「AI 总结的 · 日期」。
// 跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, type Running } from './app'
import { board, openBoard } from './fixtures/board-doc'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(15 * 60_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const CARDS = ['订机票', '租四驱车', '买防水外套', '南岸在维克住两晚', '东边霍芬住一晚', '黄金圈一日游', '杰古沙龙冰河湖', '看极光要看 KP 指数']
const BOARD = `---\ntype: board\n---\n# 冰岛准备\n\n${CARDS.join('\n\n')}\n`

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  const t = Date.now()
  await expect(chat(page).getByRole('button', { name: '停下' })).toBeVisible()
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 8 * 60_000 })
  const msg = chat(page).getByTestId('ai-msg').last()
  const steps = await msg.getByTestId('ai-step').allTextContents()
  const said = (await msg.locator('.txt').textContent().catch(() => '')) ?? ''
  console.log(`\n【${((Date.now() - t) / 1000).toFixed(0)} 秒】${text}\n  步骤：${steps.join(' / ') || '（没有）'}\n  回答：${said.replace(/\n+/g, ' ⏎ ')}`)
  return { steps, said, msg }
}

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
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}`)
}

test('真 Claude Code：/整理当前白板 把卡分成几列（文档里多几节，字一个不少）；/总结这块白板 存成卡片在最左一组最上面', async () => {
  const run = await launch({ '项目/冰岛准备.md': BOARD }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '项目/冰岛准备.md'), 'utf8')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openBoard(page, '冰岛准备')
    await expect(board(page)).toBeVisible()
    await openAi(page)
    await chat(page).getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()

    const r1 = await ask(page, '/整理当前白板')
    expect(r1.steps.join(' ')).toMatch(/看白板上有什么/)
    // 文件里多了几节「## 列名」，每张卡的字都还在、一个字没改
    const after = file()
    const heads = after.match(/^## .+$/gm) ?? []
    console.log('整理后：\n' + after)
    expect(heads.length).toBeGreaterThanOrEqual(2)
    for (const c of CARDS) expect(after).toContain(c)
    await expect(board(page).locator('.db-col[data-head="1"]')).toHaveCount(heads.length)
    const log1 = execFileSync('git', ['-C', vault, 'log', '--format=%s', '-1'], { encoding: 'utf8' })
    console.log('提交：' + log1)
    expect(log1).toMatch(/^AI：/)
    await page.screenshot({ path: 'test-results/real-board-tidy.png' })

    const r2 = await ask(page, '/总结这块白板')
    expect(r2.said.length).toBeGreaterThan(10)
    await r2.msg.getByRole('button', { name: '存成卡片' }).click()
    await expect(r2.msg).toContainText('存到了白板最左一组的最上面')
    await expect(board(page).locator('.db-card .aifoot')).toHaveText(/^AI 总结的 · \d{4}-\d{2}-\d{2}$/)
    expect(file()).toMatch(/<!-- card id=s1 ai=\d{4}-\d{2}-\d{2} -->\n/)
    await page.screenshot({ path: 'test-results/real-board-summary.png' })
  } finally {
    forgetSessions(run)
    await run.close()
  }
})
