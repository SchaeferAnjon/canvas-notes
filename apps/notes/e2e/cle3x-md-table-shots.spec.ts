/**
 * 普通表格对照 Notion 和 Tolaria（task-cle3x）的「我们」这一边：同一张冰岛自驾行程表（5 列 7 行），一项一项真点、真按键，截表格那一块。
 * 只在截对照图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色。每一步按了什么、焦点落到哪、文件变没变写进 <目录>/ours-<tone>.log。
 */
import { expect, test } from '@playwright/test'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane } from './app'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TONE = DARK ? 'dark' : 'light'
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')
test.setTimeout(300_000)

export const TRIP = `| 日期 | 路线 | 距离 | 纯车程 | 冬季估算 |
|---|---|---|---|---|
| 2.24 周三 | 机场 → 塞尔福斯 | 97 km | 1.5 h | 1.9 h |
| 2.25 周四 | 塞尔福斯 → 黄金圈 → 赫沃斯沃德勒 | 215 km | 3.4 h | 4.3 h |
| 2.26 周五 | 赫沃斯沃德勒 → 南海岸 → 冰河湖 | 301 km | 4.5 h | 5.6 h |
| 2.27 周六 | 蓝冰洞，然后冰河湖 → 维克 | 193 km | 2.8 h | 3.5 h |
| 2.28 周日 | 维克 → 雷克雅未克 | 187 km | 2.8 h | 3.5 h |
| 3.1 周一 | 雷克雅未克 → 蓝湖 → 机场 | 73 km | 1.3 h | 1.6 h |
| 合计 |  | 1,066 km | 16.3 h | 20.4 h |`

const NOTE = `# 冰岛自驾行程\n\n下面这张表用来对照普通表格的手感。\n\n${TRIP}\n\n距离和纯车程是用 OSM 路网算的，冬季估算是纯车程乘以 1.25。\n`

const WIDE = `# 宽表\n\n十列的表。\n\n| 日期 | 出发 | 到达 | 路线 | 距离 | 纯车程 | 冬季估算 | 住哪 | 门票 | 备注 |\n|---|---|---|---|---|---|---|---|---|---|\n| 2.24 周三 | 凯夫拉维克机场 | 塞尔福斯 | 1 号环岛公路 | 97 km | 1.5 h | 1.9 h | 塞尔福斯民宿 | 无 | 取车后先去超市 |\n| 2.25 周四 | 塞尔福斯 | 赫沃斯沃德勒 | 黄金圈 | 215 km | 3.4 h | 4.3 h | 农场旅馆 | 间歇泉免费 | 下午天黑早 |\n\n后面一段。\n`

const skin = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

