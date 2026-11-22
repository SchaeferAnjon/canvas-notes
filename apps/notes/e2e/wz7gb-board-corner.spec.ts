/**
 * 白板的缩放和收件箱挪进白板右上角（task-wz7gb，用户：「这个可以放在白板里面的右上角，这样的话这里就不会跳来跳去了，当切换文档和白板的时候」）：
 * - 标签条上「属性 · 任务 · 白板 · 文档 · ⋯」在任务 / 白板 / 文档之间切换时每颗按钮的 x 一样（A、B 都量）；
 * - 缩放「N% ▾」和「收件箱 N」浮在白板画布右上角（离右 16、离顶 16，和顶上那条胶囊同一行），标签条里没有它们；
 * - 点「收件箱 N」弹窗照旧从按钮下面 6 弹出、右边对齐，⇧⌘I 照旧开关；点缩放照旧弹缩放菜单，点「放大」比例变大；
 * - 白板窄（中栏 420）：两颗只留图标和数（不写「收件箱」、不画 ⌄），不盖列和卡，也不盖顶上那条胶囊；
 * - 导图（自由白板）右上角也是这两颗。
 * 都是真点、真按。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, pane, tabOn, widenRight } from './app'
import { board, FILES, openBoard } from './fixtures/board-doc'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const MAP = '---\ntype: board\n白板样式: 导图\n类型: 导图\n---\n# 导图 11-15 21∶40\n\n- 线性映射\n  - 定义\n  - 核与像\n'

const frame = (f: 'a' | 'b') => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { frame: f } }))
}
const corner = (page: Page) => pane(page).getByTestId('board-corner')
const pop = (page: Page) => board(page).getByRole('dialog', { name: '收件箱' })
const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!

/** 标签条右端每颗按钮的左边 x（按出现顺序，带名字） */
const actXs = (page: Page) =>
  acts(page).evaluate((el) =>
    [...el.querySelectorAll<HTMLElement>('button')]
      .filter((b) => b.offsetParent)
      .map((b) => `${b.getAttribute('aria-label') ?? b.textContent}@${Math.round(b.getBoundingClientRect().left * 10) / 10}`),
  )

const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

