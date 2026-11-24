// 读 PDF 的旁支：CN-90 的小框和问法照旧，2026-11-21 起开法换成方向 A「就地展开」（task-4edsc，原型 /private/tmp/canvas-notes-branch/proto.html#dir=a）。
// 在 AI 的回答里选中一句 → 选区下方的小框（先能打问题；「引用 ⌘↵」「问这句 ↵」）→ 那一段下面长出旁支（不再开下格），
// 问过的那句划虚线、后面一个小标（一句一个，数字是这一句几条）；头上 ⋯ 改名、删掉、切到别的旁支；放进主对话、在笔记里看、拷贝；
// esc 收起；重开软件旁支还在。四处（读 PDF、AI 对话、网页、文档）各走一遍的在 side-inline.spec.ts。
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
const side = (page: Page) => ai(page).getByRole('region', { name: '旁支' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const askbox = (page: Page) => page.getByRole('dialog', { name: '选中的这句' })
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
    const range = window.getSelection()!.getRangeAt(0)
    const r = range.getBoundingClientRect()
    // 选中高亮的下沿：底色铺满行高，比字的下沿低半个行距（task-5yp97 小框离它 8）
    const last = [...range.getClientRects()].filter((x) => x.width > 0).reduce((a, x) => (x.bottom > a.bottom ? x : a))
    const lh = parseFloat(getComputedStyle(range.endContainer.parentElement!).lineHeight)
    return { left: r.left, right: r.right, bottom: r.bottom, highlight: last.bottom + (lh - last.height) / 2 }
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

test('小框（照小样）、空着回车就地开旁支光标在旁支里、打字回车有回答（从主对话分叉，不往主对话里加东西）、虚线和小标；答完三个小按钮；esc 收起，没问过的空旁支不留', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    const msg = await askFirst(page)
    const txt = msg.locator('.txt')
    // 回答里选中一句：离选中高亮的下沿 8 的小框（task-5yp97，以前离字的下沿 8），300 宽；上面一格能先打问题，下面两行
    const sel = await selectText(page, txt, '列就是', '去哪')
    const ab = askbox(page)
    await expect(ab).toBeVisible()
    const b = await box(ab)
    expect(b.width).toBe(300)
    // 量到看得见的边：框外那圈 1px 外环（--shadow-up 第一层）离高亮下沿 8，框本身再往下 1
    expect(Math.abs(b.y - 1 - (sel.highlight + 8))).toBeLessThanOrEqual(1)
    expect(Math.abs(b.x + 150 - (sel.left + sel.right) / 2)).toBeLessThanOrEqual(1.5)
    const ta = ab.getByRole('textbox', { name: '问这句' })
    await expect(ta).toHaveAttribute('placeholder', '问这句…（空着 ↵ 就是打开旁支自己打）')
    expect((await box(ta)).height).toBe(32)
    await expect(ab.locator('.it')).toHaveText(['引用⌘↵', '问这句↵'])
    expect(await css(ab, ['border-radius', 'padding'])).toEqual({ 'border-radius': '12px', padding: '6px' })
    expect((await box(ab.locator('.it').first())).height).toBe(30)
    // esc：小框收起、选区取消
    await page.keyboard.press('Escape')
    await expect(ab).toHaveCount(0)
    expect(await page.evaluate(() => window.getSelection()!.isCollapsed)).toBe(true)

    // 再选一次，空着回车：旁支就在这条回答里那一段下面打开，光标在旁支的输入框里
    await selectText(page, txt, '列就是', '去哪')
    await expect(ab).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(ab).toHaveCount(0)
    await expect(side(page)).toBeVisible()
    await expect(msg.getByRole('region', { name: '旁支' })).toBeVisible()
    await expect(sideBox(page)).toBeFocused()
    await expect(sideBox(page)).toHaveAttribute('placeholder', '问这句…（直接 ↵ 就是「讲讲这句」）')
    // 头：28 高；「旁支」500 +「· 新旁支」12 --t3；不再有下格和「看得到」藏起来那回事
    const head = side(page).locator('.sd-head')
    await expect(head.locator('b')).toHaveText('旁支')
    await expect(head.locator('.s')).toHaveText('· 新旁支')
    expect((await box(head)).height).toBe(28)
    expect(await css(head.locator('b'), ['font-weight'])).toEqual({ 'font-weight': '500' })
    expect(await css(head.locator('.s'), ['font-size'])).toEqual({ 'font-size': '12px' })
    await expect(ai(page).getByTestId('reading-sees')).toBeVisible()
    await expect(page.getByRole('separator', { name: '拖着调高低，双击回默认' })).toHaveCount(0)
    // 问过的那句：--acc 点线（1.5 粗、4 一个点），整句一个 span、开着时整句亮；后面一个小标（17 高、圆角 5、11px 500），开着的这句强调色底
    const asked = txt.locator('.asked')
    await expect(asked).toHaveText('列就是基向量去哪。')
    await expect(asked).toHaveCount(1)
    await expect(asked).toHaveClass(/\bon\b/)
    expect(await css(asked, ['background-size', 'background-repeat', 'padding-bottom'])).toEqual({ 'background-size': '4px 1.5px', 'background-repeat': 'repeat-x', 'padding-bottom': '2px' })
    expect((await css(asked, ['background-image']))['background-image']).toMatch(/^radial-gradient\(circle/)
    const badge = txt.locator('.badge')
    await expect(badge).toHaveText('1')
    await expect(badge).toHaveClass(/\bcur\b/)
    expect((await box(badge)).height).toBe(17)
    expect(await css(badge, ['border-radius', 'font-size', 'font-weight'])).toEqual({ 'border-radius': '5px', 'font-size': '11px', 'font-weight': '500' })

    // 打字回车：直接问；回答从主对话的会话分叉，主对话里不多出东西
    await sideBox(page).fill('为什么是基向量？')
    await sideBox(page).press('Enter')
    const ans = side(page).getByTestId('side-msg').last()
    await expect(ans).toContainText('这是旁支的回答', { timeout: 15_000 })
    await expect(ans).toContainText('旁支，从 fake-read-claude 分叉')
    await expect(ans).toContainText('讲「列就是基向量去哪」，问的是「为什么是基向量？」')
    await expect(side(page).locator('.sq')).toHaveText(['为什么是基向量？'])
    await expect(ai(page).getByTestId('reading-msg')).toHaveCount(1)
    await expect(ai(page).locator('.um-wrap')).toHaveCount(1)
    // 答完：回答下面那排（task-eavzx）：拷贝 · 插进文档 · ⋯（24 高、12px，无边框），插进主对话、在笔记里看进 ⋯；
    // 占位换成「接着问这条旁支…」，名字是问的那句（末尾的问号不要）
    const acts = side(page).locator('.acts [data-act]')
    await expect(acts).toHaveText(['拷贝', '插进文档', ''])
    expect((await box(acts.first())).height).toBe(24)
    expect(await css(acts.first(), ['font-size', 'border-top-width'])).toEqual({ 'font-size': '12px', 'border-top-width': '0px' })
    await side(page).locator('.acts [data-act="more"]').click()
    await expect(page.locator('.cn-ab-menu [data-item]')).toHaveText(['插进主对话', '在笔记里看', '拷贝为 Markdown', '调整这一排…', '存进收件箱'])
    await page.keyboard.press('Escape')
    await expect(sideBox(page)).toHaveAttribute('placeholder', '接着问这条旁支…')
    await expect(head.locator('.s')).toHaveText('· 为什么是基向量')
    // 问过以后：空着回车不发、发送键灰着；打了字接着问
    const sendBtn = side(page).getByRole('button', { name: '发送' })
    await expect(sendBtn).toBeDisabled()
    await sideBox(page).press('Enter')
    await page.waitForTimeout(300)
    await expect(side(page).locator('.sq')).toHaveText(['为什么是基向量？'])
    await sideBox(page).fill('再讲讲')
    await expect(sendBtn).toBeEnabled()
    await sideBox(page).press('Enter')
    await expect(side(page).locator('.sq')).toHaveText(['为什么是基向量？', '再讲讲'])
    await expect(side(page).getByTestId('side-msg')).toHaveCount(2)
    await expect(side(page).getByTestId('side-msg').last()).toContainText('接着聊', { timeout: 15_000 })
    // 拷贝（主进程的剪贴板换成记录器，不碰这台 Mac 真的剪贴板）：变「已拷贝」
    await run.app.evaluate(({ clipboard }) => {
      ;(globalThis as { copied?: string }).copied = ''
      clipboard.writeText = async (t: string) => void ((globalThis as { copied?: string }).copied = t)
    })
    await expect(acts.first()).toBeVisible({ timeout: 15_000 })
    await acts.first().click()
    await expect(acts.first()).toHaveText('已拷贝')
    expect(await run.app.evaluate(() => (globalThis as { copied?: string }).copied)).toContain('这是旁支的回答')

    // 焦点在旁支里按 esc：收起（问过的旁支留着，小标还在、不再是强调色底，那句不再亮）
    await sideBox(page).click()
    await page.keyboard.press('Escape')
    await expect(side(page)).toHaveCount(0)
    await expect(txt.locator('.badge')).toHaveText('1')
    await expect(txt.locator('.badge')).not.toHaveClass(/\bcur\b/)
    await expect(txt.locator('.asked')).not.toHaveClass(/\bon\b/)
    // 没问过的空旁支收起就不留：另选一句、空着开，再 esc
    await selectText(page, txt, '这是讲解', '新会话')
    await expect(askbox(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(side(page)).toBeVisible()
    await expect(txt.locator('.badge')).toHaveText(['1', '1'])
    await page.keyboard.press('Escape')
    await expect(side(page)).toHaveCount(0)
    await expect(txt.locator('.badge')).toHaveText(['1'])
    await expect(txt.locator('.asked')).toHaveText(['列就是基向量去哪。'])
  } finally {
    await run.close()
  }
})

test('⋯ 菜单（300 宽、往下弹、右对齐）改名真能改、两条旁支切来切去、删掉；点小标开 / 收；放进主对话进了输入框那一排（旁支开着时输入框缩成一行，收起后看得到）', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    const msg = await askFirst(page)
    const txt = msg.locator('.txt')
    // 第一条旁支
    await selectText(page, txt, '列就是', '去哪')
    await expect(askbox(page)).toBeVisible()
    await page.keyboard.press('Enter')
    await sideBox(page).fill('为什么是基向量？')
    await sideBox(page).press('Enter')
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    // ⋯：菜单 300 宽，右边和按钮对齐，在按钮下面 6
    const head = side(page).locator('.sd-head')
    const more = head.getByRole('button', { name: '旁支菜单' })
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
    // 改名：名字那一处就地换成一格，回车存下；头上、菜单里都是新名字
    await menu.getByRole('menuitem', { name: '改名…' }).click()
    const rn = head.getByRole('textbox', { name: '旁支的名字' })
    await expect(rn).toBeFocused()
    await expect(rn).toHaveValue('为什么是基向量')
    await rn.fill('列为什么是基向量')
    await rn.press('Enter')
    await expect(head.locator('.s')).toHaveText('· 列为什么是基向量')

    // 第二条旁支：另选一句，在小框里先打问题
    await selectText(page, txt, '这是讲解', '新会话')
    await askbox(page).getByRole('textbox', { name: '问这句' }).fill('新会话是什么意思？')
    await askbox(page).getByRole('textbox', { name: '问这句' }).press('Enter')
    await expect(side(page).locator('.sq')).toHaveText(['新会话是什么意思？'])
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    // 小标：两句各一个，开着的是第二句
    const badges = txt.locator('.badge')
    await expect(badges).toHaveText(['1', '1'])
    await expect(txt.locator('.badge.cur')).toHaveCount(1)
    await expect(txt.locator('.asked.on')).toHaveText(/^这是讲解（.*新会话）。?$/)
    // ⋯ 里切回第 1 条
    await head.getByRole('button', { name: '旁支菜单' }).click()
    await expect(menu.getByRole('menuitemradio')).toHaveText(['列为什么是基向量第 2 页 · 1 问', '新会话是什么意思第 2 页 · 1 问'])
    await menu.getByRole('menuitemradio', { name: /列为什么是基向量/ }).click()
    await expect(menu).toHaveCount(0)
    await expect(head.locator('.s')).toHaveText('· 列为什么是基向量')
    await expect(side(page).locator('.sq')).toHaveText(['为什么是基向量？'])
    await expect(txt.locator('.asked.on')).toHaveText('列就是基向量去哪。')
    // 点小标：开着的这句再点是收起；点另一句的小标打开那一条
    const badgeOf = (t: string) => txt.locator(`.asked:has-text("${t}") + .badge`)
    await badgeOf('列就是').click()
    await expect(side(page)).toHaveCount(0)
    await badgeOf('这是讲解').click()
    await expect(side(page)).toBeVisible()
    await expect(side(page).locator('.sq')).toHaveText(['新会话是什么意思？'])
    await expect(sideBox(page)).toBeFocused()
    await badgeOf('这是讲解').click()
    await badgeOf('列就是').click()
    await expect(side(page).locator('.sq')).toHaveText(['为什么是基向量？'])

    // ⋯ 里插进主对话：这条回答作为一块引用进主对话输入框那一排（不自动发），底栏说一句；输入框这时缩成一行，收起后看得到那一块
    await side(page).locator('.acts [data-act="more"]').click()
    await page.getByRole('menuitem', { name: '插进主对话' }).click()
    await expect(page.getByTestId('toast')).toContainText('插进了主对话的输入框，没发')
    await expect(ai(page).getByTestId('ai-input-slim')).toBeVisible()
    await side(page).getByRole('button', { name: '收起旁支' }).last().click()
    const mat = ai(page).getByTestId('ai-mat')
    await expect(mat).toHaveCount(1)
    await expect(mat.locator('.ct')).toContainText('这是旁支的回答')
    await expect(ai(page).getByRole('textbox', { name: '问 AI' })).toHaveValue('①')
    await expect(ai(page).getByTestId('reading-msg')).toHaveCount(1)

    // 删掉第 2 条：对话记录里、笔记里都没了；菜单里只剩第 1 条
    await badgeOf('这是讲解').click()
    await expect(side(page).locator('.sq')).toHaveText(['新会话是什么意思？'])
    await side(page).locator('.sd-head').getByRole('button', { name: '旁支菜单' }).click()
    await menu.getByRole('menuitem', { name: '删掉这条旁支' }).click()
    await expect(side(page)).toHaveCount(0)
    await expect(txt.locator('.badge')).toHaveText(['1'])
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 15_000 }).not.toContain('新会话是什么意思？')
    expect(readFileSync(join(vault, NOTE), 'utf8')).toContain('> [!side] 为什么是基向量？')
  } finally {
    await run.close()
  }
})

