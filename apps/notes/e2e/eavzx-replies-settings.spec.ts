// 回答下面那排能自定义（task-eavzx A 线，款式页 /private/tmp/canvas-notes-visual/62-回答按钮款式/ 第二版，偏好「能自定义的就让用户自定义」）：
// - 设置 › 回答下面那排：四处（AI 对话 / 读 PDF / 网页 / 视频）的样子用真的 AnswerBar 画，默认三颗；功能按钮只列不改；
// - 加一颗（例子「考考我」）→ AI 对话那一排多一颗，点它真发出填好的那句；改名、改那句、拖着排、收进 ⋯、去掉勾、撤回、复制一份再改、
//   从我的命令里挑、删掉（只当快捷回复的连命令删，挑来的只拿掉快捷回复），每步看这一排和命令.json；
// - 存成快捷回复：AI 对话里你发的那句悬停点「存成快捷回复」，读 PDF 里右键那句「存成快捷回复…」，同一张填好的小卡，存好这一排当场多一颗；
// - ⌘K、/ 菜单里叫得到，跑它就是在 AI 对话里发那句。
// 一律无头（CN_E2E=1）、假 AI（CN_AI_FAKE=1）、临时库。
import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { acts, launch, openAi, openNote, tabOn, widenRight } from './app'
import { LECTURE } from './fixtures/pdf'
import { armMenus, pickMenu } from './menu'

const NOTE = '学习笔记.md'
const CMDS = '.canvas-notes/命令.json'
const PDF = '课程/线代/第3讲.pdf'

const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })
const reading = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const toast = (page: Page) => dlg(page).getByTestId('settings-toast')
const list = (page: Page) => dlg(page).getByRole('group', { name: '快捷回复', exact: true })
type Zone = '排上' | '收进 ⋯' | '不出现'
const zone = (page: Page, name: Zone) => list(page).getByRole('list', { name, exact: true })
const rowsOf = (page: Page, name: Zone) => zone(page, name).getByRole('listitem').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const preview = (page: Page) => dlg(page).getByTestId('replies-preview')
/** 预览那一排排上的几颗（读 PDF、网页、视频照右栏宽画，挤了左边只剩图标：取名字） */
const previewBtns = (page: Page) =>
  preview(page)
    .getByTestId('replies-preview-bar')
    .locator(':scope > button')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim() || (e.getAttribute('aria-label') ?? '')).filter((s) => s && s !== '这条回答还能做什么'))
const card = (page: Page) => page.getByRole('dialog', { name: '存成快捷回复' })

interface Own {
  id: string
  name: string
  prompt?: string
  write: string
  where: string[]
  reply?: { where: string[]; out: string }
}
const cmdsOnDisk = (vault: string) => JSON.parse(readFileSync(join(vault, CMDS), 'utf8')) as { own: Own[]; replies?: { on: string[]; more: string[]; off: string[] }; keys?: Record<string, string> }

/** 一条回答下面那一排：右边快捷回复（左边功能按钮的字 拷贝 · 插进文档 去掉） */
/** 这一排排上的自己加的那几颗（AI 对话 r100 起默认排上的「还是不懂」「换个方式讲」不算，它们另外查） */
const rowReplies = (msg: Locator) =>
  msg
    .getByTestId('ai-ans-acts')
    .locator(':scope > [data-reply]')
    .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()).filter((s) => s !== '还是不懂' && s !== '换个方式讲'))

async function ask(page: Page, text: string) {
  const box = chat(page).getByRole('textbox', { name: '问 AI' })
  await box.fill(text)
  await box.press('Enter')
  await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
  return chat(page).getByTestId('ai-msg').last()
}

async function openReplies(page: Page) {
  if (!(await dlg(page).isVisible())) await page.keyboard.press('Meta+,')
  await expect(dlg(page)).toBeVisible()
  await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '回答下面那排' }).click()
  await expect(list(page)).toBeVisible()
}

