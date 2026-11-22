// 用本机真的 Claude Code 验 task-dtc34「AI 写进文档的一律显示成带 Claude 标志的 AI 块」：
// 全能模式开着：① 打开一篇书摘，让 AI 在末尾加一节「评价」（照用户截图 r41/img1）；② 往学习笔记末尾加一组自测题和答案（照 r44/img2）。文件里新加的段落是 [!ai] 块、文档里画成带框带标志的块。
// 要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY=… CN_REAL_AI=1 npx playwright test e2e/real-dtc34-ai-block.spec.ts
// （去掉父会话的 CLAUDE_* 环境变量）。测试模式、临时库、临时设置目录；CN_AI_MODEL=sonnet、effort Low。
// 跑完只删这次的 Claude 会话记录；删之前看一眼 AI 自己写的那一步（Edit / Write / 跑命令）里有没有 [!ai]（AI 自己包的，还是软件补包的）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, pane, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

const BOOK = `---
类型: 书摘
作者: 哈珀·李
---
# 杀死一只知更鸟

## 第一章

> 我哥哥杰姆快满十三岁的时候，胳膊肘遭受了一次严重的骨折。等到伤痛痊愈，他也不再担惊受怕，唯恐永远也玩不成橄榄球之后，就很少想到自己受伤的事儿了。
—— [《杀死一只知更鸟》 · 第一章](https://weread.qq.com/web/reader/abc)

> 从迪尔来到我们这儿的那个夏天起——确切地说，是当迪尔怂恿我们把怪人拉德利引出来的时候，事情就开始了。
—— [《杀死一只知更鸟》 · 第一章](https://weread.qq.com/web/reader/abc)
`
const PATH = '阅读/杀死一只知更鸟.md'
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

/** 这次的会话记录：AI 写文件那几步里有没有 [!ai]；然后删掉（projects 下按临时库路径起名的那个文件夹，和这几个会话的别的记录） */
function inspectAndForget(run: Running): { ownWrap: boolean; tools: string[] } {
  const claude = join(homedir(), '.claude')
  const projects = join(claude, 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  const mine = readdirSync(projects).filter((d) => d.includes(stamp))
  const ids = mine.flatMap((d) => readdirSync(join(projects, d)).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)))
  const tools: string[] = []
  let ownWrap = false
  for (const d of mine)
    for (const f of readdirSync(join(projects, d)).filter((x) => x.endsWith('.jsonl')))
      for (const line of readFileSync(join(projects, d, f), 'utf8').split('\n')) {
        if (!line.trim()) continue
        const o = JSON.parse(line) as { message?: { content?: unknown } }
        const parts = Array.isArray(o.message?.content) ? (o.message!.content as { type?: string; name?: string; input?: Record<string, unknown> }[]) : []
        for (const p of parts) {
          if (p.type !== 'tool_use' || !p.name) continue
          tools.push(p.name)
          if (/^(Edit|Write|MultiEdit|Bash)$/.test(p.name) && JSON.stringify(p.input ?? {}).includes('[!ai]')) ownWrap = true
        }
      }
  for (const d of mine) rmSync(join(projects, d), { recursive: true, force: true })
  for (const sub of ['session-env', 'file-history', 'todos', 'tasks']) {
    const dir = join(claude, sub)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (ids.some((id) => f.startsWith(id))) rmSync(join(dir, f), { recursive: true, force: true })
  }
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.join('、') || '无'}）`)
  return { ownWrap, tools }
}

test('真 Claude Code 全能模式：在书摘末尾加一节评价，文件里是 [!ai] 块，文档里画成带框带标志的块', async () => {
  const run = await launch({ [PATH]: BOOK }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  let seen: { ownWrap: boolean; tools: string[] } | null = null
  try {
    await openNote(page, '杀死一只知更鸟')
    await openAi(page)
    await chat(page).getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(chat(page).getByRole('switch', { name: '全能模式' })).toHaveAttribute('aria-checked', 'true')
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('在这篇书摘的末尾加一节「评价」，写两段你对第一章的看法，每段两三句。')
    await box.press('Enter')
    const t0 = Date.now()
    await expect(chat(page).getByRole('button', { name: '停下' })).toBeVisible()
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    console.log(`【${((Date.now() - t0) / 1000).toFixed(0)} 秒】步骤：${(await msg.getByTestId('ai-step').allTextContents()).join(' / ')}\n回答：${(await msg.locator('.txt').textContent()) ?? ''}`)
    await expect.poll(() => readFileSync(join(vault, PATH), 'utf8'), { timeout: 10_000 }).toContain('> [!ai]')
    const text = readFileSync(join(vault, PATH), 'utf8')
    console.log(`文件末尾：\n${text.slice(BOOK.length - 1)}`)
    expect(text.startsWith(BOOK.replace(/\n$/, ''))).toBe(true)
    const tail = text.slice(BOOK.length - 1)
    expect(tail).toMatch(/> \[!ai\] AI 写的 · Claude Code · [^\n]+/)
    // 新加的正文段落都在框里：块外面除了标题和空行没有别的字
    const outside = tail.split('\n').filter((l) => l.trim() && !/^>/.test(l) && !/^#{1,6}\s/.test(l))
    expect(outside).toEqual([])
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/^AI：/)
    expect(git(vault, 'status', '--porcelain')).toBe('')
    await expect(pane(page).locator('.cm-line.cm-callout-ai.cm-callout-head').first()).toBeVisible()
    await expect(pane(page).locator('.cm-line.cm-callout-ai.cm-callout-head .cm-callout-name').first()).toHaveText('AI 写的')
  } finally {
    // 软件退出卡住（报错）也照样删这次的会话记录和临时库
    try {
      await run.close({ keep: true })
    } finally {
      seen = inspectAndForget(run)
      console.log(`AI 用过的工具：${seen.tools.join('、') || '（没有）'}；AI 自己写的那一步里${seen.ownWrap ? '有' : '没有'} [!ai]（${seen.ownWrap ? 'AI 自己包的' : '软件这一轮结束补包的'}）`)
      rmSync(dirname(run.vault), { recursive: true, force: true })
    }
  }
})

/** 用户 2026-11-22 第二个例子（r44/img2）：全能模式下 AI「在《学习笔记》末尾加一段」写了十道自测题和答案，文档里是普通正文 */
const STUDY = `# 学习笔记：动手学深度学习

