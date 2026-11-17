/**
 * 发版前第 3 轮（美学）找出来的问题：每条一个测试，真点、真按，量屏幕上画出来的样子。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { acts, launch, leftView, openNote, pane, rail, tabOn, waitSaved } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { measureGaps } from './cjk-gap'
import { LECTURE } from './fixtures/pdf'
import { shotTone, shotWindow } from './shots'

let server: Server
let videoBase: string
test.beforeAll(async () => {
  ;({ server, base: videoBase } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const size = (run: { app: import('@playwright/test').ElectronApplication }, w: number, h: number) =>
  run.app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w, h), [w, h] as const)

/** 表头每一列的左边和宽（像素，不取整） */
const cols = (db: Locator) => db.locator('thead th').evaluateAll((ths) => ths.map((th) => { const r = th.getBoundingClientRect(); return [r.left, r.width] }))

test('数据库开着筛选点「新一条」：起名前、起名框出来、打了字、回车后，每一列的位置和宽一像素不动，那一行一样高', async () => {
  const base = '```base\nfilters:\n  and:\n    - file.inFolder("书单")\n    - 状态 == "在读"\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 作者\n      - 状态\n```'
  const run = await launch({
    '读书.md': `# 读书\n\n只列在读的。\n\n${base}\n`,
    '读书二.md': `# 读书二\n\n同一张表。\n\n${base}\n`,
    '书单/冰岛人.md': '---\n作者: 哈尔多尔·拉克斯内斯\n状态: 在读\n---\n',
    '书单/置身事内.md': '---\n作者: 兰小欢\n状态: 读完\n---\n',
  })
  const { page, vault } = run
  try {
    await shotTone(page)
    for (const [w, h, note] of [[1100, 700, '读书'], [1600, 1000, '读书二']] as const) {
      await size(run, w, h)
      await openNote(page, note)
      const db = pane(page).locator('[data-part="数据库块"]')
      await expect(db.locator('tbody tr')).toHaveCount(1)
      await page.waitForTimeout(300)
      const before = await cols(db)
      await db.getByRole('button', { name: '新一条' }).click()
      const name = db.getByRole('textbox', { name: /^未命名.* · 名字$/ })
      await expect(name).toBeFocused()
      const added = db.locator('tbody tr.base-row-out')
      await expect(added.locator('.base-out')).toHaveText('新 · 不在当前筛选里')
      expect(await cols(db)).toEqual(before)
      const rowH = (await added.boundingBox())!.height
      await shotWindow(run, `r3-db-naming-${w}`)
      const typed = w === 1100 ? '冰岛人续' : '冰岛人续集·第二部'
      await page.keyboard.type(typed)
      expect(await cols(db)).toEqual(before)
      await page.keyboard.press('Enter')
      await expect.poll(() => existsSync(join(vault, '书单', `${typed}.md`))).toBe(true)
      await expect(added.locator('td.nm button')).toHaveText(typed)
      await expect(added.locator('.base-out')).toHaveText('新 · 不在当前筛选里')
      expect(await cols(db)).toEqual(before)
      expect((await added.boundingBox())!.height).toBe(rowH)
      // 小标签整个在名字格里，不压名字
      const cell = (await added.locator('td.nm').boundingBox())!
      const tag = (await added.locator('.base-out').boundingBox())!
      const nm = (await added.locator('td.nm button').boundingBox())!
      expect(tag.x + tag.width).toBeLessThanOrEqual(cell.x + cell.width)
      expect(nm.x + nm.width).toBeLessThanOrEqual(tag.x)
      await shotWindow(run, `r3-db-named-${w}`)
    }
  } finally {
    await run.close()
  }
})

