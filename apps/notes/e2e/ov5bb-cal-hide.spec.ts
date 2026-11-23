/**
 * 「日历」格的系统日历「不在这里显示」（task-ov5bb，用户「这里的系统日历能不能选择右键不显示?」）：
 * 假日历（画布今日的小助手 --memory）多一个「提醒事项」（系统把排了时间的提醒画成日程，和待办重复）。
 * 真点：左栏右键 → 不在这里显示 → 周、全天、月、小月历的点都没了；点色块藏起 / 显示；右键「在这里显示」「全部显示」；
 * 重开软件还记得；画布今日那边改了共用的 calendars.json 这边几秒内跟上；两个软件一起开着时一边藏另一边跟着（画布今日编好了才跑）。
 * 无头（CN_E2E=1 / CT_E2E=1）、临时库、临时设置目录。
 */
import { _electron as electron, expect, type Page, test } from '@playwright/test'
import electronPath from 'electron'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, type Running } from './app'
import { armMenus, openedMenu, pickMenu } from './menu'

const HELPER = join(__dirname, '../../today/native/reminders/.build/apple/Products/Release/canvas-today-reminders')
const TODAY_MAIN = join(__dirname, '../../today/out/main/index.js')
test.skip(!existsSync(HELPER), '先编画布今日的小助手：node apps/today/scripts/build-helper.mjs')

const pad = (n: number) => String(n).padStart(2, '0')
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const [T0, T1, T2] = [day(0), day(1), day(2)]
/** 小月历上只有提醒的那一天（和今天同一个月，没有待办） */
const ONLY_REM = day(3).slice(0, 7) === T0.slice(0, 7) ? day(3) : day(-3)

const INBOX = `# 待办\n\n- [ ] 回导师邮件 📅 ${T0} 10:30\n- [ ] 取快递 📅 ${T0}\n`
const PLAN = `# 小论文计划\n\n- [ ] 交论文初稿 📅 ${T1} 15:00 🔔 提前1小时\n`
const VAULT = { '收件箱/待办.md': INBOX, '写作/小论文计划.md': PLAN }

const SEED = {
  auth: 'full',
  calAuth: 'full',
  lists: [{ id: 'L-ct', title: '画布今日', icloud: true, color: '#F0883E' }],
  calendars: [
    { id: 'C-rem', title: '提醒事项', color: '#FF3B30', source: 'iCloud' },
    { id: 'C-work', title: '工作', color: '#4F7CAC', source: 'iCloud' },
    { id: 'C-home', title: '家里', color: '#B0805A', source: 'iCloud' },
  ],
  events: [
    { id: 'ev-1', title: '和爸妈视频', calendar: 'C-home', allDay: false, start: `${T0}T16:00`, end: `${T0}T17:00` },
    { id: 'ev-2', title: '组会', calendar: 'C-work', allDay: false, start: `${T1}T09:30`, end: `${T1}T10:30` },
    { id: 'r-1', title: '回导师邮件', calendar: 'C-rem', allDay: false, start: `${T0}T10:30`, end: `${T0}T11:30` },
    { id: 'r-2', title: '交实验报告', calendar: 'C-rem', allDay: false, start: `${T2}T13:00`, end: `${T2}T14:00` },
    { id: 'r-3', title: '续签证材料', calendar: 'C-rem', allDay: true, start: T2, end: T2 },
    { id: 'r-4', title: '买牛奶', calendar: 'C-rem', allDay: false, start: `${ONLY_REM}T18:00`, end: `${ONLY_REM}T18:30` },
  ],
}

const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const side = (page: Page) => page.locator('aside.side[aria-label="日历"]')
const calp = (page: Page) => page.locator('.pane.calp:not([hidden])')
const row = (page: Page, name: string) => side(page).locator('[data-part="系统日历"] .calside-row', { hasText: name })
const ev = (page: Page, title: string) => calp(page).locator('.cal-blk.ev', { hasText: title })
const mini = (page: Page, d: string) => side(page).locator('.cal-mini-g button', { hasText: new RegExp(`^${Number(d.slice(8))}$`) })

async function start(env: Record<string, string> = {}): Promise<Running & { memFile: string; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'cn-calhide-'))
  const memFile = join(dir, 'cal-mem.json')
  writeFileSync(memFile, JSON.stringify(SEED))
  const run = await launch(VAULT, { CN_CAL_HELPER: HELPER, CN_CAL_MEMORY: memFile, ...env })
  const close = run.close.bind(run)
  return Object.assign(run, { memFile, dir, close: async (o?: { keep?: boolean }) => (await close(o), rmSync(dir, { recursive: true, force: true })) })
}

/** 点图标栏「日历」：左栏换成它、中间开整页日历（重开时左栏已经是它：先点一下收起，再点打开） */
async function openCal(page: Page) {
  const b = bar(page).getByRole('button', { name: '日历', exact: true })
  if ((await b.getAttribute('aria-pressed')) === 'true') await b.click()
  await b.click()
  await expect(calp(page)).toBeVisible()
  await expect(row(page, '提醒事项')).toBeVisible()
}

