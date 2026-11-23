// 对照截图（r82，task-2onrm）：读 PDF 的缩放「100% ▾」、适合宽度 / 200% / 适合整页、捏合放大后框和标记还对齐。
// 天青 / 深湖，1440 × 887 窗口，真软件、临时库、假 AI。
// 只在给了 CN_SHOTS=<目录> 时跑：CN_SHOTS=/private/tmp/canvas-notes-build4/2onrm/shots npx playwright test e2e/r82-zoom-shots.spec.ts
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, rail, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { armMenus, pickMenu } from './menu'

const DIR = process.env.CN_SHOTS
test.skip(!DIR, '对照截图：CN_SHOTS=<目录> 才跑')
test.setTimeout(180_000)

const PDF = '课程/线代/第3讲 线性映射.pdf'
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const pill = (page: Page) => acts(page).getByTestId('pdf-zoom')

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}.png`), Buffer.from(b64, 'base64'))
}

async function drag(page: Page, a: [number, number], b: [number, number]) {
  const p = (await pdfPage(page, 1).boundingBox())!
  await page.keyboard.down('Meta')
  await page.mouse.move(p.x + p.width * a[0], p.y + p.height * a[1])
  await page.mouse.down()
  await page.mouse.move(p.x + p.width * b[0], p.y + p.height * b[1], { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Meta')
}

for (const [skin, name] of [
  ['sky', '天青'],
  ['petrol', '深湖'],
] as const) {
  test(`读 PDF 缩放对照图：${name}`, async () => {
    mkdirSync(DIR!, { recursive: true })
    const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' }, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame: 'b', winBg: 'aurora' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
      await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
      await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
      await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
      await rail(page).getByRole('button', { name: '打开 AI' }).click()
      await expect(ai(page)).toBeVisible()
      // 问过一处：页边有标记
      await drag(page, [0.1, 0.12], [0.75, 0.2])
      await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
      await expect(ai(page).getByTestId('reading-msg').last().locator('.noted')).toContainText('已记进笔记', { timeout: 20_000 })
      await expect(page.getByTestId('toast')).toHaveCount(0, { timeout: 15_000 })
      // ① 适合宽度，指着「100% ▾」出提示
      await pill(page).hover()
      await shot(run, `1-适合宽度-提示-${skin}`)
      await page.mouse.move(700, 600)
      // ② 菜单点 200%：纸比栏宽，左右能滚
      await armMenus(run)
      await pill(page).click()
      await pickMenu(run, '200%')
      await expect(pill(page)).toHaveText('200%')
      await expect(pdfPage(page, 1).locator('canvas[data-scale="2"]')).toBeAttached()
      await page.mouse.move(700, 600)
      await shot(run, `2-200%-${skin}`)
      // ③ 适合整页（⇧⌘1）
      await pdfPane(page).getByTestId('pdf-view').focus()
      await page.keyboard.press('Shift+Meta+Digit1')
      await page.waitForTimeout(300)
      await shot(run, `3-适合整页-${skin}`)
      // ④ 适合宽度，框一块（小条出来），在框上捏合放大：框、小条、标记跟着走
      await page.keyboard.press('Meta+Digit0')
      await page.waitForTimeout(300)
      await drag(page, [0.12, 0.3], [0.6, 0.4])
      const pb = (await pdfPane(page).getByTestId('pdf-box').boundingBox())!
      await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
      await page.keyboard.down('Control')
      for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -8)
      await page.keyboard.up('Control')
      await page.waitForTimeout(600)
      await shot(run, `4-捏合放大后-${skin}`)
    } finally {
      await run.close()
    }
  })
}
