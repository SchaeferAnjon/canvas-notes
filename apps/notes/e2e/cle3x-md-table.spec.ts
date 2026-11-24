/**
 * 文档里的普通表格照 Notion 补手感（task-cle3x）：真按键、真拖一项一项走。
 * 硬规矩：只看、选中、进出格子不改字时文件一字节不变（git status 干净）；改了一格只动那一格那一行；每样改动一次 ⌘Z 撤回。
 */
import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, openNote, pane, type Running, waitSaved } from './app'

test.setTimeout(180_000)

const TRIP = `| 日期 | 路线 | 距离 | 纯车程 | 冬季估算 |
|---|---|---|---|---|
| 2.24 周三 | 机场 → 塞尔福斯 | 97 km | 1.5 h | 1.9 h |
| 2.25 周四 | 塞尔福斯 → 黄金圈 → 赫沃斯沃德勒 | 215 km | 3.4 h | 4.3 h |
| 2.26 周五 | 赫沃斯沃德勒 → 南海岸 → 冰河湖 | 301 km | 4.5 h | 5.6 h |
| 合计 |  | 613 km | 9.4 h | 11.8 h |`
const NOTE = `# 冰岛自驾行程\n\n下面这张表用来对照普通表格的手感。\n\n${TRIP}\n\n距离和纯车程是用 OSM 路网算的。\n`
/** 手排过对齐空格、带对齐冒号的表（别的软件、格式化工具写的）：改一格不能重排整张表 */
const PADDED = `# 排过的表\n\n| 城市       | 人口   |\n|:-----------|-------:|\n| 雷克雅未克 | 14 万  |\n| 阿克雷里   | 2 万   |\n\n后面一段。\n`

const table = (page: Page) => pane(page).locator('[data-part="表格"]').first()
const cell = (page: Page, row: number, col: number) => table(page).locator(`[data-row="${row}"][data-col="${col}"]`)
const file = (run: Running, name = '冰岛自驾行程.md') => readFileSync(join(run.vault, name), 'utf8')
const clean = (run: Running) => expect.poll(() => gitStatus(run.vault), { timeout: 8000 }).toBe('')
/** 两篇哪几行不一样（行号从 0 数） */
const changed = (a: string, b: string) => {
  const A = a.split('\n')
  const B = b.split('\n')
  return Array.from({ length: Math.max(A.length, B.length) }, (_, i) => i).filter((i) => A[i] !== B[i])
}
/** 焦点在哪：输入框 [行, 列, 'edit']，选中的格子 [行, 列, 'sel']，别的给标签名 */
const focus = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    const td = a?.closest('td,th') as HTMLElement | null
    if (td?.dataset.row !== undefined && td.closest('[data-part="表格"]')) return [Number(td.dataset.row), Number(td.dataset.col), a!.tagName === 'INPUT' ? 'edit' : 'sel']
    return a ? a.tagName.toLowerCase() + '.' + String(a.className).split(' ')[0] : null
  })
const selected = (page: Page) => page.evaluate(() => Array.from(document.querySelectorAll('.pane:not([hidden]) [data-part="表格"] .cn-cell-sel'), (e) => [Number((e as HTMLElement).dataset.row), Number((e as HTMLElement).dataset.col)]))
/** 编辑器光标那一行的字 */
const cursorLine = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector('.pane:not([hidden]) .cm-content') as HTMLElement & { cmTile: { view: { state: { doc: { lineAt(p: number): { text: string } }; selection: { main: { head: number } } }; hasFocus: boolean } } }
    const v = el.cmTile.view
    return (v.hasFocus ? '' : '(blur)') + v.state.doc.lineAt(v.state.selection.main.head).text
  })
/** 不碰系统剪贴板：往焦点上发一个带 DataTransfer 的 paste 事件（走软件自己的粘贴处理） */
const paste = (page: Page, data: Record<string, string>) =>
  page.evaluate((d) => {
    const dt = new DataTransfer()
    for (const [k, v] of Object.entries(d)) dt.setData(k, v)
    ;(document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, data)
const copy = (page: Page) =>
  page.evaluate(() => {
    const dt = new DataTransfer()
    ;(document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }))
    return dt.getData('text/plain')
  })

