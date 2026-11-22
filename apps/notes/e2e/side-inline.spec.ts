// 旁支全局能用、就地展开（task-4edsc，用户选的方向 A，原型 /private/tmp/canvas-notes-branch/proto.html#dir=a）。
// 四处各走一遍：读 PDF、AI 对话、右栏网页框一块问的回答、文档里的 AI 讲解块。每处都是真拖选一句 → 小框「问这句」→
// 那一段下面就地长出一块旁支 → 打字问 → 假回答出来 → 接着问 → 收起只剩小标 → 从小标再打开 → esc；
// 开着时主对话的输入框缩成一行灰字（文档里的不缩，旁支在中间）；一句开两条看小签；记到哪：读 PDF 照旧记进笔记、
// AI 对话跟着那段对话存（重开软件还在）、网页上问的只在对话记录里、文档里写进这篇（`> [!side]`，打开再保存不变）。右栏窄到 340 也放得下。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）。
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { gitStatus, launch, openAi, openNote, pane, rail, tabOn, waitSaved, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'

const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
const sideIn = (scope: Locator) => scope.getByRole('region', { name: '旁支' })
const box = async (l: Locator) => (await l.boundingBox())!
const css = (l: Locator, props: string[]) =>
  l.evaluate((e, ps) => {
    const cs = getComputedStyle(e)
    return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]))
  }, props)

/** 在 scope 里用鼠标从 from 拖到 to（真拖，选区是浏览器自己算的） */
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

/** 小框里先打问题再回车 */
async function askInBox(page: Page, q: string) {
  await expect(askbox(page)).toBeVisible()
  const t = askbox(page).getByRole('textbox', { name: '问这句' })
  if (q) await t.fill(q)
  await t.press('Enter')
  await expect(askbox(page)).toHaveCount(0)
}

/** 旁支开着：就在那句所在的那一段下面（那一块紧挨在含那句的段落后面，在同一条回答里） */
async function rightUnderSentence(s: Locator) {
  return s.evaluate((el) => {
    const host = el.parentElement!
    const prev = host.previousElementSibling
    return !!prev && !!prev.querySelector('.asked.on')
  })
}

/** 开着旁支时主对话的输入框：缩成一行灰字（33.5 高，只有一行字，没有底行和全能模式那行） */
async function expectSlim(panel: Locator, ph: string) {
  const slim = panel.getByTestId('ai-input-slim')
  await expect(slim).toBeVisible()
  await expect(slim).toHaveText(ph)
  expect(Math.round((await box(slim)).height * 2) / 2).toBe(33.5)
  expect((await css(slim.locator('.ph'), ['color', 'white-space']))['white-space']).toBe('nowrap')
  // 主对话那个输入框（这一格的直接子元素）不在了；旁支自己的输入框在那一块里
  await expect(panel.locator(':scope > [data-testid="ai-input"]')).toHaveCount(0)
  await expect(panel.getByTestId('ai-omni')).toHaveCount(0)
}

/** 旁支那一块的样子（照原型 A 量的数）：左边 2px 强调色竖线、左内边距 12；头 28 高；问的话右边的气泡；输入框圆角 10、发送 24 */
async function expectLooks(s: Locator) {
  expect(await css(s, ['border-left-width', 'padding-left', 'padding-top', 'padding-bottom', 'margin-bottom', 'font-size'])).toEqual({
    'border-left-width': '2px',
    'padding-left': '12px',
    'padding-top': '6px',
    'padding-bottom': '8px',
    'margin-bottom': '12px',
    'font-size': '13px',
  })
  expect((await box(s.locator('.sd-head'))).height).toBe(28)
  expect(await css(s.locator('.sd-head b'), ['font-weight'])).toEqual({ 'font-weight': '500' })
  expect(await css(s.locator('.sd-head .s'), ['font-size'])).toEqual({ 'font-size': '12px' })
  for (const b of await s.locator('.sd-head .ib').all()) {
    const r = await box(b)
    expect([r.width, r.height]).toEqual([24, 24])
  }
  const bub = s.locator('.sq span').first()
  expect(await css(bub, ['border-radius', 'padding'])).toEqual({ 'border-radius': '14px', padding: '5px 11px' })
  const inp = s.locator('.aiin')
  expect(await css(inp, ['border-radius', 'padding'])).toEqual({ 'border-radius': '10px', padding: '6px 6px 4px 10px' })
  const send = s.locator('.aiin .send')
  expect([(await box(send)).width, (await box(send)).height]).toEqual([24, 24])
  expect(await css(s.locator('.rec'), ['font-size', 'margin-top'])).toEqual({ 'font-size': '12px', 'margin-top': '6px' })
  // 回答最后一段到「放进主对话」那一行隔 8（段下 6 + 按钮行上 2，原型 .sa p 的下边距），不贴着
  const gap = await s.evaluate((el) => {
    const mds = el.querySelectorAll('.sa .md')
    const last = mds[mds.length - 1]!.lastElementChild!.getBoundingClientRect()
    return el.querySelector('.acts')!.getBoundingClientRect().top - last.bottom
  })
  expect(Math.round(gap)).toBe(8)
}

