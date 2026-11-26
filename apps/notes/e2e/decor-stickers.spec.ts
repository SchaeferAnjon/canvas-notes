/**
 * 白板装饰 · 贴纸（设计页 145「贴纸」）：真点。
 * - 自带贴纸：抽屉贴纸页三套各 12 张，拖一张到空白处 → 笔迹文件多一行 `{"sticker":…,"k":"star",…}`，md 一个字节不动；
 *   第一次用的那张 SVG 拷进库里的 附件/贴纸/star.svg（再放一张同样的不再拷）。挪、转（旋转把手，吸到 0°）、缩放（右下角）、
 *   摆正、放到最上面、⌫ 删、⌘Z，每一下只改那一行。放到有编号（ink=1）的卡上记 on、md 不动；放到没编号的卡上先给卡记编号，⌘Z 一下两样都回去。
 * - 透明图：从访达拖进透明 PNG → 贴纸（图拷进这篇的附件，行里记 src），不透明的 → 图片卡；「改成图片卡」；抽屉「从照片…」。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { center, diff, drag, files, openDecorBoard, toScreen } from './decor-helpers'
import { BOARD, PNG_CLEAR, PNG_SOLID } from './decor-samples'

const decorLines = (ink: string) => ink.split('\n').filter((l) => l.startsWith('{"sticker"') || l.startsWith('{"tape"'))
const parse = (l: string) => JSON.parse(l) as Record<string, number | string>

/** 在白板 (x, y) 处放下一张图（像从访达拖进来：drop 事件里带文件） */
async function dropFile(page: Page, x: number, y: number, name: string, bytes: Buffer) {
  const p = await toScreen(page, x, y)
  await page.evaluate(
    ({ x, y, name, b64 }) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([bin], name, { type: 'image/png' }))
      const el = document.elementFromPoint(x, y)!
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    },
    { x: p.x, y: p.y, name, b64: bytes.toString('base64') },
  )
}