test('白板画布上边也让出一截：从 y=0 摆起的列不贴标签条，右上「N未整理」不压卡', async () => {
  const board = '---\ntype: board\ncolor: #4A7FA7\n---\n写作计划。\n\n<!-- column id=c1 x=0 y=0 w=300 title=十一月 -->\n<!-- card id=k1 in=c1 -->\n第一张\n\n<!-- column id=c2 x=340 y=0 w=300 title=十二月 -->\n<!-- card id=k2 in=c2 -->\n第二张\n\n<!-- column id=c3 x=680 y=0 w=300 title=想写的 -->\n<!-- card id=k3 in=c3 -->\n第三张\n'
  const run = await launch({ '写作计划.md': board, '收件箱/一条.md': '# 一条\n\n收件箱里的。\n' })
  const { page } = run
  try {
    await shotTone(page)
    for (const [w, h] of [[1100, 700], [1600, 1000]] as const) {
      await size(run, w, h)
      await page.locator('.nav .si', { hasText: /^写作计划/ }).first().click()
      const b = pane(page).getByTestId('board')
      await expect(b.locator('.bcol h3', { hasText: '十一月' })).toBeVisible()
      await page.waitForTimeout(300)
      const wrap = (await b.locator('.board-wrap').boundingBox())!
      const pal = (await b.locator('.bpal').boundingBox())!
      const pill = (await b.getByTestId('unsorted').boundingBox())!
      const boxes = await b.locator('.bcol').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }))
      expect(boxes).toHaveLength(3)
      for (const c of boxes) {
        // 上边和左边一样至少空 16（左边是工具板右边再空 16）
        expect(c.y - wrap.y).toBeGreaterThanOrEqual(16)
        expect(c.x).toBeGreaterThanOrEqual(pal.x + pal.width + 16)
        // 「未整理」那颗不和卡重叠
        const apart = c.x >= pill.x + pill.width || c.x + c.w <= pill.x || c.y >= pill.y + pill.height || c.y + c.h <= pill.y
        expect(apart).toBe(true)
      }
      // 卡的上沿在「未整理」下面再空 16
      expect(boxes[0]!.y).toBeGreaterThanOrEqual(pill.y + pill.height + 16)
      await shotWindow(run, `r3-board-top-${w}`)
    }
  } finally {
    await run.close()
  }
})

test('数和单位、中文和西文写在一个文本节点里，autospace 才起作用：白板列头「1张卡片」、文档白板「2列 · 3张」和列头「2张」、课程首页「收进ecp」都量到 1–2.5px', async () => {
  const doc = '# 计划\n\n## 第一节\n\n一段。\n\n两段。\n\n## 第二节\n\n三段。\n'
  const board = '---\ntype: board\ncolor: #4A7FA7\n---\n写作计划。\n\n<!-- column id=c1 x=0 y=0 w=300 title=十一月 -->\n<!-- card id=k1 in=c1 -->\n第一张\n'
  const run = await launch({ '计划.md': doc, '写作计划.md': board, '课程/ecp/Lecture05.pdf': LECTURE })
  const { page } = run
  const gaps = (scope: string) => page.evaluate(([s, k]) => (0, eval)(`(${s})`)(k, '', false), [measureGaps.toString(), scope] as const)
  try {
    await page.locator('.nav .si', { hasText: /^写作计划/ }).first().click()
    await expect(pane(page).locator('.bcol h3 .meta')).toHaveText('1张卡片')
    expect(await gaps('.pane:not([hidden]) .bcol h3 .meta')).toEqual([])
    await openNote(page, '计划')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const db = pane(page).getByTestId('doc-board')
    await expect(db.locator('.db-tools > span').first()).toHaveText('2列 · 3张')
    expect(await gaps('.pane:not([hidden]) .db-tools > span')).toEqual([])
    expect(await gaps('.pane:not([hidden]) [data-testid="doc-board"] h3 .meta')).toEqual([])
    await leftView(page, '课程')
    await page.locator('aside.side').getByRole('button', { name: /ecp/ }).click()
    await expect(tabOn(page)).toHaveText('ecp')
    await expect(pane(page).locator('.fw-dropcell')).toContainText('收进ecp')
    expect(await gaps('.pane:not([hidden]) .fw-dropcell')).toEqual([])
  } finally {
    await run.close()
  }
})

