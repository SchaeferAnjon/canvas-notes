/**
 * 待办首页 + 画布今日 v2 里「切到画布笔记」那几屏（task-kzr3n）：
 * 设计 /private/tmp/canvas-notes-visual/18-待办首页/（用户选 A「日历在上、清单在下」），v2 原型 /private/tmp/canvas-tasks-design/v2/proto.html。
 * - 点图标栏「待办」格：左栏是待办列表，中间开「待办」标签（顶上一条小的周条；整页日历是「日历」格，2026-11-22 用户改）；再点亮着的格收起左栏，标签还在
 * - 首页里加一条、勾掉、拖一条到周条某一天（文件里只改那一行的日子）、点一天只看那天（Esc、×、再点一次回到全部）
 * - 左栏点一条：旁边弹详情小卡，中间滚到这一条、两边一起亮
 * - 文档里的待办：日子画成小块；悬停一行出「定日子」，点了今天 / 明天 / 下周一，只改 📅 那几个字
 * - 左栏头上「画布今日」那一颗（装了打开画布今日，测试模式只记下来；没装是「了解画布今日」，开下载页）
 * 一律真点、真打字、真拖；无头（CN_E2E=1）、临时库、临时设置目录。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, type Running, tabOn, waitSaved } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return iso(d)
}
const T0 = day(0)
const T1 = day(1)
const T2 = day(2)
const T3 = day(3)
const T4 = day(4)
const Y1 = day(-1)
const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const md = (d: string) => `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日`
const wdOf = (d: string) => WD[new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10))).getDay()]!

const INBOX = `# 待办\n\n- [ ] 交 ecp 作业 2 📅 ${Y1} 23:59 ⏫\n- [ ] 回导师邮件 📅 ${T0} 10:30\n- [ ] 买打印纸\n`
const WTODO = `# 待办\n\n- [ ] 改第二章的开头 📅 ${T2}\n- [ ] 给编辑发邮件 📅 ${T3} 10:00\n- [x] 交读书报告 📅 ${Y1} ✅ ${T0}\n`
const PLAN = `# 小论文计划\n\n截稿前把实验和初稿弄完。\n\n- [ ] 交论文初稿 📅 ${T1} 15:00 🔔 提前1小时\n- [ ] 写提纲\n\n最后一段。\n`
const VAULT: Record<string, string> = { '收件箱/待办.md': INBOX, '写作/待办.md': WTODO, '写作/小论文计划.md': PLAN }

const read = (run: Running, p: string) => readFileSync(join(run.vault, p), 'utf8')
const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const barBtn = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })
const home = (page: Page) => pane(page).getByTestId('todo-home')
const cal = (page: Page) => home(page).locator('.tdh-wk')
const calDay = (page: Page, d: string) => cal(page).locator(`[data-day="${d}"]`)
const side = (page: Page) => page.locator('aside.side[aria-label="待办"]')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const row = (scope: Locator, title: string) => scope.locator('.td-r').filter({ has: scope.page().locator('.td-t', { hasText: new RegExp(`^${esc(title)}$`) }) })
const titles = (scope: Locator) => scope.locator('.td-r .td-t').allTextContents()
const toast = (page: Page) => page.getByTestId('toast')
const screenLog = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.slice())

/** 按住一行拖到某个落点，慢慢挪过去再松手 */
async function dragTo(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + 80, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 90, a.y + a.height / 2 - 6, { steps: 3 })
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await expect(to).toHaveClass(/over/)
  await expect(page.locator('.td-ghost')).toBeVisible()
  await page.mouse.up()
}

