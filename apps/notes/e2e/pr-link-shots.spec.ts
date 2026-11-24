/**
 * ParaRead 联动（画布笔记这一侧）的交付截图：只在给了 CN_SHOTS 时截（目录）。薄荷（浅）、深湖（深）各一组：
 * 读 PDF 选中一句时小条上带名字的四颗、纸面上划的四种线和右栏「划的线」；右栏按含义筛「看不懂」；配对笔记文档看法里的荧光笔；
 * 课程首页 ParaRead 组件（装了、没装）；设置 › 读PDF › 划线颜色。
 */
import { type Page, test } from '@playwright/test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch } from './app'
import { LECTURE, ROTATION } from './fixtures/pdf'

const dir = process.env.CN_SHOTS
const A = '课程/线代/第3讲 线性映射.pdf'
const B = '课程/线代/第4讲 旋转.pdf'
const NOTE = `---
类型: 笔记
课程: 线代
来源: "[[第3讲 线性映射.pdf]]"
进度: 4/5
读到: 40% · 3.2 Definition
读了: 39 分钟
---
# 第3讲 线性映射 笔记

## 第 1 页 · 划的线
- ==A linear map sends sums to sums and scalings to scalings.== · 重点 · [第 1 页](第3讲%20线性映射.pdf#page=1&rect=0.118,0.173,0.494,0.023) <!-- cn:hl=p1-h1 k=key -->
- ==We write T: V -> W for a map between vector spaces.== · 想引用 · [第 1 页](第3讲%20线性映射.pdf#page=1&rect=0.118,0.198,0.44,0.023) <!-- cn:hl=p1-h2 k=cite -->

## 第 2 页 · 划的线
- ==Both rules together keep linear combinations.== · 定义 · [第 2 页](第3讲%20线性映射.pdf#page=2&rect=0.118,0.224,0.387,0.023) <!-- cn:hl=p2-h1 k=def -->

## 第 2 页 · 看不懂：T(c u) = c T(u) for every s…
[第 2 页](第3讲%20线性映射.pdf#page=2&rect=0.118,0.199,0.285,0.023) · 16:44 <!-- cn:thread=第3讲 线性映射-p2-1 -->

> [!question] 看不懂
> ==T(c u) = c T(u) for every scalar c.== <!-- cn:hl=p2-h2 k=confused -->

## 第 4 页 · 看不懂：The kernel is the set of vec…
[第 4 页](第3讲%20线性映射.pdf#page=4&rect=0.118,0.173,0.369,0.023) · 16:50 <!-- cn:thread=第3讲 线性映射-p4-1 -->

> [!question] 看不懂
> ==The kernel is the set of vectors sent to zero.== <!-- cn:hl=p4-h1 k=confused -->

分两步看：先找哪些向量被送到零，再看它们组成什么。
`
const READ_AT = JSON.stringify({ files: { [A]: { page: 3, pages: 5, pct: 40, section: '3.2 Definition', at: Date.now() - 60_000, by: 'pararead', ms: { pararead: 39 * 60_000 } } } }, null, 2) + '\n'
const files = { [A]: LECTURE, [B]: ROTATION, ['课程/线代/第3讲 线性映射 笔记.md']: NOTE, '.canvas-notes/读到哪.json': READ_AT }

const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const home = (page: Page) => page.getByTestId('folder-home')