/** 那句后面的小标：左右各隔 2、图标和数字隔 3（原型 .badge） */
async function expectBadge(b: Locator) {
  expect(await css(b, ['margin-left', 'margin-right', 'column-gap'])).toEqual({ 'margin-left': '2px', 'margin-right': '2px', 'column-gap': '3px' })
}

/** 一整轮：问 → 假回答 → 接着问 → 收起只剩小标 → 小标再打开 → esc；txt 是被问那句所在的回答 */
async function walk(page: Page, o: { scope: Locator; txt: Locator; q1: string; q2: string; first: RegExp; again: RegExp }) {
  const s = sideIn(o.scope)
  await expect(s).toBeVisible()
  expect(await rightUnderSentence(s)).toBe(true)
  await expect(s.locator('.sq')).toHaveText([o.q1])
  await expect(s.getByTestId('side-msg').last()).toContainText(o.first, { timeout: 15_000 })
  // 接着问：输入框在这一块里，光标在它里面
  const sin = s.getByRole('textbox')
  await expect(sin).toHaveAttribute('placeholder', '接着问这条旁支…')
  await sin.fill(o.q2)
  await sin.press('Enter')
  await expect(s.locator('.sq')).toHaveText([o.q1, o.q2])
  await expect(s.getByTestId('side-msg').last()).toContainText(o.again, { timeout: 15_000 })
  // 答完（下面三个小按钮回来了）再收起
  await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
  // 收起（头上 ⌄）：只剩那句后面的小标
  await s.getByRole('button', { name: '收起旁支' }).first().click()
  await expect(s).toHaveCount(0)
  const badge = o.txt.locator('.badge')
  await expect(badge).toHaveText('1')
  await expect(badge).toHaveAttribute('title', '这句有 1 条旁支')
  await expect(badge).not.toHaveClass(/\bcur\b/)
  // 从小标再打开：问过的都在，光标在旁支的输入框里，小标是开着的样子
  await badge.click()
  await expect(s).toBeVisible()
  await expect(s.locator('.sq')).toHaveText([o.q1, o.q2])
  await expect(s.getByRole('textbox')).toBeFocused()
  await expect(badge).toHaveClass(/\bcur\b/)
  // esc：收起
  await page.keyboard.press('Escape')
  await expect(s).toHaveCount(0)
}

