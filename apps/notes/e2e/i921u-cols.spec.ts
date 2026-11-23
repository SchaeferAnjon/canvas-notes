/**
 * 数据库第三批第 5 块（task-i921u）：关联、汇总、公式三种列的界面，真点、真打字。
 * 样本是设计页那一块（八讲七题，packages/format/test/base-samples.ts）。每个动作之后读盘：只改了该改的几行，
 * 和 packages/format 算出来的一模一样；关联勾一下两篇一次提交、撤回一次回到原样；外面改了一边时块底说一句、点「补上」。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { baseContext, parseBaseDoc, setBaseOrder, setFormula, setPropDef, toggleRelation } from '@cn/format'
import { ECP_BASE, ECP_DOC, EXERCISES, LECTURES, records } from '../../../packages/format/test/base-samples'
import { gitStatus, launch, openNote, pane } from './app'

const DOC = '课程/ecp/ecp 课程计划.md'
/** 练习那边也有一篇放着它的数据库（加关联列时「关联到哪个数据库」列得出来） */
const EX_DOC = '课程/ecp/ecp 练习册.md'
const EX_DOC_TEXT = '# ecp 练习册\n\n```base\nfilters:\n  and:\n    - file.inFolder("课程/ecp/练习")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 做完\n```\n'
const FILES: Record<string, string> = { [DOC]: ECP_DOC, [EX_DOC]: EX_DOC_TEXT, ...LECTURES, ...EXERCISES }

const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' })
/** 文件里那一块 base 的 YAML */
const blockOf = (text: string) => /```base\n([\s\S]*?)\n```/.exec(text)![1]!
const ctxOf = (vault: string) =>
  baseContext(parseBaseDoc(blockOf(read(vault, DOC))), records(Object.fromEntries(Object.keys(LECTURES).map((p) => [p, read(vault, p)]))), {
    related: { '课程/ecp/练习': records(Object.fromEntries(Object.keys(EXERCISES).map((p) => [p, read(vault, p)]))) },
  })

const db = (page: Page) => pane(page).locator('[data-part="数据库块"]').first()
const row = (page: Page, name: string) => db(page).locator('tbody tr', { hasText: name })
const cell = (page: Page, name: string, col: string) => row(page, name).locator(`td[data-col="${col}"]`)
/** 先滚到它、停一下再点（Playwright 自己滚的话，滚动事件晚到一帧会把刚开的浮层收起；人也是先看见再点） */
async function clickSteady(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  await el.click()
}

