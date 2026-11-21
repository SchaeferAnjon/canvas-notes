// AI 命令做出来要和说明对得上（task-9womr，designer 核实报告「现有命令要改的 7 处」里的 4 处）：
// 1. /写成文章 的草稿写在白板所在的文件夹（白板在收件箱或库最外层时进「收件箱/」），回答卡片和改动块写出文件夹，重名不覆盖；
// 2. 在 AI 里 /剪藏这一页：回答下面和别的命令一样有「打开」和「改了1个文件 · 撤回」，撤回真把那次剪藏翻回去；
// 3. /整理当前白板 的提交说明是「AI：/整理当前白板 · <白板名>」，不是写给 AI 的一长串话；
// 4. 文件夹页「照上周的样子开一篇」不经 AI，提交说明不带「AI：」。
// 都是在 AI 输入框里真打 /、真点菜单项、真点「打开」「撤回」。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { launch, leftView, pane, rail, tabOn, webAboveAi } from './app'
import { ICELAND } from './fixtures/board'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const subjects = (vault: string, n: number) => execFileSync('git', ['-C', vault, 'log', `-${n}`, '--format=%s'], { encoding: 'utf8' }).trim().split('\n')
const read = (vault: string, f: string) => readFileSync(join(vault, f), 'utf8')

