/**
 * 图标栏「日历」格（task-kzr3n，用户「这个日历需要做, 并且做的和demo一样就行」「日历做到左边」；照画布今日 v2 原型「画布笔记 · 日历」）：
 * 左栏小月历 + 连接系统日历（假日历：画布今日的小助手 --memory，不碰用户真的日历）→ 系统日历带锁、提醒事项「画布今日」两边同步；
 * 中间周看法：日程用它日历的颜色、只读（拖了说只读），待办拖到某天某个钟点只改那一行的 📅；切月；帮我排进空着的时间（假 AI）收下。
 * 一律真点、真拖；无头（CN_E2E=1）、临时库。
 */
import { expect, type Page, test } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, type Running, tabOn } from './app'

const HELPER = join(__dirname, '../../today/native/reminders/.build/apple/Products/Release/canvas-today-reminders')
test.skip(!existsSync(HELPER), '先编画布今日的小助手：node apps/today/scripts/build-helper.mjs')

const pad = (n: number) => String(n).padStart(2, '0')
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const [T0, T1, T2, T3] = [day(0), day(1), day(2), day(3)]

const INBOX = `# 待办\n\n- [ ] 回导师邮件 📅 ${T0} 10:30\n- [ ] 取快递 📅 ${T0}\n- [ ] 买打印纸\n`
const PLAN = `# 小论文计划\n\n- [ ] 交论文初稿 📅 ${T1} 15:00 🔔 提前1小时\n- [ ] 补实验图 📅 ${T1}\n`
const VAULT = { '收件箱/待办.md': INBOX, '写作/小论文计划.md': PLAN }

/** 假日历（画布今日 e2e 的 CAL_SEED，日子跟着今天走）+ 提醒事项里画布今日镜像的那个列表 */
const SEED = {
  auth: 'full',
  lists: [{ id: 'L-ct', title: '画布今日', icloud: true, color: '#F0883E' }],
  calendars: [
    { id: 'C-work', title: '工作', color: '#4F7CAC', source: 'iCloud' },
    { id: 'C-home', title: '家里', color: '#B0805A', source: 'iCloud' },
    { id: 'C-class', title: '课程表', color: '#7C6FAE', source: 'iCloud' },
  ],
  events: [
    { id: 'ev-1', title: '和爸妈视频', calendar: 'C-home', allDay: false, start: `${T0}T16:00`, end: `${T0}T17:00` },
    { id: 'ev-2', title: '组会', calendar: 'C-work', allDay: false, start: `${T1}T09:30`, end: `${T1}T10:30` },
    { id: 'ev-3', title: '交房租', calendar: 'C-home', allDay: true, start: T1, end: T1 },
  ],
}

const read = (run: Running, p: string) => readFileSync(join(run.vault, p), 'utf8')
const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const side = (page: Page) => page.locator('aside.side[aria-label="日历"]')
const calp = (page: Page) => page.locator('.pane.calp:not([hidden])')
const toast = (page: Page) => page.getByTestId('toast')

/** 测试模式只认 --memory 的假日历（文件在临时目录里，跑完删掉） */
async function start(seed: object = SEED, env: Record<string, string> = {}): Promise<Running & { memFile: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'cn-cal-'))
  const memFile = join(dir, 'cal-mem.json')
  writeFileSync(memFile, JSON.stringify(seed))
  const run = await launch(VAULT, { CN_CAL_HELPER: HELPER, CN_CAL_MEMORY: memFile, CN_AI_FAKE: '1', CT_AI_FAKE_MS: '300', ...env })
  const close = run.close.bind(run)
  return Object.assign(run, { memFile, close: async (o?: { keep?: boolean }) => (await close(o), rmSync(dir, { recursive: true, force: true })) })
}

