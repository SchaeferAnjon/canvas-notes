import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acts, launch, pane, type Running, tabOn } from './app'
import { MAP2, MAP2_OPEN, MAP_PATH as PATH, map2Files } from './fixtures/mindmap-b2'
import { armMenus, pickMenu } from './menu'

// 思维导图第二批（task-wuv05，设计页 15-思维导图「第二批设计稿」，用户：「可以按照推荐来」）：
// 备注、在导图里找、链接、导出、多选、外框和概要、联系线、浮动主题、图片、配色和骨架、鱼骨和时间线。
// 都是真按键、真点、真拖；每一下看文件只动了该动的那几行，找、只看这一枝这种看法不写文件。

const board = (page: Page) => pane(page).getByTestId('board')
const layer = (page: Page) => board(page).getByTestId('mindmap')
const esc = (s: string) => s.replace(/[()+=.*?[\]\\^$|]/g, '\\$&')
const node = (page: Page, text: string) => board(page).locator('.mm-node:not(.sumt)', { has: page.locator('.t', { hasText: new RegExp(`^${esc(text)}$`) }) })
const read = (run: Running) => readFileSync(join(run.vault, PATH), 'utf8')
const line = (text: string, s: string) => text.split('\n').find((l) => l.includes(s)) ?? ''

async function openMap(page: Page, count: number) {
  await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
  await expect(board(page).locator('.mm-node:not(.sumt)')).toHaveCount(count)
}

