/**
 * 待办三处同一套画布今日样子（task-pd1d1，原型 /private/tmp/canvas-notes-visual/05-任务软件/todo-demo.html，用户「可以就这么做吧」）：
 * 图标栏「文件」下面的「待办」格、文件夹首页的待办卡、名字叫「待办」的笔记打开时的任务界面，是同一份待办：
 * 在哪勾掉另两处跟着勾（原处留 2 秒「已完成 · 撤回」，然后进「已完成 N 条 ›」），点一条弹详情小卡改日子，拖到「明天」改日子，顶上加一条认「明天下午三点交论文」，
 * 文件里只改那一行那几个字，能撤回；名字叫「待办」的笔记不在文件树、首页文件列表、「最近」里（设置能打开），⌘K 照样搜得到；
 * 别的笔记点一次「任务」记住这一篇（记在软件设置里，文件一个字节不变）；外面（画布今日、Git）改了几秒内三处都变。
 * 一律真点、真打字、真拖（Playwright 的鼠标），无头（CN_E2E=1）、临时库、临时设置目录。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, leftView, pane, type Running, tabOn } from './app'

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
const Y1 = day(-1)
const Y2 = day(-2)

/** 原型里那几篇（日子跟着今天走） */
const INBOX = `# 待办\n\n- [ ] 交 ecp 作业 2 📅 ${Y1} 23:59 ⏫\n- [ ] 回导师邮件 📅 ${T0} 10:30\n- [ ] 取快递 📅 ${T0} 18:00 🔔 准时\n- [ ] 订冰岛租车 📅 ${T1} 20:00 🔔 提前1小时\n- [ ] 买打印纸\n`
const WTODO = `# 待办\n\n- [ ] 改第二章的开头 📅 ${T2}\n- [ ] 给编辑发邮件 📅 ${T3} 10:00\n- [x] 交读书报告 📅 ${Y2} ✅ ${T0}\n`
const PLAN = `# 小论文计划\n\n截稿前把实验和初稿弄完。\n\n- [ ] 交论文初稿 📅 ${T1} 15:00 🔔 提前1小时 ⏫\n- [ ] 读完三篇相关论文 📅 ${T0}\n`
const ECP = `# Lecture05 笔记\n\n- [ ] 复习神经元结构图 📅 ${T0} 11:00\n`
const VAULT: Record<string, string> = { '收件箱/待办.md': INBOX, '写作/待办.md': WTODO, '写作/小论文计划.md': PLAN, '课程/ecp/Lecture05 笔记.md': ECP }

const read = (run: Running, p: string) => readFileSync(join(run.vault, p), 'utf8')
const settingsJson = (run: Running) => JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8')) as { files?: { showTodo?: boolean; noteViews?: Record<string, string> } }

/** 左栏的「待办」格 */
const cell = (page: Page) => page.locator('aside.side[aria-label="待办"]')
/** 一组（按文件夹时一个文件夹一组） */
const folderGroup = (page: Page, name: string) => cell(page).locator(`.td-fg[aria-label="${name}"]`)
/** 文件夹首页的待办卡 */
const card = (page: Page) => pane(page).getByTestId('todo-card')
/** 名字叫「待办」的笔记的任务界面 */
const view = (page: Page) => pane(page).locator('.td-view')
/** 一行待办（按标题认） */
const row = (scope: Locator, title: string) => scope.locator('.td-r').filter({ has: scope.page().locator('.td-t', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
const tick = (scope: Locator, title: string) => row(scope, title).getByRole('checkbox').click()
/** 组名和条数（条数在自己的 span 里，中间不手打空格）：拼成「今天 1」好比 */
const subs = (scope: Locator) => scope.locator('.td-sub').evaluateAll((els) => els.map((e) => [...e.childNodes].map((n) => (n.textContent ?? '').trim()).filter(Boolean).join(' ')))
const toast = (page: Page) => page.getByTestId('toast')
const treeRows = (page: Page) => page.locator('aside.side').getByRole('treeitem').locator('.truncate').allTextContents()

/**
 * 打开写作的首页（图标栏「写作」那一格），再把左栏换成「待办」格；
 * 「待办」格同时在中间开「待办」首页（task-kzr3n），点回「写作」那个标签看首页卡
 */
async function writingHomeAndCell(page: Page) {
  await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '写作', exact: true }).click()
  await expect(tabOn(page)).toHaveText('写作')
  await expect(card(page)).toBeVisible()
  await leftView(page, '待办')
  await expect(cell(page)).toBeVisible()
  await expect(tabOn(page)).toHaveText('待办')
  await page.getByTestId('tab-list').getByRole('tab', { name: '写作' }).click()
  await expect(card(page)).toBeVisible()
}

/** 按住一行拖到某个落点（组名），慢慢挪过去再松手 */
async function dragRow(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!
  const b = (await to.boundingBox())!
  await page.mouse.move(a.x + 60, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 70, a.y + a.height / 2 - 6, { steps: 3 })
  await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 10 })
  await expect(to).toHaveClass(/over/)
  await expect(page.locator('.td-ghost')).toBeVisible()
  await page.mouse.up()
}

