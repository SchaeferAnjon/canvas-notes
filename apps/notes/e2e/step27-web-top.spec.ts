// 网页栏顶上（task-sta8n，用户选方向 A「紧凑两档」，原型 /private/tmp/canvas-notes-webbar/proto.html#dir=a）：
// 标签和地址并成一行（当前标签就是地址块）、视频工具和时间轴并成一行；看视频时顶上 104、一键收成一行 70、普通网页 72；
// 组头右边 ⌃、⇧⌘\、点收起那一行的标题都能切，收起记在本机（重开软件还是收着）；收起时「记下这一刻」「框一块问」「N 个时刻」照常能用，
// 时间轴变成那一行底边的一根线，点了跳过去；书签栏默认不摆，⋯ › 书签里能开（⇧⌘B 也行）。网页栏 380 窄时两行都放得下。
// 视频站是本机假的（e2e/fixtures/fake-video.ts，当成 YouTube），AI 是假的（CN_AI_FAKE）。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { dirname, join } from 'node:path'
import { launch, openNote, pane, rail, type Running } from './app'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const folded = (page: Page) => web(page).getByTestId('web-top-folded')
const env = () => ({ CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_VIDEO_TEST_ORIGIN: base })
const NOTE = '看视频的笔记.md'

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function go(page: Page, url: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(url)
  await addr.press('Enter')
}

async function openVideo(page: Page) {
  await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  await go(page, `${base}/watch?v=${FAKE_VIDEO_ID}`)
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
  await expect(strip(page).getByRole('button', { name: '字幕', exact: true })).toContainText('英→中', { timeout: 15_000 })
}

/** 顶上多高：网页那一组的组头上沿到网页（webview）上沿 */
function topHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const tab = document.querySelector('[data-testid="dtab-web"]')!
    const head = tab.closest('.dhead')!.getBoundingClientRect()
    const wv = document.querySelector('.right.web webview.on')!.getBoundingClientRect()
    return Math.round(wv.top - head.top)
  })
}

async function expectTop(page: Page, h: number) {
  await expect.poll(() => topHeight(page)).toBeGreaterThanOrEqual(h - 2)
  expect(Math.abs((await topHeight(page)) - h)).toBeLessThanOrEqual(2)
}

/** 几个元素都在网页栏里面（不出界）、互相不重叠 */
async function fitsInPanel(page: Page, items: Locator) {
  const panel = (await web(page).boundingBox())!
  const boxes = (await items.evaluateAll((els) => els.filter((e) => (e as HTMLElement).offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, n: e.getAttribute('aria-label') || e.textContent?.trim().slice(0, 12) || e.className } })))
  expect(boxes.length).toBeGreaterThan(0)
  for (const b of boxes) {
    expect(b.x, `${b.n} 左边出界`).toBeGreaterThanOrEqual(panel.x - 0.5)
    expect(b.x + b.w, `${b.n} 右边出界`).toBeLessThanOrEqual(panel.x + panel.width + 0.5)
  }
  const sorted = [...boxes].sort((a, b) => a.x - b.x)
  for (let i = 1; i < sorted.length; i++) expect(sorted[i]!.x, `${sorted[i]!.n} 压在 ${sorted[i - 1]!.n} 上`).toBeGreaterThanOrEqual(sorted[i - 1]!.x + sorted[i - 1]!.w - 0.5)
}

const curTime = async (page: Page) => Number(await guest(page, 'document.querySelector("video").currentTime'))