/** 两个主题中心之间按住拖过去（分几步，像手一样） */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8)
  await page.mouse.up()
}
const mid = async (page: Page, text: string) => {
  const b = (await node(page, text).boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

test('① 备注：续行是备注（不并进主题的字），点小图标打开、改了只动那几行；⇧⌘N 给没备注的加一段；⌘Z 撤回', async () => {
  const run = await launch(map2Files(MAP2_OPEN), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openMap(page, 17)
    // 续行不再并进主题的字：主题还是「秩-零化度定理」，字后面一个备注小图标
    const thm = node(page, '秩-零化度定理')
    await expect(thm).toHaveCount(1)
    await expect(thm.getByTestId('map-note-icon')).toBeVisible()
    await expect(node(page, '列 = 基向量的像').getByTestId('map-note-icon')).toBeVisible()
    await expect(board(page).getByTestId('map-note-icon')).toHaveCount(2)
    // 点小图标：弹层里是那两段
    await thm.getByTestId('map-note-icon').click()
    const pop = page.getByTestId('map-note')
    await expect(pop).toBeVisible()
    await expect(pop.locator('textarea')).toHaveValue('dim V = dim ker T + dim im T。\n\n老师说这是这一章最要紧的一条，期末必考。')
    await expect(pop).toContainText('存在文件里「秩-零化度定理」那一行下面，缩进的一段')
    await expect(pop.locator('textarea')).toBeFocused()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('\n\n下次复习先看这条')
    // 停一下就存：只动那几行续行
    await expect.poll(() => read(run)).toContain('      老师说这是这一章最要紧的一条，期末必考。\n\n      下次复习先看这条\n  - 例子')
    const after = read(run)
    expect(after.split('\n').filter((l) => !MAP2_OPEN.split('\n').includes(l))).toEqual(['      下次复习先看这条'])
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)

    // ⇧⌘N：给「im T 所有的像」加一段
    await node(page, 'im T 所有的像').click()
    await page.keyboard.press('Meta+Shift+N')
    await expect(pop).toBeVisible()
    await expect(pop.locator('textarea')).toHaveValue('')
    await page.keyboard.type('所有能映到的')
    await page.keyboard.press('Escape')
    await expect.poll(() => read(run)).toContain('    - im T 所有的像 <!-- box=0.813,0.781,0.171,0.064 -->\n      所有能映到的\n    - 秩-零化度定理')
    await expect(node(page, 'im T 所有的像').getByTestId('map-note-icon')).toBeVisible()
    // 撤回两下：回到打开时一个字节不差
    await layer(page).focus()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toBe(after)
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toBe(MAP2_OPEN)
  } finally {
    await run.close()
  }
})

test('② 在导图里找：⇧⌘F 右上角出找的条，找主题的字和备注，↵ 下一处，收着的枝临时展开（不写文件），esc 关掉就收回；⌘F 照旧是全库搜', async () => {
  const run = await launch(map2Files(), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openMap(page, 14)
    await node(page, '线性映射').click()
    await page.keyboard.press('Meta+Shift+F')
    const bar = board(page).getByTestId('find-bar')
    await expect(bar).toBeVisible()
    await expect(bar.getByRole('textbox')).toBeFocused()
    await expect(bar.getByTestId('find-note')).toHaveText('找主题的字和备注；收着的枝里找到了会临时展开')
    await page.keyboard.type('矩阵')
    // 4 处：主题「矩阵表示」、「列 = 基向量的像」的备注、「复合 = 矩阵相乘」、链接「详见 第3讲 矩阵乘法」
    await expect(bar.getByTestId('find-count')).toHaveText('1/4')
    await expect(node(page, '矩阵表示')).toHaveClass(/\bhitcur\b/)
    await expect(bar.getByTestId('find-note')).toHaveText('第 1 处：「矩阵表示」 · 「矩阵表示」本来收着，先临时展开了，关掉就收回')
    // 收着的「矩阵表示」临时展开了：17 个，圆点是虚线；文件一个字节没变
    await expect(board(page).locator('.mm-node:not(.sumt)')).toHaveCount(17)
    await expect(node(page, '矩阵表示').locator('.fold.tmp')).toHaveCount(1)
    expect(read(run)).toBe(MAP2)
    await expect(board(page).locator('.mm-node mark')).toHaveCount(3)
    // ↵ 下一处：在「列 = 基向量的像」的备注里，小图标亮着
    await page.keyboard.press('Enter')
    await expect(bar.getByTestId('find-count')).toHaveText('2/4')
    await expect(node(page, '列 = 基向量的像')).toHaveClass(/\bhitcur\b/)
    await expect(node(page, '列 = 基向量的像')).toHaveClass(/\bsel\b/)
    await expect(node(page, '列 = 基向量的像').getByTestId('map-note-icon')).toHaveClass(/\bon\b/)
    await expect(bar.getByTestId('find-note')).toContainText('第 2 处在「列 = 基向量的像」的备注里')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await expect(bar.getByTestId('find-count')).toHaveText('4/4')
    await expect(node(page, '详见 第3讲 矩阵乘法')).toHaveClass(/\bhitcur\b/)
    // ⇧↵ 上一处
    await page.keyboard.press('Shift+Enter')
    await expect(bar.getByTestId('find-count')).toHaveText('3/4')
    // 不找备注：3 处
    await bar.getByRole('button', { name: '也找备注' }).click()
    await expect(bar.getByTestId('find-count')).toHaveText('1/3')
    // 没有的：提示到全库找
    await bar.getByRole('textbox').fill('没有这个词')
    await expect(bar.getByTestId('find-count')).toHaveText('0')
    await expect(bar.getByTestId('find-note')).toHaveText('这块导图里没有「没有这个词」 · 到全库找 ⌘K')
    // esc 关掉：收回去，文件没变
    await page.keyboard.press('Escape')
    await expect(bar).toHaveCount(0)
    await expect(board(page).locator('.mm-node:not(.sumt)')).toHaveCount(14)
    expect(read(run)).toBe(MAP2)
    // ⌘F 照旧开全库搜索
    await node(page, '例子').click()
    await page.keyboard.press('Meta+f')
    await expect(page.getByRole('dialog', { name: '搜索和命令' })).toBeVisible()
    await page.keyboard.press('Escape')
    // 标签条「⋯」›「在导图里找」：一样开找的条（写着 ⇧⌘F）
    await armMenus(run)
    await acts(page).getByRole('button', { name: '更多' }).click()
    await pickMenu(run, '在导图里找')
    await expect(bar).toBeVisible()
    await expect(bar.getByRole('textbox')).toBeFocused()
  } finally {
    await run.close()
  }
})

test('③ 链接：[[双链]] 只露名字（强调色下划线），指着停一下出链接卡，点了在中间新标签打开；改字时打 [[ 出找笔记的小框', async () => {
  const run = await launch(map2Files(MAP2_OPEN), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openMap(page, 17)
    const lk = node(page, '详见 第3讲 矩阵乘法').getByTestId('map-link')
    await expect(lk).toHaveText('第3讲 矩阵乘法')
    await lk.hover()
    const card = page.getByTestId('map-link-card')
    await expect(card).toBeVisible()
    await expect(card).toContainText('第3讲 矩阵乘法')
    await expect(card.getByRole('button', { name: '打开' })).toBeVisible()
    await expect(card.getByRole('button', { name: '改链接' })).toBeVisible()
    await expect(card.getByRole('button', { name: '去掉链接' })).toBeVisible()
    // 点链接的字：中间开那一篇
    await lk.click()
    await expect(tabOn(page)).toHaveText('第3讲 矩阵乘法')
    await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
    await expect(board(page).locator('.mm-node:not(.sumt)')).toHaveCount(17)

    // 改字时打 [[：找笔记的小框，↵ 填上，文件里是 [[…]]，导图上只露名字
    await node(page, '例子').dblclick()
    const box = page.getByRole('textbox', { name: '节点的字' })
    await expect(box).toBeFocused()
    await page.keyboard.press('Meta+ArrowRight')
    await page.keyboard.type(' 见[[学习')
    const sugg = page.getByTestId('map-link-suggest')
    await expect(sugg).toBeVisible()
    await expect(sugg.getByRole('option').first()).toHaveText('学习笔记：动手学深度学习')
    await page.keyboard.press('Enter')
    await expect(box).toHaveValue('例子 见[[学习笔记：动手学深度学习]]')
    await page.keyboard.press('Enter')
    await expect.poll(() => line(read(run), '例子')).toBe('  - 例子 见[[学习笔记：动手学深度学习]] <!-- box=0.233,0.675,0.091,0.082 -->')
    await expect(node(page, '例子 见学习笔记：动手学深度学习').getByTestId('map-link')).toHaveText('学习笔记：动手学深度学习')
    // 链接卡「去掉链接」：只留字
    await node(page, '例子 见学习笔记：动手学深度学习').getByTestId('map-link').hover()
    await card.getByRole('button', { name: '去掉链接' }).click()
    await expect.poll(() => line(read(run), '例子')).toBe('  - 例子 见学习笔记：动手学深度学习 <!-- box=0.233,0.675,0.091,0.082 -->')
  } finally {
    await run.close()
  }
})

test('⑤⑥⑨ 多选：⌘ 点、⇧ 点、空白处拖框；操作条加外框（写名字）、概要、联系线（编号、属性、写字、拖弯度、⌫ 删）、拷贝、删除', async () => {
  const run = await launch(map2Files(MAP2_OPEN), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1900, height: 1000 })
    await openMap(page, 17)
    // ⌘ 点两个：操作条「已选2个」
    await node(page, 'ker T 映到 0').click()
    await node(page, 'im T 所有的像').click({ modifiers: ['Meta'] })
    const bar = board(page).getByTestId('map-selbar')
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('已选2个')
    await expect(node(page, 'ker T 映到 0')).toHaveClass(/\bsel\b/)
    await expect(node(page, 'im T 所有的像')).toHaveClass(/\bsel\b/)
    // 外框：记在前面那个上，从它起 2 个；接着写名字
    await bar.getByRole('button', { name: '外框' }).click()
    await expect.poll(() => line(read(run), 'ker T 映到 0')).toBe('    - ker T 映到 0 <!-- box=0.812,0.567,0.164,0.064 frame=2 -->')
    const inl = board(page).getByTestId('map-inline')
    await expect(inl).toBeFocused()
    await page.keyboard.type('核和像')
    await page.keyboard.press('Enter')
    await expect.poll(() => line(read(run), 'ker T 映到 0')).toBe('    - ker T 映到 0 <!-- box=0.812,0.567,0.164,0.064 frame=2 frame-title="核和像" -->')
    await expect(board(page).getByTestId('map-frame')).toHaveCount(1)
    await expect(board(page).getByTestId('map-frame-title')).toHaveText('核和像')
    // 框住的两个都在框里
    const fr = (await board(page).getByTestId('map-frame').boundingBox())!
    for (const t of ['ker T 映到 0', 'im T 所有的像']) {
      const b = (await node(page, t).boundingBox())!
      expect(b.x >= fr.x && b.y >= fr.y && b.x + b.width <= fr.x + fr.width && b.y + b.height <= fr.y + fr.height, t).toBe(true)
    }

    // 联系线：选两个 → 两头编号写在行尾，属性里一行；接着写线上的字
    await node(page, 'T(cv)=cT(v)').click()
    await node(page, '求导 d/dx').click({ modifiers: ['Meta'] })
    await bar.getByRole('button', { name: '联系线' }).click()
    await expect.poll(() => read(run)).toContain('导图联系线:\n  - k1 -> k2\n')
    expect(line(read(run), 'T(cv)=cT(v)')).toBe('    - T(cv)=cT(v) <!-- box=0.054,0.338,0.166,0.066 id=k1 -->')
    expect(line(read(run), '求导 d/dx')).toBe('    - 求导 d/dx <!-- box=0.207,0.882,0.142,0.068 id=k2 -->')
    await expect(inl).toBeFocused()
    await page.keyboard.type('求导也是线性的')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run)).toContain('导图联系线:\n  - k1 -> k2 "求导也是线性的"\n')
    await expect(board(page).getByTestId('map-rel-label')).toHaveText('求导也是线性的')
    // 拖小圆点改弯度
    const hd = board(page).getByTestId('map-rel-handle')
    await expect(hd).toBeVisible()
    const h = (await hd.boundingBox())!
    await dragTo(page, { x: h.x + 5, y: h.y + 5 }, { x: h.x + 65, y: h.y + 5 })
    await expect.poll(() => /k1 -> k2 "求导也是线性的" bend=-?\d+/.test(read(run))).toBe(true)
    // ⌫ 删掉这条联系线：属性那几行去掉（编号留着）
    await page.keyboard.press('Backspace')
    await expect.poll(() => read(run)).not.toContain('导图联系线')

    // 空白处拖框：框住「例子」下面三个
    const a = (await node(page, '旋转').boundingBox())!
    const c = (await node(page, '求导 d/dx').boundingBox())!
    await dragTo(page, { x: a.x - 16, y: a.y - 6 }, { x: c.x + c.width + 30, y: c.y + c.height + 6 })
    await expect(bar).toContainText('已选3个')
    // 概要：一个括号收成一句话
    await bar.getByRole('button', { name: '概要' }).click()
    await expect.poll(() => line(read(run), '旋转')).toBe('    - 旋转 <!-- box=0.073,0.591,0.072,0.068 sum=3 -->')
    await page.keyboard.type('都能写成矩阵')
    await page.keyboard.press('Enter')
    await expect.poll(() => line(read(run), '旋转')).toBe('    - 旋转 <!-- box=0.073,0.591,0.072,0.068 sum=3 sum-text="都能写成矩阵" -->')
    await expect(board(page).getByTestId('map-sum')).toHaveText('都能写成矩阵')

    // ⇧ 点：同一级连选；拷贝成一段缩进列表（主进程的剪贴板换成记录，不碰真的剪贴板）
    await run.app.evaluate(({ ipcMain }) => {
      const g = globalThis as unknown as { cnCopied: string[] }
      g.cnCopied = []
      ipcMain.removeHandler('ctx:copy')
      ipcMain.handle('ctx:copy', (_e, t: string) => void g.cnCopied.push(t))
    })
    await node(page, 'T(u+v)=T(u)+T(v)').click()
    await node(page, '先加再映射，和先映射再加，结果一样；数乘也一样').click({ modifiers: ['Shift'] })
    await expect(bar).toContainText('已选3个')
    await bar.getByRole('button', { name: '拷贝' }).click()
    await expect
      .poll(() => run.app.evaluate(() => (globalThis as unknown as { cnCopied: string[] }).cnCopied.at(-1)))
      .toBe('- T(u+v)=T(u)+T(v)\n- T(cv)=cT(v)\n- 先加再映射，和先映射再加，结果一样；数乘也一样')
    // 删除：三个一起删，联系线的那一头没了（属性早删了），⌘Z 回来
    const before = read(run)
    await bar.getByRole('button', { name: '删掉这几个（连同下面的）' }).click()
    await expect.poll(() => read(run)).not.toContain('T(u+v)=T(u)+T(v)')
    await expect(node(page, '定义')).toHaveCount(1)
    await layer(page).focus()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toBe(before)
  } finally {
    await run.close()
  }
})

