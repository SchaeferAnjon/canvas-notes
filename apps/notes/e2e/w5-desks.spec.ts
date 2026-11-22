// 长期一起看的网页和笔记 · 方向 B「存成书桌」（task-kbnc0，原型 /private/tmp/canvas-notes-webpair/proto.html#scene=b）：
// 一张书桌记下中间开着哪几篇、右栏哪几个网页、各读到哪、左栏和网页开没开；存在库里 .canvas-notes/书桌/<名字>.json、跟着 Git 走；
// 从左栏「书桌」或 ⌘K 一下恢复，底栏「回到刚才的样子」；开着时自动记下改动；改名、删（能撤回）、用现在的样子更新。
// 书桌里的网页是配好对的那本书时，读到哪用 读到哪.json 那一份（和方向 A 同一份）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, pane, rail, tabOn, type Running } from './app'
import { BOOK, fakeBook, type FakeBook, TARGET, TARGET_HEAD } from './fixtures/fake-book'

const A = '课程/学习笔记：动手学深度学习.md'
const B = '课程/小论文计划.md'
const A_TEXT = '# 学习笔记：动手学深度学习\n\n张量 = n 维数组。\n'
const B_TEXT = '# 小论文计划\n\n先读两本书。\n'

let book: FakeBook
let other: FakeBook
test.beforeAll(async () => {
  book = await fakeBook()
  other = await fakeBook()
})
test.afterAll(async () => {
  await book.close()
  await other.close()
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const toast = (page: Page) => page.getByTestId('toast')
const desks = (page: Page) => page.locator('aside.side[aria-label="书桌"]')
const card = (page: Page, name: string) => desks(page).getByRole('listitem').filter({ has: page.getByRole('button', { name: new RegExp(`^书桌「${name}」`) }) })
const deskPath = (vault: string, name: string) => join(vault, '.canvas-notes/书桌', `${name}.json`)
const readDesk = (vault: string, name: string) => JSON.parse(readFileSync(deskPath(vault, name), 'utf8'))
const readPos = (vault: string): Record<string, { head?: string }> => {
  try {
    return JSON.parse(readFileSync(join(vault, '.canvas-notes/读到哪.json'), 'utf8'))
  } catch {
    return {}
  }
}
const centerTabs = (page: Page) => page.getByTestId('tab-list').locator('.tab .tl .truncate')

const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>

const where = (page: Page, text: string) =>
  guest<{ top: number; bottom: number; vh: number; scrolled: number } | null>(
    page,
    `(() => { const el = [...document.querySelectorAll('p')].find((p) => p.textContent.includes(${JSON.stringify(text.slice(0, 20))})); if (!el) return null;
      const r = el.getBoundingClientRect(); const sc = document.querySelector('main.mdl-layout__content') || document.scrollingElement;
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, scrolled: Math.round(sc.scrollTop) } })()`,
  )

async function expectInView(page: Page, text: string) {
  await expect
    .poll(async () => {
      const w = await where(page, text)
      return !!w && w.scrolled > 0 && w.top >= 0 && w.bottom <= w.vh
    }, { timeout: 15_000 })
    .toBe(true)
}

/** 像人一样滚：指针放在网页上，滚轮一下一下往下滚，滚到那段压着读的那一行（网页高的 18% 处，软件按这一行认读到哪） */
async function wheelTo(page: Page, text: string) {
  const box = (await web(page).locator('webview.on').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 200; i++) {
    const w = await where(page, text)
    const line = w ? w.vh * 0.18 : 0
    if (w && w.top <= line - 4 && w.bottom >= line + 4) return page.waitForTimeout(600)
    await page.mouse.wheel(0, w && w.top < line ? -40 : 40)
    await page.waitForTimeout(40)
  }
  throw new Error(`滚不到「${text.slice(0, 12)}」`)
}

async function go(page: Page, u: string) {
  await addr(page).click()
  await addr(page).fill(u)
  await addr(page).press('Enter')
  await expect.poll(() => guest(page, 'location.href')).toBe(u)
}

async function openInTree(page: Page, path: string) {
  await leftView(page, '文件')
  const folder = tree(page).getByRole('treeitem').filter({ hasText: /^课程/ }).first()
  const toggle = folder.getByRole('button', { name: '展开 课程' })
  if (await toggle.count()) await toggle.click()
  await tree(page).locator(`[data-path="${path}"]`).click()
}

/** 关掉软件、同一个库再开（launch 自己另建的临时库不用，CN_VAULT 指回原来的库）；userData 给了是同一台 Mac，没给是换一台 */
async function relaunch(run: Running, vault: string, userData?: string): Promise<Running> {
  await run.close({ keep: true })
  return launch({ 'x.md': '# x\n' }, { CN_VAULT: vault, ...(userData ? { CN_USER_DATA: userData } : {}) })
}

async function palette(page: Page, q: string, row: string | RegExp) {
  await page.locator('main.center').click({ position: { x: 200, y: 300 } })
  await page.keyboard.press('Meta+k')
  const pal = page.getByRole('dialog', { name: '搜索和命令' })
  await pal.getByRole('textbox').fill(q)
  await pal.getByRole('option').filter({ hasText: row }).first().click()
}

test('存一张书桌 → 换一台 Mac 什么都没开 → 从左栏「书桌」恢复：篇、标签、各自读到哪都对；⌘K 也行；「回到刚才的样子」；文件在 .canvas-notes/书桌/、跟着 Git 走', async () => {
  test.setTimeout(240_000)
  let run = await launch({ [A]: `---\nread-along: ${book.base}/\n---\n${A_TEXT}`, [B]: B_TEXT })
  const vault = run.vault
  const dirs = [dirname(run.vault)]
  try {
    let page = run.page
    // 中间开两篇；右栏三个网页：配好对的书（读到 2.1.4）、另一个网站的两页
    await openInTree(page, B)
    await openInTree(page, A)
    await expect(web(page)).toBeVisible()
    await go(page, `${book.base}/chapter_preliminaries/ndarray.html`)
    await wheelTo(page, TARGET)
    await expect.poll(() => readPos(vault)[`${book.base}/`]?.head ?? '', { timeout: 10_000 }).toBe(TARGET_HEAD)
    await web(page).locator('button.wnew').click()
    await go(page, `${other.base}/chapter_preface/index.html`)
    await web(page).locator('button.wnew').click()
    await go(page, `${other.base}/`)
    // 回到书那个标签（存的时候它在前面）
    await webTabs(page).first().locator('.tl').click()
    await expect.poll(() => guest(page, 'location.href')).toBe(`${book.base}/chapter_preliminaries/ndarray.html`)

    // ⌘K「存成书桌…」：列出会记下什么，别的网页默认不勾
    await palette(page, '存成书桌', '存成书桌…')
    const dlg = page.getByRole('dialog', { name: '存成书桌' })
    await expect(dlg.getByRole('textbox', { name: '书桌的名字' })).toHaveValue(BOOK)
    await expect(dlg.getByRole('checkbox', { name: /学习笔记：动手学深度学习/ })).toBeChecked()
    await expect(dlg.getByRole('checkbox', { name: /小论文计划/ })).toBeChecked()
    const webChecks = dlg.getByRole('group', { name: '右栏的网页' }).getByRole('checkbox')
    await expect(webChecks).toHaveCount(3)
    await expect(webChecks.nth(0)).toBeChecked()
    await expect(webChecks.nth(0)).toContainText(`读到 ${TARGET_HEAD}`)
    await expect(webChecks.nth(1)).not.toBeChecked()
    await expect(webChecks.nth(2)).not.toBeChecked()
    await webChecks.nth(1).click()
    await expect(dlg.getByRole('switch', { name: /开着时自动记下改动/ })).toBeChecked()
    await expect(dlg).toContainText(`存在 .canvas-notes/书桌/${BOOK}.json，跟着 Git 走`)
    await dlg.getByRole('button', { name: '存成书桌', exact: true }).click()
    await expect(dlg).toHaveCount(0)
    await expect(toast(page)).toContainText(`存好了书桌「${BOOK}」：2 篇笔记、2 个网页`)

    // 文件：两篇、两个网页；书那个标签记的是「这本书」（读到哪用 读到哪.json 那一份），另一个网站的记自己读到哪
    const d = readDesk(vault, BOOK)
    expect(d.notes).toEqual([B, A])
    expect(d.active).toBe(A)
    expect(d.web.map((t: { url: string }) => t.url)).toEqual([`${book.base}/chapter_preliminaries/ndarray.html`, `${other.base}/chapter_preface/index.html`])
    expect(d.web[0].book).toBe(`${book.base}/`)
    expect(d.web[0].pos).toBeUndefined()
    expect(d.web[1].pos?.url).toBe(`${other.base}/chapter_preface/index.html`)
    expect(d.auto).toBe(true)
    // 左栏换到「书桌」：这张开着，改动自动记下
    await expect(card(page, BOOK)).toContainText('2 篇笔记 · 2 个网页')
    await expect(card(page, BOOK)).toContainText('开着 · 改动自动记下')

    // 换一台 Mac：同一个库，本机什么都没记
    run = await relaunch(run, vault)
    dirs.push(dirname(run.vault))
    page = run.page
    await expect(tabOn(page)).toHaveText('首页')
    await expect(web(page)).toBeHidden()
    await leftView(page, '书桌')
    await expect(card(page, BOOK)).toContainText('2 篇笔记 · 2 个网页')
    await expect(card(page, BOOK)).toContainText(/上次 /)
    await card(page, BOOK).click()
    await expect(centerTabs(page)).toHaveText(['小论文计划', '学习笔记：动手学深度学习'])
    await expect(tabOn(page)).toHaveText('学习笔记：动手学深度学习')
    await expect(web(page)).toBeVisible()
    await expect(webTabs(page)).toHaveCount(2)
    await expect.poll(() => guest(page, 'location.href')).toBe(`${book.base}/chapter_preliminaries/ndarray.html`)
    await expectInView(page, TARGET)
    await expect(toast(page)).toContainText(`打开了书桌「${BOOK}」：回到「${TARGET_HEAD}」那段`)
    // 回到刚才的样子：首页、右栏收着
    await toast(page).getByRole('button', { name: '回到刚才的样子' }).click()
    await expect(centerTabs(page)).toHaveText(['首页'])
    await expect(web(page)).toBeHidden()
    await expect(toast(page)).toContainText('回到了刚才的样子')

    // ⌘K 里「书桌」一组，打字搜名字也行
    await page.locator('main.center').click({ position: { x: 200, y: 300 } })
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await expect(pal.locator('.pal-sec[data-g="desks"] .pal-g')).toHaveText('书桌')
    await expect(pal.locator('.pal-sec[data-g="desks"] .pal-row')).toContainText([`书桌：${BOOK}`])
    await pal.getByRole('textbox').fill('动手学')
    await pal.getByRole('option').filter({ hasText: `书桌：${BOOK}` }).first().click()
    await expect(centerTabs(page)).toHaveText(['小论文计划', '学习笔记：动手学深度学习'])
    await expectInView(page, TARGET)

    // 跟着 Git 走：提交里有这张书桌
    await page.evaluate(() => window.cn.commit())
    const files = execFileSync('git', ['-C', vault, 'log', '--name-only', '--format='], { encoding: 'utf8' })
    expect(files).toContain(`.canvas-notes/书桌/${BOOK}.json`)
  } finally {
    await run.close({ keep: true })
    for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('开着时自动记下多开的标签；「⋯」里改名、用现在的样子更新、删掉（笔记和网页都不动，底栏能撤回）', async () => {
  test.setTimeout(180_000)
  const run = await launch({ [A]: A_TEXT, [B]: B_TEXT })
  const { page, vault } = run
  try {
    await openInTree(page, A)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${book.base}/chapter_preface/index.html`)
    // 左栏「书桌」的 +：存成书桌
    await leftView(page, '书桌')
    await expect(desks(page)).toContainText('书桌记下中间开着哪几篇、右栏哪几个网页、各自读到哪一段。点一张就回到那个样子，刚才的样子能撤回。')
    await desks(page).getByRole('button', { name: '把现在的样子存成书桌' }).click()
    const dlg = page.getByRole('dialog', { name: '存成书桌' })
    await dlg.getByRole('textbox', { name: '书桌的名字' }).fill('读书')
    await dlg.getByRole('button', { name: '存成书桌', exact: true }).click()
    await expect.poll(() => existsSync(deskPath(vault, '读书'))).toBe(true)
    expect(readDesk(vault, '读书').web).toHaveLength(1)

    // 开着：多开一个网页、一篇笔记，自动记下
    await web(page).locator('button.wnew').click()
    await go(page, `${other.base}/`)
    await openInTree(page, B)
    await expect.poll(() => readDesk(vault, '读书').web.length, { timeout: 10_000 }).toBe(2)
    await expect.poll(() => readDesk(vault, '读书').notes, { timeout: 10_000 }).toEqual([A, B])

    // 改名
    await leftView(page, '书桌')
    await card(page, '读书').hover()
    await card(page, '读书').getByRole('button', { name: '这张书桌的菜单' }).click()
    const menu = page.getByRole('dialog', { name: '书桌「读书」' })
    await expect(menu.getByRole('menuitem')).toHaveText([/^打开/, /^用现在的样子更新/, /^改名…/, /^删掉这张书桌/])
    await menu.getByRole('menuitem', { name: /^改名…/ }).click()
    const input = desks(page).getByRole('textbox', { name: '书桌的名字' })
    await input.fill('动手学深度学习')
    await input.press('Enter')
    await expect.poll(() => existsSync(deskPath(vault, '动手学深度学习'))).toBe(true)
    expect(existsSync(deskPath(vault, '读书'))).toBe(false)
    expect(readDesk(vault, '动手学深度学习').name).toBe('动手学深度学习')

    // 「用现在的样子更新」：照现在开着的写一遍
    await card(page, '动手学深度学习').hover()
    await card(page, '动手学深度学习').getByRole('button', { name: '这张书桌的菜单' }).click()
    await page.getByRole('dialog', { name: '书桌「动手学深度学习」' }).getByRole('menuitem', { name: /^用现在的样子更新/ }).click()
    await expect(toast(page)).toContainText('书桌「动手学深度学习」更新成现在的样子了')
    const before = readFileSync(deskPath(vault, '动手学深度学习'), 'utf8')
    expect(JSON.parse(before).web).toHaveLength(2)

    // 删掉：只删这张卡，笔记和网页都不动；撤回放回原样
    await card(page, '动手学深度学习').hover()
    await card(page, '动手学深度学习').getByRole('button', { name: '这张书桌的菜单' }).click()
    await page.getByRole('dialog', { name: '书桌「动手学深度学习」' }).getByRole('menuitem', { name: /^删掉这张书桌/ }).click()
    await expect.poll(() => existsSync(deskPath(vault, '动手学深度学习'))).toBe(false)
    await expect(toast(page)).toContainText('删掉了书桌「动手学深度学习」：笔记和网页都没动')
    await expect(webTabs(page)).toHaveCount(2)
    await expect(centerTabs(page)).toHaveText(['首页', '学习笔记：动手学深度学习', '小论文计划'])
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => (existsSync(deskPath(vault, '动手学深度学习')) ? readFileSync(deskPath(vault, '动手学深度学习'), 'utf8') : '')).toBe(before)
    await expect(toast(page)).toContainText('书桌回来了')
    await expect(card(page, '动手学深度学习')).toBeVisible()

    // 笔记改了名：书桌里记着的路径跟着换（和置顶一样）
    await page.evaluate(() => window.cn.renameNote('课程/小论文计划.md', '小论文计划二稿'))
    await expect.poll(() => readDesk(vault, '动手学深度学习').notes, { timeout: 10_000 }).toEqual([A, '课程/小论文计划二稿.md'])
  } finally {
    await run.close()
  }
})

test('第一次怎么建：这篇配好了一本书、又常和别的网站一起开，标题下出一句「存成一张书桌？」，× 掉不再提', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [A]: `---\nread-along: ${book.base}/\n---\n${A_TEXT}` })
  const { page } = run
  try {
    const day = 86_400_000
    await page.evaluate(
      ({ n, h, day }) => localStorage.setItem('cn.coopen', JSON.stringify({ [`${n}\n${h}`]: [Date.now() - 3 * day, Date.now() - 2 * day, Date.now() - day] })),
      { n: A, h: '127.0.0.1', day },
    )
    await openInTree(page, A)
    await expect(web(page)).toBeVisible()
    // 别的网站（端口不同就是别的网站）
    await web(page).locator('button.wnew').click()
    await go(page, `${other.base}/chapter_preface/index.html`)
    const hint = pane(page).getByRole('note', { name: '存成一张书桌？' })
    await expect(hint).toContainText(`这篇和网页「${BOOK}」这周一起开了 4 次。存成一张书桌？以后一下回到这一整套。`)
    await hint.getByRole('button', { name: '存成书桌…' }).click()
    await expect(page.getByRole('dialog', { name: '存成书桌' })).toBeVisible()
    await page.getByRole('dialog', { name: '存成书桌' }).getByRole('button', { name: '取消' }).click()
    await hint.getByRole('button', { name: '不用，不再提' }).click()
    await expect(hint).toHaveCount(0)
    await expect(toast(page)).toContainText(/^不再提。想存时：.+「存成书桌…」或左栏「书桌」的 \+/)
  } finally {
    await run.close()
  }
})
