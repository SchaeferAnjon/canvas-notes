// 网页标签上指着哪儿只出一个提示（task-4emge，用户原话「当我把鼠标滑上去会出现两个弹窗.」）：
// 指着配对小标只出「打开配对的笔记《…》」，指着标签别处只出网址，指着 × 只出「关闭网页标签」；来回移动换得干净，不留上一个。
// 原生 title 的提示 Playwright 看不见，按浏览器的规矩算：鼠标下那个元素往上最近的 title 就是会出的原生提示；自绘的看 [data-testid=tooltip]。
// 顺带把整个窗口扫一遍：自绘提示（data-tip）和原生 title 不能一个套在另一个里（套着就会同时出两个）。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { launch, openNote, rail, widenRight } from './app'
import { fakeBook, type FakeBook } from './fixtures/fake-book'

const NOTE = '课程/学习笔记：动手学深度学习.md'
const TITLE = '学习笔记：动手学深度学习'

let book: FakeBook
test.beforeAll(async () => {
  book = await fakeBook()
})
test.afterAll(() => book.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })

async function go(page: Page, u: string) {
  await addr(page).click()
  await addr(page).fill(u)
  await addr(page).press('Enter')
  await expect(
    webTabs(page)
      .filter({ has: page.locator('.wpm') })
      .last(),
  ).toBeVisible({ timeout: 15_000 })
  await addr(page).blur()
}

/** 鼠标移到 (x, y) 停 0.9 秒（自绘提示 0.4 秒出），列出这时会出的所有提示：原生 title 一条、自绘的各一条 */
async function tipsAt(page: Page, x: number, y: number) {
  await page.mouse.move(x, y, { steps: 4 })
  await page.waitForTimeout(900)
  return page.evaluate(
    ([x, y]) => {
      const hit = document.elementFromPoint(x!, y!)
      const native = hit?.closest('[title]')?.getAttribute('title')
      const drawn = [...document.querySelectorAll('[data-testid="tooltip"]')].map((e) => (e as HTMLElement).innerText.replace(/\n+/g, '\n').trim())
      return [...(native ? [`原生：${native}`] : []), ...drawn.map((t) => `自绘：${t}`)]
    },
    [x, y],
  )
}

/** 这会儿出着的自绘提示：分几行（各行的字）、键帽、字有没有出框（两行的提示框得跟着长高） */
const shownTip = (page: Page) =>
  page.getByTestId('tooltip').evaluate((el) => {
    const r = el.getBoundingClientRect()
    const out = [...el.querySelectorAll('.para, :scope > span, kbd')].some((c) => {
      const b = c.getBoundingClientRect()
      return b.top < r.top - 0.5 || b.bottom > r.bottom + 0.5 || b.left < r.left - 0.5 || b.right > r.right + 0.5
    })
    const paras = [...el.querySelectorAll('.para')].map((e) => e.textContent)
    return { lines: paras.length ? paras : [el.querySelector(':scope > span')?.textContent], key: el.querySelector('kbd')?.textContent ?? null, out }
  })

const center = async (l: Locator) => {
  const b = (await l.boundingBox())!
  return [b.x + b.width / 2, b.y + b.height / 2] as const
}

/** 整个窗口里自绘提示和原生 title 套在一起的地方（指着里面那个会同时出两个） */
const nested = (page: Page) =>
  page.evaluate(() => {
    const name = (e: Element) => `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}[${e.getAttribute('aria-label') ?? e.getAttribute('data-tip') ?? e.getAttribute('title') ?? ''}]`
    const out: string[] = []
    for (const e of document.querySelectorAll('[data-tip]')) {
      const up = e.parentElement?.closest('[title]')
      if (up && !e.hasAttribute('title')) out.push(`${name(e)} 在带 title 的 ${name(up)} 里`)
    }
    for (const e of document.querySelectorAll('[title]')) {
      const up = e.parentElement?.closest('[data-tip]')
      if (up) out.push(`${name(e)} 在带 data-tip 的 ${name(up)} 里`)
    }
    return out
  })

