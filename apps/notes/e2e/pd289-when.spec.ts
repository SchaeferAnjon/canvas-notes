/**
 * 待办写时间的两种方式（task-pd289）：
 * - 自然语言：文档里真打「明天下午三点交论文」，停手出灰字预览（时间词划掉），Tab 收下读盘是标准写法；回车先出预览、再回车收下并换行；
 *   esc 不要、文件不改、这一行之后不再提示；本地认不出的「圣诞节前买礼物」问 AI（假 AI，记下只送了这一行、用的 Haiku）。
 * - 自己选：打 @ 弹选择器（方向键 + 回车选定）、⌥⌘T 弹（选钟点、提醒下拉）、点日子小块弹（清掉）、悬停「定日子」弹；白板卡里同一套；
 *   待办首页加一条：打 @ 选了插进输入框，回车加进收件箱；AI 认出来的写在下面那一行。
 * 一律真打字、真点、真按键；无头（CN_E2E=1）、临时库、临时设置目录。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acts, launch, openNote, pane, type Running, waitSaved } from './app'

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return iso(d)
}
const T0 = day(0)
const T1 = day(1)
/** 「圣诞节前」截止那天：今年的圣诞节（过了是明年的） */
const XMAS = `${new Date().getFullYear()}-12-25` >= T0 ? `${new Date().getFullYear()}-12-25` : `${new Date().getFullYear() + 1}-12-25`

const PLAN = '# 计划\n\n- [ ] 写提纲\n\n最后一段。\n'
const read = (run: Running, p: string) => readFileSync(join(run.vault, p), 'utf8')
const ed = (page: Page) => pane(page).locator('.cm-content')
const line = (page: Page, text: string | RegExp) => ed(page).locator('.cm-line', { hasText: text })
const ghost = (page: Page) => page.getByTestId('when-ghost')
const picker = (page: Page) => page.getByRole('dialog', { name: '定日子和时间' })
const toast = (page: Page) => page.getByTestId('toast')

/** 在「写提纲」那一行末尾按回车：下面多一行「- [ ] 」，光标在那里 */
async function newTask(page: Page) {
  await line(page, '写提纲').click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
}

test('自然语言：打「明天下午三点交论文」停手出灰字（时间词划掉），Tab 收下，读盘是标准写法', async () => {
  const run = await launch({ '写作/计划.md': PLAN })
  const { page } = run
  try {
    await openNote(page, '计划')
    await newTask(page)
    await page.keyboard.type('明天下午三点交论文')
    // 打字时不出；停手 0.6 秒出
    await expect(ghost(page)).toHaveCount(0)
    await expect(ghost(page)).toBeVisible({ timeout: 3000 })
    await expect(ghost(page)).toContainText(`📅 ${T1} 15:00`)
    await expect(ed(page).locator('.cm-when-cut')).toHaveText(['明天', '下午三点'])
    // 灰字是 --t3
    const colors = await page.evaluate(() => {
      const g = document.querySelector('[data-testid="when-ghost"] .cm-when-tail')!
      const probe = document.createElement('span')
      probe.style.color = 'var(--t3)'
      document.body.append(probe)
      const want = getComputedStyle(probe).color
      probe.remove()
      return { got: getComputedStyle(g).color, want }
    })
    expect(colors.got).toBe(colors.want)
    await page.screenshot({ path: 'test-results/pd289-ghost.png' })
    await page.keyboard.press('Tab')
    await expect(ghost(page)).toHaveCount(0)
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/计划.md')).toBe(`# 计划\n\n- [ ] 写提纲\n- [ ] 交论文 📅 ${T1} 15:00\n\n最后一段。\n`)
    // 光标在行尾：接着回车是新的一条
    await page.keyboard.press('Enter')
    await page.keyboard.type('买打印纸')
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/计划.md')).toContain(`- [ ] 交论文 📅 ${T1} 15:00\n- [ ] 买打印纸\n`)
  } finally {
    await run.close()
  }
})

