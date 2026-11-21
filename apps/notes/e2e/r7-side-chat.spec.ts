// 第 3 段：读 PDF 的旁支（CN-90 方向 A「照 Dispatch 旁支」，小样 A-AI与读PDF/v2/proto-a.html 的 A1 七条）。
// 在 AI 的回答里选中一句 → 选区下方的小框（先能打问题；「引用进输入框 ⇧⌘L」「问这句 ↵」）→ 旁支开在右栏 AI 那一格的下格，
// 问过的那句划虚线加小标；格头 ⋯ 改名、删掉、切回别的旁支，点格头收成 29 高的一条（在答 / 1 条新回答）；
// 拖两格之间的线调高低、双击回 55%；引用片指着亮、点了回去；放进主对话、在笔记里看、拷贝；esc 关掉；重开软件旁支还在。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）。
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { launch, noteBeside, rail, tabOn, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const NOTE = '课程/线代/第3讲 笔记.md'
const files = { [PDF]: LECTURE }

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const side = (page: Page) => page.getByRole('complementary', { name: '旁支' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
const sash = (page: Page) => page.getByRole('separator', { name: '拖着调高低，双击回默认' })
const sideBox = (page: Page) => side(page).getByRole('textbox', { name: '问 AI' })
const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pdfPane(page).locator(`.pdfpage[data-page="${n}"]`)
const box = async (l: Locator) => (await l.boundingBox())!
const css = (l: Locator, props: string[]) =>
  l.evaluate((e, ps) => {
    const cs = getComputedStyle(e)
    return Object.fromEntries(ps.map((p) => [p, cs.getPropertyValue(p)]))
  }, props)

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
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

/** 在 scope 里用鼠标从 from 拖到 to（真拖，选区是浏览器自己算的）；返回选区的框 */
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
      // 上格可能很矮（开着旁支时只剩四成多）：先把那句滚进来，看得见才选得中
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
  return page.evaluate(() => {
    const r = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
    return { left: r.left, right: r.right, bottom: r.bottom }
  })
}

/** 框第 2 页一块问「给我讲解一下」，等它答完、记进笔记 */
async function askFirst(page: Page) {
  await openPdf(page)
  await page.keyboard.press('Meta+j')
  await expect(ai(page)).toBeVisible()
  await drawBox(page, 2, [0.08, 0.2], [0.6, 0.4])
  await expect(ai(page).getByTestId('reading-att').locator('img')).toBeVisible()
  await ai(page).getByRole('textbox', { name: '问 AI' }).press('Enter')
  const msg = ai(page).getByTestId('reading-msg').last()
  await expect(msg.locator('.noted')).toContainText('已记进笔记', { timeout: 20_000 })
  return msg
}

/** 下格是不是默认的高：55%，但让给上格最矮 420、自己最矮 201（side.css 的 --pane） */
const atDefault = (s: { side: number; room: number }) => Math.abs(s.side - Math.max(Math.min(s.room - 420, Math.max(201, s.room * 0.55)), Math.min(201, s.room - 32))) <= 1

/** 下格开着：上格（AI 或笔记）和下格的高、这一格一共多高 */
async function split(page: Page, top: Locator = ai(page)) {
  const a = await box(top)
  const s = await box(side(page))
  return { top: a.height, side: s.height, room: a.height + s.height, gap: s.y - (a.y + a.height) }
}

test('A1 第 1、2、5、7 条：选一句出小框（照小样）、空着回车下格打开光标在旁支、打字回车有回答（从主对话分叉，不往主对话里加东西）、虚线和小标；答完三个小按钮；esc 关掉，没问过的空旁支不留', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const msg = await askFirst(page)
    const txt = msg.locator('.txt')
    // 1. 回答里选中一句：选区下方 8 的小框，300 宽；上面一格能先打问题，下面两行
    const sel = await selectText(page, txt, '列就是', '去哪')
    const ab = askbox(page)
    await expect(ab).toBeVisible()
    const b = await box(ab)
    expect(b.width).toBe(300)
    expect(Math.abs(b.y - (sel.bottom + 8))).toBeLessThanOrEqual(1)
    expect(Math.abs(b.x + 150 - (sel.left + sel.right) / 2)).toBeLessThanOrEqual(1.5)
    const ta = ab.getByRole('textbox', { name: '问这句' })
    await expect(ta).toHaveAttribute('placeholder', '问这句…（空着 ↵ 就是打开旁支自己打）')
    expect((await box(ta)).height).toBe(32)
    await expect(ab.locator('.it')).toHaveText(['引用进输入框⇧⌘L', '问这句↵'])
    expect(await css(ab, ['border-radius', 'padding'])).toEqual({ 'border-radius': '12px', padding: '6px' })
    expect((await box(ab.locator('.it').first())).height).toBe(30)
    // esc：小框收起、选区取消
    await page.keyboard.press('Escape')
    await expect(ab).toHaveCount(0)
    expect(await page.evaluate(() => window.getSelection()!.isCollapsed)).toBe(true)

    // 再选一次，空着回车：旁支在下格打开，光标在旁支的输入框里
    await selectText(page, txt, '列就是', '去哪')
    await expect(ab).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(ab).toHaveCount(0)
    await expect(side(page)).toBeVisible()
    await expect(sideBox(page)).toBeFocused()
    await expect(sideBox(page)).toHaveAttribute('placeholder', '问这句…（直接 ↵ 就是「讲讲这句」）')
    // 格头：28 高、左 20；「旁支」500 +「· 新旁支 · 来自第 2 页」12 --t3
    const head = side(page).locator('.sh')
    await expect(head.locator('b')).toHaveText('旁支')
    await expect(head.locator('.s')).toHaveText('· 新旁支 · 来自第 2 页')
    expect((await box(head)).height).toBe(28)
    expect(await css(head, ['padding-left'])).toEqual({ 'padding-left': '20px' })
    expect(await css(head.locator('b'), ['font-weight'])).toEqual({ 'font-weight': '500' })
    expect(await css(head.locator('.s'), ['font-size'])).toEqual({ 'font-size': '12px' })
    // 旁支开着：上格的「看得到」那行藏起来；默认下格占 AI 那一格的 55%，紧贴上格
    await expect(ai(page).getByTestId('reading-sees')).toHaveCount(0)
    await expect.poll(async () => atDefault(await split(page))).toBe(true)
    expect(Math.abs((await split(page)).gap)).toBeLessThanOrEqual(1)
    // 两格之间的线就在边界上（6 高，中间 1px）
    const s1 = await box(sash(page))
    expect(s1.height).toBe(6)
    expect(Math.abs(s1.y + 3 - (await box(side(page))).y)).toBeLessThanOrEqual(1)
    // 2. 问过的那句：--acc 虚线（偏移 4、粗 1.5），后面一个带数字的小标（17 高、圆角 5、11px 500），开着的这条强调色底白字
    const asked = txt.locator('.asked')
    await expect(asked).toHaveText('列就是基向量去哪')
    // 点线是底边上重复的 --acc 点（1.5 粗、4 一个点），整句一个 span（一句里有公式时公式下面也连着）
    await expect(asked).toHaveCount(1)
    expect(await css(asked, ['background-size', 'background-repeat', 'padding-bottom'])).toEqual({ 'background-size': '4px 1.5px', 'background-repeat': 'repeat-x', 'padding-bottom': '2px' })
    expect((await css(asked, ['background-image']))['background-image']).toMatch(/^radial-gradient\(circle/)
    const badge = txt.locator('.badge')
    await expect(badge).toHaveText('1')
    await expect(badge).toHaveClass(/\bcur\b/)
    expect((await box(badge)).height).toBe(17)
    expect(await css(badge, ['border-radius', 'font-size', 'font-weight', 'color'])).toEqual({ 'border-radius': '5px', 'font-size': '11px', 'font-weight': '500', color: 'rgb(255, 255, 255)' })
    // 3. 最上面是引用片：48 高、圆角 6；那句话 + 「主对话 · 第 2 页 · 这一轮的标题」
    const chip = side(page).getByTestId('side-quote')
    expect((await box(chip)).height).toBe(48)
    await expect(chip.locator('.l1')).toHaveText('列就是基向量去哪')
    await expect(chip.locator('.l2')).toHaveText('主对话 · 第 2 页 · 测试小标题 p2')

    // 打字回车：直接问；回答从主对话的会话分叉，主对话里不多出东西
    await sideBox(page).fill('为什么是基向量？')
    await sideBox(page).press('Enter')
    const ans = side(page).getByTestId('side-msg').last()
    await expect(ans.locator('.txt')).toContainText('这是旁支的回答', { timeout: 15_000 })
    await expect(ans.locator('.txt')).toContainText('旁支，从 fake-read-claude 分叉')
    await expect(ans.locator('.txt')).toContainText('讲「列就是基向量去哪」，问的是「为什么是基向量？」')
    await expect(side(page).locator('.um')).toHaveText(['为什么是基向量？'])
    await expect(ai(page).getByTestId('reading-msg')).toHaveCount(1)
    await expect(ai(page).locator('.um-wrap')).toHaveCount(1)
    // 5. 答完：输入框上面三个小按钮（24 高、圆角 4、12px），占位换成「接着问这条旁支…」，名字是问的那句
    const acts = side(page).locator('.sacts button')
    await expect(acts).toHaveText(['放进主对话', '在笔记里看', '拷贝'])
    expect((await box(acts.first())).height).toBe(24)
    expect(await css(acts.first(), ['border-radius', 'font-size'])).toEqual({ 'border-radius': '4px', 'font-size': '12px' })
    await expect(sideBox(page)).toHaveAttribute('placeholder', '接着问这条旁支…')
    // 名字是第一问的原话，末尾的问号不要（格头里全角问号再加「 · 」空得太宽）
    await expect(head.locator('.s')).toHaveText('· 为什么是基向量 · 来自第 2 页')
    // 问过以后：空着回车不发、发送键灰着；打了字接着问
    const sendBtn = side(page).getByRole('button', { name: '发送' })
    await expect(sendBtn).toBeDisabled()
    await sideBox(page).press('Enter')
    await page.waitForTimeout(300)
    await expect(side(page).locator('.um')).toHaveText(['为什么是基向量？'])
    await sideBox(page).fill('再讲讲')
    await expect(sendBtn).toBeEnabled()
    await sideBox(page).press('Enter')
    await expect(side(page).locator('.um')).toHaveText(['为什么是基向量？', '再讲讲'])
    await expect(side(page).getByTestId('side-msg')).toHaveCount(2)
    await expect(side(page).getByTestId('side-msg').last().locator('.txt')).toContainText('接着聊', { timeout: 15_000 })
    // 拷贝（主进程的剪贴板换成记录器，不碰这台 Mac 真的剪贴板）：变「已拷贝」
    await run.app.evaluate(({ clipboard }) => {
      ;(globalThis as { copied?: string }).copied = ''
      clipboard.writeText = async (t: string) => void ((globalThis as { copied?: string }).copied = t)
    })
    await acts.last().click()
    await expect(acts.last()).toHaveText('已拷贝')
    expect(await run.app.evaluate(() => (globalThis as { copied?: string }).copied)).toContain('这是旁支的回答')

    // 7. 焦点在旁支里按 esc：关掉旁支（问过的旁支留着，小标还在、不再是强调色底）
    await sideBox(page).click()
    await page.keyboard.press('Escape')
    await expect(side(page)).toHaveCount(0)
    await expect(sash(page)).toHaveCount(0)
    await expect(txt.locator('.badge')).toHaveText('1')
    await expect(txt.locator('.badge')).not.toHaveClass(/\bcur\b/)
    await expect(ai(page).getByTestId('reading-sees')).toBeVisible()
    // 没问过的空旁支关掉就不留：另选一句、空着开，再 esc
    await selectText(page, txt, '这是讲解', '新会话')
    await expect(askbox(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(side(page)).toBeVisible()
    // 小标按字里的先后排：新的这句在前面，数字是开的先后
    await expect(txt.locator('.badge')).toHaveText(['2', '1'])
    await page.keyboard.press('Escape')
    await expect(side(page)).toHaveCount(0)
    await expect(txt.locator('.badge')).toHaveText(['1'])
    await expect(txt.locator('.asked')).toHaveText(['列就是基向量去哪'])
  } finally {
    await run.close()
  }
})

test('A1 第 4、7 条：点格头收成 29 高的一条（答着写「在答」、答完写「1 条新回答」）；拖线调高低、最矮 201、上格最矮 420、双击回 55%', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '45' })
  const { page } = run
  try {
    const msg = await askFirst(page)
    await selectText(page, msg.locator('.txt'), '列就是', '去哪')
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('为什么是基向量？')
    // 小框里先打了问题再回车：直接问
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(side(page).locator('.um')).toHaveText(['为什么是基向量？'])
    const head = side(page).locator('.sh')
    // 答着的时候点格头：收成 29 高的一条，写「· 在答」（扫光的灰字），「看得到」回来
    await head.locator('b').click()
    await expect(head.locator('.s')).toHaveText('· 在答')
    await expect(head.locator('.s')).toHaveClass(/\bshimmer\b/)
    await expect.poll(async () => (await box(side(page))).height).toBe(29)
    await expect(ai(page).getByTestId('reading-sees')).toBeVisible()
    // 收着答完：「· 1 条新回答」（--t1 500）
    await expect(head.locator('.s')).toHaveText('· 1 条新回答', { timeout: 15_000 })
    expect(await css(head.locator('.s'), ['font-weight'])).toEqual({ 'font-weight': '500' })
    // chevron 转 -90°
    expect((await css(head.locator('.cv'), ['transform'])).transform).toMatch(/^matrix\(/)
    // 点格头展开：看过了，又是名字和第几页
    await head.locator('b').click()
    await expect(head.locator('.s')).toHaveText('· 为什么是基向量 · 来自第 2 页')
    await expect.poll(async () => atDefault(await split(page))).toBe(true)
    // 收着、没有新回答：「· 名字」
    await head.locator('b').click()
    await expect(head.locator('.s')).toHaveText('· 为什么是基向量')
    // 收成一条时 ⋯ 和 × 不露着（焦点停在格头上也不露），指着格头才出来
    await page.mouse.move(10, 10)
    await expect.poll(async () => (await css(head.locator('.ib').first(), ['opacity'])).opacity).toBe('0')
    await head.hover()
    await expect.poll(async () => (await css(head.locator('.ib').first(), ['opacity'])).opacity).toBe('1')
    await head.locator('b').click()
    // 展开的动画（0.2 秒）走完再拖
    await expect.poll(async () => atDefault(await split(page))).toBe(true)

    // 拖线调高低：往下拖 60，下格矮 60（默认时上格已经是最矮的 420，往上拖不动）
    const s0 = (await split(page)).side
    const grab = async () => {
      const r = await box(sash(page))
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    }
    let g = await grab()
    await page.mouse.move(g.x, g.y)
    await page.mouse.down()
    await page.mouse.move(g.x, g.y + 60, { steps: 6 })
    // 拖着的时候线是 3px 强调色
    await expect(sash(page)).toHaveClass(/\bon\b/)
    await page.mouse.up()
    await expect.poll(async () => Math.round(s0 - (await split(page)).side)).toBe(60)
    // 往下拖到底：下格最矮 201（带上面那条线）
    g = await grab()
    await page.mouse.move(g.x, g.y)
    await page.mouse.down()
    await page.mouse.move(g.x, g.y + 2000, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await split(page)).side)).toBe(201)
    // 往上拖到顶：上格最矮 420（读得下回答）
    g = await grab()
    await page.mouse.move(g.x, g.y)
    await page.mouse.down()
    await page.mouse.move(g.x, 0, { steps: 6 })
    await page.mouse.up()
    await expect.poll(async () => Math.round((await split(page)).top)).toBe(420)
    // 双击线：回默认 55%
    g = await grab()
    await page.mouse.dblclick(g.x, g.y)
    await expect.poll(async () => atDefault(await split(page))).toBe(true)
  } finally {
    await run.close()
  }
})

