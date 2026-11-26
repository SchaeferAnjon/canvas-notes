/**
 * 收件箱「费曼学习需要检测到白板的内容」：在白板上开费曼，材料要是这块白板（真点工具板「费曼学习」，假 AI CN_AI_FAKE=1）。
 * 以前：什么都没选时写一个词只搜库、还把这块白板排除了；没有「整块白板」可挑；白板上的手写不进材料。
 * 材料里每一样怎么读（列名、连线、PDF 页卡、图片卡）在 test/feynman-board-material.test.ts。
 */
import { expect, type Page, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, pane } from './app'
import { board, openBoard } from './fixtures/board-doc'
import { feynmanFiles } from './fixtures/feynman'
import { BOARD as INK_BOARD, BOARD_PATH as INK_BOARD_PATH, INK, INK_PATH } from './ink-samples'

let server: Server
let book = ''
test.beforeAll(async () => {
  server = createServer((_q, r) => (r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), r.end('<p>书</p>')))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  book = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => new Promise<void>((r) => server.close(() => r())))

const col = (page: Page) => pane(page).getByTestId('fy-col')

/** 等这次要讲到出来；卡多、AI 分成了几个点时先挑第一个（假 AI 五条一组） */
async function drafted(page: Page) {
  const pick = pane(page).getByTestId('fy-pick-item').first()
  await expect(pick.or(col(page))).toBeVisible({ timeout: 15_000 })
  if (await pick.isVisible()) {
    // 单子一项挨一项排在这一列里，不叠在一起（以前 ⌘ 悬停浮窗的 .pk 把每一项都变成 position: fixed，叠在同一处，只点得到最后一项）
    const rows = await pane(page)
      .getByTestId('fy-pick-item')
      .evaluateAll((els) => els.map((e) => [e.getBoundingClientRect().top, e.getBoundingClientRect().bottom, e.closest('[data-testid="fy-pending"]')!.getBoundingClientRect().bottom]))
    for (let i = 1; i < rows.length; i++) expect(rows[i]![0]).toBeGreaterThanOrEqual(rows[i - 1]![1]!)
    for (const r of rows) expect(r[1]).toBeLessThanOrEqual(r[2]! + 1)
    await pick.click()
  }
  await expect(col(page)).toBeVisible({ timeout: 15_000 })
}

/** 假 AI 每问一句记一行（哪一步、几张图） */
async function start(extra: Record<string, string> = {}) {
  const log = join(tmpdir(), `cn-fy-log-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`)
  const run = await launch({ ...feynmanFiles(book), ...extra }, { CN_AI_FAKE: '1', CN_FAKE_FEYNMAN_LOG: log })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  const asks = () => {
    try {
      return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as { kind: string; images: number })
    } catch {
      return []
    }
  }
  return { ...run, asks }
}

test('什么都没选、在白板上写一个词：说到它的卡当材料，列头写「照白板上说到「范数」的 N 张卡…核对」', async () => {
  test.setTimeout(120_000)
  const run = await start()
  const { page } = run
  try {
    await openBoard(page, '线性代数 2.3 白板')
    await board(page).getByTestId('pal-feynman').click()
    const pop = page.getByTestId('fy-start')
    await pop.getByRole('textbox', { name: '直接写一个词' }).fill('范数')
    await pop.getByTestId('fy-start-go').click()
    await drafted(page)
    const c = col(page)
    await expect(c.locator('.lb.fy-nw')).toContainText('照白板上说到「范数」的')
  } finally {
    await run.close()
  }
})

test('什么都没选：小框「从这块白板上挑」第一个是「整块白板」，点了每张卡都当材料', async () => {
  test.setTimeout(120_000)
  const run = await start()
  const { page } = run
  try {
    await openBoard(page, '线性代数 2.3 白板')
    await board(page).getByTestId('pal-feynman').click()
    const items = page.getByTestId('fy-start-items').getByRole('button')
    await expect(items.first()).toHaveText('整块白板')
    await items.first().click()
    await drafted(page)
    await expect(col(page).locator('.lb.fy-nw')).toContainText('照这块白板上的')
  } finally {
    await run.close()
  }
})

test('白板上有 iPad 写的手写：整块白板开讲时手写拍成一张图交给看图那家，列头写「…和白板上的手写核对」', async () => {
  test.setTimeout(120_000)
  const run = await start({ [INK_BOARD_PATH]: INK_BOARD, [INK_PATH]: INK })
  const { page } = run
  try {
    await openBoard(page, '组会白板')
    await expect(board(page)).toBeVisible()
    await board(page).getByTestId('pal-feynman').click()
    await page.getByTestId('fy-start-items').getByRole('button', { name: '整块白板' }).click()
    await drafted(page)
    expect(run.asks().find((a) => a.kind === 'extract')?.images).toBeGreaterThanOrEqual(1)
    await expect(col(page).locator('.lb.fy-nw')).toContainText('和白板上的手写核对')
  } finally {
    await run.close()
  }
})