async function rowMenu(page: Page, name: string, item: string | RegExp) {
  await list(page).getByRole('listitem', { name, exact: true }).getByRole('button', { name: '这一颗还能…' }).click()
  await dlg(page).getByRole('menu', { name: '这一颗还能…' }).getByRole('menuitem', { name: item }).click()
}

/** 设置里真拖一行：按住那一行，挪到另一行的上半截 */
async function dragRow(page: Page, name: string, before: string) {
  const a = (await list(page).getByRole('listitem', { name, exact: true }).boundingBox())!
  const b = (await list(page).getByRole('listitem', { name: before, exact: true }).boundingBox())!
  await page.mouse.move(a.x + 20, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(a.x + 20, a.y + a.height / 2 + 8, { steps: 2 })
  await page.mouse.move(a.x + 20, b.y + 6, { steps: 10 })
  await page.mouse.up()
}

/** 库里已有一条「存成命令」存的（还没当快捷回复） */
const seeded = () =>
  JSON.stringify({
    version: 1,
    own: [{ id: 'own-tidy', name: '整理成通顺笔记', kind: 'ai', target: '1. 把这篇整理成通顺的笔记', rules: [{ t: '把这篇整理成通顺的笔记' }], where: ['doc'], write: 'inplace', desc: '把这篇整理成通顺的笔记，每次先给你看' }],
  }) + '\n'

test('设置 › 回答下面那排：四处的样子（真的 AnswerBar）和默认三颗；功能按钮只列不改；搜「快捷回复」到这一页', async () => {
  const run = await launch({ [NOTE]: '# 学习笔记\n\n一段。\n' }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openReplies(page)
    await expect(dlg(page).getByTestId('settings-head').locator('h2')).toHaveText('回答下面那排')
    expect(await rowsOf(page, '排上')).toEqual(['还是不懂', '换个方式讲', '做个可视化'])
    expect(await rowsOf(page, '收进 ⋯')).toEqual([])
    expect(await rowsOf(page, '不出现')).toEqual([])
    await expect(list(page).getByRole('listitem', { name: '还是不懂' })).toContainText('自带')
    await expect(list(page).getByRole('listitem', { name: '还是不懂' })).toContainText('四处都有')
    await expect(list(page).getByRole('listitem', { name: '做个可视化' })).toContainText('读 PDF · HTML · AI 觉得适合画图时')
    // 四处的样子：读 PDF 三颗，网页、视频、AI 对话前两颗（AI 对话 r100 起也排上）
    await expect(preview(page).getByRole('radio', { name: '读 PDF' })).toHaveAttribute('aria-checked', 'true')
    expect(await previewBtns(page)).toEqual(['拷贝', '插进文档', '还是不懂', '换个方式讲', '做个可视化'])
    await expect(preview(page)).toContainText('这是讲解（第 1 页）')
    await expect(preview(page)).toContainText('⋯ 里：在笔记里看 · 拷贝为 Markdown · 调整这一排… · 存进收件箱')
    await preview(page).getByRole('radio', { name: 'AI 对话' }).click()
    expect(await previewBtns(page)).toEqual(['拷贝', '插进文档', '还是不懂', '换个方式讲'])
    await preview(page).getByRole('radio', { name: '网页' }).click()
    expect(await previewBtns(page)).toEqual(['拷贝', '插进文档', '还是不懂', '换个方式讲'])
    await preview(page).getByRole('radio', { name: '视频' }).click()
    expect(await previewBtns(page)).toEqual(['拷贝', '插进文档', '还是不懂', '换个方式讲'])
    await expect(preview(page)).toContainText('到 AI 对话里接着聊')
    // 功能按钮：三行，标「固定」，没有勾、没有把手
    const fixed = dlg(page).getByRole('list', { name: '功能按钮' })
    await expect(fixed.getByRole('listitem')).toHaveCount(3)
    await expect(fixed.getByRole('listitem')).toContainText(['拷贝', '插进文档', '⋯'])
    await expect(fixed.getByText('固定')).toHaveCount(3)
    await expect(fixed.getByRole('checkbox')).toHaveCount(0)
    // 侧栏搜「快捷回复」：去这一页那张表，闪一下
    const box = dlg(page).getByRole('textbox', { name: '搜设置' })
    await dlg(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '一般' }).click()
    await box.fill('快捷回复')
    await box.press('Enter')
    await expect(dlg(page).getByTestId('settings-head').locator('h2')).toHaveText('回答下面那排')
    await expect(dlg(page).locator('[data-row="replyList"]')).toHaveClass(/sa-flash/)
  } finally {
    await run.close()
  }
})

