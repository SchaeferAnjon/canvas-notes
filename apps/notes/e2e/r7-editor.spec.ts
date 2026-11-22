/**
 * 第 7 轮 · 文档编辑器（M1 录屏 CN-107、CN-115、CN-12、CN-124 和设计走样「第三版：文档一块一块」「右键菜单」）。
 * 方向 A「块上露写法」：平时一个记号都不露、没有「源文件」；数据库这类块点「改写法」只在那一块露出写法。
 * 都在测试模式里真点、真打字、真拖、真右键；改的都是 md 原文，读文件断言。
 */
import { expect, test, type Page } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, editorText, gitStatus, launch, openNote, pane, shownText, waitSaved } from './app'
import { armMenus, openedMenu, pickMenu } from './menu'

const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()
const read = (vault: string, name: string) => readFileSync(join(vault, name), 'utf8')
const tail = (page: Page) => pane(page).locator('.cm-tailline')
const slash = (page: Page) => page.locator('.slash-menu')

/** 选中的字粘贴一段文字（和 ⌘V 一样走 CodeMirror 的粘贴） */
async function paste(page: Page, text: string) {
  await page.evaluate((t) => {
    const dt = new DataTransfer()
    dt.setData('text/plain', t)
    document.querySelector('.pane:not([hidden]) .cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, text)
}

/** 鼠标移到这一行上，等左边的把手出来 */
async function hoverLine(page: Page, text: string) {
  await expect(async () => {
    const box = (await line(page, text).boundingBox())!
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.move(box.x + 60, box.y + box.height / 2)
    await expect(pane(page).locator('.blk-bar:not([hidden]) .blk-grip')).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 5000 })
}

test('CN-124 打字像 Typora：记号都不露；标题行首退格变正文；``` 回车补收尾；⌘B ⌘I；选中字粘网址成链接；| 日期 | 地点 | 回车成表格、Tab 跳格', async () => {
  const md = '# 冰岛行程\n\n第一天到**雷克雅未克**，第二天走黄金圈。\n\n## 路线\n\n> 冰洞每年的形状都不一样。\n\n还没订完的：租车、冰川徒步。\n'
  const run = await launch({ '冰岛行程.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '冰岛行程')
    // 没有「源文件」看法
    await expect(acts(page).locator('.seg button')).toHaveText(['任务', '白板', '文档'])
    // 光标点进加粗、标题、引用：记号也不露
    await pane(page).locator('.cm-strong', { hasText: '雷克雅未克' }).click()
    await line(page, '路线').click()
    await line(page, '冰洞每年').click()
    const shown = await shownText(page)
    for (const m of ['**', '##', '> ']) expect(shown).not.toContain(m)
    await expect(pane(page).locator('.cm-mdmark')).toHaveCount(0)

    // 标题行首退格：整行变回正文，不剩「##」
    await line(page, '路线').click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Backspace')
    expect(await editorText(page)).toContain('\n\n路线\n\n')
    await expect(line(page, '路线')).not.toHaveClass(/cm-h2/)
    // 引用行首退格：出引用
    await line(page, '冰洞每年').click()
    await page.keyboard.press('Home')
    await page.keyboard.press('Backspace')
    expect(await editorText(page)).toContain('\n\n冰洞每年的形状都不一样。\n\n')

    // 点文末那一行写；打 ``` 回车补收尾，后面的字不被吞
    await tail(page).click()
    await page.keyboard.type('## 预算')
    await page.keyboard.press('Enter')
    await page.keyboard.type('```')
    await page.keyboard.press('Enter')
    await page.keyboard.type('总共 ISK 420000')
    expect(await editorText(page)).toContain('## 预算\n```\n总共 ISK 420000\n```')
    // 代码块最后一行空着再回车：出块，接着写正文
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('块外面的字')
    expect(await editorText(page)).toContain('总共 ISK 420000\n```\n\n块外面的字')
    expect(await shownText(page)).not.toContain('```')

    // 打「| 日期 | 地点 |」回车：变表格，光标进第一格，Tab 跳下一格
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('| 日期 | 地点 |')
    await page.keyboard.press('Enter')
    const cell = pane(page).locator('.cm-cellin')
    await expect(cell).toBeFocused()
    await page.keyboard.type('11月20日')
    await page.keyboard.press('Tab')
    await expect(cell).toBeFocused()
    await page.keyboard.type('雷克雅未克')
    await page.keyboard.press('Escape')
    await waitSaved(page)
    expect(read(vault, '冰岛行程.md')).toContain('| 日期 | 地点 |\n| --- | --- |\n| 11月20日 | 雷克雅未克 |')
    // 表格画成格子，不露「|」
    await expect(pane(page).locator('.cm-table th')).toHaveText(['日期', '地点'])
    expect(await shownText(page)).not.toContain('| 日期')

    // ⌘B：选中的字加粗，再按一次取消；⌘I 斜体
    await line(page, '还没订完的').click()
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Meta+b')
    expect(await editorText(page)).toContain('还没订完的：租车、**冰川徒步**。')
    await page.keyboard.press('Meta+b')
    expect(await editorText(page)).toContain('还没订完的：租车、冰川徒步。')
    await page.keyboard.press('Meta+i')
    expect(await editorText(page)).toContain('还没订完的：租车、*冰川徒步*。')
    await page.keyboard.press('Meta+i')

    // 选中字粘贴网址：变成链接，字留着；文档里是字加一颗域名小块
    await line(page, '第一天到').click()
    await page.keyboard.press('End')
    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowLeft')
    await paste(page, 'https://zh.wikipedia.org/wiki/Golden_Circle')
    expect(await editorText(page)).toContain('第二天走[黄金圈。](https://zh.wikipedia.org/wiki/Golden_Circle)')
    await line(page, '还没订完').click()
    // 链接后面什么都不露（cmdk 方案 A）
    await expect(pane(page).locator('.cm-urlchip')).toHaveCount(0)
    expect(await shownText(page)).not.toContain('](')
    expect(await shownText(page)).not.toContain('zh.wikipedia.org')
    await waitSaved(page)
  } finally {
    await run.close()
  }
})

test('CN-124 ←→ 跨过藏着的加粗记号不白按；退格删看得见的字，加粗的字删光了记号一起拿掉', async () => {
  const run = await launch({ '手感.md': '# 手感\n\nA**B**C\n' })
  const { page } = run
  try {
    await openNote(page, '手感')
    await line(page, 'ABC').click()
    await page.keyboard.press('End')
    // 从行尾往左一格一格走：C 前、B 前、A 前，三下到行首（不在记号上白按）
    // 往左一下：在 B 和 C 之间；打的字跟左边的 B 一个样子（加粗里，像 Notion、谷歌文档）
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('1')
    expect(await editorText(page)).toContain('A**B1**C')
    await page.keyboard.press('Backspace')
    // 再往左一下：在 A 和 B 之间（加粗前面），打的字跟 A 一个样子（不加粗）
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('2')
    expect(await editorText(page)).toContain('A2**B**C')
    await page.keyboard.press('Backspace')
    // 再左一下到行首（只按一下，不在记号上白按）
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.type('0')
    expect(await editorText(page)).toContain('0A**B**C')
    await page.keyboard.press('Backspace')
    // 光标在 C 前面（加粗记号后面）按退格：删的是 B，B 删光了「****」一起拿掉（不变成分隔线）
    await page.keyboard.press('End')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('Backspace')
    expect(await editorText(page)).toBe('# 手感\n\nAC\n')
  } finally {
    await run.close()
  }
})

test('CN-107 文末常驻一行灰字：悬停出「+ ⋮⋮」和深色提示；点它写字成新的一段；不打字点别处文件一个字节都不多', async () => {
  const md = '# 冰岛行程\n\n第一天去雷克雅未克。\n\n```java\njava\n```\n'
  const run = await launch({ '冰岛行程.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '冰岛行程')
    await expect(tail(page)).toHaveText('输入 / 插入块，或者直接写')
    // 悬停出加号和把手，停一会儿出深色提示条
    const t = (await tail(page).boundingBox())!
    await page.mouse.move(t.x + 80, t.y + t.height / 2)
    const add = pane(page).locator('.blk-bar:not([hidden]) .blk-add')
    await expect(add).toBeVisible()
    await add.hover()
    await expect(page.getByTestId('blk-tip')).toHaveText('点一下插入块 · 也可以打 /')
    await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').hover()
    await expect(page.getByTestId('blk-tip')).toHaveText('拖动挪位置 · 点一下打开菜单')
    // 提示条是深色的（--solid 底）
    const bg = await page.getByTestId('blk-tip').evaluate((el) => getComputedStyle(el).backgroundColor)
    const solid = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--solid').trim())
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(solid).not.toBe('')

    // 点文末那一行、不打字、点别处：文件不变
    await tail(page).click()
    await line(page, '第一天去').click()
    await page.waitForTimeout(1200)
    expect(read(vault, '冰岛行程.md')).toBe(md)
    expect(gitStatus(vault)).toBe('')

    // 点最后一块（代码块）下面的空白打字：字落在代码块外面的新段落里
    const box = (await pane(page).locator('.doc').boundingBox())!
    await page.mouse.click(box.x + 200, box.y + box.height - 40)
    await page.keyboard.type('第二天：黄金圈')
    await waitSaved(page)
    expect(read(vault, '冰岛行程.md')).toBe(md + '\n第二天：黄金圈\n')
    // 打完又有一行灰字在下面
    await expect(tail(page)).toHaveText('输入 / 插入块，或者直接写')
  } finally {
    await run.close()
  }
})

test('CN-107 点「+」直接弹插入菜单不写「/」，点别处什么都不留；打的「/」没选就离开那一行也拿掉', async () => {
  const md = '# 加块\n\n第一段\n\n第二段\n'
  const run = await launch({ '加块.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '加块')
    await hoverLine(page, '第一段')
    await pane(page).locator('.blk-bar:not([hidden]) .blk-add').click()
    await expect(slash(page)).toBeVisible()
    expect(await editorText(page)).toBe(md)
    // 四组，右边是 md 写法，底部一句
    await expect(slash(page).locator('.slash-g')).toHaveText(['基本', '图片和表格', '链接', 'AI'])
    await expect(slash(page).getByRole('option').first()).toContainText('正文纯文字')
    await expect(slash(page).getByRole('option', { name: /^标题/ }).locator('code')).toHaveText('##')
    await expect(slash(page).locator('.keys')).toHaveText('右边是它在 md 里的写法 · ↑↓ 选择 · ↵ 插入 · esc 关闭')
    // 点别处：菜单收起，什么都不留
    await line(page, '第二段').click()
    await expect(slash(page)).toBeHidden()
    await page.waitForTimeout(1000)
    expect(read(vault, '加块.md')).toBe(md)

    // 点「+」打字筛选（字不进文档），回车插在这一块后面
    await hoverLine(page, '第一段')
    await pane(page).locator('.blk-bar:not([hidden]) .blk-add').click()
    await page.keyboard.type('h3')
    await expect(slash(page).getByRole('option')).toHaveCount(1)
    await expect(slash(page).getByRole('option')).toContainText('小标题')
    await page.keyboard.press('Enter')
    await page.keyboard.type('中间的小标题')
    await waitSaved(page)
    expect(read(vault, '加块.md')).toBe('# 加块\n\n第一段\n\n### 中间的小标题\n\n第二段\n')

    // 打「/」弹菜单，打的那一行左边出「+ ⋮⋮」；没选就点别的行：「/」拿掉
    await line(page, '第二段').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await expect(slash(page)).toBeVisible()
    await expect(pane(page).locator('.blk-bar:not([hidden]) .blk-add')).toBeVisible()
    await line(page, '第一段').click()
    await expect(slash(page)).toBeHidden()
    expect(await editorText(page)).not.toContain('/')
  } finally {
    await run.close()
  }
})

test('块菜单照稿：转成标题 / 转成待办 / 转成引用 | 复制一块 ⌘D / 问 AI 这一块 / 删除 ⌫，弹在把手右边；⌘D 复制光标所在的块', async () => {
  const md = '# 笔记\n\n甲段\n\n乙段\n\n丙段\n'
  const run = await launch({ '笔记.md': md })
  const { page, vault } = run
  const menu = page.getByRole('menu', { name: '块菜单' })
  try {
    await openNote(page, '笔记')
    await hoverLine(page, '乙段')
    const grip = pane(page).locator('.blk-bar:not([hidden]) .blk-grip')
    const g = (await grip.boundingBox())!
    await grip.click()
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem')).toHaveText(['转成标题', '转成待办', '转成引用', '标成 AI 写的', '上移⌥⇧↑', '下移⌥⇧↓', '复制一块⌘D', '问 AI 这一块', '删除⌫'])
    const m = (await menu.boundingBox())!
    // 弹在把手右边 6（菜单有 6 的内边距：第一行和把手顶对齐）
    expect(Math.round(m.x - (g.x + g.width))).toBeGreaterThanOrEqual(4)
    expect(Math.round(m.x - (g.x + g.width))).toBeLessThanOrEqual(8)
    expect(Math.abs(m.y - g.y)).toBeLessThan(4)
    await menu.getByRole('menuitem', { name: '转成标题' }).click()
    await waitSaved(page)
    expect(read(vault, '笔记.md')).toBe('# 笔记\n\n甲段\n\n## 乙段\n\n丙段\n')
    // 菜单开着按 ⌫ 删掉这一块
    await hoverLine(page, '丙段')
    await grip.click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Backspace')
    await waitSaved(page)
    expect(read(vault, '笔记.md')).toBe('# 笔记\n\n甲段\n\n## 乙段\n')
    // ⌘D：复制光标所在的块
    await line(page, '甲段').click()
    await page.keyboard.press('Meta+d')
    await waitSaved(page)
    expect(read(vault, '笔记.md')).toBe('# 笔记\n\n甲段\n\n甲段\n\n## 乙段\n')
  } finally {
    await run.close()
  }
})
