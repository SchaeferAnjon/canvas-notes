/**
 * 数据库 AI 列（第三批 task-i921u「AI 生成一列」方向 B「右栏一页」），假 AI 引擎（CN_AI_FAKE=1）真点、真打字：
 * 表头「+」→「AI 生成一列」→ 写「每一讲的练习题」→ 先跑前 3 条看样例 → 全跑剩下 5 条、esc 停下、接着跑 → 单格重跑、撤回 →
 * 再加一列「难度」（单选）→ 手改一格 → 整列重跑不动手改的 → 撤回回到原样。
 * 每个动作之后读盘：只改了该改的几行、和 packages/format 算出来的一样；打开、看样例不写文件；跑一批一次提交、能撤回。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiFilled, parseBaseDoc, prop } from '@cn/format'
import { ECP_DOC, EXERCISES, LECTURES } from '../../../packages/format/test/base-samples'
import { lineDiff } from '../../../packages/format/test/line-diff'
import { gitStatus, launch, openNote, pane, tabOn } from './app'

const DOC = '课程/ecp/ecp 课程计划.md'
const FILES: Record<string, string> = { [DOC]: ECP_DOC, ...LECTURES, ...EXERCISES }
const P = (n: string) => Object.keys(LECTURES).find((p) => p.includes(`/${n} `))!
const NOTE = (name: string) => `课程/ecp/练习题/${name} 练习题.md`

const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const blockOf = (text: string) => /```base\n([\s\S]*?)\n```/.exec(text)![1]!

const db = (page: Page) => pane(page).locator('[data-part="数据库块"]').first()
const row = (page: Page, name: string) => db(page).locator('tbody tr', { hasText: name })
const cell = (page: Page, name: string, col: string) => row(page, name).locator(`td[data-col="${col}"]`)
const side = (page: Page) => page.getByTestId('dview-aicol')
const toast = (page: Page) => page.getByTestId('toast')
/** 先滚到它、停一下再点（滚动事件晚到一帧会把刚开的浮层收起；人也是先看见再点） */
async function clickSteady(page: Page, el: Locator) {
  await el.scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await el.click()
}