for (const [skin, tone] of [
  ['mint', '薄荷'],
  ['petrol', '深湖'],
] as const) {
  test(`ParaRead 联动截图 · ${tone}`, async () => {
    test.skip(!dir, '只在给了 CN_SHOTS 时截')
    test.setTimeout(180_000)
    const installed = join(mkdtempSync(join(tmpdir(), 'cn-pr-shot-')), 'installed.json')
    writeFileSync(installed, '{}')
    const run = await launch(files, { CN_FAMILY_INSTALLED_FILE: installed, CN_AI_FAKE: '1' })
    const { page } = run
    const shot = (name: string) => page.screenshot({ path: join(dir!, `${name}-${tone}.png`) })
    try {
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.evaluate((skin) => window.cn.setSettings({ appearance: { followSystem: false, skin } }), skin)
      await page.reload()
      await page.locator('.vault b').waitFor()

      // 课程首页 ParaRead 组件：没装
      await run.app.evaluate(({ app }, u) => app.emit('open-url', { preventDefault: () => undefined }, u), 'canvas-notes://open?file=' + encodeURIComponent('课程/线代'))
      await home(page).waitFor()
      await page.getByTestId('tab-acts').getByRole('button', { name: '编辑首页' }).click()
      await home(page).getByRole('button', { name: '加组件' }).click()
      const lib = page.getByRole('dialog', { name: '加组件' })
      await lib.getByRole('button', { name: '加上 ParaRead' }).click()
      await lib.getByRole('button', { name: '完成' }).click()
      await page.getByTestId('tab-acts').getByRole('button', { name: '完成' }).click()
      const w = home(page).getByTestId('pararead-widget')
      await w.waitFor()
      await w.scrollIntoViewIfNeeded()
      // 刚加上的组件外圈闪 2 秒，等它过去；鼠标挪开（不截悬停提示）
      await page.mouse.move(700, 880)
      await page.waitForTimeout(2600)
      await shot('05-组件没装')
      // 装了
      writeFileSync(installed, JSON.stringify({ pararead: '0.2.0' }))
      await w.getByTestId('pararead-download').click()
      await w.getByRole('button', { name: '装好了，再看一下' }).click()
      await w.getByTestId('pararead-continue').waitFor()
      await page.mouse.move(0, 0)
      await page.waitForTimeout(400)
      await shot('04-组件装了')

      await page.getByTestId('tab-on').locator('.x').click().catch(() => undefined)

      // 读 PDF：纸面上的线、右栏划的线，选中一句时的小条
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲 线性映射')
      await page.locator('.pal-row', { hasText: '第3讲 线性映射.pdf' }).first().click()
      // 读到哪记着第 3 页（ParaRead 记的），打开就翻到那里：先回到第 1 页
      await pdfPane(page).locator('canvas[data-ready="1"]').first().waitFor({ timeout: 15_000 })
      await pdfPane(page).getByTestId('pdf-view').evaluate((el) => (el.scrollTop = 0))
      await pdfPane(page).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]').waitFor({ timeout: 15_000 })
      if (!(await notes(page).isVisible())) await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '笔记' }).first().click().catch(() => undefined)
      await pdfPane(page).locator('[data-testid="pdf-hl"]').first().waitFor({ timeout: 15_000 })
      const span = pdfPane(page).locator('.pdfpage[data-page="1"] .textLayer span', { hasText: 'Lecture 3 Linear Maps' }).first()
      const s = (await span.boundingBox())!
      await page.mouse.move(s.x + 1, s.y + s.height / 2)
      await page.mouse.down()
      await page.mouse.move(s.x + s.width - 1, s.y + s.height / 2, { steps: 6 })
      await page.mouse.up()
      await pdfPane(page).getByTestId('hl-pick').first().waitFor()
      await page.waitForTimeout(400)
      await shot('01-读PDF划线')
      await page.keyboard.press('Escape')

      // 右栏按含义筛：看不懂
      await notes(page).getByTestId('hl-filter').getByRole('tab', { name: /看不懂/ }).click()
      await page.waitForTimeout(300)
      await shot('02-按含义筛看不懂')
      await notes(page).getByTestId('hl-filter').getByRole('tab', { name: /看不懂/ }).click()

      // 配对笔记文档看法：荧光笔按含义换色，看不懂红色波浪线
      await page.locator('aside.side').getByText('第3讲 线性映射 笔记').first().click()
      const docTab = page.getByTestId('tab-acts').getByRole('tab', { name: '文档' })
      if (await docTab.isVisible()) await docTab.click()
      await page.locator('.cm-hl-k').first().waitFor()
      await page.waitForTimeout(400)
      await shot('03-配对笔记荧光笔')

      // 设置 › 读PDF › 划线颜色
      await page.keyboard.press('Meta+Comma')
      const set = page.getByRole('dialog', { name: '设置' })
      await set.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '读PDF', exact: true }).click()
      await set.getByTestId('hl-kinds').scrollIntoViewIfNeeded()
      await page.mouse.move(5, 5)
      await page.waitForTimeout(400)
      await set.screenshot({ path: join(dir!, `06-设置划线颜色-${tone}.png`) })
    } finally {
      await run.close()
    }
  })
}
