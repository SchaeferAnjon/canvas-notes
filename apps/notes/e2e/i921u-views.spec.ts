/**
 * 数据库第三批第 3 块（task-i921u）：视图标签条、存视图（改了就存）、分组、筛选面板（且 / 或、一层组）、排序。
 * 都在测试模式里真点、真选、真拖、真打字；每一步之后读盘，整篇和 packages/format 算出来的一样（只换那几行），
 * 只看不写的（切视图、收起一组）文件不动；底部提示「撤回」回到上一步；全去掉回到原样，一个字不差。
 */
import {
  addView,
  baseContext,
  type BaseFilter,
  defaultGroupProp,
  duplicateView,
  filterText,
  colTypeOf,
  moveView,
  parseBaseDoc,
  queryView,
  removeView,
  renameView,
  setViewFilter,
  setViewGroup,
  setViewSort,
  setViewType,
} from '@cn/format'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ECP_BASE, ECP_DOC, EXERCISES, LECTURES, records } from '../../../packages/format/test/base-samples'
import { gitStatus, launch, openNote, pane } from './app'

const DOC = '课程/ecp/ecp 课程计划.md'
const FILES: Record<string, string> = { [DOC]: ECP_DOC, ...LECTURES, ...EXERCISES }
const withBase = (b: string) => ECP_DOC.replace(ECP_BASE, b)
const ctxOf = (b: string) => baseContext(parseBaseDoc(b), records({ ...LECTURES, ...EXERCISES }))
/** 块头第一行的「N 条 · 筛掉 M 条」照 queryView 算 */
const countOf = (b: string, i: number) => {
  const r = queryView(ctxOf(b), i)
  return r.hidden ? `${r.rows.length} 条 · 筛掉 ${r.hidden} 条` : `${r.rows.length} 条`
}
const SUB = '只改 ecp 课程计划.md 里 base 块的那几行'

async function setup(page: Page) {
  await openNote(page, 'ecp 课程计划')
  const db = pane(page).locator('[data-part="数据库块"]')
  await expect(db.locator('.base-count')).toHaveText('8 条')
  return db
}
const tabs = (db: Locator) => db.locator('[data-part="视图标签条"]').getByRole('tab')
const tool = (db: Locator, name: string) => db.locator('.base-tools').getByRole('button', { name, exact: true })
const toast = (page: Page) => page.getByTestId('toast')
/** 当前视图的菜单：标签摆得开时点当前标签，收成下拉时点下拉（下拉里有同样几项） */
async function viewMenu(page: Page, db: Locator, name: string) {
  const bar = db.locator('[data-part="视图标签条"]')
  if (await bar.getByRole('tab').count()) {
    await bar.getByRole('tab', { name, exact: true }).click()
    return page.getByRole('menu', { name: `视图「${name}」` })
  }
  await bar.getByRole('button', { name: `切换视图：${name}` }).click()
  return page.getByRole('menu', { name: '视图' })
}

