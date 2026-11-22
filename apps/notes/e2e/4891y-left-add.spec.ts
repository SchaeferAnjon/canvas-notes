// 左栏只加不改（task-4891y）：用户看了 /private/tmp/canvas-notes-visual/06-文件管理/4-加进左栏-浅.png 说「加到左栏就可以了 剩下的保持原样」
// （偏好「文件管理新东西加进左栏、其余原样」「八个分类保持现状」）。图上标的五样：
// ① 树顶「钉住」（右键「钉到最上面」/「取消钉住」，存在库里 .canvas-notes/置顶.json，跟着 Git 走）；
// ② 类型筛选下面一个找文件的框（⌥⌘F，命令表能改），打字把树筛到命中的几行，esc 清空；
// ④ 长名字的 PDF：名字先省略，「PDF」小标和问了几问在默认 248 宽时一直看得到；
// ⑤ 拖着一篇停在收着的文件夹上约 0.6 秒，它自己展开；
// ⑦ 右键「移到…」是能打字找的小弹层：刚挪去过的排最前，本来就在的文件夹灰着，数据库的记录文件夹不列。
// 一律无头（CN_E2E=1），右键菜单换成记录器（e2e/menu.ts），拖是真按下、真挪、真松手。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, leftView, openNote, tabOn, type Running } from './app'
import { BOARD, DB_DIR, INBOX_NOTE, LONG_PDF, treeAddVault } from './fixtures/tree-add'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const side = (page: Page) => page.locator('aside.side')
const tree = (page: Page) => side(page).getByRole('tree', { name: '全部文件' })
const item = (page: Page, path: string) => tree(page).locator(`[role="treeitem"][data-path="${path}"]`)
const shownPaths = (page: Page) => tree(page).locator('[role="treeitem"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-path')))
const pins = (page: Page) => side(page).getByRole('group', { name: '钉住' })
const finder = (page: Page) => side(page).getByRole('searchbox', { name: '找文件' })
const mover = (page: Page) => page.getByRole('dialog', { name: '移到' })
const moverNames = (page: Page) => mover(page).getByRole('menuitem').locator('.truncate').allTextContents()
const pinsJson = (vault: string) => JSON.parse(readFileSync(join(vault, '.canvas-notes/置顶.json'), 'utf8')) as string[]

async function start(files = treeAddVault(), prepare?: (vault: string) => void): Promise<Running> {
  const run = await launch(files, {}, prepare)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await armMenus(run)
  await leftView(run.page, '文件')
  return run
}

/** 一层层点三角展开到这个文件夹 */
async function openDir(page: Page, path: string) {
  const segs = path.split('/')
  for (let i = 1; i <= segs.length; i++) {
    const row = item(page, segs.slice(0, i).join('/'))
    await expect(row).toBeVisible()
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.getByRole('button', { name: `展开 ${segs[i - 1]}`, exact: true }).click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
  }
}

test('① 钉住：右键「钉到最上面」放到库那一行上面一组，存在 置顶.json；点它打开；右键「取消钉住」拿下', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await expect(pins(page)).toHaveCount(0)
    await openDir(page, '课程/study project')
    await item(page, '课程/study project 2').click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toContain('钉到最上面')
    expect(menuLabels(m)).not.toContain('置顶')
    await pickMenu(run, '钉到最上面')
    await expect(pins(page).locator('.ft-row .truncate')).toHaveText(['study project 2'])
    await expect.poll(() => pinsJson(vault)).toEqual(['课程/study project 2/'])
    // 一篇（白板）也能钉，排在后面
    await item(page, BOARD).click({ button: 'right' })
    await pickMenu(run, '钉到最上面')
    await expect(pins(page).locator('.ft-row .truncate')).toHaveText(['study project 2', '小论文计划'])
    await expect.poll(() => pinsJson(vault)).toEqual(['课程/study project 2/', BOARD])
    // 组头「钉住」，整组在库那一行上面
    await expect(pins(page).locator('.ft-gh')).toHaveText('钉住')
    const g = (await pins(page).boundingBox())!
    const root = (await item(page, '').boundingBox())!
    expect(g.y + g.height).toBeLessThanOrEqual(root.y + 1)
    // 文件夹那一行写篇数；点它开首页，点白板开白板
    await expect(pins(page).locator('.ft-row').first().locator('.ft-count')).toHaveText('1')
    await pins(page).locator('.ft-row', { hasText: '小论文计划' }).click()
    await expect(tabOn(page)).toHaveText('小论文计划')
    await pins(page).locator('.ft-row', { hasText: 'study project 2' }).click()
    await expect(tabOn(page)).toHaveText('study project 2')
    // 右键钉住的那一行：「取消钉住」
    await pins(page).locator('.ft-row', { hasText: 'study project 2' }).click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toContain('取消钉住')
    await pickMenu(run, '取消钉住')
    await expect(pins(page).locator('.ft-row .truncate')).toHaveText(['小论文计划'])
    await expect.poll(() => pinsJson(vault)).toEqual([BOARD])
  } finally {
    await run.close()
  }
})

