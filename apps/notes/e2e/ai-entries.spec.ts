/**
 * 「问 AI」入口的防回归清单（r171、r172 用户：「把这两个地方修复了，并且以后杜绝这样的问题」）。
 * 每个入口真点一遍：点了 → 右栏真出现交来的东西（看得到里的「选中的N个 / N块 / N张」、输入框里的引用、跑起来的命令）→ 真发一句 →
 * 假引擎这一轮真收到了那些内容（CN_FAKE_TURN_LOG 记 AI 对话每一轮的提示，CN_FAKE_PICK_LOG 记 / 命令每一问的提示）。
 * 用户两次都是右栏正看着别处问的一段（顶上「这是在《X》问的 · 切到《…》」）时点的，所以每一条都先造出这个样子再点；
 * 修前「看得到」那一行被「这是在《X》问的」顶掉，交来的几篇、几块画不出来，点了像没反应。
 * 加了新的「问 AI」入口，在这里加一条。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, leftView, openNote, pane, type Running, tabOn } from './app'
import { board, openBoard } from './fixtures/board-doc'
import { DOC_PATH, FILES } from './fixtures/board-select'
import { LECTURE } from './fixtures/pdf'
import { armMenus, openedMenu, pickMenu } from './menu'

const files = {
  ...FILES,
  '另一页.md': '# 另一页\n\n先在这一页问过一句。\n',
  '收件箱/白板里面回车有问题.md': '# 白板里面回车有问题\n\n白板卡片里按回车跳出卡片。\n',
  '收件箱/视频 ai 放大之后消失.md': '# 视频 ai 放大之后消失\n\n视频放大以后 AI 按钮不见了。\n',
  '收件箱/速记抓不到内容.md': '# 速记抓不到内容\n\n速记窗口抓不到网页内容。\n',
  '课程/第3讲.pdf': LECTURE,
}
const DOC_TITLE = '2.3 线性代数'
const BOARD_TITLE = '学习笔记：动手学深度学习'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const input = (page: Page) => chat(page).getByRole('textbox', { name: '问 AI' })
const away = (page: Page) => chat(page).getByTestId('ai-away')
const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()

interface Logged {
  said?: string
  prompt: string
  cmd?: string
}
/** 起软件：假引擎，AI 对话每一轮、/ 命令每一问的提示都记下来 */
async function start(env: Record<string, string> = {}): Promise<Running & { turns: () => Logged[]; asks: () => Logged[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'cn-ai-entries-'))
  const turnLog = join(dir, 'turns.jsonl')
  const askLog = join(dir, 'asks.jsonl')
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_TURN_LOG: turnLog, CN_FAKE_PICK_LOG: askLog, ...env })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
  const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as Logged) : [])
  return Object.assign(run, { turns: () => read(turnLog), asks: () => read(askLog) })
}

/** 用户截图里那样：在《另一页》问过一句，再开 open 那一页，右栏留着刚才那段（顶上「这是在《另一页》问的」） */
async function awayFrom(page: Page, open: () => Promise<void>) {
  await openNote(page, '另一页')
  await page.keyboard.press('Meta+j')
  await input(page).fill('你好')
  await input(page).press('Enter')
  await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
  await open()
  await expect(away(page)).toContainText('这是在《另一页》问的')
}

/** 发一句，等这一轮答完，回 AI 这一轮拿到的提示 */
async function send(run: Awaited<ReturnType<typeof start>>, text: string): Promise<Logged> {
  const before = run.turns().length
  await input(run.page).fill(text)
  await input(run.page).press('Enter')
  await expect(chat(run.page).locator('.um').last()).toContainText(text)
  await expect.poll(() => run.turns().length, { timeout: 15_000 }).toBeGreaterThan(before)
  return run.turns().at(-1)!
}

/** 交来的东西落在这一页的对话上：顶上不再是「这是在《另一页》问的」，对话胶囊是这一页 */
async function onThisPage(page: Page, name: string) {
  await expect(away(page)).toHaveCount(0)
  await expect(chat(page).getByTestId('ai-conv')).toHaveText(name)
}

// ---------- 左栏文件树 ----------