test('冰岛行程表：普通表格一项一项真按、截图', async () => {
  mkdirSync(DIR!, { recursive: true })
  const LOG = join(DIR!, `ours-${TONE}.log`)
  writeFileSync(LOG, '')
  const log = (s: string) => appendFileSync(LOG, s + '\n')
  const run = await launch({ '冰岛自驾行程.md': NOTE, '宽表.md': WIDE }, {}, skin)
  const { page } = run
  const file = () => readFileSync(join(run.vault, '冰岛自驾行程.md'), 'utf8')
  const table = pane(page).locator('[data-part="表格"]').first()
  const shot = async (name: string, target: 'table' | 'pane' = 'table') => {
    await page.waitForTimeout(400)
    const path = join(DIR!, `ours-${name}-${TONE}.png`)
    const box = (await (target === 'table' ? table : pane(page)).boundingBox())!
    // 表格四周多留一点（左边的块把手、上面的整表把手在表外）
    const pad = target === 'table' ? 72 : 0
    await page.screenshot({ path, clip: { x: box.x - pad, y: box.y - pad / 2, width: box.width + pad * 2, height: box.height + pad } })
    log(`[shot] ${name}`)
  }
  const focusInfo = () =>
    page.evaluate(() => {
      const a = document.activeElement as HTMLElement | null
      if (!a) return 'none'
      const cell = a.closest('td,th')
      return `${a.tagName.toLowerCase()}${a.className ? '.' + String(a.className).split(' ')[0] : ''} label=${a.getAttribute('aria-label') ?? ''} inCell=${!!cell} value=${(a as HTMLInputElement).value ?? ''}`
    })
  const cell = (row: number, col: number) => (row < 0 ? table.locator('thead th').nth(col) : table.locator('tbody tr').nth(row).locator('td').nth(col))
  const step = async (name: string, fn: () => Promise<void>) => {
    log(`\n## ${name}`)
    // 每一项从同一个样子开始：光标放进表上面那一段（不按 Esc：正文里 Esc 是选中这一块，会铺一层选中底）
    await page.keyboard.press('Escape')
    await pane(page).locator('.cm-line').filter({ hasText: '下面这张表用来对照' }).first().click()
    await page.mouse.move(2, 400)
    await page.waitForTimeout(200)
    try {
      await fn()
    } catch (e) {
      log(`[失败] ${String(e).split('\n')[0]}`)
    }
  }
  /** 粘贴：不碰系统剪贴板，往焦点上发一个带 DataTransfer 的 paste 事件（走软件自己的粘贴处理） */
  const paste = (data: Record<string, string>) =>
    page.evaluate((d) => {
      const dt = new DataTransfer()
      for (const [k, v] of Object.entries(d)) dt.setData(k, v)
      ;(document.activeElement ?? document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, data)
  const same = (what: string) => log(`文件${file() === NOTE ? '没变' : '变了'}（${what}）`)
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
    await openNote(page, '冰岛自驾行程')
    await expect(table.locator('tbody tr')).toHaveCount(7)

    await step('1 整体观感', async () => {
      const m = await table.evaluate((el) => {
        const cs = (s: string) => {
          const e = el.querySelector(s) as HTMLElement | null
          if (!e) return null
          const c = getComputedStyle(e)
          const b = e.getBoundingClientRect()
          return { h: Math.round(b.height), w: Math.round(b.width), font: c.fontSize + '/' + c.fontWeight, pad: c.padding }
        }
        return { table: cs('table'), th: cs('thead th'), td: cs('tbody td') }
      })
      log(JSON.stringify(m))
      await shot('overall')
      same('只打开')
    })

    await step('2 悬停一行（有没有把手）', async () => {
      await cell(2, 1).hover()
      await shot('hover')
    })

    await step('3 单击一格', async () => {
      await cell(0, 1).click()
      log('单击「机场 → 塞尔福斯」后焦点：' + (await focusInfo()))
      await shot('click')
    })

    await step('4 Tab / ⇧Tab', async () => {
      await cell(0, 1).click()
      await page.keyboard.press('Tab')
      log('Tab 后：' + (await focusInfo()))
      await shot('tab')
      await page.keyboard.press('Shift+Tab')
      log('⇧Tab 后：' + (await focusInfo()))
    })

    await step('5 方向键', async () => {
      await cell(0, 1).click()
      await page.keyboard.press('ArrowDown')
      log('格子里按 ↓ 后：' + (await focusInfo()))
      await page.keyboard.press('ArrowRight')
      log('再按 → 后：' + (await focusInfo()))
      await shot('arrows')
    })

    await step('6 回车', async () => {
      await cell(0, 1).click()
      await page.keyboard.press('Enter')
      log('回车后：' + (await focusInfo()))
      await shot('enter')
      same('点进去回车走到下一行，没打字')
    })

    await step('7 进出不改字', async () => {
      await cell(3, 0).click()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(800)
      same('点一格、Tab 两下、Esc')
    })

    await step('8 改一格、⌘Z', async () => {
      await cell(0, 2).click()
      await page.keyboard.press('Meta+A')
      await page.keyboard.type('98 km')
      await page.keyboard.press('Escape')
      await page.waitForTimeout(800)
      const after = file()
      const changed = after.split('\n').filter((l, i) => l !== NOTE.split('\n')[i])
      log('改了「97 km」→「98 km」，文件里变的行：' + JSON.stringify(changed))
      await pane(page).locator('.cm-content').click({ position: { x: 20, y: 10 } })
      await page.keyboard.press('Meta+Z')
      await expect.poll(file, { timeout: 8000 }).toBe(NOTE).catch(() => {})
      log('⌘Z 后：' + (file() === NOTE ? '回到原样' : '没回去：' + JSON.stringify(file().split('\n').filter((l, i) => l !== NOTE.split('\n')[i]))))
    })

    await step('9 最后一行回车加一行', async () => {
      await cell(6, 0).click()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(500)
      log('最后一行回车后行数：' + (await table.locator('tbody tr').count()) + ' 焦点：' + (await focusInfo()))
      await shot('addrow')
      await page.keyboard.press('Escape')
      await pane(page).locator('.cm-content').click({ position: { x: 20, y: 10 } })
      await page.keyboard.press('Meta+Z')
      await expect.poll(file, { timeout: 8000 }).toBe(NOTE).catch(() => {})
      log('⌘Z 后：' + (file() === NOTE ? '回到原样' : '没回去'))
    })

    await step('10 块把手和块菜单', async () => {
      await cell(0, 0).hover()
      await page.mouse.move((await table.boundingBox())!.x - 20, (await table.boundingBox())!.y + 10)
      await page.waitForTimeout(300)
      const grip = pane(page).getByRole('button', { name: /拖动|把手|移动/ }).first()
      log('块把手看得到：' + (await grip.isVisible().catch(() => false)))
      await shot('grip')
      if (await grip.isVisible().catch(() => false)) {
        await grip.click()
        await page.waitForTimeout(300)
        const items = await page.locator('[role="menu"] [role="menuitem"]').allTextContents()
        log('块菜单：' + JSON.stringify(items))
        await shot('blockmenu', 'pane')
      }
    })

    await step('11 粘贴网页表格（HTML）、制表符隔开的字（Numbers / Excel）', async () => {
      // 正文最后一段末尾粘
      const last = pane(page).locator('.cm-line').filter({ hasText: '冬季估算是纯车程' })
      await last.click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await paste({ 'text/plain': '城市\t人口\n雷克雅未克\t14 万\n阿克雷里\t2 万', 'text/html': '<table><tr><th>城市</th><th>人口</th></tr><tr><td>雷克雅未克</td><td>14 万</td></tr><tr><td>阿克雷里</td><td>2 万</td></tr></table>' })
      await page.waitForTimeout(600)
      log('粘网页表格后表格数：' + (await pane(page).locator('[data-part="表格"]').count()))
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await paste({ 'text/plain': '城市\t人口\n雷克雅未克\t14 万\n阿克雷里\t2 万' })
      await page.waitForTimeout(600)
      log('粘制表符的字后表格数：' + (await pane(page).locator('[data-part="表格"]').count()))
      const tail = file().split('冬季估算是纯车程乘以 1.25。')[1]
      log('粘完文末：' + JSON.stringify(tail))
      await shot('paste', 'pane')
      // 粘进一格：Excel 复制来的 2×2
      await cell(0, 3).click()
      await paste({ 'text/plain': '1.6 h\t2.0 h\n3.0 h\t3.8 h' })
      log('格子里粘 2×2 后格子的字：' + (await focusInfo()))
      await page.keyboard.press('Escape')
    })

    // 下面几样是照 Notion 补的（改前没有把手、选中，截出来就是没有）
    await step('13 选中一格（Esc 停下）', async () => {
      await cell(1, 2).click()
      await page.keyboard.press('Escape')
      log('Esc 后焦点：' + (await focusInfo()))
      await shot('sel')
    })

    await step('14 行把手菜单', async () => {
      await cell(2, 1).hover()
      const g = pane(page).locator('.tbl-rgrip:visible')
      if (!(await g.isVisible().catch(() => false))) return log('没有行把手')
      await g.click()
      log('行菜单：' + JSON.stringify(await page.getByRole('menu').getByRole('menuitem').allTextContents()))
      await shot('rowmenu', 'pane')
    })

    await step('15 列把手菜单', async () => {
      await cell(2, 2).hover()
      const g = pane(page).locator('.tbl-cgrip:visible')
      if (!(await g.isVisible().catch(() => false))) return log('没有列把手')
      await g.click()
      log('列菜单：' + JSON.stringify(await page.getByRole('menu').locator('button').allTextContents()))
      await shot('colmenu', 'pane')
    })

    await step('16 拖列宽（拖着的时候）', async () => {
      const b = (await cell(-1, 1).boundingBox())!
      await page.mouse.move(b.x + b.width, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width + 30, b.y + b.height / 2, { steps: 4 })
      await page.mouse.move(b.x + b.width + 60, b.y + b.height / 2, { steps: 4 })
      await shot('resize')
      await page.mouse.up()
      await page.waitForTimeout(2500)
      log('拖完第二行：' + JSON.stringify(file().split('\n')[5]))
      await pane(page).locator('.cm-content').click({ position: { x: 20, y: 10 } })
      await page.keyboard.press('Meta+Z')
    })

    await step('17 拖行（拖着的时候）', async () => {
      await cell(0, 1).hover()
      const g = pane(page).locator('.tbl-rgrip:visible')
      if (!(await g.isVisible().catch(() => false))) return log('没有行把手')
      const gb = (await g.boundingBox())!
      const to = (await cell(3, 0).boundingBox())!
      await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2)
      await page.mouse.down()
      await page.mouse.move(gb.x + gb.width / 2, gb.y + 30, { steps: 3 })
      await page.mouse.move(gb.x + gb.width / 2, to.y + to.height - 6, { steps: 6 })
      await shot('dragrow')
      const was = file()
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await page.waitForTimeout(1500)
      log('拖到一半按 Esc 再松手：文件' + (file() === was ? '没变（当没拖过）' : '变了'))
    })

    await step('12 宽表横滑', async () => {
      await openNote(page, '宽表')
      const wide = pane(page).locator('[data-part="表格"]').first()
      const m = await wide.evaluate((el) => ({ client: el.clientWidth, scroll: el.scrollWidth }))
      log('宽表：' + JSON.stringify(m))
      const box = (await wide.boundingBox())!
      await page.screenshot({ path: join(DIR!, `ours-wide-${TONE}.png`), clip: { x: box.x - 40, y: box.y - 20, width: box.width + 80, height: box.height + 40 } })
    })
  } finally {
    await run.close()
  }
})
