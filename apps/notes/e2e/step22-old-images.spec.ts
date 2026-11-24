// 梦游把老图挪进各篇自己的附件文件夹（2026-11-17 用户定，four-items 第 4 节）：报告「附件」组一条，两行例子、不挪的一句；
// 「预览」在中间开「梦游预览 · 挪老图」，按笔记分组列出每张从哪到哪、在哪一节，不挪的写原因；「收下这一条」一次提交进 main，提示条上能撤回。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, leftView, tabOn } from './app'
import { solidPng } from './fixtures/png'
import { armMenus, menuLabels, openedMenu, dismissMenu } from './menu'
import { shotPart, shotTone, shotWindow } from './shots'

const png = solidPng(64, 40, [80, 140, 120])
const L5 = '# Lecture05 笔记\n\n这一讲讲比较静态。\n\n![](../../附件/image-1.png)\n\n## 为什么要先看符号\n\n![第 2 张](../../附件/image-2.png) 和 ![共用](../../附件/image-12.png)\n'
const FILES: Record<string, string | Uint8Array> = {
  '课程/ecp/Lecture05 笔记.md': L5,
  '课程/ecp/Lecture04 笔记.md': '# Lecture04 笔记\n\n![](../../附件/image-12.png)\n',
  '读书/置身事内.md': '# 置身事内\n\n## 第二章 · 土地财政\n\n![](../附件/image-14.png)\n',
  '附件/image-1.png': png,
  '附件/image-2.png': png,
  '附件/image-12.png': png,
  '附件/image-14.png': png,
  '附件/image-30.png': png,
}
const git = (vault: string, ...a: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...a], { encoding: 'utf8' })
const panel = (page: Page) => page.getByRole('complementary', { name: '梦游报告' })

test('老图：报告里一条，预览按笔记分组列出每张从哪到哪；收下一次提交、图挪了链接改了；撤回回到原样', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await shotTone(page)
    await leftView(page, '梦游报告')
    await panel(page).getByRole('button', { name: '现在梦游' }).click()
    await expect(panel(page).getByTestId('dream-summary')).toContainText('整理了', { timeout: 30_000 })
    await expect(panel(page).locator('.dg').first()).toHaveText('附件1条')
    const item = panel(page).getByTestId('dream-item').filter({ hasText: '把3张老图挪进各篇自己的附件文件夹' })
    await expect(item).toContainText('改2篇里的链接')
    await item.click()
    const detail = panel(page).getByTestId('dream-detail')
    const sum = detail.getByTestId('old-images-summary')
    await expect(sum).toContainText('附件/image-1.png→ 附件/课程/ecp/Lecture05 笔记/')
    await expect(sum).toContainText('还有1张 · 共改2篇3处链接')
    await expect(detail.locator('.dkeep')).toHaveText('2张不挪：1张几篇都在用，1张没有哪篇在用。')
    await shotPart(panel(page), 'old-images-report')

    // 点这一条中间就开它的预览标签（task-m552v：点一条中间开这一条，小卡里不再另有「预览」），按笔记分组
    await expect(detail.getByRole('button', { name: '预览' })).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('梦游预览 · 挪老图')
    const pv = page.getByTestId('old-images')
    await expect(pv.locator('h1')).toHaveText('挪3张老图')
    await expect(pv.locator('.oi-chip')).toHaveText(['3张挪走', '1张几篇都在用，留在原处', '1张没有哪篇在用，不动'])
    await expect(pv.locator('.oi-gh b')).toHaveText(['课程/ecp/Lecture05 笔记', '读书/置身事内', '不挪的2张'])
    await expect(pv.getByTestId('old-image-move')).toHaveText([
      /^附件\/image-1\.png附件\/课程\/ecp\/Lecture05 笔记\/image-1\.pngLecture05 笔记$/,
      /^附件\/image-2\.png附件\/课程\/ecp\/Lecture05 笔记\/image-2\.png为什么要先看符号$/,
      /^附件\/image-14\.png附件\/读书\/置身事内\/image-14\.png第二章 · 土地财政$/,
    ])
    await expect(pv.locator('.oi-link').first()).toContainText('![](../../附件/image-1.png)→![](../../附件/课程/ecp/Lecture05%20笔记/image-1.png)')
    await expect(pv.getByTestId('old-image-kept')).toHaveText(['附件/image-12.png《Lecture04 笔记》《Lecture05 笔记》都在用，留在原处', '附件/image-30.png没有哪篇在用：不动，要删在这里右键'])
    // 搜索
    await pv.getByRole('textbox', { name: '找一张图或一篇笔记' }).fill('置身')
    await expect(pv.getByTestId('old-image-move')).toHaveCount(1)
    await pv.getByRole('textbox', { name: '找一张图或一篇笔记' }).fill('')
    // 没人用的右键能删
    await armMenus(run)
    await pv.getByTestId('old-image-kept').last().click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['在访达中显示', '拷贝路径', '移到废纸篓'])
    await dismissMenu(run)
    // 还没收下：main 上一张都没动
    expect(existsSync(join(vault, '附件/image-1.png'))).toBe(true)
    await shotWindow(run, 'old-images-preview')

    // 收下这一条：一次提交，图挪了（不改名），链接改了；共用的、没人用的留原处
    const before = git(vault, 'rev-parse', 'HEAD').trim()
    await page.getByTestId('tab-acts').getByRole('button', { name: '收下', exact: true }).click()
    await expect(page.getByTestId('toast')).toContainText('老图挪好了，一次提交进了main')
    await expect.poll(() => existsSync(join(vault, '附件/课程/ecp/Lecture05 笔记/image-1.png'))).toBe(true)
    expect(existsSync(join(vault, '附件/image-1.png'))).toBe(false)
    expect(readFileSync(join(vault, '附件/读书/置身事内/image-14.png'))).toEqual(Buffer.from(png))
    expect(readFileSync(join(vault, '课程/ecp/Lecture05 笔记.md'), 'utf8')).toBe(L5.replace('../../附件/image-1.png', '../../附件/课程/ecp/Lecture05%20笔记/image-1.png').replace('../../附件/image-2.png', '../../附件/课程/ecp/Lecture05%20笔记/image-2.png'))
    for (const n of [12, 30]) expect(existsSync(join(vault, `附件/image-${n}.png`))).toBe(true)
    expect(git(vault, 'rev-list', '--count', `${before}..HEAD`).trim()).toBe('1')
    expect(git(vault, 'status', '--porcelain')).toBe('')
    await expect(page.getByTestId('tab-acts').getByTestId('page-note')).toHaveText('梦游 · 已收下')

    // 撤回：一次反向提交，回到收下前
    await page.getByTestId('toast').getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, '附件/image-1.png'))).toBe(true)
    expect(readFileSync(join(vault, '课程/ecp/Lecture05 笔记.md'), 'utf8')).toBe(L5)
    expect(git(vault, 'diff', '--stat', before, 'HEAD').trim()).toBe('')
  } finally {
    await run.close()
  }
})
