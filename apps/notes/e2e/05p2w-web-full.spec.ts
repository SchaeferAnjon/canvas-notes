// 「收起中间栏」和「移到中间」整合成方向 A「网页占满」（task-05p2w，用户 2026-11-22：「可以 就用设计a」，偏好「网页占满一颗按钮」）：
// - 窗口右上角那颗只做「网页占满 ↔ 还原」，⌃⌘\、网页 ⋯ 里的「网页占满 / 还原」是同一个开关；文档标签条上不再有「收起中间栏」；
// - 占满时地址栏一直挂「记进《这篇》」小牌，带这次剪了几条；点开换一篇，或「这一阵剪进收件箱」；剪一段底栏「记进《X》」带「看一眼」；
// - 「移到中间」改名「在中间开成一页」（右边写「剪的进收件箱」），只在网页 ⋯ 里；那一页的 ⋯、标签右键「放回右栏」；
// - 混用的毛病：占满 → 在中间开成一页 → 放回右栏、在中间开成一页 → ⌃⌘\ → 放回右栏，中间那篇都看得见。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, editorText, launch, leftView, rail, tabOn, type Running } from './app'
import { armMenus, pickMenu } from './menu'
import { fakeBook, type FakeBook } from './fixtures/fake-book'

const NOTE = '阅读/杀死一只知更鸟.md'
const OTHER = '阅读/读书笔记.md'
const BODY = '# 杀死一只知更鸟\n\n读到第三章。\n'

let book: FakeBook
test.beforeAll(async () => {
  book = await fakeBook()
})
test.afterAll(() => book.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const toast = (page: Page) => page.getByTestId('toast')
const center = (page: Page) => page.locator('.win > main.center')
const tbWeb = (page: Page) => page.getByTestId('tb-web')
const chip = (page: Page) => page.getByTestId('full-chip')
const chipMenu = (page: Page) => page.getByRole('menu', { name: '记进哪篇' })
const chooser = (page: Page) => page.getByRole('dialog', { name: '记到哪篇' })
const RIGHT = '.right.web webview.on'
const MIDDLE = '.wpane:not([hidden]) webview'

const guest = <T = unknown>(page: Page, code: string, sel = RIGHT): Promise<T> =>
  page.evaluate(
    ([c, s]) => {
      const w = document.querySelector(s!) as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
      try {
        return w ? w.executeJavaScript(c!).catch(() => null) : null
      } catch {
        return null
      }
    },
    [code, sel],
  ) as Promise<T>

async function openTree(page: Page, path: string, title: string) {
  await leftView(page, '文件')
  const folder = tree(page).getByRole('treeitem').filter({ hasText: /^阅读/ }).first()
  const toggle = folder.getByRole('button', { name: '展开 阅读' })
  if (await toggle.count()) await toggle.click()
  await tree(page).locator(`[data-path="${path}"]`).click()
  await expect(tabOn(page)).toHaveText(title)
}

async function goBook(page: Page) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  await addr(page).click()
  await addr(page).fill(`${book.base}/chapter_preface/index.html`)
  await addr(page).press('Enter')
  await expect.poll(() => guest(page, 'location.href')).toBe(`${book.base}/chapter_preface/index.html`)
}

/** 网页上第 n 段（前言里的段落）的字 */
const para = (page: Page, n: number, sel = RIGHT) => guest<string>(page, `[...document.querySelectorAll('p')].filter((p) => p.textContent.trim().length > 20)[${n}].textContent.trim()`, sel)

/** 在网页上选一段，点黑色小条上的「剪藏」（真点：量小条在网页里的位置） */
async function clipFromPage(page: Page, text: string, sel = RIGHT) {
  await guest(page, `(() => { const p = [...document.querySelectorAll('p')].find((x) => x.textContent.includes(${JSON.stringify(text)})); p.scrollIntoView({ block: 'center' }); const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r) })()`, sel)
  const where = `(() => { const h = document.getElementById('cn-clip-host'); if (!h || h.style.display === 'none') return null; const b = h.shadowRoot.querySelector('button.clip').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 } })()`
  await expect.poll(() => guest(page, where, sel)).not.toBeNull()
  const at = (await guest<{ x: number; y: number }>(page, where, sel))!
  const wv = (await page.locator(sel).boundingBox())!
  await page.mouse.click(wv.x + at.x, wv.y + at.y)
}

