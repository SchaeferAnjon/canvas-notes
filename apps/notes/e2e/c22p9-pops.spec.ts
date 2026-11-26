/**
 * 弹层不被栏边截掉、窄栏里的块不挤坏（task-c22p9，0.4.8 用户原话：「你能看到第二张图，它是只露了半截儿的，在这个白板里面也是这样的状况」
 * 「这里修复一下」）：
 * - 数据库的浮层（加一列、列头菜单、筛选、排序、选项）挂在最外层，按触发点在窗口里放：中栏 420 时点表头最右「+」，
 *   菜单整个看得见（每个角、七种类型都点得到，不被右栏盖住）、不出中栏；打开后不自己收起；
 * - 白板上展开的数据库表，缩放 69%、144% 各点一次「+」：菜单不跟着缩放（220 宽、按钮 30 高），贴着「+」；
 * - 中栏 420 时数据库块的工具条：标题一行（放不下省略号、悬停看全名），按钮不被切，放不下的收进「⋯」（新一条照旧露着），
 *   表头不压着标题，表格在块里横着滚、不撑宽版心。
 * 都是真点、真打字、真滚。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, openAi, openNote, pane, rail, widenRight } from './app'
import { docBoardVault } from './fixtures/doc-board'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

/** 截改前改后的图：CN_SHOTS_DIR=目录，CN_SHOT_TONE=dark 用深湖，不然天青 */
const SHOTS = process.env.CN_SHOTS_DIR
const TONE = process.env.CN_SHOT_TONE === 'dark' ? 'dark' : 'light'
const look = (vault: string) => {
  if (!SHOTS) return
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: TONE === 'dark' ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}-${TONE}.png`) })
}

const BASE = '```base\nfilters:\n  and:\n    - file.inFolder("阅读/未命名数据库")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 状态\n      - 日期\n```'
const FILES: Record<string, string> = {
  '阅读/杀死一只知更鸟.md': `# 杀死一只知更鸟\n\n## 评价\n\n开篇很克制：从杰姆胳膊肘骨折这件小事讲起。\n\n${BASE}\n\n后面一段。\n`,
  '阅读/未命名数据库/第一条.md': '---\n状态: 未开始\n日期: 2026-11-21\n---\n',
  '阅读/未命名数据库/第二条.md': '---\n状态: 在读\n日期: 2026-11-20\n---\n',
}

/** 浮层整个看得见：在窗口里，四个角和中间点下去都落在它自己身上（不被右栏、别的栏盖住）；within 给了还要在这个框里 */
async function wholeVisible(pop: Locator, within?: { x: number; y: number; width: number; height: number }) {
  const r = await pop.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const pts = [
      [b.left + 4, b.top + 4],
      [b.right - 4, b.top + 4],
      [b.left + 4, b.bottom - 4],
      [b.right - 4, b.bottom - 4],
      [(b.left + b.right) / 2, (b.top + b.bottom) / 2],
    ]
    const covered = pts.filter(([x, y]) => !el.contains(document.elementFromPoint(x!, y!))).map(([x, y]) => {
      const hit = document.elementFromPoint(x!, y!) as HTMLElement | null
      return `${Math.round(x!)},${Math.round(y!)} 被 ${hit?.className || hit?.tagName} 盖住`
    })
    return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, vw: window.innerWidth, vh: window.innerHeight, covered }
  })
  expect(r.covered, '浮层有地方被盖住').toEqual([])
  expect(r.left).toBeGreaterThanOrEqual(0)
  expect(r.top).toBeGreaterThanOrEqual(0)
  expect(r.right).toBeLessThanOrEqual(r.vw)
  expect(r.bottom).toBeLessThanOrEqual(r.vh)
  if (within) {
    expect(r.left).toBeGreaterThanOrEqual(within.x - 0.5)
    expect(r.right).toBeLessThanOrEqual(within.x + within.width + 0.5)
  }
  return r
}

/** 每一项的中间点下去落在它自己身上（真点得到） */
async function allHittable(items: Locator) {
  const misses = await items.evaluateAll((els) =>
    els
      .filter((el) => {
        const b = el.getBoundingClientRect()
        return !el.contains(document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2))
      })
      .map((el) => el.textContent),
  )
  expect(misses, '点不到的项').toEqual([])
}

