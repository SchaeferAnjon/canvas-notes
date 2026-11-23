import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, gitStatus, launch, pane, type Running, tabOn } from './app'
import { MAP, MAP_PATH as PATH, mapFiles } from './fixtures/mindmap-b1'
import { armMenus, dismissMenu, openedMenu, pickMenu } from './menu'

// 思维导图第一批（task-wuv05，设计页 /private/tmp/canvas-notes-visual/15-思维导图/，用户：「这个我看完了 我觉得可以」）：
// ① 键盘补齐 ② 拖到两个同级中间 ③ 折叠写进文件 ④ 左右 / 向下两种新布局 ⑤ 只看这一枝。都是真按键、真拖、真点；
// 每一下看文件只动了那几行，撤回到底和打开时一个字节不差。

const B1_FILES = mapFiles()
const board = (page: Page) => pane(page).getByTestId('board')
const layer = (page: Page) => board(page).getByTestId('mindmap')
const esc = (s: string) => s.replace(/[()+=.*?[\]\\^$|]/g, '\\$&')
const node = (page: Page, text: string) => board(page).locator('.mm-node', { has: page.locator('.t', { hasText: new RegExp(`^${esc(text)}$`) }) })
const read = (run: Running) => readFileSync(join(run.vault, PATH), 'utf8')

async function openMap(page: Page) {
  await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
  await expect(board(page).locator('.mm-node')).toHaveCount(16)
  await expect(board(page).getByTestId('map-photo').locator('img')).toHaveJSProperty('complete', true)
}

/** 原文和现在逐行比：少了哪几行、多了哪几行（顺序照文件） */
function diff(before: string, after: string) {
  const a = before.split('\n')
  const b = after.split('\n')
  return { gone: a.filter((l) => !b.includes(l)), added: b.filter((l) => !a.includes(l)) }
}

/** 节点两两不重叠、字没被截、没出框、不比 260 宽；连线两头接得上（照 wuv05-mindmap-wrap 的查法，左右展开、向下也认） */
async function check(page: Page) {
  const r = await layer(page).evaluate((el) => {
    const nodes = [...el.querySelectorAll<HTMLElement>('.mm-node')].map((n) => {
      const t = n.querySelector<HTMLElement>('.t')!
      const range = document.createRange()
      range.selectNodeContents(t)
      const nr = n.getBoundingClientRect()
      const lines = [...range.getClientRects()]
      return {
        text: t.textContent!,
        cut: t.scrollWidth > t.clientWidth + 0.5 || t.scrollHeight > t.clientHeight + 0.5,
        inside: lines.every((r) => r.left >= nr.left - 0.5 && r.right <= nr.right + 0.5 && r.top >= nr.top - 0.5 && r.bottom <= nr.bottom + 0.5),
        x: parseFloat(n.style.left),
        y: parseFloat(n.style.top),
        w: parseFloat(n.style.width),
        h: parseFloat(n.style.height),
      }
    })
    const overlaps: string[] = []
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!
        const b = nodes[j]!
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps.push(`${a.text} ⨯ ${b.text}`)
      }
    // 连线两头：起点落在某个节点的边上，终点落在另一个节点的边上（左右展开左边那一半是右边，向下是顶上、左边）
    const near = (x: number, y: number) => nodes.some((n) => x >= n.x - 0.5 && x <= n.x + n.w + 0.5 && y >= n.y - 0.5 && y <= n.y + n.h + 0.5)
    const loose: string[] = []
    for (const p of el.querySelectorAll<SVGPathElement>('svg.mm-wires path')) {
      // 两头照画出来的路径量（向下的线有 V、H，不能只取最后两个数）
      const a = p.getPointAtLength(0)
      const b = p.getPointAtLength(p.getTotalLength())
      if (!near(a.x, a.y) || !near(b.x, b.y)) loose.push(p.getAttribute('d')!)
    }
    return { nodes, overlaps, loose }
  })
  for (const n of r.nodes) {
    expect.soft(n.cut, `「${n.text}」被截`).toBe(false)
    expect.soft(n.inside, `「${n.text}」字出了框`).toBe(true)
    expect.soft(n.w, `「${n.text}」比 260 宽`).toBeLessThanOrEqual(260)
  }
  expect(r.overlaps).toEqual([])
  expect(r.loose).toEqual([])
  return r
}