test('左边待办格：图标栏「文件」下面一格，数字是今天没做的；按文件夹每个文件夹一组，组里 过期 / 今天 / 明天 / 以后；左栏只露勾选框、标题、日子小块', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    const bar = page.getByRole('navigation', { name: '左栏' })
    expect((await bar.locator('button.ab').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).slice(0, 4)).toEqual(['文件', '待办', '日历', '最近'])
    await expect(page.getByTestId('todo-count')).toHaveText('5')
    await leftView(page, '待办')
    await expect(cell(page).locator('.vh h2')).toHaveText(/^待办\s*今天\s*5$/)
    await expect(cell(page).getByRole('tab', { name: '按文件夹' })).toHaveAttribute('aria-selected', 'true')
    await expect(cell(page).getByRole('textbox', { name: '加一条' })).toHaveAttribute('placeholder', '加一条，「明天下午三点交论文」')
    expect(await cell(page).locator('.td-fg').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['收件箱', '写作', '课程 › ecp'])
    await expect.poll(() => subs(folderGroup(page, '收件箱'))).toEqual(['过期 1', '今天 2', '明天 1', '没定日子 1'])
    await expect.poll(() => subs(folderGroup(page, '写作'))).toEqual(['今天 1', '明天 1', '以后 2'])
    // 行尾日子小块：今天只写钟点，昨天、明天带钟点，过期的红；重要的勾选框是黄边
    await expect(row(folderGroup(page, '收件箱'), '交 ecp 作业 2').locator('.td-chip')).toHaveText('昨天 23:59')
    await expect(row(folderGroup(page, '收件箱'), '交 ecp 作业 2').locator('.td-chip')).toHaveClass(/red/)
    await expect(row(folderGroup(page, '收件箱'), '交 ecp 作业 2').getByRole('checkbox')).toHaveClass(/hi/)
    await expect(row(folderGroup(page, '收件箱'), '回导师邮件').locator('.td-chip')).toHaveText('10:30')
    await expect(row(folderGroup(page, '收件箱'), '订冰岛租车').locator('.td-chip')).toHaveText('明天 20:00')
    // 左栏不露出处
    await expect(cell(page).locator('.td-src')).toHaveCount(0)
    // 组下面「打开 写作/待办 ›」；没有「待办」那篇的文件夹没有
    await expect(folderGroup(page, '写作').getByRole('button', { name: '打开 写作/待办 ›' })).toBeVisible()
    await expect(folderGroup(page, '课程 › ecp').getByRole('button', { name: /^打开 / })).toHaveCount(0)
    // 收起一组：点组名前的箭头
    await folderGroup(page, '课程 › ecp').getByRole('button', { name: '收起课程 › ecp' }).click()
    await expect(row(folderGroup(page, '课程 › ecp'), '复习神经元结构图')).toHaveCount(0)
    await folderGroup(page, '课程 › ecp').getByRole('button', { name: '展开课程 › ecp' }).click()
    await expect(row(folderGroup(page, '课程 › ecp'), '复习神经元结构图')).toBeVisible()
    // 换成「今天」「七天」「收件箱」
    await cell(page).getByRole('tab', { name: '今天' }).click()
    await expect.poll(() => subs(cell(page))).toEqual(['过期 1', '今天 4'])
    await cell(page).getByRole('tab', { name: '七天' }).click()
    await expect.poll(() => subs(cell(page))).toEqual(['过期 1', '今天 4', '明天 2', '以后 2'])
    await cell(page).getByRole('tab', { name: '收件箱' }).click()
    await expect.poll(() => subs(cell(page))).toEqual(['过期 1', '今天 2', '明天 1', '以后', '没定日子 1'])
    await expect(cell(page).locator('.td-more', { hasText: '空着，拖一条到「以后」上就改到这天' })).toBeVisible()
    await cell(page).getByRole('tab', { name: '按文件夹' }).click()
  } finally {
    await run.close()
  }
})

