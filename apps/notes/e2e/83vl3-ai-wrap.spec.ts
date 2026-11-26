// AI 回答整条左右滑（task-83vl3，用户截图 r34/img1、img2）：回答里一长串没空格的行内代码 `torch.tensor(inputs.to_numpy(dtype=float))`
// 撑宽了回答，整个对话列表跟着能横着滑，往左滑字就被切掉。修好以后：正文和行内代码折行，整条回答、对话列表都不横着滚；
// 只有代码块、宽表格在自己的框里横着滚。右栏 AI 对话、读 PDF 的讲解卡、文档里的 AI 讲解提示块都量一遍。无头、假 AI、临时库。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { join } from 'node:path'
import { acts, launch, openAi, openNote, tabOn } from './app'
import { board, col } from './fixtures/board-doc'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const LONG = 'torch.tensor(inputs.to_numpy(dtype=float)).reshape(-1,1)'

/** 量一条回答：对话列表、回答、正文的 scrollWidth / clientWidth；正文里不在代码块、表格、公式块里却伸出正文右边的东西；代码块、表格自己的宽 */
function measure(msg: Locator) {
  return msg.evaluate((el) => {
    const list = el.closest('.msgs') as HTMLElement
    const txt = el.querySelector('.txt') as HTMLElement
    const box = txt.getBoundingClientRect()
    const own = 'pre, .md-table, .mblock'
    const out = [...txt.querySelectorAll<HTMLElement>('*')]
      .filter((x) => !x.closest(own) || x.matches(own))
      .filter((x) => x.getBoundingClientRect().right > box.right + 0.5)
      .map((x) => `${x.tagName.toLowerCase()}.${x.className}「${(x.textContent ?? '').slice(0, 30)}」`)
    // 字本身（长网址这种没空格的一串是文字，不是元素）：一段一段量每行的右边
    const walk = document.createTreeWalker(txt, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (n.parentElement?.closest(own)) continue
      const r = document.createRange()
      r.selectNodeContents(n)
      if ([...r.getClientRects()].some((b) => b.right > box.right + 0.5)) out.push(`字「${(n.textContent ?? '').slice(0, 30)}」`)
    }
    const sz = (x: Element) => ({ sw: x.scrollWidth, cw: x.clientWidth, right: Math.round(x.getBoundingClientRect().right - box.right) })
    const inline = [...txt.querySelectorAll('code')].filter((c) => !c.closest('pre')).map((c) => ({ text: c.textContent, lines: c.getClientRects().length, right: Math.round(c.getBoundingClientRect().right - box.right) }))
    return {
      list: { sw: list.scrollWidth, cw: list.clientWidth },
      msg: { sw: el.scrollWidth, cw: el.clientWidth },
      txt: { sw: txt.scrollWidth, cw: txt.clientWidth },
      out,
      inline,
      pres: [...txt.querySelectorAll('pre')].map(sz),
      tables: [...txt.querySelectorAll('.md-table')].map(sz),
    }
  })
}

/** 回答整条不横着滑、横着滚的只有代码块和宽表；真在正文上、代码块上横着拨两下 */
async function noSideways(page: Page, msg: Locator) {
  const m = await measure(msg)
  console.log(JSON.stringify(m))
  expect(m.list.sw).toBeLessThanOrEqual(m.list.cw)
  expect(m.msg.sw).toBeLessThanOrEqual(m.msg.cw)
  expect(m.txt.sw).toBeLessThanOrEqual(m.txt.cw)
  expect(m.out).toEqual([])
  // 那串长行内代码折成了几行，没伸出正文
  const long = m.inline.find((c) => c.text === LONG)!
  expect(long.lines).toBeGreaterThan(1)
  expect(long.right).toBeLessThanOrEqual(0)
  // 代码块：照原样一行一行（不折），比框宽，在自己的框里横着滚，框不伸出正文
  expect(m.pres.length).toBe(1)
  expect(m.pres[0]!.sw).toBeGreaterThan(m.pres[0]!.cw)
  expect(m.pres[0]!.right).toBeLessThanOrEqual(0)
  // 窄表不滚；九列的宽表在自己的框里横着滚
  expect(m.tables.length).toBe(2)
  expect(m.tables[0]!.sw).toBeLessThanOrEqual(m.tables[0]!.cw)
  expect(m.tables[1]!.sw).toBeGreaterThan(m.tables[1]!.cw)
  for (const t of m.tables) expect(t.right).toBeLessThanOrEqual(0)

  // 真拨：在正文第一段上横着拨，对话列表不动
  const list = msg.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " msgs ")][1]')
  await msg.locator('.txt p').first().hover()
  await page.mouse.wheel(300, 0)
  await page.waitForTimeout(150)
  expect(await list.evaluate((el) => el.scrollLeft)).toBe(0)
  // 在代码块上横着拨：代码块自己滚，对话列表还是不动
  const pre = msg.locator('pre')
  await pre.scrollIntoViewIfNeeded()
  await pre.hover()
  await page.mouse.wheel(200, 0)
  await expect.poll(() => pre.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
  expect(await list.evaluate((el) => el.scrollLeft)).toBe(0)
}

