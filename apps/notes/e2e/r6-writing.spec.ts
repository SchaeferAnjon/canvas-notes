/**
 * 发版前第 6 轮（实用 · 写作区）找出来的问题：每条一个测试，真点、真按（⌥↑、Ctrl+T、⌘/、↓）、真打字、真拖。
 * 截图只在给了 CN_SHOTS 时截（CN_SHOT_TONE=dark 是深色）。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, leftView, openNote, pane, slowDisk, tabOn, waitSaved, type Running } from './app'
import { ICELAND } from './fixtures/board'
import { solidPng } from './fixtures/png'
import { shotTone, shotWindow } from './shots'

const vaultGit = (vault: string, args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const read = (run: Running, rel: string) => readFileSync(join(run.vault, rel), 'utf8')
const content = (page: Page) => pane(page).locator('.cm-content')
const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text })

/** 点在某一行最左边（行首） */
async function clickLineStart(page: Page, text: string) {
  const b = (await line(page, text).boundingBox())!
  await page.mouse.click(b.x + 2, b.y + b.height / 2)
}

/** 点在某一行最右边（行尾） */
async function clickLineEnd(page: Page, text: string) {
  await line(page, text).click()
  await page.keyboard.press('End')
}

/** 白板（新写法）：空白处三张卡，前面各一行位置 */
const BOARD = (c1: string, pos = 'x=300 y=80') => `---\ntype: board\n---\n<!-- card id=c0 x=0 y=80 -->\n十一月\n\n<!-- card id=c1 ${pos} -->\n${c1}\n\n<!-- card id=c2 x=600 y=80 -->\n想写的\n`

test('白板上正改着一张卡，外面把这张卡删了：框不消失，打的字留着，存下时卡放回去、外面那版存成冲突副本；外面只挪了位置：不出副本、卡不跳回', async () => {
  const run = await launch({ '写作/写作计划.md': BOARD('十二月') })
  const { page, vault } = run
  const copies = () => readdirSync(join(vault, '写作')).filter((f) => f.includes('冲突'))
  try {
    await shotTone(page)
    await openNote(page, '写作计划').catch(() => {})
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await board.locator('.db-card[data-id="c1"]').dblclick()
    const box = pane(page).getByRole('textbox', { name: '卡片内容' })
    await expect(box).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type('正在写的一大段字')
    // 外面（同步盘、另一台机器）把这张卡删了
    writeFileSync(join(vault, '写作/写作计划.md'), BOARD('十二月').replace('<!-- card id=c1 x=300 y=80 -->\n十二月\n\n', ''))
    await expect(board.locator('.db-card[data-id="c1"]')).toHaveCount(0)
    await expect(board.locator('.db-card[data-id="c2"]')).toBeVisible()
    await page.waitForTimeout(2000)
    // 框还在、焦点还在，接着打的字也进框里
    await expect(box).toBeFocused()
    await expect(box).toHaveText('十二月正在写的一大段字')
    await page.keyboard.type('还在')
    await shotWindow(run, 'r6-board-deleted-editing')
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await expect.poll(() => read(run, '写作/写作计划.md')).toBe(BOARD('十二月正在写的一大段字还在'))
    await expect.poll(copies).toHaveLength(1)
    expect(read(run, `写作/${copies()[0]}`)).not.toContain('card id=c1')
    // 白板自己底部那条提示（标签还开着）
    await expect(board.locator('.db-toast')).toContainText(`外面删了你正在改的卡：已放回，外面那版存成《${copies()[0]!.replace(/\.md$/, '')}》`)
    await expect(board.locator('.db-card[data-id="c1"]')).toContainText('十二月正在写的一大段字还在')
    // 白板视野没跳走：三张卡都在屏上
    for (const id of ['c0', 'c1', 'c2']) await expect(board.locator(`.db-card[data-id="${id}"]`)).toBeInViewport()
    await shotWindow(run, 'r6-board-deleted-back')

    // 外面只挪了这张卡（另一台机器上拖了一下）：字是我的、位置是外面的，不出副本，存下后卡不跳回
    for (const f of copies()) rmSync(join(vault, '写作', f))
    writeFileSync(join(vault, '写作/写作计划.md'), BOARD('十二月'))
    await expect(board.locator('.db-card[data-id="c1"]')).toHaveText('十二月')
    await board.locator('.db-card[data-id="c1"]').dblclick()
    await expect(box).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type('我写')
    writeFileSync(join(vault, '写作/写作计划.md'), BOARD('十二月', 'x=600 y=400'))
    await expect.poll(() => board.locator('.db-card[data-id="c1"]').evaluate((e) => (e as HTMLElement).style.left)).toBe('600px')
    await expect(box).toBeFocused()
    await page.keyboard.press('Escape')
    await expect.poll(() => read(run, '写作/写作计划.md')).toBe(BOARD('十二月我写', 'x=600 y=400'))
    await page.waitForTimeout(1000)
    expect(copies()).toHaveLength(0)
    expect(await board.locator('.db-card[data-id="c1"]').evaluate((e) => (e as HTMLElement).style.left)).toBe('600px')
  } finally {
    await run.close()
  }
})

