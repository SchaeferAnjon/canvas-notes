/**
 * 表格格子编辑时字看得全（0.5.15 补丁）的改前改后对照图：同一张自造的行程表，点长内容那一格、再打一串字，截表格那一块；
 * 再点一格短的、一格没有记号的长格子，深色主题再点一次长格子。
 * 只在截图时跑：CN_SHOTS=目录。改前改后各用对应的构建跑一次。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane } from './app'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')
test.setTimeout(120_000)

const LONG = '集合点在雷克雅未克 BSÍ 车站，导游说冬季路况要看前一天的预报，如果下雪就改走一号公路南线：**待确认**'
const NOTE = `# 冰岛行程备忘

下面这张表记每天的安排。

| 日期 | 路线 | 住哪 | 集合 | 备注 |
|---|---|---|---|---|
| 2.24 | 机场 → 塞尔福斯 | 塞尔福斯旅馆 | 早上 9 点 | 先取车 |
| 2.25 | 黄金圈 | 赫拉山小屋 | ${LONG} | 带冰爪 |
| 2.26 | 南海岸 | 维克 | 早上 8 点 | 看黑沙滩，下午去斯科加瀑布，天黑前赶到维克镇上的超市买午饭 |

最后一段。
`

const table = (page: Page) => pane(page).locator('[data-part="表格"]').first()

async function shot(page: Page, name: string) {
  await page.mouse.move(5, 5)
  await page.waitForTimeout(200)
  const b = (await table(page).boundingBox())!
  await page.screenshot({ path: join(DIR!, name), clip: { x: b.x - 24, y: b.y - 16, width: b.width + 48, height: b.height + 32 } })
}

/** 点格子里某串字的第 nth 个字右半边 */
async function clickAt(page: Page, row: number, col: number, needle: string, nth: number) {
  const p = await table(page)
    .locator(`[data-row="${row}"][data-col="${col}"]`)
    .evaluate(
      (el, [needle, nth]) => {
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const at = n.textContent!.indexOf(needle as string)
          if (at < 0) continue
          const r = document.createRange()
          r.setStart(n, at + (nth as number))
          r.setEnd(n, at + (nth as number) + 1)
          const b = r.getBoundingClientRect()
          return { x: b.left + b.width * 0.75, y: b.top + b.height / 2 }
        }
        throw new Error('没找到 ' + needle)
      },
      [needle, nth] as const,
    )
  await page.mouse.click(p.x, p.y)
  await expect(pane(page).locator('.cm-cellin')).toBeFocused()
}

async function open(dark: boolean) {
  const run = await launch({ '冰岛行程备忘.md': NOTE }, {}, (vault) => {
    if (!dark) return
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'petrol', frame: 'b', winBg: 'aurora' } }))
  })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
  await openNote(run.page, '冰岛行程备忘')
  await expect(table(run.page).locator('tbody tr')).toHaveCount(3)
  return run
}

test('行程表：点长内容的一格、打字，点短格子、没有记号的长格子，截表格', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await open(false)
  const { page } = run
  try {
    await shot(page, '1-平时.png')
    await clickAt(page, 1, 3, '预报', 1)
    await shot(page, '2-点进去.png')
    await page.keyboard.type('（周一再打电话问一次车站）')
    await shot(page, '3-打字后.png')
    await page.keyboard.press('Escape')
    await clickAt(page, 0, 3, '早上', 1)
    await shot(page, '4-点短格子.png')
    await page.keyboard.press('Escape')
    await clickAt(page, 2, 4, '瀑布', 1)
    await shot(page, '5-点没有记号的长格子.png')
  } finally {
    await run.close()
  }
})

test('深色主题：点长内容的一格，截表格', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await open(true)
  const { page } = run
  try {
    await shot(page, '6-深色-平时.png')
    await clickAt(page, 1, 3, '预报', 1)
    await shot(page, '7-深色-点进去.png')
  } finally {
    await run.close()
  }
})
