import { expect, test, type Page } from '@playwright/test'
import { attr, parseBoard, parseLinks } from '@cn/format'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { foldInbox, launch, pane, tabOn, type Running } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu, setClipboard } from './menu'

// 白板的右键：卡片、选了几张、空白处、连线、列，点了真的改了白板文件

const BOARD = `---
type: board
links:
  - a -> b
---
# 板

<!-- card id=a x=60 y=60 w=280 -->
甲卡片的内容

<!-- card id=b x=460 y=60 w=280 -->
乙卡片

<!-- column id=c x=900 y=40 w=300 title="一列" -->

<!-- card id=d in=c -->
丁
`

/**
 * 这块白板用以前的写法（注释存列），2026-11-21 起打开时会一次转成「## 列名」写法（新写法的工具板、右键在 r9-board-doc.spec.ts、b2-board.spec.ts）。
 * 这里测的是以前的自由白板（导图、撤回了转写法的白板还用它）：把它记进旧写法名单，打开不转
 */
const keepOld = (...paths: string[]) => ({ '.canvas-notes/白板旧写法.json': JSON.stringify({ 版本: 1, 白板: paths }) })
const board = (page: Page) => pane(page).getByTestId('board')
const card = (page: Page, id: string) => board(page).locator(`.bcard[data-id="${id}"]`)
const file = (run: Running) => readFileSync(join(run.vault, '板.md'), 'utf8')
const blocks = (run: Running) => parseBoard(file(run)).blocks

async function openBoard(run: Running) {
  await armMenus(run)
  await run.page.locator('.nav .si', { hasText: /^板/ }).first().click()
  await expect(tabOn(run.page)).toHaveText('板')
  await expect(card(run.page, 'a')).toBeVisible()
  await foldInbox(run.page)
}

test('白板卡片：右键「复制一份」「转成文档」「删除」', async () => {
  const run = await launch({ '板.md': BOARD, ...keepOld('板.md') })
  const { page, vault } = run
  try {
    await openBoard(run)
    await card(page, 'a').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['编辑', '复制一份', '问 AI 这张', '转成文档', '删除'])
    await pickMenu(run, '复制一份')
    await expect.poll(() => blocks(run).filter((b) => b.kind === 'card').length).toBe(4)
    await expect(board(page).locator('.bcard', { hasText: '甲卡片的内容' })).toHaveCount(2)

    await card(page, 'b').click({ button: 'right' })
    await pickMenu(run, '转成文档')
    await expect.poll(() => existsSync(join(vault, '乙卡片.md'))).toBe(true)
    expect(readFileSync(join(vault, '乙卡片.md'), 'utf8')).toBe('# 乙卡片\n\n乙卡片\n')
    await expect.poll(() => file(run)).toContain('[[乙卡片]]')

    await card(page, 'd').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('从列里拿出来')
    await pickMenu(run, '删除')
    await expect.poll(() => blocks(run).some((b) => attr(b, 'id') === 'd')).toBe(false)
  } finally {
    await run.close()
  }
})

test('白板：选了两张右键「放进新列」；列右键「删除列（卡片留下）」；连线右键「删除连线」', async () => {
  const run = await launch({ '板.md': BOARD, ...keepOld('板.md') })
  const { page } = run
  try {
    await openBoard(run)
    await card(page, 'a').click()
    await card(page, 'b').click({ modifiers: ['Shift'] })
    await card(page, 'a').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['左对齐', '顶对齐', '排整齐', '放进新列', '删除 2 张'])
    await pickMenu(run, '放进新列')
    await expect.poll(() => blocks(run).filter((b) => b.kind === 'column').length).toBe(2)
    const col = blocks(run).find((b) => b.kind === 'column' && attr(b, 'id') !== 'c')!
    expect(blocks(run).filter((b) => attr(b, 'in') === attr(col, 'id')).map((b) => attr(b, 'id'))).toEqual(['a', 'b'])

    await board(page).locator('.bcol[data-id="c"] h3').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['改名', '删除列（卡片留下）'])
    await pickMenu(run, '删除列（卡片留下）')
    await expect.poll(() => blocks(run).some((b) => attr(b, 'id') === 'c')).toBe(false)
    expect(attr(blocks(run).find((b) => attr(b, 'id') === 'd')!, 'in')).toBeUndefined()
  } finally {
    await run.close()
  }
})

test('白板：连线右键「删除连线」；空白处右键「新列」「粘贴」放在点的地方；列右键「改名」进改名', async () => {
  const run = await launch({ '板.md': BOARD, ...keepOld('板.md') })
  const { page } = run
  try {
    await openBoard(run)
    const hit = board(page).locator('[data-link="a>b"] .hit')
    const box = (await hit.boundingBox())!
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['删除连线'])
    await pickMenu(run, '删除连线')
    await expect.poll(() => parseLinks(parseBoard(file(run))).length).toBe(0)

    const wrap = (await board(page).locator('.board-wrap').boundingBox())!
    await page.mouse.click(wrap.x + 300, wrap.y + 400, { button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['新卡片', '新待办', '新列', '新子白板', '拍导图', '粘贴'])
    await pickMenu(run, '新列')
    await expect.poll(() => blocks(run).filter((b) => b.kind === 'column').length).toBe(2)

    await setClipboard(run, '剪贴板里的一句话')
    await page.mouse.click(wrap.x + 300, wrap.y + 600, { button: 'right' })
    await pickMenu(run, '粘贴')
    await expect.poll(() => file(run)).toContain('剪贴板里的一句话')
    await expect(board(page).locator('.bcard', { hasText: '剪贴板里的一句话' })).toBeVisible()

    await board(page).locator('.bcol[data-id="c"] h3').click({ button: 'right' })
    await pickMenu(run, '改名')
    const input = board(page).getByRole('textbox', { name: '列名' })
    await expect(input).toBeFocused()
    await input.fill('改过的列')
    await input.press('Enter')
    await expect.poll(() => file(run)).toMatch(/<!-- column id=c [^>]*title="?改过的列/)
  } finally {
    await run.close()
  }
})
