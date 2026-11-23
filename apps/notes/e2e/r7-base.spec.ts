/**
 * 第 7 轮 · 数据库照 Notion 做全（用户原话：「这个数据库需要你再去看一下 notion 的，功能再全一点，可以加更多的列」）：
 * 表头「+」加列选类型、列头菜单（改名、类型、排序、筛选、左右插入、隐藏、删除）、格子里改值、「+ 新建」、计算行、拖列宽、
 * 「改写法」只在这一块露出 YAML。每一行是一篇笔记、每一列是它的属性，都写回 md。都在测试模式里真点、真打字、真拖。
 */
import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, openNote, pane, shownText } from './app'

const read = (vault: string, name: string) => readFileSync(join(vault, name), 'utf8')

const ROOMS = '```base\nfilters:\n  and:\n    - file.inFolder("冰岛旅行/住宿")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 价格\n      - 评分\n```'
const ROOM_FILES: Record<string, string> = {
  '冰岛行程.md': `# 冰岛行程\n\n## 住哪\n\n${ROOMS}\n\n后面一段。\n`,
  '冰岛旅行/住宿/雷克雅未克 · Loft.md': '---\n价格: 1080\n评分: 9.1\n---\n',
  '冰岛旅行/住宿/维克 · 黑沙滩旅馆.md': '---\n价格: 980\n评分: 8.6\n---\n',
  '冰岛旅行/住宿/霍芬 · 港口客栈.md': '---\n价格: 1150\n评分: 9.0\n---\n',
}