test('右栏 AI 对话：长行内代码折行，整条回答不横着滑；代码块、宽表在自己的框里横着滚；回答下面没有空白小方块', async () => {
  const run = await launch({ '学习笔记.md': '# 学习笔记\n\n一段字。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    const chat = page.getByRole('complementary', { name: 'AI 对话' })
    const box = chat.getByRole('textbox', { name: '问 AI' })
    // 问的话里也带一长串没空格的代码（真 AI 那一遍撑宽对话列表的是问的那条气泡）
    await box.fill(`给我一段宽内容，讲讲 ${LONG}.to(device)`)
    await box.press('Enter')
    await expect(chat.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const um = await chat.locator('.um').last().evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(um.sw).toBeLessThanOrEqual(um.cw)
    const msg = chat.getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toContainText('下一步就能转成张量')
    await noSideways(page, msg)
    // 截图里那三个「空白小方块」：回答正文后面没有空着的块（没画出来的按钮、空的 .acts），每一块都有字
    const blank = await msg.evaluate((el) => [...el.children].filter((c) => !(c as HTMLElement).innerText.trim()).map((c) => c.className))
    expect(blank).toEqual([])
    await page.screenshot({ path: process.env.CN_SHOT_DIR ? join(process.env.CN_SHOT_DIR, 'wrap-chat.png') : test.info().outputPath('wrap-chat.png') })
  } finally {
    await run.close()
  }
})

test('读 PDF 的讲解卡：同一段宽内容，整条回答不横着滑', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await openAi(page)
    const ai = page.getByRole('complementary', { name: '边读边问 AI' })
    const box = ai.getByRole('textbox', { name: '问 AI' })
    await box.fill('这一页给我一段宽内容')
    await box.press('Enter')
    const msg = ai.getByTestId('reading-msg').last()
    await expect(msg.locator('.txt')).toContainText('下一步就能转成张量', { timeout: 15_000 })
    await noSideways(page, msg)
    await page.screenshot({ path: process.env.CN_SHOT_DIR ? join(process.env.CN_SHOT_DIR, 'wrap-reading.png') : test.info().outputPath('wrap-reading.png') })
  } finally {
    await run.close()
  }
})

test('文档里的 AI 讲解提示块：长行内代码折行，文档不横着滚', async () => {
  const note = `# 讲解\n\n> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 3 页\n> 转张量时写 \`${LONG}${LONG}\`，表里混着小数和布尔值会报错。\n\n后面一段。\n`
  const run = await launch({ '讲解.md': note }, {})
  const { page } = run
  try {
    await openNote(page, '讲解')
    const ed = page.locator('.pane:not([hidden]) .cm-editor')
    await expect(ed.locator('.cm-content')).toContainText('表里混着小数')
    const m = await ed.evaluate((el) => {
      const sc = el.querySelector('.cm-scroller') as HTMLElement
      const content = el.querySelector('.cm-content') as HTMLElement
      const r = content.getBoundingClientRect()
      const lines = [...el.querySelectorAll<HTMLElement>('.cm-line')].filter((l) => l.textContent?.includes('torch'))
      return { sw: sc.scrollWidth, cw: sc.clientWidth, out: lines.map((l) => Math.round(l.getBoundingClientRect().right - r.right)), rows: lines.map((l) => l.getClientRects().length && Math.round(l.getBoundingClientRect().height)) }
    })
    console.log(JSON.stringify(m))
    expect(m.sw).toBeLessThanOrEqual(m.cw)
    for (const o of m.out) expect(o).toBeLessThanOrEqual(0)
  } finally {
    await run.close()
  }
})

