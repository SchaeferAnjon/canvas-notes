/**
 * task-hqula：链接按住 ⌘ 悬停弹出那一篇（照 Obsidian 的页面预览，peek/peek.tsx）。
 * 用户：「文章里面的链接 能不能也做成 Obsidian 那样 按住 Command 把鼠标滑上去的时候 另一篇文章就会弹出来?」
 * 都是真按键：Playwright 按住 Meta 再移过去 / 先移过去再按 Meta，窗口不上屏（CN_E2E=1），假 AI（CN_AI_FAKE=1），临时库。
 * 浮窗只读：测完库里的文件一个字没变、git 干净。
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { acts, launch, openAi, openNote, pane, type Running, tabOn } from './app'
import { ICELAND } from './fixtures/board'
import { AURORA, AURORA_MD, DREAM2_VAULT, prepareDream2 } from './fixtures/dream2'
import { LECTURE } from './fixtures/pdf'

const FILLER = Array.from({ length: 20 }, (_, i) => `填充第 ${i + 1} 段，凑出长度。`)
/** 目标那篇：标题、提示块、公式、AI 块，第 30、31 行是两句要引的，「方法」一节，^b7 那一段，再链到第三篇 */
const TARGET_LINES = [
  '# 目标',
  '',
  '开头一段：这是目标这篇的正文。',
  '',
  '> [!note] 提示块',
  '> 提示块里的字。',
  '',
  ...FILLER,
]
while (TARGET_LINES.length < 29) TARGET_LINES.push('')
TARGET_LINES.push('第三十行：要引的第一句。', '第三十一行：要引的第二句。', '', '## 方法', '', '方法这一段：先读再写。', '', '块那一段在这里。 ^b7', '', '相关：[[第三篇]]', '')
const TARGET_MD = TARGET_LINES.join('\n')
const START_MD = [
  '# 起点',
  '',
  '双链：[[目标]]',
  '',
  '标题：[方法那段](../课程/目标.md#方法)',
  '',
  '行号：[两行](../课程/目标.md#L30-L31)',
  '',
  '块：[[目标#^b7]]',
  '',
  '大的：[[大文件]]',
  '',
  '没有的：[[库里没有这篇]]',
  '',
].join('\n')
const BIG_MD = ['# 大文件', '', ...Array.from({ length: 6000 }, (_, i) => `第 ${i + 1} 行：${'很长的一句话，'.repeat(3)}`), ''].join('\n')

const FILES: Record<string, string | Uint8Array> = {
  '收件箱/起点.md': START_MD,
  '课程/目标.md': TARGET_MD,
  '课程/第三篇.md': '# 第三篇\n\n第三篇的正文，从目标那篇链过来。\n',
  '资料/大文件.md': BIG_MD,
}

const peeks = (page: Page) => page.getByTestId('peek')
const layer = (page: Page, depth: number) => page.locator(`.pk[data-depth="${depth}"]`)
const tabs = (page: Page) => page.getByTestId('tab-list').locator(':scope > .tab')

/** 文件都没变（浮窗只读） */
function snapshot(vault: string, paths: string[]) {
  return Object.fromEntries(paths.map((p) => [p, readFileSync(join(vault, p), 'utf8')]))
}
const clean = (vault: string) => execFileSync('git', ['-C', vault, 'status', '--porcelain'], { encoding: 'utf8' }).trim()

/** 先停在链接上，再按下 ⌘ */
async function hoverThenMeta(page: Page, link: Locator) {
  await link.hover()
  await page.keyboard.down('Meta')
}
/** 先按住 ⌘，再移到链接上 */
async function metaThenHover(page: Page, link: Locator) {
  await page.keyboard.down('Meta')
  await link.hover()
}

/** 移到中间栏左下角的空白处 */
async function away(page: Page) {
  const b = (await pane(page).boundingBox())!
  await page.mouse.move(b.x + 12, b.y + b.height - 12, { steps: 3 })
}

