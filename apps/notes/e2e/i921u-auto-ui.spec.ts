/**
 * 自动化的界面（task-i921u「当……就……」方向 B「先说一句」），真软件无头、假 AI（CN_AI_FAKE=1）真点真打字：
 * 1. 一个还没有规则的数据库：块头「自动化」开右栏 → 说一句（假 AI 填成「交报销单」）→ 试跑（拿这个数据库的一条试，不写文件）→ 存（块最后多一段 automations）；
 *    自己一格格选建「大额提醒」（当「金额」改了、如果 金额 > 500、就发通知）→ 存；表格里把「外卖」的分类改成「报销」→「交报销单」跑了、待办多一行、
 *    底部一句能看记录；记录里撤回 → 待办回到原样；卡片上关掉 → 只多一行 on: false；设置 › 自动化里打开 → 那一行没了；周记改成周五、关掉 AI 先填 → 自动化.md 只换那几行；
 *    总开关、错过的怎么补存在设置目录。
 * 2. 按钮列：加一列菜单「按钮」→ 右栏写它做什么（新建一条、在右栏打开它）→ 存 → 表格里每行一颗；点「咖啡」那一行的按钮 → 新建一条、右栏打开它、底部能撤回；
 *    右栏那一条里的按钮也能点；点列头在右栏改它做什么。
 * 3. 窄栏：块头「自动化」收进「⋯」，点它开右栏。
 * 每个动作之后读盘：只改了该改的那几行（packages/format 算的），打开、看记录、试跑、看写法不碰文件。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseAutomations, parseLibrary } from '@cn/format'
import { lineDiff } from '../../../packages/format/test/line-diff'
import { LEDGER_BASE, LEDGER_DOC_PATH, LEDGER_FILES, LEDGER_ROWS, TODO_DOC } from './auto-samples'
import { gitStatus, launch, openNote, pane, rail, widenRight } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')
const blockOf = (text: string) => /```base\n([\s\S]*?)\n```/.exec(text)?.[1] ?? ""
const git = (vault: string, ...a: string[]) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' }).trim()
const db = (page: Page) => pane(page).locator('[data-part="数据库块"]').first()
const side = (page: Page) => page.getByTestId('dview-auto')
const toast = (page: Page) => page.getByTestId('toast')
const card = (page: Page, name: string) => side(page).locator(`[data-part="一条自动化"][data-name="${name}"]`)
const settings = (page: Page) => page.getByRole('dialog', { name: '设置' })
async function clickSteady(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await el.click()
}
/** 改一格选项：点格子、在弹出的选项里点一个 */
async function pickOption(page: Page, row: string, from: string, to: string) {
  const cell = db(page).locator('tbody tr', { hasText: row }).locator('td', { hasText: new RegExp(`^${from}$`) })
  // 单击只选中一格（task-cle3x 格子焦点），再点一下开选项
  await clickSteady(page, cell)
  await cell.click()
  await page.getByLabel(`${row} · 分类`).getByText(to, { exact: true }).first().click()
}