test('网页标签：指着配对小标只出它的提示，指着标签别处只出网址，指着 × 只出关闭；来回移动不留上一个；点小标照旧打开那篇', async () => {
  test.setTimeout(120_000)
  const run = await launch({
    [NOTE]: `---\nread-along: ${book.base}/\n---\n# ${TITLE}\n\n记一句。\n`,
    'x.md': '# x\n\n随手记。\n',
  })
  const { page } = run
  try {
    await openNote(page, 'x')
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const A = `${book.base}/chapter_preliminaries/ndarray.html`
    const B = `${book.base}/chapter_preliminaries/pandas.html`
    await go(page, A)
    await web(page).getByRole('button', { name: '新网页' }).click()
    await go(page, B)
    await widenRight(page, 240)
    const cur = webTabs(page).nth(1)
    const other = webTabs(page).nth(0)
    await expect(cur).toHaveAttribute('aria-selected', 'true')
    const pairTip = [`自绘：打开配对的笔记《${TITLE}》`]

    // 当前那个标签（地址块）：小标 → 锁那一块（标签别处）→ 小标 → ×，每一步都只有一个、是对的那个
    const cb = (await cur.boundingBox())!
    await page.mouse.move(cb.x + 14, cb.y + cb.height / 2)
    const mark = cur.locator('.wpm')
    const lock = cur.locator('.addr > svg').first()
    const [mx, my] = await center(mark)
    const [lx, ly] = await center(lock)
    expect(await tipsAt(page, mx, my), '指着当前标签的小标').toEqual(pairTip)
    const atLock = await tipsAt(page, lx, ly)
    expect(atLock, '指着当前标签的锁').toHaveLength(1)
    expect(atLock[0], '指着当前标签的锁：网址').toContain(B)
    expect(await tipsAt(page, mx, my), '再回到小标').toEqual(pairTip)
    const atAddr = await tipsAt(page, ...(await center(cur.locator('.adisp'))))
    expect(atAddr, '指着地址块的字').toHaveLength(1)
    expect(atAddr[0]).toContain(B)
    // 地址块的提示两行：网址一行，「点一下改地址」一行，⌘L 是键帽；字都在框里（设计复审）
    expect(await shownTip(page)).toEqual({ lines: [B, '点一下改地址'], key: '⌘L', out: false })
    const [xx, xy] = await center(cur.locator('.x'))
    const atX = await tipsAt(page, xx, xy)
    expect(atX, '指着 ×').toHaveLength(1)
    expect(atX[0]).toContain('关闭网页标签')
    expect(await tipsAt(page, mx, my), '从 × 回到小标').toEqual(pairTip)

    // 别的那个标签：名字 → 小标 → 名字，各一个
    const ob = (await other.boundingBox())!
    await page.mouse.move(ob.x + 14, ob.y + ob.height / 2)
    const [nx, ny] = await center(other.locator('.tl'))
    const atName = await tipsAt(page, nx, ny)
    expect(atName, '指着别的标签的名字').toHaveLength(1)
    expect(atName[0], '指着别的标签的名字：网址').toContain(A)
    expect((await shownTip(page)).out, '两行（标题、网址）的提示字都在框里').toBe(false)
    const [ox, oy] = await center(other.locator('.wpm'))
    expect(await tipsAt(page, ox, oy), '指着别的标签的小标').toEqual(pairTip)
    const back = await tipsAt(page, nx, ny)
    expect(back, '回到别的标签的名字').toHaveLength(1)
    expect(back[0]).toContain(A)

    // 短的两行提示（不到 60 个字，不走 .long）：框也跟着长高，字不出框
    await page.evaluate(() => {
      const b = document.createElement('button')
      b.id = 'probe-4emge'
      b.dataset.tip = '百度\nhttps://baidu.com'
      b.dataset.side = 'below'
      b.textContent = '探'
      Object.assign(b.style, { position: 'fixed', left: '400px', top: '300px', zIndex: '999' })
      document.body.append(b)
    })
    await page.mouse.move(0, 0)
    await page.locator('#probe-4emge').hover()
    await expect(page.getByTestId('tooltip')).toBeVisible()
    expect(await shownTip(page)).toEqual({ lines: ['百度', 'https://baidu.com'], key: null, out: false })
    await page.evaluate(() => document.getElementById('probe-4emge')!.remove())

    // 整个窗口（中间文档标签、右栏标签、网页栏）没有自绘提示和原生 title 套在一起的
    expect(await nested(page)).toEqual([])

    // 点小标照旧：中间打开那篇
    await mark.click()
    await expect(page.getByTestId('tab-on')).toHaveText(TITLE)
    expect(await nested(page)).toEqual([])
  } finally {
    await run.close()
  }
})
