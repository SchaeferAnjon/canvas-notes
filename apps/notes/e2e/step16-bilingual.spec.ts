import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, rail, tabOn } from './app'
import { ROTATION } from './fixtures/pdf'

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const BI = '课程/线性代数/第3讲 线性映射 双语.md'
const GLOSS = '# 术语表\n\n| 原文 | 译法 | 备注 |\n| --- | --- | --- |\n| linear map | 线性映射 |  |\n| kernel | 核 |  |\n'
const files = { [PDF]: ROTATION, '课程/线性代数/术语表.md': GLOSS }

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
/** 标签条右端的「对照读」：点一下按上次的方式开 / 关，小箭头里选 原文 / 对照 / 只看译文 */
const mode = (page: Page) => acts(page).getByTestId('bi-mode')
const MODE = { 原文: 'orig', 对照: 'bi', 只看译文: 'tr' } as const
async function pick(page: Page, name: keyof typeof MODE) {
  await mode(page).getByRole('button', { name: '原文 / 对照 / 只看译文' }).click()
  await acts(page).getByRole('radiogroup', { name: '原文 对照 只看译文' }).getByRole('radio', { name }).click()
  await expect(mode(page)).toHaveAttribute('data-mode', MODE[name])
}
const reflow = (page: Page) => pdfPane(page).getByTestId('reflow')
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPane(page).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文3页')
}

