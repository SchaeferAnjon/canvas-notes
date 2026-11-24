/**
 * 书桌回到刚才的截图（交付页 84-书桌回到刚才）：CN_SHOTS=<文件夹> 时存图，不设只跑一遍。
 * 薄荷、浮岛书桌：在 A 篇里读那本书 → 左栏「书桌」点「读书」→ 底栏「已切到书桌「读书」· 回到刚才」、最上面那张「刚才」
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, rail } from './app'
import { shot } from './aph2j-look'
import { fakeBook, type FakeBook } from './fixtures/fake-book'

const A = '课程/学习笔记：动手学深度学习.md'
const B = '课程/小论文计划.md'

let book: FakeBook
let other: FakeBook
test.beforeAll(async () => {
  book = await fakeBook()
  other = await fakeBook()
})
test.afterAll(async () => {
  await book.close()
  await other.close()
})

const LOOKS = [
  { name: '薄荷', skin: 'mint', winBg: 'wall' },
  { name: '薄荷-极光', skin: 'mint', winBg: 'aurora' },
  { name: '松林', skin: 'pine', winBg: 'wall' },
]
for (const look of LOOKS)
test(`${look.name} · 浮岛书桌：切到书桌后底栏那句和最上面那张「刚才」`, async () => {
  test.setTimeout(120_000)
  const run = await launch({ [A]: '# 学习笔记：动手学深度学习\n\n张量 = n 维数组。\n\n## 2.3 线性代数\n\n矩阵的形状是 (m, n)。\n', [B]: '# 小论文计划\n\n先读两本书。\n' }, {}, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: look.skin, frame: 'b', winBg: look.winBg, wallMix: 'mid', wallMove: false } }))
  })
  const { page } = run
  const web = page.getByRole('complementary', { name: '网页' })
  const addr = web.getByRole('textbox', { name: '网址' })
  const go = async (u: string) => {
    await addr.click()
    await addr.fill(u)
    await addr.press('Enter')
  }
  const desks = page.locator('aside.side[aria-label="书桌"]')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    const toggle = tree.getByRole('button', { name: '展开 课程' })
    if (await toggle.count()) await toggle.click()
    await tree.locator(`[data-path="${B}"]`).click()
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    await go(`${other.base}/`)
    await leftView(page, '书桌')
    await desks.getByRole('button', { name: '把现在的样子存成书桌' }).click()
    const dlg = page.getByRole('dialog', { name: '存成书桌' })
    await dlg.getByRole('textbox', { name: '书桌的名字' }).fill('读书')
    await dlg.getByRole('switch', { name: /开着时自动记下改动/ }).click()
    await dlg.getByRole('button', { name: '存成书桌', exact: true }).click()

    await leftView(page, '文件')
    await tree.locator(`[data-path="${A}"]`).click()
    await go(`${book.base}/chapter_preface/index.html`)
    await page.waitForTimeout(800)
    await leftView(page, '书桌')
    await desks.getByRole('button', { name: /^书桌「读书」/ }).click()
    await expect(page.getByTestId('desk-away')).toContainText('已切到书桌「读书」')
    await expect(desks.getByRole('listitem').first()).toContainText('刚才')
    await page.mouse.move(700, 400)
    await shot(run, `${look.name}-切完1秒内`)
    // 底栏正中的提示收掉再拍（只剩左边「已切到书桌」那句）
    await page.waitForTimeout(6500)
    await shot(run, `${look.name}-切到书桌后`)
    await desks.locator('.desk-before').hover()
    await page.waitForTimeout(300)
    await shot(run, `${look.name}-指着刚才那张`)
  } finally {
    await run.close()
  }
})
