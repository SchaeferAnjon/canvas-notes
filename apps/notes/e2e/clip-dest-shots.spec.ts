/**
 * 剪藏去处的交付截图（/private/tmp/canvas-notes-visual/158-剪藏去处/）：同剪藏统计实测 B 的场景（中间开着 剪藏/视频 的文件夹首页，
 * 网站已经记进《读书笔记》），薄荷、深湖各一套：弹窗三种、选文件夹（新建）、选好以后、地址栏小牌、文件夹首页那一项。
 * 截图才跑：CN_SHOTS=<目录>
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, leftView, openNote, pane, type Running, widenRight } from './app'
import { openPickTarget, openWeb, pressInPage, selectPara, toast, web } from './clip-web'
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

const dlg = (page: Page) => page.getByRole('dialog', { name: '记到哪篇' })
const picker = (page: Page) => page.getByRole('dialog', { name: '移到' })
const chip = (page: Page) => page.getByTestId('full-chip')


for (const [skin, tag] of [['mint', '薄荷'], ['petrol', '深湖']] as const) {
  test(`截图：剪藏去处（${tag}）`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const run = await launch({ '课程/读书笔记.md': '# 读书笔记\n\n第一段。\n', '剪藏/视频/P1 机器学习的应用.md': '---\ntype: video\n---\n# P1 机器学习的应用\n\n字幕。\n' }, {}, skinned(skin))
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      await openNote(page, '读书笔记')
      await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
      await page.keyboard.press('End')
      await openWeb(page, pandas.pandas)
      // 右栏拉到 470 以上（默认那一档窄于 470，小牌只剩图标，最后一张截那个样子）
      await widenRight(page, 140)
      await selectPara(page, 'p1')
      await pressInPage(run, 'S', ['meta'])
      await dlg(page).getByRole('button', { name: /记到这篇/ }).click()
      await expect(toast(page)).toContainText('剪进《读书笔记》')

      // 中间换成 剪藏/视频 的文件夹首页（同截图那一下）
      await leftView(page, '文件')
      const tree = page.getByRole('tree', { name: '全部文件' })
      const open = tree.getByRole('button', { name: '展开 剪藏' })
      if (await open.count()) await open.click()
      await tree.locator('[data-path="剪藏/视频"]').first().click()
      await expect(chip(page)).toHaveText(/^记进 读书笔记$/)
      await shot(run, `1-胶囊记进读书笔记-${skin}`)

      // ⋯ › 剪到哪篇…：读书笔记（选的）、剪成卡片放进收件箱、放进一个文件夹…
      await selectPara(page, 'p2')
      await openPickTarget(page)
      await expect(dlg(page)).toBeVisible()
      await shot(run, `2-弹窗三种-${skin}`)
      await dlg(page).getByRole('radio', { name: /放进一个文件夹/ }).click()
      await expect(picker(page)).toBeVisible()
      await shot(run, `3-选文件夹-${skin}`)
      await picker(page).getByRole('menuitem', { name: '新建文件夹…' }).click()
      await picker(page).getByRole('textbox', { name: '新文件夹的名字' }).fill('网页摘录')
      await shot(run, `4-新建文件夹-${skin}`)
      await picker(page).getByRole('textbox', { name: '新文件夹的名字' }).press('Enter')
      await expect(dlg(page).getByRole('radio', { name: /网页摘录/ })).toHaveAttribute('aria-checked', 'true')
      await shot(run, `5-选好文件夹-${skin}`)
      await dlg(page).locator('.wh-go').click()
      await expect(chip(page)).toHaveText(/^剪进 网页摘录$/)
      await selectPara(page, 'p2')
      await pressInPage(run, 'S', ['meta'])
      await expect(toast(page)).toContainText('剪成卡片，放进「网页摘录」了')
      await shot(run, `6-剪进文件夹-${skin}`)

      // 地址栏小牌点开：中间开着 剪藏/视频 首页，多一项「放进这个文件夹」
      await chip(page).click()
      await expect(page.getByRole('menu', { name: '剪到哪' })).toBeVisible()
      await shot(run, `7-文件夹首页那一项-${skin}`)
      await page.getByRole('menu', { name: '剪到哪' }).getByRole('menuitemradio', { name: '剪成卡片，放进收件箱' }).click()
      await expect(chip(page)).toHaveText(/^剪进 收件箱$/)
      await page.mouse.move(10, 400)
      await shot(run, `8-胶囊收件箱-${skin}`)
      // 网页栏窄于 470（右栏默认）：小牌只剩一颗图标，引号收进 ⋯；指着它看写着剪到哪
      await widenRight(page, -140)
      await expect(web(page)).toHaveClass(/w-narrow/)
      await chip(page).hover()
      await shot(run, `9-窄网页栏只剩图标-${skin}`)
      // 网页占满（网页栏 720 以上同样）：小牌写字「剪进 收件箱」
      await page.locator('.dhead:has([data-testid="dtab-web"]) .maxbtn').click()
      await expect(web(page)).toHaveClass(/w-wide/)
      await page.mouse.move(10, 400)
      await shot(run, `10-网页占满写字-${skin}`)
    } finally {
      await run.close()
    }
  })
}
