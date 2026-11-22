// 2026-11-22 用户（task-dtc34，截图《杀死一只知更鸟》书摘里 AI 写的两段「评价」看着就是普通正文）：
// 「这段是AI写的 我记得之前你有一版设计里面就是AI写出来的东西 它是有一个框 上面有一个AI标志的设计」。
// AI 往文档里新加的内容一律包成 `> [!ai] AI 写的 · 哪家 · 模型 · 回到 AI 对话` 块，文档里画成带框、框头引擎标志的块：
// - 全能模式下 AI 自己用 Edit 加了几段普通的字：这一轮结束软件补包，和 AI 的改动同一次提交，「撤回」一起撤掉；
// - AI 改了用户原有的字：不包（那是「改」）；这一轮里用户自己在同一篇打的整段：不包；
// - AI 用笔记工具在末尾加一段：当场就包好；
// - 已有的（以前 AI 写的普通段落）：右键「标成 AI 写的」包成「AI 写的 · 补标」，⌘Z 撤回；
// - 在 AI 块里改了字：头上多「改过」，⌘Z 和那一下一起撤；块菜单「变成我的字」去掉框，⌘Z 撤回。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库、临时设置目录。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, launch, openAi, openNote, pane, waitSaved, type Running } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const BOOK = `---
类型: 书摘
作者: 哈珀·李
---
# 杀死一只知更鸟

## 第一章

> 我哥哥杰姆快满十三岁的时候，胳膊肘遭受了一次严重的骨折。
—— [《杀死一只知更鸟》 · 第一章](https://weread.qq.com/web/reader/abc)

> 等过了一些年，日子长到足够让当事人回首往事时，我们有时候会谈论导致他受伤的那些过往事件。
—— [《杀死一只知更鸟》 · 第一章](https://weread.qq.com/web/reader/abc)
`
const P1 = '开篇很克制：从杰姆胳膊肘骨折这件小事讲起，再说"过了一些年"兄妹俩回头谈起它。'
const P2 = '"事情就开始了"这一句把源头指向迪尔和怪人拉德利，先抛一个悬念。'
/** 以前 AI 直接写进去的样子（img1）：「## 评价」下面两段普通的字 */
const OLD_REVIEW = `${BOOK}\n## 评价\n\n${P1}\n\n${P2}\n`
const BOOK_PATH = '阅读/杀死一只知更鸟.md'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const disk = (run: Running, rel: string) => readFileSync(join(run.vault, rel), 'utf8')

async function send(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
}

async function answered(page: Page) {
  await expect(chat(page).getByRole('button', { name: '停下' })).toBeHidden({ timeout: 20_000 })
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 20_000 })
  return chat(page).getByTestId('ai-msg').last()
}

/** 文档里画出来的 AI 块：框头那一行（引擎标志 +「AI 写的」+ 灰字） */
const aiHeads = (page: Page) => pane(page).locator('.cm-line.cm-callout-ai.cm-callout-head')

