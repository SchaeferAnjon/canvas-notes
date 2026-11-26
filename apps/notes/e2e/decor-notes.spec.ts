/**
 * 白板装饰 · 便签（设计页 145「便签」）：真点。
 * 工具板「装饰」→ 抽屉便签页按住一张拖到白板空白处 → 马上进打字；打了字点别处，md 末尾多一张摆在空白处的卡
 * （前面一行 `<!-- card id=… x=… y=… note=yellow rot=… -->`），笔迹文件不动；空着点别处什么都不写。
 * 选中便签：操作条「纸色 ▾」换纸色、「摆正」，每下只改那一行注释；删掉、⌘Z 撤回。
 */
import { expect, test } from '@playwright/test'
import { center, diff, drag, files, openDecorBoard, toScreen } from './decor-helpers'
import { BOARD } from './decor-samples'

const NOTE_LINE = /^<!-- card id=(d\d+) x=(\d+) y=(\d+) note=yellow rot=(-?[\d.]+) -->$/

test('便签：抽屉拖出来马上打字、空着不写；换纸色、摆正只改那一行；删、⌘Z', async () => {
  test.setTimeout(240_000)
  const { run, page, board } = await openDecorBoard()
  const f = files(run)
  try {
    await board.getByTestId('pal-decor').click()
    const drawer = page.getByTestId('decor-drawer')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('tab', { name: '便签' })).toHaveAttribute('aria-selected', 'true')
    await expect(drawer.locator('.dw-item')).toHaveCount(6)

    // ---- 拖一张出来，空着点别处：什么都不写 ----
    const yellow = await center(page, '[data-testid="decor-drawer"] .dw-item[data-v="yellow"]')
    const spot = await toScreen(page, 330, 470)
    await drag(page, yellow, spot)
    await expect(board.getByTestId('decor-note-draft')).toBeVisible()
    await page.mouse.click(spot.x + 560, spot.y - 80)
    await expect(board.getByTestId('decor-note-draft')).toHaveCount(0)
    await page.waitForTimeout(800)
    expect(f.md()).toBe(BOARD)
    expect(f.ink()).toBe('')

    // ---- 再拖一张，打字，点别处：md 末尾多这一张 ----
    await drag(page, yellow, spot)
    const draft = board.getByTestId('decor-note-draft')
    await expect(draft).toBeVisible()
    await expect(draft.locator('.cm-content')).toBeFocused()
    await page.keyboard.type('问 Nima：E4 数据 12 月能给吗？')
    await page.mouse.click(spot.x + 560, spot.y - 80)
    await expect.poll(f.md).toContain('问 Nima：E4 数据 12 月能给吗？')
    const md1 = f.md()
    const d = diff(BOARD, md1)
    expect(d.removed).toEqual([])
    expect(d.added.length).toBe(2)
    const m = NOTE_LINE.exec(d.added[0]!)
    expect(m, d.added[0]).not.toBeNull()
    expect(d.added[1]).toBe('问 Nima：E4 数据 12 月能给吗？')
    // 正文前面的部分一个字节不动，新卡加在文末
    expect(md1.startsWith(BOARD.trimEnd())).toBe(true)
    const rot = Number(m![4])
    expect(Math.abs(rot)).toBeLessThanOrEqual(3)
    expect(f.ink()).toBe('')
    // 画出来：便签纸、200 × 200、歪 rot 度、字 15px
    const note = board.locator('.db-card.placed.dc-note[data-note="yellow"]')
    await expect(note).toBeVisible()
    await page.waitForTimeout(2400) // 刚放上的那一下闪完
    const look = await note.evaluate((el) => {
      const s = getComputedStyle(el)
      const mt = new DOMMatrix(s.transform)
      return { w: (el as HTMLElement).offsetWidth, h: (el as HTMLElement).offsetHeight, rot: (Math.atan2(mt.b, mt.a) * 180) / Math.PI, font: s.fontSize, paper: getComputedStyle(el.querySelector('.sn')!).backgroundImage }
    })
    expect(look.w).toBe(200)
    expect(look.h).toBe(200)
    expect(Math.abs(look.rot - rot)).toBeLessThan(0.2)
    expect(look.font).toBe('15px')
    expect(look.paper).toContain('linear-gradient')

    // ---- 选中：操作条「纸色 ▾」换成樱粉，只改那一行注释 ----
    await page.getByTestId('decor-drawer').getByRole('button', { name: '收起' }).click()
    await note.click({ position: { x: 100, y: 120 } })
    const bar = page.getByTestId('decor-cardbar')
    await expect(bar).toBeVisible()
    await expect(bar.locator('.cnt')).toHaveText('便签')
    await bar.getByRole('button', { name: '纸色' }).click()
    await page.getByTestId('decor-paper-pop').getByRole('radio', { name: '樱粉' }).click()
    await expect.poll(f.md).toContain('note=pink')
    let d2 = diff(md1, f.md())
    expect(d2.removed).toEqual([d.added[0]])
    expect(d2.added).toEqual([d.added[0]!.replace('note=yellow', 'note=pink')])
    await expect(board.locator('.db-card.placed.dc-note[data-note="pink"]')).toBeVisible()

    // ---- 摆正：rot=0 ----
    await bar.getByRole('button', { name: '摆正' }).click()
    await expect.poll(f.md).toMatch(/note=pink rot=0 -->/)
    d2 = diff(md1, f.md())
    expect(d2.added.length).toBe(1)
    const pink = board.locator('.db-card.placed.dc-note[data-note="pink"]')
    await expect.poll(() => pink.evaluate((el) => getComputedStyle(el).transform)).toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/)

    // ---- 删掉：md 回到放便签之前；⌘Z 回来（摆正、粉色都在） ----
    const before = f.md()
    await bar.getByRole('button', { name: '删除' }).click()
    await expect.poll(f.md).not.toContain('问 Nima')
    expect(f.md().trimEnd()).toBe(BOARD.trimEnd())
    await page.keyboard.press('Meta+z')
    await expect.poll(f.md).toBe(before)
    // 再撤两下（摆正、纸色）、再一下（放便签）：回到原样
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await expect.poll(f.md).toBe(md1)
    await page.keyboard.press('Meta+z')
    await expect.poll(f.md).toBe(BOARD)
    expect(f.ink()).toBe('')
  } finally {
    await run.close()
  }
})