test('数据库照 Notion：表头「+」加列选类型、列头菜单改名 / 改类型 / 右边插入 / 删除、格子里改多选和日期、「+ 新建」、计算行、拖列宽；都写回 md', async () => {
  const run = await launch(ROOM_FILES)
  const { page, vault, app } = run
  const file = () => read(vault, '冰岛行程.md')
  const room = (n: string) => read(vault, `冰岛旅行/住宿/${n}.md`)
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '冰岛行程')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(3)
    await expect(db.locator('.base-count')).toHaveText('3 条')
    // 只看不改：文件不变
    await page.waitForTimeout(800)
    expect(file()).toBe(ROOM_FILES['冰岛行程.md'])
    expect(gitStatus(vault)).toBe('')

    // 表头最右「+」：起名「标签」，选「多选」
    await db.getByRole('button', { name: '加一列' }).click()
    const addCol = page.getByRole('dialog', { name: '加一列' })
    await addCol.getByRole('textbox', { name: '新的一列叫什么' }).fill('标签')
    // 第三批（task-i921u）：加一列的菜单分三组，点类型就加上（照原型，不再另点「加」）
    await expect(addCol.getByRole('menuitem')).toHaveText(['文字', '数字', '选项', '多选', '状态', '日期', '勾选', '链接', '关联', '汇总', '公式', /^按钮点一下跑一串动作/, /^AI 生成一列说要什么/])
    await addCol.getByRole('menuitem', { name: '多选' }).click()
    await expect.poll(file).toContain('      - 评分\n      - 标签\n')
    expect(file()).toContain('properties:\n  标签:\n    type: multi\n```')
    await expect(db.locator('thead th.col')).toHaveText(['名字', '价格', '评分', '标签'])

    // 多选格子：建两个值，写回 frontmatter 一行 [a, b]
    await db.locator('tbody tr', { hasText: '霍芬' }).locator('td').nth(3).dblclick()
    const opts = page.getByRole('dialog', { name: '霍芬 · 港口客栈 · 标签' })
    const q = opts.getByRole('textbox', { name: '找一个，或者打一个新的' })
    await q.fill('海边')
    await q.press('Enter')
    await q.fill('温泉')
    await q.press('Enter')
    await expect.poll(() => room('霍芬 · 港口客栈')).toBe('---\n价格: 1150\n评分: 9.0\n标签: [海边, 温泉]\n---\n')
    await page.keyboard.press('Escape')
    await expect(db.locator('tbody tr', { hasText: '霍芬' }).locator('.base-sel')).toHaveText(['海边', '温泉'])

    // 列头菜单：改名「价格」→「一晚多少钱」，每一条的属性跟着改
    await db.getByRole('button', { name: '价格', exact: true }).click()
    const menu = page.getByRole('menu', { name: '价格 这一列' })
    await expect(menu.getByRole('menuitem')).toHaveText(['按这一列筛选…', '计算…', '左边插入一列', '右边插入一列', '隐藏这一列', '删除这一列'])
    await expect(menu.getByRole('menuitemradio')).toHaveText(['文字', '数字', '选项', '多选', '状态', '日期', '勾选', '链接'])
    const nameBox = menu.getByRole('textbox', { name: '列名' })
    await nameBox.fill('一晚多少钱')
    await nameBox.press('Enter')
    await expect.poll(() => room('维克 · 黑沙滩旅馆')).toBe('---\n一晚多少钱: 980\n评分: 8.6\n---\n')
    await expect.poll(file).toContain('      - 一晚多少钱\n')
    expect(file()).not.toContain('价格')

    // 改类型：「评分」→ 数字，写进 properties
    await db.getByRole('button', { name: '评分', exact: true }).click()
    await page.getByRole('menu', { name: '评分 这一列' }).getByRole('menuitemradio', { name: '数字' }).click()
    await expect.poll(file).toContain('  评分:\n    type: number')

    // 右边插入一列（日期），格子里填日期
    await db.getByRole('button', { name: '评分', exact: true }).click()
    await page.getByRole('menu', { name: '评分 这一列' }).getByRole('menuitem', { name: '右边插入一列' }).click()
    const ins = page.getByRole('dialog', { name: '加一列' })
    await ins.getByRole('textbox', { name: '新的一列叫什么' }).fill('入住')
    await ins.getByRole('menuitem', { name: '日期' }).click()
    await expect(db.locator('thead th.col')).toHaveText(['名字', '一晚多少钱', '评分', '入住', '标签'])
    await db.locator('tbody tr', { hasText: '维克' }).locator('td').nth(3).dblclick()
    // 日期格是能打字的浮层（task-cle3x），挂在最外层，不在块里
    const date = page.getByRole('textbox', { name: '维克 · 黑沙滩旅馆 · 入住' })
    await date.fill('2026-11-20')
    await date.press('Enter')
    await expect.poll(() => room('维克 · 黑沙滩旅馆')).toContain('入住: 2026-11-20')

    // 「+ 新建」：表底一行，新的一条直接起名
    await db.locator('.base-newrow').click()
    const named = db.locator('input.base-in')
    await expect(named).toBeFocused()
    await named.fill('塞尔福斯 · 河边小屋')
    await named.press('Enter')
    await expect(db.locator('tbody tr')).toHaveCount(4)
    await expect.poll(() => read(vault, '冰岛旅行/住宿/塞尔福斯 · 河边小屋.md')).toBe('')

    // 计算：平时表底没有空的计算行；列头菜单「计算…」选「求和」，表底才多出这一行
    await expect(db.locator('.base-sums')).toHaveCount(0)
    await db.getByRole('button', { name: '一晚多少钱', exact: true }).click()
    await page.getByRole('menu', { name: '一晚多少钱 这一列' }).getByRole('menuitem', { name: '计算…' }).click()
    // 表底算什么的菜单（task-i921u「通用合计」）：每样后面带着现在算出来的数
    await page.getByRole('menu', { name: '「一晚多少钱」算什么 · 这个视图' }).getByRole('menuitemradio').filter({ hasText: /^求和3,210$/ }).click()
    await expect.poll(file).toContain('    summaries:\n      一晚多少钱: Sum')
    await expect(db.locator('.base-sums td.on-sum')).toContainText('求和3,210')

    // 拖列宽：「评分」右边的缝往右拖 60，写进 columnSize
    const handle = db.getByRole('separator', { name: '拖动改「评分」的列宽' })
    const h = (await handle.boundingBox())!
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(h.x + 60, h.y + h.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect.poll(file).toMatch(/ {4}columnSize:\n {6}评分: \d+/)

    // 删除一列：确认后每一条里的这一项一起删
    await db.getByRole('button', { name: '入住', exact: true }).click()
    await page.getByRole('menu', { name: '入住 这一列' }).getByRole('menuitem', { name: '删除这一列' }).click()
    await page.getByRole('dialog', { name: '删掉这一列' }).getByRole('button', { name: '删除' }).click()
    await expect.poll(() => room('维克 · 黑沙滩旅馆')).toBe('---\n一晚多少钱: 980\n评分: 8.6\n---\n')
    await expect.poll(file).not.toContain('入住')
    await expect(db.locator('thead th.col')).toHaveText(['名字', '一晚多少钱', '评分', '标签'])
  } finally {
    await run.close()
  }
})

