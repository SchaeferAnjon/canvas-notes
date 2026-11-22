// 网页标签上的配对小标（task-z5jh4，偏好「网页标签配对小标能点开笔记」）：
// 鼠标移到标签上时小标和关闭的 × 都在、互不遮挡（先缩标题，地址块照样最窄 190，窄于 470 时 88）；
// 点小标在中间打开那篇配好对的笔记（开着就切过去，网页不跟着跳走），一个网页配了几篇时弹菜单选；点标签本身照样换网页、点 × 照样关。
// 本机假的在线书（fixtures/fake-book.ts），不上网。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { launch, openNote, rail, tabOn, widenRight } from './app'
import { fakeBook, type FakeBook } from './fixtures/fake-book'

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'
const NOTE2 = '课程/第二章的习题.md'
const TITLE2 = '第二章的习题'

let book: FakeBook
test.beforeAll(async () => {
  book = await fakeBook()
})
test.afterAll(() => book.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })
const centerTabs = (page: Page, title: string) => page.locator('.center .tabs .tab').filter({ hasText: new RegExp(`^${title}$`) })
const paired = (book: string, title: string) => `---\nread-along: ${book}/\n---\n# ${title}\n\n记一句。\n`

const guestUrl = (page: Page) =>
  page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<string> }).executeJavaScript('location.href'))

async function go(page: Page, u: string) {
  await addr(page).click()
  await addr(page).fill(u)
  await addr(page).press('Enter')
  await expect.poll(() => guestUrl(page)).toBe(u)
}

async function newTab(page: Page, u: string) {
  await web(page).getByRole('button', { name: '新网页' }).click()
  await go(page, u)
}

type Box = { x: number; y: number; w: number; h: number }
type Part = Box & { shown: boolean; hit: boolean }

/** 鼠标放在标签左边（名字 / 地址上），量小标、×、地址块：看得见没有、正中间点下去点到的是不是它 */
async function hoverMeasure(page: Page, tab: Locator) {
  const tb = (await tab.boundingBox())!
  await page.mouse.move(tb.x + 14, tb.y + tb.height / 2)
  await page.waitForTimeout(150)
  return tab.evaluate((el) => {
    const box = (e: Element): Box => {
      const r = e.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height }
    }
    const part = (e: Element | null): Part | null => {
      if (!e) return null
      const s = getComputedStyle(e)
      const b = box(e)
      const t = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2)
      return { ...b, shown: s.display !== 'none' && s.visibility === 'visible' && Number(s.opacity) > 0.9 && b.w > 0, hit: !!t && (t === e || e.contains(t)) }
    }
    const a = el.querySelector('.addr')
    return { tab: box(el), mark: part(el.querySelector('.wpm')), x: part(el.querySelector('.x')), addr: a ? box(a) : null }
  })
}