/** 收件箱里有没有一张卡写着这段 */
const inInbox = (vault: string, text: string) => {
  const dir = join(vault, '收件箱')
  return existsSync(dir) && readdirSync(dir).some((f) => f.endsWith('.md') && readFileSync(join(dir, f), 'utf8').includes(text.slice(0, 12)))
}

/** 按 ⌃⌘\（焦点放在软件窗口上，不在网页里） */
async function pressFull(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.locator('.titlebar').focus().catch(() => undefined)
  await page.keyboard.press('Control+Meta+Backslash')
}

test('网页占满：右上角那颗、⌃⌘\\、网页 ⋯ 是同一个开关；地址栏「记进」小牌写记进哪篇和剪了几条，能换一篇、改剪进收件箱；看一眼还原、那段亮一下', async () => {
  test.setTimeout(180_000)
  const TEXT = `---\nread-along: ${book.base}/\n---\n${BODY}`
  const run: Running = await launch({ [NOTE]: TEXT, [OTHER]: '# 读书笔记\n\n杂记。\n' })
  const { page, vault } = run
  try {
    await openTree(page, NOTE, '杀死一只知更鸟')
    await goBook(page)
    // 文档标签条上不再有「收起中间栏」；右上角那颗写「网页占满」带键，没有小牌
    await expect(page.getByTestId('center-fold')).toHaveCount(0)
    await expect(tbWeb(page)).toHaveAccessibleName('网页占满')
    await expect(tbWeb(page)).toContainText('网页占满')
    await expect(tbWeb(page)).toContainText('⌃⌘\\')
    await expect(chip(page)).toHaveCount(0)
    const before = (await web(page).boundingBox())!.width
    const mid = (await center(page).boundingBox())!.width

    // 点右上角：网页占满（宽了中间那么多），那颗变「还原」，地址栏挂「记进《杀死一只知更鸟》」
    await tbWeb(page).click()
    await expect(center(page)).toHaveClass(/folded/)
    await expect.poll(async () => Math.round((await web(page).boundingBox())!.width)).toBeGreaterThan(before + mid - 20)
    await expect(tbWeb(page)).toHaveAccessibleName('还原')
    await expect(tbWeb(page)).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page)).toHaveText(/^记进 《杀死一只知更鸟》$/)
    await expect(page.getByTestId('full-chip-n')).toHaveCount(0)
    // 小牌：26 高、圆角 6、--acc-soft 底
    const look = await chip(page).evaluate((el) => {
      const cs = getComputedStyle(el)
      return { h: el.getBoundingClientRect().height, r: cs.borderRadius, font: cs.fontSize }
    })
    expect(look).toEqual({ h: 26, r: '6px', font: '12px' })

    // 剪一段：写进那篇（看不见也照写，不问记到哪篇），底栏「记进《杀死一只知更鸟》」带「看一眼」，小牌数 1
    const p0 = await para(page, 0)
    await clipFromPage(page, p0.slice(0, 16))
    await expect(toast(page)).toContainText('记进《杀死一只知更鸟》')
    await expect(toast(page).getByRole('button', { name: '看一眼' })).toBeVisible()
    await expect(chooser(page)).toHaveCount(0)
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 10_000 }).toContain(p0.slice(0, 16))
    await expect(page.getByTestId('full-chip-n')).toHaveText('1')

    // 点小牌：「网页上剪的、问的记进」· 这篇（打勾，配好对的）· 换一篇… ｜ 这一阵剪进收件箱
    await chip(page).click()
    const m = chipMenu(page)
    await expect(m).toBeVisible()
    await expect(m.locator('.cap')).toHaveText('网页上剪的、问的记进')
    await expect(m.getByRole('menuitemradio', { name: /杀死一只知更鸟/ })).toHaveAttribute('aria-checked', 'true')
    await expect(m.getByRole('menuitemradio', { name: /杀死一只知更鸟/ })).toContainText('配好对的')
    await expect(m.getByRole('menuitem', { name: '换一篇…' })).toBeVisible()
    await expect(m.getByRole('menuitemradio', { name: '这一阵剪进收件箱' })).toHaveAttribute('aria-checked', 'false')

    // 换一篇…：问记到哪篇，选《读书笔记》；小牌跟着变，再剪的进它，数 2
    await m.getByRole('menuitem', { name: '换一篇…' }).click()
    const dlg = chooser(page)
    await expect(dlg).toBeVisible()
    await dlg.getByRole('radio', { name: /选别的一篇/ }).click()
    await dlg.getByRole('textbox', { name: '找一篇' }).fill('读书')
    await dlg.getByRole('option', { name: /读书笔记/ }).click()
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(dlg).toHaveCount(0)
    await expect(chip(page)).toContainText('记进 《读书笔记》')
    const p1 = await para(page, 1)
    await clipFromPage(page, p1.slice(0, 16))
    await expect(toast(page)).toContainText('记进《读书笔记》')
    await expect.poll(() => readFileSync(join(vault, OTHER), 'utf8'), { timeout: 10_000 }).toContain(p1.slice(0, 16))
    expect(readFileSync(join(vault, NOTE), 'utf8')).not.toContain(p1.slice(0, 16))
    await expect(page.getByTestId('full-chip-n')).toHaveText('2')

    // 这一阵剪进收件箱：小牌写「剪进 收件箱」，再剪的成一张卡进收件箱，数 3
    await chip(page).click()
    await chipMenu(page).getByRole('menuitemradio', { name: '这一阵剪进收件箱' }).click()
    await expect(chipMenu(page)).toHaveCount(0)
    await expect(chip(page)).toContainText('剪进 收件箱')
    const p2 = await para(page, 2)
    await clipFromPage(page, p2.slice(0, 16))
    await expect(toast(page)).toContainText('剪成卡片，放进收件箱了')
    await expect.poll(() => inInbox(vault, p2), { timeout: 10_000 }).toBe(true)
    expect(readFileSync(join(vault, OTHER), 'utf8')).not.toContain(p2.slice(0, 16))
    await expect(page.getByTestId('full-chip-n')).toHaveText('3')

    // ⌃⌘\：还原，中间那篇回来，小牌没了；再按一次又占满（剪进收件箱、数都清掉了）
    await pressFull(page)
    await expect(center(page)).not.toHaveClass(/folded/)
    await expect(chip(page)).toHaveCount(0)
    await expect(tbWeb(page)).toHaveAccessibleName('网页占满')
    await expect.poll(() => editorText(page)).toContain(p0.slice(0, 16))
    await pressFull(page)
    await expect(center(page)).toHaveClass(/folded/)
    await expect(chip(page)).toContainText('记进 《读书笔记》')
    await expect(page.getByTestId('full-chip-n')).toHaveCount(0)

    // 网页 ⋯：浏览器一组是「还原 ⌃⌘\」「在中间开成一页 · 剪的进收件箱」，没有「网页拉到最宽」；点「还原」还原
    await web(page).getByRole('button', { name: '更多' }).click()
    const more = web(page).getByRole('menu', { name: '更多' })
    await expect(more.getByRole('menuitem', { name: /^还原/ })).toContainText('⌃⌘\\')
    await expect(more.getByRole('menuitem', { name: /在中间开成一页/ })).toContainText('剪的进收件箱')
    await expect(more.getByText('网页拉到最宽')).toHaveCount(0)
    await expect(more.getByText('网页移到中间')).toHaveCount(0)
    await more.getByRole('menuitem', { name: /^还原/ }).click()
    await expect(center(page)).not.toHaveClass(/folded/)
    await web(page).getByRole('button', { name: '更多' }).click()
    await web(page).getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: /^网页占满/ }).click()
    await expect(center(page)).toHaveClass(/folded/)

    // 剪一段，点底栏「看一眼」：还原，开着《读书笔记》，刚剪的那段亮一下（左边一道竖线）
    const p3 = await para(page, 3)
    await clipFromPage(page, p3.slice(0, 16))
    await expect(toast(page)).toContainText('记进《读书笔记》')
    await toast(page).getByRole('button', { name: '看一眼' }).click()
    await expect(center(page)).not.toHaveClass(/folded/)
    await expect(tabOn(page)).toHaveText('读书笔记')
    await expect.poll(() => editorText(page)).toContain(p3.slice(0, 16))
    await expect(page.locator('main.center .cm-flashbar:not([hidden])')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('没配对的网页占满：剪的照样记进中间那篇（不问记到哪篇），小牌写着它', async () => {
  test.setTimeout(120_000)
  const run = await launch({ 'a.md': '# 甲\n\n正文。\n' })
  const { page, vault } = run
  try {
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).click()
    await tree(page).locator('[data-path="a.md"]').click()
    await expect(tabOn(page)).toHaveText('a')
    await goBook(page)
    await tbWeb(page).click()
    await expect(center(page)).toHaveClass(/folded/)
    await expect(chip(page)).toHaveText(/^记进 《a》$/)
    const p0 = await para(page, 0)
    await clipFromPage(page, p0.slice(0, 16))
    await expect(toast(page)).toContainText('记进《a》')
    await expect(chooser(page)).toHaveCount(0)
    await expect.poll(() => readFileSync(join(vault, 'a.md'), 'utf8'), { timeout: 10_000 }).toContain(p0.slice(0, 16))
    await expect(page.getByTestId('full-chip-n')).toHaveText('1')
  } finally {
    await run.close()
  }
})