/** 一句开两条：小标点开，「+ 这句再开一条」，块头下面一排小签；空着回车问「讲讲这句」；小标的数字是这句有几条 */
async function twoOnOne(page: Page, o: { scope: Locator; txt: Locator; name1: string }) {
  const s = sideIn(o.scope)
  await o.txt.locator('.badge').click()
  await expect(s).toBeVisible()
  await s.getByRole('button', { name: '这句再开一条旁支' }).click()
  await expect(s.locator('.chips .chip')).toHaveText([`1${o.name1}`, '2新旁支'])
  await expect(s.locator('.chips .chip.on')).toHaveText('2新旁支')
  await expect(s.locator('.sd-head .s')).toHaveText('· 2 条，在第 2 条')
  await expect(s.getByRole('textbox')).toHaveAttribute('placeholder', '问这句…（直接 ↵ 就是「讲讲这句」）')
  await expect(s.getByRole('textbox')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(s.locator('.sq')).toHaveText(['讲讲这句'])
  await expect(s.getByTestId('side-msg').last()).toContainText('旁支的回答', { timeout: 15_000 })
  // 小签切回第 1 条
  await s.locator('.chips .chip').first().click()
  await expect(s.locator('.sd-head .s')).toHaveText('· 2 条，在第 1 条')
  await expect(s.locator('.chips .chip.on')).toHaveText(`1${o.name1}`)
  await s.getByRole('button', { name: '收起旁支' }).last().click()
  await expect(s).toHaveCount(0)
  await expect(o.txt.locator('.badge')).toHaveText('2')
  await expect(o.txt.locator('.badge')).toHaveAttribute('title', '这句有 2 条旁支')
}

// ---------------------------------------------------------------- 读 PDF

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲.pdf')
  await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

async function drawBox(page: Page, n: number, a: [number, number], b: [number, number]) {
  const el = page.locator(`.pdfpane:not([hidden]) .pdfpage[data-page="${n}"]`)
  await el.scrollIntoViewIfNeeded()
  const r = await box(el)
  await page.mouse.move(r.x + r.width * a[0], r.y + r.height * a[1])
  await page.mouse.down()
  await page.mouse.move(r.x + r.width * b[0], r.y + r.height * b[1], { steps: 6 })
  await page.mouse.up()
}

test('读 PDF：选一句「问这句」就地展开在那一段下面（不再开下格），主输入框缩成一行；接着问、收起只剩小标、小标再开、esc；一句两条看小签；记进笔记照旧；右栏 340 也放得下', async () => {
  const run = await launch({ [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openPdf(page)
    await page.keyboard.press('Meta+j')
    const ai = reading(page)
    await expect(ai).toBeVisible()
    await drawBox(page, 2, [0.08, 0.2], [0.6, 0.4])
    await expect(ai.getByTestId('reading-att').locator('img')).toBeVisible()
    await ai.getByRole('textbox', { name: '问 AI' }).press('Enter')
    const msg = ai.getByTestId('reading-msg').last()
    await expect(msg.locator('.noted')).toContainText('已记进笔记', { timeout: 20_000 })
    const txt = msg.locator('.txt')

    await selectText(page, txt, '列就是', '去哪')
    await askInBox(page, '为什么是基向量？')
    const s = sideIn(ai)
    await expect(s).toBeVisible()
    // 没有下格、没有中间那条拖的线
    await expect(page.getByRole('complementary', { name: '旁支' })).toHaveCount(0)
    await expect(page.getByRole('separator', { name: '拖着调高低，双击回默认' })).toHaveCount(0)
    // 头：⌄ · comment-discussion ·「旁支」·「· 为什么是基向量」…… + ×
    await expect(s.locator('.sd-head b')).toHaveText('旁支')
    await expect(s.locator('.sd-head .s')).toHaveText('· 为什么是基向量')
    // 被问的那句亮着、小标是开着的样子；「看得到」那行还在（照原型 A）
    // 只选到「去哪」：紧跟着的「。」也算进那一句，小标跟在「。」后面（不把「。」挤到下一行行首）
    await expect(txt.locator('.asked.on')).toHaveText('列就是基向量去哪。')
    await expect(txt.locator('.badge')).toHaveClass(/\bcur\b/)
    await expectBadge(txt.locator('.badge'))
    await expect(ai.getByTestId('reading-sees')).toBeVisible()
    await expectSlim(ai, '跟Claude Code说，在左边框一块就能问')
    await expect(s.getByTestId('side-msg').last()).toContainText('旁支，从 fake-read-claude 分叉', { timeout: 15_000 })
    await expect(s.locator('.acts button')).toHaveText(['放进主对话', '在笔记里看', '拷贝'])
    await expect(s.locator('.rec')).toHaveText('记进《第3讲 笔记》第2页')
    await expectLooks(s)
    // 旁支不往主对话里加东西
    await expect(ai.getByTestId('reading-msg')).toHaveCount(1)
    await expect(ai.locator('.um-wrap')).toHaveCount(1)

    await walk(page, { scope: ai, txt, q1: '为什么是基向量？', q2: '那行呢？', first: /这是旁支的回答/, again: /接着聊/ })
    // 收起后主输入框回到原样
    await expect(ai.locator(':scope > [data-testid="ai-input"]')).toBeVisible()
    await expect(ai.getByTestId('ai-input-slim')).toHaveCount(0)
    await expect(ai.getByTestId('ai-omni')).toBeVisible()

    // 开着时点那一行灰字：收起旁支、光标回主对话的输入框
    await txt.locator('.badge').click()
    await expect(s).toBeVisible()
    await ai.getByTestId('ai-input-slim').click()
    await expect(s).toHaveCount(0)
    await expect(ai.getByRole('textbox', { name: '问 AI' })).toBeFocused()

    await twoOnOne(page, { scope: ai, txt, name1: '为什么是基向量' })

    // 记进笔记：照旧挂在被问那一问的回答后面（第一问带引用句，同一条追问不带）
    await expect
      .poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 20_000 })
      .toMatch(/> \[!side\] 为什么是基向量？\n> > 列就是基向量去哪\n>\n> #### 旁支的回答[\s\S]*> \[!side\] 那行呢？\n>\n> #### 旁支的回答[\s\S]*> \[!side\] 讲讲这句\n> > 列就是基向量去哪/)

    // 在笔记里看：换到笔记标签，落在那条旁支上；⌘J 换回 AI
    await txt.locator('.badge').click()
    await s.locator('.chips .chip').first().click()
    await s.locator('.acts').getByRole('button', { name: '在笔记里看' }).click()
    const notes = page.getByRole('complementary', { name: '笔记', exact: true })
    await expect(notes).toBeVisible()
    await expect(notes.getByTestId('note-round').locator('.nside').first()).toBeInViewport()
    await page.keyboard.press('Meta+j')
    await expect(ai).toBeVisible()

    // 右栏窄到 340：旁支那一块整块放得下，不横着滚
    await widenRight(page, -40)
    expect(Math.round((await box(ai)).width)).toBe(340)
    if (!(await s.isVisible())) await txt.locator('.badge').click()
    await expect(s).toBeVisible()
    const a = await box(ai)
    const b = await box(s)
    expect(b.x + b.width).toBeLessThanOrEqual(a.x + a.width - 12)
    expect(await ai.locator('.msgs').evaluate((e) => e.scrollWidth - e.clientWidth)).toBeLessThanOrEqual(0)
    for (const btn of await s.locator('.sd-head .ib').all()) expect((await box(btn)).x + 24).toBeLessThanOrEqual(a.x + a.width)
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- AI 对话

const WEEK = '周记/2026-W47.md'
const WEEK_TEXT = '# 2026-W47\n\n周一：第5讲的作业开了个头。\n\n周三：早上开始跑步，5 公里。\n'

test('AI 对话：回答里选一句也能「问这句」，就地展开、主输入框缩成一行；旁支跟着这段对话存（不写进笔记），重开软件还在', async () => {
  const run = await launch({ [WEEK]: WEEK_TEXT }, { CN_AI_FAKE: '1' })
  const { page, vault, userData } = run
  const root = dirname(vault)
  try {
    await openNote(page, '2026-W47')
    await openAi(page)
    const ai = chat(page)
    const ta = ai.getByRole('textbox', { name: '问 AI' })
    await ta.fill('把这周的周记总结成三句话')
    await ta.press('Enter')
    const msg = ai.getByTestId('ai-msg').last()
    await expect(msg.locator('.txt')).toContainText('周三开始每天早上跑步', { timeout: 15_000 })
    await expect(ai.getByRole('button', { name: '发送' })).toBeVisible()
    const txt = msg.locator('.txt')

    // 选一句：同一个小框（不再是「引用 · 拷贝」那条黑胶囊）
    await selectText(page, txt, '周三开始', '下来了。')
    await expect(page.getByRole('toolbar', { name: '选中的这段' })).toHaveCount(0)
    await expect(askbox(page).locator('.it')).toHaveText(['引用进输入框⇧⌘L', '问这句↵'])
    await askInBox(page, '三次都是几点跑的？')
    const s = sideIn(ai)
    await expect(s).toBeVisible()
    await expect(txt.locator('.asked.on')).toHaveText('周三开始每天早上跑步，三次都坚持下来了。')
    await expectSlim(ai, '跟Claude Code说，/ 选命令，@ 引用笔记')
    await expect(s.getByTestId('side-msg').last()).toContainText('旁支，从 fake-claude 分叉', { timeout: 15_000 })
    await expect(s.locator('.acts button')).toHaveText(['放进主对话', '拷贝'])
    await expect(s.locator('.rec')).toHaveText('跟着这段对话存，不写进笔记')
    await expectLooks(s)
    // 主对话里不多出东西
    await expect(ai.locator('.um')).toHaveCount(1)
    await expect(ai.getByTestId('ai-msg')).toHaveCount(1)

    await walk(page, { scope: ai, txt, q1: '三次都是几点跑的？', q2: '下周还能坚持吗？', first: /这是旁支的回答/, again: /接着聊/ })
    await twoOnOne(page, { scope: ai, txt, name1: '三次都是几点跑的' })

    // 放进主对话：这条回答成为主输入框那一排的一块引用（不自动发），底栏说一句；旁支照旧开着，收起后看得到那一块
    await txt.locator('.badge').click()
    await s.locator('.acts').getByRole('button', { name: '放进主对话' }).click()
    await expect(page.getByTestId('toast')).toContainText('放进了主对话的输入框，没发')
    await expect(s).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(s).toHaveCount(0)
    await expect(ai.getByTestId('ai-mat')).toHaveCount(1)
    // 小标打开的是这一句最后开的那条（讲讲这句，名字是那一句的头 8 个字）
    await expect(ai.getByTestId('ai-mat')).toHaveAttribute('data-src', '旁支 · 周三开始每天早上…')
    await expect(ta).toHaveValue('①')
    await expect(ai.getByTestId('ai-msg')).toHaveCount(1)
    // 不写进笔记、库里没有改动
    expect(readFileSync(join(vault, WEEK), 'utf8')).toBe(WEEK_TEXT)
    await page.waitForTimeout(600)
    await run.close({ keep: true })

    // 重开软件：这段对话里小标还在，点开问过的都在
    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash') },
    })
    try {
      const p2 = await app.firstWindow()
      await expect(p2.locator('.vault b')).toHaveText('测试库')
      if ((await tabOn(p2).textContent()) !== '2026-W47') await openNote(p2, '2026-W47')
      await openAi(p2)
      const t2 = chat(p2).getByTestId('ai-msg').last().locator('.txt')
      await expect(t2.locator('.badge')).toHaveText('2', { timeout: 15_000 })
      await t2.locator('.badge').click()
      const s2 = sideIn(chat(p2))
      await expect(s2.locator('.chips .chip')).toHaveText(['1三次都是几点跑的', '2周三开始每天早上…'])
      await s2.locator('.chips .chip').first().click()
      await expect(s2.locator('.sq')).toHaveText(['三次都是几点跑的？', '下周还能坚持吗？'])
      await expect(s2.getByTestId('side-msg').last()).toContainText('接着聊')
    } finally {
      await app.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------- 右栏网页框一块问的回答

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end(
      '<!doctype html><html lang="en"><head><title>Rotation matrix</title></head><body style="font:18px/1.6 Georgia,serif;padding:24px;max-width:640px;background:#fff;color:#1b1b1b"><h1>Rotation matrix</h1><p id="p1">In linear algebra, a rotation matrix is a transformation matrix that is used to perform a rotation in Euclidean space.</p></body></html>',
    )
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => {
  server.close()
})

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const guest = (page: Page, code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)

// task-6cxtc 起网页上问的不进收件箱，一问一块 [!ai] 写进这个网页正在剪进去的那篇：这里 plain.md 和这个网站配好对（属性 read-along），
// 回答记进它（《plain》）；在右栏 AI 回答里开的旁支照旧跟着这段对话存，那篇不多出东西
test('右栏网页框一块问的回答里也能开旁支：就地展开、接着问、收起再开；只记在对话记录里（记进的那篇不多出一段、不带旁支）', async () => {
  const run = await launch({ 'plain.md': `---\nread-along: ${base}/\n---\n# 随手\n` }, { CN_AI_FAKE: '1', CN_FAKE_NOTE_MS: '50' })
  const { page, vault } = run
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
    await expect(ai).toBeVisible()
    await ai.getByRole('textbox').press('Enter')
    const msg = ai.getByTestId('reading-msg').last()
    await expect(ai.getByText('已记进《plain》')).toBeVisible({ timeout: 15_000 })
    const inbox = () => readFileSync(join(vault, 'plain.md'), 'utf8')
    await expect.poll(inbox).toContain('> [!ai] 讲解一下')
    const before = inbox()
    const txt = msg.locator('.txt')

    await selectText(page, txt, '列就是', '去哪')
    await askInBox(page, '为什么是基向量？')
    const s = sideIn(ai)
    await expect(s).toBeVisible()
    // 记到哪那一行（task-6cxtc）：右栏 AI 里开的跟着这段对话存，在那篇的讲解块上开的才写进那篇
    await expect(s.locator('.rec')).toHaveText('跟着这段对话存；在那篇的讲解块上开的旁支写进那篇')
    await expect(s.locator('.acts button')).toHaveText(['放进主对话', '拷贝'], { timeout: 15_000 })
    await expectSlim(ai, '跟Claude Code说，在网页上按住 ⌘ 框一块就能问')
    await walk(page, { scope: ai, txt, q1: '为什么是基向量？', q2: '那行呢？', first: /这是旁支的回答/, again: /接着聊/ })
    // 只在对话记录里：记进的那篇一个字没变（不多插一段、不带旁支），库里没有没提交的（读到哪.json 是配好对的网页记读到哪的，不算）
    await page.waitForTimeout(1500)
    expect(inbox()).toBe(before)
    expect(inbox()).not.toContain('[!side]')
    expect(gitStatus(vault).split('\n').filter((l) => l.trim() && !l.includes('读到哪.json'))).toEqual([])
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 文档里的 AI 讲解块

const DOC = '课程/ecp/第5讲 注意力机制.md'
const DOC_TEXT = [
  '# 第5讲 注意力机制',
  '',
  '这一讲从「一句话里每个词该看谁」讲起，引出 Q、K、V 三样东西。',
  '',
  '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧',
  '> 这一帧在讲缩放点积注意力：先拿 Q 和每个 K 做点积，得到「该看谁」的分数。分数要先除以 √d，再过 softmax 变成权重。',
  '>',
  '> 最后用这些权重把 V 加起来，就是这个位置的输出。维度 d 越大，不缩放时点积越大，softmax 会几乎只剩一个 1，梯度就没了。',
  '',
  '我的理解：缩放是为了让分数别太极端，不然 softmax 只会盯着一个词。',
  '',
].join('\n')

test('文档里的 AI 讲解：选讲解里的一句「问这句」，旁支就地长在那一段下面；问答写进这篇（`> [!side]` 挂在讲解下面），文档里只露那句后面的小标；打开再保存不变', async () => {
  const run = await launch({ [DOC]: DOC_TEXT }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '第5讲 注意力机制')
    const doc = pane(page)
    const content = doc.locator('.cm-content')
    // 自己写的字：选了不出「问这句」（不算旁支）
    await selectText(page, content, '这一讲从', '三样东西。')
    await page.waitForTimeout(300)
    await expect(askbox(page)).toHaveCount(0)
    await page.keyboard.press('ArrowRight')

    await selectText(page, content, '最后用这些', '的输出。')
    await askInBox(page, 'V 在这里是什么？')
    const s = sideIn(doc)
    await expect(s).toBeVisible()
    // 长在那一段下面（编辑器里那一段的最后一行后面），不在右栏
    expect(await s.evaluate((el) => {
      const host = el.closest('.cm-side-host')!
      const prev = host.previousElementSibling as HTMLElement | null
      return !!prev && prev.textContent!.includes('梯度就没了')
    })).toBe(true)
    await expect(content.locator('.asked.on')).toHaveText('最后用这些权重把 V 加起来，就是这个位置的输出。')
    await expect(s.getByTestId('side-msg').last()).toContainText('旁支的回答', { timeout: 15_000 })
    await expect(s.locator('.rec')).toHaveText('写在这篇文档里，挂在这段讲解下面')
    await expect(s.locator('.acts button')).toHaveText(['放进主对话', '拷贝'])
    await expectLooks(s)
    // 右栏 AI 的输入框不缩（旁支在中间）
    if (await chat(page).isVisible()) await expect(chat(page).getByTestId('ai-input-slim')).toHaveCount(0)
    // 写进文件：挂在讲解下面，第一问带那一句
    await waitSaved(page)
    await expect
      .poll(() => readFileSync(join(vault, DOC), 'utf8'), { timeout: 15_000 })
      .toContain('梯度就没了。\n\n> [!side] V 在这里是什么？\n> > 最后用这些权重把 V 加起来，就是这个位置的输出。\n>\n> #### 旁支的回答')
    // 文档里看不到那几行 md（只露小标）
    await expect(content).not.toContainText('[!side]')

    await walk(page, { scope: doc, txt: content, q1: 'V 在这里是什么？', q2: '为什么偏偏除以根号 d？', first: /旁支的回答/, again: /接着聊/ })
    await expect.poll(() => readFileSync(join(vault, DOC), 'utf8'), { timeout: 15_000 }).toContain('> [!side] 为什么偏偏除以根号 d？\n>\n> #### 旁支的回答')
    await waitSaved(page)
    const md = readFileSync(join(vault, DOC), 'utf8')
    expect(md.startsWith(DOC_TEXT.replace(/\n$/, '').split('\n\n我的理解')[0]!)).toBe(true)
    expect(md).toContain('\n\n我的理解：缩放是为了让分数别太极端，不然 softmax 只会盯着一个词。\n')
    await twoOnOne(page, { scope: doc, txt: content, name1: 'V 在这里是什么' })
    await expect.poll(() => readFileSync(join(vault, DOC), 'utf8'), { timeout: 15_000 }).toContain('> [!side] 讲讲这句\n> > 最后用这些权重把 V 加起来，就是这个位置的输出。')
    await waitSaved(page)
    // 打开再保存不变：关掉标签再打开、⌘S，字节不变
    const saved = readFileSync(join(vault, DOC))
    await page.locator('.tab.on .x').click()
    await openNote(page, '第5讲 注意力机制')
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(1000)
    expect(readFileSync(join(vault, DOC)).equals(saved)).toBe(true)
    await expect(pane(page).locator('.cm-content .badge')).toHaveText('2')

    // ⋯ 改名（同读 PDF 的旁支：名字记在这台 Mac 上，文件一个字不变）；小签、菜单跟着换，关掉这篇再打开还在
    await pane(page).locator('.cm-content .badge').click()
    const s2 = sideIn(pane(page))
    await expect(s2.locator('.chips .chip')).toHaveText(['1V 在这里是什么', '2最后用这些权重把…'])
    await s2.locator('.chips .chip').first().click()
    await s2.getByRole('button', { name: '旁支菜单' }).click()
    const menu = page.getByRole('menu', { name: '旁支' })
    await expect(menu.locator('.mh')).toHaveText('这篇文档的旁支')
    await menu.getByRole('menuitem', { name: '改名…' }).click()
    const rn = s2.getByRole('textbox', { name: '旁支的名字' })
    await expect(rn).toHaveValue('V 在这里是什么')
    await rn.fill('V 是什么')
    await rn.press('Enter')
    // 一句两条：头上写「2 条，在第 1 条」，名字在小签上
    await expect(s2.locator('.sd-head .s')).toHaveText('· 2 条，在第 1 条')
    await expect(s2.locator('.chips .chip')).toHaveText(['1V 是什么', '2最后用这些权重把…'])
    await page.waitForTimeout(600)
    expect(readFileSync(join(vault, DOC)).equals(saved)).toBe(true)
    await page.locator('.tab.on .x').click()
    await openNote(page, '第5讲 注意力机制')
    await pane(page).locator('.cm-content .badge').click()
    await expect(sideIn(pane(page)).locator('.chips .chip')).toHaveText(['1V 是什么', '2最后用这些权重把…'])
    await sideIn(pane(page)).getByRole('button', { name: '旁支菜单' }).click()
    await expect(menu.getByRole('menuitemradio')).toHaveText([/^V 是什么/, /^最后用这些权重把…/])
  } finally {
    await run.close()
  }
})

test('文档里旁支长在讲解中间那一段下面：上下都不露页面底色（离上一段 8、下边 12 都在提示块的底色里）；只选到「分数」时小标跟在「。」后面', async () => {
  const run = await launch({ [DOC]: DOC_TEXT }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, '第5讲 注意力机制')
    const content = pane(page).locator('.cm-content')
    await selectText(page, content, '先拿 Q', '的分数')
    await askInBox(page, '分数是什么？')
    const s = sideIn(pane(page))
    await expect(s.locator('.acts')).toBeVisible({ timeout: 15_000 })
    await expect(content.locator('.asked.on')).toHaveText('先拿 Q 和每个 K 做点积，得到「该看谁」的分数。')
    await expectBadge(content.locator('.badge'))
    const g = await s.evaluate((el) => {
      const host = el.closest('.cm-side-host')!
      const prev = host.previousElementSibling!.getBoundingClientRect()
      const next = host.nextElementSibling!.getBoundingClientRect()
      const h = host.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      return {
        last: host.classList.contains('last'),
        prevHasSentence: !!host.previousElementSibling!.querySelector('.asked.on'),
        hostTop: Math.round(h.top - prev.bottom),
        sideTop: Math.round(b.top - h.top),
        sideBottom: Math.round(h.bottom - b.bottom),
        hostBottom: Math.round(next.top - h.bottom),
        bg: getComputedStyle(host).backgroundColor === getComputedStyle(host.previousElementSibling!).backgroundColor,
      }
    })
    expect(g).toEqual({ last: false, prevHasSentence: true, hostTop: 0, sideTop: 8, sideBottom: 12, hostBottom: 0, bg: true })
  } finally {
    await run.close()
  }
})

test('文档里问着旁支就关掉这篇：回答照样写进文件；讲解里同一句先后开两条、后开的先答完，两条各写各的、不串', async () => {
  const run = await launch({ [DOC]: DOC_TEXT }, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '60' })
  const { page, vault } = run
  try {
    await openNote(page, '第5讲 注意力机制')
    const content = pane(page).locator('.cm-content')
    await selectText(page, content, '最后用这些', '的输出。')
    await askInBox(page, '答得慢的这一问')
    const s = sideIn(pane(page))
    await expect(s.locator('.sq')).toHaveText(['答得慢的这一问'])
    // 还在答就关掉这篇
    await page.locator('.tab.on .x').click()
    await expect.poll(() => readFileSync(join(vault, DOC), 'utf8'), { timeout: 20_000 }).toContain('> [!side] 答得慢的这一问\n> > 最后用这些权重把 V 加起来，就是这个位置的输出。\n>\n> #### 旁支的回答')
    expect(readFileSync(join(vault, DOC), 'utf8')).toContain('\n\n我的理解：缩放是为了让分数别太极端')

    // 再打开：同一句「+」再开一条（新的那条先问完），之前那条接着问；两条各写各的
    await openNote(page, '第5讲 注意力机制')
    await expect(content.locator('.badge')).toHaveText('1')
    await content.locator('.badge').click()
    await expect(s.locator('.sq')).toHaveText(['答得慢的这一问'])
    await s.getByRole('textbox').fill('接着问第一条')
    await s.getByRole('textbox').press('Enter')
    await s.getByRole('button', { name: '这句再开一条旁支' }).click()
    await s.getByRole('textbox').fill('第二条的第一问')
    await s.getByRole('textbox').press('Enter')
    await expect
      .poll(() => readFileSync(join(vault, DOC), 'utf8'), { timeout: 30_000 })
      .toMatch(/> \[!side\] 答得慢的这一问\n> > 最后用这些[^\n]*\n>\n[\s\S]*?\n\n> \[!side\] 接着问第一条\n>\n[\s\S]*?\n\n> \[!side\] 第二条的第一问\n> > 最后用这些/)
  } finally {
    await run.close()
  }
})
