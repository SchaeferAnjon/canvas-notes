/**
 * 发版前第 3 轮（实用 · 写作区）找出来的问题：每条一个测试，真点、真按、真拖。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, leftView, openNote, pane, tabOn, waitSaved } from './app'
import { armMenus, pickMenu } from './menu'

const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const treeRow = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
/** 文件树里展开到 path（逐层点三角） */
async function expand(page: Page, path: string) {
  await leftView(page, '文件')
  for (const p of path.split('/')) if ((await treeRow(page, p).getAttribute('aria-expanded')) !== 'true') await treeRow(page, p).locator('.ft-tw').click()
}

test('文件树点开一篇直接打字：字落在正文第一段末尾，不插到「# 」前面；撤回删除后恢复的那篇也一样', async () => {
  const run = await launch({
    '生活/日记.md': '# 日记\n\n今天下雪了。\n',
    '生活/投稿清单.md': '# 投稿清单\n',
    '写作/丁.md': '# 丁\n\n丁的正文。\n',
    '写作/戊.md': '# 戊\n\n戊的正文。\n',
  })
  const { page, vault } = run
  const file = (p: string) => readFileSync(join(vault, p), 'utf8')
  try {
    await expand(page, '生活')
    await treeRow(page, '日记').click()
    await expect(tabOn(page)).toHaveText('日记')
    // 编辑器读完文件、光标出来了（人看得到光标才打字）
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await page.keyboard.type('今')
    await waitSaved(page)
    expect(file('生活/日记.md')).toBe('# 日记\n\n今天下雪了。今\n')
    await expect(pane(page).locator('.cm-line').first()).toHaveText('日记')

    // 只有标题的：打在标题后面
    await treeRow(page, '投稿清单').click()
    await expect(tabOn(page)).toHaveText('投稿清单')
    // 编辑器读完文件、光标出来了（人看得到光标才打字）
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await page.keyboard.type('X')
    await waitSaved(page)
    expect(file('生活/投稿清单.md')).toBe('# 投稿清单X\n')

    // 回到「日记」：光标在上次离开的地方（刚打的「今」后面）
    await page.getByRole('tab', { name: /日记/ }).click()
    await page.keyboard.press('Meta+w')
    await treeRow(page, '日记').click()
    await expect(tabOn(page)).toHaveText('日记')
    // 编辑器读完文件、光标出来了（人看得到光标才打字）
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await page.keyboard.type('天')
    await waitSaved(page)
    expect(file('生活/日记.md')).toBe('# 日记\n\n今天下雪了。今天\n')

    // 连删两篇，⌘Z 恢复：恢复后打开的那篇直接打字
    await armMenus(run)
    await expand(page, '写作')
    for (const n of ['丁', '戊']) {
      await treeRow(page, n).click({ button: 'right' })
      await pickMenu(run, '移到废纸篓')
      await expect.poll(() => existsSync(join(vault, `写作/${n}.md`))).toBe(false)
    }
    await page.keyboard.press('Meta+z')
    await expect.poll(() => existsSync(join(vault, '写作/戊.md'))).toBe(true)
    await expect(tabOn(page)).toHaveText('戊')
    // 编辑器读完文件、光标出来了（人看得到光标才打字）
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await page.keyboard.type('W')
    await waitSaved(page)
    expect(file('写作/戊.md')).toBe('# 戊\n\n戊的正文。W\n')
  } finally {
    await run.close()
  }
})

/** 切到 title 那个标签的白板，双击卡片 → 改字 → 末尾打字（不点存好） */
async function typeInCardDialog(page: Page, title: string, card: string, typed: string) {
  await page.getByRole('tab', { name: new RegExp(title) }).first().click()
  await expect(tabOn(page)).toHaveText(title)
  const acts = page.getByTestId('tab-acts')
  if ((await acts.getByRole('tab', { name: '白板' }).getAttribute('aria-selected')) !== 'true') await acts.getByRole('tab', { name: '白板' }).click()
  await pane(page).getByTestId('doc-board').locator('.db-card', { hasText: card }).dblclick()
  const dlg = page.getByRole('dialog', { name: '全文' })
  await dlg.getByRole('button', { name: '改字' }).click()
  await dlg.getByRole('textbox', { name: '这张卡的原文' }).press('End')
  await page.keyboard.type(typed)
}

