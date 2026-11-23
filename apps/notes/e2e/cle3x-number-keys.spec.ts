/**
 * 数字格、日期格不再悄悄改值（task-cle3x）：表格对照页上，数字格里按 ↓，2011 变 2010，回车就写进文件。
 * 原因是格子用了浏览器的 <input type="number"> / <input type="date">，↑ ↓（数字框还有滚轮）被浏览器拿去加减。
 * 都在测试模式里真点、真按键、真滚轮：表格里的数字格、日期格，右栏「记录」里的数字、日期，筛选面板里数字的值；
 * 按了 ↑ ↓ / PageUp / PageDown / 滚轮再回车，文件一个字不变；正常打数字照样写回；不是数字的不收，说一句。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, openNote, pane } from './app'

const BASE =
  '```base\nfilters:\n  and:\n    - file.inFolder("论文")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 年份\n      - 读完\nproperties:\n  年份:\n    type: number\n  读完:\n    type: date\n```'
const PRIMER = '论文/A Primer on Memory Consistency.md'
const MCS = '论文/Algorithms for Scalable Synchronization.md'
const FILES: Record<string, string> = {
  '论文清单.md': `# 论文清单\n\n${BASE}\n\n后面一段。\n`,
  [PRIMER]: '---\n年份: 2011\n读完: 2026-11-20 09:30\n---\n\n正文。\n',
  [MCS]: '---\n年份: 1991\n读完: 2026-10-02\n---\n',
}

const toast = (page: Page) => page.getByTestId('toast')
// 每条都按好多键、开好几次格子；机器忙时 60 秒不够
test.describe.configure({ timeout: 150_000 })

/** 浏览器自带的加减键都按一遍（数字框、日期框会拿 ↑ ↓ 去加减），再在框上滚几下滚轮 */
async function pokeKeysAndWheel(page: Page, box: Locator) {
  for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', 'PageDown']) await box.press(k)
  const b = (await box.boundingBox())!
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
  for (const dy of [120, 120, -120, 120]) {
    await page.mouse.wheel(0, dy)
    await page.waitForTimeout(40)
  }
}