/** 收件箱那一枝真框选：在最后一行下面的空白处按下，往上拖到第一行 */
async function lassoInbox(page: Page): Promise<string[]> {
  await leftView(page, '收件箱')
  const tree = page.locator('aside.side').getByRole('tree')
  const rows = tree.locator('[role="treeitem"][data-path^="收件箱/"]')
  await expect(rows).toHaveCount(3)
  const t = (await tree.boundingBox())!
  const last = (await rows.nth(2).boundingBox())!
  const top = (await rows.nth(0).boundingBox())!
  await page.mouse.move(t.x + 120, last.y + last.height + 30)
  await page.mouse.down()
  await page.mouse.move(t.x + 130, top.y + top.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('aside.side').getByRole('toolbar', { name: '选中的' }).locator('b')).toHaveText('已选3个')
  return Promise.all([0, 1, 2].map(async (i) => (await rows.nth(i).getAttribute('data-path'))!))
}

test('1 文件树多选，底部浮条「问AI」（r171）：看得到「选中的3个」，发一句 AI 收到这 3 篇', async () => {
  const run = await start()
  const { page } = run
  try {
    await awayFrom(page, () => openNote(page, DOC_TITLE))
    const picked = await lassoInbox(page)
    await page.locator('aside.side').getByRole('toolbar', { name: '选中的' }).getByRole('button', { name: '问AI' }).click()
    // 左栏点「收件箱」时中间开的是收件箱首页：这一页是「收件箱」
    await onThisPage(page, '收件箱')
    await expect(chat(page).getByTestId('ai-picked')).toHaveText('选中的3个')
    await expect(input(page)).toBeFocused()
    const got = await send(run, '选中的这几篇讲什么')
    for (const p of picked) expect(got.prompt).toContain(p)
  } finally {
    await run.close()
  }
})

test('2 文件树多选，右键「问 AI」：同一条路', async () => {
  const run = await start()
  const { page } = run
  try {
    await armMenus(run)
    await awayFrom(page, () => openNote(page, DOC_TITLE))
    const picked = await lassoInbox(page)
    await page.locator('aside.side').getByRole('tree').locator(`[data-path="${picked[0]}"]`).click({ button: 'right' })
    expect((await openedMenu(run)).find((i) => i.label === '问 AI')?.enabled).toBe(true)
    await pickMenu(run, '问 AI')
    await onThisPage(page, '收件箱')
    await expect(chat(page).getByTestId('ai-picked')).toHaveText('选中的3个')
    const got = await send(run, '选中的这几篇讲什么')
    for (const p of picked) expect(got.prompt).toContain(p)
  } finally {
    await run.close()
  }
})

// ---------- 文档：选好几块的操作条 ----------

/** 从「矩阵-矩阵乘法 AB」左边空白按住往下拖到「范数：向量有多大」：三块 */
async function frameBlocks(page: Page) {
  const a = (await line(page, '矩阵-矩阵乘法 AB').boundingBox())!
  const z = (await line(page, '范数：向量有多大').boundingBox())!
  await page.mouse.move(a.x - 30, a.y + 6)
  await page.mouse.down()
  await page.mouse.move(a.x - 28, a.y + 40, { steps: 4 })
  await page.mouse.move(a.x - 26, z.y + 10, { steps: 10 })
  await page.mouse.up()
  await expect(page.getByTestId('doc-selbar').locator('.cnt')).toHaveText('已选3块')
}

test('3 文档里选 3 块，操作条「问AI」（r172 图1）：看得到「这篇里选中的3块」，发一句 AI 收到这 3 块的原文', async () => {
  const run = await start()
  const { page } = run
  try {
    await awayFrom(page, () => openNote(page, DOC_TITLE))
    await frameBlocks(page)
    await page.getByTestId('doc-selbar').getByRole('button', { name: '问AI' }).click()
    // CN_SHOTS 给了：点完的样子截一张（修前修后并排看）
    if (process.env.CN_SHOTS) await page.waitForTimeout(400).then(() => page.screenshot({ path: join(process.env.CN_SHOTS!, 'doc-blocks-ask.png') }))
    await onThisPage(page, DOC_TITLE)
    await expect(chat(page).getByTestId('ai-cards')).toHaveText('这篇里选中的3块')
    await expect(input(page)).toBeFocused()
    const got = await send(run, '讲一讲这几块')
    for (const s of ['矩阵-矩阵乘法 AB 可以看作', 'Hadamard积', '范数：向量有多大']) expect(got.prompt).toContain(s)
  } finally {
    await run.close()
  }
})

