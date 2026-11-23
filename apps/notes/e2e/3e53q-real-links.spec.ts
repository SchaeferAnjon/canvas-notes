// 用本机真的 Claude Code / Codex 问一句（task-3e53q「改前改后」）：问题里不提链接，数回答里提到库里东西的地方几处 AI 写成了链接、
// 写的链接认不认得出、指的行和页对不对；再数界面上软件兜底认出的几处。数完的结果写进 CN_LINKS_OUT 指的 JSON（交付页用）。
// 要联网、花额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 CN_LINKS_ENGINE=claude|codex CN_LINKS_OUT=/tmp/x.json npx playwright test e2e/3e53q-real-links.spec.ts
// （Claude Code 换个登录：再带上 CLAUDE_CONFIG_DIR；换模型：CN_LINKS_MODEL=Sonnet）
// 测试模式（窗口不上屏幕）、临时库、临时设置目录。跑完只删这次产生的 Claude 会话记录。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, openNote, type Running } from './app'
import { LECTURE } from './fixtures/pdf'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(15 * 60_000)

const ENGINE = process.env.CN_LINKS_ENGINE === 'codex' ? 'codex' : 'claude'
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

const PLAN = ['# 小论文计划', '', '先读完这 5 篇，按和 C72 的关系排。', '', '## 排第 1 篇', 'C72 BST-GATNet：图注意力 + Bi-LSTM。', '', '## 排第 2 篇', 'SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。', ''].join('\n')
const SAGE = ['# SAGE 读书笔记', '', '## 评估', '随机划分 91.8%，留一被试（LOSO）只有 80.6%。', '同一个人的数据同时出现在练习和考卷里，模型学会的是认人。', '', '## 待查', 'C72 只做了随机划分。', ''].join('\n')
const FILES: Record<string, string | Buffer> = {
  '课程/study project 2/小论文计划.md': PLAN,
  '课程/文献/SAGE 读书笔记.md': SAGE,
  '课程/线代/第3讲.pdf': LECTURE,
  '课程/线代/第3讲 笔记.md': '# 第3讲 笔记\n\n## 定义\n线性：加起来再变和变了再加一样。\n',
  '收件箱/随手.md': '# 随手\n\n问问 AI。\n',
}
const QUESTION = 'SAGE 在我库里哪几篇笔记里提到了？各在哪几行、说了什么？另外线代第3讲那份 PDF 里哪一页讲 kernel？'

function forgetSessions(run: Running) {
  // Claude Code 的设置目录：CLAUDE_CONFIG_DIR 指了别处（另一个登录）时在那里
  const claude = process.env.CLAUDE_CONFIG_DIR?.replace(/\/+$/, '') || join(homedir(), '.claude')
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
}

/** 设置目录里记下的这段对话，最后一条 AI 回答的原文 */
function rawAnswer(userData: string): string {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.json') && p.includes('/chats/')) {
        const j = JSON.parse(readFileSync(p, 'utf8')) as { msgs?: { role: string; text?: string }[] }
        for (const m of j.msgs ?? []) if (m.role === 'ai' && m.text) out.push(m.text)
      }
    }
  }
  walk(join(userData, 'ai'))
  return out.at(-1) ?? ''
}

/**
 * 数一条回答：库里的四样（两篇笔记、PDF、第3讲笔记）各算一处，看 AI 写成什么样：md 链接（指对了没有）、反引号 / 路径、只写名字、没提。
 * 页码（PDF 的某一页）另算一处
 */
