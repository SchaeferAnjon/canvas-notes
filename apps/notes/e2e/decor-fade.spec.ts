/**
 * 白板装饰 · 会消失的笔（设计页 145 第 3、4 条）：真点。
 * 右上角缩放旁那颗按下，用鼠标画两笔：2 秒还在、3.8 秒没了（量光迹那块 canvas 的 data-live）；md、笔迹文件一个字节不变、不提交；
 * 按住 L 不按按钮也能画；再点一下按钮出浮层，选 6 秒：3.5 秒还在、7 秒没了，选的记进设置；设置 › 文档和白板「消失笔停多久」是同一个。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { files, openDecorBoard, toScreen } from './decor-helpers'
import { BOARD } from './decor-samples'

const live = (page: Page) => page.getByTestId('fade-canvas').evaluate((el) => Number((el as HTMLElement).dataset.live))

/** 在白板坐标 (x, y) 起画一道波浪线 */
async function scribble(page: Page, x: number, y: number) {
  const p = await toScreen(page, x, y)
  await page.mouse.move(p.x, p.y)
  await page.mouse.down()
  for (let i = 1; i <= 16; i++) await page.mouse.move(p.x + i * 12, p.y + Math.sin(i / 2) * 14)
  await page.mouse.up()
}

test('消失笔：画两笔 2 秒还在、3.8 秒没了，文件不变；按住 L 也能画；浮层选 6 秒 3.5 秒还在，设置里同一个', async () => {
  test.setTimeout(240_000)
  const { run, page, board } = await openDecorBoard()
  const f = files(run)
  const settings = () => JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8'))
  try {
    const btn = page.getByTestId('fade-pen')
    await expect(btn).toBeVisible()
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await btn.click()
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await expect(board.locator('.board-wrap')).toHaveClass(/dc-fading/)

    // ---- 画两笔（一笔在空白处，一笔划过卡）：写完一起消失 ----
    await scribble(page, 700, 470)
    await scribble(page, 160, 130)
    const end = Date.now()
    expect(await live(page)).toBe(2)
    // 画在卡上不会选中卡、不会出框选
    await expect(page.getByTestId('decor-cardbar')).toHaveCount(0)
    await page.waitForTimeout(Math.max(0, end + 2000 - Date.now()))
    expect(await live(page)).toBe(2)
    await page.waitForTimeout(Math.max(0, end + 3800 - Date.now()))
    await expect.poll(() => live(page), { timeout: 400 }).toBe(0)
    expect(f.md()).toBe(BOARD)
    expect(f.ink()).toBe('')
    expect(f.commits()).toBe(1)

    // ---- 关掉按钮，按住 L 画一笔 ----
    await btn.click() // 开着 → 出浮层
    await expect(page.getByTestId('fade-pop')).toBeVisible()
    await btn.click() // 浮层开着再点 → 收起、关掉
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByTestId('fade-pop')).toHaveCount(0)
    await board.locator('.board-wrap').click({ position: { x: 700, y: 520 } })
    await page.keyboard.down('l')
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await scribble(page, 700, 470)
    await page.keyboard.up('l')
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    expect(await live(page)).toBe(1)
    await expect.poll(() => live(page), { timeout: 5000 }).toBe(0)

    // ---- 浮层选 6 秒：3.5 秒还在，记进设置 ----
    await btn.click()
    await btn.click()
    const pop = page.getByTestId('fade-pop')
    await expect(pop).toBeVisible()
    await expect(pop.getByRole('radio', { name: '3 秒' })).toHaveAttribute('aria-checked', 'true')
    await expect(pop.getByRole('radio', { name: '红' })).toHaveAttribute('aria-checked', 'true')
    await expect(pop.getByRole('radio', { name: '写完一起' })).toHaveAttribute('aria-checked', 'true')
    await pop.getByRole('radio', { name: '6 秒' }).click()
    await expect.poll(() => settings().editor?.fadeSecs).toBe(6)
    await expect(pop).toContainText('停笔 6 秒内接着写')
    await page.keyboard.press('Escape')
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await btn.click()
    await scribble(page, 700, 470)
    const end6 = Date.now()
    await page.waitForTimeout(Math.max(0, end6 + 3500 - Date.now()))
    expect(await live(page)).toBe(1)
    await expect.poll(() => live(page), { timeout: 6000 }).toBe(0)
    expect(Date.now() - end6).toBeGreaterThan(6000)
    expect(f.md()).toBe(BOARD)
    expect(f.ink()).toBe('')
    expect(f.commits()).toBe(1)
    await page.keyboard.press('Escape')

    // ---- 设置 › 文档和白板「消失笔停多久」：同一个设置 ----
    await page.keyboard.press('Meta+,')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '文档和白板', exact: true }).click()
    const row = dlg.locator('[data-row="fadeSecs"]')
    await expect(row).toBeVisible()
    await expect(row.getByRole('radio', { name: '6 秒' })).toHaveAttribute('aria-checked', 'true')
    await row.getByRole('radio', { name: '1.5 秒' }).click()
    await expect.poll(() => settings().editor?.fadeSecs).toBe(1.5)
    await page.keyboard.press('Escape')
    await btn.click()
    await btn.click()
    await expect(page.getByTestId('fade-pop').getByRole('radio', { name: '1.5 秒' })).toHaveAttribute('aria-checked', 'true')
  } finally {
    await run.close()
  }
})