教材：《动手学深度学习》，PyTorch 版。

## 前言

任何一种计算技术要想发挥其全部影响力，都必须得到充分的理解。

## 2.3 线性代数

标量是只有一个元素的张量；向量是标量值组成的列表；矩阵把向量从一阶推广到二阶。

矩阵-矩阵乘法可以简单地称为矩阵乘法，不应与 Hadamard 积混淆。
`
const STUDY_PATH = '课程/study project/学习笔记.md'

/** 软件整个窗口截一张（给了 CN_SHOTS 时） */
async function shot(run: Running, name: string) {
  if (!process.env.CN_SHOTS) return
  await run.page.waitForTimeout(600)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(process.env.CN_SHOTS, name), Buffer.from(b64, 'base64'))
}

test('真 Claude Code 全能模式：往学习笔记末尾加一组自测题和答案，新加的题和答案在 AI 块里（标题留在块外），白板看法里是 AI 卡', async () => {
  const run = await launch({ [STUDY_PATH]: STUDY }, { CN_AI_MODEL: 'sonnet' })
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    await chat(page).getByTestId('ai-effort').click()
    await page.getByRole('menu', { name: '想多久（effort）' }).getByRole('menuitemradio', { name: /^Low/ }).click()
    await expect(chat(page).getByRole('switch', { name: '全能模式' })).toHaveAttribute('aria-checked', 'true')
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('照这篇笔记出 5 道自测题，连同答案加到这篇末尾，放在新标题「自测题（第 1 章 – 2.3）」下面，答案集中写在「答案」小标题下。')
    await box.press('Enter')
    const t0 = Date.now()
    await expect(chat(page).getByRole('button', { name: '停下' })).toBeVisible()
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    console.log(`【${((Date.now() - t0) / 1000).toFixed(0)} 秒】步骤：${(await msg.getByTestId('ai-step').allTextContents()).join(' / ')}\n回答：${(await msg.locator('.txt').textContent()) ?? ''}`)
    await expect.poll(() => readFileSync(join(vault, STUDY_PATH), 'utf8'), { timeout: 10_000 }).toContain('> [!ai]')
    const text = readFileSync(join(vault, STUDY_PATH), 'utf8')
    console.log(`文件末尾：\n${text.slice(STUDY.length - 1)}`)
    expect(text.startsWith(STUDY.replace(/\n$/, ''))).toBe(true)
    const tail = text.slice(STUDY.length - 1)
    expect(tail).toMatch(/自测题/)
    expect(tail).toMatch(/> \[!ai\] AI 写的 · Claude Code · [^\n]+/)
    // 新加的题和答案都在框里：块外面只有标题和空行（标题按 DESIGN.v3 2.4c 留在块外，大纲、白板的列照常认）
    const outside = tail.split('\n').filter((l) => l.trim() && !/^>/.test(l) && !/^#{1,6}\s/.test(l))
    expect(outside).toEqual([])
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/^AI：/)
    expect(git(vault, 'status', '--porcelain')).toBe('')
    // 文档里画成 AI 块；白板看法里是提示块那种卡（卡头「AI 讲解」一类）
    await pane(page).locator('.cm-line.cm-callout-ai.cm-callout-head').first().scrollIntoViewIfNeeded()
    await expect(pane(page).locator('.cm-line.cm-callout-ai.cm-callout-head').first()).toBeVisible()
    await shot(run, 'real-quiz-doc.png')
    await page.getByTestId('tab-acts').getByRole('tab', { name: '白板' }).click()
    await expect(pane(page).getByTestId('doc-board')).toBeVisible()
    await expect(pane(page).locator('.db-card.fc-callout').first()).toBeVisible()
  } finally {
    try {
      await run.close({ keep: true })
    } finally {
      const seen = inspectAndForget(run)
      console.log(`AI 用过的工具：${seen.tools.join('、') || '（没有）'}；AI 自己写的那一步里${seen.ownWrap ? '有' : '没有'} [!ai]（${seen.ownWrap ? 'AI 自己包的' : '软件这一轮结束补包的'}）`)
      rmSync(dirname(run.vault), { recursive: true, force: true })
    }
  }
})
