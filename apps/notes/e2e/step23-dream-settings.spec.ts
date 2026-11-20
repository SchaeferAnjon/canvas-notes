// 设置 › 梦游（「梦游每样能开关」）：真点开这一页、关掉补双链和做可视化、点「现在梦游」，报告里没有这两组、分支上也没有；
// 重开软件设置还在；自己梦游关了到点也不梦游；改完直接收下、报告顶上一键撤回；「用哪家 AI」那一行跳到 AI 页那一行。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gitStatus, launch } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { LECTURE } from './fixtures/pdf'

const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

const NOTE = '课程/线性代数/第3讲 线性映射 笔记.md'
/** 今天读 PDF 卡住的一处（问了 3 轮、1 次还是不懂）：可视化挑它 */
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

const files = { ...DREAM_VAULT, '课程/线性代数/第3讲 线性映射.pdf': LECTURE }
const withReading = (vault: string) => {
  mkdirSync(dirname(join(vault, NOTE)), { recursive: true })
  writeFileSync(join(vault, NOTE), NOTE_MD)
  // 只提交这一篇（别的样本留给 launch 那次提交）
  git(vault, 'add', '--', NOTE)
  git(vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', '笔记：第3讲 线性映射 第 5 页 · 旋转矩阵每个数从哪来')
}

const dialog = (page: Page) => page.getByRole('dialog', { name: '设置' })

async function openDreamSettings(page: Page) {
  await page.keyboard.press('Meta+,')
  await page.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '梦游', exact: true }).click()
  await expect(dialog(page).getByTestId('dream-set-now')).toBeVisible()
}

const sw = (page: Page, name: string) => dialog(page).getByRole('switch', { name, exact: true })

test('设置 › 梦游：关掉补双链和做可视化，点「现在梦游」，报告和分支上都没有这两组、别的照做；重开软件还是关着', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' }, withReading)
  const { page, vault, userData } = run
  let again: Awaited<ReturnType<typeof launch>> | null = null
  try {
    await openDreamSettings(page)
    const dlg = dialog(page)
    await expect(dlg.getByTestId('dream-set-now')).toContainText('还没梦游过')
    // 默认：每样都开着，文件夹勾着 收件箱、阅读、剪藏、周记，改完先预览
    const steps = dlg.getByRole('list', { name: '梦游能做哪些事' }).getByRole('listitem')
    await expect(steps).toHaveCount(8)
    await expect(steps.locator('.hd b')).toHaveText(['归类挪动收件箱里的笔记', '改名', '补双链', '写本周小结', '做HTML可视化', '老图挪进各篇的附件文件夹', '提醒可能重复', '提醒同一个视频记散在多篇'])
    await expect(dlg.locator('[data-step="link"] .eff')).toHaveText(['改正文'])
    await expect(dlg.locator('[data-step="viz"] .eff')).toHaveText(['新建文件', '改正文'])
    await expect(dlg.locator('[data-step="dup"] .eff')).toHaveText(['只提醒'])
    for (const name of ['自己梦游', '等上一份报告看完', '归类挪动收件箱里的笔记', '改名', '补双链', '写本周小结', '做HTML可视化', '老图挪进各篇的附件文件夹', '提醒可能重复', '提醒同一个视频记散在多篇'])
      await expect(sw(page, name)).toHaveAttribute('aria-checked', 'true')
    await expect(dlg.getByLabel('没人动多久算闲')).toHaveValue('15')
    await expect(dlg.getByLabel('两次之间至少隔')).toHaveValue('20')
    await expect(dlg.getByLabel('一晚最多补几处双链')).toHaveValue('30')
    await expect(dlg.getByLabel('一晚最多做几个可视化')).toHaveValue('3')
    await expect(dlg.getByLabel('一晚最多列几对可能重复')).toHaveValue('20')
    const folders = dlg.getByRole('group', { name: '梦游能动哪些文件夹' })
    for (const [name, on] of [['收件箱', true], ['课程', false], ['阅读', true], ['剪藏', true], ['周记', true], ['写作', false], ['项目', false], ['生活', false]] as const)
      await expect(folders.getByRole('checkbox', { name, exact: true })).toBeChecked({ checked: on })
    await expect(dlg.getByRole('radio', { name: /先预览，收下才进库/ })).toHaveAttribute('aria-checked', 'true')
    await expect(dlg.getByTestId('dream-set-ai')).toContainText('Claude Code')
    // 没有下拉、没有提示的几行一样高（「只提醒」小标以前撞上 .note 的外边距，那两行高出一截）
    const heights = await dlg.locator('[data-step="week"], [data-step="attach"], [data-step="video"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    expect(new Set(heights).size).toBe(1)

    // 关掉补双链、做可视化
    await sw(page, '补双链').click()
    await sw(page, '做HTML可视化').click()
    await expect(sw(page, '补双链')).toHaveAttribute('aria-checked', 'false')
    await expect(sw(page, '做HTML可视化')).toHaveAttribute('aria-checked', 'false')
    await expect(dlg.getByLabel('一晚最多补几处双链')).toBeDisabled()
    await page.screenshot({ path: test.info().outputPath('dream-settings.png') })

    // 现在梦游（这一页上的按钮）
    await dlg.getByTestId('dream-set-now').getByRole('button', { name: '现在梦游' }).click()
    await expect(dlg.getByTestId('dream-set-now')).toContainText('上次梦游', { timeout: 30_000 })
    await expect(dlg.getByTestId('dream-set-now')).toContainText('整理了5处')
    await dlg.getByTestId('dream-set-now').getByRole('button', { name: '看报告' }).click()
    await expect(dialog(page)).toHaveCount(0)
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.locator('.dg')).toHaveText(['归类和改名3条预览', '可能重复1条', '本周小结1条'])
    await page.screenshot({ path: test.info().outputPath('dream-report.png') })
    // 分支上也没有：没有一处「相关：」，没有新的 HTML
    const branch = git(vault, 'branch', '--list', '--format=%(refname:short)', 'dream/*').trim()
    const diff = git(vault, 'diff', `main..${branch}`)
    expect(diff).not.toContain('相关：[[')
    expect(git(vault, 'diff', '--name-only', `main..${branch}`)).not.toMatch(/\.html$/m)
    expect(gitStatus(vault)).toBe('')

    // 重开软件（同一个设置目录）：还是关着
    await run.close({ keep: true })
    again = await launch({ '随手记.md': '# 随手记\n' }, { CN_USER_DATA: userData })
    await openDreamSettings(again.page)
    await expect(sw(again.page, '补双链')).toHaveAttribute('aria-checked', 'false')
    await expect(sw(again.page, '做HTML可视化')).toHaveAttribute('aria-checked', 'false')
    await expect(sw(again.page, '写本周小结')).toHaveAttribute('aria-checked', 'true')
  } finally {
    if (again) await again.close()
    else await run.close({ keep: true })
    rmSync(dirname(vault), { recursive: true, force: true })
  }
})

