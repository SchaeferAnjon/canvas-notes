// 用本机真的 Claude Code 走一遍「存成命令」（task-9womr）：真改两轮，点「存成命令」，弹窗真问 AI 比对改前改后，
// 看出的规矩带依据、指一条左边亮出那几行（计数和亮着的行对得上），存好进命令.json。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-save-dialog.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量）。测试模式、临时库、临时设置目录；CN_AI_MODEL=sonnet，effort 选 Low。
// 跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, pane, type Running, tabOn } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(15 * 60_000)

const NOTE = '课程/读书/摘录.md'
const TEXT = `# 摘录

> 任何一种计算技术要想发挥其全部影响力，都必须得到充分的理解。

—— 前言 — 动手学深度学习

> 以特定方式提出问题的动机，给定建模方法的数学。

—— 前言 — 动手学深度学习

> 张量表示一个由数值组成的数组，这个数组可能有多个维度。

—— 2.1 数据操作 — 动手学深度学习

> 广播机制在形状不同的张量之间按元素运算。

—— 2.1 数据操作 — 动手学深度学习
`

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const dlg = (page: Page) => page.getByRole('dialog', { name: '存成命令' })

async function lowEffort(page: Page) {
  await chat(page).getByTestId('ai-effort').click()
  await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
  await expect(chat(page).getByTestId('ai-effort')).toHaveText('Low')
}

async function send(page: Page, text: string) {
  await chat(page).getByRole('textbox', { name: '问 AI' }).click()
  await page.keyboard.type(text)
  await page.keyboard.press('Enter')
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
}

/** 这次在 ~/.claude 下留的会话记录：projects 下按临时库路径起名的文件夹，和这几个会话号在 session-env、file-history、todos、tasks 下的 */
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

test('真 Claude Code：改两轮以后存成命令，弹窗真比对出规矩，指一条亮出依据，存好进命令.json', async () => {
  const run = await launch({ [NOTE]: TEXT, '课程/读书/另一篇.md': '# 另一篇\n\n还没整理。\n' }, { CN_AI_MODEL: 'sonnet' })
  const { page, app, vault } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('摘录')
    await page.waitForTimeout(250)
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('摘录')
    await expect(pane(page).locator('.cm-content')).toBeVisible()
    await openAi(page)
    await lowEffort(page)
    await send(page, '把这篇里重复的「—— 出处」行合并：每一节只在开头写一次「出处：书名 · 节名」，引文一字不改。直接改这篇。')
    await send(page, '再按出处分节，每节前面加一个「## 节名」小标题。直接改这篇。')
    await chat(page).getByTestId('cmd-saverow').getByRole('button', { name: '存成命令' }).click()
    const d = dlg(page)
    await expect(d).toBeVisible()
    await expect(d.locator('.sc-wait')).toContainText('正在比对')
    // 真比对：等规矩出来（最多 5 分钟）
    await expect(d.locator('.sc-rule').first()).toBeVisible({ timeout: 5 * 60_000 })
    const rules = await d.locator('.sc-rule .rt').allTextContents()
    console.log('看出的规矩：', rules)
    expect(rules.length).toBeGreaterThanOrEqual(2)
    const name = await d.getByRole('textbox', { name: '名字' }).inputValue()
    console.log('名字：', name)
    expect(name.length).toBeGreaterThan(0)
    // 指一条有依据的：计数和亮着的行对得上
    let checked = 0
    for (let i = 0; i < rules.length; i++) {
      await d.locator('.sc-rule').nth(i).locator('.rt').hover()
      const meta = (await d.locator('.sc-meta').textContent()) ?? ''
      const n = Number(/并排里 (\d+) 处依据/.exec(meta)?.[1] ?? '0')
      if (!n) continue
      await d.locator('.sc-rule').nth(i).locator('.rt').click()
      await page.mouse.move(700, 870)
      const lit = await d.locator('.sc-cp').evaluate((cp) => new Set([...cp.querySelectorAll('.cm-line.sc-ev')].map((e) => Math.round(e.getBoundingClientRect().top))).size)
      console.log(`第 ${i + 1} 条「${rules[i]}」：并排里 ${n} 处依据，亮着 ${lit} 行`)
      expect(lit).toBe(n)
      checked++
      await page.keyboard.press('Escape')
    }
    expect(checked).toBeGreaterThan(0)
    await page.screenshot({ path: 'test-results/real-save-dialog.png' })
    await page.keyboard.press('Meta+Enter')
    await expect(d).toHaveCount(0)
    const own = (JSON.parse(readFileSync(join(vault, '.canvas-notes/命令.json'), 'utf8')) as { own: { name: string; kind: string; rules: unknown[] }[] }).own
    expect(own.find((o) => o.name === name)).toMatchObject({ kind: 'ai' })
  } finally {
    await run.close()
    forgetSessions(run)
  }
})