test('4 文档里选 3 块，操作条「AI整理」：在这一页的对话里跑「/整理这几段」，AI 收到这 3 块，给出改前改后', async () => {
  const run = await start()
  const { page } = run
  try {
    await awayFrom(page, () => openNote(page, DOC_TITLE))
    await frameBlocks(page)
    await page.getByTestId('doc-selbar').getByRole('button', { name: 'AI整理' }).click()
    await onThisPage(page, DOC_TITLE)
    await expect(chat(page).locator('.um').last()).toHaveText('/整理这几段')
    await expect.poll(() => run.asks().find((a) => a.cmd === '整理这几段')?.prompt ?? '', { timeout: 15_000 }).toContain('范数：向量有多大')
    await expect(chat(page).getByTestId('ai-msg').last()).not.toContainText('没答出来')
  } finally {
    await run.close()
  }
})

test('4b「AI整理」答着时点「停下」（r172 图1「Claude Code没答出来」，原话「AbortError: 停下了」）：说「停下了」，不当成没答出来', async () => {
  const run = await start({ CN_FAKE_ASK_MS: '20000' })
  const { page } = run
  try {
    await openNote(page, DOC_TITLE)
    await frameBlocks(page)
    await page.getByTestId('doc-selbar').getByRole('button', { name: 'AI整理' }).click()
    const last = chat(page).getByTestId('ai-msg').last()
    await expect(last).toContainText('读了选中的3块')
    await chat(page).getByRole('button', { name: '停下' }).click()
    await expect(last).toContainText('停下了')
    await expect(last).not.toContainText('没答出来')
    await expect(last).not.toContainText('AbortError')
  } finally {
    await run.close()
  }
})

// ---------- 白板：框选的操作条 ----------

async function pickCards(page: Page) {
  const card = (id: string) => board(page).locator(`.db-card[data-id="${id}"]`)
  for (const [i, id] of ['f3', 'f4'].entries()) {
    await card(id).scrollIntoViewIfNeeded()
    const b = (await card(id).boundingBox())!
    if (i) await page.keyboard.down('Shift')
    await page.mouse.click(b.x + 40, b.y + 16)
    if (i) await page.keyboard.up('Shift')
  }
  await expect(page.getByTestId('db-selbar').locator('.cnt')).toHaveText('已选2张')
}

test('5 白板上选 2 张，操作条「问AI」：看得到「白板上选中的2张」，发一句 AI 收到这 2 张', async () => {
  const run = await start()
  const { page } = run
  try {
    await awayFrom(page, () => openBoard(page, BOARD_TITLE))
    await pickCards(page)
    await page.getByTestId('db-selbar').getByRole('button', { name: '问AI' }).click()
    await onThisPage(page, BOARD_TITLE)
    await expect(chat(page).getByTestId('ai-cards')).toHaveText('白板上选中的2张')
    const got = await send(run, '总结这几张')
    for (const s of ['范数：向量有多大', '矩阵-矩阵乘法 AB 可以看作']) expect(got.prompt).toContain(s)
  } finally {
    await run.close()
  }
})

test('6 白板上选 2 张，操作条「AI整理」：在这一页的对话里跑「/整理这几张」，AI 收到这 2 张', async () => {
  const run = await start()
  const { page } = run
  try {
    await awayFrom(page, () => openBoard(page, BOARD_TITLE))
    await pickCards(page)
    await page.getByTestId('db-selbar').getByRole('button', { name: 'AI整理' }).click()
    await onThisPage(page, BOARD_TITLE)
    await expect(chat(page).locator('.um').last()).toHaveText('/整理这几张')
    await expect.poll(() => run.asks().find((a) => a.cmd === '整理这几张')?.prompt ?? '', { timeout: 15_000 }).toContain('范数：向量有多大')
  } finally {
    await run.close()
  }
})

// ---------- 带着一段字进输入框的入口（引用进右栏开着的那段，DESIGN.v3 2.4 对话绑页面） ----------

/** 选中这一行的字（点进去、⇧End） */
async function selectLine(page: Page, text: string) {
  const b = (await line(page, text).boundingBox())!
  await page.mouse.click(b.x + 2, b.y + b.height / 2)
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
}