test('视图标签条：切换只记在本机不写文件；加一个看板直接起名、复制、换看法、删除、双击改名、拖着换顺序，每一步只换 base 块那几行，撤回回到上一步', async () => {
  const run = await launch(FILES)
  const { page, vault, app } = run
  const file = () => readFileSync(join(vault, DOC), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    const db = await setup(page)
    await expect(tabs(db)).toHaveText(['全部', '看板', '日历', '画廊', '没学完的'])
    await expect(db.getByRole('tab', { selected: true })).toHaveText('全部')

    // 切到「没学完的」：条数、筛选小标签跟着变，文件一个字不动，当前视图记在本机
    await db.getByRole('tab', { name: '没学完的' }).click()
    await expect(db.getByRole('tab', { selected: true })).toHaveText('没学完的')
    await expect(db.locator('.base-count')).toHaveText(countOf(ECP_BASE, 4))
    const ctx = ctxOf(ECP_BASE)
    const f4 = parseBaseDoc(ECP_BASE).views[4]!.filter!
    await expect(db.locator('[data-part="筛选排序小标签"] .base-fchip').first()).toHaveText(filterText(f4, (c) => colTypeOf(ctx, c)))
    await expect(db.locator('[data-part="筛选排序小标签"] .base-fchip').nth(1)).toHaveText('日期')
    await expect(tool(db, '筛选')).toHaveText('筛选 3')
    await expect(db.locator('tbody tr')).toHaveCount(queryView(ctx, 4).rows.length)
    await page.waitForTimeout(800)
    expect(file()).toBe(ECP_DOC)
    expect(gitStatus(vault)).toBe('')
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cn.base.view') ?? '{}'))).toEqual({ '课程/ecp/课程计划': '没学完的' })
    await page.screenshot({ path: 'test-results/i921u-views-1.png' })

    // 最右「+」加一个看板：叫「看板 2」，标签上直接起名「学习看板」
    await db.getByRole('button', { name: '加一个视图' }).click()
    await page.getByRole('menu', { name: '加一个视图' }).getByRole('menuitem', { name: '看板' }).click()
    const s1 = addView(ECP_BASE, { type: 'kanban', name: '看板 2', groupBy: defaultGroupProp(ctx) })
    await expect.poll(file).toBe(withBase(s1))
    await expect(toast(page)).toContainText(`加了视图「看板 2」 · ${SUB}`)
    const box = db.getByRole('textbox', { name: '视图名' })
    await expect(box).toBeFocused()
    await box.fill('学习看板')
    await box.press('Enter')
    const s2 = renameView(s1, 5, '学习看板')
    await expect.poll(file).toBe(withBase(s2))
    await expect(db.getByRole('tab', { selected: true })).toHaveText('学习看板')
    // 六个视图时标签条先让分组筛选排序只留图标（不切半截标签），名字写在悬停提示里
    await expect.poll(() => tool(db, '分组').evaluate((el) => el.textContent || el.getAttribute('data-tip'))).toBe('按「状态」分列')
    await expect(tabs(db)).toHaveCount(6)

    // 点当前那个出菜单：复制这个视图（「学习看板 2」，esc 不改名）
    await db.getByRole('tab', { name: '学习看板' }).click()
    const menu = page.getByRole('menu', { name: '视图「学习看板」' })
    await expect(menu.getByRole('menuitem')).toHaveText(['重命名双击标签', '复制这个视图', '删除这个视图'])
    await expect(menu.getByRole('menuitemradio')).toHaveText(['表格', '看板', '日历', '画廊'])
    await expect(menu.getByRole('menuitemradio', { name: '看板' })).toHaveAttribute('aria-checked', 'true')
    await page.screenshot({ path: 'test-results/i921u-views-menu.png' })
    await menu.getByRole('menuitem', { name: '复制这个视图' }).click()
    const s3 = duplicateView(s2, 5, '学习看板 2')
    await expect.poll(file).toBe(withBase(s3))
    await expect(db.getByRole('textbox', { name: '视图名' })).toBeFocused()
    await page.keyboard.press('Escape')
    // 七个视图：分组筛选排序只留图标，七个标签整个摆得下（没有切掉半截的）
    await expect(db.getByRole('tab', { selected: true })).toHaveText('学习看板 2')
    await expect(tabs(db)).toHaveCount(7)
    await expect(db.locator('[data-part="视图标签条"] .lb')).toHaveCount(0)
    const cut = await db.locator('[data-part="视图标签条"]').evaluate((bar) => {
      const r = bar.querySelector('.base-vtabs')!.getBoundingClientRect()
      return [...bar.querySelectorAll('[role=tab]')].filter((t) => t.getBoundingClientRect().right > r.right + 0.5).length
    })
    expect(cut).toBe(0)

    // 换看法：表格
    await db.getByRole('tab', { name: '学习看板 2' }).click()
    await page.getByRole('menu', { name: '视图「学习看板 2」' }).getByRole('menuitemradio', { name: '表格' }).click()
    const s4 = setViewType(s3, 6, 'table', { groupBy: '状态', date: '日期' })
    await expect.poll(file).toBe(withBase(s4))
    await expect(toast(page)).toContainText('「学习看板 2」换成了表格')

    // 删除这个视图：只拿掉那一段，回到左边那个
    // 换成表格以后多了「隐藏了 N 列」，七个标签又摆不下：收成下拉，下拉里删
    await expect(db.locator('[data-part="视图标签条"]').getByRole('button', { name: '切换视图：学习看板 2' })).toBeVisible()
    await (await viewMenu(page, db, '学习看板 2')).getByRole('menuitem', { name: '删除这个视图' }).click()
    const s5 = removeView(s4, 6)
    expect(s5).toBe(s2)
    await expect.poll(file).toBe(withBase(s5))
    await expect(toast(page)).toContainText('删掉了视图「学习看板 2」 · 数据没动，只拿掉 base 块里这个视图')
    await expect(db.getByRole('tab', { selected: true })).toHaveText('学习看板')

    // 双击「日历」直接改名「月历」
    await db.getByRole('tab', { name: '日历' }).dblclick()
    const box2 = db.getByRole('textbox', { name: '视图名' })
    await expect(box2).toBeFocused()
    await box2.fill('月历')
    await box2.press('Enter')
    const s6 = renameView(s5, 2, '月历')
    await expect.poll(file).toBe(withBase(s6))
    await expect(tabs(db)).toHaveText(['全部', '看板', '月历', '画廊', '没学完的', '学习看板'])

    // 按住「月历」拖到「全部」前面
    const from = (await db.getByRole('tab', { name: '月历' }).boundingBox())!
    const to = (await db.getByRole('tab', { name: '全部' }).boundingBox())!
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 8 })
    await page.mouse.up()
    const s7 = moveView(s6, 2, 0)
    await expect.poll(file).toBe(withBase(s7))
    await expect(tabs(db)).toHaveText(['月历', '全部', '看板', '画廊', '没学完的', '学习看板'])
    // 双击时先切到了「月历」，改名、挪位置以后还看着它（按名字记）
    await expect(db.getByRole('tab', { selected: true })).toHaveText('月历')
    // 底部「撤回」：只撤这一步
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(file).toBe(withBase(s6))
    await expect(tabs(db)).toHaveText(['全部', '看板', '月历', '画廊', '没学完的', '学习看板'])
  } finally {
    await run.close()
  }
})

