// 用本机真的 Claude Code 验 task-bppvn：回答下面没有「引用再问」；在真回答里拖选一段 → 小框「引用 ⌘↵」→ 输入框顶上一张引用小卡，
// 接着问一句发出去，AI 答的是那一段（回答里提到那段里的词）。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-bppvn-quote.spec.ts
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet、Low。跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

test('真 AI：回答下面没有「引用再问」；拖选一段点「引用」，小卡是那一段，接着问 AI 答的是那一段', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n第一段。\n' }, { CN_AI_MODEL: 'sonnet' }, lowDefault)
  const { page } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('不要用工具，直接回答：用三段话分别讲番茄工作法、费曼学习法、间隔重复，每段一句话，段与段之间空一行，不要标题和列表。')
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    console.log('回答：', await msg.locator('.txt').innerText())
    const row = msg.getByTestId('ai-ans-acts')
    await expect(row.locator('[data-act]')).toHaveText(['拷贝', '插进文档', ''])

    // 拖选「费曼」那一段（从第一个字到最后一个字）
    const p = msg.locator('.txt p', { hasText: '费曼' }).first()
    const pts = await p.evaluate((el) => {
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      const nodes: Text[] = []
      while (w.nextNode()) if ((w.currentNode as Text).data.trim()) nodes.push(w.currentNode as Text)
      const box = (n: Text, i: number) => {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + 1)
        return r.getBoundingClientRect()
      }
      const a = box(nodes[0]!, 0)
      const last = nodes[nodes.length - 1]!
      const b = box(last, last.data.trimEnd().length - 1)
      return { a: { x: a.left + 1, y: a.top + a.height / 2 }, b: { x: b.right - 1, y: b.top + b.height / 2 }, text: (el as HTMLElement).innerText.trim() }
    })
    await page.mouse.move(pts.a.x, pts.a.y)
    await page.mouse.down()
    await page.mouse.move(pts.b.x, pts.b.y, { steps: 8 })
    await page.mouse.up()
    const askbox = page.getByRole('dialog', { name: '选中的这句' })
    await expect(askbox).toBeVisible()
    await expect(askbox.locator('.it')).toHaveText(['引用⌘↵', '问这句↵'])
    await askbox.getByRole('button', { name: /^引用/ }).click()
    const mat = chat(page).getByTestId('ai-mat')
    await expect(mat).toHaveCount(1)
    await expect(mat).toHaveAttribute('data-src', 'AI的回答')
    const quoted = (await mat.locator('.ct').innerText()).trim()
    console.log('引用小卡：', quoted)
    expect(quoted.replace(/\s+/g, '')).toBe(pts.text.replace(/\s+/g, ''))
    await expect(box).toHaveValue('①')
    await page.keyboard.type('这段里的方法，给一个今天就能做的小练习，一句话。')
    await page.keyboard.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const sent = chat(page).locator('.um.mq').last()
    await expect(sent.locator('.fni .fs')).toHaveText(['· AI的回答'])
    const ans = await chat(page).getByTestId('ai-msg').last().locator('.txt').innerText()
    console.log('接着问的回答：', ans)
    expect(ans).toMatch(/费曼|讲给|解释|教/)
    await page.screenshot({ path: test.info().outputPath('real-quote.png') })
  } finally {
    forgetSessions(run)
    await run.close()
  }
})