test('表格里的数字格：↑ ↓、PageUp / PageDown、滚轮都不改数，回车文件一个字不变；打数字照样写回；不是数字的不收，说一句', async () => {
  const run = await launch(FILES)
  const { page, vault, app } = run
  const read = (p: string) => readFileSync(join(vault, p), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '论文清单')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)
    const row = db.locator('tbody tr', { hasText: 'A Primer' })
    const year = row.locator('td').nth(1)
    await expect(year).toHaveText('2011')

    // 点开数字格，按方向键、翻页键、滚轮：框里还是 2011；回车，文件不变
    // 单击只选中（task-cle3x 格子焦点），双击进编辑
    await year.dblclick()
    const box = db.getByLabel('A Primer on Memory Consistency · 年份', { exact: true })
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('2011')
    // 等宽数字，和不编辑时的格子一样（点开时数字不变窄）
    expect(await box.evaluate((e) => getComputedStyle(e).fontVariantNumeric)).toBe('tabular-nums')
    await pokeKeysAndWheel(page, box)
    await expect(box).toHaveValue('2011')
    await box.press('Enter')
    await expect(box).toHaveCount(0)
    await page.waitForTimeout(600)
    expect(read(PRIMER)).toBe(FILES[PRIMER])
    expect(gitStatus(vault)).toBe('')
    await expect(year).toHaveText('2011')

    // 点开、滚轮、点别处（失焦也会写回）：文件还是不变
    await year.dblclick()
    await pokeKeysAndWheel(page, box)
    await pane(page).locator('.cm-content').getByText('后面一段。').click()
    await expect(box).toHaveCount(0)
    await page.waitForTimeout(600)
    expect(read(PRIMER)).toBe(FILES[PRIMER])
    expect(gitStatus(vault)).toBe('')

    // 正常打数字：写回
    await year.dblclick()
    await box.fill('2012')
    await box.press('Enter')
    await expect.poll(() => read(PRIMER)).toBe('---\n年份: 2012\n读完: 2026-11-20 09:30\n---\n\n正文。\n')
    await expect(year).toHaveText('2012')

    // 中文输入法打出来的全角数字也认，写成半角
    await year.dblclick()
    await box.fill('２０１３')
    await box.press('Enter')
    await expect.poll(() => read(PRIMER)).toBe('---\n年份: 2013\n读完: 2026-11-20 09:30\n---\n\n正文。\n')

    // 不是数字：不收，说一句；框还开着，改对了再回车
    await year.dblclick()
    await box.fill('20x3')
    await box.press('Enter')
    await expect(toast(page)).toContainText('「年份」只收数字，「20x3」没写进去')
    await expect(box).toBeFocused()
    // 框描红，打下一个字恢复
    await expect(box).toHaveAttribute('aria-invalid', 'true')
    await page.waitForTimeout(400)
    expect(read(PRIMER)).toContain('年份: 2013\n')
    await page.keyboard.type('2014')
    await expect(box).not.toHaveAttribute('aria-invalid', 'true')
    await box.press('Enter')
    await expect.poll(() => read(PRIMER)).toContain('年份: 2014\n')
    // 改对写回了：底栏那句「没写进去」收掉
    await expect(toast(page).filter({ hasText: '没写进去' })).toHaveCount(0)

    // 中文标点下打的小数点「。」也认
    await year.click()
    await box.fill('2014。5')
    await box.press('Enter')
    await expect.poll(() => read(PRIMER)).toContain('年份: 2014.5\n')
    await year.click()
    await box.fill('2014')
    await box.press('Enter')
    await expect.poll(() => read(PRIMER)).toContain('年份: 2014\n')

    // 打错了按 esc 放弃：不写，那句也收掉
    await year.click()
    await box.fill('很长很长很长很长很长很长很长的一段字')
    await box.press('Enter')
    await expect(toast(page)).toContainText('「很长很长很长很长很长很长…」没写进去')
    await box.press('Escape')
    await expect(box).toHaveCount(0)
    await expect(toast(page).filter({ hasText: '没写进去' })).toHaveCount(0)
    expect(read(PRIMER)).toContain('年份: 2014\n')

    // 不是数字又点别处：不写，原来的数留着
    await year.dblclick()
    await box.fill('abc')
    await pane(page).locator('.cm-content').getByText('后面一段。').click()
    await expect(box).toHaveCount(0)
    await expect(toast(page)).toContainText('「年份」只收数字')
    await page.waitForTimeout(400)
    expect(read(PRIMER)).toContain('年份: 2014\n')
  } finally {
    await run.close()
  }
})

test('表格里的日期格：↑ ↓ 不改日子，回车文件一个字不变（带钟点的也不丢钟点）；挑一天照样写回，钟点留着', async () => {
  const run = await launch(FILES)
  const { page, vault, app } = run
  const read = (p: string) => readFileSync(join(vault, p), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '论文清单')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)

    for (const [name, path] of [
      ['Algorithms for Scalable Synchronization', MCS],
      ['A Primer on Memory Consistency', PRIMER],
    ] as const) {
      // 日期格是能打字的浮层加小月历（task-cle3x），不再是浏览器的日期框：双击打开，框里是日子（全选着）
      await db.locator('tbody tr', { hasText: name }).locator('td').nth(2).dblclick()
      const box = page.getByRole('textbox', { name: `${name} · 读完`, exact: true })
      await expect(box).toBeFocused()
      const before = await box.inputValue()
      for (const k of ['ArrowDown', 'ArrowDown', 'ArrowUp', 'ArrowDown', 'PageDown', 'PageUp', 'PageDown']) await box.press(k)
      await expect(box).toHaveValue(before)
      await box.press('Enter')
      await expect(box).toHaveCount(0)
      await page.waitForTimeout(600)
      expect(read(path)).toBe(FILES[path])
    }
    expect(gitStatus(vault)).toBe('')

    // 改日子：带钟点的只换日子
    await db.locator('tbody tr', { hasText: 'A Primer' }).locator('td').nth(2).dblclick()
    const box = page.getByRole('textbox', { name: 'A Primer on Memory Consistency · 读完', exact: true })
    await box.fill('2026-11-21')
    await box.press('Enter')
    await expect.poll(() => read(PRIMER)).toBe('---\n年份: 2011\n读完: 2026-11-21 09:30\n---\n\n正文。\n')
  } finally {
    await run.close()
  }
})