async function quoteSent(run: Awaited<ReturnType<typeof start>>, text: string) {
  await expect(chat(run.page).getByTestId('ai-mat').last()).toContainText(text.slice(0, 8))
  const got = await send(run, '这段讲什么')
  expect(got.prompt).toContain(text)
}

test('7 文档里选了字按 ⌘J（AI 收着时）：带着这段打开，引用在输入框里，发一句 AI 收到这段', async () => {
  const run = await start()
  const { page } = run
  try {
    await openNote(page, DOC_TITLE)
    await selectLine(page, '我的疑问')
    await page.keyboard.press('Meta+j')
    await expect(chat(page)).toBeVisible()
    await quoteSent(run, '我的疑问：为什么深度学习里常用 L2 而不是 L1？')
  } finally {
    await run.close()
  }
})

test('8 文档里选了字右键「问 AI 这段」：引用进右栏开着的那段，发一句 AI 收到这段', async () => {
  const run = await start()
  const { page } = run
  try {
    await armMenus(run)
    await awayFrom(page, () => openNote(page, DOC_TITLE))
    await selectLine(page, '我的疑问')
    await line(page, '我的疑问').click({ button: 'right', position: { x: 40, y: 8 } })
    await pickMenu(run, '问 AI 这段')
    await quoteSent(run, '我的疑问：为什么深度学习里常用 L2 而不是 L1？')
  } finally {
    await run.close()
  }
})

test('9 块把手菜单「问 AI 这一块」：这一块进输入框，发一句 AI 收到', async () => {
  const run = await start()
  const { page } = run
  try {
    await awayFrom(page, () => openNote(page, DOC_TITLE))
    await expect(async () => {
      const b = (await line(page, '我的疑问').boundingBox())!
      await page.mouse.move(b.x + 40, b.y + b.height / 2)
      await page.mouse.move(b.x + 60, b.y + b.height / 2)
      await expect(pane(page).locator('.blk-bar:not([hidden]) .blk-grip')).toBeVisible({ timeout: 500 })
    }).toPass({ timeout: 5000 })
    await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click()
    await page.getByRole('menu', { name: '块菜单' }).getByRole('menuitem', { name: '问 AI 这一块' }).click()
    await quoteSent(run, '我的疑问：为什么深度学习里常用 L2 而不是 L1？')
  } finally {
    await run.close()
  }
})

test('10 白板卡右键「问 AI 这张」：这张卡进输入框，发一句 AI 收到', async () => {
  const run = await start()
  const { page } = run
  try {
    await armMenus(run)
    await awayFrom(page, () => openBoard(page, BOARD_TITLE))
    const card = board(page).locator('.db-card[data-id="f3"]')
    await card.scrollIntoViewIfNeeded()
    await card.click({ button: 'right', position: { x: 40, y: 16 } })
    await pickMenu(run, '问 AI 这张')
    await quoteSent(run, '范数：向量有多大')
  } finally {
    await run.close()
  }
})

// ---------- 只打开 AI 的入口、跑 AI 命令的入口 ----------

test('11 ⌘K「问AI」：右栏 AI 打开，输入框能发，AI 收到这一句', async () => {
  const run = await start()
  const { page } = run
  try {
    await openNote(page, DOC_TITLE)
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox').fill('问AI')
    await pal.locator('.pal-row').filter({ has: page.locator('.nm', { hasText: /^问AI$/ }) }).first().click()
    await expect(chat(page)).toBeVisible()
    const got = await send(run, '这一篇讲什么')
    expect(got.said).toBe('这一篇讲什么')
    expect(got.prompt).toContain(DOC_PATH)
  } finally {
    await run.close()
  }
})

test('12 ⌘K「总结这块白板」：右栏开着别处的对话时跑在右栏开着的那段（AI 命令进开着的那段），AI 收到这块白板', async () => {
  const run = await start()
  const { page } = run
  try {
    await awayFrom(page, () => openBoard(page, BOARD_TITLE))
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await pal.getByRole('textbox').fill('总结这块白板')
    await pal.locator('.pal-row').filter({ has: page.locator('.nm', { hasText: /^总结这块白板$/ }) }).first().click()
    await expect(chat(page).locator('.um').last()).toHaveText('/总结这块白板')
    await expect.poll(() => run.asks().find((a) => a.cmd === '总结')?.prompt ?? '', { timeout: 15_000 }).toContain('全书分三部分')
    await expect(chat(page).getByTestId('ai-msg').last()).not.toContainText('没答出来')
  } finally {
    await run.close()
  }
})

