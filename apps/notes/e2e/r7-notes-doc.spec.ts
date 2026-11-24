// 第 3 段：读 PDF 的笔记做成一篇长文档（CN-93、94、95、96、111，小样 A-AI与读PDF/v2/proto-a.html 的 docHtml 和 notes.md 那段 md）。
// 问题条照发出去的原话、回答照 AI 原文、旁支挂在被问那一问的回答后面、末尾一句小结（每答完一次重写）；我框的图按 PDF 上 100% 的宽、截图 2 倍；
// 右栏「笔记」：顶上搜、N 轮 · N 问，最近一轮展开、旧的收成一行；以前格式的笔记照旧显示，同一处再问时整段换成新格式；我的疑惑是原话。
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import type { ReadingState } from '../src/shared/reading'
import { launch, leftView, rail, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const side = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' }).getByRole('region', { name: '旁支' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const gitOut = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const box = async (l: Locator) => (await l.boundingBox())!
const css = (l: Locator, props: string[]) =>
  l.evaluate((e, ps) => {
    const cs = getComputedStyle(e)
    return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]))
  }, props)

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲.pdf' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

async function drawBox(page: Page, n: number, a: [number, number], b: [number, number]) {
  const el = pdfPage(page, n)
  await el.scrollIntoViewIfNeeded()
  const r = await box(el)
  await page.mouse.move(r.x + r.width * a[0], r.y + r.height * a[1])
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * b[0], r.y + r.height * b[1], { steps: 6 })
  await page.mouse.up()
}

async function selectText(page: Page, scope: Locator, from: string, to: string) {
  const pts = await scope.evaluate(
    (root, [a, b]) => {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let s: [Node, number] | null = null
      let e: [Node, number] | null = null
      while (w.nextNode()) {
        const n = w.currentNode as Text
        if (!s && n.data.includes(a!)) s = [n, n.data.indexOf(a!)]
        if (s && n.data.includes(b!, s[0] === n ? s[1] : 0)) {
          e = [n, n.data.indexOf(b!, s[0] === n ? s[1] : 0) + b!.length]
          break
        }
      }
      const r = document.createRange()
      r.setStart(s![0], s![1])
      r.setEnd(e![0], e![1])
      ;(s![0] as Text).parentElement!.scrollIntoView({ block: 'center' })
      const rs = r.getClientRects()
      const f = rs[0]!
      const l = rs[rs.length - 1]!
      return [f.left + 1, f.top + f.height / 2, l.right - 1, l.top + l.height / 2]
    },
    [from, to],
  )
  await page.mouse.move(pts[0]!, pts[1]!)
  await page.mouse.down()
  await page.mouse.move(pts[2]!, pts[3]!, { steps: 8 })
  await page.mouse.up()
}

/** 同一份库、设置目录再开一次软件 */
async function relaunch(vault: string, userData: string) {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(dirname(vault), 'trash') },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.vault b')).toHaveText('测试库')
  return { app, page }
}