test('右栏「记录」里的数字、日期：↑ ↓、滚轮不改值，回车文件不变；不是数字的不收', async () => {
  const run = await launch(FILES)
  const { page, vault, app } = run
  const read = (p: string) => readFileSync(join(vault, p), 'utf8')
  const peek = page.locator('.rpeek')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '论文清单')
    const db = pane(page).locator('[data-part="数据库块"]')
    await db.getByRole('button', { name: 'A Primer on Memory Consistency', exact: true }).click()
    await expect(peek.locator('.rec-title')).toHaveText('A Primer on Memory Consistency')

    await peek.locator('.rec-row[data-col="年份"] .v').click()
    const year = peek.getByLabel('A Primer on Memory Consistency · 年份', { exact: true })
    await expect(year).toBeFocused()
    await pokeKeysAndWheel(page, year)
    await expect(year).toHaveValue('2011')
    await year.press('Enter')
    await expect(year).toHaveCount(0)

    await peek.locator('.rec-row[data-col="读完"] .v').click()
    const day = peek.getByLabel('A Primer on Memory Consistency · 读完', { exact: true })
    await expect(day).toBeFocused()
    await pokeKeysAndWheel(page, day)
    await expect(day).toHaveValue('2026-11-20')
    await day.press('Enter')
    await expect(day).toHaveCount(0)
    await page.waitForTimeout(600)
    expect(read(PRIMER)).toBe(FILES[PRIMER])
    expect(gitStatus(vault)).toBe('')
    // 还是这一条（↑ ↓ 没被拿去换一条）
    await expect(peek.locator('.rec-title')).toHaveText('A Primer on Memory Consistency')

    // 不是数字：不收，说一句
    await peek.locator('.rec-row[data-col="年份"] .v').click()
    await year.fill('二〇一一')
    await year.press('Enter')
    await expect(toast(page)).toContainText('「年份」只收数字')
    await page.waitForTimeout(400)
    expect(read(PRIMER)).toBe(FILES[PRIMER])
    // 打数字：写回
    await year.fill('2010')
    await year.press('Enter')
    await expect.poll(() => read(PRIMER)).toBe('---\n年份: 2010\n读完: 2026-11-20 09:30\n---\n\n正文。\n')
  } finally {
    await run.close()
  }
})

test('筛选面板里数字的值：↑ ↓、滚轮不改值、不写文件；打的不是数字只留在面板上不写', async () => {
  const run = await launch(FILES)
  const { page, vault, app } = run
  const read = () => readFileSync(join(vault, '论文清单.md'), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '论文清单')
    const db = pane(page).locator('[data-part="数据库块"]')
    await db.locator('.base-tools').getByRole('button', { name: '筛选', exact: true }).click()
    const panel = page.getByRole('dialog', { name: '筛选' })
    await panel.getByRole('button', { name: '加一条' }).click()
    const r = panel.locator('.fbody > .frow').first()
    await r.getByRole('combobox', { name: '列' }).selectOption('年份')
    const val = r.locator('input[aria-label="值"]')
    await val.click()
    await page.keyboard.type('2000')
    await expect.poll(read).toContain('2000\n')
    const after = read()
    await pokeKeysAndWheel(page, val)
    await expect(val).toHaveValue('2000')
    await page.waitForTimeout(800)
    expect(read()).toBe(after)

    // 不是数字：和没填完一样只留在面板上，不当成「年份 = "20x0"」写进去（和清空值一样，这一条先从文件里拿掉）
    await val.fill('20x0')
    await expect(val).toHaveValue('20x0')
    await expect.poll(read).toBe(FILES['论文清单.md'])
    // 改对了：写回
    await val.fill('１９９５')
    await expect.poll(read).toContain('1995\n')
    expect(read()).not.toContain('１９９５')
  } finally {
    await run.close()
  }
})
