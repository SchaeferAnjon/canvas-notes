/**
 * 交付图（配对笔记白板分列）。只在截图时跑：CN_SHOTS=目录；CN_SHOT_SKIN=petrol 截深湖（不给是薄荷）；CN_SHOT_TAG 加在文件名前（改前截 before）。
 * CN_PBC_REAL=<文件夹>：用户那篇真配对笔记的副本（文件夹里放「<名字> 笔记.md」和那份 PDF，不进仓库），不给就只截造的样本。
 * 1 真笔记切到白板；2 样本（多问、旁支、划线、框的图）切到白板；3 平移到最右那一列（白板能往右拖出空白）。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, openNote, pane, type Running } from './app'
import { LECTURE } from './fixtures/pdf'
import { solidPng } from './fixtures/png'
import { PB_CROP, PB_EIGHT, PB_MD, PB_NOTE, PB_PDF } from './fixtures/paired-board'

const DIR = process.env.CN_SHOTS
const SKIN = process.env.CN_SHOT_SKIN === 'petrol' ? 'petrol' : 'mint'
const TAG = process.env.CN_SHOT_TAG ? `${process.env.CN_SHOT_TAG}-` : ''
const REAL = process.env.CN_PBC_REAL
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')
test.setTimeout(240_000)

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: SKIN, frame: 'b', winBg: 'aurora' } }))
}

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(800)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${TAG}${name}-${SKIN}.png`), Buffer.from(b64, 'base64'))
}

const board = (page: Page) => pane(page).getByTestId('doc-board')

async function toBoard(run: Running, title: string, zoom?: string) {
  const { page } = run
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await openNote(page, title)
  await acts(page).getByRole('tab', { name: '白板' }).click()
  await expect(board(page)).toBeVisible()
  if (zoom) {
    await page.keyboard.press('Meta+0')
    for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+Minus')
  }
  await page.mouse.move(1, 1)
}

test('真笔记切到白板', async () => {
  test.skip(!REAL, '没给真笔记的副本（CN_PBC_REAL）')
  mkdirSync(DIR!, { recursive: true })
  const files: Record<string, Buffer> = {}
  for (const f of readdirSync(REAL!)) files[`课程/study project 2/${f}`] = readFileSync(join(REAL!, f))
  const note = readdirSync(REAL!).find((f) => f.endsWith(' 笔记.md'))!
  const run = await launch(files, {}, look)
  try {
    await toBoard(run, note.replace(/\.md$/, ''))
    await shot(run, '1-real-board')
    // 用户那张图的样子：64%，想把右下角的费曼那一列拉到正中（按住空格往左上拖）
    await run.page.keyboard.press('Meta+0')
    for (let i = 0; i < 4; i++) await run.page.keyboard.press('Meta+Minus')
    await run.page.waitForTimeout(400)
    await shot(run, '3a-real-67')
    const fy = (await board(run.page).locator('[data-testid="fy-col"]').boundingBox())!
    const wrap = (await board(run.page).locator('.board-wrap').boundingBox())!
    await board(run.page).focus()
    await run.page.keyboard.down('Space')
    // 按住费曼那一列的列头（露在画面里的那一截）拖到画面正中
    const from = { x: Math.min(fy.x + fy.width / 2, wrap.x + wrap.width - 20), y: Math.min(fy.y + 20, wrap.y + wrap.height - 20) }
    await run.page.mouse.move(from.x, from.y)
    await run.page.mouse.down()
    await run.page.mouse.move(from.x - (fy.x + fy.width / 2 - (wrap.x + wrap.width / 2)), from.y - (fy.y + fy.height / 2 - (wrap.y + wrap.height / 2)), { steps: 12 })
    await run.page.mouse.up()
    await run.page.keyboard.up('Space')
    await run.page.mouse.move(1, 1)
    await shot(run, '3-real-pan-feynman')
  } finally {
    await run.close()
  }
})

test('样本切到白板', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ [PB_PDF]: LECTURE, [PB_NOTE]: PB_MD, [PB_CROP]: solidPng(480, 160, [222, 232, 246]) }, {}, look)
  try {
    await toBoard(run, '第3讲 笔记')
    await shot(run, '2-sample-board')
  } finally {
    await run.close()
  }
})

test('8 问的配对笔记：一行往右排，第 7、8 列完整显示', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch({ [PB_PDF]: LECTURE, [PB_NOTE]: PB_EIGHT }, {}, look)
  try {
    await toBoard(run, '第3讲 笔记')
    // 白板往右滚到第 8 列露出来
    await board(run.page).locator('.db-col[data-ask="1"]').nth(7).scrollIntoViewIfNeeded()
    await run.page.mouse.move(1, 1)
    await shot(run, '4-eight-board')
  } finally {
    await run.close()
  }
})
