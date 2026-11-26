/**
 * 文档表格的格子进入编辑时，这一格的全部文字照样看得见（0.5.14 用户报：点一格变成单行输入框，只露末尾「：，**待确认**」）。
 * 真点：长内容、带粗体的一格点进去，编辑框里字全看得见、编辑框不比原来的格子矮、光标落在点的那个字；
 * 打字格子跟着长高、表格不跳；点外面存回的 md 只动这一格；回车、⇧回车、↑↓、Tab、Esc、输入法照旧。
 */
import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, openNote, pane, type Running, waitSaved } from './app'

test.setTimeout(180_000)

const LONG = '集合点在雷克雅未克 BSÍ 车站，导游说冬季路况要看前一天的预报，如果下雪就改走一号公路南线：**待确认**'
const NOTE = `# 冰岛行程备忘

下面这张表记每天的安排。

| 日期 | 路线 | 住哪 | 集合 | 备注 |
|---|---|---|---|---|
| 2.24 | 机场 → 塞尔福斯 | 塞尔福斯旅馆 | 早上 9 点 | 先取车 |
| 2.25 | 黄金圈 | 赫拉山小屋 | ${LONG} | 带冰爪 |
| 2.26 | 南海岸 | 维克 | 早上 8 点 | 看黑沙滩 |

最后一段。
`

const table = (page: Page) => pane(page).locator('[data-part="表格"]').first()
const cell = (page: Page, row: number, col: number) => table(page).locator(`[data-row="${row}"][data-col="${col}"]`)
const box = (page: Page) => pane(page).locator('.cm-cellin')
const file = (run: Running) => readFileSync(join(run.vault, '冰岛行程备忘.md'), 'utf8')
/** 焦点在哪一格、是不是在改字 */
const focus = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    const td = a?.closest('td,th') as HTMLElement | null
    if (td?.dataset.row !== undefined) return [Number(td.dataset.row), Number(td.dataset.col), a!.classList.contains('cm-cellin') ? 'edit' : 'sel']
    return a ? a.tagName.toLowerCase() : null
  })
/** 编辑框量一下：字有没有被藏（要滚才看得见）、多高、光标在第几个字 */
const measure = (page: Page) =>
  page.evaluate(() => {
    const t = document.activeElement as HTMLTextAreaElement
    const r = t.getBoundingClientRect()
    return {
      tag: t.tagName,
      value: t.value,
      height: r.height,
      hiddenY: t.scrollHeight - t.clientHeight,
      hiddenX: t.scrollWidth - t.clientWidth,
      scrolled: t.scrollTop + t.scrollLeft,
      caret: t.selectionStart,
      caretEnd: t.selectionEnd,
    }
  })
/** 格子里第 n 个字（画出来的字，不算记号）的正中，点它右半边：光标该落在它后面 */
const charPoint = (page: Page, row: number, col: number, needle: string, nth: number) =>
  cell(page, row, col).evaluate(
    (el, [needle, nth]) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const at = n.textContent!.indexOf(needle as string)
        if (at < 0) continue
        const r = document.createRange()
        r.setStart(n, at + (nth as number))
        r.setEnd(n, at + (nth as number) + 1)
        const b = r.getBoundingClientRect()
        return { x: b.left + b.width * 0.75, y: b.top + b.height / 2 }
      }
      throw new Error('格子里没有 ' + needle)
    },
    [needle, nth] as const,
  )

async function open() {
  const run = await launch({ '冰岛行程备忘.md': NOTE })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
  await openNote(run.page, '冰岛行程备忘')
  await expect(table(run.page).locator('tbody tr')).toHaveCount(3)
  return run
}

