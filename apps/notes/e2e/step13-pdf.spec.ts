import { _electron as electron, expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { launch, openAi, rail, acts, tabOn, railItems } from './app'
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

test('PDF 框一块问：右栏 AI 带图回答，后台记笔记（我框的图、问题原话、回答原文、小结），一次提交；页边标记和笔记互相跳', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openPdf(page)
    // 读 PDF：竖条上只多「笔记」；AI 只住右栏（第 2a 段）：打开 PDF 不再自己把 AI 打开，右下角的圆钮一直在，点了开右栏 AI 那一格
    await expect.poll(() => railItems(page)).toEqual(['笔记', '大纲', '相关', '网页', '微信读书', '记录', '自动化', '历史'])
    await expect(ai(page)).toBeHidden()
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeHidden()
    await expect(rail(page).getByRole('button', { name: '打开 AI' })).toBeVisible()
    await rail(page).getByRole('button', { name: '打开 AI' }).click()
    await expect(ai(page)).toBeVisible()
    await expect(rail(page).locator('.ai-fab')).toHaveClass(/\bon\b/)
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('1 / 5')
    // AI 先把整份读一遍
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')

    // 在第 3 页上框一块：工具条出来，输入框里有截图，预填「给我讲解一下」并全选
    await drawBox(page, 3, [0.08, 0.25], [0.6, 0.42])
    await expect(pdfPane(page).getByTestId('pdf-box')).toBeVisible()
    await expect(pdfPane(page).getByRole('toolbar', { name: '框好的这块' })).toBeVisible()
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await expect(ai(page).getByTestId('reading-att')).toContainText('第3页')
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
    await expect(msg.locator('.read')).toHaveText('读了第3页 · Claude Code · Opus 5.5 · High')
    // 不让人等：先「正在记进笔记…」，写好「已记进笔记 · 第 3 页」，竖条「笔记」上一个小点
    await expect(msg.locator('.noted')).toContainText('已记进笔记 · 第3页', { timeout: 15_000 })
    await expect(rail(page).getByTestId('notes-dot')).toBeVisible()

    // 库里：笔记（我框的图、问题原话、回答原文、小结）、截图，一次提交；完整对话不再另写一份（CN-93、94、96）
    const md = readFileSync(join(vault, NOTE), 'utf8')
    expect(md).toContain('类型: 笔记\n课程: 线性代数\n第几讲: 3\n来源: "[[第3讲 线性映射.pdf]]"')
    expect(md).toContain('AI填的: 课程, 第几讲')
    expect(md).toContain('## 第 3 页 · 测试小标题 p3\n[第 3 页](第3讲%20线性映射.pdf#page=3&rect=')
    expect(md).toMatch(/ <!-- cn:thread=第3讲 线性映射-p3-1 -->\n\n!\[我框的\|\d+\]\(\.\.\/\.\.\/附件\/第3讲%20线性映射\/p3-1\.png\)\n\n> \[!question\] 给我讲解一下\n\n这是讲解（第 3 页，图 1 张，读过全文，新会话）。/)
    expect(md).toContain('> [!recap] 测试小结：主对话问了 1 句。')
    expect(md).not.toMatch(/我的疑惑|整块没看懂|讲通的讲法|完整对话/)
    expect(existsSync(join(vault, '附件/第3讲 线性映射/p3-1.png'))).toBe(true)
    expect(existsSync(join(vault, '.canvas-notes/对话'))).toBe(false)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('笔记：第3讲 线性映射 第 3 页 · 测试小标题 p3')
    expect(gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')

    // 页边标记：第 3 页这里问过 1 轮
    const mk = pdfPane(page).getByRole('button', { name: '第 3 页这里问过 1 轮' })
    await expect(mk).toBeVisible()

    // 还是不懂：接着同一处问，AI 换个讲法；笔记里多一个问题条（原话）和这一版回答，小结重写
    await msg.getByRole('button', { name: '还是不懂' }).click()
    const msg2 = ai(page).getByTestId('reading-msg').last()
    await expect(msg2.locator('.txt')).toContainText('换个方式讲（第 3 页，图 0 张，读过全文，接着聊）')
    await expect(msg2.locator('.noted')).toContainText('已记进笔记', { timeout: 15_000 })
    await expect(pdfPane(page).getByRole('button', { name: '第 3 页这里问过 2 轮' })).toBeVisible()
    const md2 = readFileSync(join(vault, NOTE), 'utf8')
    expect(md2.match(/^## /gm)?.length).toBe(1)
    expect(md2).toContain('> [!question] 还是不懂\n\n换个方式讲（第 3 页，图 0 张，读过全文，接着聊）：先别看公式，看图。\n\n> [!recap] 测试小结：主对话问了 2 句。\n')
    expect(md2).not.toMatch(/\[!ai\]|没讲通|完整对话/)

    // AI 回答里的「第 2 页」：和别的引用一样点一下先出预览卡（task-3e53q 已定 1），⌘点 PDF 翻过去
    const p2 = ai(page).getByTestId('reading-msg').first().locator('a.pg', { hasText: '第 2 页' })
    await p2.click()
    await expect(page.getByRole('dialog', { name: '引用' }).locator('.u')).toContainText('第2页')
    await page.keyboard.press('Escape')
    await p2.click({ modifiers: ['Meta'] })
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('2 / 5')

    // 竖条「笔记」：小点消失，那段展开着
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notes(page)).toBeVisible()
    await expect(ai(page)).toBeHidden()
    await expect(rail(page).getByTestId('notes-dot')).toHaveCount(0)
    const sec = notes(page).getByTestId('note-round')
    await expect(sec.locator('.rh h3')).toHaveText('第3页 · 测试小标题 p3')
    await expect(sec.locator('.qs')).toHaveText(['给我讲解一下', '还是不懂'])
    await expect(sec.locator('.am').first()).toContainText('这是讲解（第 3 页，图 1 张，读过全文，新会话）')
    await expect(sec.locator('.recap span')).toHaveText('测试小结：主对话问了 2 句。')
    await expect(sec.locator('.crop img')).toHaveCount(1)

    // 笔记 → PDF：点「第 3 页 ›」，翻到第 3 页，框过的那块闪一下
    await sec.getByRole('button', { name: '第3页 ›' }).click()
    await expect(pdfPane(page).getByTestId('pdf-flash')).toBeVisible()
    await expect(acts(page).getByTestId('pdf-pager')).toHaveText('3 / 5')
    await expect(pdfPane(page).getByTestId('pdf-flash')).toHaveCount(0, { timeout: 4000 })

    // 页边标记 → 笔记那一段（外圈亮一下）；右下角的 AI 入口开回 AI
    await rail(page).getByRole('button', { name: '打开 AI' }).click()
    await pdfPane(page).getByRole('button', { name: '第 3 页这里问过 2 轮' }).click()
    await expect(notes(page)).toBeVisible()
    await expect(notes(page).locator('section.rnd.flash')).toBeVisible()
    await expect(pdfPane(page).getByRole('button', { name: '第 3 页这里问过 2 轮' })).toHaveClass(/cur/)

    // 再点竖条「笔记」：收起笔记标签，回到 AI（笔记里就是问答原文，不再有「完整对话」那个入口）
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(ai(page)).toBeVisible()

    // 标签上的 × 收起 AI：右栏没有别的了，整栏收起
    await page.getByTestId('dtab-ai').hover()
    await page.getByTestId('dtab-ai').getByRole('button', { name: '收起AI' }).click()
    await expect(ai(page)).toHaveCount(0)
    await expect(page.locator('.win')).not.toHaveClass(/with-right/)

    // 笔记单独在中间打开（⌘O）：就是普通文档，相对链接的截图照常显示。只开了笔记标签：换到这篇文档时笔记标签藏起来、整栏收起，
    // 竖条上「笔记」原地变淡（右图标栏方向 A），AI 还是收着
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notes(page)).toBeVisible()
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('第3讲 线性映射 笔记')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('第3讲 线性映射 笔记')
    const img = page.locator('.pane:not([hidden]) img[src*="p3-1.png"]').first()
    await expect(img).toBeVisible()
    expect(await img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(10)
    await expect.poll(() => railItems(page)).toEqual(['笔记', '大纲', '相关', '网页', '微信读书', '记录', '自动化', '历史'])
    await expect(rail(page).getByRole('button', { name: /^笔记/ })).toHaveClass(/\bdim\b/)
    await expect(notes(page)).toHaveCount(0)
    await expect(page.locator('.win')).not.toHaveClass(/with-right/)
    await expect(page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '打开 AI' })).toBeVisible()
    // 回到 PDF：笔记又开着
    await page.getByTestId('tab-list').getByRole('tab', { name: /第3讲 线性映射\.pdf/ }).click()
    await expect(notes(page)).toBeVisible()
    // 开着 AI、笔记在前面（同一组两个标签）：换到文档，笔记标签藏起来、AI 换成这篇文档自己的对话；回到 PDF 又是笔记在前面
    await rail(page).getByRole('button', { name: '打开 AI' }).click()
    await expect(ai(page)).toBeVisible()
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notes(page)).toBeVisible()
    await page.getByTestId('tab-list').getByRole('tab', { name: /第3讲 线性映射 笔记/ }).click()
    await expect(page.getByRole('complementary', { name: 'AI 对话' })).toBeVisible()
    await expect(notes(page)).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '收起 AI' })).toBeVisible()
    await page.getByTestId('tab-list').getByRole('tab', { name: /第3讲 线性映射\.pdf/ }).click()
    await expect(notes(page)).toBeVisible()
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
    await openAi(page)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')
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
    await expect(msg.locator('.noted')).toContainText('已记进笔记 · 第4页', { timeout: 15_000 })
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
    await expect(ai(page).getByTestId('reading-msg').last().locator('.noted')).toContainText('已记进笔记 · 第2页', { timeout: 15_000 })
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
      await expect(p2.getByTestId('toast')).toContainText('回到上次看到的第2页')
      await expect(acts(p2).getByTestId('pdf-pager')).toHaveText('2 / 5')
      await expect(ai(p2).locator('.um')).toHaveCount(2)
      await expect(pdfPane(p2).getByRole('button', { name: '第 4 页这里问过 1 轮' })).toBeAttached()
      // 第二次打开：全文已经缓存，问的时候接着同一个会话
      await expect(ai(p2).getByTestId('reading-sees')).toContainText('读过全文5页')
    } finally {
      await app.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('第 2 段：做个可视化（后台做好挂进笔记、中间栏沙箱里能拖）、问到 n/N、从笔记出卡送进 Anki', async () => {
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
    await openAi(page)
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')
    // 「看得到」照 A 组读 PDF 小样：这份 PDF · 第几页 | 读过全文几页 | 笔记几轮；问到哪不写在这里（笔记的属性行有「问到 3/5 页」），标签条右端只有页码
    await expect(ai(page).getByTestId('reading-sees').locator('.chip')).toHaveText(['第3讲 线性映射.pdf · 第1页', '读过全文5页'])
    await expect(acts(page).getByTestId('pdf-progress')).toHaveCount(0)
    await drawBox(page, 3, [0.08, 0.25], [0.6, 0.42])
    await expect(ai(page).getByRole('textbox', { name: '问 AI' })).toHaveValue('给我讲解一下')
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    const msg = ai(page).getByTestId('reading-msg').first()
    await expect(msg.locator('.noted')).toContainText('已记进笔记 · 第3页', { timeout: 15_000 })
    // 回答最后那行标记不显示，换成「做个可视化」
    await expect(msg.locator('.txt')).not.toContainText('〔')
    await expect(ai(page).getByTestId('reading-sees').locator('.chip').last()).toHaveText('笔记1轮')
    await expect(ai(page).getByTestId('pdf-progress')).toHaveCount(0)
    await expect(acts(page).getByTestId('pdf-pager')).toContainText(' / 5')
    await expect(acts(page).getByTestId('pdf-progress')).toHaveCount(0)

    // 做个可视化：后台做，好了挂进笔记、存在课程文件夹，一次提交
    // 回答下面那排（task-eavzx）：「做个可视化」是快捷回复，右栏窄时放不下就在 ⋯ 里
    const viz = msg.getByTestId('reading-ans-acts').getByRole('button', { name: '做个可视化' })
    if (await viz.count()) await viz.click()
    else {
      await msg.getByTestId('reading-ans-acts').locator('[data-act="more"]').click()
      await page.getByRole('menuitem', { name: '做个可视化' }).click()
    }
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
    // 写着是哪家哪个模型做的（CN-54）
    await expect(acts(page).getByTestId('page-note')).toHaveText('可视化 · 第3讲 · Claude Code · Opus 5.5')
    await acts(page).getByRole('button', { name: '更多' }).click()
    await expect(acts(page).getByRole('menu', { name: '更多' })).toContainText('在隔离环境里运行 · 不联网')
    await acts(page).getByRole('button', { name: '更多' }).click()
    const frame = page.frameLocator('[data-testid="html-frame"]')
    await frame.getByRole('slider', { name: '角度' }).fill('90')
    await expect(frame.locator('#v')).toHaveText('90')

    // 回到 PDF：笔记里有可视化卡
    await page.locator('.tab', { hasText: '第3讲 线性映射.pdf' }).locator('.tl').click()
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notes(page).getByTestId('viz-card')).toContainText('旋转矩阵 · 拖动角度看基向量')
    // 「我的疑惑」那一页 2026-11-22 拿掉了（task-tz7y3）：⌘K 打它说问过的在哪；不再是文件
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('我的疑惑')
    await expect(page.locator('.pal-row').first()).toContainText('这一页拿掉了：问过的在每份PDF的笔记「只看我问的」里')
    await page.keyboard.press('Escape')
    expect(existsSync(join(vault, '课程/线性代数/我的疑惑.md'))).toBe(false)

    // 出卡：AI 改成卡（假 AI），一张张过，送进 Anki；送过的标「已送」，一次提交
    await notes(page).getByRole('tab', { name: '只看我问的' }).click()
    await notes(page).getByRole('button', { name: '出卡 · 1问' }).click()
    const dlg = page.getByRole('dialog', { name: '出卡' })
    await expect(dlg.locator('.dh .sub')).toHaveText(/^改好了1张/, { timeout: 15_000 })
    await expect(dlg.locator('.orig')).toHaveText('你当时问的：「给我讲解一下」')
    await expect(dlg.locator('.paper .foot')).toContainText('第3讲 线性映射 · 第 3 页')
    await dlg.getByRole('button', { name: '送进Anki · 1张' }).click()
    await expect(page.locator('.toast-cn')).toContainText('已送进Anki · 1张（牌组「课程::线性代数::第3讲 线性映射」）')
    await expect(notes(page).locator('.qonly .st')).toHaveText(['已送'])
    await expect(notes(page).getByRole('button', { name: '出卡 · 0问' })).toBeVisible()
    expect(added.map((n) => [n.deckName, n.fields.Question])).toEqual([['课程::线性代数::第3讲 线性映射', '「测试小标题 p3」里：给我讲解一下']])
    // 背面：AI 改写的答案；原文摘句是回答里原样的一句
    expect(added[0]!.fields.Answer).toContain('这是讲解')
    expect(added[0]!.fields.Image).toMatch(/^<img class="lead" src="canvasnotes-\w+\.png"( width="\d+")?>$/)
    expect(gitOut(vault, 'log', '-1', '--format=%s')).toBe('送进 Anki：第3讲 线性映射 1 张')
    expect(gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')

    // 点「只看我问的」里那一条：回到那一轮
    await notes(page).locator('.qonly').first().click()
    await expect(notes(page).getByRole('tab', { name: '全部' })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await run.close()
    anki.close()
  }
})
