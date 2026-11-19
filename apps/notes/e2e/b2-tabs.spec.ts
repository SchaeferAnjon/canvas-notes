/**
 * 标签多了（0.4.2 施工）：方向 A「滚着走，两端有提示」：标签照原来的宽排、名字是全的（最宽 280，再长打省略号），
 * 放不下就横着滚，停在标签边上，当前标签整个露着（CN-112 当前标签名字完整、最左没有半个字）；
 * 放不下时右端才有「N ⌄」，列出开着的全部标签；直接修 CN-125：⌥⌘\ 开关右栏（网页有焦点时也行），⌘\ 照旧收左栏。
 * 真点、真滚、真按键，窗口不上屏。
 */
import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { launch, rail, tabOn } from './app'

const LONG = '一篇名字特别特别长的笔记用来看标签最宽到哪里再打省略号'
const NAMES = ['Lecture05 笔记', '我的疑惑', '视频里的疑惑', '读书笔记', '写作计划', '本周复盘', '冰岛旅游2', '未命名 3', '课程', '2026-W47', '趣说明朝276年（微信读书出品）', '冰岛行程', '周记']
const files = Object.fromEntries([...NAMES, LONG].map((n) => [`收件箱/${n}.md`, `# ${n}\n\n正文。\n`]))
const list = (page: Page) => page.getByTestId('tab-list')
/** 标签条里每个标签：名字、宽、相对标签条可见区的左右、缩没缩 */
const strip = (page: Page) =>
  list(page).evaluate((l) => {
    const r = l.getBoundingClientRect()
    return {
      width: Math.round(r.width),
      scroll: Math.round(l.scrollLeft),
      tabs: [...l.querySelectorAll<HTMLElement>(':scope > .tab')].map((t) => {
        const b = t.getBoundingClientRect()
        const nm = t.querySelector<HTMLElement>('.truncate')!
        return { name: t.textContent ?? '', on: t.classList.contains('on'), full: nm.scrollWidth <= nm.clientWidth, w: Math.round(b.width), left: Math.round(b.left - r.left), right: Math.round(r.right - b.right) }
      }),
    }
  })
/** 左端停在标签边上：有个标签开头离左沿正好 24（箭头和渐隐让出来），没有标签骑在 24 那条线上露半个（标签多了方向 A） */
const edgeOk = (s: Awaited<ReturnType<typeof strip>>) => s.tabs.some((t) => t.left === 24) && !s.tabs.some((t) => t.left < 23 && t.left + t.w > 25)
/** 等标签条滚停（点箭头、滚轮是平滑滚过去的） */
async function settle(page: Page): Promise<number> {
  let last = -1
  for (let i = 0; i < 40; i++) {
    const now = (await strip(page)).scroll
    if (now === last) return now
    last = now
    await page.waitForTimeout(120)
  }
  return last
}
async function open(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
}

