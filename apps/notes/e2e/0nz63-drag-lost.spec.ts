/**
 * task-0nz63 第二步：松手丢在窗口外（透明窗口外松手，页面收不到 mouseup / pointerup，之后只来按键已松开的移动）。
 * 以前每处拖动都只等松手才收，拖影、框、落点线留在屏上跟着鼠标走。现在都走 @cn/design/drag-end 的 trackDrag：
 * 挪内容、写文件的当没拖过（像 Esc，文件一个字节不变）；只改看法的（框选、平移、拉宽）停在最后按着时的样子。
 * 每一类拖动一条，真鼠标（e2e/lost-release.ts，CDP 送的鼠标事件），改前红、改后绿。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openAi, openNote, pane, type Running } from './app'
import { board as docBoard, openBoard } from './fixtures/board-doc'
import { BOARD, BOARD_PATH, FILES as BOARD_FILES } from './fixtures/board-select'
import { MAP, MAP_PATH, mapFiles } from './fixtures/mindmap-b1'
import { LECTURE } from './fixtures/pdf'
import { realMouse } from './lost-release'

const read = (run: Running, p: string) => readFileSync(join(run.vault, p), 'utf8')
const box = async (l: Locator) => (await l.boundingBox())!
const settle = (page: Page) => page.waitForTimeout(250)

test('文档：按把手拖一块，松手丢在窗口外——拖影、落点线收掉，块不挪、不出块菜单，文件不变；之后正常拖照旧挪', async () => {
  const md = '# 清单\n\n第一段\n\n第二段\n\n第三段\n'
  const run = await launch({ '清单.md': md })
  const { page } = run
  const line = (t: string) => pane(page).locator('.cm-line', { hasText: t }).first()
  try {
    await openNote(page, '清单')
    const m = await realMouse(page)
    const ghost = page.getByTestId('blk-ghost')
    const grab = async () => {
      const b = await box(line('第一段'))
      await m.move(b.x + 40, b.y + b.height / 2)
      await m.move(b.x + 60, b.y + b.height / 2)
      const grip = pane(page).locator('.blk-bar:not([hidden]) .blk-grip')
      await expect(grip).toBeVisible()
      const g = await box(grip)
      await m.down(g.x + g.width / 2, g.y + g.height / 2)
      const t = await box(line('第三段'))
      await m.drag(g.x + 40, t.y - 6, 8)
      await m.drag(t.x + 80, t.y + t.height - 2, 6)
      await expect(ghost).toBeVisible()
      return t
    }
    const t = await grab()
    await m.lost(t.x + 300, t.y + 120)
    await expect(ghost).toHaveCount(0)
    await m.move(t.x + 120, t.y - 60, 4)
    await settle(page)
    await expect(ghost).toHaveCount(0)
    await expect(pane(page).locator('.blk-faded')).toHaveCount(0)
    await expect(page.getByRole('menu', { name: '块菜单' })).toHaveCount(0)
    expect(await editorText(page)).toBe(md)
    expect(read(run, '清单.md')).toBe(md)
    // 正常拖一次：照旧挪过去
    await grab()
    await m.up()
    await expect.poll(() => editorText(page)).toBe('# 清单\n\n第二段\n\n第三段\n\n第一段\n')
  } finally {
    await run.close()
  }
})

test('白板：拖一张卡、空白处框选、中键平移，松手都丢在窗口外——卡回原处、框收掉碰到的照样选着、平移停在那里；鼠标再动什么都不跟；文件不变', async () => {
  const run = await launch(BOARD_FILES)
  const { page } = run
  const card = (id: string) => docBoard(page).locator(`.db-card[data-id="${id}"]`)
  const selIds = () => docBoard(page).locator('.db-card.sel').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id).sort())
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openBoard(page, '学习笔记：动手学深度学习')
    await expect(card('f5')).toBeVisible()
    const m = await realMouse(page)

    // 拖卡
    const f3 = await box(card('f3'))
    await m.down(f3.x + 60, f3.y + 20)
    await m.drag(f3.x + 80, f3.y + 40, 4)
    await m.drag(f3.x + 160, f3.y + 120, 10)
    await expect(card('f3')).toHaveClass(/\bdragging\b/)
    await m.lost(f3.x + 400, f3.y + 300)
    await expect(card('f3')).not.toHaveClass(/\bdragging\b/)
    await m.move(f3.x + 250, f3.y + 200, 4)
    await settle(page)
    await expect(card('f3')).not.toHaveClass(/\bdragging\b/)
    const back = await box(card('f3'))
    expect(Math.round(back.x - f3.x)).toBe(0)
    expect(Math.round(back.y - f3.y)).toBe(0)

    // 框选
    await page.keyboard.press("Escape")
    const a = await box(card('f1'))
    const c = await box(card('f3'))
    await m.down(a.x - 24, a.y - 24)
    await m.drag(c.x + 30, c.y + 30, 12)
    const marq = page.getByTestId('db-marquee')
    await expect(marq).toBeVisible()
    await expect.poll(selIds).toEqual(['f1', 'f2', 'f3'])
    await m.lost(c.x + 400, c.y + 300)
    await expect(marq).toHaveCount(0)
    await m.move(a.x - 60, a.y - 60, 4)
    await settle(page)
    await expect(marq).toHaveCount(0)
    expect(await selIds()).toEqual(['f1', 'f2', 'f3'])

    // 中键平移
    const wrap = docBoard(page).locator('.board-wrap')
    // 起点是四周多出的空白那里（board-slack.ts，data-home）：从起点往右下滚一点
    const [hx, hy] = (await wrap.getAttribute('data-home'))!.split(',').map(Number) as [number, number]
    await wrap.evaluate((w, [x, y]) => w.scrollTo(x!, y!), [hx + 200, hy + 150])
    const p = await box(card('f3'))
    await m.down(p.x + 40, p.y + 20, 'middle')
    await m.drag(p.x + 140, p.y + 100, 8)
    const s1 = await wrap.evaluate((w) => ({ x: w.scrollLeft, y: w.scrollTop }))
    expect(s1).toEqual({ x: hx + 100, y: hy + 70 })
    await m.lost(p.x + 300, p.y + 300)
    await m.move(p.x - 100, p.y - 100, 4)
    await settle(page)
    expect(await wrap.evaluate((w) => ({ x: w.scrollLeft, y: w.scrollTop }))).toEqual(s1)
    expect(read(run, BOARD_PATH)).toBe(BOARD)
  } finally {
    await run.close()
  }
})

const ROOMS = '```base\nfilters:\n  and:\n    - file.inFolder("冰岛旅行/住宿")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 价格\n      - 评分\n```'
const ROOM_FILES: Record<string, string> = {
  '冰岛行程.md': `# 冰岛行程\n\n## 住哪\n\n${ROOMS}\n\n后面一段。\n`,
  '冰岛旅行/住宿/雷克雅未克 · Loft.md': '---\n价格: 1080\n评分: 9.1\n---\n',
  '冰岛旅行/住宿/维克 · 黑沙滩旅馆.md': '---\n价格: 980\n评分: 8.6\n---\n',
}

test('数据库表：拖列宽、拖列头换顺序，松手丢在窗口外——列宽回原样、先后不变，文件不变；鼠标再动不跟', async () => {
  const run = await launch(ROOM_FILES)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '冰岛行程')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)
    const m = await realMouse(page)
    const th = (name: string) => db.locator('thead th.col').filter({ has: page.getByRole('button', { name, exact: true }) })

    // 列宽
    const w0 = (await box(th('评分'))).width
    const h = await box(db.getByRole('separator', { name: '拖动改「评分」的列宽' }))
    await m.down(h.x + h.width / 2, h.y + h.height / 2)
    await m.drag(h.x + 60, h.y + h.height / 2, 6)
    await expect.poll(async () => Math.round((await box(th('评分'))).width - w0)).toBeGreaterThan(40)
    await m.lost(h.x + 260, h.y + 200)
    await expect.poll(async () => Math.round((await box(th('评分'))).width)).toBe(Math.round(w0))
    await m.move(h.x + 120, h.y + 10, 4)
    await settle(page)
    expect(Math.round((await box(th('评分'))).width)).toBe(Math.round(w0))

    // 列头换顺序：「评分」拖到「价格」前面
    const from = await box(th('评分'))
    const to = await box(th('价格'))
    await m.down(from.x + 20, from.y + from.height / 2)
    await m.drag(to.x + 10, to.y + to.height / 2, 8)
    await expect(th('评分')).toHaveClass(/\bmoving\b/)
    await m.lost(to.x - 200, to.y + 300)
    await expect(th('评分')).not.toHaveClass(/\bmoving\b/)
    await m.move(to.x + 5, to.y + to.height / 2, 4)
    await settle(page)
    await expect(db.locator('thead th.col')).toHaveText(['名字', '价格', '评分'])
    await expect(page.getByRole('menu')).toHaveCount(0)
    expect(read(run, '冰岛行程.md')).toBe(ROOM_FILES['冰岛行程.md'])
  } finally {
    await run.close()
  }
})

test('左栏文件树：空白处往上框选，松手丢在窗口外——框收掉，碰到的行照样选着；鼠标再动不改选', async () => {
  const files: Record<string, string> = { '收件箱/一.md': '# 一\n', '收件箱/二.md': '# 二\n', '周记/周一.md': '# 周一\n', '写作/草稿.md': '# 草稿\n' }
  const run = await launch(files)
  const { page } = run
  const side = page.locator('aside.side')
  const tree = side.getByRole('tree')
  try {
    const files = page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true })
    if ((await files.getAttribute('aria-pressed')) !== 'true') await files.click()
    await expect(tree.getByRole('treeitem').first()).toBeVisible()
    const m = await realMouse(page)
    const t = await box(tree)
    const rows = tree.getByRole('treeitem')
    const last = await box(rows.last())
    const first = await box(rows.first())
    await m.down(t.x + 120, last.y + last.height + 30)
    await m.drag(t.x + 130, first.y + 4, 8)
    const lasso = tree.locator('.ft-lasso')
    await expect(lasso).toBeVisible()
    const bar = side.getByRole('toolbar', { name: '选中的' })
    await expect(bar.locator('b')).toHaveText(/^已选\d+个$/)
    const picked = await bar.locator('b').textContent()
    await m.lost(t.x + 500, last.y + 200)
    await expect(lasso).toHaveCount(0)
    await m.move(t.x + 130, last.y + last.height + 20, 4)
    await settle(page)
    await expect(lasso).toHaveCount(0)
    await expect(bar.locator('b')).toHaveText(picked!)
  } finally {
    await run.close()
  }
})

test('分栏拖条：左栏右边的线、中间和右栏之间的线，松手丢在窗口外——停在最后拖到的宽，鼠标再动不跟', async () => {
  const run = await launch({ '写作/草稿.md': '# 草稿\n\n写点什么。\n' })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    const m = await realMouse(page)
    const side = page.locator('aside.side')
    // 左栏
    const sash = await box(page.getByRole('separator', { name: '拖动调整左栏宽度' }))
    await m.down(sash.x + sash.width / 2, sash.y + 200)
    await m.drag(sash.x + 60, sash.y + 200, 6)
    const w1 = Math.round((await box(side)).width)
    await m.lost(sash.x + 200, sash.y + 260)
    await m.move(sash.x - 40, sash.y + 260, 4)
    await settle(page)
    expect(Math.round((await box(side)).width)).toBe(w1)
    await expect(page.locator('body')).not.toHaveClass(/\bresizing\b/)

    // 右栏（AI）和中间之间
    await openAi(page)
    const right = page.getByRole('separator', { name: '拖动调整右栏宽度' })
    await expect(right).toBeVisible()
    const r = await box(right)
    const col = page.locator('.dcol').last()
    await m.down(r.x + r.width / 2, r.y + 200)
    await m.drag(r.x - 80, r.y + 200, 8)
    const c1 = Math.round((await box(col)).width)
    await m.lost(r.x - 300, r.y + 300)
    await m.move(r.x + 60, r.y + 200, 4)
    await settle(page)
    expect(Math.round((await box(col)).width)).toBe(c1)
    await expect(page.locator('body')).not.toHaveClass(/\bresizing\b/)
  } finally {
    await run.close()
  }
})

test('待办：拖一条到周条上某一天，松手丢在窗口外——小卡、落点亮圈收掉，日子不改，文件不变', async () => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const WTODO = `# 待办\n\n- [ ] 改第二章的开头 📅 ${day(2)}\n- [ ] 给编辑发邮件 📅 ${day(3)} 10:00\n`
  const run = await launch({ '写作/待办.md': WTODO })
  const { page } = run
  try {
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '待办', exact: true }).click()
    const home = pane(page).getByTestId('todo-home')
    const target = home.locator('.tdh-wk').locator(`[data-day="${day(4)}"]`)
    await expect(target).toBeVisible()
    const m = await realMouse(page)
    const a = await box(home.locator('.td-r').filter({ hasText: '改第二章的开头' }).first())
    const b = await box(target)
    await m.down(a.x + 80, a.y + a.height / 2)
    await m.drag(a.x + 90, a.y + a.height / 2 - 6, 3)
    await m.drag(b.x + b.width / 2, b.y + b.height / 2, 12)
    await expect(target).toHaveClass(/over/)
    await expect(page.locator('.td-ghost')).toBeVisible()
    await m.lost(b.x + 300, b.y + 300)
    await expect(page.locator('.td-ghost')).toHaveCount(0)
    await m.move(b.x + b.width / 2, b.y + b.height / 2, 4)
    await settle(page)
    await expect(page.locator('.td-ghost')).toHaveCount(0)
    await expect(page.locator('[data-drop].over')).toHaveCount(0)
    await expect(page.locator('.td-r.dragging')).toHaveCount(0)
    expect(read(run, '写作/待办.md')).toBe(WTODO)
  } finally {
    await run.close()
  }
})

test('导图：拖一个主题，松手丢在窗口外——拖影、插入线收掉，主题不挪，文件不变', async () => {
  const run = await launch(mapFiles(), { CN_AI_FAKE: '1' })
  const { page } = run
  const board = pane(page).getByTestId('board')
  const node = (text: string) => board.locator('.mm-node', { has: page.locator('.t', { hasText: new RegExp(`^${text.replace(/[()+=.*?[\]\\^$|]/g, '\\$&')}$`) }) })
  try {
    await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
    await expect(board.locator('.mm-node')).toHaveCount(16)
    const m = await realMouse(page)
    const from = await box(node('秩-零化度定理'))
    const ker = await box(node('ker T 映到 0'))
    await m.down(from.x + 10, from.y + from.height / 2)
    await m.drag(ker.x + 40, ker.y + 20, 6)
    await m.drag(ker.x + 40, ker.y + 2, 3)
    await expect(page.getByTestId('map-drag-ghost')).toBeVisible()
    await m.lost(ker.x + 400, ker.y + 300)
    await expect(page.getByTestId('map-drag-ghost')).toHaveCount(0)
    await m.move(ker.x + 40, ker.y + 2, 4)
    await settle(page)
    await expect(page.getByTestId('map-drag-ghost')).toHaveCount(0)
    await expect(board.getByTestId('map-insert-line')).toHaveCount(0)
    expect(read(run, MAP_PATH)).toBe(MAP)
  } finally {
    await run.close()
  }
})

test('PDF：框一块，松手丢在窗口外——不出框、不截图、不开 AI；鼠标再动不画框', async () => {
  const PDF = '课程/线性代数/第3讲 线性映射.pdf'
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  const pdfPane = page.locator('.pdfpane:not([hidden])')
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(pdfPane.locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    const pg = pdfPane.locator('.pdfpage[data-page="3"]')
    await pg.scrollIntoViewIfNeeded()
    const b = await box(pg)
    const m = await realMouse(page)
    await m.down(b.x + b.width * 0.08, b.y + b.height * 0.25)
    await m.drag(b.x + b.width * 0.34, b.y + b.height * 0.33, 4)
    await m.drag(b.x + b.width * 0.6, b.y + b.height * 0.42, 4)
    const view = pdfPane.getByTestId('pdf-view')
    await expect(view).toHaveClass(/\bdrawing\b/)
    await m.lost(b.x + b.width * 0.9, b.y + b.height * 0.8)
    await expect(view).not.toHaveClass(/\bdrawing\b/)
    await m.move(b.x + b.width * 0.3, b.y + b.height * 0.3, 4)
    await settle(page)
    await expect(view).not.toHaveClass(/\bdrawing\b/)
    await expect(pdfPane.getByTestId('pdf-box')).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: '边读边问 AI' }).getByTestId('reading-att')).toHaveCount(0)
  } finally {
    await run.close()
  }
})
