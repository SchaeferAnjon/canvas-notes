// 左栏和文件树（录屏 G1 组的直接修）：课程列表右键（CN-1）、课程名双击改名、有文件的也能改、链接跟着改（CN-3）、
// 文件树工具栏和新建文件夹（CN-5）、左栏拖宽（CN-7）、第一行标题就是文件名（CN-12）、底栏库名只显示（CN-50），
// 图标栏亮着的那格不加底块（图标别做白底突起块）；白板颜色方块和 PDF、HTML 小标（CN-8）、白板缩放（CN-20）、新建笔记放哪（CN-11）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, gitStatus, launch, leftView, pane, tabOn, waitSaved, type Running } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { ICELAND } from './fixtures/board'

const settings = (appearance: Record<string, unknown>) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...appearance } }))
}
const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen)
const lastCommit = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()
const side = (page: Page) => page.locator('aside.side')
const sideRow = (page: Page, name: string) => side(page).locator('.nav .si', { has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const item = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })

const COURSE = {
  '课程/ecp/Lecture05.pdf': '%PDF-1.4\n',
  '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n\n[第 5 页](Lecture05.pdf#page=5)\n',
  "课程/e'c'p/草稿.md": '# 草稿\n',
  '复习.md': '# 复习\n\n[[课程/ecp/Lecture05 笔记]] · [讲义](课程/ecp/Lecture05.pdf#page=2)\n',
  '写作/去冰岛之前.md': '# 去冰岛之前\n',
  '生活/日记.md': '# 日记\n',
}

test('CN-1、CN-3：课程列表右键有菜单；有文件的课程改名，链接跟着改、点得开；首页标题双击改名；生活、写作不改名；删课程先确认', async () => {
  const run = await launch(COURSE)
  const { page, vault } = run
  try {
    await armMenus(run)
    await leftView(page, '课程')
    await sideRow(page, 'ecp').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['新建笔记', '新建白板', '新建文件夹', '打开首页', '在新标签打开首页', '钉到最上面', '放到左边', '换图标和颜色…', '重命名…', '移到…', '在访达中显示', '拷贝路径', '移到废纸篓'])
    await pickMenu(run, '在访达中显示')
    await expect.poll(() => screen(run)).toContain(`在访达中显示 ${join(vault, '课程/ecp')}`)

    // 右键「重命名」：原地改，文件夹、链接、左栏一起变
    await sideRow(page, 'ecp').click({ button: 'right' })
    await pickMenu(run, '重命名…')
    const input = side(page).getByRole('textbox', { name: '新名字' })
    await expect(input).toBeFocused()
    await input.fill('ECP 经济学')
    await input.press('Enter')
    await expect.poll(() => existsSync(join(vault, '课程/ECP 经济学/Lecture05.pdf'))).toBe(true)
    expect(existsSync(join(vault, '课程/ecp'))).toBe(false)
    await expect(sideRow(page, 'ECP 经济学')).toBeVisible()
    await expect(page.getByTestId('toast')).toContainText('链接一起改好了')
    expect(readFileSync(join(vault, '复习.md'), 'utf8')).toBe('# 复习\n\n[[课程/ECP 经济学/Lecture05 笔记]] · [讲义](课程/ECP%20经济学/Lecture05.pdf#page=2)\n')
    expect(lastCommit(vault)).toBe('文件夹改名：课程/ecp → 课程/ECP 经济学')
    expect(gitStatus(vault)).toBe('')

    // 改完以后从复习里 ⌘ 点带路径的双链，打得开
    await leftView(page, '文件')
    await item(page, '复习').click()
    await expect(tabOn(page)).toHaveText('复习')
    await pane(page).locator('.cm-wikilink').first().click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('Lecture05 笔记')

    // 首页的大标题双击改名
    await leftView(page, '课程')
    await sideRow(page, 'ECP 经济学').click()
    await expect(tabOn(page)).toHaveText('ECP 经济学')
    await pane(page).locator('h2', { hasText: 'ECP 经济学' }).dblclick()
    const name = page.getByRole('textbox', { name: '文件夹名字' })
    await expect(name).toBeFocused()
    await name.fill('ECP')
    await name.press('Enter')
    await expect(tabOn(page)).toHaveText('ECP')
    await expect.poll(() => readdirSync(join(vault, '课程')).sort()).toEqual(['ECP', "e'c'p"])
    // 开着的笔记标签跟着换了路径
    await page.getByRole('tab', { name: /Lecture05 笔记/ }).getByRole('button').first().click()
    await expect(page.locator('.pane:not([hidden])')).toHaveAttribute('data-path', '课程/ECP/Lecture05 笔记.md')

    // 文件夹标签上 F2 也能改（焦点在树上时 F2 是树里原地改名）
    await sideRow(page, 'ECP').click()
    await page.locator('.tab.on .tl').click()
    await page.keyboard.press('F2')
    await expect(page.getByRole('textbox', { name: '文件夹名字' }).first()).toBeVisible()
    await page.keyboard.press('Escape')

    // 生活、写作是软件自带的分类：双击说一句，不进改名（写作从「文件」里开）；分类默认在左边，右键是「从左边拿下」
    await leftView(page, '文件')
    await item(page, '写作').click()
    await expect(tabOn(page)).toHaveText('写作')
    await pane(page).locator('h2', { hasText: '写作' }).dblclick()
    await expect(page.getByTestId('toast')).toContainText('「写作」是软件自带的分类，不改名')
    await expect(page.getByRole('textbox', { name: '文件夹名字' })).toHaveCount(0)
    await item(page, '写作').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['新建笔记', '新建白板', '新建文件夹', '打开首页', '在新标签打开首页', '钉到最上面', '从左边拿下', '换图标和颜色…', '在访达中显示', '拷贝路径'])
    await pickMenu(run, '打开首页')
    await leftView(page, '课程')

    // 删 e'c'p：先弹确认（测试模式记下「提示框」、当成点了「移到废纸篓」），删完一次提交
    await sideRow(page, "e'c'p").click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect(sideRow(page, "e'c'p")).toHaveCount(0)
    expect(await screen(run)).toContain('提示框')
    expect(existsSync(join(vault, "课程/e'c'p"))).toBe(false)
    expect(readdirSync(run.trash)).toHaveLength(1)
    expect(lastCommit(vault)).toBe("移到废纸篓：课程/e'c'p（1 个文件）")
    await expect(page.getByTestId('toast')).toContainText('历史里能撤回')
  } finally {
    await run.close()
  }
})