test('加一颗（例子「考考我」）→ AI 对话那一排多一颗，点它真发出那句；改名改那句、拖着排、收进 ⋯、去掉勾再撤回、复制一份再改、从我的命令里挑、删掉，每步看这一排和命令.json', async () => {
  const run = await launch({ [NOTE]: '# 学习笔记\n\n一段。\n', [CMDS]: seeded() }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    // 右栏拉宽一点：默认两颗加自己的几颗都排得下（窄了多出来的进 ⋯）
    await widenRight(page, 260)
    const a1 = await ask(page, '把这周总结成三句话')
    // AI 对话默认一颗快捷回复也没有
    expect(await rowReplies(a1)).toEqual([])
    // AI 对话默认排上的两颗（r100）
    await expect(a1.getByTestId('ai-ans-acts').locator('[data-reply]')).toHaveText(['还是不懂', '换个方式讲'])
    // ⋯ 最下面「调整这一排…」：开设置 › 回答下面那排，预览先看 AI 对话
    await a1.getByTestId('ai-ans-acts').getByRole('button', { name: '这条回答还能做什么' }).click()
    await page.getByRole('menu', { name: '这条回答还能做什么' }).getByRole('menuitem', { name: '调整这一排…' }).click()
    await expect(list(page)).toBeVisible()
    await expect(preview(page).getByRole('radio', { name: 'AI 对话' })).toHaveAttribute('aria-checked', 'true')

    // ---------- 加一颗：例子「考考我」，⌘↵ 存好
    await dlg(page).getByRole('button', { name: '加一颗' }).click()
    await expect(dlg(page).getByTestId('settings-head').locator('h2')).toHaveText('新的一颗快捷回复')
    await dlg(page).getByRole('button', { name: '考考我' }).click()
    await expect(dlg(page).getByRole('textbox', { name: '名字' })).toHaveValue('考考我')
    await expect(dlg(page).getByRole('textbox', { name: '提示词' })).toHaveValue('就{这条回答}出三道选择题考我，我答完再告诉我对错。')
    // AI 收到的样子：拿示例回答填好空
    await expect(dlg(page).getByTestId('replies-sample')).toContainText('就「这是一条回答：先说结论，再举一个例子……」出三道选择题考我')
    // 插空按钮：光标放在最后点「+ 你问的那句」
    const say = dlg(page).getByRole('textbox', { name: '提示词' })
    await say.click()
    await page.keyboard.press('End')
    await dlg(page).getByRole('button', { name: '你问的那句' }).click()
    await expect(say).toHaveValue('就{这条回答}出三道选择题考我，我答完再告诉我对错。{你问的那句}')
    await say.fill('就{这条回答}出三道选择题考我，我答完再告诉我对错。')
    // 在哪能用默认四处，还有「AI 回答里选中」（回答里选中一句的小菜单，新的默认勾着）；在哪答默认这段对话里
    await expect(dlg(page).getByRole('group', { name: '在哪能用' }).getByRole('button', { pressed: true })).toHaveText(['AI 对话', '读 PDF', '网页', '视频', '回答里选中一句'])
    await expect(dlg(page).getByRole('radiogroup', { name: '在哪答' }).getByRole('radio', { name: '这段对话里' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Meta+Enter')
    await expect(toast(page)).toContainText('「考考我」排在了这一排最后')
    expect(await rowsOf(page, '排上')).toEqual(['还是不懂', '换个方式讲', '做个可视化', '考考我'])
    await expect(list(page).getByRole('listitem', { name: '考考我' })).toContainText('我的')
    await expect(list(page).getByRole('listitem', { name: '考考我' })).toContainText('四处都有')
    await expect.poll(() => cmdsOnDisk(vault).own.find((o) => o.name === '考考我')).toMatchObject({ prompt: '就{这条回答}出三道选择题考我，我答完再告诉我对错。', write: 'answer', where: [], reply: { where: ['chat', 'pdf', 'web', 'video'], out: 'here' } })
    const quiz = cmdsOnDisk(vault).own.find((o) => o.name === '考考我')!.id
    expect(cmdsOnDisk(vault).replies).toEqual({ on: ['still', 'another', 'viz', quiz], more: [], off: [] })
    // 预览 AI 对话：多了它
    expect(await previewBtns(page)).toEqual(['拷贝', '插进文档', '还是不懂', '换个方式讲', '考考我'])

    // ---------- AI 对话那一排多一颗，点它真发出填好的那句
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toBeHidden()
    expect(await rowReplies(a1)).toEqual(['考考我'])
    const answer1 = (await a1.locator('.txt').innerText()).trim()
    await a1.getByTestId('ai-ans-acts').getByRole('button', { name: '考考我' }).click()
    await expect(chat(page).locator('.um')).toHaveCount(2)
    await expect(chat(page).locator('.um').last()).toHaveText(/^就「[\s\S]+」出三道选择题考我，我答完再告诉我对错。$/)
    expect(await chat(page).locator('.um').last().innerText()).toContain(answer1.slice(0, 6))
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })

    // ---------- 改名、改那句（⋯ › 编辑…）
    await openReplies(page)
    await rowMenu(page, '考考我', '编辑…')
    await expect(dlg(page).getByTestId('settings-head').locator('h2')).toHaveText('考考我')
    await dlg(page).getByRole('textbox', { name: '名字' }).fill('小测验')
    await dlg(page).getByRole('textbox', { name: '提示词' }).fill('就{这条回答}出两道题考我')
    await dlg(page).getByRole('button', { name: /^存好/ }).click()
    await expect(toast(page)).toContainText('「小测验」改好了')
    expect(await rowsOf(page, '排上')).toEqual(['还是不懂', '换个方式讲', '做个可视化', '小测验'])
    await expect.poll(() => cmdsOnDisk(vault).own.find((o) => o.id === quiz)).toMatchObject({ name: '小测验', prompt: '就{这条回答}出两道题考我' })

    // ---------- 拖着排：「小测验」拖到「还是不懂」前面
    await dragRow(page, '小测验', '还是不懂')
    await expect(toast(page)).toContainText('「小测验」排在第 1 颗')
    expect(await rowsOf(page, '排上')).toEqual(['小测验', '还是不懂', '换个方式讲', '做个可视化'])
    await expect.poll(() => cmdsOnDisk(vault).replies?.on).toEqual([quiz, 'still', 'another', 'viz'])

    // ---------- 收进 ⋯：AI 对话那一排不排它，⋯ 里有它
    await rowMenu(page, '小测验', '收进 ⋯')
    await expect(toast(page)).toContainText('「小测验」挪到⋯ 里')
    expect(await rowsOf(page, '收进 ⋯')).toEqual(['小测验'])
    await expect.poll(() => cmdsOnDisk(vault).replies?.more).toEqual([quiz])

    // ---------- 去掉勾：「换个方式讲」不出现；读 PDF 的预览少了它；撤回又回来
    await list(page).getByRole('listitem', { name: '换个方式讲' }).getByRole('checkbox').click()
    await expect(toast(page)).toContainText('「换个方式讲」不出现了')
    expect(await rowsOf(page, '不出现')).toEqual(['换个方式讲'])
    await expect.poll(() => cmdsOnDisk(vault).replies?.off).toEqual(['another'])
    await preview(page).getByRole('radio', { name: '读 PDF' }).click()
    expect(await previewBtns(page)).toEqual(['拷贝', '插进文档', '还是不懂', '做个可视化'])
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => rowsOf(page, '排上')).toEqual(['还是不懂', '换个方式讲', '做个可视化'])
    await expect.poll(() => cmdsOnDisk(vault).replies?.off).toEqual([])

    await page.keyboard.press('Escape')
    await expect(dlg(page)).toBeHidden()
    expect(await rowReplies(a1)).toEqual([])
    await a1.getByTestId('ai-ans-acts').getByRole('button', { name: '这条回答还能做什么' }).click()
    const more = page.getByRole('menu', { name: '这条回答还能做什么' })
    await expect(more.getByRole('menuitem', { name: '小测验' })).toBeVisible()
    await page.keyboard.press('Escape')

    // ---------- 自带的：复制一份再改（自带的没有「编辑…」「删掉」）
    await openReplies(page)
    await list(page).getByRole('listitem', { name: '还是不懂' }).getByRole('button', { name: '这一颗还能…' }).click()
    const m = dlg(page).getByRole('menu', { name: '这一颗还能…' })
    await expect(m.getByRole('menuitem', { name: '编辑…' })).toHaveCount(0)
    await expect(m.getByRole('menuitem', { name: /删掉|不当快捷回复了/ })).toHaveCount(0)
    await expect(m.getByRole('menuitem', { name: /设快捷键/ })).toBeDisabled()
    await m.getByRole('menuitem', { name: '复制一份再改…' }).click()
    await expect(dlg(page).getByRole('textbox', { name: '名字' })).toHaveValue('还是不懂')
    await expect(dlg(page).getByRole('textbox', { name: '提示词' })).toHaveValue('还是不懂')
    await expect(dlg(page).getByRole('group', { name: '在哪能用' }).getByRole('button', { pressed: true })).toHaveText(['AI 对话', '读 PDF', '网页', '视频', '回答里选中一句'])
    await dlg(page).getByRole('textbox', { name: '名字' }).fill('再细一点')
    await dlg(page).getByRole('textbox', { name: '提示词' }).fill('还是不懂，再讲细一点')
    await dlg(page).getByRole('button', { name: /^存好/ }).click()
    await expect(toast(page)).toContainText('「再细一点」排在了这一排最后')
    expect(await rowsOf(page, '排上')).toEqual(['还是不懂', '换个方式讲', '做个可视化', '再细一点'])
    await expect.poll(() => cmdsOnDisk(vault).own.find((o) => o.name === '再细一点')?.reply).toEqual({ where: ['chat', 'pdf', 'web', 'video'], out: 'here' })

    // ---------- 从我的命令里挑：「整理成通顺笔记」排到最后；命令原样（规矩、写到哪不动），多了 reply
    await dlg(page).getByRole('button', { name: '从我的命令里挑…' }).click()
    const pick = dlg(page).getByRole('menu', { name: '从我的命令里挑' })
    await expect(pick).toContainText('整理成通顺笔记')
    await expect(pick).toContainText('已在 ⋯ 里')
    await pick.getByRole('button', { name: '放上这一排' }).click()
    await expect(toast(page)).toContainText('「整理成通顺笔记」排在了这一排最后')
    expect(await rowsOf(page, '排上')).toEqual(['还是不懂', '换个方式讲', '做个可视化', '再细一点', '整理成通顺笔记'])
    await expect.poll(() => cmdsOnDisk(vault).own.find((o) => o.id === 'own-tidy')).toMatchObject({ write: 'inplace', where: ['doc'], reply: { where: ['chat'], out: 'here' } })
    expect(cmdsOnDisk(vault).own.find((o) => o.id === 'own-tidy')!.prompt).toBeUndefined()

    // AI 对话那一排：挑来的这颗点了发的是它的规矩
    await page.keyboard.press('Escape')
    expect(await rowReplies(a1)).toEqual(['再细一点', '整理成通顺笔记'])

    // ---------- 删掉：只当快捷回复的连命令删；挑来的只拿掉快捷回复，命令留着
    await openReplies(page)
    await rowMenu(page, '小测验', '删掉')
    await expect(toast(page)).toContainText('已删掉「小测验」')
    expect(await rowsOf(page, '收进 ⋯')).toEqual([])
    await expect.poll(() => cmdsOnDisk(vault).own.some((o) => o.id === quiz)).toBe(false)
    await rowMenu(page, '整理成通顺笔记', '不当快捷回复了')
    await expect(toast(page)).toContainText('「整理成通顺笔记」不当快捷回复了，命令还在')
    await expect.poll(() => cmdsOnDisk(vault).own.find((o) => o.id === 'own-tidy')).toMatchObject({ name: '整理成通顺笔记', where: ['doc'] })
    expect(cmdsOnDisk(vault).own.find((o) => o.id === 'own-tidy')!.reply).toBeUndefined()
    expect(await rowsOf(page, '排上')).toEqual(['还是不懂', '换个方式讲', '做个可视化', '再细一点'])
    await expect.poll(() => [...(cmdsOnDisk(vault).replies?.on ?? []), ...(cmdsOnDisk(vault).replies?.more ?? [])].includes(quiz)).toBe(false)
  } finally {
    await run.close()
  }
})

