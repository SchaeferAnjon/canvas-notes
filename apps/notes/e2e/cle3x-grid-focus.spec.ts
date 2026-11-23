/**
 * 数据库表格照 Notion 改手感（task-cle3x）：真按键走一遍「读过的论文」那张表。
 * 单击选中一格（蓝框）、方向键 / Tab 走格、回车 / 打字进编辑、Esc 退回、从正文进表出表、⌘C / ⌘V 一格、日期浮层、选项 ↑↓、
 * 表头吸顶、表在文档里放宽。每一步只是看、选中、进出编辑没改字的，库里一个字节不变（git status 干净）。
 */
import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, openNote, pane, type Running } from './app'
import { FILES, skin } from './papers'

test.setTimeout(240_000)

const COLS = ['file.name', '作者', '年份', '状态', '标签', '评分', '读完日期', '链接']
const db = (page: Page) => pane(page).locator('[data-part="数据库块"]').first()
const cell = (page: Page, row: number, col: string) => db(page).locator(`tbody td[data-row="${row}"][data-col="${col}"]`)
/** 选中的那一格：[第几行, 哪一列]；没有给 null */
const selected = (page: Page) =>
  page.evaluate(() => {
    const td = document.querySelector<HTMLElement>('.pane:not([hidden]) [data-part="数据库块"] td.cn-cell-sel')
    return td ? [Number(td.dataset.row), td.dataset.col!] : null
  })
const focusedCell = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    return a?.matches('td[data-row]') ? [Number(a.dataset.row), a.dataset.col!] : a ? a.tagName.toLowerCase() + '.' + a.className.split(' ')[0] : null
  })
const paper = (run: Running, title: string) => readFileSync(join(run.vault, '论文/读过的', title + '.md'), 'utf8')
const clean = (run: Running) => expect.poll(() => gitStatus(run.vault)).toBe('')
/** 光标在正文哪一行（焦点在编辑器上时） */
const cursorLine = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.pane:not([hidden]) .cm-content') as HTMLElement & { cmTile: { view: any } }
    const v = el.cmTile.view
    return `${v.hasFocus ? 'focus' : 'blur'}|${v.state.selection.main.empty ? '' : 'range'}|${v.state.doc.lineAt(v.state.selection.main.head).text}`
  })
/** 名字是这个的那一条现在显示在第几行（没排序时照文件名排） */
const rowOf = (page: Page, name: string) =>
  db(page)
    .locator('tbody td[data-col="file.name"]')
    .evaluateAll((tds, n) => Number((tds as HTMLElement[]).find((td) => td.querySelector('button')?.textContent === n)!.dataset.row), name)

async function open(dark = false) {
  const run = await launch(FILES, {}, skin(dark))
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
  await openNote(run.page, '读过的论文')
  await expect(db(run.page).locator('tbody tr')).toHaveCount(16)
  return run
}