test('三处同一份：左边待办格、写作首页的待办卡、写作/待办 的任务界面；在哪勾掉另两处跟着勾（原处 2 秒「已完成 · 撤回」再进已完成），文件里只改那一行；撤回回到原样', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await writingHomeAndCell(page)
    // 首页卡：同样分组和小块，标题后面灰色出处，已完成收成一行，底下加一条写进 写作/待办.md
    await expect.poll(() => subs(card(page))).toEqual(['今天 1', '明天 1', '以后 2'])
    await expect(row(card(page), '读完三篇相关论文').locator('.td-src')).toHaveText('· 小论文计划')
    await expect(row(card(page), '改第二章的开头').locator('.td-src')).toHaveText('· 待办')
    await expect(card(page).getByRole('button', { name: '已完成 1 条 ›' })).toBeVisible()
    await expect(card(page).getByRole('textbox', { name: '首页加一条' })).toHaveAttribute('placeholder', '加一条，写进 写作/待办.md')

    // ① 左边勾掉：左边、首页原处都是一行「已完成 · 撤回」；文件里只改那一行；数字少一
    await tick(folderGroup(page, '写作'), '读完三篇相关论文')
    const done = PLAN.replace(`- [ ] 读完三篇相关论文 📅 ${T0}`, `- [x] 读完三篇相关论文 📅 ${T0} ✅ ${T0}`)
    await expect.poll(() => read(run, '写作/小论文计划.md')).toBe(done)
    await expect(page.getByTestId('todo-count')).toHaveText('4')
    await expect(toast(page).locator('span').first()).toHaveText('勾掉了「读完三篇相关论文」')
    // 撤回：文件一个字节回到原样，两处都回来了
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(run, '写作/小论文计划.md')).toBe(PLAN)
    await expect(row(card(page), '读完三篇相关论文')).not.toHaveClass(/done/)
    await expect(row(folderGroup(page, '写作'), '读完三篇相关论文')).not.toHaveClass(/done/)
    await expect(page.getByTestId('todo-count')).toHaveText('5')

    // ② 首页卡里勾掉：左边跟着，2 秒后两处都收进「已完成 2 条 ›」
    await tick(card(page), '给编辑发邮件')
    await expect.poll(() => read(run, '写作/待办.md')).toBe(WTODO.replace(`- [ ] 给编辑发邮件 📅 ${T3} 10:00`, `- [x] 给编辑发邮件 📅 ${T3} 10:00 ✅ ${T0}`))
    await expect(row(folderGroup(page, '写作'), '给编辑发邮件')).toHaveCount(0)
    await expect(folderGroup(page, '写作').getByRole('button', { name: '已完成 2 条 ›' })).toBeVisible()
    await expect(row(card(page), '给编辑发邮件')).toHaveCount(0)

    // ③ 「打开 写作/待办 ›」：任务界面（标签条右边「任务」亮着）；在这里勾掉，左边和首页跟着
    await folderGroup(page, '写作').getByRole('button', { name: '打开 写作/待办 ›' }).click()
    await expect(tabOn(page)).toHaveText('写作/待办')
    await expect(acts(page).getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true')
    await expect(view(page).locator('h1')).toHaveText('待办')
    await expect(view(page).getByTestId('td-meta')).toHaveText('写作/待办.md · 1条没做 · 任务界面（文件还是那几行）')
    await expect(view(page).getByRole('button', { name: '已完成 2 条 ›' })).toBeVisible()
    await tick(view(page), '改第二章的开头')
    await expect.poll(() => read(run, '写作/待办.md')).toContain(`- [x] 改第二章的开头 📅 ${T2} ✅ ${T0}\n`)
    await expect(row(folderGroup(page, '写作'), '改第二章的开头')).toHaveCount(0)
    // 编辑器藏着，没有拿焦点：在任务界面打字不会写进文件
    await page.keyboard.type('abc')
    await page.waitForTimeout(400)
    expect(read(run, '写作/待办.md')).not.toContain('abc')
    // 在「已完成」里再点一次取消勾选：回到「以后」那组
    await view(page).getByRole('button', { name: '已完成 3 条 ›' }).click()
    await tick(view(page), '改第二章的开头')
    await expect.poll(() => read(run, '写作/待办.md')).toContain(`- [ ] 改第二章的开头 📅 ${T2}\n`)
    await expect(row(folderGroup(page, '写作'), '改第二章的开头')).not.toHaveClass(/done/)
  } finally {
    await run.close()
  }
})