test('点「待办」格：左栏是待办列表，中间开「待办」标签（顶上一条周条）；再点亮着的格收起左栏，标签还在；首页里加一条、勾掉', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    // 图标栏：文件、待办、日历、最近
    expect((await bar(page).locator('button.ab').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).slice(0, 4)).toEqual(['文件', '待办', '日历', '最近'])
    await barBtn(page, '待办').click()
    await expect(barBtn(page, '待办')).toHaveAttribute('aria-pressed', 'true')
    await expect(side(page)).toBeVisible()
    await expect(tabOn(page)).toHaveText('待办')
    await expect(home(page).locator('h1')).toHaveText('待办')
    // 今天 2 条（含过期 1 条）· 接下来七天 3 条
    await expect(home(page).getByTestId('tdh-meta')).toHaveText('今天2条（含过期1条） · 接下来七天3条 · 库里每篇笔记的「- [ ]」都在这里')
    // 顶上一条小的周条：从今天起七格，有没做完的待办画小点（2026-11-22 用户改：整页日历在「日历」格）
    expect(await cal(page).locator('.tdh-wc').evaluateAll((els) => els.map((e) => e.getAttribute('data-day')))).toEqual([T0, T1, T2, T3, day(4), day(5), day(6)])
    await expect(calDay(page, T0).locator('.cal-dots i')).toHaveCount(1)
    await expect(calDay(page, T3).locator('.cal-dots i')).toHaveCount(1)
    await expect(calDay(page, T4).locator('.cal-dots i')).toHaveCount(0)
    // 往后一周、回到今天
    await cal(page).getByRole('button', { name: '后一周' }).click()
    await expect(cal(page).locator('.tdh-wc').first()).toHaveAttribute('data-day', day(7))
    await cal(page).getByRole('button', { name: '回到今天' }).click()
    await expect(cal(page).locator('.tdh-wc').first()).toHaveAttribute('data-day', T0)
    // 几组：今天（过期在前）、接下来七天（按天）、更晚和没定日子的（按文件夹）
    await expect(home(page).locator('.tdh-sech').first()).toContainText(`今天${md(T0)} ${wdOf(T0)}2条`)
    expect(await titles(home(page).locator('[data-part="今天组"]'))).toEqual(['交 ecp 作业 2', '回导师邮件'])
    expect(await titles(home(page).locator('[data-part="七天组"]'))).toEqual(['交论文初稿', '改第二章的开头', '给编辑发邮件'])
    expect(await titles(home(page).locator('[data-part="按文件夹组"]'))).toEqual(['买打印纸', '写提纲'])
    // 再点亮着的「待办」格：左栏收起，标签还在
    await barBtn(page, '待办').click()
    await expect(side(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('待办')
    await barBtn(page, '待办').click()
    await expect(side(page)).toBeVisible()
    await expect(page.getByTestId('tab-list').getByRole('tab').filter({ hasText: /^待办$/ })).toHaveCount(1)

    // 首页顶上加一条：进 收件箱/待办.md，出现在「接下来七天」明天那一组
    const qa = home(page).getByRole('textbox', { name: '待办首页加一条' })
    await qa.click()
    await qa.pressSequentially('明天下午三点交论文')
    await expect(home(page).getByTestId('td-hint')).toContainText('认出来：明天 15:00')
    await qa.press('Enter')
    await expect(qa).toHaveValue('')
    await expect.poll(() => read(run, '收件箱/待办.md')).toBe(INBOX + `- [ ] 交论文 📅 ${T1} 15:00\n`)
    await expect(row(home(page).locator('[data-part="七天组"]'), '交论文')).toBeVisible()
    await expect(toast(page)).toContainText('加上了「交论文」')

    // 勾掉：文件里那一行改成 [x] 加 ✅；首页、左栏 2 秒后都不在「今天」里了，进首页底下「已完成」
    await row(home(page), '回导师邮件').getByRole('checkbox').click()
    await expect.poll(() => read(run, '收件箱/待办.md')).toContain(`- [x] 回导师邮件 📅 ${T0} 10:30 ✅ ${T0}`)
    await expect(row(home(page).locator('[data-part="今天组"]'), '回导师邮件')).toHaveCount(0)
    await expect(row(side(page), '回导师邮件')).toHaveCount(0)
    await home(page).locator('[data-part="已完成"]').click()
    await expect(row(home(page), '回导师邮件')).toHaveClass(/done/)
  } finally {
    await run.close()
  }
})

