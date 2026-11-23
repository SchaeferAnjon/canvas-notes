/**
 * 「日历」格系统日历「不在这里显示」的交付截图（task-ov5bb）：CN_SHOTS=<目录> CN_E2E=1 npx playwright test e2e/ov5bb-shots.spec.ts（在 apps/notes 下跑）。
 * 天青 A（浅色、不用图）、天青 B（浮岛、极光背景图）各一套：改前（「提醒事项」日历把提醒画成粉块，和待办重复）、右键菜单开着、改后、改后的月看法。
 * 系统右键菜单是原生的、无头截不到：菜单里的字从真弹出的那个菜单（记录器）读出来，照 macOS 菜单的样子画在右键的地方，截完拿掉，再真点那一项。
 */
import { expect, type Page, test } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, type Running } from './app'
import { armMenus, openedMenu, pickMenu } from './menu'

const DIR = process.env.CN_SHOTS
const HELPER = join(__dirname, '../../today/native/reminders/.build/apple/Products/Release/canvas-today-reminders')
test.skip(!DIR || !existsSync(HELPER), '只在出截图时跑（CN_SHOTS=目录），要先编画布今日的小助手')

const pad = (n: number) => String(n).padStart(2, '0')
const D = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 带钟点、带提醒的待办（镜像进提醒事项以后，系统又把它们画在「提醒事项」日历里） */
const FILES: Record<string, string> = {
  '收件箱/待办.md': `# 待办\n\n- [ ] 回导师邮件 📅 ${D(0)} 10:30 🔔 准时\n- [ ] 取快递 📅 ${D(0)} 18:00 🔔 提前30分钟\n- [ ] 订冰岛租车 📅 ${D(2)} 20:00 🔔 准时\n- [ ] 买打印纸\n`,
  '写作/小论文计划.md': `# 小论文计划\n\n- [ ] 读完三篇相关论文 📅 ${D(0)}\n- [ ] 交论文初稿 📅 ${D(1)} 15:00 🔔 提前1小时 ⏫\n- [ ] 补实验图 📅 ${D(3)}\n`,
  '课程/ecp/第5讲笔记.md': `# 第5讲笔记\n\n- [ ] 复习神经元结构图 📅 ${D(0)} 11:00 🔔 准时\n- [ ] 做第 6 讲练习 📅 ${D(4)} 14:00 🔔 准时\n`,
  '生活/待办.md': `# 待办\n\n- [ ] 体检预约 📅 ${D(5)} 09:00 🔔 准时\n`,
}

const rem = (id: string, title: string, d: string, from: string, to: string) => ({ id, title, calendar: 'C-rem', allDay: false, start: `${d}T${from}`, end: `${d}T${to}` })
const CAL = {
  auth: 'full',
  calAuth: 'full',
  lists: [{ id: 'L-ct', title: '画布今日', icloud: true, color: '#C0703A' }],
  calendars: [
    { id: 'C-rem', title: '提醒事项', color: '#FF3B30', source: 'iCloud' },
    { id: 'C-work', title: '工作', color: '#4F7CAC', source: 'iCloud' },
    { id: 'C-home', title: '家里', color: '#B0805A', source: 'iCloud' },
    { id: 'C-class', title: '课程表', color: '#7C6FAE', source: 'iCloud' },
  ],
  events: [
    { id: 'e1', title: '和爸妈视频', calendar: 'C-home', allDay: false, start: `${D(0)}T16:00`, end: `${D(0)}T17:00` },
    { id: 'e2', title: '组会', calendar: 'C-work', allDay: false, start: `${D(1)}T09:30`, end: `${D(1)}T10:30` },
    { id: 'e3', title: 'ecp 课', calendar: 'C-class', allDay: false, start: `${D(2)}T14:00`, end: `${D(2)}T15:30` },
    { id: 'e5', title: '牙医', calendar: 'C-home', allDay: false, start: `${D(5)}T10:00`, end: `${D(5)}T11:00` },
    rem('r1', '回导师邮件', D(0), '10:30', '11:30'),
    rem('r2', '复习神经元结构图', D(0), '11:00', '12:00'),
    rem('r3', '取快递', D(0), '18:00', '19:00'),
    rem('r4', '交论文初稿', D(1), '15:00', '16:00'),
    rem('r5', '交实验报告', D(1), '10:00', '12:00'),
    rem('r6', '订冰岛租车', D(2), '20:00', '21:00'),
    rem('r7', '取干洗的衣服', D(2), '13:00', '14:00'),
    rem('r8', '做第 6 讲练习', D(4), '14:00', '15:00'),
    rem('r9', '给房东回邮件', D(3), '09:00', '11:00'),
    rem('r10', '体检预约', D(5), '09:00', '10:00'),
    rem('r11', '打电话给银行', D(6), '14:00', '15:00'),
    { id: 'r12', title: '续签证材料', calendar: 'C-rem', allDay: true, start: D(3), end: D(3) },
  ],
}

