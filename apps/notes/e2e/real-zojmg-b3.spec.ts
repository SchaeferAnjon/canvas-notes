// 真的 Claude Code：英文版第三批里交给 AI 的话（task-zojmg）。英文界面在文档的 AI 讲解里选一句「Ask about this」，
// 旁支里空着回车问的是「Explain this」（旁支默认那一问跟界面语言，side/name.ts 的 ASK_THIS），真问真答，写进文档的问题和回答都是英文。在本机跑：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" CN_REAL_AI=1 npx playwright test e2e/real-zojmg-b3.spec.ts
// （去掉父会话的 CLAUDE_* 环境变量；测试专用的 API key 只在运行时交给 claude 进程，不写进仓库和日志。）测试模式、临时库、临时设置目录；
// CN_AI_MODEL=sonnet，effort 选 Low。跑完只删这次产生的 Claude 会话记录（按临时库路径起名的那个文件夹）。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, openAi, pane, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(300_000)

const HAN = /\p{Script=Han}/u
const DOC = [
  '# Attention',
  '',
  'Notes from lecture 5.',
  '',
  '> [!ai] AI 讲解 · Claude Code · Opus 5.5',
  '> Scaled dot-product attention compares each query with every key to get a score.',
  '>',
  '> Finally the weights are used to add up the values, which gives the output at that position.',
  '',
].join('\n')

function forgetSessions(run: Running) {
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
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

/** Claude Code（Sonnet · Low）：effort 在 AI 对话的引擎条上选，旁支也照它 */
async function lowEffort(page: Page) {
  await openAi(page)
  const chat = page.getByRole('complementary', { name: /^(AI 对话|AI chat)$/ })
  await chat.getByTestId('ai-effort').click()
  await page.getByRole('menu', { name: /effort/ }).getByRole('menuitemradio', { name: /^Low/ }).click()
}

/** 在 scope 里用鼠标从 from 拖到 to（真拖） */
async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (w.nextNode()) {
        const n = w.currentNode as Text
        const i = n.data.indexOf(a!)
        const j = n.data.indexOf(b!, i)
        if (i < 0 || j < 0) continue
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, j + b!.length)
        const rs = r.getClientRects()
        return [rs[0]!.left + 1, rs[0]!.top + rs[0]!.height / 2, rs[rs.length - 1]!.right - 1, rs[rs.length - 1]!.top + rs[rs.length - 1]!.height / 2]
      }
      throw new Error('没找到那一句')
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

test('英文界面：文档 AI 讲解里选一句开旁支，空着回车问「Explain this」，真问真答，写进文档的问答是英文', async () => {
  const run = await launch({ 'Attention.md': DOC }, { CN_AI_MODEL: 'sonnet', CN_LANG: 'en' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, 'Attention.md'), 'utf8')
  try {
    await lowEffort(page)
    await page.keyboard.press('Meta+k')
    await page.getByRole('dialog', { name: 'Search and commands' }).getByRole('textbox').first().fill('Attention')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('tab-on')).toHaveText('Attention')
    const content = pane(page).locator('.cm-content')
    await selectText(page, content, 'Finally the weights', 'that position.')
    const box = page.getByRole('dialog', { name: 'Selected sentence' })
    await expect(box).toBeVisible()
    const q = box.getByRole('textbox', { name: 'Ask about this' })
    await expect(q).toHaveAttribute('placeholder', 'Ask about this…')
    await q.press('Enter')
    const side = pane(page).getByRole('region', { name: 'Side thread' })
    await expect(side).toBeVisible()
    await expect(side.getByRole('textbox', { name: 'Ask AI' })).toHaveAttribute('placeholder', 'Ask about this… (↵ alone: “Explain this”)')
    await side.getByRole('textbox', { name: 'Ask AI' }).press('Enter')
    // 答好了写进这篇：「> [!side] Explain this」挂在讲解下面
    await expect.poll(file, { timeout: 200_000, intervals: [2000] }).toContain('> [!side] Explain this')
    await expect.poll(() => file().split('> [!side] Explain this')[1]?.replace(/^>\s*>.*$/m, '').trim().length ?? 0, { timeout: 200_000, intervals: [2000] }).toBeGreaterThan(20)
    const answer = file().split('> [!side] Explain this')[1]!
    console.log(`旁支问答：${answer}`)
    expect(HAN.test(answer)).toBe(false)
  } finally {
    try {
      await run.close()
    } finally {
      forgetSessions(run)
    }
  }
})
