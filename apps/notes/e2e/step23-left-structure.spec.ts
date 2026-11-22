// 左栏重组（2026-11-17，用户批准的 left-structure 小样；2026-11-18 方案 v2 分类与入口方向 A：整套分类平铺在活动栏）：
// 活动栏 文件 / 最近 / 分类和摘出来的文件夹 / 梦游；文件树第一行是库本身、最外层按分类分组；
// 文件树篇数、置顶、图标和颜色、六种排序和开关、定位当前文件；每个文件夹都有首页（子文件夹卡片、白板缩略图、PDF 封面、笔记一行预览）；
// 文件夹右键「置顶」「放到左边」「换图标和颜色…」「移到 ›」；活动栏右键 从左边拿下 / 在「文件」里看位置 / 换图标和颜色 / 上移 / 下移；
// 「最近」左栏按时间分组、中间整页写标题回车新建进收件箱。菜单每一项都真点一遍（e2e/menu.ts）。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { launch, leftView, pane, rail, tabOn, type Running } from './app'
import { LEFT_VAULT, withTimes } from './fixtures/left-vault'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const side = (page: Page) => page.locator('aside.side')
const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const barNames = (page: Page) => bar(page).locator('button.ab').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const tree = (page: Page) => side(page).getByRole('tree')
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
const rowNames = (page: Page) => tree(page).getByRole('treeitem').locator('.truncate').allTextContents()
/** 最外层那几行（第一行是库本身，最外层挂在它下面是第 2 层；课程默认展开着，里面的 ecp 不算） */
const topNames = (page: Page) => tree(page).locator('[role=treeitem][aria-level="2"] .truncate').allTextContents()
/** 一个最外层文件夹下面那一层（第 3 层，按 data-path 认） */
const kidsOf = (page: Page, folder: string) => tree(page).locator(`[role=treeitem][aria-level="3"][data-path^="${folder}/"] .truncate`).allTextContents()
const CATS = ['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活']
const left = (vault: string) => JSON.parse(readFileSync(join(vault, '.canvas-notes/左栏.json'), 'utf8')) as { 左边: string[]; 图标: Record<string, { icon?: string; color?: string }> }
const lastCommit = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()

async function start(): Promise<Running> {
  const run = await launch(LEFT_VAULT, {}, (v) => withTimes(v))
  await armMenus(run)
  await leftView(run.page, '文件')
  return run
}

test('活动栏：文件、最近 | 收件箱 | 课程 阅读 剪藏 | 周记 写作 项目 生活 | 梦游；没有「全部笔记」；亮着的那格没有底块，只有符号和左边 2px 竖线', async () => {
  const run = await start()
  const { page } = run
  try {
    expect(await barNames(page)).toEqual(['文件', '最近', '书桌', ...CATS, '梦游报告', '库', '设置和外观'])
    expect(await bar(page).locator('.ab-sep').count()).toBe(4)
    const on = bar(page).getByRole('button', { name: '文件', exact: true })
    const look = await on.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, line: getComputedStyle(el, '::before').width }))
    expect(look).toEqual({ bg: 'rgba(0, 0, 0, 0)', line: '2px' })
    // 「最近」页底下只有「归档」，不再有「全部笔记」
    await leftView(page, '最近')
    await expect(side(page).getByText('全部笔记')).toHaveCount(0)
    await expect(side(page).getByRole('button', { name: /归档/ })).toBeVisible()
    // 课程：左栏是课程那一枝，每门课一行，问完几讲 / 一共几讲；点开课程首页
    await leftView(page, '课程')
    await expect(row(page, 'ecp')).toContainText('1/2讲')
    await row(page, 'ecp').click()
    await expect(tabOn(page)).toHaveText('ecp')
  } finally {
    await run.close()
  }
})