test('混用一：占满 → 网页 ⋯ 在中间开成一页（剪的进收件箱，右上角那颗不出）→ 这一页 ⋯ 放回右栏：中间那篇看得见', async () => {
  test.setTimeout(120_000)
  const TEXT = `---\nread-along: ${book.base}/\n---\n${BODY}`
  const run = await launch({ [NOTE]: TEXT })
  const { page, vault } = run
  try {
    await openTree(page, NOTE, '杀死一只知更鸟')
    await goBook(page)
    await tbWeb(page).click()
    await expect(center(page)).toHaveClass(/folded/)

    await web(page).getByRole('button', { name: '更多' }).click()
    await web(page).getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: /在中间开成一页/ }).click()
    // 网页开成中间的一页：中间看得见（不再收着），右上角那颗不出
    await expect(page.locator(MIDDLE)).toBeVisible()
    await expect(center(page)).not.toHaveClass(/folded/)
    await expect(tbWeb(page)).toHaveCount(0)
    await expect(chip(page)).toHaveCount(0)
    // 在这一页上剪的进收件箱（这篇配好对也不进它）
    await expect.poll(() => guest(page, 'document.readyState', MIDDLE)).toBe('complete')
    const p0 = await para(page, 0, MIDDLE)
    await clipFromPage(page, p0.slice(0, 16), MIDDLE)
    await expect(toast(page)).toContainText('剪成卡片，放进收件箱了')
    await expect.poll(() => inInbox(vault, p0), { timeout: 10_000 }).toBe(true)
    expect(readFileSync(join(vault, NOTE), 'utf8')).not.toContain(p0.slice(0, 16))

    // 这一页标签条右端 ⋯ › 放回右栏：网页回右栏，中间那篇看得见，右上角那颗回来写「网页占满」
    await acts(page).getByRole('button', { name: '更多' }).click()
    await page.getByRole('dialog', { name: '这一页' }).getByRole('menuitem', { name: /放回右栏/ }).click()
    await expect(page.locator(MIDDLE)).toHaveCount(0)
    await expect(web(page)).toBeVisible()
    await expect(center(page)).not.toHaveClass(/folded/)
    await expect(tabOn(page)).toHaveText('杀死一只知更鸟')
    await expect(page.locator('main.center .cm-content')).toBeVisible()
    await expect(tbWeb(page)).toHaveAccessibleName('网页占满')
  } finally {
    await run.close()
  }
})