test('右键「不在这里显示」：周、全天、月、小月历里那个日历都没了；点色块切换；右键「在这里显示」「全部显示」；重开还记得；画布今日那边改了跟上', async () => {
  const run = await start()
  const shared = join(run.userData, 'calendars.json')
  let again: Running | null = null
  let firstClosed = false
  try {
    const { page } = run
    await openCal(page)
    await expect(side(page).locator('.calside-row .nm')).toHaveText(['提醒事项', '工作', '家里', '画布今日'])
    // 改前：提醒的粉块和待办重复
    await expect(ev(page, '回导师邮件')).toBeVisible()
    await expect(calp(page).locator(`[data-drop="allday:${T2}"] .cal-chip.ev`)).toHaveText('续签证材料')
    await expect(mini(page, ONLY_REM)).toHaveClass(/has/)

    await armMenus(run)
    await row(page, '提醒事项').click({ button: 'right' })
    expect((await openedMenu(run)).map((i) => i.label)).toEqual(['不在这里显示'])
    await pickMenu(run, '不在这里显示')
    await expect(row(page, '提醒事项')).toHaveClass(/off/)
    await expect(row(page, '提醒事项').locator('.calsw')).toHaveAttribute('aria-pressed', 'false')
    // 周：提醒没了，待办自己的块、别的日历还在
    await expect(ev(page, '回导师邮件')).toHaveCount(0)
    await expect(ev(page, '交实验报告')).toHaveCount(0)
    await expect(calp(page).locator('.cal-blk:not(.ev)', { hasText: '回导师邮件' })).toBeVisible()
    await expect(ev(page, '和爸妈视频')).toBeVisible()
    await expect(calp(page).locator(`[data-drop="allday:${T2}"] .cal-chip.ev`)).toHaveCount(0)
    await expect(mini(page, ONLY_REM)).not.toHaveClass(/has/)
    expect(JSON.parse(readFileSync(shared, 'utf8'))).toEqual({ hidden: [{ id: 'C-rem', title: '提醒事项', source: 'iCloud' }] })
    // 月
    await calp(page).getByRole('tab', { name: '月' }).click()
    await expect(calp(page).locator('.cal-mcell .cal-chip.ev', { hasText: '组会' })).toBeVisible()
    await expect(calp(page).locator('.cal-mcell .cal-chip.ev', { hasText: '交实验报告' })).toHaveCount(0)
    await calp(page).getByRole('tab', { name: '周' }).click()

    // 点「家里」的色块藏起；右键它：在这里显示 · 全部显示
    await row(page, '家里').locator('.calsw').click()
    await expect(row(page, '家里')).toHaveClass(/off/)
    await expect(ev(page, '和爸妈视频')).toHaveCount(0)
    await row(page, '家里').click({ button: 'right' })
    expect((await openedMenu(run)).map((i) => i.label)).toEqual(['在这里显示', '—', '全部显示'])
    await pickMenu(run, '在这里显示')
    await expect(ev(page, '和爸妈视频')).toBeVisible()
    // 点「提醒事项」的色块：回来了
    await row(page, '提醒事项').locator('.calsw').click()
    await expect(row(page, '提醒事项')).not.toHaveClass(/off/)
    await expect(ev(page, '回导师邮件')).toBeVisible()
    await expect(mini(page, ONLY_REM)).toHaveClass(/has/)
    // 藏两个，右键「全部显示」
    await row(page, '提醒事项').locator('.calsw').click()
    await row(page, '工作').locator('.calsw').click()
    await expect(ev(page, '组会')).toHaveCount(0)
    await row(page, '家里').click({ button: 'right' })
    await pickMenu(run, '全部显示')
    await expect(side(page).locator('.calside-row.off')).toHaveCount(0)
    await expect(ev(page, '组会')).toBeVisible()
    await expect(ev(page, '回导师邮件')).toBeVisible()

    // 藏起「提醒事项」，退出、用同一个设置目录重开：还记得
    await row(page, '提醒事项').locator('.calsw').click()
    await expect(ev(page, '回导师邮件')).toHaveCount(0)
    await run.close({ keep: true })
    firstClosed = true
    // 假日历的文件跟着第一次的临时目录删了：同样的种子再写一份（日历的 id 一样）
    mkdirSync(run.dir, { recursive: true })
    writeFileSync(run.memFile, JSON.stringify(SEED))
    again = await launch(VAULT, { CN_CAL_HELPER: HELPER, CN_CAL_MEMORY: run.memFile, CN_USER_DATA: run.userData })
    const p2 = again.page
    await openCal(p2)
    await expect(row(p2, '提醒事项')).toHaveClass(/off/)
    await expect(ev(p2, '组会')).toBeVisible()
    await expect(ev(p2, '回导师邮件')).toHaveCount(0)
    // 画布今日那边显示了（写同一份文件）：几秒内跟上
    writeFileSync(shared, JSON.stringify({ hidden: [] }))
    await expect(row(p2, '提醒事项')).not.toHaveClass(/off/, { timeout: 5000 })
    await expect(ev(p2, '回导师邮件')).toBeVisible()
    // 别的 id（日历重建过）：认名字 + 来源
    writeFileSync(shared, JSON.stringify({ hidden: [{ id: 'SOME-OTHER-ID', title: '提醒事项', source: 'iCloud' }] }))
    await expect(row(p2, '提醒事项')).toHaveClass(/off/, { timeout: 5000 })
    await expect(ev(p2, '回导师邮件')).toHaveCount(0)
  } finally {
    if (again) await again.close()
    else if (!firstClosed) await run.close({ keep: true })
    rmSync(join(run.userData, '..'), { recursive: true, force: true })
    rmSync(run.dir, { recursive: true, force: true })
  }
})

