/**
 * 白板装饰 · 卡片样式（设计页 145「卡片样式」）：真点。
 * - 按卡：点一张卡 → 操作条「样式 ▾」→ 浮层里换五种样式、换主题六色；每一下 md 只改那张卡前面那一行注释（没有就加一行），笔迹文件不动；
 *   换回「纸面」、颜色点回去（跟主题）那一行注释去掉对应的字；⌘Z 一步步撤回到原样。
 * - 按列：列名右键「样式…」→ 浮层；记在列名下面紧跟的一行 `<!-- column style=… color=… -->`，全去掉时整行删；⌘Z。
 * - 选两张时操作条「样式 ▾」一起换。
 * - 打开再保存：带样式、便签、贴纸胶带的白板打开、切文档切白板，md 和笔迹文件一个字节不变。
 */
import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { pane } from './app'
import { diff, files, openDecorBoard } from './decor-helpers'
import { armMenus, pickMenu } from './menu'
import { BOARD, INK_PATH } from './decor-samples'

const undo = (page: import('@playwright/test').Page) => page.keyboard.press('Meta+z')

test('卡片样式按卡：样式 ▾ 换五种、换颜色，每下只改那一行注释，⌘Z 撤回到原样；选两张一起换', async () => {
  test.setTimeout(240_000)
  const { run, page, board } = await openDecorBoard()
  const f = files(run)
  try {
    const card = board.locator('.db-card[data-id]', { hasText: '笔记里只记到这些' })
    await card.click({ position: { x: 30, y: 12 } })
    const bar = page.getByTestId('decor-cardbar')
    await expect(bar).toBeVisible()
    await expect(bar.locator('.cnt')).toHaveText('已选1张')
    // ---- 换成彩头：md 只多了这张卡前面一行注释 ----
    await bar.getByRole('button', { name: '样式' }).click()
    const pop = page.getByTestId('decor-style-pop')
    await expect(pop).toBeVisible()
    await expect(pop.getByRole('radio', { name: '纸面' })).toHaveAttribute('aria-checked', 'true')
    await pop.getByRole('radio', { name: '彩头' }).click()
    await expect.poll(f.md).not.toBe(BOARD)
    let d = diff(BOARD, f.md())
    expect(d.removed).toEqual([])
    expect(d.added).toEqual(['<!-- card id=k2 style=header -->'])
    expect(f.md().replace('<!-- card id=k2 style=header -->\n', '')).toBe(BOARD)
    await expect(card).toHaveAttribute('data-cs', 'header')
    expect(f.ink()).toBe('')
    // ---- 换颜色（第 3 色）：同一行多了 color=2 ----
    await pop.getByRole('radio', { name: '第3色' }).click()
    await expect.poll(f.md).toContain('<!-- card id=k2 style=header color=2 -->')
    d = diff(BOARD, f.md())
    expect(d.added).toEqual(['<!-- card id=k2 style=header color=2 -->'])
    // 颜色是主题六色的第 3 个（--mm-b2，换主题跟着换）
    const c2 = await card.evaluate((el) => [getComputedStyle(el).getPropertyValue('--c').trim(), getComputedStyle(el).getPropertyValue('--mm-b2').trim()])
    expect(c2[0]).toBe(c2[1])
    // ---- 五种都换一遍：画出来的样子跟着变 ----
    for (const [name, v] of [
      ['磨砂玻璃', 'glass'],
      ['描边', 'outline'],
      ['横线纸', 'lined'],
    ] as const) {
      await pop.getByRole('radio', { name }).click()
      await expect(card).toHaveAttribute('data-cs', v)
      await expect.poll(f.md).toContain(`<!-- card id=k2 style=${v} color=2 -->`)
    }
    const lined = await card.evaluate((el) => getComputedStyle(el).backgroundImage)
    expect(lined).toContain('repeating-linear-gradient')
    // ---- 换回纸面、颜色点回去（跟主题）：注释里只剩编号 ----
    await pop.getByRole('radio', { name: '纸面' }).click()
    await expect.poll(f.md).toContain('<!-- card id=k2 color=2 -->')
    await pop.getByRole('radio', { name: '第3色' }).click()
    await expect.poll(f.md).toContain('<!-- card id=k2 -->')
    await expect(card).not.toHaveAttribute('data-cs', /.*/)
    // ---- ⌘Z 一步步撤回：最后回到一个字节不差的原样 ----
    await page.keyboard.press('Escape')
    for (let i = 0; i < 7; i++) await undo(page)
    await expect.poll(f.md).toBe(BOARD)
    expect(f.ink()).toBe('')

    // ---- 选两张：操作条「样式 ▾」一起换 ----
    const other = board.locator('.db-card[data-id]', { hasText: '如实说进度' })
    await card.click({ position: { x: 30, y: 12 } })
    await other.click({ position: { x: 30, y: 12 }, modifiers: ['Shift'] })
    const many = page.getByTestId('db-selbar')
    await expect(many).toBeVisible()
    await many.getByRole('button', { name: '样式' }).click()
    await page.getByTestId('decor-style-pop').getByRole('radio', { name: '描边' }).click()
    await expect.poll(() => (f.md().match(/style=outline/g) ?? []).length).toBe(2)
    d = diff(BOARD, f.md())
    expect(d.removed).toEqual([])
    expect(d.added.length).toBe(2)
    expect(d.added.every((l) => /^<!-- card id=k\d+ style=outline -->$/.test(l))).toBe(true)
    await page.keyboard.press('Escape')
    await undo(page)
    await expect.poll(f.md).toBe(BOARD)
  } finally {
    await run.close()
  }
})

