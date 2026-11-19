/**
 * 第 8 轮 · 「文档、书摘与白板」验收查出来的几处（task-qv2yz 第 4 步）：
 * - 文档切成的白板上双击卡片点「改字」：在排好的样子上直接改字（和文档里一样的所见即所得），不露 [!quote]、书链接、weread://；
 * - 短文档点中间栏文末下面很远的空白：和点文末那一行一样，字落在最后（最后一块是代码块、标题、引用都试）；
 * - 数据库表头一行 33.5 高；
 * - 文档里 Obsidian 写法的图片 ![[图.png]]、![[图.png|300]] 画成图，打开再保存文件不变；
 * - 白板卡里的双链 [[a/b/笔记]] 只露笔记名（有别名露别名），和文档里一样。
 * 都是真点、真打字。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, gitStatus, launch, openNote, pane, waitSaved } from './app'
import { docBoardVault, TRAVEL_NOTE } from './fixtures/doc-board'
import { solidPng } from './fixtures/png'

const read = (vault: string, name: string) => readFileSync(join(vault, name), 'utf8')
const docBoard = (page: Page) => pane(page).getByTestId('doc-board')
const col = (page: Page, name: string) => docBoard(page).getByRole('region', { name, exact: true })

test('文档白板「改字」：在排好的样子上直接改，不露 [!quote]、书链接、weread://、** 这些写法；改的字写回那一段，Esc 存下', async () => {
  const run = await launch(docBoardVault())
  const { page, vault } = run
  const file = () => read(vault, '写作/冰岛十天环岛.md')
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, '冰岛十天环岛')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(docBoard(page)).toBeVisible()
    // 书摘卡：双击看全文，点「改字」
    await col(page, '出发前').locator('.db-card.fc-clip').first().dblclick()
    const dlg = page.getByRole('dialog', { name: '全文' })
    await dlg.getByRole('button', { name: '改字' }).click()
    const box = dlg.getByRole('textbox', { name: '这张卡的字' })
    await expect(box).toBeVisible()
    await expect(box).toBeFocused()
    // 没有 md 原文框；看得见的字里一个写法都不露，也不是等宽字
    await expect(dlg.locator('textarea')).toHaveCount(0)
    await page.screenshot({ path: 'test-results/r8-改字-书摘.png' })
    for (const raw of ['[!quote]', 'weread://', '[《', '](', '> ']) await expect(dlg).not.toContainText(raw, { useInnerText: true })
    await expect(dlg).toContainText('在冰岛，天气不是闲聊的话题，是第二天的行程表。')
    // 和文档里一样：书名一行，链接收成小块（weread:// 写「微信读书」，不写 book…），评价照文档里的样子
    await expect(dlg.locator('.cm-urlchip')).toHaveText('微信读书')
    await expect(dlg).toContainText('我的评价：所以每天只排一个主景点，剩下的时间留给天气。')
    const font = await box.evaluate((el) => getComputedStyle(el).fontFamily)
    expect(font).not.toMatch(/mono|Menlo|SF Mono/i)
    // 光标在最后：打的字接在评价后面，Esc 存下
    await page.keyboard.type('冬天尤其是。', { delay: 30 })
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await expect.poll(file).toBe(TRAVEL_NOTE.replace('剩下的时间留给天气。', '剩下的时间留给天气。冬天尤其是。'))

    // 带加粗的正文卡：** 不露，改中间的字只改那几个字
    await docBoard(page).locator('.db-card', { hasText: '主要看三样' }).first().dblclick()
    await dlg.getByRole('button', { name: '改字' }).click()
    await expect(dlg).not.toContainText('**', { useInnerText: true })
    await expect(dlg.locator('.cm-strong')).toHaveText('极光、冰洞、黑沙滩')
    await dlg.locator('.cm-line', { hasText: '二月底出发' }).click({ position: { x: 2, y: 10 } })
    await page.keyboard.press('Home')
    await page.keyboard.type('今年')
    await dlg.getByRole('button', { name: '存好' }).click()
    await expect(dlg).toHaveCount(0)
    await expect.poll(file).toContain('今年二月底出发，十天，冬天走一号公路。主要看三样：**极光、冰洞、黑沙滩**。')

    // 改字时 ⌘Z 撤的是弹层里的字；没改直接关，文件不动
    const before = file()
    await docBoard(page).locator('.db-card', { hasText: '主要看三样' }).first().dblclick()
    await dlg.getByRole('button', { name: '改字' }).click()
    await page.keyboard.type('X')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await page.waitForTimeout(1200)
    expect(file()).toBe(before)
    await waitSaved(page)
  } finally {
    await run.close()
  }
})

for (const [kind, last] of [
  ['代码块', '```java\njava\n```'],
  ['标题', '## 第二天'],
  ['引用', '> 冰岛的天气五分钟一变。'],
] as const) {
  test(`点版心下面很远的空白（最后一块是${kind}）：和点文末那一行一样，光标进文末新起的一段，字落在最后`, async () => {
    const md = `# 冰岛行程\n\n第一天去雷克雅未克。\n\n${last}\n`
    const run = await launch({ '冰岛行程.md': md })
    const { page, vault } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
      await openNote(page, '冰岛行程')
      // 打开时光标停在第一段末尾（以前点远处空白焦点丢了，字落到这里）
      await pane(page).locator('.cm-line', { hasText: '第一天去' }).click()
      const doc = (await pane(page).locator('.doc').boundingBox())!
      const body = (await pane(page).locator('.body').boundingBox())!
      // .doc 下面、中间岛下半截
      const y = body.y + body.height - 60
      expect(y).toBeGreaterThan(doc.y + doc.height + 20)
      await page.mouse.click(doc.x + doc.width / 2, y)
      expect(await page.evaluate(() => document.activeElement?.classList.contains('cm-content'))).toBe(true)
      await page.keyboard.type('窗底', { delay: 40 })
      await waitSaved(page)
      expect(read(vault, '冰岛行程.md')).toBe(md + '\n窗底\n')
      // 只点不打字：文件一个字节都不多
      await page.mouse.click(doc.x + 40, y)
      await pane(page).locator('.cm-line', { hasText: '第一天去' }).click()
      await page.waitForTimeout(1200)
      expect(read(vault, '冰岛行程.md')).toBe(md + '\n窗底\n')
    } finally {
      await run.close()
    }
  })
}

test('数据库表头一行 33.5 高、数据一行 36（照小样和 DESIGN.v3 6.5）', async () => {
  const ROOMS = '```base\nfilters:\n  and:\n    - file.inFolder("住宿")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 价格\n```'
  const run = await launch({ '冰岛行程.md': `# 冰岛行程\n\n${ROOMS}\n\n后面一段。\n`, '住宿/维克.md': '---\n价格: 980\n---\n', '住宿/霍芬.md': '---\n价格: 1150\n---\n' })
  const { page } = run
  try {
    await openNote(page, '冰岛行程')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)
    const th = await db.locator('thead th').first().evaluate((e) => e.getBoundingClientRect().height)
    const td = await db.locator('tbody td').first().evaluate((e) => e.getBoundingClientRect().height)
    expect(th).toBeCloseTo(33.5, 1)
    expect(td).toBeCloseTo(36, 1)
  } finally {
    await run.close()
  }
})

test('文档里 Obsidian 写法的图片 ![[图.png]]、![[图.png|300]]：画成图（按名字在库里找，|300 是宽）；什么都不改文件不变', async () => {
  const md = '# 看图\n\n第一段。\n\n![[极光.png]]\n\n![[极光.png|300]]\n\n![[子/路径/冰洞.png]]\n\n后面一段。\n'
  const run = await launch({ '写作/看图.md': md, '附件/极光.png': solidPng(640, 360, [40, 160, 120]), '子/路径/冰洞.png': solidPng(200, 100, [120, 160, 220]) })
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openNote(page, '看图')
    const imgs = pane(page).locator('.cm-image img')
    await expect(imgs).toHaveCount(3)
    for (let i = 0; i < 3; i++) await expect.poll(() => imgs.nth(i).evaluate((e: HTMLImageElement) => e.complete && e.naturalWidth)).toBeGreaterThan(100)
    expect(await imgs.nth(1).evaluate((e) => e.getBoundingClientRect().width)).toBeCloseTo(300, 0)
    // 原文一个记号都不露
    await expect(pane(page).locator('.cm-content')).not.toContainText('![[', { useInnerText: true })
    await expect(pane(page).locator('.cm-content')).not.toContainText('|300', { useInnerText: true })
    // 点进前后的段落、点图，不改字：文件不变
    await pane(page).locator('.cm-line', { hasText: '第一段' }).click()
    await imgs.first().click()
    await pane(page).locator('.cm-line', { hasText: '后面一段' }).click()
    await page.waitForTimeout(1200)
    expect(read(vault, '写作/看图.md')).toBe(md)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('白板卡里的双链 [[a/b/笔记]] 只露笔记名，有别名露别名；文档里一样', async () => {
  const BOARD = '---\ntype: board\n---\n# 链接板\n\n<!-- card id=a x=80 y=80 w=260 -->\n看 [[课程/ecp/第五讲]] 和 [[课程/ecp/第六讲|下一讲]]\n'
  const DOC = '# 链接稿\n\n## 一\n\n看 [[课程/ecp/第五讲]] 和 [[课程/ecp/第六讲|下一讲]]\n'
  const run = await launch({ '链接板.md': BOARD, '链接稿.md': DOC, '课程/ecp/第五讲.md': '# 第五讲\n', '课程/ecp/第六讲.md': '# 第六讲\n' })
  const { page, vault } = run
  try {
    // 真白板
    await page.locator('.nav .si', { hasText: '链接板' }).first().click()
    const card = pane(page).getByTestId('board').locator('.bcard[data-id="a"]')
    await expect(card).toContainText('看 第五讲 和 下一讲')
    await expect(card).not.toContainText('课程/ecp')
    // 文档切成的白板
    await openNote(page, '链接稿')
    await expect(pane(page).locator('.cm-content')).toContainText('看 第五讲 和 下一讲')
    await expect(pane(page).locator('.cm-content')).not.toContainText('课程/ecp', { useInnerText: true })
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(col(page, '一').locator('.db-card').first()).toContainText('看 第五讲 和 下一讲')
    await expect(col(page, '一')).not.toContainText('课程/ecp')
    await page.waitForTimeout(1200)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('表格格子里打完字马上点正文接着打（机器速度，点和打之间不停）：格子里的字写回去，接着打的每个字都落在点的地方', async () => {
  const md = '# 冰岛行程\n\n第一天去雷克雅未克。\n\n| 日期 | 地点 |\n|---|---|\n| 2-24 |  |\n\n后面一段。\n'
  const run = await launch({ '冰岛行程.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '冰岛行程')
    const first = pane(page).locator('.cm-line', { hasText: '第一天去' })
    for (let i = 0; i < 3; i++) {
      await pane(page).locator('.cm-table td').last().click()
      await expect(pane(page).locator('.cm-table input')).toBeFocused()
      await page.keyboard.type('乙地', { delay: 30 })
      // 点第一段末尾，紧接着打字（两个键隔 0、40 毫秒）
      const box = (await first.boundingBox())!
      await page.mouse.click(box.x + box.width - 2, box.y + box.height / 2)
      await page.keyboard.type('QW', { delay: i === 0 ? 0 : 40 })
      await waitSaved(page)
      const want = md.replace('第一天去雷克雅未克。', '第一天去雷克雅未克。' + 'QW'.repeat(i + 1)).replace('| 2-24 |  |', `| 2-24 | ${'乙地'.repeat(i + 1)} |`)
      await expect.poll(() => read(vault, '冰岛行程.md')).toBe(want)
    }
  } finally {
    await run.close()
  }
})

test('普通白板（type: board）双击改字：剪藏卡、带加粗和双链的卡都在排好的样子上改，不露 ](、http、[[、** 这些写法；Esc、点别处、⌘↵ 都存下；不改字关掉文件不变', async () => {
  const BOARD =
    '---\ntype: board\n---\n# 剪藏板\n\n' +
    '<!-- card id=c1 x=80 y=80 w=300 -->\n> 冬天白天只有五六个小时。\n—— [去冰岛之前要知道的十件事](https://zhuanlan.zhihu.com/p/62019734)\n\n' +
    '<!-- card id=c2 x=440 y=80 w=300 -->\n先看 **黄金圈**，再读 [[课程/ecp/第五讲]]\n'
  const run = await launch({ '剪藏板.md': BOARD, '课程/ecp/第五讲.md': '# 第五讲\n' })
  const { page, vault } = run
  const file = () => read(vault, '剪藏板.md')
  try {
    await page.locator('.nav .si', { hasText: '剪藏板' }).first().click()
    const board = pane(page).getByTestId('board')
    const clip = board.locator('.bcard[data-id="c1"]')
    // 打开、不改字、Esc：文件一个字节不变
    await clip.dblclick()
    const box = board.getByRole('textbox', { name: '卡片内容' })
    await expect(box).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await page.waitForTimeout(1200)
    expect(file()).toBe(BOARD)

    // 剪藏卡改字：不露写法，不是等宽字，改引文那一行
    await clip.dblclick()
    await expect(box).toBeFocused()
    await expect(board.locator('textarea')).toHaveCount(0)
    for (const raw of ['](', 'http', '[[', '> ', '——[']) await expect(clip).not.toContainText(raw, { useInnerText: true })
    await expect(clip).toContainText('冬天白天只有五六个小时。')
    expect(await box.evaluate((el) => getComputedStyle(el).fontFamily)).not.toMatch(/mono|Menlo|SF Mono/i)
    await page.screenshot({ path: 'test-results/r8-真白板改字-剪藏.png' })
    await clip.locator('.cm-line', { hasText: '冬天白天' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('超市周日关门早。', { delay: 20 })
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await expect.poll(file).toBe(BOARD.replace('> 冬天白天只有五六个小时。', '> 冬天白天只有五六个小时。超市周日关门早。'))

    // 带加粗、双链的卡：只露「黄金圈」「第五讲」；改完点白板空白处存下
    const note = board.locator('.bcard[data-id="c2"]')
    await note.dblclick()
    await expect(box).toBeFocused()
    for (const raw of ['**', '[[', '课程/ecp']) await expect(note).not.toContainText(raw, { useInnerText: true })
    await expect(note.locator('.cm-strong')).toHaveText('黄金圈')
    await expect(note.locator('.cm-wikilink')).toHaveText('第五讲')
    await page.keyboard.type('。')
    const bb = (await board.boundingBox())!
    await page.mouse.click(bb.x + bb.width - 80, bb.y + bb.height - 80)
    await expect(box).toHaveCount(0)
    await expect.poll(file).toContain('先看 **黄金圈**，再读 [[课程/ecp/第五讲]]。\n')

    // ⌘↵ 也存下，不多一个空行
    await note.dblclick()
    await page.keyboard.type('好')
    await page.keyboard.press('Meta+Enter')
    await expect(box).toHaveCount(0)
    await expect.poll(file).toContain('先看 **黄金圈**，再读 [[课程/ecp/第五讲]]。好\n')
    await waitSaved(page)
  } finally {
    await run.close()
  }
})

test('代码块和上下两块：块和块之间 12、代码块上下内边距各 12（DESIGN.v3 6.1、6.5）', async () => {
  const md = '# 冰岛行程\n\n冲锋衣、雪地靴。\n\n```java\njava\n```\n\n后面一段。\n'
  const run = await launch({ '冰岛行程.md': md })
  try {
    await openNote(run.page, '冰岛行程')
    const ys = await run.page.evaluate(() => {
      const r = (s: string) => document.querySelector('.pane:not([hidden]) ' + s)!.getBoundingClientRect()
      const para = Array.from(document.querySelectorAll('.pane:not([hidden]) .cm-line')).find((l) => l.textContent === '冲锋衣、雪地靴。')!.getBoundingClientRect()
      const top = r('.cm-code-top')
      const code = document.querySelectorAll('.pane:not([hidden]) .cm-codeblock')[1]!.getBoundingClientRect()
      const bot = r('.cm-code-bot')
      const after = Array.from(document.querySelectorAll('.pane:not([hidden]) .cm-line')).find((l) => l.textContent === '后面一段。')!.getBoundingClientRect()
      return { gapAbove: top.top - para.bottom, padTop: code.top - top.top, padBot: bot.bottom - code.bottom, gapBelow: after.top - bot.bottom }
    })
    expect(ys.gapAbove).toBeCloseTo(12, 1)
    expect(ys.padTop).toBeCloseTo(12, 1)
    expect(ys.padBot).toBeCloseTo(12, 1)
    expect(ys.gapBelow).toBeCloseTo(12, 1)
  } finally {
    await run.close()
  }
})
