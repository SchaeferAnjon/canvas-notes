/**
 * 配对笔记白板上拖进来的卡（r147，用户 0.5.11：「根据 pdf 生成的笔记，然后我在白板模式下，打开收件箱拖进来的东西，没法变位置」）。
 * 用户那篇的结构（test/fixtures/pair-board-drop.md：「## 第 1 页 · …」一节全是问答，旁支回答后面是拖进来的 `<!-- card id=d1 … -->` + `![[过度捕鱼]]`）。
 * 一律无头、真点：
 * 1 开白板：那张是「过度捕鱼」的嵌入卡、不露注释；拖到别处文件只改位置那一行；再从收件箱拖一条进来是卡、能拖，也只改它那一行；
 *   切回文档、再切白板，一个字节不变。
 * 2 右栏 AI（假的 claude 命令行，全能模式接我们的 MCP）：board_move 挪空白处那张成功、文件只改位置行；挪问答列里的卡报错、文件不动。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { acts, inboxPop, launch, openAi, openNote, pane, type Running, waitSaved } from './app'
import { LECTURE } from './fixtures/pdf'

const NOTE = '课程/alr170025 笔记.md'
const MD = readFileSync(join(__dirname, '../test/fixtures/pair-board-drop.md'), 'utf8')
const FILES = { [NOTE]: MD, '课程/alr170025.pdf': LECTURE, '过度捕鱼.md': '# 过度捕鱼\n\n捞得比长得快，鱼就越来越少。\n', '收件箱/海里的鱼.md': '鱼群恢复要十年。\n' }
const board = (page: Page) => pane(page).getByTestId('doc-board')
const read = (run: Running) => readFileSync(join(run.vault, NOTE), 'utf8')
const LINE = '<!-- card id=d1 x=383 y=2075 -->'

async function dragBy(page: Page, l: Locator, dx: number, dy: number) {
  // 按卡头（左上角往里一点）拖：嵌入卡里的字、链接不接按下
  const b = (await l.boundingBox())!
  const from = { x: b.x + 12, y: b.y + 8 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 12, from.y + 10, { steps: 3 })
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 14 })
  await page.waitForTimeout(80)
  await page.mouse.up()
}
async function toBoard(page: Page) {
  await openNote(page, 'alr170025 笔记')
  await acts(page).getByRole('tab', { name: '白板' }).click()
  await expect(board(page)).toBeVisible()
}
/** 文件里只有 d1 那一行和 MD 不同（换成别的坐标） */
const onlyLine = (text: string, id: string, base: string) => {
  const re = new RegExp(`<!-- card id=${id} x=(\\d+) y=(\\d+) -->`)
  const m = re.exec(text)
  expect(m).not.toBeNull()
  expect(text.replace(re, '@')).toBe(base.replace(re, '@'))
  return { x: Number(m![1]), y: Number(m![2]) }
}