test('① 键盘：⇧↵ 前面加同级、⌘↵ 加父主题、⌥↑ ⌥↓ 挪、⌘⌫ 只删这一个、Tab、↵；每一下文件只动那几行，⌘Z 撤回到一字不差', async () => {
  const run = await launch(B1_FILES, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const type = async (text: string) => {
    const box = page.getByRole('textbox', { name: '节点的字' })
    await expect(box).toBeFocused()
    await box.fill(text)
    await page.keyboard.press('Enter')
    await expect(box).toHaveCount(0)
  }
  try {
    await openMap(page)
    // 打开不写盘
    await page.waitForTimeout(400)
    expect(read(run)).toBe(MAP)

    // ⇧↵：在「核与像」前面加一个同级
    await node(page, '核与像').click()
    await page.keyboard.press('Shift+Enter')
    await type('前面的')
    await expect.poll(() => read(run)).toContain('    - 复合 = 矩阵相乘 <!-- box=0.755,0.32,0.202,0.066 -->\n  - 前面的\n  - 核与像 <!--')
    expect(diff(MAP, read(run))).toEqual({ gone: [], added: ['  - 前面的'] })

    // ⌘↵：给「核与像」套一个父主题：它那一枝只多一层缩进，注释原样
    await node(page, '核与像').click()
    await page.keyboard.press('Meta+Enter')
    await type('父主题')
    await expect.poll(() => read(run)).toContain(
      '  - 父主题\n    - 核与像 <!-- box=0.669,0.675,0.125,0.082 -->\n      - ker T 映到 0 <!-- box=0.812,0.567,0.164,0.064 -->\n      - im T 所有的像 <!-- box=0.813,0.781,0.171,0.064 -->\n      - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->\n  - 例子',
    )
    // 「问这一页」（同是 ⌘↵）没被叫起来：右栏没开 AI
    await expect(page.getByRole('complementary', { name: 'AI' })).toHaveCount(0)

    // ⌥↑ ⌥↓：「父主题」在同一层里往上挪一个、再挪回来
    await node(page, '父主题').click()
    await page.keyboard.press('Alt+ArrowUp')
    await expect.poll(() => read(run)).toContain('  - 父主题\n    - 核与像 <!-- box=0.669,0.675,0.125,0.082 -->\n      - ker T 映到 0 <!-- box=0.812,0.567,0.164,0.064 -->\n      - im T 所有的像 <!-- box=0.813,0.781,0.171,0.064 -->\n      - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->\n  - 前面的\n  - 例子')
    await expect(node(page, '父主题')).toHaveClass(/\bsel\b/)
    await page.keyboard.press('Alt+ArrowDown')
    await expect.poll(() => read(run)).toContain('  - 前面的\n  - 父主题\n')
    // 到头了不挪：「定义」往上没有
    await node(page, '定义').click()
    const before = read(run)
    await page.keyboard.press('Alt+ArrowUp')
    await page.waitForTimeout(300)
    expect(read(run)).toBe(before)

    // ⌘⌫：只删「父主题」这一个，下面的提上来（回到原来的缩进，一个字节不差）
    await node(page, '父主题').click()
    await page.keyboard.press('Meta+Backspace')
    await expect.poll(() => read(run)).toBe(MAP.replace('  - 核与像', '  - 前面的\n  - 核与像'))
    await expect(node(page, '核与像')).toHaveClass(/\bsel\b/)

    // Tab：「例子」加一个子主题；↵：再加一个同级；改字时按 Tab 存下再加子主题
    await node(page, '例子').click()
    await page.keyboard.press('Tab')
    await type('积分')
    await expect(node(page, '积分')).toHaveClass(/\bsel\b/)
    await page.keyboard.press('Enter')
    await page.getByRole('textbox', { name: '节点的字' }).fill('卷积')
    await page.keyboard.press('Tab')
    await type('离散的')
    await expect.poll(() => read(run)).toContain('    - 求导 d/dx <!-- box=0.207,0.882,0.142,0.068 -->\n    - 积分\n    - 卷积\n      - 离散的\n')

    // 中心上：⇧↵、⌘↵、⌘⌫ 不做事，↵ 是加子主题
    await node(page, '线性映射').click()
    const atCenter = read(run)
    for (const k of ['Shift+Enter', 'Meta+Enter', 'Meta+Backspace', 'Alt+ArrowUp']) await page.keyboard.press(k)
    await page.waitForTimeout(300)
    expect(read(run)).toBe(atCenter)
    await page.keyboard.press('Enter')
    await type('第五个')
    await expect.poll(() => read(run)).toContain('      - 离散的\n  - 第五个\n')

    // ⌘Z 撤回到底：和打开时一个字节不差，Git 里干干净净
    await layer(page).focus()
    for (let i = 0; i < 30 && read(run) !== MAP; i++) {
      await page.keyboard.press('Meta+z')
      await page.waitForTimeout(120)
    }
    await expect.poll(() => read(run)).toBe(MAP)
    await expect.poll(() => gitStatus(vault)).toBe('')
    await check(page)
  } finally {
    await run.close()
  }
})

test('① 右键菜单把键全写出来（照命令表），中心上灰掉同级、父主题、挪、删；点一项真做', async () => {
  const run = await launch(B1_FILES, { CN_AI_FAKE: '1' })
  const { page } = run
  /** 菜单每一项：字、灰没灰、写着的键 */
  const items = () =>
    run.app.evaluate(() => {
      const g = globalThis as unknown as { cnMenu: { menu: Electron.Menu } | null }
      return g.cnMenu!.menu.items.map((i) => (i.type === 'separator' ? '—' : `${i.label}|${i.enabled ? '' : '灰'}|${i.accelerator ?? ''}`))
    })
  try {
    await armMenus(run)
    await openMap(page)
    await node(page, '核与像').click({ button: 'right' })
    await openedMenu(run)
    expect(await items()).toEqual([
      '加子主题||Tab',
      '在后面加同级||Return',
      '在前面加同级||Shift+Return',
      '加父主题||Command+Return',
      '—',
      '往上挪||Alt+Up',
      '往下挪||Alt+Down',
      '收起这一枝||Space',
      '只看这一枝||Alt+Return',
      '—',
      // 第二批加的：备注、外框、概要、联系线、拆成浮动主题、加图片
      '加备注||Shift+Command+N',
      '加外框||Shift+Command+B',
      '加概要||',
      '连一条联系线…||Shift+Command+R',
      '拆成浮动主题||',
      '—',
      '加图片…||',
      '—',
      '改字||F2',
      '删掉这一枝||Backspace',
      '只删这一个（下面的往上提）||Command+Backspace',
    ])
    await expect(node(page, '核与像')).toHaveClass(/\bsel\b/)
    await dismissMenu(run)
    // 中心：同级、父主题、挪、收起、删都灰着
    await node(page, '线性映射').click({ button: 'right' })
    await openedMenu(run)
    const center = await items()
    for (const name of ['在后面加同级', '在前面加同级', '加父主题', '往上挪', '往下挪', '收起这一枝', '删掉这一枝', '只删这一个（下面的往上提）'])
      expect(center.find((x) => x.startsWith(name + '|')), name).toContain('|灰|')
    expect(center.find((x) => x.startsWith('加子主题|'))).toBe('加子主题||Tab')
    await dismissMenu(run)
    // 第一个往上挪灰着
    await node(page, '定义').click({ button: 'right' })
    await openedMenu(run)
    expect((await items()).find((x) => x.startsWith('往上挪|'))).toContain('|灰|')
    await dismissMenu(run)
    // 点「在前面加同级」：真加，进改字
    await node(page, '例子').click({ button: 'right' })
    await pickMenu(run, '在前面加同级')
    await page.getByRole('textbox', { name: '节点的字' }).fill('补充')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run)).toContain('  - 补充\n  - 例子 <!--')
    // 收起的菜单项写「展开」
    await node(page, '定义').click({ button: 'right' })
    await pickMenu(run, '收起这一枝')
    await expect.poll(() => read(run)).toContain('  - 定义 <!-- box=0.233,0.211,0.091,0.082 fold -->\n')
    await node(page, '定义').click({ button: 'right' })
    await openedMenu(run)
    expect((await items()).find((x) => x.startsWith('展开|'))).toBe('展开||Space')
    await pickMenu(run, '展开')
    await expect.poll(() => read(run)).toContain('  - 定义 <!-- box=0.233,0.211,0.091,0.082 -->\n')
  } finally {
    await run.close()
  }
})