const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const calp = (page: Page) => page.locator('.pane.calp:not([hidden])')
const row = (page: Page, name: string) => page.locator('aside.side[aria-label="日历"] [data-part="系统日历"] .calside-row', { hasText: name })

/** 在 (x, y) 画一个 macOS 样子的右键菜单（第一项是指着的样子） */
async function drawMenu(page: Page, x: number, y: number, labels: string[]) {
  await page.evaluate(
    ({ x, y, labels }) => {
      const m = document.createElement('div')
      m.id = 'shot-menu'
      m.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:99999;min-width:150px;padding:5px;border-radius:7px;font:13px -apple-system,'PingFang SC',sans-serif;background:rgba(238,238,240,.82);backdrop-filter:blur(20px) saturate(1.6);box-shadow:0 0 0 .5px rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.22);color:#1d1d1f`
      labels.forEach((l, i) => {
        const it = document.createElement('div')
        if (l === '—') it.style.cssText = 'height:1px;margin:5px 9px;background:rgba(0,0,0,.12)'
        else {
          it.textContent = l
          it.style.cssText = `padding:3px 10px;border-radius:4px;line-height:16px;${i === 0 ? 'background:#0a63d7;color:#fff' : ''}`
        }
        m.append(it)
      })
      document.body.append(m)
    },
    { x, y, labels },
  )
}

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(400)
  await run.page.screenshot({ path: join(DIR!, `${name}.png`) })
  writeFileSync(join(DIR!, `${name}.json`), JSON.stringify(await boxes(run.page)))
}
/** 交付页上的编号框：左栏系统日历那一块、日历格子、画上去的菜单（图片像素） */
async function boxes(page: Page) {
  return page.evaluate(() => {
    const k = devicePixelRatio
    const r = (sel: string) => {
      const e = document.querySelector(sel)
      if (!e) return null
      const b = e.getBoundingClientRect()
      return [b.x * k, b.y * k, b.width * k, b.height * k].map(Math.round)
    }
    return { side: r('aside.side[aria-label="日历"] [data-part="系统日历"]'), grid: r('.pane.calp:not([hidden]) .cal-wk, .pane.calp:not([hidden]) .cal-month'), menu: r('#shot-menu') }
  })
}


const LOOKS = [
  ['a', 'sky', 'a'],
  ['b', 'sky', 'b'],
  ['dark', 'petrol', 'b'],
] as const

for (const [tag, skin, frame] of LOOKS) {
  test(`画布笔记 · 日历格 · ${tag}`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const tmp = mkdtempSync(join(tmpdir(), 'cn-calshot-'))
    const mem = join(tmp, 'cal-mem.json')
    writeFileSync(mem, JSON.stringify(CAL))
    const run = await launch(FILES, { CN_TODAY_INSTALLED: '1', CN_CAL_HELPER: HELPER, CN_CAL_MEMORY: mem }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame, winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
      await bar(page).getByRole('button', { name: '日历', exact: true }).click()
      await expect(calp(page).locator('.cal-blk.ev', { hasText: '交实验报告' })).toBeVisible()
      await page.mouse.move(700, 600)
      if (tag === 'dark') {
        // 深色主题：藏起「提醒事项」和一个深色的日历「工作」
        await row(page, '提醒事项').locator('.calsw').click()
        await row(page, '工作').locator('.calsw').click()
        await expect(calp(page).locator('.cal-blk.ev', { hasText: '组会' })).toHaveCount(0)
        await page.mouse.move(700, 600)
        await shot(run, 'cn-dark-3-after')
        return
      }
      await shot(run, `cn-${tag}-1-before`)
      await armMenus(run)
      const b = (await row(page, '提醒事项').boundingBox())!
      await page.mouse.move(b.x + 70, b.y + b.height / 2)
      await row(page, '提醒事项').click({ button: 'right', position: { x: 70, y: b.height / 2 } })
      const items = (await openedMenu(run)).map((i) => i.label)
      await drawMenu(page, b.x + 72, b.y + b.height / 2 + 2, items)
      await shot(run, `cn-${tag}-2-menu`)
      await page.evaluate(() => document.getElementById('shot-menu')?.remove())
      await pickMenu(run, '不在这里显示')
      await expect(calp(page).locator('.cal-blk.ev', { hasText: '交实验报告' })).toHaveCount(0)
      await page.mouse.move(700, 600)
      await shot(run, `cn-${tag}-3-after`)
      // 悬停「工作」的色块：淡底 + 提示
      await row(page, '工作').locator('.calsw').hover()
      await page.waitForTimeout(700)
      await shot(run, `cn-${tag}-5-hover`)
      await page.mouse.move(700, 600)
      await calp(page).getByRole('tab', { name: '月' }).click()
      await shot(run, `cn-${tag}-4-after-month`)
      await calp(page).getByRole('tab', { name: '周' }).click()
    } finally {
      await run.close()
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
