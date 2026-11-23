// 用本机真的 Claude Code 走一遍自动化的界面（task-i921u「当……就……」方向 B）：右栏「自动化」里说一句 → AI 填成三段（列名、选项对得上）→ 试跑 → 存 → 块里多一条。
// 要联网、花一点额度，平时跳过（同 e2e/real-i921u-auto.spec.ts 的跑法）：
//   env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TMPDIR="$TMPDIR" ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" \
//     CN_REAL_AI=1 npx playwright test e2e/real-i921u-auto-ui.spec.ts
// 测试模式（窗口不上屏幕）、临时库、临时设置目录；CN_AI_MODEL=sonnet。跑完只收走这次产生的 Claude 会话记录
// （不直接删：挪进 CN_TRASH_LATER 给的文件夹、清单里记一行，没给就删）。
import { expect, test } from '@playwright/test'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Running } from './app'
import { parseAutomations } from '@cn/format'
import { LEDGER_DOC_PATH, LEDGER_FILES } from './auto-samples'
import { launch, openNote, pane } from './app'

test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
test.setTimeout(10 * 60_000)

/** 这次跑出来的 Claude 会话记录（临时库那个文件夹名在路径里的那几个，同 real-i921u-auto.spec.ts 的认法）：收走 */
function forgetSessions(run: Running) {
  const claude = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
  const projects = join(claude, 'projects')
  const stamp = dirname(run.vault).split('/').pop()!
  const mine = existsSync(projects) ? readdirSync(projects).filter((d) => d.includes(stamp)) : []
  const later = process.env.CN_TRASH_LATER
  for (const d of mine) {
    const from = join(projects, d)
    if (!later) {
      rmSync(from, { recursive: true, force: true })
      continue
    }
    mkdirSync(later, { recursive: true })
    renameSync(from, join(later, d))
    appendFileSync(join(dirname(later), '清单.md'), `- ${from} · 自动化界面真 AI 测试这一次的 Claude 会话记录（task-i921u）\n`)
  }
  console.log(`收走了这次的会话记录：${mine.join('、') || '（没有）'}`)
}

test('真 AI：说一句「分类改成报销就提醒我下周一交报销单」，填成规则、试跑、存', async () => {
  const run = await launch(LEDGER_FILES, { CN_AI_MODEL: 'sonnet', CN_AUTO_SETTLE_MS: '400' })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '2026 记账')
    const db = pane(page).locator('[data-part="数据库块"]').first()
    await expect(db.locator('tbody tr')).toHaveCount(14)
    await db.locator('[data-part="自动化入口"]').click()
    const side = page.getByTestId('dview-auto')
    await side.getByRole('textbox', { name: '说一句' }).fill('分类改成报销，就提醒我下周一交报销单')
    await side.getByRole('button', { name: '填成规则 ↵' }).click()
    await expect(side.locator('.au-filled')).toContainText('填好了', { timeout: 180_000 })
    const name = await side.getByRole('textbox', { name: '规则叫什么' }).inputValue()
    console.log('AI 起的名字：', name)
    await expect(side.locator('[data-part="当"] .trow .ch').first()).toContainText('「分类」改成「报销」')
    await expect(side.locator('[data-part="一步"]').first()).toContainText('加一条待办或提醒')
    await side.getByRole('button', { name: '试跑' }).click()
    await expect(side.locator('[data-part="试跑"]')).toContainText('拿《')
    await side.getByRole('button', { name: '存', exact: true }).click()
    await expect.poll(() => parseAutomations(/```base\n([\s\S]*?)\n```/.exec(readFileSync(join(vault, LEDGER_DOC_PATH), 'utf8'))?.[1] ?? '').length).toBe(1)
    const rule = parseAutomations(/```base\n([\s\S]*?)\n```/.exec(readFileSync(join(vault, LEDGER_DOC_PATH), 'utf8'))![1]!)[0]!
    console.log('存进去的：', JSON.stringify(rule))
    expect(rule.when).toEqual([{ on: 'changed', prop: '分类', to: '报销' }])
    expect(rule.do.some((s) => s.do === 'todo')).toBe(true)
  } finally {
    await run.close()
    forgetSessions(run)
  }
})