const CALLOUT = '# 块\n\n上一段。\n\n> [!tip] 提示标题\n> 提示正文。\n\n下一段。\n'

test('展开的提示块下面的空行里打字：另起一段，下一段不并进提示块；下一段按 ⌥↑ 不挪进提示块', async () => {
  const run = await launch({ '块.md': CALLOUT })
  const { page } = run
  try {
    await openNote(page, '块')
    await clickLineStart(page, '下一段')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.type('新打的字')
    await waitSaved(page)
    expect(read(run, '块.md')).toBe(CALLOUT.replace('\n\n下一段', '\n\n新打的字\n下一段'))
    // 「新打的字」「下一段」不画在提示块里
    await expect(line(page, '新打的字')).not.toHaveClass(/cm-callout/)
    await expect(line(page, '下一段')).not.toHaveClass(/cm-callout/)
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(read(run, '块.md')).toBe(CALLOUT)
    await clickLineStart(page, '下一段')
    await page.keyboard.press('Alt+ArrowUp')
    await page.keyboard.press('Alt+ArrowUp')
    await page.waitForTimeout(1000)
    expect(read(run, '块.md')).toBe(CALLOUT)
    await expect(line(page, '下一段')).not.toHaveClass(/cm-callout/)
  } finally {
    await run.close()
  }
})