/**
 * 表格里的按钮、格子：先把表格横着滚到它、等一帧再点（跟人一样）。直接点的话 Playwright 自己去滚，
 * 滚动事件晚到一帧，把刚开的浮层当成「表格滚了」收起
 */
async function clickSteady(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  await el.click()
}

/** 中栏拉到 420：右栏开「历史」，往左拉宽 */
async function narrowCenter(page: Page) {
  await rail(page).getByRole('button', { name: '历史' }).click()
  await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
  await widenRight(page, 400)
  await expect.poll(async () => Math.round((await page.locator('.win > .center').boundingBox())!.width)).toBe(420)
}

const TYPES = ['文字', '数字', '选项', '多选', '状态', '日期', '勾选', '链接']
/** 加一列的菜单（第三批 task-i921u）：基本八种，连起来（关联、汇总），算出来（公式） */
// 最下面一组「AI 生成一列」（数据库 AI 列，task-i921u）
// 「动手」一组：按钮列（自动化那一套动作）、AI 生成一列（task-i921u）
const ADD_TYPES = [...TYPES, '关联', '汇总', '公式', /^按钮/, /^AI 生成一列/]

test('中栏 420：数据库表头最右「+」的加列菜单整个看得见、不出中栏、七种类型都点得到，选「勾选」真加上一列；列头菜单、筛选、选项、⋯ 里的排序也一样', async () => {
  const run = await launch(FILES, {}, look)
  const { page, app, vault } = run
  const file = () => readFileSync(join(vault, '阅读/杀死一只知更鸟.md'), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await armMenus(run)
    await openNote(page, '杀死一只知更鸟')
    await narrowCenter(page)
    const center = (await page.locator('.win > .center').boundingBox())!
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)
    await shot(page, 'doc-420-block')

    // 表头最右「+」：先把表格横着滚到它（跟人一样；Playwright 自己滚的话，滚动事件晚到一帧会把刚开的菜单收起）
    await clickSteady(page, db.getByRole('button', { name: '加一列' }))
    const add = page.getByRole('dialog', { name: '加一列' })
    await expect(add).toBeVisible()
    await shot(page, 'doc-420-addcol')
    // 名字框拿到焦点也不把它自己收起（以前框在表格的横滚区里，聚焦一滚就收）
    await page.waitForTimeout(400)
    await expect(add).toBeVisible()
    await expect(add.getByRole('textbox', { name: '新的一列叫什么' })).toBeFocused()
    await wholeVisible(add, center)
    await expect(add.getByRole('menuitem')).toHaveText(ADD_TYPES)
    await allHittable(add.getByRole('menuitem'))
    // 菜单贴着「+」：右边放不下就往左翻，右边和「+」对齐
    const plus = (await db.getByRole('button', { name: '加一列' }).boundingBox())!
    const box = (await add.boundingBox())!
    expect(Math.round(box.x + box.width)).toBe(Math.round(plus.x + plus.width))
    expect(Math.abs(box.y - (plus.y + plus.height + 4))).toBeLessThan(1)
    await add.getByRole('textbox', { name: '新的一列叫什么' }).fill('读完了')
    await add.getByRole('menuitem', { name: '勾选' }).click()
    await expect.poll(file).toContain('      - 读完了\n')
    expect(file()).toContain('  读完了:\n    type: check')
    await expect(add).toHaveCount(0)

    // 最右一列的列头菜单
    await clickSteady(page, db.locator('thead th.col').last().locator('.base-th'))
    const colMenu = page.getByRole('menu', { name: '读完了 这一列' })
    await wholeVisible(colMenu, center)
    await expect(colMenu.getByRole('menuitemradio')).toHaveText(TYPES)
    await allHittable(colMenu.getByRole('menuitemradio'))
    await allHittable(colMenu.getByRole('menuitem'))
    // 列头菜单里「按这一列筛选…」：筛选面板也整个看得见
    await colMenu.getByRole('menuitem', { name: '按这一列筛选…' }).click()
    const filter = page.getByRole('dialog', { name: '筛选' })
    await wholeVisible(filter)
    await allHittable(filter.getByRole('combobox'))
    await page.keyboard.press('Escape')
    await expect(filter).toHaveCount(0)

    // 选项格子的小菜单
    // 单击只选中一格（task-cle3x 格子焦点），再点一下开选项
    await clickSteady(page, db.locator('tbody tr', { hasText: '第一条' }).locator('td').nth(1))
    await db.locator('tbody tr', { hasText: '第一条' }).locator('td').nth(1).click()
    const opts = page.getByRole('dialog', { name: '第一条 · 状态' })
    await wholeVisible(opts, center)
    await allHittable(opts.getByRole('menuitemradio'))
    await opts.getByRole('menuitemradio', { name: '在读' }).click()
    await expect.poll(() => readFileSync(join(vault, '阅读/未命名数据库/第一条.md'), 'utf8')).toContain('状态: 在读')

    // 第一行放不下的在「⋯」里（420 宽，块 286：条上留名字、「N 条」、⋯、新一条；自动化、整页打开、改写法收进来）
    const more = db.getByRole('button', { name: '工具条上放不下的' })
    await expect(more).toBeVisible()
    await more.click()
    expect(menuLabels(await openedMenu(run))).toEqual(['自动化', '整页打开', '改写法'])
    await pickMenu(run, '整页打开')
    const full = page.getByRole('dialog', { name: '数据库 未命名数据库' })
    await expect(full).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(full).toHaveCount(0)
    // 排序在第二行（窄了只留图标），排序面板整个看得见（第三批 task-i921u）
    await db.locator('.base-tools').getByRole('button', { name: '排序', exact: true }).click()
    const sort = page.getByRole('dialog', { name: '排序' })
    await wholeVisible(sort)
    await sort.getByRole('button', { name: '加一个排序' }).click()
    await sort.getByRole('combobox', { name: '排序的列' }).selectOption('日期')
    await expect.poll(file).toContain('    sort:\n      - property: 日期\n        direction: ASC')
    // 加过列（有 properties）再排序也写进视图里，表真按日期排了（以前落进 properties，排不上）
    await expect(db.locator('tbody tr').first()).toContainText('第二条')
    // 排序的小标签「↑ 日期」在第三行，窄了照样露着
    await expect(db.locator('.base-cbar .base-fchip')).toHaveText('日期')
    await page.keyboard.press('Escape')
    await expect(sort).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('中栏 420：数据库块工具条不挤，标题一行、放不下省略号悬停看全名；按钮都没被切，放不下的收进「⋯」、新一条露着；表头不压标题；表格在块里横着滚，不出中栏', async () => {
  const long = '一个名字特别长的读书清单数据库'
  const files = Object.fromEntries(Object.entries(FILES).map(([k, v]) => [k.replace('未命名数据库', long), v.replace('未命名数据库', long)]))
  const run = await launch(files, {}, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '杀死一只知更鸟')
    const db = pane(page).locator('[data-part="数据库块"]')
    const top = db.locator('.base-top')
    // 宽的时候：工具条全在、没有「⋯」（筛选、排序、分组在第二行，task-i921u）
    await expect(db.locator('.base-tools').getByRole('button', { name: '筛选', exact: true })).toBeVisible()
    await expect(top.getByRole('button', { name: '改写法' })).toBeVisible()
    await expect(db.getByRole('button', { name: '工具条上放不下的' })).toHaveCount(0)

    await narrowCenter(page)
    await shot(page, 'doc-420-toolbar')
    const m = await db.evaluate((el) => {
      const top = el.querySelector('.base-top')!.getBoundingClientRect()
      const b = el.querySelector<HTMLElement>('.base-top b')!
      const line = parseFloat(getComputedStyle(b).lineHeight) || parseFloat(getComputedStyle(b).fontSize) * 1.5
      const kids = [...el.querySelectorAll<HTMLElement>('.base-top > *, .base-vbar button')].filter((k) => k.offsetWidth > 0)
      const cut = kids.filter((k) => {
        const r = k.getBoundingClientRect()
        return r.left < top.left - 0.5 || r.right > top.right + 0.5 || r.height > 34
      })
      const th = el.querySelector('thead')!.getBoundingClientRect()
      const bar = el.querySelector('.base-vbar')!.getBoundingClientRect()
      // 表在文档里放宽到栏宽（task-cle3x，照 Notion）：量到栏的右边，不出栏
      const content = el.closest('.body')!.getBoundingClientRect()
      const blk = el.getBoundingClientRect()
      const scroll = el.querySelector<HTMLElement>('.base-scroll')!
      return {
        topH: top.height,
        titleH: b.getBoundingClientRect().height,
        line,
        titleCut: b.scrollWidth > b.clientWidth,
        titleW: b.clientWidth,
        tip: b.getAttribute('data-tip'),
        cut: cut.map((k) => k.className + ' ' + k.textContent),
        thTop: th.top,
        topBottom: bar.bottom,
        blkRight: blk.right,
        contentRight: content.right,
        scrollable: scroll.scrollWidth > scroll.clientWidth,
      }
    })
    expect(m.topH).toBeLessThanOrEqual(39)
    expect(m.titleH).toBeLessThanOrEqual(m.line + 1)
    expect(m.titleCut).toBe(true)
    // 名字省略了也至少露出几个字（头上图标是 svg，以前量漏了它，名字被挤到 0）
    expect(m.titleW).toBeGreaterThanOrEqual(39)
    // 悬停看全名，后面接「双击改名」（2026-11-24 文档里的数据库块也能双击标题改名）
    expect(m.tip).toBe(`${long} · 双击改名`)
    expect(m.cut, '被切或者折行的').toEqual([])
    expect(m.thTop).toBeGreaterThanOrEqual(m.topBottom - 0.5)
    expect(m.blkRight).toBeLessThanOrEqual(m.contentRight + 0.5)
    expect(m.scrollable).toBe(true)
    await expect(top.getByRole('button', { name: '新一条' })).toBeVisible()
    await expect(db.getByRole('button', { name: '工具条上放不下的' })).toBeVisible()
    // 横着滚：真在表格上滚轮
    const scroll = db.locator('.base-scroll')
    const sb = (await scroll.boundingBox())!
    await page.mouse.move(sb.x + sb.width / 2, sb.y + 40)
    await page.mouse.wheel(200, 0)
    await expect.poll(() => scroll.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0)
    // 正文没被横着带走
    expect(await pane(page).locator('.cm-scroller').evaluate((e) => e.scrollLeft)).toBe(0)
  } finally {
    await run.close()
  }
})

test('中栏 420、开着排序和筛选：小标签在第三行照样露着（放不下整个换行，不收进「⋯」）；× 能去掉那条筛选，写回 md', async () => {
  const base = BASE.replace('    - file.inFolder("阅读/未命名数据库")', '    - file.inFolder("阅读/未命名数据库")\n    - 状态 != "放弃"').replace(
    '      - 日期\n```',
    '      - 日期\n    sort:\n      - property: 日期\n        direction: DESC\n```',
  )
  const files = { ...FILES, '阅读/杀死一只知更鸟.md': FILES['阅读/杀死一只知更鸟.md']!.replace(BASE, base) }
  const run = await launch(files, {}, look)
  const { page, app, vault } = run
  const file = () => readFileSync(join(vault, '阅读/杀死一只知更鸟.md'), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await armMenus(run)
    await openNote(page, '杀死一只知更鸟')
    const db = pane(page).locator('[data-part="数据库块"]')
    // 小标签在第三行（task-i921u）：宽的、窄的都露着
    const chips = db.locator('[data-part="筛选排序小标签"] .base-fchip')
    await expect(chips).toHaveText(['状态 不是 放弃', '日期'])
    await narrowCenter(page)
    await expect(chips).toHaveText(['状态 不是 放弃', '日期'])
    const cut = await db.evaluate((el) => {
      const box = el.getBoundingClientRect()
      return [...el.querySelectorAll<HTMLElement>('.base-fchip')].filter((c) => c.getBoundingClientRect().right > box.right + 0.5 || c.getBoundingClientRect().height > 26).length
    })
    expect(cut).toBe(0)
    await shot(page, 'doc-420-chips')
    await db.getByRole('button', { name: '去掉筛选' }).click()
    await expect.poll(file).not.toContain('状态 != "放弃"')
    expect(file()).toContain('direction: DESC')
  } finally {
    await run.close()
  }
})

test('白板上展开的数据库表：缩放 50%、69%、144% 各点一次表头「+」，加列菜单不跟着缩放（220 宽、一项 28 高）、贴着「+」、整个看得见，七种类型都点得到；块头收哪几样不跟缩放变', async () => {
  const run = await launch(docBoardVault(), {}, look)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    for (const z of [0.5, 0.69, 1.44]) {
      await openNote(page, '冰岛十天环岛')
      await page.evaluate((z) => localStorage.setItem('cn.boardZoom:写作/冰岛十天环岛.md', String(z)), z)
      // 关掉再开：标签按记下的比例画
      await page.keyboard.press('Meta+w')
      await openNote(page, '冰岛十天环岛')
      await acts(page).getByRole('tab', { name: '白板' }).click()
      await expect(page.getByTestId('board-zoom')).toHaveText(`${Math.round(z * 100)}%`)
      const board = pane(page).getByTestId('doc-board')
      await board.getByRole('region', { name: '住哪', exact: true }).locator('.db-card[data-face="base"]').getByTestId('db-expand').click()
      const big = board.locator('.dbx')
      await expect(big.locator('tbody tr')).toHaveCount(8)
      // 块头收哪几样不跟缩放变：660 宽的表三个比例都放得下，筛选、排序、整页打开、收起都在；「⋯」里只收着「自动化」（白板卡上一直收着，task-i921u）
      for (const name of ['筛选', '排序', '整页打开', '收起']) await expect(big.locator('.base-top, .base-tools').getByRole('button', { name, exact: true })).toBeVisible()
      await expect(big.locator('.base-more')).toHaveCount(1)
      const plusBtn = big.getByRole('button', { name: '加一列' })
      await plusBtn.scrollIntoViewIfNeeded()
      await plusBtn.click()
      const add = page.getByRole('dialog', { name: '加一列' })
      await expect(add).toBeVisible()
      await shot(page, `board-${Math.round(z * 100)}-addcol`)
      await page.waitForTimeout(300)
      await wholeVisible(add)
      const box = (await add.boundingBox())!
      expect(Math.round(box.width)).toBe(300)
      const one = (await add.getByRole('menuitem', { name: '文字' }).boundingBox())!
      expect(Math.round(one.height)).toBe(30)
      // 贴着「+」：上边在「+」下面 4，或者翻到「+」上面
      const plus = (await plusBtn.boundingBox())!
      const below = Math.abs(box.y - (plus.y + plus.height + 4)) < 1
      const above = Math.abs(box.y + box.height - (plus.y - 4)) < 1
      expect(below || above, `菜单 ${JSON.stringify(box)} 没贴着「+」${JSON.stringify(plus)}`).toBe(true)
      expect(box.x).toBeLessThanOrEqual(plus.x + plus.width)
      expect(box.x + box.width).toBeGreaterThanOrEqual(plus.x)
      await expect(add.getByRole('menuitem')).toHaveText(ADD_TYPES)
      await allHittable(add.getByRole('menuitem'))
      await page.keyboard.press('Escape')
      await expect(add).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(big).toHaveCount(0)
    }
  } finally {
    await run.close()
  }
})