test('笔记逐字核（2026-11-24 新写法）：一问一个小标题是原话（主对话接着问的、旁支问的）、回答原文、旁支挂在被问那一问后面（追问不带引用句）、不再有小结和身份注释、我框的写宽度；图按 PDF 100% 的宽显示、截图 2 倍；出卡是原话', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openPdf(page)
    await page.keyboard.press('Meta+j')
    await expect(ai(page).getByTestId('reading-sees')).toContainText('读过全文5页')
    // 框两个词：第 2 页的标题「3.2 Definition」
    await drawBox(page, 2, [0.11, 0.085], [0.42, 0.135])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    const first = ai(page).getByTestId('reading-msg').first()
    await expect(first.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    let md = readFileSync(join(vault, NOTE), 'utf8')
    // 2026-11-24 AI 对话记笔记开关（偏好「不要PDF自动笔记样式」）：普通文档，一页一节「第 N 页 · 那页第一行大字」、一问一个「### 问的原话」，
    // 框的图写宽度、「—— [第 N 页](…)」回到那一块、回答原文一块 [!ai]（块头带回到对话的链接）；不再有身份注释、问题条、小结，不让快模型起标题
    const anchor = /\n## 第 2 页 · 3\.2 Definition\n\n### 给我讲解一下\n\n!\[我框的\|(\d+)\]\(\.\.\/\.\.\/附件\/第3讲\/p2-1\.png\)\n\n—— \[第 2 页\]\(第3讲\.pdf#page=2&rect=([\d.]+),([\d.]+),([\d.]+),([\d.]+)\)\n\n> \[!ai\] AI 回答 · Claude Code · Opus 5\.5 · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?[^)]+\)\n> 这是讲解（第 2 页，图 1 张，读过全文，新会话）。用你在 \[第 2 页\]\(#page=2\) 弄懂的那条：列就是基向量去哪。\n/.exec(md)!
    expect(anchor).not.toBeNull()
    const cropW = Number(anchor[1])
    // 我框的图的宽 = 框在 PDF 上 100% 时的宽（612 宽的页 × 框的比例）
    expect(Math.abs(cropW - 612 * Number(anchor[4]))).toBeLessThanOrEqual(1)
    expect(md).not.toMatch(/我的疑惑|讲通的讲法|要点|完整对话|cn:thread|\[!question\]|\[!recap\]|测试小标题|〔/)
    await expect.poll(() => gitOut(vault, 'log', '-1', '--format=%s')).toBe('笔记：第3讲 笔记 · 给我讲解一下')

    // 主对话接着问（「还是不懂」）：再一问，接在这一节后面，不再放图和来源行
    await first.getByRole('button', { name: '还是不懂' }).click()
    await expect(ai(page).getByTestId('reading-msg').last().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    // 旁支：在第一个回答里选一句，问，再追问一句
    await selectText(page, first.locator('.txt'), '列就是', '去哪')
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('为什么是列？')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    await expect(side(page).getByTestId('side-noted')).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await side(page).getByRole('textbox', { name: '问 AI' }).fill('那行呢？')
    await side(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(side(page).getByTestId('side-msg')).toHaveCount(2)
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 15_000 }).toContain('#### 旁支：那行呢？')
    md = readFileSync(join(vault, NOTE), 'utf8')
    const section = md.slice(md.indexOf('## 第 2 页')).replace(/\]\(canvas-notes:\/\/chat\?[^)]+\)/g, '](L)')
    // 旁支挂在被问那一问后面（在「还是不懂」之前）；同一条旁支追问的不再引那一句
    expect(section).toBe(
      [
        '## 第 2 页 · 3.2 Definition',
        '',
        '### 给我讲解一下',
        '',
        `![我框的|${cropW}](../../附件/第3讲/p2-1.png)`,
        '',
        `—— [第 2 页](第3讲.pdf#page=2&rect=${anchor.slice(2, 6).join(',')})`,
        '',
        '> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](L)',
        '> 这是讲解（第 2 页，图 1 张，读过全文，新会话）。用你在 [第 2 页](#page=2) 弄懂的那条：列就是基向量去哪。',
        '',
        '#### 旁支：为什么是列？',
        '',
        '> 列就是基向量去哪',
        '> —— 在「给我讲解一下」的回答里',
        '',
        '> [!ai] 旁支回答 · Claude Code · Opus 5.5 · [回到 AI 对话](L)',
        // 假 AI 的旁支回答自己带这个小标题（回答原文照写）
        '> #### 旁支的回答',
        '>',
        '> 这是旁支的回答（第 ? 页，图 0 张，没读全文，旁支，从 fake-read-claude 分叉）：讲「列就是基向量去哪」，问的是「为什么是列？」。',
        '>',
        '> 第二段：门槛减掉，不清零。',
        '',
        '#### 旁支：那行呢？',
        '',
        '> [!ai] 旁支回答 · Claude Code · Opus 5.5 · [回到 AI 对话](L)',
        // 假 AI 的旁支回答自己带这个小标题（回答原文照写）
        '> #### 旁支的回答',
        '>',
        '> 这是旁支的回答（第 ? 页，图 0 张，没读全文，接着聊）：讲「列就是基向量去哪」，问的是「那行呢？」。',
        '>',
        '> 第二段：门槛减掉，不清零。',
        '',
        '### 还是不懂',
        '',
        '> [!ai] AI 回答 · Claude Code · Opus 5.5 · [回到 AI 对话](L)',
        '> 换个方式讲（第 2 页，图 0 张，读过全文，接着聊）：先别看公式，看图。',
        '',
      ].join('\n'),
    )
    // 完整对话不再另写一份（笔记里就是问答原文）
    expect(() => readdirSync(join(vault, '.canvas-notes/对话'))).toThrow()
    // 笔记写进去和提交是先后两步（原子写带 fsync 后机器忙时中间隔得开）：等提交到
    await expect.poll(() => gitOut(vault, 'status', '--porcelain', '--untracked-files=all')).toBe('')

    // CN-111：笔记里我框的图按 100% 的宽显示（不超过栏宽），截图是 2 倍
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const img = notes(page).locator('.rnd .crop img').first()
    await expect(img).toBeVisible()
    const size = await img.evaluate((e: HTMLImageElement) => ({ nat: e.naturalWidth, w: e.getBoundingClientRect().width, col: e.closest('.ndoc')!.clientWidth - 40 }))
    expect(Math.abs(size.w - Math.min(cropW, size.col))).toBeLessThanOrEqual(1)
    expect(Math.abs(size.nat - cropW * 2)).toBeLessThanOrEqual(2)

    // 出卡（「我的疑惑」那一页 2026-11-22 拿掉了，task-tz7y3）：一问一张，原话（主问题 + 旁支问题；「还是不懂」并进上一问）
    await notes(page).getByRole('button', { name: '出卡 · 3问' }).click()
    const dlg = page.getByRole('dialog', { name: '出卡' })
    await expect(dlg.getByRole('group', { name: '每一张' }).getByRole('button')).toHaveCount(3)
    for (const q of ['给我讲解一下', '为什么是列？', '那行呢？']) {
      await expect(dlg.locator('.orig')).toContainText(`你当时问的：「${q}」`)
      await page.keyboard.press('ArrowRight')
    }
    await page.keyboard.press('Escape')
    // 「我的疑惑」不再是文件（2026-11-20）：没有我的疑惑.md，汇总页直接读笔记
    expect(existsSync(join(vault, '课程/线代/我的疑惑.md'))).toBe(false)
    // 左栏 PDF 下面挂它的笔记一行写「笔记」，右端是笔记里问了几问（主问题 + 旁支问题，「还是不懂」也算一问；PDF › 笔记 › 可视化，task-m552v）
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    const item = (name: string) => tree.getByRole('treeitem').filter({ hasText: new RegExp(`^${name}`) })
    for (const f of ['课程', '线代']) if (await item(f).getByRole('button', { name: `展开 ${f}` }).count()) await item(f).getByRole('button', { name: `展开 ${f}` }).click()
    await expect(tree.locator(`[role="treeitem"][data-path="${NOTE}"]`).getByTestId('ft-note')).toHaveText('4')
    await expect(item('第3讲 笔记')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

// AI 对话记笔记开关（新写法）起：不再让快模型起段标题、写小结，一轮的标题是问的原话，没有小结那一行；右栏照新写法显示问的原话、回答原文、旁支
test('笔记标签一篇长文档（工作区方向 A 原型 buildNote）：顶上搜、下面「全部 · 只看我问的 · 旁支」+ N轮 · N问，最近一轮展开、旧的收成一行（第N页 · 问的原话、几问 · 时间），点开展开；问题条、回答原文、旁支的样子，没有 AI 标题和小结；「第N页 ›」点了 PDF 翻过去框闪；搜得到原话、回答、旁支', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openPdf(page)
    await page.keyboard.press('Meta+j')
    await drawBox(page, 2, [0.1, 0.2], [0.6, 0.4])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    const first = ai(page).getByTestId('reading-msg').first()
    await expect(first.getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await selectText(page, first.locator('.txt'), '列就是', '去哪')
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('为什么是列？')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    // 开着旁支看一眼笔记（直接落在那条旁支上），再回到 AI：这一轮不算「自己点开的」，来了新的一轮照样收成一行
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notes(page).locator('.nside').first()).toBeInViewport()
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(ai(page)).toBeVisible()
    await side(page).getByRole('button', { name: '收起旁支' }).last().click()
    // 第二轮：第 4 页
    await drawBox(page, 4, [0.1, 0.2], [0.6, 0.4])
    await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
    await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
    await expect(ai(page).getByTestId('reading-msg').last().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const n = notes(page)
    await expect(n).toBeVisible()
    // 顶上：28 高、圆角 8、--fill 底的搜；下面一行筛选，右边「2轮 · 3问」
    const srch = n.locator('.nsub .srch')
    await expect(srch.getByRole('textbox', { name: '在这份笔记里找' })).toHaveAttribute('placeholder', '在这份笔记里找')
    expect((await box(srch)).height).toBe(28)
    expect(await css(srch, ['border-radius'])).toEqual({ 'border-radius': '8px' })
    await expect(n.getByTestId('cards-open')).toHaveText('出卡 · 3问')
    await expect(n.getByRole('tablist', { name: '笔记筛选' }).getByRole('tab')).toHaveText(['全部', '只看我问的', '旁支'])
    // 每一轮默认展开（2026-11-23 起）；点「全部收起」都收成一行：40 高，「第2页 · 问的原话」+ 右边「2问 · 今天 时间」（新写法没有小结）
    const rounds = n.getByTestId('note-round')
    await expect(rounds).toHaveCount(2)
    await expect(rounds.locator('.rh h3')).toHaveText(['第2页 · 给我讲解一下', '第4页 · 给我讲解一下'])
    await expect(n.getByText('测试小标题')).toHaveCount(0)
    await expect(n.locator('.recap')).toHaveCount(0)
    // 回答原文照排：两轮的回答都在
    await expect(rounds.first().locator('.qa > .am').first()).toContainText('这是讲解（第 2 页')
    await expect(rounds.last().locator('.qa > .am').first()).toContainText('这是讲解（第 4 页')
    await n.getByTestId('notes-fold-all').click()
    await expect(rounds.locator('.fh')).toHaveCount(2)
    const fold = rounds.first()
    await expect(fold).toHaveClass(/\bfold\b/)
    expect((await box(fold.locator('.fh'))).height).toBe(40)
    await expect(fold.locator('.tt')).toHaveText('第2页 · 给我讲解一下')
    await expect(fold.locator('.rc')).toHaveText('')
    await expect(fold.locator('.r')).toHaveText(/^2问 · 今天 \d\d:\d\d$/)
    // 点开第 4 页那轮：「第4页 · 问的原话」15/600 + 右边「1问 · 时间」，下一行「第4页 ›」「· 我框的」，主问题条整栏宽 --fill2 圆角 6
    await rounds.last().locator('.fh').click()
    const open = rounds.last()
    await expect(open.locator('.rh h3')).toHaveText('第4页 · 给我讲解一下')
    expect(await css(open.locator('.rh h3'), ['font-size', 'font-weight'])).toEqual({ 'font-size': '15px', 'font-weight': '600' })
    await expect(open.locator('.rh .r')).toHaveText(/^1问 · 今天 \d\d:\d\d$/)
    await expect(open.locator('.loc')).toHaveText('第4页 ›· 我框的')
    const qs = open.locator('.qs')
    await expect(qs).toHaveText(['给我讲解一下'])
    expect(await css(qs, ['border-radius', 'font-weight'])).toEqual({ 'border-radius': '6px', 'font-weight': '500' })
    expect(Math.abs((await box(qs)).width - (await box(open)).width)).toBeLessThanOrEqual(1)
    await expect(open.locator('.qa > .am').first()).toContainText('这是讲解（第 4 页')
    await expect(open.locator('.recap')).toHaveCount(0)
    // 「第 4 页 ›」：PDF 翻过去，框闪
    await open.locator('.loc button').click()
    await expect(pdfPane(page).locator('.pdfslot').nth(3).getByTestId('pdf-flash')).toBeAttached()
    await expect(page.getByTestId('tab-acts').getByTestId('pdf-pager')).toHaveText('4 / 5')
    // 点开旧的那轮：展开；旁支缩进一级（左边距 18、左内边距 12、2px 竖线），被问的那句一行 12 --t3，旁支的问题条 78% 宽
    await fold.locator('.fh').click()
    const r2 = rounds.first()
    await expect(r2.locator('.rh h3')).toHaveText('第2页 · 给我讲解一下')
    const sd = r2.locator('.nside')
    expect(await css(sd, ['margin-left', 'padding-left', 'border-left-width', 'border-left-style'])).toEqual({ 'margin-left': '18px', 'padding-left': '12px', 'border-left-width': '2px', 'border-left-style': 'solid' })
    // 不带上左栏（.side）的样子：没有底色、右边线、上边的空，也不是拖窗口的区域（以前撞名，旁支那块点不了、选不了字）
    expect(await css(sd, ['background-color', 'border-right-width', 'padding-top', '-webkit-app-region'])).toEqual({ 'background-color': 'rgba(0, 0, 0, 0)', 'border-right-width': '0px', 'padding-top': '0px', '-webkit-app-region': 'none' })
    await expect(sd.locator('.q0')).toHaveText('列就是基向量去哪')
    expect(await css(sd.locator('.q0'), ['font-size'])).toEqual({ 'font-size': '12px' })
    const sqs = sd.locator('.qs')
    await expect(sqs).toHaveText('为什么是列？')
    // 78%：占旁支里面（去掉 2px 竖线和左内边距 12）那一栏的宽
    const inner = await sd.evaluate((e) => e.clientWidth - 12)
    expect(Math.round(((await box(sqs)).width / inner) * 100)).toBe(78)
    // 回答原文照排（标题）；被问的那句笔记里也有虚线和小标
    await expect(sd.locator('.am .md-h')).toHaveText('旁支的回答')
    await expect(r2.locator('.qa > .am .asked')).toHaveText('列就是基向量去哪。')
    await expect(r2.locator('.qa > .am .badge')).toHaveText('1')
    // 搜：原话、回答、旁支都搜得到；搜的时候命中的那几轮都展开
    const find = n.getByRole('textbox', { name: '在这份笔记里找' })
    await find.fill('为什么是列')
    await expect(rounds).toHaveCount(1)
    await expect(n.getByTestId('cards-open')).toHaveText('出卡 · 3问')
    await find.fill('门槛减掉')
    await expect(rounds).toHaveCount(1)
    await find.fill('第 4 页，图 1 张')
    await expect(rounds).toHaveCount(1)
    await expect(rounds.locator('.rh h3')).toHaveText('第4页 · 给我讲解一下')
    await find.fill('没有这句话')
    await expect(rounds).toHaveCount(0)
    await expect(n.locator('.nempty')).toHaveText('这份笔记里没有「没有这句话」')
  } finally {
    await run.close()
  }
})