test('自带贴纸：拖上白板只多一行、SVG 拷一次；挪、转、缩放、摆正、放到最上面、删、⌘Z；挂卡', async () => {
  test.setTimeout(300_000)
  const { run, page, board } = await openDecorBoard()
  const f = files(run)
  try {
    await board.getByTestId('pal-decor').click()
    const drawer = page.getByTestId('decor-drawer')
    await drawer.getByRole('tab', { name: '贴纸' }).click()
    for (const [pack, n] of [
      ['学习', 12],
      ['标签', 12],
      ['心情', 12],
    ] as const) {
      await drawer.getByRole('button', { name: pack, exact: true }).click()
      await expect(drawer.locator('.dw-item[data-kind="sticker"]')).toHaveCount(n)
    }
    await drawer.getByRole('button', { name: '学习', exact: true }).click()

    // ---- 放一张星星在空白处 ----
    const commits0 = f.commits()
    const star = await center(page, '[data-testid="decor-drawer"] .dw-item[data-v="star"]')
    const spot = await toScreen(page, 760, 520)
    await drag(page, star, spot)
    await expect(board.getByTestId('decor-sticker')).toHaveCount(1)
    await expect.poll(() => decorLines(f.ink()).length).toBe(1)
    const ink1 = f.ink()
    const s1 = parse(decorLines(ink1)[0]!)
    expect(ink1.split('\n')[0]).toBe('{"ink":1}')
    expect(s1.k).toBe('star')
    expect(s1.w).toBe(76)
    expect(Math.abs(Number(s1.rot))).toBeLessThanOrEqual(8)
    expect(Math.abs(Number(s1.x) - 760)).toBeLessThan(3)
    expect(Math.abs(Number(s1.y) - 520)).toBeLessThan(3)
    expect(s1.on).toBeUndefined()
    expect(f.md()).toBe(BOARD)
    const svg = join(run.vault, '附件/贴纸/star.svg')
    await expect.poll(() => existsSync(svg)).toBe(true)
    expect(readFileSync(svg, 'utf8')).toBe(readFileSync(join(__dirname, '../../../packages/design/stickers/star.svg'), 'utf8'))
    await expect.poll(f.commits).toBe(commits0 + 2) // 拷 SVG 一次、笔迹一次
    // 选中：旋转把手、缩放把手、小条「摆正 · 放到最上面 · 删除」
    const el = board.getByTestId('decor-sticker').first()
    await expect(el).toHaveClass(/sel/)
    await expect(el.locator('[data-handle="rot"]')).toBeVisible()
    await expect(el.locator('[data-handle="scale"]')).toBeVisible()
    const bar = page.getByTestId('decor-bar')
    await expect(bar).toBeVisible()
    await expect(bar.getByRole('button')).toHaveText(['摆正', '放到最上面', '删除'])

    // ---- 再放一张星星：SVG 不再拷，提交只多一次 ----
    const spot2 = await toScreen(page, 960, 430)
    await drag(page, star, spot2)
    await expect.poll(() => decorLines(f.ink()).length).toBe(2)
    await expect.poll(f.commits).toBe(commits0 + 3)
    await page.getByTestId('decor-drawer').getByRole('button', { name: '收起' }).click()

    // ---- 挪第一张：只改它那一行的 x、y ----
    const z = spot.z
    const before = f.ink()
    await drag(page, spot, { x: spot.x + 80 * z, y: spot.y + 40 * z })
    await expect.poll(f.ink).not.toBe(before)
    let d = diff(before, f.ink())
    expect(d.removed.length).toBe(1)
    expect(d.added.length).toBe(1)
    const moved = parse(d.added[0]!)
    expect(moved.sticker).toBe(s1.sticker)
    expect(Math.abs(Number(moved.x) - (Number(s1.x) + 80))).toBeLessThan(2)
    expect(Math.abs(Number(moved.y) - (Number(s1.y) + 40))).toBeLessThan(2)
    expect(f.md()).toBe(BOARD)

    // ---- 转：拖旋转把手到右边 → 角度约 90°，吸到 90 ----
    const first = board.locator(`[data-decor="sticker:${s1.sticker}"]`)
    await first.click()
    const c0 = await toScreen(page, Number(moved.x), Number(moved.y))
    const rotH = await center(page, `[data-decor="sticker:${s1.sticker}"] [data-handle="rot"]`)
    await drag(page, rotH, { x: c0.x + 120 * z, y: c0.y + 1 })
    await expect.poll(() => parse(decorLines(f.ink()).find((l) => l.includes(String(s1.sticker)))!).rot).toBe(90)
    // 摆正：0
    await bar.getByRole('button', { name: '摆正' }).click()
    await expect.poll(() => parse(decorLines(f.ink()).find((l) => l.includes(String(s1.sticker)))!).rot).toBe(0)
    // ---- 缩放：右下角往外拖，宽变大 ----
    const sc = await center(page, `[data-decor="sticker:${s1.sticker}"] [data-handle="scale"]`)
    await drag(page, sc, { x: sc.x + 40 * z, y: sc.y + 40 * z })
    await expect.poll(() => Number(parse(decorLines(f.ink()).find((l) => l.includes(String(s1.sticker)))!).w)).toBeGreaterThan(85)
    // ---- 放到最上面：第一张的行挪到最后 ----
    expect(decorLines(f.ink())[0]).toContain(String(s1.sticker))
    await bar.getByRole('button', { name: '放到最上面' }).click()
    await expect.poll(() => decorLines(f.ink())[1]).toContain(String(s1.sticker))
    expect(f.md()).toBe(BOARD)

    // ---- ⌫ 删、⌘Z 回来 ----
    const full = f.ink()
    await page.keyboard.press('Backspace')
    await expect.poll(() => decorLines(f.ink()).length).toBe(1)
    await expect(board.getByTestId('decor-sticker')).toHaveCount(1)
    await page.keyboard.press('Meta+z')
    await expect.poll(f.ink).toBe(full)
    await expect(board.getByTestId('decor-sticker')).toHaveCount(2)

    // ---- 放到有编号的卡 k1 上：记 on=k1，md 不动 ----
    await board.getByTestId('pal-decor').click()
    await page.getByTestId('decor-drawer').getByRole('tab', { name: '贴纸' }).click()
    await page.getByTestId('decor-drawer').getByRole('button', { name: '标签', exact: true }).click()
    const zd = await center(page, '[data-testid="decor-drawer"] .dw-item[data-v="zd"]')
    const k1 = (await board.locator('.db-card[data-id="k1"]').boundingBox())!
    await drag(page, zd, { x: k1.x + k1.width - 60, y: k1.y + 20 })
    await expect.poll(() => decorLines(f.ink()).length).toBe(3)
    const onK1 = parse(decorLines(f.ink())[2]!)
    expect(onK1.k).toBe('zd')
    expect(onK1.on).toBe('k1')
    expect(onK1.w).toBe(96)
    expect(f.md()).toBe(BOARD)

    // ---- 放到没编号的卡上：先给卡记编号（md 只多一行注释），⌘Z 一下两样都回去 ----
    const plain = board.locator('.db-card[data-id]', { hasText: '笔记里只记到这些' })
    const pb = (await plain.boundingBox())!
    const inkBefore = f.ink()
    await drag(page, zd, { x: pb.x + 60, y: pb.y + 30 })
    await expect.poll(() => decorLines(f.ink()).length).toBe(4)
    await expect.poll(() => diff(BOARD, f.md())).toEqual({ removed: [], added: ['<!-- card id=k2 ink=1 -->'] })
    expect(parse(decorLines(f.ink())[3]!).on).toBe('k2')
    await page.getByTestId('decor-drawer').getByRole('button', { name: '收起' }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+z')
    await expect.poll(f.ink).toBe(inkBefore)
    await expect.poll(f.md).toBe(BOARD)
    d = diff(inkBefore, f.ink())
    expect(d).toEqual({ removed: [], added: [] })
  } finally {
    await run.close()
  }
})

test('透明图贴纸：访达拖进透明 PNG 成贴纸、不透明的成图片卡；改成图片卡；抽屉「从照片…」', async () => {
  test.setTimeout(240_000)
  const { run, page, board } = await openDecorBoard()
  const f = files(run)
  try {
    // ---- 透明 PNG：贴纸，图拷进这篇的附件，md 不动 ----
    await dropFile(page, 760, 520, '手环.png', PNG_CLEAR)
    await expect.poll(() => decorLines(f.ink()).length).toBe(1)
    const s = parse(decorLines(f.ink())[0]!)
    expect(String(s.src)).toMatch(/^附件\/11\.24 组会准备\/手环.*\.png$/)
    expect(s.k).toBeUndefined()
    expect(s.w).toBe(160)
    expect(s.rot).toBe(-4)
    expect(existsSync(join(run.vault, String(s.src)))).toBe(true)
    expect(f.md()).toBe(BOARD)
    const el = board.locator(`[data-decor="sticker:${s.sticker}"]`)
    await expect(el).toBeVisible()
    await expect(el.locator('img')).toHaveJSProperty('complete', true)
    expect(await el.locator('img').evaluate((i) => (i as HTMLImageElement).naturalWidth)).toBe(120)
    // 无框、两层柔影
    expect(await el.locator('img').evaluate((i) => getComputedStyle(i).filter)).toContain('drop-shadow')
    const bar = page.getByTestId('decor-bar')
    await expect(bar.getByRole('button')).toHaveText(['摆正', '放到最上面', '改成图片卡', '删除'])

    // ---- 改成图片卡：笔迹少这一行、md 末尾多一张图片卡；⌘Z 一下两样都回去 ----
    const ink1 = f.ink()
    await bar.getByRole('button', { name: '改成图片卡' }).click()
    await expect.poll(() => decorLines(f.ink()).length).toBe(0)
    await expect.poll(f.md).toContain('![手环')
    const d = diff(BOARD, f.md())
    expect(d.removed).toEqual([])
    expect(d.added.length).toBe(2)
    expect(d.added[0]).toMatch(/^<!-- card id=d1 x=\d+ y=\d+ -->$/)
    expect(d.added[1]).toMatch(/^!\[手环[^\]]*\]\(附件\/11\.24%20组会准备\/手环.*\.png\)$|^!\[手环[^\]]*\]\(<?附件\/11\.24 组会准备\/手环.*\.png>?\)$/)
    await page.keyboard.press('Meta+z')
    await expect.poll(f.ink).toBe(ink1)
    await expect.poll(f.md).toBe(BOARD)

    // ---- 不透明 PNG：图片卡（md 多一张），笔迹不动 ----
    await dropFile(page, 760, 620, '流程图.png', PNG_SOLID)
    await expect.poll(f.md).toContain('![流程图')
    expect(f.ink()).toBe(ink1)
    await expect(board.locator('.db-card.placed', { has: page.locator('img') })).toHaveCount(1)
    const md2 = f.md()

    // ---- 抽屉「从照片…」：选透明的一张 → 贴纸 ----
    await board.getByTestId('pal-decor').click()
    await page.getByTestId('decor-drawer').getByRole('tab', { name: '贴纸' }).click()
    await page.getByTestId('decor-photo-input').setInputFiles({ name: '印章.png', mimeType: 'image/png', buffer: PNG_CLEAR })
    await expect.poll(() => decorLines(f.ink()).length).toBe(2)
    expect(String(parse(decorLines(f.ink())[1]!).src)).toMatch(/印章.*\.png$/)
    expect(f.md()).toBe(md2)
  } finally {
    await run.close()
  }
})