for (const f of ['a', 'b'] as const) {
  test(`${f.toUpperCase()}：切任务 / 白板 / 文档标签条那一排不动；缩放和收件箱在白板右上角，收件箱弹窗、⇧⌘I、缩放菜单照旧`, async () => {
    const run = await launch(FILES, {}, frame(f))
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      await armMenus(run)
      await openBoard(page, '冰岛十天环岛')
      await expect(board(page)).toBeVisible()
      await page.mouse.move(700, 880)
      // 标签条里不再有这两颗
      await expect(acts(page).getByTestId('board-zoom')).toHaveCount(0)
      await expect(acts(page).getByTestId('db-inbox')).toHaveCount(0)
      const onBoard = await actXs(page)
      await acts(page).getByRole('tab', { name: '文档' }).click()
      await expect(pane(page).locator('.cm-content')).toBeVisible()
      const onDoc = await actXs(page)
      await acts(page).getByRole('tab', { name: '任务' }).click()
      await page.waitForTimeout(200)
      const onTask = await actXs(page)
      expect(onDoc).toEqual(onBoard)
      expect(onTask).toEqual(onBoard)
      await acts(page).getByRole('tab', { name: '白板' }).click()
      await expect(board(page)).toBeVisible()
      expect(await actXs(page)).toEqual(onBoard)

      // 右上角：离白板右边 16、离顶 16，32 高；先缩放、后收件箱
      const b = await box(board(page))
      const c = await box(corner(page))
      expect(Math.abs(b.x + b.width - 16 - (c.x + c.width))).toBeLessThan(1)
      expect(Math.abs(c.y - (b.y + 16))).toBeLessThan(1)
      expect(Math.round(c.height)).toBe(32)
      const zoom = corner(page).getByTestId('board-zoom')
      const inbox = corner(page).getByTestId('db-inbox')
      expect((await box(zoom)).x).toBeLessThan((await box(inbox)).x)
      // 和左边工具板同一个底、圆角、阴影
      const look = (sel: string) =>
        pane(page)
          .locator(sel)
          .evaluate((el) => {
            const s = getComputedStyle(el)
            return [s.backgroundColor, s.borderTopLeftRadius, s.boxShadow]
          })
      expect(await look('[data-testid="board-corner"]')).toEqual(await look('.db-area > .bpal'))
      // A 只有图标和数，B 写「收件箱」
      await expect(inbox.locator('.lb')).toBeVisible({ visible: f === 'b' })
      await expect(inbox.locator('.cnt')).toHaveText('2')
      await expect(zoom.locator('.ci')).toBeVisible()

      // 收件箱：点开从右上角那一小条下面 6 弹出，右边和它对齐；点外面收起；⇧⌘I 开关
      await inbox.click()
      await expect(pop(page)).toBeVisible()
      await pop(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
      const p = await box(pop(page))
      // 挂在右上角那一小条下面 6，右边和它的外沿对齐
      const cc = await box(corner(page))
      expect(Math.abs(p.y - (cc.y + cc.height + 6))).toBeLessThan(1)
      expect(Math.abs(p.x + p.width - (cc.x + cc.width))).toBeLessThan(1)
      await expect(inbox).toHaveAttribute('aria-expanded', 'true')
      await inbox.click()
      await expect(pop(page)).toHaveCount(0)
      await page.keyboard.press('Shift+Meta+KeyI')
      await expect(pop(page)).toBeVisible()
      await page.keyboard.press('Shift+Meta+KeyI')
      await expect(pop(page)).toHaveCount(0)

      // 缩放：点比例弹缩放菜单，点「放大」比例变大；⌘0 回 100%
      await expect(zoom).toHaveText('100%')
      await zoom.click()
      expect(menuLabels(await openedMenu(run))).toEqual(['放大', '缩小', '100%', '适合窗口', '触控板捏合、按住 ⌘ 滚动也能缩放'])
      await pickMenu(run, '放大')
      await expect(zoom).toHaveText('110%')
      await page.keyboard.press('Meta+Digit0')
      await expect(zoom).toHaveText('100%')
      // 文档看法里没有这两颗
      await acts(page).getByRole('tab', { name: '文档' }).click()
      await expect(corner(page)).toHaveCount(0)
    } finally {
      await run.close()
    }
  })

  test(`${f.toUpperCase()}：中栏 420 时右上角只留图标和数，不盖列、卡和顶上那条；导图右上角也是这两颗`, async () => {
    const run = await launch({ ...FILES, '收件箱/导图 11-15 21∶40.md': MAP }, {}, frame(f))
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      await openBoard(page, '冰岛十天环岛')
      await page.keyboard.press('Meta+y')
      await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
      for (let i = 0; i < 3; i++) {
        const bw = (await box(board(page))).width
        if (Math.abs(bw - 420) < 1) break
        await widenRight(page, bw - 420)
        await page.waitForTimeout(200)
      }
      expect(Math.round((await box(board(page))).width)).toBe(420)
      const zoom = corner(page).getByTestId('board-zoom')
      const inbox = corner(page).getByTestId('db-inbox')
      await expect(inbox.locator('.lb')).toBeHidden()
      await expect(zoom.locator('.ci')).toBeHidden()
      // 导图也在收件箱里：3 条
      await expect(inbox.locator('.cnt')).toHaveText('3')
      const b = await box(board(page))
      const c = await box(corner(page))
      expect(c.x).toBeGreaterThan(b.x)
      expect(Math.abs(b.x + b.width - 16 - (c.x + c.width))).toBeLessThan(1)
      // 不盖列、卡、工具板，也不盖顶上那条胶囊
      await expect(board(page).locator('.db-hint')).toBeVisible()
      const things = await board(page).locator('.db-col, .db-card, .bpal, .db-hint').all()
      expect(things.length).toBeGreaterThan(3)
      for (const t of things) {
        const r = await t.boundingBox()
        if (r) expect(overlap(c, r), `盖住了 ${await t.getAttribute('class')}`).toBe(false)
      }
      // 窄时收件箱照样点得开，弹窗收在中栏里
      await inbox.click()
      await expect(pop(page)).toBeVisible()
      await pop(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
      const p = await box(pop(page))
      expect(p.x).toBeGreaterThanOrEqual(b.x + 8 - 0.5)
      expect(p.x + p.width).toBeLessThanOrEqual(b.x + b.width - 8 + 0.5)
      await page.keyboard.press('Escape')
      await expect(pop(page)).toHaveCount(0)

      // 导图（自由白板）：右上角也是这两颗，标签条里没有
      await openBoard(page, '导图 11-15 21∶40')
      await expect(tabOn(page)).toContainText('导图 11-15')
      await expect(pane(page).locator('.board:has(> [data-testid="board-corner"])')).toBeVisible()
      await expect(corner(page)).toBeVisible()
      await expect(acts(page).getByTestId('board-zoom')).toHaveCount(0)
      const mb = await box(pane(page).locator('.board:has(> [data-testid="board-corner"])'))
      const mc = await box(corner(page))
      expect(Math.abs(mb.x + mb.width - 16 - (mc.x + mc.width))).toBeLessThan(1)
      expect(Math.abs(mc.y - (mb.y + 16))).toBeLessThan(1)
      await corner(page).getByTestId('db-inbox').click()
      await expect(pane(page).getByRole('dialog', { name: '收件箱' })).toBeVisible()
    } finally {
      await run.close()
    }
  })
}