test('混用二：网页 ⋯ 在中间开成一页 → 按 ⌃⌘\\（什么都不记）→ 标签右键放回右栏：中间那篇看得见', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [NOTE]: BODY })
  const { page } = run
  const dirs = [dirname(run.vault)]
  try {
    await armMenus(run)
    await openTree(page, NOTE, '杀死一只知更鸟')
    await goBook(page)
    await web(page).getByRole('button', { name: '更多' }).click()
    await web(page).getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: /在中间开成一页/ }).click()
    await expect(page.locator(MIDDLE)).toBeVisible()
    await pressFull(page)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('cn.centerFold'))).toBe('0')
    await expect(center(page)).not.toHaveClass(/folded/)

    await page.locator('.center .tabs .tab.on').click({ button: 'right' })
    await pickMenu(run, '放回右栏')
    await expect(page.locator(MIDDLE)).toHaveCount(0)
    await expect(web(page)).toBeVisible()
    await expect(center(page)).not.toHaveClass(/folded/)
    await expect(tabOn(page)).toHaveText('杀死一只知更鸟')
    await expect(page.locator('main.center .cm-content')).toBeVisible()
    await expect(tbWeb(page)).toHaveAccessibleName('网页占满')
  } finally {
    await run.close({ keep: true })
    for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})
