/**
 * 中间栏分屏（规则 design/split/README.md）：照 VS Code、Obsidian 把中间的标签拖到边上分成两格。
 * 都是真拖（鼠标按下、挪、松开）、真按键，窗口不上屏：
 * 拖到右边缘出落点、松手两格各有标签条；拖分隔条宽度变、双击回一半；在一格里拖着换顺序、拖到另一格；拖走最后一个合回；
 * ⌃\ 分屏、⌘1 / ⌘2 换格、⌘W 关当前格的、⌘O 打开落在当前格；同一篇两格一边打字另一边跟着、看法各看各的；重开软件布局还在。
 */
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { gitStatus, launch, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const PDF = '课程/线代/第3讲.pdf'
const files = {
  [PDF]: LECTURE,
  '收件箱/甲.md': '# 甲\n\n第一段。\n',
  '收件箱/乙.md': '# 乙\n\n乙的正文。\n',
  '收件箱/丙.md': '# 丙\n\n丙的正文。\n',
}

type Box = { x: number; y: number; width: number; height: number }
const box = async (l: Locator): Promise<Box> => (await l.boundingBox())!
const mid = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const list1 = (page: Page) => page.getByTestId('tab-list')
const list2 = (page: Page) => page.getByTestId('tab-list-2')
const names = (l: Locator) => l.locator(':scope > .tab').evaluateAll((els) => els.map((e) => e.textContent ?? ''))
const tabIn = (l: Locator, name: string) => l.locator(':scope > .tab').filter({ hasText: name })
const center = (page: Page) => page.locator('main.center')
/** 第几格看得见的内容 */
const slot = (page: Page, p: 0 | 1) => page.locator(`main.center > .cslot[data-pane="${p}"]:not([hidden])`)
const cm = (page: Page, p: 0 | 1) => slot(page, p).locator('.cm-editor')
const cmText = (page: Page, p: 0 | 1) => cm(page, p).evaluate((el) => (el as HTMLElement & { cnText: string }).cnText)

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, peek?: () => Promise<void>) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y + 3, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.waitForTimeout(80)
  if (peek) await peek()
  await page.mouse.up()
  await page.waitForTimeout(150)
}

async function open(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(name)
}

