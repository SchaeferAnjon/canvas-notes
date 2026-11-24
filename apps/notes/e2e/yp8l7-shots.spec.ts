/**
 * 交付图（task-yp8l7：配对笔记每一节带上框的那块截图、白板看法显示全）。只在截图时跑：CN_SHOTS=目录；
 * CN_SHOT_LOOK=island 是 B 浮岛书桌 + 极光背景图（不给是浅色天青、A 风格）；CN_SHOT_TAG 加在文件名前（改前截 before）。
 * 1 白板看法（一篇十几节的长配对笔记）；2 文档看法那一节；3 读 PDF 右栏笔记那一节。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, openNote, pane, rail, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { PAIRED_MD, PAIRED_NOTE, PAIRED_PDF } from './fixtures/paired-long'

const DIR = process.env.CN_SHOTS
const LOOK = process.env.CN_SHOT_LOOK === 'island' ? 'island' : 'light'
const TAG = process.env.CN_SHOT_TAG ? `${process.env.CN_SHOT_TAG}-` : ''
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
test.setTimeout(240_000)

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame: LOOK === 'island' ? 'b' : 'a', ...(LOOK === 'island' ? { winBg: 'aurora' } : {}) } }))
}

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(600)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${TAG}${name}-${LOOK}.png`), Buffer.from(b64, 'base64'))
}

const board = (page: Page) => pane(page).getByTestId('doc-board')

test('白板看法：长配对笔记', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ [PAIRED_PDF]: LECTURE, [PAIRED_NOTE]: PAIRED_MD }, {}, look)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '第3讲 笔记')
    await expect(pane(page).locator('.cm-content')).toContainText('驾驶压力')
    if (TAG !== 'before-') {
      // 打开配对笔记时补上以前缺的截图，文档里那一节第一问上面出图
      await expect.poll(() => readFileSync(join(run.vault, PAIRED_NOTE), 'utf8').split('![我框的|').length - 1, { timeout: 20_000 }).toBe(12)
      await expect(pane(page).locator('.cm-image img.jump').first()).toBeVisible()
      await pane(page).locator('.cm-image img.jump').first().evaluate((e) => e.scrollIntoView({ block: 'center' }))
      await page.mouse.move(1, 1)
    }
    await shot(run, 'doc')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page)).toBeVisible()
    await shot(run, 'board')
    if (TAG !== 'before-') {
      // 读 PDF 时右栏「笔记」
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
      await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
      await expect(tabOn(page)).toHaveText('第3讲.pdf')
      const notes = page.getByRole('complementary', { name: '笔记', exact: true })
      if (!(await notes.isVisible())) await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
      await expect(notes.locator('.crop img').first()).toBeVisible()
      await expect(notes.getByTestId('crop-filled')).toContainText('补上了 12 张截图；1 条当时没记下框的位置，补不了')
      await shot(run, 'panel')
    }
  } finally {
    await run.close()
  }
})

test('现问：拖框问一块、选字问一段，右栏笔记里的图和原文；文档里点图回 PDF 框闪', async () => {
  test.skip(TAG === 'before-', '改前没有')
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ [PAIRED_PDF]: LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' }, look)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    const pg = (n: number) => page.locator(`.pdfpane:not([hidden]) .pdfpage[data-page="${n}"]`)
    await expect(pg(1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    await page.keyboard.press('Meta+j')
    await expect(ai.getByTestId('reading-sees')).toContainText('读过全文5页')
    // 选字问：第 1 页第二行
    const span = pg(1).locator('.textLayer span').nth(1)
    const sb = (await span.boundingBox())!
    await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
    await page.mouse.up()
    await page.getByRole('toolbar', { name: '框好的这块' }).getByRole('button', { name: '翻译 + 讲一讲' }).click()
    await expect(ai.getByTestId('reading-msg').nth(0).getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    // 拖框问：第 3 页那张图
    await pg(3).scrollIntoViewIfNeeded()
    const r = (await pg(3).boundingBox())!
    await page.mouse.move(r.x + r.width * 0.46, r.y + r.height * 0.45)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width * 0.91, r.y + r.height * 0.74, { steps: 6 })
    await page.mouse.up()
    await expect(ai.getByTestId('reading-att').locator('img')).toBeVisible()
    await page.getByRole('toolbar', { name: '框好的这块' }).getByRole('button', { name: '讲解一下' }).click()
    await expect(ai.getByTestId('reading-msg').nth(1).getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const notes = page.getByRole('complementary', { name: '笔记', exact: true })
    await expect(notes.locator('.crop img').first()).toBeVisible()
    // 第一次开两个标签时的提示「想两样一起看？拖标签」收起来，不挡 PDF
    if (await page.getByTestId('dock-hint').isVisible()) await page.getByTestId('dock-hint').getByRole('button', { name: '关掉' }).click()
    await page.mouse.move(1, 1)
    await shot(run, 'ask-panel')
    // 选字问那一节展开看原文
    const fold = notes.getByTestId('note-round').filter({ hasText: '第1页' }).locator('.fh')
    if (await fold.count()) await fold.click()
    await expect(notes.locator('.nquote')).toBeVisible()
    await shot(run, 'ask-quote')
    // 文档看法里点图：回到 PDF 第 3 页，框闪一下
    await openNote(page, '第3讲 笔记')
    const img = pane(page).locator('.cm-image img.jump').first()
    await img.scrollIntoViewIfNeeded()
    await img.click()
    await expect(page.locator('.pdfpane:not([hidden])').getByTestId('pdf-flash')).toBeVisible()
    await page.waitForTimeout(150)
    await shot(run, 'jump')
  } finally {
    await run.close()
  }
})