test('拖一条到周条上某一天：文件里只改那一行的日子；点一天只看那天（× / Esc / 再点一次回到全部），这时加一条加到那天', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await barBtn(page, '待办').click()
    await expect(cal(page)).toBeVisible()
    // 拖「改第二章的开头」（T2）到日历 T4 那一格：只改那一行的 📅
    await dragTo(page, row(home(page), '改第二章的开头'), calDay(page, T4))
    await expect.poll(() => read(run, '写作/待办.md')).toBe(WTODO.replace(`改第二章的开头 📅 ${T2}`, `改第二章的开头 📅 ${T4}`))
    await expect(calDay(page, T4).locator('.cal-dots i')).toHaveCount(1)
    await expect(toast(page)).toContainText('「改第二章的开头」改到')

    // 点一天只看那天
    await calDay(page, T3).click()
    await expect(calDay(page, T3)).toHaveClass(/sel/)
    await expect(home(page).locator('[data-part="日期筛选"]')).toHaveText('只看这天')
    expect(await titles(home(page))).toEqual(['给编辑发邮件'])
    // 只看那天时加一条：没写哪天就加到那天
    const qa = home(page).getByRole('textbox', { name: '待办首页加一条' })
    await expect(qa).toHaveAttribute('placeholder', `加一条到 ${md(T3)} ${wdOf(T3)}，回车`)
    await qa.click()
    await qa.pressSequentially('买花')
    await qa.press('Enter')
    await expect.poll(() => read(run, '收件箱/待办.md')).toBe(INBOX + `- [ ] 买花 📅 ${T3}\n`)
    await expect.poll(() => titles(home(page))).toEqual(['给编辑发邮件', '买花'])
    // Esc 回到全部（第一下 Esc 离开输入框，第二下回到全部）
    await qa.press('Escape')
    await expect(qa).not.toBeFocused()
    await expect(home(page).locator('[data-part="日期筛选"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(home(page).locator('[data-part="日期筛选"]')).toHaveCount(0)
    // 再点一次同一天回到全部；点 × 也回到全部
    await calDay(page, T3).click()
    await expect(home(page).locator('[data-part="日期筛选"]')).toBeVisible()
    await calDay(page, T3).click()
    await expect(home(page).locator('[data-part="日期筛选"]')).toHaveCount(0)
    await calDay(page, T1).click()
    await home(page).locator('[data-part="日期筛选"]').getByRole('button', { name: '看全部' }).click()
    await expect(home(page).locator('[data-part="日期筛选"]')).toHaveCount(0)

  } finally {
    await run.close()
  }
})

test('左栏点一条，弹详情小卡，中间滚到这一条、两边一起亮', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await barBtn(page, '待办').click()
    await expect(cal(page)).toBeVisible()

    // 左栏点一条：小卡贴在左栏右边，中间那一条也亮、滚进来
    const left = row(side(page), '给编辑发邮件')
    await left.click()
    await expect(page.getByRole('dialog', { name: '详情' })).toBeVisible()
    await expect(left).toHaveClass(/sel/)
    const center = row(home(page), '给编辑发邮件')
    await expect(center).toHaveClass(/sel/)
    await expect(center).toBeInViewport()
  } finally {
    await run.close()
  }
})

test('文档里的待办：日子画成小块；悬停一行出「定日子」，点了选明天，只加 📅 那几个字；点日子小块改到今天，只改日子、钟点留着', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await openNote(page, '小论文计划')
    const ed = pane(page).locator('.cm-content')
    // 光标不在那一行时：📅 那一截画成小块「明天 15:00」带铃铛
    await ed.locator('.cm-line', { hasText: '最后一段' }).click()
    const dated = ed.locator('.cm-line', { hasText: '交论文初稿' })
    await expect(dated.locator('.cm-tdchip')).toHaveText(/^明天 15:00 · $/)
    await expect(dated).not.toContainText('📅')
    // 悬停没日子的一行：出「定日子」「看详情」
    const plain = ed.locator('.cm-line', { hasText: '写提纲' })
    await plain.hover()
    await expect(plain.getByRole('button', { name: '定日子' })).toBeVisible()
    await expect(plain.getByRole('button', { name: '看详情' })).toBeVisible()
    await plain.getByRole('button', { name: '定日子' }).click()
    // 定日子的小菜单扩成了选择器（task-pd289）：最上面照旧今天 / 明天 / 下周一，点了选定就关上
    const pop = page.getByRole('menu', { name: '定日子和时间' })
    await expect(pop.getByRole('menuitem')).toHaveText([`今天${md(T0)}`, `明天${md(T1)}`, new RegExp(`^(下周一|周.)`)])
    await pop.getByRole('menuitem', { name: new RegExp(`^明天`) }).click()
    await expect(page.getByRole('dialog', { name: '定日子和时间' })).toHaveCount(0)
    await expect(toast(page)).toContainText('「写提纲」改到明天')
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/小论文计划.md')).toBe(PLAN.replace('- [ ] 写提纲\n', `- [ ] 写提纲 📅 ${T1}\n`))
    // 点日子小块：改到今天，钟点、提醒不动
    await ed.locator('.cm-line', { hasText: '最后一段' }).click()
    await dated.locator('.cm-tdchip').click()
    await page.getByRole('menu', { name: '定日子和时间' }).getByRole('menuitem', { name: /^今天/ }).click()
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/小论文计划.md')).toBe(PLAN.replace('- [ ] 写提纲\n', `- [ ] 写提纲 📅 ${T1}\n`).replace(`📅 ${T1} 15:00 🔔`, `📅 ${T0} 15:00 🔔`))
    // 看详情：弹待办详情小卡（同左栏那张）
    await ed.locator('.cm-line', { hasText: '最后一段' }).click()
    await dated.hover()
    await dated.getByRole('button', { name: '看详情' }).click()
    await expect(page.getByRole('dialog', { name: '详情' })).toContainText('交论文初稿')
  } finally {
    await run.close()
  }
})

