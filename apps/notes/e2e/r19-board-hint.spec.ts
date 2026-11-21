/**
 * 白板顶上那条提示能消失（task-wn3x5，偏好「提示条要能消失」）。都是真点、真拖、真按键：
 * - 说明「按「##」摆成列 · 挪动了才写进文件」每块白板只说一次：几秒后、或第一次操作后自己收起，右边 × 点掉；收过、点掉以后这块白板不再出（记在本机，不写进笔记）。
 * - 「N张卡离开了自己那一节 · 文件里多了N行位置 · 摆回原样」只在文件里真有位置行时出：点「摆回原样」后收起（能撤回）；× 先藏起，有新的卡挪离才再出来。
 * - 出现、收起有过渡（进场动画、收起时先留着淡出再拿掉）。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, gitStatus, launch, waitSaved } from './app'
import { board, col, FILES, openBoard } from './fixtures/board-doc'

const hint = (page: Page) => board(page).locator('.db-hint')
const TRAVEL = '项目/冰岛十天环岛.md'

async function start(files = FILES, env: Record<string, string> = {}) {
  const run = await launch(files, env)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  return run
}

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y + 10, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 14 })
  await page.waitForTimeout(80)
  await page.mouse.up()
}

/** 一张卡拖到画布下面的空白处 */
async function dragOut(page: Page, column: string, text: string, dx: number) {
  const c = (await col(page, column).locator('.db-card', { hasText: text }).boundingBox())!
  const w = (await board(page).locator('.board-wrap').boundingBox())!
  await dragTo(page, { x: c.x + 40, y: c.y + 16 }, { x: w.x + dx, y: w.y + w.height - 120 })
}

/** 关掉这个标签再按名字开回来 */
async function reopen(page: Page, title: string) {
  await page.keyboard.press('Meta+w')
  await expect(page.locator('.tab', { hasText: title })).toHaveCount(0)
  await openBoard(page, title)
  await expect(board(page)).toBeVisible()
}

