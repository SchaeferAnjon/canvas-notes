/**
 * 表底合计（task-i921u「通用合计」，原型 automations/proto.html「表底算什么」「按月合计」「按分类占比」）：
 * 在测试模式里真点：表底一格点开选算法（公式列也能算）、日期列按月分组、组头小计（收起来也在）、组头占比条。
 * 每一步之后读盘，整篇和 packages/format 算出来的一样（只换 base 块那几行）；底部「撤回」回到上一步；全去掉回到原样，一个字不差。
 */
import { parseBaseDoc, setViewGroup, setViewSummary } from '@cn/format'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SUMS_BASE, SUMS_DOC, SUMS_ROWS } from '../../../packages/format/test/base-samples'
import { launch, openNote, pane } from './app'

const DOC = '生活/记账本.md'
/** 开始的样子：「按月」没分组、表底只算条数；「按分类」表底只有支出求和 */
const START = SUMS_BASE.replace('    groupBy:\n      property: 日期\n      by: month\n      direction: DESC\n', '')
  .replace('      formula.收入: Sum\n      formula.支出: Sum\n      formula.结余: Sum\n', '')
  .replace('      formula.支出: SumShare\n      分类: PercentFilled', '      formula.支出: Sum')
const withBase = (b: string) => SUMS_DOC.replace(SUMS_BASE, b)
const SUB = '只改 记账本.md 里 base 块的那几行'
const toast = (page: Page) => page.getByTestId('toast')
const tool = (db: Locator, name: string) => db.locator('.base-tools').getByRole('button', { name, exact: true })
const foot = (db: Locator, col: string) => db.locator(`tr.base-sums td[data-col="${col}"]`)

/** 点表底一格：表宽过中栏时先横着滚到那一格、停稳再点（滚动会收起浮层） */
async function openSum(page: Page, db: Locator, col: string) {
  const btn = foot(db, col).getByRole('button')
  await btn.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await btn.click()
}

async function pick(page: Page, db: Locator, col: string, label: string, item: string) {
  await openSum(page, db, col)
  const menu = page.getByRole('menu', { name: `「${label}」算什么 · 这个视图` })
  await expect(menu).toBeVisible()
  // 每样后面带着算出来的数（「求和5,656」）；「求和」不要点成「求和，组里画占比」
  await menu.getByRole('menuitemradio').filter({ hasText: new RegExp('^' + item + '(?![，占])') }).click()
  await expect(menu).toHaveCount(0)
}