test('卡片样式按列：列头右键「样式…」，记在列名下面一行，全去掉整行删，⌘Z 撤回', async () => {
  test.setTimeout(180_000)
  const { run, page, board } = await openDecorBoard()
  const f = files(run)
  try {
    await armMenus(run)
    const col = board.locator('.db-col', { has: page.locator('h3', { hasText: '会上怎么说' }) })
    await col.locator('h3').click({ button: 'right' })
    await pickMenu(run, '样式…')
    const pop = page.getByTestId('decor-style-pop')
    await expect(pop).toBeVisible()
    await expect(pop).toContainText('「会上怎么说」这一列的样式')
    await pop.getByRole('radio', { name: '彩头' }).click()
    await expect.poll(f.md).toContain('## 会上怎么说\n<!-- column style=header -->\n')
    let d = diff(BOARD, f.md())
    expect(d).toEqual({ removed: [], added: ['<!-- column style=header -->'] })
    await expect(col).toHaveAttribute('data-cs', 'header')
    const band = await col.locator('h3').evaluate((el) => getComputedStyle(el).boxShadow)
    expect(band).toContain('inset')
    await pop.getByRole('radio', { name: '第2色' }).click()
    await expect.poll(f.md).toContain('<!-- column style=header color=1 -->')
    // 换回纸面、颜色点回去：那一行整个删掉，回到原样
    await pop.getByRole('radio', { name: '纸面' }).click()
    await pop.getByRole('radio', { name: '第2色' }).click()
    await expect.poll(f.md).toBe(BOARD)
    await expect(col).not.toHaveAttribute('data-cs', /.*/)
    // ⌘Z：回到「彩头 · 第 2 色」，再一下「彩头」
    await page.keyboard.press('Escape')
    await undo(page)
    await expect.poll(f.md).toContain('<!-- column color=1 -->')
    await undo(page)
    await expect.poll(f.md).toContain('<!-- column style=header color=1 -->')
    await undo(page)
    await undo(page)
    await expect.poll(f.md).toBe(BOARD)
    d = diff(BOARD, f.md())
    expect(d).toEqual({ removed: [], added: [] })
  } finally {
    await run.close()
  }
})

test('打开再保存不变：带卡片样式、列样式、便签、贴纸、胶带的白板，开着切文档切白板，md 和笔迹文件一个字节不动', async () => {
  test.setTimeout(180_000)
  const md = BOARD.replace('## 会上怎么说\n', '## 会上怎么说\n<!-- column style=header color=1 -->\n')
    .replace('<!-- card id=k1 ink=1 -->', '<!-- card id=k1 ink=1 style=lined color=0 -->')
    .concat('\n<!-- card id=n1 x=520 y=520 note=pink rot=-2.5 -->\n问 Nima：数据什么时候给？一共几个人？\n')
  const ink = [
    '{"ink":1}',
    '{"tape":"t1aaaaaa","on":"k1","at":"tl","pat":"mint","len":80,"rot":-40,"seed":2}',
    '{"tape":"t2bbbbbb","on":"n1","at":"t","pat":"dots","len":76,"rot":2,"seed":5}',
    '{"sticker":"s1cccccc","k":"coffee","x":1300,"y":110,"w":76,"rot":10}',
    '{"sticker":"s2dddddd","k":"zd","on":"k1","x":330,"y":20,"w":96,"rot":-6,"t":1764000000000}',
    '{"future":"留着"}',
    '',
  ].join('\n')
  const { run, page, board } = await openDecorBoard({ '11.24 组会准备.md': md, [INK_PATH]: ink })
  const f = files(run)
  try {
    await expect(board.getByTestId('decor-tape')).toHaveCount(2)
    await expect(board.getByTestId('decor-sticker')).toHaveCount(2)
    await expect(board.locator('.db-card.dc-note[data-note="pink"]')).toBeVisible()
    await expect(board.locator('.db-col.dc-cs[data-cs="header"]')).toBeVisible()
    await expect(board.locator('.db-card.dc-cs[data-cs="lined"]')).toBeVisible()
    await page.waitForTimeout(800)
    const acts = page.getByTestId('tab-acts')
    await acts.getByRole('tab', { name: '文档' }).click()
    await expect(pane(page).locator('.cm-content')).toBeVisible()
    await page.waitForTimeout(600)
    await acts.getByRole('tab', { name: '白板' }).click()
    await expect(board.getByTestId('decor-tape')).toHaveCount(2)
    await page.waitForTimeout(800)
    expect(f.md()).toBe(md)
    expect(f.ink()).toBe(ink)
    expect(f.commits()).toBe(1)
    void join
  } finally {
    await run.close()
  }
})
