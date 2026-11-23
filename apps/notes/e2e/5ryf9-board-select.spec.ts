/**
 * 白板框选（task-5ryf9，设计稿 17-白板框选 方向 A「浮在选区上」，用户定：空白处拖 = 框选、碰到就选、合成一张 = 字不改加一行注释）。
 * 都是真拖、真点、真按键，改了文件的每一样读盘看只改了该改的：
 * - 空白处按住拖出框，碰到的卡都选上；⇧ 点加减一张、⇧ 拖加选；⌘A 全选；Esc、点空白取消；列里的空处按下也能框；
 * - 按住空格拖、中键拖是平移；
 * - 选两张起浮出操作条「已选N张 · 对齐 · 放进列 · 问AI · AI整理 · 出卡 ｜ 复制 · 删除 · ⋯」，浮在选区上方 10，拖的时候藏起来；
 * - 对齐、放进列（新的一列、已有的列、挪进新白板）、一起拖、复制、删除、⋯（合成一张、复制一份、移到别的笔记、全选、取消选择），每一下能撤回；
 * - 空白处的剪藏卡选上看得出来（以前外圈被它自己的描边盖掉）。
 */
import { expect, type Page, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, type Running, waitSaved } from './app'
import { board, col, openBoard } from './fixtures/board-doc'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { BOARD, BOARD_PATH, FILES } from './fixtures/board-select'