test('白板「改字」弹层开着时 ⌘W、标签右键「关闭其他」：弹层里打的字先存进文件再关', async () => {
  const NOTE = (t: string) => `# ${t}\n\n## 一\n\n卡一。\n\n## 二\n\n卡二。\n`
  const run = await launch({ '弹层关标签.md': NOTE('弹层关标签'), '关闭其他.md': NOTE('关闭其他'), '首页留着.md': '# 首页留着\n' })
  const { page, vault } = run
  const file = (p: string) => readFileSync(join(vault, p), 'utf8')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await leftView(page, '文件')
    await treeRow(page, '弹层关标签').click()
    await typeInCardDialog(page, '弹层关标签', '卡二', '弹层里没存的字')
    await page.keyboard.press('Meta+w')
    await expect(page.getByRole('tab', { name: /弹层关标签/ })).toHaveCount(0)
    await expect.poll(() => file('弹层关标签.md')).toBe(NOTE('弹层关标签').replace('卡二。', '卡二。弹层里没存的字'))

    // 「关闭其他」：在另一个标签上右键
    await treeRow(page, '关闭其他').click()
    await treeRow(page, '首页留着').click()
    await typeInCardDialog(page, '关闭其他', '卡一', '关其他前的字')
    await armMenus(run)
    await page.getByRole('tab', { name: /首页留着/ }).click({ button: 'right' })
    await pickMenu(run, '关闭其他')
    await expect(page.getByRole('tab', { name: /关闭其他/ })).toHaveCount(0)
    await expect.poll(() => file('关闭其他.md')).toBe(NOTE('关闭其他').replace('卡一。', '卡一。关其他前的字'))
  } finally {
    await run.close()
  }
})

const BASE = (folder: string) => '```base\nfilters:\n  and:\n    - file.inFolder("' + folder + '")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n```'

test('数据库连点「新一条」起名：每条打的名字都存成文件名（不再隔一条丢一条）；名字里有 / : ? 时说清换成了什么，不说重名', async () => {
  const run = await launch({ '项目/表.md': `# 表\n\n${BASE('项目/库')}\n`, '项目/库/已有.md': '---\n状态: 进行中\n---\n' })
  const { page, vault } = run
  const names = () => readdirSync(join(vault, '项目/库')).filter((f) => f.endsWith('.md')).sort()
  const toast = page.getByTestId('toast')
  try {
    await openNote(page, '表')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(1)
    for (const n of ['一号', '二号', '三号', '四号']) {
      await db.getByRole('button', { name: '新一条' }).click()
      const box = db.locator('input.base-in')
      await expect(box).toBeFocused()
      await page.keyboard.type(n)
      await page.keyboard.press('Enter')
      await expect.poll(() => existsSync(join(vault, `项目/库/${n}.md`))).toBe(true)
      await expect(db.locator('tbody tr', { hasText: n })).toHaveCount(1)
    }
    expect(names()).toEqual(['一号.md', '三号.md', '二号.md', '四号.md', '已有.md'].sort())
    // 打了名字不按回车直接点「新一条」（失焦存名），接着起下一条
    await db.getByRole('button', { name: '新一条' }).click()
    await expect(db.locator('input.base-in')).toBeFocused()
    await page.keyboard.type('五号')
    await db.getByRole('button', { name: '新一条' }).click()
    await expect(db.locator('input.base-in')).toBeFocused()
    await page.keyboard.type('六号')
    await page.keyboard.press('Enter')
    await expect.poll(() => names().filter((n) => /[五六]号/.test(n))).toEqual(['五号.md', '六号.md'].sort())
    expect(names().filter((n) => n.startsWith('未命名'))).toEqual([])
    // 不能当文件名的字：说清换成了什么
    await db.getByRole('button', { name: '新一条' }).click()
    await expect(db.locator('input.base-in')).toBeFocused()
    await page.keyboard.type('冰岛:机票?')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(vault, '项目/库/冰岛-机票.md'))).toBe(true)
    await expect(toast).toContainText('「:」「?」不能用在文件名里，已换成「冰岛-机票」')
    await expect(toast).not.toContainText('已经有')
  } finally {
    await run.close()
  }
})