/** 浮窗里引到的那几行：亮着、在浮窗的可见范围里 */
async function hitShown(page: Page, depth: number, texts: string[]) {
  const l = layer(page, depth)
  const hit = l.locator('.cm-line.pk-hit')
  await expect(hit).toHaveCount(texts.length)
  for (let i = 0; i < texts.length; i++) await expect(hit.nth(i)).toContainText(texts[i]!)
  const body = (await l.locator('.pk-body').boundingBox())!
  await expect
    .poll(async () => {
      const h = (await hit.first().boundingBox())!
      return h.y >= body.y - 1 && h.y + h.height <= body.y + body.height + 1
    })
    .toBe(true)
}

/** 点空白处：中间栏里不在浮窗、不在链接上的一点（左下角，被浮窗盖着就换右下角、左上角） */
async function blank(page: Page) {
  const b = (await pane(page).boundingBox())!
  const spots = [
    [b.x + 12, b.y + b.height - 12],
    [b.x + b.width - 12, b.y + b.height - 12],
    [b.x + b.width - 12, b.y + 60],
  ] as const
  for (const [x, y] of spots) {
    const free = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)
      return !!el && !el.closest('.pk, .lk-card-host, a, .cm-wikilink, .cm-link')
    }, [x, y] as const)
    if (free) return page.mouse.click(x, y)
  }
  throw new Error('中间栏找不到空白处')
}

/** 松开 ⌘：浮窗还在（常驻，⌘预览常驻）；点空白处才收 */
async function releaseThenBlank(page: Page) {
  await page.keyboard.up('Meta')
  await page.waitForTimeout(400)
  await expect(peeks(page).first()).toBeVisible()
  await blank(page)
  await expect(peeks(page)).toHaveCount(0)
}

/** 浮窗滚到底（浮窗里是 CodeMirror，只画看得见的那一截：末尾的链接滚到才在） */
async function toBottom(page: Page, depth: number) {
  await layer(page, depth).locator('.pk-body').evaluate((el) => (el.scrollTop = el.scrollHeight))
}

/** 软件里记的最近一次弹出用了多久：从按下 ⌘ / 按着 ⌘ 移到链接上，到浮窗画出来那一帧（peek.tsx 的 window.__cnPeek） */
async function lastMs(page: Page): Promise<number> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __cnPeek?: Record<string, number>[] }).__cnPeek?.at(-1)?.shown)).toBeTruthy()
  return page.evaluate(() => {
    const t = (window as unknown as { __cnPeek: Record<string, number>[] }).__cnPeek.at(-1)!
    return Math.round(t.shown! - t.at!)
  })
}

/**
 * 每个地方都走一遍（⌘预览常驻）：⌘ 悬停 a → 弹出（量时间）→ 松 ⌘ 还在 → 点空白收；再弹 → Esc 收；
 * 按着 ⌘ 停到 b → 换成 b（还是一层）；松 ⌘ 移进浮窗滚轮不收（能滚的滚得动）；inner：浮窗里的链接，单击出预览卡、浮窗留着，Esc 先收卡；最后点空白收
 */
async function round(page: Page, where: string, o: { a: Locator; aTitle: string; b: Locator; bTitle: string; inner?: (p: Locator) => Locator }) {
  await hoverThenMeta(page, o.a)
  await expect(layer(page, 0).locator('.pk-t')).toHaveText(o.aTitle)
  const ms = await lastMs(page)
  console.log(`${where}：⌘ 悬停到浮窗画出来 ${ms} ms`)
  expect(ms).toBeLessThan(400)
  await releaseThenBlank(page)
  // Esc 收
  await hoverThenMeta(page, o.a)
  await expect(layer(page, 0)).toBeVisible()
  await page.keyboard.up('Meta')
  await page.waitForTimeout(300)
  await expect(peeks(page)).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(peeks(page)).toHaveCount(0)
  // 按着 ⌘ 停到另一个链接：换成那一篇
  await hoverThenMeta(page, o.a)
  await expect(layer(page, 0).locator('.pk-t')).toHaveText(o.aTitle)
  await o.b.hover()
  await expect(layer(page, 0).locator('.pk-t')).toHaveText(o.bTitle)
  await expect(peeks(page)).toHaveCount(1)
  await page.keyboard.up('Meta')
  // 移进浮窗：滚轮滚它自己，不收
  const body = layer(page, 0).locator('.pk-body')
  await body.hover()
  const [can, top0, atEnd] = await body.evaluate((el) => [el.scrollHeight > el.clientHeight + 4, el.scrollTop, el.scrollTop + el.clientHeight >= el.scrollHeight - 4] as const)
  // 滚到了那几行、已经在底的往上滚
  await page.mouse.wheel(0, atEnd ? -300 : 300)
  if (can) await expect.poll(() => body.evaluate((el) => el.scrollTop)).not.toBe(top0)
  await page.waitForTimeout(300)
  await expect(peeks(page)).toHaveCount(1)
  // 浮窗里的链接：单击照现在的规矩出预览卡，浮窗留着；Esc 先收卡
  if (o.inner) {
    const l = o.inner(layer(page, 0))
    await toBottom(page, 0)
    await expect(l).toBeVisible()
    await l.click()
    await expect(card(page)).toBeVisible()
    await expect(peeks(page)).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    await expect(peeks(page)).toHaveCount(1)
  }
  await blank(page)
  await expect(peeks(page)).toHaveCount(0)
}

