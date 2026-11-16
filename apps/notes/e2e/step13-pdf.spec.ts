import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { launch, rail, acts, tabOn, railItems } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const NOTE = '课程/线性代数/第3讲 线性映射 笔记.md'
const files = { [PDF]: LECTURE, '课程/线性代数/第4讲 特征值.md': '# 第4讲 特征值\n\n旋转矩阵没有实特征值。\n' }

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()

/** ⌘K 里按名字找到 PDF 打开 */
async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

/** 在第 n 页上从 (fx0, fy0) 拖到 (fx1, fy1)（这一页上的比例） */
async function drawBox(page: Page, n: number, a: [number, number], b: [number, number], meta = false) {
  const el = pdfPage(page, n)
  await el.scrollIntoViewIfNeeded()
  const box = (await el.boundingBox())!
  if (meta) await page.keyboard.down('Meta')
  await page.mouse.move(box.x + box.width * a[0], box.y + box.height * a[1])
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * (a[0] + b[0]) / 2, box.y + box.height * (a[1] + b[1]) / 2, { steps: 4 })
  await page.mouse.move(box.x + box.width * b[0], box.y + box.height * b[1], { steps: 4 })
  await page.mouse.up()
  if (meta) await page.keyboard.up('Meta')
}

test('PDF 框一块问：右栏 AI 带图回答，后台记笔记（图、疑惑、讲通的讲法），一次提交；页边标记和笔记互相跳', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openPdf(page)
    // 读 PDF：竖条上面多了 AI、笔记；右下角没有浮着的 AI；右栏开着 AI
    await expect.poll(() => railItems(page)).toEqual(['AI', '笔记', '大纲', '网页', '历史'])
    // 读 PDF / HTML 时右下角的 AI 入口开关的是右栏的 AI，不再浮在中间
    await expect(page.getByRole('navigation', { name: '右栏' }).locator('.ai-fab')).toHaveAttribute('data-tip', 'AI 在右栏（读 PDF 时）')
    await expect(page.locator('main.center').getByRole('complementary', { name: 'AI 对话' })).toBeHidden()
    await expect(ai(page)).toBeVisible()
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('1 / 5')
    // AI 先把整份读一遍
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文 5 页')

    // 在第 3 页上框一块：工具条出来，输入框里有截图，预填「给我讲解一下」并全选
    await drawBox(page, 3, [0.08, 0.25], [0.6, 0.42])
    await expect(pdfPane(page).getByTestId('pdf-box')).toBeVisible()
    await expect(pdfPane(page).getByRole('toolbar', { name: '框好的这块' })).toBeVisible()
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await expect(ai(page).getByTestId('reading-att')).toContainText('第 3 页')
    const box = ai(page).getByRole('textbox', { name: '问 AI' })
    await expect(box).toHaveValue('给我讲解一下')
    await expect(box).toBeFocused()
    expect(await box.evaluate((t: HTMLTextAreaElement) => [t.selectionStart, t.selectionEnd])).toEqual([0, 6])

    // 回车就发：带着图问，AI 读过全文
    await box.press('Enter')
    await expect(pdfPane(page).getByTestId('pdf-box')).toHaveCount(0)
    const um = ai(page).locator('.um-wrap').last()
    await expect(um.locator('img')).toBeVisible()
    await expect(um.locator('.um')).toHaveText('给我讲解一下')
    const msg = ai(page).getByTestId('reading-msg').last()
    await expect(msg.locator('.txt')).toContainText('这是讲解（第 3 页，图 1 张，读过全文，新会话）')
    await expect(msg.locator('.read')).toHaveText('读了第 3 页')
    // 不让人等：先「正在记进笔记…」，写好「已记进笔记 · 第 3 页」，竖条「笔记」上一个小点
    await expect(msg.locator('.noted')).toContainText('已记进笔记 · 第 3 页', { timeout: 15_000 })
    await expect(rail(page).getByTestId('notes-dot')).toBeVisible()

    // 库里：笔记、截图、AI 挑的图、完整对话，一次提交
    const md = readFileSync(join(vault, NOTE), 'utf8')
    expect(md).toContain('类型: 笔记\n课程: 线性代数\n第几讲: 3\n来源: "[[第3讲 线性映射.pdf]]"')
    expect(md).toContain('AI填的: 课程, 第几讲')
    expect(md).toContain('## 第 3 页 · 测试小标题 p3\n[第 3 页](第3讲%20线性映射.pdf#page=3&rect=')
    expect(md).toContain('![我框的](../../附件/第3讲%20线性映射/p3-1.png)\n\n![第 3 页 · 这页的图](../../附件/第3讲%20线性映射/p3-1-fig.png)')
    expect(md).toContain('> [!question] 我的疑惑\n> 整块没看懂：第 3 页框的这块')
    expect(md).toContain('[完整对话 · 1 轮](../../.canvas-notes/对话/第3讲%20线性映射-p3-1.md)')
    expect(existsSync(join(vault, '附件/第3讲 线性映射/p3-1.png'))).toBe(true)
    expect(existsSync(join(vault, '附件/第3讲 线性映射/p3-1-fig.png'))).toBe(true)
    expect(readFileSync(join(vault, '.canvas-notes/对话/第3讲 线性映射-p3-1.md'), 'utf8')).toContain('### 我 · ')
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('笔记：第3讲 线性映射 第 3 页 · 测试小标题 p3')
    expect(gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')

    // 页边标记：第 3 页这里问过 1 轮
    const mk = pdfPane(page).getByRole('button', { name: '第 3 页这里问过 1 轮' })
    await expect(mk).toBeVisible()

    // 还是不懂：接着同一处问，AI 换个讲法；笔记里讲通的讲法换成第 2 版，第 1 版收成一行
    await msg.getByRole('button', { name: '还是不懂' }).click()
    const msg2 = ai(page).getByTestId('reading-msg').last()
    await expect(msg2.locator('.txt')).toContainText('换个方式讲（第 3 页，图 0 张，读过全文，接着聊）')
    await expect(msg2.locator('.noted')).toContainText('已记进笔记', { timeout: 15_000 })
    await expect(pdfPane(page).getByRole('button', { name: '第 3 页这里问过 2 轮' })).toBeVisible()
    const md2 = readFileSync(join(vault, NOTE), 'utf8')
    expect(md2.match(/^## /gm)?.length).toBe(1)
    expect(md2).toContain('> [!success] 讲通的讲法（第 2 版）\n> 第 2 版：换成画面来讲，这次讲通了。')
    expect(md2).toContain('<details><summary>没讲通 · 第 1 版：第 1 版用公式推，没听懂</summary>')
    expect(md2).toContain('[完整对话 · 2 轮]')

    // AI 回答里的「第 2 页」：点了 PDF 翻过去
    await ai(page).getByTestId('reading-msg').first().locator('a.pg', { hasText: '第 2 页' }).click()
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('2 / 5')

    // 竖条「笔记」：小点消失，那段展开着
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await expect(notes(page)).toBeVisible()
    await expect(ai(page)).toBeHidden()
    await expect(rail(page).getByTestId('notes-dot')).toHaveCount(0)
    const sec = notes(page).getByTestId('note-section')
    await expect(sec.locator('h3')).toHaveText('测试小标题 p3')
    await expect(sec.locator('.doubt')).toContainText('整块没看懂：第 3 页框的这块')
    await expect(sec.locator('.doubt')).toContainText('还是不懂')
    await expect(sec.locator('.good')).toContainText('讲通的讲法 第 2 版')
    await expect(sec.locator('.bad summary')).toHaveText('没讲通 · 第 1 版：第 1 版用公式推，没听懂')
    await expect(sec.locator('.fig img')).toHaveCount(2)
    await expect(notes(page).locator('.props .chip')).toHaveText(['笔记', '线性代数', '第 3 讲', '来源 第3讲 线性映射.pdf', '问到 3/5 页'])

    // 笔记 → PDF：点页码，翻到第 3 页，框过的那块闪一下
    await sec.getByRole('button', { name: '第 3 页' }).first().click()
    await expect(pdfPane(page).getByTestId('pdf-flash')).toBeVisible()
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('3 / 5')
    await expect(pdfPane(page).getByTestId('pdf-flash')).toHaveCount(0, { timeout: 4000 })

    // 页边标记 → 笔记那一段（外圈亮一下）
    await rail(page).getByRole('button', { name: 'AI', exact: true }).click()
    await pdfPane(page).getByRole('button', { name: '第 3 页这里问过 2 轮' }).click()
    await expect(notes(page)).toBeVisible()
    await expect(notes(page).locator('section.ns.flash')).toBeVisible()
    await expect(pdfPane(page).getByRole('button', { name: '第 3 页这里问过 2 轮' })).toHaveClass(/cur/)

    // 「完整对话 · 2 轮」：回到 AI 那次对话
    await sec.getByRole('button', { name: '完整对话 · 2 轮' }).click()
    await expect(ai(page)).toBeVisible()
    await expect(ai(page).locator('.um-wrap.flash')).toBeVisible()

    // 再点 AI 收起右栏；别的标签（文档）里 AI 还在右下角浮着
    await rail(page).getByRole('button', { name: 'AI', exact: true }).click()
    await expect(ai(page)).toHaveCount(0)
    await expect(page.locator('.win')).not.toHaveClass(/with-right/)

    // 笔记「在中间打开」：就是普通文档，相对链接的截图照常显示；这时 AI 回到右下角浮着，竖条上没有 AI、笔记
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await notes(page).getByRole('button', { name: '在中间打开' }).click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射 笔记')
    const img = page.locator('.pane:not([hidden]) img[src*="p3-1.png"]').first()
    await expect(img).toBeVisible()
    expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(10)
    await expect.poll(() => railItems(page)).toEqual(['大纲', '网页', '历史'])
    await expect(page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('⌘↵ 问整页；选中一段字问；esc 取消框；重开软件回到上次那页，对话和页边标记都还在', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const root = dirname(vault)
  try {
    await openPdf(page)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文 5 页')
    // 翻到第 4 页，⌘↵ 整页问
    await acts(page).getByTestId('pdf-pager').getByRole('button').click()
    await page.getByRole('textbox', { name: '跳到第几页' }).fill('4')
    await page.keyboard.press('Enter')
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('4 / 5')
    await pdfPane(page).getByTestId('pdf-view').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Meta+Enter')
    const msg = ai(page).getByTestId('reading-msg').last()
    await expect(msg.locator('.txt')).toContainText('这是讲解（第 4 页，图 1 张')
    await expect(ai(page).locator('.um').last()).toHaveText('给我讲解一下这一页')
    await expect(msg.locator('.noted')).toContainText('已记进笔记 · 第 4 页', { timeout: 15_000 })
    // 整页问的标记在页顶
    await expect(pdfPane(page).getByRole('button', { name: '第 4 页这里问过 1 轮' })).toBeVisible()

    // 框一块再 esc：框和输入框里的图都没了
    await drawBox(page, 2, [0.05, 0.6], [0.5, 0.8], true)
    await expect(ai(page).getByTestId('reading-att')).toBeVisible()
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Escape')
    await expect(ai(page).getByTestId('reading-att')).toHaveCount(0)
    await expect(pdfPane(page).getByTestId('pdf-box')).toHaveCount(0)

    // 选中一段字：工具条出在选区上方，「讲解一下」带引文问
    const span = pdfPage(page, 2).locator('.textLayer span', { hasText: 'for every scalar c' })
    await span.scrollIntoViewIfNeeded()
    const sb = (await span.boundingBox())!
    await page.mouse.move(sb.x + 2, sb.y + sb.height / 2)
    await page.mouse.down()
    await page.mouse.move(sb.x + sb.width - 2, sb.y + sb.height / 2, { steps: 6 })
    await page.mouse.up()
    const bar = pdfPane(page).getByRole('toolbar', { name: '框好的这块' })
    await expect(bar).toBeVisible()
    await bar.getByRole('button', { name: /讲解一下/ }).click()
    await expect(ai(page).locator('.uq').last()).toContainText('scalar')
    await expect(ai(page).getByTestId('reading-msg').last().locator('.noted')).toContainText('已记进笔记 · 第 2 页', { timeout: 15_000 })
    const md = readFileSync(join(vault, NOTE), 'utf8')
    // 按页排：第 2 页在第 4 页前面
    expect([...md.matchAll(/^## 第 (\d+) 页/gm)].map((m) => m[1])).toEqual(['2', '4'])
    await page.waitForTimeout(600)
    await run.app.close()

    // 重开：回到上次看到的那页，对话、标记都在
    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: run.userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19' },
    })
    try {
      const p2 = await app.firstWindow()
      await expect(tabOn(p2)).toHaveText('第3讲 线性映射.pdf')
      await expect(p2.getByTestId('toast')).toContainText('回到上次看到的第 2 页')
      await expect(acts(p2).getByTestId('pdf-pager')).toHaveText('2 / 5')
      await expect(ai(p2).locator('.um')).toHaveCount(2)
      await expect(pdfPane(p2).getByRole('button', { name: '第 4 页这里问过 1 轮' })).toBeAttached()
      // 第二次打开：全文已经缓存，问的时候接着同一个会话
      await expect(ai(p2).getByTestId('reading-sees')).toContainText('读过全文 5 页')
    } finally {
      await app.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('第 2 段：做个可视化（后台做好挂进笔记、中间栏沙箱里能拖）、问到 n/N、我的疑惑按讲收起、送进 Anki', async () => {
  // 假的 AnkiConnect：记下加了哪些卡
  const added: { fields: Record<string, string>; deckName: string }[] = []
  const anki = createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const { action, params } = JSON.parse(body)
      const ok = (result: unknown) => res.end(JSON.stringify({ result, error: null }))
      if (action === 'modelNames') return ok([])
      if (action === 'deckNamesAndIds') return ok({ Default: 1 })
      if (action === 'createDeck') return ok(9)
      if (action === 'storeMediaFile') return ok(params.filename)
      if (action === 'canAddNotesWithErrorDetail') return ok(params.notes.map(() => ({ canAdd: true })))
      if (action === 'addNotes') return (added.push(...params.notes), ok(params.notes.map((_: unknown, i: number) => 10 + i)))
      ok(action === 'version' ? 6 : {})
    })
  })
  await new Promise<void>((r) => anki.listen(0, '127.0.0.1', r))
  const run = await launch(files, { CN_AI_FAKE: '1', CN_ANKI_URL: `http://127.0.0.1:${(anki.address() as { port: number }).port}` })
  const { page, vault } = run
  try {
    await openPdf(page)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文 5 页')
    // 还没问过：不显示问到哪（标签条右端只有页码，问到哪写在 AI「看得到」那一行）
    await expect(ai(page).getByTestId('pdf-progress')).toHaveCount(0)
    await expect(acts(page).getByTestId('pdf-progress')).toHaveCount(0)
    await drawBox(page, 3, [0.08, 0.25], [0.6, 0.42])
    await expect(ai(page).getByRole('textbox', { name: '问 AI' })).toHaveValue('给我讲解一下')
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    const msg = ai(page).getByTestId('reading-msg').first()
    await expect(msg.locator('.noted')).toContainText('已记进笔记 · 第 3 页', { timeout: 15_000 })
    // 回答最后那行标记不显示，换成「做个可视化」
    await expect(msg.locator('.txt')).not.toContainText('〔')
    await expect(ai(page).getByTestId('pdf-progress')).toHaveText('问到第 3 页')
    await expect(acts(page).getByTestId('pdf-pager')).toContainText(' / 5')
    await expect(acts(page).getByTestId('pdf-progress')).toHaveCount(0)

    // 做个可视化：后台做，好了挂进笔记、存在课程文件夹，一次提交
    await msg.getByRole('button', { name: '做个可视化' }).click()
    await expect(msg.locator('.vizpill')).toContainText('后台在做可视化 · 好了会挂进笔记，可以接着问')
    await expect(msg.locator('.vizpill.done')).toContainText('可视化做好了：旋转矩阵.html', { timeout: 15_000 })
    const html = readFileSync(join(vault, '课程/线性代数/旋转矩阵.html'), 'utf8')
    expect(html).toContain('<meta name="类型" content="可视化">')
    expect(html).toContain('<meta name="第几讲" content="3">')
    expect(readFileSync(join(vault, NOTE), 'utf8')).toContain('[可视化 · 旋转矩阵 · 拖动角度看基向量](旋转矩阵.html)')
    expect(readFileSync(join(vault, NOTE), 'utf8')).toContain('进度: 3/5')
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('可视化：旋转矩阵 · 拖动角度看基向量（第3讲 线性映射 第 3 页）')
    expect(gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')

    // 打开：中间栏新标签，沙箱里能拖
    await msg.locator('.vizpill.done').getByRole('button', { name: '打开' }).click()
    const pane = page.locator('.htmlpane:not([hidden])')
    await expect(tabOn(page)).toHaveText('旋转矩阵')
    await expect(acts(page).getByTestId('page-note')).toHaveText('可视化 · 第 3 讲')
    await acts(page).getByRole('button', { name: '更多' }).click()
    await expect(acts(page).getByRole('menu', { name: '更多' })).toContainText('在隔离环境里运行 · 不联网')
    await acts(page).getByRole('button', { name: '更多' }).click()
    const frame = page.frameLocator('[data-testid="html-frame"]')
    await frame.getByRole('slider', { name: '角度' }).fill('90')
    await expect(frame.locator('#v')).toHaveText('90')

    // 回到 PDF：笔记里有可视化卡，属性行有进度；「全部疑惑」开我的疑惑
    await page.locator('.tab', { hasText: '第3讲 线性映射.pdf' }).locator('.tl').click()
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await expect(notes(page).getByTestId('viz-card')).toContainText('旋转矩阵 · 拖动角度看基向量')
    await expect(notes(page).locator('.props .chip').last()).toHaveText('问到 3/5 页')
    await notes(page).getByRole('button', { name: '全部疑惑' }).click()
    const doubts = page.getByTestId('doubts')
    await expect(doubts.locator('.dq-sub')).toContainText('线性代数 · 1 条')
    await expect(doubts.getByTestId('doubt-group').locator('.dq-gh b')).toHaveText('第3讲 线性映射')
    const row = doubts.getByTestId('doubt-row')
    await expect(row.locator('.dq-tx b')).toHaveText('整块没看懂：第 3 页框的这块')
    await row.locator('.dq-line').click()
    await expect(row.locator('.dq-full')).toContainText('先看图，再看公式')
    expect(readFileSync(join(vault, '课程/线性代数/我的疑惑.md'), 'utf8')).toContain('- **整块没看懂：第 3 页框的这块** [第 3 页]')

    // 送进 Anki：预览正反面，送 1 张；送过的标「已送」，一次提交
    await doubts.getByRole('button', { name: '送进 Anki · 1 张' }).click()
    const dlg = page.getByRole('dialog', { name: '送进 Anki' })
    await expect(dlg.locator('.adq')).toHaveText('整块没看懂：第 3 页框的这块')
    await expect(dlg.locator('.adsrc')).toHaveText('第 3 页 · 第3讲 线性映射.pdf')
    await dlg.getByRole('button', { name: '送 1 张' }).click()
    await expect(page.locator('.toast-cn')).toContainText('已送进 Anki · 1 张卡片（牌组「知识」）')
    await expect(row.locator('.dq-sent')).toHaveText('已送')
    await expect(doubts.getByRole('button', { name: '送进 Anki · 0 张' })).toBeDisabled()
    expect(added.map((n) => [n.deckName, n.fields.Question])).toEqual([['知识', '整块没看懂：第 3 页框的这块']])
    expect(added[0]!.fields.Image).toMatch(/^<img class="lead" src="canvasnotes-\w+\.png">$/)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('送进 Anki：线性代数 1 张')
    expect(gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')

    // 疑惑里点页码：回到 PDF 那一页
    await row.locator('.pgc').click()
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('3 / 5')
  } finally {
    await run.close()
    anki.close()
  }
})
