// 第 3 段：左栏「最近 / 全部文件」和目录树（设计 design/pdf/ 方向 A §1.8）。
// 全部文件 = 整个库的树（md、PDF、HTML），PDF 和课程文件夹旁边是进度；点课程文件夹的名字开它的首页，点箭头只展开；
// 梦游预览时树也画成改好以后的样子。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, pane, rail, tabOn, leftView } from './app'
import { LECTURE } from './fixtures/pdf'

const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ hasText: new RegExp(`^${name}`) })
/** 左图标栏的「最近」「文件」（原来左栏中部的「最近 / 全部文件」分段拆成两个图标） */
const sideTab = (page: Page, name: '最近' | '全部文件') => page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: name === '全部文件' ? '文件' : name, exact: true })

const FILES: Record<string, string | Uint8Array> = {
  '课程/线性代数/第2讲 向量空间.pdf': LECTURE,
  '课程/线性代数/第2讲 向量空间 笔记.md': '---\n类型: 笔记\n进度: 5/5\n---\n## 第 5 页\n',
  '课程/线性代数/第3讲 线性映射.pdf': LECTURE,
  '课程/线性代数/第3讲 线性映射 笔记.md': '---\n类型: 笔记\n进度: 3/5\n---\n## 第 3 页\n',
  '课程/线性代数/第10讲 二次型.pdf': LECTURE,
  '课程/线性代数/旋转矩阵.html': '<!doctype html><title>旋转矩阵</title><p>拖动角度</p>',
  '课程/线性代数/我的疑惑.md': '# 我的疑惑\n',
  '生活/周末.md': '# 周末\n',
  '收件箱/一条速记.md': '记得买相框。\n',
}

test('全部文件：整个库的树，PDF 和课程旁边是进度；点文件开标签，点课程名字开首页、点箭头只展开；新加的 PDF 自己出现；切回最近', async () => {
  const run = await launch(FILES)
  const { page, vault } = run
  try {
    // 默认是原来那套「最近」
    await expect(sideTab(page, '最近')).toHaveAttribute('aria-pressed', 'true')
    await expect(tree(page)).toHaveCount(0)
    await sideTab(page, '全部文件').click()
    // 顶层按 课程 / 生活 / 收件箱 排；课程默认展开；原来的分组都让开了
    await expect(tree(page).getByRole('treeitem', { level: 1 })).toHaveText(['课程', '生活', '收件箱'])
    await expect(page.locator('aside.side').getByRole('group', { name: '最近的白板' })).toBeHidden()
    await expect(page.locator('aside.side .sall')).toBeHidden()
    // 线性代数：3 份课件问完 1 份
    await expect(item(page, '线性代数').locator('.ft-meta')).toHaveText('1/3 讲')

    // 点箭头只展开（不开首页）：我的疑惑在最上，同一讲课件和笔记挨着，第 10 讲排在第 3 讲后面；名字不带扩展名
    await item(page, '线性代数').getByRole('button', { name: '展开 线性代数' }).click()
    await expect(tree(page).getByRole('treeitem', { level: 3 })).toHaveText([/^我的疑惑/, /^第2讲 向量空间/, /^第2讲 向量空间 笔记/, /^第3讲 线性映射3\/5/, /^第3讲 线性映射 笔记/, /^第10讲 二次型/, /^旋转矩阵/])
    await expect(page.locator('.tab', { hasText: '线性代数' })).toHaveCount(0)
    // 问完的是绿勾，问了一些写 3/5，没开始什么都不写
    await expect(item(page, '第2讲 向量空间').first().locator('.done')).toBeVisible()
    await expect(item(page, '第3讲 线性映射').first().locator('.ft-meta')).toHaveText('3/5')
    await expect(item(page, '第10讲 二次型').locator('.ft-meta')).toHaveText('')

    // 点 PDF 开 PDF 标签，这一行变成当前
    await item(page, '第3讲 线性映射').first().click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await expect(item(page, '第3讲 线性映射').first()).toHaveAttribute('aria-selected', 'true')
    // HTML 开 HTML 标签
    await item(page, '旋转矩阵').click()
    await expect(tabOn(page)).toHaveText('旋转矩阵')

    // 点课程文件夹的名字：开它的首页
    await item(page, '线性代数').locator('.truncate').click()
    await expect(page.getByTestId('folder-home').locator('.fh-title h2')).toHaveText('线性代数')
    await expect(item(page, '线性代数')).toHaveAttribute('aria-selected', 'true')

    // 外面新加一份 PDF：树里自己出现
    mkdirSync(join(vault, '课程/线性代数'), { recursive: true })
    writeFileSync(join(vault, '课程/线性代数/第4讲 特征值.pdf'), LECTURE)
    await expect(item(page, '第4讲 特征值')).toBeVisible({ timeout: 10_000 })

    // 记住选的是全部文件；切回最近，原来那套回来
    await sideTab(page, '最近').click()
    await expect(tree(page)).toHaveCount(0)
    await expect(page.locator('aside.side').getByRole('group', { name: '这周动过的' })).toBeVisible()
    // 文件页头的「按名字跳」开 ⌘O
    await sideTab(page, '全部文件').click()
    await page.locator('aside.side').getByRole('button', { name: '按名字跳' }).click()
    await expect(page.getByRole('dialog', { name: '按名字跳到' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('梦游预览时目录树画成改好以后的样子：挪来的标「新」，收件箱里留划掉的影子；点挪来的那篇开的是它现在的位置', async () => {
  const run = await launch(
    {
      '课程/线性代数/第3讲 线性映射.md': '# 第3讲 线性映射\n\n课上讲了线性映射的定义。\n',
      '收件箱/一条速记.md': '---\ncreated: 2026-11-15 20:10\n---\n周末去花市买绣球，顺便看看多肉。\n',
      '收件箱/说不好的.md': '---\ncreated: 2026-11-15 20:30\n---\n一句说不好放哪的话。\n',
    },
    { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '300' },
  )
  const { page } = run
  try {
    await sideTab(page, '全部文件').click()
    await leftView(page, '梦游报告')
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByRole('button', { name: '现在梦游' }).click()
    await expect(panel.getByTestId('dream-summary')).toContainText('点「预览」看改好后的样子', { timeout: 30_000 })
    await panel.getByRole('region', { name: '归类和改名' }).getByRole('button', { name: '预览' }).click()
    await expect(page.getByTestId('preview-bar')).toBeVisible()

    // 树里：生活/周末去花市买 是挪来的（标「新」），收件箱里原来那篇留划掉的影子
    await expect(tree(page).getByRole('treeitem', { level: 1 })).toHaveText(['课程', '生活', '收件箱'])
    await item(page, '生活').getByRole('button', { name: '展开 生活' }).click()
    const moved = item(page, '周末去花市买')
    await expect(moved.locator('.tag-new')).toHaveText('新')
    await item(page, '收件箱').getByRole('button', { name: '展开 收件箱' }).click()
    await expect(tree(page).locator('.pv-ghost')).toHaveText('一条速记挪到 生活')
    await expect(item(page, '说不好的')).toBeVisible()
    // 点挪来的那篇：开的是它现在（还在收件箱里）的那篇
    await moved.click()
    await expect(tabOn(page)).toHaveText('一条速记')
  } finally {
    await run.close()
  }
})