test('自己梦游关了到点也不梦游；打开后到点就梦游', async () => {
  // 设置文件里本来就关着（老用户关过的样子）；到点的条件都缩成 0
  const ud = mkdtempSync(join(tmpdir(), 'cn-e2e-ud-'))
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ dream: { auto: false } }))
  const run = await launch(DREAM_VAULT, { CN_AI_FAKE: '1', CN_DREAM_IDLE_SEC: '0', CN_DREAM_GAP_MS: '0', CN_DREAM_CHECK_MS: '300', CN_USER_DATA: ud })
  const { page } = run
  try {
    await openDreamSettings(page)
    await expect(sw(page, '自己梦游')).toHaveAttribute('aria-checked', 'false')
    await expect(dialog(page).getByLabel('没人动多久算闲')).toBeDisabled()
    await expect(dialog(page).getByTestId('dream-set-now')).toContainText('自己梦游关着，点「现在梦游」才梦游')
    // 十几轮检查过去了，一次都没梦游
    await page.waitForTimeout(4000)
    expect(await page.evaluate(() => window.cn.dreamReport())).toBeNull()
    await sw(page, '自己梦游').click()
    await expect(dialog(page).getByTestId('dream-set-now')).toContainText('上次梦游', { timeout: 30_000 })
    expect((await page.evaluate(() => window.cn.dreamReport()))?.trigger).toBe('idle')
  } finally {
    await run.close()
    rmSync(ud, { recursive: true, force: true })
  }
})

test('改完直接收下：梦游完一次提交进 main，报告顶上写着、能一键撤回；「用哪家 AI」那一行跳到 AI 页的「梦游」那一行', async () => {
  const run = await launch(DREAM_VAULT, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openDreamSettings(page)
    const dlg = dialog(page)
    await dlg.getByRole('radio', { name: /改完直接收下/ }).click()
    await expect(dlg.getByRole('radio', { name: /改完直接收下/ })).toHaveAttribute('aria-checked', 'true')
    const head = git(vault, 'rev-parse', 'HEAD').trim()
    await dlg.getByTestId('dream-set-now').getByRole('button', { name: '现在梦游' }).click()
    await expect(dlg.getByTestId('dream-set-now')).toContainText('已直接收下', { timeout: 30_000 })
    // main 上多一次提交：归类、双链、小结都进来了；可能重复只是提醒
    expect(git(vault, 'rev-list', '--count', `${head}..HEAD`).trim()).toBe('1')
    expect(git(vault, 'log', '-1', '--format=%s').trim()).toBe('收下梦游的整理：5 处')
    expect(gitStatus(vault)).toBe('')

    // 用哪家 AI：点了到 AI 页，「梦游」那一行闪一下
    await dlg.getByTestId('dream-set-ai').click()
    await expect(dlg.locator('.aip-row[data-feature="dream"]')).toHaveClass(/flash/)

    await page.keyboard.press('Escape')
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '梦游报告', exact: true }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await expect(panel.getByTestId('dream-auto')).toContainText('设置里选了改完直接收下：5处已合进main')
    await page.screenshot({ path: test.info().outputPath('dream-auto.png') })
    await panel.getByTestId('dream-auto').getByRole('button', { name: '撤回这次收下' }).click()
    await expect(panel.getByTestId('dream-auto')).toHaveCount(0)
    await expect.poll(() => git(vault, 'diff', '--name-only', head, 'HEAD').trim()).toBe('')
  } finally {
    await run.close()
  }
})
