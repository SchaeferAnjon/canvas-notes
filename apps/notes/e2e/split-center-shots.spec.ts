// 中间栏分屏的交付截图（薄荷、深湖，浮岛书桌，1440×887）：用户圈的那个场景，左边配对笔记的白板、右边那篇 PDF。
// 拖 PDF 标签到右边缘时的落点、松手后的两格、上下两格、拖到另一格时的「放进这一格」。
// 平时跳过：CN_SHOTS=<目录> npx playwright test e2e/split-center-shots.spec.ts
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, tabOn, type Running } from './app'
import { LECTURE } from './fixtures/pdf'

const SHOTS = process.env.CN_SHOTS
test.skip(!SHOTS, '截图才跑：CN_SHOTS=<目录>')
test.setTimeout(5 * 60_000)

const PDF = '课程/线代/第3讲 线性映射.pdf'
const NOTE = '课程/线代/第3讲 线性映射 笔记.md'
const BOARD = '课程/线代/线性映射 白板.md'
const BOARD_TEXT = `---
type: board
---
# 线性映射 白板

## 定义

保持加法和数乘的映射。

## 矩阵表示

选好基以后，一个线性映射就是一个矩阵。

## 核与像

核是映到 0 的那些向量，像是映出来的全部。
`
type Box = { x: number; y: number; width: number; height: number }
const box = async (l: Locator): Promise<Box> => (await l.boundingBox())!
const mid = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const tabIn = (page: Page, list: string, name: string) => page.getByTestId(list).locator(':scope > .tab').filter({ hasText: name })

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(350)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS!, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function open(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
}

for (const [skin, tone] of [
  ['mint', '薄荷'],
  ['petrol', '深湖'],
] as const) {
  test(`分屏截图：${tone}`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const run = await launch({ [PDF]: LECTURE, [NOTE]: '# 第3讲 线性映射 笔记\n', [BOARD]: BOARD_TEXT }, {}, (v) => {
      const ud = join(v, '..', 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b' } }))
    })
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await page.waitForTimeout(300)
      await open(page, '线性映射 白板')
      await expect(page.locator('[data-testid="doc-board"], [data-testid="board"]').first()).toBeVisible()
      await open(page, '第3讲 线性映射.pdf')
      await expect(page.locator('.pdfpage[data-page="1"] canvas[data-ready="1"]').first()).toBeAttached({ timeout: 15_000 })

      // 1. 拖 PDF 标签到中间内容的右边缘：右半块亮「分到右边」
      const c = await box(page.locator('main.center'))
      const from = mid(await box(tabIn(page, 'tab-list', '第3讲 线性映射.pdf')))
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x + 10, from.y + 4, { steps: 3 })
      await page.mouse.move(c.x + c.width - 60, c.y + c.height / 2, { steps: 14 })
      await expect(page.getByTestId('split-mark')).toBeVisible()
      await shot(run, `1-拖到右边缘-${tone}`)
      await page.mouse.up()

      // 2. 松手：左边白板、右边 PDF，各有标签条，当前格是右边
      await expect(page.locator('main.center')).toHaveClass(/\bsplit row\b/)
      await page.waitForTimeout(600)
      await shot(run, `2-左白板右PDF-${tone}`)

      // 3. 指着分隔条（中间一条 --line2），往左拖一点
      const s = mid(await box(page.getByTestId('split-sash')))
      await page.mouse.move(s.x, s.y)
      await page.mouse.down()
      await page.mouse.move(s.x - 80, s.y, { steps: 6 })
      await shot(run, `3-拖分隔条-${tone}`)
      await page.mouse.up()

      // 4. 把白板拖到右边那格的内容上：「放进这一格」
      const r = await box(page.locator('main.center > .cslot[data-pane="1"]:not([hidden])'))
      const b = mid(await box(tabIn(page, 'tab-list', '线性映射 白板')))
      await page.mouse.move(b.x, b.y)
      await page.mouse.down()
      await page.mouse.move(b.x + 10, b.y + 4, { steps: 3 })
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2, { steps: 14 })
      await expect(page.getByTestId('split-mark')).toHaveText('放进这一格')
      await shot(run, `4-放进另一格-${tone}`)
      // 松手前按住拖回原处，不放进去
      await page.mouse.move(b.x, b.y, { steps: 8 })
      await page.mouse.up()

      // 5. 上下两格：合回去，再把 PDF 拖到下边缘
      await page.keyboard.press('Control+Backslash')
      await expect(page.locator('main.center')).not.toHaveClass(/\bsplit\b/)
      const c2 = await box(page.locator('main.center'))
      const p2 = mid(await box(tabIn(page, 'tab-list', '第3讲 线性映射.pdf')))
      await page.mouse.move(p2.x, p2.y)
      await page.mouse.down()
      await page.mouse.move(p2.x + 10, p2.y + 4, { steps: 3 })
      await page.mouse.move(c2.x + c2.width / 2, c2.y + c2.height - 60, { steps: 14 })
      await page.mouse.up()
      await expect(page.locator('main.center')).toHaveClass(/\bsplit col\b/)
      await page.waitForTimeout(600)
      await shot(run, `5-上下两格-${tone}`)

      // 6. 对照看：同一篇左边文档、右边白板
      await page.keyboard.press('Control+Backslash')
      await expect(page.locator('main.center')).not.toHaveClass(/\bsplit\b/)
      await open(page, '线性映射 白板')
      await page.getByTestId('tab-acts').getByRole('tab', { name: '文档' }).click()
      await page.getByTestId('tab-acts').getByRole('button', { name: '对照看：另一格用白板开这一篇' }).click()
      await expect(page.locator('main.center > .cslot[data-pane="1"]:not([hidden])').getByTestId('doc-board')).toBeVisible()
      await page.locator('main.center > .cslot[data-pane="0"]:not([hidden]) .cm-line', { hasText: '保持加法和数乘的映射。' }).click()
      await page.keyboard.press('End')
      await page.keyboard.type('线性映射把 0 映到 0。')
      await page.waitForTimeout(500)
      await shot(run, `6-对照看-${tone}`)
    } finally {
      await run.close()
    }
  })
}
