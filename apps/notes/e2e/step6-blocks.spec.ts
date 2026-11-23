import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editorText, gitStatus, launch, openNote, pane, waitSaved } from './app'

// 文档模式的块编辑：拖把手挪块、块菜单、⌥⇧↑↓、/ 菜单、[[ 链接、待办勾选、表格。改的都是 md 原文。

const line = (page: Page, text: string) => pane(page).locator('.cm-line', { hasText: text }).first()
const grip = (page: Page) => pane(page).locator('.blk-bar:not([hidden]) .blk-grip')
const slash = (page: Page) => page.locator('.slash-menu')

/** 鼠标移到这一行上，等左边的把手出来 */
async function hoverBlock(page: Page, text: string) {
  // 刚打开时排版可能还在动：每次重新量这一行的位置再移过去，直到把手对着这一块
  await expect(async () => {
    const box = (await line(page, text).boundingBox())!
    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.move(box.x + 60, box.y + box.height / 2)
    await expect(grip(page)).toBeVisible({ timeout: 500 })
    const g = (await grip(page).boundingBox())!
    expect(Math.abs(g.y + g.height / 2 - (box.y + box.height / 2))).toBeLessThan(box.height)
  }).toPass({ timeout: 5000 })
}

/** 鼠标移到这一块上，点左边的「+」 */
async function clickAdd(page: Page, text: string) {
  await expect(async () => {
    await hoverBlock(page, text)
    await pane(page).locator('.blk-bar:not([hidden]) .blk-add').click({ timeout: 1000 })
    await expect(slash(page)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

/** 真鼠标：按住把手拖到 target 那一行的上半（before）或下半（after）再松手 */
async function dragBlock(page: Page, text: string, target: string, where: 'before' | 'after') {
  // 按下把手、挪几像素，确认拖起来了（没拖起来就松手重来）
  let g = { x: 0, y: 0, width: 0, height: 0 }
  await expect(async () => {
    await hoverBlock(page, text)
    g = (await grip(page).boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(g.x + g.width / 2 + 3, g.y + g.height / 2 + 6, { steps: 2 })
    try {
      await expect(pane(page).locator('.cm-editor.blk-dragging')).toHaveCount(1, { timeout: 500 })
    } catch (e) {
      // 没拖起来的松手算点一下，会开块菜单：关掉再重来
      await page.mouse.up()
      await page.keyboard.press('Escape')
      throw e
    }
  }).toPass({ timeout: 10_000 })
  const t = (await line(page, target).boundingBox())!
  const y = where === 'before' ? t.y + 2 : t.y + t.height - 2
  await page.mouse.move(g.x + 20, (g.y + y) / 2, { steps: 5 })
  await page.mouse.move(t.x + 80, y, { steps: 8 })
  // 像人一样：看到落点线在目标那行的上沿 / 下沿再松手
  const drop = pane(page).locator('.blk-drop')
  await expect(async () => {
    await page.mouse.move(t.x + 80, y)
    await expect(drop).toBeVisible({ timeout: 500 })
    const d = (await drop.boundingBox())!
    expect(Math.abs(d.y - (where === 'before' ? t.y : t.y + t.height))).toBeLessThan(t.height)
  }).toPass({ timeout: 5000 })
  await page.mouse.up()
}

const read = (vault: string, name: string) => readFileSync(join(vault, name), 'utf8')

test('拖把手挪块：整块挪过去，块之间一个空行；紧凑列表里挪列表项不加空行；⌘Z 撤回', async () => {
  const md = '# 清单\n\n第一段\n\n第二段\n\n要买：\n- 苹果\n- 香蕉\n- 梨\n\n第三段\n'
  const run = await launch({ '清单.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '清单')
    await dragBlock(page, '第一段', '第三段', 'after')
    await waitSaved(page)
    expect(read(vault, '清单.md')).toBe('# 清单\n\n第二段\n\n要买：\n- 苹果\n- 香蕉\n- 梨\n\n第三段\n\n第一段\n')

    await dragBlock(page, '苹果', '梨', 'after')
    await waitSaved(page)
    expect(read(vault, '清单.md')).toBe('# 清单\n\n第二段\n\n要买：\n- 香蕉\n- 梨\n- 苹果\n\n第三段\n\n第一段\n')

    await page.keyboard.press('Meta+z')
    await waitSaved(page)
    expect(read(vault, '清单.md')).toBe('# 清单\n\n第二段\n\n要买：\n- 苹果\n- 香蕉\n- 梨\n\n第三段\n\n第一段\n')
  } finally {
    await run.close()
  }
})

test('点把手出块菜单（DESIGN.v3 6.4）：转成标题、待办、引用，复制一块，删除；⌥⇧↑↓ 挪光标所在的块', async () => {
  const md = '# 笔记\n\n甲段\n\n乙段\n\n丙段\n'
  const run = await launch({ '笔记.md': md })
  const { page, vault } = run
  const menu = page.getByRole('menu', { name: '块菜单' })
  const pick = async (text: string, item: string) => {
    await expect(async () => {
      await hoverBlock(page, text)
      await grip(page).click({ timeout: 1000 })
      await expect(menu).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
    await menu.getByRole('menuitem', { name: item }).click()
    await expect(menu).toBeHidden()
  }
  try {
    await openNote(page, '笔记')
    await pick('乙段', '转成标题')
    await waitSaved(page)
    expect(read(vault, '笔记.md')).toBe('# 笔记\n\n甲段\n\n## 乙段\n\n丙段\n')
    await expect(pane(page).locator('.cm-h2')).toHaveText(/乙段/)

    await pick('甲段', '转成待办')
    await waitSaved(page)
    expect(read(vault, '笔记.md')).toBe('# 笔记\n\n- [ ] 甲段\n\n## 乙段\n\n丙段\n')

    await pick('丙段', '转成引用')
    await pick('丙段', '复制一块')
    await waitSaved(page)
    expect(read(vault, '笔记.md')).toBe('# 笔记\n\n- [ ] 甲段\n\n## 乙段\n\n> 丙段\n\n> 丙段\n')

    await pick('乙段', '删除')
    // 下移：菜单里没有了（照稿），键盘 ⌥⇧↓ 照旧
    await line(page, '甲段').click()
    await page.keyboard.press('Alt+Shift+ArrowDown')
    await waitSaved(page)
    expect(read(vault, '笔记.md')).toBe('# 笔记\n\n> 丙段\n\n- [ ] 甲段\n\n> 丙段\n')

    // 键盘上下挪：光标在「甲段」里
    await line(page, '甲段').click()
    await page.keyboard.press('Alt+Shift+ArrowUp')
    await page.keyboard.press('Alt+Shift+ArrowUp')
    await waitSaved(page)
    expect(read(vault, '笔记.md')).toBe('- [ ] 甲段\n\n# 笔记\n\n> 丙段\n\n> 丙段\n')
    await page.keyboard.press('Alt+Shift+ArrowDown')
    // 光标跟着块走：接着打字落在「甲段」后面
    await page.keyboard.press('End')
    await page.keyboard.type('！')
    await waitSaved(page)
    expect(read(vault, '笔记.md')).toBe('# 笔记\n\n- [ ] 甲段！\n\n> 丙段\n\n> 丙段\n')

    // Esc 关菜单，什么都不改
    await hoverBlock(page, '笔记')
    await grip(page).click()
    await expect(menu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
    expect(await editorText(page)).toBe('# 笔记\n\n- [ ] 甲段！\n\n> 丙段\n\n> 丙段\n')
  } finally {
    await run.close()
  }
})

test('/ 菜单：插入标题、待办、表格、链接到笔记、日期；打字筛选，↑↓ 选，回车插入，Esc 关', async () => {
  const run = await launch({ '写作.md': '# 写作\n\n开头一段\n', '工作流.md': '# 工作流\n', '所思所想.md': '# 所思所想\n' })
  const { page, vault } = run
  try {
    await openNote(page, '写作')
    await line(page, '开头一段').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    // 打 / 弹出菜单；Esc 关掉，/ 留着当普通字
    await page.keyboard.type('/')
    await expect(slash(page)).toBeVisible()
    // DESIGN.v3 6.3 的四组 15 项 + 提示块 5 种、折叠块、日期、数据库、拍导图（提示块 5 种不打字就全列，task-r00en；拍导图 task-wuv05 加在「图片和表格」最后）
    await expect(slash(page).getByRole('option')).toHaveCount(24)
    await expect(slash(page).getByRole('option', { name: /拍导图/ })).toHaveCount(1)
    await expect(slash(page).locator('.slash-g')).toHaveText(['基本', '图片和表格', '链接', 'AI'])
    await page.keyboard.press('Escape')
    await expect(slash(page)).toBeHidden()
    await page.keyboard.press('Backspace')

    // 筛选 + 回车：二级标题
    await page.keyboard.type('/h2')
    await expect(slash(page).getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(slash(page)).toBeHidden()
    await page.keyboard.type('小节')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    // 中文筛选：「待办」筛出「待办」一个
    await page.keyboard.type('/待办')
    await expect(slash(page).getByRole('option', { name: /^待办/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await page.keyboard.type('买菜')
    await page.keyboard.press('Enter')
    // 列表里回车接着是待办；空的那项再回车就出了列表
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    // ↑↓ 选：「列表」筛出 列表（圆点）/ 编号列表，↓ 一次是编号列表
    await page.keyboard.type('/列表')
    await expect(slash(page).getByRole('option')).toHaveCount(2)
    await page.keyboard.press('ArrowDown')
    await expect(slash(page).getByRole('option', { name: /编号列表/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await page.keyboard.type('第一步')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')

    // 链接到笔记：插入 [[ ]] 并弹出笔记列表，打字筛选（「/链接」先列白板链接，↓ 选链接到笔记）
    await page.keyboard.type('/链接')
    await page.keyboard.press('ArrowDown')
    await expect(slash(page).getByRole('option', { name: /链接到笔记/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    const notes = page.getByRole('listbox', { name: '链接到笔记' })
    await expect(notes).toBeVisible()
    await expect(notes.getByRole('option')).toHaveCount(2)
    await page.keyboard.type('工作')
    await expect(notes.getByRole('option')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(notes).toBeHidden()
    await page.keyboard.type(' 和日期 ')

    // 日期：行首才弹菜单，行中间的 / 是普通字
    await page.keyboard.type('a/b')
    await expect(slash(page)).toBeHidden()
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/日期')
    await page.keyboard.press('Enter')

    // 表格：插入 3×3（光标停在表格前面那一行）
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/表格')
    await page.keyboard.press('Enter')
    // 点第一格就地改（方向 A：表格不露「|」，格子里直接打字）
    const t0 = pane(page).locator('.cm-table table')
    await t0.locator('th').first().click()
    const cell = pane(page).locator('.cm-cellin')
    await expect(cell).toBeFocused()
    await cell.fill('名字')
    await cell.press('Escape')
    await page.keyboard.press('Meta+s')
    await waitSaved(page)

    const d = new Date()
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(read(vault, '写作.md')).toBe(
      [
        // 文末那一行里回车两下是两个空块（像 Notion，task-axoxy 第 15 条）：每一块上面留着一个空块
        '# 写作',
        '',
        '开头一段',
        '',
        '',
        '## 小节',
        '',
        '',
        '- [ ] 买菜',
        '',
        '',
        '1. 第一步',
        '',
        '',
        '[[工作流]] 和日期 a/b',
        '',
        '',
        day,
        '',
        '',
        '| 名字 | 列 2 | 列 3 |',
        '| --- | --- | --- |',
        '|    |    |    |',
        '|    |    |    |',
        '',
      ].join('\n'),
    )

    // 光标在哪都显示成表格（不露「|」）
    await line(page, '开头一段').click()
    const table = pane(page).locator('.cm-table table')
    await expect(table).toBeVisible()
    await expect(table.locator('th')).toHaveText(['名字', '列 2', '列 3'])
    await expect(table.locator('tbody tr')).toHaveCount(2)
    // 点一格就地改，Tab 跳下一格
    await table.locator('th').nth(1).click()
    await expect(table).toBeVisible()
    await expect(pane(page).locator('.cm-cellin')).toBeFocused()
    await page.keyboard.press('End')
    await page.keyboard.type('数量')
    await page.keyboard.press('Tab')
    await page.keyboard.type('单位')
    await page.keyboard.press('Escape')
    await waitSaved(page)
    expect(read(vault, '写作.md')).toContain('| 名字 | 列 2数量 | 单位 |')
  } finally {
    await run.close()
  }
})

test('「+」打开插入菜单（不写「/」）；Esc 什么都不留；打字筛选、回车插在这一块后面', async () => {
  const md = '# 加块\n\n第一段\n\n第二段\n'
  const run = await launch({ '加块.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '加块')
    await clickAdd(page, '第一段')
    await page.keyboard.press('Escape')
    await expect(slash(page)).toBeHidden()
    await page.waitForTimeout(1000)
    expect(read(vault, '加块.md')).toBe(md)

    await clickAdd(page, '第一段')
    await page.keyboard.type('h3')
    await page.keyboard.press('Enter')
    await page.keyboard.type('中间的小标题')
    await waitSaved(page)
    expect(read(vault, '加块.md')).toBe('# 加块\n\n第一段\n\n### 中间的小标题\n\n第二段\n')
  } finally {
    await run.close()
  }
})

test('待办：直接打 [] 空格变待办；点勾选框改的是 md 里的 [ ] / [x]', async () => {
  const md = '# 要订的\n\n- [ ] 车\n- [x] 机票\n'
  const run = await launch({ '要订的.md': md })
  const { page, vault } = run
  try {
    await openNote(page, '要订的')
    const boxes = pane(page).getByRole('checkbox')
    await expect(boxes).toHaveCount(2)
    await expect(boxes.nth(1)).toHaveAttribute('aria-checked', 'true')
    await boxes.nth(0).click()
    await waitSaved(page)
    expect(read(vault, '要订的.md')).toBe('# 要订的\n\n- [x] 车\n- [x] 机票\n')
    await boxes.nth(1).click()
    await waitSaved(page)
    expect(read(vault, '要订的.md')).toBe('# 要订的\n\n- [x] 车\n- [ ] 机票\n')

    // 标题末尾回车一次就新起一块（task-ys1rr，像 Notion；以前回车两下才空出一行）
    await line(page, '要订的').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('[] 住处')
    await expect(boxes).toHaveCount(3)
    await waitSaved(page)
    expect(read(vault, '要订的.md')).toBe('# 要订的\n\n- [ ] 住处\n\n- [x] 车\n- [ ] 机票\n')
  } finally {
    await run.close()
  }
})

test('/ 白板 新建子白板并插入链接；/ 图片 拷进附件并显示；AI 写一段（测试用固定回答）', async () => {
  const run = await launch({ '旅行.md': '# 旅行\n\n正文\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const tmp = mkdtempSync(join(tmpdir(), 'cn-img-'))
  // 1×1 的 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
  writeFileSync(join(tmp, '猫 咪.png'), png)
  try {
    await openNote(page, '旅行')
    await line(page, '正文').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    // 「白板链接」：从库里的白板里挑，第一行「新建白板」
    await page.keyboard.type('/白板')
    await page.keyboard.press('Enter')
    const boards = page.getByRole('listbox', { name: '白板链接' })
    await expect(boards.getByRole('option').first()).toContainText('新建白板')
    await page.keyboard.press('Enter')
    await expect(page.locator('.nav .si', { hasText: '未命名白板' })).toBeVisible()
    await waitSaved(page)
    // 回车两下是两个空块（task-axoxy 第 15 条），链接插在第二个里
    expect(read(vault, '旅行.md')).toBe('# 旅行\n\n正文\n\n\n[[未命名白板]]\n\n\n')
    expect(read(vault, '未命名白板.md')).toContain('type: board')

    // 系统的选文件对话框换成直接给一张图（主进程里替换 dialog）
    await run.app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog
    }, join(tmp, '猫 咪.png'))
    // 白板链接画成一张卡，光标已经在卡下面新起的一段
    await expect(pane(page).locator('[data-part="白板链接"]')).toContainText('未命名白板')
    await page.keyboard.type('/图片')
    await page.keyboard.press('Enter')
    // 拷进这篇自己的附件文件夹 附件/<笔记名>/，说明默认空（CN-40）
    await expect.poll(() => existsSync(join(vault, '附件', '旅行', '猫 咪.png'))).toBe(true)
    expect(readFileSync(join(vault, '附件', '旅行', '猫 咪.png')).equals(png)).toBe(true)
    await waitSaved(page)
    expect(read(vault, '旅行.md')).toBe('# 旅行\n\n正文\n\n\n[[未命名白板]]\n\n![](附件/旅行/猫%20咪.png)\n')
    // 光标移开，图片显示出来（cn-file:// 读的是库里的文件）
    await line(page, '正文').click()
    const img = pane(page).locator('.cm-image img')
    await expect(img).toBeVisible()
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(1)

    // AI 写一段（段末回车一次就新起一块，task-ys1rr）
    await line(page, '正文').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/ai')
    await page.keyboard.press('Enter')
    const ask = page.getByRole('textbox', { name: '让 AI 写什么' })
    await expect(ask).toBeFocused()
    await page.keyboard.type('写一句开场白')
    await page.keyboard.press('Enter')
    await expect(ask).toBeHidden()
    await waitSaved(page)
    // AI 写的一句包成 AI 块（task-dtc34）
    expect(read(vault, '旅行.md')).toBe('# 旅行\n\n正文\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5\n> 这是测试回答。\n\n[[未命名白板]]\n\n![](附件/旅行/猫%20咪.png)\n')
  } finally {
    await run.close()
    rmSync(tmp, { recursive: true, force: true })
  }
})

test('挪块和插入之后：外部改动合并进来，正在打的字不丢；打开再保存（含表格、待办、卡片）不变', async () => {
  const BASE = '# 旅行\n\n第一段。\n\n第二段。\n\n第三段。\n\n第四段。\n\n第五段。\n'
  const board = '---\ntype: board\n---\n# 白板\n\n<!-- card id=a1 x=0 y=0 -->\n- [ ] 车\n- [x] 机票\n\n<!-- card id=a2 x=300 y=0 -->\n| a | b |\n| - | - |\n| 1 | 2 |\n'
  const run = await launch({ '旅行.md': BASE, '白板.md': board })
  const { page, vault } = run
  const file = join(vault, '旅行.md')
  try {
    // 打开白板文件切到文档：表格、待办、卡片都画出来了，文件和 Git 都不变
    await openNote(page, '白板')
    await expect(pane(page).locator('.cm-table')).toBeVisible()
    await expect(pane(page).getByRole('checkbox')).toHaveCount(2)
    await hoverBlock(page, '白板')
    await page.keyboard.press('Meta+s')
    await page.waitForTimeout(1000)
    expect(read(vault, '白板.md')).toBe(board)

    await openNote(page, '旅行')
    // 刚挪完块、还没自动保存，外部（AI、同步）就改了磁盘上另一段：合并进来，挪的块也在
    await dragBlock(page, '第二段。', '第一段。', 'before')
    writeFileSync(file, BASE.replace('第五段。', '第五段。AI 补的一句'))
    await expect.poll(() => editorText(page)).toContain('AI 补的一句')
    await waitSaved(page)
    const moved = '# 旅行\n\n第二段。\n\n第一段。\n\n第三段。\n\n第四段。\n\n第五段。AI 补的一句\n'
    expect(read(vault, '旅行.md')).toBe(moved)

    // 一边打字一边外部改动：正在打的字一个不少
    await line(page, '第一段。').click()
    await page.keyboard.press('End')
    const typing = page.keyboard.type('正在打的字，外部改动来了也接着打', { delay: 120 })
    await page.waitForTimeout(400)
    writeFileSync(file, moved.replace('第四段。', '第四段。同步来的'))
    await typing
    await expect.poll(() => editorText(page)).toContain('同步来的')
    await waitSaved(page)
    expect(read(vault, '旅行.md')).toBe(
      '# 旅行\n\n第二段。\n\n第一段。正在打的字，外部改动来了也接着打\n\n第三段。\n\n第四段。同步来的\n\n第五段。AI 补的一句\n',
    )
    expect(readdirSync(vault).filter((f) => f.includes('冲突'))).toHaveLength(0)

    // 关掉所有标签；关完回到首页，只剩首页时不再关（它也没有 ×）
    const tabs = page.getByTestId('tab-list').getByRole('tab')
    while (!((await tabs.count()) === 1 && (await page.getByTestId('tab-on').textContent()) === '首页')) await page.locator('.tab.on .x').click()
    await page.waitForTimeout(1200)
    expect(gitStatus(vault)).toBe(' M 旅行.md\n')
  } finally {
    await run.close()
  }
})
