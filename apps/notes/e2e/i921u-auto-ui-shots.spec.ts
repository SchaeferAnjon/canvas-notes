/**
 * 自动化的对照图（task-i921u「当……就……」方向 B）：原型 automations/proto.html#dir=b 和软件走同一遍，同一个状态左右拼一张（左原型、右软件）：
 * 右栏规则列表、说一句填好了、编辑一条（试跑、看写法）、当什么时候、加一步、记录、按钮做的事、按钮列和右栏一条、设置 › 自动化、周记设置。
 * 软件这边的库里放了和原型同名的几条规则当测试数据（软件本身不预置规则）。
 * 平时跳过：CN_SHOTS_DIR=<目录> [CN_SHOT_TONE=dark] npx playwright test e2e/i921u-auto-ui-shots.spec.ts（原型路径 CN_PROTO）。
 */
import { chromium, expect, type Locator, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LEDGER_BASE, LEDGER_DOC_PATH, LEDGER_FILES } from './auto-samples'
import { launch, openNote, pane, type Running } from './app'

const SHOTS = process.env.CN_SHOTS_DIR
const TONE = process.env.CN_SHOT_TONE === 'dark' ? 'dark' : 'light'
const PROTO = process.env.CN_PROTO ?? '/private/tmp/canvas-notes-visual/14-数据库第三批/automations/proto.html'
const CHROMIUM = { ...(process.env.CN_CHROMIUM ? { executablePath: process.env.CN_CHROMIUM } : {}) }
const W = 1440
const H = 887

test.skip(!SHOTS, '截对照图才跑：CN_SHOTS_DIR=<目录>')

/** 和原型同名的几条规则、一列按钮（测试数据） */
const RULES = `
  再记一笔:
    type: button
    do:
      - newRow: {copy: [金额, 分类, 收支], set: {日期: today()}}
      - open: true`
const AUTOS = `
automations:
  - name: 自动猜分类
    when: {added: true}
    if: 分类.isEmpty()
    do:
      - ai: cell
        prop: 分类
        prompt: 照名字猜是哪一类，只从已有的分类里选
  - name: 大额支出提醒
    when: [{added: true}, {changed: 金额}]
    if: {and: [收支 == "支出", 金额 > 500]}
    do:
      - notify: 这笔有点大：{{名字}} {{金额}}
  - name: 交报销单
    when: {changed: 分类, to: 报销}
    do:
      - todo: 交报销单：{{名字}} {{金额}}
        file: 生活/待办.md
        date: 下周一 9:00
  - name: 月底写账单摘要
    when: {every: month, day: last, at: "21:00"}
    missed: once
    do:
      - ai: summary
        rows: 日期.month == today().month
        prompt: 收入、支出、结余，花得最多的三类，和上个月比
        folder: 生活/记账/账单摘要`
const BASE = LEDGER_BASE.replace('    type: select\nviews:', `    type: select${RULES}\nviews:`).replace('      - 收支', '      - 收支\n      - 再记一笔') + AUTOS
const FILES = { ...LEDGER_FILES, [LEDGER_DOC_PATH]: LEDGER_FILES[LEDGER_DOC_PATH]!.replace(LEDGER_BASE, BASE) }

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: TONE === 'dark' ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
async function winShot(run: Running): Promise<Buffer> {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  return Buffer.from(b64, 'base64')
}
async function clickSteady(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(250)
  await el.click()
}

