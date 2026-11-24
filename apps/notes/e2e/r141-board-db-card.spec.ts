/**
 * 白板上的数据库卡（r141）：展开 → 整页打开 → 滚轮滚白板 → 收起，白板和卡都在、点得动（以前整页是盖满整栏的空白一层，白板没了，
 * 滚轮滚的是底下看不见的白板，卡被带着跑，像卡死）；「占满」下整页只有一份（展开的卡和整页叠着时让开）；
 * 双击卡头的名字改名，改的是数据源文件夹，文件里 file.inFolder 跟着变。都是真点、真滚、真打字。
 * CN_SHOTS=目录：顺手截交付图（薄荷、浮岛）。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch } from './app'
import { board, FILES, openBoard } from './fixtures/board-doc'

const SHOTS = process.env.CN_SHOTS
const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: join(SHOTS, name) }))

async function start() {
  const run = await launch(FILES, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b', winBg: 'aurora' } }))
  })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  const errors: string[] = []
  run.page.on('pageerror', (e) => errors.push(String(e)))
  run.page.on('console', (m) => m.type() === 'error' && /React|Maximum update/i.test(m.text()) && errors.push(m.text()))
  return { ...run, errors }
}

/** 工具板放一张「住宿」数据库卡，点「展开」 */
async function expandStay(page: Page) {
  await openBoard(page, '冰岛十天环岛')
  await board(page).locator('.bpal button[data-kind="base"]').click()
  await page.getByRole('menu', { name: '放一张数据库卡' }).getByRole('menuitem').filter({ hasText: '住宿' }).first().click()
  const card = board(page).locator('.db-card[data-kind="base"]')
  await expect(card).toBeVisible()
  await card.getByTestId('db-expand').click()
  const big = board(page).locator('.dbx')
  await expect(big).toBeVisible()
  await page.waitForTimeout(350)
  return { card, big }
}

const rect = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vis: getComputedStyle(el).visibility }
  }, sel)
const overlap = (a: { top: number; bottom: number; left: number; right: number }, b: { top: number; bottom: number; left: number; right: number }) =>
  a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left

/** 整页那一层上看得见的数据库只有它自己：展开的卡和它叠着就藏起来 */
async function oneCopy(page: Page) {
  const sheet = (await rect(page, '.base-full'))!
  const dbx = (await rect(page, '.dbx'))!
  expect(dbx.vis === 'hidden' || !overlap(sheet, dbx)).toBe(true)
}

test('展开 → 整页打开 → 滚轮滚几下 → 收起：整页盖在顶上、底下白板看得见滚得动，收起后白板和卡都在、点一下马上有反应', async () => {
  const run = await start()
  const { page, errors } = run
  try {
    const { card, big } = await expandStay(page)
    await big.locator('[data-fold="full"]').click()
    const full = page.locator('.base-full')
    await expect(full).toBeVisible()
    await expect(full.locator('tbody tr')).toHaveCount(5)
    await page.waitForTimeout(200)
    await shot(page, '1-整页打开.png')
    // 整页是盖在顶上的一层，高随内容：底下还露着白板（以前盖满整栏，白板一大片空白）
    const sheet = (await rect(page, '.base-full'))!
    const wrapBox = (await board(page).locator('.board-wrap').boundingBox())!
    expect(sheet.bottom).toBeLessThan(wrapBox.y + wrapBox.height - 200)
    await oneCopy(page)
    // 在整页下面的白板上真滚几下：滚的是白板，卡跟着白板走
    const wrap = board(page).locator('.board-wrap')
    const before = await wrap.evaluate((w) => w.scrollTop)
    await page.mouse.move(wrapBox.x + wrapBox.width / 2, sheet.bottom + 120)
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 150)
      await page.waitForTimeout(60)
    }
    await expect.poll(() => wrap.evaluate((w) => w.scrollTop)).not.toBe(before)
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -150)
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(300)
    await oneCopy(page)
    // 整页那一层在滚的时候不动，白板还在
    expect((await rect(page, '.base-full'))!.top).toBe(sheet.top)
    await expect(board(page).locator('.db-col h3 .truncate')).toHaveText(['出发前', '住哪', '路线'])
    await shot(page, '2-滚过以后.png')
    // 收回整页（Esc），再收起卡
    await page.keyboard.press('Escape')
    await expect(full).toHaveCount(0)
    await expect(big).toBeVisible()
    await expect(big).toHaveCSS('visibility', 'visible')
    await big.getByTestId('db-collapse').click()
    await expect(big).toHaveCount(0)
    await expect(card).toBeVisible()
    await expect(board(page).locator('.db-col h3 .truncate')).toHaveText(['出发前', '住哪', '路线'])
    // 界面还点得动：点一张卡，量从点下去到选上的时间
    const other = board(page).locator('.db-card', { hasText: '11 月白天' })
    await other.scrollIntoViewIfNeeded()
    const t0 = Date.now()
    await other.click()
    await expect(other).toHaveClass(/sel/)
    const ms = Date.now() - t0
    console.log('点一张卡到选上', ms, 'ms')
    expect(ms).toBeLessThan(1500)
    await shot(page, '3-收起以后.png')
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})

