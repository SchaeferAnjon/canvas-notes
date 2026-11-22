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

test('梦游做可视化：挑今天卡得最久的那处做一个 HTML，报告里「可视化」一组，中间对照里就是梦游分支上那张图，收下才进课程文件夹、嵌进笔记那一段', async () => {
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
    await expect(card.locator('.l')).toContainText(['1个可视化'])
    // 只在分支上：课程文件夹里还没有
    expect(existsSync(join(vault, '课程/线性代数/旋转矩阵.html'))).toBe(false)
    expect(gitStatus(vault)).toBe('')

    await card.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.locator('.dg', { hasText: '可视化' })).toContainText('1条')
    const item = panel.getByTestId('dream-item').filter({ hasText: '旋转矩阵 · 拖动角度看基向量' })
    await expect(item).toContainText('新文件 课程/线性代数/旋转矩阵.html · 挂到「第3讲 线性映射 笔记」第5页')
    await item.click()
    const detail = panel.getByTestId('dream-detail')
    // 点一条中间开它（task-m552v）：为什么、谁做的在条目头上
    const dt = page.locator('[data-testid="dream-tab"]:not([hidden])')
    await expect(dt.getByTestId('dream-why')).toContainText('你今天在第5页「旋转矩阵每个数从哪来」问了3轮、1次还是不懂')
    // 写着是哪家哪个模型做的（CN-54，设置 › AI 的「梦游」）
    await expect(dt.getByTestId('dream-by')).toHaveText('Claude Code · Opus 5.5做的')
    // 侧栏不铺 HTML 源码：每个文件一行人话带在哪（CN-55 / 63）；笔记在前，HTML 在后
    const changes = detail.getByTestId('dream-change')
    await expect(changes.locator('.tx > span')).toHaveText(['第3讲 线性映射 笔记：第5页那段末尾嵌进可视化', /^旋转矩阵\.html：新建，\d+ (B|KB)$/])
    await expect(changes.locator('.p')).toHaveText(['线性代数 › 第3讲 线性映射.pdf', '线性代数 › 第3讲 线性映射.pdf › 笔记'])
    await expect(detail.locator('.dl')).toHaveCount(0)
    // 没有「预览可视化」：点 HTML 那行，中间换成它，右边就是那张图（梦游分支上那份，沙箱里能拖）
    await expect(detail.getByRole('button', { name: '预览可视化' })).toHaveCount(0)
    await changes.nth(1).click()
    await expect(dt.getByTestId('dream-void')).toContainText('main 上还没有这个文件')
    await expect(dt.frameLocator('[data-testid="viz-frame"]').locator('h1')).toHaveText('第 5 页 · 拖动角度')
    // 「打开「旋转矩阵.html」· 梦游分支上的」：中间开梦游分支上那份，在沙箱里跑，不能问
    await dt.getByTestId('dream-open').click()
    await expect(acts(page).getByTestId('page-note')).toContainText('梦游做的可视化 · Claude Code · Opus 5.5 · 还没收下')
    await expect(acts(page).getByRole('button', { name: '问这一屏' })).toHaveCount(0)
    await expect(page.frameLocator('.htmlpane:not([hidden]) [data-testid="html-frame"]').locator('h1')).toHaveText('第 5 页 · 拖动角度')
    // 收下：进课程文件夹，笔记那一段末尾嵌着可视化（task-m552v：写成嵌入），一次提交
    await detail.getByRole('button', { name: '收下' }).click()
    await expect.poll(() => existsSync(join(vault, '课程/线性代数/旋转矩阵.html'))).toBe(true)
    expect(readFileSync(join(vault, '课程/线性代数/旋转矩阵.html'), 'utf8')).toContain('<meta name="做的" content="梦游">')
    expect(readFileSync(join(vault, NOTE), 'utf8')).toContain('\n![可视化 · 旋转矩阵 · 拖动角度看基向量](旋转矩阵.html)\n')
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
