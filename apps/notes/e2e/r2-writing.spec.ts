/**
 * 发版前第 2 轮（实用 · 写作区）找出来的问题：每条一个测试，真点、真按、真拖。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, leftView, openNote, pane, waitSaved } from './app'
import { armMenus, pickMenu } from './menu'

const board = (page: Page) => pane(page).getByTestId('doc-board')
const col = (page: Page, name: string) => board(page).getByRole('region', { name, exact: true })
const cardIn = (page: Page, name: string, text: string) => col(page, name).locator('.db-card', { hasText: text })

async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
}

const NOTE = '# 外改\n\n## 第一节\n\n开头一段。\n\n外面加的一段。\n\n## 第二节\n\n第二段卡片。\n'

/** 开「外改」切到白板 */
async function docBoard() {
  const run = await launch({ '外改.md': NOTE })
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await openNote(run.page, '外改')
  await acts(run.page).getByRole('tab', { name: '白板' }).click()
  await expect(board(run.page)).toBeVisible()
  const path = join(run.vault, '外改.md')
  return { ...run, path, file: () => readFileSync(path, 'utf8') }
}

/** 双击卡片 → 改字 → 光标到末尾打字；返回弹层 */
async function editCard(page: Page, colName: string, text: string, typed: string) {
  await cardIn(page, colName, text).dblclick()
  const dlg = page.getByRole('dialog', { name: '全文' })
  await dlg.getByRole('button', { name: '改字' }).click()
  const box = dlg.getByRole('textbox', { name: '这张卡的原文' })
  await box.press('End')
  await page.keyboard.type(typed)
  return dlg
}

