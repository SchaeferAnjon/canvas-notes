// 用本机真的 Claude Code 验「AI整理」（task-5ryf9）。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-5ryf9-tidy.spec.ts
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。
// 白板上框选三张 → AI整理：AI 只回编号，先在中间给你看，收下才写：选中的三张进了新的几节，每张的字一个不少、一个不改，小结是带 AI 标志的块，一次提交能撤回。
// 文档里拖选几块 → AI整理：理顺顺序、加小标题，字一个不少。跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, pane, type Running } from './app'
import { board, openBoard } from './fixtures/board-doc'
import { BOARD, BOARD_PATH, DOC, DOC_PATH, FILES } from './fixtures/board-select'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(15 * 60_000)

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
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}`)
}

async function low(page: Page) {
  await openAi(page)
  await chat(page).getByTestId('ai-effort').click()
  await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
}

/** 收下以后：每一段原文都还在、一字不改 */
const keeps = (text: string, parts: string[]) => parts.every((p) => text.includes(p))

test('真 Claude Code：白板 AI整理三张、文档 AI整理六块；先看改前改后，收下一次提交，字一个不改，撤回回到原样', async () => {
  const run = await launch(FILES, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  const bf = () => readFileSync(join(vault, BOARD_PATH), 'utf8')
  const df = () => readFileSync(join(vault, DOC_PATH), 'utf8')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await low(page)
    await openBoard(page, '学习笔记：动手学深度学习')
    await expect(board(page)).toBeVisible()
    const parts = ['范数：向量有多大。L2 是各元素平方和再开方，L1 是各元素绝对值之和。', '矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积，再把结果拼在一起。', '> 矩阵-矩阵乘法可以简单地称为矩阵乘法，不应与“Hadamard积”混淆。']
    for (const [i, id] of ['f3', 'f4', 'f5'].entries()) {
      const c = board(page).locator(`.db-card[data-id="${id}"]`)
      await c.scrollIntoViewIfNeeded()
      const b = (await c.boundingBox())!
      if (i) await page.keyboard.down('Shift')
      await page.mouse.click(b.x + 40, b.y + 16)
      if (i) await page.keyboard.up('Shift')
    }
    const t0 = Date.now()
    await page.getByTestId('db-selbar').getByRole('button', { name: 'AI整理' }).click()
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg.getByRole('button', { name: '收下', exact: true })).toBeVisible({ timeout: 8 * 60_000 })
    console.log(`【白板 ${((Date.now() - t0) / 1000).toFixed(0)} 秒】${(await msg.innerText()).replace(/\n+/g, ' ⏎ ')}`)
    expect(bf()).toBe(BOARD)
    await msg.getByRole('button', { name: '收下', exact: true }).click()
    await expect.poll(() => bf()).not.toBe(BOARD)
    const after = bf()
    console.log(after.slice(after.indexOf('## 章节阅读顺序')))
    expect(keeps(after, parts)).toBe(true)
    expect(after).toMatch(/> \[!ai\] AI 写的 · Claude Code/)
    expect(after).not.toContain('id=f3 ')
    await chat(page).getByTestId('ai-msg').last().getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => bf()).toBe(BOARD)

    // 文档：从左边空白拖选六块 → AI整理
    await openNote(page, '2.3 线性代数')
    const line = (s: string) => pane(page).locator('.cm-line', { hasText: s }).first()
    const a = (await line('矩阵-矩阵乘法 AB').boundingBox())!
    const z = (await line('按常数缩放').boundingBox())!
    await page.mouse.move(a.x - 30, a.y + 6)
    await page.mouse.down()
    await page.mouse.move(a.x - 28, a.y + 40, { steps: 4 })
    await page.mouse.move(a.x - 26, z.y + 10, { steps: 10 })
    await page.mouse.up()
    const t1 = Date.now()
    await page.getByTestId('doc-selbar').getByRole('button', { name: 'AI整理' }).click()
    const m2 = chat(page).getByTestId('ai-msg').last()
    await expect(m2.getByRole('button', { name: '收下', exact: true })).toBeVisible({ timeout: 8 * 60_000 })
    console.log(`【文档 ${((Date.now() - t1) / 1000).toFixed(0)} 秒】${(await m2.innerText()).replace(/\n+/g, ' ⏎ ')}`)
    await m2.getByRole('button', { name: '收下', exact: true }).click()
    await expect.poll(() => df()).not.toBe(DOC)
    const d2 = df()
    console.log(d2)
    expect(keeps(d2, ['矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积，再把结果拼在一起。', '范数：向量有多大。L2 是各元素平方和再开方，L1 是各元素绝对值之和。', '- 范数非负', '- 三角不等式', '- 按常数缩放'])).toBe(true)
    expect(d2).toMatch(/\n### \S/)
    await chat(page).getByTestId('ai-msg').last().getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => df()).toBe(DOC)
  } finally {
    await run.close({ keep: true })
    forgetSessions(run)
    rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
  }
})