const OLD = [
  '---',
  '类型: 笔记',
  '来源: "[[第3讲.pdf]]"',
  '---',
  '',
  '# 第3讲 笔记',
  '',
  '## 第 2 页 · 旧的一段',
  '[第 2 页](第3讲.pdf#page=2&rect=0.1,0.2,0.5,0.2) · 10:20',
  '',
  '> [!question] 我的疑惑',
  '> 整块没看懂：第 2 页框的这块',
  '',
  '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 2 页',
  '> 先看图，再看公式。',
  '>',
  '> - 要点一：列就是基向量去哪',
  '',
  '[完整对话 · 1 轮](../../.canvas-notes/对话/第3讲-p2-1.md) · [[第4讲 特征值]]',
  '',
  '## 第 4 页 · 另一段旧的',
  '[第 4 页](第3讲.pdf#page=4) · 10:30',
  '',
  '> [!question] 我的疑惑',
  '> 核是什么',
  '',
  '> [!ai] AI 讲解',
  '> 核是被送到零的那些向量。',
  '',
  '[完整对话 · 1 轮](../../.canvas-notes/对话/第3讲-p4-1.md)',
  '',
  '## 我自己记的',
  '',
  '考试要考。',
  '',
].join('\n')

test('以前格式的笔记照旧读得回来、照旧显示（我的疑惑、讲通的讲法、要点、完整对话），不自动改写；同一处再问时新写法接在那一段后面（那一段一字节不动），别的段、自己写的字不动', async () => {
  const FILLED = OLD.replace('· 10:20\n', '· 10:20\n\n![我框的](../../附件/第3讲/p2-1.png)\n')
  const run = await launch({ [PDF]: LECTURE, [NOTE]: OLD, '课程/线代/第4讲 特征值.md': '# 第4讲 特征值\n' }, { CN_AI_FAKE: '1' })
  const { page, vault, userData } = run
  const root = dirname(vault)
  try {
    await openPdf(page)
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    const n = notes(page)
    await expect(n.getByTestId('note-round')).toHaveCount(2)
    await expect(n.getByTestId('cards-open')).toHaveText('出卡 · 2问')
    // 旧的段收成一行（右边小结的位置写讲通的讲法）；点开照旧是我的疑惑、讲通的讲法、要点、完整对话
    await n.getByTestId('notes-fold-all').click()
    const r1 = n.getByTestId('note-round').first()
    await expect(r1.locator('.tt')).toHaveText('第2页 · 旧的一段')
    await expect(r1.locator('.rc')).toHaveText('先看图，再看公式。')
    await r1.locator('.fh').click()
    await expect(r1.locator('.doubt')).toContainText('整块没看懂：第 2 页框的这块')
    await expect(r1.locator('.good')).toContainText('先看图，再看公式。')
    await expect(r1.locator('.pts li')).toHaveText(['要点一：列就是基向量去哪'])
    await expect(r1.locator('.nsf')).toContainText('完整对话 · 1轮')
    await expect(r1.locator('.nsf .wl')).toHaveText('[[第4讲 特征值]]')
    // 看过不改写；只是有框的位置、没有图的那一段补上一张「我框的」图（task-yp8l7，只插一行，别的字不动）；第 4 页那段没记框的位置，不补
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 15_000 }).toBe(FILLED)
  } finally {
    await run.close({ keep: true })
  }
  // 以前问那一段时的对话记录（同一处）：对话记录里有那一处、那一问
  const dir = join(userData, 'reading')
  const f = readdirSync(dir).find((x) => x.endsWith('.json') && !x.endsWith('.sessions.json'))!
  const st = JSON.parse(readFileSync(join(dir, f), 'utf8')) as ReadingState
  const t0 = Date.now() - 3600_000
  st.threads = [{ id: '.canvas-notes/对话/第3讲-p2-1.md', page: 2, rect: [0.1, 0.2, 0.5, 0.2], createdAt: t0 }]
  st.msgs = [
    { id: 1, role: 'user', thread: st.threads[0]!.id, text: '给我讲解一下', time: t0, page: 2 },
    { id: 2, role: 'ai', thread: st.threads[0]!.id, text: '以前的回答：先看图，再看公式。', time: t0 + 1000, page: 2 },
  ]
  writeFileSync(join(dir, f), JSON.stringify(st))
  const re = await relaunch(vault, userData)
  const app = re.app
  try {
    const page = re.page
    if (!(await tabOn(page).textContent())?.includes('第3讲.pdf')) await openPdf(page)
    if (!(await ai(page).isVisible())) await page.keyboard.press('Meta+j')
    await expect(ai(page).getByTestId('reading-msg')).toHaveCount(1)
    // 同一处接着问
    const ta = ai(page).getByRole('textbox', { name: '问 AI' })
    await ta.fill('那第二条呢？')
    await ta.press('Enter')
    await expect(ai(page).getByTestId('reading-msg').last().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    const md = readFileSync(join(vault, NOTE), 'utf8')
    // 2026-11-24 起旧的那一段不再整段换：一字节不动（打开时补上的图照旧在），同一处接着问的用新写法接在它后面（同一页新起一节）
    const old2 = FILLED.slice(FILLED.indexOf('## 第 2 页'), FILLED.indexOf('## 第 4 页'))
    expect(md).toContain(old2 + '## 第 2 页 · 3.2 Definition\n\n### 那第二条呢？\n\n> [!ai] AI 回答 · ')
    expect(md).toContain('旧的一段')
    expect(md).not.toMatch(/\[!recap\] 测试小结|测试小标题/)
    // 别的段、自己写的字原样
    expect(md).toContain(OLD.slice(OLD.indexOf('## 第 4 页'), OLD.indexOf('## 我自己记的')))
    expect(md.endsWith('## 我自己记的\n\n考试要考。\n')).toBe(true)
  } finally {
    await app.close()
    rmSync(root, { recursive: true, force: true })
  }
})
