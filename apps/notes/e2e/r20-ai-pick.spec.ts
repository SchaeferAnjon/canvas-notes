// 左栏选了好几个交给 AI（task-0tgz2，用户 r20「多选文件之后 能不能也加一个AI的接口可以处理」，偏好「多选文件能交给 AI」）：
// 底部那一条「移到…」左边一颗「问AI」（前面是 AI 那一家的标志），右键也有「问 AI」；点了右栏 AI 打开，「看得到」写「选中的N个」
// （指着看是哪几个，文件夹算里面的笔记），输入框拿到焦点；问候和快捷命令换成好几篇的，点了就是发那一问；写文件的一次提交、能撤回
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { launch, leftView, openNote, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { pickQuick, quickTexts } from './ai-quick'
import { armMenus, openedMenu, pickMenu } from './menu'

const files = {
  '冰岛.md': '# 冰岛\n\n机票订好了，住宿还没定。\n',
  '菜谱.md': '# 菜谱\n\n番茄炒蛋。\n',
  '随手记.md': '# 随手记\n\n一段字。\n',
  '周记/2026-W46.md': '# 2026-W46\n\n读了 ECP 第 4 讲。\n',
  '周记/2026-W47.md': '# 2026-W47\n\n读了 ECP 第 5 讲。\n',
}

const side = (page: Page) => page.locator('aside.side')
const tree = (page: Page) => side(page).getByRole('tree')
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
const bar = (page: Page) => side(page).getByRole('toolbar', { name: '选中的' })
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

test('多选 3 篇，底部那一条点「问AI」：AI 打开、看得到「选中的3个」、输入框拿到焦点；问候和快捷命令是好几篇的；「总结这几篇」交给 AI 的是这 3 篇，「合成一篇」真建一篇、一次提交、能撤回；换了标签就拿掉', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app, vault } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await openNote(page, '随手记')
    await leftView(page, '文件')
    await row(page, '冰岛').click()
    await row(page, '菜谱').click({ modifiers: ['Meta'] })
    await row(page, '随手记').click({ modifiers: ['Meta'] })
    await expect(bar(page).locator('b')).toHaveText('已选3个')
    // 「问AI」在「移到…」左边，前面是 AI 对话那一家的标志
    await expect(bar(page).getByRole('button')).toHaveText(['问AI', '移到…', '删除'])
    const ask = bar(page).getByRole('button', { name: '问AI' })
    await expect(ask.locator('.eng-logo')).toHaveAttribute('data-engine', 'claude')
    // 三颗按钮都在这一条里，不挤出去
    const b = (await bar(page).boundingBox())!
    const del = (await bar(page).getByRole('button', { name: '删除' }).boundingBox())!
    expect(del.x + del.width).toBeLessThanOrEqual(b.x + b.width)
    await ask.click()

    const ai = chat(page)
    await expect(ai).toBeVisible()
    const picked = ai.getByTestId('ai-picked')
    await expect(picked).toHaveText('选中的3个')
    await expect(picked).toHaveAttribute('title', '冰岛\n菜谱\n随手记')
    // 「选中的3个」排第一、带圆点；这一页那颗还在，不带点
    await expect(ai.getByTestId('ai-sees').locator('.chip').first()).toHaveText('选中的3个')
    // 点第一篇时它开在了中间（照访达，单击就是打开），这一页是冰岛
    await expect(ai.getByTestId('ai-sees').locator('.chip').nth(1)).toHaveText('文档：冰岛')
    await expect(ai.getByTestId('ai-sees').locator('.chip').nth(1).locator('.dot')).toHaveCount(0)
    await expect(ai.getByRole('textbox', { name: '问 AI' })).toBeFocused()
    await expect(ai.getByTestId('ai-greet').locator('p')).toHaveText('要对选中的3个做点什么？')
    expect(await quickTexts(ai)).toEqual(['总结这几篇', '合成一篇', '找出重复的', '归到该去的分类', '列成表'])

    // 「总结这几篇」：发的是「总结选中的这几篇」，交给 AI 的正是这 3 篇
    await pickQuick(ai, '总结这几篇')
    await expect(ai.locator('.um').last()).toHaveText('总结选中的这几篇')
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（选中的3篇：冰岛.md、菜谱.md、随手记.md）。')
    // 问了以后「选中的3个」还在（接着问还是这几篇）
    await expect(picked).toHaveText('选中的3个')

    // 「合成一篇」（这一排放不下，在「⋯」里）：真建一篇，一次提交，下面能撤回
    await ai.getByRole('button', { name: '新对话' }).click()
    await pickQuick(ai, '合成一篇')
    await expect(ai.locator('.um').last()).toHaveText('把选中的这几篇合成一篇新笔记')
    const a = ai.getByTestId('ai-msg').last()
    await expect(a.locator('.txt')).toHaveText('合成好了：《合成的笔记》，来自3篇。')
    await expect(a.getByTestId('ai-change').locator('.hd')).toContainText('改了1个文件')
    const made = execFileSync('git', ['-C', vault, 'show', '--name-only', '--format=', 'HEAD'], { encoding: 'utf8' }).trim()
    expect(made).toMatch(/合成的笔记\.md$/)
    expect(existsSync(join(vault, made))).toBe(true)
    await a.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, made))).toBe(false)

    // 换了标签：「选中的3个」拿掉，问候回到这一篇的
    await openNote(page, '菜谱')
    await expect(ai.getByTestId('ai-picked')).toHaveCount(0)
    await expect(ai.getByTestId('ai-greet').locator('p')).toHaveText('要对《菜谱》做点什么？')
  } finally {
    await run.close()
  }
})