test('数和单位合成一个文本节点（全软件统一改）：「最近」页头「3篇」、文件夹首页「2篇」、底栏「1处没提交」都量到 1–2.5px', async () => {
  const run = await launch({ '写作/冰岛/行程.md': '# 行程\n\n第一天。\n', '写作/冰岛/预算.md': '# 预算\n\n机票。\n', '随记.md': '# 随记\n\n一句。\n' })
  const { page } = run
  // 量到的每一处（all）：至少有一处数字挨中文，且都在 1–2.5px
  const gaps = async (scope: string) => {
    const all = await page.evaluate(([s, k]) => (0, eval)(`(${s})`)(k, '', true) as { gap: number }[], [measureGaps.toString(), scope] as const)
    expect(all.length).toBeGreaterThan(0)
    return all.filter((g) => g.gap < 1 || g.gap > 2.5)
  }
  try {
    await shotTone(page)
    await leftView(page, '最近')
    await expect(page.getByTestId('recent-count')).toHaveText('3篇')
    expect(await gaps('[data-testid="recent-count"]')).toEqual([])
    await leftView(page, '文件')
    const tree = page.getByRole('tree')
    await tree.getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^写作$/ }) }).locator('.ft-tw').click()
    await tree.getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^冰岛$/ }) }).click()
    await expect(tabOn(page)).toHaveText('冰岛')
    const fc = pane(page).getByTestId('folder-content')
    await expect(fc.locator('.fc-n')).toHaveText('2篇')
    expect(await gaps('.pane:not([hidden]) [data-testid="folder-content"] .fc-n')).toEqual([])
    await openNote(page, '随记')
    await page.locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('再一句。')
    await waitSaved(page)
    expect(readFileSync(join(run.vault, '随记.md'), 'utf8')).toBe('# 随记\n\n一句。\n再一句。')
    await expect(page.getByTestId('git-changed')).toContainText('1处没提交', { timeout: 10_000 })
    expect(await gaps('[data-testid="git-changed"]')).toEqual([])
    await shotWindow(run, 'cjk-node-status')
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 右栏下格 AI

const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })

/** 空状态（大标题和那一句）里看得见的每一块都整个在消息区里：要么整个露着，要么整个不画，不被拦腰切 */
async function emptyFits(page: Page) {
  return reading(page).locator('.msgs').evaluate((m) => {
    const box = m.getBoundingClientRect()
    const parts = [...m.querySelectorAll<HTMLElement>('.ai-empty h2, .ai-empty p')].filter((e) => e.getClientRects().length)
    return {
      shown: parts.map((e) => e.tagName.toLowerCase()),
      cut: parts.filter((e) => { const r = e.getBoundingClientRect(); return r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5 }).map((e) => e.textContent!.slice(0, 8)),
    }
  })
}

