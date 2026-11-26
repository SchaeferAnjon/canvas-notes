/**
 * 收件箱「白板里面回车有问题」：文档切成的白板上就地改卡时按回车。真双击、真打字、真按回车（输入法用 CDP 的组字事件）。
 * 以前：待办卡打完最后一项回车再点别处，文件里多一个空的「- [ ]」、卡上 0/3；字卡末尾回车几下，文档里那一段后面多出空行；
 * 引文卡末尾回车一下，点别处后变成两张卡（引文一张、后面打的字一张）。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openNote, pane, waitSaved } from './app'

const board = (page: Page) => pane(page).getByTestId('doc-board')
const col = (page: Page, name: string) => board(page).getByRole('region', { name, exact: true })
const cardIn = (page: Page, name: string, text: string) => col(page, name).locator('.db-card', { hasText: text })
const editor = (page: Page) => board(page).locator('.card-edit .cm-content')

const NOTE = '# 回车\n\n## 第一节\n\n第一张卡。\n\n- [ ] 买菜\n- [ ] 买米\n\n> 一段引文\n\n## 第二节\n\n第二张卡。\n'

async function open() {
  const run = await launch({ '回车.md': NOTE })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await openNote(run.page, '回车')
  await acts(run.page).getByRole('tab', { name: '白板' }).click()
  await expect(board(run.page)).toBeVisible()
  const path = join(run.vault, '回车.md')
  return { ...run, file: () => readFileSync(path, 'utf8') }
}

/** 点白板左上角的空处：卡收起、存下 */
async function away(page: Page) {
  await board(page).click({ position: { x: 5, y: 5 } })
  await expect(editor(page)).toHaveCount(0)
}

test('待办卡打完最后一项按回车、点别处：空的一项不进文件，卡上是 0/3 不是 0/4', async () => {
  const run = await open()
  const { page } = run
  try {
    await cardIn(page, '第一节', '买米').dblclick({ position: { x: 30, y: 8 } })
    await expect(editor(page)).toBeFocused()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('买油')
    await page.keyboard.press('Enter')
    await away(page)
    await expect.poll(run.file).toContain('- [ ] 买油')
    await waitSaved(page)
    expect(run.file()).toBe(NOTE.replace('- [ ] 买米\n', '- [ ] 买米\n- [ ] 买油\n'))
    await expect(cardIn(page, '第一节', '买油')).toContainText('0/3')
  } finally {
    await run.close()
  }
})

test('字卡末尾回车两下、点别处：文档里这一段后面不多出空行，还是一张卡', async () => {
  const run = await open()
  const { page } = run
  try {
    const cards = board(page).locator('.db-card')
    const n = await cards.count()
    await cardIn(page, '第二节', '第二张卡').dblclick()
    await expect(editor(page)).toBeFocused()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('续一句')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await away(page)
    await expect.poll(run.file).toContain('续一句')
    await waitSaved(page)
    expect(run.file()).toBe(NOTE.replace('第二张卡。\n', '第二张卡。续一句\n'))
    await expect(cards).toHaveCount(n)
  } finally {
    await run.close()
  }
})

test('引文卡末尾回车一下接着打：字续在这张引文里，点别处后还是一张卡', async () => {
  const run = await open()
  const { page } = run
  try {
    const cards = board(page).locator('.db-card')
    const n = await cards.count()
    await cardIn(page, '第一节', '一段引文').dblclick()
    await expect(editor(page)).toBeFocused()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('第二行')
    await away(page)
    await expect.poll(run.file).toContain('第二行')
    await waitSaved(page)
    expect(run.file()).toBe(NOTE.replace('> 一段引文\n', '> 一段引文\n> 第二行\n'))
    await expect(cards).toHaveCount(n)
    await expect(cardIn(page, '第一节', '一段引文')).toContainText('第二行')
  } finally {
    await run.close()
  }
})

test('卡里输入法组字时按回车：只上屏、不换行；上屏后回车才换行；打开再收起不改字的卡文件一个字节不变', async () => {
  const run = await open()
  const { page } = run
  try {
    // 不改字：双击打开再点别处
    await cardIn(page, '第一节', '第一张卡').dblclick()
    await expect(editor(page)).toBeFocused()
    await away(page)
    await page.waitForTimeout(600)
    expect(run.file()).toBe(NOTE)

    await cardIn(page, '第一节', '第一张卡').dblclick()
    await expect(editor(page)).toBeFocused()
    await page.keyboard.press('Meta+ArrowDown')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'nihao', selectionStart: 5, selectionEnd: 5 })
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 })
    await cdp.send('Input.insertText', { text: '你好' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
    await expect(editor(page)).toHaveText('第一张卡。你好')
    await page.keyboard.press('Enter')
    await page.keyboard.type('下一行')
    await away(page)
    await expect.poll(run.file).toContain('下一行')
    await waitSaved(page)
    expect(run.file()).toBe(NOTE.replace('第一张卡。\n', '第一张卡。你好\n下一行\n'))
  } finally {
    await run.close()
  }
})
