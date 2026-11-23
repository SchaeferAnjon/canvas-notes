/**
 * 白板框选、文档选多块的对照图（task-5ryf9）：和设计稿 17-白板框选 原型 A 同一个状态，天青（浅）、深湖（深）各一组。
 * 只在给了 CN_SHOTS_DIR 时跑：CN_SHOTS_DIR=<目录> npx playwright test e2e/5ryf9-shots.spec.ts
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane } from './app'
import { board, openBoard } from './fixtures/board-doc'
import { FILES } from './fixtures/board-select'

const DIR = process.env.CN_SHOTS_DIR
test.skip(!DIR, '要对照图时给 CN_SHOTS_DIR')

const card = (page: Page, id: string) => board(page).locator(`.db-card[data-id="${id}"]`)

for (const [tone, skin] of [
  ['light', 'sky'],
  ['dark', 'petrol'],
] as const) {
  test(`对照截图（${tone}）`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const run = await launch(FILES)
    const { page, app } = run
    const shoot = (name: string) => page.screenshot({ path: join(DIR!, `app-${tone}-${name}.png`) })
    try {
      await page.evaluate((s) => window.cn.setSettings({ appearance: { followSystem: false, skin: s, frame: 'b' } }), skin)
      await page.reload()
      await page.locator('.vault b').waitFor()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await page.keyboard.press('Meta+Backslash')
      await openBoard(page, '学习笔记：动手学深度学习')
      await expect(card(page, 'f5')).toBeVisible()
      // 说明那句先收起（截的是选中以后的样子）
      await page.waitForTimeout(400)
      const hx = board(page).locator('.db-hint-x')
      if (await hx.count()) await hx.click()
      const a = (await card(page, 'f1').boundingBox())!
      const c = (await card(page, 'f3').boundingBox())!
      await page.mouse.move(a.x - 20, a.y - 20)
      await page.mouse.down()
      await page.mouse.move(c.x + 30, c.y + 30, { steps: 10 })
      await shoot('board-marquee')
      await page.mouse.up()
      // 鼠标停在右下空白处（左边图标栏有图标，停在那里会冒出提示）
      await page.mouse.move(1250, 800)
      await page.waitForTimeout(300)
      await shoot('board-sel3')
      // 「在哪」标注图：①空白处拖框选上的几张 ②浮在上方的操作条 ③新加的「AI整理」
      if (tone === 'light') {
        await page.evaluate(() => {
          const mark = (r: DOMRect, n: string, pad = 6) => {
            const d = document.createElement('div')
            d.className = 'cn-where'
            Object.assign(d.style, { position: 'fixed', zIndex: '99999', left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px', border: '3px solid #e5484d', borderRadius: '10px', pointerEvents: 'none' })
            const b = document.createElement('div')
            Object.assign(b.style, { position: 'absolute', left: '-14px', top: '-14px', width: '26px', height: '26px', borderRadius: '13px', background: '#e5484d', color: '#fff', font: '600 15px/26px -apple-system', textAlign: 'center' })
            b.textContent = n
            d.appendChild(b)
            document.body.appendChild(d)
          }
          const sel = [...document.querySelectorAll('.pane:not([hidden]) .db-card.sel')].map((e) => e.getBoundingClientRect())
          const u = new DOMRect(Math.min(...sel.map((r) => r.left)), Math.min(...sel.map((r) => r.top)), Math.max(...sel.map((r) => r.right)) - Math.min(...sel.map((r) => r.left)), Math.max(...sel.map((r) => r.bottom)) - Math.min(...sel.map((r) => r.top)))
          mark(u, '1', 10)
          mark(document.querySelector('[data-testid="db-selbar"]')!.getBoundingClientRect(), '2')
          mark(document.querySelector('[data-testid="db-selbar"] [data-k="tidy"]')!.getBoundingClientRect(), '3', 3)
        })
        await page.screenshot({ path: join(DIR!, 'where-board.png') })
        await page.evaluate(() => document.querySelectorAll('.cn-where').forEach((e) => e.remove()))
      }
      await page.getByTestId('db-selbar').getByRole('button', { name: '对齐' }).click()
      await page.waitForTimeout(200)
      await shoot('board-align')
      await page.keyboard.press('Escape')
      await page.getByTestId('db-selbar').getByRole('button', { name: '更多' }).click()
      await page.waitForTimeout(200)
      await shoot('board-more')
      await page.keyboard.press('Escape')
      await page.getByTestId('db-selbar').getByRole('button', { name: '放进列' }).click()
      await page.waitForTimeout(200)
      await shoot('board-col')
      await page.keyboard.press('Escape')
      // 左栏收着时按名字点不到：先展开，开好再收起
      await page.keyboard.press('Meta+Backslash')
      await openNote(page, '2.3 线性代数')
      await page.keyboard.press('Meta+Backslash')
      await page.waitForTimeout(400)
      const line = (s: string) => pane(page).locator('.cm-line', { hasText: s }).first()
      const l1 = (await line('矩阵-矩阵乘法 AB').boundingBox())!
      const l2 = (await line('按常数缩放').boundingBox())!
      await page.mouse.move(l1.x - 30, l1.y + 6)
      await page.mouse.down()
      await page.mouse.move(l1.x - 26, l2.y + 10, { steps: 10 })
      await shoot('doc-marquee')
      await page.mouse.up()
      // 鼠标停在右下空白处（左边图标栏有图标，停在那里会冒出提示）
      await page.mouse.move(1250, 800)
      await page.waitForTimeout(300)
      await shoot('doc-sel6')
      await page.getByTestId('doc-selbar').getByRole('button', { name: '转成' }).click()
      await page.waitForTimeout(200)
      await shoot('doc-turn')
      await page.keyboard.press('Escape')
    } finally {
      await run.close()
    }
  })
}