test('自动化：说一句建一条、试跑、存；一格格选建一条；改格子触发、看记录、撤回；卡片和设置里开关；周记设置', async () => {
  test.setTimeout(300_000)
  const run = await launch(LEDGER_FILES, { CN_AI_FAKE: '1', CN_AUTO_SETTLE_MS: '400' })
  const { page, vault } = run
  const doc = () => read(vault, LEDGER_DOC_PATH)
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '2026 记账')
    await expect(db(page).locator('tbody tr')).toHaveCount(14)

    // ---------- 块头「自动化」：右栏开这一页（还没有规则）；右图标栏的 ⚡ 亮；打开不写文件
    const entry = db(page).locator('[data-part="自动化入口"]')
    await expect(entry).toHaveText('自动化')
    await entry.click()
    await expect(side(page)).toBeVisible()
    await expect(page.locator('.dtab[data-view="auto"] .dname')).toHaveText('自动化')
    await expect(entry).toHaveClass(/\bon\b/)
    await expect(rail(page).getByRole('button', { name: '自动化', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(side(page).locator('.au-seg')).toContainText('规则0记录0')
    await expect(side(page).locator('.au-seg')).toContainText('数据库「账目」')
    // 「比如」照这个数据库的列说（不预置规则）
    await expect(side(page).locator('.au-say .pill')).toHaveCount(4)
    await expect(side(page).locator('[data-part="一条自动化"]')).toHaveCount(0)
    await page.waitForTimeout(500)
    expect(gitStatus(vault)).toBe('')

    // ---------- 说一句：AI 填成三段（填的时候三段上走一道光），看过再存
    const say = side(page).getByRole('textbox', { name: '说一句' })
    await say.click()
    await say.pressSequentially('分类改成报销，就提醒我下周一交报销单')
    await say.press('Enter')
    await expect(side(page).locator('[data-part="编辑一条自动化"]')).toBeVisible()
    await expect(side(page).locator('.au-filled')).toContainText('照「分类改成报销，就提醒我下周一交报销单」填好了', { timeout: 15_000 })
    await expect(side(page).getByRole('textbox', { name: '规则叫什么' })).toHaveValue('交报销单')
    await expect(side(page).locator('[data-part="当"] .trow .ch').first()).toHaveText('「分类」改成「报销」')
    await expect(side(page).locator('[data-part="一步"]')).toHaveCount(1)
    await expect(side(page).locator('[data-part="一步"]')).toContainText('加一条待办或提醒')
    // 试跑：拿这个数据库的一条（不是库里的规则），什么都不写
    await side(page).getByRole('button', { name: '试跑' }).click()
    const trial = side(page).locator('[data-part="试跑"]')
    await expect(trial).toContainText('拿《')
    await expect(trial).toContainText('在「生活/待办」加一条「交报销单：')
    await expect(trial).not.toContainText('还有问题')
    await expect(trial).toContainText('只是给你看，什么都没写')
    // 看写法：这一条在 md 里的样子
    await side(page).getByRole('button', { name: '看写法' }).click()
    await expect(side(page).locator('[data-part="这一条的写法"]')).toContainText('- name: 交报销单')
    await page.waitForTimeout(400)
    expect(gitStatus(vault)).toBe('')

    // 存：块最后多一段 automations，别的一个字不动；一次提交；底部一句能撤回
    await side(page).getByRole('button', { name: '存', exact: true }).click()
    await expect(card(page, '交报销单')).toBeVisible()
    await expect(toast(page)).toContainText('加了自动化「交报销单」')
    await expect.poll(() => parseAutomations(blockOf(doc())).map((r) => r.name)).toEqual(['交报销单'])
    const d1 = lineDiff(LEDGER_BASE, blockOf(doc()))
    expect(d1.removed).toEqual([])
    expect(d1.added[0]).toBe('automations:')
    expect(d1.added).toContain('  - name: 交报销单')
    expect(doc().replace(blockOf(doc()), LEDGER_BASE)).toBe(LEDGER_FILES[LEDGER_DOC_PATH])
    await expect.poll(() => gitStatus(vault)).toBe('')
    await expect(card(page, '交报销单')).toContainText('当 「分类」改成「报销」 · 就 加一条待办「交报销单：名字 金额」')
    await expect(card(page, '交报销单')).toContainText('还没跑过')
    await expect(db(page).locator('[data-part="自动化入口"]')).toHaveText('自动化1')

    // ---------- 自己一格格选：当「金额」改了 · 如果 金额 > 500 · 就 发通知
    await side(page).getByRole('button', { name: '自己一格格选' }).click()
    await side(page).getByRole('textbox', { name: '规则叫什么' }).fill('大额提醒')
    await side(page).getByRole('button', { name: '选一个' }).click()
    const when = page.getByRole('menu', { name: '当什么时候' })
    await expect(when.getByRole('menuitem')).toHaveText([/^新加一条/, /^某一列改了/, /^某一列改成某个值/, /^到了某一列的日子/, /^定时/])
    await when.getByRole('menuitem', { name: /^某一列改了/ }).click()
    // 要填的就在菜单下面：选「金额」
    await when.getByRole('combobox', { name: '哪一列' }).selectOption('金额')
    await page.keyboard.press('Escape')
    await expect(when).toHaveCount(0)
    await expect(side(page).locator('[data-part="当"] .trow .ch').first()).toHaveText('「金额」改了')
    await side(page).getByRole('button', { name: '加一条条件' }).click()
    const cond = side(page).locator('[data-part="如果"] .trow').first()
    await cond.getByRole('combobox', { name: '哪一列' }).selectOption({ label: '金额' })
    await cond.getByRole('combobox', { name: '条件' }).selectOption({ label: '>' })
    await cond.getByRole('textbox', { name: '值' }).fill('500')
    await side(page).getByRole('button', { name: '加一步' }).click()
    const steps = page.getByRole('menu', { name: '加一步' })
    await expect(steps.getByRole('group')).toHaveText([/^改数据/, /^AI（和 AI 列一套）/, /^告诉我/, /^命令/])
    await steps.getByRole('menuitem', { name: '发通知' }).click()
    await side(page).getByRole('textbox', { name: '通知写什么' }).fill('这笔有点大：{{名字}}')
    await page.waitForTimeout(300)
    expect(gitStatus(vault)).toBe('')
    const before2 = blockOf(doc())
    await side(page).getByRole('button', { name: '存', exact: true }).click()
    await expect(card(page, '大额提醒')).toBeVisible()
    await expect.poll(() => parseAutomations(blockOf(doc())).map((r) => r.name)).toEqual(['交报销单', '大额提醒'])
    const big = parseAutomations(blockOf(doc()))[1]!
    expect(big.when).toEqual([{ on: 'changed', prop: '金额' }])
    expect(big.do).toEqual([{ do: 'notify', text: '这笔有点大：{{名字}}' }])
    expect(big.if?.items).toEqual([{ prop: '金额', op: '>', value: '500' }])
    expect(lineDiff(before2, blockOf(doc())).removed).toEqual([])
    await expect.poll(() => gitStatus(vault)).toBe('')

    // ---------- 改格子：「外卖」的分类改成「报销」→「交报销单」跑了：待办多一行、记录一行、底部「看记录」「撤回」
    const todo0 = read(vault, TODO_DOC)
    await pickOption(page, '外卖', '餐饮', '报销')
    await expect(toast(page)).toContainText('自动化「交报销单」跑了', { timeout: 20_000 })
    await expect.poll(() => read(vault, TODO_DOC)).toContain('- [ ] 交报销单：外卖 41')
    expect(lineDiff(todo0, read(vault, TODO_DOC)).removed).toEqual([])
    expect(lineDiff(LEDGER_ROWS['生活/账目/外卖.md']!, read(vault, '生活/账目/外卖.md'))).toEqual({ removed: ['分类: 餐饮'], added: ['分类: 报销'] })
    // 「大额提醒」没跑（金额没改），也不连锁
    await expect(card(page, '交报销单')).toContainText('跑过1次')
    await expect(card(page, '大额提醒')).toContainText('还没跑过')
    await toast(page).getByRole('button', { name: '看记录' }).click()
    await expect(side(page).locator('[data-part="自动化记录"]')).toBeVisible()
    const row = side(page).locator('[data-part="一行记录"][data-name="交报销单"]')
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('因为')
    await expect(row).toContainText('做了 在「生活/待办」加了一条「交报销单：外卖 41」')

    // ---------- 撤回那一次：待办回到原样，那一行划掉
    await row.getByRole('button', { name: '撤回' }).click()
    await expect(row).toHaveClass(/undone/, { timeout: 15_000 })
    await expect(row).toContainText('撤回了')
    await expect.poll(() => read(vault, TODO_DOC)).toBe(todo0)
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/撤回/)

    // ---------- 卡片上关掉「交报销单」：只多一行 on: false
    await side(page).getByRole('tab', { name: /规则/ }).click()
    const before3 = blockOf(doc())
    await card(page, '交报销单').getByRole('switch', { name: '交报销单' }).click()
    await expect.poll(() => lineDiff(before3, blockOf(doc()))).toEqual({ removed: [], added: ['    on: false'] })
    await expect(card(page, '交报销单')).toHaveClass(/\boff\b/)
    await expect(db(page).locator('[data-part="自动化入口"]')).toHaveText('自动化1')

    // ---------- 设置 › 自动化：自带的三样、自己建的两条；在这里打开「交报销单」，数据库里那一行跟着没了
    await side(page).getByRole('button', { name: '设置里看全部 ›' }).click()
    await expect(settings(page)).toBeVisible()
    await expect(settings(page).getByTestId('settings-head').locator('h2')).toHaveText('自动化')
    const sys = settings(page).getByRole('group', { name: '软件自带的' })
    await expect(sys.locator('.sa-lb')).toHaveText(['周记', '梦游', '定时整理收件箱'])
    const mine = settings(page).getByRole('group', { name: '数据库里建的' })
    await expect(mine.locator('.au-rn')).toHaveText(['交报销单', '大额提醒'])
    await expect(mine).toContainText('跑过1次')
    await mine.getByRole('switch', { name: '交报销单' }).click()
    await expect.poll(() => blockOf(doc())).toBe(before3)
    await expect(settings(page)).toContainText('打开了「交报销单」，数据库里跟着变')

    // ---------- 周记：周几改成五、关掉「AI 先填」：自动化.md 只换那几行
    await settings(page).locator('[data-part="周记"] .sa-lb').click()
    await expect(settings(page).locator('.au-subhead h2')).toHaveText('周记')
    await settings(page).getByRole('radio', { name: '五' }).click()
    const lib = () => (existsSync(join(vault, '.canvas-notes/自动化.md')) ? read(vault, '.canvas-notes/自动化.md') : '')
    await expect.poll(() => parseLibrary(lib()).find((r) => r.name === '周记')?.when).toEqual([{ on: 'every', every: 'week', day: '五', at: '20:00' }])
    const lib1 = lib()
    await settings(page).getByRole('switch', { name: '建好以后让 AI 先填一段' }).click()
    await expect.poll(() => lineDiff(lib1, lib())).toEqual({ removed: ['    - command: /写这周的周记', '      reads: [写了剪了, 做完的待办, 梦游报告]'], added: [] })
    await expect(settings(page).getByRole('radio', { name: '五' })).toHaveAttribute('aria-checked', 'true')
    // 回到自动化：周记那一行写着周五
    await settings(page).getByRole('button', { name: '回到自动化' }).click()
    await expect(settings(page).locator('[data-part="周记"]')).toContainText('每周五 20:00 新建本周那篇')

    // ---------- 总开关、错过的怎么补：存在设置目录（不进库）
    await settings(page).getByRole('switch', { name: '自动化', exact: true }).click()
    await expect(settings(page)).toContainText('自动化全部停下，规则都留着')
    await settings(page).getByRole('combobox', { name: 'Mac 关着时错过的' }).selectOption('skip')
    const prefs = () => (JSON.parse(readFileSync(join(vault, '..', 'user-data', 'automation.json'), 'utf8')) as { prefs: { on: boolean; missed: string } }).prefs
    await expect.poll(() => prefs()).toMatchObject({ on: false, missed: 'skip' })
    // 只在这台 Mac 上：库里没有多出别的文件（外卖.md 是自己改的那一格，等自动提交）
    expect(gitStatus(vault).split('\n').filter(Boolean).map((l) => l.slice(3))).toEqual(['生活/账目/外卖.md'])
  } finally {
    await run.close()
  }
})

