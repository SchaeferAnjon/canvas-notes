/**
 * 白板笔迹（方案 B「白板笔迹层」，2026-11-25；格式 packages/format/src/ink.ts，Mac 这边 renderer/doc-board/ink-layer.tsx）：
 * 一块带 笔迹.ink 的白板打开就画出笔迹；挂在卡上的那笔在卡上面插了一段以后跟着卡往下挪，空白处的不动；
 * 真点：点一笔选中那一组、拖着挪、改颜色、⌫ 删、⌘Z 撤回，每一下只改笔迹文件里那几行（别的行、白板那篇 md 一个字节不动）、提交一次；
 * 空白处按住拖是框选，不会写出笔来。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, waitSaved } from './app'
import { BOARD, BOARD_PATH, INK, INK_PATH } from './ink-samples'

const mint = (vault: string) => {
  const ud = join(vault, '..', 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
}

type Box = { left: number; top: number; right: number; bottom: number }

/** 白板坐标 → 窗口坐标 */
const toScreen = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const plane = document.querySelector<HTMLElement>('.db-plane')!
    const r = plane.getBoundingClientRect()
    const z = Number(getComputedStyle(plane).zoom) || 1
    return { x: r.left + x * z, y: r.top + y * z, z }
  }, [x, y] as const)

/** 笔迹画布上这一块（窗口坐标）里有墨的像素：几个、重心在哪、最深的一个点在哪 */
const inkIn = (page: Page, b: Box) =>
  page.evaluate((b) => {
    const cv = document.querySelector<HTMLCanvasElement>('[data-testid="db-ink"]')!
    const r = cv.getBoundingClientRect()
    const k = cv.width / r.width
    const x0 = Math.max(0, Math.floor((b.left - r.left) * k))
    const y0 = Math.max(0, Math.floor((b.top - r.top) * k))
    const x1 = Math.min(cv.width, Math.ceil((b.right - r.left) * k))
    const y1 = Math.min(cv.height, Math.ceil((b.bottom - r.top) * k))
    if (x1 <= x0 || y1 <= y0) return { n: 0, cx: 0, cy: 0, px: 0, py: 0 }
    const d = cv.getContext('2d')!.getImageData(x0, y0, x1 - x0, y1 - y0).data
    let n = 0
    let sx = 0
    let sy = 0
    let best = 0
    let px = 0
    let py = 0
    for (let y = 0; y < y1 - y0; y++)
      for (let x = 0; x < x1 - x0; x++) {
        const a = d[(y * (x1 - x0) + x) * 4 + 3]!
        if (a > 64) {
          n++
          sx += x
          sy += y
        }
        if (a > best) {
          best = a
          px = x
          py = y
        }
      }
    return { n, cx: r.left + (x0 + sx / Math.max(1, n)) / k, cy: r.top + (y0 + sy / Math.max(1, n)) / k, px: r.left + (x0 + px + 0.5) / k, py: r.top + (y0 + py + 0.5) / k }
  }, b)

const around = (p: { x: number; y: number }, w: number, h: number, z: number): Box => ({ left: p.x - 20 * z, top: p.y - 40 * z, right: p.x + (w + 20) * z, bottom: p.y + (h + 40) * z })

const lines = (s: string) => s.split('\n')
/** 两份字：没了哪几行、多了哪几行（按整行比） */
function diff(a: string, b: string) {
  const x = lines(a)
  const y = lines(b)
  return { removed: x.filter((l) => !y.includes(l)), added: y.filter((l) => !x.includes(l)) }
}

