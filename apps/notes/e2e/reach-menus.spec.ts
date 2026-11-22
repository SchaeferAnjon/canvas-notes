/**
 * 以前只有按键或只在 ⌘K 里的几样，现在点得到（task-xy89o「功能有、但正常翻找不到」）：
 * 1. 「课程」右键「新建一门课」：建 课程/新的课程，开它的首页
 * 2. 块菜单「上移」「下移」（⌥⇧↑ / ⌥⇧↓）：真挪了这一块；最上一块的「上移」、最下一块的「下移」灰着
 * 3. 菜单栏：显示 › 收起 / 展开中间栏、左栏：书桌、梦游报告；文件 › 新建一门课、新建文件夹、存成书桌…，点了真跑
 */
import { expect, type Page, test } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, leftView, openNote, pane, type Running, tabOn } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()
async function grip(page: Page, text: string) {
  await expect(async () => {
    const box = (await line(page, text).boundingBox())!
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.move(box.x + 60, box.y + box.height / 2)
    await expect(pane(page).locator('.blk-bar:not([hidden]) .blk-grip')).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 5000 })
  await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click()
  const menu = page.getByRole('menu', { name: '块菜单' })
  await expect(menu).toBeVisible()
  return menu
}

/** 菜单栏一项：读出那个菜单的项，点一项（像人点菜单栏） */
const menuBar = (run: Running, top: string) =>
  run.app.evaluate(({ Menu }, top) => Menu.getApplicationMenu()!.items.find((i) => i.label === top)!.submenu!.items.map((i) => i.label), top)
const clickMenuBar = (run: Running, top: string, label: string) =>
  run.app.evaluate(({ Menu }, [top, label]) => Menu.getApplicationMenu()!.items.find((i) => i.label === top)!.submenu!.items.find((i) => i.label === label)!.click(), [top, label] as const)

test('「课程」右键有「新建一门课」，点了建 课程/新的课程、开它的首页', async () => {
  const run = await launch({ '课程/ecp/讲义.md': '# 讲义\n\n第一段。\n' })
  const { page, vault } = run
  try {
    await leftView(page, '文件')
    await armMenus(run)
    await page.locator('aside.side [role=tree] [role=treeitem]', { hasText: /^课程/ }).first().click({ button: 'right' })
    const labels = menuLabels(await openedMenu(run))
    expect(labels.slice(0, 3)).toEqual(['新建笔记', '新建白板', '新建一门课'])
    await pickMenu(run, '新建一门课')
    await expect.poll(() => existsSync(join(vault, '课程/新的课程'))).toBe(true)
    await expect(tabOn(page)).toContainText('新的课程')
    // 别的文件夹没有这一项
    await armMenus(run)
    await page.locator('aside.side [role=tree] [role=treeitem]', { hasText: /^ecp/ }).first().click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).not.toContain('新建一门课')
  } finally {
    await run.close()
  }
})

test('块菜单「上移」「下移」：真挪这一块，写进文件；最上一块的上移、最下一块的下移灰着', async () => {
  const run = await launch({ '笔记.md': '# 笔记\n\n甲段\n\n乙段\n\n丙段\n' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '笔记.md'), 'utf8')
  try {
    await openNote(page, '笔记')
    let menu = await grip(page, '乙段')
    await expect(menu.getByRole('menuitem', { name: /上移/ })).toHaveText('上移⌥⇧↑')
    await expect(menu.getByRole('menuitem', { name: /下移/ })).toHaveText('下移⌥⇧↓')
    await menu.getByRole('menuitem', { name: /上移/ }).click()
    await expect(menu).toHaveCount(0)
    await expect.poll(file).toBe('# 笔记\n\n乙段\n\n甲段\n\n丙段\n')
    menu = await grip(page, '甲段')
    await menu.getByRole('menuitem', { name: /下移/ }).click()
    await expect.poll(file).toBe('# 笔记\n\n乙段\n\n丙段\n\n甲段\n')
    // 最上一块（标题）的上移灰着，最下一块的下移灰着
    menu = await grip(page, '笔记')
    await expect(menu.getByRole('menuitem', { name: /上移/ })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
    menu = await grip(page, '甲段')
    await expect(menu.getByRole('menuitem', { name: /下移/ })).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

test('菜单栏：显示有收起 / 展开中间栏、左栏：书桌、梦游报告；文件有新建一门课、新建文件夹、存成书桌…，点了真跑', async () => {
  const run = await launch({ '写作/草稿.md': '# 草稿\n\n还没写完。\n' })
  const { page } = run
  try {
    expect(await menuBar(run, '显示')).toEqual(expect.arrayContaining(['收起 / 展开中间栏', '左栏：书桌', '梦游报告']))
    expect(await menuBar(run, '文件')).toEqual(expect.arrayContaining(['新建一门课', '新建文件夹', '存成书桌…']))
    await clickMenuBar(run, '显示', '左栏：书桌')
    await expect(page.locator('aside.side[aria-label="书桌"]')).toBeVisible()
    await clickMenuBar(run, '显示', '梦游报告')
    await expect(page.locator('aside.side[aria-label="梦游报告"]')).toBeVisible()
    await leftView(page, '最近')
    await openNote(page, '草稿')
    await clickMenuBar(run, '文件', '存成书桌…')
    const dlg = page.getByRole('dialog', { name: '存成书桌' })
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await clickMenuBar(run, '文件', '新建一门课')
    await expect(tabOn(page)).toContainText('新的课程')
  } finally {
    await run.close()
  }
})
