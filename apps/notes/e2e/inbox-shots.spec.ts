/**
 * 收件箱三条（白板回车、费曼看白板、速记）的对照图：CN_SHOTS=<目录> npx playwright test e2e/inbox-shots.spec.ts。
 * 修之前、修之后各跑一次，交付页并排放。没给 CN_SHOTS 不跑。
 */
import { expect, type ElectronApplication, test } from '@playwright/test'
import { join } from 'node:path'
import { BRAND } from '../src/shared/brand'
import { acts, launch, openNote, pane } from './app'
import { board, openBoard } from './fixtures/board-doc'
import { feynmanFiles } from './fixtures/feynman'
import { BOARD as INK_BOARD, BOARD_PATH as INK_BOARD_PATH, INK, INK_PATH } from './ink-samples'

const SHOTS = process.env.CN_SHOTS
test.skip(!SHOTS, '给 CN_SHOTS=<目录> 才截图')
const out = (name: string) => join(SHOTS!, name + '.png')

test('白板：引文卡末尾回车、待办卡最后回车，点别处以后的样子', async () => {
  const run = await launch({ '回车.md': '# 回车\n\n## 第一节\n\n> 一段引文\n\n- [ ] 买菜\n- [ ] 买米\n' })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 760))
    await openNote(page, '回车')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const b = pane(page).getByTestId('doc-board')
    const ed = b.locator('.card-edit .cm-content')
    await b.locator('.db-card', { hasText: '一段引文' }).dblclick()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('第二行')
    await b.click({ position: { x: 5, y: 5 } })
    await expect(ed).toHaveCount(0)
    await b.locator('.db-card', { hasText: '买米' }).dblclick({ position: { x: 30, y: 8 } })
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('买油')
    await page.keyboard.press('Enter')
    await b.click({ position: { x: 5, y: 5 } })
    await expect(ed).toHaveCount(0)
    await page.waitForTimeout(1200)
    await page.screenshot({ path: out('1-board-enter') })
  } finally {
    await run.close()
  }
})

test('费曼：什么都没选时的小框、AI 分成几个点时的单子', async () => {
  const run = await launch({ ...feynmanFiles('http://127.0.0.1:9'), [INK_BOARD_PATH]: INK_BOARD, [INK_PATH]: INK }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openBoard(page, '组会白板')
    await board(page).getByTestId('pal-feynman').click()
    await expect(page.getByTestId('fy-start')).toBeVisible()
    await page.waitForTimeout(400)
    await page.screenshot({ path: out('2-feynman-pop') })
    const items = page.getByTestId('fy-start-items').getByRole('button')
    await items.first().click()
    // 新的「整块白板」；以前点的是第一列「方向」
    await expect(pane(page).getByTestId('fy-pick-item').first().or(pane(page).getByTestId('fy-col'))).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(600)
    await page.screenshot({ path: out('3-feynman-pick') })
  } finally {
    await run.close()
  }
})

test('速记：前台就是画布笔记、笔记里选了一句', async () => {
  const run = await launch({ '游记.md': '# 游记\n\n速记要带上的这一句。\n\n别的一段。\n' })
  const { app, page } = run
  try {
    await openNote(page, '游记')
    await pane(page).locator('.cm-line', { hasText: '速记要带上的这一句' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
    const q = await quick(app)
    await expect(q.getByRole('textbox', { name: '速记内容' })).toBeVisible()
    await page.waitForTimeout(600)
    await q.screenshot({ path: out('4-quick-self') })
  } finally {
    await run.close()
  }
})

async function quick(app: ElectronApplication) {
  const front = { name: BRAND.name, bundle: BRAND.appId }
  const [w] = await Promise.all([
    app.waitForEvent('window', (p) => p.url().endsWith('/quick.html')),
    app.evaluate((_e, f) => (globalThis as unknown as { cnQuick: { show(t: unknown): Promise<void> } }).cnQuick.show({ front: f }), front),
  ])
  await w.waitForLoadState()
  return w
}