test('回车：还没出预览先出预览、不换行；再回车收下并换行。esc 不要：文件不改，这一行之后不再提示', async () => {
  const run = await launch({ '写作/计划.md': PLAN })
  const { page } = run
  try {
    await openNote(page, '计划')
    await newTask(page)
    await page.keyboard.type('每周五晚上八点 组会')
    await page.keyboard.press('Enter')
    await expect(ghost(page)).toBeVisible()
    await expect(ghost(page)).toContainText('20:00')
    await expect(ghost(page)).toContainText('🔁 每周五')
    await expect(line(page, /组会/)).toHaveCount(1)
    await page.keyboard.press('Enter')
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/计划.md')).toMatch(/\n- \[ \] 组会 📅 \d{4}-\d{2}-\d{2} 20:00 🔁 每周五\n- \[ \] \n/)
    // 下一条：esc 不要
    await page.keyboard.type('下周三组会')
    await expect(ghost(page)).toBeVisible({ timeout: 3000 })
    await page.keyboard.press('Escape')
    await expect(ghost(page)).toHaveCount(0)
    // esc 不改字：盘上这一行照打的写
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/计划.md')).toContain('- [ ] 下周三组会\n')
    // 这一行之后不再提示
    await page.keyboard.type(' 带电脑')
    await page.waitForTimeout(1500)
    await expect(ghost(page)).toHaveCount(0)
    await waitSaved(page)
    expect(read(run, '写作/计划.md')).toMatch(/\n- \[ \] 下周三组会 带电脑\n\n最后一段。\n$/)
  } finally {
    await run.close()
  }
})

test('文档里选着几块时 esc、Tab 归选块（task-5ryf9）：esc 只取消选块、灰字还在；Tab 缩进这一块、不收灰字', async () => {
  const run = await launch({ '写作/计划.md': PLAN })
  const { page } = run
  try {
    await openNote(page, '计划')
    await newTask(page)
    await page.keyboard.type('明天下午三点交论文')
    await expect(ghost(page)).toBeVisible({ timeout: 3000 })
    const picked = pane(page).locator('.cm-blkSelLayer .cm-blk-sel')
    // 从这一行左边空白按住、往下拖一点：框住这一块（光标还留在这一行）
    const frame = async () => {
      const b = (await line(page, '交论文').boundingBox())!
      await page.mouse.move(b.x - 30, b.y + 3)
      await page.mouse.down()
      await page.mouse.move(b.x - 28, b.y + 8, { steps: 3 })
      await page.mouse.move(b.x - 26, b.y + b.height - 3, { steps: 4 })
      await page.mouse.up()
      await expect(picked).toHaveCount(1)
    }
    await frame()
    await page.keyboard.press('Escape')
    await expect(picked).toHaveCount(0)
    await expect(ghost(page)).toBeVisible()
    await frame()
    await page.keyboard.press('Tab')
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/计划.md')).toMatch(/\n- \[ \] 写提纲\n[ \t]+- \[ \] 明天下午三点交论文\n/)
    expect(read(run, '写作/计划.md')).not.toContain('📅')
  } finally {
    await run.close()
  }
})

