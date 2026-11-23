// 微信读书同步进书摘（2026-11-18 M1 录屏 CN-118、CN-120、CN-122、CN-123、CN-130、CN-131，方案页 D-读书与AI入口/review「直接修」）：
// - 同步只往书摘里加：书摘末尾写的字、改过的类型都在；新划线进它那一章；删掉的引文不加回来；不出冲突副本（CN-130）；
// - 中间开着这本书的书摘时划线：不插光标处，同步进那一章，中间岛底部提示「已同步到《书名》· 章节」带「看一眼」，整句不截，光标不动（CN-118）；
// - 书摘写进「阅读」，以前「素材/微信读书」里的照样认、不另建一份；
// - 微信读书阅读页里按 Tab，阅读区不横着错开（CN-120）；
// - 网页栏窄时点「注」，注释气泡整个在网页里，箭头还对着「注」（task-rbtrz，用户：「这里有遮挡」）。
// 微信读书是本机假的（e2e/fixtures/fake-weread.ts），不碰真账号。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, rail, type Running, waitSaved, widenRight } from './app'
import { BOOK, type FakeWeread, PARAS, PARAS2, READER, startFakeWeread, VID } from './fixtures/fake-weread'

let fake: FakeWeread

test.beforeAll(async () => {
  fake = await startFakeWeread()
})
test.afterAll(() => fake.server.close())
test.beforeEach(() => {
  fake.loggedOut = false
  fake.skey = 'skey-1'
  fake.failBookmarks = 0
  fake.hideBookId = false
  for (const [id, list] of fake.marks) fake.marks.set(id, list.slice(0, 1))
  fake.reviews.set(BOOK.bookId, [{ reviewId: 'r1', chapterName: '第1章 两个系统', abstract: PARAS[0], content: '系统 1 就是直觉。', createTime: 1794790100 }])
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const env = () => ({ CN_WEREAD_ORIGIN: fake.base })
const bookPath = `阅读/${BOOK.title}.md`
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')
const commits = (vault: string) => execFileSync('git', ['-C', vault, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')
/** 库里有没有冲突副本（「…（冲突 2026-11-18 01-23）.md」） */
const conflicts = (vault: string): string[] => {
  const out: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(join(vault, d), { withFileTypes: true })) {
      if (e.name.startsWith('.')) continue
      const p = d ? `${d}/${e.name}` : e.name
      if (e.isDirectory()) walk(p)
      else if (/（冲突 /.test(e.name)) out.push(p)
    }
  }
  walk('')
  return out
}

async function login(run: Running) {
  await run.app.evaluate(async ({ session }, [url, vid, skey]) => {
    const c = session.fromPartition('persist:web').cookies
    await c.set({ url, name: 'wr_vid', value: vid })
    await c.set({ url, name: 'wr_skey', value: skey })
  }, [fake.base, VID, fake.skey] as const)
}

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function openReader(page: Page) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${fake.base}${READER}`)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
}

/** 在阅读页里选中某一段（id）的前几个字，再点微信读书自己的「划线」（真的鼠标拖选、真的点） */
async function highlight(page: Page, id: string, chars: number) {
  const wv = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `(() => { const p = document.getElementById('${id}'); p.scrollIntoView({ block: 'center' }); const range = document.createRange(); range.setStart(p.firstChild, 0); range.setEnd(p.firstChild, ${chars}); const a = range.getClientRects()[0]; const rs = range.getClientRects(); const b = rs[rs.length - 1]; return JSON.stringify({ x0: a.left + 1, y0: a.top + a.height / 2, x1: b.right - 1, y1: b.top + b.height / 2 }) })()`))) as { x0: number; y0: number; x1: number; y1: number }
  for (let k = 0; k < 3; k++) {
    await page.mouse.move(wv.x + r.x0, wv.y + r.y0)
    await page.mouse.down()
    await page.mouse.move(wv.x + r.x1, wv.y + r.y1, { steps: 8 })
    await page.mouse.up()
    if (String(await guest(page, 'String(getSelection())')).trim()) break
    await page.waitForTimeout(300)
  }
  expect(String(await guest(page, 'String(getSelection())')).trim().length).toBeGreaterThan(0)
  const btn = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('mark').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  const sent = () => fake.requests.filter((u) => u.startsWith('/web/book/addBookmark')).length
  const before = sent()
  await page.mouse.click(wv.x + btn.x + btn.width / 2, wv.y + btn.y + btn.height / 2)
  await expect.poll(sent, { message: `${id} 的「划线」请求没发到微信读书` }).toBe(before + 1)
}

/** 打开书：同步出书摘，再在中间打开它（文档看法） */
async function openBook(run: Running) {
  await openReader(run.page)
  await expect.poll(() => (existsSync(join(run.vault, bookPath)) ? read(run.vault, bookPath) : ''), { timeout: 10_000 }).toContain(`bookId: ${BOOK.bookId}`)
  await openNote(run.page, BOOK.title)
}

/** 编辑器里点到最后一行末尾 */
async function caretToEnd(page: Page) {
  await pane(page).locator('.cm-content').click()
  await page.keyboard.press('Meta+End')
}

const toast = (page: Page) => page.locator('#wr-toast')

test('CN-130 书摘末尾写字存好，再划一段：写的字还在、新划线进它那一章、没有冲突副本；CN-118 提示「已同步到《书名》· 章节」，光标不动', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await login(run)
    await openBook(run)
    const first = read(vault, bookPath)
    expect(first).toContain('类型: 书摘\n')
    expect(first).toContain('微信读书的想法：系统 1 就是直觉。')
    // ⌘End 落到文末新起的那一段（task-ys1rr 块缝，同 3c8f0ee9），直接打字就是新的一段；再按回车会多夹一个空块
    await caretToEnd(page)
    await page.keyboard.type('我自己的想法：要多用系统 2')
    await waitSaved(page)
    await expect.poll(() => read(vault, bookPath)).toContain('\n\n我自己的想法：要多用系统 2')
    await highlight(page, 'p1', 20)
    const quote = PARAS[1]!.slice(0, 20)
    await expect(toast(page).locator('.t')).toHaveText(`已同步到《${BOOK.title}》· 第1章 两个系统`)
    await expect(toast(page).getByRole('button', { name: '看一眼' })).toBeVisible()
    await expect(toast(page)).toHaveClass(/\bon\b/)
    // 提示条在中间岛底部、整句不截
    await page.waitForTimeout(250)
    const box = await toast(page).evaluate((el) => {
      const r = el.getBoundingClientRect()
      const c = el.closest('main.center')!.getBoundingClientRect()
      const t = el.querySelector('.t')!
      return { inCenter: !!el.closest('main.center'), bottomGap: c.bottom - r.bottom, centerDx: Math.abs(r.left + r.width / 2 - (c.left + c.width / 2)), clipped: t.scrollWidth > t.clientWidth + 1, inside: r.left >= c.left && r.right <= c.right }
    })
    expect(box.inCenter).toBe(true)
    expect(box.bottomGap).toBeCloseTo(16, 0)
    expect(box.centerDx).toBeLessThan(1)
    expect(box.clipped).toBe(false)
    expect(box.inside).toBe(true)
    // 文件：写的字还在，新划线在第 1 章（这一章最后一条引文连同想法后面，在用户那一段前面）
    await expect.poll(() => read(vault, bookPath)).toContain(`> ${quote}`)
    await waitSaved(page)
    const md = read(vault, bookPath)
    expect(md.slice(md.indexOf('## 第1章 两个系统')).replace(/\n$/, '')).toBe(['## 第1章 两个系统', '', `> ${PARAS[0]}`, '', '微信读书的想法：系统 1 就是直觉。', '', `> ${quote}`, '', '我自己的想法：要多用系统 2'].join('\n'))
    expect(conflicts(vault)).toEqual([])
    // 光标还在刚才打字的地方：接着打的字跟在「系统 2」后面
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.type('。')
    await waitSaved(page)
    expect(read(vault, bookPath)).toMatch(/我自己的想法：要多用系统 2。\n?$/)
    await expect.poll(() => commits(vault)).toContain(`微信读书：同步《${BOOK.title}》2 条划线`)
  } finally {
    await run.close()
  }
})

test('CN-130 打着字还没存时划线：正在打的字不丢、没有冲突副本，新划线照样进书摘', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await login(run)
    await openBook(run)
    await highlight(page, 'p2', 12)
    // 划完马上回到书摘最后接着打字（同步正好在打字的时候进来）
    await caretToEnd(page)
    await page.keyboard.press('Enter')
    await page.keyboard.type('边读边写的一句话，正在打还没停', { delay: 80 })
    await expect.poll(() => read(vault, bookPath), { timeout: 10_000 }).toContain(`> ${PARAS[2]!.slice(0, 12)}`)
    await waitSaved(page)
    const md = read(vault, bookPath)
    expect(md).toContain('边读边写的一句话，正在打还没停')
    expect(md.split(`> ${PARAS[2]!.slice(0, 12)}`).length).toBe(2)
    expect(conflicts(vault)).toEqual([])
    await expect(page.getByTestId('toast').filter({ hasText: '冲突' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('CN-130 删掉一条引文、改了类型，再同步：删掉的不加回来，类型还是改过的那个，只有一个类型字段', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await login(run)
    await openBook(run)
    // 属性里把类型改成「笔记」
    await acts(page).getByRole('button', { name: '属性' }).click()
    const pop = page.getByRole('dialog', { name: '属性' })
    await expect(pop.getByRole('combobox', { name: '类型' })).toHaveValue('书摘')
    await pop.getByRole('combobox', { name: '类型' }).selectOption('笔记')
    await page.keyboard.press('Escape')
    // 删掉第一条引文：连点三下选中这一行，删掉
    const line = pane(page).locator('.cm-line', { hasText: PARAS[0]!.slice(0, 10) })
    await line.click({ clickCount: 3 })
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    await expect.poll(() => read(vault, bookPath)).not.toContain(PARAS[0]!)
    expect(read(vault, bookPath)).toContain('类型: 笔记\n')
    // 再划一段：同步进来，删掉的那条不回来，类型还是「笔记」
    await highlight(page, 'q0', 10)
    await expect.poll(() => read(vault, bookPath), { timeout: 10_000 }).toContain(`> ${PARAS2[0]!.slice(0, 10)}`)
    await waitSaved(page)
    const md = read(vault, bookPath)
    expect(md).not.toContain(PARAS[0]!)
    expect(md.match(/^(类型|type):/gm)).toEqual(['类型:'])
    expect(md).toContain('类型: 笔记\n')
    // 第 2 章新起一节，排在第 1 章后面
    expect(md.indexOf('## 第2章 注意力')).toBeGreaterThan(md.indexOf('## 第1章 两个系统'))
    expect(conflicts(vault)).toEqual([])
  } finally {
    await run.close()
  }
})

test('CN-118 中间开的不是文档：不插，提示「已同步到《书名》· 章节」，点「看一眼」打开书摘、滚到新的那一段', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page, vault } = run
  try {
    await login(run)
    await openReader(page)
    await expect.poll(() => existsSync(join(vault, bookPath)), { timeout: 10_000 }).toBe(true)
    await highlight(page, 'q1', 9)
    await expect(toast(page).locator('.t')).toHaveText(`已同步到《${BOOK.title}》· 第2章 注意力`)
    await toast(page).getByRole('button', { name: '看一眼' }).click()
    await expect(page.getByTestId('tab-on')).toHaveText(BOOK.title)
    const q = pane(page).locator('.cm-line', { hasText: PARAS2[1]!.slice(0, 9) })
    await expect(q).toBeInViewport()
    await expect(pane(page).locator('.cm-flashbar')).toBeVisible()
    expect(read(vault, bookPath)).toContain(`## 第2章 注意力\n\n> ${PARAS2[1]!.slice(0, 9)}`)
  } finally {
    await run.close()
  }
})

