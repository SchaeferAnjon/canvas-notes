/**
 * 白板和文档联动（2026-11-21 方向 A「一份文字两种看法」，task-vcov6）：白板就是这篇文档，## 是列、一段是一张卡。
 * 都是真点、真拖、真打字：白板上改卡切文档看、文档里加一段切白板看、收件箱拖一条进列、加数据库卡展开改一格、空白卡打 / 插一块、
 * 卡底没有位置行；旧白板第一次打开一次转写法（字不丢、位置还在、一次提交）、撤回字节一样；文档里嵌白板、嵌一节勾待办、提到这篇的。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { OLD_BOARDS } from '../../../packages/format/test/fixtures'
import { acts, gitStatus, inboxPop, launch, leftView, pane, tabOn, waitSaved } from './app'
import { board, col, FILES, openBoard } from './fixtures/board-doc'
import { armMenus, menuLabels, openedMenu, pickMenu, setClipboard } from './menu'

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y + 10, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 14 })
  await page.waitForTimeout(80)
  await page.mouse.up()
}
const mid = async (l: ReturnType<Page['locator']>) => {
  const b = (await l.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + Math.min(24, b.height / 2) }
}

async function start(files = FILES) {
  const run = await launch(files)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  return run
}

test('白板上改一张卡，切到文档就是那一段；文档里加一段，切回白板那一列多一张卡；卡底不写在哪一节', async () => {
  const run = await start()
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')
  try {
    await openBoard(page, '冰岛十天环岛')
    await expect(board(page).locator('.db-col h3 .truncate')).toHaveText(['出发前', '住哪', '路线'])
    // 双击文字卡就地改：在卡里打字，点别处存下
    const card = col(page, '出发前').locator('.db-card', { hasText: '11 月白天' })
    await card.dblclick()
    const ed = card.getByRole('textbox', { name: '卡片内容' })
    await expect(ed).toBeFocused()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('冬天轮胎要带钉。')
    await board(page).locator('.board-wrap').click({ position: { x: 700, y: 760 } })
    await expect(board(page).locator('.db-toast')).toContainText('改好了')
    await waitSaved(page)
    expect(file()).toContain('天黑前到住处。冬天轮胎要带钉。\n')
    // 切到文档：就是那一段
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(pane(page).locator('.cm-content')).toContainText('天黑前到住处。冬天轮胎要带钉。')
    // 文档里在「住哪」那段末尾回车写一段
    await pane(page).locator('.cm-line', { hasText: '南岸在维克住两晚' }).click()
    await page.keyboard.press('End')
    // 文档里另起一段（一块）：回车两下（回车一下是同一段里换行，白板上还是那一张卡）
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('蓝湖就在去机场的路上，最后一天顺便泡一下。')
    await waitSaved(page)
    expect(file()).toMatch(/三晚。\n\n蓝湖就在去机场的路上，最后一天顺便泡一下。\n/)
    // 切回白板：「住哪」多了一张卡
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(col(page, '住哪').locator('.db-card')).toHaveCount(2)
    await expect(col(page, '住哪').locator('.db-card').nth(1)).toContainText('蓝湖就在去机场的路上')
    // 拖到空白处：卡底不写「在文档『…』这一节里」，文件里只多一行位置
    const blue = col(page, '住哪').locator('.db-card', { hasText: '蓝湖就在' })
    const wrapBox = (await board(page).locator('.board-wrap').boundingBox())!
    await dragTo(page, await mid(blue), { x: wrapBox.x + 560, y: wrapBox.y + 620 })
    const placed = board(page).locator('.db-card.placed', { hasText: '蓝湖就在' })
    await expect(placed).toBeVisible()
    await expect(placed).not.toContainText('在文档')
    await expect(board(page).locator('.db-card .from')).toHaveCount(0)
    await waitSaved(page)
    expect(file()).toMatch(/<!-- card id=d1 x=\d+ y=\d+ -->\n蓝湖就在去机场的路上/)
    await expect(board(page).locator('.db-hint')).toContainText('1张卡离开了自己那一节')
    await page.screenshot({ path: 'test-results/r9-placed.png' })
  } finally {
    await run.close()
  }
})

test('收件箱弹窗：速记拖进一列插进那一节（那篇移到废纸篓），拖完弹窗不收；整页剪藏拖到空白处挪进「剪藏/这篇/」放一张剪藏卡；撤回放回收件箱；收起后白板右上角留「收件箱 N」', async () => {
  const run = await start()
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')
  try {
    await openBoard(page, '冰岛十天环岛')
    const drawer = await inboxPop(page)
    await expect(drawer.locator('.dbr-head')).toContainText('2条')
    const quick = drawer.getByRole('listitem', { name: '蓝湖温泉要提前两周订，周末更紧。' })
    await expect(quick).toContainText('速记')
    // 拖进「住哪」：落点一条横线，松手插进那一节
    const target = col(page, '住哪').locator('.db-card').first()
    const tb = (await target.boundingBox())!
    await page.mouse.move(...Object.values(await mid(quick)) as [number, number])
    await page.mouse.down()
    await page.mouse.move(tb.x + 100, tb.y + tb.height + 10, { steps: 16 })
    await expect(col(page, '住哪').locator('.db-drop')).toHaveCount(1)
    await page.mouse.up()
    await expect(col(page, '住哪').locator('.db-card', { hasText: '蓝湖温泉要提前两周订' })).toBeVisible()
    await expect(board(page).locator('.db-toast')).toContainText('收件箱里那条放进了「住哪」')
    await waitSaved(page)
    expect(file()).toContain('三晚。\n\n蓝湖温泉要提前两周订，周末更紧。\n\n## 路线')
    await expect.poll(() => readdirSafe(join(vault, '收件箱'))).not.toContain('蓝湖温泉要提前两周订.md')
    // 拖完弹窗不收
    await expect(drawer).toBeVisible()
    // 整页剪藏拖到空白处：那篇挪进「剪藏/冰岛十天环岛/」，白板上是一张剪藏卡（![[它]]），带一行位置
    const clip = drawer.getByRole('listitem', { name: 'Geography of Iceland' })
    const wrapBox = (await board(page).locator('.board-wrap').boundingBox())!
    await dragTo(page, await mid(clip), { x: wrapBox.x + 420, y: wrapBox.y + 640 })
    await expect(board(page).locator('.db-card.placed[data-face="clipnote"]')).toBeVisible()
    await expect(board(page).locator('.db-card.placed[data-face="clipnote"]')).toContainText('en.wikipedia.org')
    await waitSaved(page)
    expect(file()).toMatch(/<!-- card id=d1 x=\d+ y=\d+ -->\n!\[\[Geography of Iceland\]\]\n$/)
    await expect.poll(() => readdirSafe(join(vault, '剪藏/冰岛十天环岛'))).toContain('Geography of Iceland.md')
    // 撤回（点在弹窗外面，弹窗收起）：卡没了，那篇回到收件箱
    await board(page).locator('.db-toast').getByRole('button', { name: '撤回' }).click()
    await expect(drawer).toHaveCount(0)
    await expect(board(page).locator('.db-card.placed[data-face="clipnote"]')).toHaveCount(0)
    await expect.poll(() => readdirSafe(join(vault, '收件箱'))).toContain('Geography of Iceland.md')
    // 收起：白板右上角留「收件箱 1」，再点打开，esc 收起
    await expect(pane(page).getByTestId('db-inbox')).toContainText('1')
    await expect(pane(page).getByTestId('db-inbox')).toHaveAttribute('aria-expanded', 'false')
    await pane(page).getByTestId('db-inbox').click()
    await expect(drawer.getByRole('listitem', { name: 'Geography of Iceland' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('工具板「数据库」：挑「住宿」放一张小表卡，「展开」原地长成整张表，改一格写进那一条笔记，文档里同一个数据库块', async () => {
  const run = await start()
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')
  try {
    await openBoard(page, '冰岛十天环岛')
    await board(page).locator('.bpal button[data-kind="base"]').click()
    const menu = page.getByRole('menu', { name: '放一张数据库卡' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem').first()).toContainText('项目/住宿 · 5条')
    await expect(menu.getByRole('menuitem', { name: /新建一个空的数据库/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/r9-base-menu.png' })
    await menu.getByRole('menuitem').filter({ hasText: '住宿' }).first().click()
    const card = board(page).locator('.db-card[data-kind="base"]')
    await expect(card).toBeVisible()
    await expect(card.locator('.kh')).toContainText('住宿 · 表格')
    await expect(card.locator('.kh .r')).toHaveText('5条')
    await expect(card.locator('tbody tr')).toHaveCount(4)
    await expect(card.locator('.dbfoot')).toContainText('还有1条')
    await waitSaved(page)
    expect(file()).toContain('```base\nfilters:\n  and:\n    - file.inFolder("项目/住宿")')
    // 展开：原地长成整张表；顶上那条胶囊让开
    await card.getByTestId('db-expand').click()
    const big = board(page).locator('.dbx')
    await expect(big).toBeVisible()
    await expect(board(page).locator('.db-hint')).toHaveCount(0)
    // 从卡的左上角长出来（0.22 秒），长完 660 宽
    await page.waitForTimeout(350)
    expect(Math.round((await big.boundingBox())!.width)).toBe(660)
    await expect(big.locator('tbody tr')).toHaveCount(5)
    await page.screenshot({ path: 'test-results/r9-base-expanded.png' })
    // 改一格：Mývatn 小屋的晚数 2 → 3
    const row = big.locator('tbody tr', { hasText: 'Mývatn 小屋' })
    const nights = row.locator('td').nth(2)
    await nights.click()
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('3')
    await page.keyboard.press('Enter')
    await expect(board(page).locator('.db-toast')).toContainText('「Mývatn 小屋」的晚数改成了「3」')
    await expect(board(page).locator('.db-toast .path')).toHaveText('写进 项目/住宿/Mývatn 小屋.md')
    await expect.poll(() => readFileSync(join(vault, '项目/住宿/Mývatn 小屋.md'), 'utf8')).toContain('晚数: 3')
    // 收起；文档里同一张表（同一个数据库块）
    await big.getByTestId('db-collapse').click()
    await expect(big).toHaveCount(0)
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(pane(page).locator('.cm-base')).toHaveCount(1)
    await expect(pane(page).locator('.cm-base tbody tr', { hasText: 'Mývatn 小屋' })).toContainText('3')
  } finally {
    await run.close()
  }
})

test('空白卡片打 / 出和文档同一个插入菜单：插一个待办，写了字才写进文件；一个字没写就收起，文件不多一个字', async () => {
  const run = await start()
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')
  try {
    await openBoard(page, '冰岛十天环岛')
    const before = file()
    // 点「卡片」：正中那一列多一张空卡，光标在里面
    await board(page).locator('.bpal button[data-kind="card"]').click()
    const draft = board(page).getByTestId('db-draft')
    await expect(draft).toBeVisible()
    await expect(draft).toContainText('输入 / 插入块，或者直接写')
    await expect(draft.getByRole('textbox', { name: '新卡片的字' })).toBeFocused()
    // 什么都不写就点别处：不写进文件
    await board(page).locator('.board-wrap').click({ position: { x: 700, y: 760 } })
    await expect(draft).toHaveCount(0)
    await page.waitForTimeout(800)
    expect(file()).toBe(before)
    // 再来一张：打 /，插入菜单和文档里同一个
    await board(page).locator('.bpal button[data-kind="card"]').click()
    await expect(draft.getByRole('textbox', { name: '新卡片的字' })).toBeFocused()
    await page.keyboard.type('/')
    const menu = page.getByRole('listbox', { name: '插入' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('option', { name: /标题/ }).first()).toContainText('####')
    await expect(menu.getByRole('option', { name: /数据库/ })).toBeVisible()
    await page.screenshot({ path: 'test-results/r9-slash.png' })
    await page.keyboard.type('待办')
    await page.keyboard.press('Enter')
    await page.keyboard.type('带转换插头')
    await page.keyboard.press('Meta+Enter')
    await expect(draft).toHaveCount(0)
    const where = board(page).locator('.db-card', { hasText: '带转换插头' })
    await expect(where).toBeVisible()
    await expect(where.locator('.cb-todo, .db-todo')).toBeVisible()
    await waitSaved(page)
    expect(file()).toContain('- [ ] 带转换插头')
    expect(gitStatus(vault)).toContain('冰岛十天环岛.md')
  } finally {
    await run.close()
  }
})

test('旧白板（注释存列）第一次打开一次转成「## 列名」写法：字不丢、卡还在原处、一次提交；底栏撤回字节一样，以后不再自动转，「⋯」里能再转', async () => {
  const old = OLD_BOARDS['冰岛自驾.md']!
  const run = await start({ '项目/冰岛自驾.md': old, '收件箱/一句.md': '一句速记\n' })
  const { page, vault } = run
  const path = join(vault, '项目/冰岛自驾.md')
  const log = () => execFileSync('git', ['-C', vault, 'log', '--format=%s', '-3'], { encoding: 'utf8' })
  try {
    await openBoard(page, '冰岛自驾')
    await expect(board(page)).toBeVisible()
    // 转好了：两列「住哪」「剪藏」，空白处的卡在原来的位置（新白板坐标 = 旧的 + (4, 64)）
    await expect(board(page).locator('.db-col[data-head="1"] h3 .truncate')).toHaveText(['住哪', '剪藏'])
    const k1 = board(page).locator('.db-card.placed[data-id="k1"]')
    await expect(k1).toBeVisible()
    expect(await k1.evaluate((el) => [parseFloat((el as HTMLElement).style.left), parseFloat((el as HTMLElement).style.top)])).toEqual([44, 84])
    await expect(k1.locator('.kh')).toContainText('待办')
    await expect(board(page).locator('.db-card[data-id="k5"] .aifoot')).toHaveText('AI 总结的 · 2026-11-19')
    await expect(page.locator('.status, footer').getByText('改成了按「##」分列的写法')).toBeVisible()
    const converted = readFileSync(path, 'utf8')
    expect(converted).toContain('<!-- column id=c1 x=1044 y=84 -->\n## 住哪')
    expect(converted).not.toContain('in=c1')
    expect(log()).toMatch(/^白板改成按「##」分列：冰岛自驾\n/)
    expect(gitStatus(vault)).toBe('')
    await page.screenshot({ path: 'test-results/r9-converted.png' })
    // 撤回：文件回到转之前一个字节不差，照旧用以前的自由白板看
    await page.locator('footer, .status').getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => readFileSync(path, 'utf8')).toBe(old)
    await expect(pane(page).getByTestId('board')).toBeVisible()
    await expect.poll(() => log()).toMatch(/^撤回：白板改成按「##」分列：冰岛自驾\n/)
    expect(JSON.parse(readFileSync(join(vault, '.canvas-notes/白板旧写法.json'), 'utf8')).白板).toEqual(['项目/冰岛自驾.md'])
    await expect.poll(() => gitStatus(vault)).toBe('')
    // 「⋯」里再转
    await run.app.evaluate(({ Menu }) => {
      Menu.prototype.popup = function (this: Electron.Menu, opts?: Electron.PopupOptions) {
        const item = this.items.find((i) => i.label === '改成按「##」分列的写法')
        if (!item) throw new Error('菜单里没有 改成按「##」分列的写法')
        item.click()
        opts?.callback?.()
      }
    })
    await acts(page).getByRole('button', { name: '更多' }).click()
    await expect(board(page)).toBeVisible()
    await expect.poll(() => readFileSync(path, 'utf8')).toBe(converted)
  } finally {
    await run.close()
  }
})

test('文档里嵌白板、嵌一节（待办能勾，勾的是原文那一行）；被嵌的那篇文末「提到这篇的」；白板列名下「2026-W47 引用了这一节」', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await openBoard(page, '2026-W47')
    const emb = pane(page).locator('.cm-embed [data-part="文档里嵌白板"]')
    await expect(emb).toBeVisible()
    await expect(emb.locator('.emh')).toContainText('白板「冰岛十天环岛」 · 3列')
    await expect(emb.locator('.emb-col h3 .truncate')).toHaveText(['出发前', '住哪', '路线'])
    const sec = pane(page).locator('.cm-embed [data-part="嵌进来的一节"]')
    await expect(sec.locator('.emh')).toContainText('引用自《冰岛十天环岛》› 出发前')
    await expect(sec.getByRole('checkbox')).toHaveCount(3)
    await page.screenshot({ path: 'test-results/r9-w47.png' })
    await sec.locator('.td', { hasText: '租四驱车' }).getByRole('checkbox').click()
    await expect.poll(() => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')).toContain('- [x] 租四驱车')
    await expect(sec.locator('.td', { hasText: '租四驱车' })).toHaveClass(/done/)
    // 被嵌的那篇：白板上列名下面一行，文档文末「提到这篇的」
    await openBoard(page, '冰岛十天环岛')
    await expect(col(page, '出发前').locator('.backref')).toContainText('2026-W47引用了这一节')
    await expect(col(page, '出发前').locator('.db-card', { hasText: '租四驱车' }).getByRole('checkbox').nth(1)).toBeChecked()
    await acts(page).getByRole('tab', { name: '文档' }).click()
    const bl = pane(page).getByLabel('提到这篇的')
    await expect(bl).toContainText('2026-W47')
    await expect(bl).toContainText('嵌了这块白板、引用了「出发前」这一节')
    await bl.getByRole('button', { name: '2026-W47' }).click()
    await expect(tabOn(page)).toHaveText('2026-W47')
  } finally {
    await run.close()
  }
})

test('连线：卡右边的小圆点拖到另一张卡上连一条线（列里的卡多一行编号），点线 ⌫ 删掉；从文件树拖一篇笔记上来放 ![[它]]', async () => {
  const run = await start()
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')
  try {
    await openBoard(page, '冰岛十天环岛')
    const a = col(page, '住哪').locator('.db-card').first()
    const b = col(page, '出发前').locator('.db-card').nth(1)
    await a.hover()
    const h = (await a.locator('.db-handle').boundingBox())!
    await dragTo(page, { x: h.x + h.width / 2, y: h.y + h.height / 2 }, await mid(b))
    await expect(board(page).locator('.db-wires .wire')).toHaveCount(1)
    await waitSaved(page)
    expect(file()).toMatch(/^---\ntype: board\nlinks:\n {2}- (k\d) -> (k\d)\n---\n/)
    expect(file()).toMatch(/<!-- card id=k\d -->\n南岸在维克/)
    // 点线选中，⌫ 删掉
    const hit = board(page).locator('.db-wires .wire .hit')
    const box = (await board(page).locator('.db-wires .wire .vis').boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(board(page).locator('.db-wires .wire.on')).toHaveCount(1)
    await page.keyboard.press('Backspace')
    await expect(hit).toHaveCount(0)
    await waitSaved(page)
    expect(file()).not.toContain('links:')
    // 从左栏文件树把「住宿」拖进「住哪」：放一张 ![[住宿]]，嵌入的笔记卡
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    const open = tree.getByRole('button', { name: '展开 项目' })
    if (await open.count()) await open.click()
    // 「住宿」这一篇（不是装着五条记录的「住宿」文件夹，那一行后面带篇数）
    const row = tree.getByRole('treeitem').filter({ hasText: /^住宿$/ }).first()
    await expect(row).toBeVisible()
    await row.dragTo(col(page, '住哪').locator('.db-card').first(), { targetPosition: { x: 120, y: 60 } })
    await expect(col(page, '住哪').locator('.db-card[data-face="note"]')).toBeVisible()
    await waitSaved(page)
    expect(file()).toMatch(/## 住哪\n\n[\s\S]*!\[\[住宿\]\]\n\n## 路线/)
  } finally {
    await run.close()
  }
})

test('卡拖进另一个标签里的文档：停在标签上半秒切过去，松手插进那两段之间；两篇一次提交，底栏撤回两篇一起回去', async () => {
  const run = await start()
  const { page, vault } = run
  const boardFile = () => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')
  const weekFile = () => readFileSync(join(vault, '周记/2026-W47.md'), 'utf8')
  const log = () => execFileSync('git', ['-C', vault, 'log', '--format=%s', '-2'], { encoding: 'utf8' })
  try {
    await openBoard(page, '2026-W47')
    await openBoard(page, '冰岛十天环岛')
    const card = col(page, '出发前').locator('.db-card', { hasText: '11 月白天' })
    const from = await mid(card)
    const tab = page.getByTestId('tab-list').locator('.tab[data-path="周记/2026-W47.md"]')
    const tb = (await tab.boundingBox())!
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 20, from.y + 10, { steps: 4 })
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 })
    // 停半秒：切到那篇文档
    await expect(tabOn(page)).toHaveText('2026-W47', { timeout: 3000 })
    const line = pane(page).locator('.cm-line', { hasText: '这周把冰岛的行程定下来了' })
    const lb = (await line.boundingBox())!
    await page.mouse.move(lb.x + 40, lb.y + lb.height - 2, { steps: 10 })
    await expect(page.locator('.db-doc-drop')).toBeVisible()
    await page.mouse.up()
    await expect.poll(() => weekFile()).toContain('这周把冰岛的行程定下来了，住的还差两晚没订。\n\n11 月白天只有 6 个小时左右，每天开车别超过 4 小时，天黑前到住处。\n')
    await expect.poll(() => boardFile()).not.toContain('11 月白天')
    await expect.poll(() => log()).toMatch(/^挪了一段：《冰岛十天环岛》→《2026-W47》\n/)
    await expect.poll(() => gitStatus(vault)).toBe('')
    // 底栏撤回：两篇一起回去
    await page.locator('footer, .status').getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => boardFile()).toBe(FILES['项目/冰岛十天环岛.md'])
    await expect.poll(() => weekFile()).toBe(FILES['周记/2026-W47.md'])
  } finally {
    await run.close()
  }
})

test('收件箱超过 20 条顶上多一个搜索框（别把上万条全铺开）；空了是「收件箱是空的」；数据库菜单里「新建一个空的数据库」在这篇旁边建好再放卡', async () => {
  const many: Record<string, string> = { ...FILES }
  for (let i = 1; i <= 21; i++) many[`收件箱/速记 ${i}.md`] = `第 ${i} 条速记：${i % 2 ? '冰岛' : '挪威'}\n`
  const run = await start(many)
  const { page, vault } = run
  try {
    await openBoard(page, '冰岛十天环岛')
    const drawer = await inboxPop(page)
    await expect(drawer.locator('.dbr-head')).toContainText('23条')
    const search = drawer.getByRole('textbox', { name: '在收件箱里找' })
    await expect(search).toBeVisible()
    await search.fill('挪威')
    await expect(drawer.getByRole('listitem')).toHaveCount(10)
    await search.fill('没有这个')
    await expect(drawer.locator('.dbr-none')).toHaveText('收件箱里没有「没有这个」')
    // 新建一个空的数据库：在这篇旁边建「未命名数据库」，放一张数据库卡
    await page.keyboard.press('Escape')
    await board(page).locator('.bpal button[data-kind="base"]').click()
    await page.getByRole('menu', { name: '放一张数据库卡' }).getByRole('menuitem', { name: /新建一个空的数据库/ }).click()
    await expect(board(page).locator('.db-card[data-kind="base"] .kh')).toContainText('未命名数据库 · 表格')
    await expect.poll(() => readdirSafe(join(vault, '项目/未命名数据库'))).toContain('第一条.md')
  } finally {
    await run.close()
  }
  // 收件箱空了
  const empty = await start({ '项目/冰岛十天环岛.md': FILES['项目/冰岛十天环岛.md']! })
  try {
    await openBoard(empty.page, '冰岛十天环岛')
    const drawer = await inboxPop(empty.page)
    await expect(drawer.locator('.dbr-empty')).toContainText('收件箱是空的')
    await expect(drawer.locator('.dbr-empty')).toContainText('剪藏、速记、手机发来的都先到这里。')
    await expect(acts(empty.page).getByTestId('db-inbox').locator('.cnt')).toHaveCount(0)
  } finally {
    await empty.close()
  }
})

test('右键：卡片「复制一份」「从列里拿出来」「删除」、选两张「放进新列」、列「删除列（卡片留下）」、空白处「粘贴」放在点的地方', async () => {
  const run = await start()
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')
  try {
    await armMenus(run)
    await openBoard(page, '冰岛十天环岛')
    const stay = col(page, '住哪').locator('.db-card').first()
    await stay.click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['编辑', '复制一份', '从列里拿出来', '问 AI 这张', '转成文档', '删除'])
    await pickMenu(run, '复制一份')
    await expect(col(page, '住哪').locator('.db-card')).toHaveCount(2)
    await expect.poll(() => file().split('南岸在维克住两晚').length - 1).toBe(2)
    await col(page, '住哪').locator('.db-card').nth(1).click({ button: 'right' })
    await pickMenu(run, '删除')
    await expect(col(page, '住哪').locator('.db-card')).toHaveCount(1)
    await expect.poll(() => file().split('南岸在维克住两晚').length - 1).toBe(1)
    // 从列里拿出来：放在列右边，文档里这段前面多一行位置
    await col(page, '出发前').locator('.db-card', { hasText: '11 月白天' }).click({ button: 'right' })
    await pickMenu(run, '从列里拿出来')
    await expect(board(page).locator('.db-card.placed', { hasText: '11 月白天' })).toBeVisible()
    await expect.poll(() => file()).toMatch(/<!-- card id=d1 x=\d+ y=\d+ -->\n11 月白天/)
    // 放回那一节
    await board(page).locator('.db-card.placed', { hasText: '11 月白天' }).click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('放回那一节')
    await pickMenu(run, '放回那一节')
    await expect(col(page, '出发前').locator('.db-card', { hasText: '11 月白天' })).toBeVisible()
    await expect.poll(() => file()).not.toContain('<!-- card')
    // 选两张（⇧ 点）右键「放进新列」：文档末尾新起一节，两段挪进去，马上改名
    await col(page, '出发前').locator('.db-card', { hasText: '11 月白天' }).click()
    await col(page, '住哪').locator('.db-card').first().click({ modifiers: ['Shift'] })
    await expect(board(page).locator('.db-card.sel')).toHaveCount(2)
    await col(page, '住哪').locator('.db-card').first().click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['左对齐', '顶对齐', '排整齐', '放进新列', '删除 2 张'])
    await pickMenu(run, '放进新列')
    const name = board(page).getByRole('textbox', { name: '列名' })
    await expect(name).toBeFocused()
    await page.keyboard.type('先看')
    await page.keyboard.press('Enter')
    await expect(col(page, '先看').locator('.db-card')).toHaveCount(2)
    await expect.poll(() => file()).toMatch(/## 先看\n\n11 月白天[^\n]*\n\n南岸在维克/)
    // 列右键「删除列（卡片留下）」：只删标题那一行，卡并进上一节
    await col(page, '先看').locator('h3').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['改名', '删除列（卡片留下）'])
    await pickMenu(run, '删除列（卡片留下）')
    await expect(col(page, '先看')).toHaveCount(0)
    await expect.poll(() => file()).not.toContain('## 先看')
    expect(file()).toContain('11 月白天')
    // 空白处「粘贴」：剪贴板里的字放在点的地方
    await setClipboard(run, '冰岛的路况看 umferdin.is')
    const w = (await board(page).locator('.board-wrap').boundingBox())!
    await page.mouse.click(w.x + 420, w.y + 620, { button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['新卡片', '新待办', '新列', '新子白板', '拍导图', '粘贴'])
    await pickMenu(run, '粘贴')
    await expect(board(page).locator('.db-card.placed', { hasText: 'umferdin.is' })).toBeVisible()
    await expect.poll(() => file()).toMatch(/<!-- card id=d\d x=\d+ y=\d+ -->\n冰岛的路况看 umferdin\.is\n$/)
  } finally {
    await run.close()
  }
})

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}

test('白板（type: board，「## 列名」写法）上的公式卡照样排好：$$…$$、\\[…\\] 单独一段是公式（连着的合成一张卡），KaTeX 排好，不露写法；一段字里夹着的行内公式也排好；只看不改文件', async () => {
  const BOARD = '---\ntype: board\n---\n# 线代\n\n## 公式\n\n$$\n\\hat{y} = Xw + b\n$$\n\n\\[\nf(x) = x^2\n\\]\n\n向量 $\\mathbf{x}$ 的第 $i$ 个元素\n'
  const run = await launch({ '线代.md': BOARD })
  const { page, vault } = run
  try {
    await openBoard(page, '线代')
    const c = col(page, '公式')
    // 连着的两段公式合成一张公式卡（doc-board 的规矩），两条都排好
    await expect(c.locator('.db-card[data-face="math"]')).toHaveCount(1)
    await expect(c.locator('.db-card[data-face="math"] .katex')).toHaveCount(2)
    // 行内的公式在字卡里也排好
    await expect(c.locator('.db-card', { hasText: '的第' }).locator('.katex')).toHaveCount(2)
    for (const raw of ['$$', '\\hat', '\\[', '\\mathbf']) await expect(c).not.toContainText(raw, { useInnerText: true })
    await page.waitForTimeout(1200)
    expect(readFileSync(join(vault, '线代.md'), 'utf8')).toBe(BOARD)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})