test('新建笔记标题带「?」：存成去掉问号的文件名，提示说清「?」不能用在文件名里，不说重名', async () => {
  const run = await launch({ '收件箱/旧的.md': '# 旧的\n' })
  const { page, vault } = run
  const toast = page.getByTestId('toast')
  try {
    await page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' }).click()
    await expect(tabOn(page)).toHaveText('未命名')
    await page.keyboard.type('为什么?')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(vault, '收件箱/为什么.md'))).toBe(true)
    await expect(toast).toContainText('「?」不能用在文件名里，已换成「为什么」')
    await expect(toast).not.toContainText('已经有')
  } finally {
    await run.close()
  }
})

test('数据库的数据源文件夹在文件树里拖进别的文件夹、右键重命名：表照样有那几条，代码块里的路径跟着改', async () => {
  const run = await launch({
    '项目/表.md': `# 表\n\n${BASE('项目/库')}\n`,
    '项目/库/一号.md': '---\n状态: 进行中\n---\n',
    '项目/库/二号.md': '---\n状态: 完成\n---\n',
    '写作/a.md': '# a\n',
  })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '项目/表.md'), 'utf8')
  try {
    await expand(page, '项目')
    await treeRow(page, '库').dragTo(treeRow(page, '写作'))
    await expect.poll(() => existsSync(join(vault, '写作/库/一号.md'))).toBe(true)
    await expect(page.getByTestId('toast')).toContainText('链接一起改好了')
    expect(file()).toBe(`# 表\n\n${BASE('写作/库')}\n`)
    await treeRow(page, '表').click()
    await expect(tabOn(page)).toHaveText('表')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)

    // 右键「重命名…」
    await armMenus(run)
    await expand(page, '写作')
    await treeRow(page, '库').click({ button: 'right' })
    await pickMenu(run, '重命名…')
    const input = tree(page).getByRole('textbox', { name: '新名字' })
    await input.fill('项目库')
    await input.press('Enter')
    await expect.poll(() => existsSync(join(vault, '写作/项目库/二号.md'))).toBe(true)
    await expect.poll(file).toBe(`# 表\n\n${BASE('写作/项目库')}\n`)
    // 改名后中间开着「项目库」的首页：切回「表」
    await page.getByRole('tab', { name: /^表/ }).click()
    await expect(tabOn(page)).toHaveText('表')
    await expect(db.locator('tbody tr')).toHaveCount(2)
    await expect(db).toContainText('「项目库/」')
  } finally {
    await run.close()
  }
})

test('开头的属性只有软件自己用的键（created、source……）：文档里整段藏起来，不露「---」原文；打开再关文件一个字节不变', async () => {
  const JI = '---\ncreated: 2026-11-14 21:20\n---\n极光要看太阳风和云量，云量低于三成、KP 指数到 3 以上就值得出门。维克附近光污染少。\n'
  const CLIP = '---\nsource: https://example.com/a\ncreated: 2026-11-14 21:20\ntype: clip\n---\n# 剪来的\n\n正文一段。\n'
  const run = await launch({ '收件箱/极光.md': JI, '收件箱/剪来的.md': CLIP })
  const { page, vault } = run
  try {
    for (const [name, text, first] of [['极光', JI, '极光要看太阳风'], ['剪来的', CLIP, '剪来的']] as const) {
      await expand(page, '收件箱')
      await treeRow(page, name).click()
      await expect(tabOn(page)).toHaveText(name)
      const lines = pane(page).locator('.cm-content')
      await expect(lines).toContainText(first)
      await expect(lines).not.toContainText('created')
      await expect(lines).not.toContainText('---')
      await page.keyboard.press('Meta+w')
      await expect(tabOn(page)).not.toHaveText(name)
      expect(readFileSync(join(vault, `收件箱/${name}.md`), 'utf8')).toBe(text)
    }
  } finally {
    await run.close()
  }
})