test('单击选中、方向键和 Tab 走格、回车 / 再点进编辑、Esc 退回：没改字文件不变', async () => {
  const run = await open()
  const { page } = run
  try {
    await cell(page, 0, '作者').click()
    await expect.poll(() => selected(page)).toEqual([0, '作者'])
    await expect.poll(() => focusedCell(page)).toEqual([0, '作者'])
    // 单击只是选中，不进编辑
    await expect(db(page).locator('input.base-in')).toHaveCount(0)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => selected(page)).toEqual([0, '年份'])
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => selected(page)).toEqual([2, '年份'])
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowLeft')
    await expect.poll(() => selected(page)).toEqual([2, 'file.name'])
    await page.keyboard.press('Tab')
    await expect.poll(() => selected(page)).toEqual([2, '作者'])
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    // 行首 ⇧Tab 接上一行最后一格
    await expect.poll(() => selected(page)).toEqual([1, '链接'])
    await page.keyboard.press('Tab')
    await expect.poll(() => selected(page)).toEqual([2, 'file.name'])
    await page.keyboard.press('Meta+ArrowRight')
    await expect.poll(() => selected(page)).toEqual([2, '链接'])
    await page.keyboard.press('Meta+ArrowDown')
    await expect.poll(() => selected(page)).toEqual([15, '链接'])
    await page.keyboard.press('Meta+ArrowUp')
    await page.keyboard.press('Meta+ArrowLeft')
    await expect.poll(() => selected(page)).toEqual([0, 'file.name'])
    await clean(run)

    // 回车进编辑（框里是原来的字），Esc 退回选中这一格，不写
    const g = await rowOf(page, 'GLocks for Highly-Contended Locks')
    await cell(page, g, '作者').click()
    await page.keyboard.press('Enter')
    const box = db(page).locator('input.base-in')
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('Abellán, Fernández, Acacio')
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await expect.poll(() => selected(page)).toEqual([g, '作者'])
    await expect.poll(() => focusedCell(page)).toEqual([g, '作者'])
    // 回车进、回车出（没改字）：停在原格，不写
    await page.keyboard.press('Enter')
    await expect(box).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(box).toHaveCount(0)
    await expect.poll(() => selected(page)).toEqual([g, '作者'])
    // 已选中的再点一下进编辑；点别的格子：存（没改就不写）、选中点的那一格
    await cell(page, g, '作者').click()
    await expect(box).toBeFocused()
    await cell(page, 3, '作者').click()
    await expect(box).toHaveCount(0)
    await expect.poll(() => selected(page)).toEqual([3, '作者'])
    // 双击没选中的格子直接进编辑
    await cell(page, 4, '链接').dblclick()
    await expect(box).toBeFocused()
    await page.keyboard.press('Tab')
    await expect.poll(() => selected(page)).toEqual([5, 'file.name'])
    // 名字格回车进起名框，Esc 不改名
    const name5 = await cell(page, 5, 'file.name').locator('button').first().textContent()
    await page.keyboard.press('Enter')
    await expect(box).toHaveValue(name5!)
    await page.keyboard.press('Escape')
    await expect.poll(() => selected(page)).toEqual([5, 'file.name'])
    // 日期格回车出日期浮层，Esc 收起、回到这一格
    const a = await rowOf(page, 'Algorithms for Scalable Synchronization')
    await cell(page, a, '读完日期').click()
    await page.keyboard.press('Enter')
    const date = page.getByRole('dialog', { name: 'Algorithms for Scalable Synchronization · 读完日期' })
    await expect(date.getByRole('textbox')).toBeFocused()
    await expect(date.getByRole('textbox')).toHaveValue('2026-04-20')
    await page.keyboard.press('Escape')
    await expect(date).toHaveCount(0)
    await expect.poll(() => focusedCell(page)).toEqual([a, '读完日期'])
    // 选项格：回车出小框，Esc 收起
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => selected(page)).toEqual([a, '状态'])
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Algorithms for Scalable Synchronization · 状态' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect.poll(() => focusedCell(page)).toEqual([a, '状态'])
    // 点表外面：不选中
    await pane(page).locator('.cm-line', { hasText: '读完的写一段要点' }).click()
    await expect.poll(() => selected(page)).toBeNull()
    await clean(run)
  } finally {
    await run.close()
  }
})

test('打字进编辑、回车停在原格、Tab 存了走；退格清空；日期能打字', async () => {
  const run = await open()
  const { page } = run
  try {
    const n = await rowOf(page, 'NUMA An Overview')
    // 选中「作者」直接打字：打的字换掉原来的，回车写回，还停在这一格
    await cell(page, n, '作者').click()
    await page.keyboard.type('Christoph Lameter')
    await expect(db(page).locator('input.base-in')).toHaveValue('Christoph Lameter')
    await page.keyboard.press('Enter')
    await expect.poll(() => paper(run, 'NUMA An Overview')).toContain('作者: Christoph Lameter\n')
    await expect.poll(() => selected(page)).toEqual([n, '作者'])
    await expect.poll(() => focusedCell(page)).toEqual([n, '作者'])
    // 回车进编辑、改了按 Tab：存，走到右边一格
    await page.keyboard.press('Enter')
    await page.keyboard.press('End')
    await page.keyboard.type(' (SGI)')
    await page.keyboard.press('Tab')
    await expect.poll(() => paper(run, 'NUMA An Overview')).toContain('作者: Christoph Lameter (SGI)\n')
    await expect.poll(() => selected(page)).toEqual([n, '年份'])
    // 退格清空一格
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => selected(page)).toEqual([n, '评分'])
    await page.keyboard.press('Backspace')
    await expect.poll(() => paper(run, 'NUMA An Overview')).not.toContain('评分:')
    // 日期格直接打字：浮层开着、打的字在框里，回车写回
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('2026-05-01')
    const date = page.getByRole('dialog', { name: 'NUMA An Overview · 读完日期' })
    await expect(date.getByRole('textbox')).toHaveValue('2026-05-01')
    await page.keyboard.press('Enter')
    await expect.poll(() => paper(run, 'NUMA An Overview')).toContain('读完日期: 2026-05-01\n')
    await expect.poll(() => focusedCell(page)).toEqual([n, '读完日期'])
    // 点月历上的一天
    await page.keyboard.press('Enter')
    await date.getByRole('button', { name: /^5月3日/ }).click()
    await expect.poll(() => paper(run, 'NUMA An Overview')).toContain('读完日期: 2026-05-03\n')
  } finally {
    await run.close()
  }
})