test('CN-5：文件树工具栏六个按钮；在选中的文件夹里新建文件夹（.gitkeep、一次提交）；排序、全部收起、显示当前文件；文件夹右键改名和删除', async () => {
  const run = await launch(COURSE, {}, (vault) => {
    // 写作里两篇的修改时间：去冰岛之前 旧、行前清单 新
    writeFileSync(join(vault, '写作/行前清单.md'), '# 行前清单\n')
    const t = Date.now() / 1000
    utimesSync(join(vault, '写作/去冰岛之前.md'), t - 86400, t - 86400)
    utimesSync(join(vault, '写作/行前清单.md'), t, t)
  })
  const { page, vault } = run
  try {
    await armMenus(run)
    await leftView(page, '文件')
    const head = side(page).locator('.vh')
    expect(await head.getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))).toEqual(['新建笔记', '新建文件夹', '新建白板', '定位当前文件', '排序', '全部收起'])

    // 点「写作」（选中它），新建文件夹 → 写作/旅行
    await item(page, '写作').click()
    await head.getByRole('button', { name: '新建文件夹' }).click()
    const input = tree(page).getByRole('textbox', { name: '新文件夹的名字' })
    await expect(input).toBeFocused()
    await input.fill('旅行')
    await input.press('Enter')
    await expect(item(page, '旅行')).toBeVisible()
    expect(readdirSync(join(vault, '写作/旅行'))).toEqual(['.gitkeep'])
    expect(lastCommit(vault)).toBe('新建文件夹：写作/旅行')
    expect(gitStatus(vault)).toBe('')

    // 排序：菜单打钩，换成按修改时间后写作里新的在前
    const names = () => tree(page).getByRole('treeitem').evaluateAll((els) => els.map((e) => e.querySelector('.truncate')?.textContent?.trim()))
    expect((await names()).join('|')).toContain('旅行|去冰岛之前|行前清单')
    await head.getByRole('button', { name: '排序' }).click()
    const sortMenu = page.getByRole('dialog', { name: '排序' })
    await expect(sortMenu.getByRole('menuitem', { name: '名字 A → Z' }).locator('svg')).toHaveCount(1)
    await sortMenu.getByRole('menuitem', { name: '修改时间 新的在前' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await names()).join('|')).toContain('旅行|行前清单|去冰岛之前')

    // 开一篇课程里的（课程默认展开着），全部收起，再「显示当前文件」展开到它
    // （一个 PDF 一篇笔记：Lecture05 和它的笔记是一行，点它开 PDF）
    await tree(page).getByRole('button', { name: '展开 ecp' }).click()
    await item(page, 'Lecture05').first().click()
    await expect(tabOn(page)).toHaveText('Lecture05.pdf')
    await head.getByRole('button', { name: '全部收起' }).click()
    await expect(tree(page).locator('.ft-root')).toHaveAttribute('aria-expanded', 'true')
    await expect(tree(page).locator('.ft-row:not(.ft-root)[aria-expanded="true"]')).toHaveCount(0)
    await expect(item(page, 'Lecture05')).toHaveCount(0)
    await head.getByRole('button', { name: '定位当前文件' }).click()
    await expect(item(page, 'Lecture05').first()).toBeVisible()

    // 文件夹右键：固定的没有重命名、删除；别的有，还能原地新建文件夹
    await item(page, '课程').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['新建笔记', '新建白板', '新建文件夹', '打开首页', '在新标签打开首页', '钉到最上面', '从左边拿下', '换图标和颜色…', '在访达中显示', '拷贝路径'])
    await pickMenu(run, '新建文件夹')
    await tree(page).getByRole('textbox', { name: '新文件夹的名字' }).fill('数学')
    await tree(page).getByRole('textbox', { name: '新文件夹的名字' }).press('Enter')
    await expect.poll(() => existsSync(join(vault, '课程/数学/.gitkeep'))).toBe(true)
    await tree(page).getByRole('button', { name: '展开 写作' }).click()
    await item(page, '旅行').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['新建笔记', '新建白板', '新建文件夹', '打开首页', '在新标签打开首页', '钉到最上面', '放到左边', '换图标和颜色…', '重命名…', '移到…', '在访达中显示', '拷贝路径', '移到废纸篓'])
    await pickMenu(run, '重命名…')
    await tree(page).getByRole('textbox', { name: '新名字' }).fill('冰岛')
    await tree(page).getByRole('textbox', { name: '新名字' }).press('Enter')
    await expect(item(page, '冰岛')).toBeVisible()
    expect(existsSync(join(vault, '写作/冰岛/.gitkeep'))).toBe(true)
    await item(page, '冰岛').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect(item(page, '冰岛')).toHaveCount(0)
    expect(existsSync(join(vault, '写作/冰岛'))).toBe(false)
    // 文件夹先挪走、树先刷新，主进程随后提交（左栏.json、置顶跟着查一遍）：等那次提交
    await expect.poll(() => gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

for (const frame of ['a', 'b'] as const) {
  test(`CN-7：左栏右边缘能拖宽，夹在 200 到 400，刷新后还在，双击回默认（${frame.toUpperCase()}）`, async () => {
    const run = await launch({ '写作/a.md': '# a\n' }, {}, settings({ frame }))
    const { page } = run
    try {
      await leftView(page, '文件')
      const sideW = () => page.locator('.win').evaluate((el) => Number.parseFloat(getComputedStyle(el).gridTemplateColumns.split(' ')[1]!))
      // 默认：A 252；B 248（含岛右边 6 的缝，DESIGN.v3 1.3）
      const def = frame === 'a' ? 252 : 248
      expect(await sideW()).toBe(def)
      const sash = page.getByRole('separator', { name: '拖动调整左栏宽度' })
      const drag = async (dx: number) => {
        const b = (await sash.boundingBox())!
        await page.mouse.move(b.x + b.width / 2, b.y + 200)
        await page.mouse.down()
        await page.mouse.move(b.x + b.width / 2 + dx, b.y + 200, { steps: 6 })
        await page.mouse.up()
      }
      await drag(60)
      await expect.poll(sideW).toBe(def + 60)
      await drag(400)
      await expect.poll(sideW).toBe(400)
      await drag(-600)
      await expect.poll(sideW).toBe(200)
      await drag(100)
      await expect.poll(sideW).toBe(300)
      // 中间的文件树跟着变宽：左栏这块看得见的宽度（B 里减去岛右边 6 的缝）
      expect(Math.round((await side(page).boundingBox())!.width)).toBe(frame === 'a' ? 300 : 294)
      await page.reload()
      await expect(page.locator('.vault b')).toHaveText('测试库')
      await expect.poll(sideW).toBe(300)
      await sash.dblclick()
      await expect.poll(sideW).toBe(def)
      await page.reload()
      await expect(page.locator('.vault b')).toHaveText('测试库')
      await expect.poll(sideW).toBe(def)
      // 收起左栏时没有分隔线
      await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).click()
      await expect(sash).toHaveCount(0)
    } finally {
      await run.close()
    }
  })
}