test('文件树：篇数（含子文件夹）、类型筛选和「最近」共用、六种排序 + 三个开关记得住、定位当前文件（展开、外圈 2 秒）', async () => {
  const run = await start()
  const { page } = run
  try {
    // 老库的「素材」打开时改成了「剪藏」（一次提交）；「冰岛自驾指南」PDF 和它的笔记是一行，算一篇（一个 PDF 一篇笔记，task-9okg5）
    await expect(row(page, '剪藏').locator('.ft-count')).toHaveText('19')
    await expect(row(page, '写作').locator('.ft-count')).toHaveText('12')
    // 类型：白板 → 只剩有白板的分类和文件，篇数跟着变（没有白板的分类不画）；装着白板的文件夹自己展开，一眼看到挂在哪（CN-104）
    await side(page).getByRole('tablist', { name: '类型' }).getByRole('tab', { name: '白板' }).click()
    await expect.poll(() => rowNames(page)).toEqual(['测试库', '剪藏', '冰岛旅行', '冰岛十天环岛', '预算', '写作', '写作计划', '未命名白板'])
    await expect(row(page, '剪藏').locator('.ft-count')).toHaveText('2')
    // 和「最近」是同一排
    await leftView(page, '最近')
    await expect(side(page).getByRole('tablist', { name: '类型' }).getByRole('tab', { name: '白板' })).toHaveAttribute('aria-selected', 'true')
    await expect(side(page).locator('.nav .si .truncate')).toHaveText(['未命名白板', '预算', '冰岛十天环岛', '写作计划'])
    await side(page).getByRole('tablist', { name: '类型' }).getByRole('tab', { name: '全部' }).click()
    await leftView(page, '文件')
    // 回到「全部」：筛的时候自己展开的又收回去，和筛之前一样
    await expect(row(page, '剪藏')).toHaveAttribute('aria-expanded', 'false')

    // 排序：点按钮开菜单（按钮亮着），名字 Z → A：写作里面跟着排（文件夹在前）；最外层的分类按分类表的先后，不跟着排
    await row(page, '写作').locator('.ft-tw').click()
    const az = ['书评', '游记', '专栏', '投稿清单', '写作计划', '写作习惯']
    expect(await kidsOf(page, '写作')).toEqual(az)
    const sortBtn = side(page).getByRole('button', { name: '排序' })
    await sortBtn.click()
    await expect(sortBtn).toHaveAttribute('aria-pressed', 'true')
    const menu = page.getByRole('dialog', { name: '排序' })
    await expect(menu.getByRole('menuitem')).toHaveText(['修改时间新的在前', '修改时间旧的在前', '创建时间新的在前', '创建时间旧的在前', '名字A → Z', '名字Z → A', '文件夹排在前面', '置顶的排在最前', '显示篇数', '自动定位当前文件', '新笔记放哪、附件、删除…'])
    await menu.getByRole('menuitem', { name: '名字 Z → A' }).click()
    await expect.poll(() => kidsOf(page, '写作')).toEqual(['专栏', '游记', '书评', '写作习惯', '写作计划', '投稿清单'])
    expect((await topNames(page)).slice(0, 8)).toEqual(CATS)
    // 显示篇数关掉：数字没了
    await menu.getByRole('menuitem', { name: '显示篇数' }).click()
    await expect(tree(page).locator('.ft-count')).toHaveCount(0)
    // 文件夹不排在前面：写作里的白板、笔记按名字插进文件夹中间
    await menu.getByRole('menuitem', { name: '文件夹排在前面' }).click()
    const mixed = ['专栏', '游记', '写作习惯', '写作计划', '投稿清单', '书评']
    await expect.poll(() => kidsOf(page, '写作')).toEqual(mixed)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    // 记得住：重新载入还是这样
    await page.reload()
    await page.locator('.vault b').waitFor()
    await leftView(page, '文件')
    await expect.poll(() => kidsOf(page, '写作')).toEqual(mixed)
    await expect(tree(page).locator('.ft-count')).toHaveCount(0)
    await sortBtn.click()
    await menu.getByRole('menuitem', { name: '名字 A → Z' }).click()
    await menu.getByRole('menuitem', { name: '显示篇数' }).click()
    await menu.getByRole('menuitem', { name: '文件夹排在前面' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => kidsOf(page, '写作')).toEqual(az)
    await row(page, '写作').locator('.ft-tw').click()

    // 定位当前文件：开着一号公路东段，全部收起后点「定位当前文件」→ 展开 剪藏 › 冰岛旅行 › 路线，那一行外圈 2 秒
    for (const f of ['剪藏', '冰岛旅行', '路线']) await row(page, f).locator('.ft-tw').click()
    await row(page, '一号公路东段').click()
    await expect(tabOn(page)).toHaveText('一号公路东段')
    await row(page, '收件箱').locator('.ft-tw').click()
    await row(page, '冰岛旅游 2').click()
    await expect(tabOn(page)).toHaveText('冰岛旅游 2')
    // 自动定位开着：全部收起后切回那个标签，树自己展开到它
    await side(page).getByRole('button', { name: '全部收起' }).click()
    await expect(row(page, '一号公路东段')).toHaveCount(0)
    await page.getByRole('tab', { name: /一号公路东段/ }).click()
    await expect(row(page, '一号公路东段')).toHaveAttribute('aria-current', 'page')
    await side(page).getByRole('button', { name: '全部收起' }).click()
    await expect(row(page, '一号公路东段')).toHaveCount(0)
    await side(page).getByRole('button', { name: '定位当前文件' }).click()
    await expect(row(page, '一号公路东段')).toHaveClass(/ring/)
    await expect(row(page, '一号公路东段')).toBeInViewport()
    await expect(row(page, '一号公路东段')).not.toHaveClass(/ring/, { timeout: 4000 })
    // 关掉自动定位：切标签树不动
    await side(page).getByRole('button', { name: '全部收起' }).click()
    await sortBtn.click()
    await menu.getByRole('menuitem', { name: '自动定位当前文件' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('tab', { name: /冰岛旅游 2/ }).click()
    await page.getByRole('tab', { name: /一号公路东段/ }).click()
    await expect(row(page, '一号公路东段')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('文件夹右键：每一项都真能用——置顶、放到左边、换图标和颜色、重命名（F2）、移到 ›、新建、打开首页、移到废纸篓', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await row(page, '剪藏').locator('.ft-tw').click()
    await row(page, '极光摄影').click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['新建笔记', '新建白板', '新建文件夹', '打开首页', '在新标签打开首页', '置顶', '放到左边', '换图标和颜色…', '重命名…', '移到', '在访达中显示', '拷贝路径', '移到废纸篓'])
    expect(m.find((i) => i.label === '移到')!.submenu![0]!.label).toBe('测试库')
    // 置顶：图钉、排到最前，置顶.json 里写成「剪藏/极光摄影/」
    await pickMenu(run, '置顶')
    await expect(row(page, '极光摄影').locator('.ft-pin')).toBeVisible()
    await expect.poll(() => JSON.parse(readFileSync(join(vault, '.canvas-notes/置顶.json'), 'utf8'))).toEqual(['剪藏/极光摄影/'])
    // 剪藏下面第一行就是它
    const all = await rowNames(page)
    expect(all[all.indexOf('剪藏') + 1]).toBe('极光摄影')
    await row(page, '极光摄影').click({ button: 'right' })
    await pickMenu(run, '取消置顶')
    await expect(row(page, '极光摄影').locator('.ft-pin')).toHaveCount(0)

    // 换图标和颜色：搜整套 Codicons，挑相机 + 紫；树、首页、活动栏都用它；恢复默认
    await row(page, '极光摄影').click({ button: 'right' })
    await pickMenu(run, '换图标和颜色…')
    const pick = page.getByRole('dialog', { name: '换图标和颜色' })
    await expect(pick.getByRole('listbox', { name: '图标' }).getByRole('option')).toHaveCount(32)
    await pick.getByRole('textbox', { name: '找图标' }).fill('telescope')
    await expect(pick.getByRole('option', { name: 'telescope' })).toBeVisible()
    await pick.getByRole('textbox', { name: '找图标' }).fill('')
    await pick.getByRole('option', { name: 'device-camera' }).click()
    await pick.getByRole('option', { name: '紫', exact: true }).click()
    await expect(row(page, '极光摄影').locator('.fglyph')).toHaveAttribute('data-icon', 'device-camera')
    await expect(row(page, '极光摄影').locator('.fglyph')).toHaveCSS('color', 'rgb(123, 98, 168)')
    await expect.poll(() => left(vault).图标).toEqual({ '剪藏/极光摄影': { icon: 'device-camera', color: 'purple' } })
    // 不在常用那 32 个里的也画得出（整套用到才加载）
    await pick.getByRole('textbox', { name: '找图标' }).fill('telescope')
    await pick.getByRole('option', { name: 'telescope' }).click()
    await expect(row(page, '极光摄影').locator('.fglyph svg path').first()).toBeAttached()
    await expect(row(page, '极光摄影').locator('.fglyph')).toHaveAttribute('data-icon', 'telescope')
    await pick.getByRole('button', { name: '恢复默认' }).click()
    await expect(row(page, '极光摄影').locator('.fglyph')).toHaveAttribute('data-icon', 'folder')
    await page.keyboard.press('Escape')
    await expect(pick).toHaveCount(0)

    // 新建笔记 → 进这个文件夹；新建文件夹 → 原地输入框
    await row(page, '极光摄影').click({ button: 'right' })
    await pickMenu(run, '新建笔记')
    await expect(tabOn(page)).toHaveText('未命名')
    await expect.poll(() => existsSync(join(vault, '剪藏/极光摄影/未命名.md'))).toBe(true)
    await row(page, '极光摄影').click({ button: 'right' })
    await pickMenu(run, '新建文件夹')
    await side(page).getByRole('textbox', { name: '新文件夹的名字' }).fill('星轨')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(vault, '剪藏/极光摄影/星轨/.gitkeep'))).toBe(true)
    // 新建白板 → 进这个文件夹
    await row(page, '极光摄影').click({ button: 'right' })
    await pickMenu(run, '新建白板')
    await expect.poll(() => existsSync(join(vault, '剪藏/极光摄影/未命名白板.md'))).toBe(true)
    // 打开首页 / 在新标签打开首页
    await row(page, '书摘').click({ button: 'right' })
    await pickMenu(run, '在新标签打开首页')
    await expect(tabOn(page)).toHaveText('书摘')
    await row(page, '极光摄影').click({ button: 'right' })
    await pickMenu(run, '打开首页')
    await expect(tabOn(page)).toHaveText('极光摄影')
    // 重命名（F2 也行）
    await row(page, '书摘').click()
    await row(page, '书摘').press('F2')
    const name = side(page).getByRole('textbox', { name: '新名字' })
    await name.fill('读书摘抄')
    await name.press('Enter')
    await expect.poll(() => existsSync(join(vault, '剪藏/读书摘抄/人类简史摘录.md'))).toBe(true)
    // 移到 › 测试库（库的最外层，菜单里写库名）：开着的首页标签跟着换路径，一次提交
    await row(page, '极光摄影').click({ button: 'right' })
    await pickMenu(run, '移到 › 测试库')
    await expect.poll(() => existsSync(join(vault, '极光摄影/三脚架怎么选.md'))).toBe(true)
    expect(existsSync(join(vault, '剪藏/极光摄影'))).toBe(false)
    await expect.poll(() => lastCommit(vault)).toBe('移动文件夹：剪藏/极光摄影 → 极光摄影')
    await page.getByRole('tab', { name: /^极光摄影/ }).click()
    await expect(pane(page)).toHaveAttribute('data-folder', '极光摄影')
    // 分类（软件自带）没有重命名、移到、移到废纸篓；默认在左边，所以是「从左边拿下」
    await row(page, '剪藏').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['新建笔记', '新建白板', '新建文件夹', '打开首页', '在新标签打开首页', '置顶', '从左边拿下', '换图标和颜色…', '在访达中显示', '拷贝路径'])
    await pickMenu(run, '拷贝路径')
  } finally {
    await run.close()
  }
})

test('放到左边：活动栏最后一段多一格（单色符号）、左栏是它自己的树、底下「在「文件」里看位置」；活动栏右键 从左边拿下（能撤回）/ 在「文件」里看位置 / 换图标和颜色 / 上移 / 下移（只在自己那一段里）/ 拖着排', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    // 分类默认都在左边：拿写作里的「游记」来放
    await row(page, '写作').locator('.ft-tw').click()
    await row(page, '游记').click({ button: 'right' })
    await pickMenu(run, '放到左边')
    const w = bar(page).getByRole('button', { name: '游记', exact: true })
    await expect(w).toHaveAttribute('aria-pressed', 'true')
    expect(await barNames(page)).toEqual(['文件', '最近', '书桌', ...CATS, '游记', '梦游报告', '库', '设置和外观'])
    expect(await bar(page).locator('.ab-sep').count()).toBe(5)
    await expect.poll(() => left(vault).左边).toEqual([...CATS, '写作/游记'])
    // 左栏是「写作/游记/」那一枝；新建笔记进游记
    await expect(side(page).locator('.vh .t')).toHaveText('游记')
    expect(await rowNames(page)).toEqual(['冬天的赫尔辛基', '京都三日', '去冰岛之前要知道的十件事', '一个人的东京'])
    await side(page).getByRole('button', { name: '新建笔记' }).click()
    await expect.poll(() => existsSync(join(vault, '写作/游记/未命名.md'))).toBe(true)
    // 活动栏右键：只有它一个自己摘的，上移、下移都灰着（不跨到分类那几段）
    await w.click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['从左边拿下', '在「文件」里看位置', '换图标和颜色…', '上移', '下移'])
    expect(m.find((i) => i.label === '上移')!.enabled).toBe(false)
    expect(m.find((i) => i.label === '下移')!.enabled).toBe(false)
    await pickMenu(run, '换图标和颜色…')
    const pick = page.getByRole('dialog', { name: '换图标和颜色' })
    await pick.getByRole('option', { name: 'edit', exact: true }).click()
    await pick.getByRole('option', { name: '橙', exact: true }).click()
    await page.keyboard.press('Escape')
    // 活动栏只用单色符号
    await expect(w.locator('.fglyph')).toHaveAttribute('data-icon', 'edit')
    expect(await w.locator('.fglyph').evaluate((el) => el.getAttribute('style'))).toBeNull()
    // 分类那几格：在自己那一段里上移、下移；段里第一个没有上移
    const cell = (name: string) => bar(page).getByRole('button', { name, exact: true })
    await cell('写作').click({ button: 'right' })
    await pickMenu(run, '上移')
    await expect.poll(() => left(vault).左边.slice(4, 8)).toEqual(['写作', '周记', '项目', '生活'])
    await cell('写作').click({ button: 'right' })
    expect((await openedMenu(run)).find((i) => i.label === '上移')!.enabled).toBe(false)
    await pickMenu(run, '下移')
    await expect.poll(() => left(vault).左边.slice(4, 8)).toEqual(['周记', '写作', '项目', '生活'])
    // 按住拖：生活拖到周记前面（同一段）挪了；拖到课程上（别的段）不挪
    await cell('生活').dragTo(cell('周记'))
    await expect.poll(() => left(vault).左边.slice(4, 8)).toEqual(['生活', '周记', '写作', '项目'])
    await cell('生活').dragTo(cell('课程'))
    await page.waitForTimeout(300)
    expect(left(vault).左边.slice(1, 8)).toEqual(['课程', '阅读', '剪藏', '生活', '周记', '写作', '项目'])
    // 点「游记」那一格（先换到文件，不然亮着的那格再点是收起左栏）：中间是它的首页，组件在上、内容在下；头上的方块用同一个图标和颜色
    await leftView(page, '文件')
    await w.click()
    await expect(tabOn(page)).toHaveText('游记')
    await expect(pane(page).getByTestId('folder-badge')).toHaveAttribute('data-icon', 'edit')
    const widgetsTop = (await pane(page).locator('.wgrid').boundingBox())!.y
    const contentTop = (await pane(page).getByTestId('folder-content').boundingBox())!.y
    expect(widgetsTop).toBeLessThan(contentTop)
    // 在「文件」里看位置（右键）：换到文件，游记那一行外圈
    await w.click({ button: 'right' })
    await pickMenu(run, '在「文件」里看位置')
    await expect(bar(page).getByRole('button', { name: '文件', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(row(page, '游记')).toHaveClass(/ring/)
    // 底下「在「文件」里看位置」同一件事
    await w.click()
    await side(page).getByRole('button', { name: /在「文件」里看位置/ }).click()
    await expect(row(page, '游记')).toHaveClass(/ring/)
    // 从左边拿下：格子没了，文件夹本身不动；底部能撤回
    await w.click({ button: 'right' })
    await pickMenu(run, '从左边拿下')
    await expect(w).toHaveCount(0)
    expect(existsSync(join(vault, '写作/游记/京都三日.md'))).toBe(true)
    await page.getByTestId('toast').getByRole('button', { name: '撤回' }).click()
    await expect(w).toHaveCount(1)
    // 分类也能拿下来，再从树上「放到左边」放回去（放回去还在自己那一段）
    await cell('课程').click({ button: 'right' })
    await pickMenu(run, '从左边拿下')
    await expect(cell('课程')).toHaveCount(0)
    await expect.poll(() => left(vault).左边.includes('课程')).toBe(false)
    await row(page, '课程').click({ button: 'right' })
    await pickMenu(run, '放到左边')
    expect(await barNames(page)).toEqual(['文件', '最近', '书桌', '收件箱', '阅读', '剪藏', '课程', '生活', '周记', '写作', '项目', '游记', '梦游报告', '库', '设置和外观'])
    await expect(side(page).locator('.vh .t')).toHaveText('课程')
  } finally {
    await run.close()
  }
})

test('每个文件夹都有首页：头（图标、名字、位置·篇数·改于）、子文件夹卡片、白板缩略图、PDF 封面、笔记一行预览和「再显示」、类型和排序', async () => {
  const run = await start()
  const { page } = run
  try {
    await row(page, '剪藏').locator('.ft-tw').click()
    await row(page, '冰岛旅行').click()
    await expect(tabOn(page)).toHaveText('冰岛旅行')
    // 点名字也顺手展开
    await expect(row(page, '冰岛旅行')).toHaveAttribute('aria-expanded', 'true')
    const p = pane(page)
    // 「冰岛自驾指南」PDF 和它的笔记是一行，算一篇（task-9okg5）
    await expect(p.locator('.fh-tx p')).toHaveText(/^剪藏 \/ 冰岛旅行 · 17篇 · 改于/)
    const c = p.getByTestId('folder-content')
    await expect(c.locator('.fc-n')).toHaveText('17篇')
    await expect(c.getByRole('region', { name: '文件夹' }).locator('.fc-fcard')).toHaveCount(3)
    await expect(c.getByRole('region', { name: '文件夹' }).locator('.fc-fcard').filter({ hasText: '住宿' })).toContainText('3篇')
    await expect(c.getByRole('region', { name: '白板' }).locator('.bth i').first()).toBeVisible()
    await expect(c.getByRole('region', { name: '白板' }).locator('.fc-tcard').filter({ hasText: '预算' })).toContainText('4张卡片')
    // PDF 封面是课件封面缓存那一份（画好的 PNG）
    await expect.poll(() => c.getByRole('region', { name: 'PDF' }).locator('img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(100)
    await expect(c.getByRole('region', { name: 'PDF' }).locator('.fc-tcard').filter({ hasText: '冰岛自驾指南' })).toContainText('6页 · 读到3')
    // 笔记：先 4 篇，「再显示 2 篇」（「冰岛自驾指南 笔记」和它的 PDF 是一张卡，不在笔记里另列）
    const notes = c.getByRole('region', { name: '笔记' })
    await expect(notes.locator('.fc-row')).toHaveCount(4)
    await expect(notes.locator('.fc-row').filter({ hasText: '一、最佳旅游季节' }).locator('.pv')).toHaveText('夏季白昼长，适合自驾环岛；冬季看极光，路况差。')
    await notes.getByRole('button', { name: /再显示/ }).click()
    await expect(notes.locator('.fc-row')).toHaveCount(6)
    // 类型筛选：白板 → 只剩两块白板
    await c.getByRole('tablist', { name: '类型' }).getByRole('tab', { name: '白板' }).click()
    await expect(c.locator('.fc-n')).toHaveText('2篇')
    await expect(c.getByRole('region', { name: '笔记' })).toHaveCount(0)
    await c.getByRole('tablist', { name: '类型' }).getByRole('tab', { name: '全部' }).click()
    // 排序按钮带菜单（系统菜单）：名字 A → Z
    await c.getByRole('button', { name: '排序' }).click()
    expect(menuLabels(await openedMenu(run))).toEqual(['修改时间（新的在前）', '修改时间（旧的在前）', '创建时间（新的在前）', '创建时间（旧的在前）', '名字（A → Z）', '名字（Z → A）'])
    await pickMenu(run, '名字（A → Z）')
    await expect(c.locator('.fc-sort')).toContainText('名字')
    // 点子文件夹卡片 → 它的首页；点白板 → 开白板
    await c.locator('.fc-fcard').filter({ hasText: '住宿' }).click()
    await expect(tabOn(page)).toHaveText('住宿')
    await expect(pane(page).getByTestId('folder-content').getByRole('region', { name: '笔记' }).locator('.fc-row')).toHaveCount(3)
    // 空文件夹：一句话
    await row(page, '剪藏').click({ button: 'right' })
    await pickMenu(run, '新建文件夹')
    await side(page).getByRole('textbox', { name: '新文件夹的名字' }).fill('空的')
    await page.keyboard.press('Enter')
    await row(page, '空的').click()
    await expect(pane(page).getByTestId('folder-content')).toContainText('这个文件夹还是空的')
  } finally {
    await run.close()
  }
})

test('窄窗口（1100×700，左右栏都开着）文件夹首页：名字优先、篇数和日期先省略；头上一句放不下整行省略，不折两行（第 1 轮美学）', async () => {
  const run = await start()
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 700))
    await rail(page).getByRole('button', { name: /^历史/ }).click()
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    await row(page, '剪藏').locator('.ft-tw').click()
    await row(page, '冰岛旅行').click()
    const c = pane(page).getByTestId('folder-content')
    await expect(c.locator('.fc-fcard')).toHaveCount(3)
    // 子文件夹卡片：名字一个字都不少，右边「2 篇 · 10月8日」放不下时省略
    const cards = await c.locator('.fc-fcard .fn').evaluateAll((els) =>
      els.map((e) => {
        const n = e.querySelector('.truncate') as HTMLElement
        const m = e.querySelector('.fm') as HTMLElement
        return { name: n.textContent, full: n.scrollWidth <= n.clientWidth, metaEllipsis: getComputedStyle(m).textOverflow }
      }),
    )
    expect(cards.map((x) => x.name).sort()).toEqual(['住宿', '美食', '路线'])
    expect(cards.every((x) => x.full && x.metaEllipsis === 'ellipsis')).toBe(true)
    // 白板卡：「冰岛十天环岛」整个露出来
    const tn = c.locator('.fc-tcard .tn .truncate').filter({ hasText: '冰岛十天环岛' })
    expect(await tn.evaluate((n) => n.scrollWidth <= n.clientWidth)).toBe(true)
    // 头上一句：一行
    const lead = pane(page).locator('.fh-tx p')
    const one = await lead.evaluate((e) => ({ h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || 18, ws: getComputedStyle(e).whiteSpace }))
    expect(one.ws).toBe('nowrap')
    expect(one.h).toBeLessThan(one.lh * 1.5)
  } finally {
    await run.close()
  }
})

