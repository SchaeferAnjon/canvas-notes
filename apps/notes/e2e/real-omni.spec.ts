// 用本机真的 Claude Code 验全能模式（task-n7uwo，2026-11-19 用户定的规矩：用真 AI 验收）。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-omni.spec.ts
// （在 Claude Code 的终端里跑要像上面这样去掉父会话的 CLAUDE_* 环境变量，像从访达打开的软件一样）。
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet，输入框底行把 effort 选成 Low。
// 全能开：问家目录下面有什么（只列一层）、在 /private/tmp 下建一个文件再删掉、在库里新建一篇（看这一轮的提交）；
// 全能关：同样问库外目录（要说做不了、请打开全能模式，不提 Claude Code 的权限设置）、新建、改名（链接跟着改）、挪进别的文件夹、删掉（进废纸篓、能撤回）。
// 跑完只删这次产生的 Claude 会话记录（~/.claude/projects 下按临时库路径起名的那个文件夹）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, type Running } from './app'
import { LECTURE } from './fixtures/pdf'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(15 * 60_000)

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const files = {
  '旅行.md': '# 旅行\n\n先看 [[冰岛行程]]，细节在 [这篇](收件箱/冰岛行程.md)。\n',
  '收件箱/.gitkeep': '',
  '课程/.gitkeep': '',
}
let asks = 0

async function ask(page: Page, text: string): Promise<{ text: string; steps: string[] }> {
  asks++
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  const t = Date.now()
  await expect(chat(page).getByRole('button', { name: '停下' })).toBeVisible()
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
  const msg = chat(page).getByTestId('ai-msg').last()
  const r = { text: (await msg.locator('.txt').textContent().catch(() => '')) ?? '', steps: await msg.getByTestId('ai-step').allTextContents() }
  const err = await msg.locator('.aierr, [data-testid="ai-error"]').allTextContents()
  console.log(`\n【第${asks}问 · ${((Date.now() - t) / 1000).toFixed(0)} 秒】${text}\n  步骤：${r.steps.join(' / ') || '（没有）'}\n  回答：${r.text.replace(/\n+/g, ' ⏎ ')}${err.length ? `\n  出错：${err.join(' ')}` : ''}`)
  return r
}

/** 输入框底行把 effort 选成 Low（这个对话用） */
async function lowEffort(page: Page) {
  await chat(page).getByTestId('ai-effort').click()
  await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
  await expect(chat(page).getByTestId('ai-effort')).toHaveText('Low')
}