test('全能模式：AI 用 Edit 在书摘末尾加「## 评价」和两段普通的字，这一轮结束补包成 AI 块（同一次提交、能撤回），文档里画成带框带 Claude 标志的块', async () => {
  const run = await launch({ [BOOK_PATH]: BOOK }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '杀死一只知更鸟')
    await openAi(page)
    await send(page, `在「${BOOK_PATH}」末尾写一节评价`)
    const msg = await answered(page)
    await expect(msg).toContainText('我在文末加了一节「评价」')
    // 文件里：标题留在框外，两段包成一个 [!ai] 块，头上写哪家哪个模型、链回这段对话
    await expect.poll(() => disk(run, BOOK_PATH)).toContain('> [!ai]')
    const text = disk(run, BOOK_PATH)
    expect(text.startsWith(BOOK)).toBe(true)
    const tail = text.slice(BOOK.length)
    expect(tail).toMatch(/^\n## 评价\n\n> \[!ai\] AI 写的 · Claude Code · Opus 5\.5 · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=[^)\s]+&msg=\d+\)\n/)
    expect(tail).toContain(`\n> ${P1}\n>\n> ${P2}\n`)
    // 同一次提交「AI：…」，工作区干净
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/^AI：/)
    expect(git(vault, 'show', 'HEAD:' + BOOK_PATH)).toBe(text.replace(/\n$/, ''))
    expect(git(vault, 'status', '--porcelain')).toBe('')
    // 文档里：编辑器收到了包好的样子，画成 AI 块（框头 Claude 标志、「AI 写的」、灰字的引擎和模型）
    await expect.poll(() => editorText(page)).toBe(text)
    await expect(aiHeads(page)).toHaveCount(1)
    const head = aiHeads(page).first()
    await expect(head.locator('.cm-callout-icon svg, .cm-callout-icon img')).toHaveCount(1)
    await expect(head.locator('.cm-callout-name')).toHaveText('AI 写的')
    await expect(head.locator('.cm-callout-meta')).toContainText('Claude Code · Opus 5.5')
    await expect(pane(page).locator('.cm-line.cm-callout-ai')).toHaveCount(4)
    // 撤回这一轮：AI 写的和补的框一起没了，文件回到原样
    await msg.getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => disk(run, BOOK_PATH)).toBe(BOOK)
  } finally {
    await run.close()
  }
})

test('AI 改了用户原有的字不包；这一轮里用户自己在同一篇打的一段不包，AI 加的包', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n\n一段字。\n', [BOOK_PATH]: BOOK }, { CN_AI_FAKE: '1', CN_FAKE_OWN_MS: '2500' })
  const { page, vault } = run
  try {
    await openAi(page)
    await send(page, '把「随手记.md」里的「一段字。」改成「一段改过的字。」')
    await answered(page)
    expect(disk(run, '随手记.md')).toBe('# 随手记\n\n一段改过的字。\n')
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/^AI：/)

    // AI 在写的时候，用户在同一篇的第一章后面自己打了一段
    await openNote(page, '杀死一只知更鸟')
    await send(page, `在「${BOOK_PATH}」末尾写一节评价`)
    await expect(chat(page).getByRole('button', { name: '停下' })).toBeVisible()
    const cm = pane(page).locator('.cm-content')
    await cm.click()
    await page.keyboard.press('Meta+ArrowUp')
    const firstQuote = pane(page).locator('.cm-line', { hasText: '我哥哥杰姆' }).first()
    await firstQuote.click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('我自己的一段：这本书我十年前读过。')
    await waitSaved(page)
    await answered(page)
    await expect.poll(() => disk(run, BOOK_PATH)).toContain('> [!ai] AI 写的')
    const text = disk(run, BOOK_PATH)
    expect(text).toContain('\n我自己的一段：这本书我十年前读过。\n')
    expect(text).not.toContain('> 我自己的一段')
    expect(text).toContain(`## 评价\n\n> [!ai] AI 写的 · Claude Code · Opus 5.5 · [回到 AI 对话](`)
    expect(text).toContain(`> ${P1}\n>\n> ${P2}\n`)
  } finally {
    await run.close()
  }
})

