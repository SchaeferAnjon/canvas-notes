// 数据库的记录文件夹藏到用它的那篇下面（task-5yp97；用户看了 /private/tmp/canvas-notes-visual/06-文件管理/3-藏之后-浅.png
// 说「Ok 用藏之后」，偏好「数据库记录文件夹藏到那篇下面」）：插入数据库时建的那个放每一条记录的文件夹，左栏里不再和普通文件夹一样摆着，
// 挂在用它的那篇下面（那篇多一个展开箭头），一行写「数据库图标 · 名字 · N条」，点开是它的首页（每一条都在）；「移到」菜单里不列它
// （不能把笔记挪进去），这篇本来就在的文件夹是灰的。磁盘上照旧是普通文件夹，不挪不改名。那篇改了名照样挂着；那篇删了它又是普通文件夹。
// 一律无头（CN_E2E=1），右键菜单换成记录器（e2e/menu.ts）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { launch, leftView, openNote, pane, tabOn, waitSaved } from './app'
import { armMenus, dismissMenu, type MenuShot, openedMenu, pickMenu } from './menu'

const NOTE = '课程/study project/学习笔记：动手学深度学习.md'
const DB = '课程/study project/未命名数据库'

const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
/** 树里的一行（按库里的路径找：文件夹行的名字里带着「展开 …」那颗按钮的字） */
const item = (page: Page, path: string) => tree(page).locator(`[role="treeitem"][data-path="${path}"]`)
/** 菜单里所有看得到的字（子菜单写成「课程 › ecp」） */
const flat = (m: MenuShot[], pre = ''): string[] => m.flatMap((i) => (i.type === 'separator' ? [] : [pre + i.label, ...(i.submenu ? flat(i.submenu, pre + i.label + ' › ') : [])]))
/** 文件树里一层层展开到这个文件夹（按路径找那一行，点它的三角） */
async function openDir(page: Page, path: string) {
  const segs = path.split('/')
  for (let i = 1; i <= segs.length; i++) {
    const row = item(page, segs.slice(0, i).join('/'))
    await expect(row).toBeVisible()
    if ((await row.getAttribute('aria-expanded')) !== 'true') await row.getByRole('button', { name: `展开 ${segs[i - 1]}`, exact: true }).click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
  }
}
const BASE = (folder: string) => '```base\nfilters:\n  and:\n    - file.inFolder("' + folder + '")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n```'
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const find = (m: MenuShot[], path: string[]): MenuShot | undefined => {
  let items = m
  let hit: MenuShot | undefined
  for (const n of path) {
    hit = items.find((i) => i.label === n)
    if (!hit) return undefined
    items = hit.submenu ?? []
  }
  return hit
}