test('表底合计：表底一格选算法（公式列也算）、按月分组、全收起看每月小计、组头占比条；每步只换 base 块那几行，撤回回到上一步，全去掉回到原样', async () => {
  expect(START).not.toBe(SUMS_BASE)
  expect(parseBaseDoc(START).views[0]!.groupBy).toBeNull()
  const run = await launch({ [DOC]: withBase(START), ...SUMS_ROWS })
  const { page, vault, app } = run
  const file = () => readFileSync(join(vault, DOC), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '记账本')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('.base-count')).toHaveText('10 条')
    await expect(foot(db, 'file.name')).toHaveText('条数10条')

    // 1. 点表底「支出」那一格：菜单照原型（不算、数字七种、计数六种，每样后面是现在算出来的数，最下面一句说明）
    await openSum(page, db, 'formula.支出')
    const menu = page.getByRole('menu', { name: '「支出」算什么 · 这个视图' })
    await expect(menu.getByRole('menuitemradio')).toHaveText([
      '不算',
      '求和5,656',
      '求和，组里画占比5,656',
      '平均808',
      '中位数89',
      '最小6',
      '最大2,600',
      '最大减最小2,594',
      '全部条数10条',
      '有值的7',
      '空着的3',
      '不同的值6',
      '有值的占几成70%',
      '空着的占几成30%',
    ])
    await expect(menu.getByRole('menuitemradio', { name: '不算' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu).toContainText('分组时每组按同一种算法出小计')
    await page.screenshot({ path: 'test-results/i921u-sums-menu.png' })
    // 打开菜单不写文件
    await page.waitForTimeout(400)
    expect(file()).toBe(withBase(START))
    await menu.getByRole('menuitemradio').filter({ hasText: /^求和5,656$/ }).click()
    const s1 = setViewSummary(START, 0, 'formula.支出', 'Sum')
    await expect.poll(file).toBe(withBase(s1))
    await expect(toast(page)).toContainText(`「按月」表底「支出」改成「求和」 · ${SUB}`)
    await expect(foot(db, 'formula.支出')).toHaveText('求和5,656')

    // 收入、结余（公式列）也求和
    await pick(page, db, 'formula.收入', '收入', '求和')
    const s2 = setViewSummary(s1, 0, 'formula.收入', 'Sum')
    await expect.poll(file).toBe(withBase(s2))
    await pick(page, db, 'formula.结余', '结余', '求和')
    const s3 = setViewSummary(s2, 0, 'formula.结余', 'Sum')
    await expect.poll(file).toBe(withBase(s3))
    await expect(foot(db, 'formula.收入')).toHaveText('求和25,200')
    await expect(foot(db, 'formula.结余')).toHaveText('求和19,544')

    // 换成平均：只换那一行；底部「撤回」回到求和
    await pick(page, db, 'formula.支出', '支出', '平均')
    const s4 = setViewSummary(s3, 0, 'formula.支出', 'Average')
    await expect.poll(file).toBe(withBase(s4))
    await expect(foot(db, 'formula.支出')).toHaveText('平均808')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(file).toBe(withBase(s3))
    await expect(foot(db, 'formula.支出')).toHaveText('求和5,656')

    // 日期列：最早、跨了几天；勾选列：勾了的占几成
    await pick(page, db, '日期', '日期', '跨了几天')
    const s5 = setViewSummary(s3, 0, '日期', 'Range')
    await expect.poll(file).toBe(withBase(s5))
    await expect(foot(db, '日期')).toHaveText('跨了327天')

    // 2. 分组：日期按月（新的在前）
    await tool(db, '分组').click()
    const gmenu = page.getByRole('menu', { name: '分组' })
    await expect(gmenu.getByRole('menuitemradio', { name: '日期 · 按月' })).toBeVisible()
    await expect(gmenu.getByRole('menuitemradio', { name: '日期 · 按周' })).toBeVisible()
    await gmenu.getByRole('menuitemradio', { name: '日期 · 按月' }).click()
    const s6 = setViewGroup(s5, 0, { prop: '日期', by: 'month', desc: true })
    await expect.poll(file).toBe(withBase(s6))
    await expect(toast(page)).toContainText(`按月分组，存进了「按月」 · ${SUB}`)
    await expect(tool(db, '分组')).toHaveText('按月分组')
    const heads = db.locator('tr.base-grp')
    await expect(heads.locator('td.gl')).toHaveText(['11月4', '10月3', '9月1', '2025年12月1', '没填1'])
    // 组头小计：和表底同一种算法，写在组头那一行同一列
    const nov = heads.filter({ hasText: '11月' })
    await expect(nov.locator('td.gv[data-col="formula.收入"]')).toHaveText('8,800')
    await expect(nov.locator('td.gv[data-col="formula.支出"]')).toHaveText('2,647')
    await expect(nov.locator('td.gv[data-col="formula.结余"]')).toHaveText('6,153')
    await expect(nov.locator('td.gv[data-col="日期"]')).toHaveText('21天')
    await page.screenshot({ path: 'test-results/i921u-sums-month.png' })

    // 3. 全收起：每月一行，小计还在，就是一张月度汇总；文件不动（收起记在本机）
    const before = file()
    for (const h of ['11月', '10月', '9月', '2025年12月', '没填']) await heads.filter({ hasText: h }).getByRole('button').click()
    await expect(db.locator('tbody tr:not(.base-grp)')).toHaveCount(0)
    await expect(nov.locator('td.gv[data-col="formula.支出"]')).toHaveText('2,647')
    await expect(heads.filter({ hasText: '10月' }).locator('td.gv[data-col="formula.收入"]')).toHaveText('8,200')
    await expect(foot(db, 'formula.收入')).toHaveText('求和25,200')
    await page.screenshot({ path: 'test-results/i921u-sums-folded.png' })
    await page.waitForTimeout(600)
    expect(file()).toBe(before)
    // 分组的撤回：回到没分组
    await tool(db, '分组').click()
    await page.getByRole('menu', { name: '分组' }).getByRole('menuitemradio', { name: '日期 · 按周' }).click()
    const s7 = setViewGroup(s6, 0, { prop: '日期', by: 'week', desc: true })
    await expect.poll(file).toBe(withBase(s7))
    await expect(heads.first().locator('td.gl')).toHaveText('第47周2')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(file).toBe(withBase(s6))

    // 4. 「按分类」视图：支出改成「求和，组里画占比」，组头画占比条
    await db.getByRole('tab', { name: '按分类' }).click()
    await expect(db.getByRole('tab', { selected: true })).toHaveText('按分类')
    await expect(db.locator('[data-part="占比条"]')).toHaveCount(0)
    await pick(page, db, 'formula.支出', '支出', '求和，组里画占比')
    const s8 = setViewSummary(s6, 1, 'formula.支出', 'SumShare')
    await expect.poll(file).toBe(withBase(s8))
    await expect(toast(page)).toContainText(`「按分类」表底「支出」改成「求和，组里画占比」 · ${SUB}`)
    const cats = db.locator('tr.base-grp')
    await expect(cats.filter({ hasText: '住房' }).locator('[data-part="占比条"]')).toHaveText('92%')
    await expect(cats.filter({ hasText: '住房' }).locator('[data-part="占比条"]')).toHaveAttribute('aria-label', '占「支出」的 92%')
    await expect(cats.filter({ hasText: '住房' }).locator('td.gv[data-col="formula.支出"]')).toHaveText('5,200')
    // 条的宽照占比画（150 宽的条，住房 92%）
    const w = await cats.filter({ hasText: '住房' }).locator('[data-part="占比条"] .tr').evaluate((el) => [el.getBoundingClientRect().width, el.querySelector('b')!.getBoundingClientRect().width])
    expect(Math.round((w[1]! / w[0]!) * 100)).toBe(92)
    await expect(foot(db, 'formula.支出')).toHaveText('求和5,656')
    await page.screenshot({ path: 'test-results/i921u-sums-share.png' })

    // 5. 全去掉：一个个改回去，回到原样，一个字不差
    await pick(page, db, 'formula.支出', '支出', '求和')
    await db.getByRole('tab', { name: '按月' }).click()
    await tool(db, '分组').click()
    await page.getByRole('menu', { name: '分组' }).getByRole('menuitemradio', { name: '不分组' }).click()
    for (const [col, label] of [
      ['formula.支出', '支出'],
      ['formula.收入', '收入'],
      ['formula.结余', '结余'],
      ['日期', '日期'],
    ] as const)
      await pick(page, db, col, label, '不算')
    await expect.poll(file).toBe(withBase(START))
  } finally {
    await run.close()
  }
})