test('⑤ 几个一起拖：⌘ 点选两个，拖其中一个到别的主题正中间，两个一起挂过去、按原来的先后排在一起；⌘Z 回来', async () => {
  const run = await launch(map2Files(MAP2_OPEN), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1900, height: 1000 })
    await openMap(page, 17)
    await node(page, 'T(cv)=cT(v)').click()
    await node(page, '投影').click({ modifiers: ['Meta'] })
    await expect(board(page).getByTestId('map-selbar')).toContainText('已选2个')
    await dragTo(page, await mid(page, '投影'), await mid(page, '核与像'))
    await expect.poll(() => read(run)).toContain(
      '    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->\n      dim V = dim ker T + dim im T。\n\n      老师说这是这一章最要紧的一条，期末必考。\n    - T(cv)=cT(v) <!-- box=0.054,0.338,0.166,0.066 -->\n    - 投影 <!-- box=0.061,0.754,0.072,0.068 -->\n',
    )
    // 两个都还选着
    await expect(node(page, 'T(cv)=cT(v)')).toHaveClass(/\bsel\b/)
    await expect(node(page, '投影')).toHaveClass(/\bsel\b/)
    await layer(page).focus()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toBe(MAP2_OPEN)
  } finally {
    await run.close()
  }
})

test('⑦ 浮动主题：双击空白处加一个（直接打字，写在大树后面、行尾记位置），拖着挪位置，拖到一个主题正中间挂回树上', async () => {
  const run = await launch(map2Files(MAP2_OPEN), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1900, height: 1000 })
    await openMap(page, 17)
    const c = (await node(page, '线性映射').boundingBox())!
    const right = Math.max(...(await board(page).locator('.mm-node').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))))
    await page.mouse.dblclick(right + 120, c.y + c.height / 2)
    const box = page.getByRole('textbox', { name: '节点的字' })
    await expect(box).toBeFocused()
    await box.fill('先记一笔')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run)).toMatch(/\n- 先记一笔 <!-- at=\d+,-?\d+ -->\n$/)
    // 白板没在这里加卡片
    expect(read(run)).not.toContain('<!-- card')
    await expect(node(page, '先记一笔')).toHaveClass(/\bflt\b/)
    await expect(node(page, '先记一笔')).toHaveClass(/\bl1\b/)
    // Tab 给它加子主题，往右长
    await node(page, '先记一笔').click()
    await page.keyboard.press('Tab')
    await box.fill('后来想到的')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run)).toMatch(/\n- 先记一笔 <!-- at=\d+,-?\d+ -->\n {2}- 后来想到的\n$/)
    expect((await node(page, '后来想到的').boundingBox())!.x).toBeGreaterThan((await node(page, '先记一笔').boundingBox())!.x)
    // 拖着挪位置：at 跟着变
    const at0 = /at=(\d+),(-?\d+)/.exec(read(run))!
    const f = await mid(page, '先记一笔')
    await dragTo(page, f, { x: f.x + 60, y: f.y + 80 })
    await expect.poll(() => /at=(\d+),(-?\d+)/.exec(read(run))![0]).not.toBe(at0[0])
    const at1 = /at=(\d+),(-?\d+)/.exec(read(run))!
    expect(Number(at1[1]) - Number(at0[1])).toBeGreaterThan(40)
    expect(Number(at1[2]) - Number(at0[2])).toBeGreaterThan(55)
    // 拖到「例子」正中间：挂到它下面，不再记位置
    await dragTo(page, await mid(page, '先记一笔'), await mid(page, '例子'))
    await expect.poll(() => read(run)).toContain('    - 求导 d/dx <!-- box=0.207,0.882,0.142,0.068 -->\n    - 先记一笔\n      - 后来想到的\n')
    expect(read(run)).not.toContain('at=')
    // 右键「拆成浮动主题」拆出来
    await armMenus(run)
    await node(page, '先记一笔').click({ button: 'right' })
    await pickMenu(run, '拆成浮动主题')
    await expect.poll(() => read(run)).toMatch(/\n- 先记一笔 <!-- at=-?\d+,-?\d+ -->\n {2}- 后来想到的\n$/)
  } finally {
    await run.close()
  }
})

