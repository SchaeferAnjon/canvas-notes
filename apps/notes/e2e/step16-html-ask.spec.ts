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
    // 读 HTML 时右栏 AI 那一格是它的 AI（AI 只住右栏，第 2a 段）：打开不自己开，右下角的圆钮开它；竖条上只多「笔记」
    await expect.poll(() => railItems(page)).toEqual(['笔记', '大纲', '相关', '网页', '微信读书', '记录', '自动化', '历史'])
    await expect(ai(page)).toBeHidden()
    await rail(page).getByRole('button', { name: '打开 AI' }).click()
    await expect(ai(page)).toBeVisible()
    await expect(ai(page).getByTestId('reading-sees')).toContainText('旋转矩阵.html')
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeHidden()
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
    // 工具条同 PDF（task-6cxtc 复审）：讲解一下 ↵、引用 ⌘↵ 键帽；在框上方 6（上面有地方），整条在这一栏里、左右各留 8
    const tb = pane(page).getByRole('toolbar', { name: '框好的这块' })
    await expect(tb.locator('kbd')).toHaveText(['↵', '⌘↵'])
    await page.waitForTimeout(250)
    const [tr, fr, br] = [(await tb.boundingBox())!, (await pane(page).getByTestId('html-box').boundingBox())!, (await pane(page).locator('.htmlbody').boundingBox())!]
    expect(Math.abs(fr.y - (tr.y + tr.height) - 6)).toBeLessThanOrEqual(2)
    expect(tr.x).toBeGreaterThanOrEqual(br.x + 8 - 0.5)
    expect(tr.x + tr.width).toBeLessThanOrEqual(br.x + br.width - 8 + 0.5)
    await page.screenshot({ path: 'test-results/step16-html-cap.png' })
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await pane(page).getByRole('toolbar', { name: '框好的这块' }).getByRole('button', { name: /讲解一下/ }).click()
    await expect(pane(page).getByTestId('html-box')).toHaveCount(0)
    await expect(ai(page).locator('.um').last()).toHaveText('给我讲解一下')
    await expect(ai(page).getByText('看了框的这一块')).toBeVisible()
    await expect(ai(page).getByTestId('ai-noted').last()).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    const md = readFileSync(join(vault, '课程/线性代数/旋转矩阵 笔记.md'), 'utf8')
    expect(md).toContain('来源: "[[旋转矩阵.html]]"')
    // 2026-11-24 新写法：一节写 HTML 的名字，一问一个小标题，框的图、回到那份 HTML 的来源行，一块 AI 回答
    expect(md).toMatch(/\n## 旋转矩阵\n\n### 给我讲解一下\n\n!\[我框的(\|\d+)?\]\(\.\.\/\.\.\/附件\/旋转矩阵\/p1-1\.png\)\n\n—— \[旋转矩阵\.html\]\(旋转矩阵\.html\)\n\n> \[!ai\] AI 回答 · /)
    await expect.poll(() => gitOut(vault, 'log', '-1', '--format=%s')).toBe('笔记：旋转矩阵 笔记 · 给我讲解一下')
    expect(gitStatus(vault)).toBe('')
    // 笔记里这一轮的来源是文件名「旋转矩阵.html ›」，点了打开 HTML
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(page.getByRole('complementary', { name: '笔记', exact: true }).locator('.rnd .loc button').first()).toHaveText('旋转矩阵.html ›')

    // 问这一屏：整屏直接发
    await rail(page).getByRole('button', { name: '打开 AI' }).click()
    await acts(page).getByRole('button', { name: '问这一屏' }).click()
    await expect(ai(page).locator('.um').last()).toHaveText('给我讲解一下这一屏')
    await expect(ai(page).locator('.um-wrap .att img').last()).toBeVisible()
  } finally {
    await run.close()
  }
})
