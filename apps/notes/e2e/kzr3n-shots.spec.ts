/**
 * 待办首页、日历格、文档里的待办的对照截图（task-kzr3n）：和原型同一份数据、同一个状态，天青 / 深湖 × A / B 各一套。
 * 待办首页那几张照 18-待办首页/proto-a.html 的数据（日子跟着今天走），文档那张照画布今日 v2 原型「小论文计划」那一篇。
 * 只在给了 CN_SHOTS（目录）时跑；窗口内容 1440×887（原型的大小）。真点、真拖、真悬停。
 */
import { expect, type Page, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, pane, type Running, tabOn } from './app'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')

const pad = (n: number) => String(n).padStart(2, '0')
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const D = (n: number) => day(n)

/** 18-待办首页 原型的那几条（原型的今天是 2026-11-22，这里跟着今天走） */
const HOME: Record<string, string> = {
  '收件箱/待办.md': `# 待办\n\n- [ ] 交 ecp 作业 2 📅 ${D(-1)} 23:59 🔔 准时 ⏫\n- [ ] 回导师邮件 📅 ${D(0)} 10:30\n- [ ] 取快递 📅 ${D(0)} 18:00 🔔 提前30分钟\n- [ ] 订冰岛租车 📅 ${D(1)} 20:00 🔔 准时\n- [ ] 买打印纸\n- [x] 买咖啡豆 📅 ${D(0)} ✅ ${D(0)}\n`,
  '写作/小论文计划.md': `# 小论文计划\n\n- [ ] 读完三篇相关论文 📅 ${D(0)}\n- [ ] 交论文初稿 📅 ${D(1)} 15:00 🔔 提前1小时 ⏫\n`,
  '写作/待办.md': `# 待办\n\n- [ ] 改第二章的开头 📅 ${D(2)}\n- [ ] 给编辑发邮件 📅 ${D(3)} 10:00\n- [ ] 写《斯通纳》书评 📅 ${D(10)}\n- [ ] 定专栏下期题目\n- [x] 写完第一章 📅 ${D(-1)} ✅ ${D(-1)}\n`,
  '课程/ecp/第5讲笔记.md': `# 第5讲笔记\n\n- [ ] 看第 4 讲回放 📅 ${D(-3)}\n- [ ] 复习神经元结构图 📅 ${D(0)} 11:00\n- [ ] 做第 6 讲练习 📅 ${D(4)}\n- [ ] 期中复习提纲 📅 ${D(16)}\n- [x] 交第 4 讲作业 📅 ${D(-2)} ✅ ${D(-2)}\n`,
  '项目/冰岛旅行.md': `# 冰岛旅行\n\n- [ ] 订 Vík 的住处 📅 ${D(3)}\n- [ ] 查极光预报网站 📅 ${D(13)}\n`,
  '生活/待办.md': `# 待办\n\n- [ ] 体检预约 📅 ${D(5)}\n- [ ] 交房租 📅 ${D(6)} 09:00 🔔 准时 🔁 每月28日\n- [ ] 换冬季轮胎\n`,
}

/** 画布今日 v2 原型里「小论文计划」那一篇 */
const DOC: Record<string, string> = {
  '写作/小论文计划.md': `# 小论文计划\n\n截稿前把实验和初稿弄完，周五交给导师。\n\n## 这周\n\n- [ ] 读完三篇相关论文 📅 ${D(0)} 🔼\n    - [x] Attention Is All You Need\n    - [ ] BERT\n    - [ ] ViT\n- [ ] 交论文初稿 📅 ${D(1)} 15:00 🔔 提前1小时 ⏫\n- [x] 和导师约时间\n\n## 下周\n\n- [ ] 补实验图 📅 ${D(3)} 🔼\n- [ ] 改摘要\n`,
  '收件箱/待办.md': `# 待办\n\n- [ ] 回导师邮件 🔽\n- [ ] 买打印纸\n- [ ] 看《杀死一只知更鸟》第二章\n- [ ] 取快递 📅 ${D(0)}\n- [ ] 给猫买粮\n`,
  '课程/ecp/Lecture05 笔记.md': `# Lecture05 笔记\n\n- [ ] 复习 Lecture05 的神经元结构图 📅 ${D(0)} 11:00\n- [ ] 交 ecp 作业 2 📅 ${D(-1)} 23:59 ⏫\n`,
  '周记/2026-W47.md': `# 第47周\n\n- [ ] 整理这周的读书笔记 📅 ${D(0)} 🔁 每周日\n`,
  '生活/冰岛行程.md': `# 冰岛行程\n\n- [ ] 订冰岛租车 📅 ${D(2)} 20:00 🔔 准时\n`,
}