// 用户截图 r38/img1：白板卡里 4 行 × 3 列的表，右边一列被卡直接切掉。现在表在卡里自己横着滚（触控板横着拨、Shift+滚轮），
// 卡、白板都不动；右边还有列时右边渐隐，滚到头就没了、左边出渐隐
const WIDE_BOARD = `---
type: board
---
# 动手学深度学习

## NumPy 和框架

NumPy 不是深度学习框架，区别在于：

| 能力 | NumPy | 深度学习框架 | 备注说明 | 再来一列 | 第六列 | 第七列 | 第八列 | 第九列 |
|---|---|---|---|---|---|---|---|---|
| 多维数组 | ndarray | Tensor | 两者几乎一样 | 第五列 | 六 | 七 | 八 | 九 |
| GPU 加速 | 只能用 CPU | 能用 GPU | 差得最多 | 第五列 | 六 | 七 | 八 | 九 |
| 自动微分 | 导数要自己写 | backward 自动算 | 训练离不开 | 第五列 | 六 | 七 | 八 | 九 |
| 现成的网络层 | 没有 | nn.Linear 这些 | 拿来就用 | 第五列 | 六 | 七 | 八 | 九 |

## 别的

一段字。

## 第三节

又一段字。

## 第四节

再一段字。

## 第五节

最后一段字。
`

test('白板卡里的宽表格：在卡里横着滚，卡和白板不动；右边渐隐，滚到头换成左边', async () => {
  const run = await launch({ '动手学深度学习.md': WIDE_BOARD })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '动手学深度学习')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page)).toBeVisible()
    const card = col(page, 'NumPy 和框架').locator('.db-card[data-kind="table"]')
    // 表格格子放不下会折行（每格至少 4em，mt wrap），五列在卡里放得下了；九列才比卡宽
    await expect(card.locator('.kh')).toHaveText('表格4行 × 9列')
    const box = card.locator('.mt-box')
    const wrap = board(page).locator('.board-wrap').first()
    const state = async () => ({
      box: await box.evaluate((el) => ({ sl: el.scrollLeft, sw: el.scrollWidth, cw: el.clientWidth, r: el.classList.contains('math-fade-r'), l: el.classList.contains('math-fade-l') })),
      board: await wrap.evaluate((el) => ({ sl: el.scrollLeft, st: el.scrollTop, sw: el.scrollWidth, cw: el.clientWidth })),
      card: (await card.boundingBox())!,
    })
    const s0 = await state()
    console.log(JSON.stringify(s0))
    // 表比卡宽：表在自己的框里，框不伸出卡；右边渐隐、左边没有
    expect(s0.box.sw).toBeGreaterThan(s0.box.cw)
    expect(s0.box.r).toBe(true)
    expect(s0.box.l).toBe(false)
    const cb = s0.card
    const bb = (await box.boundingBox())!
    expect(bb.x + bb.width).toBeLessThanOrEqual(cb.x + cb.width + 0.5)

    // 触控板横着拨（在表上）：表滚了，卡没挪、白板没平移
    await box.hover()
    await page.mouse.wheel(60, 0)
    await expect.poll(async () => (await state()).box.sl).toBeGreaterThan(0)
    let s = await state()
    expect(s.board.sl).toBe(s0.board.sl)
    expect(s.board.st).toBe(s0.board.st)
    expect(s.card).toEqual(s0.card)
    expect(s.box.l).toBe(true)

    // 滚到头：右边渐隐没了；再往右拨，白板也不跟着平移
    await page.mouse.wheel(2000, 0)
    await expect.poll(async () => (await state()).box.r).toBe(false)
    await page.mouse.wheel(400, 0)
    await page.waitForTimeout(200)
    s = await state()
    expect(s.box.sl).toBe(s.box.sw - s.box.cw)
    expect(s.board.sl).toBe(s0.board.sl)
    expect(s.card).toEqual(s0.card)

    // Shift+滚轮往回滚：macOS 把按着 Shift 的鼠标滚轮在系统里就换成横向（deltaX）交给软件，这里照那个样子发
    await page.keyboard.down('Shift')
    await page.mouse.wheel(-3000, 0)
    await page.keyboard.up('Shift')
    await expect.poll(async () => (await state()).box.sl).toBe(0)
    s = await state()
    expect(s.box.l).toBe(false)
    expect(s.box.r).toBe(true)
    expect(s.board.sl).toBe(s0.board.sl)
    expect(s.card).toEqual(s0.card)
    await page.screenshot({ path: process.env.CN_SHOT_DIR ? join(process.env.CN_SHOT_DIR, 'wrap-board.png') : test.info().outputPath('wrap-board.png') })

    // 白板比窗口宽（五列）：在空白处横着拨，白板照常平移；在表上竖着拨也不拦（表不是竖着的滚动框）
    expect(s0.board.sw).toBeGreaterThan(s0.board.cw)
    const wb = (await wrap.boundingBox())!
    await page.mouse.move(wb.x + wb.width - 40, wb.y + wb.height - 40)
    await page.mouse.wheel(200, 0)
    await expect.poll(async () => (await state()).board.sl).toBeGreaterThan(s0.board.sl)
  } finally {
    await run.close()
  }
})