test('② 找文件的框：在类型筛选下面，⌥⌘F 到它，打字把树筛到命中的几行（展开到命中处），回车开第一个，esc 清空；命令表改了键跟着变', async () => {
  const run = await start()
  const { page } = run
  try {
    const box = finder(page)
    await expect(box).toHaveAttribute('placeholder', '找文件、文件夹')
    await expect(side(page).locator('.ft-find .ft-k')).toHaveText('⌥⌘F')
    // 在类型筛选那一排下面、树上面
    const chips = (await side(page).locator('.side-chips').boundingBox())!
    const b = (await box.boundingBox())!
    expect(b.y).toBeGreaterThanOrEqual(chips.y + chips.height - 1)
    expect(b.y).toBeLessThan((await item(page, '').boundingBox())!.y)
    // 在文档里按 ⌥⌘F：光标到找文件的框
    await openNote(page, '菜谱')
    await page.keyboard.press('Alt+Meta+KeyF')
    await expect(box).toBeFocused()
    // 收着的 study project 2 里那份 PDF：展开到它，别的都不在
    await expect(item(page, '课程/study project 2')).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.type('Yiting')
    await expect.poll(() => shownPaths(page)).toEqual(['', '课程', '课程/study project 2', LONG_PDF])
    await expect(item(page, LONG_PDF).locator('.truncate b')).toHaveText('Yiting')
    // 文件夹名字也算
    await box.fill('stu')
    await expect.poll(() => shownPaths(page)).toEqual(['', '课程', '课程/study project', '课程/study project 2'])
    // esc 清空，树回到原来的样子
    await page.keyboard.press('Escape')
    await expect(box).toHaveValue('')
    await expect(item(page, '课程/study project 2')).toHaveAttribute('aria-expanded', 'false')
    await expect(item(page, '收件箱')).toBeVisible()
    // 回车开第一个
    await box.fill('行程')
    await expect.poll(() => shownPaths(page)).toEqual(['', '项目', '项目/冰岛自驾', '项目/冰岛自驾/行程.md'])
    await box.press('Enter')
    await expect(tabOn(page)).toHaveText('行程')
    // 一个都没有：说一句
    await box.fill('没有这个')
    await expect(side(page).getByText('没有名字里带「没有这个」的文件')).toBeVisible()
  } finally {
    await run.close()
  }

  // 命令表里改了键（.canvas-notes/命令.json）：框里写的、按的都跟着换
  const files = { ...treeAddVault(), '.canvas-notes/命令.json': JSON.stringify({ keys: { 'find-file': '⌃⌥⌘F' } }) }
  const run2 = await start(files)
  try {
    await expect(side(run2.page).locator('.ft-find .ft-k')).toHaveText('⌃⌥⌘F')
    await openNote(run2.page, '菜谱')
    await run2.page.keyboard.press('Control+Alt+Meta+KeyF')
    await expect(finder(run2.page)).toBeFocused()
  } finally {
    await run2.close()
  }
})

test('④ 长名字的 PDF：默认左栏宽 248 时名字先省略，「PDF」小标和问了几问一直看得到', async () => {
  const run = await start()
  const { page } = run
  try {
    await openDir(page, '课程/study project 2')
    expect(await side(page).evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBeLessThanOrEqual(248)
    const row = item(page, LONG_PDF)
    await expect(row.getByTestId('ft-note')).toHaveText('6')
    const look = await row.evaluate((r) => {
      const box = r.getBoundingClientRect()
      const seen = (sel: string) => {
        const e = r.querySelector(sel)!.getBoundingClientRect()
        return e.top - box.top < 28 && e.right <= box.right && e.width > 0
      }
      const n = r.querySelector('.truncate') as HTMLElement
      return { ext: seen('.ft-ext'), asks: seen('.ft-nb'), cut: n.scrollWidth > n.clientWidth, nameW: n.clientWidth, h: box.height }
    })
    expect(look).toMatchObject({ ext: true, asks: true, cut: true, h: 28 })
    // 名字也不缩没了：至少露 3 个字那么宽
    expect(look.nameW).toBeGreaterThanOrEqual(36)
  } finally {
    await run.close()
  }
})

test('⑤ 拖着一篇停在收着的文件夹上约 0.6 秒，它自己展开；一晃而过的不展开；松在展开出来的子文件夹上就挪进去', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await openDir(page, '收件箱')
    const src = item(page, INBOX_NOTE)
    await expect(item(page, '项目')).toHaveAttribute('aria-expanded', 'false')
    await expect(item(page, '生活')).toHaveAttribute('aria-expanded', 'false')
    const at = async (path: string) => {
      const b = (await item(page, path).boundingBox())!
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    }
    /**
     * 拖着停在一行上 ms 毫秒：真鼠标停着时 Chromium 每 50 毫秒左右发一次 dragover；Playwright 送的拖动只在鼠标动时才有，
     * 所以停着的这段每 60 毫秒挪 1 像素（手停在那里也会这样微微动）
     */
    const dwell = async (path: string, ms: number) => {
      const p = await at(path)
      await page.mouse.move(p.x, p.y, { steps: 4 })
      for (let t = 0; t < ms; t += 60) {
        await page.waitForTimeout(60)
        await page.mouse.move(p.x + ((t / 60) % 2 ? 1 : 0), p.y)
      }
    }
    const s = await at(INBOX_NOTE)
    await src.hover()
    await page.mouse.down()
    await page.mouse.move(s.x + 10, s.y + 10, { steps: 3 })
    // 在「生活」上停 0.25 秒就走：不展开
    await dwell('生活', 250)
    await expect(item(page, '生活')).toHaveClass(/drop/)
    await dwell('项目', 120)
    await expect(item(page, '项目')).toHaveClass(/drop/)
    await expect(item(page, '项目')).toHaveAttribute('aria-expanded', 'false')
    // 在「项目」上停够 0.6 秒：自己展开
    await dwell('项目', 700)
    await expect(item(page, '项目')).toHaveAttribute('aria-expanded', 'true')
    await page.waitForTimeout(700)
    await expect(item(page, '生活')).toHaveAttribute('aria-expanded', 'false')
    await dwell('项目/冰岛自驾', 120)
    await expect(item(page, '项目/冰岛自驾')).toHaveClass(/drop/)
    await page.mouse.up()
    await expect.poll(() => existsSync(join(vault, '项目/冰岛自驾/周三组会要问的.md'))).toBe(true)
    expect(existsSync(join(vault, INBOX_NOTE))).toBe(false)
  } finally {
    await run.close()
  }
})

