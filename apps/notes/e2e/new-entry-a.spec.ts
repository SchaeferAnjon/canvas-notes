// 标题栏「首页」右边的「+」（新建入口方案 A，设计页 149）：点一下新建文档、光标在标题；小箭头 / 按住 / 右键出菜单；
// 菜单四项（模板灰着）；「放进 ⌄」临时换地方只管这一次；⌘N ⇧⌘N 照旧；左栏收起时也在；和左栏头上的「新建笔记」落在同一处。
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, leftView, pane, tabOn } from './app'

const files = {
  '收件箱/冰岛.md': '# 冰岛\n',
  '写作/去冰岛之前.md': '# 去冰岛之前\n',
  '课程/ecp/a.md': '# a\n',
}
const plus = (page: Page) => page.locator('.titlebar').getByRole('button', { name: '新建文档', exact: true })
const chev = (page: Page) => page.locator('.titlebar').getByRole('button', { name: '新建白板、数据库…' })
const menu = (page: Page) => page.getByRole('dialog', { name: '新建', exact: true })
const item = (page: Page, name: string) => menu(page).getByRole('menuitem', { name })
const side = (page: Page) => page.locator('aside.side')
const treeItem = (page: Page, name: string) =>
  page.getByRole('tree', { name: '全部文件' }).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
/** 库里某个文件夹下现在有的 .md（不往下钻） */
const mds = (vault: string, dir: string) => (existsSync(join(vault, dir)) ? readdirSync(join(vault, dir)).filter((f) => f.endsWith('.md')).sort() : [])

async function menuOk(page: Page) {
  await expect(menu(page)).toBeVisible()
  await expect(menu(page).getByRole('menuitem')).toHaveText([/新建文档\s*⌘N/, /新建白板\s*⇧⌘N/, '新建数据库', /从模板…\s*要先做模板/])
  await expect(item(page, '从模板…')).toBeDisabled()
  // 开着就停在「新建文档」上（回车就建）
  await expect(item(page, '新建文档')).toBeFocused()
  await expect(menu(page).locator('.ne-chip')).toHaveText('收件箱')
}

test('点「+」新建文档：中间开、光标在标题、照规矩进收件箱；悬停说放进哪；和左栏「新建笔记」落在同一处', async () => {
  const run = await launch(files)
  const { page, vault } = run
  try {
    await plus(page).hover()
    await expect(page.getByTestId('tooltip')).toHaveText(/新建文档 · 放进「收件箱」\s*⌘N/)
    await plus(page).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名.md'))).toBe(true)
    // 光标在标题：打的字进标题，回车后文件名跟着改
    await page.keyboard.type('从加号建的')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('从加号建的')
    await expect.poll(() => existsSync(join(vault, '收件箱/从加号建的.md'))).toBe(true)

    // 目录树里点了「ecp」：「+」和左栏头上的「新建笔记」都进 课程/ecp（同一个 newNote）
    await leftView(page, '文件')
    await treeItem(page, 'ecp').click()
    await expect(tabOn(page)).toHaveText('ecp')
    await plus(page).hover()
    await expect(page.getByTestId('tooltip')).toHaveText(/放进「ecp」/)
    await plus(page).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect.poll(() => mds(vault, '课程/ecp')).toEqual(['a.md', '未命名.md'])
    await page.keyboard.type('加号')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('加号')
    await treeItem(page, 'ecp').click()
    await expect(tabOn(page)).toHaveText('ecp')
    await side(page).locator('.vh').getByRole('button', { name: '新建笔记' }).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect.poll(() => mds(vault, '课程/ecp')).toEqual(['a.md', '加号.md', '未命名.md'])
  } finally {
    await run.close()
  }
})