test('数据库「改写法」：只在这一块露出写法，「完成」写回、esc 收回不改；文档里平时看不到 YAML', async () => {
  const run = await launch(ROOM_FILES)
  const { page, vault } = run
  const file = () => read(vault, '冰岛行程.md')
  try {
    await openNote(page, '冰岛行程')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(3)
    expect(await shownText(page)).not.toContain('filters')
    await db.getByRole('button', { name: '改写法' }).click()
    const raw = db.getByRole('textbox', { name: '这一块的写法' })
    await expect(raw).toBeFocused()
    await expect(db.locator('.cm-raw-foot')).toHaveText('只在这一块里露出写法 · esc 收回完成')
    // esc：收回，什么都不改
    await page.keyboard.press('Escape')
    await expect(raw).toHaveCount(0)
    // 加一条筛选：价格 < 1000，点「完成」写回，表格跟着只剩 1 条
    await db.getByRole('button', { name: '改写法' }).click()
    const yaml = await raw.inputValue()
    await raw.fill(yaml.replace('    - file.inFolder("冰岛旅行/住宿")', '    - file.inFolder("冰岛旅行/住宿")\n    - 价格 < 1000'))
    await db.getByRole('button', { name: '完成' }).click()
    await expect.poll(file).toContain('    - 价格 < 1000\nviews:')
    await expect(db.locator('tbody tr')).toHaveCount(1)
    await expect(db.locator('.base-fchip')).toHaveText(['价格 < 1000'])
    // 再点「改写法」（照小样）：选中的是最后一条筛选条件，直接打字就改；框 132 高
    await db.getByRole('button', { name: '改写法' }).click()
    await expect(raw).toBeFocused()
    expect(await raw.evaluate((t) => (t as HTMLTextAreaElement).value.slice((t as HTMLTextAreaElement).selectionStart, (t as HTMLTextAreaElement).selectionEnd))).toBe('价格 < 1000')
    expect((await raw.boundingBox())!.height).toBe(132)
    await page.keyboard.press('Escape')
    await expect(raw).toHaveCount(0)
    expect(file()).toContain('    - 价格 < 1000\nviews:')
  } finally {
    await run.close()
  }
})

test('数据库块头「排序」「筛选」是纯字按钮（不带条数）：「排序」面板选列和方向写进 sort，× 不排序；改写法开着时「新一条」收起来', async () => {
  const run = await launch(ROOM_FILES)
  const { page, vault } = run
  const file = () => read(vault, '冰岛行程.md')
  try {
    await openNote(page, '冰岛行程')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(3)
    await expect(db.getByRole('button', { name: '筛选', exact: true })).toHaveText('筛选')
    // 排序：按价格降序
    await db.getByRole('button', { name: '排序', exact: true }).click()
    const panel = page.getByRole('dialog', { name: '排序' })
    await panel.getByRole('button', { name: '加一个排序' }).click()
    await panel.getByRole('combobox', { name: '排序的列' }).selectOption('价格')
    await expect.poll(file).toContain('    sort:\n      - property: 价格\n        direction: ASC')
    await panel.getByRole('combobox', { name: '升序还是降序' }).selectOption('desc')
    await expect.poll(file).toContain('        direction: DESC')
    await expect(db.locator('tbody tr').first()).toContainText('霍芬')
    // 第三行多了一颗「↓ 价格」：点它也开排序面板；× 不排序，sort 那几行整个拿掉
    await expect(db.locator('.base-fchip')).toHaveText('价格')
    await panel.getByRole('button', { name: '去掉这个排序' }).click()
    await expect.poll(file).not.toContain('sort:')
    expect(file()).toBe(ROOM_FILES['冰岛行程.md'])
    // 改写法开着：只留「完成」一颗实心，「新一条」先收起来
    await db.getByRole('button', { name: '改写法' }).click()
    await expect(db.getByRole('button', { name: '新一条' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(db.getByRole('button', { name: '新一条' })).toBeVisible()
  } finally {
    await run.close()
  }
})