test('⑦ 右键「移到…」是能打字找的小弹层：本来就在的灰着、数据库记录文件夹不列；打字找、回车挪；刚挪去过的排最前；文件夹、多选也用它', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await openDir(page, '收件箱')
    await item(page, INBOX_NOTE).click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toContain('移到…')
    expect(menuLabels(m)).not.toContain('移到')
    await pickMenu(run, '移到…')
    await expect(mover(page)).toBeVisible()
    await expect(mover(page).locator('.mv-hd')).toHaveText('把「周三组会要问的」移到…')
    const q = mover(page).getByRole('searchbox', { name: '挪到哪个文件夹' })
    await expect(q).toBeFocused()
    // 全部文件夹：库本身在最前；收件箱是它本来就在的，灰着；数据库的记录文件夹不列
    const all = await moverNames(page)
    expect(all[0]).toBe('测试库')
    expect(all).toContain('study project')
    expect(all).not.toContain('未命名数据库')
    expect(all.some((n) => n.includes(DB_DIR.split('/').pop()!))).toBe(false)
    await expect(mover(page).getByRole('menuitem').filter({ has: page.locator('.truncate', { hasText: /^收件箱$/ }) })).toBeDisabled()
    // 打字找：只剩名字里带 stu 的，右边写在哪
    await q.fill('stu')
    await expect.poll(() => moverNames(page)).toEqual(['study project', 'study project 2'])
    await expect(mover(page).getByRole('menuitem').first().locator('.r')).toHaveText('课程')
    await expect(mover(page).locator('.mh')).toHaveText(['找到的'])
    await q.press('ArrowDown')
    await q.press('Enter')
    await expect(mover(page)).toHaveCount(0)
    await expect.poll(() => existsSync(join(vault, '课程/study project 2/周三组会要问的.md'))).toBe(true)

    // 再挪一篇：「刚挪去过」在最前
    await item(page, '收件箱/Kindle 导出的标注.md').click({ button: 'right' })
    await pickMenu(run, '移到…')
    await expect(mover(page).locator('.mh').first()).toHaveText('刚挪去过')
    expect((await moverNames(page))[0]).toBe('study project 2')
    await page.keyboard.press('Escape')
    await expect(mover(page)).toHaveCount(0)

    // 文件夹右键也是它：自己和自己里面的不列，上一层灰着
    await openDir(page, '项目')
    await item(page, '项目/搬家').click({ button: 'right' })
    const fm = await openedMenu(run)
    expect(menuLabels(fm)).toContain('移到…')
    await pickMenu(run, '移到…')
    await expect(mover(page).locator('.mv-hd')).toHaveText('把「搬家」移到…')
    expect(await moverNames(page)).not.toContain('搬家')
    await expect(mover(page).getByRole('menuitem').filter({ has: page.locator('.truncate', { hasText: /^项目$/ }) })).toBeDisabled()
    await mover(page).getByRole('searchbox').fill('生活')
    await mover(page).getByRole('menuitem').filter({ has: page.locator('.truncate', { hasText: /^生活$/ }) }).click()
    await expect.poll(() => existsSync(join(vault, '生活/搬家/清单.md'))).toBe(true)

    // 多选两篇：底部「移到…」也是这个弹层
    await openDir(page, '课程/ecp')
    await item(page, '课程/ecp/第5讲.md').click({ modifiers: ['Meta'] })
    await item(page, '阅读').click({ modifiers: ['Meta'] })
    await side(page).getByRole('toolbar', { name: '选中的' }).getByRole('button', { name: '移到…' }).click()
    await expect(mover(page).locator('.mv-hd')).toHaveText('把选中的2个移到…')
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})