test('13 左栏「最近」头上「问AI」：右栏 AI 打开，能发', async () => {
  const run = await start()
  const { page } = run
  try {
    await openNote(page, DOC_TITLE)
    await leftView(page, '最近')
    await page.locator('aside.side').getByRole('button', { name: '问AI' }).click()
    await expect(chat(page)).toBeVisible()
    const got = await send(run, '你好')
    expect(got.said).toBe('你好')
  } finally {
    await run.close()
  }
})

// ---------- 读 PDF：选字的小条 ----------

test('14 PDF 选字，小条「讲解一下」：右栏换成这份 PDF 的 AI，那段字带进去、AI 答了', async () => {
  const run = await start()
  const { page } = run
  try {
    // 先在《另一页》问过一句、右栏开着，再开 PDF
    await openNote(page, '另一页')
    await page.keyboard.press('Meta+j')
    await input(page).fill('你好')
    await input(page).press('Enter')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（Claude Code）。', { timeout: 15_000 })
    await page.keyboard.press('Meta+o')
    await page.getByRole('textbox', { name: '按名字跳到文件' }).fill('第3讲')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    const pdfPage = page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="2"]')
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    const span = pdfPage.locator('.textLayer span', { hasText: 'for every scalar c' })
    await span.scrollIntoViewIfNeeded()
    const sb = (await span.boundingBox())!
    await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
    await page.mouse.up()
    await page.locator('.pdfpane:not([hidden])').getByRole('toolbar', { name: '框好的这块' }).getByRole('button', { name: /^讲解一下/ }).click()
    const reading = page.getByRole('complementary', { name: '边读边问 AI' })
    await expect(reading).toBeVisible()
    await expect(reading.getByTestId('reading-msg').last().locator('.txt')).toContainText('这是讲解', { timeout: 15_000 })
    await expect(reading.locator('.um').last()).toContainText('讲解一下')
  } finally {
    await run.close()
  }
})

// 不在这里：视频框一块问 AI（小框自己的输入框，不进右栏，e2e/step22-video-ai.spec.ts 真点）、网页上选字右键「问 AI」和网页小条
// （要本机假网站，e2e/quote-stay.spec.ts、e2e/6cxtc-selbar.spec.ts 真点）

// 真 Claude Code 走一遍 r172 图1 那条（要联网、花一点额度，平时跳过；只问一句）：
//   CN_REAL_AI=1 npx playwright test e2e/ai-entries.spec.ts -g 真   （在 Claude Code 终端里跑先去掉父会话的 CLAUDECODE、CLAUDE_CODE_* 环境变量）
test('真 Claude Code：右栏开着别处的对话（输入框里打了半句没发）时文档里选 3 块点「问AI」，问一句，回答讲到这 3 块', async () => {
  test.skip(!process.env.CN_REAL_AI, '真 AI 才跑：CN_REAL_AI=1')
  test.setTimeout(10 * 60_000)
  const run = await launch(files, { CN_AI_MODEL: 'sonnet' })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    await openNote(page, '另一页')
    await page.keyboard.press('Meta+j')
    await input(page).fill('打了半句还没发')
    await openNote(page, DOC_TITLE)
    await expect(away(page)).toContainText('这是在《另一页》问的')
    await frameBlocks(page)
    await page.getByTestId('doc-selbar').getByRole('button', { name: '问AI' }).click()
    await onThisPage(page, DOC_TITLE)
    await expect(chat(page).getByTestId('ai-cards')).toHaveText('这篇里选中的3块')
    await input(page).fill('这几块各讲什么？每块一句')
    await input(page).press('Enter')
    const a = chat(page).getByTestId('ai-msg').last().locator('.txt')
    for (const w of ['范数', 'Hadamard']) await expect(a).toContainText(w, { timeout: 240_000 })
    await page.waitForTimeout(3000)
    console.log('回答：', await a.textContent())
    await page.screenshot({ path: '/private/tmp/canvas-notes-visual/sel-ask/after/5-real-claude-blocks.png' })
  } finally {
    await run.close()
  }
})
