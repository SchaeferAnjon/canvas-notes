/**
 * 写时间（task-pd289）的截图：天青（sky）、深湖（petrol）两套，B 浮岛书桌，1440 × 887。PD289_SHOTS=<目录> 才跑。
 * 文档里的灰字（本地认、AI 认）、打 @ 弹的选择器、点日子小块弹的、待办首页加一条的选择器和「AI 认出来」、详情小卡「其他…」、白板卡里的灰字；
 * 每张旁边配一张邻页（收下以后的样子、原来的详情小卡），给 designer 并排对照。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, pane, type Running } from './app'

const DIR = process.env.PD289_SHOTS
test.skip(!DIR, 'PD289_SHOTS=<目录> 才截')

const pad = (n: number) => String(n).padStart(2, '0')
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const PLAN = `# 小论文计划\n\n截稿前把实验和初稿弄完，周五交给导师。\n\n## 这周\n\n- [ ] 读完三篇相关论文\n- [ ] 交论文初稿 📅 ${day(1)} 15:00 🔔 提前1小时\n- [ ] 写提纲\n\n## 下周\n\n- [ ] 补实验图\n`
const INBOX = `# 待办\n\n- [ ] 回导师邮件 📅 ${day(0)} 10:30\n- [ ] 买打印纸\n`
const VAULT = { '写作/小论文计划.md': PLAN, '收件箱/待办.md': INBOX }

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(350)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function start(skin: string, env: Record<string, string> = {}): Promise<Running> {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(VAULT, env, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
  })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await expect.poll(() => run.page.evaluate(() => innerHeight)).toBe(887)
  return run
}

const ed = (page: Page) => pane(page).locator('.cm-content')
const line = (page: Page, t: string) => ed(page).locator('.cm-line', { hasText: t })
const picker = (page: Page) => page.getByRole('dialog', { name: '定日子和时间' })

/** 交回页开头那张「在哪」：文档里一行出了灰字、一行有日子小块、悬停「定日子」，框出来编号（PD289_WHERE=<目录>） */
test('在哪（天青）', async () => {
  const where = process.env.PD289_WHERE
  test.skip(!where, 'PD289_WHERE=<目录> 才截')
  const run = await start('sky', {})
  const { page } = run
  try {
    await openNote(page, '小论文计划')
    await line(page, '写提纲').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('明天下午三点交论文')
    await expect(page.getByTestId('when-ghost')).toBeVisible({ timeout: 3000 })
    await line(page, '补实验图').hover()
    await expect(line(page, '补实验图').getByRole('button', { name: '定日子' })).toBeVisible()
    const box = async (sel: import('@playwright/test').Locator) => {
      const b = (await sel.boundingBox())!
      return [Math.round(b.x * 2) - 8, Math.round(b.y * 2) - 8, Math.round(b.width * 2) + 16, Math.round(b.height * 2) + 16]
    }
    const items = [
      { n: 1, box: await box(page.getByTestId('when-ghost')), what: '灰字预览', where: '文档、白板卡里待办这一行行尾', how: '写「明天下午三点交论文」停手 0.6 秒出；Tab 收下，回车收下并换行，esc 不要' },
      { n: 2, box: await (async () => {
        const a = await box(ed(page).locator('.cm-when-cut').first())
        const b = await box(ed(page).locator('.cm-when-cut').last())
        return [a[0]!, a[1]!, b[0]! + b[2]! - a[0]!, a[3]!]
      })(), what: '要拿掉的时间词', where: '这一行的标题里', how: '划掉变淡；收下以后标题只剩「交论文」' },
      { n: 3, box: await box(line(page, '交论文初稿').locator('.cm-tdchip')), what: '日子小块', where: '待办行尾', how: '点了弹定日子和时间的选择器（今天 / 明天 / 下周一、小月历、钟点、提醒、重复、清掉）' },
      { n: 4, box: await box(line(page, '补实验图').getByRole('button', { name: '定日子' })), what: '「定日子」', where: '悬停没日子的一行，右边', how: '点了弹同一个选择器；光标在待办行上按 ⌥⌘T、在标题后面打 @ 也弹' },
      { n: 5, box: await box(page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '待办', exact: true })), what: '待办首页、左栏「待办」格', where: '左图标栏', how: '加一条的框里打 @ 弹选择器；本地认不出的下面写「AI 认出来」' },
    ]
    await page.mouse.move(5, 300)
    await line(page, '补实验图').hover()
    const raw = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
    mkdirSync(where!, { recursive: true })
    writeFileSync(join(where!, '00-where.png'), Buffer.from(raw, 'base64'))
    // 画框：红框、左上角编号（交回页自己也会画，这张给开头那一眼）
    await page.evaluate((its) => {
      for (const it of its) {
        const [x = 0, y = 0, w = 0, h = 0] = it.box.map((v: number) => v / 2)
        const d = document.createElement('div')
        d.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${w}px;height:${h}px;border:2px solid #e5484d;border-radius:6px;z-index:9999;pointer-events:none`
        const n = document.createElement('b')
        n.textContent = String(it.n)
        n.style.cssText = `position:absolute;left:${x < 12 ? 2 - x : -11}px;top:-11px;width:20px;height:20px;border-radius:10px;background:#e5484d;color:#fff;font:600 12px/20px -apple-system;text-align:center`
        d.append(n)
        document.body.append(d)
      }
    }, items)
    const drawn = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
    writeFileSync(join(where!, '00-where-drawn.png'), Buffer.from(drawn, 'base64'))
    writeFileSync(join(where!, '00-where.json'), JSON.stringify({ image: '00-where.png', items }, null, 1))
  } finally {
    await run.close()
  }
})

