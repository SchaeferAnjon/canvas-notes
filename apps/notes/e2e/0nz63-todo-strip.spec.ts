/**
 * 待办首页往下滚，顶上的周条贴在顶上时铺的底和中间岛是同一个样子（task-0nz63，用户 0.5.2：「当你向下滚动的时候就会出现一个大白框」）。
 * 浮岛书桌 + 窗口背景图时中间岛是半透明面板（--isle + 模糊，垫在岛最底下的 ::before 上）；周条以前贴住后自己再铺一层 --isle，
 * 两层 82% 叠起来差不多 97% 不透明，就成了一整块白。
 * 量法：没滚的时候岛左上角内边距里一小块空白的颜色，和滚下去以后周条盖在同一处的颜色比，差得不多才算「和面板一致」；
 * 同时周条那一块不能是实心白，滚过去的字也不能从周条底下透出来（周条上边内边距那一横条一小块一小块都和岛一样）。
 * 浅色 / 深色 × 有图 / 不用图，加 A「照 VS Code」。一律真滚（鼠标滚轮）、无头。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, pane, type Running } from './app'

const pad = (n: number) => String(n).padStart(2, '0')
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
// 够长、能滚两屏的待办：过期、今天、接下来七天、没定日子的都有
const LINES = Array.from({ length: 60 }, (_, i) => `- [ ] 第 ${i + 1} 条：Generative Neural Networks 讲课和练习 📅 ${day((i % 12) - 3)}${i % 3 ? ' 14:00' : ''}`)
const VAULT = { '收件箱/待办.md': `# 待办\n\n${LINES.join('\n')}\n` }

type Rgb = [number, number, number]
const home = (page: Page) => pane(page).getByTestId('todo-home')

/** 窗口里一块（CSS 像素）的平均颜色：主进程 capturePage，BGRA 逐点平均 */
async function avg(run: Running, r: { x: number; y: number; width: number; height: number }): Promise<Rgb> {
  return run.app.evaluate(async ({ BrowserWindow }, rect) => {
    const img = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(rect)
    const buf = img.toBitmap()
    const n = buf.length / 4
    let b = 0, g = 0, r = 0
    for (let i = 0; i < buf.length; i += 4) {
      b += buf[i]!
      g += buf[i + 1]!
      r += buf[i + 2]!
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)] as [number, number, number]
  }, { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) })
}
const dist = (a: Rgb, b: Rgb) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

const CASES = [
  { name: '浮岛-极光-浅色', skin: 'mint', frame: 'b', winBg: 'aurora' },
  { name: '浮岛-极光-深色', skin: 'petrol', frame: 'b', winBg: 'aurora' },
  { name: '浮岛-冰洞-浅色', skin: 'sky', frame: 'b', winBg: 'cave' },
  { name: '浮岛-不用图-纯白', skin: 'mint', frame: 'b', winBg: 'none' },
  { name: '浮岛-不用图-深色', skin: 'ink', frame: 'b', winBg: 'none' },
  { name: 'VSCode-浅色', skin: 'mint', frame: 'a', winBg: 'aurora' },
  { name: 'VSCode-深色', skin: 'graphite', frame: 'a', winBg: 'aurora' },
] as const

for (const c of CASES)
  test(`${c.name}：待办首页往下滚，周条贴在顶上时的底和中间岛一样（不是一整块白），滚过去的字不从它底下透出来`, async () => {
    const run = await launch(VAULT, {}, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: c.skin, frame: c.frame, winBg: c.winBg } }))
    })
    const { page } = run
    try {
      await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '待办', exact: true }).click()
      const scroll = home(page)
      const bar = scroll.locator('.tdh-cal')
      await expect(bar.locator('.tdh-wc')).toHaveCount(7)
      await expect(page.locator('html')).toHaveAttribute('data-winbg', c.frame === 'b' && c.winBg !== 'none' ? 'photo' : /photo|none/)
      // 背景图画出来再量
      await page.waitForTimeout(600)
      const box = (await scroll.boundingBox())!
      // 周条贴住以后它左边内边距（32 宽，没有自己的字）会盖住的一小块：没滚时这里是岛上的空白（清单的左内边距、大标题上面）
      const left = (await scroll.locator('.tdh').boundingBox())!.x
      const spot = { x: left + 6, y: box.y + 8, width: 16, height: 10 }
      const before = await avg(run, spot)
      // 岛顶上一横条（以后周条上边的内边距，12 高）切成 24 宽的小块：没滚时是大标题上面的空白
      const tops = (await scroll.locator('.tdh-cal').boundingBox())!
      const cells: { x: number; y: number; width: number; height: number }[] = []
      for (let x = tops.x + 40; x + 24 < tops.x + tops.width - 8; x += 24) cells.push({ x, y: box.y + 2, width: 24, height: 8 })
      const plain: Rgb[] = []
      for (const r of cells) plain.push(await avg(run, r))
      await shot(run, `${c.name}-没滚`)

      // 真滚：鼠标放在清单上，滚轮往下滚两次
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.wheel(0, 500)
      await page.mouse.wheel(0, 500)
      await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(600)
      // 周条贴住了：它的顶就是岛的顶，盖住了刚才量的那一块
      await expect.poll(async () => Math.round((await bar.boundingBox())!.y - box.y)).toBe(0)
      const b = (await bar.boundingBox())!
      expect(spot.y + spot.height).toBeLessThan(b.y + b.height)
      expect(spot.x).toBeGreaterThanOrEqual(b.x)
      await page.waitForTimeout(400)
      const after = await avg(run, spot)
      await shot(run, `${c.name}-滚下去`)

      // 0. 周条自己算出来的底：浮岛有图时不铺（透明），不是不透明的白
      const bg = await bar.evaluate((el) => getComputedStyle(el).backgroundColor)
      if (c.frame === 'b' && c.winBg !== 'none') expect(bg).toBe('rgba(0, 0, 0, 0)')
      expect(bg).not.toBe('rgb(255, 255, 255)')
      // 1. 和没滚时同一处的岛一样：不叠第二层面板色
      expect(dist(before, after), `周条底 ${after} 对岛 ${before}`).toBeLessThanOrEqual(6)
      // 2. 有图的浮岛：周条那一块不是实心白（三个通道都 ≥ 250）
      if (c.frame === 'b' && c.winBg !== 'none') expect(Math.min(...after), `周条底 ${after}`).toBeLessThan(250)
      // 3. 滚过去的字不透出来：周条上边的内边距（没有自己的字，下面压着一行行待办）一小块一小块都和没滚时同一处的岛一样
      expect(b.x).toBe(tops.x)
      const blocks: Rgb[] = []
      for (const r of cells) blocks.push(await avg(run, r))
      const worst = Math.max(...blocks.map((p, i) => dist(p, plain[i]!)))
      expect(worst, `周条上边一块块 ${JSON.stringify(blocks)}，没滚时 ${JSON.stringify(plain)}`).toBeLessThanOrEqual(6)
    } finally {
      await run.close()
    }
  })