function tally(text: string) {
  const links = [...text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)].map((m) => ({ label: m[1]!, href: m[2]! }))
  const outside = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, ' ')
  const items = [
    { key: '小论文计划', path: '课程/study project 2/小论文计划.md', names: ['小论文计划'], want: /#L(9|10)\b|#L[89]-L(9|10)\b/ },
    { key: 'SAGE 读书笔记', path: '课程/文献/SAGE 读书笔记.md', names: ['SAGE 读书笔记'], want: /#L\d/ },
    { key: '第3讲.pdf', path: '课程/线代/第3讲.pdf', names: ['第3讲.pdf', '第3讲 PDF', '第3讲'], want: /page=4\b/ },
  ]
  const enc = (p: string) => [p, encodeURI(p), p.replace(/ /g, '%20'), `<${p}>`]
  return items.map((it) => {
    const hit = links.filter((l) => enc(it.path).some((p) => decodeURI(l.href.replace(/^<|>$/g, '')).startsWith(it.path) || l.href.startsWith(p)) || l.href.includes(it.path.split('/').pop()!))
    const form = hit.length ? 'link' : outside.includes(it.path) ? 'path' : it.names.some((n) => outside.includes(n)) ? 'name' : 'none'
    return { item: it.key, form, links: hit.map((l) => `[${l.label}](${l.href})`), right: hit.some((l) => it.want.test(l.href)) }
  })
}

test(`真 ${ENGINE}：问题里不提链接，回答里提到库里的笔记、PDF 页码写成链接没有`, async () => {
  const run = await launch(FILES)
  const { page } = run
  let closed = false
  try {
    await openNote(page, '随手')
    await openAi(page)
    // Claude Code：CN_LINKS_MODEL（比如 Sonnet，Opus 用完了这周的额度时）在输入框底下的模型那一颗里选
    if (ENGINE === 'claude' && process.env.CN_LINKS_MODEL) {
      await chat(page).getByTestId('ai-model').click()
      await page.getByRole('menu', { name: '模型' }).getByRole('menuitemradio').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${process.env.CN_LINKS_MODEL}`) }) }).first().click()
    }
    if (ENGINE === 'codex') {
      await chat(page).getByTestId('ai-engine').click()
      await page.getByRole('menu', { name: 'AI 引擎' }).getByRole('menuitemradio').filter({ hasText: 'Codex' }).click()
      await expect(chat(page).getByTestId('ai-engine')).toHaveText('Codex')
    }
    const ta = chat(page).getByRole('textbox', { name: '问 AI' })
    await ta.fill(QUESTION)
    await ta.press('Enter')
    await expect(chat(page).getByRole('button', { name: '停下' })).toBeVisible({ timeout: 60_000 })
    await expect(chat(page).getByRole('button', { name: '停下' })).toHaveCount(0, { timeout: 12 * 60_000 })
    const msg = chat(page).getByTestId('ai-msg').last()
    console.log('界面上的回答：', (await msg.textContent())?.replace(/\s+/g, ' ').slice(0, 600))
    if (await msg.getByText('看原话').count()) {
      await msg.getByText('看原话').click()
      console.log('原话：', (await chat(page).textContent())?.slice(-2000))
    }
    // CN_SHOTS（目录）+ CN_LINKS_TAG（改前 / 改后）：截一张回答，交付页用
    const snap = async (name: string) => {
      if (!process.env.CN_SHOTS) return
      await page.waitForTimeout(400)
      const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
      writeFileSync(join(process.env.CN_SHOTS, `${name}-${process.env.CN_LINKS_TAG ?? 'x'}-${ENGINE}.png`), Buffer.from(b64, 'base64'))
    }
    await msg.scrollIntoViewIfNeeded()
    await snap('real')
    const ui = await msg.locator('a.cite').evaluateAll((as) => as.map((a) => ({ text: a.textContent ?? '', href: (a as HTMLElement).dataset.href ?? `[[${(a as HTMLElement).dataset.wiki}]]`, auto: (a as HTMLElement).dataset.auto ?? null, page: a.classList.contains('pg') })))
    // 每个链接点一下，看预览卡认出的是哪一篇（页码小牌点了直接翻页、右栏跟着换对话，不点）
    const cards: string[] = []
    for (let i = 0; i < ui.length; i++) {
      if (ui[i]!.page) {
        cards.push('（页码小牌，点了直接翻到那页）')
        continue
      }
      await msg.locator('a.cite').nth(i).click()
      const card = page.getByRole('dialog', { name: '引用' })
      await expect(card).toBeVisible()
      cards.push((await card.textContent())?.replace(/\s+/g, ' ').slice(0, 160) ?? '')
      await page.keyboard.press('Escape')
    }
    const by = (await msg.locator('.read').textContent().catch(() => '')) ?? ''
    await run.close({ keep: true })
    closed = true
    const text = rawAnswer(run.userData)
    const result = { engine: ENGINE, by, question: QUESTION, text, tally: tally(text), ui, cards }
    console.log(JSON.stringify(result, null, 2))
    if (process.env.CN_LINKS_OUT) writeFileSync(process.env.CN_LINKS_OUT, JSON.stringify(result, null, 2))
    expect(text).not.toBe('')
  } finally {
    if (!closed) await run.close({ keep: true }).catch(() => undefined)
    forgetSessions(run)
    rmSync(dirname(run.vault), { recursive: true, force: true })
  }
})