test('按钮列：加一列「按钮」、写它做什么、存；格子里点、右栏一条里点；新建的那条在右栏开、底部能撤回；点列头改它做什么', async () => {
  test.setTimeout(240_000)
  const run = await launch(LEDGER_FILES, { CN_AI_FAKE: '1', CN_AUTO_SETTLE_MS: '400' })
  const { page, vault } = run
  const doc = () => read(vault, LEDGER_DOC_PATH)
  const rows = () => execFileSync('ls', [join(vault, '生活/账目')], { encoding: 'utf8' }).trim().split('\n')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '2026 记账')
    await expect(db(page).locator('tbody tr')).toHaveCount(14)

    // 加一列菜单最下面「动手」：按钮、AI 生成一列
    await clickSteady(page, db(page).getByRole('button', { name: '加一列' }))
    const add = page.getByRole('dialog', { name: '加一列' })
    await expect(add.getByRole('menuitem', { name: /^按钮/ })).toContainText('点一下跑一串动作')
    await add.getByRole('menuitem', { name: /^按钮/ }).click()
    await expect(side(page).locator('[data-part="按钮做的事"]')).toBeVisible()
    await side(page).getByRole('textbox', { name: '按钮叫什么' }).fill('再记一笔')
    await side(page).getByRole('button', { name: '加一步' }).click()
    const steps = page.getByRole('menu', { name: '加一步' })
    // 只给按钮的两样也在
    await expect(steps.getByRole('group', { name: '只给按钮' }).getByRole('menuitem')).toHaveText(['先问一句', '在右栏打开它'])
    await steps.getByRole('menuitem', { name: '新建一条' }).click()
    await side(page).getByRole('textbox', { name: '照这一条抄哪几列' }).fill('金额、分类、收支')
    await side(page).getByRole('textbox', { name: '新的一条填什么' }).fill('日期 = 今天')
    await side(page).getByRole('button', { name: '加一步' }).click()
    await page.getByRole('menu', { name: '加一步' }).getByRole('menuitem', { name: '在右栏打开它' }).click()
    await page.waitForTimeout(300)
    expect(gitStatus(vault)).toBe('')
    await side(page).getByRole('button', { name: '存', exact: true }).click()
    await expect(toast(page)).toContainText('加了按钮列「再记一笔」')
    // 块里：properties 多一列 type: button（do 两步），视图的列多一个；别的不动
    await expect.poll(() => blockOf(doc())).toContain('  再记一笔:\n    type: button\n    do:\n')
    const d = lineDiff(LEDGER_BASE, blockOf(doc()))
    expect(d.removed).toEqual([])
    expect(d.added).toEqual(expect.arrayContaining(['  再记一笔:', '    type: button', '      - 再记一笔']))
    await expect(db(page).locator('thead')).toContainText('再记一笔')
    const btn = (name: string) => db(page).locator('tbody tr', { hasText: name }).getByRole('button', { name: `「${name}」这一行点「再记一笔」` })
    await expect(btn('咖啡')).toBeVisible()

    // 点「咖啡」那一行：新建一条（抄金额、分类、收支，日期今天），右栏开它；底部一句能撤回
    const n0 = rows().length
    await clickSteady(page, btn('咖啡'))
    await expect(toast(page)).toContainText('按钮「再记一笔」', { timeout: 20_000 })
    await expect.poll(() => rows().length).toBe(n0 + 1)
    const made = rows().find((f) => !Object.keys(LEDGER_ROWS).some((p) => p.endsWith('/' + f)))!
    const text = read(vault, `生活/账目/${made}`)
    expect(text).toContain('金额: 18')
    expect(text).toContain('分类: 餐饮')
    await expect(page.getByTestId('dview-record')).toBeVisible()
    // 右栏那一条里也有这颗按钮
    const peek = page.getByTestId('dview-record')
    await expect(peek.locator('.au-peekbtn')).toContainText('按钮列在这里也能点')
    // 右栏那一条里点：照样新建一条（照新的那条抄）
    await peek.locator('.au-peekbtn').getByRole('button').click()
    await expect.poll(() => rows().length).toBe(n0 + 2)
    // 底部撤回：刚新建的那条删掉
    await expect(toast(page).getByRole('button', { name: '撤回' })).toBeVisible({ timeout: 20_000 })
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => rows().length).toBe(n0 + 1)

    // 点列头：右栏改它做什么（两步都在）；列菜单最上面一段「按钮 · 点一下做 2 步」
    await clickSteady(page, db(page).locator('thead .base-th', { hasText: '再记一笔' }))
    await expect(page.getByRole('group', { name: '按钮列' })).toContainText('按钮 · 点一下做 2 步')
    await expect(side(page).locator('[data-part="按钮做的事"]')).toBeVisible()
    await expect(side(page).locator('[data-part="一步"]')).toHaveCount(2)
  } finally {
    await run.close()
  }
})

test('窄栏：块头「自动化」收进「⋯」，点它开右栏', async () => {
  test.setTimeout(120_000)
  const run = await launch(LEDGER_FILES, {})
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await armMenus(run)
    await openNote(page, '2026 记账')
    await expect(db(page).locator('[data-part="自动化入口"]')).toBeVisible()
    await rail(page).getByRole('button', { name: '历史' }).click()
    await widenRight(page, 400)
    await expect(db(page).locator('[data-part="自动化入口"]')).toHaveCount(0)
    await db(page).getByRole('button', { name: '工具条上放不下的' }).click()
    expect(menuLabels(await openedMenu(run))[0]).toBe('自动化')
    await pickMenu(run, '自动化')
    await expect(side(page)).toBeVisible()
  } finally {
    await run.close()
  }
})