test('文档里：双链弹整篇（先停再按 ⌘、先按 ⌘ 再移过去都行），标题、行号、块链接滚到那里亮着；不按 ⌘ 不弹；松 ⌘、移开都不收，点空白、Esc 才收，⌘ 停到另一个链接换成那一篇；浮窗里能滚、能点链接、再套一层；⌘S 这种快捷键顺手弹的收掉；⌘点照旧打开；文件不变', async () => {
  test.setTimeout(150_000)
  const run = await launch(FILES)
  const { page, vault } = run
  const before = snapshot(vault, Object.keys(FILES))
  try {
    await openNote(page, '起点')
    const doc = pane(page)
    const wiki = doc.locator('.cm-wikilink', { hasText: /^目标$/ })

    // 不按 ⌘：停 0.8 秒什么都不弹
    await wiki.hover()
    await page.waitForTimeout(800)
    await expect(peeks(page)).toHaveCount(0)

    // 先停着再按 ⌘：弹整篇；头上标题、文件夹、「打开 ⌘点」
    await page.keyboard.down('Meta')
    const p0 = layer(page, 0)
    await expect(p0).toBeVisible()
    await expect(p0.locator('.pk-t')).toHaveText('目标')
    await expect(p0.locator('.pk-sub')).toHaveText('课程')
    await expect(p0.locator('.pk-open')).toHaveText('打开 ⌘点')
    // 整篇用文档同一套画：标题是标题、提示块是提示块，不露 md 记号
    await expect(p0.getByTestId('peek-doc')).toContainText('开头一段：这是目标这篇的正文。')
    await expect(p0.locator('.cm-content')).not.toContainText('[!note]')
    await expect(p0.locator('.cm-content')).not.toContainText('# 目标')
    // 浮窗在窗口里
    const vp = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })))
    const pb = (await p0.boundingBox())!
    expect(pb.x).toBeGreaterThanOrEqual(0)
    expect(pb.y).toBeGreaterThanOrEqual(0)
    expect(pb.x + pb.width).toBeLessThanOrEqual(vp.width)
    expect(pb.y + pb.height).toBeLessThanOrEqual(vp.height)

    // 松开 ⌘：不收；鼠标移开（不按 ⌘）：也不收
    await page.keyboard.up('Meta')
    await page.waitForTimeout(700)
    await expect(p0).toBeVisible()
    await away(page)
    await page.waitForTimeout(700)
    await expect(p0).toBeVisible()
    await expect(peeks(page)).toHaveCount(1)
    // 点空白处：收
    await blank(page)
    await expect(peeks(page)).toHaveCount(0)

    // 先按 ⌘ 再移过去：标题链接滚到「方法」那一段、亮着
    await metaThenHover(page, doc.locator('.cm-link', { hasText: '方法那段' }))
    await expect(layer(page, 0).locator('.pk-sub')).toHaveText('课程 · 「方法」那一段')
    // 标题那一段：标题、空行、下面那一段
    await hitShown(page, 0, ['方法', '', '方法这一段：先读再写。'])
    // 松开 ⌘ 还在；Esc 收
    await page.keyboard.up('Meta')
    await page.waitForTimeout(500)
    await expect(peeks(page)).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(peeks(page)).toHaveCount(0)

    // 块链接 [[目标#^b7]]
    await hoverThenMeta(page, doc.locator('.cm-wikilink', { hasText: '目标#^b7' }))
    await expect(layer(page, 0).locator('.pk-sub')).toHaveText('课程 · ^b7 那一段')
    await hitShown(page, 0, ['块那一段在这里。'])
    // 还按着 ⌘ 停到另一个链接（上面的行号链接，浮窗在下面盖不着它）：换成第 30–31 行，还是一层
    await doc.locator('.cm-link', { hasText: '两行' }).hover()
    await expect(layer(page, 0).locator('.pk-sub')).toHaveText('课程 · 第30–31行')
    await expect(peeks(page)).toHaveCount(1)
    await hitShown(page, 0, ['第三十行：要引的第一句。', '第三十一行：要引的第二句。'])
    // 松开 ⌘ 再停到别的链接上：不换（没按 ⌘）
    await page.keyboard.up('Meta')
    await wiki.hover()
    await page.waitForTimeout(500)
    await expect(layer(page, 0).locator('.pk-sub')).toHaveText('课程 · 第30–31行')

    // 移进浮窗：能滚
    const body = layer(page, 0).locator('.pk-body')
    await body.hover()
    const top0 = await body.evaluate((el) => el.scrollTop)
    await page.mouse.wheel(0, 400)
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(top0)
    // 浮窗里的双链：单击照现在的规矩出预览卡，浮窗留着；Esc 先收卡，浮窗还在
    const inner = layer(page, 0).locator('.cm-wikilink', { hasText: '第三篇' })
    await toBottom(page, 0)
    await expect(inner).toBeVisible()
    await inner.click()
    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText('第三篇')
    await expect(peeks(page)).toHaveCount(1)
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    await expect(peeks(page)).toHaveCount(1)
    // 浮窗里的双链再 ⌘ 悬停：套一层
    await hoverThenMeta(page, inner)
    const p1 = layer(page, 1)
    await expect(p1).toBeVisible()
    await expect(p1.locator('.pk-t')).toHaveText('第三篇')
    await expect(p1.getByTestId('peek-doc')).toContainText('第三篇的正文')
    // 松开 ⌘、移到别处：两层都留着
    await page.keyboard.up('Meta')
    await away(page)
    await page.waitForTimeout(700)
    await expect(peeks(page)).toHaveCount(2)
    // 点在第一层里（不在第二层）：第二层收，第一层留着
    await layer(page, 0).locator('.pk-head').click({ position: { x: 4, y: 4 } })
    await expect(peeks(page)).toHaveCount(1)
    // 再套一层，Esc 收最上面一层，再 Esc 收下一层
    await hoverThenMeta(page, inner)
    await expect(layer(page, 1)).toBeVisible()
    await page.keyboard.up('Meta')
    await page.keyboard.press('Escape')
    await expect(peeks(page)).toHaveCount(1)
    await expect(layer(page, 0).locator('.pk-t')).toHaveText('目标')
    await page.keyboard.press('Escape')
    await expect(peeks(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('起点')

    // ⌘S 这种快捷键：鼠标正好停在链接上，按 ⌘ 时顺手弹出来的，按下 S 就收；之前就开着的不收
    await wiki.hover()
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(300)
    await expect(peeks(page)).toHaveCount(0)
    await hoverThenMeta(page, wiki)
    await expect(layer(page, 0)).toBeVisible()
    await page.keyboard.up('Meta')
    await away(page)
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(300)
    await expect(peeks(page)).toHaveCount(1)
    await blank(page)
    await expect(peeks(page)).toHaveCount(0)

    // 库里没有的：写「库里没找到这一篇」
    await hoverThenMeta(page, doc.locator('.cm-wikilink', { hasText: '库里没有这篇' }))
    await expect(layer(page, 0).locator('.pk-msg')).toHaveText('库里没找到这一篇')
    await expect(layer(page, 0).locator('.pk-open')).toHaveCount(0)
    await releaseThenBlank(page)

    // 弹出来以后再 ⌘点 = 打开，浮窗收掉
    await hoverThenMeta(page, wiki)
    await expect(layer(page, 0)).toBeVisible()
    await wiki.click({ modifiers: ['Meta'] })
    await page.keyboard.up('Meta')
    await expect(tabOn(page)).toHaveText('目标')
    await expect(peeks(page)).toHaveCount(0)
    // 浮窗头上「打开 ⌘点」也是打开（到那一行）
    await tabs(page).filter({ hasText: '起点' }).click()
    await hoverThenMeta(page, pane(page).locator('.cm-link', { hasText: '两行' }))
    await expect(layer(page, 0)).toBeVisible()
    await page.keyboard.up('Meta')
    await layer(page, 0).locator('.pk-open').click()
    await expect(tabOn(page)).toHaveText('目标')
    await expect(peeks(page)).toHaveCount(0)
    // 浮窗里 ⌘点链接：照旧打开那一篇，浮窗收掉
    await tabs(page).filter({ hasText: '起点' }).click()
    await hoverThenMeta(page, pane(page).locator('.cm-wikilink', { hasText: '目标#^b7' }))
    await expect(layer(page, 0)).toBeVisible()
    await page.keyboard.up('Meta')
    const third = layer(page, 0).locator('.cm-wikilink', { hasText: '第三篇' })
    await toBottom(page, 0)
    await expect(third).toBeVisible()
    await third.click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('第三篇')
    await expect(peeks(page)).toHaveCount(0)

    // 浮窗只读：一个字没变
    expect(snapshot(vault, Object.keys(FILES))).toEqual(before)
    expect(clean(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('几千行的大文件：弹得快，浮窗里只画看得见的那一截；同一篇第二次也弹得出来', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    await openNote(page, '起点')
    const big = pane(page).locator('.cm-wikilink', { hasText: '大文件' })
    await big.hover()
    const t0 = Date.now()
    await page.keyboard.down('Meta')
    const p0 = layer(page, 0)
    await expect(p0.getByTestId('peek-doc')).toContainText('第 1 行')
    const ms = Date.now() - t0
    console.log(`6000 行弹出用了 ${ms} ms`)
    expect(ms).toBeLessThan(1500)
    // 只画看得见的：浮窗里的行远少于 6000
    expect(await p0.locator('.cm-line').count()).toBeLessThan(200)
    // 滚到底也能看到最后一行
    await p0.locator('.pk-body').hover()
    await page.keyboard.up('Meta')
    await p0.locator('.pk-body').evaluate((el) => (el.scrollTop = el.scrollHeight))
    await expect(p0.getByTestId('peek-doc')).toContainText('第 6000 行', { timeout: 5000 })
    await page.keyboard.press('Escape')
    await expect(peeks(page)).toHaveCount(0)
    // 第二次：弹得出来、字对
    await hoverThenMeta(page, big)
    await expect(layer(page, 0).getByTestId('peek-doc')).toContainText('第 1 行')
    await page.keyboard.up('Meta')
  } finally {
    await run.close()
  }
})

// ---------- AI 回答里、白板卡里、PDF 页码（七种引用的假回答，同 3e53q-kinds） ----------

const PLAN_MD = ['# 小论文计划', ...Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 条：先放着。`), 'SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。', '', '相关：[[读论文白板]]', ''].join('\n')
const BOARD_MD = ['# 读论文白板', '', '## 方法', '', '<!-- card id=c7 -->', '**LOSO 评估**', '随机划分 91.8%，留一被试 80.6%：差 11 个点。', '', '另一张卡，见 [[小论文计划]]。', '', '## 结果', '', '结果那张，另见 [[随手]]。', ''].join('\n')
const AI_FILES = {
  '课程/小论文计划.md': PLAN_MD,
  '课程/线代/第3讲.pdf': LECTURE,
  '收件箱/随手.md': '# 随手\n\n问问 AI。\n',
  '课程/读论文白板.md': BOARD_MD,
  '冰岛.md': ICELAND.replace('3 月 1 日，维克', '3 月 1 日，见 [计划](课程/小论文计划.md#L42)，维克'),
  '待办.md': ['# 待办', '', '- [ ] 周五前读完 SAGE 📅 2026-11-27', ''].join('\n'),
  // 冰岛那块是老白板（自由摆放）：记进旧写法名单，打开不转写法（同 step21-ctx-board）
  '.canvas-notes/白板旧写法.json': JSON.stringify({ 版本: 1, 白板: ['冰岛.md'] }),
}
const SUBJECT = '整理小论文计划'
function prepare(vault: string) {
  const git = (...a: string[]) => execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...a])
  git('add', '-A')
  git('commit', '-q', '-m', '开始')
  appendFileSync(join(vault, '课程/小论文计划.md'), '排第 3 篇还没定。\n')
  git('add', '-A')
  git('commit', '-q', '-m', SUBJECT)
  writeFileSync(join(vault, '收件箱/样本.md'), '# 样本\n')
}
const hashOf = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%h', `--grep=${SUBJECT}`], { encoding: 'utf8' }).trim()
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const card = (page: Page) => page.getByRole('dialog', { name: '引用' })

async function ask(run: Running): Promise<Locator> {
  const { page } = run
  await openNote(page, '随手')
  await openAi(page)
  const ta = chat(page).getByRole('textbox', { name: '问 AI' })
  await ta.fill(`列出七种引用 ${hashOf(run.vault)}`)
  await ta.press('Enter')
  const msg = chat(page).getByTestId('ai-msg').last()
  await expect(msg).toContainText('整理计划那次', { timeout: 15_000 })
  return msg
}

test('AI 回答里：笔记几行弹整篇滚到那两行、PDF 页码弹那一页（框画出来）、白板卡弹那块白板转到那张卡、网页弹网址和那几个字；单击预览卡、⌘点打开照旧', async () => {
  test.setTimeout(150_000)
  const run = await launch(AI_FILES, { CN_AI_FAKE: '1' }, prepare)
  const { page, vault } = run
  try {
    const msg = await ask(run)
    const before = snapshot(vault, ['课程/小论文计划.md', '课程/读论文白板.md', '待办.md'])

    // 常驻那一套：⌘ 停白板卡那条弹出、松 ⌘ 还在、点空白收、Esc 收、⌘ 停到上面笔记那条换过去（浮窗在链接下面，挑上面没被盖住的）、浮窗里滚、点里面的 [[读论文白板]] 出预览卡
    await round(page, 'AI 回答', {
      a: msg.locator('a.cite', { hasText: 'LOSO 那张卡' }),
      aTitle: '读论文白板',
      b: msg.locator('a.cite', { hasText: '小论文计划里排' }),
      bTitle: '小论文计划',
      inner: (p) => p.locator('.cm-wikilink', { hasText: '读论文白板' }),
    })

    // 笔记几行
    await hoverThenMeta(page, msg.locator('a.cite', { hasText: '小论文计划里排' }))
    await expect(layer(page, 0).locator('.pk-t')).toHaveText('小论文计划')
    await hitShown(page, 0, ['SAGE 排第 2 篇，编号 J52。', '作者和 C72 重叠（Chenpei Xie）。'])
    await releaseThenBlank(page)

    // PDF 页码：那一页的整页图，框在图里
    await hoverThenMeta(page, msg.locator('a.pg.cite', { hasText: '第 4 页' }))
    const pdf = layer(page, 0)
    await expect(pdf.locator('.pk-t')).toHaveText('第3讲.pdf')
    await expect(pdf.locator('.pk-sub')).toHaveText('课程/线代 · 第4页')
    await expect(pdf.locator('.pk-open')).toHaveText('翻到这页 ⌘点')
    const img = pdf.getByTestId('peek-pdf').locator('img')
    await expect(img).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => img.evaluate((e: HTMLImageElement) => e.naturalWidth)).toBeGreaterThan(500)
    const box = pdf.getByTestId('peek-pdf').locator('.box')
    await expect(box).toBeVisible()
    const ib = (await img.boundingBox())!
    const bb = (await box.boundingBox())!
    expect(bb.x).toBeGreaterThanOrEqual(ib.x - 1)
    expect(bb.x + bb.width).toBeLessThanOrEqual(ib.x + ib.width + 1)
    await releaseThenBlank(page)

    // 白板卡：那块白板一列一列，那张卡亮着、在看得见的地方
    await hoverThenMeta(page, msg.locator('a.cite', { hasText: 'LOSO 那张卡' }))
    const bd = layer(page, 0)
    await expect(bd.locator('.pk-sub')).toHaveText('课程 · 白板里的一张卡')
    await expect(bd.getByTestId('peek-board').locator('.pk-col h4')).toHaveText(['方法', '结果'])
    const hit = bd.locator('.pk-card.hit')
    await expect(hit).toContainText('LOSO 评估')
    // 白板卡里的双链再套一层
    await bd.locator('.pk-body').hover()
    await page.keyboard.up('Meta')
    await hoverThenMeta(page, bd.locator('a.cite', { hasText: '小论文计划' }))
    await expect(layer(page, 1).locator('.pk-t')).toHaveText('小论文计划')
    // 松 ⌘、移开：两层都留着；点空白都收
    await page.keyboard.up('Meta')
    await away(page)
    await page.waitForTimeout(400)
    await expect(peeks(page)).toHaveCount(2)
    await blank(page)
    await expect(peeks(page)).toHaveCount(0)

    // 网页：网址和那几个字，不在浮窗里开网页
    await hoverThenMeta(page, msg.locator('a.cite', { hasText: '注意力那段' }))
    const web = layer(page, 0).getByTestId('peek-web')
    await expect(web.locator('.q')).toHaveText('注意力')
    await expect(web.locator('.url')).toContainText('https://example.com/attn.html')
    await expect(layer(page, 0).locator('webview, iframe')).toHaveCount(0)
    await releaseThenBlank(page)

    // 单击照旧出预览卡，不弹浮窗
    const note = msg.locator('a.cite', { hasText: '小论文计划里排' })
    await note.click()
    await expect(card(page)).toBeVisible()
    await expect(peeks(page)).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    // ⌘ 悬停弹出后再 ⌘点 = 打开
    await hoverThenMeta(page, note)
    await expect(layer(page, 0)).toBeVisible()
    await note.click({ modifiers: ['Meta'] })
    await page.keyboard.up('Meta')
    await expect(tabOn(page)).toHaveText('小论文计划')
    await expect(peeks(page)).toHaveCount(0)

    expect(snapshot(vault, ['课程/小论文计划.md', '课程/读论文白板.md', '待办.md'])).toEqual(before)
  } finally {
    await run.close()
  }
})

test('白板卡里的链接：文档切成的白板、老白板都能 ⌘ 悬停弹出；白板上的卡不跟着动、不选中', async () => {
  test.setTimeout(150_000)
  const run = await launch(AI_FILES)
  const { page, vault } = run
  try {
    // 文档切成的白板
    await openNote(page, '读论文白板')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const board = pane(page).getByTestId('doc-board')
    await expect(board).toBeVisible()
    const link = board.locator('a.cite', { hasText: '小论文计划' })
    const cardEl = board.locator('.db-card', { has: page.locator('a.cite', { hasText: '小论文计划' }) })
    const at = await cardEl.boundingBox()
    // 常驻那一套：⌘ 停「随手」弹出、松 ⌘ 还在、点空白收、Esc 收、⌘ 停到「小论文计划」换过去、浮窗里滚、点里面的 [[读论文白板]] 出预览卡
    await round(page, '白板', {
      a: board.locator('a.cite', { hasText: '随手' }),
      aTitle: '随手',
      b: link,
      bTitle: '小论文计划',
      inner: (p) => p.locator('.cm-wikilink', { hasText: '读论文白板' }),
    })
    await hoverThenMeta(page, link)
    await expect(layer(page, 0).locator('.pk-t')).toHaveText('小论文计划')
    await expect(layer(page, 0).getByTestId('peek-doc')).toContainText('第 1 条：先放着。')
    await releaseThenBlank(page)
    expect(await cardEl.boundingBox()).toEqual(at)
    await expect(cardEl).not.toHaveClass(/\bsel\b/)

    // 老白板（自由摆放的）
    await page.locator('.nav .si', { hasText: /^冰岛/ }).first().click()
    await expect(tabOn(page)).toHaveText('冰岛')
    const old = pane(page).getByTestId('board')
    await expect(old).toBeVisible()
    await hoverThenMeta(page, old.locator('a.cite', { hasText: '计划' }))
    await expect(layer(page, 0).locator('.pk-t')).toHaveText('小论文计划')
    await expect(layer(page, 0).locator('.pk-sub')).toHaveText('课程 · 第42行')
    await hitShown(page, 0, ['SAGE 排第 2 篇'])
    await releaseThenBlank(page)
    expect(clean(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('数据库格子里的链接：一样 ⌘ 悬停弹出', async () => {
  const VAULT = {
    '文献总表.md': ['# 文献总表', '', '```base', 'filters:', '  and:', '    - file.inFolder("文献库")', 'views:', '  - type: table', '    name: 表格', '    order:', '      - file.name', '      - 状态', '```', ''].join('\n'),
    '文献库/SAGE.md': ['---', '状态: 在读', '---', '# SAGE', '', '图神经网络，和 C72 同一组作者。', ''].join('\n'),
  }
  const run = await launch(VAULT)
  const { page } = run
  try {
    // 数据库：名字那一格
    await openNote(page, '文献总表')
    const name = pane(page).locator('td.nm button', { hasText: 'SAGE' }).first()
    await expect(name).toBeVisible()
    await hoverThenMeta(page, name)
    await expect(layer(page, 0).locator('.pk-t')).toHaveText('SAGE')
    await expect(layer(page, 0).locator('.pk-sub')).toHaveText('文献库 · 一行')
    await expect(layer(page, 0).getByTestId('peek-doc')).toContainText('图神经网络')
    await releaseThenBlank(page)
  } finally {
    await run.close()
  }
})

test('梦游对照里的链接：一样 ⌘ 悬停弹出', async () => {
  test.setTimeout(150_000)
  // 极光那篇末尾先有一个链到「冰岛行程」的双链（梦游补的 [[极光预报]] 补在它后面，两个在对照里挨着）；冰岛行程里本来就链着 [[极光]]（浮窗里点它）
  const vault = { ...DREAM2_VAULT, [AURORA]: AURORA_MD + '\n相关：[[冰岛行程]]\n' }
  const run = await launch(vault, { CN_AI_FAKE: '1' }, prepareDream2)
  const { page } = run
  try {
    // 梦游对照：收下后那一栏补上的 [[极光预报]]
    const dcard = page.getByTestId('dream-card')
    await dcard.getByRole('button', { name: '现在梦游' }).click()
    await expect(dcard.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
    await dcard.getByRole('button', { name: '看报告' }).click()
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByTestId('dream-item').filter({ hasText: '↔ [[极光预报]]' }).click()
    const dtab = page.locator('[data-testid="dream-tab"]:not([hidden])')
    const link = dtab.locator('.cm-merge-b .cm-wikilink', { hasText: '极光预报' })
    await expect(link).toBeVisible({ timeout: 10_000 })
    // 对照一画好会自己滚到改动处：等它停下再指
    await page.waitForTimeout(1200)
    await hoverThenMeta(page, link)
    await expect(layer(page, 0).locator('.pk-t')).toHaveText('极光预报')
    await expect(layer(page, 0).getByTestId('peek-doc')).toContainText('每天下午看冰岛气象局的云量图')
    await releaseThenBlank(page)
    // 常驻那一套：⌘ 停「极光预报」弹出、松 ⌘ 还在、点空白收、Esc 收、⌘ 停到「冰岛行程」换过去、点浮窗里的 [[极光]] 出预览卡
    const other = dtab.locator('.cm-merge-b .cm-wikilink', { hasText: '冰岛行程' })
    await round(page, '梦游对照', { a: link, aTitle: '极光预报', b: other, bTitle: '冰岛行程', inner: (p) => p.locator('.cm-wikilink', { hasText: '极光' }) })
  } finally {
    await run.close()
  }
})