test('点一条弹详情小卡：日期、钟点、提醒、重复、在哪篇第几行、那一行原文；改日子三处跟着变；拖到「明天」改日子', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await writingHomeAndCell(page)
    // 点左边「交论文初稿」：旁边弹详情
    await row(folderGroup(page, '写作'), '交论文初稿').locator('.td-t').click()
    const pop = page.getByRole('dialog', { name: '详情' })
    await expect(pop).toBeVisible()
    await expect(row(folderGroup(page, '写作'), '交论文初稿')).toHaveClass(/sel/)
    await expect(pop.locator('.td-pt')).toHaveText('交论文初稿')
    await expect(pop.getByRole('button', { name: '明天' })).toHaveClass(/on/)
    await expect(pop.getByRole('combobox', { name: '钟点' })).toHaveValue('15:00')
    await expect(pop.getByRole('combobox', { name: '提醒' })).toHaveValue('提前1小时')
    await expect(pop.getByRole('combobox', { name: '重复' })).toHaveValue('')
    await expect(pop.getByTestId('td-where')).toHaveText('写作/小论文计划.md · 第5行')
    await expect(pop.getByTestId('td-raw')).toHaveText(`- [ ] 交论文初稿 📅 ${T1} 15:00 🔔 提前1小时 ⏫`)
    // 弹在那一行右边，不盖住它
    const r = (await row(folderGroup(page, '写作'), '交论文初稿').boundingBox())!
    const p = (await pop.boundingBox())!
    expect(p.x).toBeGreaterThanOrEqual(r.x + r.width)
    // 改到今天：文件里只换日子那十个字，钟点留着；左边、首页都挪到「今天」
    await pop.getByRole('button', { name: '今天' }).click()
    await expect.poll(() => read(run, '写作/小论文计划.md')).toBe(PLAN.replace(`📅 ${T1} 15:00`, `📅 ${T0} 15:00`))
    await expect(pop.getByTestId('td-raw')).toHaveText(`- [ ] 交论文初稿 📅 ${T0} 15:00 🔔 提前1小时 ⏫`)
    await expect.poll(() => subs(folderGroup(page, '写作'))).toEqual(['今天 2', '以后 2'])
    await expect.poll(() => subs(card(page))).toEqual(['今天 2', '以后 2'])
    await expect(toast(page).locator('span').first()).toHaveText('「交论文初稿」改到今天 15:00')
    // 钟点、提醒、重复
    await pop.getByRole('combobox', { name: '钟点' }).selectOption('20:00')
    await expect.poll(() => read(run, '写作/小论文计划.md')).toContain(`- [ ] 交论文初稿 📅 ${T0} 20:00 🔔 提前1小时 ⏫\n`)
    await pop.getByRole('combobox', { name: '重复' }).selectOption('每天')
    await expect.poll(() => read(run, '写作/小论文计划.md')).toContain(`- [ ] 交论文初稿 📅 ${T0} 20:00 🔔 提前1小时 🔁 每天 ⏫\n`)
    await pop.getByRole('combobox', { name: '提醒' }).selectOption('')
    await expect.poll(() => read(run, '写作/小论文计划.md')).toContain(`- [ ] 交论文初稿 📅 ${T0} 20:00 🔁 每天 ⏫\n`)
    // 「打开笔记，到这一行」
    await pop.getByRole('button', { name: '打开笔记，到这一行' }).click()
    await expect(pop).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('小论文计划')
    await expect
      .poll(() =>
        page.evaluate(() => {
          const n = document.getSelection()?.focusNode
          const el = (n?.nodeType === 1 ? n : n?.parentElement) as HTMLElement | null
          return el?.closest('.cm-line')?.textContent ?? ''
        }),
      )
      .toContain('交论文初稿')
    await expect(pane(page).locator('.cm-flashbar:not([hidden])')).toBeVisible()
    // Esc 收起小卡
    await row(folderGroup(page, '收件箱'), '买打印纸').locator('.td-t').click()
    await expect(page.getByRole('dialog', { name: '详情' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '详情' })).toHaveCount(0)

    // 拖「买打印纸」到收件箱那组的「明天」上：改到明天；拖的时候跟着一张小卡，落点亮起来
    await dragRow(page, row(folderGroup(page, '收件箱'), '买打印纸'), folderGroup(page, '收件箱').locator('.td-sub', { hasText: /^明天/ }))
    await expect.poll(() => read(run, '收件箱/待办.md')).toBe(INBOX.replace('- [ ] 买打印纸\n', `- [ ] 买打印纸 📅 ${T1}\n`))
    await expect.poll(() => subs(folderGroup(page, '收件箱'))).toEqual(['过期 1', '今天 2', '明天 2'])
    await expect(toast(page).locator('span').first()).toHaveText('「买打印纸」改到明天')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(run, '收件箱/待办.md')).toBe(INBOX)
  } finally {
    await run.close()
  }
})