test('别的弹层抽查：窄栏里的块菜单、/ 菜单，白板工具板「数据库」的小菜单都整个看得见', async () => {
  const run = await launch(docBoardVault(), {}, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '冰岛十天环岛')
    await narrowCenter(page)
    // 块菜单：开头那一段（文档长，下面的块 CodeMirror 还没画）
    const para = pane(page).locator('.cm-content .cm-line').nth(2)
    await expect(async () => {
      const box = (await para.boundingBox())!
      await page.mouse.move(box.x + 40, box.y + 8)
      await page.mouse.move(box.x + 60, box.y + 10)
      await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click({ timeout: 1000 })
      await expect(page.getByRole('menu', { name: '块菜单' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
    await wholeVisible(page.getByRole('menu', { name: '块菜单' }))
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu', { name: '块菜单' })).toHaveCount(0)
    // / 菜单：开头那一段后面另起一行打 /
    await para.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    const slash = page.locator('.ed-pop.slash-pop:not([hidden])')
    await expect(slash).toBeVisible()
    await wholeVisible(slash)
    await page.keyboard.press('Escape')
    // 白板工具板「数据库」
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await pane(page).getByTestId('doc-board').locator('.bpal button[data-kind="base"]').click()
    const menu = page.getByRole('menu', { name: '放一张数据库卡' })
    await expect(menu.getByRole('menuitem').first()).toBeVisible()
    await wholeVisible(menu)
    await allHittable(menu.getByRole('menuitem'))
  } finally {
    await run.close()
  }
})

test('中栏 420：七列的 md 表格不挤成一字一行，每列至少 6em、在这一块里横着滚、不撑宽版心；文档白板顶上的说明整条在白板里', async () => {
  const doc = [
    '# 窄栏样张',
    '',
    '| 书名 | 作者 | 出版社 | 出版年 | 页数 | 评分 | 读完了吗 |',
    '|---|---|---|---|---|---|---|',
    '| 杀死一只知更鸟 | 哈珀·李 | 译林出版社 | 2012 | 357 | 9.2 | 读完了 |',
    '| 百年孤独 | 加西亚·马尔克斯 | 南海出版公司 | 2011 | 360 | 9.3 | 没读完 |',
    '',
    '## 一节',
    '',
    '正文。',
    '',
  ].join('\n')
  const run = await launch({ '阅读/窄栏样张.md': doc }, {}, look)
  const { page, app, vault } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '窄栏样张')
    await narrowCenter(page)
    await shot(page, 'doc-420-table')
    const t = pane(page).locator('[data-part="表格"]')
    const m = await t.evaluate((wrap) => {
      const fs = parseFloat(getComputedStyle(wrap.querySelector('table')!).fontSize)
      const cells = [...wrap.querySelectorAll<HTMLElement>('th, td')]
      const content = wrap.closest('.cm-content')!.getBoundingClientRect()
      return {
        minCell: Math.min(...cells.map((c) => c.getBoundingClientRect().width)),
        em6: fs * 6,
        /** 表头一格最多两行 */
        headLines: Math.max(...[...wrap.querySelectorAll<HTMLElement>('th')].map((c) => Math.round((c.getBoundingClientRect().height - 12) / (parseFloat(getComputedStyle(c).lineHeight) || fs * 1.6)))),
        scrolls: wrap.scrollWidth > wrap.clientWidth,
        right: wrap.getBoundingClientRect().right,
        contentRight: content.right,
      }
    })
    expect(m.minCell).toBeGreaterThanOrEqual(m.em6 - 1)
    expect(m.headLines).toBeLessThanOrEqual(2)
    expect(m.scrolls).toBe(true)
    expect(m.right).toBeLessThanOrEqual(m.contentRight + 0.5)
    // 右边还有列：右边渐隐，左边不；真在表格上横着滚到中间，两边都渐隐
    await expect(t).toHaveClass(/math-fade-r/)
    await expect(t).not.toHaveClass(/math-fade-l/)
    const tb = (await t.boundingBox())!
    await page.mouse.move(tb.x + tb.width / 2, tb.y + 30)
    await page.mouse.wheel(120, 0)
    await expect.poll(() => t.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0)
    await expect(t).toHaveClass(/math-fade-l/)
    await shot(page, 'doc-420-table-scrolled')
    // 滚到头：右边的渐隐收掉
    await page.mouse.wheel(2000, 0)
    await expect(t).not.toHaveClass(/math-fade-r/)
    // 只看不改：文件一个字节不变
    expect(readFileSync(join(vault, '阅读/窄栏样张.md'), 'utf8')).toBe(doc)

    // 文档白板：收件箱是弹窗、不占宽（task-8isml），中栏 420 时白板占满这 420，顶上那条说明整条在白板里、× 在胶囊里面
    // （以前右边一格收件箱开着，白板只露 150 来宽，说明不出）
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const hint = pane(page).locator('.db-hint')
    await expect(hint).toBeVisible()
    await page.waitForTimeout(400)
    const wrap = (await pane(page).locator('.board-wrap').boundingBox())!
    const h = (await hint.boundingBox())!
    const x = (await hint.getByRole('button', { name: '收起这条说明' }).boundingBox())!
    expect(h.x).toBeGreaterThanOrEqual(wrap.x - 0.5)
    expect(h.x + h.width).toBeLessThanOrEqual(wrap.x + wrap.width + 0.5)
    expect(x.x + x.width).toBeLessThanOrEqual(h.x + h.width + 0.5)
    await shot(page, 'board-420-hint')
  } finally {
    await run.close()
  }
})

test('AI 栏 350、300 宽：输入框底下「谁来答 · 模型 · effort」不切半截，先藏快捷键提示，再让谁来答只留标志（悬停看名字）；拉宽回来名字又写全', async () => {
  const run = await launch({ 'a.md': '# a\n\n正文。\n' }, { CN_AI_FAKE: '1' }, look)
  const { page, app } = run
  const row = () =>
    page.evaluate(() => {
      const col = document.querySelector('[data-testid="ai-input"]')!.closest('.dview, aside') as HTMLElement
      const ft = document.querySelector('[data-testid="ai-input"] .ft') as HTMLElement
      const fr = ft.getBoundingClientRect()
      const picks = [...ft.querySelectorAll<HTMLElement>(':scope > .pick')].filter((k) => k.offsetWidth > 0)
      const lb = (id: string) => ft.querySelector<HTMLElement>(`[data-testid="${id}"] .lb`)!
      const shown = (id: string) => lb(id).offsetWidth > 0
      return {
        col: Math.round(col.getBoundingClientRect().width),
        /** 写出来但被省略的名字 */
        cut: ['ai-engine', 'ai-model', 'ai-effort'].filter((id) => shown(id) && lb(id).scrollWidth > lb(id).clientWidth + 0.5),
        outside: picks.filter((k) => k.getBoundingClientRect().right > fr.right + 0.5 || k.getBoundingClientRect().left < fr.left - 0.5).map((k) => k.className),
        engName: shown('ai-engine'),
        hint: (ft.querySelector('.k') as HTMLElement).offsetWidth > 0,
        engTip: ft.querySelector('[data-testid="ai-engine"]')!.getAttribute('data-tip'),
      }
    })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openAi(page)
    // 宽的时候（拉宽 180）：快捷键提示、三颗全名都在
    await widenRight(page, 180)
    await expect.poll(async () => (await row()).hint).toBe(true)
    let r = await row()
    expect(r.cut).toEqual([])
    expect(r.engName).toBe(true)
    for (const want of [350, 300]) {
      await widenRight(page, want - (await row()).col)
      await expect.poll(async () => (await row()).col).toBe(want)
      await page.waitForTimeout(200)
      await shot(page, `ai-${want}-row`)
      r = await row()
      expect(r.hint).toBe(false)
      expect(r.cut, `${want} 宽时被省略的`).toEqual([])
      expect(r.outside).toEqual([])
      expect(r.engName).toBe(false)
      expect(r.engTip).toMatch(/^谁来答：/)
    }
    // 300 宽时三个菜单各开一次：都在 AI 这一栏里（栏比菜单窄时菜单收到栏宽减 16）
    const col = (await page.locator('[data-testid="ai-input"]').evaluate((e) => {
      const r = e.closest('.dview, aside')!.getBoundingClientRect()
      return { x: r.left, y: r.top, width: r.width, height: r.height }
    }))!
    for (const id of ['ai-engine', 'ai-model', 'ai-effort']) {
      await page.getByTestId(id).click()
      const menu = page.locator('.aipk-menu')
      await expect(menu).toBeVisible()
      await page.waitForTimeout(150)
      await wholeVisible(menu, col)
      await shot(page, `ai-300-${id}`)
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
    }
    // 悬停谁来答（只留标志时）：提示「谁来答：…」
    await page.getByTestId('ai-engine').hover()
    await expect(page.locator('.shell-tip, [role="tooltip"]').filter({ hasText: /^谁来答：/ }).first()).toBeVisible()
    await shot(page, 'ai-300-engine-tip')
    // 拉宽回来：谁来答的名字又写全
    await widenRight(page, 460 - (await row()).col)
    await expect.poll(async () => (await row()).engName).toBe(true)
    expect((await row()).cut).toEqual([])
  } finally {
    await run.close()
  }
})
