// 网页标签上指着哪儿只出一个提示（task-4emge）的截图：浅色天青、深色深湖（B 浮岛书桌）。
// 指着当前标签的配对小标、指着当前标签的地址块、指着别的标签的名字、指着别的标签的小标，各存整窗和网页栏第一行往下多留一截的放大图。
// 原生 title 的提示是系统画的，截不进窗口里：每张旁边存一份 json，记下那一刻按浏览器规矩会出的所有提示（原生的 + 自绘的）。
// 平时跳过：CN_SHOTS=<目录> npx playwright test e2e/w8-web-tab-tips-shots.spec.ts
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, openNote, rail, widenRight, type Running } from './app'
import { fakeBook, type FakeBook } from './fixtures/fake-book'

const SHOTS = process.env.CN_SHOTS
test.skip(!SHOTS, '截图才跑：CN_SHOTS=<目录>')
test.setTimeout(3 * 60_000)

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
  await expect(
    webTabs(page)
      .filter({ has: page.locator('.wpm') })
      .last(),
  ).toBeVisible({ timeout: 15_000 })
  await addr(page).blur()
}

/** 指着 l 的正中（先从标签左边进来，和人一样），停 0.9 秒，存整窗、第一行放大图和那一刻的提示清单 */
async function shotAt(run: Running, l: Locator, name: string) {
  const { page } = run
  const b = (await l.boundingBox())!
  const [x, y] = [b.x + b.width / 2, b.y + b.height / 2]
  await page.mouse.move(x, y, { steps: 4 })
  await page.waitForTimeout(900)
  const tips = await page.evaluate(
    ([x, y]) => {
      const native = document.elementFromPoint(x!, y!)?.closest('[title]')?.getAttribute('title')
      return [...(native ? [`原生：${native}`] : []), ...[...document.querySelectorAll('[data-testid="tooltip"]')].map((e) => `自绘：${(e as HTMLElement).innerText}`)]
    },
    [x, y],
  )
  const row = (await web(page).getByTestId('web-row1').boundingBox())!
  // 提示往左伸出网页栏时（别的标签在最左边）放大图跟着往左多留，提示整个截进来
  const tip = await page.getByTestId('tooltip').first().boundingBox()
  const left = Math.round(Math.min(row.x, tip ? tip.x - 8 : row.x))
  const rect = {
    x: left,
    y: Math.round(row.y - 8),
    width: Math.round(row.x + row.width - left),
    height: Math.round(row.height + 8 + 56),
  }
  const [whole, part] = await run.app.evaluate(async ({ BrowserWindow }, rect) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents
    return [(await wc.capturePage()).toPNG().toString('base64'), (await wc.capturePage(rect)).toPNG().toString('base64')]
  }, rect)
  writeFileSync(join(SHOTS!, `${name}.png`), Buffer.from(whole, 'base64'))
  writeFileSync(join(SHOTS!, `${name}-row.png`), Buffer.from(part, 'base64'))
  writeFileSync(join(SHOTS!, `${name}.json`), JSON.stringify({ tips }, null, 1))
}

for (const skin of ['sky', 'petrol'] as const)
  test(`B · ${skin}`, async () => {
    const run = await launch(
      {
        [NOTE]: `---\nread-along: ${book.base}/\n---\n# 学习笔记：动手学深度学习\n\n记一句。\n`,
        '课程/study project/x.md': '# x\n\n随手记。\n',
      },
      {},
      (v) => {
        const ud = join(dirname(v), 'user-data')
        mkdirSync(ud, { recursive: true })
        writeFileSync(
          join(ud, 'settings.json'),
          JSON.stringify({
            appearance: { followSystem: false, skin, frame: 'b' },
          }),
        )
      },
    )
    const { page } = run
    try {
      await openNote(page, 'x')
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      await go(page, `${book.base}/chapter_preliminaries/ndarray.html`)
      await web(page).getByRole('button', { name: '新网页' }).click()
      await go(page, `${book.base}/chapter_preliminaries/pandas.html`)
      await widenRight(page, 240)
      const cur = webTabs(page).nth(1)
      const other = webTabs(page).nth(0)
      const cb = (await cur.boundingBox())!
      await page.mouse.move(cb.x + 14, cb.y + cb.height / 2)
      await shotAt(run, cur.locator('.wpm'), `${skin}-1-cur-mark`)
      await shotAt(run, cur.locator('.adisp'), `${skin}-2-cur-addr`)
      await shotAt(run, cur.locator('.wpm'), `${skin}-3-cur-mark-again`)
      const ob = (await other.boundingBox())!
      await page.mouse.move(ob.x + 14, ob.y + ob.height / 2)
      await shotAt(run, other.locator('.tl'), `${skin}-4-other-name`)
      await shotAt(run, other.locator('.wpm'), `${skin}-5-other-mark`)
    } finally {
      await run.close()
    }
  })