test('存成快捷回复：AI 对话里悬停你发的那句点「存成快捷回复」、读 PDF 里右键那句，同一张填好的小卡，存好这一排当场多一颗', async () => {
  const run = await launch({ [NOTE]: '# 学习笔记\n\n一段。\n', [PDF]: LECTURE }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await armMenus(run)
    await openNote(page, '学习笔记')
    await openAi(page)
    // 右栏拉宽一点：默认两颗加自己的几颗都排得下（窄了多出来的进 ⋯）
    await widenRight(page, 260)
    const a1 = await ask(page, '举个生活里的例子')
    const um = chat(page).locator('.um-wrap').last()
    // 平时不露，悬停那一句才露：拷贝 · 存成快捷回复
    const acts1 = um.getByTestId('um-acts')
    await page.mouse.move(5, 5)
    await expect(acts1).toHaveCSS('opacity', '0')
    await um.locator('.um').hover()
    await expect(acts1).toHaveCSS('opacity', '1')
    await acts1.getByRole('button', { name: '存成快捷回复' }).click()
    // 填好的小卡：名字取前 6 个字、那句原样、在哪出现勾上 AI 对话
    await expect(card(page)).toBeVisible()
    await expect(card(page).getByRole('textbox', { name: '名字（排上就写这几个字）' })).toHaveValue('举个生活里的')
    await expect(card(page).getByRole('textbox', { name: '点了替你发的那句' })).toHaveValue('举个生活里的例子')
    await expect(card(page).getByRole('group', { name: '在哪出现' }).getByRole('button', { pressed: true })).toHaveText(['AI 对话'])
    await expect(card(page)).toContainText('存好就排在这一排最后')
    // 取消：什么都不存
    await card(page).getByRole('button', { name: '取消' }).click()
    await expect(card(page)).toBeHidden()
    await um.locator('.um').hover()
    await acts1.getByRole('button', { name: '存成快捷回复' }).click()
    await card(page).getByRole('textbox', { name: '名字（排上就写这几个字）' }).fill('举个例子')
    await page.keyboard.press('Meta+Enter')
    await expect(card(page)).toBeHidden()
    await expect(page.getByTestId('toast')).toContainText('「举个例子」排在了这一排最后')
    await expect.poll(() => rowReplies(a1)).toEqual(['举个例子'])
    await expect.poll(() => cmdsOnDisk(vault).own.find((o) => o.name === '举个例子')).toMatchObject({ prompt: '举个生活里的例子', write: 'answer', reply: { where: ['chat'], out: 'here' } })
    // 点它：照样发那句
    await a1.getByTestId('ai-ans-acts').getByRole('button', { name: '举个例子' }).click()
    await expect(chat(page).locator('.um')).toHaveText(['举个生活里的例子', '举个生活里的例子'])
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    // 拷贝：剪贴板里是那一句
    await chat(page).locator('.um').first().hover()
    await chat(page).locator('.um-wrap').first().getByTestId('um-acts').getByRole('button', { name: '拷贝' }).click()
    await expect(chat(page).locator('.um-wrap').first().getByTestId('um-acts').getByRole('button', { name: '已拷贝' })).toBeVisible()

    // ---------- 读 PDF：右键你发的那句 → 存成快捷回复…，小卡勾上的是「读 PDF」
    await page.keyboard.press('Meta+o')
    await page.getByRole('textbox', { name: '按名字跳到文件' }).fill('第3讲')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('第3讲.pdf')
    // AI 开着：右栏换成这份 PDF 的边读边问；没换过来再按 ⌘J
    if (!(await reading(page).waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false))) await page.keyboard.press('Meta+j')
    await expect(reading(page)).toBeVisible()
    await acts(page).getByRole('button', { name: /问这一页/ }).click()
    await expect(reading(page).getByTestId('reading-msg').last().locator('.txt')).toContainText('列就是基向量去哪', { timeout: 20_000 })
    // 等记进笔记（底栏说的那句「记进《…》」先出完，不和下面存快捷回复的那句撞）
    await expect(reading(page).getByTestId('reading-msg').last().getByTestId('ai-noted')).toHaveAttribute('data-state', 'done', { timeout: 20_000 })
    await expect(page.getByTestId('toast')).toContainText('记进《')
    const rum = reading(page).locator('.um-wrap').last()
    // 悬停也有那一小排
    await rum.locator('.um').hover()
    await expect(rum.getByTestId('um-acts')).toHaveCSS('opacity', '1')
    await rum.locator('.um').click({ button: 'right' })
    await pickMenu(run, '存成快捷回复…')
    await expect(card(page)).toBeVisible()
    await expect(card(page).getByRole('textbox', { name: '点了替你发的那句' })).toHaveValue('给我讲解一下这一页')
    await expect(card(page).getByRole('group', { name: '在哪出现' }).getByRole('button', { pressed: true })).toHaveText(['读 PDF'])
    await card(page).getByRole('textbox', { name: '名字（排上就写这几个字）' }).fill('讲这一页')
    await card(page).getByRole('button', { name: /^存好/ }).click()
    await expect(page.getByTestId('toast')).toContainText('「讲这一页」排在了这一排最后')
    await expect.poll(() => cmdsOnDisk(vault).own.find((o) => o.name === '讲这一页')?.reply).toEqual({ where: ['pdf'], out: 'here' })
    // 设置里看读 PDF 那一处：排在最后
    await openReplies(page)
    expect(await rowsOf(page, '排上')).toEqual(['还是不懂', '换个方式讲', '做个可视化', '举个例子', '讲这一页'])
    // 读 PDF 那一处多了它（右栏宽画，放不下的进 ⋯）
    const bar = preview(page).getByTestId('replies-preview-bar')
    expect((await previewBtns(page)).includes('讲这一页') || (await bar.getAttribute('data-spill')) !== null).toBe(true)
    expect((await previewBtns(page)).slice(0, 4)).toEqual(['拷贝', '插进文档', '还是不懂', '换个方式讲'])
  } finally {
    await run.close()
  }
})

