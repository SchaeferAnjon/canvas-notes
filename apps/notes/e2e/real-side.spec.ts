// 用本机真的 Claude Code 验旁支就地展开（task-4edsc）：读 PDF 和 AI 对话里各开一条旁支、真问一句，截图。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 CN_SHOTS=<目录> npx playwright test e2e/real-side.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量）。测试模式（窗口不上屏幕）、临时库、临时设置目录；
// CN_AI_MODEL=sonnet，输入框底行把 effort 选成 Low。跑完只删这次产生的 Claude 会话记录（~/.claude/projects 下按临时库路径起名的那个文件夹）。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openNote, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(15 * 60_000)

const DIR = process.env.CN_SHOTS ?? ''
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const askbox = (page: Page) => page.getByRole('toolbar', { name: '选中的这句' })
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame: 'b', winBg: 'aurora' } }))
}

async function shot(run: Running, name: string) {
  if (!DIR) return
  mkdirSync(DIR, { recursive: true })
  await run.page.mouse.move(5, 300)
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `real-${name}.png`), Buffer.from(b64, 'base64'))
}

/** 输入框底行把 effort 选成 Low（这个对话用；旁支跟主对话） */
async function lowEffort(page: Page, panel: Locator) {
  await panel.getByTestId('ai-effort').first().click()
  await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
  await expect(panel.getByTestId('ai-effort').first()).toHaveText('Low')
}

/** 回答第一段里拖选第一句（真回答的字事先不知道：找第一段字，拖到第一个句号或 24 个字） */
async function selectFirstSentence(page: Page, txt: Locator): Promise<string> {
  const r = await txt.evaluate((root) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      const n = w.currentNode as Text
      if (n.parentElement?.closest('.katex, code, .md-h')) continue
      const t = n.data
      if (t.trim().length < 8) continue
      const start = t.search(/\S/)
      const stop = t.indexOf('。', start)
      const end = stop > start + 4 ? stop + 1 : Math.min(t.length, start + 24)
      const range = document.createRange()
      range.setStart(n, start)
      range.setEnd(n, end)
      n.parentElement!.scrollIntoView({ block: 'center' })
      const rs = range.getClientRects()
      const f = rs[0]!
      const l = rs[rs.length - 1]!
      return { text: t.slice(start, end), pts: [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2] }
    }
    return null
  })
  if (!r) throw new Error('回答里没找到能选的一句')
  await page.mouse.move(r.pts[0]!, r.pts[1]!)
  await page.mouse.down()
  await page.mouse.move(r.pts[2]!, r.pts[3]!, { steps: 8 })
  await page.mouse.up()
  return r.text
}

/** 这次在 ~/.claude 下留的会话记录：projects 下按临时库路径起名的那个文件夹，和这几个会话在 session-env、file-history、todos、tasks 下的 */
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

test('真 Claude Code：读 PDF 的回答里选一句开旁支，真问一句（从主对话的会话分叉）', async () => {
  const run = await launch({ '课程/线代/第3讲.pdf': LECTURE }, { CN_AI_MODEL: 'sonnet' }, look)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await page.keyboard.press('Meta+j')
    const ai = reading(page)
    await expect(ai).toBeVisible()
    await lowEffort(page, ai)
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('用两三句话讲讲这一页在说什么。')
    await box.press('Enter')
    const msg = ai.getByTestId('reading-msg').last()
    await expect(msg.locator('.acts, .aierr').first()).toBeVisible({ timeout: 5 * 60_000 })
    console.log('主对话回答：', (await msg.locator('.txt').textContent())?.replace(/\n+/g, ' ⏎ '))
    const quote = await selectFirstSentence(page, msg.locator('.txt'))
    console.log('选中的那句：', quote)
    await askbox(page).getByRole('button', { name: '问这句' }).click()
    // 「问这句」直接开旁支，光标在旁支的输入框里，问题在那里打（r129 小条上不再常驻问题那一格）
    await page.keyboard.insertText('这句里最关键的是哪个词？一两句话就好。')
    await page.keyboard.press('Enter')
    const s = ai.getByRole('region', { name: '旁支' })
    await expect(s).toBeVisible()
    await expect(s.locator('.acts, .aierr').first()).toBeVisible({ timeout: 5 * 60_000 })
    const answer = (await s.getByTestId('side-msg').last().textContent()) ?? ''
    console.log('旁支回答：', answer.replace(/\n+/g, ' ⏎ '))
    expect(answer.trim().length).toBeGreaterThan(4)
    await expect(s.locator('.aierr')).toHaveCount(0)
    await shot(run, 'pdf-side')
  } finally {
    forgetSessions(run)
    await run.close()
  }
})

test('真 Claude Code：AI 对话的回答里选一句开旁支，真问一句（从这个地方的会话分叉）', async () => {
  const run = await launch({ '周记/2026-W47.md': '# 2026-W47\n\n周一：第5讲的作业开了个头，注意力那节看懂了公式，但不知道为什么要缩放。\n\n周三：原来是怕点积太大，softmax 变得太尖。早上开始跑步，5 公里。\n\n周五：跑步第三天。约导师下周见面，要先把论文计划第一节写完。\n' }, { CN_AI_MODEL: 'sonnet' }, look)
  const { page } = run
  try {
    await openNote(page, '2026-W47')
    await page.keyboard.press('Meta+j')
    const ai = chat(page)
    await expect(ai).toBeVisible()
    await lowEffort(page, ai)
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('把这篇周记总结成三句话，不要动手改文件。')
    await box.press('Enter')
    await expect(ai.getByRole('button', { name: '停下' })).toBeVisible()
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const msg = ai.getByTestId('ai-msg').last()
    console.log('主对话回答：', (await msg.locator('.txt').textContent())?.replace(/\n+/g, ' ⏎ '))
    const quote = await selectFirstSentence(page, msg.locator('.txt'))
    console.log('选中的那句：', quote)
    await askbox(page).getByRole('button', { name: '问这句' }).click()
    // 「问这句」直接开旁支，光标在旁支的输入框里，问题在那里打（r129 小条上不再常驻问题那一格）
    await page.keyboard.insertText('这句是从周记哪一天看出来的？一两句话就好。')
    await page.keyboard.press('Enter')
    const s = ai.getByRole('region', { name: '旁支' })
    await expect(s).toBeVisible()
    await expect(s.locator('.acts, .aierr').first()).toBeVisible({ timeout: 5 * 60_000 })
    const answer = (await s.getByTestId('side-msg').last().textContent()) ?? ''
    console.log('旁支回答：', answer.replace(/\n+/g, ' ⏎ '))
    expect(answer.trim().length).toBeGreaterThan(4)
    await expect(s.locator('.aierr')).toHaveCount(0)
    // 主对话里没多出东西
    await expect(ai.getByTestId('ai-msg')).toHaveCount(1)
    await shot(run, 'chat-side')
  } finally {
    forgetSessions(run)
    await run.close()
  }
})