test('树里 PDF 名字优先：放不下先整个藏「3/6」，再藏「PDF」小标，不截成半个；名字至少露 6 个字（第 1 轮美学）', async () => {
  const run = await start()
  const { page } = run
  try {
    await row(page, '剪藏').locator('.ft-tw').click()
    await row(page, '冰岛旅行').locator('.ft-tw').click()
    const look = (name: string) =>
      row(page, name).evaluate((r) => {
        const top = r.getBoundingClientRect().top
        const shown = (sel: string) => {
          const e = r.querySelector(sel) as HTMLElement | null
          return e ? e.getBoundingClientRect().top - top < 28 : null
        }
        const n = r.querySelector('.truncate') as HTMLElement
        return { full: n.scrollWidth <= n.clientWidth, nameW: n.clientWidth, ext: shown('.ft-ext'), meta: shown('.ft-meta'), h: r.getBoundingClientRect().height }
      })
    for (const w of [320, 248, 200]) {
      await page.evaluate((px) => document.documentElement.style.setProperty('--side-w', px + 'px'), w)
      await page.waitForTimeout(100)
      const a = await look('冰岛自驾指南')
      // 名字整个露出来（6 个字），行高不变
      expect(a, `左栏 ${w}`).toMatchObject({ full: true, h: 28 })
      // 先藏 3/6 再藏小标：小标藏了，3/6 一定也藏了
      if (a.ext === false) expect(a.meta).toBe(false)
    }
    // 最窄时长名字：至少露 6 个字那么宽，后面的都藏到看不见的第二行
    const lp = await look('Lonely Planet 冰岛')
    expect(lp.nameW).toBeGreaterThanOrEqual(6 * 13)
  } finally {
    await run.close()
  }
})