test('工作区方向 A：开着旁支点竖条「笔记」，笔记标签落在那条旁支上；笔记拖到 PDF 左边，旁支照旧能问，问完笔记里这一问马上长出来、闪一下；「在笔记里看」滚到那条旁支；重开软件旁支还在（答完马上退出也存下整条回答）', async () => {
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
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => readFileSync(join(vault, NOTE), 'utf8'), { timeout: 15_000 }).toContain('> [!side] 为什么是基向量？\n> > 列就是基向量去哪\n>\n> #### 旁支的回答')
    // 竖条「笔记」：笔记标签开在同一组、在前面；开着旁支切过来：落在正在问的那条旁支上
    await rail(page).getByRole('button', { name: '笔记', exact: true }).click()
    await expect(notes(page)).toBeVisible()
    await expect(ai(page)).toBeHidden()
    const round = notes(page).getByTestId('note-round')
    await expect(round.locator('.nside .qs')).toHaveText(['为什么是基向量？'])
    await expect(round.locator('.nside').first()).toBeInViewport()
    // 笔记拖到 PDF 左边成一栏：AI 回来，开着的旁支还在，一边问一边看笔记
    await noteBeside(page)
    await expect(ai(page)).toBeVisible()
    await expect(side(page)).toBeVisible()
    await expect(notes(page)).toBeVisible()
    // 接着问：笔记里这一问马上长出来（先写一次，标题小结晚一点补），闪一下
    await sideBox(page).fill('那行呢？')
    await sideBox(page).press('Enter')
    const grown = round.locator('.nside .turn').nth(1)
    await expect(grown.locator('.qs')).toHaveText('那行呢？', { timeout: 15_000 })
    await expect(grown).toHaveClass(/\bgrow\b/)
    await expect(grown.locator('.qs')).toBeInViewport()
    await expect(round).not.toHaveClass(/\bflash\b/)
    expect(await css(grown, ['animation-duration'])).toEqual({ 'animation-duration': '1.6s' })
    // 小结跟着重写（旁支答完一次也重写）
    await expect(round.locator('.recap span')).toHaveText('测试小结：主对话问了 1 句，旁支问了 2 句。', { timeout: 15_000 })
    // 同一条旁支的追问在笔记里不带引用句
    expect(readFileSync(join(vault, NOTE), 'utf8')).toContain('> [!side] 那行呢？\n>\n> #### 旁支的回答')

    // 「在笔记里看」：笔记滚到那条旁支（先把笔记滚回顶上）
    await notes(page).locator('.notes').evaluate((e) => (e.scrollTop = 0))
    await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    await side(page).locator('.acts [data-act="more"]').click()
    await page.getByRole('menuitem', { name: '在笔记里看' }).click()
    await expect(notes(page)).toBeVisible()
    await expect(round.locator('.nside').first()).toBeInViewport()
    // 笔记里也有虚线和小标
    await expect(round.locator('.am .badge')).toHaveText(['1'])

    // 再问一句旁支，答完马上退出（对话记录存盘有 300 毫秒的等，退出前补存）
    await sideBox(page).fill('门槛是多少？')
    await sideBox(page).press('Enter')
    await expect(side(page).getByTestId('side-msg')).toHaveCount(3)
    await expect(side(page).getByTestId('side-msg').nth(2)).toContainText('第二段：门槛减掉，不清零。', { timeout: 15_000 })
    // 答完了（三个小按钮回来了）就马上退出：存盘的那 300 毫秒还没到
    await expect(side(page).locator('.acts')).toBeVisible()
    await run.close({ keep: true })

    // 重开软件：小标还在，点小标看得到三问三答（最后一条是整条回答，不是「没答完」）
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
      await expect(side(p2).locator('.sq')).toHaveText(['为什么是基向量？', '那行呢？', '门槛是多少？'])
      await expect(side(p2).getByTestId('side-msg')).toHaveCount(3)
      await expect(side(p2).getByTestId('side-msg').last()).toContainText('第二段：门槛减掉，不清零。')
      await expect(side(p2).getByTestId('side-msg').last()).not.toContainText('没答完')
      // ⋯ 里也列着
      await side(p2).locator('.sd-head').getByRole('button', { name: '旁支菜单' }).click()
      await expect(p2.getByRole('menu', { name: '旁支' }).getByRole('menuitemradio')).toHaveText(['为什么是基向量第 2 页 · 3 问'])
    } finally {
      await app.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('长回答下半截的一句开旁支：那句一直在那一块的正上方、看得见；问答长了在块里滚（最高 min(34vh, 340)），输入框跟着在块底', async () => {
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
    // 句里有公式也只包一个 span（点线一整条）
    const asked = txt.locator('.asked')
    await expect(asked).toHaveCount(1)
    await expect(asked.locator('.katex')).toHaveCount(1)
    // 空着回车问「讲讲这句」，再接着问两句：那句和输入框都看得见，问答在块里滚
    for (const q of ['', '还是不太懂', '那门槛是多少？']) {
      if (q) await sideBox(page).fill(q)
      await sideBox(page).press('Enter')
      await expect(side(page).locator('.acts')).toBeVisible({ timeout: 15_000 })
    }
    await expect(side(page).locator('.sq')).toHaveText(['讲讲这句', '还是不太懂', '那门槛是多少？'])
    const qa = side(page).locator('.qa')
    const h = await page.evaluate(() => innerHeight)
    expect((await box(qa)).height).toBeLessThanOrEqual(Math.min(h * 0.34, 340) + 1)
    expect(await qa.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true)
    await expect(asked).toBeInViewport()
    await expect(sideBox(page)).toBeInViewport()
    // 问过以后空着回车不发、发送键灰着
    await expect(side(page).getByRole('button', { name: '发送' })).toBeDisabled()
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
