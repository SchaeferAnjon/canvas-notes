import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, rail, acts, tabOn, railItems } from './app'

const HTML = '课程/线性代数/旋转矩阵.html'
const VIZ = `<!doctype html><html><head><meta charset="utf-8"><title>旋转矩阵</title><meta name="类型" content="可视化"><meta name="第几讲" content="3"></head>
<body style="margin:0;font:16px sans-serif;background:#fff"><h2 style="margin:24px">旋转矩阵 · 拖动角度看基向量</h2>
<div id="box" style="margin:24px;width:320px;height:200px;background:#e8eefc;border:1px solid #7a8bb5">R(θ) 的第一列是转完的 e₁</div>
<input type="range" aria-label="角度" min="0" max="180" value="30"></body></html>`

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pane = (page: Page) => page.locator('.htmlpane:not([hidden])')
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

async function openHtml(page: Page) {
  await page.keyboard.press('Meta+o')
  await page.getByRole('textbox', { name: '按名字跳到文件' }).fill('旋转矩阵')
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText('旋转矩阵')
  await expect(page.frameLocator('[data-testid="html-frame"]').locator('#box')).toBeVisible()
}

test('打开 HTML：沙箱里跑，右栏是它的 AI；「框一块」拖一个框问（截图进输入框），记进旁边的「旋转矩阵 笔记.md」；「问这一屏」直接发', async () => {
  const run = await launch({ [HTML]: VIZ }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
  try {
    await openHtml(page)
    await acts(page).getByRole('button', { name: '更多' }).click()
    await expect(acts(page).getByRole('menu', { name: '更多' })).toContainText('在隔离环境里运行 · 不联网')
    await acts(page).getByRole('button', { name: '更多' }).click()
    await expect(acts(page).getByTestId('page-note')).toHaveText('可视化 · 第3讲')
    // 读 HTML 时右栏是它的 AI，右下角不浮 AI
    // 读 PDF：竖条上只多「笔记」；AI 开着时右下角的圆钮藏起来，屏上只有一个 AI（CN-22）
    await expect.poll(() => railItems(page)).toEqual(['笔记', '大纲', '网页', '微信读书', '历史'])
    await expect(ai(page)).toBeVisible()
    await expect(ai(page).getByTestId('reading-sees')).toContainText('旋转矩阵.html')
    // 读 PDF / HTML 时右下角的 AI 入口开关的是右栏的 AI，不再浮在中间
    await expect(page.getByRole('navigation', { name: '右栏' }).locator('.ai-fab')).toHaveCount(0)
    await expect(page.locator('main.center').getByRole('complementary', { name: 'AI 对话' })).toBeHidden()
    // 没开框选层时 HTML 自己能拖
    await page.frameLocator('[data-testid="html-frame"]').getByRole('slider', { name: '角度' }).fill('90')

    // 点「框一块」，拖一个框：框下面黑色工具条，输入框里有截图
    await acts(page).getByRole('button', { name: '框一块问' }).click()
    await expect(pane(page).getByText('拖一个框问AI · esc 取消')).toBeVisible()
    const b = (await page.frameLocator('[data-testid="html-frame"]').locator('#box').boundingBox())!
    await page.mouse.move(b.x - 6, b.y - 6)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 })
    await page.mouse.move(b.x + b.width + 6, b.y + b.height + 6, { steps: 4 })
    await page.mouse.up()
    await expect(pane(page).getByTestId('html-box')).toBeVisible()
    await expect(pane(page).getByRole('toolbar', { name: '框好的这块' })).toBeVisible()
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await pane(page).getByRole('toolbar', { name: '框好的这块' }).getByRole('button', { name: /讲解一下/ }).click()
    await expect(pane(page).getByTestId('html-box')).toHaveCount(0)
    await expect(ai(page).locator('.um').last()).toHaveText('给我讲解一下')
    await expect(ai(page).getByText('看了框的这一块')).toBeVisible()
    await expect(ai(page).getByText(/已记进笔记/)).toBeVisible({ timeout: 15_000 })
    const md = readFileSync(join(vault, '课程/线性代数/旋转矩阵 笔记.md'), 'utf8')
    expect(md).toContain('来源: "[[旋转矩阵.html]]"')
    expect(md).toMatch(/## 测试小标题 p\d+\n\[旋转矩阵\.html\]\(旋转矩阵\.html\) · \d\d:\d\d/)
    expect(md).toContain('![我框的](../../附件/旋转矩阵/p1-1.png)')
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toMatch(/^笔记：旋转矩阵 · 测试小标题/)
    expect(gitStatus(vault)).toBe('')
    // 笔记里这段的来源是文件名，点了打开 HTML
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await expect(page.getByRole('complementary', { name: '笔记', exact: true }).locator('.pgc', { hasText: '旋转矩阵.html' }).first()).toBeVisible()

    // 问这一屏：整屏直接发
    await rail(page).getByRole('button', { name: '打开 AI' }).click()
    await acts(page).getByRole('button', { name: '问这一屏' }).click()
    await expect(ai(page).locator('.um').last()).toHaveText('给我讲解一下这一屏')
    await expect(ai(page).locator('.um-wrap .att img').last()).toBeVisible()
  } finally {
    await run.close()
  }
})