test('最近：左栏 置顶 / 今天 / 这周 / 按月收起；中间整页写标题回车新建进收件箱、筛选标题文件夹正文', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await leftView(page, '最近')
    const groups = side(page).locator('.s-group')
    expect(await groups.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['今天', '这周', '十月', '九月'])
    await expect(side(page).getByRole('group', { name: '今天' }).locator('.si')).toHaveCount(3)
    // 按月收起：点开才列
    const oct = side(page).getByRole('group', { name: '十月' })
    await expect(oct.locator('.si')).toHaveCount(1)
    await expect(oct.locator('.s-fold')).toContainText(/\d+篇/)
    await oct.locator('.s-fold').click()
    expect(await oct.locator('.si').count()).toBeGreaterThan(10)
    // 置顶的在最上面
    await side(page).getByRole('group', { name: '今天' }).locator('.si', { hasText: '冰岛旅游 2' }).click({ button: 'right' })
    await pickMenu(run, '置顶')
    await expect(side(page).locator('.s-group').first()).toHaveAttribute('aria-label', '置顶')
    // 在中间打开：写个标题回车，新建进收件箱并打开
    await side(page).getByRole('button', { name: '在中间打开' }).click()
    await expect(tabOn(page)).toHaveText('最近')
    const p = pane(page)
    await expect(p.getByRole('textbox', { name: '新建一篇的标题' })).toHaveAttribute('placeholder', '写个标题，回车新建一篇 · 放进「收件箱」')
    await p.getByRole('textbox', { name: '新建一篇的标题' }).fill('冰岛旅游 3')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('冰岛旅游 3')
    await expect.poll(() => existsSync(join(vault, '收件箱/冰岛旅游 3.md'))).toBe(true)
    // 回到最近页：筛选正文里的字
    await page.getByRole('tab', { name: /^最近/ }).click()
    await pane(page).getByRole('textbox', { name: '筛选' }).fill('road.is')
    await expect(pane(page).getByRole('list', { name: '最近的笔记' }).locator('.rp-row')).toHaveCount(2)
    expect((await pane(page).getByRole('list', { name: '最近的笔记' }).locator('.rp-row .t').allTextContents()).sort()).toEqual(['一号公路东段', '一号公路冬季路况'])
    await pane(page).getByRole('list', { name: '最近的笔记' }).locator('.rp-row', { hasText: '一号公路东段' }).click()
    await expect(tabOn(page)).toHaveText('一号公路东段')
  } finally {
    await run.close()
  }
})