test('A1 第 2、3、4、5 条：⋯ 菜单（300 宽、往下弹、右对齐）改名真能改、两条旁支切来切去、删掉；点小标切换（再点关掉）；引用片指着亮、点了亮 1.4 秒；放进主对话进了输入框那一排', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const msg = await askFirst(page)
    const txt = msg.locator('.txt')
    // 第一条旁支
    await selectText(page, txt, '列就是', '去哪')
    await expect(askbox(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await sideBox(page).fill('为什么是基向量？')
    await sideBox(page).press('Enter')
    await expect(side(page).locator('.sacts')).toBeVisible({ timeout: 15_000 })
    // ⋯：指着格头才出来；菜单 300 宽，右边和按钮对齐，在按钮下面 6
    const head = side(page).locator('.sh')
    const more = head.getByRole('button', { name: '旁支菜单' })
    await head.hover()
    await more.click()
    const menu = page.getByRole('menu', { name: '旁支' })
    await expect(menu).toBeVisible()
    const mb = await box(menu)
    const bb = await box(more)
    expect(mb.width).toBe(300)
    expect(Math.abs(mb.x + mb.width - (bb.x + bb.width))).toBeLessThanOrEqual(1)
    expect(Math.abs(mb.y - (bb.y + bb.height + 6))).toBeLessThanOrEqual(1)
    await expect(menu.getByRole('menuitem')).toHaveText(['改名…', '删掉这条旁支'])
    await expect(menu.locator('.mh')).toHaveText('这一份 PDF 的旁支')
    await expect(menu.getByRole('menuitemradio')).toHaveText(['为什么是基向量第 2 页 · 1 问'])
    await expect(menu.getByRole('menuitemradio')).toHaveAttribute('aria-checked', 'true')
    // 改名：名字那一处就地换成一格，回车存下；格头、小标的说明、菜单里都是新名字
    await menu.getByRole('menuitem', { name: '改名…' }).click()
    const rn = head.getByRole('textbox', { name: '旁支的名字' })
    await expect(rn).toBeFocused()
    await expect(rn).toHaveValue('为什么是基向量')
    await rn.fill('列为什么是基向量')
    await rn.press('Enter')
    await expect(head.locator('.s')).toHaveText('· 列为什么是基向量 · 来自第 2 页')
    await expect(txt.locator('.badge')).toHaveAttribute('title', '旁支 · 列为什么是基向量')

    // 第二条旁支：另选一句，在小框里先打问题
    await selectText(page, txt, '这是讲解', '新会话')
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('新会话是什么意思？')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(side(page).locator('.um')).toHaveText(['新会话是什么意思？'])
    await expect(side(page).locator('.sacts')).toBeVisible({ timeout: 15_000 })
    // 小标：两条，开着的是第 2 条
    const badges = txt.locator('.badge')
    await expect(badges).toHaveText(['2', '1'])
    await expect(txt.locator('.badge.cur')).toHaveText('2')
    // ⋯ 里切回第 1 条
    await head.hover()
    await more.click()
    await expect(menu.getByRole('menuitemradio')).toHaveText(['列为什么是基向量第 2 页 · 1 问', '新会话是什么意思第 2 页 · 1 问'])
    await menu.getByRole('menuitemradio', { name: /列为什么是基向量/ }).click()
    await expect(menu).toHaveCount(0)
    await expect(head.locator('.s')).toHaveText('· 列为什么是基向量 · 来自第 2 页')
    await expect(side(page).locator('.um')).toHaveText(['为什么是基向量？'])
    await expect(txt.locator('.badge.cur')).toHaveText('1')
    // 点小标切到那条旁支，再点关掉
    await txt.locator('.badge', { hasText: '2' }).click()
    await expect(side(page).locator('.um')).toHaveText(['新会话是什么意思？'])
    await txt.locator('.badge', { hasText: '2' }).click()
    await expect(side(page)).toHaveCount(0)
    await txt.locator('.badge', { hasText: '1' }).click()
    await expect(side(page).locator('.um')).toHaveText(['为什么是基向量？'])
    await expect(sideBox(page)).toBeFocused()

    // 3. 引用片：指着它，上格里那句亮起来；点它，滚回那句、亮 1.4 秒
    const chip = side(page).getByTestId('side-quote')
    const mine = txt.locator('.asked', { hasText: '列就是基向量去哪' })
    await chip.hover()
    await expect(mine).toHaveClass(/\bhov\b/)
    await page.mouse.move(5, 5)
    await expect(mine).not.toHaveClass(/\bhov\b/)
    await chip.click()
    await expect(mine).toHaveClass(/\blit\b/)
    await expect(mine).toBeInViewport()
    await expect(mine).not.toHaveClass(/\blit\b/, { timeout: 3000 })

    // 5. 放进主对话：这条回答作为一块引用进主对话输入框那一排（不自动发）
    await side(page).locator('.sacts').getByRole('button', { name: '放进主对话' }).click()
    const mat = ai(page).getByTestId('ai-mat')
    await expect(mat).toHaveCount(1)
    await expect(mat).toHaveAttribute('data-src', '旁支 · 列为什么是基向量')
    await expect(mat.locator('.ct')).toContainText('这是旁支的回答')
    await expect(ai(page).getByRole('textbox', { name: '问 AI' })).toHaveValue('①')
    await expect(ai(page).getByTestId('reading-msg')).toHaveCount(1)

    // 删掉第 2 条：对话记录里、笔记里都没了；菜单里只剩第 1 条
    await txt.locator('.badge', { hasText: '2' }).click()
    await head.hover()
    await more.click()
    await menu.getByRole('menuitem', { name: '删掉这条旁支' }).click()
    await expect(side(page)).toHaveCount(0)
    await expect(txt.locator('.badge')).toHaveText(['1'])
    await expect.poll(() => readFileSync(join(run.vault, NOTE), 'utf8'), { timeout: 15_000 }).not.toContain('新会话是什么意思？')
    expect(readFileSync(join(run.vault, NOTE), 'utf8')).toContain('> [!side] 为什么是基向量？')
  } finally {
    await run.close()
  }
})