/**
 * 这次在 ~/.claude 下留的会话记录：projects 下按临时库路径起名的那个文件夹（里面只有这次的会话）整个删掉；
 * 这几个会话在 session-env、file-history、todos、tasks 下按会话号起名的也删掉
 */
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
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.join('、') || '无'}）`)
}

test('真 Claude Code：全能模式开着、关着各走一遍', async () => {
  const run = await launch(files, { CN_AI_MODEL: 'sonnet' })
  const { page, vault, trash } = run
  try {
    await openAi(page)
    await lowEffort(page)
    const sw = chat(page).getByRole('switch', { name: '全能模式' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')

    // ---------- 全能模式开着 ----------
    const home = `/Users/${userInfo().username}`
    const a1 = await ask(page, `${home} 下面有什么？只列这一层的名字，不要打开、不要读里面任何文件的内容。`)
    expect(a1.text).toMatch(/Documents|Desktop|Library|Downloads/)

    const tmp = `/private/tmp/cn-omni-real-${Date.now().toString(36)}`
    const a2 = await ask(page, `在 ${tmp} 这个文件夹里建一个文件 hello.txt，内容写 hi；建好以后再把这个文件和这个文件夹都删掉。做完告诉我。`)
    expect(a2.steps.join(' ')).toMatch(/tmp/)
    expect(existsSync(tmp)).toBe(false)

    const before = Number(git(vault, 'rev-list', '--count', 'HEAD'))
    const a3 = await ask(page, '在库的最外层新建一篇笔记，标题「真AI测试」，正文写一句「全能模式下新建的」。')
    expect(existsSync(join(vault, '真AI测试.md'))).toBe(true)
    expect(Number(git(vault, 'rev-list', '--count', 'HEAD'))).toBeGreaterThan(before)
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/^AI：/)
    expect(git(vault, 'show', '--name-only', '--format=', 'HEAD')).toContain('真AI测试.md')
    expect(git(vault, 'status', '--porcelain')).toBe('')
    console.log(`  这一轮的提交：${git(vault, 'log', '-1', '--format=%h %s')}`)
    void a3

    // ---------- 全能模式关着 ----------
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    const a4 = await ask(page, `${home} 下面有什么？只列这一层的名字。`)
    expect(a4.text).toContain('全能模式')
    expect(a4.text).not.toMatch(/权限设置|settings\.json|\/permissions|allowedTools|--add-dir/)

    const a5 = await ask(page, '新建一篇笔记「冰岛行程」，放在「收件箱」文件夹里，正文写「第一天到雷克雅未克」。')
    expect(readFileSync(join(vault, '收件箱/冰岛行程.md'), 'utf8')).toContain('第一天到雷克雅未克')
    expect(a5.steps.join(' ')).toContain('新建《冰岛行程》')

    const a6 = await ask(page, '把「冰岛行程」这篇改名为「冰岛自驾行程」。')
    expect(existsSync(join(vault, '收件箱/冰岛自驾行程.md'))).toBe(true)
    expect(readFileSync(join(vault, '旅行.md'), 'utf8')).toBe('# 旅行\n\n先看 [[冰岛自驾行程]]，细节在 [这篇](收件箱/冰岛自驾行程.md)。\n')
    expect(a6.steps.join(' ')).toContain('改名为《冰岛自驾行程》')

    const a7 = await ask(page, '把「冰岛自驾行程」挪进「课程」文件夹。')
    expect(existsSync(join(vault, '课程/冰岛自驾行程.md'))).toBe(true)
    expect(readFileSync(join(vault, '旅行.md'), 'utf8')).toContain('[这篇](课程/冰岛自驾行程.md)')
    expect(a7.steps.join(' ')).toContain('挪进「课程」')

    const a8 = await ask(page, '把「冰岛自驾行程」这篇删掉。')
    expect(existsSync(join(vault, '课程/冰岛自驾行程.md'))).toBe(false)
    expect(readdirSync(trash).some((n) => n.endsWith('冰岛自驾行程.md'))).toBe(true)
    expect(a8.steps.join(' ')).toContain('在废纸篓里能找回')
    console.log(`  删掉那一轮的提交：${git(vault, 'log', '-1', '--format=%h %s')}`)
    // 撤回：那一轮的改动块上点「撤回」，笔记回来
    await chat(page).getByTestId('ai-msg').last().getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(chat(page).getByTestId('ai-msg').last().getByTestId('ai-change')).toContainText('已撤回')
    expect(readFileSync(join(vault, '课程/冰岛自驾行程.md'), 'utf8')).toContain('第一天到雷克雅未克')
    console.log(`\n一共问了 ${asks} 次；提交：\n${git(vault, 'log', '--format=  %h %s')}`)
  } finally {
    await run.close({ keep: true })
    forgetSessions(run)
    rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
  }
})

test('真 Claude Code：读 PDF 的 AI 在全能模式下也能动手（照 CN-89 读用户设置），不去建任务看板的任务', async () => {
  const run = await launch({ ...files, '课程/线代/第3讲.pdf': LECTURE }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  const reading = page.getByRole('complementary', { name: '边读边问 AI' })
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await openAi(page)
    await reading.getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(reading.getByRole('switch', { name: '全能模式' })).toHaveAttribute('aria-checked', 'true')
    asks++
    const t = Date.now()
    const box = reading.getByRole('textbox', { name: '问 AI' })
    await box.fill('这一页讲的是什么？用两三句话讲，再把要点记成一篇笔记：放在「课程/线代」文件夹里，标题「第3讲要点」。')
    await box.press('Enter')
    const msg = reading.getByTestId('reading-msg').last()
    await expect(msg.getByTestId('ai-change')).toBeVisible({ timeout: 5 * 60_000 })
    const steps = await msg.getByTestId('ai-step').allTextContents()
    const text = (await msg.locator('.txt').textContent()) ?? ''
    console.log(`\n【读 PDF · 第${asks}问 · ${((Date.now() - t) / 1000).toFixed(0)} 秒】\n  步骤：${steps.join(' / ')}\n  回答：${text.replace(/\n+/g, ' ⏎ ')}`)
    expect(existsSync(join(vault, '课程/线代/第3讲要点.md'))).toBe(true)
    expect(steps.join(' ')).not.toMatch(/dispatch|task_begin/i)
    expect(git(vault, 'log', '--format=%s')).toContain('AI：读第3讲时：')
    console.log(`  提交：\n${git(vault, 'log', '--format=  %h %s')}`)
  } finally {
    await run.close({ keep: true })
    forgetSessions(run)
    rmSync(dirname(run.vault), { recursive: true, force: true, maxRetries: 5 })
  }
})