const LOOKS = [
  ['sky', 'b'],
  ['petrol', 'b'],
  ['sky', 'a'],
  ['petrol', 'a'],
] as const

const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const home = (page: Page) => pane(page).getByTestId('todo-home')
const side = (page: Page) => page.locator('aside.side[aria-label="待办"]')
const row = (scope: ReturnType<typeof home>, title: string) => scope.locator('.td-r').filter({ has: scope.page().locator('.td-t', { hasText: new RegExp(`^${title}$`) }) }).first()

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

/** v2 原型连上系统日历时的那几个日程（日子跟着今天走），画布今日的小助手 --memory 的假日历 */
const CAL = {
  auth: 'full',
  calAuth: 'full',
  lists: [{ id: 'L-ct', title: '画布今日', icloud: true, color: '#C0703A' }],
  calendars: [
    { id: 'C-work', title: '工作', color: '#4F7CAC', source: 'iCloud' },
    { id: 'C-home', title: '家里', color: '#B0805A', source: 'iCloud' },
    { id: 'C-class', title: '课程表', color: '#7C6FAE', source: 'iCloud' },
  ],
  events: [
    { id: 'e1', title: '和爸妈视频', calendar: 'C-home', allDay: false, start: `${D(0)}T16:00`, end: `${D(0)}T17:00` },
    { id: 'e2', title: '组会', calendar: 'C-work', allDay: false, start: `${D(1)}T09:30`, end: `${D(1)}T10:30` },
    { id: 'e3', title: 'ecp 课', calendar: 'C-class', allDay: false, start: `${D(2)}T14:00`, end: `${D(2)}T15:30` },
    { id: 'e4', title: '和小林吃饭', calendar: 'C-home', allDay: false, start: `${D(3)}T19:00`, end: `${D(3)}T20:00` },
    { id: 'e5', title: '牙医', calendar: 'C-home', allDay: false, start: `${D(5)}T10:00`, end: `${D(5)}T11:00` },
    { id: 'e6', title: '交房租', calendar: 'C-home', allDay: true, start: D(1), end: D(1) },
  ],
}
const HELPER = join(__dirname, '../../today/native/reminders/.build/apple/Products/Release/canvas-today-reminders')

async function start(files: Record<string, string>, skin: string, frame: string, env: Record<string, string> = {}): Promise<Running> {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(files, { CN_TODAY_INSTALLED: '1', ...env }, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame, winBg: 'aurora' } }))
  })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(887)
  return run
}