test('② 拖：两个同级中间换位置（强调色插入线、小牌说去哪、原处淡掉），正中间放进去（强调色虚线框），换到别的上级下面', async () => {
  const run = await launch(B1_FILES, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const box = async (text: string) => (await node(page, text).boundingBox())!
  const acc = () => layer(page).evaluate((el) => getComputedStyle(el).getPropertyValue('--acc').trim())
  /** 把颜色写法统一成 rgb(…)：拿一个看不见的元素量 */
  const rgb = (c: string) =>
    page.evaluate((c) => {
      const d = document.createElement('div')
      d.style.color = c
      document.body.append(d)
      const v = getComputedStyle(d).color
      d.remove()
      return v
    }, c)
  try {
    await openMap(page)
    const accent = await rgb(await acc())

    // 「秩-零化度定理」拖到「ker T 映到 0」上边：排到它前面
    const from = await box('秩-零化度定理')
    const ker = await box('ker T 映到 0')
    await page.mouse.move(from.x + 10, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(ker.x + 40, ker.y + 20, { steps: 6 })
    await page.mouse.move(ker.x + 40, ker.y + 2, { steps: 3 })
    const line = board(page).getByTestId('map-insert-line')
    await expect(line).toBeVisible()
    expect(await line.evaluate((e) => getComputedStyle(e).backgroundColor)).toBe(accent)
    const lb = (await line.boundingBox())!
    expect(lb.height).toBeLessThanOrEqual(3)
    expect(lb.y).toBeLessThan(ker.y)
    await expect(page.getByTestId('map-drag-hint')).toHaveText('排到「ker T 映到 0」前面')
    await expect(page.getByTestId('map-drag-ghost')).toHaveText('秩-零化度定理')
    await expect(node(page, '秩-零化度定理')).toHaveClass(/\bdim\b/)
    await page.mouse.up()
    await expect(line).toHaveCount(0)
    await expect.poll(() => read(run)).toContain('  - 核与像 <!-- box=0.669,0.675,0.125,0.082 -->\n    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->\n    - ker T 映到 0')
    // 只是那一行换了位置
    expect([...read(run).split('\n')].sort()).toEqual([...MAP.split('\n')].sort())

    // 「ker T 映到 0」拖到「定义」正中间：放进去、排在最后；「定义」画强调色虚线框
    const k2 = await box('ker T 映到 0')
    const def = await box('定义')
    await page.mouse.move(k2.x + 10, k2.y + k2.height / 2)
    await page.mouse.down()
    await page.mouse.move(def.x + def.width / 2, def.y + def.height / 2, { steps: 8 })
    await expect(node(page, '定义')).toHaveClass(/\bdrop\b/)
    const outline = await node(page, '定义').evaluate((e) => [getComputedStyle(e).outlineStyle, getComputedStyle(e).outlineColor])
    expect(outline).toEqual(['dashed', accent])
    await expect(page.getByTestId('map-drag-hint')).toHaveText('放进「定义」，排在最后')
    await page.mouse.up()
    await expect.poll(() => read(run)).toContain('    - 先加再映射，和先映射再加，结果一样；数乘也一样\n    - ker T 映到 0 <!-- box=0.812,0.567,0.164,0.064 -->\n  - 矩阵表示')

    // 「复合 = 矩阵相乘」拖到「T(u+v)=T(u)+T(v)」下边：排到它和「T(cv)=cT(v)」中间，换到「定义」下面
    const fu = await box('复合 = 矩阵相乘')
    const tuv = await box('T(u+v)=T(u)+T(v)')
    await page.mouse.move(fu.x + 10, fu.y + fu.height / 2)
    await page.mouse.down()
    await page.mouse.move(tuv.x + 30, tuv.y + tuv.height - 2, { steps: 8 })
    await expect(page.getByTestId('map-drag-hint')).toHaveText('排到「T(u+v)=T(u)+T(v)」和「T(cv)=cT(v)」中间（换到「定义」下面）')
    await page.mouse.up()
    await expect.poll(() => read(run)).toContain('    - T(u+v)=T(u)+T(v) <!-- box=0.075,0.074,0.232,0.066 -->\n    - 复合 = 矩阵相乘 <!-- box=0.755,0.32,0.202,0.066 -->\n    - T(cv)=cT(v)')

    // 拖到哪都不挨着：松手放回原处，文件不动
    const now = read(run)
    const li = await box('列 = 基向量的像')
    await page.mouse.move(li.x + 10, li.y + li.height / 2)
    await page.mouse.down()
    await page.mouse.move(li.x + 10, li.y + 400, { steps: 8 })
    await expect(page.getByTestId('map-drag-hint')).toHaveText('松手放回原处')
    // esc 不放了
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('map-drag-hint')).toHaveCount(0)
    await page.mouse.up()
    await page.waitForTimeout(300)
    expect(read(run)).toBe(now)
    await check(page)

    // ⌘Z 三下：回到打开时
    await layer(page).focus()
    for (let i = 0; i < 3; i++) await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toBe(MAP)
    await expect.poll(() => gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('③ 折叠：点圆点收起 / 展开（文件只多一个 fold）、空格、关了再开还收着；收起到第一层、全部展开（布局菜单、⇧⌘/、⌘K）', async () => {
  const run = await launch(B1_FILES, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openMap(page)
    // 指着「定义」：后面出一个「−」，点一下收起；圆点写藏了 3 个
    await node(page, '定义').hover()
    const dot = node(page, '定义').locator('.fold')
    await expect(dot).toBeVisible()
    await expect(dot).toHaveAccessibleName('收起这一枝')
    expect(await dot.evaluate((e) => getComputedStyle(e, '::before').content)).toBe('"−"')
    // 圆点在主题右边 5、16 高
    const db = (await dot.boundingBox())!
    const nb = (await node(page, '定义').boundingBox())!
    expect(Math.round(db.x - (nb.x + nb.width))).toBe(5)
    expect(Math.round(db.height)).toBe(16)
    await dot.click()
    await expect(node(page, 'T(cv)=cT(v)')).toHaveCount(0)
    await expect(dot).toHaveText('3')
    await expect(dot).toHaveClass(/folded/)
    await expect.poll(() => read(run)).toBe(MAP.replace('  - 定义 <!-- box=0.233,0.211,0.091,0.082 -->', '  - 定义 <!-- box=0.233,0.211,0.091,0.082 fold -->'))
    // 空格收起「例子」
    await node(page, '例子').click()
    await page.keyboard.press(' ')
    await expect(node(page, '旋转')).toHaveCount(0)
    await expect.poll(() => read(run)).toContain('  - 例子 <!-- box=0.233,0.675,0.091,0.082 fold -->\n')
    expect(diff(MAP, read(run)).gone).toEqual(['  - 定义 <!-- box=0.233,0.211,0.091,0.082 -->', '  - 例子 <!-- box=0.233,0.675,0.091,0.082 -->'])
    await check(page)

    // 关掉标签再打开：还收着
    await page.keyboard.press('Meta+w')
    await expect(tabOn(page)).not.toHaveText(/^导图/)
    await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
    await expect(board(page).locator('.mm-node')).toHaveCount(10)
    await expect(node(page, '定义').locator('.fold')).toHaveText('3')
    await expect(node(page, '例子').locator('.fold')).toHaveText('3')

    // 点圆点展开：那一行回到原样
    await node(page, '定义').locator('.fold').click()
    await expect(node(page, 'T(cv)=cT(v)')).toHaveCount(1)
    await node(page, '例子').locator('.fold').click()
    await expect.poll(() => read(run)).toBe(MAP)

    // 「布局 ▾」里收起到第一层：第一层四个都收起（只多四个 fold）；全部展开回到原样
    await acts(page).getByTestId('map-layout').click()
    const menu = page.getByTestId('map-layout-menu')
    await expect(menu.getByRole('menuitem', { name: /收起到第一层/ })).toContainText('⇧⌘/')
    await menu.getByRole('menuitem', { name: /收起到第一层/ }).click()
    await expect(menu).toHaveCount(0)
    await expect(board(page).locator('.mm-node')).toHaveCount(5)
    await expect.poll(() => diff(MAP, read(run)).added.length).toBe(4)
    expect(diff(MAP, read(run)).added.every((l) => l.endsWith(' fold -->'))).toBe(true)
    await acts(page).getByTestId('map-layout').click()
    await menu.getByRole('menuitem', { name: '全部展开' }).click()
    await expect.poll(() => read(run)).toBe(MAP)
    // 菜单里做的也能 ⌘Z：撤回「全部展开」又是收着的，再撤回回到打开时
    await node(page, '线性映射').click()
    await page.keyboard.press('Meta+z')
    await expect(board(page).locator('.mm-node')).toHaveCount(5)
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toBe(MAP)

    // ⇧⌘/：焦点在导图上按一下收起到第一层，再按全部展开
    await node(page, '线性映射').click()
    await page.keyboard.press('Shift+Meta+Slash')
    await expect(board(page).locator('.mm-node')).toHaveCount(5)
    await page.keyboard.press('Shift+Meta+Slash')
    await expect(board(page).locator('.mm-node')).toHaveCount(16)
    await expect.poll(() => read(run)).toBe(MAP)

    // ⌘K 里也有（不打字往下翻就在「设置和外观」）
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await expect(pal.locator('.pal-row').filter({ hasText: '导图：收起到第一层' })).toHaveCount(1)
    await pal.getByRole('textbox').fill('导图：收起到第一层')
    await page.keyboard.press('Enter')
    await expect(board(page).locator('.mm-node')).toHaveCount(5)
    await page.keyboard.press('Meta+k')
    await pal.getByRole('textbox').fill('导图：全部展开')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run)).toBe(MAP)
  } finally {
    await run.close()
  }
})

test('③ 收着的导图关掉软件再开还收着；没升级的写法（没有 fold）打开不写盘', async () => {
  const folded = MAP.replace('  - 核与像 <!-- box=0.669,0.675,0.125,0.082 -->', '  - 核与像 <!-- box=0.669,0.675,0.125,0.082 fold -->').replace('  - 例子 <!-- box=0.233,0.675,0.091,0.082 -->', '  - 例子 <!-- box=0.233,0.675,0.091,0.082 fold -->')
  const run = await launch({ ...B1_FILES, [PATH]: folded }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.locator('.nav .si', { hasText: /^导图 11-22/ }).first().click()
    await expect(board(page).locator('.mm-node')).toHaveCount(10)
    await expect(node(page, '核与像').locator('.fold')).toHaveText('3')
    // 字里不露注释
    await expect(node(page, '核与像').locator('.t')).toHaveText('核与像')
    await page.waitForTimeout(500)
    expect(read(run)).toBe(folded)
    expect(gitStatus(vault)).toBe('')
    // 文档看法里注释藏着
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(pane(page).locator('.cm-content')).toContainText('核与像')
    await expect(pane(page).locator('.cm-content')).not.toContainText('fold')
  } finally {
    await run.close()
  }
})

test('④ 布局：标签条「布局 ▾」换成左右展开、向下展开，属性那一行对、节点不重叠不截字；换回向右回到原样；只在导图白板上有', async () => {
  const run = await launch(B1_FILES, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    // 宽一点：向下展开时整排第一层都在画面里，拖得到
    await page.setViewportSize({ width: 1900, height: 1000 })
    await openMap(page)
    const btn = acts(page).getByTestId('map-layout')
    await expect(btn).toHaveAccessibleName('布局：向右')
    await expect(layer(page)).toHaveAttribute('data-layout', 'right')
    await check(page)
    await btn.click()
    const menu = page.getByTestId('map-layout-menu')
    await expect(menu.locator('.head')).toHaveText('这块导图怎么摆')
    // 第二批又加了鱼骨、时间线两种（配色、骨架两排小图另外测）
    await expect(menu.locator('.lay')).toHaveText([
      '向右展开逻辑图：中心在左，一层层往右',
      '左右展开思维导图：第一层分到左右两边',
      '向下展开组织结构：中心在上，一层层往下',
      '鱼骨找原因：中心是鱼头，原因一根根长在骨头上',
      '时间线按先后：第一层排在一根横线上',
    ])
    await expect(menu.getByRole('menuitemradio', { name: /向右展开/ })).toHaveAttribute('aria-checked', 'true')
    await expect(menu.locator('.foot')).toHaveText('记在这篇的属性里：导图布局: 向右（向右是默认，不写）')

    // 左右展开：属性里多一行，紧跟在「白板样式: 导图」后面；中心主题在屏幕上不动（白板跟着平移）
    const mid = async (t: string) => {
      const b = (await node(page, t).boundingBox())!
      return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }
    }
    const before = await mid('线性映射')
    await menu.getByRole('menuitemradio', { name: /左右展开/ }).click()
    await expect.poll(() => read(run)).toBe(MAP.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 左右\n'))
    await expect(layer(page)).toHaveAttribute('data-layout', 'both')
    await expect(btn).toHaveAccessibleName('布局：左右')
    // 中心不动时有一块到了屏幕外（左边一半压到工具板下面）：平移到整张看得见（第二批 designer 复审改的规矩，DESIGN.v3 6.7）；
    // 中心不动也整张看得见时，中心照旧不动
    const visible = async () => {
      const v = (await board(page).locator('.board-wrap').boundingBox())!
      const boxes = await board(page).locator('.mm-node, [data-testid="map-photo"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ x: r.x, y: r.y, r: r.right, b: r.bottom })))
      return boxes.every((r) => r.x >= v.x + 80 && r.r <= v.x + v.width && r.y >= v.y && r.b <= v.y + v.height)
    }
    await expect
      .poll(async () => {
        const m = await mid('线性映射')
        return Math.abs(m.x - before.x) + Math.abs(m.y - before.y) <= 2 || (await visible())
      })
      .toBe(true)
    await expect.poll(visible).toBe(true)
    // 换布局能撤回、能重做
    await node(page, '线性映射').click()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toBe(MAP)
    await expect(layer(page)).toHaveAttribute('data-layout', 'right')
    await page.keyboard.press('Shift+Meta+z')
    await expect(layer(page)).toHaveAttribute('data-layout', 'both')
    const c = (await node(page, '线性映射').boundingBox())!
    // 前一半（定义、矩阵表示）在右边，后一半（核与像、例子）在左边，例子在上
    for (const t of ['定义', '矩阵表示']) expect((await node(page, t).boundingBox())!.x, t).toBeGreaterThan(c.x + c.width)
    for (const t of ['核与像', '例子', '旋转', '秩-零化度定理']) {
      const b = (await node(page, t).boundingBox())!
      expect(b.x + b.width, t).toBeLessThan(c.x)
    }
    expect((await node(page, '例子').boundingBox())!.y).toBeLessThan((await node(page, '核与像').boundingBox())!.y)
    // 原照片卡在整张图最左边
    const photo = (await board(page).getByTestId('map-photo').boundingBox())!
    expect(photo.x + photo.width).toBeLessThan((await node(page, '旋转').boundingBox())!.x)
    await check(page)
    // 左边那一半选中时：折叠圆点、「+」在主题左边（「+」在圆点外面 28）
    await node(page, '核与像').click()
    const kb = (await node(page, '核与像').boundingBox())!
    const plus = (await board(page).getByTestId('map-plus').boundingBox())!
    const dotL = (await node(page, '核与像').locator('.fold').boundingBox())!
    expect(dotL.x + dotL.width).toBeLessThan(kb.x)
    expect(Math.round(kb.x - (plus.x + plus.width))).toBe(28)
    // 方向键：左边那一半往左是孩子
    await page.keyboard.press('ArrowLeft')
    await expect(node(page, 'ker T 映到 0')).toHaveClass(/\bsel\b/)
    await page.keyboard.press('ArrowRight')
    await expect(node(page, '核与像')).toHaveClass(/\bsel\b/)

    // 向下展开：只改那一行；第二层以下是小框
    await btn.click()
    await menu.getByRole('menuitemradio', { name: /向下展开/ }).click()
    await expect.poll(() => read(run)).toBe(MAP.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 向下\n'))
    await expect(layer(page)).toHaveAttribute('data-layout', 'down')
    const cd = (await node(page, '线性映射').boundingBox())!
    for (const t of ['定义', '矩阵表示', '核与像', '例子']) expect((await node(page, t).boundingBox())!.y, t).toBeGreaterThan(cd.y + cd.height)
    await expect(node(page, '旋转')).toHaveClass(/\bboxed\b/)
    await expect(node(page, '定义')).not.toHaveClass(/\bboxed\b/)
    await check(page)
    // 拖到向下的第一层左右边：竖着的插入线
    const ex = (await node(page, '例子').boundingBox())!
    const mx = (await node(page, '矩阵表示').boundingBox())!
    await page.mouse.move(ex.x + 10, ex.y + ex.height / 2)
    await page.mouse.down()
    await page.mouse.move(mx.x + 3, mx.y + mx.height / 2, { steps: 8 })
    const line = board(page).getByTestId('map-insert-line')
    await expect(line).toHaveClass(/\bv\b/)
    await expect(page.getByTestId('map-drag-hint')).toHaveText('排到「定义」和「矩阵表示」中间')
    await page.mouse.up()
    await expect.poll(() => read(run)).toContain('    - 先加再映射，和先映射再加，结果一样；数乘也一样\n  - 例子 <!--')
    await layer(page).focus()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toBe(MAP.replace('白板样式: 导图\n', '白板样式: 导图\n导图布局: 向下\n'))

    // 切到文档看法：「布局 ▾」还在，紧挨着「属性」（白板才有的缩放、收件箱挪进白板右上角是 task-wz7gb 的事）
    const props = acts(page).getByRole('button', { name: '属性', exact: true })
    const gap = async () => (await props.boundingBox())!.x - (await btn.boundingBox())!.x
    const inBoard = await gap()
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await expect(btn).toBeVisible()
    expect(await gap()).toBeCloseTo(inBoard, 0)
    await acts(page).getByRole('tab', { name: '白板' }).click()

    // 换回向右：属性那一行去掉，和打开时一字不差
    await btn.click()
    await menu.getByRole('menuitemradio', { name: /向右展开/ }).click()
    await expect.poll(() => read(run)).toBe(MAP)
    await expect.poll(() => gitStatus(vault)).toBe('')

    // 普通白板上没有「布局 ▾」
    await page.locator('.nav .si', { hasText: /^复习/ }).first().click()
    await expect(tabOn(page)).toHaveText('复习')
    await expect(acts(page).getByTestId('map-layout')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('⑤ 只看这一枝：⌥↵ 进，胶囊写从哪来，只画这一枝；里面照样能加、收；esc 回整张；文件里不写', async () => {
  const run = await launch(B1_FILES, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openMap(page)
    const center = (await node(page, '线性映射').boundingBox())!
    await node(page, '核与像').click()
    await page.keyboard.press('Alt+Enter')
    const pill = board(page).getByTestId('map-focus')
    await expect(pill).toHaveText('只看「核与像」这一枝线性映射 › 核与像回到整张esc')
    await expect(board(page).locator('.mm-node')).toHaveCount(4)
    await expect(board(page).getByTestId('map-photo')).toHaveCount(0)
    await expect(node(page, '核与像')).toHaveClass(/\bc\b/)
    // 这一枝的中心就在整张图中心主题原来的地方（不顶到左上角）
    const fc = (await node(page, '核与像').boundingBox())!
    expect(Math.abs(fc.x + fc.width / 2 - (center.x + center.width / 2))).toBeLessThanOrEqual(2)
    expect(Math.abs(fc.y + fc.height / 2 - (center.y + center.height / 2))).toBeLessThanOrEqual(2)
    await page.waitForTimeout(300)
    expect(read(run)).toBe(MAP)
    await check(page)

    // 这一枝里照样能加（中心上 ↵ 是加子主题）、能收
    await node(page, '核与像').click()
    await page.keyboard.press('Enter')
    await page.getByRole('textbox', { name: '节点的字' }).fill('线性无关')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run)).toContain('    - 秩-零化度定理 <!-- box=0.579,0.872,0.186,0.068 -->\n    - 线性无关\n  - 例子')
    await expect(board(page).locator('.mm-node')).toHaveCount(5)
    // 中心删不掉
    await node(page, '核与像').click()
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(200)
    expect(read(run)).toContain('  - 核与像 <!--')

    // esc 回到整张
    await page.keyboard.press('Escape')
    await expect(pill).toHaveCount(0)
    await expect(board(page).locator('.mm-node')).toHaveCount(17)
    await expect(board(page).getByTestId('map-photo')).toBeVisible()

    // 右键「只看这一枝」进，点「回到整张」出
    await armMenus(run)
    await node(page, '定义').click({ button: 'right' })
    await pickMenu(run, '只看这一枝')
    await expect(pill).toContainText('只看「定义」这一枝')
    await expect(board(page).locator('.mm-node')).toHaveCount(4)
    await pill.getByRole('button', { name: /回到整张/ }).click()
    await expect(pill).toHaveCount(0)
    // 撤回两下（改的字、加的那一个）：回到打开时；只看这一枝进出都没写文件
    await layer(page).focus()
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toContain('    - 新主题\n')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read(run)).toBe(MAP)
  } finally {
    await run.close()
  }
})

test('① 键能改：设置 › 快捷键「导图里」一段，把「加父主题」改成 ⌥⌘P，导图里按新键加父主题、旧键 ⌘↵ 不再做事；右键菜单写新键；焦点在导图上 ⌘K 照样开', async () => {
  const run = await launch(B1_FILES, { CN_AI_FAKE: '1' })
  const { page } = run
  const dlg = page.getByRole('dialog', { name: '设置' })
  try {
    await openMap(page)
    await page.keyboard.press('Meta+Comma')
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
    const row = dlg.locator('[data-row="k-cmd-mm-parent"]')
    await expect(row).toContainText('导图：加父主题')
    await expect(row).toContainText('导图里')
    await row.getByRole('button', { name: '改 导图：加父主题 的快捷键' }).click()
    await page.keyboard.press('Alt+Meta+KeyP')
    await expect(row.locator('.sa-keyb')).toHaveText('⌥⌘P')
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)

    await node(page, '矩阵表示').click()
    const before = read(run)
    await page.keyboard.press('Meta+Enter')
    await page.waitForTimeout(300)
    expect(read(run)).toBe(before)
    await page.keyboard.press('Alt+Meta+KeyP')
    await page.getByRole('textbox', { name: '节点的字' }).fill('表示')
    await page.keyboard.press('Enter')
    await expect.poll(() => read(run)).toContain('  - 表示\n    - 矩阵表示 <!--')
    await armMenus(run)
    await node(page, '例子').click({ button: 'right' })
    await openedMenu(run)
    const accel = await run.app.evaluate(() => (globalThis as unknown as { cnMenu: { menu: Electron.Menu } }).cnMenu.menu.items.find((i) => i.label === '加父主题')!.accelerator)
    expect(accel).toBe('Alt+Command+P')
    await dismissMenu(run)

    // 焦点在导图上：导图只拦自己的键，⌘K 照样开搜索
    await node(page, '例子').click()
    await page.keyboard.press('Meta+k')
    await expect(page.getByRole('dialog', { name: '搜索和命令' })).toBeVisible()
  } finally {
    await run.close()
  }
})
