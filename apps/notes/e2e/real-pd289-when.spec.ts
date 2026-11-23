/**
 * 真的 Haiku 认时间（task-pd289）：CN_REAL_AI=1 才跑。本机 Claude Code（设置 › AI「小活」默认就是 Claude Code · Haiku），
 * 用 API 额度那把 key：ANTHROPIC_API_KEY="$(dispatch env get CN_TEST_ANTHROPIC_API_KEY)" 交给这次测试（不写进仓库、日志）。
 * 不给工具、不留会话记录（--no-session-persistence），8 秒超时。
 */
import { expect, test } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, openNote, pane, waitSaved } from './app'

test.skip(process.env.CN_REAL_AI !== '1', '真 AI：CN_REAL_AI=1 才跑')

test('真 Haiku：「圣诞节前买礼物」本地认不出，问 Haiku，出灰字，Tab 收下写成 📅 12 月 25 日（截止那天）', async () => {
  test.setTimeout(90_000)
  const log = join(mkdtempSync(join(tmpdir(), 'cn-pd289-real-')), 'when.log')
  const run = await launch({ '写作/计划.md': '# 计划\n\n- [ ] 写提纲\n\n最后一段。\n' }, { CN_FAKE_WHEN_LOG: log })
  const { page } = run
  try {
    await openNote(page, '计划')
    const ed = pane(page).locator('.cm-content')
    await ed.locator('.cm-line', { hasText: '写提纲' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    const t0 = Date.now()
    await page.keyboard.type('圣诞节前买礼物')
    const ghost = page.getByTestId('when-ghost')
    await expect(ghost).toBeVisible({ timeout: 20_000 })
    const ms = Date.now() - t0
    const tail = await ghost.textContent()
    console.log(`真 Haiku：${ms} 毫秒（含停手 0.6 秒），灰字「${tail}」`)
    expect(tail).toMatch(/📅 \d{4}-12-25/)
    await page.keyboard.press('Tab')
    await waitSaved(page)
    expect(readFileSync(join(run.vault, '写作/计划.md'), 'utf8')).toMatch(/\n- \[ \] 买礼物 📅 \d{4}-12-25\n/)
    const asked = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { text: string; engine: string; model: string })
    expect(asked[0]).toMatchObject({ text: '圣诞节前买礼物', engine: 'claude', model: 'haiku' })
  } finally {
    await run.close()
  }
})
