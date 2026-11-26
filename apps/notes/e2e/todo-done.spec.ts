/**
 * 待办打勾就进已完成（2026-11-24 用户：「我点了对勾之后，这个任务是不是应该就要消失，到"已完成"里面」「是不是应该有个全部 因为有些我是没写日期的
 * …还应该有一个已完成」「这些已完成的都放在这里 是不是有点占地方」）：
 * - 过期里勾一条：原处一行「已完成 · 撤回」，点撤回回来；2 秒后从过期消失，进「已完成」；日历来的那种（生活/日历.md，带钟点和 🔔）同样
 * - 左栏分类多「全部」（没写日子的也在，文件夹下按笔记分）和「已完成」（按完成那天倒着，点勾选框取消勾回到原来那一组）
 * - 按文件夹里已完成的收成一行「已完成 N 条 ›」，点开看得到
 * 一律真点，无头（CN_E2E=1），临时库、临时设置目录。CN_SHOTS=目录 时截薄荷的交付图。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, pane, type Running } from './app'

const pad = (n: number) => String(n).padStart(2, '0')
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const T0 = day(0)

const CAL = `# 日历\n\n- [ ] 练车 📅 ${day(-15)} 14:30 🔔 准时\n- [ ] Generative Neural Networks（讲课） 📅 ${day(-8)} 14:00 🔔 准时\n- [x] 组会 yiting 📅 ${day(-14)} 13:30 ✅ ${day(-3)}\n`
const WS = `# WS 2026 27 待办\n\n- [ ] 给房东发邮件 📅 ${day(-5)} 18:00\n- [ ] 回电份工作的消息 📅 ${day(3)} 10:00\n`
const INBOX = `# 待办\n\n- [ ] 交房租 📅 ${T0}\n- [ ] 买打印纸\n`
const PLAN = `# 小论文计划\n\n- [ ] 想题目\n- [x] 读文献 📅 ${day(-2)} ✅ ${day(-1)}\n`
const VAULT = { '生活/日历.md': CAL, '生活/WS 2026 27 待办.md': WS, '收件箱/待办.md': INBOX, '写作/小论文计划.md': PLAN }

const read = (run: Running, p: string) => readFileSync(join(run.vault, p), 'utf8')
const side = (page: Page) => page.locator('aside.side[aria-label="待办"]')
const seg = (page: Page, name: string) => side(page).getByRole('tab', { name, exact: true })
const home = (page: Page) => pane(page).getByTestId('todo-home')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const row = (scope: Locator, title: string) => scope.locator('.td-r').filter({ has: scope.page().locator('.td-t', { hasText: new RegExp(`^${esc(title)}$`) }) })
const titles = (scope: Locator) => scope.locator('.td-r .td-t').allTextContents()
const subs = (scope: Locator) => scope.locator('.td-sub').evaluateAll((els) => els.map((e) => [...e.childNodes].map((n) => (n.textContent ?? '').trim()).filter(Boolean).join(' ')))
const toast = (page: Page) => page.getByTestId('toast')

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await run.page.mouse.move(900, 700)
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function open() {
  const run = await launch(VAULT, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
  })
  await leftView(run.page, '待办')
  await expect(side(run.page)).toBeVisible()
  return run
}

test('过期里勾一条：原处「已完成 · 撤回」，点撤回回来；再勾 2 秒后从过期、首页消失，进「已完成」；日历来的那种同样', async () => {
  const run = await open()
  const { page } = run
  try {
    await seg(page, '今天').click()
    await expect.poll(() => subs(side(page))).toEqual(['过期 3', '今天 1'])

    // ① 勾掉：原处一行「已完成 · 撤回」，文件里只改那一行
    await row(side(page), '给房东发邮件').getByRole('checkbox').click()
    await expect.poll(() => read(run, '生活/WS 2026 27 待办.md')).toBe(WS.replace(`- [ ] 给房东发邮件 📅 ${day(-5)} 18:00`, `- [x] 给房东发邮件 📅 ${day(-5)} 18:00 ✅ ${T0}`))
    const just = row(side(page), '给房东发邮件')
    await expect(just).toHaveClass(/just/)
    await expect(just.locator('.td-just')).toHaveText('已完成 · 撤回')
    await expect.poll(() => subs(side(page))).toEqual(['过期 2', '今天 1'])
    // 点行里的「撤回」：文件回到原样，回到过期里（没打勾），底栏那句也收了
    await just.getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(run, '生活/WS 2026 27 待办.md')).toBe(WS)
    await expect(row(side(page), '给房东发邮件')).not.toHaveClass(/done|just/)
    await expect(toast(page)).toHaveCount(0)
    await expect.poll(() => subs(side(page))).toEqual(['过期 3', '今天 1'])

    // ② 再勾：2 秒后从过期、中间首页的过期里都消失
    await row(side(page), '给房东发邮件').getByRole('checkbox').click()
    await expect(row(side(page), '给房东发邮件')).toHaveClass(/just/)
    await expect(row(side(page), '给房东发邮件')).toHaveCount(0, { timeout: 4000 })
    await expect(row(home(page), '给房东发邮件')).toHaveCount(0)
    await expect.poll(() => subs(side(page))).toEqual(['过期 2', '今天 1'])

    // ③ 日历来的（生活/日历.md，带钟点和 🔔）：同样消失；底栏「撤回」也能拿回来
    await row(side(page), '练车').getByRole('checkbox').click()
    await expect.poll(() => read(run, '生活/日历.md')).toContain(`- [x] 练车 📅 ${day(-15)} 14:30 🔔 准时 ✅ ${T0}`)
    await expect(row(side(page), '练车')).toHaveCount(0, { timeout: 4000 })
    await expect(titles(side(page))).resolves.toEqual(['Generative Neural Networks（讲课）', '交房租'])
    await expect(toast(page).locator('span').first()).toHaveText('勾掉了「练车」')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(run, '生活/日历.md')).toBe(CAL)
    await expect(row(side(page), '练车')).toBeVisible()
    await expect(row(side(page), '练车')).not.toHaveClass(/done/)
  } finally {
    await run.close()
  }
})

test('全部有没写日子的（文件夹下按笔记分）；已完成按完成日子倒着，取消勾回到原来那组；按文件夹里已完成收成一行', async () => {
  const run = await open()
  const { page } = run
  try {
    // 分类：今天 / 七天 / 全部 / 按文件夹 / 收件箱 / 已完成
    await expect(side(page).getByRole('tab')).toHaveText(['今天', '七天', '全部', '按文件夹', '收件箱', '已完成'])

    // 全部：没写日子的「买打印纸」「想题目」在；做完的不在；文件夹下按笔记分
    await seg(page, '全部').click()
    const life = side(page).locator('.td-fg[aria-label="生活"]')
    await expect.poll(() => subs(life)).toEqual(['日历 2', 'WS 2026 27 待办 2'])
    await expect(row(side(page), '买打印纸')).toBeVisible()
    await expect(row(side(page), '想题目')).toBeVisible()
    await expect(row(side(page), '组会 yiting')).toHaveCount(0)
    await expect(row(side(page), '读文献')).toHaveCount(0)
    await shot(run, '02-全部')
    // 点笔记名打开那一篇
    await side(page).getByRole('button', { name: /^小论文计划/ }).click()
    await expect(pane(page).locator('.cm-content')).toContainText('想题目')

    // 今天里勾掉一条的样子（截图），等它进已完成
    await seg(page, '今天').click()
    await row(side(page), '给房东发邮件').getByRole('checkbox').click()
    await expect(row(side(page), '给房东发邮件')).toHaveClass(/just/)
    await shot(run, '01-今天里勾掉')
    await expect(row(side(page), '给房东发邮件')).toHaveCount(0, { timeout: 4000 })
    await shot(run, '01b-今天里勾完以后')

    // 已完成：按完成那天倒着（今天、昨天、三天前）
    await seg(page, '已完成').click()
    await expect.poll(() => titles(side(page))).toEqual(['给房东发邮件', '读文献', '组会 yiting'])
    expect((await subs(side(page)))[0]).toBe('今天 1')
    expect((await subs(side(page)))[1]).toBe('昨天 1')
    await shot(run, '03-已完成')
    // 取消勾：从已完成里走，回到过期
    await row(side(page), '给房东发邮件').getByRole('checkbox').click()
    await expect.poll(() => read(run, '生活/WS 2026 27 待办.md')).toBe(WS)
    await expect.poll(() => titles(side(page))).toEqual(['读文献', '组会 yiting'])
    await seg(page, '今天').click()
    await expect(row(side(page), '给房东发邮件')).toBeVisible()
    await expect(row(side(page), '给房东发邮件')).not.toHaveClass(/done/)

    // 按文件夹：生活里的「组会 yiting」收成一行「已完成1条 ›」，点开看得到
    await seg(page, '按文件夹').click()
    const fold = life.getByRole('button', { name: '已完成1条 ›' })
    await expect(fold).toBeVisible()
    await expect(row(life, '组会 yiting')).toHaveCount(0)
    await shot(run, '04-按文件夹已完成收成一行')
    await fold.click()
    await expect(row(life, '组会 yiting')).toBeVisible()
    await expect(row(life, '组会 yiting')).toHaveClass(/done/)
    await expect(life.getByRole('button', { name: '已完成1条 ⌄' })).toBeVisible()
  } finally {
    await run.close()
  }
})