test('挨着图片、视频卡、时刻块按 ⌥↑ / ⌥↓、Ctrl+T，⌘/ 包注释：块和位置行原样，屏上不露原文', async () => {
  const VIDEO = '<!-- video video=youtube:7CVYBBX_zxA -->\n![视频标题](附件/c.png)\n[视频标题](https://www.youtube.com/watch?v=7CVYBBX_zxA)\nIC实验室 · 08:55'
  const MOMENT = '<!-- moment video=youtube:7CVYBBX_zxA t=1.1 -->\n![00:01](附件/c.png)\n[▶ 00:01 · 视频标题](https://www.youtube.com/watch?v=7CVYBBX_zxA&t=1s)\n> **00:01 原文一句**'
  const docs: Record<string, string> = {
    '图.md': '# 图\n\n上一段。\n\n![图](附件/c.png)\n\n下一段。\n',
    '视频.md': `# 视频\n\n上一段。\n\n${VIDEO}\n\n下一段。\n`,
    '时刻.md': `# 时刻\n\n上一段。\n\n${MOMENT}\n\n下一段。\n`,
    '注释键.md': '# 注释键\n\n第一段。\n\n<!-- card id=d2 x=900 y=200 -->\n第二段摆着。\n\n第三段。\n',
  }
  const run = await launch({ ...docs, '附件/c.png': solidPng(40, 30, [200, 120, 60]) })
  const { page } = run
  const raw = () => content(page).evaluate((el) => el.textContent ?? '')
  try {
    for (const name of ['图', '视频', '时刻']) {
      await openNote(page, name)
      await clickLineStart(page, '下一段')
      await page.keyboard.press('Alt+ArrowUp')
      await page.keyboard.press('Control+t')
      await clickLineEnd(page, '上一段')
      await page.keyboard.press('Alt+ArrowDown')
      await page.waitForTimeout(900)
      expect(read(run, `${name}.md`), name).toBe(docs[`${name}.md`])
      expect(await raw(), name).not.toMatch(/<!--|!\[/)
      await expect(line(page, '下一段')).toBeVisible()
    }
    await openNote(page, '注释键')
    await clickLineStart(page, '第二段摆着')
    await page.keyboard.press('Control+t')
    await page.keyboard.press('Meta+/')
    await clickLineStart(page, '第一段')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+End')
    await page.keyboard.press('Meta+/')
    await page.keyboard.press('Control+Shift+a')
    await page.waitForTimeout(900)
    expect(read(run, '注释键.md')).toBe(docs['注释键.md'])
    expect(await raw()).not.toContain('<!--')
  } finally {
    await run.close()
  }
})

test('点一下图片（选中这张图）再打字：整串字落在图下面一段，不拆到图上面', async () => {
  const DOC = '# 一图\n\n上一段。\n\n![图一](附件/c.png)\n\n下一段。\n'
  const run = await launch({ '一图.md': DOC, '附件/c.png': solidPng(160, 90, [90, 140, 200]) })
  const { page } = run
  try {
    await openNote(page, '一图')
    const img = pane(page).locator('.cm-image img')
    await expect(img).toBeVisible()
    await img.click()
    await page.keyboard.type('xyz')
    await page.keyboard.type('点图后打字')
    await waitSaved(page)
    expect(read(run, '一图.md')).toBe(DOC.replace('\n\n下一段', '\n\nxyz点图后打字\n下一段'))
    // ⌘Z 一下回到原样（一次打字）
    for (let i = 0; i < 2; i++) await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(read(run, '一图.md')).toBe(DOC)
  } finally {
    await run.close()
  }
})

test('点提示块标题左边的图标再打字：字进提示块标题，笔记标题不变，页面不跳到最上面', async () => {
  const filler = Array.from({ length: 30 }, (_, i) => `第${i + 1}段，凑够一屏多的字，让提示块在下面。`).join('\n\n')
  const DOC = `# 长文\n\n${filler}\n\n> [!question] 我的疑惑\n> 疑惑的正文。\n\n收尾。\n`
  const run = await launch({ '长文.md': DOC })
  const { page } = run
  try {
    await shotTone(page)
    await openNote(page, '长文')
    const icon = pane(page).locator('.cm-callout-icon').first()
    // 提示块在一屏多以下（编辑器只画看得见的几行）：光标到文末，滚过去
    await line(page, '第1段').click()
    await page.keyboard.press('Meta+ArrowDown')
    await expect(icon).toBeInViewport()
    await expect(line(page, '第1段')).toHaveCount(0)
    await icon.click()
    await page.keyboard.type('点了图标')
    await waitSaved(page)
    expect(read(run, '长文.md')).toBe(DOC.replace('[!question] 我的疑惑', '[!question] 点了图标我的疑惑'))
    // 页面没跳到最上面：提示块还在屏上
    await expect(line(page, '点了图标我的疑惑')).toBeInViewport()
    await shotWindow(run, 'r6-callout-icon-typed')
    // 点图标后按 End、Delete：笔记标题和下面那段不并在一起（报告里光标在文首，Delete 并掉了「# 长文」下面的空行）
    await icon.click()
    await page.keyboard.press('End')
    await page.keyboard.press('Delete')
    await page.waitForTimeout(900)
    expect(read(run, '长文.md').startsWith('# 长文\n\n第1段')).toBe(true)
  } finally {
    await run.close()
  }
})

test('白板上摆过的段落：和上一段之间的空行和普通空行一样高（块间 12），↓ 停得进去、点得进去，打的字在空行里', async () => {
  const DOC = '# 拖出\n\n第一段文字。\n\n<!-- card id=d2 x=900 y=200 -->\n第二段文字。\n\n第三段文字。\n'
  const run = await launch({ '拖出.md': DOC })
  const { page } = run
  try {
    await shotTone(page)
    await openNote(page, '拖出')
    // 第一段和摆着的第二段之间那一行（藏着位置行的空行），和第二、三段之间的普通空行一样高（竖向疏密：块和块之间压成 12）
    const gap = line(page, '第二段文字').locator('xpath=preceding-sibling::div[1]')
    const plain = await line(page, '第二段文字').evaluate((el) => (el.nextElementSibling as HTMLElement).getBoundingClientRect().height)
    const h = await gap.evaluate((el) => el.getBoundingClientRect().height)
    expect(plain).toBe(12)
    expect(Math.abs(h - plain)).toBeLessThan(2)
    await shotWindow(run, 'r6-placed-gap')
    // ↓ 从上一段末尾进空行
    await clickLineEnd(page, '第一段文字')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.type('空行里')
    await waitSaved(page)
    expect(read(run, '拖出.md')).toBe(DOC.replace('第一段文字。\n\n', '第一段文字。\n空行里\n'))
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(read(run, '拖出.md')).toBe(DOC)
    // 点空行
    const b = (await gap.boundingBox())!
    await page.mouse.click(b.x + 40, b.y + b.height / 2)
    await page.keyboard.type('点进来')
    await waitSaved(page)
    expect(read(run, '拖出.md')).toBe(DOC.replace('第一段文字。\n\n', '第一段文字。\n点进来\n'))
  } finally {
    await run.close()
  }
})

test('盘慢时点了「新建笔记」又马上去左栏点开别的笔记：新笔记在后台开、不抢焦点，切走后打的字留在切到的那篇', async () => {
  const run = await launch({ '日记.md': '# 日记\n\n今天下雪了。\n', '慢慢走.md': '# 慢慢走\n\n走路的事。\n', '写作习惯.md': '# 写作习惯\n\n每天写。\n' })
  const { page, vault } = run
  const newBtn = page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' })
  const noteTabs = page.getByTestId('tab-list').getByRole('tab')
  const inbox = () => (existsSync(join(vault, '收件箱')) ? readdirSync(join(vault, '收件箱')) : [])
  try {
    // 写作习惯先开着（第二次切过去的是开着的标签）
    await openNote(page, '写作习惯')
    await openNote(page, '日记')
    await clickLineEnd(page, '今天下雪了')
    await slowDisk(run, { write: 1500, read: 600 })
    for (const [to, typed] of [
      ['慢慢走', '切走后打的'],
      ['写作习惯', '第二次切走'],
    ] as const) {
      const tabsBefore = await noteTabs.count()
      await newBtn.click()
      await page.waitForTimeout(150)
      await page.locator('.nav .si', { hasText: to }).first().click()
      await page.keyboard.type(typed)
      // 新笔记建好（写 1.5 秒、读 0.6 秒）以后：标签多一个，当前还是切到的那篇
      await expect(noteTabs).toHaveCount(tabsBefore + (to === '慢慢走' ? 2 : 1), { timeout: 15_000 })
      await page.waitForTimeout(1500)
      await expect(tabOn(page)).toHaveText(to)
      await expect(content(page)).toBeFocused()
      await expect.poll(() => read(run, `${to}.md`), { timeout: 15_000 }).toContain(typed)
      await page.keyboard.type('又一句')
      await expect.poll(() => read(run, `${to}.md`), { timeout: 15_000 }).toContain(typed + '又一句')
    }
    expect(read(run, '日记.md')).toBe('# 日记\n\n今天下雪了。\n')
    // 新建的两篇在后台标签里，空着（没收到切走后打的字）
    for (const f of inbox()) expect(read(run, `收件箱/${f}`)).not.toMatch(/切走|又一句/)
  } finally {
    await run.close()
  }
})

test('文件夹首页「笔记」一栏：只有数据库表的笔记写「数据库」，不写「空的」', async () => {
  const BASE = '# 清单\n\n```base\nfilters:\n  and:\n    - file.inFolder("写作/清单")\nviews:\n  - type: table\n```\n'
  const run = await launch({ '写作/清单.md': BASE, '写作/清单/一条.md': '# 一条\n', '写作/一篇.md': '# 一篇\n\n正文。\n' })
  const { page } = run
  try {
    await leftView(page, '文件')
    await page.getByRole('tree', { name: '全部文件' }).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^写作$/ }) }).click()
    const row = pane(page).getByTestId('folder-content').getByRole('region', { name: '笔记' }).locator('.fc-row', { hasText: '清单' })
    await expect(row.locator('.pv')).toHaveText('数据库')
  } finally {
    await run.close()
  }
})

