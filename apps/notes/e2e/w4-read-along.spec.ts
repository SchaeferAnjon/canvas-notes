// 长期一起看的网页和笔记 · 方向 A「配成一对」（task-kbnc0，原型 /private/tmp/canvas-notes-webpair/proto.html#scene=a）：
// 笔记属性 read-along 记这本书；读到哪（那段字 + 滚动比例）记在库里 .canvas-notes/读到哪.json、跟着 Git 走；
// 点开配好对的笔记，网页跟着在右栏开、回到上次读到的那段、亮一下；翻到下一章记住新的章；网页改版了按比例停、说一句；
// 解除（对着看菜单、右键）底栏能撤回；右键「只打开笔记，网页不跟着开」。本机假的在线书（fixtures/fake-book.ts），不上网。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { armMenus, openedMenu, pickMenu, menuLabels } from './menu'
import { launch, leftView, pane, rail, tabOn, type Running } from './app'
import { BOOK, fakeBook, type FakeBook, TARGET, TARGET2, TARGET2_HEAD, TARGET_HEAD } from './fixtures/fake-book'

const NOTE = '课程/学习笔记：动手学深度学习.md'
const NOTE_TEXT = '# 学习笔记：动手学深度学习\n\n## 前言\n\n这本书每一节都是能跑的 Jupyter 记事本。\n\n## 2.1 数据操作\n\n张量 = n 维数组。\n'
const TITLE = '学习笔记：动手学深度学习'

