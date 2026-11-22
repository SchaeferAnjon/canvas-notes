/**
 * 发版前第 1 轮（实用 · 写作区）找出来的问题：每条一个测试，真点、真按、真拖。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, readdirSync, readFileSync, renameSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { acts, editorText, launch, leftView, openNote, pane, rail, waitSaved, widenRight } from './app'
import { armMenus, openedMenu, pickMenu } from './menu'
import { solidPng } from './fixtures/png'

const TRAVEL = `# 冰岛十天环岛

## 出发前

还没订完的：

- [ ] 租车
- [x] 机票

> 冰岛的天气五分钟一变。
—— [旅行杂志](https://example.com)

## 住哪

第一晚住雷克雅未克。

## 路线

第一天：黄金圈。
`

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

test('文档白板上 ⌘Z 只撤这块白板自己的动作，别的标签一个字不动', async () => {
  const run = await launch({ '冰岛十天环岛.md': TRAVEL, '投稿清单.md': '# 投稿清单\n\n第一段。\n' })
  const { page, vault, app } = run
  const read = (f: string) => readFileSync(join(vault, f), 'utf8')
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    // A 里打几个字，等保存
    await openNote(page, '投稿清单')
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('A里新写的字')
    await waitSaved(page)
    expect(read('投稿清单.md')).toBe('# 投稿清单\n\n第一段。A里新写的字\n')

    // B 切白板，点空白处，按 ⌘Z：A 不动
    await openNote(page, '冰岛十天环岛')
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(board(page)).toBeVisible()
    const bb = (await board(page).boundingBox())!
    await page.mouse.click(bb.x + bb.width - 60, bb.y + bb.height - 120)
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await page.waitForTimeout(1500)
    expect(read('投稿清单.md')).toBe('# 投稿清单\n\n第一段。A里新写的字\n')
    expect(read('冰岛十天环岛.md')).toBe(TRAVEL)

    // 白板自己的动作：拖进别的列，⌘Z 撤回来；⇧⌘Z 再做一遍
    const q = (await cardIn(page, '出发前', '冰岛的天气').boundingBox())!
    const target = (await col(page, '住哪').boundingBox())!
    await dragTo(page, { x: q.x + 40, y: q.y + 20 }, { x: target.x + 60, y: target.y + target.height - 6 })
    await expect(cardIn(page, '住哪', '冰岛的天气')).toBeVisible()
    await waitSaved(page)
    const moved = read('冰岛十天环岛.md')
    expect(moved).not.toBe(TRAVEL)
    await page.keyboard.press('Meta+z')
    await expect(cardIn(page, '出发前', '冰岛的天气')).toBeVisible()
    await expect.poll(() => read('冰岛十天环岛.md')).toBe(TRAVEL)
    await page.keyboard.press('Meta+Shift+z')
    await expect(cardIn(page, '住哪', '冰岛的天气')).toBeVisible()
    await expect.poll(() => read('冰岛十天环岛.md')).toBe(moved)
    // 撤完白板自己的动作，再按也不往前撤（别的标签、切白板前打的字都不动）
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => read('冰岛十天环岛.md')).toBe(TRAVEL)
    await page.waitForTimeout(1000)
    expect(read('投稿清单.md')).toBe('# 投稿清单\n\n第一段。A里新写的字\n')

    // 回到 A：字还在
    await openNote(page, '投稿清单')
    await expect(pane(page).locator('.cm-content')).toContainText('A里新写的字')
  } finally {
    await run.close()
  }
})

/** 开一篇、切到白板 */
async function docBoard(files: Record<string, string> = { '冰岛十天环岛.md': TRAVEL }) {
  const run = await launch(files)
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await openNote(run.page, '冰岛十天环岛')
  await acts(run.page).getByRole('tab', { name: '白板' }).click()
  await expect(board(run.page)).toBeVisible()
  return { ...run, file: () => readFileSync(join(run.vault, '冰岛十天环岛.md'), 'utf8') }
}

