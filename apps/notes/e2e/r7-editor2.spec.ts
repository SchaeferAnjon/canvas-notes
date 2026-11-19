/**
 * 第 7 轮 · 文档编辑器（二）：CN-115 输入法组字时回车交给输入法、CN-12 旧「未命名」跟标题改名、标题下一行（文件夹 · 改于 · 字数）、
 * 新建笔记的灰字、[[白板]] 画成白板卡、⌘ 点链接在右栏网页开、选了字右键菜单写快捷键并分组、拖块时原块变淡和拖影跟手。
 * 都在测试模式里真点、真打字、真拖、真右键。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { acts, launch, leftView, openNote, pane, tabOn, waitSaved } from './app'
import { armMenus, openedMenu } from './menu'

const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()
const read = (vault: string, name: string) => readFileSync(join(vault, name), 'utf8')

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    res.end('<title>黄金圈 - 维基百科</title><body><p>黄金圈</p></body>')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

test('CN-115 输入法还在组字时按回车：不建文件夹，输入框还开着；上屏后回车才建成「ecp」', async () => {
  const run = await launch({ '课程/线代.md': '# 线代\n' })
  const { page, vault } = run
  try {
    await leftView(page, '文件')
    await page.locator('aside.side .vh').getByRole('button', { name: '新建文件夹' }).click()
    const input = page.locator('aside.side').getByRole('textbox', { name: '新文件夹的名字' })
    await expect(input).toBeFocused()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: "e'c'p", selectionStart: 5, selectionEnd: 5 })
    await page.keyboard.press('Enter')
    await page.waitForTimeout(400)
    await expect(input).toBeVisible()
    expect(existsSync(join(vault, "e'c'p"))).toBe(false)
    // 上屏「ecp」，再回车：建成
    await cdp.send('Input.insertText', { text: 'ecp' })
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(vault, 'ecp/.gitkeep'))).toBe(true)
    expect(existsSync(join(vault, "e'c'p"))).toBe(false)
  } finally {
    await run.close()
  }
})

test('CN-12 文件名还是软件起的「未命名」：打开时标题已经不是「未命名」就按标题改一次名，链接跟着改、一次提交；自己起过名的不动', async () => {
  const run = await launch({
    '收件箱/未命名.md': '# 冰岛旅游2\n\n去冰岛。\n',
    '收件箱/未命名 2.md': '# 未命名 2\n\n还没写。\n',
    '收件箱/旅行.md': '# 冰岛之行\n\n另一篇。\n',
    '收件箱/目录.md': '# 目录\n\n见 [[未命名]]。\n',
  })
  const { page, vault } = run
  const log = () => execFileSync('git', ['-C', vault, 'log', '--format=%s'], { encoding: 'utf8' }).trim().split('\n')
  try {
    const before = log().length
    // 左栏点开「未命名」：一打开标签就换成标题的名字
    await page.locator('.nav .si', { has: page.locator('.truncate', { hasText: /^未命名$/ }) }).click()
    await expect(tabOn(page)).toHaveText('冰岛旅游2')
    await expect.poll(() => existsSync(join(vault, '收件箱/冰岛旅游2.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/未命名.md'))).toBe(false)
    await expect(page.getByTestId('toast')).toContainText('《未命名》按第一行标题改名为《冰岛旅游2》')
    await expect.poll(() => read(vault, '收件箱/目录.md')).toBe('# 目录\n\n见 [[冰岛旅游2]]。\n')
    // 改名和链接跟着改是同一件事：「现在提交」只出一条提交，git 认得是改名
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('现在提交')
    await page.keyboard.press('Enter')
    await expect.poll(() => log().length).toBe(before + 1)
    const changed = execFileSync('git', ['-C', vault, '-c', 'core.quotePath=false', 'show', '-M', '--name-status', '--format=', 'HEAD'], { encoding: 'utf8' })
    expect(changed).toMatch(/^R\d+\t收件箱\/未命名\.md\t收件箱\/冰岛旅游2\.md$/m)
    expect(changed).toMatch(/^M\t收件箱\/目录\.md$/m)
    // 第二篇标题还是「未命名 2」、第三篇是用户自己起的名：都不动
    await openNote(page, '未命名 2')
    await openNote(page, '旅行')
    await page.waitForTimeout(800)
    expect(existsSync(join(vault, '收件箱/未命名 2.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/旅行.md'))).toBe(true)
  } finally {
    await run.close()
  }
})

test('标题下一行：「文件夹 ▾ · 改于… · N 字」；新建笔记写「刚建 · 0 字」，正文位置一行灰字', async () => {
  const run = await launch({ '写作/所思所想.md': '# 所思所想\n\n财富是靠专长挣来的。Seek wealth.\n' })
  const { page } = run
  try {
    await openNote(page, '所思所想')
    const meta = pane(page).locator('.cm-meta')
    await expect(meta.locator('.cm-folder')).toHaveText('写作')
    await expect(meta.locator('.cm-meta-rest')).toHaveText(/^ · 改于今天 \d\d:\d\d · 11 字$/)
    // 新建一篇：刚建 · 0 字，正文位置是「回车开始写正文；标题改了，文件名和标签跟着改」
    await page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' }).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect(pane(page).locator('.cm-meta-rest')).toHaveText(' · 刚建 · 0 字')
    await expect(pane(page).locator('.cm-tailline')).toHaveText('回车开始写正文；标题改了，文件名和标签跟着改')
    await page.keyboard.type('冰岛旅游 3')
    await page.keyboard.press('Enter')
    // 光标进了正文那一行：灰字换成「输入 / 插入块，或者直接写」
    await expect(pane(page).locator('.cm-tailline')).toHaveText('输入 / 插入块，或者直接写')
    await page.keyboard.type('第一天')
    await expect(pane(page).locator('.cm-meta-rest')).toContainText('3 字')
  } finally {
    await run.close()
  }
})

test('独占一行的 [[白板]] 画成白板卡（颜色方块、名字、「白板 · N 张卡片 · 点开在新标签」），点了开那块白板', async () => {
  const board = '---\ntype: board\n---\n# 冰岛自驾\n\n<!-- card id=a1 x=0 y=0 -->\n住哪\n\n<!-- card id=a2 x=300 y=0 -->\n吃什么\n'
  const run = await launch({ '冰岛自驾.md': board, '游记.md': '# 游记\n\n要去的地方：\n\n[[冰岛自驾]]\n\n路上记一笔。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '游记')
    const card = pane(page).locator('[data-part="白板链接"]')
    await expect(card).toBeVisible()
    await expect(card.locator('b')).toHaveText('冰岛自驾')
    await expect(card.locator('.tx > span')).toHaveText('白板 · 2 张卡片 · 点开在新标签')
    // 撑满版心
    const w = (await card.boundingBox())!.width
    const content = (await pane(page).locator('.cm-content').boundingBox())!.width
    expect(Math.abs(w - content)).toBeLessThan(2)
    await card.click()
    await expect(tabOn(page)).toHaveText('冰岛自驾')
    expect(read(vault, '游记.md')).toBe('# 游记\n\n要去的地方：\n\n[[冰岛自驾]]\n\n路上记一笔。\n')
  } finally {
    await run.close()
  }
})

test('⌘ 点链接在右栏网页开（同一个网址开着就切过去），⌘⌥ 点在中间栏开；普通点光标进字里；按住 ⌘ 链接变色', async () => {
  const run = await launch({ '游记.md': `# 游记\n\n第二天走[黄金圈](${base}/golden)。\n\n最后一段。\n` })
  const { page } = run
  try {
    await openNote(page, '游记')
    const link = pane(page).locator('.cm-link', { hasText: '黄金圈' })
    // 普通点：光标进字里，不开网页
    await link.click()
    await expect(page.getByRole('complementary', { name: '网页' })).toHaveCount(0)
    // 按住 ⌘：变 --acc-t
    await page.keyboard.down('Meta')
    await link.hover()
    await expect(pane(page).locator('.cm-editor')).toHaveClass(/cn-meta/)
    await link.click({ modifiers: ['Meta'] })
    await page.keyboard.up('Meta')
    const web = page.getByRole('complementary', { name: '网页' })
    await expect(web).toBeVisible()
    await expect(web.getByRole('textbox', { name: '网址' })).toHaveValue(new RegExp(`${base.replace('http://', '')}/golden$`))
    const tabs = await web.getByRole('tab').count()
    // 再 ⌘ 点同一个：不重复开
    await link.click({ modifiers: ['Meta'] })
    await page.waitForTimeout(500)
    expect(await web.getByRole('tab').count()).toBe(tabs)
    // ⌘⌥ 点：中间栏开一个网页标签
    await link.click({ modifiers: ['Meta', 'Alt'] })
    await expect(tabOn(page)).toContainText('黄金圈')
  } finally {
    await run.close()
  }
})

test('选了字右键：加粗 ⌘B、斜体 ⌘I、加链接 ⌘K 写着快捷键，和「转成」隔开；选了字按 ⌘K 就是加链接', async () => {
  const run = await launch({ '游记.md': '# 游记\n\n第二天走黄金圈。\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '游记')
    await line(page, '第二天').click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft')
    await line(page, '第二天').click({ button: 'right', position: { x: 60, y: 10 } })
    const m = await openedMenu(run)
    const labels = m.map((i) => i.label)
    const at = (l: string) => labels.indexOf(l)
    expect(labels.slice(at('加粗'), at('加链接') + 1)).toEqual(['加粗', '斜体', '高亮', '加链接'])
    expect(labels[at('加链接') + 1]).toBe('—')
    expect(labels[at('加链接') + 2]).toBe('转成')
    // 快捷键写在右边（读系统菜单项的 accelerator）
    const accels = await run.app.evaluate(() => {
      const g = globalThis as unknown as { cnMenu: { menu: Electron.Menu } | null }
      return Object.fromEntries(g.cnMenu!.menu.items.filter((i) => ['加粗', '斜体', '加链接'].includes(i.label)).map((i) => [i.label, String(i.accelerator ?? '')]))
    })
    expect(accels).toEqual({ 加粗: 'CommandOrControl+B', 斜体: 'CommandOrControl+I', 加链接: 'CommandOrControl+K' })
    await page.keyboard.press('Escape')
    // 选了字按 ⌘K：加链接（剪贴板里是网址就直接用），不弹搜索
    await run.app.evaluate(({ clipboard }) => clipboard.writeText('https://zh.wikipedia.org/wiki/x'))
    await line(page, '第二天').click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Meta+k')
    await expect.poll(() => read(vault, '游记.md')).toBe('# 游记\n\n第二天走[黄金圈](https://zh.wikipedia.org/wiki/x)。\n')
    await expect(page.getByRole('dialog', { name: /搜索/ })).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('拖一块：原块变淡（保持选中底）、拖影跟着鼠标（略歪、一行字）、落点线；松手块挪过去', async () => {
  const md = '# 清单\n\n第一段\n\n第二段\n\n第三段\n'
  const run = await launch({ '清单.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '清单')
    const box = (await line(page, '第一段').boundingBox())!
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.move(box.x + 60, box.y + box.height / 2)
    const grip = pane(page).locator('.blk-bar:not([hidden]) .blk-grip')
    await expect(grip).toBeVisible()
    const g = (await grip.boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    const t = (await line(page, '第三段').boundingBox())!
    await page.mouse.move(g.x + 40, t.y - 6, { steps: 8 })
    await page.mouse.move(t.x + 80, t.y + t.height - 2, { steps: 6 })
    const ghost = page.getByTestId('blk-ghost')
    await expect(ghost).toHaveText('第一段')
    const gb = (await ghost.boundingBox())!
    // 拖影在鼠标右边 14
    expect(Math.round(gb.x - (t.x + 80))).toBe(14)
    expect(await ghost.evaluate((e) => getComputedStyle(e).transform)).not.toBe('none')
    // 原来那块变淡
    expect(await line(page, '第一段').evaluate((e) => getComputedStyle(e).opacity)).toBe('0.3')
    await expect(pane(page).locator('.blk-drop')).toBeVisible()
    await page.mouse.up()
    await expect(ghost).toHaveCount(0)
    await waitSaved(page)
    expect(read(vault, '清单.md')).toBe('# 清单\n\n第二段\n\n第三段\n\n第一段\n')
    await expect(acts(page).getByTestId('save-state')).toHaveAttribute('data-state', 'saved')
  } finally {
    await run.close()
  }
})

test('竖向疏密照小样：两块之间 12、二级标题上 26 下 10、元信息行到正文 26；光标停在空行上这一行一整行高；代码块里的空行不压；文件不变', async () => {
  const md = '# 疏密\n\n第一段。\n\n第二段。\n\n## 小节\n\n第三段。\n\n```js\nconst a = 1\n\nconst b = 2\n```\n\n最后一段。\n'
  const run = await launch({ '疏密.md': md })
  const { page, vault } = run
  const box = async (t: string) => (await line(page, t).boundingBox())!
  const gap = async (a: string, b: string) => {
    const x = await box(a)
    const y = await box(b)
    return Math.round(y.y - (x.y + x.height))
  }
  try {
    await openNote(page, '疏密')
    await page.locator('.cm-content').first().evaluate((e) => (e as HTMLElement).blur())
    expect(await gap('第一段', '第二段')).toBe(12)
    expect(await gap('第二段', '小节')).toBe(26)
    expect(await gap('小节', '第三段')).toBe(10)
    const meta = (await pane(page).locator('.cm-meta').boundingBox())!
    expect(Math.round((await box('第一段')).y - (meta.y + meta.height))).toBe(26)
    // 代码块里的空行是代码：照常一整行
    expect(await gap('const a = 1', 'const b = 2')).toBeGreaterThan(18)
    // 点进第一段和第二段之间的空行：这一行恢复一整行高，好在这里打字
    const first = await box('第一段')
    await page.mouse.click(first.x + 30, first.y + first.height + 6)
    await expect.poll(() => gap('第一段', '第二段')).toBeGreaterThan(25)
    await page.keyboard.type('插一段')
    await waitSaved(page)
    expect(read(vault, '疏密.md')).toBe(md.replace('第一段。\n\n', '第一段。\n插一段\n'))
  } finally {
    await run.close()
  }
})

test('勾上的待办：字末尾打一个字再退格只删这一个字（原来整条字被当成一整颗，退格一下全没了）', async () => {
  const md = '# 任务\n\n- [ ] 车\n- [x] 机票\n'
  const run = await launch({ '任务.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '任务')
    const done = line(page, '机票')
    await expect(done.locator('.cm-task-done')).toHaveText('机票')
    const b = (await done.boundingBox())!
    await page.mouse.click(b.x + b.width - 4, b.y + b.height / 2)
    await page.keyboard.press('End')
    await page.keyboard.type('x')
    await waitSaved(page)
    expect(read(vault, '任务.md')).toBe('# 任务\n\n- [ ] 车\n- [x] 机票x\n')
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(read(vault, '任务.md')).toBe(md)
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(read(vault, '任务.md')).toBe('# 任务\n\n- [ ] 车\n- [x] 机\n')
  } finally {
    await run.close()
  }
})