test(`对照图（${TONE}）：原型方向 B 和软件同一遍`, async () => {
  test.setTimeout(400_000)
  mkdirSync(SHOTS!, { recursive: true })
  const b = await chromium.launch(CHROMIUM)
  const proto = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  proto.setDefaultTimeout(20_000)
  const go = async (hash: string) => {
    await proto.goto(`file://${PROTO}#dir=b&theme=${TONE}${hash}`)
    await proto.reload()
    await proto.waitForTimeout(500)
  }
  const act = async (sel: string, wait = 300) => {
    await proto.locator(sel).first().click()
    await proto.waitForTimeout(wait)
  }
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_AUTO_SETTLE_MS: '400' }, look)
  const { page, app } = run
  const pairs: [string, Buffer, Buffer][] = []
  const both = async (name: string) => {
    const [p, a] = await Promise.all([proto.screenshot({ timeout: 60_000, caret: 'initial' }), winShot(run)])
    pairs.push([name, p, a])
    console.log('截好', name)
  }
  const side = page.getByTestId('dview-auto')
  try {
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setSize(s.W, s.H), { W, H })
    await openNote(page, '2026 记账')
    const db = pane(page).locator('[data-part="数据库块"]').first()
    await expect(db.locator('tbody tr')).toHaveCount(14)

    // 1 右栏规则列表
    await go('')
    await act('[data-act="autos"]')
    await db.locator('[data-part="自动化入口"]').click()
    await expect(side.locator('[data-part="一条自动化"]')).toHaveCount(4)
    await both('f5-自动化列表')

    // 2 说一句：填好了（原型点「比如」第三句、填成规则）
    await act('[data-act="say"][data-i="2"]')
    await act('[data-act="saygo"]', 2200)
    await side.getByRole('textbox', { name: '说一句' }).fill('每周日晚上 9 点提醒我记账')
    await side.getByRole('button', { name: '填成规则 ↵' }).click()
    await expect(side.locator('.au-filled')).toContainText('填好了', { timeout: 15_000 })
    await both('f9-填好了')

    // 3 编辑「交报销单」：试跑、看写法
    await act('[data-act="back"]')
    await act('[data-act="editauto"][data-id="reimb"]')
    await act('[data-act="trial"]')
    await act('[data-act="yaml"]')
    await side.getByRole('button', { name: '回到规则' }).click()
    await side.locator('[data-part="一条自动化"][data-name="交报销单"] .sum').click()
    await side.getByRole('button', { name: '试跑' }).click()
    await expect(side.locator('[data-part="试跑"]')).toBeVisible()
    await side.getByRole('button', { name: '看写法' }).click()
    await both('f7-试跑和写法')

    // 4 当什么时候、加一步（新的一条）
    await act('[data-act="back"]')
    await act('[data-act="newauto"]')
    await act('[data-act="trig"]')
    await side.getByRole('button', { name: '回到规则' }).click()
    await side.getByRole('button', { name: '自己一格格选' }).click()
    await side.getByRole('button', { name: '选一个' }).click()
    await both('a1-当什么时候')
    await proto.keyboard.press('Escape')
    await proto.mouse.click(5, 5)
    await act('[data-act="settrig"][data-t="set"]').catch(() => undefined)
    await page.getByRole('menu', { name: '当什么时候' }).getByRole('menuitem', { name: /^某一列改成某个值/ }).click()
    await page.keyboard.press('Escape')
    await act('[data-act="stepadd"]')
    await side.getByRole('button', { name: '加一步' }).click()
    await both('a2-加一步')
    await page.keyboard.press('Escape')

    // 5 记录（原型：表里把「外卖」改成报销，跑一次「交报销单」；软件同样改一格）
    await proto.mouse.click(5, 5)
    await act('[data-act="back"]')
    await act('[data-act="cat"][data-id]', 300).catch(() => undefined)
    await proto.locator('[data-act="setcat"][data-c="报销"]').first().click().catch(() => undefined)
    await proto.waitForTimeout(600)
    await act('[data-act="pane"][data-p="log"]')
    await side.getByRole('button', { name: '回到规则' }).click()
    const cell = db.locator('tbody tr', { hasText: '外卖' }).locator('td', { hasText: /^餐饮$/ })
    await clickSteady(page, cell)
    await page.getByLabel('外卖 · 分类').getByText('报销', { exact: true }).first().click()
    await expect(page.getByTestId('toast')).toContainText('交报销单', { timeout: 20_000 })
    await side.getByRole('tab', { name: /记录/ }).click()
    await expect(side.locator('[data-part="一行记录"]')).toHaveCount(1)
    await both('f12-记录')

    // 6 按钮做的事（点按钮列的列头）
    await act('[data-act="addcol"]')
    await act('[data-act="btnedit"]')
    await clickSteady(page, db.locator('thead .base-th', { hasText: '再记一笔' }))
    await page.waitForTimeout(500)
    await page.keyboard.press('Escape')
    await expect(side.locator('[data-part="按钮做的事"]')).toBeVisible()
    await both('f16-按钮怎么设')

    // 7 按钮列：点「咖啡」那一行，新建一条在右栏开
    await go('')
    await act('[data-act="again"]', 600)
    await clickSteady(page, db.locator('tbody tr', { hasText: '咖啡' }).getByRole('button', { name: '「咖啡」这一行点「再记一笔」' }))
    await expect(page.getByTestId('dview-record')).toBeVisible({ timeout: 20_000 })
    // 右栏第一次有两个标签时的「想两样一起看？」提示：关掉（原型没有）
    const hint = page.getByTestId('dock-hint')
    if (await hint.isVisible()) await hint.getByRole('button', { name: '关掉' }).click()
    await both('f15-按钮')

    // 8 设置 › 自动化
    await go('&scene=settings')
    await side.isVisible()
    await page.keyboard.press('Meta+,')
    await page.getByRole('dialog', { name: '设置' }).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '自动化', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '设置' }).getByRole('group', { name: '软件自带的' })).toBeVisible()
    await both('w1-设置自动化')

    // 9 周记设置
    await act('[data-act="setpage"][data-p="week"]')
    await page.getByRole('dialog', { name: '设置' }).locator('[data-part="周记"] .sa-lb').click()
    await expect(page.getByRole('dialog', { name: '设置' }).locator('.au-subhead')).toBeVisible()
    await both('w2-周记设置')
  } finally {
    await run.close()
  }
  // 左右拼：左原型、右软件
  const sheet = await b.newPage({ viewport: { width: W * 2 + 24, height: H + 40 } })
  for (const [name, p, a] of pairs) {
    const img = (x: Buffer) => `data:image/png;base64,${x.toString('base64')}`
    const col = (title: string, x: Buffer) =>
      `<div><div style="height:32px;line-height:32px;color:#fff;padding-left:8px">${title}</div><img src="${img(x)}" style="width:${W}px;height:${H}px;display:block;object-fit:contain;object-position:top left"></div>`
    await sheet.setContent(`<body style="margin:0;background:#666;font:14px -apple-system"><div style="display:flex;gap:24px">${col(`原型 · ${name}`, p)}${col(`软件 · ${name}`, a)}</div></body>`)
    await sheet.waitForTimeout(150)
    writeFileSync(join(SHOTS!, `${name}-${TONE === 'dark' ? '深湖' : '天青'}.png`), await sheet.screenshot())
  }
  await b.close()
})