const bar = (page: Page) => page.getByTestId('db-selbar')
const card = (page: Page, id: string) => board(page).locator(`.db-card[data-id="${id}"]`)
const selIds = (page: Page) => board(page).locator('.db-card.sel').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.id).sort())
const file = (run: Running, p = BOARD_PATH) => readFileSync(join(run.vault, p), 'utf8')
const commits = (vault: string) => Number(execFileSync('git', ['-C', vault, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim())

async function start() {
  const run = await launch(FILES)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await openBoard(run.page, '学习笔记：动手学深度学习')
  await expect(board(run.page)).toBeVisible()
  await expect(card(run.page, 'f5')).toBeVisible()
  return run
}

/** 画布上一处空白：在 a 卡的左上方 */
async function marquee(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, opts: { shift?: boolean } = {}) {
  if (opts.shift) await page.keyboard.down('Shift')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y + 16, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await expect(page.getByTestId('db-marquee')).toBeVisible()
  await page.mouse.up()
  if (opts.shift) await page.keyboard.up('Shift')
  await expect(page.getByTestId('db-marquee')).toHaveCount(0)
}

const box = async (page: Page, id: string) => (await card(page, id).boundingBox())!

/** 框选空白处的三张：从 f1 左上方的空白拖到 f3 里面（原型「三张都碰到了」） */
async function pickThree(page: Page) {
  // 白板先滚回左上角（放进新的一列以后会滚到右边去看新的那一列）
  await board(page).locator('.board-wrap').evaluate((w) => w.scrollTo(0, 0))
  const a = await box(page, 'f1')
  const c = await box(page, 'f3')
  await marquee(page, { x: a.x - 24, y: a.y - 24 }, { x: c.x + 30, y: c.y + 30 })
  await expect.poll(() => selIds(page)).toEqual(['f1', 'f2', 'f3'])
}

test('空白处拖出框：碰到的都选上，浮出操作条（照原型的字和先后）；⇧ 点加减、⇧ 拖加选、⌘A、Esc、点空白；只选不写文件', async () => {
  const run = await start()
  const { page } = run
  try {
    // 拖的时候：框是 1px 强调色边、淡强调色底；操作条先藏着
    const a = await box(page, 'f1')
    const c = await box(page, 'f3')
    await page.mouse.move(a.x - 24, a.y - 24)
    await page.mouse.down()
    await page.mouse.move(c.x + 30, c.y + 30, { steps: 12 })
    const m = page.getByTestId('db-marquee')
    await expect(m).toBeVisible()
    const look = await m.evaluate((e) => {
      const s = getComputedStyle(e)
      return { bw: s.borderTopWidth, r: s.borderTopLeftRadius }
    })
    expect(look).toEqual({ bw: '1px', r: '2px' })
    await expect.poll(() => selIds(page)).toEqual(['f1', 'f2', 'f3'])
    await expect(bar(page)).toHaveClass(/\bhide\b/)
    await page.mouse.up()
    await expect(m).toHaveCount(0)

    // 松手：操作条浮在三张上方 10，水平居中在选区上；字和先后照原型（加「AI整理」、不放「费曼」）
    await expect(bar(page)).toBeVisible()
    await expect(bar(page)).not.toHaveClass(/\bhide\b/)
    await expect(bar(page).locator('.cnt')).toHaveText('已选3张')
    const names = await bar(page).locator('button.sb').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(names).toEqual(['对齐', '放进列', '问AI', 'AI整理', '出卡', '费曼讲这几张', '复制', '删除', '更多'])
    await expect(bar(page).locator('button.sb .lb')).toHaveText(['对齐', '放进列', '问AI', 'AI整理', '出卡', '费曼讲这几张'])
    const bb = (await bar(page).boundingBox())!
    const top = Math.min(...(await Promise.all(['f1', 'f2', 'f3'].map((id) => box(page, id)))).map((r) => r.y))
    expect(Math.abs(bb.y + bb.height + 10 - top)).toBeLessThan(1.5)
    expect(bb.height).toBe(40)
    // 删除是红的
    const red = await bar(page).getByRole('button', { name: '删除' }).evaluate((e) => getComputedStyle(e).color)
    const t2 = await bar(page).getByRole('button', { name: '复制' }).evaluate((e) => getComputedStyle(e).color)
    expect(red).not.toBe(t2)

    // 空白处的剪藏卡选上看得出来：2px 强调色外圈（以前被它自己的描边盖掉）
    const ring = await card(page, 'f2').evaluate((e) => getComputedStyle(e).boxShadow)
    const acc = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--acc').trim())
    expect(ring).toMatch(/0px 0px 0px 2px/)
    expect(acc).toBeTruthy()

    // ⇧ 点加一张、再 ⇧ 点减掉（f4 在右边，先滚到看得见）
    await card(page, 'f4').scrollIntoViewIfNeeded()
    const d = await box(page, 'f4')
    await page.keyboard.down('Shift')
    await page.mouse.click(d.x + 40, d.y + 20)
    await page.keyboard.up('Shift')
    await expect.poll(() => selIds(page)).toEqual(['f1', 'f2', 'f3', 'f4'])
    await expect(bar(page).locator('.cnt')).toHaveText('已选4张')
    await page.keyboard.down('Shift')
    await page.mouse.click(d.x + 40, d.y + 20)
    await page.keyboard.up('Shift')
    await expect.poll(() => selIds(page)).toEqual(['f1', 'f2', 'f3'])

    // ⇧ 拖：在选着的上面再加（框 f5）
    await card(page, 'f5').scrollIntoViewIfNeeded()
    const e5 = await box(page, 'f5')
    // 从 f5 左上方的空白（f3 和 f5 之间）拖进 f5
    await marquee(page, { x: e5.x - 20, y: e5.y - 16 }, { x: e5.x + 40, y: e5.y + 20 }, { shift: true })
    await expect.poll(() => selIds(page)).toEqual(['f1', 'f2', 'f3', 'f5'])

    // Esc 取消；只剩一张时不出操作条
    await page.keyboard.press('Escape')
    await expect.poll(() => selIds(page)).toEqual([])
    await expect(bar(page)).toHaveCount(0)
    await card(page, 'f4').scrollIntoViewIfNeeded()
    const d2 = await box(page, 'f4')
    await page.mouse.click(d2.x + 40, d2.y + 20)
    await expect.poll(() => selIds(page)).toEqual(['f4'])
    await expect(bar(page)).toHaveCount(0)

    // ⌘A 全选：白板上的每一张（最左一组、列里、空白处）
    await page.keyboard.press('Meta+a')
    await expect.poll(async () => (await selIds(page)).length).toBe(10)
    await expect(bar(page).locator('.cnt')).toHaveText('已选10张')
    // 换到另一个标签：白板那一条不留在窗口上（以前挂在 body 上、量不到位置时漂到左上角）
    await openNote(page, '2.3 线性代数')
    await expect(bar(page)).toHaveCount(0)
    await page.locator('.tab', { hasText: '学习笔记：动手学深度学习' }).first().click()
    await expect(board(page)).toBeVisible()
    await expect(bar(page)).toBeVisible()
    await expect(bar(page).locator('.cnt')).toHaveText('已选10张')
    // 点空白处取消
    const w = (await board(page).locator('.board-wrap').boundingBox())!
    await page.mouse.click(w.x + w.width - 60, w.y + w.height - 40)
    await expect.poll(() => selIds(page)).toEqual([])

    // 列里的空处按下也能框：从「前言」列底下的空处往上拖，碰到列里的两张
    await board(page).locator('.board-wrap').evaluate((w) => w.scrollTo(0, 0))
    const q = (await col(page, '前言').boundingBox())!
    const q2 = (await col(page, '前言').locator('.db-card').last().boundingBox())!
    await marquee(page, { x: q.x + q.width - 6, y: q.y + q.height - 3 }, { x: q2.x + 30, y: q.y + 60 })
    expect((await selIds(page)).length).toBe(2)

    // 只是选、开菜单、取消：文件一个字节没变，库里没有改动
    await waitSaved(page)
    expect(file(run)).toBe(BOARD)
  } finally {
    await run.close()
  }
})

test('按住空格拖、中键拖是平移：白板跟着手走，卡不动、不选；光标变成小手', async () => {
  const run = await start()
  const { page } = run
  try {
    const wrap = board(page).locator('.board-wrap')
    // 先往右下滚一点，好往两边拖
    await wrap.evaluate((w) => w.scrollTo(200, 150))
    const s0 = await wrap.evaluate((w) => ({ x: w.scrollLeft, y: w.scrollTop }))
    const f3 = await box(page, 'f3')
    await board(page).focus()
    await page.keyboard.down('Space')
    await expect(wrap).toHaveClass(/\bgrab\b/)
    // 按在卡上拖也是平移
    await page.mouse.move(f3.x + 40, f3.y + 20)
    await page.mouse.down()
    await page.mouse.move(f3.x + 140, f3.y + 100, { steps: 8 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    await expect(wrap).not.toHaveClass(/\bgrab\b/)
    const s1 = await wrap.evaluate((w) => ({ x: w.scrollLeft, y: w.scrollTop }))
    expect(s0.x - s1.x).toBeCloseTo(100, 0)
    expect(s0.y - s1.y).toBeCloseTo(80, 0)
    expect(await selIds(page)).toEqual([])
    // 中键拖
    await page.mouse.move(f3.x + 40, f3.y + 20)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(f3.x - 20, f3.y - 20, { steps: 6 })
    await page.mouse.up({ button: 'middle' })
    const s2 = await wrap.evaluate((w) => ({ x: w.scrollLeft, y: w.scrollTop }))
    expect(s2.x - s1.x).toBeCloseTo(60, 0)
    expect(s2.y - s1.y).toBeCloseTo(40, 0)
    expect(file(run)).toBe(BOARD)
  } finally {
    await run.close()
  }
})

test('对齐 › 左对齐：只改这三张的位置行，撤回回去；排整齐、横着等距；列里的不跟着挪（菜单头上写只挪空白处的N张）', async () => {
  const run = await start()
  const { page } = run
  try {
    await pickThree(page)
    await bar(page).getByRole('button', { name: '对齐' }).click()
    const menu = page.getByRole('menu', { name: '对齐' })
    await expect(menu).toBeVisible()
    await expect(menu.locator('.sm-head')).toHaveText('只挪空白处的3张')
    await expect(menu.getByRole('menuitem')).toHaveText(['左对齐', '水平居中', '右对齐', '顶对齐', '垂直居中', '底对齐', '横着等距', '竖着等距', '排整齐'])
    await menu.getByRole('menuitem', { name: '左对齐' }).click()
    await expect(board(page).locator('.db-toast')).toContainText('左对齐了：只改了这3张的位置行，正文一个字没动')
    await waitSaved(page)
    const after = file(run)
    expect(after).toContain('<!-- card id=f1 x=40 y=420 -->')
    expect(after).toContain('<!-- card id=f2 x=40 y=470 -->')
    expect(after).toContain('<!-- card id=f3 x=40 y=520 -->')
    expect(after.replace(/<!-- card [^\n]*-->/g, '')).toBe(BOARD.replace(/<!-- card [^\n]*-->/g, ''))
    // 卡的左边真的齐了
    const xs = await Promise.all(['f1', 'f2', 'f3'].map(async (id) => Math.round((await box(page, id)).x)))
    expect(new Set(xs).size).toBe(1)
    // 底部提示的「撤回」：文件回到原样
    await board(page).locator('.db-toast').getByRole('button', { name: '撤回' }).click()
    await waitSaved(page)
    expect(file(run)).toBe(BOARD)

    // 选着的里面有列里的卡：菜单写「列里的N张照文档顺序，不跟着挪」
    await page.keyboard.press('Meta+a')
    await bar(page).getByRole('button', { name: '对齐' }).click()
    await expect(menu.locator('.sm-head')).toHaveText('只挪空白处的5张')
    await expect(menu.locator('.sm-note')).toHaveText('列里的5张照文档顺序，不跟着挪。')
    await menu.getByRole('menuitem', { name: '横着等距' }).click()
    await waitSaved(page)
    const spread = file(run)
    // 只有空白处五张的位置行变了，列里的卡一个字没动
    expect(spread.replace(/<!-- card [^\n]*-->/g, '')).toBe(BOARD.replace(/<!-- card [^\n]*-->/g, ''))
    expect(spread).not.toBe(BOARD)
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(BOARD)
  } finally {
    await run.close()
  }
})

test('放进列：放进新的一列（文末新起一节、马上改名）、放进「全书结构」；⌘Z 撤回；挪进一块新白板（两篇一次提交，撤回两篇一起回去）', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await pickThree(page)
    await bar(page).getByRole('button', { name: '放进列' }).click()
    const menu = page.getByRole('menu', { name: '放进列' })
    await expect(menu.getByRole('menuitem')).toHaveText(['放进新的一列', '放进「前言」', '放进「全书结构」', '放进「章节阅读顺序」', '挪进一块新白板'])
    await menu.getByRole('menuitem', { name: '放进新的一列' }).click()
    const name = board(page).getByRole('textbox', { name: '列名' })
    await expect(name).toHaveValue('新的列')
    await name.press('Enter')
    await expect(col(page, '新的列').locator('.db-card')).toHaveCount(3)
    await waitSaved(page)
    expect(file(run).endsWith('## 新的列\n\n[[导图 11-22 17:51]]\n\n> 从翻译应用到自动驾驶汽车，机器学习是我们使用的一些最重要的技术。\n—— [developers.google.com](https://developers.google.com/machine-learning)\n\n范数：向量有多大。L2 是各元素平方和再开方，L1 是各元素绝对值之和。\n')).toBe(true)
    expect(file(run)).not.toContain('id=f1')
    await board(page).focus()
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(BOARD)

    await pickThree(page)
    await bar(page).getByRole('button', { name: '放进列' }).click()
    await menu.getByRole('menuitem', { name: '放进「全书结构」' }).click()
    await expect(col(page, '全书结构').locator('.db-card')).toHaveCount(4)
    await expect(board(page).locator('.db-toast')).toContainText('放进了「全书结构」：这3段挪到那一节末尾，位置行去掉了')
    await board(page).locator('.db-toast').getByRole('button', { name: '撤回' }).click()
    await waitSaved(page)
    expect(file(run)).toBe(BOARD)

    // 挪进一块新白板：新建一篇放这三段，原处换成一行 [[新的白板]]（带第一张的位置行）；两篇一次提交
    const before = commits(vault)
    await pickThree(page)
    await bar(page).getByRole('button', { name: '放进列' }).click()
    await menu.getByRole('menuitem', { name: '挪进一块新白板' }).click()
    await expect(board(page).locator('.db-toast')).toContainText('挪进了新白板《新的白板》')
    await expect.poll(() => commits(vault)).toBe(before + 1)
    const nb = join(vault, '课程/新的白板.md')
    expect(existsSync(nb)).toBe(true)
    expect(readFileSync(nb, 'utf8')).toBe('---\ntype: board\n所属白板: "[[学习笔记：动手学深度学习]]"\n---\n[[导图 11-22 17:51]]\n\n> 从翻译应用到自动驾驶汽车，机器学习是我们使用的一些最重要的技术。\n—— [developers.google.com](https://developers.google.com/machine-learning)\n\n范数：向量有多大。L2 是各元素平方和再开方，L1 是各元素绝对值之和。\n')
    expect(file(run)).toContain('<!-- card id=f1 x=40 y=420 -->\n[[新的白板]]\n')
    const changed = execFileSync('git', ['-C', vault, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' }).trim().split('\n').sort()
    expect(changed).toEqual([BOARD_PATH, '课程/新的白板.md'].sort())
    await board(page).locator('.db-toast').getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(nb)).toBe(false)
    await expect.poll(() => file(run)).toBe(BOARD)
  } finally {
    await run.close()
  }
})

test('按住选中的一张拖：几张一起走——拖到空白处只改位置行，拖进一列按原来的先后挪进那一节；拖的时候操作条藏起来、鼠标右下「3张」', async () => {
  const run = await start()
  const { page } = run
  try {
    await pickThree(page)
    const f3 = await box(page, 'f3')
    const f1 = await box(page, 'f1')
    await page.mouse.move(f3.x + 60, f3.y + 20)
    await page.mouse.down()
    await page.mouse.move(f3.x + 80, f3.y + 40, { steps: 4 })
    await page.mouse.move(f3.x + 160, f3.y + 120, { steps: 10 })
    await expect(page.getByTestId('db-drag-count')).toHaveText('3张')
    await expect(bar(page)).toHaveClass(/\bhide\b/)
    await page.mouse.up()
    await expect(board(page).locator('.db-toast')).toContainText('挪了3张：只改了这3张的位置行，正文顺序不变')
    await waitSaved(page)
    const moved = file(run)
    expect(moved.replace(/<!-- card [^\n]*-->/g, '')).toBe(BOARD.replace(/<!-- card [^\n]*-->/g, ''))
    const f1b = await box(page, 'f1')
    expect(Math.round(f1b.x - f1.x)).toBe(100)
    expect(Math.round(f1b.y - f1.y)).toBe(100)
    await board(page).locator('.db-toast').getByRole('button', { name: '撤回' }).click()
    await waitSaved(page)
    expect(file(run)).toBe(BOARD)

    // 拖进「前言」：这三段按原来的先后挪进那一节，位置行去掉
    await pickThree(page)
    const g = await box(page, 'f2')
    const target = (await col(page, '前言').boundingBox())!
    await page.mouse.move(g.x + 60, g.y + 20)
    await page.mouse.down()
    await page.mouse.move(g.x + 80, g.y, { steps: 4 })
    await page.mouse.move(target.x + 100, target.y + target.height - 12, { steps: 14 })
    await expect(col(page, '前言')).toHaveClass(/\bdrop\b/)
    await page.mouse.up()
    await expect(col(page, '前言').locator('.db-card')).toHaveCount(5)
    await waitSaved(page)
    expect(file(run)).toContain('需要同时懂四样：动机、数学、优化算法、工程技巧。\n\n[[导图 11-22 17:51]]\n\n> 从翻译应用到自动驾驶汽车')
    expect(file(run)).not.toContain('id=f1')
  } finally {
    await run.close()
  }
})

test('复制、删除、⋯：复制是这三段 md 原文；删除能撤回；合成一张（字不改、前面一行注释），再打开、切到文档再切回来文件一个字节不变；复制一份；移到别的笔记（两篇一次提交）', async () => {
  const run = await start()
  const { page, vault } = run
  // 剪贴板是这台 Mac 真的：测之前存下，测完放回
  const saved = await run.app.evaluate(({ clipboard }) => clipboard.readText())
  try {
    await pickThree(page)
    await bar(page).getByRole('button', { name: '复制' }).click()
    await expect(board(page).locator('.db-toast')).toContainText('复制了3张：贴进文档是这3段原文，贴进白板是3张卡')
    const copied = await run.app.evaluate(({ clipboard }) => clipboard.readText())
    expect(copied).toBe('[[导图 11-22 17:51]]\n\n> 从翻译应用到自动驾驶汽车，机器学习是我们使用的一些最重要的技术。\n—— [developers.google.com](https://developers.google.com/machine-learning)\n\n范数：向量有多大。L2 是各元素平方和再开方，L1 是各元素绝对值之和。')
    expect(file(run)).toBe(BOARD)

    // 删除：这三段一起删；撤回回来
    await bar(page).getByRole('button', { name: '删除' }).click()
    await expect(board(page).locator('.db-toast')).toContainText('删了3张卡：文档里这3段一起删了')
    await waitSaved(page)
    expect(file(run)).not.toContain('范数：向量有多大')
    expect(file(run)).not.toContain('id=f2')
    await board(page).locator('.db-toast').getByRole('button', { name: '撤回' }).click()
    await waitSaved(page)
    expect(file(run)).toBe(BOARD)

    // ⋯ 里：合成一张、复制一份、移到别的笔记… | 全选、取消选择
    await pickThree(page)
    await bar(page).getByRole('button', { name: '更多' }).click()
    const more = page.getByRole('menu', { name: '更多' })
    await expect(more.getByRole('menuitem')).toHaveText(['合成一张', '复制一份⌘D', '移到别的笔记…', '全选⌘A', '取消选择esc'])
    await more.getByRole('menuitem', { name: '合成一张' }).click()
    await expect(board(page).locator('.db-toast')).toContainText('合成了一张：这3段挪到一起、字不改，前面一行记着「这3段是一张」')
    await waitSaved(page)
    const merged = file(run)
    expect(merged).toContain('<!-- card id=f1 x=40 y=420 merge=3 -->\n[[导图 11-22 17:51]]\n\n> 从翻译应用到自动驾驶汽车')
    expect(merged.replace(/<!-- card [^\n]*-->\n/g, '').replace(/\n+/g, '\n')).toBe(BOARD.replace(/<!-- card [^\n]*-->\n/g, '').replace(/\n+/g, '\n'))
    const one = card(page, 'f1')
    await expect(one.locator('.db-part')).toHaveCount(3)
    await expect(board(page).locator('.db-card[data-id="f2"], .db-card[data-id="f3"]')).toHaveCount(0)
    // 打开再保存不变：切到文档、再切回白板，关掉标签再打开，文件一个字节不变
    const tabs = page.getByTestId('tab-acts')
    await tabs.getByRole('tab', { name: '文档' }).click()
    await expect(page.locator('.pane:not([hidden]) .cm-content')).toBeVisible()
    await page.waitForTimeout(400)
    await tabs.getByRole('tab', { name: '白板' }).click()
    await expect(card(page, 'f1').locator('.db-part')).toHaveCount(3)
    await page.keyboard.press('Meta+w')
    await openBoard(page, '学习笔记：动手学深度学习')
    await expect(card(page, 'f1').locator('.db-part')).toHaveCount(3)
    await page.waitForTimeout(600)
    if (file(run) !== merged) console.log('ROUNDTRIP', JSON.stringify(merged), '\n=>', JSON.stringify(file(run)))
    expect(file(run)).toBe(merged)

    // 右键「拆开」（真右键，系统菜单换成记下来再点）：去掉 merge，三张各是各的，第一张留着位置，后两张错开 24 摆在旁边
    await armMenus(run)
    await card(page, 'f1').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('拆开')
    await pickMenu(run, '拆开')
    await expect(board(page).locator('.db-toast')).toContainText('拆开了：去掉了前面那一行注释，3段各是各的卡')
    await waitSaved(page)
    const split = file(run)
    expect(split).toContain('<!-- card id=f1 x=40 y=420 -->\n[[导图 11-22 17:51]]\n\n<!-- card id=d1 x=64 y=444 -->\n> 从翻译应用')
    expect(split).not.toContain('merge=')
    await expect(board(page).locator('.db-card.placed')).toHaveCount(5)
    // 撤回拆开、再撤回合成不了（重开过标签，合成那一步在上一次打开里）：把文件放回原样接着测
    await board(page).focus()
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(merged)
    // 外面把文件改回原样（像同步盘）：白板跟着变
    writeFileSync(join(vault, BOARD_PATH), BOARD)
    await expect.poll(() => card(page, 'f1').locator('.db-part').count()).toBe(0)
    await expect.poll(() => file(run)).toBe(BOARD)

    // 复制一份：文末多这三段，各带一行位置（右下错开 24），选中的换成新的三张
    await pickThree(page)
    await bar(page).getByRole('button', { name: '更多' }).click()
    await more.getByRole('menuitem', { name: '复制一份' }).click()
    await waitSaved(page)
    expect(file(run).startsWith(BOARD)).toBe(true)
    expect(file(run).slice(BOARD.length)).toBe('\n<!-- card id=d1 x=64 y=444 -->\n[[导图 11-22 17:51]]\n\n<!-- card id=d2 x=374 y=494 -->\n> 从翻译应用到自动驾驶汽车，机器学习是我们使用的一些最重要的技术。\n—— [developers.google.com](https://developers.google.com/machine-learning)\n\n<!-- card id=d3 x=704 y=544 -->\n范数：向量有多大。L2 是各元素平方和再开方，L1 是各元素绝对值之和。\n')
    await expect.poll(() => selIds(page)).toEqual(['d1', 'd2', 'd3'])
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(file(run)).toBe(BOARD)

    // 移到别的笔记：挑「第 3 章」，三段从这块白板删掉、加到那篇末尾；两篇一次提交，撤回两篇一起回去
    const before = commits(vault)
    await pickThree(page)
    await bar(page).getByRole('button', { name: '更多' }).click()
    await more.getByRole('menuitem', { name: '移到别的笔记…' }).click()
    const pick = page.getByRole('dialog', { name: '移到别的笔记' })
    await pick.getByRole('textbox', { name: '筛选笔记' }).fill('第 3 章')
    await pick.getByRole('option', { name: /第 3 章 线性神经网络/ }).click()
    await expect(board(page).locator('.db-toast')).toContainText('挪了3张到《第 3 章 线性神经网络》：两篇一次提交，撤回两篇一起回去')
    await expect.poll(() => commits(vault)).toBe(before + 1)
    const ch3 = readFileSync(join(vault, '课程/第 3 章 线性神经网络.md'), 'utf8')
    expect(ch3).toBe('# 第 3 章 线性神经网络\n\n线性回归是最简单的神经网络。\n\n[[导图 11-22 17:51]]\n\n> 从翻译应用到自动驾驶汽车，机器学习是我们使用的一些最重要的技术。\n—— [developers.google.com](https://developers.google.com/machine-learning)\n\n范数：向量有多大。L2 是各元素平方和再开方，L1 是各元素绝对值之和。\n')
    expect(file(run)).not.toContain('范数：向量有多大')
    await board(page).locator('.db-toast').getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => file(run)).toBe(BOARD)
    await expect.poll(() => readFileSync(join(vault, '课程/第 3 章 线性神经网络.md'), 'utf8')).toBe(FILES['课程/第 3 章 线性神经网络.md'])
  } finally {
    await run.app.evaluate(({ clipboard }, t) => clipboard.writeText(t), saved)
    await run.close()
  }
})

test('出卡：点开一张说明小卡（写清楚做好以后点它会怎样），知道了收起；窄栏只留图标、放不下的收进「⋯」，不挤字', async () => {
  const run = await start()
  const { page } = run
  try {
    await pickThree(page)
    await bar(page).getByRole('button', { name: '出卡' }).click()
    const info = page.getByTestId('sel-info')
    await expect(info).toBeVisible()
    await expect(info.locator('h4')).toHaveText('出卡 · 这3张')
    await info.getByRole('button', { name: '知道了' }).click()
    await expect(info).toHaveCount(0)
    // 窄：右栏开着 AI、中间栏只剩四百来宽时，操作条先只留图标（问AI 留字），再把放不下的收进「⋯」
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1000, 900))
    await page.keyboard.press('Meta+j')
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
    await board(page).locator('.board-wrap').evaluate((w) => w.scrollTo(0, 0))
    await expect.poll(async () => Number(await bar(page).getAttribute('data-level'))).toBe(1)
    const bb = (await bar(page).boundingBox())!
    const area = (await board(page).locator('.db-area').boundingBox())!
    expect(bb.width).toBeLessThanOrEqual(area.width - 16 + 0.5)
    expect(bb.height).toBe(40)
    await expect(bar(page).getByRole('button', { name: '问AI' }).locator('.lb')).toBeVisible()
    await expect(bar(page).getByRole('button', { name: '对齐' }).locator('.lb')).toBeHidden()
  } finally {
    await run.close()
  }
})