/** 网页栏第一行里相邻两样（按钮、每个网页标签、+、竖线……）之间空出多少，最大的那段在哪 */
const rowGaps = (page: Page) =>
  web(page)
    .getByTestId('web-row1')
    .evaluate((row) => {
      const els = [...row.querySelectorAll(':scope > :not(.wtabs), :scope > .wtabs > .wnew, :scope > .wtabs > .wtlist > .tab')]
        .map((e) => ({ e, r: e.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0)
        .sort((a, b) => a.r.x - b.r.x)
      let max = 0
      let at = ''
      for (let i = 1; i < els.length; i++) {
        const gap = els[i]!.r.x - (els[i - 1]!.r.x + els[i - 1]!.r.width)
        if (gap > max) (max = Math.round(gap)), (at = `${els[i - 1]!.e.className} → ${els[i]!.e.className}`)
      }
      return { max, at }
    })

const apart = (a: Box, b: Box) => a.x + a.w <= b.x + 0.5 || b.x + b.w <= a.x + 0.5
const inside = (a: Box, o: Box) => a.x >= o.x - 0.5 && a.x + a.w <= o.x + o.w + 0.5 && a.y >= o.y - 0.5 && a.y + a.h <= o.y + o.h + 0.5

/** 悬停时小标、× 都看得见、点得到，各自完整在标签里，两个的框不重叠 */
function expectBoth(m: Awaited<ReturnType<typeof hoverMeasure>>, what: string) {
  expect(m.mark, `${what}：有小标`).not.toBeNull()
  expect(m.mark!.shown, `${what}：小标看得见`).toBe(true)
  expect(m.mark!.hit, `${what}：小标点得到（没被盖住）`).toBe(true)
  expect(m.x!.shown, `${what}：× 看得见`).toBe(true)
  expect(m.x!.hit, `${what}：× 点得到`).toBe(true)
  expect(inside(m.mark!, m.tab), `${what}：小标整个在标签里`).toBe(true)
  expect(inside(m.x!, m.tab), `${what}：× 整个在标签里`).toBe(true)
  expect(apart(m.mark!, m.x!), `${what}：小标 ${JSON.stringify(m.mark)} 和 × ${JSON.stringify(m.x)} 重叠`).toBe(true)
}

test('悬停网页标签：配对小标和 × 都在、不重叠；点小标中间打开那篇（开着就切过去），网页不跳走；点标签照样换、点 × 照样关；窄网页栏也一样', async () => {
  test.setTimeout(150_000)
  const run = await launch({ [NOTE]: paired(book.base, TITLE), 'x.md': '# x\n\n随手记。\n' })
  const { page } = run
  try {
    await openNote(page, 'x')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const A = `${book.base}/chapter_preliminaries/ndarray.html`
    const B = `${book.base}/chapter_preliminaries/pandas.html`
    await go(page, A)
    await newTab(page, B)
    // 右栏拉宽到 470 以上：别的标签带名字
    await widenRight(page, 240)
    await expect(web(page)).not.toHaveClass(/w-narrow/)
    await expect(webTabs(page)).toHaveCount(2)
    const cur = webTabs(page).nth(1)
    const other = webTabs(page).nth(0)
    await expect(cur).toHaveAttribute('aria-selected', 'true')

    // 当前那个（地址块）：悬停时小标和 × 都在，地址块照样最窄 190
    const mc = await hoverMeasure(page, cur)
    expectBoth(mc, '宽 · 当前标签')
    expect(mc.addr!.w).toBeGreaterThanOrEqual(190 - 0.5)
    // 地址块吃掉这一行的空位：+ 跟在标签后面，行里相邻两样之间不空出 8 以上
    const wide = await rowGaps(page)
    expect(wide.max, `宽栏这一行空出最大的一段：${JSON.stringify(wide)}`).toBeLessThanOrEqual(8)

    // 两个标签上都有小标，提示写清是哪篇
    const tip = `打开配对的笔记《${TITLE}》`
    await expect(cur.locator('.wpm')).toHaveAttribute('data-tip', tip)
    await expect(other.locator('.wpm')).toHaveAttribute('data-tip', tip)
    await expect(cur.getByRole('button', { name: tip })).toHaveCount(1)
    // 点小标：中间打开那篇；网页还在这一页（不跟着跳到读到哪）
    await cur.getByRole('button', { name: tip }).click()
    await expect(tabOn(page)).toHaveText(TITLE)
    await expect(webTabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    expect(await guestUrl(page)).toBe(B)

    // 中间换回 x，再点别的那个标签上的小标：已经开着的那篇切过去（不另开一个），这个网页标签换到前面
    await centerTabs(page, 'x').click()
    await expect(tabOn(page)).toHaveText('x')
    const mo = await hoverMeasure(page, other)
    expectBoth(mo, '宽 · 别的标签')
    await other.getByRole('button', { name: tip }).click()
    await expect(tabOn(page)).toHaveText(TITLE)
    await expect(centerTabs(page, TITLE)).toHaveCount(1)
    await expect(webTabs(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => guestUrl(page)).toBe(A)

    // 点标签本身照样换网页（点名字那里）
    await webTabs(page).nth(1).locator('.tl').click()
    await expect(webTabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => guestUrl(page)).toBe(B)

    // 窄网页栏（右栏拉回 380 上下，470 以下别的标签只剩图标）：当前标签小标和 × 照样都在，地址块最窄 88；别的标签图标 + 小标，小标点得到
    await widenRight(page, -240)
    await expect(web(page)).toHaveClass(/w-narrow/)
    expect(Math.round((await web(page).boundingBox())!.width)).toBeLessThanOrEqual(400)
    // 两个带小标的标签在 380 宽时不用横着滚：第一个标签的图标不被切掉半个
    const list = web(page).getByRole('tablist', { name: '网页标签' }).locator('.wtlist')
    expect(await list.evaluate((e) => ({ over: Math.max(0, e.scrollWidth - e.clientWidth), left: e.scrollLeft }))).toEqual({ over: 0, left: 0 })
    const nc = await hoverMeasure(page, webTabs(page).nth(1))
    expectBoth(nc, '窄 · 当前标签')
    expect(nc.addr!.w).toBeGreaterThanOrEqual(88 - 0.5)
    // 380 宽、两个带小标的标签：这一行本来就排满了（地址块在最窄 88），行里不空出 8 以上
    const row = await rowGaps(page)
    expect(row.max, `窄栏这一行空出最大的一段：${JSON.stringify(row)}`).toBeLessThanOrEqual(8)
    const no = await hoverMeasure(page, webTabs(page).nth(0))
    expect(no.mark!.shown && no.mark!.hit, '窄 · 别的标签：小标看得见、点得到').toBe(true)
    // 图标和小标不压着
    const icon = (await webTabs(page).nth(0).locator('.tl > :first-child').boundingBox())!
    expect(apart({ x: icon.x, y: icon.y, w: icon.width, h: icon.height }, no.mark!)).toBe(true)
    // 中间换回 x（右栏跟着换回 x 上次看的 2.1），点 2.1 的小标：中间开那篇，右栏留在点的 2.1 上，不被那篇上次看的 2.2 换走
    await centerTabs(page, 'x').click()
    await expect(webTabs(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await webTabs(page).nth(0).getByRole('button', { name: tip }).click()
    await expect(tabOn(page)).toHaveText(TITLE)
    await expect(webTabs(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await page.waitForTimeout(300)
    await expect(webTabs(page).nth(0)).toHaveAttribute('aria-selected', 'true')

    // × 照样关：悬停当前标签点 ×，剩一个
    await webTabs(page).nth(0).hover()
    await webTabs(page).nth(0).getByRole('button', { name: '关闭网页标签' }).click()
    await expect(webTabs(page)).toHaveCount(1)

    // 窄栏只剩一个标签：地址块吃掉空出来的地方，行里不空出 8 以上；悬停时标题那块（灰色域名 + 标题）至少 5 个 12px 的字宽
    const one = await hoverMeasure(page, webTabs(page).nth(0))
    expectBoth(one, '窄 · 只剩一个标签')
    const narrow = await rowGaps(page)
    expect(narrow.max, `窄栏一个标签这一行空出最大的一段：${JSON.stringify(narrow)}`).toBeLessThanOrEqual(8)
    expect(await webTabs(page).nth(0).locator('.adisp').evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThanOrEqual(60)
  } finally {
    await run.close()
  }
})

test('一个网页配了两篇：点小标弹菜单选哪篇，选了在中间打开那篇', async () => {
  test.setTimeout(90_000)
  const run = await launch({ [NOTE]: paired(book.base, TITLE), [NOTE2]: paired(book.base, TITLE2), 'x.md': '# x\n' })
  const { page } = run
  try {
    await armMenus(run)
    await openNote(page, 'x')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${book.base}/chapter_preliminaries/ndarray.html`)
    const mark = webTabs(page).first().locator('.wpm')
    await expect(mark).toHaveAttribute('data-tip', `打开配对的笔记：《${TITLE2}》《${TITLE}》`)
    await mark.click()
    const m = await openedMenu(run)
    // 按名字排（拼音）
    expect(menuLabels(m)).toEqual([`《${TITLE2}》`, `《${TITLE}》`])
    await pickMenu(run, `《${TITLE2}》`)
    await expect(tabOn(page)).toHaveText(TITLE2)
  } finally {
    await run.close()
  }
})