/** ⌘K 里按名字打开一篇（白板开成白板） */
async function openByName(page: Page, name: string) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill(name)
  await page.locator('.pal-row', { has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first().click()
  await expect(tabOn(page)).toHaveText(name)
}

/** AI 输入框里真打「/」和几个字，在弹出的命令菜单里点那一条 */
async function slash(page: Page, typed: string, name: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.click()
  await page.keyboard.type('/' + typed)
  const menu = chat(page).getByRole('listbox', { name: '命令' })
  await expect(menu).toBeVisible()
  await menu.getByRole('option').filter({ has: page.locator('b', { hasText: new RegExp(`^${name}$`) }) }).click()
}

async function openAi(page: Page) {
  const entry = page.getByRole('button', { name: '打开 AI', exact: true })
  if (await entry.count()) await entry.first().click()
  await expect(chat(page)).toBeVisible()
}

test('/写成文章：草稿写在白板所在的文件夹，回答卡片和改动块写出文件夹；再写一次加「 2」不覆盖；库最外层、收件箱里的白板写进收件箱', async () => {
  const run = await launch(
    { '课程/机器学习/冰岛自驾.md': ICELAND, '计划.md': ICELAND.replace('冰岛环岛前', '计划里'), '收件箱/草图.md': ICELAND.replace('冰岛环岛前', '草图里') },
    { CN_AI_FAKE: '1' },
  )
  const { page, vault } = run
  try {
    await openByName(page, '冰岛自驾')
    await openAi(page)
    await slash(page, '写成', '写成文章')
    const msg = chat(page).getByTestId('ai-msg').last()
    const path = '课程/机器学习/冰岛自驾：文章草稿.md'
    await expect(msg.locator('.dprev .dmeta code')).toHaveText(path)
    await expect(msg.getByTestId('ai-change').locator('.fr')).toHaveText([new RegExp(`^${path}新`)])
    expect(read(vault, path)).toMatch(/^---\ndraft: true\nfrom: "\[\[冰岛自驾\]\]"\n---\n# 冰岛自驾\n/)
    expect(existsSync(join(vault, '冰岛自驾：文章草稿.md'))).toBe(false)
    expect(subjects(vault, 1)).toEqual(['AI：按「冰岛自驾」写成文章草稿'])
    const first = read(vault, path)
    // 点「打开」开的就是这一篇
    await msg.getByRole('button', { name: '打开' }).click()
    await expect(tabOn(page)).toHaveText('冰岛自驾：文章草稿')

    // 再写一次：同一个文件夹里加「 2」，第一篇不动
    await openByName(page, '冰岛自驾')
    await slash(page, '写成', '写成文章')
    const msg2 = chat(page).getByTestId('ai-msg').last()
    await expect(msg2.locator('.dprev .dmeta code')).toHaveText('课程/机器学习/冰岛自驾：文章草稿 2.md')
    expect(read(vault, path)).toBe(first)
    expect(existsSync(join(vault, '课程/机器学习/冰岛自驾：文章草稿 2.md'))).toBe(true)
    // 实心「打开」一屏只有一个：最新那条是实心，上一条退成次按钮
    await expect(msg2.getByRole('button', { name: '打开' })).toHaveClass(/btn-primary/)
    await expect(chat(page).getByTestId('ai-msg').filter({ has: page.locator('.dprev') }).first().getByRole('button', { name: '打开' })).not.toHaveClass(/btn-primary/)
    // 右栏拉窄到 340：放不下时先省略文件夹那一截，文件名整个露着、悬停看整条；「· N字 · AI写的草稿」不折行
    const narrow = async (to: number) => {
      const aside = chat(page)
      const dx = (await aside.boundingBox())!.width - to
      const sep = (await page.getByRole('separator', { name: '拖动调整右栏宽度' }).boundingBox())!
      await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
      await page.mouse.down()
      await page.mouse.move(sep.x + sep.width / 2 + dx, sep.y + 300, { steps: 6 })
      await page.mouse.up()
      await expect.poll(async () => Math.round((await aside.boundingBox())!.width)).toBe(to)
    }
    await narrow(340)
    const cut = (l: ReturnType<Page['locator']>) => l.evaluate((e) => e.scrollWidth > e.clientWidth + 1)
    const row = msg2.getByTestId('ai-change').locator('.fr .fpath')
    expect(await cut(row.locator('.dir'))).toBe(true)
    expect(await cut(row.locator('.fn'))).toBe(false)
    await expect(row).toHaveAttribute('title', '课程/机器学习/冰岛自驾：文章草稿 2.md')
    expect(await cut(msg2.locator('.dprev .dmeta .fn'))).toBe(false)
    const oneLine = () => msg2.locator('.dprev .dmeta').evaluate((e) => e.getBoundingClientRect().height < 24)
    expect(await oneLine()).toBe(true)
    // 最窄 300：文件夹那一截先收没了，才轮到文件名；那一行照样不折
    await narrow(300)
    expect(await row.locator('.dir').evaluate((e) => e.getBoundingClientRect().width)).toBeLessThan(1)
    expect(await oneLine()).toBe(true)
    // 库最外层的白板：进收件箱
    await openByName(page, '计划')
    await slash(page, '写成', '写成文章')
    const msg3 = chat(page).getByTestId('ai-msg').last()
    await expect(msg3.locator('.dprev .dmeta code')).toHaveText('收件箱/计划：文章草稿.md')
    await expect(msg3.getByTestId('ai-change').locator('.fr')).toHaveText([/^收件箱\/计划：文章草稿\.md新/])
    expect(existsSync(join(vault, '计划：文章草稿.md'))).toBe(false)

    // 收件箱里的白板：也进收件箱（就在它旁边）
    await openByName(page, '草图')
    await slash(page, '写成', '写成文章')
    await expect(chat(page).getByTestId('ai-msg').last().locator('.dprev .dmeta code')).toHaveText('收件箱/草图：文章草稿.md')
    expect(readdirSync(join(vault, '收件箱')).sort()).toEqual(['草图.md', '草图：文章草稿.md', '计划：文章草稿.md'].sort())
  } finally {
    await run.close()
  }
})

test('AI 里 /剪藏这一页：回答下面有「打开」和「改了1个文件 · 撤回」，打开就是剪下的那篇，撤回把剪藏翻回去', async () => {
  const server = createServer((_q, r) =>
    r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>张量</title><article><h1>张量</h1><p>张量是多维数组，是后面所有计算的基本数据结构。</p><p>第二段也是正文。</p></article>'),
  )
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/tensor`
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n' }, { CN_AI_FAKE: '1' })
  const { page, vault, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(url)
    await addr.press('Enter')
    await expect(web(page).locator('webview.on')).toBeVisible()
    await expect
      .poll(() => page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<string> }).executeJavaScript('document.readyState')))
      .toBe('complete')
    await openAi(page)
    await webAboveAi(page)
    await slash(page, '剪藏', '剪藏这一页')
    const msg = chat(page).getByTestId('ai-msg').last()
    const chg = msg.getByTestId('ai-change')
    await expect(chg.locator('.hd')).toContainText('改了1个文件')
    await expect(chg.locator('.fr')).toHaveText([/^收件箱\/张量\.md新/])
    await expect(msg.locator('.txt')).toHaveText('剪好了「张量」，放在「收件箱」。')
    expect(existsSync(join(vault, '收件箱/张量.md'))).toBe(true)
    expect(subjects(vault, 1)).toEqual(['剪藏整页：张量'])
    // 打开：中间开的是剪下的那篇（AI 那一格换成这一篇的对话）
    const where = (await chat(page).getByTestId('ai-conv').innerText()).trim()
    await msg.getByRole('button', { name: '打开' }).click()
    await expect(tabOn(page)).toHaveText('张量')
    await expect(pane(page)).toContainText('张量是多维数组')
    // 回到剪藏那段对话（头上「张量 ⌄」里点它），点撤回：那一篇不在了，历史里多一次「撤回剪藏整页：张量」
    await chat(page).getByTestId('ai-conv').click()
    await page.getByRole('menu', { name: '对话' }).getByRole('menuitemradio').filter({ hasText: where }).click()
    const back = chat(page).getByTestId('ai-msg').last().getByTestId('ai-change')
    await expect(back.locator('.fr')).toHaveText([/^收件箱\/张量\.md新/])
    await back.getByRole('button', { name: '撤回' }).click()
    await expect(back.locator('.hd')).toContainText('已撤回')
    await expect.poll(() => existsSync(join(vault, '收件箱/张量.md'))).toBe(false)
    expect(subjects(vault, 2)).toEqual(['撤回剪藏整页：张量', '剪藏整页：张量'])
  } finally {
    await run.close()
    server.close()
  }
})

const TODO_BOARD = `---
type: board
---
<!-- card id=t x=80 y=80 w=280 -->
**待办**
- [ ] 订住宿

<!-- card id=n x=500 y=80 w=280 -->
一张普通卡片
`

test('/整理当前白板：提交说明是「AI：/整理当前白板 · 白板名」，不是写给 AI 的那一长串', async () => {
  const run = await launch({ '旅行/冰岛计划.md': TODO_BOARD }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openByName(page, '冰岛计划')
    await openAi(page)
    await slash(page, '整理当前', '整理当前白板')
    const msg = chat(page).getByTestId('ai-msg').last()
    await expect(msg).toContainText('按列排整齐了')
    await expect(msg.getByTestId('ai-change').locator('.hd')).toContainText('改了1个文件')
    expect(subjects(vault, 1)).toEqual(['AI：/整理当前白板 · 冰岛计划'])
    // 对话里自己那句还是「/整理当前白板」
    await expect(chat(page).locator('.um').last()).toHaveText('/整理当前白板')
    // 撤回的说明跟着是短的
    await msg.getByTestId('ai-change').getByRole('button', { name: '撤回' }).click()
    await expect(msg.getByTestId('ai-change').locator('.hd')).toContainText('已撤回')
    expect(subjects(vault, 1)).toEqual(['撤回AI：/整理当前白板 · 冰岛计划'])
  } finally {
    await run.close()
  }
})

test('文件夹页「照上周的样子开一篇」：不经 AI，提交说明照实写「照「2026-W47」开一篇「2026-W48」」，不带「AI：」；撤回能把那篇拿掉', async () => {
  const w47 = '---\ncreated: 2026-11-12\n---\n# 2026-W47\n\n这周读了 ECP。\n\n## 读了\n\n- 课：ECP 第 5 讲\n\n## 下周\n\n订住宿。\n'
  const run = await launch({ '周记/2026-W47.md': w47 }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await leftView(page, '文件')
    await page.locator('aside.side').getByRole('tree').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^周记$/ }) }).first().click()
    await expect(pane(page)).toHaveAttribute('data-folder', '周记')
    await openAi(page)
    const sug = chat(page).locator('.ai-empty .sug').filter({ hasText: '照上周的样子开一篇' })
    await expect(sug).toHaveText('照上周的样子开一篇 2026-W48')
    await sug.click()
    await expect(tabOn(page)).toHaveText('2026-W48')
    await expect.poll(() => existsSync(join(vault, '周记/2026-W48.md'))).toBe(true)
    expect(subjects(vault, 1)).toEqual(['照「2026-W47」开一篇「2026-W48」'])
    // 回答下面照样能撤回
    await leftView(page, '文件')
    await page.locator('aside.side').getByRole('tree').getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: /^周记$/ }) }).first().click()
    const chg = chat(page).getByTestId('ai-msg').last().getByTestId('ai-change')
    await expect(chg.locator('.fr')).toHaveText([/^周记\/2026-W48\.md新/])
    await chg.getByRole('button', { name: '撤回' }).click()
    await expect(chg.locator('.hd')).toContainText('已撤回')
    await expect.poll(() => existsSync(join(vault, '周记/2026-W48.md'))).toBe(false)
    expect(subjects(vault, 1)).toEqual(['撤回照「2026-W47」开一篇「2026-W48」'])
  } finally {
    await run.close()
  }
})