test('AI 存卡提交没成功，之后自动提交先把卡收进去了：「再提交一次」说「已经由自动提交收进去了」，给撤回，撤回只撤 AI 改的那篇', async () => {
  const run = await launch({ '冰岛自驾.md': ICELAND, '日记.md': '# 日记\n\n今天。\n' }, { CN_AI_FAKE: '1', CN_MINUTE_MS: '300' })
  const { page, vault } = run
  const ai = page.getByRole('complementary', { name: 'AI 对话' })
  try {
    await shotTone(page)
    writeFileSync(join(vault, '.git/index.lock'), '')
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    await page.getByRole('button', { name: '打开 AI' }).click()
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('/总结这块白板')
    await box.press('Enter')
    const msg = ai.getByTestId('ai-msg').last()
    await expect(msg).toContainText('这块白板讲了三件事')
    await msg.getByRole('button', { name: '存成卡片' }).click()
    const warn = msg.getByTestId('ai-warn')
    await expect(warn.locator('.t')).toHaveText('卡存好了，提交没成功', { timeout: 15_000 })
    // 日记里也打几个字：自动提交一起收走
    await openNote(page, '日记')
    await clickLineEnd(page, '今天')
    await page.keyboard.type('下雪')
    await waitSaved(page)
    // 锁放开：自动提交（3 秒一次）把卡和日记一起提交了
    rmSync(join(vault, '.git/index.lock'))
    await expect.poll(() => vaultGit(vault, ['status', '--porcelain']), { timeout: 20_000 }).toBe('')
    const auto = vaultGit(vault, ['log', '-1', '--format=%H %s'])
    expect(auto).not.toContain('AI：')
    // AI 对话跟着地方走（D 组 CN-132）：回到白板那段对话里点「再提交一次」
    await page.locator('.tab', { hasText: '冰岛自驾' }).locator('.tl').click()
    await warn.getByRole('button', { name: '再提交一次' }).click()
    await expect(msg.locator('.done')).toHaveText('卡存好了，已经由自动提交收进去了', { timeout: 15_000 })
    const change = msg.getByTestId('ai-change')
    await expect(change).toContainText('改了1个文件')
    await expect(change).toContainText('冰岛自驾.md')
    await expect(change).toContainText('自动提交收进去的')
    await shotWindow(run, 'r6-ai-taken-by-autocommit')
    await change.getByRole('button', { name: '撤回' }).click()
    await expect(change).toContainText('已撤回')
    expect(read(run, '冰岛自驾.md')).not.toContain('这块白板讲了三件事')
    expect(read(run, '冰岛自驾.md')).toBe(ICELAND)
    // 同一次自动提交里的日记不动
    expect(read(run, '日记.md')).toContain('今天。下雪')
    expect(vaultGit(vault, ['log', '-1', '--format=%s'])).toBe('撤回AI：总结「冰岛自驾」存成卡片')
    expect(vaultGit(vault, ['show', '--name-only', '--format=', 'HEAD'])).toBe('冰岛自驾.md')
  } finally {
    await run.close()
  }
})
