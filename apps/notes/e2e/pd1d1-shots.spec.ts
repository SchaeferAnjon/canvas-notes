/**
 * 待办三处的对照截图（task-pd1d1）：和原型 05-任务软件/todo-demo.html 同一份数据、同一个状态，天青 / 深湖 × A / B 各一套。
 * 只在给了 CN_SHOTS（目录）时跑；窗口内容 1420×834，和原型里画的那个窗口一样大。真点、真拖、真打字。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, pane, type Running, tabOn } from './app'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '只在截对照图时跑（CN_SHOTS=目录）')

const pad = (n: number) => String(n).padStart(2, '0')
const day = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const [T0, T1, T2, T3, Y1, Y2] = [day(0), day(1), day(2), day(3), day(-1), day(-2)]
const VAULT: Record<string, string> = {
  '收件箱/待办.md': `# 待办\n\n- [ ] 交 ecp 作业 2 📅 ${Y1} 23:59 ⏫\n- [ ] 回导师邮件 📅 ${T0} 10:30\n- [ ] 取快递 📅 ${T0} 18:00 🔔 准时\n- [ ] 订冰岛租车 📅 ${T1} 20:00 🔔 提前1小时\n- [ ] 买打印纸\n`,
  '写作/待办.md': `# 待办\n\n- [ ] 改第二章的开头 📅 ${T2}\n- [ ] 给编辑发邮件 📅 ${T3} 10:00\n- [x] 交读书报告 📅 ${Y2} ✅ ${T0}\n`,
  '写作/小论文计划.md': `# 小论文计划\n\n截稿前把实验和初稿弄完。\n\n- [ ] 交论文初稿 📅 ${T1} 15:00 🔔 提前1小时 ⏫\n- [ ] 读完三篇相关论文 📅 ${T0}\n`,
  '课程/ecp/Lecture05 笔记.md': `# Lecture05 笔记\n\n- [ ] 复习神经元结构图 📅 ${T0} 11:00\n`,
}

const LOOKS = [
  ['sky', 'b'],
  ['petrol', 'b'],
  ['sky', 'a'],
  ['petrol', 'a'],
] as const

const cell = (page: Page) => page.locator('aside.side[aria-label="待办"]')
const row = (page: Page, scope: string, title: string) => page.locator(`${scope} .td-r`).filter({ has: page.locator('.td-t', { hasText: new RegExp(`^${title}$`) }) }).first()

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(350)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

for (const [skin, frame] of LOOKS) {
  test(`对照图：${skin} · ${frame}`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const run = await launch(VAULT, { CN_TODAY_INSTALLED: '1' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame, winBg: 'aurora' } }))
    })
    const { page } = run
    const tag = `${skin}-${frame}`
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1420, 834))
      // ① 写作首页 + 左边「待办」格（按文件夹）
      await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '写作', exact: true }).click()
      await expect(tabOn(page)).toHaveText('写作')
      await leftView(page, '待办')
      // 「待办」格同时在中间开「待办」首页（task-kzr3n）：点回「写作」标签
      await page.getByTestId('tab-list').getByRole('tab', { name: '写作' }).click()
      await expect(pane(page).getByTestId('todo-card')).toBeVisible()
      await shot(run, `1-start-${tag}`)
      // 「在哪」标注图要的框（天青 B 那一套）
      const boxes: Record<string, unknown> = {}
      if (tag === 'sky-b') {
        boxes['1'] = await page.getByTestId('ab-todo').boundingBox()
        boxes['2'] = await cell(page).boundingBox()
        boxes['3'] = await page.locator('[data-widget]').filter({ has: page.getByTestId('todo-card') }).boundingBox()
      }
      // ② 点一条开详情小卡
      await row(page, 'aside.side', '交论文初稿').locator('.td-t').click()
      await expect(page.getByRole('dialog', { name: '详情' })).toBeVisible()
      await shot(run, `2-pop-${tag}`)
      await page.keyboard.press('Escape')
      // ③ 正在拖「改第二章的开头」到收件箱那组的「明天」上
      const src = (await row(page, 'aside.side', '改第二章的开头').boundingBox())!
      const dst = (await cell(page).locator('.td-fg[aria-label="收件箱"] .td-sub', { hasText: /^明天/ }).boundingBox())!
      await page.mouse.move(src.x + 60, src.y + src.height / 2)
      await page.mouse.down()
      await page.mouse.move(src.x + 70, src.y + src.height / 2 - 6, { steps: 3 })
      await page.mouse.move(dst.x + 40, dst.y + dst.height / 2, { steps: 8 })
      await shot(run, `3-drag-${tag}`)
      await page.mouse.move(src.x + 60, src.y + src.height / 2, { steps: 3 })
      await page.keyboard.press('Escape')
      await page.mouse.up()
      // ④ 加一条：打了字，下面一行「认出来：…」
      await cell(page).getByRole('textbox', { name: '加一条' }).click()
      await page.keyboard.type('明天下午三点交论文')
      await shot(run, `4-qa-${tag}`)
      await page.keyboard.press('Escape')
      await cell(page).getByRole('textbox', { name: '加一条' }).fill('')
      // ⑤ 写作/待办 的任务界面
      await cell(page).locator('.td-fg[aria-label="写作"]').getByRole('button', { name: '打开 写作/待办 ›' }).click()
      await expect(pane(page).locator('.td-view')).toBeVisible()
      await shot(run, `5-taskview-${tag}`)
      if (tag === 'sky-b') {
        boxes['4'] = await page.getByTestId('tab-acts').getByRole('tab', { name: '任务' }).boundingBox()
        boxes['5'] = await pane(page).locator('.td-view').boundingBox()
        writeFileSync(join(DIR!, 'boxes.json'), JSON.stringify(boxes))
      }
      // ⑥ 任务界面里点一条开详情
      await row(page, '.pane:not([hidden]) .td-view', '给编辑发邮件').locator('.td-t').click()
      await expect(page.getByRole('dialog', { name: '详情' })).toBeVisible()
      await shot(run, `6-taskview-pop-${tag}`)
      await page.keyboard.press('Escape')
      // ⑦ 想看原文：点「文档」
      await page.getByTestId('tab-acts').getByRole('tab', { name: '文档' }).click()
      await expect(pane(page).locator('.cm-content')).toBeVisible()
      await shot(run, `7-doc-${tag}`)
      await page.getByTestId('tab-acts').getByRole('tab', { name: '任务' }).click()
      // ⑧ 收件箱/待办 的任务界面
      await cell(page).locator('.td-fg[aria-label="收件箱"]').getByRole('button', { name: '打开 收件箱/待办 ›' }).click()
      await expect(pane(page).locator('.td-view h1')).toHaveText('待办')
      await shot(run, `8-inbox-${tag}`)
      // ⑨ 回到写作首页，首页卡里勾掉一条（左边跟着划线）
      await page.getByTestId('tab-list').locator('.tab', { hasText: /^写作$/ }).click()
      await row(page, '.pane:not([hidden]) [data-testid="todo-card"]', '给编辑发邮件').getByRole('checkbox').click()
      await expect(row(page, 'aside.side', '给编辑发邮件')).toHaveClass(/done/)
      await shot(run, `9-home-tick-${tag}`)
      // ⑩ 文件树：名字叫「待办」的不显示
      await leftView(page, '文件')
      for (const name of ['收件箱', '写作']) {
        const r = page.locator('aside.side').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) }).first()
        if ((await r.getAttribute('aria-expanded')) !== 'true') await r.click()
      }
      await shot(run, `10-files-${tag}`)
    } finally {
      await run.close()
    }
  })
}
