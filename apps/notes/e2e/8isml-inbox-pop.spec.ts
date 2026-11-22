/**
 * 白板收件箱做成弹窗（task-8isml，用户定「一律弹窗」，图在 01-画布笔记小处 inbox-pop-*.png）：
 * - 宽窄都一样：默认收着，点标签条「收件箱 N」从按钮下面弹出 320 宽，盖在白板上、不占白板的宽；点外面、esc 收起；
 * - ⇧⌘I 开关（命令表「打开 / 收起收件箱」，只在白板上起作用，设置 › 快捷键能改），按钮提示「打开收件箱 ⇧⌘I」；
 * - 最高 min(中栏高 − 32, 560)，头、说明、搜索框钉在上面，「共 N 条 · 打开收件箱文件夹」钉在下面，只有中间列表滚；
 * - 按住一条拖出去列表不滚，拖到列表上下边缘自动滚，拖进一列照常写进那一节，拖完弹窗不收；
 * - 「今天 / 更早」组头能收起，记在本机。
 * 正常宽（1440）和中栏 420（右栏开「历史」拉宽）各走一遍。都是真点、真按、真拖。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, type Running, tabOn, waitSaved, widenRight } from './app'
import { board, col, FILES, openBoard } from './fixtures/board-doc'

const pop = (page: Page) => board(page).getByRole('dialog', { name: '收件箱' })
/** 弹窗出来时有 0.14 秒落下的动画：等它走完再量 */
const settled = async (page: Page) => {
  await expect(pop(page)).toBeVisible()
  await pop(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
}
const btn = (page: Page) => acts(page).getByTestId('db-inbox')
const box = async (l: ReturnType<Page['locator']>) => (await l.boundingBox())!
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** 收件箱 45 条：今天 6 条、更早 39 条（created 写在开头，按它分组） */
function many(): Record<string, string> {
  const files: Record<string, string> = Object.fromEntries(Object.entries(FILES).filter(([k]) => !k.startsWith('收件箱/')))
  const today = ymd(new Date())
  for (let i = 1; i <= 6; i++) files[`收件箱/今天 ${i}.md`] = `---\ncreated: ${today} 00:0${i}\n---\n今天第 ${i} 条速记。\n`
  for (let i = 1; i <= 39; i++) {
    const d = new Date(Date.now() - (2 + Math.floor(i / 4)) * 86400_000)
    files[`收件箱/更早 ${i}.md`] = `---\ncreated: ${ymd(d)} 09:${String(i).padStart(2, '0')}\n---\n更早第 ${i} 条速记。\n`
  }
  return files
}

async function start(files: Record<string, string>, w: number) {
  const run = await launch(files)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  await openBoard(run.page, '冰岛十天环岛')
  if (w) await centerTo(run.page, w)
  return run
}

/** 中栏窄到 w：右栏开「历史」，拖右栏左边的分隔线拉宽（跟人一样） */
async function centerTo(page: Page, w: number) {
  await page.keyboard.press('Meta+y')
  await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
  for (let i = 0; i < 3; i++) {
    const bw = (await box(board(page))).width
    if (Math.abs(bw - w) < 1) break
    await widenRight(page, bw - w)
    await page.waitForTimeout(200)
  }
  expect(Math.round((await box(board(page))).width)).toBe(w)
}

/** 白板上一块空白（不在列、卡、工具板、顶上那条、弹窗上） */
async function blank(page: Page) {
  const at = await board(page).evaluate((b) => {
    const r = b.getBoundingClientRect()
    for (let y = r.bottom - 30; y > r.top + 100; y -= 20)
      for (let x = r.left + 110; x < r.right - 20; x += 20) {
        const el = document.elementFromPoint(x, y)
        if (el && b.querySelector('.board-wrap')!.contains(el) && !el.closest('.db-col, .db-card, .db-top, .bpal, .dbx')) return { x, y }
      }
    return null
  })
  expect(at).not.toBeNull()
  return at!
}

/** 设置 › 快捷键：点这一条的键位，按一个新组合（同 keys.spec.ts） */
async function setKeyInSettings(page: Page, id: string, name: string, pw: string) {
  const dlg = page.getByRole('dialog', { name: '设置' })
  if (!(await dlg.isVisible())) await page.keyboard.press('Meta+Comma')
  await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
  const row = dlg.locator(`[data-row="k-cmd-${id}"]`)
  await row.getByRole('button', { name: `改 ${name} 的快捷键` }).click()
  await expect(row.getByRole('button', { name: `改 ${name} 的快捷键` })).toHaveText('按新的组合键…')
  await page.keyboard.press(pw)
  await expect(row.locator('.sa-keyb')).toHaveText('⌃⌘I')
  await page.keyboard.press('Escape')
  await expect(dlg).toHaveCount(0)
}

for (const W of [0, 420]) {
  const where = W ? `中栏 ${W}` : '正常宽'
  test(`${where}：默认收着；点「收件箱 N」从按钮下面弹出 320 宽，白板宽度不变；点外面、esc 收起；⇧⌘I 开关，只在白板上；提示「打开收件箱 ⇧⌘I」；设置里改了键跟着变`, async () => {
    const run = await start(FILES, W)
    const { page } = run
    try {
      const wrap = board(page).locator('.board-wrap')
      await expect(btn(page)).toHaveText('收件箱2')
      // 默认收着：白板占满中栏
      await expect(pop(page)).toHaveCount(0)
      const host = await box(board(page))
      const w0 = (await box(wrap)).width
      expect(Math.abs(w0 - host.width)).toBeLessThan(1)
      // 按钮提示：打开收件箱 ⇧⌘I
      await btn(page).hover()
      await expect(page.getByTestId('tooltip')).toContainText('打开收件箱')
      await expect(page.getByTestId('tooltip')).toContainText('⇧⌘I')
      await expect(btn(page)).toHaveAttribute('aria-expanded', 'false')
      // 点开：从按钮下面弹出 320 宽，收在中栏里离两边至少 8，白板宽度不变
      await btn(page).click()
      await settled(page)
      await expect(btn(page)).toHaveAttribute('aria-expanded', 'true')
      const p = await box(pop(page))
      const b = await box(btn(page))
      expect(Math.round(p.width)).toBe(320)
      expect(Math.abs(p.y - (b.y + b.height + 6))).toBeLessThan(1)
      expect(p.x).toBeGreaterThanOrEqual(host.x + 8 - 0.5)
      expect(p.x + p.width).toBeLessThanOrEqual(host.x + host.width - 8 + 0.5)
      if (!W) expect(Math.abs(p.x + p.width - (b.x + b.width))).toBeLessThan(1)
      expect(Math.abs((await box(wrap)).width - w0)).toBeLessThan(1)
      // 头上「⇧⌘I」，底下「共 2 条 · 打开收件箱文件夹」
      await expect(pop(page).locator('.dbr-head')).toContainText('2条')
      await expect(pop(page).locator('.dbr-head kbd')).toHaveText('⇧⌘I')
      await expect(pop(page).locator('.dbr-foot')).toContainText('共 2 条')
      await expect(pop(page).locator('.dbr-foot').getByRole('button', { name: '打开收件箱文件夹' })).toBeVisible()
      // 弹窗不抢焦点
      expect(await pop(page).evaluate((el) => el.contains(document.activeElement))).toBe(false)
      // 点外面（白板空白处）收起
      const at = await blank(page)
      await page.mouse.click(at.x, at.y)
      await expect(pop(page)).toHaveCount(0)
      // ⇧⌘I 打开、再按收起；开着按 esc 收起
      await page.keyboard.press('Shift+Meta+KeyI')
      await expect(pop(page)).toBeVisible()
      await page.keyboard.press('Shift+Meta+KeyI')
      await expect(pop(page)).toHaveCount(0)
      await page.keyboard.press('Shift+Meta+KeyI')
      await expect(pop(page)).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(pop(page)).toHaveCount(0)
      // 开着时提示是「收起收件箱」
      await btn(page).click()
      await page.mouse.move(0, 400)
      await expect(page.getByTestId('tooltip')).toHaveCount(0)
      await btn(page).hover()
      await expect(page.getByTestId('tooltip')).toContainText('收起收件箱')
      await btn(page).click()
      await expect(pop(page)).toHaveCount(0)
      // 文档看法里按 ⇧⌘I 不做事
      await acts(page).getByRole('tab', { name: '文档' }).click()
      await page.keyboard.press('Shift+Meta+KeyI')
      await page.waitForTimeout(300)
      await expect(page.getByRole('dialog', { name: '收件箱' })).toHaveCount(0)
      await acts(page).getByRole('tab', { name: '白板' }).click()
      await expect(board(page)).toBeVisible()
      // 「打开收件箱文件夹」：中间开收件箱这个文件夹的首页，弹窗收起
      await page.keyboard.press('Shift+Meta+KeyI')
      await pop(page).getByRole('button', { name: '打开收件箱文件夹' }).click()
      await expect(tabOn(page)).toHaveText('收件箱')
      await expect(page.getByRole('dialog', { name: '收件箱' })).toHaveCount(0)
      if (W) return
      // 设置 › 快捷键里改成 ⌃⌘I：提示跟着变，新键能用，旧键不再做事
      await openBoard(page, '冰岛十天环岛')
      await setKeyInSettings(page, 'board-inbox', '打开 / 收起收件箱', 'Control+Meta+KeyI')
      await expect(btn(page)).toHaveAttribute('data-key', '⌃⌘I')
      await board(page).locator('.board-wrap').click({ position: { x: 300, y: 700 } })
      await page.keyboard.press('Shift+Meta+KeyI')
      await page.waitForTimeout(300)
      await expect(pop(page)).toHaveCount(0)
      await page.keyboard.press('Control+Meta+KeyI')
      await expect(pop(page)).toBeVisible()
      await expect(pop(page).locator('.dbr-head kbd')).toHaveText('⌃⌘I')
      // 开着弹窗，只用键盘（⌘O 回车）切到另一块白板：那块白板和弹窗一起挂上，弹窗照样摆好、看得见
      await page.keyboard.press('Meta+o')
      await page.getByRole('dialog', { name: '按名字跳到' }).getByRole('textbox', { name: '按名字跳到文件' }).fill('冰岛照片墙')
      await page.waitForTimeout(200)
      await page.keyboard.press('Enter')
      await expect(tabOn(page)).toHaveText('冰岛照片墙')
      await settled(page)
      expect(Math.round((await box(pop(page))).width)).toBe(320)
      await expect(pop(page)).toHaveCSS('visibility', 'visible')
    } finally {
      await run.close()
    }
  })

  test(`${where}：45 条时最高 min(中栏 − 32, 560)，头尾钉住只有列表滚；按住拖出去列表不滚、拖进白板写对、拖完不收；拖到边缘自动滚；组头收起记在本机`, async () => {
    const run: Running = await start(many(), W)
    const { page, vault } = run
    const file = () => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')
    try {
      await page.keyboard.press('Shift+Meta+KeyI')
      const P = pop(page)
      await settled(page)
      await expect(P.locator('.dbr-head')).toContainText('45条')
      await expect(P.getByRole('textbox', { name: '在收件箱里找' })).toBeVisible()
      await expect(P.locator('.dbr-foot')).toContainText('共 45 条')
      const list = P.getByRole('list', { name: '收件箱里的' })
      const host = await box(board(page))
      const p = await box(P)
      expect(Math.abs(p.height - Math.min(host.height - 32, 560))).toBeLessThan(1)
      // 只有中间列表滚：弹窗自己不滚
      expect(await P.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0)
      expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
      // 卡片左右离弹窗边一样宽，和搜索框对齐（列表的滚动条那一道不把卡片往里挤）
      const sb = await box(P.locator('.dbr-search'))
      const cb = await box(P.getByRole('listitem').first())
      expect(Math.abs(cb.x - sb.x)).toBeLessThan(1)
      expect(Math.abs(cb.x + cb.width - (sb.x + sb.width))).toBeLessThan(1)
      // 说明两句各占一行
      expect(Math.round((await box(P.locator('.dbr-hint span').first())).y)).toBeLessThan(Math.round((await box(P.locator('.dbr-hint span').last())).y))
      // 滚列表：头、搜索框、底下一行不动
      const fixed = async () => ({ head: (await box(P.locator('.dbr-head'))).y, search: (await box(P.locator('.dbr-search'))).y, foot: (await box(P.locator('.dbr-foot'))).y })
      const before = await fixed()
      const lb = await box(list)
      await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2)
      await page.mouse.wheel(0, 400)
      await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(100)
      expect(await fixed()).toEqual(before)
      expect((await box(P.locator('.dbr-foot'))).y + (await box(P.locator('.dbr-foot'))).height).toBeLessThanOrEqual(p.y + p.height + 0.5)

      // 拖到列表上下边缘自动滚：按住一条，挪到底边 8 以内停一会儿，往下滚；挪到顶边往回滚；在弹窗上松手什么都不写
      const scroll = () => list.evaluate((el) => el.scrollTop)
      const one = P.getByRole('listitem').filter({ hasText: '更早第 3 条速记。' })
      await one.scrollIntoViewIfNeeded()
      const s0 = await scroll()
      const ob = await box(one)
      await page.mouse.move(ob.x + 60, ob.y + 20)
      await page.mouse.down()
      // 按住刚开始挪：列表不滚
      await page.mouse.move(ob.x + 70, ob.y + 30, { steps: 3 })
      await page.waitForTimeout(250)
      expect(await scroll()).toBe(s0)
      const lb2 = await box(list)
      await page.mouse.move(lb2.x + lb2.width / 2, lb2.y + lb2.height - 8, { steps: 8 })
      await page.waitForTimeout(600)
      const s1 = await scroll()
      expect(s1).toBeGreaterThan(s0 + 40)
      await page.mouse.move(lb2.x + lb2.width / 2, lb2.y + 8, { steps: 8 })
      await page.waitForTimeout(600)
      expect(await scroll()).toBeLessThan(s1 - 40)
      // 在弹窗头上松手：不放、不写
      const hb = await box(P.locator('.dbr-head'))
      await page.mouse.move(hb.x + 100, hb.y + hb.height / 2, { steps: 4 })
      await page.mouse.up()
      await page.waitForTimeout(300)
      expect(file()).toBe(FILES['项目/冰岛十天环岛.md'])
      await expect(P.getByRole('listitem')).toHaveCount(45)

      // 按住一条横着拖出弹窗：列表不跟着滚；松手放进白板，文件里写对；弹窗不收
      const item = P.getByRole('listitem').filter({ hasText: '更早第 5 条速记。' })
      await item.scrollIntoViewIfNeeded()
      const keep = await scroll()
      const ib = await box(item)
      await page.mouse.move(ib.x + 40, ib.y + ib.height / 2)
      await page.mouse.down()
      await page.mouse.move(ib.x - 30, ib.y + ib.height / 2, { steps: 6 })
      await page.waitForTimeout(200)
      expect(await scroll()).toBe(keep)
      if (!W) {
        // 正常宽：拖进「住哪」，落点一条线，松手插进那一节
        const t = await box(col(page, '住哪').locator('.db-card').first())
        await page.mouse.move(t.x + 100, t.y + t.height + 10, { steps: 14 })
        await expect(col(page, '住哪').locator('.db-drop')).toHaveCount(1)
        expect(await scroll()).toBe(keep)
        await page.mouse.up()
        await expect(col(page, '住哪').locator('.db-card', { hasText: '更早第 5 条速记。' })).toBeVisible()
        await waitSaved(page)
        expect(file()).toContain('三晚。\n\n更早第 5 条速记。\n\n## 路线')
      } else {
        // 中栏 420：弹窗盖住了列，拖到它下面的空白处，放在那里（文末带一行位置）
        const at = await blank(page)
        expect(at.y).toBeGreaterThan(p.y + p.height)
        await page.mouse.move(at.x, at.y, { steps: 14 })
        expect(await scroll()).toBe(keep)
        await page.mouse.up()
        await expect(board(page).locator('.db-card.placed', { hasText: '更早第 5 条速记。' })).toBeVisible()
        await waitSaved(page)
        expect(file()).toMatch(/<!-- card id=d1 x=\d+ y=\d+ -->\n更早第 5 条速记。\n$/)
      }
      await expect(P).toBeVisible()
      await expect(P.getByRole('listitem')).toHaveCount(44)

      // 组头收起：「更早」点一下只剩今天 6 条；记在本机，重开还收着
      const older = P.getByRole('button', { name: '更早' })
      await expect(older).toHaveAttribute('aria-expanded', 'true')
      await older.click()
      await expect(older).toHaveAttribute('aria-expanded', 'false')
      await expect(P.getByRole('listitem')).toHaveCount(6)
      await page.reload()
      await expect(tabOn(page)).toHaveText('冰岛十天环岛')
      await expect(board(page)).toBeVisible()
      await expect(pop(page)).toHaveCount(0)
      await btn(page).click()
      await expect(pop(page).getByRole('button', { name: '更早' })).toHaveAttribute('aria-expanded', 'false')
      await expect(pop(page).getByRole('listitem')).toHaveCount(6)
      await pop(page).getByRole('button', { name: '今天' }).click()
      await expect(pop(page).getByRole('listitem')).toHaveCount(0)
      await pop(page).getByRole('button', { name: '今天' }).click()
      await pop(page).getByRole('button', { name: '更早' }).click()
      await expect(pop(page).getByRole('listitem')).toHaveCount(44)

      // 窗口矮了：最高跟着变成中栏高 − 32
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(BrowserWindow.getAllWindows()[0]!.getContentSize()[0]!, 560))
      await expect.poll(async () => Math.round((await box(board(page))).height)).toBeLessThan(560)
      const h2 = await box(board(page))
      await expect.poll(async () => Math.round((await box(pop(page))).height)).toBe(Math.round(Math.min(h2.height - 32, 560)))
    } finally {
      await run.close()
    }
  })
}
