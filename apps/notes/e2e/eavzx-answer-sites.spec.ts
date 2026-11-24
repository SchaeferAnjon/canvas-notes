// 回答下面那排换到各处（task-eavzx B 线，款式页「62-回答按钮款式」第二版「27 处各改成什么」）。真点、无头、假 AI、临时库：
// - 读 PDF：左边 拷贝 · 插进文档（中间是 PDF 变淡）· ⋯，右边快捷回复默认 还是不懂 · 换个方式讲（· 做个可视化），点「还是不懂」真发出去；
//   之前那条悬停才露；⋯ 里 存进收件箱 · 在笔记里看 · 拷贝为 Markdown · 调整这一排…；右键和 AI 对话同一套；出错 再问一次（那一家标志）· 换个问法 · 换一家
// - 插进文档：读 PDF 的回答（看别处的对话时中间开着文档）和 AI 对话的回答插出来的是同一种 AI 块，块头链回那段对话；右键「插进文档」和按钮一字不差；点块头链接回到那条
// - 网页上框着问：快捷回复两颗，不做可视化
// - 视频问框：两颗快捷回复、没有「接着问」，⋯ 里「到 AI 对话里接着聊」带过去
// - 收不收那一套：AI整理 看改动 ……… 不要 · 收下（右栏这颗描边，中间底条 不要 · 收下 实心）；梦游中间 不要 · 收下（实心）、左边 跟 AI 说 ……… 不要 · 收下；
//   日历帮我排 不要 · 收下（实心）
import { expect, test, type Locator, type Page } from '@playwright/test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, openAi, openNote, pane, rail, type Running, tabOn, widenRight } from './app'
import { DOC_PATH, FILES } from './fixtures/board-select'
import { DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { LECTURE } from './fixtures/pdf'
import { armMenus, menuLabels, openedMenu, pickMenu, enabledOf } from './menu'

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const DOC = '学习笔记.md'
const DOC_TEXT = '# 学习笔记\n\n第一段。\n'

const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPane(page).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
  await openAi(page)
  await expect(reading(page).getByTestId('reading-sees')).toContainText('读过全文5页')
}