test('CN-12：新建笔记写标题、回车，文件名和标签跟着变；同名加「 2」并提示；自己改过名的不再跟；拼字中途不改；白板照旧在标签上改名', async () => {
  const run = await launch({ '收件箱/冰岛.md': '# 冰岛\n' })
  const { page, vault } = run
  try {
    await leftView(page, '文件')
    await side(page).getByRole('button', { name: '新建笔记' }).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    // 不再进标签改名框：光标在标题里，「未命名」全选，打字就替换
    await expect(page.getByRole('textbox', { name: '笔记名字' })).toHaveCount(0)
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await page.keyboard.type('冰岛旅游 3')
    expect(existsSync(join(vault, '收件箱/未命名.md'))).toBe(true)
    await page.keyboard.press('Enter')
    await page.keyboard.type('十天环岛。')
    await expect(tabOn(page)).toHaveText('冰岛旅游 3')
    await expect.poll(() => existsSync(join(vault, '收件箱/冰岛旅游 3.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/未命名.md'))).toBe(false)
    await expect(item(page, '冰岛旅游 3')).toBeVisible()
    await waitSaved(page)
    // 回车后光标到标题下空一行的正文处
    expect(readFileSync(join(vault, '收件箱/冰岛旅游 3.md'), 'utf8')).toBe('# 冰岛旅游 3\n\n十天环岛。')

    // 同名：存成「冰岛 2」，底栏说一句
    await side(page).getByRole('button', { name: '新建笔记' }).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await page.keyboard.type('冰岛')
    await page.keyboard.press('ArrowDown')
    await expect(tabOn(page)).toHaveText('冰岛 2')
    await expect(page.getByTestId('toast')).toContainText('已经有一篇叫「冰岛」了，这篇存成「冰岛 2」')
    expect(readFileSync(join(vault, '收件箱/冰岛.md'), 'utf8')).toBe('# 冰岛\n')

    // 拼字中途（输入法还没上屏）点到别处不改名，上屏后离开才改
    await side(page).getByRole('button', { name: '新建笔记' }).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: 'lv', selectionStart: 2, selectionEnd: 2 })
    await page.waitForTimeout(300)
    await expect(tabOn(page)).toHaveText('未命名')
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await cdp.send('Input.insertText', { text: '旅行' })
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('旅行')

    // 自己在标签上改了名：以后改标题不再跟
    await page.getByTestId('tab-on').dblclick()
    const tabInput = page.getByRole('textbox', { name: '笔记名字' })
    await tabInput.fill('游记')
    await tabInput.press('Enter')
    await expect(tabOn(page)).toHaveText('游记')
    await pane(page).locator('.cm-line').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type('改')
    await page.keyboard.press('ArrowDown')
    await waitSaved(page)
    await page.waitForTimeout(500)
    await expect(tabOn(page)).toHaveText('游记')
    expect(existsSync(join(vault, '收件箱/游记.md'))).toBe(true)
    expect(readFileSync(join(vault, '收件箱/游记.md'), 'utf8').startsWith('# 游记改\n')).toBe(true)

    // 白板没有标题行：新建后照旧在标签上改名
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '最近', exact: true }).click()
    await side(page).getByRole('button', { name: '新建白板' }).first().click()
    await expect(page.getByRole('textbox', { name: '笔记名字' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(acts(page)).toBeVisible()
  } finally {
    await run.close()
  }
})

