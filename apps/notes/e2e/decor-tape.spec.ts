/**
 * 白板装饰 · 和纸胶带（设计页 145「胶带」）：真点。
 * 抽屉胶带页八种花样；按住一卷拖到卡角 36 以内出虚线框、顶上说「贴在「卡名」左上角，跟着这张卡走」，松手吸住：
 * 笔迹文件多一行 `{"tape":…,"on":"k1","at":"tl",…}`，md 一个字节不动（k1 本来就带编号和 ink=1）；
 * 挪这张卡（拖到空白处）胶带跟着走；⌘Z 撤回挪卡，胶带跟回去；「换花样 ▾」只改这一行；拖到空白处钉在白板上（不挂卡）；
 * 卡删了胶带不画、撤回删卡就回来；胶带挂到没编号的卡上先给卡记编号，⌘Z 一下两样都回去。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { center, diff, drag, files, openDecorBoard, toScreen } from './decor-helpers'
import { BOARD } from './decor-samples'

const tapeLines = (ink: string) => ink.split('\n').filter((l) => l.startsWith('{"tape"'))
const parse = (l: string) => JSON.parse(l) as Record<string, number | string>

/** 胶带画出来的中心（窗口坐标）：转过的元素的外框中心就是它的中心 */
async function tapeCenter(el: Locator) {
  const b = (await el.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
async function tapeTab(page: Page) {
  await page.getByTestId('decor-drawer').getByRole('tab', { name: '胶带' }).click()
}

test('胶带：吸到卡角（虚线框、顶上那句），md 不动；挪卡跟着走、⌘Z；换花样；钉在白板上；删卡不画、撤回回来；挂没编号的卡', async () => {
  test.setTimeout(300_000)
  const { run, page, board } = await openDecorBoard()
  const f = files(run)
  try {
    await board.getByTestId('pal-decor').click()
    await tapeTab(page)
    await expect(page.getByTestId('decor-drawer').locator('.dw-item[data-kind="tape"]')).toHaveCount(8)
    await expect(page.getByTestId('decor-drawer')).toContainText('拖到卡片的角或边上会吸住；放在空白处就钉在白板上')

    // ---- 拖到 k1 左上角附近：虚线框、顶上那句；松手吸住 ----
    const card = board.locator('.db-card[data-id="k1"]')
    const k = (await card.boundingBox())!
    const mint = await center(page, '[data-testid="decor-drawer"] .dw-item[data-v="mint"]')
    await drag(page, mint, { x: k.x + 14, y: k.y + 10 }, 14, async () => {
      await expect(board.getByTestId('decor-snap')).toBeVisible()
      await expect(page.getByTestId('decor-say')).toHaveText('贴在「C72 BST-GATNet…」左上角，跟着这张卡走')
    })
    await expect(board.getByTestId('decor-snap')).toHaveCount(0)
    await expect.poll(() => tapeLines(f.ink()).length).toBe(1)
    const t1 = parse(tapeLines(f.ink())[0]!)
    expect(t1).toMatchObject({ on: 'k1', at: 'tl', pat: 'mint' })
    expect(Number(t1.len)).toBeGreaterThanOrEqual(72)
    expect(Number(t1.len)).toBeLessThanOrEqual(88)
    expect(Math.abs(Number(t1.rot) + 40)).toBeLessThanOrEqual(3)
    expect(f.md()).toBe(BOARD)
    const tape = board.locator(`[data-decor="tape:${t1.tape}"]`)
    // 画在卡的左上角上
    let c = await tapeCenter(tape)
    expect(Math.abs(c.x - k.x)).toBeLessThan(3)
    expect(Math.abs(c.y - k.y)).toBeLessThan(3)
    // 80% 不透明、宽 26（+2 撕口）
    await expect.poll(() => page.evaluate((id) => getComputedStyle(document.querySelector(`[data-decor="tape:${id}"] .dc-tape-op`)!).opacity, String(t1.tape))).toBe('0.8')
    await page.getByTestId('decor-drawer').getByRole('button', { name: '收起' }).click()

    // ---- 挪 k1 到空白处：胶带跟着走（笔迹文件不动） ----
    const ink1 = f.ink()
    const to = await toScreen(page, 900, 560)
    await drag(page, { x: k.x + 120, y: k.y + 40 }, to, 14)
    await expect.poll(f.md).toContain('<!-- card id=k1 x=')
    const k2 = (await card.boundingBox())!
    expect(Math.hypot(k2.x - k.x, k2.y - k.y)).toBeGreaterThan(100)
    await expect.poll(async () => {
      const p = await tapeCenter(tape)
      return Math.round(Math.hypot(p.x - k2.x, p.y - k2.y))
    }).toBeLessThan(3)
    expect(f.ink()).toBe(ink1)
    // ⌘Z：卡回去，胶带也回去
    await page.keyboard.press('Meta+z')
    await expect.poll(f.md).toBe(BOARD)
    await expect.poll(async () => {
      const p = await tapeCenter(tape)
      return Math.round(Math.hypot(p.x - k.x, p.y - k.y))
    }).toBeLessThan(3)

    // ---- 换花样：只改这一行的 pat ----
    await tape.click()
    const bar = page.getByTestId('decor-bar')
    await expect(bar).toBeVisible()
    // 照定稿只有几颗按钮，不写「已选」
    await expect(bar.locator('.cnt')).toHaveCount(0)
    await expect(bar.getByRole('button')).toHaveText(['换花样', '删除'])
    await bar.getByRole('button', { name: '换花样' }).click()
    await page.getByTestId('decor-tape-pop').getByRole('radio', { name: '夜空星星' }).click()
    await expect.poll(() => parse(tapeLines(f.ink())[0]!).pat).toBe('stars')
    const d = diff(ink1, f.ink())
    expect(d.removed.length).toBe(1)
    expect(d.added.length).toBe(1)
    expect(parse(d.added[0]!)).toMatchObject({ tape: t1.tape, on: 'k1', at: 'tl', len: t1.len, seed: t1.seed })
    expect(f.md()).toBe(BOARD)

    // ---- 拖到空白处：钉在白板上（不挂卡） ----
    await board.getByTestId('pal-decor').click()
    await tapeTab(page)
    const dots = await center(page, '[data-testid="decor-drawer"] .dw-item[data-v="dots"]')
    const free = await toScreen(page, 1000, 600)
    await drag(page, dots, free)
    await expect.poll(() => tapeLines(f.ink()).length).toBe(2)
    const t2 = parse(tapeLines(f.ink())[1]!)
    expect(t2.on).toBeUndefined()
    expect(t2.at).toBeUndefined()
    expect(Math.abs(Number(t2.x) - 1000)).toBeLessThan(3)
    expect(t2.len).toBe(90)
    // 删掉（⌫）、⌘Z
    const ink2 = f.ink()
    await page.keyboard.press('Backspace')
    await expect.poll(() => tapeLines(f.ink()).length).toBe(1)
    await page.keyboard.press('Meta+z')
    await expect.poll(f.ink).toBe(ink2)

    // ---- 删掉卡 k1：胶带不画（文件里照留）；撤回删卡就回来 ----
    await page.getByTestId('decor-drawer').getByRole('button', { name: '收起' }).click()
    await card.click({ position: { x: 120, y: 40 } })
    await page.keyboard.press('Backspace')
    await expect.poll(f.md).not.toContain('C72 BST-GATNet：第 1、2 页')
    await expect(tape).toHaveCount(0)
    expect(f.ink()).toBe(ink2)
    await page.keyboard.press('Meta+z')
    await expect.poll(f.md).toBe(BOARD)
    await expect(tape).toHaveCount(1)
    c = await tapeCenter(tape)
    const k3 = (await card.boundingBox())!
    expect(Math.hypot(c.x - k3.x, c.y - k3.y)).toBeLessThan(3)

    // ---- 挂到没编号的卡上（右下角）：md 多一行编号注释；⌘Z 一下两样都回去 ----
    await page.keyboard.press('Escape')
    const plain = board.locator('.db-card[data-id]', { hasText: '笔记里只记到这些' })
    const pb = (await plain.boundingBox())!
    await board.getByTestId('pal-decor').click()
    await tapeTab(page)
    const kraft = await center(page, '[data-testid="decor-drawer"] .dw-item[data-v="kraft"]')
    await drag(page, kraft, { x: pb.x + pb.width - 8, y: pb.y + pb.height - 6 }, 14, async () => {
      await expect(page.getByTestId('decor-say')).toContainText('右下角，跟着这张卡走')
    })
    await expect.poll(() => tapeLines(f.ink()).length).toBe(3)
    expect(parse(tapeLines(f.ink())[2]!)).toMatchObject({ on: 'k2', at: 'br', pat: 'kraft' })
    await expect.poll(() => diff(BOARD, f.md())).toEqual({ removed: [], added: ['<!-- card id=k2 ink=1 -->'] })
    await page.getByTestId('decor-drawer').getByRole('button', { name: '收起' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+z')
    await expect.poll(f.ink).toBe(ink2)
    await expect.poll(f.md).toBe(BOARD)
  } finally {
    await run.close()
  }
})