test('同一文件夹第 3 篇起新建：标题和文件名一样（未命名 3、4），写标题回车改名，空着关掉进废纸篓', async () => {
  const run = await launch({ '收件箱/旧的.md': '# 旧的\n' })
  const { page, vault } = run
  const newBtn = page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' })
  const tabOn = page.getByTestId('tab-on')
  const firstLine = () => pane(page).locator('.cm-line').first()
  try {
    for (const name of ['未命名', '未命名 2', '未命名 3', '未命名 4']) {
      await newBtn.click()
      await expect(tabOn).toHaveText(name)
      await expect(firstLine()).toHaveText(name)
      expect(readFileSync(join(vault, `收件箱/${name}.md`), 'utf8')).toBe(`# ${name}\n\n`)
    }
    // 第 4 篇写标题回车：文件跟着改名
    await page.keyboard.type('第四篇')
    await page.keyboard.press('Enter')
    await expect(tabOn).toHaveText('第四篇')
    await page.keyboard.type('正文')
    await waitSaved(page)
    expect(readFileSync(join(vault, '收件箱/第四篇.md'), 'utf8')).toBe('# 第四篇\n\n正文')
    expect(existsSync(join(vault, '收件箱/未命名 4.md'))).toBe(false)
    // 第 3 篇空着关掉：进废纸篓
    await page.getByRole('tab', { name: /未命名 3/ }).click()
    await expect(tabOn).toHaveText('未命名 3')
    await page.keyboard.press('Meta+w')
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名 3.md'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('新建笔记写了标题不按回车直接 ⌘W：关之前先按标题改文件名', async () => {
  const run = await launch({ '项目/canvas/说明.md': '# 说明\n' })
  const { page, vault } = run
  const newBtn = page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' })
  try {
    await newBtn.click()
    await expect(page.getByTestId('tab-on')).toHaveText('未命名')
    await page.keyboard.type('关标签前的标题')
    await page.waitForTimeout(1000)
    await page.keyboard.press('Meta+w')
    await expect.poll(() => existsSync(join(vault, '收件箱/关标签前的标题.md'))).toBe(true)
    expect(readFileSync(join(vault, '收件箱/关标签前的标题.md'), 'utf8')).toBe('# 关标签前的标题\n\n')
    expect(existsSync(join(vault, '收件箱/未命名.md'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('⌘J 带进 AI 的引文跟着那一篇：换到另一篇再 ⌘J，输入框里不留上一篇的引文；自己接着打的问题留着', async () => {
  const run = await launch({ '黑沙滩.md': '# 黑沙滩\n\n边打字边挪走的一句话。\n', '投稿清单.md': '# 投稿清单\n\n最后一行。\n' })
  const { page } = run
  const box = page.getByRole('textbox', { name: '问 AI' })
  const line = (t: string) => pane(page).locator('.cm-line', { hasText: t })
  const selectLine = async (t: string) => {
    await line(t).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
  }
  try {
    await openNote(page, '黑沙滩')
    await selectLine('边打字边挪走的一句话')
    await page.keyboard.press('Meta+j')
    await expect(box).toHaveValue('> 边打字边挪走的一句话。\n\n')
    await page.keyboard.press('Escape')
    await expect(box).toBeHidden()
    await openNote(page, '投稿清单')
    await line('最后一行').click()
    await page.keyboard.press('Meta+j')
    await expect(box).toBeVisible()
    await expect(box).toHaveValue('')
    // 带了引文又打了问题，换篇：引文拿掉，问题留着
    await page.keyboard.press('Escape')
    await selectLine('最后一行')
    await page.keyboard.press('Meta+j')
    await expect(box).toHaveValue('> 最后一行。\n\n')
    await page.keyboard.type('这句怎么改')
    await openNote(page, '黑沙滩')
    await expect(box).toHaveValue('这句怎么改')
  } finally {
    await run.close()
  }
})

test('白板改字弹层开着时外面改了同一段：存好后文件里是我的版本，外面那版存成冲突副本并提示，不拼出两边都没写过的句子', async () => {
  const run = await docBoard()
  const { page, vault, path, file } = run
  const theirs = NOTE.replace('外面加的一段。', '外面加的一段，手机上又补了半句。')
  try {
    const dlg = await editCard(page, '第一节', '外面加的一段', 'ABC')
    writeFileSync(path, theirs)
    // 外部改动进了编辑器（白板上那张卡变了）再点「存好」
    await expect(cardIn(page, '第一节', '手机上又补了半句')).toBeVisible()
    await dlg.getByRole('button', { name: '存好' }).click()
    await expect(page.locator('.db-toast')).toContainText('冲突')
    await waitSaved(page)
    expect(file()).toBe(NOTE.replace('外面加的一段。', '外面加的一段。ABC'))
    const copies = readdirSync(vault).filter((f) => f.startsWith('外改（冲突 '))
    expect(copies).toHaveLength(1)
    // 时间和写不进去另存的「没存上的字 18-20」同一写法（第 6 轮）
    expect(copies[0]).toMatch(/^外改（冲突 \d{4}-\d\d-\d\d \d\d-\d\d）\.md$/)
    expect(readFileSync(join(vault, copies[0]!), 'utf8')).toBe(theirs)
    // 提示里的副本名和左栏、最近里一样不带 .md（第 3 轮美学）
    await expect(page.locator('.db-toast')).toContainText(`外面那版存成《${copies[0]!.replace(/\.md$/, '')}》`)

    // Esc 关弹层也一样走合并：外面改的是第二节那段（不是一处），两边都在
    const dlg2 = await editCard(page, '第一节', '开头一段', '我加的')
    writeFileSync(path, file().replace('第二段卡片。', '第二段卡片（同步盘那边改的）。'))
    await expect(cardIn(page, '第二节', '同步盘那边改的')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg2).toHaveCount(0)
    await expect(page.locator('.db-toast')).toContainText('合并进来')
    await waitSaved(page)
    expect(file()).toBe(NOTE.replace('外面加的一段。', '外面加的一段。ABC').replace('开头一段。', '开头一段。我加的').replace('第二段卡片。', '第二段卡片（同步盘那边改的）。'))
  } finally {
    await run.close()
  }
})

test('白板拖卡后文件在外面改过：「撤回」照样撤（外面加的那段留着）；撤的那几行外面也改过就明说撤不回；⌘Z 后提示不再挂「撤回」', async () => {
  const run = await docBoard()
  const { page, path, file } = run
  const toast = page.locator('.db-toast')
  const dragOut = async (text: string) => {
    const p = (await cardIn(page, '第一节', text).boundingBox())!
    const bb = (await board(page).boundingBox())!
    await dragTo(page, { x: p.x + 40, y: p.y + 20 }, { x: bb.x + 700, y: bb.y + bb.height - 150 })
    await expect(board(page).locator('.db-card.placed')).toHaveCount(1)
    await expect(toast).toContainText('单独摆在这里')
    await waitSaved(page)
  }
  try {
    // ① 拖出去 → 外面在末尾加一段 → 点「撤回」：卡回到列里，外面那段还在
    await dragOut('开头一段')
    writeFileSync(path, file() + '\n外面后来加的。\n')
    await expect(board(page).getByText('外面后来加的。')).toBeVisible()
    await toast.getByRole('button', { name: '撤回' }).click()
    await expect(board(page).locator('.db-card.placed')).toHaveCount(0)
    await expect(cardIn(page, '第一节', '开头一段')).toBeVisible()
    await expect(toast).toHaveText('撤回了这一步')
    await waitSaved(page)
    expect(file()).toBe(NOTE + '\n外面后来加的。\n')

    // ② 拖出去 → 白板上按 ⌘Z：撤回，提示换成「撤回了这一步」，不再挂「撤回」按钮
    await dragOut('开头一段')
    const bb = (await board(page).boundingBox())!
    await page.mouse.click(bb.x + bb.width - 60, bb.y + bb.height - 120)
    await page.keyboard.press('Meta+z')
    await expect(board(page).locator('.db-card.placed')).toHaveCount(0)
    await expect(toast).toHaveText('撤回了这一步')
    await expect(toast.getByRole('button', { name: '撤回' })).toHaveCount(0)
    await waitSaved(page)
    expect(file()).toBe(NOTE + '\n外面后来加的。\n')

    // ③ 拖出去 → 外面把位置行和那一段都改了 → ⌘Z：撤不回，明说
    await dragOut('开头一段')
    const placed = file()
    writeFileSync(path, placed.replace(/<!-- card id=(\w+) x=\d+ y=\d+ -->\n开头一段。/, '<!-- card id=$1 x=5 y=5 -->\n开头一段，手机上改的。'))
    await expect(board(page).getByText('开头一段，手机上改的。')).toBeVisible()
    await page.mouse.click(bb.x + bb.width - 60, bb.y + bb.height - 120)
    await page.keyboard.press('Meta+z')
    await expect(toast).toHaveText('文件在外面改过，这一步撤不回了')
    await page.waitForTimeout(1200)
    expect(file()).toContain('开头一段，手机上改的。')
    expect(file()).toContain('x=5 y=5')
  } finally {
    await run.close()
  }
})

test('<details> 和 <summary> 分两行写的折叠块：文档里收成一行标题、白板上一张卡，都不露 HTML；文件不变', async () => {
  const text = '# 折叠测试\n\n开头一段。\n\n<details>\n<summary>别处的写法</summary>\n\n里面的字\n\n</details>\n\n收尾一段。\n'
  const run = await launch({ '折叠测试.md': text })
  const { page, vault } = run
  try {
    await openNote(page, '折叠测试')
    const fold = pane(page).locator('.cm-fold-head')
    await expect(fold).toHaveText('别处的写法')
    await expect(pane(page).locator('.cm-content')).not.toContainText('<details')
    await expect(pane(page).locator('.cm-content')).not.toContainText('summary>')
    await fold.click()
    await expect(pane(page).locator('.cm-line', { hasText: '里面的字' })).toBeVisible()
    await expect(pane(page).locator('.cm-content')).not.toContainText('<summary>')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const card = board(page).locator('.db-card', { hasText: '别处的写法' })
    await expect(card).toHaveCount(1)
    await expect(card).not.toContainText('<details')
    await expect(card).not.toContainText('summary>')
    await page.waitForTimeout(1200)
    expect(readFileSync(join(vault, '折叠测试.md'), 'utf8')).toBe(text)
  } finally {
    await run.close()
  }
})

test('白板上拖出去的卡，回到文档在那段开头按退格：并掉上面的空行，藏着的位置行留着，卡还摆在原处', async () => {
  const run = await docBoard()
  const { page, file } = run
  try {
    const p = (await cardIn(page, '第一节', '开头一段').boundingBox())!
    const bb = (await board(page).boundingBox())!
    await dragTo(page, { x: p.x + 40, y: p.y + 20 }, { x: bb.x + 700, y: bb.y + bb.height - 150 })
    await expect(board(page).locator('.db-card.placed')).toHaveCount(1)
    await waitSaved(page)
    const placed = file()
    expect(placed).toMatch(/\n\n<!-- card id=\w+ x=\d+ y=\d+ -->\n开头一段。\n/)
    await acts(page).getByRole('tab', { name: '文档' }).click()
    await pane(page).locator('.cm-line', { hasText: '开头一段。' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(file()).toBe(placed.replace(/\n\n(<!-- card id=\w+ x=\d+ y=\d+ -->\n开头一段。)/, '\n$1'))
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page).locator('.db-card.placed')).toHaveCount(1)
    await expect(board(page).locator('.db-card.placed')).toContainText('开头一段')
  } finally {
    await run.close()
  }
})

const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const treeRow = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
/** 文件树里展开到 path（逐层点三角） */
async function expand(page: Page, path: string) {
  await leftView(page, '文件')
  for (const p of path.split('/')) if ((await treeRow(page, p).getAttribute('aria-expanded')) !== 'true') await treeRow(page, p).locator('.ft-tw').click()
}

test('挪进文件夹撞名：存成「X 2」并在提示里说出新名字（右键「移到」、文件树拖都一样）', async () => {
  const run = await launch({ '写作/游记/冰岛第二稿.md': '# 冰岛第二稿\n\n旧的。\n', '收件箱/冰岛第二稿.md': '# 冰岛第二稿\n\n新的。\n', '收件箱/对比.md': '# 对比\n', '写作/游记/对比.md': '# 对比\n' })
  const { page, vault } = run
  const toast = page.getByTestId('toast')
  try {
    await armMenus(run)
    await expand(page, '收件箱')
    await expand(page, '写作')
    await treeRow(page, '冰岛第二稿').first().click({ button: 'right' })
    await pickMenu(run, '移到 › 写作 › 游记')
    await expect.poll(() => existsSync(join(vault, '写作/游记/冰岛第二稿 2.md'))).toBe(true)
    await expect(toast).toContainText('写作/游记里已经有一篇叫「冰岛第二稿」，这篇挪过去存成「冰岛第二稿 2」')
    await treeRow(page, '对比').first().dragTo(treeRow(page, '游记'))
    await expect.poll(() => existsSync(join(vault, '写作/游记/对比 2.md'))).toBe(true)
    await expect(toast).toContainText('这篇挪过去存成「对比 2」')
  } finally {
    await run.close()
  }
})

test('连着删两篇：⌘Z 两次依次恢复（后删的先回来），提示条说接下来恢复哪篇', async () => {
  const run = await launch({ '写作/甲.md': '# 甲\n\n甲的正文。\n', '写作/乙.md': '# 乙\n\n乙的正文。\n', '别的.md': '# 别的\n' })
  const { page, vault } = run
  const toast = page.getByTestId('toast')
  try {
    await armMenus(run)
    await expand(page, '写作')
    for (const n of ['甲', '乙']) {
      await treeRow(page, n).click({ button: 'right' })
      await pickMenu(run, '移到废纸篓')
      await expect.poll(() => existsSync(join(vault, `写作/${n}.md`))).toBe(false)
    }
    await expect(toast).toContainText('已删除《乙》（连着删了2篇，撤回从这篇起依次恢复）')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => existsSync(join(vault, '写作/乙.md'))).toBe(true)
    await expect(toast).toContainText('恢复了《乙》，再撤回恢复《甲》')
    // 恢复的那篇打开了、光标在正文里：⌘Z 还是先归撤回删除
    await page.keyboard.press('Meta+z')
    await expect.poll(() => existsSync(join(vault, '写作/甲.md'))).toBe(true)
    await expect(toast).toContainText('恢复了《甲》')
    expect(readFileSync(join(vault, '写作/甲.md'), 'utf8')).toBe('# 甲\n\n甲的正文。\n')
    expect(readFileSync(join(vault, '写作/乙.md'), 'utf8')).toBe('# 乙\n\n乙的正文。\n')
  } finally {
    await run.close()
  }
})

test('文件树里文件夹也能拖进别的文件夹（和访达一样）；拖进它自己里面不动', async () => {
  const run = await launch({ '生活/旧稿/习惯.md': '# 习惯\n', '写作/a.md': '# a\n' })
  const { page, vault } = run
  try {
    await expand(page, '生活')
    await expect(treeRow(page, '旧稿')).toHaveAttribute('draggable', 'true')
    await treeRow(page, '旧稿').dragTo(treeRow(page, '写作'))
    await expect.poll(() => existsSync(join(vault, '写作/旧稿/习惯.md'))).toBe(true)
    expect(existsSync(join(vault, '生活/旧稿'))).toBe(false)
    await expect(page.getByTestId('toast')).toContainText('「旧稿」挪到了写作')
  } finally {
    await run.close()
  }
})

test('数据库「新一条」名字格直接能起名；条目在左栏「最近」标出是哪个表的；写作首页草稿不算数据库条目、一行的新笔记不算写完、同名的标子文件夹、摘要不露记号', async () => {
  const base = '```base\nfilters:\n  and:\n    - file.inFolder("写作/未命名数据库")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 状态\n```'
  const long = '这是一篇写完了的长文章。'.repeat(12)
  const run = await launch({
    '写作/计划.md': `# 计划\n\n${long}\n\n${base}\n`,
    '写作/未命名数据库/第一条.md': '---\n状态: 未开始\n---\n',
    '写作/未命名.md': '# 未命名\n\n只写了一句。\n',
    '写作/专栏/未命名.md': '# 未命名\n\n专栏里也只写了一句。\n',
    '写作/长文.md': `# 长文\n\n${long}\n`,
    '写作/折叠测试.md': '# 折叠测试\n\n<details><summary>旧的预算</summary>\n\n旧预算第一段\n\n</details>\n\n<https://example.com> 脚注[^1]\n\n[^1]: 说明\n',
  })
  const { page, vault } = run
  try {
    await openNote(page, '计划')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(1)
    await db.getByRole('button', { name: '新一条' }).click()
    const name = db.getByRole('textbox', { name: '未命名 · 名字' })
    await expect(name).toBeFocused()
    await page.keyboard.type('冰岛机票')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(vault, '写作/未命名数据库/冰岛机票.md'))).toBe(true)
    expect(existsSync(join(vault, '写作/未命名数据库/未命名.md'))).toBe(false)
    await expect(db.locator('tbody tr', { hasText: '冰岛机票' })).toHaveCount(1)
    // 左栏「最近」：数据库的条目后面写表名
    await leftView(page, '最近')
    await expect(page.locator('aside.side .si', { hasText: '冰岛机票' }).locator('.s-table')).toHaveText('未命名数据库')
    await expect(page.locator('aside.side .si', { hasText: '长文' }).locator('.s-table')).toHaveCount(0)
    // 写作首页
    await expand(page, '写作')
    await treeRow(page, '写作').click()
    const home = page.getByTestId('folder-home')
    await expect(home.locator('.fh-title p')).toHaveText('写作 · 3篇草稿 · 这个月写完2篇')
    const drafts = page.getByTestId('fw-drafts')
    await expect(drafts.locator('.fw-row')).toHaveCount(3)
    await expect(drafts).not.toContainText('冰岛机票')
    await expect(drafts).not.toContainText('第一条')
    // 两篇「未命名」：专栏里那篇后面写「专栏」
    await expect(drafts.locator('.fw-row', { hasText: '专栏' }).locator('.fw-in')).toHaveText('专栏')
    const done = page.getByTestId('fw-list')
    await expect(done).toContainText('长文')
    await expect(done).not.toContainText('未命名')
    // 下面文件列表里的摘要：折叠块、尖括号链接、脚注都只留字
    const pv = page.getByTestId('folder-content').locator('button', { hasText: '折叠测试' }).locator('.pv')
    await expect(pv).toHaveText('旧的预算 旧预算第一段 https://example.com 脚注 说明')
    await page.screenshot({ path: 'test-results/r2-writing-home.png' })
  } finally {
    await run.close()
  }
})

test('白板上从 x=0 摆起的列：左边竖着的工具板不盖住列头', async () => {
  const run = await launch({ '写作计划.md': '---\ntype: board\ncolor: #4A7FA7\n---\n写作计划。\n\n<!-- column id=c1 x=0 y=0 w=300 title=十一月 -->\n<!-- card id=k1 in=c1 -->\n第一张\n' })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await page.locator('.nav .si', { hasText: /^写作计划/ }).first().click()
    await expect(pane(page).getByTestId('board')).toBeVisible()
    const head = pane(page).locator('.bcol h3', { hasText: '十一月' })
    await expect(head).toBeVisible()
    const pal = (await pane(page).locator('.bpal').boundingBox())!
    const h = (await head.boundingBox())!
    expect(h.x).toBeGreaterThanOrEqual(pal.x + pal.width)
    await page.screenshot({ path: 'test-results/r2-board-pal.png' })
  } finally {
    await run.close()
  }
})