test('CN-50 和图标栏：底栏库名只显示（悬停看路径、点了没有菜单），库菜单在左下角；亮着的图标不加底块，靠外一条强调色竖线', async () => {
  for (const frame of ['b', 'a'] as const) {
    const run = await launch({ 'a.md': '# a\n' }, {}, settings({ frame }))
    const { page, vault } = run
    try {
      const v = page.locator('.status .vault')
      expect(await v.evaluate((el) => el.tagName)).toBe('SPAN')
      await v.hover()
      await expect(page.getByTestId('tooltip')).toContainText(vault.replace(/^\/Users\/[^/]+/, '~'))
      await v.click()
      await expect(page.getByRole('menuitem', { name: '换一个库…' })).toHaveCount(0)
      await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '库', exact: true }).click()
      await expect(page.getByRole('menuitem', { name: '换一个库…' })).toBeVisible()
      await page.keyboard.press('Escape')

      await leftView(page, '文件')
      const on = page.getByRole('navigation', { name: '左栏' }).locator('.ab.on')
      const look = await on.evaluate((el) => {
        const s = getComputedStyle(el)
        const b = getComputedStyle(el, '::before')
        const probe = document.createElement('i')
        probe.style.color = 'var(--acc)'
        document.body.append(probe)
        const acc = getComputedStyle(probe).color
        probe.style.color = 'color-mix(in srgb, var(--acc) 40%, #fff)'
        const light = getComputedStyle(probe).color
        probe.remove()
        return { bg: s.backgroundColor, shadow: s.boxShadow, line: b.backgroundColor, w: b.width, left: el.getBoundingClientRect().left + Number.parseFloat(b.left), acc, light }
      })
      expect(look.bg).toBe('rgba(0, 0, 0, 0)')
      expect(look.shadow).toBe('none')
      // B 铺着照片：竖线浅一档（--acc 压在照片上不到 3:1）；A 是 --acc
      expect(look.line).toBe(frame === 'b' ? look.light : look.acc)
      expect(look.w).toBe('2px')
      // 竖线贴着窗口左边（图标栏的外沿）
      expect(Math.abs(Math.round(look.left))).toBe(0)
    } finally {
      await run.close()
    }
  }
})

