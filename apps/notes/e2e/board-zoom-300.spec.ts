/**
 * 白板放大到 300%（2026-11-25 用户：「这里目前最多有160% 能不能加到300%」，截图是右栏 AI 开着、右上角 160% 到顶）：
 * - ⌘+ 一路按到 300%（档位 …200%、250%、300%，再按停住），捏合（按住 ⌘ 滚轮）连续放到 300% 停住；
 * - 右上角写的是你选的比例：右栏开着时画布让位 0.8 倍，照样写 300%，悬停两行「缩放」「右栏开着，画布实际 240%」，提示收在中栏里，不再显示 160% 像到顶；
 * - 300% 下不糊：画布是 CSS zoom 按比例重排（卡里的字是重新排的，不是放大位图）；PDF 页缩略图换 1680 宽那份（100% 时的 3 倍）；
 *   笔迹画布按屏幕像素画（画布像素 = 显示大小 × 屏幕倍数），笔画跟着变粗、有墨的像素约是 100% 时的 9 倍；
 * - 300% 下拖着滚（滚轮平移）量每秒画几帧，和 100% 时比；结果打在输出里（CN_SHOTS=目录 时存 100% / 300% 对照图）。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openAi, openNote, pane, type Running } from './app'
import { lecturePdf } from './fixtures/pdf'
import { BOARD, BOARD_PATH, INK, INK_PATH } from './ink-samples'

const PDF = lecturePdf([
  { title: 'Lecture 05 · Neurons', lines: ['A neuron sums its weighted inputs and fires above a threshold.'] },
  { title: 'Action potential', lines: ['Sodium channels open first, potassium channels follow.', 'The membrane returns to rest within a few milliseconds.'] },
])
// 组会白板：原来的两列、一张挂了笔迹的卡，再摆一张 PDF 第 2 页的卡
const FILES = {
  [BOARD_PATH]: `${BOARD}\n<!-- card id=p1 x=300 y=420 w=280 -->\n![[讲义.pdf#page=2]]\n`,
  [INK_PATH]: INK,
  '讲义.pdf': PDF,
}
const SHOTS = process.env.CN_SHOTS

const mint = (vault: string) => {
  const ud = join(vault, '..', 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
}
const board = (page: Page) => pane(page).getByTestId('doc-board')
const zoomBtn = (page: Page) => pane(page).getByTestId('board-zoom')
const planeZoom = (page: Page) => page.locator('.db-plane').evaluate((el) => Number(getComputedStyle(el).zoom))

async function shot(run: Running, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** 「情绪识别」那张卡里那行字在屏幕上多高 */
const lineH = (page: Page) =>
  board(page)
    .locator('.db-card', { hasText: '情绪识别' })
    .first()
    .evaluate((el) => {
      const r = document.createRange()
      r.selectNodeContents(el)
      return r.getClientRects()[0]!.height
    })

/** 笔迹画布上有墨的像素数，和画布像素对显示大小的倍数 */
const ink = (page: Page) =>
  page.evaluate(() => {
    const cv = document.querySelector<HTMLCanvasElement>('[data-testid="db-ink"]')!
    const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i]! > 64) n++
    return { n, k: cv.width / cv.getBoundingClientRect().width, dpr: devicePixelRatio }
  })

/** 滚轮平移 1.5 秒（每 16ms 一下），这段时间里每秒画了几帧 */
async function panFps(page: Page): Promise<number> {
  const b = (await board(page).boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __on: boolean }
    w.__frames = 0
    w.__on = true
    const tick = () => {
      if (!w.__on) return
      w.__frames++
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const t0 = Date.now()
  let dir = 1
  while (Date.now() - t0 < 1500) {
    await page.mouse.wheel(40 * dir, 30 * dir)
    if ((Date.now() - t0) % 500 < 20) dir = -dir
  }
  const ms = Date.now() - t0
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number; __on: boolean }
    w.__on = false
    return w.__frames
  })
  return Math.round((frames / ms) * 1000)
}