test('⌘J：先打好的问题不被引文盖掉（引文放在问题上面）；引文改过几个字、前面打过字，换到别的篇照样拿掉，问题留着', async () => {
  const run = await launch({ '引文甲.md': '# 引文甲\n\n第一段甲。\n\n第三段甲。\n', '引文乙.md': '# 引文乙\n\n乙的正文。\n' })
  const { page } = run
  const box = page.getByRole('textbox', { name: '问 AI' })
  const line = (t: string) => pane(page).locator('.cm-line', { hasText: t })
  const selectLine = async (t: string) => {
    await line(t).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Shift+Home')
  }
  try {
    await openNote(page, '引文甲')
    await line('第一段甲').click()
    await page.keyboard.press('Meta+j')
    await expect(box).toBeFocused()
    await page.keyboard.type('帮我改得口语一点')
    await page.keyboard.press('Escape')
    await selectLine('第三段甲')
    await page.keyboard.press('Meta+j')
    await expect(box).toHaveValue('> 第三段甲。\n\n帮我改得口语一点')
    // 再选一段 ⌘J：换成新的引文，问题还在
    await page.keyboard.press('Escape')
    await selectLine('第一段甲')
    await page.keyboard.press('Meta+j')
    await expect(box).toHaveValue('> 第一段甲。\n\n帮我改得口语一点')
    // 改引文（删两个字）、在最前面打字，再换篇：引文拿掉，打的字留着
    await box.press('Meta+ArrowUp')
    await page.keyboard.type('先问：')
    await box.press('Meta+ArrowDown')
    await page.keyboard.type('，这句通顺吗')
    await box.evaluate((el: HTMLTextAreaElement) => {
      const v = el.value.replace('第一段', '一段')
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await expect(box).toHaveValue('先问：> 一段甲。\n\n帮我改得口语一点，这句通顺吗')
    await openNote(page, '引文乙')
    await expect(box).toHaveValue('先问：\n\n帮我改得口语一点，这句通顺吗')
  } finally {
    await run.close()
  }
})

test('关掉空着的新笔记（关闭其他、⌘W）：不出英文 ENOENT，空笔记进废纸篓；先删的那篇提示不被顶掉，⌘Z 还能恢复', async () => {
  const run = await launch({ '项目/说明.md': '# 说明\n', '项目/要删的.md': '# 要删的\n\n留着的正文。\n' })
  const { page, vault } = run
  const toast = page.getByTestId('toast')
  const newIn = async (folder: string) => {
    await treeRow(page, folder).click({ button: 'right' })
    await pickMenu(run, '新建笔记')
    await expect(tabOn(page)).toHaveText(/^未命名/)
  }
  try {
    await armMenus(run)
    await expand(page, '项目')
    // 点「项目」开它的文件夹首页，新建一篇空的，在首页标签上右键「关闭其他」（之后文件夹首页开在前面，文件一变就重新列）
    await treeRow(page, '项目').locator('.truncate').click()
    await expect(tabOn(page)).toHaveText('项目')
    await newIn('项目')
    await page.getByRole('tab', { name: /^项目/ }).click({ button: 'right' })
    await pickMenu(run, '关闭其他')
    await expect.poll(() => existsSync(join(vault, '项目/未命名.md'))).toBe(false)
    // 再新建、等一下、⌘W：反复几次
    for (let i = 0; i < 3; i++) {
      await newIn('项目')
      await page.waitForTimeout(i === 0 ? 1500 : 300)
      await page.keyboard.press('Meta+w')
      await expect.poll(() => readdirSync(join(vault, '项目')).filter((f) => f.startsWith('未命名'))).toEqual([])
      await page.waitForTimeout(500)
      await expect(toast.filter({ hasText: 'ENOENT' })).toHaveCount(0)
    }
    // 先删一篇，再关空的新笔记：删除的提示还在，⌘Z 恢复刚删的
    await treeRow(page, '要删的').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect.poll(() => existsSync(join(vault, '项目/要删的.md'))).toBe(false)
    await newIn('项目')
    await page.keyboard.press('Meta+w')
    await expect.poll(() => readdirSync(join(vault, '项目')).filter((f) => f.startsWith('未命名'))).toEqual([])
    await page.waitForTimeout(500)
    await expect(toast.filter({ hasText: 'ENOENT' })).toHaveCount(0)
    await expect(toast).toContainText('已删除《要删的》')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => existsSync(join(vault, '项目/要删的.md'))).toBe(true)
  } finally {
    await run.close()
  }
})

test('白板上单独摆着的卡，回到文档在那段开头退格两下：第二下把这段并到上一段末尾（屏上看得见），卡还摆在原处', async () => {
  const NOTE = '# 合并测试\n\n## 第一节\n\n第二段卡片。\n\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n'
  const run = await launch({ '合并测试.md': NOTE })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '合并测试.md'), 'utf8')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await openNote(page, '合并测试')
    await pane(page).locator('.cm-line', { hasText: '收尾一段。' }).click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(file()).toBe('# 合并测试\n\n## 第一节\n\n第二段卡片。\n<!-- card id=d2 x=900 y=200 -->\n收尾一段。\n')
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(file()).toBe('# 合并测试\n\n## 第一节\n\n<!-- card id=d2 x=900 y=200 -->\n第二段卡片。收尾一段。\n')
    await expect(pane(page).locator('.cm-line', { hasText: '第二段卡片。收尾一段。' })).toHaveCount(1)
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const placed = pane(page).getByTestId('doc-board').locator('.db-card.placed')
    await expect(placed).toHaveCount(1)
    await expect(placed).toContainText('第二段卡片。收尾一段。')
  } finally {
    await run.close()
  }
})