test('⌘K 和 / 菜单：快捷回复是一条命令，跑它就是在 AI 对话里发那句（这条回答填的是最新那条）', async () => {
  const cmds =
    JSON.stringify({
      version: 1,
      own: [{ id: 'own-quiz', name: '考考我', kind: 'ai', target: '1. 就{这条回答}出三道选择题考我', rules: [{ t: '就{这条回答}出三道选择题考我' }], prompt: '就{这条回答}出三道选择题考我', where: [], write: 'answer', desc: '就{这条回答}出三道选择题考我', reply: { where: ['chat'], out: 'here' } }],
      replies: { on: ['still', 'another', 'viz', 'own-quiz'], more: [], off: [] },
    }) + '\n'
  const run = await launch({ [NOTE]: '# 学习笔记\n\n一段。\n', [CMDS]: cmds }, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await openNote(page, '学习笔记')
    await openAi(page)
    // 右栏拉宽一点：默认两颗加自己的几颗都排得下（窄了多出来的进 ⋯）
    await widenRight(page, 260)
    const a1 = await ask(page, '把这周总结成三句话')
    const answer1 = (await a1.locator('.txt').innerText()).trim()
    expect(await rowReplies(a1)).toEqual(['考考我'])
    // ⌘K：找得到，提示写「快捷回复 · 那句」；回车跑它
    const pal = page.getByRole('dialog', { name: '搜索和命令' })
    await page.keyboard.press('Meta+k')
    await pal.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('考考我')
    const row = pal.locator('.pal-row').filter({ has: page.locator('.nm', { hasText: /^考考我$/ }) }).first()
    await expect(row).toContainText('快捷回复 · 就{这条回答}出三道选择题考我')
    await row.click()
    await expect(chat(page).locator('.um')).toHaveCount(2)
    await expect(chat(page).locator('.um').last()).toHaveText(/^就「[\s\S]+」出三道选择题考我$/)
    expect(await chat(page).locator('.um').last().innerText()).toContain(answer1.slice(0, 6))
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })
    const a2 = chat(page).getByTestId('ai-msg').last()
    const answer2 = (await a2.locator('.txt').innerText()).trim()
    // / 菜单：「我的命令」里有它，点了发那句（这条回答换成最新那条）
    const box = chat(page).getByRole('textbox', { name: '问 AI' })
    await box.fill('/考考')
    const slash = chat(page).getByRole('listbox', { name: '命令' })
    await expect(slash.getByRole('option', { name: /考考我/ })).toBeVisible()
    await slash.getByRole('option', { name: /考考我/ }).click()
    await expect(chat(page).locator('.um')).toHaveCount(3)
    await expect(chat(page).locator('.um').last()).toHaveText(/^就「[\s\S]+」出三道选择题考我$/)
    expect(await chat(page).locator('.um').last().innerText()).toContain(answer2.slice(0, 6))
    await expect(chat(page).getByRole('button', { name: '发送' })).toBeVisible({ timeout: 30_000 })

    // 设快捷键：⋯ › 设快捷键… 一进来就在按新键；存好记进命令.json 的 keys，表里那一行写着它；关上设置按它照样发那句
    await openReplies(page)
    await rowMenu(page, '考考我', /设快捷键/)
    await expect(dlg(page).getByRole('group', { name: '快捷回复这一颗' }).getByRole('button', { name: '快捷键' })).toHaveText('按下新键…')
    // 全局键要带 ⌘ 或 ⌃（⌥ 加字母会挡着打字）：先按 ⌥Q 说不能用，再按 ⌃⌥Q
    await page.keyboard.press('Alt+q')
    await expect(dlg(page).locator('.sb-clash')).toContainText('「⌥Q」不能用：要带 ⌘ 或 ⌃')
    await dlg(page).getByRole('group', { name: '快捷回复这一颗' }).getByRole('button', { name: '快捷键' }).click()
    await page.keyboard.press('Control+Alt+q')
    await expect(dlg(page).getByRole('group', { name: '快捷回复这一颗' }).getByRole('button', { name: '快捷键' })).toHaveText('⌃⌥Q')
    await dlg(page).getByRole('button', { name: /^存好/ }).click()
    await expect(toast(page)).toContainText('「考考我」改好了')
    await expect(list(page).getByRole('listitem', { name: '考考我' })).toContainText('⌃⌥Q')
    await expect.poll(() => JSON.stringify(cmdsOnDisk(run.vault).keys ?? {})).toContain('own-quiz')
    await page.keyboard.press('Escape')
    await expect(dlg(page)).toBeHidden()
    await chat(page).getByRole('textbox', { name: '问 AI' }).blur()
    await page.keyboard.press('Control+Alt+q')
    await expect(chat(page).locator('.um')).toHaveCount(4)
    await expect(chat(page).locator('.um').last()).toHaveText(/^就「[\s\S]+」出三道选择题考我$/)
  } finally {
    await run.close()
  }
})
