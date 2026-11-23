// 用本机真的 Claude Code 走一遍自动化（task-i921u「当……就……」）：一句话填成规则（列名、选项对得上）→ 存 → 在表格里改格子触发 →
// AI 写这一格（规则里的 ai: cell）→ 深链跑周记（AI 本周摘要）。要联网、花一点额度，平时跳过：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" \
//     CN_REAL_AI=1 npx playwright test e2e/real-i921u-auto.spec.ts
// （在 Claude Code 的终端里跑要去掉父会话的 CLAUDE_* 环境变量；测试用的 API key 只在运行时从 dispatch env 读，不写进任何文件、不打印）。
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet，AI 对话那一行设成 Low。跑完只删这次产生的 Claude 会话记录。
import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { isoWeekOf, parseLog } from '@cn/format'
import { launch, openNote, pane, type Running } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(15 * 60_000)

const DOC = '生活/2026 记账.md'
const BASE = 'filters:\n  and:\n    - file.inFolder("生活/账目")\nproperties:\n  分类:\n    type: select\nviews:\n  - type: table\n    name: 全部\n    order:\n      - file.name\n      - 金额\n      - 收支\n      - 分类'
const FILES: Record<string, string> = {
  [DOC]: `# 2026 记账\n\n\`\`\`base\n${BASE}\n\`\`\`\n`,
  '生活/账目/外卖.md': '---\n金额: 41\n收支: 支出\n分类: 餐饮\n---\n',
  '生活/账目/地铁.md': '---\n金额: 4\n收支: 支出\n分类: 交通\n---\n',
  '生活/账目/工资.md': '---\n金额: 12000\n收支: 收入\n分类: 工资\n---\n',
  '生活/账目/机场打车.md': '---\n金额: 620\n收支: 支出\n---\n打车去机场。\n',
  '课程/第3讲.md': '# 第3讲\n\n边际产量先升后降。\n\n- [x] 交小论文提纲 ✅ ' + new Date().toISOString().slice(0, 10) + '\n',
}
const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')
const logOf = (vault: string) => {
  const dir = join(vault, '.canvas-notes/自动化记录')
  return existsSync(dir) ? readdirSync(dir).flatMap((n) => parseLog(readFileSync(join(dir, n), 'utf8'))) : []
}
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
  console.log(`删掉了这次的会话记录：${mine.join('、') || '（没有）'}（会话 ${ids.length} 个）`)
}

test('真 Claude Code：一句话填规则、存、改格子触发 AI 写一格、深链跑周记', async () => {
  const run = await launch(FILES, { CN_AI_MODEL: 'sonnet', CN_AUTO_SETTLE_MS: '500' })
  const { page, vault, app } = run
  try {
    await page.evaluate(() => {
      const pick = { engine: 'claude' as const, model: 'sonnet', effort: 'low' }
      return window.cn.aiSetPrefs({ default: pick, features: { chat: pick } })
    })
    const where = `${DOC}#0`
    // 一句话 → 规则
    const said = await page.evaluate((w) => window.cn.auto.fromSentence({ sentence: '金额改了而且是支出、分类空着的时候，让 AI 照名字猜分类，只从已有的分类里选', where: w }), where)
    console.log('AI 填的规则：', JSON.stringify(said))
    expect(said.ok).toBe(true)
    if (!said.ok) return
    expect(said.problems).toEqual([])
    expect(said.rule.when.some((w) => w.on === 'changed' && w.prop === '金额')).toBe(true)
    expect(said.rule.do.some((s) => s.do === 'ai' && s.ai === 'cell' && s.prop === '分类')).toBe(true)
    expect(await page.evaluate(({ w, r }) => window.cn.auto.save({ where: w, index: null, rule: r as never }), { w: where, r: JSON.parse(JSON.stringify(said.rule)) as unknown })).toMatchObject({ ok: true })

    // 在表格里真改「机场打车」的金额：触发规则，真 AI 写分类
    await openNote(page, '2026 记账')
    const db = pane(page).locator('[data-part="数据库块"]')
    await db.locator('tbody tr', { hasText: '机场打车' }).locator('td').nth(1).dblclick()
    const box = db.locator('input.base-in[aria-label="机场打车 · 金额"]')
    await box.fill('630')
    await box.press('Enter')
    await expect.poll(() => logOf(vault).length, { timeout: 5 * 60_000 }).toBe(1)
    const e = logOf(vault)[0]!
    console.log('记录：', JSON.stringify(e))
    expect(e.ok).toBe(true)
    expect(read(vault, '生活/账目/机场打车.md')).toMatch(/分类: (交通|餐饮|工资)/)

    // 深链跑周记：真 AI 写本周摘要
    await app.evaluate(({ app: a }) => a.emit('open-url', { preventDefault() {} }, 'canvas-notes://automation/run?name=%E5%91%A8%E8%AE%B0'))
    const w = isoWeekOf(new Date())
    const note = `周记/${w.year}-W${String(w.week).padStart(2, '0')}.md`
    await expect.poll(() => logOf(vault).length, { timeout: 5 * 60_000 }).toBe(2)
    const week = logOf(vault)[1]!
    console.log('周记记录：', JSON.stringify(week))
    expect(week.ok).toBe(true)
    const text = read(vault, note)
    console.log('周记：\n' + text)
    expect(text).toContain('> [!ai] AI 本周摘要 · Claude Code')
    expect(execFileSync('git', ['-C', vault, 'status', '--porcelain'], { encoding: 'utf8' }).split('\n').filter((l) => l && !l.includes('机场打车'))).toEqual([])
  } finally {
    forgetSessions(run)
    await run.close()
  }
})