test('A1 第 6 条（工作区方向 A）：开着旁支点竖条「笔记」，笔记标签落在那条旁支上；笔记拖到 PDF 左边，旁支照旧能问，问完笔记里这一问马上长出来、闪一下；「在笔记里看」滚到那条旁支；重开软件旁支还在（答完马上退出也存下整条回答）', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault, userData } = run
  const root = dirname(vault)
  try {
    const msg = await askFirst(page)
    await selectText(page, msg.locator('.txt'), '列就是', '去哪')
    await expect(askbox(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await sideBox(page).fill('为什么是基向量？')
    await sideBox(page).press('Enter')
    await expect(side(page).locator('.sacts')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 15_000 }).toContain('> [!side] 为什么是基向量？\n> > 列就是基向量去哪\n>\n> #### 旁支的回答')
    // 竖条「笔记」：笔记标签开在同一组、在前面（AI 和下格的旁支在它后面）；开着旁支切过来：落在正在问的那条旁支上
    await rail(page).getByRole('button', { name: '笔记' }).click()
    await expect(notes(page)).toBeVisible()
    await expect(ai(page)).toBeHidden()
    await expect(side(page)).toBeHidden()
    const round = notes(page).getByTestId('note-round')
    await expect(round.locator('.nside .qs')).toHaveText(['为什么是基向量？'])
    await expect(round.locator('.nside').first()).toBeInViewport()
    // 笔记拖到 PDF 左边成一栏：AI 和下格的旁支回来，一边问一边看笔记
    await noteBeside(page)
    await expect(ai(page)).toBeVisible()
    await expect(side(page)).toBeVisible()
    await expect(notes(page)).toBeVisible()
    // 在下格接着问：笔记里这一问马上长出来（先写一次，标题小结晚一点补），闪一下
    await sideBox(page).fill('那行呢？')
    await sideBox(page).press('Enter')
    const grown = round.locator('.nside .turn').nth(1)
    await expect(grown.locator('.qs')).toHaveText('那行呢？', { timeout: 15_000 })
    await expect(grown).toHaveClass(/\bgrow\b/)
    // 刚问的那一问滚进来、看得见；整轮外面不亮一圈（只有新长出来的那几块闪）
    await expect(grown.locator('.qs')).toBeInViewport()
    await expect(round).not.toHaveClass(/\bflash\b/)
    expect(await css(grown, ['animation-duration'])).toEqual({ 'animation-duration': '1.6s' })
    // 小结跟着重写（旁支答完一次也重写）
    await expect(round.locator('.recap span')).toHaveText('测试小结：主对话问了 1 句，旁支问了 2 句。', { timeout: 15_000 })
    // 同一条旁支的追问在笔记里不带引用句
    expect(readFileSync(join(vault, NOTE), 'utf8')).toContain('> [!side] 那行呢？\n>\n> #### 旁支的回答')

    // 「在笔记里看」：笔记滚到那条旁支（先把笔记滚回顶上）
    await notes(page).locator('.notes').evaluate((e) => (e.scrollTop = 0))
    await side(page).locator('.sacts').getByRole('button', { name: '在笔记里看' }).click()
    await expect(notes(page)).toBeVisible()
    await expect(round.locator('.nside').first()).toBeInViewport()
    // 笔记里也有虚线和小标；点小标滚到那条旁支
    await expect(round.locator('.am .badge')).toHaveText(['1'])

    // 再问一句旁支，答完马上退出（对话记录存盘有 300 毫秒的等，退出前补存）
    await sideBox(page).fill('门槛是多少？')
    await sideBox(page).press('Enter')
    await expect(side(page).getByTestId('side-msg')).toHaveCount(3)
    await expect(side(page).getByTestId('side-msg').nth(2).locator('.txt')).toContainText('第二段：门槛减掉，不清零。', { timeout: 15_000 })
    // 答完了（三个小按钮回来了）就马上退出：存盘的那 300 毫秒还没到
    await expect(side(page).locator('.sacts')).toBeVisible()
    await run.close({ keep: true })

    // 重开软件：旁支还在，小标还在，点小标看得到三问三答（最后一条是整条回答，不是「没答完」）
    const app = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash') },
    })
    try {
      const p2 = await app.firstWindow()
      await expect(p2.locator('.vault b')).toHaveText('测试库')
      if (!(await tabOn(p2).textContent())?.includes('第3讲.pdf')) await openPdf(p2)
      if (!(await ai(p2).isVisible())) await p2.keyboard.press('Meta+j')
      const t2 = ai(p2).getByTestId('reading-msg').last().locator('.txt')
      await expect(t2.locator('.badge')).toHaveText(['1'], { timeout: 15_000 })
      await t2.locator('.badge').click()
      await expect(side(p2).locator('.um')).toHaveText(['为什么是基向量？', '那行呢？', '门槛是多少？'])
      await expect(side(p2).getByTestId('side-msg')).toHaveCount(3)
      await expect(side(p2).getByTestId('side-msg').last().locator('.txt')).toContainText('第二段：门槛减掉，不清零。')
      await expect(side(p2).getByTestId('side-msg').last()).not.toContainText('没答完')
      // ⋯ 里也列着
      await side(p2).locator('.sh').hover()
      await side(p2).locator('.sh').getByRole('button', { name: '旁支菜单' }).click()
      await expect(p2.getByRole('menu', { name: '旁支' }).getByRole('menuitemradio')).toHaveText(['为什么是基向量第 2 页 · 3 问'])
    } finally {
      await app.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('开旁支时上格变矮：问的那句（长回答下半截的一句）留在上格看得见的地方，问完、答完也还在', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await askFirst(page)
    // 再问一句长的：假 AI 答 LIF 的三条公式，「水位一到门槛」那句在下半截
    const ta = ai(page).getByRole('textbox', { name: '问 AI' })
    await ta.fill('讲讲这页的三条公式')
    await ta.press('Enter')
    const msg = ai(page).getByTestId('reading-msg').last()
    await expect(msg.locator('.noted')).toContainText('已记进笔记', { timeout: 20_000 })
    const txt = msg.locator('.txt')
    await selectText(page, txt, '水位一到门槛', '不是清零')
    await expect(askbox(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(side(page)).toBeVisible()
    await expect.poll(async () => atDefault(await split(page))).toBe(true)
    // 那句在上格的消息区里，不被下格挡住；句里有公式也只包一个 span（点线一整条）
    const asked = txt.locator('.asked')
    await expect(asked).toHaveCount(1)
    await expect(asked.locator('.katex')).toHaveCount(1)
    await expect(asked).toBeInViewport()
    const a = await box(asked)
    const l = await box(ai(page).locator('.msgs'))
    expect(a.y).toBeGreaterThanOrEqual(l.y)
    expect(a.y + a.height).toBeLessThanOrEqual(l.y + l.height)
    // 空着回车问「讲讲这句」，答完那句还在上格看得见的地方（答完以后虚线那几段重画过一次）
    await sideBox(page).press('Enter')
    await expect(side(page).locator('.um')).toHaveText(['讲讲这句'])
    await expect(side(page).locator('.sacts')).toBeVisible({ timeout: 15_000 })
    await expect(asked).toBeInViewport()
    // 问过以后空着回车不发、发送键灰着
    await expect(side(page).getByRole('button', { name: '发送' })).toBeDisabled()
    await sideBox(page).press('Enter')
    await page.waitForTimeout(300)
    await expect(side(page).locator('.um')).toHaveText(['讲讲这句'])
  } finally {
    await run.close()
  }
})

test('回答里选中靠左的一句：小框收在 AI 那一格里（离两边 8），不伸到 PDF 栏上；右栏拖窄到 340 也一样', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const msg = await askFirst(page)
    const txt = msg.locator('.txt')
    for (const dx of [0, -40]) {
      if (dx) await widenRight(page, dx)
      const cell = await box(ai(page))
      expect(Math.round(cell.width)).toBe(380 + dx)
      await selectText(page, txt, '这是', '讲解')
      const ab = askbox(page)
      await expect(ab).toBeVisible()
      const b = await box(ab)
      expect(b.width).toBe(300)
      expect(b.x).toBeGreaterThanOrEqual(cell.x + 8 - 0.5)
      expect(b.x + b.width).toBeLessThanOrEqual(cell.x + cell.width - 8 + 0.5)
      await page.keyboard.press('Escape')
      await expect(ab).toHaveCount(0)
    }
  } finally {
    await run.close()
  }
})