test('拖标签到右边缘：出落点、松手两格；拖分隔条宽度变、双击回一半；一格里换顺序、拖到另一格；拖走最后一个合回一格', async () => {
  const run = await launch(files)
  const { page } = run
  try {
    await open(page, '甲')
    await open(page, '乙')
    await open(page, '丙')
    expect(await names(list1(page))).toEqual(['首页', '甲', '乙', '丙'])

    // 拖「乙」到中间内容的右边缘：亮「分到右边」落点（右半块），松手分成左右两格
    const c = await box(center(page))
    await drag(page, mid(await box(tabIn(list1(page), '乙'))), { x: c.x + c.width - 30, y: c.y + c.height / 2 }, async () => {
      await expect(page.getByTestId('split-mark')).toHaveText('分到右边')
      const m = await box(page.getByTestId('split-mark'))
      expect(Math.abs(m.x - (c.x + c.width / 2))).toBeLessThan(4)
      await expect(page.getByTestId('tab-ghost')).toHaveText('乙')
    })
    await expect(page.getByTestId('split-mark')).toHaveCount(0)
    await expect(center(page)).toHaveClass(/\bsplit row\b/)
    expect(await names(list1(page))).toEqual(['首页', '甲', '丙'])
    expect(await names(list2(page))).toEqual(['乙'])
    // 当前格是拖过去的那格；左边那格前面还是「丙」，标记变淡（tab-on-other）
    await expect(tabOn(page)).toHaveText('乙')
    await expect(page.getByTestId('tab-on-other')).toHaveText('丙')
    await expect(cm(page, 0)).toBeVisible()
    await expect(cm(page, 1)).toBeVisible()
    expect(await cmText(page, 0)).toContain('丙的正文')
    expect(await cmText(page, 1)).toContain('乙的正文')
    // 两格各占一半，各有自己的标签条和动作（文档 / 白板那一组在各自的标签条右端）
    const w0 = (await box(slot(page, 0))).width
    const w1 = (await box(slot(page, 1))).width
    expect(Math.abs(w0 - w1)).toBeLessThan(3)
    await expect(page.getByTestId('tab-acts').getByRole('tab', { name: '文档' })).toBeVisible()
    await expect(page.getByTestId('tab-acts-2').getByRole('tab', { name: '文档' })).toBeVisible()

    // 拖分隔条往左 150：左边那格窄 150；双击回一半
    const sash = page.getByTestId('split-sash')
    const s = mid(await box(sash))
    await drag(page, s, { x: s.x - 150, y: s.y })
    await expect.poll(async () => Math.round((await box(slot(page, 0))).width)).toBeLessThan(w0 - 140)
    expect((await box(slot(page, 1))).width).toBeGreaterThan(w1 + 140)
    await sash.dblclick()
    await expect(sash).toHaveAttribute('aria-valuenow', '50')

    // 点左边那格的内容：当前格换到左边
    await slot(page, 0).locator('.cm-content').click()
    await expect(tabOn(page)).toHaveText('丙')
    await expect(page.getByTestId('tab-on-other')).toHaveText('乙')

    // 一格里拖着换顺序：「丙」拖到「首页」前面
    await drag(page, mid(await box(tabIn(list1(page), '丙'))), { x: (await box(tabIn(list1(page), '首页'))).x + 6, y: mid(await box(tabIn(list1(page), '首页'))).y }, async () => {
      await expect(page.getByTestId('split-bar')).toBeVisible()
    })
    expect(await names(list1(page))).toEqual(['丙', '首页', '甲'])

    // 拖「甲」到右边那格的标签条上：进右边那格，排在「乙」后面，成了当前标签
    const b2 = await box(tabIn(list2(page), '乙'))
    await drag(page, mid(await box(tabIn(list1(page), '甲'))), { x: b2.x + b2.width + 20, y: b2.y + b2.height / 2 })
    expect(await names(list2(page))).toEqual(['乙', '甲'])
    expect(await names(list1(page))).toEqual(['丙', '首页'])
    await expect(tabOn(page)).toHaveText('甲')

    // 拖「首页」到右边那格的内容上：「放进这一格」
    const r = await box(slot(page, 1))
    await drag(page, mid(await box(tabIn(list1(page), '首页'))), mid(r), async () => {
      await expect(page.getByTestId('split-mark')).toHaveText('放进这一格')
    })
    expect(await names(list1(page))).toEqual(['丙'])
    expect(await names(list2(page))).toEqual(['乙', '甲', '首页'])

    // 拖走左边那格最后一个「丙」到右边：左边空了，合回一格
    const b3 = await box(tabIn(list2(page), '首页'))
    await drag(page, mid(await box(tabIn(list1(page), '丙'))), { x: b3.x + b3.width + 20, y: b3.y + b3.height / 2 })
    await expect(center(page)).not.toHaveClass(/\bsplit\b/)
    await expect(list2(page)).toHaveCount(0)
    expect(await names(list1(page))).toEqual(['乙', '甲', '首页', '丙'])
    await expect(tabOn(page)).toHaveText('丙')

    // 只剩一格时拖到边上分出来；关掉那一格的最后一个标签也合回
    const c2 = await box(center(page))
    await drag(page, mid(await box(tabIn(list1(page), '首页'))), { x: c2.x + c2.width / 2, y: c2.y + c2.height - 30 }, async () => {
      await expect(page.getByTestId('split-mark')).toHaveText('分到下半')
    })
    await expect(center(page)).toHaveClass(/\bsplit col\b/)
    expect(await names(list2(page))).toEqual(['首页'])
    await page.keyboard.press('Meta+w')
    await expect(center(page)).not.toHaveClass(/\bsplit\b/)
    expect(await names(list1(page))).toEqual(['乙', '甲', '丙'])
    // 关的是当前格的，接上的是另一格前面那个
    await expect(tabOn(page)).toHaveText('丙')
  } finally {
    await run.close()
  }
})