test('加一条：左边写进 收件箱/待办.md（认「明天下午三点」）、首页卡写进 写作/待办.md、任务界面写进这一篇；外面改了正在打的字不丢', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await writingHomeAndCell(page)
    const qa = cell(page).getByRole('textbox', { name: '加一条' })
    await qa.click()
    await page.keyboard.type('明天下午三点交论文')
    await expect(cell(page).getByTestId('td-hint')).toHaveText('认出来：明天 15:00 · 「交论文」 · 回车加进收件箱')
    // 正在打字时外面改了一篇（画布今日、Git）：字不丢、焦点还在
    writeFileSync(join(run.vault, '课程/ecp/Lecture05 笔记.md'), ECP + `- [ ] 外面加的一条 📅 ${T0} 09:00\n`)
    await expect(row(folderGroup(page, '课程 › ecp'), '外面加的一条')).toBeVisible({ timeout: 3000 })
    await expect(qa).toHaveValue('明天下午三点交论文')
    await expect(qa).toBeFocused()
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run, '收件箱/待办.md')).toBe(INBOX.replace('- [ ] 买打印纸\n', `- [ ] 买打印纸\n- [ ] 交论文 📅 ${T1} 15:00\n`))
    await expect(qa).toHaveValue('')
    await expect(row(folderGroup(page, '收件箱'), '交论文')).toBeVisible()
    await expect.poll(() => subs(folderGroup(page, '收件箱'))).toEqual(['过期 1', '今天 2', '明天 2', '没定日子 1'])
    await expect(toast(page).locator('span').first()).toHaveText('加上了「交论文」 · 明天 15:00')

    // 首页卡：写进 写作/待办.md
    await card(page).getByRole('textbox', { name: '首页加一条' }).click()
    // 「周末」现在认成日子（task-pd289）：这里只看写进哪一篇，用不带时间词的一句
    await page.keyboard.type('整理参考文献')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run, '写作/待办.md')).toBe(WTODO.replace(`- [x] 交读书报告 📅 ${Y2} ✅ ${T0}\n`, `- [x] 交读书报告 📅 ${Y2} ✅ ${T0}\n- [ ] 整理参考文献\n`))
    await expect(row(card(page), '整理参考文献').locator('.td-src')).toHaveText('· 待办')
    await expect(row(folderGroup(page, '写作'), '整理参考文献')).toBeVisible()

    // 任务界面：写进这一篇
    await folderGroup(page, '写作').getByRole('button', { name: '打开 写作/待办 ›' }).click()
    await view(page).getByRole('textbox', { name: '任务界面加一条' }).click()
    await page.keyboard.type('后天上午十点交稿')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run, '写作/待办.md')).toContain(`- [ ] 整理参考文献\n- [ ] 交稿 📅 ${T2} 10:00\n`)
    await expect(row(view(page), '交稿')).toBeVisible()

    // 写作首页没有「待办」那篇的别的文件夹：首页卡加一条时建 <文件夹>/待办.md
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '生活', exact: true }).click()
    await expect(tabOn(page)).toHaveText('生活')
    await card(page).getByRole('textbox', { name: '首页加一条' }).click()
    await page.keyboard.type('交房租')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(run.vault, '生活/待办.md')) && read(run, '生活/待办.md')).toBe('# 待办\n\n- [ ] 交房租\n')
    await expect(row(card(page), '交房租')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('名字叫「待办」的笔记默认用任务界面打开，点「文档」看原文，选哪种记在软件设置里（不改文件）；别的笔记点一次「任务」记住这一篇', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    // ⌘K 搜得到
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('待办')
    await expect(pal.getByRole('option').filter({ hasText: '待办' }).filter({ hasText: '写作' }).first()).toBeVisible()
    await pal.getByRole('option').filter({ hasText: '待办' }).filter({ hasText: '写作' }).first().click()
    await expect(tabOn(page)).toHaveText('写作/待办')
    // 标签条右边：任务、白板、文档并排，默认「任务」
    await expect(acts(page).getByRole('tab')).toHaveText(['任务', '白板', '文档'])
    await expect(acts(page).getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true')
    await expect(view(page)).toBeVisible()
    await expect(pane(page).locator('.cm-content')).toBeHidden()
    // 空着的今天、明天当落点
    await expect.poll(() => subs(view(page))).toEqual(['今天', '明天', '以后 2'])
    await expect(view(page).locator('.td-more', { hasText: '空着，拖一条到「明天」上就改到这天' })).toBeVisible()
    await expect(view(page).getByRole('button', { name: '已完成 1 条 ›' })).toBeVisible()
    await view(page).getByRole('button', { name: '已完成 1 条 ›' }).click()
    await expect(row(view(page), '交读书报告')).toHaveClass(/done/)
    // 想看原文：点「文档」
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(pane(page).locator('.cm-content')).toBeVisible()
    await expect(view(page)).toHaveCount(0)
    await expect(pane(page).locator('.cm-content')).toContainText('改第二章的开头')
    await expect.poll(() => settingsJson(run).files?.noteViews?.['写作/待办.md']).toBe('doc')
    // 关了再开：照记住的用文档打开
    await page.keyboard.press('Meta+w')
    await leftView(page, '待办')
    await folderGroup(page, '写作').getByRole('button', { name: '打开 写作/待办 ›' }).click()
    await expect(acts(page).getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true')
    await acts(page).getByRole('tab', { name: '任务' }).click()
    await expect(view(page)).toBeVisible()
    await expect.poll(() => settingsJson(run).files?.noteViews?.['写作/待办.md']).toBeUndefined()
    // 来回切了几次，文件一个字节没变
    expect(read(run, '写作/待办.md')).toBe(WTODO)

    // 别的笔记：默认文档；点一次「任务」这一篇就记住
    await row(folderGroup(page, '写作'), '交论文初稿').locator('.td-t').click()
    await page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '打开笔记，到这一行' }).click()
    await expect(tabOn(page)).toHaveText('小论文计划')
    await expect(acts(page).getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true')
    await acts(page).getByRole('tab', { name: '任务' }).click()
    await expect(view(page).locator('h1')).toHaveText('小论文计划')
    await expect.poll(() => subs(view(page))).toEqual(['今天 1', '明天 1', '以后'])
    await expect.poll(() => settingsJson(run).files?.noteViews?.['写作/小论文计划.md']).toBe('task')
    await page.keyboard.press('Meta+w')
    await leftView(page, '最近')
    await page.locator('aside.side .nav .si').filter({ hasText: '小论文计划' }).click()
    await expect(acts(page).getByRole('tab', { name: '任务' })).toHaveAttribute('aria-selected', 'true')
    expect(read(run, '写作/小论文计划.md')).toBe(PLAN)
    execFileSync('git', ['-C', run.vault, 'diff', '--exit-code'])
  } finally {
    await run.close()
  }
})