/** 读 PDF 那一格问一句、等它答完 */
async function askPdf(page: Page, text: string, n: number) {
  const box = reading(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(reading(page).getByTestId('reading-msg')).toHaveCount(n)
  await expect(reading(page).getByTestId('reading-msg').last().locator('.txt')).not.toBeEmpty({ timeout: 15_000 })
  await expect(reading(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
}

/** 这一排的快捷回复：排上的 + 放不下进 ⋯ 的（按顺序） */
async function replyNames(page: Page, row: Locator): Promise<string[]> {
  const shown = await row.locator('[data-reply]').allInnerTexts()
  if (!(await row.getAttribute('data-spill'))) return shown.map((s) => s.trim())
  await row.locator('[data-act="more"]').click()
  const spill = await page.locator('.cn-ab-menu [data-reply]').allInnerTexts()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cn-ab-menu')).toHaveCount(0)
  return [...shown, ...spill].map((s) => s.trim())
}

/** 点一颗快捷回复：排上的直接点，放不下的从 ⋯ 里点 */
async function clickReply(page: Page, row: Locator, name: string) {
  const b = row.locator('[data-reply]', { hasText: name })
  if (await b.count()) return b.click()
  await row.locator('[data-act="more"]').click()
  await page.locator('.cn-ab-menu [data-reply]', { hasText: name }).click()
}

const HEAD = /^> \[!ai\] AI 回答 · Claude Code · Opus 5\.5 · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=([^&)]+)&msg=(\d+)\)$/gm

test('读 PDF：回答下面 拷贝 · 插进文档（变淡）· ⋯ ｜ 还是不懂 · 换个方式讲，点「还是不懂」真发出去；之前那条悬停才露；⋯ 和右键；出错那排', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await armMenus(run)
    await openPdf(page)
    const ai = reading(page)
    await askPdf(page, '给我讲解一下这一页', 1)
    const msg = ai.getByTestId('reading-msg').first()
    const row = msg.getByTestId('reading-ans-acts')
    await expect(row).toBeVisible()
    // 左边功能按钮固定：拷贝 · 插进文档 · ⋯；中间是 PDF，插进文档变淡（还能悬停看为什么）
    await expect(row.locator('[data-act]')).toHaveCount(3)
    expect(await row.locator('[data-act]').evaluateAll((els) => els.map((e) => e.getAttribute('data-act')))).toEqual(['copy', 'insert', 'more'])
    await expect(row.locator('[data-act="insert"]')).toHaveAttribute('aria-disabled', 'true')
    await row.locator('[data-act="insert"]').hover()
    await expect(page.getByTestId('tooltip')).toContainText('中间开着一篇文档才能插')
    // 无边框灰字（btn-ghost）、24 高；快捷回复是描边胶囊、24 高
    const a0 = row.locator('[data-act="copy"]')
    expect(await a0.evaluate((e) => [Math.round(e.getBoundingClientRect().height), getComputedStyle(e).borderTopWidth])).toEqual([24, '0px'])
    const r0 = row.locator('[data-reply]').first()
    expect(await r0.evaluate((e) => [Math.round(e.getBoundingClientRect().height), getComputedStyle(e).borderTopWidth, getComputedStyle(e).borderRadius])).toEqual([24, '1px', '999px'])
    // 右边快捷回复：默认 还是不懂 · 换个方式讲（AI 觉得适合画图时再加 做个可视化）；放不下的进 ⋯
    const names = await replyNames(page, row)
    expect(names.slice(0, 2)).toEqual(['还是不懂', '换个方式讲'])
    for (const n of names) expect(['还是不懂', '换个方式讲', '做个可视化']).toContain(n)
    // 「还是不懂」那颗画那一家的标志
    await expect(row.locator('[data-reply="still"] .cn-ab-logo')).toHaveCount((await row.locator('[data-reply="still"]').count()) ? 1 : 0)

    // ⋯ 里：最前面记进 / 拿掉这一条（AI 对话记笔记开关，记好了是「从《…》拿掉」）· 在笔记里看 · 存进收件箱 · 拷贝为 Markdown，最下面 调整这一排…
    await expect(msg.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await row.locator('[data-act="more"]').click()
    await expect(page.locator('.cn-ab-menu [data-item]')).toHaveText(['从《第3讲 线性映射 笔记》拿掉', '在笔记里看', '拷贝为 Markdown', '调整这一排…', '存进收件箱'])
    await page.keyboard.press('Escape')

    // 右键这条回答：和 AI 对话同一套，插进文档灰着（中间是 PDF）
    await msg.locator('.txt').click({ button: 'right' })
    const m1 = await openedMenu(run)
    expect(menuLabels(m1)).toEqual(['拷贝', '拷贝为 Markdown', '插进文档', '存进收件箱'])
    expect(enabledOf(m1, '插进文档')).toBe(false)
    await page.keyboard.press('Escape')
    await armMenus(run)
    // 你发的那句右键多「存成快捷回复…」
    await ai.locator('.um').first().click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('存成快捷回复…')
    await page.keyboard.press('Escape')
    await armMenus(run)

    // 点「还是不懂」：真发出去（和自己打字一样），AI 接着答
    await clickReply(page, row, '还是不懂')
    await expect(ai.locator('.um').last()).toHaveText('还是不懂')
    await expect(ai.getByTestId('reading-msg')).toHaveCount(2)
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    // 最新那条一直露，之前那条悬停才露（刚点过的那颗还拿着焦点，Tab 走到时也露：先放掉焦点）
    const row2 = ai.getByTestId('reading-msg').last().getByTestId('reading-ans-acts')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await page.mouse.move(5, 5)
    await expect(row2).toHaveCSS('opacity', '1')
    await expect(row).toHaveCSS('opacity', '0')
    await msg.locator('.txt').hover()
    await expect(row).toHaveCSS('opacity', '1')

    // 出错那排：再问一次（那一家的标志）· 换个问法 · 换一家
    await ai.getByRole('textbox', { name: '问 AI' }).fill('假装被拦：讲讲这页')
    await ai.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const err = ai.getByTestId('ai-error')
    await expect(err).toBeVisible({ timeout: 15_000 })
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible({ timeout: 15_000 })
    await expect(err.locator('.acts button')).toHaveText(['再问一次', '换个问法', '换一家'])
    await expect(err.locator('[data-act="retry"] .eng-logo')).toHaveAttribute('data-engine', 'claude')
    // 出错的那条下面不出回答那排
    await expect(ai.getByTestId('reading-msg').last().getByTestId('reading-ans-acts')).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('pdf.png') })
  } finally {
    await run.close()
  }
})

