// 读 PDF 页边问过的标记放进纸面（task-2onrm，设计页 27-PDF页边标记 选 B「纸面内一列」）：真鼠标框几处问，
// 纸里右边一列竖线出来、长短等于框高、挨着的错开、悬停出这一页的列表、点一条跳到笔记那一节且框闪一下、
// 放大缩小（⌘= ⌘- ⌘0、捏合）后竖线和竖条对齐（≤ 2px）、纸左右留白相等
import { expect, type Locator, type Page, test } from '@playwright/test'
import { launch, rail, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

test.setTimeout(180_000)

const A = '课程/线代/第3讲 线性映射.pdf'
const files = { [A]: LECTURE }

const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const view = (page: Page) => pdfPane(page).getByTestId('pdf-view')
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const col = (page: Page) => pdfPane(page).getByRole('group', { name: '第 1 页问过的地方' })
const box = async (l: Locator) => (await l.boundingBox())!

async function drag(page: Page, a: [number, number], b: [number, number]) {
  const p = await box(pdfPage(page, 1))
  await page.keyboard.down('Meta')
  await page.mouse.move(p.x + p.width * a[0], p.y + p.height * a[1])
  await page.mouse.down()
  await page.mouse.move(p.x + p.width * b[0], p.y + p.height * b[1], { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Meta')
}

async function ask(page: Page, a: [number, number], b: [number, number]) {
  const n = await ai(page).getByTestId('reading-msg').count()
  await drag(page, a, b)
  const input = ai(page).getByRole('textbox', { name: '问 AI' })
  await expect(input).toBeFocused()
  await input.press('Enter')
  await expect(ai(page).getByTestId('reading-msg')).toHaveCount(n + 1)
  await expect(ai(page).getByTestId('reading-msg').last().locator('.noted')).toContainText('已记进笔记', { timeout: 20_000 })
}

/** 纸离这一栏左右两边多远（常显的滚动条算在右边留白里） */
async function gaps(page: Page) {
  return view(page).evaluate((el) => {
    const v = el.getBoundingClientRect()
    const s = el.querySelector('.pdfslot')!.getBoundingClientRect()
    return { left: s.left - v.left, right: v.right - s.right }
  })
}

/** 每段竖线和它那一处问过的框：上下沿、竖线在哪道（x）；竖条和看得到的纸右边 */
async function measure(page: Page) {
  return pdfPane(page).evaluate((root) => {
    const el = root.querySelector<HTMLElement>('[data-testid="pdf-view"]')!
    const v = el.getBoundingClientRect()
    const slot = root.querySelector('.pdfslot')!
    const s = slot.getBoundingClientRect()
    const frames = [...slot.querySelectorAll('.fr.asked')].map((f) => f.getBoundingClientRect())
    const ticks = [...slot.querySelectorAll<HTMLElement>('.mkcol .tick')].map((t) => {
      const r = t.getBoundingClientRect()
      return { id: t.dataset.id!, top: r.top, bottom: r.bottom, x: r.left, label: t.getAttribute('aria-label') }
    })
    const c = slot.querySelector('.mkcol')!.getBoundingClientRect()
    return {
      frames: frames.map((f) => ({ top: f.top, bottom: f.bottom })),
      ticks,
      col: { left: c.left, right: c.right, top: c.top, bottom: c.bottom },
      paperRight: Math.min(s.right, v.left + el.clientWidth),
      paper: { left: s.left, right: s.right, top: s.top, bottom: s.bottom },
      scale: s.width / 612,
    }
  })
}

/** 竖线按上沿排，框也按上沿排：一一对上，上下沿差 ≤ 2；竖条贴着看得到的纸右边、18 宽、和纸一样高 */
function expectAligned(m: Awaited<ReturnType<typeof measure>>) {
  const frames = [...m.frames].sort((a, b) => a.top - b.top)
  const ticks = [...m.ticks].sort((a, b) => a.top - b.top || a.x - b.x)
  expect(ticks.length).toBe(frames.length)
  ticks.forEach((t, i) => {
    expect(Math.abs(t.top - frames[i]!.top)).toBeLessThanOrEqual(2)
    expect(Math.abs(t.bottom - frames[i]!.bottom)).toBeLessThanOrEqual(2)
    expect(t.x).toBeGreaterThanOrEqual(m.col.left)
    expect(t.x + 4).toBeLessThanOrEqual(m.col.right + 0.5)
  })
  expect(Math.abs(m.col.right - m.paperRight)).toBeLessThanOrEqual(2)
  expect(Math.round(m.col.right - m.col.left)).toBe(18)
  expect(Math.abs(m.col.top - m.paper.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(m.col.bottom - m.paper.bottom)).toBeLessThanOrEqual(1)
}

test('纸里右边一列问过的：竖线长短等于框高、挨着错开、悬停出列表、点一条跳到笔记那一节且框闪、放大缩小后对齐、纸左右留白相等', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲 线性映射')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await rail(page).getByRole('button', { name: '打开 AI' }).click()
    await expect(ai(page)).toBeVisible()

    // 纸外右边那一大条没了：适合宽度时纸左右留白相等（各 40）
    await expect.poll(async () => {
      const g = await gaps(page)
      return Math.round(Math.abs(g.left - g.right))
    }).toBeLessThanOrEqual(1)
    expect(Math.round((await gaps(page)).left)).toBe(40)

    // 没问过：没有竖条
    await expect(col(page)).toHaveCount(0)

    // 问三处：上面一块、和它上下挨着（叠着）的一块、下面隔开的一块
    await ask(page, [0.1, 0.12], [0.7, 0.2])
    await expect(col(page)).toBeVisible()
    await expect(col(page).locator('.tick')).toHaveCount(1)
    await ask(page, [0.15, 0.18], [0.75, 0.3])
    await ask(page, [0.1, 0.5], [0.6, 0.56])
    await expect(col(page).locator('.tick')).toHaveCount(3)
    // 竖线是按钮，名字照旧「第 1 页这里问过 1 轮」
    await expect(col(page).getByRole('button', { name: '第 1 页这里问过 1 轮' })).toHaveCount(3)

    const m0 = await measure(page)
    expectAligned(m0)
    // 竖条在纸里：右边和纸右边齐
    expect(Math.abs(m0.col.right - m0.paper.right)).toBeLessThanOrEqual(1)
    // 挨着的错开成两道；隔开的那段回到第一道
    const byTop = [...m0.ticks].sort((a, b) => a.top - b.top)
    expect(byTop[1]!.x - byTop[0]!.x).toBeGreaterThanOrEqual(4)
    expect(Math.abs(byTop[2]!.x - byTop[0]!.x)).toBeLessThanOrEqual(0.5)
    // 长短等于框高（比例：0.08、0.12、0.06 页高）
    const ph = m0.paper.bottom - m0.paper.top
    expect(Math.abs(byTop[0]!.bottom - byTop[0]!.top - 0.08 * ph)).toBeLessThanOrEqual(2)
    expect(Math.abs(byTop[1]!.bottom - byTop[1]!.top - 0.12 * ph)).toBeLessThanOrEqual(2)

    // 悬停竖条下面那一段：出这一页问过的全部（3 处），指着的那条高亮、页上那一处的虚线框显出来
    const low = byTop[2]!
    await page.mouse.move(m0.col.left + 9, low.top + 4)
    const menu = pdfPane(page).getByRole('menu', { name: '第 1 页问过 3 处' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveCount(3)
    await expect(menu.getByRole('menuitem').nth(2)).toHaveClass(/hi/)
    await expect(pdfPage(page, 1).locator('xpath=..').locator('.fr.asked.show')).toHaveCount(1)
    // 列表整张在纸里（不碰右栏）
    const mb = await box(menu)
    expect(mb.x).toBeGreaterThanOrEqual(m0.paper.left)
    expect(mb.x + mb.width).toBeLessThanOrEqual(m0.col.left)
    // 不盖住指着的那一处：列表在它下沿往下 8；头一行中文和数字之间不手打空格
    expect(Math.abs(mb.y - (low.bottom + 8))).toBeLessThanOrEqual(2)
    await expect(menu.locator('.h')).toHaveText('第1页问过3处')
    // 从竖条挪进列表（中间隔着一点纸）：列表不收
    await page.mouse.move(mb.x + mb.width - 20, mb.y + mb.height / 2, { steps: 4 })
    await expect(menu).toBeVisible()
    // 移开：收起
    await page.mouse.move(m0.paper.left + 40, m0.paper.top + 20, { steps: 3 })
    await expect(menu).toHaveCount(0)

    // 再悬停、点第二条（叠着的那块）：右栏切到笔记那一节（外圈亮一下），PDF 上那一处的框闪一下，竖线是「正看着的」
    await page.mouse.move(m0.col.left + 9, byTop[1]!.top + 30)
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitem').nth(1).click()
    await expect(menu).toHaveCount(0)
    await expect(notes(page)).toBeVisible()
    await expect(notes(page).locator('section.rnd.flash')).toBeVisible()
    const flash = pdfPane(page).getByTestId('pdf-flash')
    await expect(flash).toBeVisible()
    // 闪的是点的那一处：和那段竖线上下沿一样（右栏换成笔记、栏宽变了，同一刻量）
    const fl = await pdfPane(page).evaluate((root, id) => {
      const f = root.querySelector('[data-testid="pdf-flash"]')!.getBoundingClientRect()
      const t = root.querySelector(`.tick[data-id="${id}"]`)!.getBoundingClientRect()
      return { dt: Math.abs(f.top - t.top), db: Math.abs(f.bottom - t.bottom) }
    }, byTop[1]!.id)
    expect(fl.dt).toBeLessThanOrEqual(2)
    expect(fl.db).toBeLessThanOrEqual(2)
    await expect(col(page).locator(`.tick[data-id="${byTop[1]!.id}"]`)).toHaveClass(/cur/)
    await expect(flash).toHaveCount(0, { timeout: 4000 })

    // 点竖条空白处：列表钉住（鼠标移开也不收），esc 收
    await rail(page).getByRole('button', { name: '打开 AI' }).click()
    // 右栏换回 AI、栏宽又变了：重新量；点在第二、三段中间的空白
    await view(page).evaluate((el) => (el.scrollTop = 0))
    await page.waitForTimeout(100)
    const mp = await measure(page)
    const sp = [...mp.ticks].sort((a, b) => a.top - b.top)
    await page.mouse.click(mp.col.left + 9, (sp[1]!.bottom + sp[2]!.top) / 2)
    await expect(menu).toBeVisible()
    await page.mouse.move(mp.paper.left + 40, (sp[1]!.bottom + sp[2]!.top) / 2, { steps: 3 })
    await page.waitForTimeout(400)
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // 直接点一段竖线（第一段）：也跳到笔记那一节
    await col(page).locator(`.tick[data-id="${byTop[0]!.id}"]`).click()
    await expect(notes(page)).toBeVisible()
    await expect(col(page).locator(`.tick[data-id="${byTop[0]!.id}"]`)).toHaveClass(/cur/)
    await expect(flash).toBeVisible()

    // ⌘= 三档：纸比栏宽，竖条贴着看得到的那块纸的右边，竖线照旧对着框（≤ 2px）
    await view(page).focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+Equal')
    await expect.poll(async () => (await measure(page)).scale).toBeGreaterThan(m0.scale + 0.3)
    await page.waitForTimeout(300)
    const m1 = await measure(page)
    expect(m1.paper.right).toBeGreaterThan(m1.paperRight + 20)
    expectAligned(m1)
    // 横着滚到最左、最右：竖条一直贴着看得到的纸右边
    await view(page).evaluate((el) => (el.scrollLeft = 0))
    await page.waitForTimeout(100)
    expectAligned(await measure(page))
    await view(page).evaluate((el) => (el.scrollLeft = el.scrollWidth))
    await page.waitForTimeout(100)
    const m2 = await measure(page)
    expectAligned(m2)
    expect(Math.abs(m2.col.right - m2.paper.right)).toBeLessThanOrEqual(1)

    // 捏合（带 ctrlKey 的滚轮）再放大
    const vb = await box(view(page))
    await page.mouse.move(vb.x + vb.width / 2, vb.y + vb.height / 2)
    await page.keyboard.down('Control')
    for (let i = 0; i < 4; i++) await page.mouse.wheel(0, -8)
    await page.keyboard.up('Control')
    await expect.poll(async () => (await measure(page)).scale).toBeGreaterThan(m1.scale + 0.1)
    await page.waitForTimeout(300)
    expectAligned(await measure(page))
    // 放大后悬停：列表还是在看得到的纸里
    const m3 = await measure(page)
    const t3 = m3.ticks.find((t) => t.top > 120 && t.bottom < 860)
    if (t3) {
      await page.mouse.move(m3.col.left + 9, t3.top + 3)
      await expect(menu).toBeVisible()
      const b3 = await box(menu)
      expect(b3.x + b3.width).toBeLessThanOrEqual(m3.col.left)
      expect(b3.x).toBeGreaterThanOrEqual(m3.paper.left)
      await page.mouse.move(m3.paper.left + 300, 400)
      await expect(menu).toHaveCount(0)
    }

    // ⌘- 缩小到比适合宽度还小：竖条贴着纸右边，对齐
    for (let i = 0; i < 8; i++) await page.keyboard.press('Meta+Minus')
    await expect.poll(async () => (await measure(page)).scale).toBeLessThan(m0.scale - 0.1)
    await page.waitForTimeout(300)
    const m4 = await measure(page)
    expectAligned(m4)
    expect(Math.abs(m4.col.right - m4.paper.right)).toBeLessThanOrEqual(1)

    // ⌘0 回到适合宽度：左右留白又相等
    await page.keyboard.press('Meta+Digit0')
    await expect.poll(async () => Math.abs((await measure(page)).scale - m0.scale)).toBeLessThan(0.01)
    const g = await gaps(page)
    expect(Math.abs(g.left - g.right)).toBeLessThanOrEqual(1)
    expectAligned(await measure(page))
  } finally {
    await run.close()
  }
})