/** 字被 y 这条线从中间切开（上下都伸出去）的那一行是第几行，没有是 -1 */
const rowAcross = (page: Page, y: number) =>
  home(page)
    .locator('.td-r .td-t')
    .evaluateAll((ts, yy) => ts.findIndex((x) => {
      const q = x.getBoundingClientRect()
      return q.top < yy - 4 && q.bottom > yy + 4
    }), y)

test('周条贴在顶上时照样能用：压在周条下沿的那一行，上半截点到的是周条；拖一条到周条某天只改那一行；左栏点一条，中间滚到它、不被周条盖住', async () => {
  const run = await launch(VAULT, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b', winBg: 'aurora' } }))
  })
  const { page } = run
  try {
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '待办', exact: true }).click()
    const scroll = home(page)
    const bar = scroll.locator('.tdh-cal')
    await expect(bar.locator('.tdh-wc')).toHaveCount(7)
    const box = (await scroll.boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 700)
    await expect.poll(async () => Math.round((await bar.boundingBox())!.y - box.y)).toBe(0)
    const b = (await bar.boundingBox())!
    const edge = b.y + b.height
    // 一点一点往下滚，直到有一行正好压在周条下沿上（半截在周条底下）
    for (let i = 0; i < 16 && (await rowAcross(page, edge)) < 0; i++) {
      await page.mouse.wheel(0, 7)
      await page.waitForTimeout(60)
    }
    expect(await rowAcross(page, edge), '有一行的字被周条下沿从中间切开').toBeGreaterThanOrEqual(0)
    await run.page.waitForTimeout(100)
    await shot(run, '压着下沿的一行')
    // 下沿上面 3：那一行的上半截在这里，但被剪掉了，点到的是周条；下沿下面 6：点到的是那一行
    const at = (y: number) => page.evaluate(([x, yy]) => {
      const el = document.elementFromPoint(x!, yy!)
      return el?.closest('.tdh-cal') ? '周条' : el?.closest('.td-r') ? '行' : el?.className
    }, [b.x + 140, y])
    expect(await at(edge - 3)).toBe('周条')
    expect(await at(edge + 6)).toBe('行')

    // 贴着的时候把一条拖到周条上后天那一格：文件里只改那一行的日子
    const src = VAULT['收件箱/待办.md']
    const target = scroll.locator('.td-r').filter({ hasText: /^第 30 条/ })
    await target.scrollIntoViewIfNeeded()
    const to = bar.locator(`.tdh-wc[data-day="${day(2)}"]`)
    const a = (await target.boundingBox())!
    const t = (await to.boundingBox())!
    await page.mouse.move(a.x + 80, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(a.x + 90, a.y + a.height / 2 - 6, { steps: 3 })
    await page.mouse.move(t.x + t.width / 2, t.y + t.height / 2, { steps: 12 })
    await expect(to).toHaveClass(/over/)
    await page.mouse.up()
    const old = src.split('\n').find((l) => l.startsWith('- [ ] 第 30 条：'))!
    await expect.poll(() => readFileSync(join(run.vault, '收件箱/待办.md'), 'utf8')).toBe(src.replace(old, old.replace(/📅 \S+/, `📅 ${day(2)}`)))

    // 左栏点一条（在清单最上面那组）：中间滚到它，它整个在周条下面
    await page.keyboard.press('Escape')
    const left = page.locator('aside.side[aria-label="待办"] .td-r').filter({ hasText: /^第 1 条/ }).first()
    await left.click()
    const center = scroll.locator('.td-r').filter({ hasText: /^第 1 条/ })
    await expect(center).toHaveClass(/sel/)
    await expect.poll(async () => (await center.boundingBox())!.y >= edge).toBe(true)
    await expect(center).toBeInViewport()
  } finally {
    await run.close()
  }
})