test('插入一个数据库：记录文件夹挂在那篇下面写「N条」，不再是一个普通文件夹；「移到」里没有它、这篇所在的文件夹灰着；改名照样挂着、那篇删了它回到普通文件夹；磁盘上不挪不改名', async () => {
  test.setTimeout(150_000)
  const run = await launch({
    [NOTE]: '# 学习笔记：动手学深度学习\n\n2.1 数据操作。\n',
    '课程/study project/小论文计划.md': '# 小论文计划\n\n先列提纲。\n',
    '课程/ecp/第5讲.md': '# 第5讲\n\n注意力。\n',
  })
  const { page, vault } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    // 在笔记里打 /数据库 插一个：旁边建「未命名数据库」，先放一条
    await openNote(page, '学习笔记：动手学深度学习')
    await pane(page).locator('.cm-line', { hasText: '2.1 数据操作。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/数据库')
    await expect(page.locator('.slash-menu button.on')).toContainText('数据库')
    await page.keyboard.press('Enter')
    await expect(pane(page).locator('[data-part="数据库块"]')).toBeVisible()
    await expect.poll(() => existsSync(join(vault, DB, '第一条.md'))).toBe(true)
    await waitSaved(page)
    const db = pane(page).locator('[data-part="数据库块"]')
    await db.getByRole('button', { name: '新一条' }).click()
    await expect(db.locator('tbody tr')).toHaveCount(2)

    // 左栏「文件」：study project 下面没有「未命名数据库」这个普通文件夹；它挂在那篇下面，数据库图标、写「2条」
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).click()
    for (const [path, n] of [['课程', '课程'], ['课程/study project', 'study project']]) {
      const row = item(page, path!)
      await expect(row).toBeVisible()
      if ((await row.getAttribute('aria-expanded')) !== 'true') await row.getByRole('button', { name: `展开 ${n}`, exact: true }).click()
      await expect(row).toHaveAttribute('aria-expanded', 'true')
    }
    const note = item(page, NOTE)
    await expect(note).toBeVisible()
    const noteLevel = Number(await note.getAttribute('aria-level'))
    // 那篇多一个展开箭头；展开以后下面一行是记录文件夹
    await expect(note).toHaveAttribute('aria-expanded', 'false')
    const rec = item(page, DB)
    await expect(rec).toHaveCount(0)
    await tree(page).getByRole('button', { name: '展开 学习笔记：动手学深度学习 的数据库' }).click()
    await expect(note).toHaveAttribute('aria-expanded', 'true')
    await expect(rec).toHaveCount(1)
    await expect(rec).toHaveAttribute('aria-level', String(noteLevel + 1))
    await expect(rec.locator('.ft-count')).toHaveText('2条')
    await expect(rec.locator('svg.ft-db')).toHaveCount(1)
    // 记录本身不在树里一条条列（点开在首页里看）
    await expect(item(page, `${DB}/第一条.md`)).toHaveCount(0)
    // 紧跟在那篇后面
    const order = await tree(page).getByRole('treeitem').evaluateAll((els) => els.map((e) => e.getAttribute('data-path')))
    expect(order[order.indexOf(NOTE) + 1]).toBe(DB)
    // 点它：开它的首页，每一条都在
    await rec.click()
    await expect(tabOn(page)).toHaveText('未命名数据库')
    await expect(pane(page)).toContainText('第一条')

    // 「移到」：哪一层都没有「未命名数据库」；这篇本来就在的 study project 灰着
    await armMenus(run)
    await note.click({ button: 'right' })
    const m = await openedMenu(run)
    const move = find(m, ['移到'])!.submenu!
    expect(flat(move).some((l) => l.includes('未命名数据库'))).toBe(false)
    const here = find(move, ['课程', 'study project'])!
    expect(here.enabled).toBe(false)
    expect(here.submenu).toBeUndefined()
    expect(find(move, ['课程', 'ecp'])!.enabled).toBe(true)
    await dismissMenu(run)
    // 文件夹右键「移到」也不能挪进它
    await item(page, '课程/ecp').click({ button: 'right' })
    const fm = await openedMenu(run)
    expect(flat(find(fm, ['移到'])!.submenu!).some((l) => l.includes('未命名数据库'))).toBe(false)
    await dismissMenu(run)
    // 磁盘上照旧是普通文件夹，没挪没改名
    expect(statSync(join(vault, DB)).isDirectory()).toBe(true)

    // 那篇改名：照样挂着
    await note.click({ button: 'right' })
    await pickMenu(run, '重命名')
    const rn = tree(page).getByRole('textbox')
    await rn.fill('动手学深度学习')
    await rn.press('Enter')
    const renamed = item(page, '课程/study project/动手学深度学习.md')
    await expect(renamed).toBeVisible()
    await expect.poll(() => existsSync(join(vault, '课程/study project/动手学深度学习.md'))).toBe(true)
    if ((await renamed.getAttribute('aria-expanded')) !== 'true') await tree(page).getByRole('button', { name: '展开 动手学深度学习 的数据库' }).click()
    await expect(item(page, DB)).toHaveAttribute('aria-level', String(noteLevel + 1))

    // 打开再保存不变（这篇带着数据库块）
    await openNote(page, '动手学深度学习')
    await waitSaved(page)
    const saved = readFileSync(join(vault, '课程/study project/动手学深度学习.md'))
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(800)
    expect(readFileSync(join(vault, '课程/study project/动手学深度学习.md')).equals(saved)).toBe(true)

    // 那篇删了：没有谁在用它，它回到 study project 下面一个普通文件夹（看得见、删得掉）
    await renamed.click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect.poll(() => existsSync(join(vault, '课程/study project/动手学深度学习.md'))).toBe(false)
    const plain = item(page, DB)
    await expect(plain).toHaveAttribute('aria-level', String(noteLevel))
    await expect(plain).toHaveAttribute('aria-expanded', /true|false/)
  } finally {
    await run.close()
  }
})