test('开着旁支时上格读得下去：887、760 高时上格都是 420（消息区约 275），问的那句挪到上格靠上、下面露着后面的回答；窗口变矮到放不下两头时旁支先收成格头那一条，变高展开回来', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  const size = async (h: number) => {
    await app.evaluate(({ BrowserWindow }, hh) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, hh), h)
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(h)
  }
  try {
    await size(887)
    await askFirst(page)
    const ta = ai(page).getByRole('textbox', { name: '问 AI' })
    await ta.fill('讲讲这页的三条公式')
    await ta.press('Enter')
    const msg = ai(page).getByTestId('reading-msg').last()
    await expect(msg.locator('.noted')).toContainText('已记进笔记', { timeout: 20_000 })
    await selectText(page, msg.locator('.txt'), '水位一到门槛', '不是清零')
    await expect(askbox(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(side(page)).toBeVisible()
    // 问的那句挪到上格靠上：离消息区顶不到四成，下面还露着几行回答
    await page.waitForTimeout(1200)
    {
      const asked = await box(msg.locator('.asked').first())
      const l = await box(ai(page).locator('.msgs'))
      expect(asked.y - l.y).toBeGreaterThan(0)
      // 那句后面的字不够填满上格时，滚到底就是最靠上了
      const atEnd = await ai(page).locator('.msgs').evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 2)
      expect(asked.y - l.y < l.height * 0.4 || atEnd).toBe(true)
    }
    // AI 标签的高 = 整栏 - 组头 38（工作区方向 A）：887 高时 779、760 高时 652
    for (const [h, sideH] of [[887, 359], [760, 232]] as const) {
      await size(h)
      await expect.poll(async () => Math.round((await split(page)).top)).toBe(420)
      expect(Math.round((await split(page)).side)).toBe(sideH)
      const l = await box(ai(page).locator('.msgs'))
      expect(l.height).toBeGreaterThan(270)
    }
    // 窗口变矮到两头放不下：旁支收成 29 高的格头条，主对话整格
    await size(600)
    await expect.poll(async () => Math.round((await box(side(page))).height)).toBe(29)
    await expect(side(page).locator('.sh')).toHaveAttribute('aria-expanded', 'false')
    // 变高：自己收的，展开回来
    await size(887)
    await expect.poll(async () => Math.round((await split(page)).top)).toBe(420)
    await expect(side(page).locator('.sh')).toHaveAttribute('aria-expanded', 'true')
    // 矮窗口里自己点开：照开，下格 201、上格让
    await size(600)
    await expect.poll(async () => Math.round((await box(side(page))).height)).toBe(29)
    await side(page).locator('.sh b').click()
    await expect.poll(async () => Math.round((await split(page)).side)).toBe(201)
  } finally {
    await run.close()
  }
})