test('⌘+ 一路到 300%、捏合到 300% 停住；右栏开着时右上角照样写你选的 300%、悬停说画布实际 240%；300% 下 PDF 页换高清那份、笔迹按屏幕像素画；量平移帧率', async () => {
  test.setTimeout(180_000)
  const run = await launch(FILES, {}, mint)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    await openNote(page, '组会白板')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page)).toBeVisible()
    await expect(zoomBtn(page)).toHaveText('100%')
    await expect(page.locator('[data-testid="db-ink"]')).toBeAttached()
    const slide = board(page).locator('.db-slide img')
    await expect(slide).toHaveJSProperty('complete', true, { timeout: 20_000 })
    // 100% 时画的是 560 宽那份（pdf.js 照页面比例出图，实际宽差几十像素）
    const nat100 = await slide.evaluate((i: HTMLImageElement) => i.naturalWidth)
    expect(nat100).toBeLessThan(700)
    const lineH100 = await lineH(page)
    await page.waitForTimeout(300)
    const ink100 = await ink(page)
    const fps100 = await panFps(page)
    await shot(run, 'zoom-100')

    // ⌘+ 一路按：110 125 150 175 200 250 300，再按停在 300
    const seen: string[] = []
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Meta+Equal')
      await page.waitForTimeout(120)
      seen.push((await zoomBtn(page).innerText()).trim())
    }
    expect(seen).toEqual(['110%', '125%', '150%', '175%', '200%', '250%', '300%', '300%'])
    expect(await planeZoom(page)).toBe(3)
    // 300% 下不糊：PDF 页换 1680 宽那份
    await expect.poll(() => slide.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0)), { timeout: 20_000 }).toBe(1680)
    // 卡里那行字在屏幕上的高是 100% 时的 3 倍（CSS zoom 按比例重新排版、重新画字，不是把截图放大）
    expect((await lineH(page)) / lineH100).toBeCloseTo(3, 1)

    // 捏合：先回 100%，在空白处那一行手写上捏合放大，到 300% 停住（手写一直在手指底下）
    await page.keyboard.press('Meta+Digit0')
    await expect(zoomBtn(page)).toHaveText('100%')
    // 那行手写（白板坐标 935, 300）挪到白板正中
    const at = await page.evaluate(() => {
      const plane = document.querySelector<HTMLElement>('.db-plane')!
      const wrap = plane.closest<HTMLElement>('.board-wrap')!
      const w = wrap.getBoundingClientRect()
      let r = plane.getBoundingClientRect()
      wrap.scrollLeft += r.left + 935 - (w.left + w.width / 2)
      wrap.scrollTop += r.top + 300 - (w.top + w.height / 2)
      r = plane.getBoundingClientRect()
      return { x: r.left + 935, y: r.top + 300 }
    })
    await page.mouse.move(at.x, at.y)
    // 触控板捏合在 Chromium 里就是带 ctrlKey 的滚轮事件，每下几个单位：照这个发 30 下（一下大约放大 10%）
    await page.evaluate(async ({ x, y }) => {
      const el = document.elementFromPoint(x, y)!
      for (let i = 0; i < 30; i++) {
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: -10, ctrlKey: true, clientX: x, clientY: y, bubbles: true, cancelable: true }))
        await new Promise((r) => requestAnimationFrame(r))
      }
    }, at)
    await expect(zoomBtn(page)).toHaveText('300%')
    expect(await planeZoom(page)).toBe(3)
    // 笔迹：画布按屏幕像素画（画布像素 = 显示大小 × 屏幕倍数，不是先画小再放大），笔画跟着变粗：有墨的像素比 100% 时多得多（9 倍左右，按 4 倍算）
    await page.mouse.move(at.x, at.y + 300)
    await page.waitForTimeout(400)
    const ink300 = await ink(page)
    expect(ink300.k).toBeCloseTo(ink300.dpr, 1)
    expect(ink300.n).toBeGreaterThan(ink100.n * 4)
    await shot(run, 'zoom-300')
    const fps300 = await panFps(page)
    console.log(`[300%] 平移帧率：100% 时 ${fps100} 帧/秒，300% 时 ${fps300} 帧/秒；笔迹有墨像素 ${ink100.n} → ${ink300.n}`)
    expect(fps300).toBeGreaterThan(fps100 * 0.5)

    // 右栏开着（AI）：画布让位 0.8 倍，右上角照样写 300%，悬停说实际 240%
    await openAi(page)
    await expect.poll(() => planeZoom(page)).toBeCloseTo(2.4, 2)
    await expect(zoomBtn(page)).toHaveText('300%')
    await expect(zoomBtn(page)).toHaveAttribute('data-tip', '缩放\n右栏开着，画布实际 240%')
    await zoomBtn(page).hover()
    const tip = page.getByTestId('tooltip')
    await expect(tip).toContainText('右栏开着，画布实际 240%')
    // 提示收在中栏里，不伸进右栏
    const tb = (await tip.boundingBox())!
    const cb = (await page.locator('.win > .center').boundingBox())!
    expect(tb.x + tb.width).toBeLessThanOrEqual(cb.x + cb.width)
    await shot(run, 'zoom-300-右栏开着')
    // 右栏开着时 ⌘− 一下：250%，实际 200%（光标先从 AI 输入框里出来，不然 ⌘− 归输入框）
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.keyboard.press('Meta+Minus')
    await expect(zoomBtn(page)).toHaveText('250%')
    await expect.poll(() => planeZoom(page)).toBeCloseTo(2, 2)
  } finally {
    await run.close()
  }
})
