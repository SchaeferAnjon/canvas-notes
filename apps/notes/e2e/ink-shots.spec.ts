/**
 * 白板笔迹的截图（交付页 143、设计复审用）：薄荷、深湖各一套 —— 打开的样子、点一笔选中那一组（操作条）、改颜色的小浮层。
 * CN_SHOTS=目录 时才截；没给就只走一遍流程。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, type Running } from './app'
import { BOARD, BOARD_PATH, INK, INK_PATH } from './ink-samples'

const SHOTS = process.env.CN_SHOTS

async function shot(run: Running, name: string) {
  if (!SHOTS) return
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

for (const skin of ['mint', 'petrol', 'pine'] as const) {
  test(`白板笔迹截图：${skin}`, async () => {
    test.setTimeout(120_000)
    if (SHOTS) mkdirSync(SHOTS, { recursive: true })
    const run = await launch({ [BOARD_PATH]: BOARD, [INK_PATH]: INK }, {}, (vault) => {
      const ud = join(vault, '..', 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1512, 888))
      await openNote(page, '组会白板')
      await acts(page).getByRole('tab', { name: '白板' }).click()
      const board = pane(page).getByTestId('doc-board')
      await expect(board.getByTestId('db-ink')).toHaveAttribute('data-strokes', '4')
      // 顶上那条一次性的说明点掉（截图里不挡）
      const hint = board.locator('.db-hint-x').first()
      if (await hint.isVisible().catch(() => false)) await hint.click()
      await page.waitForTimeout(500)
      await shot(run, `${skin}-1-看`)
      // 点那行字：选中它那一组
      const p = await page.evaluate(() => {
        const plane = document.querySelector<HTMLElement>('.db-plane')!
        const r = plane.getBoundingClientRect()
        const z = Number(getComputedStyle(plane).zoom) || 1
        return { x: r.left + 860 * z, y: r.top + 300 * z, z }
      })
      // 在那行字附近找一个有墨的点
      const hit = await page.evaluate(([x, y]) => {
        const cv = document.querySelector<HTMLCanvasElement>('[data-testid="db-ink"]')!
        const r = cv.getBoundingClientRect()
        const k = cv.width / r.width
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data
        for (let dx = 0; dx < 150; dx++)
          for (let dy = -15; dy <= 15; dy++) {
            const px = Math.round((x + dx - r.left) * k)
            const py = Math.round((y + dy - r.top) * k)
            if (d[(py * cv.width + px) * 4 + 3]! > 200) return { x: x + dx, y: y + dy }
          }
        return null
      }, [p.x, p.y] as const)
      expect(hit).not.toBeNull()
      await page.mouse.click(hit!.x, hit!.y)
      await expect(page.getByTestId('ink-selbar')).toBeVisible()
      await shot(run, `${skin}-2-选中`)
      await page.getByTestId('ink-selbar').getByRole('button', { name: '颜色' }).click()
      await expect(page.getByTestId('ink-colors')).toBeVisible()
      await shot(run, `${skin}-3-改色`)
      // 框选同时碰到卡和笔：一条操作条「已选N笔 · M张卡」
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      const todo = (await board.locator('.db-card', { hasText: '跑通特征' }).boundingBox())!
      const s0 = { x: p.x + 175 * p.z, y: p.y + 70 * p.z }
      const s1 = { x: todo.x + todo.width - 20, y: todo.y + 10 }
      await page.mouse.move(s0.x, s0.y)
      await page.mouse.down()
      for (let i = 1; i <= 10; i++) await page.mouse.move(s0.x + ((s1.x - s0.x) * i) / 10, s0.y + ((s1.y - s0.y) * i) / 10)
      await page.mouse.up()
      await expect(page.getByTestId('ink-selbar').locator('.cnt')).toContainText('张卡')
      await shot(run, `${skin}-4-笔和卡一起选`)
    } finally {
      await run.close()
    }
  })
}
