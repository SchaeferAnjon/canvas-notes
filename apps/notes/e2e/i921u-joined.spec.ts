/**
 * 数据库第三批四块接上（task-i921u）：同一篇文档里从视图标签条切到看板、日历、画廊（不用把它们挪到第一个视图），
 * 点卡片、日历条、画廊卡、表格里的关联小块都在右栏「记录」标签开那一条，↑ ↓ 照点开它的那个视图的顺序；
 * 右栏「练习」那一行点开的是第 5 块的关联选择，勾一下两篇各写一行（和 packages/format 的 toggleRelation 一字不差），撤回回去。
 * CN_SHOTS=目录 [CN_SHOT_TONE=dark] 时顺便截一组图。
 */
import { baseContext, cardColumns, parseBaseDoc, queryView, toggleRelation } from '@cn/format'
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ECP_BASE, ECP_DOC, EXERCISES, LECTURES, records } from '../../../packages/format/test/base-samples'
import { launch, openNote, pane, tabOn } from './app'

const DOC = '课程/ecp/ecp 课程计划.md'
const FILES: Record<string, string> = { [DOC]: ECP_DOC, ...LECTURES, ...EXERCISES }
const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const ctx = () => baseContext(parseBaseDoc(ECP_BASE), records({ ...LECTURES, ...EXERCISES }))

const skin = (vault: string) => {
  if (!DIR) return
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
async function shot(page: Page, n: string) {
  if (!DIR) return
  mkdirSync(DIR, { recursive: true })
  await page.mouse.move(1430, 880)
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(DIR, `joined-${DARK ? 'dark' : 'light'}-${n}.png`) })
}

const db = (page: Page) => pane(page).locator('[data-part="数据库块"]')
const peek = (page: Page) => page.locator('.rpeek')
const recTab = (page: Page) => page.getByTestId('dtab-record')
/** 切视图：标签摆得开就点标签；右栏开着、标签收成下拉时从下拉里挑（两种都是用户会点的） */
async function pickView(page: Page, name: string) {
  const bar = db(page).locator('[data-part="视图标签条"]')
  if (await bar.getByRole('tab').count()) return bar.getByRole('tab', { name, exact: true }).click()
  await bar.getByRole('button', { name: /^切换视图：/ }).click()
  await page.getByRole('menu', { name: '视图' }).getByRole('group', { name: '视图' }).getByRole('menuitemradio', { name, exact: true }).click()
}

test('四块接上：标签条切到看板 / 日历 / 画廊，点一条在右栏开（↑ ↓ 照这个视图的顺序）；表格关联小块在右栏开；右栏「练习」点开关联选择，勾一下两篇各一行、撤回', async () => {
  const run = await launch(FILES, {}, skin)
  const { page, vault, app } = run
  const read = (p: string) => readFileSync(join(vault, p), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, 'ecp 课程计划')
    await expect(db(page).locator('.base-count')).toHaveText('8 条')

    // 视图标签条「+」：四种看法下面最后一行「AI 生成一列」，点了右栏开「AI 生成一列」那一页；只开不写
    await db(page).getByRole('button', { name: '加一个视图' }).click()
    const addMenu = page.getByRole('menu', { name: '加一个视图' })
    await expect(addMenu.getByRole('menuitem')).toHaveText(['表格', '看板', '日历', '画廊', /^AI 生成一列/])
    await shot(page, '0-加视图菜单')
    await addMenu.getByRole('menuitem', { name: /AI 生成一列/ }).click()
    await expect(page.locator('.dtab[data-view="aicol"] .dname')).toHaveText('AI 生成一列')
    await expect(addMenu).toHaveCount(0)
    expect(readFileSync(join(vault, DOC), 'utf8')).toBe(ECP_DOC)

    // 看板：第二个视图，从标签条切过去就是三列
    await pickView(page, '看板')
    const cols = db(page).locator('[data-part="看板一列"]')
    await expect(cols).toHaveCount(3)
    await expect(cols.locator('.bl-khead')).toHaveText(['未开始4', '在学2', '学完2'])
    await expect(db(page).locator('table')).toHaveCount(0)
    // 卡片下面露的列和 packages/format 算的一样
    expect(cardColumns(ctx(), 1, '状态').length).toBeGreaterThan(0)
    await cols.locator('.bl-kcard', { hasText: '第3讲 生产' }).click()
    await expect(recTab(page)).toHaveText('第3讲 生产')
    await expect(tabOn(page)).toHaveText('ecp 课程计划')
    await expect(peek(page).locator('.rec-title')).toHaveText('第3讲 生产')
    await shot(page, '1-看板点开')
    // ↓ 照看板这个视图的顺序换下一条
    const order = queryView(ctx(), 1).rows.map((r) => r.name)
    const next = order[order.indexOf('第3讲 生产') + 1]!
    await page.getByRole('button', { name: '下一条', exact: true }).click()
    await expect(recTab(page)).toHaveText(next)

    // 日历：点一条在右栏开
    await pickView(page, '日历')
    const chip = db(page).locator('.cal-chip', { hasText: '第4讲 市场结构' })
    await expect(chip).toBeVisible()
    await chip.click()
    await expect(recTab(page)).toHaveText('第4讲 市场结构')
    await shot(page, '2-日历点开')

    // 画廊：点卡片在右栏开
    await pickView(page, '画廊')
    const cards = db(page).locator('.bl-gcard')
    await expect(cards).toHaveCount(8)
    await cards.filter({ hasText: '第5讲 博弈初步' }).click()
    await expect(recTab(page)).toHaveText('第5讲 博弈初步')
    await shot(page, '3-画廊点开')

    // 表格（全部）：关联小块在右栏开那一题
    await pickView(page, '全部')
    const row3 = db(page).locator('tbody tr', { hasText: '第3讲 生产' })
    await row3.locator('.base-rel').first().scrollIntoViewIfNeeded()
    await row3.getByRole('button', { name: '打开「练习 3.1」' }).click()
    await expect(recTab(page)).toHaveText('练习 3.1')
    await expect(tabOn(page)).toHaveText('ecp 课程计划')
    await shot(page, '4-关联小块点开')

    // 右栏「练习」那一行：第 5 块的关联选择，勾「练习 4.1」两篇各写一行
    await db(page).getByRole('button', { name: '第3讲 生产', exact: true }).click()
    await expect(recTab(page)).toHaveText('第3讲 生产')
    const row = peek(page).locator('.rec-row[data-col="练习"] .v')
    const box = (await row.boundingBox())!
    await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2)
    const pick = page.getByRole('dialog', { name: '第3讲 生产 · 练习' })
    await expect(pick).toBeVisible()
    await shot(page, '5-右栏关联选择')
    const ws = toggleRelation(ctx(), '课程/ecp/课程计划/第3讲 生产.md', '练习', '练习 4.1', true)
    expect(ws).toHaveLength(2)
    await pick.getByRole('menuitemcheckbox', { name: /练习 4\.1/ }).click()
    for (const w of ws) await expect.poll(() => read(w.path)).toBe(w.after)
    await expect(peek(page).locator('.rec-row[data-col="练习"] .rec-rel')).toHaveText(['练习 3.1', '练习 3.2', '练习 4.1'])
    await page.keyboard.press('Escape')
    await page.getByTestId('toast').getByRole('button', { name: '撤回' }).click()
    for (const w of ws) await expect.poll(() => read(w.path)).toBe(w.before)
    expect(read(DOC)).toBe(ECP_DOC)
  } finally {
    await run.close()
  }
})
