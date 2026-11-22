/**
 * 交付截图（task-busas）：文档里剪进来的一段后面按 Tab 写「我的评价」，和用户截图同一个样子（几段剪进来的引文、来源行，光标在最后空行）。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深湖（不给是天青）。平时跳过。交互的验收在 busas-tab.spec.ts、busas-copy-math.spec.ts。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane, type Running } from './app'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const tone = DARK ? 'dark' : 'light'
const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const SRC = '—— [2.3. 线性代数 — 动手学深度学习 2.0.0 documentation](https://zh.d2l.ai/chapter_preliminaries/linear-algebra.html)'
const DOC = `# 学习笔记：动手学深度学习

这就是向量的感觉，在数学中。

> 向量只是一个数字数组，就像每个数组都有一个长度一样
${SRC}

我的评价：数组。

> 请注意，维度（dimension）这个词在不同上下文时往往会有不同的含义，这经常会使人感到困惑。
${SRC}

我的评价：向量的维度 = 向量的长度 = 有几个元素。比如 x = tensor([0, 1, 2, 3]) 里有 4 个数，就说 $\\mathbf{x}$ 是 4 维向量，len(x) 和 x.shape 也都告诉你“4”。

> 2.3.3. 矩阵
${SRC}

`

async function shot(run: Running, name: string) {
  await run.page.mouse.move(289, 860)
  await run.page.waitForTimeout(600)
  const box = (await pane(run.page).locator('.cm-scroller').boundingBox())!
  const r = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(Math.min(box.width, 820)), height: Math.round(Math.min(box.height, 700)) }
  const b64 = await run.app.evaluate(async ({ BrowserWindow }, c) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(c)).toPNG().toString('base64'), r)
  writeFileSync(join(DIR!, `${name}-${tone}.png`), Buffer.from(b64, 'base64'))
}

test('Tab 写评价：剪进来以后、按 Tab、打完字、回车再 Tab', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ '学习笔记.md': DOC }, {}, look)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    await openNote(page, '学习笔记')
    await pane(page).locator('.cm-line', { hasText: '2.3.3. 矩阵' }).first().click()
    await page.keyboard.press('Meta+ArrowDown')
    await shot(run, '1-clipped')
    await page.keyboard.press('Tab')
    await expect(pane(page).locator('.cm-review-ph')).toBeVisible()
    await shot(run, '2-tab')
    await page.keyboard.type('矩阵把向量从一阶推广到二阶。')
    await shot(run, '3-typed')
    await page.keyboard.press('Enter')
    await page.keyboard.type('- 一阶：向量')
    await page.keyboard.press('Enter')
    await page.keyboard.type('二阶：矩阵')
    await page.keyboard.press('Tab')
    await shot(run, '4-list')
  } finally {
    await run.close()
  }
})