test('书摘写进「阅读」；以前「素材/微信读书」里的旧书摘：打开库时整个挪进「阅读」（整理顶级分类，一次提交），同步合并进那一份，换成新写法，用户写的字留着，不另建', async () => {
  const OLD = [
    '---',
    'type: weread',
    `title: ${BOOK.title}`,
    `author: ${BOOK.author}`,
    `bookId: ${BOOK.bookId}`,
    `source: ${fake.base}${READER}`,
    'marks: 1',
    'thoughts: 1',
    '类型: 书摘',
    '---',
    `# ${BOOK.title}`,
    '',
    `${BOOK.author} · 微信读书里的划线和想法，软件自动同步，改这里不会改回微信读书。`,
    '',
    '## 第1章 两个系统',
    '',
    `> ${PARAS[0]}`,
    '',
    '想法：系统 1 就是直觉。',
    '',
    '我自己的想法：系统 1 就是偷懒',
    '',
  ].join('\n')
  const old = `素材/微信读书/${BOOK.title}.md`
  const run = await launch({ 'a.md': '# a\n', [old]: OLD }, env())
  const { page, vault } = run
  try {
    // 打开老库时整理顶级分类（左栏、分类那一区）：素材/微信读书/ 整个挪成 阅读/，用户写的字原样跟过去
    expect(existsSync(join(vault, old))).toBe(false)
    expect(read(vault, bookPath)).toContain('我自己的想法：系统 1 就是偷懒')
    expect(commits(vault)[0]).toMatch(/^整理顶级分类：素材\/微信读书\/ → 阅读\//)
    await login(run)
    await openReader(page)
    await expect.poll(() => read(vault, bookPath), { timeout: 10_000 }).toContain('微信读书的想法：系统 1 就是直觉。')
    const md = read(vault, bookPath)
    expect(md.match(/^(类型|type):/gm)).toEqual(['类型:'])
    expect(md).toContain('我自己的想法：系统 1 就是偷懒')
    expect(md).not.toContain('改这里不会改回微信读书')
    expect(md).toContain('作者: 丹尼尔·卡尼曼\n')
    expect(readdirSync(join(vault, '阅读'))).toEqual([`${BOOK.title}.md`])
    expect(existsSync(join(vault, '素材'))).toBe(false)
    // 再划一段也进这一份
    await highlight(page, 'p1', 8)
    await expect.poll(() => read(vault, bookPath), { timeout: 10_000 }).toContain(`> ${PARAS[1]!.slice(0, 8)}`)
    expect(readdirSync(join(vault, '阅读'))).toEqual([`${BOOK.title}.md`])
  } finally {
    await run.close()
  }
})

test('书摘被挪到别处（换了文件夹、改了名），插件也没记着挪到哪：按书的编号认出来，合并进那一份，不另建', async () => {
  const moved = '课程/心理学/读过的书.md'
  const text = ['---', '类型: 书摘', `作者: ${BOOK.author}`, `bookId: ${BOOK.bookId}`, '划线: 1', '---', '# 读过的书', '', '## 第1章 两个系统', '', `> ${PARAS[0]}`, '', '我的评价：说得对。', ''].join('\n')
  const run = await launch({ 'a.md': '# a\n', [moved]: text }, env())
  const { page, vault } = run
  try {
    await login(run)
    await openReader(page)
    await highlight(page, 'p2', 6)
    await expect.poll(() => read(vault, moved), { timeout: 10_000 }).toContain(`> ${PARAS[2]!.slice(0, 6)}`)
    expect(read(vault, moved)).toContain(`> ${PARAS[0]}\n\n微信读书的想法：系统 1 就是直觉。\n\n我的评价：说得对。`)
    expect(existsSync(join(vault, bookPath))).toBe(false)
  } finally {
    await run.close()
  }
})

test('CN-120 微信读书阅读页里连按 Tab：阅读区不横着错开（插件关着时会错开，证明假网站复现了这个毛病）', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page } = run
  try {
    await login(run)
    await openReader(page)
    const scrolled = () => guest(page, `document.getElementById('app').scrollLeft + document.scrollingElement.scrollLeft`) as Promise<number>
    const pressTabs = async () => {
      const wv = (await web(page).locator('webview.on').boundingBox())!
      const p = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('p0').getBoundingClientRect())`))) as { x: number; y: number }
      await page.mouse.click(wv.x + p.x + 30, wv.y + p.y + 10)
      const seen: number[] = []
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('Tab')
        await page.waitForTimeout(60)
        seen.push(await scrolled())
      }
      return seen
    }
    // 插件关着：焦点跳到右边藏着的按钮，阅读区被横着滚开（录屏里的样子）
    await page.evaluate(() => window.cnPlugins.setEnabled('weread', false))
    await expect.poll(async () => Math.max(...(await pressTabs()))).toBeGreaterThan(0)
    // 插件开着：Tab 拦下，阅读区横向滚动一直是 0
    await page.evaluate(() => window.cnPlugins.setEnabled('weread', true))
    await guest(page, `document.getElementById('app').scrollLeft = 0; location.reload()`)
    await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
    await page.waitForTimeout(300)
    expect(await pressTabs()).toEqual(Array(10).fill(0))
  } finally {
    await run.close()
  }
})

/** 点阅读页里的一个「注」（真的鼠标点），量弹出来的注释气泡：左右边、箭头正中、「注」正中、网页多宽、有没有挪过 */
async function footnote(page: Page, id: 'fnL' | 'fnR') {
  await guest(page, `document.getElementById('${id}').scrollIntoView({ block: 'center' })`)
  await page.waitForTimeout(100)
  const wv = (await web(page).locator('webview.on').boundingBox())!
  const n = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('${id}').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  await page.mouse.click(wv.x + n.x + n.width / 2, wv.y + n.y + n.height / 2)
  await expect.poll(() => guest(page, `!!(document.querySelector('.reader_footerNote_container') || {}).style?.left`)).toBe(true)
  await page.waitForTimeout(150)
  const m = JSON.parse(
    String(
      await guest(
        page,
        `(() => { const c = document.querySelector('.reader_footerNote_container'); const r = c.getBoundingClientRect(); const a = getComputedStyle(c, '::after');
        const n = document.getElementById('${id}').getBoundingClientRect();
        return JSON.stringify({ left: r.left, right: r.right, width: r.width, arrow: r.left + parseFloat(a.left), note: n.left + n.width / 2, vw: document.documentElement.clientWidth, translate: getComputedStyle(c).translate, styleLeft: parseFloat(c.style.left) }) })()`,
      ),
    ),
  ) as { left: number; right: number; width: number; arrow: number; note: number; vw: number; translate: string; styleLeft: number }
  // 点外面（微信读书的遮罩）收起
  await page.mouse.click(wv.x + 4, wv.y + 4)
  await expect.poll(() => guest(page, `document.querySelectorAll('.reader_footerNote_container').length`)).toBe(0)
  return m
}

test('task-rbtrz 网页栏窄时点「注」：注释气泡整个在网页里（左右各留 8）、箭头还对着「注」；宽栏时位置不变；插件关着时左边是负的（证明假网站复现了）', async () => {
  const run = await launch({ 'a.md': '# a\n' }, env())
  const { page } = run
  try {
    await login(run)
    await openReader(page)
    // 插件关着：和用户截图一样，靠左的「注」气泡左半截在网页外面
    await page.evaluate(() => window.cnPlugins.setEnabled('weread', false))
    const off = await footnote(page, 'fnL')
    expect(off.vw).toBeLessThan(420)
    expect(off.left).toBeLessThan(0)
    // 插件开着：靠左、靠右的「注」，气泡都整个在网页里，左右至少留 8，箭头对着「注」
    await page.evaluate(() => window.cnPlugins.setEnabled('weread', true))
    await page.waitForTimeout(200)
    for (const id of ['fnL', 'fnR'] as const) {
      const m = await footnote(page, id)
      expect(m.left, `${id} 气泡左边`).toBeGreaterThanOrEqual(7.5)
      expect(m.right, `${id} 气泡右边`).toBeLessThanOrEqual(m.vw - 7.5)
      expect(Math.abs(m.arrow - m.note), `${id} 箭头对着「注」`).toBeLessThanOrEqual(1)
    }
    // 宽栏：正文两边有留白，气泡放得下，微信读书摆在哪就在哪（不挪）
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1600, 900))
    await widenRight(page, 640)
    await expect.poll(async () => (await web(page).locator('webview.on').boundingBox())!.width).toBeGreaterThan(800)
    for (const id of ['fnL', 'fnR'] as const) {
      const m = await footnote(page, id)
      expect(m.translate, `${id} 宽栏时不挪`).toBe('none')
      expect(Math.abs(m.left - m.styleLeft), `${id} 在微信读书摆的位置`).toBeLessThanOrEqual(1)
      expect(m.left).toBeGreaterThanOrEqual(8)
      expect(Math.abs(m.arrow - m.note)).toBeLessThanOrEqual(1)
    }
  } finally {
    await run.close()
  }
})