test('AI 列：加列、先跑 3 条看样例、全跑、esc 停、接着跑、单格重跑、撤回；单选列手改、整列重跑不动手改的', async () => {
  test.setTimeout(300_000)
  const run = await launch(FILES, { CN_AI_FAKE: '1', CN_FAKE_AICOL_MS: '1500' })
  const { page, vault, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, 'ecp 课程计划')
    await expect(db(page).locator('tbody tr')).toHaveCount(8)

    // ---------- 表头「+」：加一列的菜单最下面「AI 生成一列」
    await clickSteady(page, db(page).getByRole('button', { name: '加一列' }))
    const add = page.getByRole('dialog', { name: '加一列' })
    await expect(add.getByRole('menuitem', { name: /AI 生成一列/ })).toContainText('说要什么，AI 逐条读笔记填进来')
    await add.getByRole('menuitem', { name: /AI 生成一列/ }).click()
    await expect(side(page)).toBeVisible()
    await expect(page.locator('.dtab[data-view="aicol"] .dname')).toHaveText('AI 生成一列')
    const box = side(page).getByRole('textbox', { name: '这一列放什么' })
    await expect(box).toBeFocused()
    // 打开、写要求都不写文件
    await box.pressSequentially('每一讲的练习题')
    await expect(box).toBeFocused()
    await expect(side(page).getByRole('radio', { name: '新建一篇笔记，关联过来' })).toHaveAttribute('aria-checked', 'true')
    await expect(side(page)).toContainText('照你写的猜的，能改')
    await expect(side(page).getByRole('textbox', { name: '列名' })).toHaveValue('练习题')
    await expect(side(page)).toContainText('放进 课程/ecp/练习题/')
    await expect(side(page).getByTestId('aic-pick')).toContainText('跟 AI 对话')
    await page.waitForTimeout(600)
    expect(gitStatus(vault)).toBe('')

    // ---------- 先跑前 3 条：块里多这一列那几行；前 3 格在写、其余「等全跑」；写好了三张样例卡整段摊开
    await side(page).getByRole('button', { name: '先跑前 3 条' }).click()
    await expect(page.locator('.dtab[data-view="aicol"] .dname')).toHaveText('AI 列「练习题」')
    await expect(cell(page, '第1讲', '练习题').locator('[data-state="running"]')).toBeVisible()
    await expect(side(page).getByTestId('ai-foot').or(side(page).locator('.pfoot'))).toContainText('先跑前 3 条')
    await expect(side(page).locator('.pfoot')).toContainText('停下')
    await expect(toast(page)).toContainText('前 3 条写好了 · 新建 3 篇笔记，算一次提交', { timeout: 20_000 })
    for (const n of ['第1讲', '第2讲', '第3讲']) await expect(cell(page, n, '练习题')).toContainText('3 道')
    await expect(cell(page, '第4讲', '练习题')).toHaveText('等全跑')
    await expect(side(page).locator('.scard')).toHaveCount(3)
    await expect(side(page).locator('.scard').nth(2).locator('ol li')).toHaveCount(3)
    await expect(side(page).locator('.pfoot')).toContainText('不要这一列')
    // 文件：块里多那几行；那三讲开头多两行；新建三篇，开头所属讲、正文 [!ai] 块；一次提交
    const src = blockOf(read(vault, DOC))
    expect(parseBaseDoc(src).props['练习题']).toEqual({ type: 'ai', prompt: '每一讲的练习题', output: 'note', folder: '课程/ecp/练习题', twoWay: '所属讲', reads: 'note', newRows: 'auto', ai: null })
    for (const n of ['第1讲', '第2讲', '第3讲']) {
      const p = P(n)
      const name = p.split('/').pop()!.replace(/\.md$/, '')
      expect(lineDiff(LECTURES[p]!, read(vault, p))).toEqual({ removed: [], added: [`练习题: "[[${name} 练习题]]"`, 'AI填的: 练习题'] })
      const note = read(vault, NOTE(name))
      expect(note.startsWith(`---\n所属讲: "[[${name}]]"\n---\n\n> [!ai] 练习题 · Claude Code · `)).toBe(true)
      expect(note).toContain(`读了《${name}》`)
    }
    expect(read(vault, P('第4讲'))).toBe(LECTURES[P('第4讲')])
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/^数据库 AI 列「练习题」：先跑前 3 条（新建 3 篇笔记，3 格）/)
    expect(gitStatus(vault).split('\n').filter((l) => l && !l.includes('ecp 课程计划'))).toEqual([])

    // ---------- 全跑剩下 5 条：一次 3 条、有的在写有的排队；按 esc 停下
    await side(page).getByRole('button', { name: '全跑剩下 5 条' }).click()
    await expect(side(page).locator('.rowlist [data-state="queued"]').first()).toBeVisible()
    await expect(side(page).locator('.rowlist [data-state="running"]')).toHaveCount(3)
    await expect(side(page).locator('.pfoot')).toContainText('一次 3 条')
    // 写好一格以后再按 esc：写好的存了，在写的那几格停下
    await expect(side(page).locator('.rowlist [data-state="done"]').first()).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('Escape')
    await expect(toast(page)).toContainText(/停在 \d\/5，写好的都存了/, { timeout: 20_000 })
    await expect(side(page).locator('.pfoot')).toContainText(/停在 \d\/8，写好的都存了/)
    const stoppedLeft = await side(page).locator('.rowlist .r', { hasText: '停下了，没写' }).count()
    expect(stoppedLeft).toBeGreaterThan(0)
    await expect(db(page).locator('td[data-col="练习题"]', { hasText: '停下了，没写' })).toHaveCount(stoppedLeft)
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/^数据库 AI 列「练习题」：跑空着的 5 条/)

    // ---------- 接着跑：8 格都填好
    await side(page).getByRole('button', { name: `接着跑剩下 ${stoppedLeft} 条` }).click()
    await expect(side(page).locator('.pfoot')).toContainText('8 格都填好了 · 新加的一讲会自动填', { timeout: 30_000 })
    for (const p of Object.keys(LECTURES)) expect(aiFilled(read(vault, p))).toEqual(['练习题'])
    await page.waitForTimeout(800)

    // ---------- 单格重跑：只有这一格在写；那篇只换 AI 那一块（第 2 版），那一讲一个字不动；撤回回到原来那组题
    const n3 = NOTE('第3讲 生产')
    const before3 = read(vault, n3)
    const lec3 = read(vault, P('第3讲'))
    await cell(page, '第3讲', '练习题').hover()
    await cell(page, '第3讲', '练习题').getByRole('button', { name: '重跑这一格' }).click()
    await expect(cell(page, '第3讲', '练习题').locator('[data-state="running"]')).toBeVisible()
    await expect(db(page).locator('td.aic [data-state="running"]')).toHaveCount(1)
    await expect(toast(page)).toContainText('重跑了「第3讲 生产」这一格 · 只换了那篇里 AI 那一块', { timeout: 20_000 })
    const after3 = read(vault, n3)
    const d3 = lineDiff(before3, after3)
    expect(d3.added[0]).toMatch(/^> \[!ai\] 练习题（第 2 版） · /)
    expect(d3.removed.every((l) => l.startsWith('>'))).toBe(true)
    expect(read(vault, P('第3讲'))).toBe(lec3)
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(toast(page)).toContainText('撤回了：文件回到这次之前的样子')
    await expect.poll(() => read(vault, n3)).toBe(before3)
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('撤回：数据库 AI 列「练习题」：重跑「第3讲 生产」这一格')

    // ---------- 练习题那种的「手改」是打开那篇直接改（在右栏「记录」开，和别处点一条一样）：块头上多「改过」，格子换成灰点（算你写的）
    const n2 = NOTE('第2讲 需求和效用')
    await clickSteady(page, cell(page, '第2讲', '练习题').getByRole('button', { name: '打开《第2讲 需求和效用 练习题》' }))
    await expect(page.getByTestId('dtab-record')).toHaveText('第2讲 需求和效用 练习题')
    await expect(tabOn(page)).toHaveText('ecp 课程计划')
    const peekBody = page.locator('.rpeek .rec-body')
    const q1 = /^> 1\. (.+)$/m.exec(read(vault, n2))![1]!
    await peekBody.locator('.cm-line', { hasText: q1 }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('（我改的）')
    await expect(peekBody.locator('.cm-callout-meta')).toContainText('改过')
    await expect.poll(() => read(vault, n2)).toContain('（我改的）')
    expect(read(vault, n2)).toMatch(/^> \[!ai\] 练习题 · .* · 改过$/m)
    const mine2 = read(vault, n2)
    await expect(cell(page, '第2讲', '练习题').locator('.mine-dot')).toBeVisible()

    // ---------- 列头菜单：AI 列那一段；整列重跑（练习题）：你改过的那篇不动，别的 7 篇只换 AI 那一块
    await clickSteady(page, db(page).locator('thead .base-th[data-col="练习题"]'))
    const menu = page.getByRole('menu', { name: '练习题 这一列' })
    await expect(menu).toContainText('「每一讲的练习题」')
    await expect(menu.getByRole('menuitem', { name: /只跑空着和没跑完的/ })).toBeDisabled()
    await expect(menu.getByRole('switch', { name: '新加的一讲自动填' })).toHaveAttribute('aria-checked', 'true')
    await expect(menu.getByRole('menuitem', { name: /整列重跑/ })).toContainText('你改过的 1 格不动')
    const notesBefore = Object.fromEntries(Object.keys(LECTURES).map((p) => [p, read(vault, NOTE(p.split('/').pop()!.replace(/\.md$/, '')))]))
    await menu.getByRole('menuitem', { name: /整列重跑/ }).click()
    await expect(toast(page)).toContainText('「练习题」7 格写好了', { timeout: 30_000 })
    expect(read(vault, n2)).toBe(mine2)
    for (const [p, t] of Object.entries(notesBefore)) {
      if (p === P('第2讲')) continue
      const now = read(vault, NOTE(p.split('/').pop()!.replace(/\.md$/, '')))
      expect(now).not.toBe(t)
      expect(lineDiff(t, now).removed.every((l) => l.startsWith('>'))).toBe(true)
    }
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(toast(page)).toContainText('撤回了')
    for (const [p, t] of Object.entries(notesBefore)) await expect.poll(() => read(vault, NOTE(p.split('/').pop()!.replace(/\.md$/, '')))).toBe(p === P('第2讲') ? mine2 : t)

    // ---------- 再加一列「难度」（单选）：常用里点「难度」，先跑 3 条、全跑
    await clickSteady(page, db(page).getByRole('button', { name: '加一列' }))
    await page.getByRole('dialog', { name: '加一列' }).getByRole('menuitem', { name: /AI 生成一列/ }).click()
    await side(page).getByRole('button', { name: '难度' }).click()
    await expect(side(page).getByRole('radio', { name: '单选' })).toHaveAttribute('aria-checked', 'true')
    await side(page).getByRole('button', { name: '先跑前 3 条' }).click()
    await expect(toast(page)).toContainText('前 3 条写好了 · 算一次提交', { timeout: 20_000 })
    await side(page).getByRole('button', { name: '全跑剩下 5 条' }).click()
    await expect(side(page).locator('.pfoot')).toContainText('8 格都填好了', { timeout: 30_000 })
    const p5 = P('第5讲')
    expect(prop(read(vault, p5), '难度')).toBe('难')
    expect(aiFilled(read(vault, p5))).toEqual(['练习题', '难度'])

    // ---------- 手改第5讲的难度：值换掉、「AI填的」里去掉，格子开头换成灰点
    const before5 = read(vault, p5)
    await cell(page, '第5讲', '难度').hover()
    await cell(page, '第5讲', '难度').getByRole('button', { name: '手改' }).click()
    const input = cell(page, '第5讲', '难度').getByRole('combobox').or(cell(page, '第5讲', '难度').getByRole('textbox'))
    await input.fill('中')
    await input.press('Enter')
    await expect(toast(page)).toContainText('这一格算你写的，AI 的标志去掉了；整列重跑不动它')
    await expect.poll(() => read(vault, p5)).not.toBe(before5)
    const d5 = lineDiff(before5, read(vault, p5))
    expect([d5.removed.sort(), d5.added.sort()]).toEqual([['AI填的: 练习题, 难度', '难度: 难'], ['AI填的: 练习题', '难度: 中']])
    await expect(cell(page, '第5讲', '难度').locator('.mine-dot')).toBeVisible()
    const mine5 = read(vault, p5)

    // ---------- 整列重跑：你改过的那一格不动，别的 7 格换了
    await clickSteady(page, db(page).locator('thead .base-th[data-col="难度"]'))
    await expect(page.getByRole('menu', { name: '难度 这一列' }).getByRole('menuitem', { name: /整列重跑/ })).toContainText('你改过的 1 格不动')
    await page.getByRole('menu', { name: '难度 这一列' }).getByRole('menuitem', { name: /整列重跑/ }).click()
    await expect(side(page).locator('.rowlist [data-state="running"]').first()).toBeVisible()
    await expect(side(page).locator('.rowlist .r[data-path$="第5讲 博弈初步.md"]')).not.toHaveAttribute('data-state', /running|queued/)
    await expect(toast(page)).toContainText('「难度」7 格写好了', { timeout: 30_000 })
    expect(read(vault, p5)).toBe(mine5)
    expect(prop(read(vault, P('第1讲')), '难度')).toBe('中')

    // ---------- 撤回这一批：回到整列重跑之前
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(toast(page)).toContainText('撤回了')
    await expect.poll(() => prop(read(vault, P('第1讲')), '难度')).toBe('易')
    expect(read(vault, p5)).toBe(mine5)
    await expect.poll(() => gitStatus(vault).split('\n').filter((l) => l && !l.includes('ecp 课程计划'))).toEqual([])
    expect(existsSync(join(vault, NOTE('第8讲 复习')))).toBe(true)

    // ---------- 原文改过：外面改了第6讲的正文，「练习题」那一格上一个小点，点一下只重跑这一格
    const p6 = P('第6讲')
    writeFileSync(join(vault, p6), read(vault, p6).replace('二手车市场的例子。', '二手车市场的例子。保险市场也一样。'))
    const dot = cell(page, '第6讲', '练习题').getByRole('button', { name: '原文改过，点一下重跑' })
    await expect(dot).toBeVisible({ timeout: 15_000 })
    // 只有第6讲那一行：「练习题」「难度」两列都是 AI 照原来的正文写的
    await expect(db(page).getByRole('button', { name: '原文改过，点一下重跑' })).toHaveCount(2)
    await expect(db(page).locator('tbody tr', { hasText: '第6讲' }).getByRole('button', { name: '原文改过，点一下重跑' })).toHaveCount(2)
    await dot.click()
    await expect(toast(page)).toContainText('重跑了「第6讲 信息不对称」这一格', { timeout: 20_000 })
    await expect(dot).toHaveCount(0)
    await expect(cell(page, '第6讲', '难度').getByRole('button', { name: '原文改过，点一下重跑' })).toHaveCount(1)
    expect(read(vault, NOTE('第6讲 信息不对称'))).toMatch(/^> \[!ai\] 练习题（第 \d 版）/m)

    // ---------- 「难度」列头菜单关掉「新加的一讲自动填」：块里只换 newRows 那一行
    const docBefore = blockOf(read(vault, DOC))
    await clickSteady(page, db(page).locator('thead .base-th[data-col="难度"]'))
    await page.getByRole('menu', { name: '难度 这一列' }).getByRole('switch', { name: '新加的一讲自动填' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => blockOf(read(vault, DOC))).not.toBe(docBefore)
    expect(lineDiff(docBefore, blockOf(read(vault, DOC)))).toEqual({ removed: ['    newRows: auto'], added: ['    newRows: manual'] })

    // ---------- 新加的一讲自动填（「练习题」开着、「难度」刚关了）：外面放进来一讲，只填「练习题」那一格
    const p9 = '课程/ecp/课程计划/第9讲 总复习.md'
    writeFileSync(join(vault, p9), '---\n状态: 未开始\n---\n\n## 要点\n\n把九讲串起来。\n')
    await expect(cell(page, '第9讲', '练习题')).toContainText('3 道', { timeout: 20_000 })
    expect(prop(read(vault, p9), '难度')).toBeUndefined()
    expect(aiFilled(read(vault, p9))).toEqual(['练习题'])
    expect(existsSync(join(vault, NOTE('第9讲 总复习')))).toBe(true)
  } finally {
    await run.close()
  }
})
