/**
 * ⌘W 关哪一栏（CN-98 方向 A「关这一格」，0.4.2 施工）：点了哪一栏就关哪一栏。
 * - 当前栏：点一下（或焦点到了）就是它；中间不是当前栏时，中间当前标签的标记变 --line2；右边一组是当前栏时它的当前标签画强调色（工作区方向 A）；左栏标题下面一道强调色。
 * - 中间、左栏：关中间的当前标签；右栏一组的当前标签是网页：关当前网页标签，最后一个关掉网页标签收起；历史、大纲、笔记、AI：收起这个标签；
 *   每次底栏一句，带「撤回」；菜单「文件 › 关闭」走同一条路。
 * - 标签都关完回到首页（用户补的），不是空白页。
 * 真点、真按键，窗口不上屏。
 */
import { expect, test, type Page } from '@playwright/test'
import { createServer, type Server } from 'node:http'
import { launch, leftView, rail, tabOn } from './app'
import { armMenus, pickMenu } from './menu'
import { LECTURE } from './fixtures/pdf'

const toast = (page: Page) => page.getByTestId('toast')
const centerTabs = (page: Page) => page.getByTestId('tab-list').getByRole('tab')
const hist = (page: Page) => page.getByRole('complementary', { name: '历史' })
const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
/** 中间当前标签的标记（主题的下沿 2px）是什么颜色；对照的强调色、--line2 */
const marks = (page: Page) =>
  page.evaluate(() => {
    const probe = (v: string) => {
      const i = document.createElement('i')
      i.style.color = `var(${v})`
      document.body.appendChild(i)
      const c = getComputedStyle(i).color
      i.remove()
      return c
    }
    const on = document.querySelector('.center .tabs .tab.on')
    return { tab: on ? getComputedStyle(on, '::before').backgroundColor : null, acc: probe('--acc'), line2: probe('--line2') }
  })
