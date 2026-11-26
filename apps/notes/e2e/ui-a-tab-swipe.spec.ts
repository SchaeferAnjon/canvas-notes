/**
 * 标签栏横滑跟手（A12，偏好「横滑跟手」）：触控板横着划（deltaX 为主）滑多少走多少，能停在中间，有惯性但不吸到底；
 * 鼠标滚轮（只有 deltaY）照旧一格挪一整个标签、停在标签边上。
 * 以前每个 wheel 事件（触控板一划几十个）都挪一整个标签：一划就到头或到尾。真滚、窗口不上屏。
 */
import { expect, test, type Page } from '@playwright/test'
import { launch, tabOn } from './app'

const NAMES = ['Lecture05 笔记', '我的疑惑', '视频里的疑惑', '读书笔记', '写作计划', '本周复盘', '冰岛旅游2', '未命名 3', '课程', '2026-W47', '趣说明朝276年（微信读书出品）', '冰岛行程', '周记']
const files = Object.fromEntries(NAMES.map((n) => [`收件箱/${n}.md`, `# ${n}\n\n正文。\n`]))
const list = (page: Page) => page.getByTestId('tab-list')
const pos = (page: Page) => list(page).evaluate((l) => ({ left: l.scrollLeft, max: l.scrollWidth - l.clientWidth }))

async function open(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
}
/** 在标签条上发一串 wheel 事件（合成的，和触控板一样一个接一个、间隔 16ms） */
const swipe = (page: Page, dxs: number[], dy = 0) =>
  list(page).evaluate(
    async (l, { dxs, dy }) => {
      for (const dx of dxs) {
        l.dispatchEvent(new WheelEvent('wheel', { deltaX: dx, deltaY: dy, bubbles: true, cancelable: true }))
        await new Promise((r) => setTimeout(r, 16))
      }
    },
    { dxs, dy },
  )
/** 等它不动了（没有平滑滚、没有吸附） */
async function still(page: Page): Promise<number> {
  let last = -1
  for (let i = 0; i < 30; i++) {
    const now = (await pos(page)).left
    if (Math.abs(now - last) < 0.5) return now
    last = now
    await page.waitForTimeout(100)
  }
  return last
}

test('标签栏横滑跟手：小 deltaX 多次按比例走、停在中间不吸到底，反着划退回来；惯性划完停在划到的地方；鼠标滚轮照旧一格一个标签', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    for (const n of NAMES) await open(page, n)
    await expect.poll(async () => (await pos(page)).max).toBeGreaterThan(600)
    // 从最左开始
    await list(page).evaluate((l) => (l.scrollLeft = 0))
    expect(await still(page)).toBe(0)
    const max = (await pos(page)).max

    // 触控板轻轻往右划：10 下每下 6px，走 60（以前第一下就挪一整个标签，一百多）
    await swipe(page, Array(10).fill(6))
    let at = await still(page)
    expect(at).toBeGreaterThan(55)
    expect(at).toBeLessThan(65)
    // 再划 10 下：走到 120，比例不变；停住后不吸到标签边上，也不往两头滑
    await swipe(page, Array(10).fill(6))
    at = await still(page)
    expect(at).toBeGreaterThan(115)
    expect(at).toBeLessThan(125)
    await page.waitForTimeout(600)
    expect(Math.abs((await pos(page)).left - at)).toBeLessThan(1)
    expect(at).toBeLessThan(max - 50)

    // 反着划 5 下每下 4px：退 20
    await swipe(page, Array(5).fill(-4))
    const back = await still(page)
    expect(Math.abs(back - (at - 20))).toBeLessThan(3)

    // 一次带惯性的划（手指离开后系统接着发越来越小的 deltaX，合起来 300 左右）：走 300 左右，停在中间，不到底
    const momentum = [30, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 1, 1, 1, 1]
    const total = momentum.reduce((a, b) => a + b, 0)
    await swipe(page, momentum)
    const after = await still(page)
    expect(Math.abs(after - (back + total))).toBeLessThan(3)
    expect(after).toBeLessThan(max - 20)

    // 真的触控板事件（Playwright 走 CDP 发的 wheel，不是合成的）：同样跟手
    const box = (await list(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const before = await still(page)
    for (let i = 0; i < 5; i++) await page.mouse.wheel(-8, 0)
    const real = await still(page)
    expect(Math.abs(real - (before - 40))).toBeLessThan(3)

    // 鼠标滚轮只有 deltaY：照旧一格挪一整个标签（停在标签边上，走得比一格的像素多）
    await list(page).evaluate((l) => (l.scrollLeft = 0))
    await still(page)
    await page.mouse.wheel(0, 100)
    const wheel = await still(page)
    expect(wheel).toBeGreaterThan(50)
    const stops = await list(page).evaluate((l) => {
      const r = l.getBoundingClientRect()
      return [...l.querySelectorAll<HTMLElement>(':scope > .tab')].map((t, i) => (i === 0 ? 0 : Math.max(0, Math.round(t.getBoundingClientRect().left - r.left + l.scrollLeft - 24))))
    })
    expect(stops.some((s) => Math.abs(s - wheel) <= 1)).toBe(true)
  } finally {
    await run.close()
  }
})