test('英文界面：右键菜单、色块的提示', async () => {
  const run = await start({ CN_LANG: 'en' })
  try {
    const { page } = run
    await page.getByRole('navigation', { name: 'Left sidebar' }).getByRole('button', { name: 'Calendar', exact: true }).click()
    const r = page.locator('aside.side[aria-label="Calendar"] .calside-row', { hasText: '提醒事项' })
    await expect(r.locator('.calsw')).toHaveAttribute('aria-label', 'Hide “提醒事项” here and in Canvas Today · or right-click')
    await armMenus(run)
    await r.click({ button: 'right' })
    expect((await openedMenu(run)).map((i) => i.label)).toEqual(['Hide Here'])
    await pickMenu(run, 'Hide Here')
    await expect(r.locator('.calsw')).toHaveAttribute('aria-label', 'Show “提醒事项” here')
    await r.click({ button: 'right' })
    expect((await openedMenu(run)).map((i) => i.label)).toEqual(['Show Here', '—', 'Show All'])
    await pickMenu(run, 'Show All')
    await expect(r).not.toHaveClass(/off/)
  } finally {
    await run.close()
  }
})

/** 两个软件一起开着（同一个设置目录：画布今日的 CT_NOTES_DATA 指向画布笔记的设置目录）：一边藏起，另一边跟着 */
test('两个软件一起开：画布笔记里藏起「提醒事项」，画布今日几秒内也不画；画布今日里再显示，画布笔记跟着', async () => {
  test.skip(!existsSync(TODAY_MAIN), '先构建画布今日：cd apps/today && pnpm exec electron-vite build')
  const run = await start()
  const ctRoot = mkdtempSync(join(tmpdir(), 'ct-with-cn-'))
  const ctData = join(ctRoot, 'user-data')
  mkdirSync(ctData)
  writeFileSync(join(ctData, 'settings.json'), JSON.stringify({ lang: 'zh', followNotes: false, appearance: { followSystem: false, skin: 'sky', day: 'sky', night: 'petrol', frame: 'b', winBg: 'aurora' }, calendar: { show: true } }))
  const ctMem = join(ctRoot, 'cal-mem.json')
  writeFileSync(ctMem, JSON.stringify(SEED))
  const ct = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [TODAY_MAIN],
    env: { ...process.env, CT_E2E: '1', CT_VAULT: run.vault, CT_USER_DATA: ctData, CT_NOTES_DATA: run.userData, CT_DEVICE: 'mac-test', CT_REMINDERS_HELPER: HELPER, CT_REMINDERS_MEMORY: ctMem },
  })
  try {
    const cp = await ct.firstWindow()
    await cp.setViewportSize({ width: 1420, height: 799 })
    await cp.locator('.ab[data-k="calendar"]').click()
    const ctRow = (name: string) => cp.locator('[data-part="系统日历"] .calrow', { hasText: name })
    const ctEv = (title: string) => cp.locator('.cal-blk.ev', { hasText: title })
    await expect(ctEv('回导师邮件')).toBeVisible()
    // 画布笔记里右键藏起
    const { page } = run
    await openCal(page)
    await armMenus(run)
    await row(page, '提醒事项').click({ button: 'right' })
    await pickMenu(run, '不在这里显示')
    await expect(ev(page, '回导师邮件')).toHaveCount(0)
    // 画布今日跟着（不用重启）
    await expect(ctRow('提醒事项')).toHaveClass(/off/, { timeout: 5000 })
    await expect(ctEv('回导师邮件')).toHaveCount(0)
    await expect(ctEv('和爸妈视频')).toBeVisible()
    // 画布今日里点色块再显示：画布笔记跟着
    await ctRow('提醒事项').locator('.calsw').click()
    await expect(ctEv('回导师邮件')).toBeVisible()
    await expect(row(page, '提醒事项')).not.toHaveClass(/off/, { timeout: 5000 })
    await expect(ev(page, '回导师邮件')).toBeVisible()
  } finally {
    await ct.close()
    await run.close()
    rmSync(ctRoot, { recursive: true, force: true })
  }
})