test('关联、汇总、公式：格子怎么画、关联两边写一次提交一次撤回、对不上能补、汇总三个下拉、公式框插列名 / 出错指位置 / 当场算', async () => {
  test.setTimeout(240_000)
  const run = await launch(FILES)
  const { page, vault, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, 'ecp 课程计划')
    await expect(db(page).locator('tbody tr')).toHaveCount(8)
    await expect(db(page).locator('thead th.col')).toHaveText(['名字', '状态', '日期', '进度', '练习', '做完几题'])

    // ---------- 格子：状态小块、日期写「11月10日」、关联小块（「练习 3.1」写「3.1」）、汇总「1/2」带进度条、公式「50%」带进度条
    await expect(cell(page, '第1讲', '状态').locator('.base-st')).toHaveText('学完')
    await expect(row(page, '第1讲').locator('td').nth(2)).toHaveText('11月10日')
    await expect(cell(page, '第3讲', '练习').locator('.base-rel')).toHaveText(['3.1', '3.2'])
    await expect(cell(page, '第3讲', '做完几题')).toHaveText('1/2')
    await expect(cell(page, '第3讲', '做完几题').locator('.base-bar')).toHaveCount(1)
    await expect(cell(page, '第3讲', 'formula.进度')).toHaveText('50%')
    await expect(cell(page, '第3讲', 'formula.进度').locator('.base-bar b')).toHaveAttribute('style', /width: 50%/)
    await expect(cell(page, '第6讲', '做完几题')).toHaveText('')
    // 只看：一个字没写
    await page.waitForTimeout(800)
    expect(gitStatus(vault)).toBe('')

    // ---------- 关联：点格子空处出选择，能搜，勾一下写两篇、一次提交
    /** 点格子空处（小块右边） */
    const openPick = async () => {
      const c = cell(page, '第3讲', '练习')
      await c.scrollIntoViewIfNeeded()
      await page.waitForTimeout(150)
      const box = (await c.boundingBox())!
      // 单击只选中一格（task-cle3x 格子焦点），再点一下开选择
      await c.click({ position: { x: box.width - 8, y: box.height / 2 } })
      await c.click({ position: { x: box.width - 8, y: box.height / 2 } })
    }
    await openPick()
    const pick = page.getByRole('dialog', { name: '第3讲 生产 · 练习' })
    await expect(pick).toBeVisible()
    await expect(pick.getByRole('menuitemcheckbox')).toHaveCount(7)
    await expect(pick.getByRole('menuitemcheckbox', { name: /练习 3\.1/ })).toHaveAttribute('aria-checked', 'true')
    await expect(pick.getByRole('menuitemcheckbox', { name: /练习 1\.1/ })).toContainText('也在第1讲')
    await expect(pick).toContainText('连到「练习」里的哪几条 · 两边都写')
    const q = pick.getByRole('textbox', { name: '找一条' })
    await q.fill('4.1')
    await expect(pick.getByRole('menuitemcheckbox')).toHaveCount(1)
    const before = ctxOf(vault)
    const want = toggleRelation(before, '课程/ecp/课程计划/第3讲 生产.md', '练习', '练习 4.1', true)
    expect(want.map((w) => w.path).sort()).toEqual(['课程/ecp/练习/练习 4.1.md', '课程/ecp/课程计划/第3讲 生产.md'])
    const commits0 = Number(git(vault, 'rev-list', '--count', 'HEAD'))
    await pick.getByRole('menuitemcheckbox', { name: /练习 4\.1/ }).click()
    for (const w of want) await expect.poll(() => read(vault, w.path)).toBe(w.after)
    await expect.poll(() => Number(git(vault, 'rev-list', '--count', 'HEAD'))).toBe(commits0 + 1)
    expect(git(vault, 'show', '--name-only', '--format=%s', 'HEAD').trim().split('\n').filter(Boolean).sort()).toEqual(['数据库：「第3讲 生产」连上「练习 4.1」', '课程/ecp/练习/练习 4.1.md', '课程/ecp/课程计划/第3讲 生产.md'].sort())
    expect(gitStatus(vault)).toBe('')
    await expect(pick.getByRole('menuitemcheckbox', { name: /练习 4\.1/ })).toHaveAttribute('aria-checked', 'true')
    await expect(pick.getByRole('menuitemcheckbox', { name: /练习 4\.1/ })).toContainText('也在第4讲')
    await expect(page.getByTestId('toast')).toContainText('「第3讲 生产」连上了「练习 4.1」 · 写进 2 篇')
    await page.keyboard.press('Escape')
    await expect(pick).toHaveCount(0)
    await expect(cell(page, '第3讲', '练习').locator('.base-rel')).toHaveText(['3.1', '3.2', '4.1'])

    // 撤回：两篇回到原样，一次提交
    await page.getByTestId('toast').getByRole('button', { name: '撤回' }).click()
    for (const w of want) await expect.poll(() => read(vault, w.path)).toBe(w.before)
    await expect.poll(() => Number(git(vault, 'rev-list', '--count', 'HEAD'))).toBe(commits0 + 2)
    expect(git(vault, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['课程/ecp/练习/练习 4.1.md', '课程/ecp/课程计划/第3讲 生产.md'])
    expect(gitStatus(vault)).toBe('')
    await expect(cell(page, '第3讲', '练习').locator('.base-rel')).toHaveText(['3.1', '3.2'])

    // 去掉一个（那边是一行一项写法的「所属讲」）：那边这一行拿掉，照 format 算的
    const off = toggleRelation(ctxOf(vault), '课程/ecp/课程计划/第3讲 生产.md', '练习', '练习 3.2', false)
    await openPick()
    await pick.getByRole('menuitemcheckbox', { name: /练习 3\.2/ }).click()
    for (const w of off) await expect.poll(() => read(vault, w.path)).toBe(w.after)
    expect(read(vault, '课程/ecp/练习/练习 3.2.md')).toBe('---\n做完: false\n---\n\n## 题目\n\n照课本这一节的例子再算一遍。\n')
    await page.keyboard.press('Escape')
    await page.getByTestId('toast').getByRole('button', { name: '撤回' }).click()
    for (const w of off) await expect.poll(() => read(vault, w.path)).toBe(w.before)

    // 点关联小块：在右栏「记录」标签开那一篇（照第 4 块），中间还是这篇文档
    await cell(page, '第3讲', '练习').getByRole('button', { name: '打开「练习 3.1」' }).click()
    await expect(page.getByTestId('dtab-record')).toHaveText('练习 3.1')
    await expect(page.getByTestId('tab-on')).toContainText('ecp 课程计划')

    // ---------- 两边对不上：外面把练习 5.1 的「所属讲」删了，块底说一句，点「补上」
    const ex51 = '课程/ecp/练习/练习 5.1.md'
    writeFileSync(join(vault, ex51), '---\n做完: false\n---\n\n## 题目\n\n照课本这一节的例子再算一遍。\n')
    const issues = db(page).getByRole('group', { name: '关联两边对不上' })
    await expect(issues).toContainText('「练习 5.1」的「所属讲」里少了「第5讲 博弈初步」')
    await issues.getByRole('button', { name: '补上' }).click()
    await expect.poll(() => read(vault, ex51)).toBe('---\n做完: false\n所属讲: ["[[第5讲 博弈初步]]"]\n---\n\n## 题目\n\n照课本这一节的例子再算一遍。\n')
    await expect(issues).toHaveCount(0)

    // ---------- 汇总：列菜单里三个下拉，算的七种都能选；改了只换 base 块 calc 那一行
    await clickSteady(page, db(page).getByRole('button', { name: '做完几题', exact: true }))
    const rm = page.getByRole('menu', { name: '做完几题 这一列' })
    await expect(rm.getByRole('combobox', { name: '顺着哪一列关联' })).toHaveValue('练习')
    await expect(rm.getByRole('combobox', { name: '那边的哪一列' })).toHaveValue('做完')
    const calc = rm.getByRole('combobox', { name: '算什么' })
    await expect(calc).toHaveValue('checked/all')
    await expect(calc.locator('option')).toHaveText(['几个', '勾了几个', '勾了几个 / 共几个', '求和', '平均', '最早', '最晚'])
    await expect(rm.getByRole('menuitemradio')).toHaveCount(0)
    const doc0 = read(vault, DOC)
    await calc.selectOption('count')
    await expect.poll(() => read(vault, DOC)).toBe(doc0.replace('    calc: checked/all', '    calc: count'))
    await expect(cell(page, '第2讲', '做完几题')).toHaveText('2')
    await page.keyboard.press('Escape')

    // ---------- 加一列：三组；「汇总」按第一个关联列建好、马上开它的菜单
    const addBtn = db(page).getByRole('button', { name: '加一列' })
    await clickSteady(page, addBtn)
    let add = page.getByRole('dialog', { name: '加一列' })
    await expect(add.getByRole('group')).toHaveText([/^基本/, /^连起来/, /^算出来/])
    await expect(add.getByRole('group', { name: '连起来' }).getByRole('menuitem')).toHaveText(['关联', '汇总'])
    const doc1 = read(vault, DOC)
    await add.getByRole('menuitem', { name: '汇总' }).click()
    const roll = { type: 'rollup' as const, via: '练习', prop: '做完', calc: 'checked/all' as const }
    const cols1 = parseBaseDoc(blockOf(doc1)).views[0]!.columns
    await expect.poll(() => blockOf(read(vault, DOC))).toBe(setPropDef(setBaseOrder(blockOf(doc1), [...cols1, '汇总']), '汇总', roll))
    await expect(page.getByRole('menu', { name: '汇总 这一列' })).toBeVisible()
    await expect(cell(page, '第2讲', '汇总')).toHaveText('2/2')
    await page.keyboard.press('Escape')

    // ---------- 加一列「公式」：写错指到哪个字、完成灰着；点列名、函数插进去；前 4 条当场算；完成写进 formulas 和这个视图
    await clickSteady(page, addBtn)
    add = page.getByRole('dialog', { name: '加一列' })
    await add.getByRole('textbox', { name: '新的一列叫什么' }).fill('还差几节')
    await add.getByRole('menuitem', { name: '公式' }).click()
    const fx = page.getByRole('dialog', { name: '写公式' })
    await expect(fx.getByRole('textbox', { name: '列名' })).toHaveValue('还差几节')
    const src = fx.getByRole('textbox', { name: '公式' })
    await expect(src).toBeFocused()
    await expect(fx.getByRole('button', { name: '完成 ⌘↵' })).toBeDisabled()
    await src.pressSequentially('节数 - 看过')
    await expect(fx.getByRole('status')).toContainText('认不出「看过」：没有这一列，也不是能用的函数')
    await expect(fx.getByRole('button', { name: '完成 ⌘↵' })).toBeDisabled()
    await fx.getByRole('button', { name: '指到写错的地方' }).click()
    expect(await src.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([5, 7])
    await page.keyboard.press('Backspace')
    await fx.getByRole('group', { name: '列' }).getByRole('button', { name: '已看', exact: true }).click()
    await expect(src).toHaveValue('节数 - 已看')
    await expect(fx.getByRole('status')).toHaveText('')
    await expect(fx.getByRole('table', { name: '前几条算出来' }).locator('tr')).toHaveText(['第1讲 绪论0', '第2讲 需求和效用0', '第3讲 生产2', '第4讲 市场结构2'])
    // 函数一键插入：光标落在括号里
    await src.press('End')
    await src.pressSequentially(' + ')
    await fx.getByRole('group', { name: '函数' }).getByRole('button', { name: 'round()' }).click()
    await expect(src).toHaveValue('节数 - 已看 + round()')
    expect(await src.evaluate((el: HTMLTextAreaElement) => el.selectionStart)).toBe('节数 - 已看 + round('.length)
    await src.pressSequentially('0.4')
    await expect(fx.getByRole('button', { name: '完成 ⌘↵' })).toBeEnabled()
    const doc2 = read(vault, DOC)
    const cols2 = parseBaseDoc(blockOf(doc2)).views[0]!.columns
    await fx.getByRole('button', { name: '完成 ⌘↵' }).click()
    await expect.poll(() => blockOf(read(vault, DOC))).toBe(setBaseOrder(setFormula(blockOf(doc2), '还差几节', '节数 - 已看 + round(0.4)'), [...cols2, 'formula.还差几节']))
    await expect(cell(page, '第3讲', 'formula.还差几节')).toHaveText('2')

    // 列菜单「改公式…」：换成会算不出的，⌘↵ 完成；格子里一句「算不出」，悬停说哪里错
    await clickSteady(page, db(page).getByRole('button', { name: '还差几节', exact: true }))
    await page.getByRole('menu', { name: '还差几节 这一列' }).getByRole('menuitem', { name: '改公式…' }).click()
    const fx2 = page.getByRole('dialog', { name: '写公式' })
    await expect(fx2.getByRole('textbox', { name: '公式' })).toHaveValue('节数 - 已看 + round(0.4)')
    const doc3 = blockOf(read(vault, DOC))
    await fx2.getByRole('textbox', { name: '公式' }).fill('状态 * 2')
    await page.keyboard.press('Meta+Enter')
    await expect.poll(() => blockOf(read(vault, DOC))).toBe(setFormula(doc3, '还差几节', '状态 * 2'))
    await expect(cell(page, '第3讲', 'formula.还差几节').locator('.base-err')).toHaveText('算不出')
    await expect(cell(page, '第3讲', 'formula.还差几节').locator('.base-err')).toHaveAttribute('data-tip', '「状态」是字，不能乘')

    // ---------- 加一列「关联」：选连到哪个数据库，两边都写默认开；列菜单里关掉，twoWay 那一行拿掉
    await clickSteady(page, addBtn)
    add = page.getByRole('dialog', { name: '加一列' })
    await add.getByRole('textbox', { name: '新的一列叫什么' }).fill('参考')
    await add.getByRole('menuitem', { name: '关联' }).click()
    const rel = page.getByRole('dialog', { name: '新的关联列' })
    await expect(rel.getByRole('switch', { name: '两边都写' })).toHaveAttribute('aria-checked', 'true')
    await expect(rel.getByRole('menuitem', { name: /^练习/ })).toContainText('课程/ecp/练习 · 7条')
    await rel.getByRole('menuitem', { name: /^练习/ }).click()
    await expect.poll(() => read(vault, DOC)).toContain('  参考:\n    type: relation\n    to: 课程/ecp/练习\n    twoWay: 课程计划\n')
    await clickSteady(page, db(page).getByRole('button', { name: '参考', exact: true }))
    const pm = page.getByRole('menu', { name: '参考 这一列' })
    await expect(pm).toContainText('连到「练习」')
    await pm.getByRole('switch', { name: '两边都写' }).click()
    await expect.poll(() => read(vault, DOC)).toContain('  参考:\n    type: relation\n    to: 课程/ecp/练习\nviews:')
    await page.keyboard.press('Escape')

    // ---------- 状态格子：按组列出，选一个只换那一行
    const lec5 = '课程/ecp/课程计划/第5讲 博弈初步.md'
    const lec5Text = read(vault, lec5)
    await clickSteady(page, cell(page, '第5讲', '状态'))
    await cell(page, '第5讲', '状态').click()
    const st = page.getByRole('dialog', { name: '第5讲 博弈初步 · 状态' })
    await expect(st.getByRole('group')).toHaveText([/^待开始/, /^进行中/, /^完成/])
    await st.getByRole('menuitemradio', { name: '在学' }).click()
    await expect.poll(() => read(vault, lec5)).toBe(lec5Text.replace('状态: 未开始', '状态: 在学'))
  } finally {
    await run.close()
  }
})