test('配对笔记白板：拖进来的卡是嵌入卡、能拖，文件只改位置行；收件箱再拖一条进来也是卡、能拖；切看法一字节不变', async () => {
  test.setTimeout(120_000)
  const run = await launch(FILES)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await toBoard(page)
    // 问答照旧一问一列；那张是空白处的嵌入笔记卡，不露注释、不露 ![[ ]]
    await expect(board(page).locator('.db-col[data-ask="1"]')).toHaveCount(1)
    const card = board(page).locator('.db-card.placed[data-id="d1"]')
    await expect(card).toHaveAttribute('data-face', 'note')
    await expect(card).toContainText('过度捕鱼')
    await expect(board(page)).not.toContainText('<!--')
    await expect(board(page)).not.toContainText('![[')
    expect(read(run)).toBe(MD)
    await page.screenshot({ path: 'test-results/r147-open.png' })

    // 拖到别处：只改位置那一行
    const before = (await card.boundingBox())!
    await card.scrollIntoViewIfNeeded()
    await dragBy(page, card, 260, -120)
    await expect.poll(() => read(run)).not.toBe(MD)
    await waitSaved(page)
    const p1 = onlyLine(read(run), 'd1', MD)
    expect(p1).not.toEqual({ x: 383, y: 2075 })
    expect((await card.boundingBox())!.x).not.toBeCloseTo(before.x, 0)
    const after1 = read(run)

    // 从收件箱拖一条到空白处：是一张卡（d2），文件末尾多它这一段带一行位置
    const pop = await inboxPop(page)
    const item = pop.getByRole('listitem').filter({ hasText: '鱼群恢复要十年' })
    const wb = (await board(page).locator('.board-wrap').boundingBox())!
    const ib = (await item.boundingBox())!
    await page.mouse.move(ib.x + 40, ib.y + ib.height / 2)
    await page.mouse.down()
    await page.mouse.move(ib.x - 30, ib.y + ib.height / 2, { steps: 6 })
    await page.mouse.move(wb.x + wb.width - 520, wb.y + wb.height - 160, { steps: 14 })
    await page.waitForTimeout(80)
    await page.mouse.up()
    const d2 = board(page).locator('.db-card.placed', { hasText: '鱼群恢复要十年' })
    await expect(d2).toBeVisible()
    await waitSaved(page)
    const withD2 = read(run)
    expect(withD2.startsWith(after1.replace(/\n+$/, ''))).toBe(true)
    expect(withD2.slice(after1.replace(/\n+$/, '').length)).toMatch(/^\n\n<!-- card id=d2 x=\d+ y=\d+ -->\n鱼群恢复要十年。\n$/)
    await expect(board(page)).not.toContainText('<!--')
    // 收起收件箱，再拖 d2：只改它那一行
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await dragBy(page, d2, -200, -60)
    await expect.poll(() => read(run)).not.toBe(withD2)
    await waitSaved(page)
    onlyLine(read(run), 'd2', withD2)
    expect(read(run)).toContain(`<!-- card id=d1 x=${p1.x} y=${p1.y} -->`)
    await page.screenshot({ path: 'test-results/r147-dragged.png' })

    // 切回文档、再切白板：一个字节不写
    const now = read(run)
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(pane(page).locator('.cm-content')).toBeVisible()
    await waitSaved(page)
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page).locator('.db-card.placed')).toHaveCount(2)
    await page.waitForTimeout(400)
    expect(read(run)).toBe(now)
  } finally {
    await run.close()
  }
})

function script(p: string, body: string) {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

test('右栏 AI 挪卡（假 claude 走我们的 MCP）：空白处那张挪好了、文件只改位置行；问答列里的卡报错、不往文件里插', async () => {
  test.setTimeout(120_000)
  const home = mkdtempSync(join(tmpdir(), 'cn-e2e-home-'))
  script(join(home, '.local/bin/claude'), `exec "${process.execPath}" "${join(__dirname, '../test/fixtures/fake-claude.mjs')}" "$@"`)
  for (const c of ['codex', 'gemini', 'opencode']) script(join(home, '.local/bin', c), 'exit 1')
  script(join(home, 'shell'), 'PATH="$HOME/.local/bin:/usr/bin:/bin"; export PATH\nexec /bin/sh -c "$2"')
  const run = await launch(FILES, { HOME: home, ZDOTDIR: home, SHELL: join(home, 'shell'), PATH: '/usr/bin:/bin' })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await toBoard(page)
    await openAi(page)
    const float = page.getByRole('complementary', { name: 'AI 对话' })
    const box = float.getByRole('textbox', { name: '问 AI' })
    await box.fill('整理白板：挪卡')
    await box.press('Enter')
    const msg = float.getByTestId('ai-msg').last().locator('.txt')
    await expect(msg).toContainText('挪问答列里的卡', { timeout: 30_000 })
    await expect(msg).toContainText('挪空白处的卡 d1 好了')
    await expect(msg).toContainText('出错：「问过 AI」那一列里的卡跟着它那一问')
    await expect.poll(() => read(run), { timeout: 10_000 }).toBe(MD.replace(LINE, '<!-- card id=d1 x=900 y=80 -->'))
    await expect(board(page).locator('.db-card.placed[data-id="d1"]')).toBeVisible()
    await expect(board(page)).not.toContainText('<!--')
  } finally {
    await run.close()
    rmSync(home, { recursive: true, force: true })
  }
})