test('文件树、文件夹首页的文件列表、「最近」里不显示名字叫「待办」的笔记；设置 › 文件「文件树里显示待办」打开就显示', async () => {
  const run = await launch(VAULT)
  const { page } = run
  try {
    await leftView(page, '文件')
    const tree = page.locator('aside.side')
    // 展开收件箱、写作
    for (const name of ['收件箱', '写作']) {
      const r = tree.getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) }).first()
      if ((await r.getAttribute('aria-expanded')) !== 'true') await r.click()
    }
    await expect(tree.getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^小论文计划$/ }) })).toBeVisible()
    expect(await treeRows(page)).not.toContain('待办')
    // 首页文件列表
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '写作', exact: true }).click()
    const content = pane(page).getByTestId('folder-content')
    await expect(content.locator('.fc-n')).toHaveText('1篇')
    await expect(content).not.toContainText('待办')
    // 「最近」
    await leftView(page, '最近')
    await expect(page.locator('aside.side .nav .si').filter({ hasText: '小论文计划' })).toBeVisible()
    await expect(page.locator('aside.side .nav .si .truncate', { hasText: /^待办$/ })).toHaveCount(0)

    // 设置 › 文件和附件：「文件树里显示待办」默认关，打开就显示
    await page.keyboard.press('Meta+,')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '文件和附件', exact: true }).click()
    const sw = dlg.locator('[data-row="showTodo"]').getByRole('switch')
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(dlg.locator('[data-row="showTodo"]')).toContainText('名字叫「待办」的笔记也列在文件树、首页文件列表和「最近」里')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => settingsJson(run).files?.showTodo).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.locator('aside.side .nav .si .truncate', { hasText: /^待办$/ }).first()).toBeVisible()
    await expect(content.locator('.fc-n')).toHaveText('2篇')
    await leftView(page, '文件')
    await expect.poll(() => treeRows(page)).toContain('待办')
    // 关回去：又不显示
    await page.keyboard.press('Meta+,')
    await dlg.locator('[data-row="showTodo"]').getByRole('switch').click()
    await page.keyboard.press('Escape')
    await expect.poll(() => treeRows(page)).not.toContain('待办')
  } finally {
    await run.close()
  }
})

