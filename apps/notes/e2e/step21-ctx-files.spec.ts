import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, leftView, openNote, tabOn } from './app'
import { armMenus, clipboardText, enabledOf, menuLabels, openedMenu, pickMenu } from './menu'

// 左栏笔记、目录树、标签的右键：点了真的挪文件、改名、新建、关标签

const row = (page: Page, name: string) => page.locator('.nav .si', { has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) }).first()

test('左栏笔记：右键「移到 › 文件夹」真的挪了文件、开着的标签跟着走；「拷贝双链」「拷贝路径」', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天。\n', '课程/线性代数/第一讲.md': '# 第一讲\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '日记')
    await row(page, '日记').click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['打开', '在新标签打开', '重命名', '移到', '置顶', '在访达中显示', '拷贝路径', '拷贝双链', '导出 PDF…', '导出为 Markdown…', '移到废纸篓'])
    // 每一层文件夹都能选：最外层八个分类都在（还没建的挪进去时建）；有子文件夹的点开是「放进「课程」」和它的子文件夹
    const move = m.find((i) => i.label === '移到')!.submenu!
    expect(menuLabels(move)).toEqual(['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活'])
    expect(menuLabels(move[1]!.submenu!)).toEqual(['放进「课程」', '线性代数'])
    await pickMenu(run, '拷贝双链')
    await expect.poll(() => clipboardText(run)).toBe('[[日记]]')

    await row(page, '日记').click({ button: 'right' })
    await pickMenu(run, '拷贝路径')
    await expect.poll(() => clipboardText(run)).toBe(join(vault, '日记.md'))

    await row(page, '日记').click({ button: 'right' })
    await pickMenu(run, '移到 › 课程 › 放进「课程」')
    await expect.poll(() => existsSync(join(vault, '课程', '日记.md'))).toBe(true)
    expect(existsSync(join(vault, '日记.md'))).toBe(false)
    await expect(page.getByTestId('toast')).toContainText('挪到了课程')
    // 开着的标签还在，换成了新路径：接着打字存进新文件
    await expect(tabOn(page)).toHaveText('日记')
    await expect(page.locator('.pane:not([hidden])')).toHaveAttribute('data-path', '课程/日记.md')
  } finally {
    await run.close()
  }
})

test('目录树：文件夹右键「新建笔记」建在那个文件夹里；文件右键「重命名」原地改名', async () => {
  const run = await launch({ '课程/线性代数/第一讲.md': '# 第一讲\n', '课程/线性代数/讲义.pdf': '%PDF-1.4\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    await tree.getByRole('treeitem', { name: /线性代数/ }).click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['新建笔记', '新建白板', '新建文件夹', '打开首页', '在新标签打开首页', '钉到最上面', '放到左边', '换图标和颜色…', '重命名…', '移到…', '在访达中显示', '拷贝路径', '移到废纸篓'])
    await pickMenu(run, '新建笔记')
    await expect.poll(() => readdirSync(join(vault, '课程', '线性代数')).sort()).toContain('未命名.md')
    await expect(page.getByTestId('tab-on')).toHaveText('未命名')

    await tree.getByRole('treeitem', { name: /第一讲/ }).click({ button: 'right' })
    await pickMenu(run, '重命名')
    const input = tree.getByRole('textbox', { name: '新名字' })
    await expect(input).toBeFocused()
    await input.fill('第一讲 向量')
    await input.press('Enter')
    await expect.poll(() => existsSync(join(vault, '课程', '线性代数', '第一讲 向量.md'))).toBe(true)

    // PDF：没有重命名、移到、置顶
    await tree.getByRole('treeitem', { name: /讲义/ }).click({ button: 'right' })
    const pdf = await openedMenu(run)
    expect(menuLabels(pdf)).toEqual(['打开', '在新标签打开', '在访达中显示', '拷贝路径', '拷贝双链', '移到废纸篓'])
    await pickMenu(run, '拷贝双链')
    await expect.poll(() => clipboardText(run)).toBe('[[讲义.pdf]]')
  } finally {
    await run.close()
  }
})

test('标签：右键「关闭右侧」「关闭其他」「拷贝路径」', async () => {
  const run = await launch({ '一.md': '# 一\n', '二.md': '# 二\n', '三.md': '# 三\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    for (const n of ['一', '二', '三']) await openNote(page, n)
    const tabs = page.getByTestId('tab-list').getByRole('tab')
    // 最前面还有首页
    await expect(tabs).toHaveCount(4)
    await tabs.nth(2).click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['关闭', '关闭其他', '关闭右侧', '关闭全部', '向右分屏', '向下分屏', '占满这一栏', '重命名', '在访达中显示', '拷贝路径'])
    await pickMenu(run, '拷贝路径')
    await expect.poll(() => clipboardText(run)).toBe(join(vault, '二.md'))

    await tabs.nth(2).click({ button: 'right' })
    await pickMenu(run, '关闭右侧')
    await expect(tabs).toHaveCount(3)
    await expect(tabs.nth(2)).toContainText('二')

    await tabs.nth(2).click({ button: 'right' })
    expect(enabledOf(await openedMenu(run), '关闭右侧')).toBe(false)
    await pickMenu(run, '关闭其他')
    await expect(tabs).toHaveCount(1)
    await expect(tabOn(page)).toHaveText('二')
  } finally {
    await run.close()
  }
})