test('窗口 700 高、上格开着视频时点「接着问」：下格 AI 的空状态放不下大标题就只留那一句，再放不下就不画，不被拦腰切；1600×1000 下整个露着', async () => {
  const NOTE = '看视频的笔记.md'
  const run = await launch({ [NOTE]: '# 看视频的笔记\n\n我先写的一句。\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '150', CN_VIDEO_TEST_ORIGIN: videoBase })
  const { page } = run
  const web = page.getByRole('complementary', { name: '网页' })
  const guest = (code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
  try {
    await shotTone(page)
    await size(run, 1600, 1000)
    await openNote(page, '看视频的笔记')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    // 右栏开视频，停在 00:06，框一块问
    await rail(page).getByRole('button', { name: '网页', exact: true }).click()
    const addr = web.getByRole('textbox', { name: '网址' })
    await addr.fill(`${videoBase}/watch?v=${FAKE_VIDEO_ID}`)
    await addr.press('Enter')
    await expect(web.getByRole('region', { name: '视频条' })).toBeVisible({ timeout: 15_000 })
    await guest(`(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
    await expect.poll(async () => Math.round(Number(await guest('document.querySelector("video").currentTime')))).toBe(6)
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Alt+KeyD')
    await expect.poll(() => guest(`!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
    const wv = (await web.locator('webview.on').boundingBox())!
    await page.mouse.move(wv.x + 120, wv.y + 60)
    await page.mouse.down()
    await page.mouse.move(wv.x + 220, wv.y + 140, { steps: 6 })
    await page.mouse.up()
    await web.getByRole('dialog', { name: '问 AI' }).getByRole('textbox', { name: '想问什么' }).press('Enter')
    await expect(page.getByText(/AI讲完了/)).toBeVisible({ timeout: 15_000 })
    await waitSaved(page)

    // 文档里问答块「接着问」：右栏下格开 AI，输入框上面挂着那一帧和那一问
    await pane(page).getByText('我先写的一句。').click()
    const more = pane(page).locator('[data-part="问答块"]').getByRole('button', { name: '接着问' })
    await more.scrollIntoViewIfNeeded()
    await more.click()
    await expect(reading(page).locator('.attq')).toBeVisible()
    await expect(reading(page).locator('.ai-empty')).toHaveCount(1)
    // 1600×1000：大标题和那一句都露着
    await page.waitForTimeout(300)
    expect(await emptyFits(page)).toEqual({ shown: ['h2', 'p'], cut: [] })
    await shotWindow(run, 'r3-ai-empty-1600')
    // 1100×700、960×700：哪一块都不被切
    for (const w of [1100, 960]) {
      await size(run, w, 700)
      await page.waitForTimeout(500)
      const fit = await emptyFits(page)
      expect(fit.cut).toEqual([])
      expect(fit.shown).not.toEqual(['h2'])
      await shotWindow(run, `r3-ai-empty-${w}x700`)
    }
  } finally {
    await run.close()
  }
})

test('读 PDF 框了一块再点「讲解一下」排队：排队那一行自己占一整行（在附图下面），句子露得出来', async () => {
  const PDF = '课程/线性代数/第3讲 线性映射.pdf'
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '120' })
  const { page } = run
  const pdfPage = (n: number) => page.locator(`.pdfpane:not([hidden]) .pdfpage[data-page="${n}"]`)
  try {
    await shotTone(page)
    await size(run, 1100, 700)
    await page.keyboard.press('Meta+k')
    await page.getByRole('dialog', { name: '搜索和命令' }).getByRole('textbox').fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await expect(pdfPage(1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await expect(reading(page).getByTestId('reading-sees')).toContainText('读过全文5页')
    // AI 在答这一页时，在第 4 页框一块，点浮条「讲解一下」
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    await expect(reading(page).getByRole('button', { name: '停下' })).toBeVisible()
    const el = pdfPage(4)
    await el.scrollIntoViewIfNeeded()
    const r = (await el.boundingBox())!
    await page.mouse.move(r.x + r.width * 0.1, r.y + r.height * 0.15)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width * 0.6, r.y + r.height * 0.3, { steps: 6 })
    await page.mouse.up()
    await page.locator('.pdfpane:not([hidden])').getByRole('toolbar', { name: '框好的这块' }).getByRole('button', { name: /讲解一下/ }).click()
    const q = reading(page).getByTestId('reading-queued')
    await expect(q).toContainText('答完上一问自动发出：给我讲解一下')
    const att = (await reading(page).getByTestId('reading-att').boundingBox())!
    const qb = (await q.boundingBox())!
    const box = (await reading(page).locator('.reading-in').boundingBox())!
    // 在附图下面一整行（输入框的内宽，左右各留内边距），不和附图挤一行
    expect(qb.y).toBeGreaterThanOrEqual(att.y + att.height)
    expect(qb.width).toBeGreaterThanOrEqual(box.width - 24)
    // 句子整个露着（没省略）
    expect(await q.locator('.truncate').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
    await shotWindow(run, 'r3-queued-with-att')
  } finally {
    await run.close()
  }
})

test('中间窄（1100 开着右栏）时开「还没提交的改动」：标签条右端那句说明藏起来，当前标签的名字整个露着；1600 宽时说明照样写', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' })
  const { page, vault } = run
  try {
    await shotTone(page)
    await size(run, 1100, 700)
    writeFileSync(join(vault, '随手记.md'), readFileSync(join(vault, '随手记.md'), 'utf8') + '\n外面加的一段。\n')
    await expect(page.getByTestId('git-changed')).toContainText('1处没提交', { timeout: 10_000 })
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hist = page.getByRole('complementary', { name: '历史' })
    await hist.getByTestId('history-pending').getByRole('button', { name: /还没提交的改动/ }).click()
    await expect(tabOn(page)).toHaveText('还没提交的改动')
    expect(await page.locator('main.center').evaluate((e) => e.clientWidth)).toBeLessThan(640)
    const note = acts(page).getByTestId('page-note')
    // 对比读出来了、说明也在（只是藏着）
    await expect(page.getByTestId('diff-tab')).toContainText('外面加的一段。')
    await expect(note).toHaveText('还没提交的改动 · 1处')
    await expect(note).toBeHidden()
    const name = tabOn(page).locator('.truncate')
    await expect.poll(() => name.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
    await shotWindow(run, 'r3-diff-narrow')
    // 宽了：说明回来
    await size(run, 1600, 1000)
    await expect(note).toBeVisible()
    await expect(note).toHaveText('还没提交的改动 · 1处')
  } finally {
    await run.close()
  }
})

test('写作首页「素材」组件：一行是一个主题文件夹，用文件夹图标；点了开那个文件夹的首页', async () => {
  const run = await launch({
    '写作/a.md': '# a\n\n正文。\n',
    '素材/冰岛旅行/一.md': '# 一\n\n剪的。\n',
    '素材/书摘/二.md': '# 二\n\n摘的。\n',
  })
  const { page } = run
  try {
    await shotTone(page)
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    await tree.getByRole('treeitem', { name: /写作/ }).first().click()
    const row = page.getByTestId('fw-clips').locator('.fw-row', { hasText: '冰岛旅行' })
    await expect(row).toContainText('1篇')
    const icon = await row.locator('svg.ci').evaluate((s) => s.innerHTML)
    await shotWindow(run, 'r3-writing-clips')
    await row.click()
    await expect(tabOn(page)).toHaveText('冰岛旅行')
    // 和文件夹标签用的是同一个图标
    expect(await tabOn(page).locator('svg.ci').first().evaluate((s) => s.innerHTML)).toBe(icon)
  } finally {
    await run.close()
  }
})

test('梦游报告里收下一条：状态条「已收下，合进main · 提交号」一行放下，放不下先省略说明，提交号整个在同一行', async () => {
  const run = await launch({ ...DREAM_VAULT }, { CN_AI_FAKE: '1' })
  const { page } = run
  const panel = page.getByRole('complementary', { name: '梦游报告' })
  try {
    await shotTone(page)
    await size(run, 1440, 900)
    await leftView(page, '梦游报告')
    await panel.getByRole('button', { name: '现在梦游' }).click()
    await expect(panel.getByTestId('dream-summary')).toContainText('整理了', { timeout: 60_000 })
    await panel.getByTestId('dream-item').filter({ hasText: /^极光\s*从/ }).click()
    await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    const state = panel.locator('.pv-state')
    await expect(state).toContainText('已收下，合进main')
    const hash = state.locator('code')
    await expect(hash).toHaveText(/^[0-9a-f]{7}$/)
    // 左栏默认宽（252）：一行，提交号整个露着、和说明在同一行
    const lines = await state.evaluate((e) => { const cs = getComputedStyle(e); return Math.round((e.getBoundingClientRect().height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / 18) })
    expect(lines).toBe(1)
    const s = (await state.boundingBox())!
    const h = (await hash.boundingBox())!
    expect(h.x + h.width).toBeLessThanOrEqual(s.x + s.width)
    expect(await hash.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
    await shotWindow(run, 'r3-dream-state')
  } finally {
    await run.close()
  }
})