test('白板笔迹：打开画出来、挂卡的跟着卡走（上面插一段、拖到空白处）；点选、拖、改色、删、撤回只动那几行，空白处拖是框选不写笔', async () => {
  test.setTimeout(240_000)
  const run = await launch({ [BOARD_PATH]: BOARD, [INK_PATH]: INK }, {}, mint)
  const { page } = run
  const inkFile = () => readFileSync(join(run.vault, INK_PATH), 'utf8')
  const mdFile = () => readFileSync(join(run.vault, BOARD_PATH), 'utf8')
  const commits = () => Number(execFileSync('git', ['-C', run.vault, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim())
  const lastMsg = () => execFileSync('git', ['-C', run.vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1512, 888))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(888)
    await openNote(page, '组会白板')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    const cv = board.getByTestId('db-ink')
    await expect(cv).toHaveAttribute('data-strokes', '4')
    await page.waitForTimeout(500)

    // ---- 画出来了：空白处那一组、荧光笔、挂在卡 k1 上的那笔都有墨 ----
    const free = await toScreen(page, 860, 300)
    const z = free.z
    const freeBox = around(free, 160, 0, z)
    const mark = await toScreen(page, 860, 440)
    const markBox = around(mark, 150, 0, z)
    const card = board.locator('.db-card', { hasText: '情绪识别：E4 手环' })
    const cb0 = (await card.boundingBox())!
    const cardBox = { left: cb0.x, top: cb0.y, right: cb0.x + cb0.width, bottom: cb0.y + cb0.height + 30 }
    const f0 = await inkIn(page, freeBox)
    const m0 = await inkIn(page, markBox)
    const c0 = await inkIn(page, cardBox)
    expect(f0.n).toBeGreaterThan(300)
    expect(m0.n).toBeGreaterThan(800)
    expect(c0.n).toBeGreaterThan(150)
    // 挂卡的那笔：在卡的左上角往右 16、往下 34 附近
    expect(Math.abs(c0.cx - (cb0.x + (16 + 75) * z))).toBeLessThan(12)
    expect(Math.abs(c0.cy - (cb0.y + 34 * z))).toBeLessThan(10)
    // 打开只看：笔迹文件、白板 md 一个字节都没动
    expect(inkFile()).toBe(INK)
    expect(mdFile()).toBe(BOARD)

    // ---- 文档里在 k1 上面插一段：卡往下挪，挂着的笔跟着挪同样多，空白处的不动 ----
    await acts(page).getByRole('tab', { name: '文档' }).click()
    const line = pane(page).locator('.cm-line', { hasText: '驾驶压力识别 + 图网络。' })
    await line.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('插在上面的一段：E4 的采样率是 4 Hz 到 64 Hz，皮电 4 Hz、心率 1 Hz、加速度 32 Hz，几种信号要先对齐到同一个时间轴再切窗。')
    await waitSaved(page)
    await expect.poll(mdFile).toContain('插在上面的一段')
    const mdAfterInsert = mdFile()
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(cv).toHaveAttribute('data-strokes', '4')
    await page.waitForTimeout(500)
    const cb1 = (await card.boundingBox())!
    const dy = cb1.y - cb0.y
    expect(dy).toBeGreaterThan(30)
    const c1 = await inkIn(page, { left: cb1.x, top: cb1.y, right: cb1.x + cb1.width, bottom: cb1.y + cb1.height + 30 })
    expect(c1.n).toBeGreaterThan(150)
    expect(Math.abs(c1.cy - c0.cy - dy)).toBeLessThan(2)
    expect(Math.abs(c1.cx - c0.cx)).toBeLessThan(2)
    const f1 = await inkIn(page, freeBox)
    expect(Math.abs(f1.cx - f0.cx)).toBeLessThan(1)
    expect(Math.abs(f1.cy - f0.cy)).toBeLessThan(1)
    expect(inkFile()).toBe(INK)

    // ---- 点一笔：选中它那一组（两笔），操作条「已选2笔」 ----
    const n0 = commits()
    await page.mouse.click(f1.px, f1.py)
    const bar = page.getByTestId('ink-selbar')
    await expect(bar).toBeVisible()
    await expect(bar.locator('.cnt')).toHaveText('已选2笔')
    await page.screenshot({ path: test.info().outputPath('选中.png') })

    // ---- 拖着挪 60、40（屏幕上的点）：只改组那一行 ----
    const before = inkFile()
    await page.mouse.move(f1.px, f1.py)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) await page.mouse.move(f1.px - (60 * i) / 8, f1.py + (40 * i) / 8)
    await page.mouse.up()
    await expect.poll(inkFile).not.toBe(before)
    const moved = inkFile()
    const dm = diff(before, moved)
    expect(dm.removed).toEqual(['{"g":"free0001","x":860,"y":300}'])
    expect(dm.added).toHaveLength(1)
    const g = JSON.parse(dm.added[0]!) as { g: string; x: number; y: number; t: number }
    expect(g.g).toBe('free0001')
    expect(Math.abs(g.x - (860 - 60 / z))).toBeLessThan(1)
    expect(Math.abs(g.y - (300 + 40 / z))).toBeLessThan(1)
    expect(g.t).toBeGreaterThan(0)
    await expect.poll(commits).toBe(n0 + 1)
    expect(lastMsg()).toBe('笔迹：挪了 2 笔 · 组会白板')
    // 画出来的也挪过去了（先 Esc 取消选中：选中时外面那圈虚线框也画在笔迹画布上）
    await page.keyboard.press('Escape')
    await expect(bar).toHaveCount(0)
    const f2 = await inkIn(page, { left: freeBox.left - 60, top: freeBox.top + 40, right: freeBox.right - 60, bottom: freeBox.bottom + 40 })
    expect(Math.abs(f2.cx - f1.cx + 60)).toBeLessThan(2)
    expect(Math.abs(f2.cy - f1.cy - 40)).toBeLessThan(2)
    await page.mouse.click(f2.px, f2.py)
    await expect(bar.locator('.cnt')).toHaveText('已选2笔')

    // ---- 改颜色：操作条「颜色」→ 红：只改这两笔的行 ----
    await bar.getByRole('button', { name: '颜色' }).click()
    const pop = page.getByTestId('ink-colors')
    await expect(pop).toBeVisible()
    await expect(pop.locator('.ink-sw')).toHaveCount(5)
    // 操作条在选区上面：浮层往上开，不盖住选着的笔；现在的颜色不一样（黑、蓝），按钮上是调色板图标、没有哪颗带圈
    expect((await pop.boundingBox())!.y + (await pop.boundingBox())!.height).toBeLessThanOrEqual((await bar.boundingBox())!.y + 1)
    await expect(pop.locator('.ink-sw.on')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('改色.png') })
    await pop.locator('.ink-sw[data-c="#d64545"]').click()
    await expect.poll(inkFile).not.toBe(moved)
    const colored = inkFile()
    const dc = diff(moved, colored)
    expect(dc.removed.map((l) => JSON.parse(l).id).sort()).toEqual(['ring0001', 'word0001'])
    expect(dc.added.map((l) => [JSON.parse(l).id, JSON.parse(l).c]).sort()).toEqual([
      ['ring0001', '#d64545'],
      ['word0001', '#d64545'],
    ])
    // 点列原样（只改了颜色和时间）
    for (const l of dc.added) expect(JSON.parse(l).p).toBe(JSON.parse(dc.removed.find((r) => JSON.parse(r).id === JSON.parse(l).id)!).p)
    await expect.poll(commits).toBe(n0 + 2)
    expect(lastMsg()).toBe('笔迹：2 笔改了颜色 · 组会白板')
    // 都是红了：「颜色」前面是红点，浮层里红那颗带圈
    await expect(bar.locator('.sb[data-k="color"] .sb-dot')).toBeVisible()
    await bar.getByRole('button', { name: '颜色' }).click()
    await expect(pop.locator('.ink-sw.on')).toHaveAttribute('data-c', '#d64545')
    await expect(pop.locator('.ink-sw.on')).toHaveAttribute('aria-label', '红')
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)

    // ---- 点荧光笔那一笔、⌫ 删：那一行和它那一组的组行没了 ----
    const m1 = await inkIn(page, markBox)
    await page.mouse.click(m1.px, m1.py)
    await expect(bar.locator('.cnt')).toHaveText('已选1笔')
    await page.keyboard.press('Backspace')
    await expect.poll(inkFile).not.toBe(colored)
    const deleted = inkFile()
    const dd = diff(colored, deleted)
    expect(dd.added).toEqual([])
    expect(dd.removed.map((l) => JSON.parse(l).id ?? JSON.parse(l).g).sort()).toEqual(['hili0001', 'mark0001'])
    await expect(bar).toHaveCount(0)
    await expect(cv).toHaveAttribute('data-strokes', '3')
    expect((await inkIn(page, markBox)).n).toBe(0)
    await expect.poll(commits).toBe(n0 + 3)

    // ---- ⌘Z：荧光笔回来，文件和删之前一个字节不差 ----
    await page.keyboard.press('Meta+z')
    await expect.poll(inkFile).toBe(colored)
    await expect(cv).toHaveAttribute('data-strokes', '4')
    await expect.poll(async () => (await inkIn(page, markBox)).n).toBeGreaterThan(800)
    await expect.poll(commits).toBe(n0 + 4)

    // ---- 空白处按住拖：框选（碰到的笔选上），不写出笔来 ----
    await page.keyboard.press('Escape')
    const fb = { left: freeBox.left - 40, top: freeBox.top + 30, right: freeBox.right - 40, bottom: freeBox.bottom + 50 }
    await page.mouse.move(fb.left, fb.top)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(fb.left + ((fb.right - fb.left) * i) / 10, fb.top + ((fb.bottom - fb.top) * i) / 10)
    await expect(board.getByTestId('db-marquee')).toBeVisible()
    await page.mouse.up()
    await expect(bar.locator('.cnt')).toHaveText('已选2笔')
    await page.waitForTimeout(400)
    expect(inkFile()).toBe(colored)
    expect(commits()).toBe(n0 + 4)

    // ---- 框选同时碰到卡和笔：只出笔迹那一条，「已选2笔 · 1张卡」 ----
    await page.keyboard.press('Escape')
    const todo = (await board.locator('.db-card', { hasText: '跑通特征' }).boundingBox())!
    const s0 = { x: freeBox.right + 30, y: freeBox.bottom + 60 }
    const s1 = { x: todo.x + todo.width - 20, y: todo.y + 10 }
    await page.mouse.move(s0.x, s0.y)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) await page.mouse.move(s0.x + ((s1.x - s0.x) * i) / 10, s0.y + ((s1.y - s0.y) * i) / 10)
    await page.mouse.up()
    await expect(bar.locator('.cnt')).toHaveText('已选2笔 · 1张卡')
    await expect(page.getByTestId('db-selbar')).toHaveCount(0)
    expect(inkFile()).toBe(colored)

    // ---- 白板那篇 md 从插了那段以后一个字节没动（改笔迹只写笔迹文件） ----
    expect(mdFile()).toBe(mdAfterInsert)

    // ---- 把卡 k1 拖到空白处：挂着的那笔跟着卡走；md 里 k1 那一行换成位置行、ink=1 留着；笔迹文件不动 ----
    await page.keyboard.press('Escape')
    const cb2 = (await card.boundingBox())!
    const c2 = await inkIn(page, { left: cb2.x, top: cb2.y, right: cb2.x + cb2.width, bottom: cb2.y + cb2.height + 30 })
    const gx = cb2.x + cb2.width - 30
    const gy = cb2.y + cb2.height - 12
    await page.mouse.move(gx, gy)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) await page.mouse.move(gx + (120 * i) / 12, gy + (360 * i) / 12)
    await page.mouse.up()
    await expect.poll(mdFile).toMatch(/<!-- card id=k1 x=-?\d+ y=-?\d+ ink=1 -->/)
    await page.waitForTimeout(500)
    const cb3 = (await card.boundingBox())!
    expect(Math.hypot(cb3.x - cb2.x, cb3.y - cb2.y)).toBeGreaterThan(100)
    const c3 = await inkIn(page, { left: cb3.x, top: cb3.y, right: cb3.x + cb3.width, bottom: cb3.y + cb3.height + 30 })
    expect(c3.n).toBeGreaterThan(150)
    expect(Math.abs(c3.cx - c2.cx - (cb3.x - cb2.x))).toBeLessThan(2)
    expect(Math.abs(c3.cy - c2.cy - (cb3.y - cb2.y))).toBeLessThan(2)
    expect(inkFile()).toBe(colored)
  } finally {
    await run.close()
  }
})