test('筛选面板改了就存：加一条、选值才写；加一组里另算或；且 / 或；撤回回到上一步；全部去掉一个字不差回到原样', async () => {
  const run = await launch(FILES)
  const { page, vault, app } = run
  const file = () => readFileSync(join(vault, DOC), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    const db = await setup(page)
    await tool(db, '筛选').click()
    const panel = page.getByRole('dialog', { name: '筛选' })
    await expect(panel.locator('.fhd')).toHaveText('筛选「全部」改了就存进这个视图留下 8 条')
    await expect(panel).toContainText('还没有条件')
    await panel.getByRole('button', { name: '加一条' }).click()
    const top = (i: number) => panel.locator('.fbody > .frow').nth(i)
    await expect(top(0).getByRole('combobox', { name: '列' })).toHaveValue('状态')
    // 值没选：只在面板上，文件不动
    await page.waitForTimeout(500)
    expect(file()).toBe(ECP_DOC)
    await top(0).getByRole('combobox', { name: '值' }).selectOption('在学')
    const f1: BaseFilter = { conj: 'and', items: [{ prop: '状态', op: '==', value: '在学' }] }
    const s1 = setViewFilter(ECP_BASE, 0, f1)
    await expect.poll(file).toBe(withBase(s1))
    await expect(toast(page)).toContainText(`改了筛选，存进了「全部」 · ${SUB}`)
    await expect(db.locator('.base-count')).toHaveText(countOf(s1, 0))
    await expect(panel.locator('.fhd .left')).toHaveText(`留下 ${queryView(ctxOf(s1), 0).rows.length} 条`)
    await expect(tool(db, '筛选')).toHaveText('筛选 1')

    // 加一组：组里「日期 为空」或「日期 早于 7天后」
    await panel.getByRole('button', { name: '加一组（组里另算且 / 或）' }).click()
    const group = panel.getByRole('group', { name: '一组条件' })
    await expect(group.locator('.gt')).toHaveText('这一组：满足任一条')
    const g = (i: number) => group.locator('.frow').filter({ has: page.getByRole('combobox', { name: '列' }) }).nth(i)
    await g(0).getByRole('combobox', { name: '列' }).selectOption('日期')
    await g(0).getByRole('combobox', { name: '条件' }).selectOption({ label: '为空' })
    const s2 = setViewFilter(s1, 0, { conj: 'and', items: [f1.items[0]!, { conj: 'or', items: [{ prop: '日期', op: 'empty', value: '' }] }] })
    await expect.poll(file).toBe(withBase(s2))
    await group.getByRole('button', { name: '在这组加一条' }).click()
    await g(1).getByRole('combobox', { name: '列' }).selectOption('日期')
    await g(1).getByRole('combobox', { name: '值' }).selectOption({ label: '7天后' })
    const f3: BaseFilter = {
      conj: 'and',
      items: [
        f1.items[0]!,
        {
          conj: 'or',
          items: [
            { prop: '日期', op: 'empty', value: '' },
            { prop: '日期', op: '<=', value: 'today() + "7d"' },
          ],
        },
      ],
    }
    const s3 = setViewFilter(s2, 0, f3)
    await expect.poll(file).toBe(withBase(s3))
    await expect(tool(db, '筛选')).toHaveText('筛选 3')
    await expect(db.locator('.base-count')).toHaveText(countOf(s3, 0))
    await page.screenshot({ path: 'test-results/i921u-filter.png' })

    // 最外层「且」换成「或」
    await top(1).getByRole('combobox', { name: '且还是或' }).first().selectOption('or')
    const s4 = setViewFilter(s3, 0, { ...f3, conj: 'or' })
    await expect.poll(file).toBe(withBase(s4))
    await expect(db.locator('.base-count')).toHaveText(countOf(s4, 0))
    // 撤回：只撤这一步，回到「且」
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(file).toBe(withBase(s3))
    await expect(db.locator('.base-count')).toHaveText(countOf(s3, 0))

    // 小标签 × 去掉整个筛选：回到原样
    await expect(panel).toHaveCount(0)
    await db.getByRole('button', { name: '去掉筛选' }).click()
    await expect.poll(file).toBe(ECP_DOC)
    await expect(db.locator('.base-count')).toHaveText('8 条')
    // 再开面板：加一条又「全部去掉」，文件还是原样
    await tool(db, '筛选').click()
    await panel.getByRole('button', { name: '加一条' }).click()
    await top(0).getByRole('combobox', { name: '值' }).selectOption('学完')
    await expect.poll(file).toBe(withBase(setViewFilter(ECP_BASE, 0, { conj: 'and', items: [{ prop: '状态', op: '==', value: '学完' }] })))
    await panel.getByRole('button', { name: '全部去掉' }).click()
    await expect.poll(file).toBe(ECP_DOC)
  } finally {
    await run.close()
  }
})