async function open(files: Record<string, string> = { '冰岛自驾行程.md': NOTE, '排过的表.md': PADDED }, title = '冰岛自驾行程') {
  const run = await launch(files)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
  await openNote(run.page, title)
  await expect(table(run.page).locator('tbody tr')).toHaveCount(title === '冰岛自驾行程' ? 4 : 2)
  return run
}

/** 悬停一格，按它那一行 / 列的把手 */
async function grip(page: Page, kind: 'row' | 'col', row: number, col: number) {
  await cell(page, row, col).hover()
  const g = pane(page).locator(kind === 'row' ? '.tbl-rgrip' : '.tbl-cgrip')
  await expect(g).toBeVisible()
  return g
}

test('走格：点一格、方向键、←→ 跨格、Esc 选中、选中后方向键 / 回车 / Esc 出表；只看不改字文件一字节不变', async () => {
  const run = await open()
  const { page } = run
  try {
    await cell(page, 0, 1).click()
    expect(await focus(page)).toEqual([0, 1, 'edit'])
    await page.keyboard.press('ArrowDown')
    expect(await focus(page)).toEqual([1, 1, 'edit'])
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    expect(await focus(page)).toEqual([-1, 1, 'edit'])
    // 字末尾按 → 到右边一格，光标在开头；开头按 ← 回来
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowRight')
    expect(await focus(page)).toEqual([-1, 2, 'edit'])
    expect(await page.evaluate(() => (document.activeElement as HTMLInputElement).selectionStart)).toBe(0)
    await page.keyboard.press('ArrowLeft')
    expect(await focus(page)).toEqual([-1, 1, 'edit'])
    // 字中间的 ← → 只挪光标
    await page.keyboard.press('ArrowLeft')
    expect(await focus(page)).toEqual([-1, 1, 'edit'])
    // Tab 横着走，行尾接下一行
    await cell(page, 0, 4).click()
    await page.keyboard.press('Tab')
    expect(await focus(page)).toEqual([1, 0, 'edit'])
    await page.keyboard.press('Shift+Tab')
    expect(await focus(page)).toEqual([0, 4, 'edit'])
    // Esc：停下、这一格选中（蓝框）
    await page.keyboard.press('Escape')
    expect(await focus(page)).toEqual([0, 4, 'sel'])
    expect(await selected(page)).toEqual([[0, 4]])
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowDown')
    expect(await selected(page)).toEqual([[1, 3]])
    expect(await focus(page)).toEqual([1, 3, 'sel'])
    await page.keyboard.press('Meta+ArrowUp')
    expect(await selected(page)).toEqual([[-1, 3]])
    // 回车进改字，Esc 又回选中
    await page.keyboard.press('Enter')
    expect(await focus(page)).toEqual([-1, 3, 'edit'])
    await page.keyboard.press('Escape')
    expect(await focus(page)).toEqual([-1, 3, 'sel'])
    // 表头再 ↑：出表回到上面一段
    await page.keyboard.press('ArrowUp')
    expect(await cursorLine(page)).toBe('下面这张表用来对照普通表格的手感。')
    expect(await selected(page)).toEqual([])
    // 正文 ↓ 走到表上（整块选中），再 ↓ 进表头第一格
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    expect(await focus(page)).toEqual([-1, 0, 'sel'])
    // 最后一行 ↓ 出表到下面一段
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.press('ArrowDown')
    expect(await cursorLine(page)).toBe('距离和纯车程是用 OSM 路网算的。')
    // 下面一段 ↑ 回到表上，再 ↑ 进最后一行
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    expect(await focus(page)).toEqual([3, 0, 'sel'])
    // Esc 回正文
    await page.keyboard.press('Escape')
    expect(await selected(page)).toEqual([])
    // 悬停出把手，开菜单再 Esc 关掉
    await (await grip(page, 'row', 1, 2)).click()
    await expect(page.getByRole('menu', { name: '行菜单' })).toBeVisible()
    // 菜单开着：那一行五格盖一层强调色
    await expect(table(page).locator('.tbl-hot')).toHaveCount(5)
    await page.keyboard.press('Escape')
    await expect(table(page).locator('.tbl-hot')).toHaveCount(0)
    // 表头那一行不出行把手（挪不了，也不和块把手挤在一起），列把手照出
    await cell(page, -1, 0).hover()
    await expect(pane(page).locator('.tbl-cgrip')).toBeVisible()
    await expect(pane(page).locator('.tbl-rgrip')).toBeHidden()
    await (await grip(page, 'col', 1, 2)).click()
    await expect(page.getByRole('menu', { name: '列菜单' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect(file(run)).toBe(NOTE)
    await clean(run)
  } finally {
    await run.close()
  }
})

test('改一格只动那一格那一行（手排过空格的表不重排）；选中直接打字换掉、退格清空；⌘C 一格', async () => {
  const run = await open(undefined, '排过的表')
  const { page } = run
  try {
    const before = file(run, '排过的表.md')
    await cell(page, 0, 1).click()
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('15 万')
    await page.keyboard.press('Escape')
    await waitSaved(page)
    const after = file(run, '排过的表.md')
    expect(changed(before, after)).toEqual([4])
    expect(after.split('\n')[4]).toBe('| 雷克雅未克 | 15 万 |')
    // 别的行（对齐空格、:---- 冒号）原样
    expect(after.split('\n')[3]).toBe('|:-----------|-------:|')
    expect(after.split('\n')[5]).toBe('| 阿克雷里   | 2 万   |')
    // 选中这一格：⌘C 拷出这一格的字
    expect(await focus(page)).toEqual([0, 1, 'sel'])
    expect(await copy(page)).toBe('15 万')
    // 直接打字：换掉这一格
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('3 万')
    expect(await focus(page)).toEqual([1, 1, 'edit'])
    await page.keyboard.press('Enter')
    await waitSaved(page)
    expect(file(run, '排过的表.md').split('\n')[5]).toBe('| 阿克雷里   | 3 万 |')
    // 退格清空选中的一格
    await page.keyboard.press('Escape')
    await cell(page, 1, 0).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(file(run, '排过的表.md').split('\n')[5]).toBe('|  | 3 万 |')
    // ⌘Z 撤回（焦点在选中的格子上）
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run, '排过的表.md').split('\n')[5]).toBe('| 阿克雷里   | 3 万 |')
  } finally {
    await run.close()
  }
})

test('行把手：上面 / 下面加一行、删掉这一行，拖着挪行；每一步只动那几行，⌘Z 撤回', async () => {
  const run = await open()
  const { page } = run
  try {
    await (await grip(page, 'row', 0, 1)).click()
    await page.getByRole('menuitem', { name: '下面加一行' }).click()
    await expect(table(page).locator('tbody tr')).toHaveCount(5)
    // 新的一行：光标在它第一格，直接打字
    expect(await focus(page)).toEqual([1, 0, 'edit'])
    await page.keyboard.type('2.24 晚上')
    await page.keyboard.press('Escape')
    await waitSaved(page)
    const one = file(run)
    expect(changed(NOTE, one)).toEqual([7, 8, 9, 10, 11, 12, 13])
    expect(one.split('\n')[7]).toBe('| 2.24 晚上 |  |  |  |  |')
    expect(one.split('\n').slice(8, 11)).toEqual(NOTE.split('\n').slice(7, 10))
    // ⌘Z 两下：先撤打的字，再撤加的那一行
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(NOTE)

    await (await grip(page, 'row', 1, 0)).click()
    await page.getByRole('menuitem', { name: '上面加一行' }).click()
    await expect(table(page).locator('tbody tr')).toHaveCount(5)
    await page.keyboard.press('Escape')
    await waitSaved(page)
    expect(file(run).split('\n')[7]).toBe('|  |  |  |  |  |')
    await (await grip(page, 'row', 1, 0)).click()
    await page.getByRole('menuitem', { name: '删掉这一行' }).click()
    await waitSaved(page)
    expect(file(run)).toBe(NOTE)

    // 拖第一行到第三行下面
    const g = await grip(page, 'row', 0, 0)
    const gb = (await g.boundingBox())!
    const target = (await cell(page, 2, 0).boundingBox())!
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
    await page.mouse.down()
    await page.mouse.move(gb.x + gb.width / 2, gb.y + 30, { steps: 4 })
    await page.mouse.move(gb.x + gb.width / 2, target.y + target.height - 4, { steps: 6 })
    await expect(pane(page).locator('.tbl-drop')).toBeVisible()
    await page.mouse.up()
    await waitSaved(page)
    const moved = file(run).split('\n')
    expect(moved.slice(6, 10)).toEqual([NOTE.split('\n')[7], NOTE.split('\n')[8], NOTE.split('\n')[6], NOTE.split('\n')[9]])
    expect(changed(NOTE, file(run))).toEqual([6, 7, 8])
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(NOTE)

    // 拖到一半按 Esc：当没拖过，松手也不挪、不开菜单
    const g2 = await grip(page, 'row', 0, 0)
    const b2 = (await g2.boundingBox())!
    await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2)
    await page.mouse.down()
    await page.mouse.move(b2.x + b2.width / 2, b2.y + 80, { steps: 6 })
    await expect(pane(page).locator('.tbl-drop')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(pane(page).locator('.tbl-drop')).toHaveCount(0)
    await page.mouse.up()
    await expect(page.getByRole('menu')).toHaveCount(0)
    await page.waitForTimeout(1500)
    expect(file(run)).toBe(NOTE)
  } finally {
    await run.close()
  }
})

test('列把手：左边 / 右边加一列、居中、删掉这一列，拖着挪列；⌘Z 撤回', async () => {
  const run = await open()
  const { page } = run
  try {
    await (await grip(page, 'col', 0, 1)).click()
    await page.getByRole('menuitem', { name: '右边加一列' }).click()
    await expect(table(page).locator('thead th')).toHaveCount(6)
    expect(await focus(page)).toEqual([-1, 2, 'edit'])
    await page.keyboard.type('住哪')
    await page.keyboard.press('Escape')
    await waitSaved(page)
    const one = file(run).split('\n')
    expect(one[4]).toBe('| 日期 | 路线 | 住哪 | 距离 | 纯车程 | 冬季估算 |')
    expect(one[5]).toBe('|---|---|---|---|---|---|')
    expect(one[6]).toBe('| 2.24 周三 | 机场 → 塞尔福斯 |  | 97 km | 1.5 h | 1.9 h |')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(NOTE)

    // 居中：只改第二行那一格
    await (await grip(page, 'col', 0, 2)).click()
    await page.getByRole('menuitemradio', { name: '居中' }).click()
    await waitSaved(page)
    expect(changed(NOTE, file(run))).toEqual([5])
    expect(file(run).split('\n')[5]).toBe('|---|---|:---:|---|---|')
    await expect(cell(page, 0, 2)).toHaveCSS('text-align', 'center')
    await (await grip(page, 'col', 0, 2)).click()
    await expect(page.getByRole('menuitemradio', { name: '居中' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('menuitemradio', { name: '靠左' }).click()
    await page.waitForTimeout(300)
    // 「靠左」是默认：写回 ---
    await waitSaved(page)
    expect(file(run)).toBe(NOTE)

    // 删掉一列
    await (await grip(page, 'col', 0, 3)).click()
    await page.getByRole('menuitem', { name: '删掉这一列' }).click()
    await expect(table(page).locator('thead th')).toHaveCount(4)
    await waitSaved(page)
    expect(file(run).split('\n')[4]).toBe('| 日期 | 路线 | 距离 | 冬季估算 |')
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(NOTE)

    // 拖「距离」列到最前面
    const g = await grip(page, 'col', 0, 2)
    const gb = (await g.boundingBox())!
    const first = (await cell(page, -1, 0).boundingBox())!
    await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
    await page.mouse.down()
    await page.mouse.move(gb.x - 20, gb.y + gb.height / 2, { steps: 3 })
    await page.mouse.move(first.x + 8, gb.y + gb.height / 2, { steps: 6 })
    await expect(pane(page).locator('.tbl-drop')).toBeVisible()
    await page.mouse.up()
    await waitSaved(page)
    expect(file(run).split('\n')[4]).toBe('| 距离 | 日期 | 路线 | 纯车程 | 冬季估算 |')
    expect(file(run).split('\n')[6]).toBe('| 97 km | 2.24 周三 | 机场 → 塞尔福斯 | 1.5 h | 1.9 h |')
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(NOTE)
  } finally {
    await run.close()
  }
})

test('拖列宽：只改第二行的「-」，重开还是这个宽；打开再保存不变', async () => {
  const run = await open()
  const { page } = run
  try {
    const w0 = await table(page).locator('thead th').evaluateAll((ths) => ths.map((t) => Math.round(t.getBoundingClientRect().width)))
    // 五列平分
    expect(Math.max(...w0) - Math.min(...w0)).toBeLessThanOrEqual(1)
    const b = (await cell(page, -1, 1).boundingBox())!
    // 「路线」右边的缝往右拖 40（右边「距离」跟着窄 40，整张表一样宽）
    await page.mouse.move(b.x + b.width, b.y + b.height / 2)
    await expect(table(page)).toHaveClass(/tbl-rz-hot/)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width + 20, b.y + b.height / 2, { steps: 4 })
    await page.mouse.move(b.x + b.width + 40, b.y + b.height / 2, { steps: 4 })
    const live = await table(page).locator('thead th').evaluateAll((ths) => ths.map((t) => Math.round(t.getBoundingClientRect().width)))
    await page.mouse.up()
    await waitSaved(page)
    expect(changed(NOTE, file(run))).toEqual([5])
    const delim = file(run).split('\n')[5]!
    const dashes = delim.split('|').slice(1, -1).map((c) => c.length)
    expect(dashes[1]!).toBeGreaterThan(dashes[0]!)
    expect(dashes[2]!).toBeLessThan(dashes[0]!)
    const w1 = await table(page).locator('thead th').evaluateAll((ths) => ths.map((t) => Math.round(t.getBoundingClientRect().width)))
    expect(live[1]! - w0[1]!).toBe(40)
    // 松手后宽度不跳（存成「-」的个数，差不过 4 像素）
    expect(w1.map((x, i) => Math.abs(x - live[i]!) <= 4)).toEqual([true, true, true, true, true])
    // 关了再开：还是这个宽，文件不变
    const saved = file(run)
    await openNote(page, '排过的表')
    await openNote(page, '冰岛自驾行程')
    const w2 = await table(page).locator('thead th').evaluateAll((ths) => ths.map((t) => Math.round(t.getBoundingClientRect().width)))
    expect(w2.map((x, i) => Math.abs(x - w1[i]!) <= 3)).toEqual([true, true, true, true, true])
    await page.waitForTimeout(1200)
    expect(file(run)).toBe(saved)
    // ⌘Z 回到平分
    await cell(page, 0, 0).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(NOTE)
  } finally {
    await run.close()
  }
})

test('粘贴：Numbers / Excel 复制的几行几格贴进正文成表；贴进选中的格子往右下铺开、不够加行加列', async () => {
  const run = await open()
  const { page } = run
  try {
    await pane(page).locator('.cm-line').filter({ hasText: '距离和纯车程是用' }).click()
    await page.keyboard.press('End')
    // 段尾回车一次就新起一个空块（文档块结构 task-axoxy 先合进来的规矩），贴进这个空块
    await page.keyboard.press('Enter')
    await paste(page, { 'text/plain': '城市\t人口\n雷克雅未克\t14 万\n阿克雷里\t2 万\n' })
    await expect(pane(page).locator('[data-part="表格"]')).toHaveCount(2)
    await waitSaved(page)
    expect(file(run)).toContain('距离和纯车程是用 OSM 路网算的。\n\n| 城市 | 人口 |\n|---|---|\n| 雷克雅未克 | 14 万 |\n| 阿克雷里 | 2 万 |')

    // 选中「冬季估算」最后一行那一格，贴 2×2：右边多一列、下面多一行
    await cell(page, 3, 4).click()
    await page.keyboard.press('Escape')
    await paste(page, { 'text/plain': '11.9 h\t备注\n\t最后一天' })
    await expect(table(page).locator('thead th')).toHaveCount(6)
    await expect(table(page).locator('tbody tr')).toHaveCount(5)
    await waitSaved(page)
    const L = file(run).split('\n')
    expect(L[9]).toBe('| 合计 |  | 613 km | 9.4 h | 11.9 h | 备注 |')
    expect(L[10]).toBe('|  |  |  |  |  | 最后一天 |')
    expect(await focus(page)).toEqual([3, 4, 'sel'])
    // 一次 ⌘Z 撤回整块粘贴
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run).split('\n').slice(0, 12)).toEqual(NOTE.split('\n').slice(0, 12))
    // 加删过行列（整张表重画过）以后，改字时贴一行两格：从这一格往右铺
    await cell(page, 0, 3).click()
    await paste(page, { 'text/plain': '1.6 h\t2.0 h' })
    await waitSaved(page)
    expect(file(run).split('\n')[6]).toBe('| 2.24 周三 | 机场 → 塞尔福斯 | 97 km | 1.6 h | 2.0 h |')
    expect(await focus(page)).toEqual([0, 3, 'sel'])
  } finally {
    await run.close()
  }
})

test('各种写法的表（补齐的空格、拖过的列宽、对齐冒号、转义竖线、没有头尾竖线）：打开、点进点出、走格、开菜单，一个字节都不变', async () => {
  const MIX =
    '# 表格\n\n| 城市       | 人口   |\n|:-----------|-------:|\n| 雷克雅未克 | 14 万  |\n\n' +
    '| 日期 | 路线 | 备注 |\n|' +
    '-'.repeat(12) +
    '|' +
    '-'.repeat(30) +
    '|:' +
    '-'.repeat(16) +
    ':|\n| 2.24 | 机场 → 塞尔福斯 | a \\| b |\n\n' +
    '甲 | 乙\n--|--\n1 | 2\n'
  const run = await launch({ '表格.md': MIX })
  const { page } = run
  try {
    await openNote(page, '表格')
    const all = pane(page).locator('[data-part="表格"]')
    await expect(all).toHaveCount(3)
    // 拖过列宽的那张：照比例画（路线最宽）
    const w = await all.nth(1).locator('thead th').evaluateAll((ths) => ths.map((t) => t.getBoundingClientRect().width))
    expect(w[1]!).toBeGreaterThan(w[0]! * 2)
    for (let i = 0; i < 3; i++) {
      const t = all.nth(i)
      await t.locator('[data-row="0"][data-col="0"]').click()
      await page.keyboard.press('Tab')
      await page.keyboard.press('ArrowUp')
      await page.keyboard.press('Escape')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Escape')
      await t.locator('[data-row="0"][data-col="1"]').hover()
      await pane(page).locator('.tbl-cgrip:visible').click()
      await expect(page.getByRole('menu', { name: '列菜单' })).toBeVisible()
      await page.keyboard.press('Escape')
    }
    // 转义竖线照原样显示成一格里的「a | b」
    await expect(all.nth(1).locator('[data-row="0"][data-col="2"]')).toHaveText('a | b')
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(1500)
    expect(readFileSync(join(run.vault, '表格.md'), 'utf8')).toBe(MIX)
    await clean(run)
  } finally {
    await run.close()
  }
})