test('打 @ 弹选择器：方向键挪到明天、回车选定，@ 拿掉；⌥⌘T 再弹，选钟点、提醒；点日子小块弹，清掉', async () => {
  const run = await launch({ '写作/计划.md': PLAN })
  const { page } = run
  try {
    await openNote(page, '计划')
    await newTask(page)
    await page.keyboard.type('交周报 @')
    await expect(picker(page)).toBeVisible()
    // 光标还在编辑器里（键盘打开的：底下一行说键怎么用）
    await expect(picker(page)).toContainText('方向键挑一天')
    await expect(picker(page).locator('.cal-mini-g .kf')).toHaveText(String(Number(T0.slice(8))))
    await page.screenshot({ path: 'test-results/pd289-picker-at.png' })
    await page.keyboard.press('ArrowRight')
    await expect(picker(page).locator('.cal-mini-g .kf')).toHaveText(String(Number(T1.slice(8))))
    await page.keyboard.press('Enter')
    await expect(picker(page)).toHaveCount(0)
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/计划.md')).toContain(`- [ ] 交周报 📅 ${T1}\n`)
    await expect(toast(page)).toContainText('「交周报」改到明天')

    // ⌥⌘T：同一行再弹；钟点、提醒下拉，选了马上写
    await page.keyboard.press('Alt+Meta+KeyT')
    await expect(picker(page)).toBeVisible()
    await picker(page).getByRole('combobox', { name: '钟点' }).selectOption('09:00')
    await picker(page).getByRole('combobox', { name: '提醒' }).selectOption('提前1小时')
    await expect.poll(() => read(run, '写作/计划.md'), { timeout: 5000 }).toMatch(new RegExp(`- \\[ \\] 交周报 📅 ${T1} 09:00 🔔 提前1小时 🆔 [a-z0-9]{6}\\n`))
    await page.keyboard.press('Escape')
    await expect(picker(page)).toHaveCount(0)
    await expect(toast(page)).toContainText('「交周报」改到明天 09:00 · 🔔 提前1小时')

    // 点日子小块：弹，「清掉」拿掉日子、钟点、提醒（🆔 留着）
    await line(page, '最后一段').click()
    await line(page, '交周报').locator('.cm-tdchip').click()
    await expect(picker(page)).toBeVisible()
    await expect(picker(page).locator('.cal-mini-g .on')).toHaveText(String(Number(T1.slice(8))))
    await picker(page).getByRole('button', { name: '清掉' }).click()
    await expect(picker(page)).toHaveCount(0)
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/计划.md')).toMatch(/- \[ \] 交周报 🆔 [a-z0-9]{6}\n/)
    await expect(toast(page)).toContainText('「交周报」拿掉了日子')

    // 悬停「定日子」弹：点小月历上的一天，不关；点外面关上
    const plain = line(page, '写提纲')
    await plain.hover()
    await plain.getByRole('button', { name: '定日子' }).click()
    await expect(picker(page)).toBeVisible()
    await picker(page).locator(`.cal-mini-g button[data-day="${T1}"]`).click()
    await expect(picker(page)).toBeVisible()
    await expect.poll(() => read(run, '写作/计划.md')).toContain(`- [ ] 写提纲 📅 ${T1}\n`)
    await line(page, '最后一段').click()
    await expect(picker(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('本地认不出的问 AI（假 AI）：「圣诞节前买礼物」出带标志的灰字，Tab 收下；只送这一行，用的是 Haiku', async () => {
  const log = join(mkdtempSync(join(tmpdir(), 'cn-pd289-')), 'when.log')
  const run = await launch({ '写作/计划.md': PLAN }, { CN_AI_FAKE: '1', CN_FAKE_WHEN_LOG: log })
  const { page } = run
  try {
    await openNote(page, '计划')
    await newTask(page)
    await page.keyboard.type('圣诞节前买礼物')
    // 先是一个淡的「…」，答回来了出预览
    await expect(ed(page).locator('.cm-when-ghost.wait')).toBeVisible({ timeout: 3000 })
    await expect(ghost(page)).toBeVisible({ timeout: 5000 })
    await expect(ghost(page)).toContainText(`📅 ${XMAS}`)
    await expect(ghost(page).locator('.cm-when-logo svg')).toBeVisible()
    await expect(ed(page).locator('.cm-when-cut')).toHaveText(['圣诞节前'])
    await page.screenshot({ path: 'test-results/pd289-ghost-ai.png' })
    await page.keyboard.press('Tab')
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/计划.md')).toContain(`- [ ] 买礼物 📅 ${XMAS}\n`)
    const asked = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { text: string; engine: string; model: string })
    expect(asked).toEqual([{ text: '圣诞节前买礼物', now: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), engine: 'claude', model: 'haiku' }])
    // 认不出的说法：问过一次，什么都不出
    await page.keyboard.press('Enter')
    await page.keyboard.type('写一篇周报 提醒自己')
    await page.waitForTimeout(2000)
    await expect(ghost(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('白板卡里：双击卡改字，打「明天下午三点交论文」出灰字，Tab 收下；打 @ 弹选择器', async () => {
  const doc = '# 小论文\n\n## 这周\n\n- [ ] 写提纲\n'
  const run = await launch({ '写作/小论文.md': doc })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '小论文')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    const card = board.locator('.db-card', { hasText: '写提纲' }).first()
    // 双击待办卡头上「待办 0/1」那一行（双击勾选框是勾掉）
    await card.getByText(/^待办/).first().dblclick()
    const box = card.getByRole('textbox', { name: '卡片内容' })
    await expect(box).toBeFocused()
    await page.keyboard.press('Enter')
    await page.keyboard.type('明天下午三点交论文')
    await expect(card.getByTestId('when-ghost')).toBeVisible({ timeout: 3000 })
    await page.screenshot({ path: 'test-results/pd289-card-ghost.png' })
    await page.keyboard.press('Tab')
    await expect(card.getByTestId('when-ghost')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await page.keyboard.type('交周报 @')
    await expect(picker(page)).toBeVisible()
    await picker(page).getByRole('menuitem', { name: /^今天/ }).click()
    await expect(picker(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await waitSaved(page)
    await expect.poll(() => read(run, '写作/小论文.md')).toBe(`# 小论文\n\n## 这周\n\n- [ ] 写提纲\n- [ ] 交论文 📅 ${T1} 15:00\n- [ ] 交周报 📅 ${T0}\n`)
  } finally {
    await run.close()
  }
})

test('待办首页加一条：打 @ 选明天，插进输入框，回车加进收件箱；AI 认出来的写在下面那一行，回车照它加；点日子小块弹选择器改钟点', async () => {
  const run = await launch({ '写作/计划.md': PLAN }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '待办', exact: true }).click()
    const home = pane(page).getByTestId('todo-home')
    await expect(home).toBeVisible()
    const input = home.getByRole('textbox', { name: '待办首页加一条' })
    await input.click()
    await page.keyboard.type('交论文 @')
    await expect(picker(page)).toBeVisible()
    await picker(page).getByRole('menuitem', { name: /^明天/ }).click()
    await expect(picker(page)).toHaveCount(0)
    await expect(input).toHaveValue('交论文 明天')
    await expect(input).toBeFocused()
    await expect(home.getByTestId('td-hint')).toContainText('认出来：明天')
    await page.keyboard.press('Enter')
    await expect(input).toHaveValue('')
    await expect.poll(() => read(run, '收件箱/待办.md')).toContain(`- [ ] 交论文 📅 ${T1}\n`)

    // AI：本地认不出的，停手问，下面那一行写「AI 认出来」
    await page.keyboard.type('圣诞节前买礼物')
    await expect(home.getByTestId('td-hint')).toContainText('AI 认出来：', { timeout: 5000 })
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run, '收件箱/待办.md')).toContain(`- [ ] 买礼物 📅 ${XMAS}\n`)

    // 一条的日子小块：点了弹选择器，改钟点马上写进那一行
    const row = home.locator('.td-r', { has: page.locator('.td-t', { hasText: /^交论文$/ }) })
    await row.locator('.td-chip').click()
    await expect(picker(page)).toBeVisible()
    await picker(page).getByRole('combobox', { name: '钟点' }).selectOption('15:00')
    await expect.poll(() => read(run, '收件箱/待办.md')).toContain(`- [ ] 交论文 📅 ${T1} 15:00\n`)
    await page.keyboard.press('Escape')
    await expect(picker(page)).toHaveCount(0)
    await expect(toast(page)).toContainText('「交论文」改到明天 15:00')

    // 点一条开详情小卡：日期那一排最后「其他…」弹选择器；小卡开着时按 ⌥⌘T 也弹
    await row.locator('.td-t').click()
    const pop = page.getByRole('dialog', { name: '详情' })
    await expect(pop).toBeVisible()
    await pop.getByRole('button', { name: '定日子和时间…' }).click()
    await expect(picker(page)).toBeVisible()
    await picker(page).getByRole('combobox', { name: '重复' }).selectOption({ label: '工作日' })
    await expect.poll(() => read(run, '收件箱/待办.md')).toContain(`- [ ] 交论文 📅 ${T1} 15:00 🔁 工作日\n`)
    await page.keyboard.press('Escape')
    await expect(picker(page)).toHaveCount(0)
    await expect(pop).toBeVisible()
    await page.keyboard.press('Alt+Meta+KeyT')
    await expect(picker(page)).toBeVisible()
    await picker(page).getByRole('button', { name: '清掉' }).click()
    await expect.poll(() => read(run, '收件箱/待办.md')).toContain('- [ ] 交论文\n')
  } finally {
    await run.close()
  }
})

/** 选择器的样子：天青（浅）和深湖（深）各一张，给 designer 复审 */
test('截图：文档里的灰字、选择器（天青、深湖）', async () => {
  const run = await launch({ '写作/计划.md': PLAN })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '计划')
    await newTask(page)
    await page.keyboard.type('下周一前交报告 提前一天提醒')
    await expect(ghost(page)).toBeVisible({ timeout: 3000 })
    await page.screenshot({ path: 'test-results/pd289-ghost-sky.png' })
    await page.keyboard.press('Tab')
    await page.keyboard.press('Alt+Meta+KeyT')
    await expect(picker(page)).toBeVisible()
    await page.screenshot({ path: 'test-results/pd289-picker-sky.png' })
  } finally {
    await run.close()
  }
})