test('文档白板：双击文字卡就地改，按 Esc 存下（⌘Z 撤回），没改直接收起', async () => {
  const run = await docBoard()
  const { page, file } = run
  try {
    // 改字后 Esc：存下（2026-11-21 起文字卡就在卡里改，不再弹「全文」）
    await cardIn(page, '住哪', '第一晚').dblclick()
    const box = cardIn(page, '住哪', '第一晚').getByRole('textbox', { name: '卡片内容' })
    await expect(box).toBeFocused()
    await box.press('End')
    await page.keyboard.type('还要订第二晚。')
    await page.keyboard.press('Escape')
    await expect(box).toHaveCount(0)
    await expect(cardIn(page, '住哪', '还要订第二晚')).toBeVisible()
    await expect.poll(file).toBe(TRAVEL.replace('第一晚住雷克雅未克。', '第一晚住雷克雅未克。还要订第二晚。'))
    // 想放弃：⌘Z
    await page.keyboard.press('Meta+z')
    await expect.poll(file).toBe(TRAVEL)
    // 没改：Esc 直接收起，文件不动
    await cardIn(page, '住哪', '第一晚').dblclick()
    await expect(cardIn(page, '住哪', '第一晚').getByRole('textbox', { name: '卡片内容' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(cardIn(page, '住哪', '第一晚').getByRole('textbox', { name: '卡片内容' })).toHaveCount(0)
    await page.waitForTimeout(1200)
    expect(file()).toBe(TRAVEL)
  } finally {
    await run.close()
  }
})

test('文档白板能缩放：⌘− ⌘0、按住 ⌘ 滚轮，列宽跟着变', async () => {
  const run = await docBoard()
  const { page } = run
  try {
    // 缩放：⌘− 变小、⌘0 回来；列宽跟着变；按住 ⌘ 滚轮也行
    const zoomBtn = pane(page).getByTestId('board-zoom')
    await expect(zoomBtn).toHaveText('100%')
    const w0 = (await col(page, '住哪').boundingBox())!.width
    await board(page).click({ position: { x: 900, y: 700 } })
    await page.keyboard.press('Meta+-')
    await expect(zoomBtn).toHaveText('90%')
    const w1 = (await col(page, '住哪').boundingBox())!.width
    expect(Math.round(w1)).toBe(Math.round(w0 * 0.9))
    await page.keyboard.press('Meta+0')
    await expect(zoomBtn).toHaveText('100%')
    await page.mouse.move(900, 600)
    await page.keyboard.down('Meta')
    await page.mouse.wheel(0, 200)
    await page.keyboard.up('Meta')
    await expect(zoomBtn).not.toHaveText('100%')
    await page.keyboard.press('Meta+0')
    await expect(zoomBtn).toHaveText('100%')
  } finally {
    await run.close()
  }
})

test('文档白板拖到空白处后切回文档：位置行藏起来，文件里照样有', async () => {
  const run = await docBoard()
  const { page, file } = run
  try {
    // 拖到空白处：文档里多一行位置；切回文档看不到这一行，编辑器里的原文照样有
    const p = (await cardIn(page, '住哪', '第一晚').boundingBox())!
    const bb = (await board(page).boundingBox())!
    await dragTo(page, { x: p.x + 40, y: p.y + 20 }, { x: bb.x + 300, y: bb.y + bb.height - 150 })
    await expect(board(page).locator('.db-card.placed')).toHaveCount(1)
    await waitSaved(page)
    expect(file()).toMatch(/\n<!-- card id=d1 x=\d+ y=\d+ -->\n第一晚住雷克雅未克。\n/)
    await acts(page).getByRole('tab', { name: '文档' }).click()
    const content = pane(page).locator('.cm-content')
    await expect(content).toContainText('第一晚住雷克雅未克。')
    await expect(content).not.toContainText('<!--')
    await expect(content).not.toContainText('card id=')
    // 那一段照常是正文的样子（不是灰色等宽）
    await expect(pane(page).locator('.cm-line', { hasText: '第一晚住雷克雅未克。' })).not.toHaveClass(/cm-layout/)
    await page.screenshot({ path: 'test-results/r1-doc-no-card-line.png' })
    expect(await editorText(page)).toContain('<!-- card id=d1')
    // 打开再保存不变
    await page.waitForTimeout(1200)
    expect(file()).toMatch(/\n<!-- card id=d1 x=\d+ y=\d+ -->\n第一晚住雷克雅未克。\n/)
  } finally {
    await run.close()
  }
})

test('同一文件夹已经有「未命名」时新建：写标题回车照样改文件名；撞名加「 2」并提示；标题里有 / 也改', async () => {
  const run = await launch({ '收件箱/未命名.md': '# 未命名\n\n', '收件箱/慢慢走.md': '# 慢慢走\n\n旧的。\n' })
  const { page, vault } = run
  const newBtn = page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' })
  const tabOn = page.getByTestId('tab-on')
  try {
    await newBtn.click()
    await expect(tabOn).toHaveText('未命名 2')
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    await page.keyboard.type('冰岛第二稿')
    await page.keyboard.press('Enter')
    await expect(tabOn).toHaveText('冰岛第二稿')
    // 打正文之前先看清楚：焦点还在这篇的正文、光标已经不在标题那一行（左栏报过机器忙时字偶尔落到标题前面；再出现时这里会说是哪一种）
    await expect(pane(page).locator('.cm-content')).toBeFocused()
    expect(await page.evaluate(() => getSelection()?.anchorNode?.parentElement?.closest('.cm-line')?.textContent ?? '(光标不在任何一行里)')).not.toContain('冰岛第二稿')
    await page.keyboard.type('正文。')
    await waitSaved(page)
    expect(readFileSync(join(vault, '收件箱/冰岛第二稿.md'), 'utf8')).toBe('# 冰岛第二稿\n\n正文。')
    expect(existsSync(join(vault, '收件箱/未命名 2.md'))).toBe(false)

    await newBtn.click()
    await expect(tabOn).toHaveText('未命名 2')
    await page.keyboard.type('慢慢走')
    await page.keyboard.press('Enter')
    await expect(tabOn).toHaveText('慢慢走 2')
    await expect(page.locator('.toast-cn')).toContainText('已经有一篇叫「慢慢走」了')

    await newBtn.click()
    await expect(tabOn).toHaveText('未命名 2')
    await page.keyboard.type('东京/大阪 对比')
    await page.keyboard.press('Enter')
    await expect(tabOn).toHaveText('东京-大阪 对比')
    expect(existsSync(join(vault, '收件箱/东京-大阪 对比.md'))).toBe(true)
  } finally {
    await run.close()
  }
})

test('新建笔记连点两下只建一篇；没写内容就关掉的「未命名」不留在库里', async () => {
  const run = await launch({ '旧的.md': '旧\n' })
  const { page, vault } = run
  const newBtn = page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' })
  try {
    await newBtn.dblclick()
    await expect(page.getByTestId('tab-on')).toHaveText('未命名')
    await page.waitForTimeout(800)
    expect(readdirSync(join(vault, '收件箱'))).toEqual(['未命名.md'])
    // 没写就关：文件没了
    await page.keyboard.press('Meta+w')
    await expect(page.getByTestId('tab-on')).not.toHaveText('未命名')
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名.md'))).toBe(false)
    // 写过正文的关掉照常留着（标题没改）
    await newBtn.click()
    await expect(page.getByTestId('tab-on')).toHaveText('未命名')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await page.keyboard.type('留着')
    await waitSaved(page)
    expect(readFileSync(join(vault, '收件箱/未命名.md'), 'utf8')).toBe('# 未命名\n\n留着')
    await page.keyboard.press('Meta+w')
    await page.waitForTimeout(800)
    expect(readFileSync(join(vault, '收件箱/未命名.md'), 'utf8')).toBe('# 未命名\n\n留着')
  } finally {
    await run.close()
  }
})

test('文件树里右键重命名：第一行标题跟着改（开着的、没开的都改）', async () => {
  const run = await launch({ '写作/第一讲.md': '# 第一讲\n\n正文。\n', '写作/旧稿.md': '# 旧稿\n\n旧。\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    await tree.getByRole('treeitem', { name: /写作/ }).click()
    // 开着的：新建一篇（未命名），在文件树里改名
    await tree.getByRole('treeitem', { name: /写作/ }).click({ button: 'right' })
    await pickMenu(run, '新建笔记')
    await expect(page.getByTestId('tab-on')).toHaveText('未命名')
    // 新建的这篇在树里出来（以前要等外面的文件变化才重新列）
    await tree.getByRole('treeitem', { name: /未命名/ }).click({ button: 'right', timeout: 5000 })
    await pickMenu(run, '重命名')
    const input = tree.getByRole('textbox', { name: '新名字' })
    await input.fill('黑沙滩')
    await input.press('Enter')
    await expect(page.getByTestId('tab-on')).toHaveText('黑沙滩')
    await expect(pane(page).locator('.cm-line').first()).toHaveText('黑沙滩')
    await waitSaved(page)
    await expect.poll(() => readFileSync(join(vault, '写作/黑沙滩.md'), 'utf8')).toBe('# 黑沙滩\n\n')
    // 没开的
    await tree.getByRole('treeitem', { name: /旧稿/ }).click({ button: 'right' })
    await pickMenu(run, '重命名')
    await input.fill('新稿')
    await input.press('Enter')
    await expect.poll(() => existsSync(join(vault, '写作/新稿.md'))).toBe(true)
    await expect.poll(() => readFileSync(join(vault, '写作/新稿.md'), 'utf8')).toBe('# 新稿\n\n旧。\n')
  } finally {
    await run.close()
  }
})

test('粘贴截图后接着打字：字落在图下面空一行处，图照常显示', async () => {
  const run = await launch({ '贴图.md': '# 贴图\n\n上一段。\n' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '贴图.md'), 'utf8')
  try {
    await openNote(page, '贴图')
    await pane(page).locator('.cm-line', { hasText: '上一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    const png = [...solidPng(320, 180, [200, 120, 60])]
    await page.evaluate((bytes) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }))
      document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, png)
    await expect(pane(page).locator('.cm-image img')).toBeVisible()
    await expect(pane(page).locator('.cm-image-pending')).toHaveCount(0)
    await page.keyboard.type('接着打的字')
    await waitSaved(page)
    expect(file()).toMatch(/^# 贴图\n\n上一段。\n\n!\[\]\(附件\/贴图\/截图%201\.png\)\n\n接着打的字\n*$/)
    await expect(pane(page).locator('.cm-image img')).toBeVisible()
    await expect(pane(page).locator('.cm-content')).not.toContainText('![')

    // 段落中间贴：图插在这一段后面，光标落在图下面的空行，下面那段还隔着一个空行
    await pane(page).locator('.cm-line', { hasText: '上一段。' }).click()
    await page.keyboard.press('End')
    await page.evaluate((bytes) => {
      const dt = new DataTransfer()
      dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }))
      document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, png)
    await expect(pane(page).locator('.cm-image img')).toHaveCount(2)
    await expect(pane(page).locator('.cm-image-pending')).toHaveCount(0)
    await page.keyboard.type('第二张的说明')
    await waitSaved(page)
    expect(file()).toMatch(/^# 贴图\n\n上一段。\n\n!\[\]\(附件\/贴图\/截图%202\.png\)\n\n第二张的说明\n\n!\[\]\(附件\/贴图\/截图%201\.png\)\n\n接着打的字\n*$/)
  } finally {
    await run.close()
  }
})

test('数据库开着筛选点「新一条」：新的那条先留在表底，标「新 · 不在当前筛选里」，改到满足筛选就成普通一行', async () => {
  const base = '```base\nfilters:\n  and:\n    - file.inFolder("书单")\n    - 状态 == "在读"\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 状态\n```'
  const run = await launch({
    '读书.md': `# 读书\n\n${base}\n`,
    '书单/三体.md': '---\n状态: 在读\n---\n',
    '书单/置身事内.md': '---\n状态: 读完\n---\n',
  })
  const { page, vault } = run
  try {
    await openNote(page, '读书')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(1)
    await db.getByRole('button', { name: '新一条' }).click()
    await expect.poll(() => existsSync(join(vault, '书单', '未命名.md'))).toBe(true)
    await expect(db.locator('tbody tr')).toHaveCount(2)
    // 新的一条名字格直接在改名（第 2 轮）：这里不改，Esc
    await expect(db.getByRole('textbox', { name: '未命名 · 名字' })).toBeFocused()
    await page.keyboard.press('Escape')
    const added = db.locator('tbody tr', { hasText: '未命名' })
    await expect(added).toContainText('新 · 不在当前筛选里')
    await expect(db.locator('tbody tr').last()).toContainText('未命名')
    // 底下的条数和表里对得上
    await expect(db.locator('.base-foot')).toHaveText('另有1条刚建的不在筛选里 · 每条是「书单」里的一篇笔记')
    // 筛选面板底下不写开发者的词
    await db.getByRole('button', { name: '筛选' }).click()
    await expect(page.getByRole('dialog', { name: '筛选' })).not.toContainText('filters')
    await expect(page.getByRole('dialog', { name: '筛选' })).not.toContainText('代码块')
    await page.keyboard.press('Escape')
    // 改成在读：满足筛选，标签去掉
    // 「状态」是选项列：点格子弹选项小框，挑「在读」
    await added.locator('td').nth(1).click()
    const cell = page.getByRole('dialog', { name: '未命名 · 状态' }).getByRole('textbox', { name: '找一个，或者打一个新的' })
    await cell.fill('在读')
    await cell.press('Enter')
    await expect(db.locator('tbody tr', { hasText: '未命名' })).not.toContainText('不在当前筛选里')
    await expect(db.locator('tbody tr')).toHaveCount(2)
  } finally {
    await run.close()
  }
})

test('窗口变窄：中间至少留 420，先收右栏再收左栏，右边图标栏不出窗口；拉宽回到原来的宽', async () => {
  const run = await launch({ '冰岛稿.md': '# 冰岛稿\n\n正文。\n' })
  const { page, app } = run
  const size = (w: number) => app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0]!.setSize(w, 900), w)
  const widthOf = async (sel: string) => (await page.locator(sel).first().boundingBox())!
  try {
    await size(1440)
    await openNote(page, '冰岛稿')
    // 右栏开「历史」（不开网页：网页的新标签页会读本机的快捷书签）
    await rail(page).getByRole('button', { name: '历史' }).click()
    const right = page.getByRole('complementary', { name: '历史' })
    await expect(right).toBeVisible()
    const before = (await right.boundingBox())!.width
    const center0 = (await widthOf('.win > .center')).width
    await widenRight(page, 400)
    const right0 = (await right.boundingBox())!.width
    // 一栏不再卡在 640（2026-11-21 用户要网页能看得更大，task-zligc）：拖多少宽多少，拖到中间只剩 420 为止
    expect(center0 - 420).toBeLessThan(400)
    expect(Math.round(right0)).toBe(Math.round(before + center0 - 420))
    expect(Math.round(right0)).toBeGreaterThan(640)
    expect(Math.round((await widthOf('.win > .center')).width)).toBe(420)
    const side0 = (await widthOf('.win > .side')).width
    for (const w of [1100, 960]) {
      await size(w)
      await expect.poll(async () => Math.round((await widthOf('.win > .center')).width)).toBeGreaterThanOrEqual(400)
      const winW = await page.evaluate(() => window.innerWidth)
      const bar = await rail(page).boundingBox()
      expect(bar!.x + bar!.width).toBeLessThanOrEqual(winW)
      await page.screenshot({ path: `test-results/r1-narrow-${w}.png` })
    }
    // 960 宽：右栏先让到 300 以下之前，左栏已经让到 200
    expect(Math.round((await widthOf('.win > .side')).width)).toBeLessThanOrEqual(200)
    // 拉宽回来：还是原来的宽
    await size(1440)
    await expect.poll(async () => Math.round((await right.boundingBox())!.width)).toBe(Math.round(right0))
    expect(Math.round((await widthOf('.win > .side')).width)).toBe(Math.round(side0))
  } finally {
    await run.close()
  }
})

test('「移到」能选子文件夹（右键、标题下所在文件夹 ▾），文件树里能把笔记拖进文件夹', async () => {
  const run = await launch({ '写作/游记/黑沙滩.md': '# 黑沙滩\n', '写作/书评/a.md': '# a\n', '收件箱/冰岛稿.md': '# 冰岛稿\n\n正文。\n', '收件箱/极光.md': '# 极光\n' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    await tree.getByRole('treeitem', { name: /收件箱/ }).click()
    await tree.getByRole('treeitem', { name: /冰岛稿/ }).click({ button: 'right' })
    // 目录树里右键「移到…」（task-4891y 起是打字找的小弹层）：子文件夹也都列着，右边写在哪一层
    await pickMenu(run, '移到…')
    const mover = page.getByRole('dialog', { name: '移到' })
    await expect(mover).toBeVisible()
    expect(await mover.getByRole('menuitem').locator('.truncate').allTextContents()).toEqual(['测试库', '收件箱', '课程', '阅读', '剪藏', '周记', '写作', '书评', '游记', '项目', '生活'])
    // 这篇本来就在的「收件箱」灰着列出来、点不了（task-5yp97「藏之后」图）
    await expect(mover.getByRole('menuitem').nth(1)).toBeDisabled()
    await expect(mover.getByRole('menuitem').nth(8).locator('.r')).toHaveText('写作')
    await mover.getByRole('searchbox').fill('游记')
    await mover.getByRole('searchbox').press('Enter')
    await expect.poll(() => existsSync(join(vault, '写作/游记/冰岛稿.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/冰岛稿.md'))).toBe(false)
    // 树刷新好了（收件箱里那一行没了；写作收着，新位置看不到）再去开它：不然 openNote 点到的是马上要被换掉的旧行
    await expect(tree.getByRole('treeitem', { name: /冰岛稿/ })).toHaveCount(0)

    // 标题下「所在文件夹 ▾」：同一套，选得到子文件夹
    await openNote(page, '冰岛稿')
    await pane(page).getByRole('button', { name: /所在文件夹：写作\/游记/ }).click()
    const chip = await openedMenu(run)
    expect(chip.map((i) => i.label)).toEqual(['测试库', '收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活'])
    expect(chip.find((i) => i.label === '写作')!.submenu!.map((i) => i.label)).toEqual(['放进「写作」', '—', '书评', '游记'])
    expect(chip.find((i) => i.label === '写作')!.submenu!.find((i) => i.label === '游记')!.enabled).toBe(false)
    await pickMenu(run, '写作 › 书评')
    await expect.poll(() => existsSync(join(vault, '写作/书评/冰岛稿.md'))).toBe(true)
    await expect(page.getByTestId('tab-on')).toHaveText('冰岛稿')

    // 拖：收件箱里的「极光」拖到「游记」那一行上
    await leftView(page, '文件')
    if ((await tree.getByRole('treeitem', { name: /游记/ }).count()) === 0) await tree.getByRole('treeitem', { name: /写作/ }).first().click()
    if ((await tree.getByRole('treeitem', { name: /极光/ }).count()) === 0) await tree.getByRole('treeitem', { name: /收件箱/ }).first().click()
    await expect(tree.getByRole('treeitem', { name: /游记/ })).toBeVisible()
    await tree.getByRole('treeitem', { name: /极光/ }).dragTo(tree.getByRole('treeitem', { name: /游记/ }))
    await expect.poll(() => existsSync(join(vault, '写作/游记/极光.md'))).toBe(true)
    expect(existsSync(join(vault, '收件箱/极光.md'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('开着的笔记在访达里改名：认出是改名，标签和编辑器跟到新文件，接着打字不把旧名字建回来', async () => {
  const run = await launch({ '写作/冰岛稿.md': '# 冰岛稿\n\n第一段。\n', '写作/别的.md': '# 别的\n' })
  const { page, vault } = run
  try {
    await openNote(page, '冰岛稿')
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('先写一句。')
    await waitSaved(page)
    renameSync(join(vault, '写作/冰岛稿.md'), join(vault, '写作/冰岛稿改名.md'))
    await expect(page.getByTestId('tab-on')).toHaveText('冰岛稿改名')
    await expect(page.locator('.toast-cn')).toContainText('在外面改名成了「冰岛稿改名」')
    await page.keyboard.type('再写一句。')
    await waitSaved(page)
    await page.waitForTimeout(1500)
    expect(existsSync(join(vault, '写作/冰岛稿.md'))).toBe(false)
    expect(readFileSync(join(vault, '写作/冰岛稿改名.md'), 'utf8')).toBe('# 冰岛稿\n\n第一段。先写一句。再写一句。\n')
    expect(readdirSync(join(vault, '写作')).sort()).toEqual(['冰岛稿改名.md', '别的.md'])
  } finally {
    await run.close()
  }
})

test('提示块：斜杠菜单能插（选类型），标题回车写正文，空行回车出块；折叠块也在斜杠菜单里', async () => {
  const run = await launch({ '贴士.md': '# 贴士\n\n开头。\n' })
  const { page, vault } = run
  const file = () => readFileSync(join(vault, '贴士.md'), 'utf8')
  try {
    await openNote(page, '贴士')
    await pane(page).locator('.cm-line', { hasText: '开头。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    // 手打：标题回车进正文
    await page.keyboard.type('> [!tip] 小贴士')
    await page.keyboard.press('Enter')
    await page.keyboard.type('贴士正文')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('块外面。')
    await waitSaved(page)
    expect(file()).toContain('> [!tip] 小贴士\n> 贴士正文\n\n块外面。')
    await expect(pane(page).locator('.cm-line', { hasText: '贴士正文' })).toHaveClass(/cm-callout/)

    // 斜杠菜单：/提示 列出几种，选「注意」
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/提示')
    const menu = page.locator('.slash-menu')
    await expect(menu.getByRole('option')).toHaveText([/提示块 · 说明/, /提示块 · 注意/, /提示块 · 疑惑/, /提示块 · 讲通了/, /提示块 · 出错/])
    await menu.getByRole('option', { name: /提示块 · 注意/ }).click()
    await page.keyboard.type('路上小心')
    await page.keyboard.press('Enter')
    await page.keyboard.type('冬天路面结冰。')
    await waitSaved(page)
    expect(file()).toContain('> [!warning] 路上小心\n> 冬天路面结冰。')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    // 折叠块
    await page.keyboard.type('/折叠')
    await expect(menu.getByRole('option')).toHaveText([/折叠块/])
    await page.keyboard.press('Enter')
    // 和提示块一样：先写标题（「收起的内容」选中，打字换掉），回车进块里写正文（第 2 轮）
    await page.keyboard.type('我的折叠标题')
    await page.keyboard.press('Enter')
    await page.keyboard.type('旧的讲法')
    await waitSaved(page)
    expect(file()).toContain('<details><summary>我的折叠标题</summary>\n\n旧的讲法\n\n</details>')
    await expect(pane(page).locator('.cm-content')).not.toContainText('<summary>')
    // 标题行能就地改：点进标题末尾接着打
    await pane(page).locator('.cm-fold-title').click()
    await page.keyboard.press('End')
    await page.keyboard.type('二')
    await waitSaved(page)
    expect(file()).toContain('<details><summary>我的折叠标题二</summary>\n\n旧的讲法\n\n</details>')
    await page.screenshot({ path: 'test-results/r1-callout.png' })
    // 切到白板：斜杠插的折叠块整块一张卡，看不到标签（写作组反馈）
    await acts(page).getByRole('tab', { name: '白板' }).click()
    const db = pane(page).getByTestId('doc-board')
    await expect(db.locator('.db-card[data-kind="details"]')).toHaveCount(1)
    await expect(db.locator('.db-card[data-kind="details"] .det .nm')).toHaveText('我的折叠标题二')
    for (const raw of ['<details', '</summary>', '</details>']) await expect(db).not.toContainText(raw)
  } finally {
    await run.close()
  }
})

test('删笔记：刚打的字删之前先提交进 Git；「撤回」停 10 秒以上、悬停不走，⌘Z 也能撤回', async () => {
  const run = await launch({ '写作/冰岛旅游 3.md': '# 冰岛旅游 3\n\n![](../附件/写作/冰岛旅游%203/截图%201.png)\n', '附件/写作/冰岛旅游 3/截图 1.png': solidPng(80, 60, [200, 120, 60]), '别的.md': '# 别的\n' })
  const { page, vault } = run
  const gitOut = (...a: string[]) => execFileSync('git', ['-C', vault, ...a], { encoding: 'utf8' })
  try {
    await armMenus(run)
    await openNote(page, '冰岛旅游 3')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await page.keyboard.type('刚打的一句')
    await waitSaved(page)
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    if ((await tree.getByRole('treeitem', { name: /冰岛旅游 3/ }).count()) === 0) await tree.getByRole('treeitem', { name: /写作/ }).first().click()
    await tree.getByRole('treeitem', { name: /冰岛旅游 3/ }).click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    const dlg = page.getByRole('dialog', { name: '把《冰岛旅游 3》移到废纸篓？' })
    await dlg.getByRole('button', { name: '移到废纸篓' }).click()
    const toast = page.getByTestId('toast')
    await expect(toast).toContainText('已删除《冰岛旅游 3》')
    // 删之前那一版（带刚打的字）在 Git 里
    expect(gitOut('log', '-p', '--all', '--', '写作/冰岛旅游 3.md')).toContain('刚打的一句')
    // 7 秒后还在（以前 6 秒就走了）
    await page.waitForTimeout(7000)
    await expect(toast).toContainText('已删除《冰岛旅游 3》')
    // 悬停时不走
    await toast.hover()
    await page.waitForTimeout(4500)
    await expect(toast).toContainText('已删除《冰岛旅游 3》')
    await page.mouse.move(10, 400)
    // ⌘Z 撤回
    await page.keyboard.press('Meta+z')
    await expect.poll(() => existsSync(join(vault, '写作/冰岛旅游 3.md')) && readFileSync(join(vault, '写作/冰岛旅游 3.md'), 'utf8')).toContain('刚打的一句')
    await expect.poll(() => existsSync(join(vault, '附件/写作/冰岛旅游 3/截图 1.png'))).toBe(true)
    await expect(page.getByTestId('tab-on')).toHaveText('冰岛旅游 3')
  } finally {
    await run.close()
  }
})

test('左栏拖到最窄：栏头「文件」两个字不被图标挤住', async () => {
  const run = await launch({ '写作/a.md': '# a\n' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await leftView(page, '文件')
    const sep = (await page.getByRole('separator', { name: '拖动调整左栏宽度' }).boundingBox())!
    await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
    await page.mouse.down()
    await page.mouse.move(sep.x - 200, sep.y + 300, { steps: 6 })
    await page.mouse.up()
    const m = await page.locator('aside.side .vh').first().evaluate((vh) => {
      const h2 = vh.querySelector('h2')!
      const range = document.createRange()
      range.selectNodeContents(h2.firstChild!)
      const r = range.getBoundingClientRect()
      const btn = vh.querySelector('.ib')!.getBoundingClientRect()
      const last = [...vh.querySelectorAll('.ib')].pop()!.getBoundingClientRect()
      return { side: vh.closest('.side')!.getBoundingClientRect().width, text: h2.firstChild!.textContent, w: h2.getBoundingClientRect().width, need: r.width, gap: btn.left - r.right, overflow: last.right - vh.getBoundingClientRect().right }
    })
    expect(m.side).toBeLessThanOrEqual(200)
    expect(m.text).toBe('文件')
    expect(m.w).toBeGreaterThanOrEqual(m.need)
    expect(m.w).toBeGreaterThanOrEqual(24)
    expect(m.gap).toBeGreaterThanOrEqual(0)
    // 最后一颗图标和栏边留着内边距（悬停底色不被岛的圆角切掉）
    expect(m.overflow).toBeLessThanOrEqual(-3)
    await page.locator('aside.side').screenshot({ path: 'test-results/r1-left-min.png' })
  } finally {
    await run.close()
  }
})

test('左栏「收件箱」页有「新建笔记」，建在收件箱里', async () => {
  const run = await launch({ '写作/a.md': '# a\n' })
  const { page, vault } = run
  try {
    await leftView(page, '收件箱')
    await page.locator('aside.side .vh').getByRole('button', { name: '新建笔记' }).click()
    await expect(page.getByTestId('tab-on')).toHaveText('未命名')
    await expect.poll(() => existsSync(join(vault, '收件箱/未命名.md'))).toBe(true)
    await expect(page.locator('aside.side .nav .si', { hasText: '未命名' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('⌘K 搜索：结果回来之前不闪「都没有」，先写「在找…」', async () => {
  const files: Record<string, string> = {}
  for (let i = 0; i < 300; i++) files[`日记/第${i}天.md`] = `# 第${i}天\n\n${i % 50 === 0 ? '今天写了周报。' : '平常的一天。'}\n`
  const run = await launch(files)
  const { page } = run
  try {
    await page.keyboard.press('Meta+k')
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await expect(pal).toBeVisible()
    // 记下这一路上出现过的每一句「没有」
    await page.evaluate(() => {
      const seen: string[] = []
      ;(window as unknown as { seenNone: string[] }).seenNone = seen
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.pal-none')) seen.push(el.textContent ?? '')
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await pal.getByRole('textbox').pressSequentially('周报', { delay: 30 })
    await expect(pal.getByRole('option').filter({ hasText: '今天写了周报' }).first()).toBeVisible()
    const seen = await page.evaluate(() => (window as unknown as { seenNone: string[] }).seenNone)
    expect(seen.filter((x) => x.includes('都没有'))).toEqual([])
  } finally {
    await run.close()
  }
})

test('「剪藏」组件里每个主题的篇数和那个主题文件夹首页上写的一样（PDF 也算），单位都是「篇」；老库的「素材」打开时已改成「剪藏」', async () => {
  const run = await launch({
    '写作/a.md': '# a\n\n正文。\n',
    '素材/冰岛旅行/一.md': '# 一\n\n剪的。\n',
    '素材/冰岛旅行/二.md': '# 二\n\n剪的。\n',
    '素材/冰岛旅行/路况.pdf': '%PDF-1.4\n',
  })
  const { page } = run
  try {
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    await tree.getByRole('treeitem', { name: /写作/ }).first().click()
    await page.getByTestId('tab-acts').getByRole('button', { name: '编辑首页' }).click()
    await page.getByTestId('folder-home').getByRole('button', { name: '加组件' }).click()
    const lib = page.getByRole('dialog', { name: '加组件' })
    await lib.getByRole('button', { name: '加上 剪藏' }).click()
    await lib.getByRole('button', { name: '完成' }).click()
    await page.getByTestId('tab-acts').getByRole('button', { name: '完成' }).click()
    const row = page.getByTestId('folder-home').locator('.fw-row', { hasText: '冰岛旅行' })
    await expect(row).toContainText('3篇')
    await tree.getByRole('treeitem', { name: /剪藏/ }).first().locator('.ft-tw').click()
    await tree.getByRole('treeitem', { name: /冰岛旅行/ }).first().click()
    await expect(page.getByTestId('folder-home').locator('.fh-tx p')).toHaveText(/^剪藏 \/ 冰岛旅行 · 3篇/)
  } finally {
    await run.close()
  }
})
