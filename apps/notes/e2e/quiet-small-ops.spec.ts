/**
 * 小操作不弹成功提示（2026-11-25 偏好「小操作不弹成功提示」，用户：「我每挪动一下，它下面都会提示『挪好了』，我觉得不用提示了」）：
 * 白板上拖着挪一张卡、挪贴纸、改贴纸大小，底部不出提示条，⌘Z 照样撤回；删一张卡照旧出「删了…」带「撤回」，点了回来。
 * 都是真鼠标拖、真按键。
 */
import { expect, test } from '@playwright/test'
import { center, drag, files, openDecorBoard, shot, toScreen } from './decor-helpers'
import { BOARD } from './decor-samples'

const decorLines = (ink: string) => ink.split('\n').filter((l) => l.startsWith('{"sticker"'))
const parse = (l: string) => JSON.parse(l) as Record<string, unknown>

test('拖着挪卡、挪贴纸、改贴纸大小都不出提示条，⌘Z 照样撤回；删卡照旧出提示带「撤回」', async () => {
  test.setTimeout(240_000)
  const { run, page, board } = await openDecorBoard()
  const f = files(run)
  const toast = board.locator('.db-toast')
  try {
    // ---- 挪一张卡：从「这周学到的」那一列拖到空白处 ----
    const card = board.locator('.db-card', { hasText: '第一步，一句话说清 C72' }).first()
    const cb = (await card.boundingBox())!
    const to = await toScreen(page, 1500, 760)
    await drag(page, { x: cb.x + 40, y: cb.y + 14 }, to)
    await expect.poll(f.md).not.toBe(BOARD)
    expect(f.md()).toMatch(/<!-- card id=\w+ x=\d+ y=\d+ -->\n第一步，一句话说清 C72/)
    await page.waitForTimeout(800)
    await expect(toast).toHaveCount(0)
    await shot(run, '挪卡没有提示条')
    // ⌘Z：卡回到列里，文件回原样
    await page.keyboard.press('Meta+z')
    await expect.poll(f.md).toBe(BOARD)

    // ---- 放一张贴纸（新放的照旧说一句），等那句收起 ----
    await board.getByTestId('pal-decor').click()
    const drawer = page.getByTestId('decor-drawer')
    await drawer.getByRole('tab', { name: '贴纸' }).click()
    const star = await center(page, '[data-testid="decor-drawer"] .dw-item[data-v="star"]')
    const spot = await toScreen(page, 760, 520)
    await drag(page, star, spot)
    await expect.poll(() => decorLines(f.ink()).length).toBe(1)
    await drawer.getByRole('button', { name: '收起' }).click()
    await expect(toast).toHaveCount(0, { timeout: 15_000 })
    const s1 = parse(decorLines(f.ink())[0]!)

    // ---- 挪贴纸：笔迹文件里那一行变了，没有提示条 ----
    const z = spot.z
    const before = f.ink()
    await drag(page, spot, { x: spot.x + 80 * z, y: spot.y + 40 * z })
    await expect.poll(f.ink).not.toBe(before)
    await page.waitForTimeout(800)
    await expect(toast).toHaveCount(0)

    // ---- 改大小：右下角往外拖，宽变大，没有提示条；⌘Z 回到原来的宽 ----
    await board.locator(`[data-decor="sticker:${s1.sticker}"]`).click()
    const sc = await center(page, `[data-decor="sticker:${s1.sticker}"] [data-handle="scale"]`)
    await drag(page, sc, { x: sc.x + 40 * z, y: sc.y + 40 * z })
    const w = () => Number(parse(decorLines(f.ink()).find((l) => l.includes(String(s1.sticker)))!).w)
    await expect.poll(w).toBeGreaterThan(85)
    await page.waitForTimeout(800)
    await expect(toast).toHaveCount(0)
    await shot(run, '改大小没有提示条')
    await page.keyboard.press('Meta+z')
    await expect.poll(w).toBe(76)
    await page.keyboard.press('Escape')

    // ---- 删一张卡：照旧出「删了1张卡」带「撤回」，点了回来 ----
    const del = board.locator('.db-card', { hasText: '如实说进度' }).first()
    await del.click()
    await page.keyboard.press('Backspace')
    await expect(toast).toContainText('删了1张卡')
    await expect(toast.getByRole('button', { name: '撤回' })).toBeVisible()
    await shot(run, '删卡照旧有撤回')
    await expect.poll(f.md).not.toContain('如实说进度')
    await toast.getByRole('button', { name: '撤回' }).click()
    await expect.poll(f.md).toContain('如实说进度')
  } finally {
    await run.close()
  }
})