test('文件夹首页卡里存在 .首页.json 的旧待办：打开首页时一次搬进 <文件夹>/待办.md（一次提交，能撤回）', async () => {
  const home = { style: 'a', order: ['recent', 'todo'], hidden: [], widgets: { recent: { type: 'recent' }, todo: { type: 'todo', todos: ['交房租', '[x] 买菜'] } }, sizes: { todo: 2 } }
  const run = await launch({ ...VAULT, '生活/.首页.json': JSON.stringify(home, null, 2) + '\n', '生活/购物.md': '# 购物\n' })
  const { page } = run
  try {
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '生活', exact: true }).click()
    await expect(tabOn(page)).toHaveText('生活')
    await expect.poll(() => existsSync(join(run.vault, '生活/待办.md')) && read(run, '生活/待办.md')).toBe('# 待办\n\n- [ ] 交房租\n- [x] 买菜\n')
    await expect(row(card(page), '交房租')).toBeVisible()
    await expect(card(page).getByRole('button', { name: '已完成 1 条 ›' })).toBeVisible()
    expect(JSON.parse(read(run, '生活/.首页.json')).widgets.todo.todos).toBeUndefined()
    await expect(toast(page).locator('span').first()).toHaveText('首页待办卡里的2条搬进了「生活/待办.md」')
    expect(execFileSync('git', ['-C', run.vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('首页待办卡里的2条搬进了「生活/待办.md」')
    expect(execFileSync('git', ['-C', run.vault, 'status', '--porcelain'], { encoding: 'utf8' }).trim()).toBe('')
    // 撤回：两个文件回到搬之前；卡里说一句还有几条旧的没搬，点了再搬
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(run.vault, '生活/待办.md'))).toBe(false)
    // 撤回先退回待办.md、再写 .首页.json（两次写）：等后一个写完再读，不然读到的是搬过以后的（时过时不过）
    await expect.poll(() => JSON.parse(read(run, '生活/.首页.json')).widgets.todo.todos).toEqual(['交房租', '[x] 买菜'])
    await expect(card(page).getByRole('button', { name: '首页卡里还有2条旧待办 · 搬进「生活/待办.md」' })).toBeVisible()
    await card(page).getByRole('button', { name: '首页卡里还有2条旧待办 · 搬进「生活/待办.md」' }).click()
    await expect.poll(() => existsSync(join(run.vault, '生活/待办.md')) && read(run, '生活/待办.md')).toBe('# 待办\n\n- [ ] 交房租\n- [x] 买菜\n')
  } finally {
    await run.close()
  }
})