test('「日历」格：左栏小月历、连接系统日历（系统问一次）以后列出系统日历和提醒事项；中间周看法画日程（只读）和待办；拖日程说只读，拖待办到某天某个钟点只改那一行', async () => {
  const run = await start()
  const { page } = run
  try {
    await bar(page).getByRole('button', { name: '日历', exact: true }).click()
    await expect(bar(page).getByRole('button', { name: '日历', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(tabOn(page)).toHaveText('日历')
    await expect(calp(page).locator('h1')).toHaveText('日历')
    await expect(side(page).locator('.cal-mini')).toBeVisible()
    // 还没连：连接卡
    const card = side(page).locator('[data-part="连接系统日历"]')
    await expect(card.locator('b')).toHaveText('连接系统日历')
    await expect(calp(page).getByTestId('cal-sub')).toContainText('还没连接系统日历')
    await expect(calp(page).locator('.cal-blk.ev')).toHaveCount(0)
    await card.getByRole('button', { name: '连接系统日历' }).click()
    await expect(toast(page)).toContainText('连上了系统日历')
    const calls = (JSON.parse(readFileSync(run.memFile, 'utf8')) as { calls: string[] }).calls
    expect(calls.filter((c) => c === 'calRequest')).toHaveLength(1)
    // 左栏：系统日历带锁、提醒事项「画布今日」两边同步
    const panel = side(page).locator('[data-part="系统日历"]')
    await expect(panel.locator('.calside-row .nm')).toHaveText(['工作', '家里', '课程表', '画布今日'])
    await expect(panel.locator('.calside-hint')).toHaveText('别的提醒事项列表不收进来。日历里的日程在系统「日历」里改。')
    await expect(calp(page).getByTestId('cal-sub')).toContainText('系统日历的日程只读，待办能拖')
    // 周：日程用它日历的颜色画在那一天、那个钟点；全天的在「全天」那一行
    const video = calp(page).locator(`.cal-col[data-drop="day:${T0}"] .cal-blk.ev`, { hasText: '和爸妈视频' })
    await expect(video).toBeVisible()
    await expect(video.locator('.bm')).toHaveText('16:00 · 家里')
    await expect(calp(page).locator(`[data-drop="allday:${T1}"] .cal-chip.ev`)).toHaveText('交房租')
    await expect(calp(page).locator(`.cal-col[data-drop="day:${T1}"] .cal-blk`, { hasText: '交论文初稿' })).toBeVisible()
    // 拖日程：不动，说只读
    const meet = (await calp(page).locator('.cal-blk.ev', { hasText: '组会' }).boundingBox())!
    const col3 = (await calp(page).locator(`.cal-col[data-drop="day:${T3}"]`).boundingBox())!
    await page.mouse.move(meet.x + meet.width / 2, meet.y + meet.height / 2)
    await page.mouse.down()
    await page.mouse.move(meet.x + meet.width / 2 + 20, meet.y + meet.height / 2 + 10, { steps: 4 })
    await page.mouse.move(col3.x + col3.width / 2, meet.y + 80, { steps: 10 })
    await page.mouse.up()
    await expect(toast(page)).toContainText('系统日历里的日程是只读的')
    // 拖待办「交论文初稿」到 T2 那一列、和它一样高（15:00）：只改日子，钟点照指到的写
    const blk = calp(page).locator(`.cal-col[data-drop="day:${T1}"] .cal-blk`, { hasText: '交论文初稿' })
    const b = (await blk.boundingBox())!
    const col2 = (await calp(page).locator(`.cal-col[data-drop="day:${T2}"]`).boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + 6)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2 + 10, b.y + 12, { steps: 4 })
    await page.mouse.move(col2.x + col2.width / 2, b.y + 6, { steps: 10 })
    // 落点虚线框写钟点到几点（@cn/calendar drag.ts，没估时按一小时）
    await expect(calp(page).locator('.cal-slot')).toHaveText('15:00–16:00')
    await page.mouse.up()
    await expect.poll(() => read(run, '写作/小论文计划.md')).toBe(PLAN.replace(`📅 ${T1} 15:00`, `📅 ${T2} 15:00`))
    await expect(toast(page)).toContainText('「交论文初稿」改到')
    // 点一条：弹详情小卡
    await calp(page).locator(`.cal-col[data-drop="day:${T2}"] .cal-blk`, { hasText: '交论文初稿' }).click()
    await expect(page.getByRole('dialog', { name: '详情' })).toContainText('交论文初稿')
    await page.keyboard.press('Escape')
    // 切月：月看法，日程在格子里
    await calp(page).getByRole('tab', { name: '月' }).click()
    await expect(calp(page).locator(`.cal-mcell[data-drop="mday:${T1}"] .cal-chip.ev`).first()).toBeVisible()
    await calp(page).getByRole('tab', { name: '周' }).click()
  } finally {
    await run.close()
  }
})

test('帮我排进空着的时间（假 AI）：虚线框是排好的样子，收下只往那几行的 📅 后面写钟点，能撤回', async () => {
  const run = await start({ ...SEED, calAuth: 'full' })
  const { page } = run
  try {
    await bar(page).getByRole('button', { name: '日历', exact: true }).click()
    await expect(side(page).locator('[data-part="系统日历"]')).toBeVisible()
    await calp(page).getByRole('button', { name: '帮我排进空着的时间' }).click()
    const ai = calp(page).locator('[data-part="AI 帮忙"]')
    await expect(ai).toContainText('在看这两天的空档')
    await expect(ai).toContainText(/想把\d条排进空着的时间/)
    await expect(ai).toContainText('避开了系统日历里的日程')
    await expect(calp(page).locator('.cal-blk.ghost').first()).toBeVisible()
    await ai.getByRole('button', { name: '收下' }).click()
    await expect(ai).toHaveCount(0)
    // 补实验图（明天、没钟点）写上了钟点，别的字不动；取快递（今天、没钟点）晚上九点以后排不进今天
    await expect.poll(() => read(run, '写作/小论文计划.md')).toMatch(new RegExp(`^# 小论文计划\\n\\n- \\[ \\] 交论文初稿 📅 ${T1} 15:00 🔔 提前1小时\\n- \\[ \\] 补实验图 📅 ${T1} \\d{2}:\\d{2}\\n$`))
    await expect(toast(page)).toContainText(/排好了\d条/)
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(run, '写作/小论文计划.md')).toBe(PLAN)
    await expect.poll(() => read(run, '收件箱/待办.md')).toBe(INBOX)
  } finally {
    await run.close()
  }
})

/**
 * 真的 Claude Code（CN_REAL_AI=1 才跑）：去掉继承来的 CLAUDE_* 环境变量，CT_AI_MODEL=sonnet CT_AI_EFFORT=low；
 * 问一次、不给工具、不留会话记录（--no-session-persistence）
 */
test('真的 Claude Code：帮我排进空着的时间，收下写进笔记', async () => {
  test.skip(process.env.CN_REAL_AI !== '1', '真 AI：CN_REAL_AI=1 才跑')
  test.setTimeout(300_000)
  const run = await start({ ...SEED, calAuth: 'full' }, { CN_AI_FAKE: '0' })
  const { page } = run
  try {
    await bar(page).getByRole('button', { name: '日历', exact: true }).click()
    await expect(side(page).locator('[data-part="系统日历"]')).toBeVisible()
    const t0 = Date.now()
    await calp(page).getByRole('button', { name: '帮我排进空着的时间' }).click()
    const ai = calp(page).locator('[data-part="AI 帮忙"]')
    await expect(ai).toContainText(/想把\d条排进空着的时间|排不下|没有还没定钟点/, { timeout: 240_000 })
    console.log(`[真 AI] ${((Date.now() - t0) / 1000).toFixed(1)} 秒：${await ai.textContent()}`)
    if (await ai.getByRole('button', { name: '收下' }).count()) {
      await ai.getByRole('button', { name: '收下' }).click()
      await expect.poll(() => read(run, '写作/小论文计划.md')).toMatch(new RegExp(`补实验图 📅 ${T1} \\d{2}:\\d{2}`))
      console.log('[真 AI] 写进去的：', read(run, '写作/小论文计划.md').split('\n').find((l) => l.includes('补实验图')))
    }
  } finally {
    await run.close()
  }
})