test('⑧ 图片：选中主题贴一张图（存进附件，写在字后面、宽记在行尾），图在字上面；拖右下角改宽；右键去掉图片回到原样', async () => {
  const run = await launch(map2Files(MAP2_OPEN), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1900, height: 1000 })
    await openMap(page, 17)
    const rot = node(page, '旋转')
    await rot.click()
    const h0 = (await rot.boundingBox())!.height
    // 贴一张图（剪贴板里的截图）：一张 2×1 的 PNG
    await layer(page).evaluate(async (el) => {
      const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mNk+M9QzwAEjDAGACCDAv8cI7IoAAAAAElFTkSuQmCC'), (c) => c.charCodeAt(0))
      const dt = new DataTransfer()
      dt.items.add(new File([png], 'image.png', { type: 'image/png' }))
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    })
    await expect.poll(() => line(read(run), '旋转')).toMatch(/^ {4}- 旋转 !\[\]\([^)]+\.png\) <!-- box=0\.073,0\.591,0\.072,0\.068 img-w=120 -->$/)
    const src = /!\[\]\(([^)]+)\)/.exec(line(read(run), '旋转'))![1]!
    expect(readdirSync(join(run.vault, decodeURIComponent(join('课程/动手学深度学习', src).replace(/\/[^/]+$/, ''))))).toHaveLength(1)
    const img = rot.getByTestId('map-topic-img')
    await expect(img).toBeVisible()
    await expect(img).toHaveJSProperty('complete', true)
    // 2:1 的图画 120 宽、60 高，主题跟着变高
    await expect.poll(async () => Math.round((await img.boundingBox())!.width)).toBe(120)
    await expect.poll(async () => Math.round((await img.boundingBox())!.height)).toBe(60)
    expect((await rot.boundingBox())!.height).toBeGreaterThan(h0 + 60)
    // 拖右下角：只改宽
    const hd = rot.getByTestId('map-img-resize')
    const hb = (await hd.boundingBox())!
    await dragTo(page, { x: hb.x + 5, y: hb.y + 5 }, { x: hb.x + 45, y: hb.y + 5 })
    await expect.poll(() => line(read(run), '旋转')).toMatch(/img-w=1[56]\d -->$/)
    // 去掉图片：回到原样
    await armMenus(run)
    await rot.click({ button: 'right' })
    await pickMenu(run, '去掉图片')
    await expect.poll(() => read(run)).toBe(MAP2_OPEN)
  } finally {
    await run.close()
  }
})