test('装了画布今日时详情里多一个「在画布今日里打开」：没有 🆔 的先给这一行加一个（只加那几个字），再打开 canvas-today://task/<🆔>', async () => {
  const run = await launch(VAULT, { CN_TODAY_INSTALLED: '1' })
  const { page } = run
  const opened = () => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.filter((x) => x.includes('canvas-today://')))
  try {
    await leftView(page, '待办')
    await row(folderGroup(page, '收件箱'), '回导师邮件').locator('.td-t').click()
    await page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '在画布今日里打开' }).click()
    await expect.poll(() => read(run, '收件箱/待办.md')).toMatch(new RegExp(`- \\[ \\] 回导师邮件 📅 ${T0} 10:30 🆔 [a-z0-9]{6}\\n`))
    const id = /回导师邮件 📅 \S+ \S+ 🆔 ([a-z0-9]{6})/.exec(read(run, '收件箱/待办.md'))![1]!
    // 别的字节一个没动
    expect(read(run, '收件箱/待办.md').replace(` 🆔 ${id}`, '')).toBe(INBOX)
    await expect.poll(opened).toEqual([`用浏览器打开 canvas-today://task/${id}`])
    // 已经有 🆔 的：不再改文件，照样打开
    await row(folderGroup(page, '收件箱'), '回导师邮件').locator('.td-t').click()
    await page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '在画布今日里打开' }).click()
    await expect.poll(async () => (await opened()).length).toBe(2)
    expect((read(run, '收件箱/待办.md').match(/🆔/g) ?? []).length).toBe(1)
  } finally {
    await run.close()
  }
})