let book: FakeBook
test.beforeAll(async () => {
  book = await fakeBook()
})
test.afterAll(() => book.close())
test.beforeEach(() => {
  book.changed = false
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const noteRow = (page: Page) => tree(page).locator(`[data-path="${NOTE}"]`)
const chip = (page: Page) => pane(page).getByRole('button', { name: /^对着看/ })
const toast = (page: Page) => page.getByTestId('toast')
const readPos = (vault: string): Record<string, { url: string; text: string; ratio: number; head?: string; book?: string }> => {
  try {
    return JSON.parse(readFileSync(join(vault, '.canvas-notes/读到哪.json'), 'utf8'))
  } catch {
    return {}
  }
}
const noteFile = (vault: string) => readFileSync(join(vault, NOTE), 'utf8')

/** 右栏前面那个网页里跑一句（拿网页的 DOM 看） */
const guest = <T = unknown>(page: Page, code: string): Promise<T> =>
  page.evaluate((c) => {
    const w = document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
    try {
      return w ? w.executeJavaScript(c).catch(() => null) : null
    } catch {
      return null
    }
  }, code) as Promise<T>

/** 那段字在网页里的位置：在不在看得见的地方（2.1 是正文区滚，前言、2.2 是整页滚），亮没亮 */
const where = (page: Page, text: string) =>
  guest<{ top: number; bottom: number; vh: number; scrolled: number; flash: boolean } | null>(
    page,
    `(() => { const el = [...document.querySelectorAll('p')].find((p) => p.textContent.includes(${JSON.stringify(text.slice(0, 20))})); if (!el) return null;
      const r = el.getBoundingClientRect(); const sc = document.querySelector('main.mdl-layout__content') || document.scrollingElement;
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, scrolled: Math.round(sc.scrollTop), flash: el.hasAttribute('data-cn-flash') } })()`,
  )

/** 那段在看得见的地方：在固定的头（64）下面、窗口底上面 */
async function expectInView(page: Page, text: string) {
  await expect
    .poll(async () => {
      const w = await where(page, text)
      return !!w && w.scrolled > 0 && w.top >= 60 && w.bottom <= w.vh
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

async function openTreeNote(page: Page) {
  await leftView(page, '文件')
  const folder = tree(page).getByRole('treeitem').filter({ hasText: /^课程/ }).first()
  const toggle = folder.getByRole('button', { name: '展开 课程' })
  if (await toggle.count()) await toggle.click()
  await noteRow(page).click()
  await expect(tabOn(page)).toHaveText(TITLE)
}

/** 右栏网页「⋯」里点一项 */
async function webMoreItem(page: Page, name: string | RegExp) {
  await web(page).getByRole('button', { name: '更多', exact: true }).click()
  await web(page).getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name }).click()
}

/** 配成一对：右栏网页「⋯」里「和中间这篇配成一对…」，问整本书还是只这一页（默认整本书） */
async function pairFromWeb(page: Page, whole = true) {
  await webMoreItem(page, '和中间这篇配成一对…')
  const pop = page.getByRole('dialog', { name: '和网页配成一对' })
  await expect(pop.getByRole('radio', { name: /^这本书：127\.0\.0\.1:\d+ 下的每一页/ })).toBeChecked()
  if (!whole) await pop.getByRole('radio', { name: /^只这一页：/ }).click()
  await pop.getByRole('button', { name: '配成一对', exact: true }).click()
  await expect(pop).toHaveCount(0)
}

/** 关掉软件、同一个库再开（launch 自己另建的临时库不用，CN_VAULT 指回原来的库）；userData 给了是同一台 Mac，没给是换一台 */
async function relaunch(run: Running, vault: string, userData?: string): Promise<Running> {
  await run.close({ keep: true })
  return launch({ 'x.md': '# x\n' }, { CN_VAULT: vault, ...(userData ? { CN_USER_DATA: userData } : {}) })
}

test('配成一对 → 网页滚到中间某段 → 关掉重开 → 点笔记，网页在右栏开、回到那段、亮一下；换一台 Mac（新的本机设置）也接着读；翻到下一章记住新的章', async () => {
  test.setTimeout(180_000)
  let run = await launch({ [NOTE]: NOTE_TEXT })
  const vault = run.vault
  const dirs = [dirname(run.vault)]
  try {
    let page = run.page
    await openTreeNote(page)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${book.base}/chapter_preliminaries/ndarray.html`)

    // 还没配：笔记标题下没有「对着看」，目录树这一行、网页标签上没有小标
    await expect(chip(page)).toHaveCount(0)
    await expect(noteRow(page).locator('.ft-pair')).toHaveCount(0)
    await pairFromWeb(page)
    // 属性写进文件开头：只多了这一段，别的一个字不变
    await expect.poll(() => noteFile(vault)).toBe(`---\nread-along: ${book.base}/\n---\n${NOTE_TEXT}`)
    await expect(toast(page)).toContainText('配成一对了：点开这篇，网页跟着开到读到的那段')
    await expect(toast(page).getByRole('button', { name: '撤回' })).toBeVisible()
    // 标题下「对着看 · 动手学深度学习 · 读到 …」，目录树这一行、网页标签各多一个小标
    await expect(chip(page)).toContainText('对着看')
    await expect(chip(page)).toContainText(BOOK)
    await expect(noteRow(page).locator('.ft-pair')).toBeVisible()
    await expect(noteRow(page).locator('.ft-pair')).toHaveAttribute('data-tip', `和网页「${BOOK}」配成一对：点开这篇，网页跟着在右栏开到上次读到的那段`)
    // 名字长也露在这一行右边（不掉到看不见的第二行），名字末尾省略
    const rowBox = (await noteRow(page).boundingBox())!
    const markBox = (await noteRow(page).locator('.ft-pair').boundingBox())!
    expect(markBox.y).toBeGreaterThanOrEqual(rowBox.y)
    expect(markBox.y + markBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height)
    expect(markBox.x + markBox.width).toBeLessThanOrEqual(rowBox.x + rowBox.width)
    await expect(webTabs(page).filter({ has: page.locator('.wpm') })).toHaveCount(1)
    await expect(webTabs(page).locator('.wpm')).toHaveAttribute('data-tip', `和「${TITLE}」是一对`)

    // 像人一样往下滚到 2.1.4 那段：标题下的「读到」跟着变，库里记下那段字
    await wheelTo(page, TARGET)
    await expect(chip(page)).toContainText(`读到 ${TARGET_HEAD}`, { timeout: 10_000 })
    await expect.poll(() => readPos(vault)[`${book.base}/`]?.text ?? '', { timeout: 10_000 }).toContain('和 Python 的列表一样')
    const saved = readPos(vault)[`${book.base}/`]!
    expect(saved.url).toBe(`${book.base}/chapter_preliminaries/ndarray.html`)
    expect(saved.head).toBe(TARGET_HEAD)
    expect(saved.book).toBe(BOOK)
    expect(saved.ratio).toBeGreaterThan(0.2)

    // 关掉软件，同一台 Mac 再开：网页标签还在。点目录树里这篇：网页回到那段、亮一下，底栏说回到了哪
    const userData = run.userData
    run = await relaunch(run, vault, userData)
    dirs.push(dirname(run.vault))
    page = run.page
    await openTreeNote(page)
    await expect(web(page)).toBeVisible()
    await expectInView(page, TARGET)
    await expect.poll(async () => (await where(page, TARGET))?.flash).toBe(true)
    await expect(toast(page)).toContainText(`网页跟着开了：回到上次读到的「${TARGET_HEAD}」那段`)
    // 亮 1.6 秒就收
    await expect.poll(async () => (await where(page, TARGET))?.flash, { timeout: 5000 }).toBe(false)

    // 换一台 Mac：同一个库，本机什么都没记（没有网页标签、右栏收着）。点这篇：网页在右栏开、回到那段
    run = await relaunch(run, vault)
    dirs.push(dirname(run.vault))
    page = run.page
    await expect(web(page)).toBeHidden()
    await openTreeNote(page)
    await expect(web(page)).toBeVisible()
    await expect.poll(() => guest(page, 'location.href')).toBe(`${book.base}/chapter_preliminaries/ndarray.html`)
    await expectInView(page, TARGET)

    // 翻到下一章（点网页里的链接），往下读：记住新的章
    const link = await guest<{ x: number; y: number } | null>(page, `(() => { const a = document.getElementById('next'); a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { x: r.left + 8, y: r.top + r.height / 2 } })()`)
    const wv = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.click(wv.x + link!.x, wv.y + link!.y)
    await expect.poll(() => guest(page, 'location.href')).toBe(`${book.base}/chapter_preliminaries/pandas.html`)
    await expect.poll(() => readPos(vault)[`${book.base}/`]?.url, { timeout: 10_000 }).toBe(`${book.base}/chapter_preliminaries/pandas.html`)
    await wheelTo(page, TARGET2)
    await expect(chip(page)).toContainText(`读到 ${TARGET2_HEAD}`, { timeout: 10_000 })
    await expect.poll(() => readPos(vault)[`${book.base}/`]?.text ?? '', { timeout: 10_000 }).toContain('对数值列')

    // 读到哪跟着 Git 走：下一次提交带上它（不单独提交）
    await page.evaluate(() => window.cn.commit())
    const files = execFileSync('git', ['-C', vault, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' })
    expect(files).toContain('.canvas-notes/读到哪.json')
  } finally {
    await run.close({ keep: true })
    for (const d of dirs) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('网页改版了：按上次的比例停在差不多的地方，网页顶上浮一句「上次那段找不到了」，点「就从这里读」以后从这里记', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [NOTE]: `---\nread-along: ${book.base}/\n---\n${NOTE_TEXT}` })
  const { page } = run
  try {
    await openTreeNote(page)
    // 配好对、还没读过：网页开在这本书的开头
    await expect(web(page)).toBeVisible()
    await expect.poll(() => guest(page, 'location.href')).toBe(`${book.base}/`)
    await go(page, `${book.base}/chapter_preliminaries/ndarray.html`)
    await wheelTo(page, TARGET)
    await expect.poll(() => readPos(run.vault)[`${book.base}/`]?.text ?? '', { timeout: 10_000 }).toContain('和 Python 的列表一样')
    const ratio = readPos(run.vault)[`${book.base}/`]!.ratio

    // 网站改了版：再点这篇，那段对不上了
    book.changed = true
    await go(page, `${book.base}/chapter_preliminaries/pandas.html`)
    await noteRow(page).click()
    const lost = web(page).getByRole('alert')
    await expect(lost).toContainText('上次那段找不到了：网页改过版。')
    await expect(lost).toContainText('按上次的位置停在了差不多的地方。上次那段是「和 Python 的列表一样，张量里的元素可…」')
    // 按比例停：正文区滚到了差不多同样的几成
    const now = await guest<number>(page, `(() => { const sc = document.querySelector('main.mdl-layout__content'); return sc.scrollTop / (sc.scrollHeight - sc.clientHeight) })()`)
    expect(Math.abs(now - ratio)).toBeLessThan(0.05)
    // 不往网页栏顶上加一排：浮在网页上面（网页那一块的高不变）
    await lost.getByRole('button', { name: '就从这里读' }).click()
    await expect(lost).toHaveCount(0)
    await expect(toast(page)).toContainText('好，以后从这里接着读')
    await expect.poll(() => readPos(run.vault)[`${book.base}/`]?.text ?? '').toContain('（改版后的说法）')
  } finally {
    await run.close()
  }
})

test('解除：「对着看」菜单、右键这一行，底栏能撤回；右键「只打开笔记，网页不跟着开」；⌘K 配对、改成只配这一页', async () => {
  test.setTimeout(150_000)
  const run = await launch({ [NOTE]: `---\nread-along: ${book.base}/\n---\n${NOTE_TEXT}`, '课程/别的笔记.md': '# 别的笔记\n' })
  const { page } = run
  try {
    await armMenus(run)
    await openTreeNote(page)
    await expect(web(page)).toBeVisible()
    // 「对着看」的菜单：在右栏打开（读到…）、从头读、改成只配这一页、解除配对
    await chip(page).click()
    const menu = page.getByRole('dialog', { name: '对着看' })
    await expect(menu.getByRole('menuitem')).toHaveText([/^在右栏打开/, /^从头读/, /^改成只配这一页/, /^解除配对/])
    await menu.getByRole('menuitem', { name: /^解除配对/ }).click()
    await expect.poll(() => noteFile(run.vault)).toBe(NOTE_TEXT)
    await expect(toast(page)).toContainText('不再一起开了：属性「对着看」删掉了')
    await expect(chip(page)).toHaveCount(0)
    await expect(noteRow(page).locator('.ft-pair')).toHaveCount(0)
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => noteFile(run.vault)).toBe(`---\nread-along: ${book.base}/\n---\n${NOTE_TEXT}`)
    await expect(toast(page)).toContainText('配对回来了')
    await expect(chip(page)).toBeVisible()

    // 右键目录树这一行：「只打开笔记，网页不跟着开」「解除和网页的配对」。先收起网页、换到别的一篇
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await expect(web(page)).toBeHidden()
    await tree(page).locator('[data-path="课程/别的笔记.md"]').click()
    await expect(tabOn(page)).toHaveText('别的笔记')
    await expect(web(page)).toBeHidden()
    await noteRow(page).click({ button: 'right' })
    const items = menuLabels(await openedMenu(run))
    expect(items).toContain('只打开笔记，网页不跟着开')
    expect(items).toContain('解除和网页的配对')
    expect(items).not.toContain('和右栏这个网页配成一对…')
    await pickMenu(run, '只打开笔记，网页不跟着开')
    await expect(tabOn(page)).toHaveText(TITLE)
    await page.waitForTimeout(800)
    await expect(web(page)).toBeHidden()
    await noteRow(page).click({ button: 'right' })
    await pickMenu(run, '解除和网页的配对')
    await expect.poll(() => noteFile(run.vault)).toBe(NOTE_TEXT)

    // ⌘K「和右栏这个网页配成一对…」：右栏开着这本书的一页时
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${book.base}/chapter_preliminaries/ndarray.html`)
    await page.locator('main.center').click({ position: { x: 200, y: 200 } })
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox').fill('配成一对')
    await pal.getByRole('option').filter({ hasText: '和右栏这个网页配成一对…' }).first().click()
    const pop = page.getByRole('dialog', { name: '和网页配成一对' })
    await pop.getByRole('radio', { name: /^只这一页：2\.1\. 数据操作/ }).click()
    await pop.getByRole('button', { name: '配成一对', exact: true }).click()
    await expect.poll(() => noteFile(run.vault)).toBe(`---\nread-along: ${book.base}/chapter_preliminaries/ndarray.html\n---\n${NOTE_TEXT}`)
    // 「对着看」菜单里这时是「改成整本书」
    await chip(page).click()
    await page.getByRole('dialog', { name: '对着看' }).getByRole('menuitem', { name: /^改成整本书/ }).click()
    await expect.poll(() => noteFile(run.vault)).toBe(`---\nread-along: ${book.base}/\n---\n${NOTE_TEXT}`)
    await expect(toast(page)).toContainText('改成整本书：换章也算')
  } finally {
    await run.close()
  }
})

test('第一次怎么建：同一个网站和这篇这周一起开了几次，标题下出一句「配成一对？」，× 掉不再提；点「配成一对」问整本书还是只这一页', async () => {
  test.setTimeout(120_000)
  const run = await launch({ [NOTE]: NOTE_TEXT, '课程/第二篇.md': '# 第二篇\n' })
  const { page } = run
  try {
    // 这周已经一起开过 3 次（本机记的，记在 cn.coopen）
    const day = 86_400_000
    await page.evaluate(
      ({ n, h, day }) => localStorage.setItem('cn.coopen', JSON.stringify({ [`${n}\n${h}`]: [Date.now() - 3 * day, Date.now() - 2 * day, Date.now() - day] })),
      { n: NOTE, h: '127.0.0.1', day },
    )
    await openTreeNote(page)
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(page, `${book.base}/chapter_preliminaries/ndarray.html`)
    const hint = pane(page).getByRole('note', { name: '配成一对？' })
    await expect(hint).toContainText(`网页「${BOOK}」这周和这篇一起开了 4 次。配成一对？以后点开这篇，它跟着开到上次读到的那段。`)
    await hint.getByRole('button', { name: '不用，不再提' }).click()
    await expect(hint).toHaveCount(0)
    await expect(toast(page)).toContainText('不再提这一对。想配时：右键这篇「和右栏这个网页配成一对…」')
    // 换到别篇再回来：不再提
    await tree(page).locator('[data-path="课程/第二篇.md"]').click()
    await noteRow(page).click()
    await page.waitForTimeout(500)
    await expect(hint).toHaveCount(0)

    // 第二篇也一起开过几次：点「配成一对」，问整本书还是只这一页，配好
    await page.evaluate(
      ({ n, h, day }) => {
        const m = JSON.parse(localStorage.getItem('cn.coopen') ?? '{}')
        m[`${n}\n${h}`] = [Date.now() - 2 * day, Date.now() - day, Date.now() - day / 2]
        localStorage.setItem('cn.coopen', JSON.stringify(m))
      },
      { n: '课程/第二篇.md', h: '127.0.0.1', day },
    )
    await tree(page).locator('[data-path="课程/第二篇.md"]').click()
    const hint2 = pane(page).getByRole('note', { name: '配成一对？' })
    await expect(hint2).toContainText('这周和这篇一起开了 4 次')
    await hint2.getByRole('button', { name: '配成一对' }).click()
    const pop = page.getByRole('dialog', { name: '和网页配成一对' })
    await expect(pop).toContainText('写进这篇的属性「对着看」，跟着 Git 走；读到哪也记在库里，换一台 Mac 打开接着读。')
    await pop.getByRole('button', { name: '配成一对', exact: true }).click()
    await expect.poll(() => readFileSync(join(run.vault, '课程/第二篇.md'), 'utf8')).toBe(`---\nread-along: ${book.base}/\n---\n# 第二篇\n`)
    await expect(hint2).toHaveCount(0)
  } finally {
    await run.close()
  }
})