test('CN-8：目录树里白板是它自己的颜色方块、课程是 folder-library、PDF 和 HTML 名字后面有小标', async () => {
  const run = await launch({
    '冰岛十天环岛.md': ICELAND,
    '课程/ecp/Lecture05.pdf': '%PDF-1.4\n',
    '课程/ecp/Lecture05 可视化.html': '<!doctype html><title>x</title>',
    '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n',
  })
  const { page } = run
  try {
    await leftView(page, '文件')
    await page.getByRole('tree', { name: '全部文件' }).getByRole('button', { name: '展开 ecp' }).click()
    // 白板：颜色方块，颜色是 frontmatter 里那个，不画文档图标
    const board = item(page, '冰岛十天环岛')
    await expect(board.locator('.ft-sw')).toHaveCSS('background-color', 'rgb(74, 127, 167)')
    await expect(board.locator('svg.ci')).toHaveCount(0)
    // 课程和每门课都是 folder-library（和活动栏上摘出来的「课程」一格同一个图标）
    const icon = (name: string) => item(page, name).locator('svg.ci').last().evaluate((el) => el.innerHTML)
    const lib = await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '课程', exact: true }).locator('svg').evaluate((el) => el.innerHTML)
    expect(await icon('ecp')).toBe(lib)
    expect(await icon('课程')).toBe(lib)
    // 小标：PDF、HTML 有，md 没有
    await expect(item(page, 'Lecture05').locator('.ft-ext')).toHaveText('PDF')
    await expect(item(page, 'Lecture05 可视化').locator('.ft-ext')).toHaveText('HTML')
    await expect(item(page, 'Lecture05 笔记').locator('.ft-ext')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('CN-20：白板标签条右端「100% ▾」：⌘+ 两次 125%、切走再回来还在；右栏开着乘 0.8；菜单里缩小、100%、适合窗口；捏合也能缩；文件一个字节不变', async () => {
  const run = await launch({ '冰岛十天环岛.md': ICELAND, '别的.md': '# 别的\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await leftView(page, '文件')
    await item(page, '冰岛十天环岛').click()
    // 以前写法的白板打开时转成「## 列名」（一次提交），白板就是 doc-board，画布按 zoom 缩放
    await expect(pane(page).getByTestId('doc-board')).toBeVisible()
    const zoom = acts(page).getByTestId('board-zoom')
    await expect(zoom).toHaveText('100%')
    const planeScale = () => pane(page).locator('.db-plane').evaluate((el) => (el as HTMLElement).style.zoom)
    await page.keyboard.press('Meta+Equal')
    await page.keyboard.press('Meta+Equal')
    await expect(zoom).toHaveText('125%')
    expect(await planeScale()).toBe('1.25')
    // 切走再回来
    await item(page, '别的').click()
    await expect(tabOn(page)).toHaveText('别的')
    await expect(acts(page).getByTestId('board-zoom')).toHaveCount(0)
    await item(page, '冰岛十天环岛').click()
    await expect(zoom).toHaveText('125%')
    // 右栏开着：让位 0.8
    const outline = page.getByRole('navigation', { name: '右栏' }).getByRole('button', { name: '大纲' })
    await outline.click()
    await expect(zoom).toHaveText('100%')
    await outline.click()
    await expect(zoom).toHaveText('125%')
    // 菜单
    await zoom.click()
    expect(menuLabels(await openedMenu(run))).toEqual(['放大', '缩小', '100%', '适合窗口', '触控板捏合、按住 ⌘ 滚动也能缩放'])
    await pickMenu(run, '100%')
    await expect(zoom).toHaveText('100%')
    await zoom.click()
    await pickMenu(run, '缩小')
    await expect(zoom).toHaveText('90%')
    await zoom.click()
    await pickMenu(run, '适合窗口')
    await expect.poll(async () => (await zoom.textContent())!.trim()).not.toBe('90%')
    // ⌘0 回 100%；捏合（按着 ctrl 的滚轮）放大
    await page.keyboard.press('Meta+0')
    await expect(zoom).toHaveText('100%')
    const box = (await pane(page).getByTestId('doc-board').locator('.board-wrap').boundingBox())!
    await page.mouse.move(box.x + 300, box.y + 300)
    await page.keyboard.down('Control')
    await page.mouse.wheel(0, -40)
    await page.keyboard.up('Control')
    await expect.poll(async () => Number.parseInt((await zoom.textContent())!)).toBeGreaterThan(100)
    // 整个过程文件没动：缩放只记在本机
    await page.waitForTimeout(1200)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('CN-11：新建笔记默认进收件箱；目录树里点过文件夹、开着文件夹首页时进那个文件夹；标题下「收件箱 ▾」点开能移到别处', async () => {
  const run = await launch({ '写作/去冰岛之前.md': '# 去冰岛之前\n', '课程/ecp/a.md': '# a\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await leftView(page, '文件')
    await side(page).locator('.vh').getByRole('button', { name: '新建笔记' }).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名.md'))).toBe(true)
    // 标题下一颗「收件箱 ▾」，点开是移到菜单
    const chip = pane(page).locator('.cm-folder')
    await expect(chip).toHaveText('收件箱')
    await chip.click()
    const moveTo = await openedMenu(run)
    // 这篇本来就在的「收件箱」灰着列出来（task-5yp97「藏之后」图）
    expect(menuLabels(moveTo)).toEqual(['测试库', '收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活'])
    expect(moveTo.find((i) => i.label === '收件箱')!.enabled).toBe(false)
    expect(menuLabels(moveTo.find((i) => i.label === '课程')!.submenu!)).toEqual(['放进「课程」', 'ecp'])
    await pickMenu(run, '写作')
    await expect.poll(() => existsSync(join(vault, '写作/未命名.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/未命名.md'))).toBe(false)
    await expect(chip).toHaveText('写作')
    await expect(page.locator('.pane:not([hidden])')).toHaveAttribute('data-path', '写作/未命名.md')

    // 目录树里点「ecp」（开它的首页），⌘N 进 课程/ecp
    await item(page, 'ecp').click()
    await expect(tabOn(page)).toHaveText('ecp')
    await page.keyboard.press('Meta+n')
    await expect(tabOn(page)).toHaveText('未命名')
    await expect.poll(() => existsSync(join(vault, '课程/ecp/未命名.md'))).toBe(true)
    // 只写所在的那一层，整条路径在悬停提示里
    await expect(pane(page).locator('.cm-folder')).toHaveText('ecp')
    await expect(pane(page).locator('.cm-folder')).toHaveAttribute('data-tip', '课程 / ecp · 移到…')

    // 点了一篇文件（不再选着文件夹）、开着的不是文件夹首页：回到收件箱
    await item(page, '去冰岛之前').click()
    await expect(tabOn(page)).toHaveText('去冰岛之前')
    await page.keyboard.press('Meta+n')
    await expect.poll(() => readdirSync(join(vault, '收件箱'))).toContain('未命名.md')
  } finally {
    await run.close()
  }
})