/** 右边一组的标签（工作区方向 A）当前那个底边那道标记的颜色 */
const tabMark = (page: Page, v: string) => page.getByTestId(`dtab-${v}`).evaluate((e) => getComputedStyle(e, '::after').backgroundColor)
/** 当前栏是右边的一组（组的 id：g1、g2……） */
const GROUP = /^[gf]\d+$/
async function open(page: Page, name: string) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(150)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(new RegExp(name))
}

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const t = req.url === '/b' ? '乔治·赫伯特·沃克·布什' : '趣说明朝276年'
    res.end(`<title>${t}</title><body style="font:16px sans-serif;padding:20px"><h1>${t}</h1><p>正文。</p></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

test('点历史空白处按 ⌘W：收起历史，中间的标签不动；撤回回来；点左栏再按 ⌘W 关中间的当前标签；中间不是当前栏时标记变灰、历史标签的标记是强调色', async () => {
  const run = await launch({ '冰岛行程.md': '# 冰岛行程\n\n第一天。\n', '冰岛旅游 3.md': '# 冰岛旅游 3\n\n正文。\n' })
  const { page } = run
  try {
    await open(page, '冰岛行程')
    await open(page, '冰岛旅游 3')
    // 中间是当前栏：标记是强调色
    let m = await marks(page)
    expect(m.tab).toBe(m.acc)
    // 打开历史、点它的空白处：历史那一组成了当前栏，中间的标记变灰，历史标签的标记是强调色（没有标签的格子才另画一道）
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hb = (await hist(page).boundingBox())!
    await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height - 40)
    await expect(page.locator('.win')).toHaveAttribute('data-pane', GROUP)
    m = await marks(page)
    expect(m.tab).toBe(m.line2)
    expect(await tabMark(page, 'history')).toBe(m.acc)
    await expect(page.getByTestId('pane-mark')).toBeHidden()
    // ⌘W：历史收起，中间的标签还在
    await page.keyboard.press('Meta+w')
    await expect(hist(page)).toHaveCount(0)
    await expect(centerTabs(page)).toHaveCount(3)
    await expect(tabOn(page)).toHaveText('冰岛旅游 3')
    await expect(toast(page)).toContainText('收起了「历史」')
    // 撤回：历史回来
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(hist(page)).toBeVisible()
    // 历史这一格收起以后当前栏回到中间：标记又是强调色
    await page.keyboard.press('Meta+w')
    await expect(hist(page)).toHaveCount(0)
    m = await marks(page)
    expect(m.tab).toBe(m.acc)

    // 点左栏再按 ⌘W：关的是中间的当前标签，左栏不动（目录树里点开一篇时焦点进了那篇，也是关它）
    await leftView(page, '文件')
    await page.getByRole('tree', { name: '全部文件' }).getByRole('treeitem').filter({ hasText: '冰岛行程' }).click()
    await expect(tabOn(page)).toHaveText('冰岛行程')
    const side = (await page.getByRole('complementary', { name: '文件' }).boundingBox())!
    await page.mouse.click(side.x + side.width / 2, side.y + side.height - 60)
    await expect(page.locator('.win')).toHaveAttribute('data-pane', 'left')
    await expect(page.getByTestId('pane-mark')).toBeVisible()
    m = await marks(page)
    expect(m.tab).toBe(m.line2)
    await page.keyboard.press('Meta+w')
    await expect(centerTabs(page)).toHaveCount(2)
    await expect(toast(page)).toContainText('关掉了「冰岛行程」')
    await expect(page.getByRole('complementary', { name: '文件' })).toBeVisible()
    // ⌘Z 不当成点「撤回」（留给文档里撤字）：按了标签也不回来，撤回按钮上也不写 ⌘Z
    await expect(toast(page).getByRole('button', { name: '撤回' })).not.toHaveAttribute('data-key', /./)
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(300)
    await expect(centerTabs(page)).toHaveCount(2)
    // 撤回：放回原来的位置、切过去
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(centerTabs(page)).toHaveText(['首页', '冰岛行程', '冰岛旅游 3'])
    await expect(tabOn(page)).toHaveText('冰岛行程')
  } finally {
    await run.close()
  }
})

test('读 PDF 时在右栏下格「笔记」里按 ⌘W：只收起笔记，PDF 还在；菜单「文件 › 关闭」走同一条路', async () => {
  const run = await launch({ '课程/线性代数/第3讲 线性映射.pdf': LECTURE }, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await open(page, '第3讲 线性映射')
    await rail(page).getByRole('button', { name: /^笔记/ }).click()
    await expect(notes(page)).toBeVisible()
    const nb = (await notes(page).boundingBox())!
    await page.mouse.click(nb.x + nb.width / 2, nb.y + nb.height / 2)
    await expect(page.locator('.win')).toHaveAttribute('data-pane', GROUP)
    await page.keyboard.press('Meta+w')
    await expect(notes(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await expect(toast(page)).toContainText('收起了「笔记」')
    // 用鼠标也能收起：笔记标签上的 ×（悬停才出来）
    await rail(page).getByRole('button', { name: /^笔记/ }).click()
    await expect(notes(page)).toBeVisible()
    await page.getByTestId('dtab-note').hover()
    await page.getByTestId('dtab-note').getByRole('button', { name: '收起笔记' }).click()
    await expect(notes(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')

    // 菜单「文件 › 关闭」：点了历史的空白处再从菜单关，收起的是历史，PDF 不动
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hb = (await hist(page).boundingBox())!
    await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height - 40)
    await app.evaluate(({ Menu }) => {
      const file = Menu.getApplicationMenu()!.items.find((i) => i.label === '文件')!
      file.submenu!.items.find((i) => i.label === '关闭')!.click()
    })
    await expect(hist(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    // 菜单这一项写着 ⌘W，不是系统的「关闭窗口」
    expect(await app.evaluate(({ Menu }) => {
      const it = Menu.getApplicationMenu()!.items.find((i) => i.label === '文件')!.submenu!.items.find((i) => i.label === '关闭')!
      return { role: it.role ?? null, accel: it.accelerator ?? null }
    })).toEqual({ role: null, accel: 'CommandOrControl+W' })
    // 中间是当前栏时从菜单关：关中间的当前标签，关完回首页
    await page.locator('.center').click({ position: { x: 300, y: 300 } })
    await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find((i) => i.label === '文件')!.submenu!.items.find((i) => i.label === '关闭')!.click())
    await expect(centerTabs(page)).toHaveText(['首页'])
  } finally {
    await run.close()
  }
})

test('右栏网页：点网页标签条按两次 ⌘W，两个网页标签一个个关掉，最后一个关掉网页这格收起；撤回放回来；焦点在网页里 ⌘W 也一样', async () => {
  const run = await launch({ 'a.md': '# a\n\n正文。\n' })
  const { page } = run
  try {
    await open(page, 'a')
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/a`)
    await addr.press('Enter')
    await expect(webTabs(page).first()).toContainText('趣说明朝276年')
    await web(page).getByRole('button', { name: '新网页' }).click()
    await addr.fill(`${base}/b`)
    await addr.press('Enter')
    await expect(webTabs(page)).toHaveCount(2)
    await expect(webTabs(page).nth(1)).toContainText('乔治')
    // 网页这一格是当前栏；当前网页标签照旧不画彩色标记（CN-15：用户说过右栏网页标签的蓝线没必要），中间的标记变灰
    await expect(page.locator('.win')).toHaveAttribute('data-pane', GROUP)
    expect(await webTabs(page).nth(1).evaluate((t) => getComputedStyle(t, '::before').content)).toBe('none')
    const m = await marks(page)
    expect(m.tab).toBe(m.line2)
    // 点网页标签条的空处（地址栏不在焦点上），按 ⌘W：关掉「乔治…」
    await web(page).getByRole('tablist', { name: '网页标签' }).click({ position: { x: 300, y: 10 } })
    await page.keyboard.press('Meta+w')
    await expect(webTabs(page)).toHaveCount(1)
    await expect(toast(page)).toContainText('关掉了网页「乔治·赫伯特·沃克·布什」')
    await expect(page.getByTestId('tab-list').getByRole('tab')).toHaveCount(2)
    // 先点一下中间（当前栏回到中间），再点进网页正文：焦点进了网页，右栏上格又是当前栏
    await page.locator('.center').click({ position: { x: 300, y: 300 } })
    await expect(page.locator('.win')).toHaveAttribute('data-pane', 'center')
    const box = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.click(box.x + 200, box.y + 160)
    await expect(page.locator('.win')).toHaveAttribute('data-pane', GROUP)
    // 焦点在网页里再按：关掉最后一个，网页这格收起
    await page.keyboard.press('Meta+w')
    await expect(web(page)).toBeHidden()
    await expect(toast(page)).toContainText('关掉了网页「趣说明朝276年」，网页标签收起了')
    await expect(page.locator('.win')).not.toHaveClass(/with-right/)
    await expect(page.getByTestId('tab-list').getByRole('tab')).toHaveCount(2)
    // 撤回：网页这格回来，标签也回来
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(web(page)).toBeVisible()
    await expect(webTabs(page)).toHaveCount(1)
    await expect(webTabs(page).first()).toContainText('趣说明朝276年')
  } finally {
    await run.close()
  }
})

