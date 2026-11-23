/**
 * 表底合计（task-i921u「通用合计」）的对照截图：和原型 automations/proto.html 同样的 28 笔数据（从原型里读出来），
 * 三个状态：「按月」全收起看每月小计、点表底「支出」出算什么的菜单、「本月按分类」组头占比条。B 浮岛书桌、天青（浅）/ 深湖（深）。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色；CN_SHOT_PROTO=原型 proto.html 的路径。交互的验收在 i921u-sums.spec.ts。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane } from './app'

const DIR = process.env.CN_SHOTS
const PROTO = process.env.CN_SHOT_PROTO
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TONE = DARK ? 'dark' : 'light'
test.skip(!DIR || !PROTO, '只在截交付图时跑（CN_SHOTS=目录，CN_SHOT_PROTO=原型）')

const BASE = `filters:
  and:
    - file.inFolder("生活/账目")
formulas:
  收入: if(收支 == "收入", 金额, "")
  支出: if(收支 == "支出", 金额, "")
  结余: if(收支 == "收入", 金额, 0 - 金额)
views:
  - type: table
    name: 按月
    order: [file.name, 日期, 金额, 分类, 收支, formula.收入, formula.支出, formula.结余]
    groupBy:
      property: 日期
      by: month
      direction: DESC
    columnSize:
      file.name: 108
      日期: 96
      金额: 72
      分类: 80
      收支: 60
      formula.收入: 100
      formula.支出: 100
      formula.结余: 104
    summaries:
      file.name: Count
      formula.收入: Sum
      formula.支出: Sum
      formula.结余: Sum
  - type: table
    name: 本月按分类
    order: [file.name, 日期, 金额, 分类, 收支, formula.收入, formula.支出, formula.结余]
    filters:
      and:
        - 收支 == "支出"
        - 日期.month == today().month
    groupBy:
      property: 分类
      direction: ASC
    columnSize:
      file.name: 108
      日期: 96
      金额: 72
      分类: 80
      收支: 60
      formula.收入: 100
      formula.支出: 100
      formula.结余: 104
    summaries:
      file.name: Count
      formula.支出: SumShare
  - type: table
    name: 全部`

const skin = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

test('表底合计对照截图', async () => {
  mkdirSync(DIR!, { recursive: true })
  const rows = [...readFileSync(PROTO!, 'utf8').matchAll(/R\('([^']+)', '([^']+)', (\d+), '([^']*)', '([^']+)'\)/g)]
  expect(rows.length).toBeGreaterThan(20)
  const files: Record<string, string> = { '生活/2026 记账.md': `# 2026 记账\n\n每笔一条，月底看结余。分类不用自己填，记完它自己猜。\n\n\`\`\`base\n${BASE}\n\`\`\`\n` }
  for (const [, name, date, amt, cat, kind] of rows) files[`生活/账目/${name} ${date!.slice(5)}.md`] = `---\n日期: ${date}\n金额: ${amt}\n分类: ${cat}\n收支: ${kind}\n---\n`
  const run = await launch(files, {}, skin)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
    await openNote(page, '2026 记账')
    const db = pane(page).locator('[data-part="数据库块"]')
    const heads = db.locator('tr.base-grp')
    await expect(heads).toHaveCount(3)
    for (const h of ['11月', '10月', '9月']) await heads.filter({ hasText: h }).getByRole('button').click()
    await expect(db.locator('tbody tr:not(.base-grp)')).toHaveCount(0)
    await page.mouse.move(5, 400)
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(DIR!, `f1-按月合计-${TONE}.png`) })
    // 鼠标停在表底一行：没选的列露「计算 ▾」
    await db.locator('tr.base-sums td[data-col="日期"]').hover()
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(DIR!, `f1b-表底悬停-${TONE}.png`) })

    await db.locator('tr.base-sums td[data-col="formula.支出"] button').click()
    await expect(page.getByRole('menu', { name: '「支出」算什么 · 这个视图' })).toBeVisible()
    await page.waitForTimeout(300)
    await page.screenshot({ path: join(DIR!, `f2-表底算什么-${TONE}.png`) })
    await page.keyboard.press('Escape')

    await db.getByRole('tab', { name: '本月按分类' }).click()
    await expect(db.locator('[data-part="占比条"]').first()).toBeVisible()
    for (const h of await heads.locator('button.grp').all()) if ((await h.getAttribute('aria-expanded')) === 'true') await h.click()
    await page.mouse.move(5, 400)
    await page.waitForTimeout(500)
    await page.screenshot({ path: join(DIR!, `f3-按分类占比-${TONE}.png`) })
  } finally {
    await run.close()
  }
})