test('⑩⑪ 配色、骨架、鱼骨、时间线：都在「布局 ▾」里，点了马上换，属性各一行（默认的不写）；换回去回到原样', async () => {
  const run = await launch(map2Files(MAP2_OPEN), { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1900, height: 1000 })
    await openMap(page, 17)
    await acts(page).getByTestId('map-layout').click()
    const menu = page.getByTestId('map-layout-menu')
    // 彩虹：属性一行，中心实心，第一层每枝一个颜色
    await menu.getByTestId('map-palette').getByRole('menuitemradio', { name: '彩虹' }).click()
    await expect.poll(() => read(run)).toContain('白板样式: 导图\n导图配色: 彩虹\n类型: 导图\n')
    await expect(layer(page)).toHaveAttribute('data-pal', 'rainbow')
    const colors = await board(page)
      .locator('.mm-node.l1')
      .evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor))
    expect(new Set(colors).size).toBe(4)
    // 菜单还开着：骨架「线条」
    await menu.getByTestId('map-skeleton').getByRole('menuitemradio', { name: '线条' }).click()
    await expect.poll(() => read(run)).toContain('导图配色: 彩虹\n导图骨架: 线条\n')
    await expect(board(page).locator('.mm-node.l1.ul')).toHaveCount(4)
    await expect(menu.locator('.foot')).toHaveText('记在这篇的属性里：导图布局: 向右（向右是默认，不写） 导图配色: 彩虹 导图骨架: 线条')
    // 鱼骨：属性一行；鱼头在最右，一根脊骨
    await menu.locator('.lay', { hasText: '鱼骨' }).click()
    await expect.poll(() => read(run)).toContain('白板样式: 导图\n导图布局: 鱼骨\n导图配色: 彩虹\n')
    await expect(layer(page)).toHaveAttribute('data-layout', 'fish')
    await expect(board(page).locator('.mm-wires .spine')).toHaveCount(1)
    const xs = await board(page)
      .locator('.mm-node')
      .evaluateAll((els) => els.map((e) => ({ t: e.textContent, r: e.getBoundingClientRect().right })))
    const head = xs.find((x) => x.t === '线性映射')!
    expect(Math.max(...xs.map((x) => x.r))).toBe(head.r)
    // 时间线：横线末端有箭头
    await acts(page).getByTestId('map-layout').click()
    await menu.locator('.lay', { hasText: '时间线' }).click()
    await expect.poll(() => read(run)).toContain('导图布局: 时间线\n')
    await expect(board(page).locator('.mm-wires .spine path.arrow')).toHaveCount(1)
    // 换回默认：属性那几行都去掉，回到原样
    await acts(page).getByTestId('map-layout').click()
    await menu.getByTestId('map-palette').getByRole('menuitemradio', { name: '跟主题' }).click()
    await menu.getByTestId('map-skeleton').getByRole('menuitemradio', { name: '卡片' }).click()
    await menu.locator('.lay', { hasText: '向右展开' }).click()
    await expect.poll(() => read(run)).toBe(MAP2_OPEN)
  } finally {
    await run.close()
  }
})