test('PDF 对照读：三种显示、⌥A、AI 开着默认重排、公式和图不翻、只看译文时看原文、问这段、重新翻译', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page } = run
  try {
    await openPdf(page)
    await expect(mode(page)).toHaveAttribute('data-mode', 'orig')
    // 右栏 AI 开着、中间栏 728 宽：对照默认是重排
    await pick(page, '对照')
    const bar = pdfPane(page).getByRole('toolbar', { name: '双语工具条' })
    await expect(bar).toContainText('英文 → 中文')
    await expect(bar.getByRole('radio', { name: '重排' })).toHaveAttribute('aria-checked', 'true')
    await expect(reflow(page)).toBeVisible()
    await expect(pdfPane(page).getByTestId('pdf-view')).toBeHidden()
    // 每段先原文、紧跟译文；公式和图是裁图，不翻译
    const para = reflow(page).locator('.fb', { hasText: 'Rotate the plane' })
    await expect(para.locator('.o')).toHaveText('Rotate the plane counter-clockwise by an angle t.')
    await expect(para.locator('.t')).toHaveText('译文：Rotate the plane counter-clockwise by an')
    const formula = reflow(page).locator('[data-group="p2"] .fc.formula')
    await expect(formula).toHaveCount(1)
    await expect(formula.locator('img')).toBeVisible()
    await expect(formula.locator('figcaption')).toHaveText('公式和图不翻译，照原页裁下来')
    await expect(reflow(page).locator('[data-group="p2"] .fc.figure img')).toBeVisible()
    await expect(reflow(page).locator('.fb', { hasText: "x' = x cos t" })).toHaveCount(0)
    await expect(bar.getByTestId('bi-status')).toContainText('译文3/3页')

    // ⌥A：只看译文（原文藏起来，悬停这段点「原文」临时露出来）
    await page.locator('body').click({ position: { x: 5, y: 300 } })
    await page.keyboard.press('Alt+a')
    await expect(mode(page)).toHaveAttribute('data-mode', 'tr')
    await expect(reflow(page)).toHaveClass(/tronly/)
    await expect(para.locator('.o')).toHaveCount(0)
    await para.hover()
    await para.getByRole('button', { name: '显示原文' }).click()
    await expect(para.locator('.o')).toBeVisible()
    // 重新翻译：这段重新要一次（不读缓存），译文照样回来
    await para.getByRole('button', { name: '重新翻译' }).click()
    await expect(para.locator('.t')).toHaveText('译文：Rotate the plane counter-clockwise by an')

    // 问这段：那段铺底色，AI 输入框里放好这段的截图，回车就发
    await para.getByRole('button', { name: '问这段' }).click()
    await expect(para).toHaveClass(/staged/)
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await ai(page).getByRole('textbox').press('Enter')
    await expect(para).not.toHaveClass(/staged/)
    await expect(ai(page).locator('.um').last()).toHaveText('给我讲解一下')
    await expect(reflow(page).locator('[data-group="p2"] .fh .mk')).toHaveCount(1, { timeout: 15_000 })

    // ⌥A 再按一次回到原文，翻到刚才那页
    await page.locator('body').click({ position: { x: 5, y: 300 } })
    await page.keyboard.press('Alt+a')
    await expect(mode(page)).toHaveAttribute('data-mode', 'orig')
    await expect(pdfPane(page).getByTestId('pdf-view')).toBeVisible()
    await expect(bar).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('PDF 对照读并排：AI 收起时默认并排，两边悬停互相点亮；术语表小卡；存成双语笔记一次提交', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '50' })
  const { page, vault } = run
  try {
    await openPdf(page)
    // 收起 AI，中间栏变宽：对照默认并排
    await ai(page).getByRole('button', { name: '收起 AI' }).click()
    await expect(ai(page)).toBeHidden()
    // 主按钮：点一下按上次的方式开（第一次是对照）
    await mode(page).getByRole('button', { name: '对照读' }).click()
    await expect(mode(page)).toHaveAttribute('data-mode', 'bi')
    const bar = pdfPane(page).getByRole('toolbar', { name: '双语工具条' })
    await expect(bar.getByRole('radio', { name: '并排' })).toHaveAttribute('aria-checked', 'true')
    const col = pdfPane(page).getByTestId('bi-side').nth(1)
    await expect(col.locator('.sb', { hasText: '译文：Rotate the plane' })).toBeVisible()
    await expect(col.locator('.skip').first()).toContainText('公式和图不翻译，看左边原页')
    // 原页和译文上沿对齐
    const pageBox = (await pdfPane(page).locator('.pdfpage[data-page="2"]').boundingBox())!
    const colBox = (await col.boundingBox())!
    expect(Math.abs(colBox.y - pageBox.y)).toBeLessThan(3)
    expect(colBox.x).toBeGreaterThan(pageBox.x + pageBox.width + 40)
    // 悬停右边一段：左边对应原文铺底色
    await col.locator('.sb', { hasText: '译文：Rotate the plane' }).hover()
    await expect(pdfPane(page).locator('.pdfpage[data-page="2"]').locator('xpath=..').locator('.fr.hl')).toHaveCount(1)
    // 悬停左边原文：右边那段亮
    const pb = (await pdfPane(page).locator('.pdfpage[data-page="2"]').boundingBox())!
    await page.mouse.move(pb.x + pb.width * 0.3, pb.y + 145 * (pb.height / 792), { steps: 3 })
    await expect(col.locator('.sb.on')).toHaveCount(1)

    // 术语表 · 2 条：小卡一行一条
    await bar.getByRole('button', { name: '术语表 · 2条' }).click()
    const pop = page.getByRole('dialog', { name: '术语表' })
    await expect(pop.locator('.gl-row')).toHaveCount(2)
    await expect(pop.locator('.gl-row').first()).toContainText('linear map线性映射')
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)

    // 存成双语笔记：每页一节，原文引用跟译文，公式和图是裁图；一次提交
    await bar.getByRole('button', { name: '存成双语笔记' }).click()
    await expect(page.getByText(`已存成${BI} · 每页带回到PDF的链接`)).toBeVisible({ timeout: 15_000 })
    await expect(bar.getByRole('button', { name: '已存成双语笔记' })).toBeVisible()
    const md = readFileSync(join(vault, BI), 'utf8')
    expect(md).toContain('类型: 双语')
    expect(md).toContain('## [第 2 页](第3讲%20线性映射.pdf#page=2)')
    expect(md).toContain('> Rotate the plane counter-clockwise by an angle t.\n\n译文：Rotate the plane counter-clockwise by an')
    expect(md).toMatch(/!\[公式\]\(\.\.\/\.\.\/附件\/第3讲%20线性映射\/双语\/p2-1\.png\)/)
    expect(md).toMatch(/!\[图\]\(\.\.\/\.\.\/附件\/第3讲%20线性映射\/双语\/p2-2\.png\)/)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('双语笔记：第3讲 线性映射 双语')
    expect(gitOut(vault, 'status', '--porcelain')).toBe('')
    // 点「已存成双语笔记」打开它
    await bar.getByRole('button', { name: '已存成双语笔记' }).click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射 双语')

    // 记住这份 PDF 的选择：回到 PDF 还是对照、并排
    await page.locator('.tab', { hasText: '第3讲 线性映射.pdf' }).click()
    await expect(mode(page)).toHaveAttribute('data-mode', 'bi')
  } finally {
    await run.close()
  }
})