test('排序和分组改了就存：加一个排序、换降序、×；按状态分组画组头、点组名收起只记在本机；不分组回到原样', async () => {
  const run = await launch(FILES)
  const { page, vault, app } = run
  const file = () => readFileSync(join(vault, DOC), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    const db = await setup(page)
    // 排序
    await tool(db, '排序').click()
    const sort = page.getByRole('dialog', { name: '排序' })
    await expect(sort).toContainText('没排序：照文件名')
    await sort.getByRole('button', { name: '加一个排序' }).click()
    const s1 = setViewSort(ECP_BASE, 0, [{ prop: '状态', desc: false }])
    await expect.poll(file).toBe(withBase(s1))
    await expect(toast(page)).toContainText(`按「状态」升序，存进了「全部」 · ${SUB}`)
    await sort.getByRole('combobox', { name: '升序还是降序' }).selectOption('desc')
    const s2 = setViewSort(s1, 0, [{ prop: '状态', desc: true }])
    await expect.poll(file).toBe(withBase(s2))
    const order = queryView(ctxOf(s2), 0).rows.map((r) => r.name)
    await expect(db.locator('tbody tr td.nm button:not(.base-open)')).toHaveText(order)
    await sort.getByRole('button', { name: '去掉这个排序' }).click()
    await expect.poll(file).toBe(ECP_DOC)
    await page.keyboard.press('Escape')

    // 分组：按状态
    await tool(db, '分组').click()
    const menu = page.getByRole('menu', { name: '分组' })
    await expect(menu.getByRole('menuitemradio', { name: '不分组' })).toHaveAttribute('aria-checked', 'true')
    await menu.getByRole('menuitemradio', { name: '状态' }).click()
    const s3 = setViewGroup(ECP_BASE, 0, { prop: '状态', desc: false })
    await expect.poll(file).toBe(withBase(s3))
    await expect(toast(page)).toContainText(`按「状态」分组，存进了「全部」 · ${SUB}`)
    await expect(tool(db, '分组')).toHaveText('按「状态」分组')
    const heads = db.locator('tr.base-grp')
    await expect(heads).toHaveText(['未开始4', '在学2', '学完2'])
    await expect(db.locator('tbody tr:not(.base-grp)')).toHaveCount(8)
    await page.screenshot({ path: 'test-results/i921u-group.png' })
    // 点「未开始」收起：那 4 条不画，文件不动，记在本机
    const before = file()
    await heads.filter({ hasText: '未开始' }).getByRole('button').click()
    await expect(db.locator('tbody tr:not(.base-grp)')).toHaveCount(4)
    await expect(heads.filter({ hasText: '未开始' }).getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    await page.waitForTimeout(600)
    expect(file()).toBe(before)
    expect(await page.evaluate(() => localStorage.getItem('cn.base.fold'))).toBe(JSON.stringify({ '课程/ecp/课程计划\n全部': ['未开始'] }))
    await heads.filter({ hasText: '未开始' }).getByRole('button').click()
    await expect(db.locator('tbody tr:not(.base-grp)')).toHaveCount(8)
    // 不分组：回到原样
    await tool(db, '分组').click()
    await page.getByRole('menu', { name: '分组' }).getByRole('menuitemradio', { name: '不分组' }).click()
    await expect.poll(file).toBe(ECP_DOC)
    await expect(heads).toHaveCount(0)
    expect(gitStatus(vault)).not.toContain('课程计划/')
  } finally {
    await run.close()
  }
})

test('窄于 560：标签收成一个下拉、分组筛选排序只留图标，不挤成一字一行；下拉里切视图', async () => {
  const run = await launch(FILES)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(820, 900))
    const db = await setup(page)
    const width = await db.evaluate((el) => (el as HTMLElement).offsetWidth)
    expect(width).toBeLessThan(560)
    const bar = db.locator('[data-part="视图标签条"]')
    await expect(bar).toHaveClass(/narrow/)
    await expect(bar.getByRole('tab')).toHaveCount(0)
    await expect(bar.locator('.lb')).toHaveCount(0)
    // 每一样都是一行高（没有挤成竖排）
    const tall = await bar.evaluate((el) => [...el.querySelectorAll<HTMLElement>('button')].filter((b) => b.getBoundingClientRect().height > 34).length)
    expect(tall).toBe(0)
    await page.screenshot({ path: 'test-results/i921u-narrow.png' })
    await bar.getByRole('button', { name: '切换视图：全部' }).click()
    const menu = page.getByRole('menu', { name: '视图' })
    await expect(menu.getByRole('group', { name: '视图' }).getByRole('menuitemradio')).toHaveText(['全部', '看板', '日历', '画廊', '没学完的'])
    await expect(menu.getByRole('menuitem')).toHaveText(['重命名双击标签', '复制这个视图', '删除这个视图', '加一个视图'])
    await menu.getByRole('group', { name: '视图' }).getByRole('menuitemradio', { name: '没学完的' }).click()
    await expect(bar.getByRole('button', { name: '切换视图：没学完的' })).toBeVisible()
    await expect(db.locator('.base-count')).toHaveText(countOf(ECP_BASE, 4))
  } finally {
    await run.close()
  }
})
