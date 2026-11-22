// 网页标签配对小标的悬停截图（task-z5jh4）：浅色天青、深色深湖（B 浮岛书桌），A 补一张天青；宽网页栏悬停当前标签、悬停别的标签，窄网页栏（380）悬停当前标签。
// 每张存整窗和网页栏第一行放大的一截。改前改后各跑一次，拼成左右对照。
// 平时跳过：CN_SHOTS=<目录> CN_SHOTS_TAG=before|after npx playwright test e2e/w7-web-pair-mark-shots.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, rail, widenRight, type Running } from './app'
import { fakeBook, type FakeBook } from './fixtures/fake-book'

const SHOTS = process.env.CN_SHOTS
const TAG = process.env.CN_SHOTS_TAG ?? 'after'
test.skip(!SHOTS, '截图才跑：CN_SHOTS=<目录>')
test.setTimeout(5 * 60_000)

const NOTE = '课程/study project/学习笔记：动手学深度学习.md'

let book: FakeBook
test.beforeAll(async () => {
  book = await fakeBook()
  mkdirSync(SHOTS!, { recursive: true })
})
test.afterAll(() => book.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const addr = (page: Page) => web(page).getByRole('textbox', { name: '网址' })

async function go(page: Page, u: string) {
  await addr(page).click()
  await addr(page).fill(u)
  await addr(page).press('Enter')
  await expect(webTabs(page).filter({ has: page.locator('.wpm') }).last()).toBeVisible({ timeout: 15_000 })
  await addr(page).blur()
}

/** 整窗一张、网页栏第一行（往外多留一点）放大一张 */
async function shot(run: Running, name: string, below = 8) {
  await run.page.waitForTimeout(350)
  const row = (await web(run.page).getByTestId('web-row1').boundingBox())!
  const rect = { x: Math.round(row.x), y: Math.round(row.y - 8), width: Math.round(row.width), height: Math.round(row.height + 8 + below) }
  const [whole, part] = await run.app.evaluate(async ({ BrowserWindow }, rect) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents
    return [(await wc.capturePage()).toPNG().toString('base64'), (await wc.capturePage(rect)).toPNG().toString('base64')]
  }, rect)
  writeFileSync(join(SHOTS!, `${TAG}-${name}.png`), Buffer.from(whole, 'base64'))
  writeFileSync(join(SHOTS!, `${TAG}-${name}-row.png`), Buffer.from(part, 'base64'))
}

async function hover(page: Page, i: number) {
  const tb = (await webTabs(page).nth(i).boundingBox())!
  await page.mouse.move(tb.x + 14, tb.y + tb.height / 2)
}

for (const [frame, skin] of [
  ['b', 'sky'],
  ['b', 'petrol'],
  ['a', 'sky'],
] as const)
  test(`${frame.toUpperCase()} · ${skin}`, async () => {
    const run = await launch({ [NOTE]: `---\nread-along: ${book.base}/\n---\n# 学习笔记：动手学深度学习\n\n记一句。\n`, '课程/study project/x.md': '# x\n\n随手记。\n' }, {}, (v) => {
      const ud = join(dirname(v), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame } }))
    })
    const { page } = run
    try {
      await openNote(page, 'x')
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      await go(page, `${book.base}/chapter_preliminaries/ndarray.html`)
      await web(page).getByRole('button', { name: '新网页' }).click()
      await go(page, `${book.base}/chapter_preliminaries/pandas.html`)
      await widenRight(page, 240)
      const k = `${frame}-${skin}`
      await hover(page, 1)
      await shot(run, `${k}-wide-cur`)
      if (frame === 'a') return
      await hover(page, 0)
      await shot(run, `${k}-wide-other`)
      // 指着小标：悬停提示（0.4 秒后出）
      await webTabs(page).nth(1).locator('.wpm').hover()
      await page.waitForTimeout(900)
      await shot(run, `${k}-wide-tip`, 48)
      await widenRight(page, -240)
      await expect(web(page)).toHaveClass(/w-narrow/)
      await hover(page, 1)
      await shot(run, `${k}-narrow-cur`)
      await webTabs(page).nth(0).locator('.wpm').hover()
      await page.waitForTimeout(900)
      await shot(run, `${k}-narrow-tip`, 48)
      // 窄栏只剩一个标签：地址块吃掉空位
      await webTabs(page).nth(1).hover()
      await webTabs(page).nth(1).getByRole('button', { name: '关闭网页标签' }).click()
      await expect(webTabs(page)).toHaveCount(1)
      await hover(page, 0)
      await shot(run, `${k}-narrow-one`)
    } finally {
      await run.close()
    }
  })
