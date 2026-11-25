/**
 * 剪藏两个毛病修好以后的对照截图（交付页 /private/tmp/canvas-notes-visual/150-剪藏两个毛病/）：同 clip-inbox-same 的流程，每步截一张。
 * 修以前的那几张是剪藏入口统计（design/clip-survey/img/B3、B4、C1）。
 */
import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, type Running } from './app'
import { armMenus, pickMenu, openedMenu } from './menu'
import { d2l, type D2l } from './fixtures/d2l-pandas'
import { d2lConv, type D2lSite } from './fixtures/d2l-conv'
import { clipTip, flashed, guest, inboxFiles, metaClickText, openPickTarget, openWeb, pressInPage, selectPara, toast, web } from './clip-web'

const DIR = '/private/tmp/canvas-notes-visual/150-剪藏两个毛病/img'
mkdirSync(DIR, { recursive: true })
test.setTimeout(180_000)

let pandas: D2l
let conv: D2lSite
test.beforeAll(async () => {
  pandas = await d2l()
  conv = await d2lConv()
})
test.afterAll(async () => {
  await pandas.close()
  await conv.close()
})

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(500)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR, `${name}.png`), Buffer.from(b64, 'base64'))
}

test('截图：剪到哪篇选收件箱', async () => {
  const run = await launch({ '课程/读书笔记.md': '# 读书笔记\n\n第一段。\n', '剪藏/视频/P1 机器学习的应用.md': '---\ntype: video\n---\n# P1 机器学习的应用\n\n字幕。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '读书笔记')
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await page.keyboard.press('End')
    await openWeb(page, pandas.pandas)
    await selectPara(page, 'p1')
    await pressInPage(run, 'S', ['meta'])
    const dlg = page.getByRole('dialog', { name: '记到哪篇' })
    await dlg.getByRole('button', { name: /记到这篇/ }).click()
    await expect(toast(page)).toContainText('剪进《读书笔记》')

    await selectPara(page, 'p2')
    await openPickTarget(page)
    await dlg.getByRole('radio', { name: /放进收件箱/ }).click()
    await shot(run, 'A1-剪到哪篇选收件箱')
    await dlg.locator('.wh-go').click()
    await expect(toast(page)).toContainText('这个网站以后剪进收件箱')
    await shot(run, 'A2-底栏说以后剪进收件箱')

    await selectPara(page, 'p2')
    await clipTip(page)
    await shot(run, 'A3-小条提示剪成卡片')
    await pressInPage(run, 'S', ['meta'])
    await expect(toast(page)).toContainText('剪成卡片，放进收件箱了')
    await expect.poll(() => inboxFiles(vault).length).toBe(1)
    await shot(run, 'A4-接着剪进了收件箱')

    await selectPara(page, 'p1')
    const more = await guest<{ x: number; y: number }>(page, `(() => { const b = document.getElementById('cn-clip-host').shadowRoot.querySelector('button[data-k="__more"]').getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 } })()`)
    const w = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.click(w.x + more.x, w.y + more.y)
    await shot(run, 'A5-更多菜单写着收件箱')
  } finally {
    await run.close()
  }
})

test('截图：右键剪成卡片', async () => {
  const run = await launch({ '随手.md': '# 随手\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openWeb(page, conv.url)
    await selectPara(page, 'p2')
    const w = (await web(page).locator('webview.on').boundingBox())!
    const r = await guest<{ x: number; y: number }>(page, `(() => { const t = document.getElementById('p2').firstChild; const g = document.createRange(); g.setStart(t, 0); g.setEnd(t, 1); const b = g.getBoundingClientRect(); return { x: b.right + 2, y: b.top + b.height / 2 } })()`)
    await page.mouse.click(w.x + r.x, w.y + r.y, { button: 'right' })
    await openedMenu(run)
    await pickMenu(run, '剪成卡片')
    await expect.poll(() => inboxFiles(vault).length).toBe(1)
    await guest(page, 'getSelection().removeAllRanges(); window.scrollTo(0, document.body.scrollHeight)')
    await openNote(page, inboxFiles(vault)[0]!.replace(/\.md$/, ''))
    await metaClickText(page, '动手学')
    await expect.poll(() => flashed(page), { timeout: 8000 }).toBeGreaterThan(0)
    await shot(run, 'B1-右键卡片点来源回到那段')
  } finally {
    await run.close()
  }
})
