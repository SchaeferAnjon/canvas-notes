/**
 * 数据库 AI 列的对照图（task-i921u「AI 生成一列」方向 B）：原型 proto-ai-column.html#dir=b 和软件走同一遍，同一个状态左右拼一张（左原型、右软件）：
 * 加一列菜单、右栏说要什么、样例在写、三条样例、全跑中、停下、全跑完、指着一格、列头菜单。
 * 平时跳过：CN_SHOTS_DIR=<目录> [CN_SHOT_TONE=dark] npx playwright test e2e/i921u-ai-col-shots.spec.ts（原型路径 CN_PROTO）。
 */
import { chromium, expect, type Locator, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ECP_DOC, EXERCISES, LECTURES } from '../../../packages/format/test/base-samples'
import { launch, openNote, pane, type Running, widenRight } from './app'

const SHOTS = process.env.CN_SHOTS_DIR
const TONE = process.env.CN_SHOT_TONE === 'dark' ? 'dark' : 'light'
const PROTO = process.env.CN_PROTO ?? '/private/tmp/canvas-notes-visual/14-数据库第三批/ai-column/proto-ai-column.html'
const CHROMIUM = { ...(process.env.CN_CHROMIUM ? { executablePath: process.env.CN_CHROMIUM } : {}) }
const W = 1440
const H = 887

test.skip(!SHOTS, '截对照图才跑：CN_SHOTS_DIR=<目录>')

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: TONE === 'dark' ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
async function winShot(run: Running): Promise<Buffer> {
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  return Buffer.from(b64, 'base64')
}
async function clickSteady(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await el.click()
}

test(`对照图（${TONE}）：原型方向 B 和软件同一遍`, async () => {
  test.setTimeout(400_000)
  mkdirSync(SHOTS!, { recursive: true })
  const b = await chromium.launch(CHROMIUM)
  const proto = await b.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
  proto.setDefaultTimeout(20_000)
  await proto.goto(`file://${PROTO}#dir=b&theme=${TONE}`)
  await proto.waitForTimeout(500)
  const run = await launch({ '课程/ecp/ecp 课程计划.md': ECP_DOC, ...LECTURES, ...EXERCISES }, { CN_AI_FAKE: '1', CN_FAKE_AICOL_MS: '3500' }, look)
  const { page, app } = run
  const pairs: [string, Buffer, Buffer][] = []
  const both = async (name: string) => {
    const [p, a] = await Promise.all([proto.screenshot({ timeout: 60_000, caret: 'initial' }), winShot(run)])
    pairs.push([name, p, a])
    console.log('截好', name)
  }
  try {
    await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setSize(s.W, s.H), { W, H })
    await openNote(page, 'ecp 课程计划')
    const db = pane(page).locator('[data-part="数据库块"]').first()
    await expect(db.locator('tbody tr')).toHaveCount(8)
    // 块头滚到和原型差不多的位置
    await db.evaluate((el) => {
      const sc = el.closest('.cm-scroller') as HTMLElement | null
      if (sc) sc.scrollTop += el.getBoundingClientRect().top - 300
    })
    /** 表格横着滚到最右（AI 列露出来） */
    const scrollRight = () => db.locator('.base-scroll').evaluate((el) => (el.scrollLeft = el.scrollWidth))

    // 加一列菜单
    await proto.click('[data-act="addcol"]')
    await clickSteady(page, db.getByRole('button', { name: '加一列' }))
    await expect(page.getByRole('dialog', { name: '加一列' })).toBeVisible()
    await both('a1-加一列')

    // 右栏说要什么
    await proto.click('[data-act="aicol"]')
    await proto.click('#promptBox')
    await proto.keyboard.type('每一讲的练习题')
    await page.getByRole('dialog', { name: '加一列' }).getByRole('menuitem', { name: /AI 生成一列/ }).click()
    await page.getByTestId('dview-aicol').getByRole('textbox', { name: '这一列放什么' }).pressSequentially('每一讲的练习题')
    // 右栏拉到和原型差不多宽（原型 528）
    await widenRight(page, 150)
    await both('b2-说要什么')

    // 样例在写
    await proto.click('[data-act="sample"]')
    await page.getByTestId('dview-aicol').getByRole('button', { name: '先跑前 3 条' }).click()
    await expect(db.locator('td.aic [data-state="running"]').first()).toBeVisible()
    await proto.waitForTimeout(600)
    await scrollRight()
    await both('b3-样例在写')

    // 三条样例
    await expect(page.getByTestId('dview-aicol').locator('.pfoot')).toContainText('全跑剩下', { timeout: 30_000 })
    await proto.waitForSelector('[data-act="runrest"]', { timeout: 15_000 })
    await scrollRight()
    await both('b4-样例')

    // 全跑中
    // 软件先点、写好一格以后原型再点（原型一格 1.5 到 2.8 秒，软件 3.5 秒），两边都停在「写好几格、几格在写、几格排队」
    await page.getByTestId('dview-aicol').getByRole('button', { name: /全跑剩下/ }).click()
    await expect(db.locator('td.aic [data-state="running"]').first()).toBeVisible()
    await page.waitForTimeout(3800)
    await proto.click('[data-act="runrest"]')
    await proto.waitForTimeout(1900)
    await scrollRight()
    await both('b6-全跑中')

    // 停下
    await proto.click('[data-act="stop"]')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('dview-aicol').locator('.pfoot')).toContainText('停在', { timeout: 20_000 })
    await both('b7-停下')

    // 全跑完
    await proto.click('[data-act="runrest"]')
    await page.getByTestId('dview-aicol').getByRole('button', { name: /接着跑/ }).click()
    await proto.waitForSelector('[data-act="rerunall"]', { timeout: 30_000 })
    await expect(page.getByTestId('dview-aicol').locator('.pfoot')).toContainText('都填好了', { timeout: 60_000 })
    await page.waitForTimeout(9500)
    await proto.waitForTimeout(9500)
    await scrollRight()
    await both('b8-全跑完')

    // 指着一格
    await proto.hover('tr[data-id] td.aic >> nth=2')
    await db.locator('tbody tr', { hasText: '第3讲' }).locator('td.aic').hover()
    await both('c1-指着一格')

    // 列头菜单
    await proto.click('[data-act="aicolmenu"]')
    await clickSteady(page, db.locator('thead .base-th[data-col="练习题"]'))
    await expect(page.getByRole('menu', { name: '练习题 这一列' })).toBeVisible()
    await both('c5-列菜单')
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
