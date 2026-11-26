/**
 * 剪藏去处规则的交付截图（/private/tmp/canvas-notes-visual/158-剪藏去处/ 的「去处规则（用户定）」一节）：地址栏小牌三种写法，
 * 网页占满着截（网页栏宽，小牌写字）：配对了写那篇、选过文件夹写文件夹名、都没有写收件箱。薄荷、深湖各一套。截图才跑：CN_SHOTS=<目录>
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, type Running } from './app'
import { openWeb } from './clip-web'
import { d2l, type D2l } from './fixtures/d2l-pandas'
import { skinned } from './fixtures/book-digest'

const SHOTS = process.env.CN_SHOTS
test.skip(!SHOTS, '截交付图才跑：CN_SHOTS=<目录>')
test.setTimeout(300_000)

let pandas: D2l
test.beforeAll(async () => {
  pandas = await d2l()
})
test.afterAll(() => pandas.close())

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(600)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS!, `${name}.png`), Buffer.from(b64, 'base64'))
}
const chip = (page: Page) => page.getByTestId('full-chip')
const menu = (page: Page) => page.getByRole('menu', { name: '剪到哪' })

for (const [skin, tag] of [['mint', '薄荷'], ['petrol', '深湖']] as const) {
  test(`截图：小牌三种写法（${tag}）`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const run = await launch({ '课程/读书笔记.md': '# 读书笔记\n\n第一段。\n', '网页摘录/.gitkeep': '' }, {}, skinned(skin))
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      await openNote(page, '读书笔记')
      await openWeb(page, pandas.pandas)
      await page.locator('.dhead:has([data-testid="dtab-web"]) .maxbtn').click()
      // 都没有：收件箱（中间开着《读书笔记》也不算）
      await expect(chip(page)).toHaveText(/^剪进 收件箱$/)
      await page.mouse.move(10, 400)
      await shot(run, `R3-都没有写收件箱-${skin}`)
      // 配对了：小牌里点那篇（同「记到这篇」，顺手配成一对）
      await chip(page).click()
      await menu(page).getByRole('menuitemradio', { name: /读书笔记/ }).click()
      await expect(chip(page)).toHaveText(/^记进 《读书笔记》$/)
      await page.mouse.move(10, 400)
      await shot(run, `R1-配对了写那篇-${skin}`)
      // 选过文件夹：放进一个文件夹… › 网页摘录
      await chip(page).click()
      await menu(page).getByRole('menuitem', { name: '放进一个文件夹…' }).click()
      const picker = page.getByRole('dialog', { name: '移到' })
      await picker.getByRole('searchbox', { name: '挪到哪个文件夹' }).fill('网页摘录')
      await picker.getByRole('menuitem', { name: /网页摘录/ }).click()
      await expect(chip(page)).toHaveText(/^剪进 网页摘录$/)
      await page.mouse.move(10, 400)
      await shot(run, `R2-选过文件夹写文件夹名-${skin}`)
    } finally {
      await run.close()
    }
  })
}