test('从正文进表、出表：↓ 选中整块再 ↓ 进第一行，第一行 ↑ 回正文，Esc 退回整块，回车再进；从下面 ↑ 进最后一行', async () => {
  const run = await open()
  const { page } = run
  try {
    await pane(page).locator('.cm-line', { hasText: '这学期读的' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('.cm-blkSelLayer > *')).toHaveCount(1)
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => focusedCell(page)).toEqual([0, 'file.name'])
    await expect(page.locator('.cm-blkSelLayer > *')).toHaveCount(0)
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => selected(page)).toBeNull()
    await expect.poll(() => cursorLine(page)).toBe('focus||这学期读的体系结构论文，读完打分。')
    // 再进去，Esc 退回选中整块，回车再进
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => focusedCell(page)).toEqual([0, 'file.name'])
    await page.keyboard.press('Escape')
    await expect.poll(() => selected(page)).toBeNull()
    await expect(page.locator('.cm-blkSelLayer > *')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect.poll(() => focusedCell(page)).toEqual([0, 'file.name'])
    // 最后一行 ↓ 出到下面一段
    await page.keyboard.press('Meta+ArrowDown')
    await expect.poll(() => selected(page)).toEqual([15, 'file.name'])
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => cursorLine(page)).toBe('focus||读完的写一段要点。')
    // 从下面 ↑：先选中整块，再 ↑ 进最后一行；↓ 照旧回到下面
    await page.keyboard.press('ArrowUp')
    await expect(page.locator('.cm-blkSelLayer > *')).toHaveCount(1)
    await page.keyboard.press('ArrowUp')
    await expect.poll(() => focusedCell(page)).toEqual([15, 'file.name'])
    await clean(run)
  } finally {
    await run.close()
  }
})

test('⌘C / ⌘V 复制粘贴一格，贴一块制表符隔开的字往右下铺；数字列不收字', async () => {
  const run = await open()
  const { page, app } = run
  try {
    const [al, ef, nu, hw] = await Promise.all(['Algorithms for Scalable Synchronization', 'Efficient Synchronization Let Them Eat QOLB', 'NUMA An Overview', 'How to Make a Multiprocessor Computer'].map((x) => rowOf(page, x))) as [number, number, number, number]
    // 贴两行：How to Make… 和它下面显示的那一条
    const below = await db(page).locator(`tbody td[data-row="${hw + 1}"][data-col="file.name"] button`).first().textContent()
    await cell(page, al, '年份').click()
    await page.keyboard.press('Meta+c')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('1991')
    await clean(run)
    await cell(page, ef, '年份').click()
    await page.keyboard.press('Meta+v')
    await expect.poll(() => paper(run, 'Efficient Synchronization Let Them Eat QOLB')).toContain('年份: 1991\n')
    await expect.poll(() => selected(page)).toEqual([ef, '年份'])
    // 多选复制出来是「a, b」，贴进另一行的多选写成 [a, b]
    await cell(page, al, '标签').click()
    await page.keyboard.press('Meta+c')
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe('锁, 同步')
    await cell(page, nu, '标签').click()
    await page.keyboard.press('Meta+v')
    await expect.poll(() => paper(run, 'NUMA An Overview')).toContain('标签: [锁, 同步]\n')
    // 数字列贴字：说一句，不写
    const before = paper(run, 'NUMA An Overview')
    await app.evaluate(({ clipboard }) => clipboard.writeText('很好'))
    await cell(page, nu, '评分').click()
    await page.keyboard.press('Meta+v')
    await expect(page.getByText('「评分」这一列收不了「很好」')).toBeVisible()
    expect(paper(run, 'NUMA An Overview')).toBe(before)
    // 从别的表格软件复制的两行两格：从选中的格往右下铺
    await app.evaluate(({ clipboard }) => clipboard.writeText('Lamport L.\t1978\nLi K.\t1988\n'))
    await cell(page, hw, '作者').click()
    await page.keyboard.press('Meta+v')
    await expect.poll(() => paper(run, 'How to Make a Multiprocessor Computer')).toContain('作者: Lamport L.\n年份: 1978\n')
    await expect.poll(() => paper(run, below!)).toContain('作者: Li K.\n年份: 1988\n')
  } finally {
    await run.close()
  }
})