test('④⑫ 导出：⌘K「导出导图…」和标签条「⋯」都能开；PNG 2 倍、SVG、PDF、OPML 各存一份，文件对；导出不改这篇', async () => {
  const out = mkdtempSync(join(tmpdir(), 'cn-map-export-'))
  const run = await launch(map2Files(MAP2_OPEN), { CN_AI_FAKE: '1', CN_E2E_EXPORT_DIR: out })
  const { page } = run
  try {
    await openMap(page, 17)
    // ⌘K 不打字也找得到：「新建和导入」组里的「导出导图…」
    await node(page, '例子').click()
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await page.keyboard.type('导出导图')
    await pal.getByRole('option', { name: /导出导图…/ }).click()
    const dlg = page.getByTestId('map-export')
    await expect(dlg).toBeVisible()
    await expect(dlg.getByTestId('map-export-preview').locator('img')).toBeVisible()
    // PNG 2 倍
    await dlg.getByTestId('map-export-fmt').getByRole('radio', { name: 'PNG 图片' }).click()
    await dlg.getByTestId('map-export-scale').getByRole('radio', { name: '2倍' }).click()
    const note = await dlg.locator('.note').textContent()
    const px = Number(/(\d+) 像素宽/.exec(note!)![1])
    await dlg.getByTestId('map-export-go').click()
    await expect(dlg).toHaveCount(0)
    const png = join(out, '导图 11-22 17∶51.png')
    await expect.poll(() => readdirSync(out)).toContain('导图 11-22 17∶51.png')
    const buf = readFileSync(png)
    expect(buf.subarray(1, 4).toString()).toBe('PNG')
    expect(buf.readUInt32BE(16)).toBe(px)
    // 标签条「⋯」› 导出图片…，换成 SVG
    await armMenus(run)
    await acts(page).getByRole('button', { name: '更多' }).click()
    await pickMenu(run, '导出图片…')
    await expect(dlg).toBeVisible()
    await dlg.getByTestId('map-export-fmt').getByRole('radio', { name: 'SVG' }).click()
    await dlg.getByTestId('map-export-go').click()
    await expect.poll(() => readdirSync(out)).toContain('导图 11-22 17∶51.svg')
    const svg = readFileSync(join(out, '导图 11-22 17∶51.svg'), 'utf8')
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    for (const t of ['线性映射', '秩-零化度定理', '详见 第3讲 矩阵乘法']) expect(svg).toContain(`>${t}<`)
    expect(svg).toContain('<image href="data:image/jpeg;base64,')
    // PDF、OPML。印 PDF 的那个看不见的窗口不降成后台（降了的话 Mac 一忙它分不到 CPU，一张要半分钟以上）
    await run.app.evaluate(({ app }) => {
      app.once('browser-window-created', (_e, w) => {
        ;(globalThis as { pdfThrottle?: boolean }).pdfThrottle = w.webContents.getBackgroundThrottling()
      })
    })
    await acts(page).getByRole('button', { name: '更多' }).click()
    await pickMenu(run, '导出 PDF…')
    await dlg.getByTestId('map-export-go').click()
    await expect.poll(() => readdirSync(out), { timeout: 30_000 }).toContain('导图 11-22 17∶51.pdf')
    expect(await run.app.evaluate(() => (globalThis as { pdfThrottle?: boolean }).pdfThrottle)).toBe(false)
    await expect.poll(() => readFileSync(join(out, '导图 11-22 17∶51.pdf')).subarray(0, 5).toString()).toBe('%PDF-')
    await acts(page).getByRole('button', { name: '更多' }).click()
    await pickMenu(run, '导出 OPML 大纲…')
    await expect(dlg.getByTestId('map-export-preview')).toContainText('· 详见 第3讲 矩阵乘法')
    await dlg.getByTestId('map-export-go').click()
    await expect.poll(() => readdirSync(out)).toContain('导图 11-22 17∶51.opml')
    const opml = readFileSync(join(out, '导图 11-22 17∶51.opml'), 'utf8')
    expect(opml).toContain('<outline text="秩-零化度定理" _note="dim V = dim ker T + dim im T。&#10;&#10;老师说这是这一章最要紧的一条，期末必考。"/>')
    expect(read(run)).toBe(MAP2_OPEN)
  } finally {
    await run.close()
    rmSync(out, { recursive: true, force: true })
  }
})
