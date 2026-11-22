// 真 Claude Code 在软件里出一次卡（task-tz7y3）：ecp 那份真实样子的 PDF 笔记，笔记栏点「出卡」，软件交给真 Claude Code（Sonnet、Low）改成卡，
// 逐张核 ChatCards 的出卡规矩（问题离开那一页也看得懂、答案不超过 40 字、原文摘句是材料里原样的一句），再送进假的 AnkiConnect。
// 平时跳过；真跑：env -i HOME="$HOME" USER="$USER" PATH="$PATH" TMPDIR="$TMPDIR" CN_REAL_AI=1 npx playwright test e2e/real-anki-cards.spec.ts
// 软件出卡不留会话记录（--no-session-persistence）；跑完把这次临时库在 ~/.claude/projects 里多出来的（只有这次的）删掉
import { cardProblems, type CardText, doubtItems } from '@cn/format'
import { expect, test } from '@playwright/test'
import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { launch, rail, tabOn } from './app'
import { ankiVault, fakeAnki, L5, L5_PAGES, L5_SECTIONS } from './fixtures/anki'

test.skip(process.env.CN_REAL_AI !== '1', '只在 CN_REAL_AI=1 时真问 AI')

test('真 Claude Code（Sonnet · Low）出 Lecture05 的 6 张卡，张张守 ChatCards 的规矩，送进 Anki', async () => {
  test.setTimeout(300_000)
  const projects = join(homedir(), '.claude', 'projects')
  const before = new Set(readdirSync(projects))
  const anki = await fakeAnki()
  const run = await launch(ankiVault(), { CN_ANKI_URL: anki.url, CN_AI_MODEL: 'sonnet' })
  const { page } = run
  try {
    // 设置 › 读PDF「改写成卡用哪家AI」：Claude Code，Low（CN_AI_MODEL 把默认的 Opus 换成 Sonnet）
    await page.evaluate(() => window.cn.aiSetPrefs({ default: { engine: 'claude', model: 'claude-opus-5-5' }, features: { cards: { engine: 'claude', model: 'claude-opus-5-5', effort: 'low' } } }))
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('Lecture05')
    await page.locator('.pal-row', { hasText: 'Lecture05.pdf' }).first().click()
    await expect(tabOn(page)).toHaveText('Lecture05.pdf')
    await rail(page).getByRole('button', { name: '笔记' }).click()
    const t0 = Date.now()
    await page.getByRole('complementary', { name: '笔记', exact: true }).getByRole('button', { name: '出卡 · 6问' }).click()
    const dlg = page.getByRole('dialog', { name: '出卡' })
    await expect(dlg.locator('.dh .sub')).toHaveText(/^改好了6张 · Claude Code/, { timeout: 240_000 })
    console.log(`改好 6 张用了 ${((Date.now() - t0) / 1000).toFixed(1)} 秒；${await dlg.locator('.dh .sub').textContent()}`)
    // 改好的卡在本机草稿里（四样字都有）
    const drafts = JSON.parse(readFileSync(join(run.userData, 'anki', 'drafts.json'), 'utf8')) as { vaults: Record<string, Record<string, { card: CardText }>> }
    const mine = Object.values(drafts.vaults)[0]!
    const items = L5_SECTIONS.flatMap((s) => doubtItems(L5, s, 5))
    const bad: string[] = []
    for (const it of items) {
      const card = mine[it.id]?.card
      expect(card, it.section.doubts[0]).toBeTruthy()
      const page = L5_PAGES[it.section.page - 1]!
      const problems = cardProblems(card!, [it.answer ?? '', it.quote ?? '', page.title, ...page.lines].join('\n'))
      console.log(`${it.section.doubts[0]} → ${card!.q} ｜ ${card!.a} ｜ 摘句：${card!.quote}${problems.length ? `\n   ✗ ${problems.join('；')}` : ''}`)
      bad.push(...problems)
    }
    expect(bad).toEqual([])
    await dlg.getByRole('button', { name: '送进Anki · 6张' }).click()
    await expect(page.getByTestId('toast')).toContainText('已送进Anki · 6张（牌组「课程::ecp」）')
    expect(anki.notes).toHaveLength(6)
  } finally {
    await run.close()
    await anki.close()
    // 只删这次的会话记录（临时库那个文件夹）
    for (const d of readdirSync(projects)) if (!before.has(d) && d.includes('cn-e2e')) rmSync(join(projects, d), { recursive: true, force: true })
  }
})