test('小箭头、按住「+」、右键「+」都出同一份菜单；按住松手不另建一篇', async () => {
  const run = await launch(files)
  const { page, vault } = run
  try {
    await chev(page).click()
    await menuOk(page)
    await expect(page.locator('.titlebar .ne')).toHaveClass(/\bon\b/)
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)

    const b = (await plus(page).boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await expect(menu(page)).toBeVisible()
    await page.mouse.up()
    await menuOk(page)
    await page.waitForTimeout(500)
    expect(mds(vault, '收件箱')).toEqual(['冰岛.md'])
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)

    await plus(page).click({ button: 'right' })
    await menuOk(page)
    // 点外面收起
    await page.mouse.click(700, 500)
    await expect(menu(page)).toHaveCount(0)
    expect(mds(vault, '收件箱')).toEqual(['冰岛.md'])
  } finally {
    await run.close()
  }
})

test('菜单四项：文档进收件箱、白板和文档放一处（收件箱）、数据库是一篇带数据库块的笔记加记录文件夹、模板灰着点不了', async () => {
  const run = await launch(files)
  const { page, vault } = run
  try {
    await chev(page).click()
    await item(page, '新建文档').click()
    await expect(menu(page)).toHaveCount(0)
    await expect(tabOn(page)).toHaveText('未命名')
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名.md'))).toBe(true)

    await chev(page).click()
    await item(page, '新建白板').click()
    await expect(tabOn(page)).toHaveAttribute('data-path', /未命名白板\.md$/)
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名白板.md'))).toBe(true)
    expect(existsSync(join(vault, '未命名白板.md'))).toBe(false)

    await chev(page).click()
    await item(page, '新建数据库').click()
    await expect(tabOn(page)).toHaveText(/^未命名/)
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名数据库/第一条.md'))).toBe(true)
    await expect.poll(() => mds(vault, '收件箱')).toEqual(['冰岛.md', '未命名 2.md', '未命名.md', '未命名白板.md'])
    const dbNote = '未命名 2.md'
    const text = readFileSync(join(vault, '收件箱', dbNote), 'utf8')
    expect(text).toMatch(/^# 未命名 2\n\n```base\n[\s\S]*收件箱\/未命名数据库[\s\S]*\n```\n$/)
    await expect(pane(page).locator('.cm-base')).toBeVisible()
    await expect(pane(page).locator('.cm-content')).toBeFocused()

    await chev(page).click()
    await expect(item(page, '从模板…')).toBeDisabled()
    const before = readdirSync(vault).length
    await item(page, '从模板…').click({ force: true })
    await expect(menu(page)).toBeVisible()
    expect(readdirSync(vault).length).toBe(before)
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

test('「放进 收件箱 ⌄」换个文件夹只管这一次：建进写作，下一次回到收件箱；收起菜单也回规矩', async () => {
  const run = await launch(files)
  const { page, vault } = run
  try {
    await chev(page).click()
    await menu(page).locator('.ne-chip').click()
    const picker = page.getByRole('dialog', { name: '移到' })
    await expect(picker).toBeVisible()
    // 小框在菜单下沿下面，不压住菜单；再点胶囊收起小框、菜单还在；再点又开
    const [mb, pb] = [(await menu(page).boundingBox())!, (await picker.boundingBox())!]
    expect(pb.y).toBeGreaterThanOrEqual(mb.y + mb.height)
    await menu(page).locator('.ne-chip').click()
    await expect(picker).toHaveCount(0)
    await expect(menu(page)).toBeVisible()
    await menu(page).locator('.ne-chip').click()
    await expect(picker).toBeVisible()
    await picker.getByRole('menuitem', { name: '写作' }).click()
    await expect(picker).toHaveCount(0)
    // 菜单还开着，胶囊换成写作
    await expect(menu(page)).toBeVisible()
    await expect(menu(page).locator('.ne-chip')).toHaveText('写作')
    await item(page, '新建文档').click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect.poll(() => mds(vault, '写作')).toEqual(['去冰岛之前.md', '未命名.md'])
    expect(mds(vault, '收件箱')).toEqual(['冰岛.md'])
    await page.keyboard.type('写作里')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('写作里')

    // 下一次：回到收件箱
    await chev(page).click()
    await expect(menu(page).locator('.ne-chip')).toHaveText('收件箱')
    await item(page, '新建文档').click()
    await expect.poll(() => mds(vault, '收件箱')).toEqual(['冰岛.md', '未命名.md'])
    await page.keyboard.type('收件箱里')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('收件箱里')

    // 挑了地方没建就收起：下一次也回规矩
    await chev(page).click()
    await menu(page).locator('.ne-chip').click()
    await page.getByRole('dialog', { name: '移到' }).getByRole('menuitem', { name: 'ecp' }).click()
    await expect(menu(page).locator('.ne-chip')).toHaveText('ecp')
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await chev(page).click()
    await expect(menu(page).locator('.ne-chip')).toHaveText('收件箱')

    // 白板临时挑了地方就建进那里
    await menu(page).locator('.ne-chip').click()
    await page.getByRole('dialog', { name: '移到' }).getByRole('menuitem', { name: '写作' }).click()
    await item(page, '新建白板').click()
    await expect(tabOn(page)).toHaveAttribute('data-path', /未命名白板\.md$/)
    await expect.poll(() => existsSync(join(vault, '写作/未命名白板.md'))).toBe(true)
  } finally {
    await run.close()
  }
})

test('⌘N、⇧⌘N 照旧；左栏收起时「+」还在、能用', async () => {
  const run = await launch(files)
  const { page, vault } = run
  try {
    await page.keyboard.press('Meta+n')
    await expect(tabOn(page)).toHaveText('未命名')
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名.md'))).toBe(true)
    await page.keyboard.type('按键建的')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('按键建的')
    await page.keyboard.press('Shift+Meta+n')
    await expect(tabOn(page)).toHaveAttribute('data-path', /未命名白板\.md$/)
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名白板.md'))).toBe(true)

    await page.locator('.titlebar').getByRole('button', { name: '收起左栏' }).click()
    await expect(side(page)).toBeHidden()
    await expect(plus(page)).toBeVisible()
    await expect(chev(page)).toBeVisible()
    await plus(page).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await expect.poll(() => mds(vault, '收件箱')).toEqual(['冰岛.md', '按键建的.md', '未命名.md', '未命名白板.md'])
    await chev(page).click()
    await menuOk(page)
  } finally {
    await run.close()
  }
})

test('左栏「新建白板」和新建笔记放一处：没点文件夹进收件箱；目录树里点了「ecp」进 课程/ecp；「+」菜单的新建白板同样进 ecp', async () => {
  const run = await launch(files)
  const { page, vault } = run
  try {
    await leftView(page, '文件')
    const head = side(page).locator('.vh')
    // 没点过文件夹：和新建笔记一样进收件箱（以前在库最外层）
    await head.getByRole('button', { name: '新建白板' }).click()
    await expect(tabOn(page)).toHaveAttribute('data-path', /^收件箱\/未命名白板\.md$/)
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名白板.md'))).toBe(true)
    expect(existsSync(join(vault, '未命名白板.md'))).toBe(false)

    // 目录树里点了「ecp」：左栏「新建白板」进 课程/ecp，和左栏「新建笔记」同一处
    await treeItem(page, 'ecp').click()
    await expect(tabOn(page)).toHaveText('ecp')
    await head.getByRole('button', { name: '新建白板' }).click()
    await expect(tabOn(page)).toHaveAttribute('data-path', /^课程\/ecp\/未命名白板\.md$/)
    await expect.poll(() => mds(vault, '课程/ecp')).toEqual(['a.md', '未命名白板.md'])
    await expect(page.getByRole('tree', { name: '全部文件' }).locator('[data-path="课程/ecp/未命名白板.md"]')).toBeVisible()
    await page.screenshot({ path: join(process.env.CN_SHOTS ?? tmpdir(), 'new-board-in-folder.png') })

    // 「+」菜单里的新建白板：同样进 ecp（菜单底下写着放进「ecp」）
    await treeItem(page, 'ecp').click()
    await chev(page).click()
    await expect(menu(page).locator('.ne-chip')).toHaveText('ecp')
    await item(page, '新建白板').click()
    await expect.poll(() => mds(vault, '课程/ecp')).toEqual(['a.md', '未命名白板 2.md', '未命名白板.md'].sort())
  } finally {
    await run.close()
  }
})