test('插进文档只有一种做法：读 PDF 的回答（看别处的对话）、AI 对话的回答、右键「插进文档」插出来都是 AI 块，块头链回那段对话；点块头链接回到那条', async () => {
  const run = await launch({ [PDF]: LECTURE, [DOC]: DOC_TEXT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, DOC), 'utf8')
  try {
    await armMenus(run)
    await openPdf(page)
    await askPdf(page, '给我讲解一下这一页', 1)
    // 中间换成文档：右栏留着读 PDF 那段（AI 对话绑页面，换页不换走），读 PDF 那一套显示，这时中间有文档能插
    await openNote(page, '学习笔记')
    const away = reading(page)
    await expect(away.getByTestId('ai-away')).toBeVisible()
    const rmsg = away.getByTestId('reading-msg').first()
    const rrow = rmsg.getByTestId('reading-ans-acts')
    await expect(rrow.locator('[data-act="insert"]')).not.toHaveAttribute('aria-disabled', 'true')
    await rmsg.locator('.txt').hover()
    await rrow.locator('[data-act="insert"]').click()
    await expect(page.getByText('插进了《学习笔记》')).toBeVisible()
    await expect.poll(file, { timeout: 10_000 }).toContain('[!ai] AI 回答')
    const one = file()
    const h1 = [...one.matchAll(HEAD)]
    expect(h1).toHaveLength(1)
    const rid = await rmsg.getAttribute('data-msg')
    expect(decodeURIComponent(h1[0]![1]!)).toBe(`read:${PDF}`)
    expect(h1[0]![2]).toBe(rid)
    // 块里是回答原文（每行「> 」），可视化那行标记不带进来
    const body = one.split(/\n\n(?=> \[!ai\])/)[1]!.split('\n').slice(1)
    expect(body.length).toBeGreaterThan(0)
    for (const l of body.filter((x) => x.trim())) expect(l.startsWith('>')).toBe(true)
    expect(one).not.toContain('〔')

    // 右键这条回答「插进文档」：走同一个函数，插出来一字不差
    await rmsg.locator('.txt').click({ button: 'right' })
    await pickMenu(run, '插进文档')
    await expect.poll(() => [...file().matchAll(HEAD)].length, { timeout: 10_000 }).toBe(2)
    const blocks = file().split(/\n\n(?=> \[!ai\])/).slice(1).map((b) => b.split(/\n\n(?!>)/)[0]!.trim())
    expect(blocks[0]).toBe(blocks[1])

    // 回到这篇的 AI 对话，问一句、插进文档：同一种块头，链的是 AI 对话那段
    await away.getByTestId('ai-follow').click()
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('把这周总结成三句话')
    await box.press('Enter')
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const cmsg = chat(page).getByTestId('ai-msg').last()
    await cmsg.getByTestId('ai-ans-acts').locator('[data-act="insert"]').click()
    await expect.poll(() => [...file().matchAll(HEAD)].length, { timeout: 10_000 }).toBe(3)
    const keys = [...file().matchAll(HEAD)].map((m) => decodeURIComponent(m[1]!))
    expect(keys[2]).toBe('file:学习笔记.md')

    // 点读 PDF 那块块头的「回到 AI 对话」：右栏换成读 PDF 那段、滚到那条回答、闪一下
    const lk = pane(page).locator('.cm-link', { hasText: '回到 AI 对话' }).first()
    await lk.scrollIntoViewIfNeeded()
    await lk.hover()
    const card = page.getByRole('dialog', { name: '链接' })
    await card.getByRole('button', { name: /回到 AI 对话/ }).click()
    await expect(reading(page).getByTestId('ai-away')).toBeVisible()
    await expect(reading(page).getByTestId('reading-msg').first()).toHaveClass(/jumped/)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 网页

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<!doctype html><html lang="en"><head><title>Rotation matrix</title></head><body style="font:18px/1.6 Georgia,serif;padding:24px;max-width:640px;background:#fff;color:#1b1b1b"><h1>Rotation matrix</h1><p id="p1">In linear algebra, a rotation matrix is a transformation matrix that is used to perform a rotation in Euclidean space.</p></body></html>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

test('网页上框着问：回答下面同一排，快捷回复两颗（还是不懂 · 换个方式讲），不做可视化；点「换个方式讲」真发出去', async () => {
  const run = await launch({ 'plain.md': `---\nread-along: ${base}/\n---\n# 随手\n` }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    if (Math.round((await web(page).boundingBox())!.width) < 420) await widenRight(page, 80)
    const addr = web(page).getByRole('textbox', { name: '网址' })
    const u = `${base}/wiki/Rotation_matrix`
    await addr.fill(u)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
    const w = (await web(page).locator('webview.on').boundingBox())!
    const r = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('p1').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
    await page.keyboard.down('Meta')
    await page.mouse.move(w.x + r.x - 4, w.y + r.y - 4)
    await page.mouse.down()
    await page.mouse.move(w.x + r.x + r.width / 2, w.y + r.y + r.height / 2, { steps: 5 })
    await page.mouse.move(w.x + r.x + r.width + 4, w.y + r.y + r.height + 4, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.up('Meta')
    const ai = reading(page)
    await ai.getByRole('textbox').press('Enter')
    await expect(ai.getByText('已记进《plain》')).toBeVisible({ timeout: 15_000 })
    const row = ai.getByTestId('reading-msg').last().getByTestId('reading-ans-acts')
    expect(await row.locator('[data-act]').evaluateAll((els) => els.map((e) => e.getAttribute('data-act')))).toEqual(['copy', 'insert', 'more'])
    expect(await replyNames(page, row)).toEqual(['还是不懂', '换个方式讲'])
    // ⋯ 里没有「在笔记里看」（网页那一问写进了剪藏那篇本身，不是读 PDF 的笔记）；最前面是「从《…》拿掉」
    await row.locator('[data-act="more"]').click()
    await expect(page.locator('.cn-ab-menu [data-item]')).toHaveText(['从《plain》拿掉', '拷贝为 Markdown', '调整这一排…', '存进收件箱'])
    await page.keyboard.press('Escape')
    await clickReply(page, row, '换个方式讲')
    await expect(ai.locator('.um').last()).toHaveText('换个方式讲')
    await expect(ai.getByTestId('reading-msg')).toHaveCount(2)
    await page.screenshot({ path: test.info().outputPath('web.png') })
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 视频问框

test.describe('视频问框', () => {
  let vserver: Server
  let vbase: string
  test.beforeAll(async () => {
    ;({ server: vserver, base: vbase } = await startFakeVideoSite())
  })
  test.afterAll(() => vserver.close())

  test('回答下面 拷贝 · 插进文档 · ⋯ ｜ 还是不懂 · 换个方式讲，没有「接着问」；⋯ 里「到 AI 对话里接着聊」带过去；点「还是不懂」真问', async () => {
    test.setTimeout(120_000)
    const NOTE = '看视频的笔记.md'
    const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_AI_FAKE_ASK_MS: '800', CN_VIDEO_TEST_ORIGIN: vbase })
    const { page } = run
    const vguest = (code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
    try {
      await openNote(page, '看视频的笔记')
      await rail(page).getByRole('button', { name: '网页', exact: true }).click()
      const addr = web(page).getByRole('textbox', { name: '网址' })
      await addr.fill(`${vbase}/watch?v=${FAKE_VIDEO_ID}`)
      await addr.press('Enter')
      const strip = web(page).getByRole('region', { name: '视频条' })
      await expect(strip).toBeVisible({ timeout: 15_000 })
      await vguest(`(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
      await page.waitForTimeout(400)
      await pane(page).getByText('我先写的一句。').click()
      await page.keyboard.press('Alt+KeyD')
      await expect.poll(() => vguest(`!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
      const wv = (await web(page).locator('webview.on').boundingBox())!
      await page.mouse.move(wv.x + 40, wv.y + 30)
      await page.mouse.down()
      await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
      await page.mouse.up()
      const ask = web(page).getByRole('dialog', { name: '问 AI' })
      await expect(ask).toBeVisible()
      await ask.getByRole('textbox', { name: '想问什么' }).press('Enter')
      await expect(ask.getByTestId('ak-answer').first()).toContainText('框里是 i 帽', { timeout: 15_000 })
      const row = ask.getByTestId('ak-ans-acts')
      await expect(row).toBeVisible()
      // 问框 380 宽：功能按钮带字（keepLabels）
      await expect(row.locator('[data-act]')).toHaveText(['拷贝', '插进文档', ''])
      expect(await replyNames(page, row)).toEqual(['还是不懂', '换个方式讲'])
      await expect(ask.getByRole('button', { name: '接着问', exact: true })).toHaveCount(0)
      await expect(ask.getByRole('button', { name: '在 AI 标签里聊' })).toHaveCount(0)
      await page.screenshot({ path: test.info().outputPath('video.png') })
      // 点「还是不懂」：在问框里接着问那一句
      await clickReply(page, row, '还是不懂')
      await expect(ask.getByTestId('ak-answer')).toHaveCount(2, { timeout: 15_000 })
      await expect(ask.locator('.ak-q').last()).toHaveText('还是不懂')
      await expect(ask.getByTestId('ak-ans-acts')).toBeVisible({ timeout: 15_000 })
      // ⋯ 里「到 AI 对话里接着聊」：问答都带去右栏 AI
      await ask.getByTestId('ak-ans-acts').locator('[data-act="more"]').click()
      await expect(page.locator('.cn-ab-menu [data-item]')).toHaveText(['到 AI 对话里接着聊', '拷贝为 Markdown', '调整这一排…', '存进收件箱'])
      await page.getByRole('menuitem', { name: '到 AI 对话里接着聊' }).click()
      await expect(reading(page)).toBeVisible()
      await expect(reading(page)).toContainText('框里是 i 帽和 j 帽变换后的位置')
      await expect(reading(page)).toContainText('还是不懂')
    } finally {
      await run.close()
    }
  })
})

// ---------------------------------------------------------------- 收不收那一套

const order = (bar: Locator) => bar.locator('button').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-act')}:${e.className.replace('cn-cb-btn ', '')}:${(e as HTMLElement).innerText.trim()}`))

test('AI整理：右栏回答下面 看改动 ……… 不要（无边框）· 收下（描边），中间对比标签底条 不要 · 收下（实心）；看改动、收下都真点', async () => {
  const run = await launch(FILES, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '2.3 线性代数')
    const line = (t: string) => pane(page).locator('.cm-line', { hasText: t }).first()
    await expect(line('按常数缩放')).toBeVisible()
    const a = (await line('矩阵-矩阵乘法 AB').boundingBox())!
    const z = (await line('按常数缩放').boundingBox())!
    await page.mouse.move(a.x - 30, a.y + 6)
    await page.mouse.down()
    await page.mouse.move(a.x - 28, a.y + 40, { steps: 4 })
    await page.mouse.move(a.x - 26, z.y + 10, { steps: 10 })
    await page.mouse.up()
    await page.getByTestId('doc-selbar').getByRole('button', { name: 'AI整理' }).click()
    const ai = chat(page)
    const msg = ai.getByTestId('ai-msg').last()
    await expect(msg).toContainText('理成了2节', { timeout: 20_000 })
    const bar = msg.getByTestId('ai-change-bar')
    expect(await order(bar)).toEqual(['view:ghost:看改动', 'reject:ghost:不要', 'accept:out:收下'])
    // 看改动在最左，收下在最右（中间空着）
    const vb = (await bar.locator('[data-act="view"]').boundingBox())!
    const rb = (await bar.locator('[data-act="reject"]').boundingBox())!
    expect(rb.x - (vb.x + vb.width)).toBeGreaterThan(40)
    // 中间对比标签底条：不要 · 收下（实心）
    const take = page.getByTestId('proposal-bar')
    await expect(take).toBeVisible()
    expect(await order(take.locator('.cn-cb'))).toEqual(['reject:ghost:不要', 'accept:solid:收下'])
    await page.screenshot({ path: test.info().outputPath('tidy.png') })
    // 先切走再点「看改动」：对比标签回来
    await openNote(page, '2.3 线性代数')
    await bar.locator('[data-act="view"]').click()
    await expect(take).toBeVisible()
    await bar.locator('[data-act="accept"]').click()
    await expect.poll(() => readFileSync(join(vault, DOC_PATH), 'utf8')).toContain('### 矩阵乘法')
    // 收下以后：改动块里撤回是同一颗（无边框、discard）
    const undo = ai.getByTestId('ai-msg').last().getByTestId('ai-change').locator('[data-act="undo"]')
    await expect(undo).toHaveText('撤回')
    await expect(undo).toHaveClass(/ghost/)
  } finally {
    await run.close()
  }
})

test('梦游：中间 不要 · 收下（实心），左边报告 跟 AI 说（标志）……… 不要 · 收下（描边）；没有「丢掉」「收下这条」；真点不要、撤回', async () => {
  const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, prepareDream2)
  const { page } = run
  try {
    const card = page.getByTestId('dream-card')
    await card.getByRole('button', { name: '现在梦游' }).click()
    await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
    await card.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    const ice = panel.getByTestId('dream-item').filter({ hasText: '原名「冰洞」' })
    await ice.click()
    const dt = page.locator('[data-testid="dream-tab"]:not([hidden])')
    await expect(dt).toBeVisible()
    expect(await order(dt.getByTestId('dream-change-bar'))).toEqual(['reject:ghost:不要', 'accept:solid:收下'])
    await expect(dt.getByText('⌘⌫ 不要')).toBeVisible()
    const pbar = panel.getByTestId('dream-panel-bar')
    expect(await order(pbar)).toEqual(['lead0:out:', 'reject:ghost:不要', 'accept:out:收下'])
    await expect(pbar.locator('[data-act="lead0"]')).toHaveAttribute('data-tip', /跟 AI 说/)
    await expect(pbar.locator('[data-act="lead0"] .eng-logo')).toBeVisible()
    await expect(page.getByRole('button', { name: '丢掉', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '收下这条' })).toHaveCount(0)
    await page.screenshot({ path: test.info().outputPath('dream.png') })
    await pbar.locator('[data-act="reject"]').click()
    await expect(ice).toContainText(/已丢掉|留在收件箱/)
    await ice.click()
    const undo = panel.getByTestId('dream-detail').locator('[data-act="undo"]')
    await expect(undo).toHaveText('撤回')
    await undo.click()
    await expect(panel.getByTestId('dream-panel-bar')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('日历帮我排：不要（无边框）· 收下（实心）；真点收下写进那一行', async () => {
  const pad = (n: number) => String(n).padStart(2, '0')
  const day = (n: number) => {
    const d = new Date()
    d.setDate(d.getDate() + n)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }
  const PLAN = `# 小论文计划\n\n- [ ] 交论文初稿 📅 ${day(1)} 15:00\n- [ ] 补实验图 📅 ${day(1)}\n`
  const dir = mkdtempSync(join(tmpdir(), 'cn-cal-'))
  const memFile = join(dir, 'cal-mem.json')
  writeFileSync(memFile, JSON.stringify({ auth: 'full', calAuth: 'full', lists: [{ id: 'L-ct', title: '画布今日', icloud: true, color: '#F0883E' }], calendars: [{ id: 'C-work', title: '工作', color: '#4F7CAC', source: 'iCloud' }], events: [] }))
  const HELPER = join(__dirname, '../../today/native/reminders/.build/apple/Products/Release/canvas-today-reminders')
  let run: Running | null = null
  try {
    run = await launch({ '写作/小论文计划.md': PLAN }, { CN_CAL_HELPER: HELPER, CN_CAL_MEMORY: memFile, CN_AI_FAKE: '1', CT_AI_FAKE_MS: '300' })
    const { page } = run
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '日历', exact: true }).click()
    const calp = page.locator('.pane.calp:not([hidden])')
    await calp.getByRole('button', { name: '帮我排进空着的时间' }).click()
    const ai = calp.locator('[data-part="AI 帮忙"]')
    await expect(ai).toContainText(/想把\d条排进空着的时间/, { timeout: 15_000 })
    const bar = ai.getByTestId('cal-change-bar')
    expect(await order(bar)).toEqual(['reject:ghost:不要', 'accept:solid:收下'])
    await page.screenshot({ path: test.info().outputPath('calendar.png') })
    await bar.locator('[data-act="accept"]').click()
    await expect(ai).toHaveCount(0)
    await expect.poll(() => readFileSync(join(run!.vault, '写作/小论文计划.md'), 'utf8')).toMatch(/补实验图 📅 \S+ \d{2}:\d{2}/)
  } finally {
    await run?.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
