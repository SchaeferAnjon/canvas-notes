/**
 * 数据库表格对照 Notion 和 Tolaria（task-cle3x）的「我们」这一边：同一张「读过的论文」表（8 列 16 行），
 * 一项一项真点、真按键，截数据库那一块，量行高、表头、字号。只在截对照图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色。
 * 每一步的结果（按了什么、发生了什么）写进 <目录>/ours-<tone>.log，对照页照它写说明。
 */
import { expect, type Page, test } from '@playwright/test'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane } from './app'
import { FILES, skin } from './papers'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TONE = DARK ? 'dark' : 'light'
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')
test.setTimeout(300_000)

test('读过的论文：表格一项一项真按、截图', async () => {
  mkdirSync(DIR!, { recursive: true })
  const LOG = join(DIR!, `ours-${TONE}.log`)
  writeFileSync(LOG, '')
  const log = (s: string) => appendFileSync(LOG, s + '\n')
  const run = await launch(FILES, {}, skin(DARK))
  const { page } = run
  const db = pane(page).locator('[data-part="数据库块"]').first()
  /** db：只截数据库那一块；pane：中间那一栏（浮层画在块外面，一起截进来）；win：整个窗口 */
  const shot = async (name: string, target: 'db' | 'pane' | 'win' = 'db') => {
    await page.waitForTimeout(350)
    const path = join(DIR!, `ours-${name}-${TONE}.png`)
    if (target === 'db') await db.screenshot({ path })
    else if (target === 'pane') await page.screenshot({ path, clip: (await pane(page).boundingBox())! })
    else await page.screenshot({ path })
    log(`[shot] ${name}`)
  }
  const focusInfo = () =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      if (!a) return 'none'
      const td = a.closest('td')
      return `${a.tagName.toLowerCase()}${a.className ? '.' + String(a.className).split(' ')[0] : ''} label=${a.getAttribute('aria-label') ?? ''} inTd=${!!td} value=${(a as HTMLInputElement).value ?? ''}`
    })
  /** 每一项从同一个样子开始：收起浮层、表格横向滚回最左、块整个露出来 */
  const reset = async () => {
    await page.keyboard.press('Escape')
    await page.mouse.move(2, 400)
    await db.locator('.base-scroll').evaluate((e) => (e.scrollLeft = 0)).catch(() => {})
    await db.evaluate((e) => e.scrollIntoView({ block: 'start' })).catch(() => {})
    await page.waitForTimeout(200)
  }
  const step = async (name: string, fn: () => Promise<void>) => {
    log(`\n## ${name}`)
    await reset()
    try {
      await fn()
    } catch (e) {
      log(`[失败] ${String(e).split('\n')[0]}`)
      await page.keyboard.press('Escape').catch(() => {})
    }
  }
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
    await openNote(page, '读过的论文')
    await expect(db.locator('tbody tr')).toHaveCount(16)
    const cell = (row: number, col: string) => db.locator('tbody tr').nth(row).locator(`td`).nth(['file.name', '作者', '年份', '状态', '标签', '评分', '读完日期', '链接'].indexOf(col))

    await step('1 整体观感', async () => {
      const m = await db.evaluate((el) => {
        const cs = (s: string) => {
          const e = el.querySelector(s) as HTMLElement | null
          if (!e) return null
          const c = getComputedStyle(e)
          const b = e.getBoundingClientRect()
          return { h: Math.round(b.height * 10) / 10, w: Math.round(b.width), font: c.fontSize + '/' + c.fontWeight, color: c.color, bg: c.backgroundColor, border: c.borderBottom, pad: c.padding }
        }
        return { tr: cs('tbody tr'), td: cs('tbody td'), nameTd: cs('tbody td.nm'), th: cs('thead th'), thBtn: cs('thead .base-th'), table: cs('table'), top: cs('.base-top'), vbar: cs('.base-vbar, .base-views') }
      })
      log(JSON.stringify(m))
      await shot('overall')
      await page.screenshot({ path: join(DIR!, `ours-overall-win-${TONE}.png`) })
    })

    await step('1b 悬停一行', async () => {
      await cell(2, '作者').hover()
      await shot('hover')
    })

    await step('2 新建一行（表底「+ 新建」）', async () => {
      await db.locator('.base-newrow').click()
      await page.waitForTimeout(500)
      log('focus after new row: ' + (await focusInfo()))
      await shot('newrow')
      await page.keyboard.type('Test row')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(600)
      log('rows after: ' + (await db.locator('tbody tr').count()) + ' focus: ' + (await focusInfo()))
      await page.keyboard.press('ArrowDown')
      await page.keyboard.type('x')
      log('after naming, ArrowDown + type x: focus ' + (await focusInfo()))
      await shot('newrow-named')
    })

    await step('3 新建一列（表头「+」）', async () => {
      await db.getByRole('button', { name: '加一列' }).click()
      await shot('newcol-menu', 'pane')
      await page.keyboard.press('Escape')
    })

    await step('4 改单元格：单击文字格', async () => {
      await cell(0, '作者').click()
      log('focus after single click: ' + (await focusInfo()))
      await shot('edit-click')
      await page.keyboard.press('Tab')
      log('after Tab: ' + (await focusInfo()))
      await shot('edit-tab')
      await page.keyboard.press('Escape')
      log('after Esc: ' + (await focusInfo()))
      await cell(0, '年份').click()
      await page.keyboard.press('ArrowDown')
      log('number cell then ArrowDown: ' + (await focusInfo()))
      await page.keyboard.press('Enter')
      log('after Enter: ' + (await focusInfo()))
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowRight')
      log('after Enter then arrows: ' + (await focusInfo()))
      await shot('edit-arrows')
      await page.keyboard.press('Escape')
    })

    await step('4b 双击文字格', async () => {
      await cell(1, '作者').dblclick()
      log('focus after dblclick: ' + (await focusInfo()))
      await shot('edit-dblclick')
      await page.keyboard.press('Escape')
    })

    await step('5 选项格：状态', async () => {
      await cell(0, '状态').click()
      await shot('select-pop', 'pane')
      log('focus in select pop: ' + (await focusInfo()))
      await page.keyboard.press('ArrowDown')
      log('after ArrowDown in pop: ' + (await focusInfo()))
      await page.keyboard.press('Escape')
    })

    await step('5b 多选格：标签', async () => {
      await cell(1, '标签').click()
      await shot('multi-pop', 'pane')
      await page.keyboard.press('Escape')
    })

    await step('6 日期格', async () => {
      await cell(0, '读完日期').click()
      log('date edit: ' + (await focusInfo()) + ' type=' + (await page.evaluate(() => (document.activeElement as HTMLInputElement)?.type)))
      await shot('date-edit')
      await page.keyboard.press('Escape')
    })

    await step('7 拖列宽', async () => {
      const sep = db.locator('thead th').nth(1).locator('.base-size')
      const b = (await sep.boundingBox())!
      const w0 = await db.locator('thead th').nth(1).evaluate((e) => e.getBoundingClientRect().width)
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + 60, b.y + b.height / 2, { steps: 8 })
      await shot('colsize-drag')
      await page.mouse.up()
      const w1 = await db.locator('thead th').nth(1).evaluate((e) => e.getBoundingClientRect().width)
      log(`作者列宽 ${Math.round(w0)} → ${Math.round(w1)}`)
      await shot('colsize-after')
    })

    await step('7b 拖列顺序', async () => {
      const h = db.locator('thead .base-th').nth(2)
      const b = (await h.boundingBox())!
      await page.mouse.move(b.x + 20, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + 220, b.y + b.height / 2, { steps: 12 })
      await shot('colmove-drag')
      await page.mouse.up()
      await page.waitForTimeout(500)
      await shot('colmove-after')
      log('header after move: ' + (await db.locator('thead .base-th').allTextContents()).join(' | '))
    })

    await step('8 排序、筛选、分组入口', async () => {
      await shot('toolbar')
      await db.locator('thead .base-th').first().click()
      await shot('colmenu', 'pane')
      await page.keyboard.press('Escape')
      await db.getByRole('button', { name: '筛选', exact: true }).click()
      await shot('filter', 'pane')
      await page.keyboard.press('Escape')
      await db.getByRole('button', { name: '排序', exact: true }).click()
      await shot('sort', 'pane')
      await page.keyboard.press('Escape')
      await db.getByRole('button', { name: '分组', exact: true }).click()
      await shot('group', 'pane')
      await page.keyboard.press('Escape')
    })

    await step('9 行打开成一页：点名字（右栏）', async () => {
      await cell(0, 'file.name').locator('button').first().click()
      await page.waitForTimeout(800)
      await shot('record-side', 'win')
      await page.keyboard.press('Escape')
    })

    await step('9b 整页打开数据库', async () => {
      await db.getByRole('button', { name: '整页打开' }).click()
      await page.waitForTimeout(600)
      await shot('fullpage', 'win')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    })

    await step('10 视图切换', async () => {
      await db.getByRole('button', { name: '加一个视图' }).click()
      await shot('view-add', 'pane')
      await page.keyboard.press('Escape')
      for (const v of ['看板', '日历', '画廊']) {
        await db.getByRole('tab', { name: v }).click()
        await page.waitForTimeout(500)
        await shot('view-' + { 看板: 'kanban', 日历: 'calendar', 画廊: 'gallery' }[v])
      }
      await db.getByRole('tab', { name: '全部' }).click()
    })

    await step('11 计算行', async () => {
      const th = db.locator('thead .base-th', { hasText: '评分' })
      await th.scrollIntoViewIfNeeded()
      await th.click()
      log('col menu items: ' + (await page.locator('.base-colmenu [role^=menuitem]').allTextContents()).join(' | '))
      await page.locator('.base-colmenu [role=menuitem]', { hasText: '计算' }).click()
      log('sum menu items: ' + (await page.locator('[data-part="表底算什么"] [role=menuitemradio]').allTextContents()).join(' | '))
      await shot('sum-menu', 'pane')
      await page.locator('[data-part="表底算什么"] [role=menuitemradio]', { hasText: '平均' }).first().click()
      await page.waitForTimeout(500)
      await shot('sum-row')
    })

    await step('13a 键盘：从上面一段按 ↓ 进数据库块', async () => {
      await pane(page).locator('.cm-line', { hasText: '这学期读的' }).click()
      await page.keyboard.press('End')
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(300)
      log('after ArrowDown from paragraph: ' + (await focusInfo()) + ' cardSelLayer=' + (await page.locator('.cm-blkSelLayer > *').count()))
      await shot('kbd-down-into', 'pane')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(300)
      log('then Enter: ' + (await focusInfo()))
      await page.keyboard.press('ArrowDown')
      log('then ArrowDown: ' + (await focusInfo()))
      await shot('kbd-enter', 'pane')
    })

    await step('13 键盘：Tab 进表格', async () => {
      await pane(page).locator('.cm-line', { hasText: '这学期读的' }).click()
      const seen: string[] = []
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab')
        seen.push(await focusInfo())
      }
      log('Tab x12: ' + seen.join(' || '))
    })

    await openNote(page, '空表')
    await step('12 空表', async () => {
      await shot('empty')
    })

    await openNote(page, '很多行')
    await step('14 很多行：文档里滚、整页滚', async () => {
      await page.waitForTimeout(600)
      log('rows shown inline: ' + (await db.locator('tbody tr').count()))
      // 鼠标停在表上滚轮往下滚（用户的滚法），看表头跟不跟着走
      const box = (await db.locator('tbody').boundingBox())!
      await page.mouse.move(box.x + 200, box.y + 200)
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 300)
      await page.waitForTimeout(500)
      const headTop = async (sel: string) => Math.round((await page.locator(sel).first().boundingBox())?.y ?? -9999)
      log('inline after wheel: thead y=' + (await headTop('.pane:not([hidden]) [data-part="数据库块"] thead')) + ' first visible row y=' + (await headTop('.pane:not([hidden]) [data-part="数据库块"] tbody tr')))
      await shot('many-inline-scrolled', 'win')
      await db.getByRole('button', { name: '整页打开' }).click()
      await page.waitForTimeout(600)
      const fb = (await page.locator('.base-full tbody').boundingBox())!
      await page.mouse.move(fb.x + 200, fb.y + 200)
      for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 300)
      await page.waitForTimeout(500)
      log('full after wheel: thead y=' + (await headTop('.base-full thead')) + ' th position=' + (await page.locator('.base-full thead th').first().evaluate((e) => getComputedStyle(e).position)) + ' rows=' + (await page.locator('.base-full tbody tr').count()))
      await shot('many-full-scrolled', 'win')
      await page.keyboard.press('Escape')
    })
  } finally {
    await run.close()
  }
})