for (const skin of ['sky', 'petrol']) {
  test(`文档：灰字、选择器（${skin}）`, async () => {
    const run = await start(skin, { CN_AI_FAKE: '1' })
    const { page } = run
    try {
      await openNote(page, '小论文计划')
      await line(page, '写提纲').click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('下周一前交报告 提前一天提醒')
      await expect(page.getByTestId('when-ghost')).toBeVisible({ timeout: 3000 })
      await shot(run, `1-doc-ghost-${skin}`)
      await page.keyboard.press('Tab')
      await line(page, '截稿前').click()
      await shot(run, `1-doc-accepted-${skin}`)
      // AI 认的
      await line(page, '交报告').click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('圣诞节前买礼物')
      await expect(page.getByTestId('when-ghost')).toBeVisible({ timeout: 5000 })
      await shot(run, `2-doc-ghost-ai-${skin}`)
      await page.keyboard.press('Escape')
      // 打 @
      await page.keyboard.press('Enter')
      await page.keyboard.type('交周报 @')
      await expect(picker(page)).toBeVisible()
      await shot(run, `3-doc-picker-at-${skin}`)
      await page.keyboard.press('Escape')
      // 点日子小块
      await line(page, '截稿前').click()
      await line(page, '交论文初稿').locator('.cm-tdchip').click()
      await expect(picker(page)).toBeVisible()
      await shot(run, `4-doc-picker-chip-${skin}`)
    } finally {
      await run.close()
    }
  })

  test(`待办首页：加一条的选择器、AI 认出来、详情小卡「其他…」（${skin}）`, async () => {
    const run = await start(skin, { CN_AI_FAKE: '1' })
    const { page } = run
    try {
      await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '待办', exact: true }).click()
      const home = pane(page).getByTestId('todo-home')
      const input = home.getByRole('textbox', { name: '待办首页加一条' })
      await input.click()
      await page.keyboard.type('交论文 @')
      await expect(picker(page)).toBeVisible()
      await shot(run, `5-home-picker-${skin}`)
      await page.keyboard.press('Escape')
      await input.fill('')
      await input.click()
      await page.keyboard.type('圣诞节前买礼物')
      await expect(home.getByTestId('td-hint')).toContainText('AI 认出来', { timeout: 5000 })
      await shot(run, `6-home-ai-hint-${skin}`)
      await input.fill('')
      // 详情小卡（邻页）和「其他…」弹的选择器
      await home.locator('.td-r', { hasText: '回导师邮件' }).first().locator('.td-t').click()
      const pop = page.getByRole('dialog', { name: '详情' })
      await expect(pop).toBeVisible()
      await shot(run, `7-home-pop-${skin}`)
      await pop.getByRole('button', { name: '定日子和时间…' }).click()
      await expect(picker(page)).toBeVisible()
      await shot(run, `7-home-pop-picker-${skin}`)
    } finally {
      await run.close()
    }
  })

  test(`白板卡里的灰字（${skin}）`, async () => {
    const run = await start(skin)
    const { page } = run
    try {
      await openNote(page, '小论文计划')
      await page.getByTestId('tab-acts').getByRole('tab', { name: '白板' }).click()
      const board = pane(page).getByTestId('doc-board')
      const card = board.locator('.db-card', { hasText: '写提纲' }).first()
      await card.getByText(/^待办/).first().dblclick()
      await page.keyboard.press('Enter')
      await page.keyboard.type('明天下午三点交论文')
      await expect(card.getByTestId('when-ghost')).toBeVisible({ timeout: 3000 })
      await shot(run, `8-card-ghost-${skin}`)
    } finally {
      await run.close()
    }
  })
}