test('套着的折叠块（外层两行写法套内层）：文档、白板都不露外层的 HTML；打开、切白板、关掉字节不变', async () => {
  const NOTE = '# 折叠丁\n\n<details>\n<summary>外层</summary>\n\n<details>\n<summary>内层</summary>\n\n最里面。\n\n</details>\n\n</details>\n\n后面一段。\n'
  const run = await launch({ '折叠丁.md': NOTE })
  const { page, vault } = run
  try {
    await openNote(page, '折叠丁')
    const content = pane(page).locator('.cm-content')
    await expect(content).toContainText('外层')
    await expect(content).not.toContainText('<details>')
    await expect(content).not.toContainText('</details>')
    // 展开外层：里面的内层收成一行，也没有标签
    await pane(page).locator('.cm-fold-head', { hasText: '外层' }).click()
    await expect(pane(page).locator('.cm-fold-head', { hasText: '内层' })).toBeVisible()
    await expect(content).not.toContainText('<summary>')
    await expect(content).not.toContainText('</details>')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const db = pane(page).getByTestId('doc-board')
    await expect(db.locator('.db-card[data-kind="details"]')).toHaveCount(1)
    for (const raw of ['<details', '</summary>', '</details>']) await expect(db).not.toContainText(raw)
    await page.keyboard.press('Meta+w')
    await expect(page.getByRole('tab', { name: /折叠丁/ })).toHaveCount(0)
    expect(readFileSync(join(vault, '折叠丁.md'), 'utf8')).toBe(NOTE)
  } finally {
    await run.close()
  }
})