test('表在文档里放宽（8 列不横着滑）、表头吸顶（文档里、整页打开）；选项小框 ↑ ↓ 回车', async () => {
  const run = await open()
  const { page } = run
  try {
    // 8 列：表比正文宽，伸到栏宽，表里不横着滚
    const m = await db(page).evaluate((el) => {
      const w = el.closest('.cm-base') as HTMLElement
      const content = w.parentElement!.getBoundingClientRect()
      const body = (w.closest('.body') as HTMLElement).getBoundingClientRect()
      const sc = el.querySelector('.base-scroll') as HTMLElement
      const r = el.getBoundingClientRect()
      return { wide: Math.round(r.width - content.width), inBody: r.left >= body.left && r.right <= body.right, scroll: sc.scrollWidth - sc.clientWidth }
    })
    expect(m.wide).toBeGreaterThan(100)
    expect(m.inBody).toBe(true)
    expect(m.scroll).toBeLessThanOrEqual(1)
    await clean(run)

    // 多选：回车出小框，↓ 挪一项（亮着），回车加上它
    const r = await rowOf(page, 'Roofline')
    await cell(page, r, '标签').click()
    await page.keyboard.press('Enter')
    const opts = page.getByRole('dialog', { name: 'Roofline · 标签' })
    await expect(opts.locator('button.kb')).toHaveCount(1)
    const first = await opts.locator('button.kb').textContent()
    await page.keyboard.press('ArrowDown')
    const second = (await opts.locator('button.kb').textContent())!.trim()
    expect(second).not.toBe(first)
    await page.keyboard.press('Enter')
    if (second !== '性能模型') await expect.poll(() => paper(run, 'Roofline')).toContain(second)
    await page.keyboard.press('Escape')
    await expect.poll(() => focusedCell(page)).toEqual([r, '标签'])

    // 表头吸顶：120 条的表，文档往下滚，表头贴着栏顶；整页打开也一样
    await openNote(page, '很多行')
    await expect(db(page).locator('tbody tr')).toHaveCount(50)
    const stuck = (sel: string, scroller: string) =>
      page.evaluate(
        ([sel, scroller]) => {
          const t = document.querySelector(sel!) as HTMLTableElement
          const s = document.querySelector(scroller!) as HTMLElement
          return { stuck: t.dataset.stuck !== undefined, gap: Math.abs(Math.round(t.tHead!.rows[0]!.cells[0]!.getBoundingClientRect().top - s.getBoundingClientRect().top)) }
        },
        [sel, scroller],
      )
    const inline = '.pane:not([hidden]) [data-part="数据库块"] .base-scroll > table'
    const body = '.pane:not([hidden]) > .body'
    expect((await stuck(inline, body)).stuck).toBe(false)
    await page.evaluate((b) => (document.querySelector(b) as HTMLElement).scrollBy(0, 1200), body)
    await expect.poll(() => stuck(inline, body)).toEqual({ stuck: true, gap: 0 })
    await db(page).getByRole('button', { name: '整页打开' }).click()
    await expect(page.locator('.base-full tbody tr')).toHaveCount(120)
    await page.evaluate(() => (document.querySelector('.base-full') as HTMLElement).scrollBy(0, 2000))
    await expect.poll(() => stuck('.base-full .base-scroll > table', '.base-full')).toEqual({ stuck: true, gap: 0 })
  } finally {
    await run.close()
  }
})

test('选中一格直接用中文输入法打字：选字的过程就在编辑框里，上屏的字写进这一格', async () => {
  const run = await open()
  const { page } = run
  try {
    const n = await rowOf(page, 'NUMA An Overview')
    await cell(page, n, '作者').click()
    // 输入法按下第一个键：keydown 是 Process（229），接着开始选字、上屏
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', code: 'KeyL', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 })
    await cdp.send('Input.imeSetComposition', { text: 'la', selectionStart: 2, selectionEnd: 2 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Process', code: 'KeyL', windowsVirtualKeyCode: 229 })
    const box = db(page).locator('input.base-in')
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('la')
    await cdp.send('Input.insertText', { text: '拉梅特' })
    await expect(box).toHaveValue('拉梅特')
    await page.keyboard.press('Enter')
    await expect.poll(() => paper(run, 'NUMA An Overview')).toContain('作者: 拉梅特\n')
    await expect.poll(() => focusedCell(page)).toEqual([n, '作者'])
  } finally {
    await run.close()
  }
})
