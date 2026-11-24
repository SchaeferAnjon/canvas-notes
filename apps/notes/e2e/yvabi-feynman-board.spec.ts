/**
 * 费曼学习 · 白板上讲（task-yvabi 方向 B，② 界面线）：四种入口各真点一遍，讲的时候盖住、按住看一眼、esc 先停 AI 再暂停、
 * 接着讲记一次看过材料、讲完看判定（三档）、当场再讲这几处、右栏 AI 顶上一句、文档看法里是文末一节。
 * AI 用 ① 的假引擎（CN_AI_FAKE=1，shared/feynman/fake.ts 认得「范数」）。CN_FY_SHOTS=<目录> 时顺手截图。
 */
import { expect, type Locator, type Page, test } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { type AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, pane, type Running } from './app'
import { board, openBoard } from './fixtures/board-doc'
import { BOARD_PATH, BOOK_PAGE, feynmanFiles } from './fixtures/feynman'
import { FAKE_RT_KEY, FAKE_RT_TEXT, startFakeSonioxRt } from './fixtures/fake-soniox-rt'

const SHOTS = process.env.CN_FY_SHOTS

let server: Server
let book = ''
test.beforeAll(async () => {
  server = createServer((_q, r) => (r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), r.end(BOOK_PAGE)))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  book = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
test.afterAll(() => new Promise<void>((r) => server.close(() => r())))

const col = (page: Page) => pane(page).getByTestId('fy-col')
const card = (page: Page, text: string) => board(page).locator('.db-card').filter({ hasText: text })
const shot = async (page: Page, name: string) => SHOTS && (await page.waitForTimeout(300), await page.screenshot({ path: join(SHOTS, name + '.png') }))

async function start(env: Record<string, string> = {}): Promise<Running> {
  const run = await launch(feynmanFiles(book), { CN_AI_FAKE: '1', ...env })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  return run
}

const fileText = (run: Running, rel: string) => readFileSync(join(run.vault, rel), 'utf8')

/** 在回答框里打一段，点「讲完了 / 回」 */
async function say(c: Locator, text: string) {
  const box = c.getByTestId('fy-answer')
  await expect(box).toBeVisible({ timeout: 15_000 })
  await box.locator('textarea').fill(text)
  await c.getByTestId('fy-send').click()
}

/** 学生问一句、等它问完（回答框出来或「讲完了，看判定」出来） */
async function asked(c: Locator) {
  await expect(c.getByTestId('fy-answer').or(c.getByTestId('fy-finish'))).toBeVisible({ timeout: 15_000 })
}

test('框选操作条「费曼讲这几张」：这次要讲到能改；开始讲盖住这几张和配对的网页；esc 先停 AI 再暂停；没过 → 当场再讲这几处 → 过 · 当场补讲', async () => {
  test.setTimeout(180_000)
  const run = await start({ CN_FAKE_FEYNMAN_MS: '900' })
  const { page } = run
  try {
    await openBoard(page, '线性代数 2.3 白板')
    await expect(card(page, '范数必须非负')).toBeVisible()
    // ⌘ 点四张剪藏卡：操作条「费曼讲这几张」
    for (const t of ['范数表示一个向量有多大', '按常数 α 缩放向量', '三角不等式', '范数必须非负']) await card(page, t).click({ modifiers: ['Meta'] })
    const bar = page.getByTestId('db-selbar')
    await expect(bar).toContainText('已选4张')
    await shot(page, 'entry-selbar')
    await bar.getByRole('button', { name: '费曼讲这几张' }).click()
    await expect(pane(page).getByTestId('fy-pending')).toBeVisible()
    const c = col(page)
    await expect(c).toBeVisible({ timeout: 15_000 })
    await expect(c.locator('.fy-t b')).toHaveText('费曼 · 范数')
    await expect(c.getByTestId('fy-by')).toContainText('Claude Code')
    const plan = c.getByTestId('fy-plan')
    const cores = plan.locator('.rows.core [data-testid="fy-point"]')
    await expect(cores).toHaveCount(4)
    await shot(page, 'doc-plan')
    // 移到了解即可、移回核心、加一条、× 掉它
    const p4 = plan.locator('[data-k="c4"]')
    await p4.hover()
    await p4.getByRole('button', { name: '移到了解即可' }).click()
    await expect(cores).toHaveCount(3)
    await plan.getByTestId('fy-lite').click()
    await plan.locator('[data-k="c4"]').hover()
    await plan.locator('[data-k="c4"]').getByRole('button', { name: '移到核心' }).click()
    await expect(cores).toHaveCount(4)
    await plan.getByTestId('fy-addp').click()
    await plan.getByRole('textbox', { name: '加一条要讲的事' }).fill('为什么要满足三角不等式')
    await page.keyboard.press('Enter')
    await expect(cores).toHaveCount(5)
    await plan.locator('[data-k="u1"]').hover()
    await plan.locator('[data-k="u1"]').getByRole('button', { name: '这次不讲这一条' }).click()
    await expect(cores).toHaveCount(4)
    // 写进了文档：文末一节「## 费曼 · 范数」，注释里记着改动
    await expect.poll(() => fileText(run, BOARD_PATH), { timeout: 8000 }).toContain('"op":"drop","id":"u1"')
    expect(fileText(run, BOARD_PATH)).toMatch(/## 费曼 · 范数\n<!-- feynman /)

    // 开始讲：这四张盖住、配对的网页盖住；别的列照常；列收成名字
    await plan.getByTestId('fy-begin').click()
    await expect(card(page, '范数必须非负')).toHaveClass(/fy-covered/)
    await expect(card(page, '矩阵-矩阵乘法 AB')).not.toHaveClass(/fy-covered/)
    await expect(page.getByTestId('fy-webcover')).toBeVisible()
    await expect(plan).toHaveClass(/done/)
    // 右栏 AI 照常能用，顶上一句
    await page.keyboard.press('Meta+j')
    await expect(page.getByTestId('fy-ainote')).toContainText('白板上「费曼 · 范数」讲着。这里照常能问，问什么都不记。')
    await shot(page, 'doc-ainote')
    await page.keyboard.press('Meta+j')

    // 按住看一眼：露出来，松手盖回去，记一次
    const hold = pane(page).getByTestId('fy-peek').getByTestId('fy-hold')
    const hb = (await hold.boundingBox())!
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    // 按着的时候窗口失焦（别的窗口冒出来、并行跑的另一个软件启动）：手没松，照样露着
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await expect(card(page, '范数必须非负')).not.toHaveClass(/fy-covered/)
    await expect(page.getByTestId('fy-webcover')).toHaveCount(0)
    await shot(page, 'doc-peek')
    await page.mouse.up()
    await expect(card(page, '范数必须非负')).toHaveClass(/fy-covered/)
    await expect(c.getByTestId('fy-peeks')).toHaveText('看过材料1次')

    // 先讲一段（只讲了量的是什么）；学生在想时 esc 先停下它，不暂停
    await say(c, '范数就是量一个向量有多大，比如 (3, 4) 的长度是 5。')
    await expect(c.getByTestId('fy-thinking')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(c.getByTestId('fy-thinking')).toHaveCount(0)
    await expect(c).toHaveAttribute('data-status', 'talking')
    await expect(c.getByTestId('fy-answer')).toBeVisible()
    // 再按一次 esc：暂停，材料露出来
    await c.locator('.fy-t b').click()
    await page.keyboard.press('Escape')
    await expect(c).toHaveAttribute('data-status', 'paused')
    await expect(c.getByTestId('fy-paused')).toContainText('暂停在第')
    await expect(card(page, '范数必须非负')).not.toHaveClass(/fy-covered/)
    await expect(page.getByTestId('fy-webcover')).toHaveCount(0)
    await shot(page, 'doc-paused')
    // 接着讲：再盖上，记一次看过材料
    await c.getByTestId('fy-resume').click()
    await expect(card(page, '范数必须非负')).toHaveClass(/fy-covered/)
    await expect(c.getByTestId('fy-peeks')).toHaveText('看过材料2次')

    // 补一句再交（停下的那问不要了）：学生问没碰的几条，前两条答得不着边（没讲到），最后答对
    await say(c, '它总是一个数。')
    await asked(c)
    await expect(c.getByTestId('fy-student').last()).toContainText('你说「')
    await expect(c.locator('.fy-mine .s.fy-hl')).toHaveCount(1)
    await expect(c.locator('.fy-dots i.touched')).toHaveCount(1)
    await shot(page, 'doc-talk')
    await say(c, '嗯，应该是吧。')
    await asked(c)
    await say(c, '嗯，差不多。')
    await asked(c)
    if (await c.getByTestId('fy-answer').isVisible()) await say(c, '不能是负的，只有零向量是 0。')
    await expect(c.getByTestId('fy-finish')).toBeVisible({ timeout: 15_000 })
    await c.getByTestId('fy-finish').click()
    const v = c.getByTestId('fy-verdict')
    await expect(v).toBeVisible({ timeout: 15_000 })
    await expect(v).toHaveAttribute('data-verdict', 'fail')
    await expect(v.locator('.rt b')).toHaveText('没过')
    await expect(v).toContainText('下一步：')
    await expect(v).toContainText('讲的时候看过一眼材料')
    // 判完露出来
    await expect(card(page, '范数必须非负')).not.toHaveClass(/fy-covered/)
    await expect(page.getByTestId('fy-webcover')).toHaveCount(0)
    await expect(c.getByTestId('fy-gaps')).toContainText('缺口 2处')
    await expect(c.getByTestId('fy-tomap')).toHaveText('拍成导图')
    await expect(c.getByTestId('fy-full')).toBeVisible()
    await shot(page, 'doc-judged')
    // 出卡勾选：去掉一张，按钮跟着变；点「出卡」打开 ③ 接上的出卡弹窗（一张张过、送 Anki 的事在 ③ 的 e2e 里测）
    const before = (await c.getByTestId('fy-cards').textContent())!
    await c.getByTestId('fy-gap').first().locator('.ck').click()
    await expect(c.getByTestId('fy-cards')).not.toHaveText(before)
    await c.getByTestId('fy-cards').click()
    await expect(page.locator('.cards-back')).toBeVisible({ timeout: 10_000 })
    await page.keyboard.press('Escape')
    await expect(page.locator('.cards-back')).toHaveCount(0)

    // 再讲这 2 处：当场只讲这几处，盖上；讲清了改成「过 · 当场补讲」
    await c.getByTestId('fy-redo').click()
    await expect(card(page, '范数必须非负')).toHaveClass(/fy-covered/)
    await expect(c.locator('.fy-round')).toHaveText('第2轮 · 只讲这几处')
    await say(c, '放大 α 倍，范数变成 |α| 倍；两段路绕路不比直走短，这是三角不等式。')
    await expect(v).toHaveAttribute('data-verdict', 'pass', { timeout: 20_000 })
    await expect(v).toContainText('当场补讲')
    await expect(c.getByTestId('fy-gaps')).toContainText('✓ 当场补讲清了')
    await expect(card(page, '范数必须非负')).not.toHaveClass(/fy-covered/)
    await shot(page, 'doc-redo')
    // 文档里：这一节在文末，判定、缺口、完整版都是 AI 块，缺口不写成待办
    await expect.poll(() => fileText(run, BOARD_PATH), { timeout: 8000 }).toContain('过 · 当场补讲')
    const f = fileText(run, BOARD_PATH)
    expect(f).toContain('> [!ai] 判定')
    expect(f).toContain('> [!ai] 完整版')
    expect(f).toContain('> [!ai] 缺口')
    expect(f).not.toContain('- [ ]')
    // 右栏 AI 那一句：讲完了不出
    await page.keyboard.press('Meta+j')
    await expect(page.getByTestId('fy-ainote')).toHaveCount(0)
    await page.keyboard.press('Meta+j')
    // 文档看法里：这一轮就是文末一节，注释那一行不露出来，AI 的话是带标志的块
    await page.getByTestId('tab-acts').getByRole('tab', { name: '文档' }).click()
    const ed = pane(page).locator('.cm-content')
    await expect(ed).toContainText('费曼 · 范数')
    await expect(ed).not.toContainText('<!-- feynman')
    await ed.getByText('费曼 · 范数').scrollIntoViewIfNeeded()
    await shot(page, 'doc-view')
  } finally {
    await run.close()
  }
})

const mapBoard = (page: Page) => pane(page).getByTestId('board')
const node = (page: Page, text: string) => mapBoard(page).locator('.mm-node', { has: page.locator('.t', { hasText: new RegExp(`^${text.replace(/[()+=.*?[\]\\^$|]/g, '\\$&')}$`) }) })
const mapCard = (page: Page, text: string) => mapBoard(page).locator('.bcard').filter({ hasText: text })
/** 截图前白板滚到费曼那一列整个露出来（点按钮时 Playwright 会把画面滚乱） */
const home = (page: Page) =>
  mapBoard(page)
    .locator('.board-wrap')
    .evaluate((w) => {
      // 费曼那一列整个露出来、离右边 24，上面滚到顶（导图在它左边）
      const col = w.querySelector('[data-testid="fy-col"], [data-testid="fy-pending"]')
      // 起点：四周多出的空白（board-slack.ts）
      const [hx, hy] = (w as HTMLElement).dataset.home!.split(',').map(Number) as [number, number]
      w.scrollTop = hy
      if (!col) return w.scrollTo(hx, hy)
      const r = col.getBoundingClientRect()
      const b = w.getBoundingClientRect()
      w.scrollLeft += r.right - (b.right - 24)
    })

test('导图白板：点「范数」这一支，工具板「费曼学习」直接开始；列摆在导图右边；那一支和讲同一件事的卡盖住、别的支照常；讲清了判「过」', async () => {
  test.setTimeout(150_000)
  const run = await start()
  const { page } = run
  try {
    await openBoard(page, '导图 · 线性代数 2.3')
    await expect(node(page, '范数')).toBeVisible()
    await node(page, '范数').click()
    await shot(page, 'entry-map')
    await mapBoard(page).getByTestId('pal-feynman').click()
    // 先选了东西：不弹小框，直接开始
    await expect(page.getByTestId('fy-start')).toHaveCount(0)
    const c = mapBoard(page).getByTestId('fy-col')
    await expect(c).toBeVisible({ timeout: 15_000 })
    await expect(c.locator('.fy-t b')).toHaveText('费曼 · 范数')
    // 摆在导图右边
    const mm = (await mapBoard(page).getByTestId('mindmap').boundingBox())!
    expect((await c.boundingBox())!.x).toBeGreaterThan(mm.x + mm.width - 4)
    // 列头这一节的进度：同级的三支，范数是第 3 个
    await expect(c.getByTestId('fy-progress')).toContainText('这一节第3个 · 共3个')
    await shot(page, 'map-plan')
    await c.getByTestId('fy-begin').click()
    // 那一支（连同下面）盖住，别的支照常；剪自同一页、讲同一件事的卡一起盖
    await expect(node(page, '范数')).toHaveClass(/fy-covered/)
    await expect(node(page, '非负 f(x) ≥ 0')).toHaveClass(/fy-covered/)
    await expect(node(page, '矩阵乘法')).not.toHaveClass(/fy-covered/)
    await expect(mapCard(page, '范数必须非负')).toHaveClass(/fy-covered/)
    await expect(mapBoard(page).getByTestId('fy-mapcover')).toBeVisible()
    await expect(page.getByTestId('fy-webcover')).toBeVisible()
    await home(page)
    await shot(page, 'map-talk0')
    // 按住导图上那颗「看一眼」
    const hold = mapBoard(page).locator('.fy-mapchip').getByTestId('fy-hold')
    await hold.scrollIntoViewIfNeeded()
    const hb = (await hold.boundingBox())!
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await expect(node(page, '范数')).not.toHaveClass(/fy-covered/)
    await home(page)
    await shot(page, 'map-peek')
    await page.mouse.up()
    await expect(node(page, '范数')).toHaveClass(/fy-covered/)
    await expect(c.getByTestId('fy-peeks')).toHaveText('看过材料1次')
    // 列头「暂停」：列收成一句和「接着讲」，那一支露出来；接着讲再盖上，记一次看过
    await c.getByTestId('fy-pause').click()
    await expect(c.getByTestId('fy-paused')).toBeVisible()
    await expect(node(page, '范数')).not.toHaveClass(/fy-covered/)
    await home(page)
    await shot(page, 'map-paused')
    await c.getByTestId('fy-resume').click()
    await expect(node(page, '范数')).toHaveClass(/fy-covered/)
    await expect(c.getByTestId('fy-peeks')).toHaveText('看过材料2次')
    // 四条核心都讲到：学生要带数的例子，答了就过
    await say(c, '范数量的是一个向量有多大；放大 α 倍，范数变成 |α| 倍；两段路绕路不比直走短，这是三角不等式；它不能是负的，只有零向量是 0。')
    for (let i = 0; i < 4; i++) {
      await asked(c)
      if (await c.getByTestId('fy-finish').isVisible()) break
      await home(page)
    await shot(page, 'map-talk')
      await say(c, '比如 (3, 4) 的大小是 5，放大 2 倍是 10，绕路 3 加 4 是 7 不比直走 5 短，长度不会是负的。')
    }
    await c.getByTestId('fy-finish').click()
    const v = c.getByTestId('fy-verdict')
    await expect(v).toHaveAttribute('data-verdict', 'pass', { timeout: 15_000 })
    await expect(c.getByTestId('fy-tomap')).toHaveText('补进导图')
    await expect(c.getByTestId('fy-gaps')).toContainText('用两三句讲清范数')
    await expect(node(page, '范数')).not.toHaveClass(/fy-covered/)
    await home(page)
    await shot(page, 'map-pass')
    // 导图白板的文件：这一节插在卡片块前面，导图那段列表、卡片一字不动
    await expect.poll(() => fileText(run, '课程/导图 · 线性代数 2.3.md'), { timeout: 8000 }).toContain('> [!ai] 判定')
    const f = fileText(run, '课程/导图 · 线性代数 2.3.md')
    expect(f.indexOf('## 费曼 · 范数')).toBeLessThan(f.indexOf('<!-- card id=k1'))
    expect(f).toContain('<!-- card id=k4 x=370 y=760 w=300 -->\n> 范数必须非负')
  } finally {
    await run.close()
  }
})

test('什么都没选点「费曼学习」：小框里直接写一个词开始；也能从白板上挑一列', async () => {
  test.setTimeout(120_000)
  const run = await start()
  const { page } = run
  try {
    await openBoard(page, '线性代数 2.3 白板')
    await expect(card(page, '范数必须非负')).toBeVisible()
    await board(page).getByTestId('pal-feynman').click()
    const pop = page.getByTestId('fy-start')
    await expect(pop).toBeVisible()
    await expect(pop.getByTestId('fy-start-items')).toContainText('矩阵乘法')
    await pop.getByRole('textbox', { name: '直接写一个词' }).fill('范数')
    await shot(page, 'entry-word')
    await pop.getByTestId('fy-start-go').click()
    await expect(pop).toHaveCount(0)
    const c = col(page)
    await expect(c).toBeVisible({ timeout: 15_000 })
    await expect(c.locator('.fy-t b')).toHaveText('费曼 · 范数')
    // 不讲了：× 拿掉这一列，文档回到原样
    await c.getByTestId('fy-discard').click()
    await expect(c).toHaveCount(0)
    await expect.poll(() => fileText(run, BOARD_PATH), { timeout: 8000 }).not.toContain('费曼 · 范数')
    // 从白板上挑一列
    await board(page).getByTestId('pal-feynman').click()
    await page.getByTestId('fy-start-items').getByRole('button', { name: '矩阵乘法' }).click()
    await expect(col(page)).toBeVisible({ timeout: 15_000 })
    await expect(col(page).getByTestId('fy-plan')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('选中一整份 PDF 的卡点「费曼学习」：先出这一讲的知识点单子，挑一个再讲；讲的时候那份 PDF 盖住', async () => {
  test.setTimeout(120_000)
  const run = await start()
  const { page } = run
  try {
    await openBoard(page, '线性代数 2.3 白板')
    const pdfCard = board(page).locator('.db-card').filter({ hasText: '第2周 习题' })
    await expect(pdfCard).toBeVisible()
    await pdfCard.click()
    await board(page).getByTestId('pal-feynman').click()
    const pick = pane(page).getByTestId('fy-pick')
    await expect(pick).toBeVisible({ timeout: 15_000 })
    await expect(pick.getByTestId('fy-pick-item')).toHaveCount(3)
    await shot(page, 'entry-pdf')
    await pick.getByTestId('fy-pick-item').filter({ hasText: 'Norms' }).click()
    const c = col(page)
    await expect(c).toBeVisible({ timeout: 15_000 })
    await c.getByTestId('fy-begin').click()
    // 打开那份 PDF：盖着
    await page.keyboard.press('Meta+o')
    const quick = page.getByRole('dialog', { name: '按名字跳到' })
    await quick.getByRole('textbox', { name: '按名字跳到文件' }).fill('第2周 习题')
    await quick.getByRole('option').filter({ hasText: '第2周 习题' }).first().click()
    await expect(page.getByTestId('fy-pdfcover')).toBeVisible({ timeout: 10_000 })
    await shot(page, 'pdf-cover')
  } finally {
    await run.close()
  }
})

test('差一点：一条核心两次没答上，学生说穿；判「差一点」，下一步再讲这 1 处', async () => {
  test.setTimeout(150_000)
  const run = await start()
  const { page } = run
  try {
    await openBoard(page, '线性代数 2.3 白板')
    for (const t of ['范数表示一个向量有多大', '按常数 α 缩放向量', '三角不等式', '范数必须非负']) await card(page, t).click({ modifiers: ['Meta'] })
    await page.getByTestId('db-selbar').getByRole('button', { name: '费曼讲这几张' }).click()
    const c = col(page)
    await expect(c).toBeVisible({ timeout: 15_000 })
    await c.getByTestId('fy-begin').click()
    await say(c, '范数量的是一个向量有多大；放大 α 倍，范数变成 |α| 倍；两段路绕路不比直走短，这是三角不等式。')
    await asked(c)
    await say(c, '不知道。')
    await asked(c)
    await say(c, '说不上来。')
    await expect(c.getByTestId('fy-reveal')).toBeVisible({ timeout: 15_000 })
    for (let i = 0; i < 4; i++) {
      await asked(c)
      if (await c.getByTestId('fy-finish').isVisible()) break
      await say(c, '比如 (3, 4) 的大小是 5，放大 2 倍是 10，绕路 3 加 4 是 7 不比直走 5 短。')
    }
    await shot(page, 'doc-reveal')
    await c.getByTestId('fy-finish').click()
    const v = c.getByTestId('fy-verdict')
    await expect(v).toHaveAttribute('data-verdict', 'almost', { timeout: 15_000 })
    await expect(v.locator('.rt b')).toHaveText('差一点')
    await expect(c.getByTestId('fy-redo')).toHaveText('再讲这1处')
    await shot(page, 'doc-almost')
  } finally {
    await run.close()
  }
})

test('回答框左下的麦克风（④ 语音）：说的时候框变红边、字边说边出；讲完了先停下听写再交', async () => {
  test.setTimeout(120_000)
  const rt = await startFakeSonioxRt({ bytesPerChar: 4800 })
  const run = await start({ CN_SONIOX_RT_URL: rt.url, SONIOX_API_KEY: FAKE_RT_KEY, CN_FAKE_AUDIO: join(__dirname, 'fixtures/voice-zh.wav') })
  const { page } = run
  try {
    await openBoard(page, '线性代数 2.3 白板')
    for (const t of ['范数表示一个向量有多大', '按常数 α 缩放向量']) await card(page, t).click({ modifiers: ['Meta'] })
    await page.getByTestId('db-selbar').getByRole('button', { name: '费曼讲这几张' }).click()
    const c = col(page)
    await expect(c).toBeVisible({ timeout: 15_000 })
    await c.getByTestId('fy-begin').click()
    const box = c.getByTestId('fy-answer')
    await box.locator('.dict-mic').click()
    await expect(box).toHaveClass(/dict-rec/)
    await expect(box.getByTestId('dict-bar')).toContainText('听写中 · Soniox')
    await expect.poll(async () => ((await box.getByTestId('dict-live').textContent()) ?? '').length, { timeout: 10_000 }).toBeGreaterThan(6)
    await shot(page, 'doc-voice')
    // 说着就点「讲完了」：先停下听写、等最后的字定稿，再交
    await c.getByTestId('fy-send').click()
    await expect(c.getByTestId('fy-mine').first()).toContainText(FAKE_RT_TEXT.slice(0, 6), { timeout: 15_000 })
    await asked(c)
  } finally {
    await run.close()
    await rt.close()
  }
})