test('顶上两档：视频页展开 104、收起 70，普通网页 72；⌃、⇧⌘\\、点那一行的标题都能切；重开软件还是收着', async () => {
  test.setTimeout(180_000)
  let run: Running = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, env())
  const keep = [dirname(run.vault)]
  try {
    let page = run.page
    await openNote(page, '看视频的笔记')
    await openVideo(page)
    await expectTop(page, 104)
    // 标签和地址一行：网址框就是当前那个网页标签，和「新网页」在同一行；视频工具、时间轴在第二行
    const row1 = web(page).getByTestId('web-row1')
    const tabs = web(page).getByRole('tablist', { name: '网页标签' })
    await expect(tabs.getByRole('tab', { selected: true }).getByRole('textbox', { name: '网址' })).toBeVisible()
    const r1 = (await row1.boundingBox())!
    expect(Math.round(r1.height)).toBe(34)
    // 网页栏窄于 470 时整页剪藏的引号收进「⋯」（2026-11-25 剪藏去处：地址栏挂了去处小牌，排不下），这一行不再有它
    await expect(row1.getByRole('button', { name: '剪藏这一页', exact: true })).toHaveCount(0)
    for (const name of ['后退', '新网页', '更多']) {
      const b = (await row1.getByRole('button', { name, exact: true }).boundingBox())!
      expect(Math.abs(b.y + b.height / 2 - (r1.y + r1.height / 2))).toBeLessThan(2)
    }
    const r2 = (await strip(page).boundingBox())!
    expect(Math.round(r2.height)).toBe(32)
    await expect(strip(page).getByTestId('vtrack')).toBeVisible()
    for (const name of ['字幕', '记下这一刻', '框一块问']) await expect(strip(page).getByRole('button', { name, exact: true })).toBeVisible()
    // 书签栏默认不摆
    await expect(web(page).getByRole('toolbar', { name: '书签栏' })).toHaveCount(0)

    // 组头右边的 ⌃：收成一行
    const fold = page.getByTestId('web-fold')
    await expect(fold).toHaveAccessibleName('收起顶上')
    await fold.click()
    await expectTop(page, 70)
    await expect(fold).toHaveAccessibleName('展开顶上')
    await expect(strip(page)).toHaveCount(0)
    await expect(folded(page).getByRole('button', { name: '记下这一刻' })).toBeVisible()
    await expect(folded(page).getByRole('button', { name: '框一块问' })).toBeVisible()
    await expect(folded(page).getByTestId('web-fold-title')).toContainText('Linear transformations and matrices')
    // 点那一行的标题：展开
    await folded(page).getByTestId('web-fold-title').click()
    await expectTop(page, 104)
    // ⇧⌘\（焦点在文档里也行）：收起、再按展开
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Shift+Meta+Backslash')
    await expectTop(page, 70)
    await page.keyboard.press('Shift+Meta+Backslash')
    await expectTop(page, 104)
    // 焦点在网页里按 ⇧⌘\ 也一样（主进程转过来），不会收起左栏
    const leftOpen = await page.locator('.win').evaluate((w) => !w.classList.contains('side-hidden'))
    await web(page).locator('webview.on').click({ position: { x: 40, y: 260 } })
    await page.keyboard.press('Shift+Meta+Backslash')
    await expectTop(page, 70)
    expect(await page.locator('.win').evaluate((w) => !w.classList.contains('side-hidden'))).toBe(leftOpen)
    await page.keyboard.press('Shift+Meta+Backslash')
    await expectTop(page, 104)
    // 收起时在网页里按 ⌘L：展开、光标进地址
    await fold.click()
    await expectTop(page, 70)
    await web(page).locator('webview.on').click({ position: { x: 40, y: 260 } })
    await page.keyboard.press('Meta+l')
    await expect(web(page).getByRole('textbox', { name: '网址' })).toBeFocused()
    await expectTop(page, 104)
    await page.keyboard.press('Escape')

    // 普通网页：只有一行，72
    await go(page, `${base}/nothing`)
    await expect(strip(page)).toHaveCount(0)
    await expectTop(page, 72)
    // 收起：70，重开软件还是收着
    await fold.click()
    await expectTop(page, 70)
    const userData = run.userData
    await run.close({ keep: true })
    run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { ...env(), CN_USER_DATA: userData })
    keep.push(dirname(run.vault))
    page = run.page
    await page.waitForTimeout(500)
    if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await expect(page.locator('.right.web webview.on')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId('web-fold')).toHaveAccessibleName('展开顶上')
    await expectTop(page, 70)
  } finally {
    await run.close({ keep: true })
    for (const d of keep) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('视频那一行：记下这一刻、框一块问照常；点时间轴跳过去；收起时那一行的两颗图标、⌥S、⌥D、底边那根线照样能用', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, env())
  const { page, vault } = run
  const moments = () => (readFileSync(join(vault, NOTE), 'utf8').match(/<!-- moment /g) ?? []).length
  try {
    // 剪藏去处规则（2026-11-25 用户定）：记下这一刻照这个网站的去处走，中间开着的那篇不算；先把视频站记进这篇（同「记到这篇」）
    await page.evaluate(([o, p]) => localStorage.setItem('cn.webTarget', JSON.stringify({ [o!]: p })), [base, NOTE])
    await openNote(page, '看视频的笔记')
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('End')
    await openVideo(page)
    // 展开时：记下这一刻
    await strip(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect(page.locator('.vtoast')).toContainText('记进了《看视频的笔记》')
    await expect.poll(moments).toBe(1)
    await expect(strip(page).getByRole('button', { name: /个时刻/ })).toContainText('1')
    // 框一块问：画面变成拖框
    await strip(page).getByRole('button', { name: '框一块问' }).click()
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(false)
    // 时间轴：点在四分之三处，视频跳到 18 秒左右（24 秒的视频）
    const track = strip(page).getByTestId('vtrack')
    const tb = (await track.boundingBox())!
    await page.mouse.click(tb.x + tb.width * 0.75, tb.y + tb.height / 2)
    await expect.poll(() => curTime(page)).toBeGreaterThan(16.5)
    expect(await curTime(page)).toBeLessThan(19.5)

    // 收起：那一行的两颗图标照样能用
    await page.getByTestId('web-fold').click()
    await expectTop(page, 70)
    await guest(page, `document.querySelector('video').pause()`)
    await folded(page).getByRole('button', { name: '记下这一刻' }).click()
    await expect.poll(moments).toBe(2)
    await expect(folded(page).getByRole('button', { name: /个时刻/ })).toContainText('2')
    await folded(page).getByRole('button', { name: '框一块问' }).click()
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    await page.keyboard.press('Escape')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(false)
    // ⌥S、⌥D 收起时照样能按
    await pane(page).getByText('我先写的一句。').click()
    await page.keyboard.press('Alt+KeyS')
    await expect.poll(moments).toBe(3)
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    await page.keyboard.press('Escape')
    // 底边那根线：点在四分之一处跳到 6 秒左右
    const hair = folded(page).getByTestId('vhair')
    const hb = (await hair.boundingBox())!
    await page.mouse.click(hb.x + hb.width * 0.25, hb.y + hb.height - 2)
    await expect.poll(() => curTime(page)).toBeLessThan(7.5)
    expect(await curTime(page)).toBeGreaterThan(4.5)
    // 「N 个时刻 ▾」：弹出时刻
    await folded(page).getByRole('button', { name: /个时刻/ }).click()
    await expect(web(page).getByRole('dialog', { name: '时刻' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('书签栏默认不摆：⋯ › 书签里列着书签栏的书签，「显示书签栏」开了多一行（⇧⌘B 也行），记在本机', async () => {
  const run = await launch({ 'a.md': '# a\n' }, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(join(ud, 'web'), { recursive: true })
    const bm = (id: string, title: string, folder = '书签栏') => ({ id, title, url: `${base}/${encodeURIComponent(title)}`, folder, addedMs: Date.now() - 86400_000 })
    writeFileSync(join(ud, 'web', 'bookmarks.json'), JSON.stringify([bm('b1', '黑沙滩'), bm('b2', '黄金瀑布'), bm('b3', '蓝湖', '书签栏 / 行程')]))
  })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${base}/nothing`)
    await expect(web(page).getByRole('toolbar', { name: '书签栏' })).toHaveCount(0)
    await expectTop(page, 72)
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    const more = web(page).getByRole('menu', { name: '更多', exact: true })
    const group = more.getByRole('group', { name: '书签' })
    await expect(group.getByRole('menuitem', { name: '黑沙滩' })).toBeVisible()
    await expect(group.getByRole('menuitem', { name: '黄金瀑布' })).toBeVisible()
    const toggle = group.getByRole('menuitemcheckbox', { name: /显示书签栏/ })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(toggle).toContainText('⇧⌘B')
    // 点一个书签：当前标签打开它
    await group.getByRole('menuitem', { name: '黑沙滩' }).click()
    await expect.poll(() => guest(page, 'decodeURIComponent(location.pathname)')).toBe('/黑沙滩')
    // 开书签栏：多一行 28
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    await more.getByRole('group', { name: '书签' }).getByRole('menuitemcheckbox', { name: /显示书签栏/ }).click()
    const bar = web(page).getByRole('toolbar', { name: '书签栏' })
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('黄金瀑布')
    await expectTop(page, 100)
    // ⇧⌘B 收起
    await page.locator('main.center').click({ position: { x: 200, y: 200 } })
    await page.keyboard.press('Shift+Meta+KeyB')
    await expect(bar).toHaveCount(0)
    await expectTop(page, 72)
  } finally {
    await run.close()
  }
})

for (const skin of ['sky', 'petrol'] as const)
  test(`网页栏 380 窄（${skin === 'sky' ? '天青' : '深湖'}）：两行、收起那一行都放得下，不出界、不重叠；标签只剩图标`, async () => {
    const run = await launch({ [NOTE]: '# 看视频的笔记\n\n' }, env(), (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b' } }))
    })
    const { page } = run
    try {
      await openNote(page, '看视频的笔记')
      await openVideo(page)
      // 再开两个网页标签，回到视频
      await web(page).getByRole('button', { name: '新网页' }).click()
      await go(page, `${base}/nothing`)
      await web(page).getByRole('button', { name: '新网页' }).click()
      await go(page, `${base}/other`)
      await web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab').first().click()
      await expect(strip(page)).toBeVisible({ timeout: 15_000 })
      const w = (await web(page).boundingBox())!.width
      expect(Math.round(w)).toBeLessThanOrEqual(382)
      await fitsInPanel(page, web(page).getByTestId('web-row1').locator(':scope > *'))
      await fitsInPanel(page, strip(page).locator(':scope > *'))
      // 窄了：别的标签只剩图标，视频那一行只留图标
      const other = web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab', { selected: false }).first()
      expect(Math.round((await other.boundingBox())!.width)).toBeLessThanOrEqual(32)
      // 三个标签在 380 宽时不用横着滚：第一个标签的图标不被切掉半个
      const list = web(page).getByRole('tablist', { name: '网页标签' }).locator('.wtlist')
      expect(await list.evaluate((e) => ({ over: Math.max(0, e.scrollWidth - e.clientWidth), left: e.scrollLeft }))).toEqual({ over: 0, left: 0 })
      await expect(strip(page).getByRole('button', { name: '记下这一刻' }).locator('.lbl')).toBeHidden()
      await expect(strip(page).getByRole('button', { name: '字幕', exact: true }).locator('.lbl')).toBeHidden()
      // 记到哪留一颗图标（默认 380 宽时也要能换记到哪）
      await expect(strip(page).getByRole('button', { name: /^记到 / })).toBeVisible()
      await page.getByTestId('web-fold').click()
      await expectTop(page, 70)
      await fitsInPanel(page, folded(page).locator(':scope > :not([data-testid="vhair"])'))
      await expect(folded(page).getByTestId('web-fold-title')).toContainText('+2 个标签')
    } finally {
      await run.close()
    }
  })