test('问AI：右栏 AI 打开，「看得到」写「白板上选中的3张」；AI整理：先在中间给你看改前改后，收下才写（一次提交、带 AI 标志的小结），撤回回到原样', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openBoard(page, '学习笔记：动手学深度学习')
    await expect(card(page, 'f5')).toBeVisible()
    // 选 f3、f4、f5（点一张，⇧ 点另外两张）
    for (const [i, id] of ['f3', 'f4', 'f5'].entries()) {
      await card(page, id).scrollIntoViewIfNeeded()
      const b = await box(page, id)
      if (i) await page.keyboard.down('Shift')
      await page.mouse.click(b.x + 40, b.y + 16)
      if (i) await page.keyboard.up('Shift')
    }
    await expect.poll(() => selIds(page)).toEqual(['f3', 'f4', 'f5'])
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    await bar(page).getByRole('button', { name: '问AI' }).click()
    await expect(ai).toBeVisible()
    await expect(ai.getByTestId('ai-cards')).toHaveText('白板上选中的3张')
    await expect(ai.getByRole('button', { name: '总结这几张' })).toBeVisible()
    expect(file(run)).toBe(BOARD)

    // AI整理：对话里出「/整理这几张」，回答说分成了几组；中间开对比标签，文件还没动
    const before = commits(vault)
    await bar(page).getByRole('button', { name: 'AI整理' }).click()
    const msg = ai.getByTestId('ai-msg').last()
    await expect(msg).toContainText('分成了2组（矩阵乘法、其他），去掉重复的0张、合成了1处。', { timeout: 20_000 })
    await expect(msg).toContainText('摆在中间先给你看')
    expect(file(run)).toBe(BOARD)
    expect(commits(vault)).toBe(before)
    await msg.getByRole('button', { name: '收下', exact: true }).click()
    // 等到写完的样子（存盘是先清空再写，机器忙时中间能读到空文件）
    await expect.poll(() => file(run)).toContain('## 其他\n\n范数')
    const after = file(run)
    // 三张从空白处拿走，文末两节：「矩阵乘法」里小结（带 AI 标志的块）+ 合成的一张（两段挨着、前面一行 merge=2）；「其他」里范数那一张
    expect(after).not.toContain('id=f3')
    expect(after).not.toContain('id=f4')
    expect(after).toMatch(/\n## 矩阵乘法\n\n> \[!ai\] AI 写的 · [^\n]+\n> 这几张讲了矩阵乘法和别的几件事。\n\n<!-- card id=d1 merge=2 -->\n矩阵-矩阵乘法 AB 可以看作 m 次矩阵-向量积，再把结果拼在一起。\n\n> 矩阵-矩阵乘法可以简单地称为矩阵乘法/)
    expect(after.endsWith('## 其他\n\n范数：向量有多大。L2 是各元素平方和再开方，L1 是各元素绝对值之和。\n')).toBe(true)
    await expect.poll(() => commits(vault)).toBe(before + 1)
    expect(execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('AI：/整理这几张 · 学习笔记：动手学深度学习')
    // 白板上：两列，合成的那张三段里两段，小结卡是 AI 块
    await expect(col(page, '矩阵乘法')).toBeVisible()
    await expect(col(page, '其他').locator('.db-card')).toHaveCount(1)
    // 撤回：文件回到原样
    await ai.getByTestId('ai-msg').last().getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => file(run)).toBe(BOARD)
  } finally {
    await run.close()
  }
})
