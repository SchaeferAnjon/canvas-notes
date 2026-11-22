// 用本机真的 Claude Code 验「AI 写进文档时字一点点长出来」（task-6kun1）。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-ai-grow.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量）。测试模式（窗口不上屏幕）、临时库、临时设置目录；
// CN_AI_MODEL=sonnet，设置 › AI 默认和输入框底行都是 Low。
// 1. 书摘里让 AI「再续写一点评价」（全能模式，Claude Code 自己写进文件）：AI 写进来以后每 150 毫秒截一张、记看得见几个字，
//    文件已经变了、看得见的字一帧比一帧多，就是字在长；
// 2. 文档里 / 菜单「AI 写一段」：同样录。
// 帧和数据放在 CN_GROW_OUT（默认 /private/tmp/canvas-notes-build4/grow/real/）；跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { editorText, launch, openNote, pane, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const OUT = process.env.CN_GROW_OUT || '/private/tmp/canvas-notes-build4/grow/real'
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

const BOOK = `# 杀死一只知更鸟

> 我哥哥杰姆快满十三岁的时候，胳膊肘遭受了一次严重的骨折。等到伤痛痊愈，他也不再担惊受怕，唯恐永远也玩不成橄榄球之后，就很少想到自己受伤的事儿了。

> 等过了一些年，日子长到足够让当事人回首往事时，我们有时候会谈论导致他受伤的那些过往事件。

> 从迪尔来到我们这儿的那个夏天起——确切地说，是当迪尔怂恿我们把怪人拉德利引出来的时候，事情就开始了。
`

/** 设置 › AI 的默认：Claude Code · Sonnet · Low（/ 菜单的「AI 写一段」用它） */
function lowDefault(vault: string) {
  const dir = join(dirname(vault), 'user-data', 'ai')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'settings.json'), JSON.stringify({ engine: 'claude', prefs: { default: { engine: 'claude', model: 'sonnet', effort: 'low' }, features: {} } }))
}

/** 这次在 ~/.claude 下留的会话记录：projects 下按临时库路径起名的那个文件夹整个删掉，和这几个会话的附带记录（同 real-omni） */
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

/** 编辑器里看得见几个字（藏着没显的不在 DOM 里） */
const seenLen = (page: Page) =>
  pane(page)
    .locator('.cm-content')
    .evaluate((el) => Array.from(el.querySelectorAll('.cm-line'), (l) => l.textContent ?? '').join('').length)

/**
 * 从文件变了那一刻起录 secs 秒：每 150 毫秒一张中间那一栏的截图，记下编辑器里的字数和看得见的字数。
 * 返回每一帧；文件变了以后看得见的字数一帧比一帧多的次数（大于 2 就是字在长）
 */
async function record(page: Page, name: string, before: string, secs = 7) {
  mkdirSync(OUT, { recursive: true })
  const t0 = Date.now()
  await expect.poll(() => editorText(page), { timeout: 5 * 60_000, intervals: [100] }).not.toBe(before)
  const start = Date.now()
  const frames: { ms: number; text: number; seen: number }[] = []
  for (let i = 0; Date.now() - start < secs * 1000; i++) {
    const text = (await editorText(page)).length
    const seen = await seenLen(page)
    frames.push({ ms: Date.now() - start, text, seen })
    await pane(page).screenshot({ path: join(OUT, `${name}-${String(i).padStart(2, '0')}.png`) })
    await page.waitForTimeout(150)
  }
  const grew = frames.filter((f, i) => i > 0 && f.seen > frames[i - 1]!.seen && f.text === frames[i - 1]!.text).length
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify({ waitedMs: start - t0, grew, frames }, null, 1))
  console.log(`【${name}】等 AI 写进来 ${((start - t0) / 1000).toFixed(1)} 秒；文件不变、看得见的字变多的帧：${grew}；看得见的字数：${frames.map((f) => f.seen).join(' → ')}`)
  return { frames, grew }
}

test('真 Claude Code：AI 对话里「再续写一点评价」写进书摘，新的字一点点长出来', async () => {
  const run = await launch({ '书摘.md': BOOK }, { CN_AI_MODEL: 'sonnet' }, lowDefault)
  const { page } = run
  try {
    await openNote(page, '书摘')
    await page.keyboard.press('Meta+j')
    await chat(page).getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(chat(page).getByTestId('ai-effort')).toHaveText('Low')
    const before = await editorText(page)
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('再续写一点评价')
    await box.press('Enter')
    const r = await record(page, 'chat', before)
    expect(r.grew).toBeGreaterThan(2)
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const steps = await chat(page).getByTestId('ai-msg').last().getByTestId('ai-step').allTextContents()
    console.log(`步骤：${steps.join(' / ')}`)
  } finally {
    await run.close({ keep: true })
    forgetSessions(run)
    rmSync(dirname(run.vault), { recursive: true, force: true })
  }
})

test('真 Claude Code：文档里 / 菜单「AI 写一段」边收边写，字一点点长出来', async () => {
  const run = await launch({ '书摘.md': `${BOOK}\n第一段。\n` }, { CN_AI_MODEL: 'sonnet' }, lowDefault)
  const { page } = run
  try {
    await openNote(page, '书摘')
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/ai')
    await page.keyboard.press('Enter')
    const ask = page.getByRole('textbox', { name: '让 AI 写什么' })
    await expect(ask).toBeFocused()
    const before = await editorText(page)
    await page.keyboard.type('接着写一段读后感，三四句话')
    await page.keyboard.press('Enter')
    const r = await record(page, 'slash', before)
    expect(r.grew).toBeGreaterThan(2)
  } finally {
    await run.close({ keep: true })
    forgetSessions(run)
    rmSync(dirname(run.vault), { recursive: true, force: true })
  }
})