test('左栏头上「画布今日」：装了是一颗「画布今日」，点了打开画布今日（测试模式只记下来）；文档里悬停多一颗「画布今日」', async () => {
  const run = await launch(VAULT, { CN_TODAY_INSTALLED: '1' })
  const { page } = run
  try {
    await barBtn(page, '待办').click()
    const btn = side(page).getByRole('button', { name: '在画布今日里打开' })
    await expect(btn).toHaveText('画布今日')
    await btn.click()
    await expect.poll(async () => (await screenLog(run)).filter((x) => x.startsWith('打开 ') && x.includes('Canvas Today'))).toHaveLength(1)
    // 标签条右端也有一颗「在画布今日里打开」
    await acts(page).getByRole('button', { name: '在画布今日里打开' }).click()
    await expect.poll(async () => (await screenLog(run)).filter((x) => x.startsWith('打开 ') && x.includes('Canvas Today'))).toHaveLength(2)
    // 文档里悬停一行：多一颗「画布今日」，点了开 canvas-today://task/<🆔>（没有 🆔 的先只加那几个字）
    await barBtn(page, '最近').click()
    await openNote(page, '小论文计划')
    const line = pane(page).locator('.cm-line', { hasText: '写提纲' })
    await line.hover()
    await line.getByRole('button', { name: '画布今日' }).click()
    await expect.poll(async () => (await screenLog(run)).filter((x) => x.includes('canvas-today://task/'))).toHaveLength(1)
    await expect.poll(() => read(run, '写作/小论文计划.md')).toMatch(/- \[ \] 写提纲 🆔 [A-Za-z0-9_-]+\n/)
  } finally {
    await run.close()
  }
})

test('左栏头上没装画布今日时是「了解画布今日」：点了开下载页', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await barBtn(page, '待办').click()
    const link = side(page).getByRole('button', { name: '了解画布今日' })
    await expect(link).toBeVisible()
    await link.click()
    await expect.poll(async () => (await screenLog(run)).filter((x) => x.includes('canvas-note.us-cloud.uk/#today'))).toHaveLength(1)
  } finally {
    await run.close()
  }
})

test('右键一条：今天 / 明天 / 下周一、打开笔记到这一行、删除（系统菜单，删了能撤回）', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await armMenus(run)
    await barBtn(page, '待办').click()
    await row(home(page), '买打印纸').click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual([`今天（${md(T0)}）`, `明天（${md(T1)}）`, expect.stringMatching(/^下周一（/) as unknown as string, '打开笔记，到这一行', '删除'])
    await pickMenu(run, `明天（${md(T1)}）`)
    await expect.poll(() => read(run, '收件箱/待办.md')).toBe(INBOX.replace('- [ ] 买打印纸\n', `- [ ] 买打印纸 📅 ${T1}\n`))
    await row(home(page), '买打印纸').click({ button: 'right' })
    await pickMenu(run, '删除')
    await expect.poll(() => read(run, '收件箱/待办.md')).toBe(INBOX.replace('- [ ] 买打印纸\n', ''))
    await expect(row(home(page), '买打印纸')).toHaveCount(0)
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(run, '收件箱/待办.md')).toBe(INBOX.replace('- [ ] 买打印纸\n', `- [ ] 买打印纸 📅 ${T1}\n`))
  } finally {
    await run.close()
  }
})