test('笔记工具在末尾加的一段当场就包好（全能模式关着也一样）', async () => {
  const run = await launch({ '周记.md': '# 周记\n\n这周在赶作业。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openAi(page)
    await chat(page).getByRole('switch', { name: '全能模式' }).click()
    await send(page, '在「周记.md」末尾加上「下周要约导师见一面。」')
    await answered(page)
    expect(disk(run, '周记.md')).toMatch(/^# 周记\n\n这周在赶作业。\n\n> \[!ai\] AI 写的 · Claude Code · Opus 5\.5 · \[回到 AI 对话\]\(canvas-notes:\/\/chat\?key=[^)]+\)\n> 下周要约导师见一面。\n$/)
  } finally {
    await run.close()
  }
})

test('已有的两段：右键「标成 AI 写的」包成「AI 写的 · 补标」、⌘Z 撤回；块里改字头上多「改过」、⌘Z 一起撤；块菜单「变成我的字」去掉框、⌘Z 撤回', async () => {
  const run = await launch({ [BOOK_PATH]: OLD_REVIEW }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await armMenus(run)
    await openNote(page, '杀死一只知更鸟')
    await expect(aiHeads(page)).toHaveCount(0)
    // 选中两段：点第一段开头，按住 Shift 点第二段末尾
    const l1 = pane(page).locator('.cm-line', { hasText: '开篇很克制' })
    const l2 = pane(page).locator('.cm-line', { hasText: '事情就开始了' })
    const b1 = (await l1.boundingBox())!
    const b2 = (await l2.boundingBox())!
    await page.mouse.click(b1.x + 2, b1.y + b1.height / 2)
    await page.keyboard.press('Home')
    await page.keyboard.down('Shift')
    await page.mouse.click(b2.x + b2.width - 2, b2.y + b2.height - 4)
    await page.keyboard.up('Shift')
    await l2.click({ button: 'right', position: { x: 20, y: 6 } })
    // 右键（选区还在）：菜单里有「标成 AI 写的」，和「转成」一组
    let m = await openedMenu(run)
    const labels = menuLabels(m)
    expect(labels).toContain('标成 AI 写的')
    expect(labels).not.toContain('变成我的字')
    await pickMenu(run, '标成 AI 写的')
    const marked = `${BOOK}\n## 评价\n\n> [!ai] AI 写的 · 补标\n> ${P1}\n>\n> ${P2}\n`
    await expect.poll(() => editorText(page)).toBe(marked)
    await waitSaved(page)
    await expect.poll(() => disk(run, BOOK_PATH)).toBe(marked)
    await expect(aiHeads(page)).toHaveCount(1)
    await expect(aiHeads(page).locator('.cm-callout-name')).toHaveText('AI 写的')
    // ⌘Z 一下回到两段普通的字，⌘⇧Z 再包上
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(OLD_REVIEW)
    await page.keyboard.press('Meta+Shift+z')
    await expect.poll(() => editorText(page)).toBe(marked)

    // 在 AI 块里改字：头上多「改过」，和这一下打字同一步
    await pane(page).locator('.cm-line', { hasText: '先抛一个悬念' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('好')
    await expect.poll(() => editorText(page)).toBe(marked.replace('> [!ai] AI 写的 · 补标', '> [!ai] AI 写的 · 补标 · 改过').replace('先抛一个悬念。', '先抛一个悬念。好'))
    await expect(aiHeads(page).locator('.cm-callout-meta')).toContainText('改过')
    // 再打一个字不再加第二个「改过」
    await page.keyboard.type('的')
    await expect.poll(() => editorText(page)).toContain('补标 · 改过\n')
    expect((await editorText(page)).match(/改过/g)).toHaveLength(1)
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(marked)

    // 块菜单（把手）：「变成我的字」去掉框
    const head = aiHeads(page).first()
    await expect(async () => {
      const box = (await head.boundingBox())!
      await page.mouse.move(box.x + 40, box.y + 8)
      await page.mouse.move(box.x + 60, box.y + 10)
      await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click({ timeout: 1000 })
      await expect(page.getByRole('menu', { name: '块菜单' })).toBeVisible({ timeout: 1000 })
    }).toPass({ timeout: 10_000 })
    const bmenu = page.getByRole('menu', { name: '块菜单' })
    await expect(bmenu.getByRole('menuitem', { name: '变成我的字' })).toBeVisible()
    await bmenu.getByRole('menuitem', { name: '变成我的字' }).click()
    await expect.poll(() => editorText(page)).toBe(OLD_REVIEW)
    await expect(aiHeads(page)).toHaveCount(0)
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toBe(marked)
    await waitSaved(page)
    expect(disk(run, BOOK_PATH)).toBe(marked)

    // 右键点在 AI 块里：「变成我的字」，没有「标成 AI 写的」
    await pane(page).locator('.cm-line', { hasText: '开篇很克制' }).click({ button: 'right' })
    m = await openedMenu(run)
    expect(menuLabels(m)).toContain('变成我的字')
    expect(menuLabels(m)).not.toContain('标成 AI 写的')
    await pickMenu(run, '变成我的字')
    await expect.poll(() => editorText(page)).toBe(OLD_REVIEW)
  } finally {
    await run.close()
  }
})