test('挂在那篇下面的记录文件夹：右键改名、拖进别的文件夹，数据库块里的路径一起改，提示「链接一起改好了」；拖那篇本身（开着也一样），它的记录文件夹跟着一起挪，一次提交，开着的表马上换成新路径', async () => {
  test.setTimeout(150_000)
  const run = await launch({
    '项目/表.md': `# 表\n\n${BASE('项目/库')}\n`,
    '项目/库/一号.md': '---\n状态: 进行中\n---\n',
    '项目/库/二号.md': '---\n状态: 完成\n---\n[回到表](../表.md)\n',
    '项目/别的.md': '# 别的\n',
    '写作/a.md': '# a\n',
    '生活/b.md': '# b\n',
  })
  const { page, vault } = run
  const text = (p: string) => readFileSync(join(vault, p), 'utf8')
  const toast = page.getByTestId('toast')
  try {
    await leftView(page, '文件')
    await openDir(page, '项目')
    const table = item(page, '项目/表.md')
    const level = Number(await table.getAttribute('aria-level'))
    await tree(page).getByRole('button', { name: '展开 表 的数据库' }).click()
    const rec = item(page, '项目/库')
    await expect(rec).toHaveAttribute('aria-level', String(level + 1))
    await expect(rec.locator('.ft-count')).toHaveText('2条')
    // 「表」开着（看着它往别处放是常见的用法）
    await table.click()
    await expect(tabOn(page)).toHaveText('表')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)

    // 1. 挂着的那一行右键「重命名…」：还挂在「表」下面，数据库块里的路径跟着改（开着的表也换了）
    await armMenus(run)
    await rec.click({ button: 'right' })
    await pickMenu(run, '重命名…')
    const input = tree(page).getByRole('textbox', { name: '新名字' })
    await input.fill('项目库')
    await input.press('Enter')
    await expect.poll(() => existsSync(join(vault, '项目/项目库/一号.md'))).toBe(true)
    await expect.poll(() => text('项目/表.md')).toBe(`# 表\n\n${BASE('项目/项目库')}\n`)
    await expect(toast).toContainText('「库」改名为「项目库」，库里指向它的链接一起改好了')
    const renamed = item(page, '项目/项目库')
    await expect(renamed).toHaveAttribute('aria-level', String(level + 1))
    await expect(renamed).toHaveClass(/ft-dbrow/)
    await expect(renamed.locator('.ft-count')).toHaveText('2条')
    // 改名后中间开着「项目库」的首页（和普通文件夹一样）：切回开着的「表」，路径已经换了
    await page.getByRole('tab', { name: /^表/ }).click()
    await expect(tabOn(page)).toHaveText('表')
    await expect(db.locator('.base-foot')).toHaveText('每条是「项目/项目库」里的一篇笔记')
    await expect(db.locator('tbody tr')).toHaveCount(2)

    // 2. 拖开着的「表」进「写作」：它的记录文件夹跟着一起挪（别的不动），链接改好，一次提交
    const before = git(vault, 'rev-parse', 'HEAD')
    await table.dragTo(item(page, '写作'))
    await expect.poll(() => existsSync(join(vault, '写作/项目库/一号.md'))).toBe(true)
    expect(existsSync(join(vault, '写作/表.md'))).toBe(true)
    expect(existsSync(join(vault, '项目/表.md'))).toBe(false)
    expect(existsSync(join(vault, '项目/项目库'))).toBe(false)
    expect(existsSync(join(vault, '项目/别的.md'))).toBe(true)
    expect(text('写作/表.md')).toBe(`# 表\n\n${BASE('写作/项目库')}\n`)
    // 记录里指回「表」的相对链接照样指着它
    expect(text('写作/项目库/二号.md')).toBe('---\n状态: 完成\n---\n[回到表](../表.md)\n')
    await expect(toast).toContainText('「表」和它的数据库「项目库」挪到了写作，库里指向它们的链接一起改好了')
    // 一次提交：那篇和每一条都在这一次里，工作区干净
    const commits = git(vault, 'log', '--format=%H', `${before}..HEAD`, '--', '项目', '写作').split('\n').filter(Boolean)
    expect(commits).toHaveLength(1)
    const changed = git(vault, 'show', '--name-status', '--no-renames', '--format=', commits[0]!).split('\n').sort()
    expect(changed).toEqual(['A\t写作/表.md', 'A\t写作/项目库/一号.md', 'A\t写作/项目库/二号.md', 'D\t项目/表.md', 'D\t项目/项目库/一号.md', 'D\t项目/项目库/二号.md'])
    expect(git(vault, 'status', '--porcelain', '--', '项目', '写作')).toBe('')
    // 树里：「写作」下面那篇照样挂着它
    await openDir(page, '写作')
    const moved = item(page, '写作/表.md')
    await expect(moved).toHaveAttribute('aria-expanded', /true|false/)
    if ((await moved.getAttribute('aria-expanded')) !== 'true') await tree(page).getByRole('button', { name: '展开 表 的数据库' }).click()
    const there = item(page, '写作/项目库')
    await expect(there).toHaveAttribute('aria-level', String(level + 1))
    await expect(there).toHaveClass(/ft-dbrow/)
    await expect(there.locator('.ft-count')).toHaveText('2条')
    // 开着的表不用重开就换成新路径，那两条都在；接着打字存下去，数据库块里还是新路径（编辑器里没留着旧的）
    await expect(tabOn(page)).toHaveText('表')
    await expect(db.locator('.base-foot')).toHaveText('每条是「写作/项目库」里的一篇笔记')
    await expect(db.locator('tbody tr')).toHaveCount(2)
    await pane(page).locator('.cm-content').focus()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.type('备注')
    await waitSaved(page)
    expect(text('写作/表.md')).toContain(`# 表\n\n${BASE('写作/项目库')}\n`)
    expect(text('写作/表.md')).toContain('备注')

    // 3. 拖挂着的那一行进「生活」：数据库块里的路径跟着改；离开了那篇，在「生活」里照普通文件夹画，「表」没有展开箭头了
    await there.dragTo(item(page, '生活'))
    await expect.poll(() => existsSync(join(vault, '生活/项目库/二号.md'))).toBe(true)
    expect(existsSync(join(vault, '写作/项目库'))).toBe(false)
    await expect(toast).toContainText('「项目库」挪到了生活，库里指向它的链接一起改好了')
    await expect.poll(() => text('写作/表.md')).toContain(`# 表\n\n${BASE('生活/项目库')}\n`)
    await expect(moved).not.toHaveAttribute('aria-expanded')
    await openDir(page, '生活')
    const plain = item(page, '生活/项目库')
    await expect(plain).toHaveAttribute('aria-level', String(level))
    await expect(plain).not.toHaveClass(/ft-dbrow/)
    // 开着的「表」照样有那两条
    await expect(db.locator('tbody tr')).toHaveCount(2)
    await expect(db.locator('.base-foot')).toHaveText('每条是「生活/项目库」里的一篇笔记')
  } finally {
    await run.close()
  }
})