test('标签多了：照原来的宽排、名字是全的，放不下才滚，两端淡出加箭头，点箭头、滚轮一次挪一整个标签停在边上；放不下才有「14 ⌄」，列出全部能选能关', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    // 只有首页一个标签：放得下，右端没有「1 ⌄」
    await expect(tabOn(page)).toBeVisible()
    await expect(page.getByTestId('tab-more')).toHaveCount(0)
    for (const n of NAMES) await open(page, n)
    // 首页 + 13 篇 = 14 个：谁都不缩，名字都是全的（「趣说明朝276年（微信读书出品）」也整个露着），没有缩过的标记
    await expect.poll(async () => (await strip(page)).tabs.length).toBe(14)
    let s = await strip(page)
    expect(s.tabs.every((t) => t.full)).toBe(true)
    expect(s.tabs.every((t) => t.w >= 96 && t.w <= 280)).toBe(true)
    expect(s.tabs.find((t) => t.name === '趣说明朝276年（微信读书出品）')!.w).toBeGreaterThan(200)
    await expect(list(page).locator('.tab[data-sq]')).toHaveCount(0)
    // 当前标签整个露着；左边还有：左端淡出加箭头，右边没有；左端停在标签开头，不露半个（设计复审第 4 条）
    const on = s.tabs.find((t) => t.on)!
    expect(on.left).toBeGreaterThanOrEqual(0)
    expect(on.right).toBeGreaterThanOrEqual(0)
    expect(edgeOk(s)).toBe(true)
    await expect(list(page)).toHaveClass(/\bmore-l\b/)
    await expect(list(page)).not.toHaveClass(/\bmore-r\b/)
    await expect(page.getByTestId('tab-edge-left')).toBeVisible()
    await expect(page.getByTestId('tab-edge-right')).toHaveCount(0)

    // 点左箭头：挪一整个标签，左边那个从渐隐后面整个露出来（停在标签边上，离左端 24）
    const before = s.scroll
    await page.getByTestId('tab-edge-left').click()
    await expect.poll(async () => (await strip(page)).scroll).toBeLessThan(before - 50)
    await expect.poll(async () => (await strip(page)).tabs.some((t) => t.left === 24)).toBe(true)
    await expect(page.getByTestId('tab-edge-right')).toBeVisible()
    await expect(list(page)).toHaveClass(/\bmore-r\b/)
    // 标签条没被别的样式挤窄（以前右边一出渐隐就窄 20、又被拉回当前标签）
    expect((await strip(page)).width).toBe(s.width)
    // 再往左两下
    await page.getByTestId('tab-edge-left').click()
    await settle(page)
    await page.getByTestId('tab-edge-left').click()
    const mid = await settle(page)
    expect(edgeOk(await strip(page))).toBe(true)
    // 滚轮往下一格：往右挪一整个标签，停在边上（右边那个整个露出来，离右端 24，或者到底）
    const box = (await list(page).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.wheel(0, 100)
    await expect.poll(async () => (await strip(page)).scroll).toBeGreaterThan(mid + 50)
    await settle(page)
    expect(edgeOk(await strip(page))).toBe(true)

    // 右端「14 ⌄」：列出全部，当前那个打勾；点一个就换过去，它整个露出来
    const more = page.getByTestId('tab-more')
    await expect(more).toHaveText('14')
    await more.click()
    const pop = page.getByRole('dialog', { name: '开着的标签' })
    await expect(pop.locator('.mh')).toHaveText('开着的14个标签')
    const rows = pop.getByRole('menuitemradio')
    await expect(rows).toHaveCount(14)
    await expect(rows.filter({ hasText: '周记' })).toHaveAttribute('aria-checked', 'true')
    await rows.filter({ hasText: '我的疑惑' }).click()
    await expect(pop).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('我的疑惑')
    s = await strip(page)
    expect(s.tabs.find((t) => t.on)!.left).toBeGreaterThanOrEqual(0)
    expect(s.scroll === 0 || edgeOk(s)).toBe(true)
    // 列表里点 ×：关掉那一个，列表还开着
    await more.click()
    await pop.getByRole('button', { name: '关闭「冰岛行程」' }).click()
    await expect(pop.locator('.mh')).toHaveText('开着的13个标签')
    await expect(list(page).locator('.tab', { hasText: '冰岛行程' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)

    // 收起左栏（⌘\）：标签条宽了，名字还是全的
    const w0 = s.width
    await page.keyboard.press('Meta+Backslash')
    await expect(page.locator('.win')).toHaveClass(/side-hidden/)
    await expect.poll(async () => (await strip(page)).width).toBeGreaterThan(w0)
    expect((await strip(page)).tabs.every((t) => t.full)).toBe(true)
    // 名字特别长的一篇：标签最宽 280，名字后面打省略号
    await open(page, LONG)
    s = await strip(page)
    const long = s.tabs.find((t) => t.on)!
    expect(long.w).toBe(280)
    expect(long.full).toBe(false)
    expect(long.left).toBeGreaterThanOrEqual(0)
    expect(long.right).toBeGreaterThanOrEqual(0)
    expect(await list(page).locator('.tab.on .truncate').evaluate((e) => getComputedStyle(e).textOverflow)).toBe('ellipsis')
    // 关到剩 4 个：放得下，不渐隐、没有箭头，右端的「N ⌄」也不画
    for (const n of [...NAMES.slice(2, 12), LONG]) if (n !== '冰岛行程') await list(page).locator('.tab', { hasText: n }).getByRole('button', { name: '关闭标签' }).click()
    await expect.poll(async () => (await strip(page)).tabs.length).toBe(4)
    await expect(list(page)).not.toHaveClass(/\bmore-l\b|\bmore-r\b/)
    await expect(page.getByTestId('tab-edge-left')).toHaveCount(0)
    await expect(more).toHaveCount(0)
  } finally {
    await run.close()
  }
})

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>冰岛的黑沙滩</title><body style="font:16px sans-serif;padding:20px"><h1>冰岛的黑沙滩</h1><p>玄武岩柱像管风琴一样排开。</p><input id="q" placeholder="搜"></body>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

test('CN-125：⌥⌘\\ 收起、再按开回原来那一格；焦点在右栏网页里也一样；⌘\\ 照旧收左栏', async () => {
  const run = await launch({ 'a.md': '# a\n\n正文。\n' })
  const { page } = run
  const win = page.locator('.win')
  try {
    // 历史开着：⌥⌘\ 收起，再按回到历史
    await rail(page).getByRole('button', { name: '历史' }).click()
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    await page.keyboard.press('Meta+Alt+Backslash')
    await expect(win).not.toHaveClass(/with-right/)
    await expect(page.getByRole('complementary', { name: '历史' })).toHaveCount(0)
    await page.keyboard.press('Meta+Alt+Backslash')
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    // ⌘\ 收左栏，右栏不动
    await page.keyboard.press('Meta+Backslash')
    await expect(win).toHaveClass(/side-hidden/)
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    await page.keyboard.press('Meta+Backslash')
    await expect(win).not.toHaveClass(/side-hidden/)

    // 右栏网页：点进网页正文（焦点在网页里），⌥⌘\ 照样收起；再按开回网页
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    const addr = web.getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/`)
    await addr.press('Enter')
    await expect(web.getByRole('tablist', { name: '网页标签' }).getByRole('tab').first()).toContainText('冰岛的黑沙滩')
    const box = (await web.locator('webview.on').boundingBox())!
    await page.mouse.click(box.x + 200, box.y + 160)
    await page.waitForTimeout(200)
    await page.keyboard.press('Meta+Alt+Backslash')
    await expect(win).not.toHaveClass(/with-right/)
    await page.keyboard.press('Meta+Alt+Backslash')
    await expect(web).toBeVisible()
    // 网页有焦点时 ⌘\ 也收左栏
    await page.mouse.click(box.x + 200, box.y + 160)
    await page.waitForTimeout(200)
    await page.keyboard.press('Meta+Backslash')
    await expect(win).toHaveClass(/side-hidden/)
  } finally {
    await run.close()
  }
})
