/**
 * 数据库第三批第 4 块（task-i921u）：点一行在右栏标签打开那一条，像 Notion 的侧边预览。
 * 都在测试模式里真点、真打字、真拖：打开、换一条不写文件；改一个属性只换那一行（和 packages/format 的 writeCell 算的一样），撤回回到原样；
 * 正文能写、待办能勾；从关联点进那一题、← 回来；改名文件跟着改、别处的 [[旧名]] 跟着改；整页打开在中间开；
 * 「记录」标签照工作区规矩能拖到上半、和别的标签成组。
 */
import { expect, type Page, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { baseContext, parseBaseDoc, writeCell } from '../../../packages/format/src/index'
import { ECP_BASE, ECP_DOC, EXERCISES, LECTURES, records } from '../../../packages/format/test/base-samples'
import { gitStatus, launch, openNote, pane, webAboveAi } from './app'

const DOC = '课程/ecp/ecp 课程计划.md'
const L3 = '课程/ecp/课程计划/第3讲 生产.md'
const L4 = '课程/ecp/课程计划/第4讲 市场结构.md'
const FILES: Record<string, string> = { [DOC]: ECP_DOC, ...LECTURES, ...EXERCISES }

const peek = (page: Page) => page.locator('.rpeek')
const toast = (page: Page) => page.getByTestId('toast')
/** 右栏这一条的属性：名字 → 看得到的值 */
const field = (page: Page, name: string) => peek(page).locator(`.rec-row[data-col="${name}"] .v`)

/** packages/format 算出来的：在第一个视图上改这一格以后那一篇的字 */
function expected(path: string, col: string, value: string | null): string {
  const ctx = baseContext(parseBaseDoc(ECP_BASE), records({ ...LECTURES, ...EXERCISES }))
  const w = writeCell(ctx, path, col, value)
  expect(w).toHaveLength(1)
  return w[0]!.after
}

test('数据库点一行在右栏打开：属性逐个能改（只换那一行、能撤回）、正文能写、↑ ↓ 换一条、关联点进那一题、改名、整页打开、拖标签', async () => {
  const run = await launch(FILES)
  const { page, vault, app } = run
  const read = (p: string) => readFileSync(join(vault, p), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, 'ecp 课程计划')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(8)

    // 点名字：右栏多一个「第3讲 生产」标签，表里这一行灰底
    await db.getByRole('button', { name: '第3讲 生产', exact: true }).click()
    const tab = page.getByTestId('dtab-record')
    await expect(tab).toHaveText('第3讲 生产')
    await expect(page.getByTestId('tab-on')).toHaveText('ecp 课程计划')
    await expect(peek(page).locator('.rec-crumbs')).toHaveText('课程计划第3讲 生产')
    await expect(peek(page).locator('.rec-title')).toHaveText('第3讲 生产')
    await expect(peek(page).locator('.rec-row .k')).toHaveText(['状态', '日期', '进度', '练习', '做完几题', '已看', '节数'])
    await expect(field(page, '状态')).toHaveText('在学')
    await expect(field(page, '日期')).toHaveText('11月17日')
    await expect(field(page, 'formula.进度')).toHaveText('50%算出来的')
    await expect(field(page, '练习').locator('.rec-rel')).toHaveText(['练习 3.1', '练习 3.2'])
    await expect(field(page, '做完几题')).toHaveText('1/2顺着「练习」数「做完」')
    await expect(db.locator('tr.base-row-peek')).toHaveText(/第3讲 生产/)
    // 正文是文档编辑器：「要点」那一段在
    await expect(peek(page).locator('.rec-body .cm-content')).toContainText('短期只有劳动能变')
    // 同一条再点：不重复开（还是一个标签，中间也没多开一个）；悬停的「打开」也是同一处
    await db.getByRole('button', { name: '第3讲 生产', exact: true }).click()
    await db.locator('tbody tr', { hasText: '第3讲 生产' }).hover()
    await db.getByRole('button', { name: '在右栏打开「第3讲 生产」' }).click()
    await expect(page.locator('[data-testid="dtab-record"]')).toHaveCount(1)
    await expect(page.locator('.tabs [role="tab"], .tabbar .tab').filter({ hasText: '第3讲 生产' })).toHaveCount(0)
    // 只看不写
    await page.waitForTimeout(900)
    expect(gitStatus(vault)).toBe('')

    // 改状态：点值出选项（按三组），点「学完」只换那一行，表里跟着变；撤回回到原样
    await field(page, '状态').click()
    const pop = page.getByRole('dialog', { name: '状态' })
    await expect(pop.locator('.rec-gname')).toHaveText(['待开始', '进行中', '完成'])
    await pop.getByRole('menuitem', { name: '学完' }).click()
    await expect.poll(() => read(L3)).toBe(expected(L3, '状态', '学完'))
    // 只有这一篇变了
    expect(gitStatus(vault).trim().split('\n')).toHaveLength(1)
    await expect(field(page, '状态')).toHaveText('学完')
    await expect(db.locator('tbody tr', { hasText: '第3讲 生产' }).locator('td').nth(1)).toHaveText('学完')
    await expect(toast(page)).toContainText(`改了「状态」，写进 ${L3}`)
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(L3)).toBe(LECTURES[L3])
    await expect(field(page, '状态')).toHaveText('在学')

    // 改数字：已看 2 → 3，公式「进度」当场跟着变
    await field(page, '已看').click()
    const num = peek(page).getByRole('textbox', { name: '第3讲 生产 · 已看' })
    await num.fill('3')
    await num.press('Enter')
    await expect.poll(() => read(L3)).toBe(expected(L3, '已看', '3'))
    await expect(field(page, 'formula.进度')).toHaveText('75%算出来的')
    // </> 看这篇 md：刚改过的那一行上底色
    await page.getByRole('button', { name: '看这篇的写法' }).click()
    await expect(page.getByTestId('record-md').locator('.hl')).toHaveText(['已看: 3'])
    await page.getByRole('button', { name: '看这篇的写法' }).click()
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(L3)).toBe(LECTURES[L3])

    // 改日期：只换日子
    await field(page, '日期').click()
    const day = peek(page).getByRole('textbox', { name: '第3讲 生产 · 日期' })
    await day.fill('2026-11-18')
    await day.press('Enter')
    await expect.poll(() => read(L3)).toBe(expected(L3, '日期', '2026-11-18'))
    await expect(field(page, '日期')).toHaveText('11月18日')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => read(L3)).toBe(LECTURES[L3])

    // 正文能写：在「要点」那一段末尾打字，存进这一篇，开头的属性不动
    const line = peek(page).locator('.rec-body .cm-line', { hasText: '短期只有劳动能变' })
    await line.click()
    await page.keyboard.press('End')
    await page.keyboard.type('右栏里写的')
    await expect.poll(() => read(L3)).toBe(LECTURES[L3]!.replace('先升后降。', '先升后降。右栏里写的'))
    // 待办能勾
    await peek(page).locator('.rec-body .cm-line', { hasText: '看完第3、4节视频' }).locator('input[type="checkbox"], .cm-task, [role="checkbox"]').first().click()
    await expect.poll(() => read(L3)).toContain('- [x] 看完第3、4节视频')
    const written = read(L3)

    // ↑ ↓ 换一条（照视图的顺序）：焦点在右栏里
    await peek(page).locator('.rec-crumbs').click()
    await page.keyboard.press('ArrowDown')
    await expect(tab).toHaveText('第4讲 市场结构')
    await expect(db.locator('tr.base-row-peek')).toHaveText(/第4讲/)
    await page.getByRole('button', { name: '上一条' }).click()
    await expect(tab).toHaveText('第3讲 生产')

    // 从关联点进那一题：右栏换成练习 3.2，「所属讲」连回来；← 回去
    await field(page, '练习').getByRole('button', { name: '练习 3.2' }).click()
    await expect(tab).toHaveText('练习 3.2')
    await expect(peek(page).locator('.rec-crumbs')).toHaveText('练习练习 3.2')
    await expect(field(page, '所属讲').locator('.rec-rel')).toHaveText(['第3讲 生产'])
    await expect(peek(page).locator('.rec-note')).toHaveText('「练习」那一列是两边都写的：在「课程计划」里连上这一条，这里的「所属讲」跟着有。')
    await page.getByRole('button', { name: '回到上一条' }).click()
    await expect(tab).toHaveText('第3讲 生产')
    expect(read(L3)).toBe(written)

    // 改名：点名字改，文件跟着改名，练习里的 [[第3讲 生产]] 跟着改
    await peek(page).locator('.rec-title').click()
    const title = peek(page).getByRole('textbox', { name: '这一条的名字' })
    await title.fill('第3讲 生产和成本')
    await title.press('Enter')
    const L3b = '课程/ecp/课程计划/第3讲 生产和成本.md'
    await expect(tab).toHaveText('第3讲 生产和成本')
    await expect.poll(() => read(L3b)).toBe(written)
    await expect.poll(() => read('课程/ecp/练习/练习 3.1.md')).toContain('[[第3讲 生产和成本]]')
    await expect(db.getByRole('button', { name: '第3讲 生产和成本', exact: true })).toBeVisible()

    // 拖标签：右栏还开着大纲时，「记录」和它叠在一组；拖到这一组上半成上下两组
    await peek(page).locator('.rec-crumbs').click()
    await page.keyboard.press('Escape')
    await expect(peek(page)).toBeHidden()
    await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: /^大纲/ }).click()
    await page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: /^记录/ }).click()
    await expect(page.locator('.dgrp').filter({ has: tab }).locator('.dtab')).toHaveCount(2)
    await webAboveAi(page, 'record')
    await expect(peek(page)).toBeVisible()
    await expect(page.locator('.dgrp').first().locator('.dtab')).toHaveText(['第3讲 生产和成本'])

    // 整页打开：中间开这一篇，右栏的这个标签收起
    await page.getByRole('button', { name: '整页打开这一条' }).click()
    await expect(page.getByTestId('tab-on')).toHaveText('第3讲 生产和成本')
    await expect(tab).toHaveCount(0)
  } finally {
    await run.close()
  }
})
