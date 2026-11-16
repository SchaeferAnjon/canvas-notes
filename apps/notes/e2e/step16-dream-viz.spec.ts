import { expect, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, acts } from './app'
import { LECTURE } from './fixtures/pdf'

const NOTE = '课程/线性代数/第3讲 线性映射 笔记.md'
const NOTE_MD = `---
类型: 笔记
课程: 线性代数
第几讲: 3
来源: "[[第3讲 线性映射.pdf]]"
日期: 2026-11-16
---
# 第3讲 线性映射 笔记

## 第 5 页 · 旋转矩阵每个数从哪来
[第 5 页](第3讲%20线性映射.pdf#page=5) · 10:20

> [!question] 我的疑惑
> 整块没看懂：旋转矩阵的四个数是怎么来的
> 还是不懂 −sin θ 为什么在右上角

> [!success] 讲通的讲法（第 2 版）
> 先别看公式，看图：e₂ 转完往左偏。

<details><summary>没讲通 · 第 1 版：套公式</summary>

列就是基向量去哪。

</details>

[完整对话 · 3 轮](../../.canvas-notes/对话/第3讲%20线性映射-p5-1.md)
`

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

test('梦游做可视化：挑今天卡得最久的那处做一个 HTML，报告里「可视化」一组，预览梦游分支上的那份，收下才进课程文件夹、挂到笔记那一段', async () => {
  const run = await launch({ '课程/线性代数/第3讲 线性映射.pdf': LECTURE }, { CN_AI_FAKE: '1' }, (vault) => {
    // 今天问过第 5 页（问了 3 轮、1 次还是不懂）：记笔记的那次提交
    mkdirSync(join(vault, '课程/线性代数'), { recursive: true })
    writeFileSync(join(vault, NOTE), NOTE_MD)
    git(vault, 'add', '-A')
    git(vault, 'commit', '-qm', '笔记：第3讲 线性映射 第 5 页 · 旋转矩阵每个数从哪来')
    writeFileSync(join(vault, '随手记.md'), '# 随手记\n')
  })
  const { page, vault } = run
  try {
    const card = page.getByTestId('dream-card')
    await card.getByRole('button', { name: '现在梦游' }).click()
    await expect(card.locator('h3')).toContainText('等你过目', { timeout: 30_000 })
    await expect(card.locator('.l')).toContainText(['1 个可视化'])
    // 只在分支上：课程文件夹里还没有
    expect(existsSync(join(vault, '课程/线性代数/旋转矩阵.html'))).toBe(false)
    expect(gitStatus(vault)).toBe('')

    await card.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.locator('.dg', { hasText: '可视化' })).toContainText('1 条')
    const item = panel.getByTestId('dream-item').filter({ hasText: '旋转矩阵 · 拖动角度看基向量' })
    await expect(item).toContainText('新文件 课程/线性代数/旋转矩阵.html · 挂到「第3讲 线性映射 笔记」第 5 页')
    await item.click()
    const detail = panel.getByTestId('dream-detail')
    await expect(detail).toContainText('你今天在第 5 页「旋转矩阵每个数从哪来」问了 3 轮、1 次还是不懂')
    // 预览：中间栏开梦游分支上的那份，在沙箱里跑，不能问
    await detail.getByRole('button', { name: '预览可视化' }).click()
    const pane = page.locator('.htmlpane:not([hidden])')
    await expect(acts(page).getByTestId('page-note')).toContainText('梦游做的可视化 · 还没收下')
    await expect(acts(page).getByRole('button', { name: '问这一屏' })).toHaveCount(0)
    await expect(page.frameLocator('[data-testid="html-frame"]').locator('h1')).toHaveText('第 5 页 · 拖动角度')
    // 收下：进课程文件夹，笔记那一段的脚上挂着可视化，一次提交
    await detail.getByRole('button', { name: '收下' }).click()
    await expect.poll(() => existsSync(join(vault, '课程/线性代数/旋转矩阵.html'))).toBe(true)
    expect(readFileSync(join(vault, '课程/线性代数/旋转矩阵.html'), 'utf8')).toContain('<meta name="做的" content="梦游">')
    expect(readFileSync(join(vault, NOTE), 'utf8')).toContain('[可视化 · 旋转矩阵 · 拖动角度看基向量](旋转矩阵.html)')
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