test('长内容带粗体的一格点进去：字全看得见、框不比格子矮、光标在点的字后面；打字长高不跳，点外面只存这一格', async () => {
  const run = await open()
  const { page } = run
  try {
    const td = cell(page, 1, 3)
    const before = await td.boundingBox()
    // 格子平时折好几行（这一格内容长）
    expect(before!.height).toBeGreaterThan(80)
    const tableTop = (await table(page).boundingBox())!.y

    // 点「预报」的「报」右半边：光标落在「报」后面
    const p = await charPoint(page, 1, 3, '预报', 1)
    await page.mouse.click(p.x, p.y)
    expect(await focus(page)).toEqual([1, 3, 'edit'])
    const m = await measure(page)
    expect(m.value).toBe(LONG)
    // 全部字看得见：不用滚、没有藏起来的
    expect(m.hiddenY).toBeLessThanOrEqual(1)
    expect(m.hiddenX).toBeLessThanOrEqual(1)
    expect(m.scrolled).toBe(0)
    // 框不比原来的格子矮（不只露一行）
    expect(m.height).toBeGreaterThanOrEqual(before!.height - 2)
    expect(m.caret).toBe(LONG.indexOf('预报') + 2)
    expect(m.caretEnd).toBe(m.caret)
    // 进编辑表格不挪
    expect((await table(page).boundingBox())!.y).toBeCloseTo(tableTop, 0)

    // 打一长串：格子跟着长高，字照样全看得见，表格顶上不动
    const add = '（周一再打电话问一次车站，顺便问问能不能退票）'
    await page.keyboard.type(add)
    const m2 = await measure(page)
    expect(m2.value).toBe(LONG.replace('预报', '预报' + add))
    expect(m2.hiddenY).toBeLessThanOrEqual(1)
    expect(m2.scrolled).toBe(0)
    expect(m2.height).toBeGreaterThan(m.height + 10)
    expect((await td.boundingBox())!.height).toBeGreaterThanOrEqual(m2.height - 1)
    expect((await table(page).boundingBox())!.y).toBeCloseTo(tableTop, 0)

    // 点外面：存回 md，只动这一格那一行
    await pane(page).locator('.cm-line', { hasText: '最后一段。' }).click()
    await waitSaved(page)
    const out = file(run)
    expect(out).toBe(NOTE.replace('预报', '预报' + add))
    // 画回去：粗体照样是粗体，不露记号
    await expect(td.locator('b')).toHaveText('待确认')
    await expect(td).not.toContainText('**')
  } finally {
    await run.close()
  }
})

test('点在粗体字中间：光标落在原文对应的位置（记号后面）', async () => {
  const run = await open()
  const { page } = run
  try {
    // 点「待确认」的「待」右半边：原文里是「**待|确认**」
    const p = await charPoint(page, 1, 3, '待确认', 0)
    await page.mouse.click(p.x, p.y)
    expect(await focus(page)).toEqual([1, 3, 'edit'])
    expect((await measure(page)).caret).toBe(LONG.indexOf('**待确认**') + 3)
    await page.keyboard.type('再')
    await page.keyboard.press('Escape')
    await waitSaved(page)
    expect(file(run)).toBe(NOTE.replace('**待确认**', '**待再确认**'))
  } finally {
    await run.close()
  }
})

test('多行格子里的按键照旧：↑↓ 上下一格、⇧回车不插换行、回车到下一行、Tab、Esc、输入法；只进出不改字文件不变', async () => {
  const run = await open()
  const { page } = run
  try {
    // ↑↓ 照旧上下一格（折了几行的格子也是一下换格，DESIGN.v3 6.5「↑↓ 上下一格」）
    const p = await charPoint(page, 1, 3, '集合点', 1)
    await page.mouse.click(p.x, p.y)
    await page.keyboard.press('ArrowDown')
    expect(await focus(page)).toEqual([2, 3, 'edit'])
    await page.keyboard.press('ArrowUp')
    expect(await focus(page)).toEqual([1, 3, 'edit'])
    await page.keyboard.press('ArrowUp')
    expect(await focus(page)).toEqual([0, 3, 'edit'])
    await page.keyboard.press('ArrowDown')
    expect(await focus(page)).toEqual([1, 3, 'edit'])
    // ⇧回车：格子里不插换行（md 表格一格只能一行）
    await page.keyboard.press('Shift+Enter')
    expect((await measure(page)).value).toBe(LONG)
    // 回车：到下一行同一列
    await page.keyboard.press('Enter')
    expect(await focus(page)).toEqual([2, 3, 'edit'])
    // Tab 下一格、⇧Tab 回来，Esc 变选中
    await page.keyboard.press('Tab')
    expect(await focus(page)).toEqual([2, 4, 'edit'])
    await page.keyboard.press('Shift+Tab')
    expect(await focus(page)).toEqual([2, 3, 'edit'])
    await page.keyboard.press('Escape')
    expect(await focus(page)).toEqual([2, 3, 'sel'])
    await page.waitForTimeout(400)
    // 只进出没改字：文件一字节不变
    expect(file(run)).toBe(NOTE)
    expect(gitStatus(run.vault)).toBe('')

    // 输入法：组字时回车归输入法，选好字落进格子
    const q = await charPoint(page, 0, 4, '先取车', 2)
    await page.mouse.click(q.x, q.y)
    expect(await focus(page)).toEqual([0, 4, 'edit'])
    const cdp = await page.context().newCDPSession(page)
    for (const t of ['h', 'ha', 'hai']) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length })
    await cdp.send('Input.insertText', { text: '还' })
    expect((await measure(page)).value).toBe('先取车还')
    await page.keyboard.press('Enter')
    expect(await focus(page)).toEqual([1, 4, 'edit'])
    await waitSaved(page)
    expect(file(run)).toBe(NOTE.replace('| 先取车 |', '| 先取车还 |'))
  } finally {
    await run.close()
  }
})
