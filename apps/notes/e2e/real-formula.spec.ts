// AI 看得到公式（2026-11-24）真问一遍：本机真的 Claude Code 读一篇双栏论文，翻到第 3 页问「公式 (1) 是什么」，
// 回答里要有原文公式 (1) 的 LeakyReLU 和 [W_i h_i ‖ W_j h_j] 拼接（以前只给拆散的文字层，AI 拿通常写法冒充原文）。
// 论文有版权不进仓库，用 E2E_PAPER 给（BST-GATNet）。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" \
//     CN_REAL_AI=1 E2E_PAPER=<BST-GATNet.pdf> CN_SHOTS=<截图目录> npx playwright test e2e/real-formula.spec.ts
// 跑完把这次临时库的 Claude 会话记录挪到 ~/待删/<日子>/，清单.md 记一行。
import { expect, test, type Page } from '@playwright/test'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { acts, launch, openAi, tabOn, type Running, widenRight } from './app'
import { shotPart } from './shots'

test.skip(!process.env.CN_REAL_AI || !process.env.E2E_PAPER, '真 AI 才跑：CN_REAL_AI=1 E2E_PAPER=<论文>')
test.setTimeout(10 * 60_000)

const PDF = '课程/论文/BST-GATNet.pdf'
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const box = (page: Page) => ai(page).getByRole('textbox', { name: '问 AI' })

const TRASH = join(homedir(), '待删', new Date().toISOString().slice(0, 10))
function forgetSessions(run: Running) {
  const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  for (const d of existsSync(projects) ? readdirSync(projects).filter((x) => x.includes(stamp)) : []) {
    const to = join(TRASH, 'ai-see-formula', d)
    mkdirSync(dirname(to), { recursive: true })
    renameSync(join(projects, d), to)
    appendFileSync(join(TRASH, '清单.md'), `- ${join(projects, d)} → ${to}：真 AI 测试（AI 看得到公式）这次的 Claude 会话记录\n`)
  }
}

test('真 Claude Code：第 3 页问公式 (1)，回答照原文写出 LeakyReLU 和 [W_i h_i ‖ W_j h_j] 拼接', async () => {
  const run = await launch({ [PDF]: readFileSync(process.env.E2E_PAPER!) }, { CN_AI_MODEL: 'sonnet' })
  const { page } = run
  try {
    await page.evaluate(() => window.cn.aiSetPrefs({ default: { engine: 'claude', model: 'sonnet', effort: 'low' }, features: { chat: { engine: 'claude', model: 'sonnet', effort: 'low' } } }))
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('BST-GATNet')
    await page.locator('.pal-row', { hasText: 'BST-GATNet' }).first().click()
    await expect(tabOn(page)).toHaveText('BST-GATNet.pdf')
    await openAi(page)
    await widenRight(page, 160)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文7页', { timeout: 30_000 })
    await acts(page).getByTestId('pdf-pager').getByRole('button').click()
    await page.getByRole('textbox', { name: '跳到第几页' }).fill('3')
    await page.keyboard.press('Enter')
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('3 / 7')
    await expect(ai(page).getByTestId('reading-sees')).toContainText('第3页')

    await box(page).fill('公式 (1) 是什么？照原文写出来，再解释每一项。')
    await box(page).press('Enter')
    const msg = ai(page).getByTestId('reading-msg').last()
    await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 5 * 60_000 })
    await expect(msg.locator('.txt')).not.toBeEmpty()
    const read = await msg.locator('.read').innerText()
    const text = await msg.locator('.txt').innerText()
    // KaTeX 排好后字里有 LeakyReLU、∥ 或 ‖，下标 W_i h_i 排成「Wi​hi​」
    const flat = text.replace(/[\s​]+/g, '')
    expect(read).toContain('看了公式图')
    expect(text).toMatch(/LeakyReLU/)
    expect(flat).toMatch(/[∥‖]|\\parallel|\\\|/)
    expect(flat).toMatch(/Wi.{0,3}hi|W_\{?i\}?\\?(mathbf\{)?h/)
    writeFileSync(join(process.env.CN_SHOTS ?? run.vault, 'cn-formula-claude.txt'), `${read}\n\n${text}`)
    await msg.locator('.read').scrollIntoViewIfNeeded()
    await shotPart(ai(page), 'cn-formula-claude')
  } finally {
    await run.close()
    forgetSessions(run)
  }
})