test('外面改了正在改的同一段、又改了别的段：同一段留我的，外面别处改的照样进主文件（白板改字、文档里打字都一样），外面那版另存冲突副本', async () => {
  const NOTE = '# 合并\n\n## 第一节\n\n外面加的一段。\n\n## 第二节\n\n收尾一段。\n'
  const run = await launch({ '合并.md': NOTE, '文档里.md': NOTE.replace('# 合并', '# 文档里') })
  const { page, vault } = run
  const file = (n: string) => readFileSync(join(vault, `${n}.md`), 'utf8')
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    // ① 白板改字
    await openNote(page, '合并')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await pane(page).getByTestId('doc-board').locator('.db-card', { hasText: '外面加的一段' }).dblclick()
    const dlg = page.getByRole('dialog', { name: '全文' })
    await dlg.getByRole('button', { name: '改字' }).click()
    await dlg.getByRole('textbox', { name: '这张卡的原文' }).press('End')
    await page.keyboard.type('我的')
    writeFileSync(join(vault, '合并.md'), NOTE.replace('外面加的一段。', '外面加的一段，手机上补的。').replace('收尾一段。', '收尾一段。外面也改了收尾。'))
    await expect(pane(page).getByTestId('doc-board').locator('.db-card', { hasText: '外面也改了收尾' })).toBeVisible()
    await dlg.getByRole('button', { name: '存好' }).click()
    await expect(page.locator('.db-toast')).toContainText('外面别处改的也合进来了')
    await expect.poll(() => file('合并')).toBe(NOTE.replace('外面加的一段。', '外面加的一段。我的').replace('收尾一段。', '收尾一段。外面也改了收尾。'))
    await expect.poll(() => readdirSync(vault).filter((f) => f.startsWith('合并（冲突 ')).length).toBe(1)

    // ② 文档里打字
    await openNote(page, '文档里')
    await pane(page).locator('.cm-line', { hasText: '外面加的一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('我的')
    writeFileSync(join(vault, '文档里.md'), NOTE.replace('# 合并', '# 文档里').replace('外面加的一段。', '外面加的一段，手机上补的。').replace('收尾一段。', '收尾一段。外面也改了收尾。'))
    await expect(page.getByTestId('toast')).toContainText('外面别处改的也合进来了', { timeout: 10_000 })
    await waitSaved(page)
    expect(file('文档里')).toBe(NOTE.replace('# 合并', '# 文档里').replace('外面加的一段。', '外面加的一段。我的').replace('收尾一段。', '收尾一段。外面也改了收尾。'))
    expect(readdirSync(vault).filter((f) => f.startsWith('文档里（冲突 ')).length).toBe(1)
  } finally {
    await run.close()
  }
})

test('连删两篇、⌘Z 恢复一篇后在里面打了字：再 ⌘Z 先撤打的字，不去恢复下一篇；提示条上的「撤回」照样能恢复下一篇', async () => {
  const run = await launch({ '写作/甲.md': '# 甲\n\n甲的正文。\n', '写作/乙.md': '# 乙\n\n乙的正文。\n' })
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
    await page.keyboard.press('Meta+z')
    await expect.poll(() => existsSync(join(vault, '写作/乙.md'))).toBe(true)
    await expect(tabOn(page)).toHaveText('乙')
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await page.keyboard.type('接着写')
    await waitSaved(page)
    expect(readFileSync(join(vault, '写作/乙.md'), 'utf8')).toBe('# 乙\n\n乙的正文。接着写\n')
    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(readFileSync(join(vault, '写作/乙.md'), 'utf8')).toBe('# 乙\n\n乙的正文。\n')
    expect(existsSync(join(vault, '写作/甲.md'))).toBe(false)
    await toast.getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, '写作/甲.md'))).toBe(true)
  } finally {
    await run.close()
  }
})