for (const [skin, frame] of LOOKS) {
  const tag = `${skin}-${frame}`
  test(`待办首页对照图：${tag}`, async () => {
    const run = await start(HOME, skin, frame)
    const { page } = run
    try {
      // ① 点「待办」格：周
      await bar(page).getByRole('button', { name: '待办', exact: true }).click()
      await expect(tabOn(page)).toHaveText('待办')
      await expect(home(page).locator('.tdh-wc')).toHaveCount(7)
      await shot(run, `1-week-${tag}`)
      // ③ 点一天（今天 +3，原型的 11月25日）
      await home(page).locator(`[data-day="${D(3)}"]`).click()
      await expect(home(page).locator('[data-part="日期筛选"]')).toBeVisible()
      await shot(run, `3-day-${tag}`)
      await page.keyboard.press('Escape')
      await expect(home(page).locator('[data-part="日期筛选"]')).toHaveCount(0)
      // ④ 左栏点一条：小卡 + 中间这一条亮着
      await side(page).locator('.td-r').filter({ hasText: '给编辑发邮件' }).first().click()
      await expect(page.getByRole('dialog', { name: '详情' })).toBeVisible()
      await shot(run, `4-pop-${tag}`)
      await page.keyboard.press('Escape')
      // ⑤ 拖一条到日历上（拖着、还没松手）
      const from = (await row(home(page), '买打印纸').boundingBox())!
      await home(page).evaluate((el) => el.scrollTo(0, 0))
      const r = (await row(home(page), '回导师邮件').boundingBox())!
      const to = (await home(page).locator(`[data-day="${D(4)}"]`).boundingBox())!
      void from
      await page.mouse.move(r.x + 120, r.y + r.height / 2)
      await page.mouse.down()
      await page.mouse.move(r.x + 130, r.y + r.height / 2 - 6, { steps: 3 })
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
      await expect(home(page).locator(`[data-day="${D(4)}"]`)).toHaveClass(/over/)
      await shot(run, `5-drag-${tag}`)
      await page.mouse.move(to.x - 400, to.y - 400, { steps: 3 })
      await page.mouse.up()
    } finally {
      await run.close()
    }
  })

  test(`文档里的待办对照图：${tag}`, async () => {
    const run = await start(DOC, skin, frame)
    const { page } = run
    try {
      await bar(page).getByRole('button', { name: '待办', exact: true }).click()
      await expect(side(page)).toBeVisible()
      // 左栏点「交论文初稿」，小卡里「打开笔记，到这一行」开小论文计划
      await side(page).locator('.td-r').filter({ hasText: '交论文初稿' }).first().click()
      await page.getByRole('dialog', { name: '详情' }).getByRole('button', { name: '打开笔记，到这一行' }).click()
      await expect(tabOn(page)).toHaveText('小论文计划')
      const ed = pane(page).locator('.cm-content')
      await ed.locator('.cm-line', { hasText: '截稿前' }).click()
      // 「到这一行」那一下的竖线 1.6 秒后淡出，等它过去再截
      await page.waitForTimeout(2200)
      const line = ed.locator('.cm-line', { hasText: '改摘要' })
      await line.hover()
      await expect(line.getByRole('button', { name: '定日子' })).toBeVisible()
      await shot(run, `7-doc-hover-${tag}`)
      await line.getByRole('button', { name: '定日子' }).click()
      await expect(page.getByRole('menu', { name: '定日子和时间' })).toBeVisible()
      await line.hover()
      await shot(run, `8-doc-datepop-${tag}`)
    } finally {
      await run.close()
    }
  })

  test(`日历格对照图：${tag}`, async () => {
    test.skip(!existsSync(HELPER), '先编画布今日的小助手：node apps/today/scripts/build-helper.mjs')
    const dir = mkdtempSync(join(tmpdir(), 'cn-cal-'))
    const mem = join(dir, 'cal-mem.json')
    writeFileSync(mem, JSON.stringify(CAL))
    const run = await start(DOC, skin, frame, { CN_CAL_HELPER: HELPER, CN_CAL_MEMORY: mem })
    const { page } = run
    try {
      await bar(page).getByRole('button', { name: '日历', exact: true }).click()
      await expect(page.locator('aside.side[aria-label="日历"] [data-part="系统日历"]')).toBeVisible()
      await expect(page.locator('.pane.calp:not([hidden]) .cal-blk.ev').first()).toBeVisible()
      await shot(run, `9-calendar-${tag}`)
    } finally {
      await run.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
}