test('「占满」下展开、整页打开：整页只有一份（叠着的那张展开的卡让开），收回整页卡又出来', async () => {
  const run = await start()
  const { page, errors } = run
  try {
    const { big } = await expandStay(page)
    await page.keyboard.press('Control+Meta+Backslash')
    await expect(page.getByText(/占满 · /)).toBeVisible()
    await page.waitForTimeout(400)
    await big.locator('[data-fold="full"]').click()
    await expect(page.locator('.base-full')).toBeVisible()
    await page.waitForTimeout(200)
    await oneCopy(page)
    // 屏幕上看得见的整张数据库表只有一张（藏起来的不算）
    const seen = await page.evaluate(() => [...document.querySelectorAll('[data-part="数据库块"], .base-full')].filter((el) => el.checkVisibility({ visibilityProperty: true }) && el.getBoundingClientRect().height > 0).length)
    expect(seen).toBe(1)
    await shot(page, '4-占满下整页.png')
    await page.keyboard.press('Escape')
    await expect(page.locator('.base-full')).toHaveCount(0)
    await expect(big).toHaveCSS('visibility', 'visible')
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})

test('双击数据库卡头的名字改名：数据源文件夹改名，文档里 file.inFolder 跟着变、卡头换成新名字；Esc 不改', async () => {
  const run = await start()
  const { page, vault, errors } = run
  const file = () => readFileSync(join(vault, '项目/冰岛十天环岛.md'), 'utf8')
  try {
    await openBoard(page, '冰岛十天环岛')
    await board(page).locator('.bpal button[data-kind="base"]').click()
    await page.getByRole('menu', { name: '放一张数据库卡' }).getByRole('menuitem').filter({ hasText: '住宿' }).first().click()
    const card = board(page).locator('.db-card[data-kind="base"]')
    await expect(card.locator('.kh')).toContainText('住宿 · 表格')
    await expect.poll(file).toContain('file.inFolder("项目/住宿")')
    // Esc 不改
    await card.locator('.base-name').dblclick()
    const box = card.getByRole('textbox', { name: '数据库的新名字' })
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('住宿')
    await page.keyboard.type('不要')
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await expect(card.locator('.base-name')).toHaveText('住宿')
    // 双击、打新名字、回车
    await card.locator('.base-name').dblclick()
    await expect(box).toBeFocused()
    await shot(page, '5-双击改名.png')
    await page.keyboard.press('Meta+a')
    await page.keyboard.type('冰岛住宿')
    await page.keyboard.press('Enter')
    await expect.poll(file).toContain('file.inFolder("项目/冰岛住宿")')
    expect(file()).not.toContain('file.inFolder("项目/住宿")')
    expect(existsSync(join(vault, '项目/冰岛住宿/Mývatn 小屋.md'))).toBe(true)
    expect(existsSync(join(vault, '项目/住宿'))).toBe(false)
    await expect(card.locator('.kh')).toContainText('冰岛住宿 · 表格')
    await expect(card.locator('.kh .r')).toHaveText('5条')
    // 数据库那篇（项目/住宿.md）里的同一个数据源也跟着换
    expect(readFileSync(join(vault, '项目/住宿.md'), 'utf8')).toContain('file.inFolder("项目/冰岛住宿")')
    await shot(page, '6-改名以后.png')
    expect(errors).toEqual([])
  } finally {
    await run.close()
  }
})