test('⌃\\ 分屏：同一篇两格，一边打字另一边马上跟着、只存一份；看法各看各的；⌘1 / ⌘2 换格；⌘O 打开落在当前格；PDF 能放进另一格；重开软件布局还在', async () => {
  const run = await launch(files)
  const { page, vault } = run
  const root = dirname(vault)
  try {
    await open(page, '甲')
    // ⌃\：当前标签复制一份放到右边，焦点到右边那格
    await page.keyboard.press('Control+Backslash')
    await expect(center(page)).toHaveClass(/\bsplit row\b/)
    await expect(tabOn(page)).toHaveText('甲')
    await expect(page.getByTestId('tab-on-other')).toHaveText('甲')

    // 右边这份打字：左边那份不等存盘就跟着（800ms 自动存盘之前）
    await slot(page, 1).locator('.cm-content').click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('右边打的字')
    await expect.poll(() => cmText(page, 0), { timeout: 600 }).toContain('右边打的字')
    // 左边这份接着打，右边也跟着
    await slot(page, 0).locator('.cm-content').click()
    await expect(tabOn(page)).toHaveText('甲')
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('左边也打')
    await expect.poll(() => cmText(page, 1), { timeout: 600 }).toContain('左边也打')
    // 存盘：文件里两段都有，只有这一个文件变了（没有冲突副本）
    await expect.poll(() => readFileSync(join(vault, '收件箱/甲.md'), 'utf8'), { timeout: 10_000 }).toMatch(/右边打的字[\s\S]*左边也打/)
    expect(await cmText(page, 0)).toBe(await cmText(page, 1))
    expect(gitStatus(vault).trim()).toBe('M 收件箱/甲.md')

    // 看法各看各的：右边那格换成白板，左边还是文档
    await page.keyboard.press('Meta+2')
    await page.getByTestId('tab-acts-2').getByRole('tab', { name: '白板' }).click()
    await expect(slot(page, 1).locator('[data-testid="doc-board"], [data-testid="board"]').first()).toBeVisible()
    await expect(page.getByTestId('tab-acts').getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true')
    await expect(cm(page, 0)).toBeVisible()

    // ⌘1 / ⌘2 换格
    await page.keyboard.press('Meta+1')
    await expect(page.locator('main.center > .tabs.p0')).not.toHaveClass(/\bidle\b/)
    // 键盘焦点跟着到左边那格的编辑器：接着打的字进左边
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.cslot[data-pane="0"]'))).toBe(true)
    await expect(page.locator('main.center > .tabs.p1')).toHaveClass(/\bidle\b/)
    await page.keyboard.press('Meta+2')
    await expect(page.locator('main.center > .tabs.p0')).toHaveClass(/\bidle\b/)

    // ⌘O 打开落在当前格（右边）：「乙」开在右边那格，左边那格不动
    await open(page, '乙')
    expect(await names(list2(page))).toEqual(['甲', '乙'])
    expect(await names(list1(page))).toEqual(['首页', '甲'])
    // PDF 也能放进任一格：在右边打开 PDF
    await open(page, '第3讲.pdf')
    await expect(slot(page, 1).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    expect(await names(list2(page))).toEqual(['甲', '乙', '第3讲.pdf'])
    await expect(cm(page, 0)).toBeVisible()
    // 左栏点一篇也落在当前格：⌘1 换到左边那格，点左栏的「丙」
    await page.keyboard.press('Meta+1')
    await page.locator('aside.side .nav .si').filter({ has: page.locator('.truncate', { hasText: /^丙$/ }) }).click()
    await expect(tabOn(page)).toHaveText('丙')
    expect(await names(list1(page))).toEqual(['首页', '甲', '丙'])
    await expect(page.getByTestId('tab-on-other')).toHaveText('第3讲.pdf')
    // 拖分隔条，等布局记下
    const s = mid(await box(page.getByTestId('split-sash')))
    await drag(page, s, { x: s.x + 120, y: s.y })
    const ratio = Number(await page.getByTestId('split-sash').getAttribute('aria-valuenow'))
    expect(ratio).toBeGreaterThan(55)
    await page.waitForTimeout(400)

    // 重开软件：两格、各格的标签、当前格、分隔条都照旧
    await run.close({ keep: true })
    const app2 = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: join(root, 'user-data'), CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash'), CN_ICLOUD_CONTAINER: join(root, 'icloud') },
    })
    try {
      const p2 = await app2.firstWindow()
      await expect(center(p2)).toHaveClass(/\bsplit row\b/)
      expect(await names(list1(p2))).toEqual(['首页', '甲', '丙'])
      expect(await names(list2(p2))).toEqual(['甲', '乙', '第3讲.pdf'])
      await expect(tabOn(p2)).toHaveText('丙')
      await expect(p2.getByTestId('tab-on-other')).toHaveText('第3讲.pdf')
      await expect(p2.getByTestId('split-sash')).toHaveAttribute('aria-valuenow', String(ratio))
      await expect(cm(p2, 0)).toBeVisible()
      // 合成一格（⌃\ 再按一次）：标签都在一条上
      await p2.keyboard.press('Control+Backslash')
      await expect(center(p2)).not.toHaveClass(/\bsplit\b/)
      expect(await names(list1(p2))).toEqual(['首页', '甲', '甲', '乙', '第3讲.pdf', '丙'])
    } finally {
      await app2.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

const TRIP = `# 冰岛

## 出发前

租车、机票都订好了。

## 住哪

第一晚住雷克雅未克。

## 路线

第一天：黄金圈。
`

test('对照看：一下分出右边那格用白板开同一篇；左边文档改一句右边白板那张卡跟着变；白板上挪一张卡文件只多一行位置；左边接着打的字不断；再点收回一格', async () => {
  const run = await launch({ '收件箱/冰岛.md': TRIP })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '收件箱/冰岛.md'), 'utf8')
  const acts1 = page.getByTestId('tab-acts')
  const board = slot(page, 1).getByTestId('doc-board')
  const card = (col: string, text: string) => board.getByRole('region', { name: col, exact: true }).locator('.db-card', { hasText: text })
  try {
    await open(page, '冰岛')
    await expect(cm(page, 0)).toBeVisible()
    // 笔记标签条上「对照看」：分出右边那格，用白板开同一篇；焦点还在左边的文档
    await acts1.getByRole('button', { name: '对照看：另一格用白板开这一篇' }).click()
    await expect(center(page)).toHaveClass(/\bsplit row\b/)
    await expect(tabOn(page)).toHaveText('冰岛')
    await expect(page.getByTestId('tab-on-other')).toHaveText('冰岛')
    await expect(board).toBeVisible()
    await expect(board.locator('.db-col h3 .truncate')).toHaveText(['出发前', '住哪', '路线'])
    await expect(cm(page, 0)).toBeVisible()
    await expect(acts1.getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('tab-acts-2').getByRole('tab', { name: '白板' })).toHaveAttribute('aria-selected', 'true')
    await expect(acts1.getByRole('button', { name: '收回对照' })).toHaveAttribute('aria-pressed', 'true')
    // 只是看：文件一个字都不变
    await page.waitForTimeout(1000)
    expect(file()).toBe(TRIP)

    // 左边文档改一句：右边白板那张卡跟着变（不等存盘）
    await slot(page, 0).locator('.cm-line', { hasText: '第一晚住雷克雅未克。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('第二晚住维克。', { delay: 40 })
    await expect(card('住哪', '第二晚住维克')).toBeVisible({ timeout: 1500 })
    const typed = TRIP.replace('第一晚住雷克雅未克。', '第一晚住雷克雅未克。第二晚住维克。')
    await expect.poll(file, { timeout: 10_000 }).toBe(typed)

    // 白板上把这张卡挪到空白处：文件只多一行位置，别的字节不变
    const c = await box(card('住哪', '第一晚'))
    const bb = await box(board)
    await drag(page, { x: c.x + 30, y: c.y + 16 }, { x: bb.x + bb.width / 2, y: bb.y + bb.height - 120 })
    await expect(board.locator('.db-card.placed')).toHaveCount(1)
    await expect.poll(file, { timeout: 10_000 }).toMatch(/\n<!-- card id=d1 x=\d+ y=\d+ -->\n第一晚住雷克雅未克。第二晚住维克。\n/)
    const placed = file()
    expect(placed.replace(/<!-- card id=d1 x=\d+ y=\d+ -->\n/, '')).toBe(typed)
    // 左边文档也有这一行（同一份字）
    await expect.poll(() => cmText(page, 0)).toBe(placed)

    // 回左边接着慢慢打：右边白板跟着重画，左边的字一个不少、光标在打的地方
    await slot(page, 0).locator('.cm-line', { hasText: '第一天：黄金圈。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('第二天：黑沙滩，再往东去冰河湖。', { delay: 90 })
    await expect(card('路线', '冰河湖')).toBeVisible({ timeout: 1500 })
    const more = placed.replace('第一天：黄金圈。', '第一天：黄金圈。第二天：黑沙滩，再往东去冰河湖。')
    expect(await cmText(page, 0)).toBe(more)
    const sel = await cm(page, 0).evaluate((el) => (el as HTMLElement & { cnSel: { head: number } }).cnSel.head)
    expect(sel).toBe(more.indexOf('冰河湖。') + '冰河湖。'.length)
    await expect.poll(file, { timeout: 10_000 }).toBe(more)
    expect(gitStatus(vault).trim()).toBe('M 收件箱/冰岛.md')

    // 再点「收回对照」：白板那一份关掉，合回一格
    await acts1.getByRole('button', { name: '收回对照' }).click()
    await expect(center(page)).not.toHaveClass(/\bsplit\b/)
    expect(await names(list1(page))).toEqual(['首页', '冰岛'])
    // ⌥ 点「白板」也是对照看
    await acts1.getByRole('tab', { name: '白板' }).click({ modifiers: ['Alt'] })
    await expect(center(page)).toHaveClass(/\bsplit row\b/)
    await expect(acts1.getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true')
  } finally {
    await run.close()
  }
})