test('选了两篇和一个文件夹，右键「问 AI」：看得到「选中的3个」，指着看得到「周记（2篇）」；交给 AI 的是 4 篇（文件夹算里面的笔记）', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await armMenus(run)
    await openNote(page, '随手记')
    await leftView(page, '文件')
    await row(page, '冰岛').click()
    await row(page, '周记').click({ modifiers: ['Meta'] })
    await row(page, '菜谱').click({ modifiers: ['Meta'] })
    await expect(bar(page).locator('b')).toHaveText('已选3个')
    await row(page, '菜谱').click({ button: 'right' })
    const m = await openedMenu(run)
    const item = m.find((i) => i.label === '问 AI')
    expect(item?.enabled).toBe(true)
    // 「问 AI」紧跟在「打开」后面，和别处右键一样是单独一项
    expect(m.map((i) => i.label).slice(0, 3)).toEqual(['打开', '问 AI', '—'])
    await pickMenu(run, '问 AI')
    const ai = chat(page)
    await expect(ai.getByTestId('ai-picked')).toHaveText('选中的3个')
    const tip = await ai.getByTestId('ai-picked').getAttribute('title')
    expect(tip!.split('\n').sort()).toEqual(['冰岛', '周记（2篇）', '菜谱'].sort())
    await pickQuick(ai, '总结这几篇')
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toHaveText(/^这是测试回答（选中的4篇：.*）。$/)
    const said = (await ai.getByTestId('ai-msg').last().locator('.txt').textContent())!
    for (const f of ['冰岛.md', '菜谱.md', '周记/2026-W46.md', '周记/2026-W47.md']) expect(said).toContain(f)
  } finally {
    await run.close()
  }
})

test('中间开着 PDF 时多选 3 篇「问AI」：切到普通的 AI 对话（不是读 PDF 那一格），看得到「选中的3个」；PDF 的对话不受影响，换走再回来、或者对话菜单点回 PDF，还是原样', async () => {
  const run = await launch({ ...files, '课程/线代/第3讲.pdf': LECTURE }, { CN_AI_FAKE: '1' })
  const { page, app } = run
  const reading = page.getByRole('complementary', { name: '边读边问 AI' })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    // 中间开 PDF，读 PDF 的 AI 先问一句
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(page.locator('.pdfpane:not([hidden]) .pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
    await page.keyboard.press('Meta+j')
    const q = reading.getByRole('textbox', { name: '问 AI' })
    await q.fill('给我讲讲这一页')
    await q.press('Enter')
    await expect(reading.getByTestId('reading-msg').last().locator('.txt')).toContainText('这是讲解', { timeout: 15_000 })
    // 文件树里 ⌘ 点三篇（不打开），底部那一条点「问AI」
    await leftView(page, '文件')
    for (const n of ['冰岛', '菜谱', '随手记']) await row(page, n).click({ modifiers: ['Meta'] })
    // 照访达：开着的那份 PDF 那一行本来就算选中的，⌘ 点三篇是 4 个；再 ⌘ 点它一下去掉
    await expect(bar(page).locator('b')).toHaveText('已选4个')
    await tree(page).locator('[data-path="课程/线代/第3讲.pdf"]').click({ modifiers: ['Meta'] })
    await expect(bar(page).locator('b')).toHaveText('已选3个')
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await bar(page).getByRole('button', { name: '问AI' }).click()
    // 普通的 AI 对话：看得到「选中的3个」，问候和快捷命令是好几篇的；读 PDF 那一格藏起来
    const ai = chat(page)
    await expect(ai).toBeVisible()
    await expect(reading).toBeHidden()
    await expect(ai.getByTestId('ai-picked')).toHaveText('选中的3个')
    await expect(ai.getByTestId('ai-greet').locator('p')).toHaveText('要对选中的3个做点什么？')
    await expect(ai.getByRole('textbox', { name: '问 AI' })).toBeFocused()
    await pickQuick(ai, '总结这几篇')
    await expect(ai.getByTestId('ai-msg').last().locator('.txt')).toHaveText('这是测试回答（选中的3篇：冰岛.md、菜谱.md、随手记.md）。')
    // 对话菜单点回 PDF：读 PDF 那一格回来，刚才那一问还在
    await ai.getByTestId('ai-conv').click()
    await page.getByRole('menu', { name: '对话' }).getByRole('menuitemradio').filter({ hasText: '第3讲.pdf' }).first().click()
    await expect(reading).toBeVisible()
    await expect(reading.locator('.um').first()).toHaveText('给我讲讲这一页')
    await expect(ai).toBeHidden()
    // 再选一次「问AI」，换到别的标签再回 PDF：还是读 PDF 的对话，原样
    await bar(page).getByRole('button', { name: '问AI' }).click()
    await expect(chat(page).getByTestId('ai-picked')).toHaveText('选中的3个')
    // 重新选了一次：从打招呼开始，上一回那一问不留在这里
    await expect(chat(page).getByTestId('ai-greet')).toBeVisible()
    await expect(chat(page).getByTestId('ai-msg')).toHaveCount(0)
    await openNote(page, '菜谱')
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    await expect(reading).toBeVisible()
    await expect(reading.locator('.um').first()).toHaveText('给我讲讲这一页')
    await expect(reading.getByTestId('reading-msg').last().locator('.txt')).toContainText('这是讲解')
  } finally {
    await run.close()
  }
})