test('说明只说一次：几秒后自己收起、× 点掉、第一次操作就收；收过的白板关掉重开、重启软件都不再出；笔记文件一个字节不变', async () => {
  let run = await start()
  const { page, vault } = run
  const keep: string[] = [dirname(run.vault)]
  try {
    await openBoard(page, '冰岛十天环岛')
    // 第一次打开：顶上居中那条说明，右边 ×，没有「摆回原样」（没东西可摆）
    await expect(hint(page)).toHaveText('按「##」摆成列 · 挪动了才写进文件')
    await expect(hint(page).getByRole('button', { name: '摆回原样' })).toHaveCount(0)
    await expect(hint(page).getByRole('button', { name: '收起这条说明' })).toBeVisible()
    // 进场有过渡
    expect(await hint(page).evaluate((e) => getComputedStyle(e).animationName)).toBe('db-hint-in')
    // 不动它：几秒内还在，之后自己收起
    await page.waitForTimeout(2500)
    await expect(hint(page)).toBeVisible()
    await expect(hint(page)).toHaveCount(0, { timeout: 10_000 })
    // 关掉重开这块白板：不再出
    await reopen(page, '冰岛十天环岛')
    await page.waitForTimeout(800)
    await expect(hint(page)).toHaveCount(0)

    // 另一块白板：点 × 收起，收起时先淡出再拿掉
    await openBoard(page, '冰岛照片墙')
    await expect(board(page)).toBeVisible()
    await expect(hint(page)).toContainText('挪动了才写进文件')
    // 指着 × 时不计时：停 7 秒还在
    await hint(page).getByRole('button', { name: '收起这条说明' }).hover()
    await page.waitForTimeout(7000)
    await expect(hint(page)).toBeVisible()
    await hint(page).getByRole('button', { name: '收起这条说明' }).click()
    await expect(hint(page)).toHaveClass(/leaving/)
    await expect(hint(page)).toHaveCount(0)
    await reopen(page, '冰岛照片墙')
    await page.waitForTimeout(800)
    await expect(hint(page)).toHaveCount(0)

    // 普通文档切到白板：第一次操作（点一下画布空白）就收起
    await openBoard(page, '2026-W47')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(hint(page)).toContainText('挪动了才写进文件')
    const w = (await board(page).locator('.board-wrap').boundingBox())!
    await page.mouse.click(w.x + w.width - 80, w.y + w.height - 60)
    await expect(hint(page)).toHaveCount(0)
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page)).toBeVisible()
    await page.waitForTimeout(800)
    await expect(hint(page)).toHaveCount(0)

    // 记在本机：笔记文件一个字节没变，库里没有改动
    expect(readFileSync(join(vault, TRAVEL), 'utf8')).toBe(FILES[TRAVEL])
    expect(readFileSync(join(vault, '周记/2026-W47.md'), 'utf8')).toBe(FILES['周记/2026-W47.md'])
    expect(gitStatus(vault)).toBe('')

    // 重启软件（同一份本机设置）：还是不出
    const userData = run.userData
    await run.close({ keep: true })
    run = await start(FILES, { CN_USER_DATA: userData })
    keep.push(dirname(run.vault))
    await openBoard(run.page, '冰岛十天环岛')
    await expect(board(run.page)).toBeVisible()
    await run.page.waitForTimeout(800)
    await expect(hint(run.page)).toHaveCount(0)
  } finally {
    await run.close({ keep: true })
    for (const d of keep) rmSync(d, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('「1张卡离开了自己那一节」只在真有位置行时出：摆回原样后收起、⌘Z 和撤回都能回来；× 藏起后再挪一张又出来', async () => {
  const run = await start()
  const { page, vault } = run
  const file = () => readFileSync(join(vault, TRAVEL), 'utf8')
  try {
    await openBoard(page, '冰岛十天环岛')
    await expect(hint(page)).toContainText('挪动了才写进文件')
    // 挪一张卡离开它那一节：说明换成真有的事
    await dragOut(page, '出发前', '11 月白天', 420)
    await expect(board(page).locator('.db-card.placed')).toHaveCount(1)
    await expect(hint(page)).toHaveText('1张卡离开了自己那一节 · 文件里多了1行位置摆回原样')
    await expect(hint(page).getByRole('button', { name: '先藏起这条' })).toBeVisible()
    await waitSaved(page)
    expect(file()).toMatch(/<!-- card id=d1 x=\d+ y=\d+ -->\n11 月白天/)

    // 摆回原样：文件回到没有位置行，条子收起；底部提示带撤回
    await hint(page).getByRole('button', { name: '摆回原样' }).click()
    await expect(board(page).locator('.db-card.placed')).toHaveCount(0)
    await expect(hint(page)).toHaveCount(0)
    await expect(board(page).locator('.db-toast')).toContainText('摆回原样')
    await waitSaved(page)
    expect(file()).toBe(FILES[TRAVEL])
    // 没东西可摆时不出「摆回原样」
    await page.waitForTimeout(600)
    await expect(board(page).getByRole('button', { name: '摆回原样' })).toHaveCount(0)

    // ⌘Z：位置行回来，条子跟着回来
    await board(page).locator('.board-wrap').click({ position: { x: 600, y: 720 } })
    await page.keyboard.press('Meta+z')
    await expect(board(page).locator('.db-card.placed')).toHaveCount(1)
    await expect(hint(page)).toContainText('1张卡离开了自己那一节')
    await waitSaved(page)
    expect(file()).toMatch(/<!-- card id=d1 x=\d+ y=\d+ -->\n11 月白天/)
    // 再摆回去，这次点底部提示的「撤回」
    await hint(page).getByRole('button', { name: '摆回原样' }).click()
    await expect(hint(page)).toHaveCount(0)
    await board(page).locator('.db-toast').getByRole('button', { name: '撤回' }).click()
    await expect(board(page).locator('.db-card.placed')).toHaveCount(1)
    await expect(hint(page)).toContainText('1张卡离开了自己那一节')

    // × 先藏起：文件不动；关掉重开还藏着
    await waitSaved(page)
    const before = file()
    await hint(page).getByRole('button', { name: '先藏起这条' }).click()
    await expect(hint(page)).toHaveClass(/leaving/)
    await expect(hint(page)).toHaveCount(0)
    await page.waitForTimeout(600)
    expect(file()).toBe(before)
    await reopen(page, '冰岛十天环岛')
    await page.waitForTimeout(800)
    await expect(hint(page)).toHaveCount(0)

    // 再挪一张离开它那一节：又出来，说的是现在的数
    await dragOut(page, '住哪', '南岸在维克', 760)
    await expect(board(page).locator('.db-card.placed')).toHaveCount(2)
    await expect(hint(page)).toContainText('2张卡离开了自己那一节 · 文件里多了2行位置')
    await expect(hint(page).getByRole('button', { name: '摆回原样' })).toBeVisible()
  } finally {
    await run.close()
  }
})

/** 改前改后对照：CN_SHOTS_DIR 给了存那里，不给存 test-results/r19-shots/。只截图，不验收 */
const DIR = process.env.CN_SHOTS_DIR ?? join(__dirname, '../test-results/r19-shots')
for (const [tone, skin] of [
  ['light', 'sky'],
  ['dark', 'petrol'],
] as const) {
  test(`对照截图（${tone}）`, async () => {
    mkdirSync(DIR, { recursive: true })
    const run = await launch(FILES)
    const { page, app } = run
    const shoot = (name: string) => page.screenshot({ path: join(DIR, `${tone}-${name}.png`) })
    try {
      await page.evaluate((s) => window.cn.setSettings({ appearance: { followSystem: false, skin: s, frame: 'b' } }), skin)
      await page.reload()
      await page.locator('.vault b').waitFor()
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await openBoard(page, '冰岛十天环岛')
      await page.keyboard.press('Meta+Backslash')
      await expect(board(page)).toBeVisible()
      await page.waitForTimeout(500)
      await shoot('1-first-open')
      // 不动它等 8 秒
      await page.waitForTimeout(8000)
      await shoot('2-after-8s')
      await dragOut(page, '出发前', '11 月白天', 420)
      await expect(board(page).locator('.db-card.placed')).toHaveCount(1)
      await page.waitForTimeout(500)
      await shoot('3-card-moved-out')
      // 指着 ×（设计复审要的悬停样子；旧代码没有 × 就跳过）
      const x = board(page).locator('.db-hint .db-hint-x')
      if (await x.count()) {
        await x.hover()
        await page.waitForTimeout(700)
        await shoot('3b-hover-x')
        await page.mouse.move(10, 400)
      }
      await board(page).getByRole('button', { name: '摆回原样' }).click()
      await page.waitForTimeout(500)
      await shoot('4-after-reset')
    } finally {
      await run.close()
    }
  })
}