test('标签都关完回首页；右键「关闭全部」也是；只剩首页时 ⌘W 不关；右栏 AI 那一格里按 ⌘W 收起 AI', async () => {
  const run = await launch({ '甲.md': '# 甲\n\n正文。\n', '乙.md': '# 乙\n\n正文。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await armMenus(run)
    await open(page, '甲')
    await open(page, '乙')
    await page.locator('.center').click({ position: { x: 400, y: 300 } })
    for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+w')
    await expect(centerTabs(page)).toHaveText(['首页'])
    await expect(tabOn(page)).toHaveText('首页')
    await expect(page.locator('.center .empty')).toHaveCount(0)
    // 只剩首页：⌘W 不关；它上面也不画 ×（点了也关不掉的按钮不放）
    await page.keyboard.press('Meta+w')
    await expect(centerTabs(page)).toHaveText(['首页'])
    await expect(centerTabs(page).getByRole('button', { name: '关闭标签' })).toHaveCount(0)
    // 右键「关闭全部」：回到首页
    await open(page, '甲')
    // 又开了别的：首页的 × 回来
    await expect(centerTabs(page).filter({ hasText: '首页' }).getByRole('button', { name: '关闭标签' })).toHaveCount(1)
    await open(page, '乙')
    await centerTabs(page).filter({ hasText: '乙' }).click({ button: 'right' })
    await pickMenu(run, '关闭全部')
    await expect(centerTabs(page)).toHaveText(['首页'])

    // AI 标签（工作区方向 A：右栏里的一个标签）：点进去按 ⌘W 收起它，首页不动；撤回又开着
    await page.keyboard.press('Meta+j')
    const ai = page.getByRole('complementary', { name: 'AI 对话' })
    await expect(ai).toBeVisible()
    await ai.getByRole('textbox').click()
    await expect(page.locator('.win')).toHaveAttribute('data-pane', GROUP)
    expect(await tabMark(page, 'ai')).toBe((await marks(page)).acc)
    await page.keyboard.press('Meta+w')
    await expect(ai).toBeHidden()
    await expect(toast(page)).toContainText('收起了「AI」')
    await expect(centerTabs(page)).toHaveText(['首页'])
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(ai).toBeVisible()
  } finally {
    await run.close()
  }
})
