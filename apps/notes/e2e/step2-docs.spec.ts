import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { editorText, gitStatus, launch, openNote, pane, shownText, waitSaved, acts, tabOn, gitAct, openInboxTab } from './app'

const bar = (page: Page) => page.getByRole('contentinfo')
const toast = (page: Page) => page.locator('.toast-cn')

test('新建笔记：点加号、起名字、打字，左栏和磁盘上都有；改名时第一行标题跟着改', async () => {
  const run = await launch({ '旧的.md': '旧\n' })
  const { page, vault } = run
  try {
    await page.locator('.nav').hover()
    await page.locator('.nav').getByRole('button', { name: '新建笔记' }).click()
    const name = page.getByRole('textbox', { name: '笔记名字' })
    await expect(name).toBeFocused()
    await page.keyboard.type('冰岛自驾')
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText('冰岛自驾')
    await expect(page.locator('.tab.on')).toContainText('冰岛自驾')
    // 新建的笔记第一行是「# 未命名」，起了名字跟着改；光标停在标题下面
    await page.keyboard.type('先订 2.27 的住处。')
    await waitSaved(page)
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toBe('# 冰岛自驾\n\n先订 2.27 的住处。')
    expect(existsSync(join(vault, '未命名.md'))).toBe(false)
    await expect(page.locator('.nav .si', { hasText: '冰岛自驾' })).toBeVisible()
    await expect(bar(page).getByTestId('git-changed')).toContainText('1 处没提交')

    // 再双击标签改一次名
    await tabOn(page).dblclick()
    await page.keyboard.type('冰岛自驾攻略')
    await page.keyboard.press('Enter')
    await expect(page.locator('.nav .si', { hasText: '冰岛自驾攻略' })).toBeVisible()
    expect(existsSync(join(vault, '冰岛自驾攻略.md'))).toBe(true)
    // 改名后接着打字，写进新文件
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await page.keyboard.type('再订车。')
    await waitSaved(page)
    expect(readFileSync(join(vault, '冰岛自驾攻略.md'), 'utf8')).toBe('# 冰岛自驾攻略\n\n先订 2.27 的住处。再订车。')
    expect(existsSync(join(vault, '冰岛自驾.md'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('文档模式藏起 md 记号，源文件显示原文；⌘ 点双链打开那篇', async () => {
  const md = '# 所思所想\n\n**财富**靠专长，见 [[工作流]]。\n\n> 引文\n> —— [标题](https://nav.al/rich)\n\n最后一行\n'
  const run = await launch({ '所思所想.md': md, '工作流.md': '# 工作流\n' })
  const { page, vault } = run
  try {
    await openNote(page, '所思所想')
    await pane(page).locator('.cm-line', { hasText: '最后一行' }).click()
    const shown = await shownText(page)
    expect(shown).toContain('财富靠专长，见 工作流。')
    expect(shown).toContain('—— 标题')
    expect(shown).not.toContain('**')
    expect(shown).not.toContain('https://')
    await expect(pane(page).locator('.cm-h1')).toHaveText('所思所想')
    // 打开时什么记号都不露；光标点进加粗的那几个字，只露这一处的记号（小一号、淡色），同一行别的不露
    await expect(pane(page).locator('.cm-mdmark')).toHaveCount(0)
    await pane(page).locator('.cm-strong', { hasText: '财富' }).click()
    await expect(pane(page).locator('.cm-line', { hasText: '财富' }).locator('.cm-mdmark')).toHaveText(['**', '**'])
    await expect(pane(page).locator('.cm-line', { hasText: '财富' })).toContainText('**财富**')
    // 源文件就是原文
    expect(await editorText(page)).toBe(md)
    await acts(page).getByRole('tab', { name: '源文件' }).click()
    await expect(pane(page).locator('.cm-wikilink')).toHaveCount(0)
    await acts(page).getByRole('tab', { name: '文档' }).click()
    // ⌘ 点双链
    await pane(page).locator('.cm-line', { hasText: '最后一行' }).click()
    await pane(page).locator('.cm-wikilink').click({ modifiers: ['Meta'] })
    await expect(tabOn(page)).toHaveText('工作流')
    await expect(page.locator('.tab')).toHaveCount(3) // 首页 + 两篇
    // 什么都没改，文件和 Git 都干净
    await page.waitForTimeout(1000)
    expect(gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('多个标签：各自保存，来回切不串；⌘W 关标签', async () => {
  const run = await launch({ '甲.md': '甲\n', '乙.md': '乙\n' })
  const { page, vault } = run
  try {
    await openNote(page, '甲')
    await page.keyboard.press('Meta+End')
    await page.keyboard.type('在甲里打的')
    await openNote(page, '乙')
    await page.keyboard.press('Meta+End')
    await page.keyboard.type('在乙里打的')
    await page.locator('.tab', { hasText: '甲' }).locator('.tl').click()
    await expect(tabOn(page)).toHaveText('甲')
    await waitSaved(page)
    expect(readFileSync(join(vault, '甲.md'), 'utf8')).toBe('甲\n在甲里打的')
    await expect.poll(() => readFileSync(join(vault, '乙.md'), 'utf8')).toBe('乙\n在乙里打的')
    await page.keyboard.press('Meta+w')
    await expect(page.locator('.tab')).toHaveCount(2) // 首页 + 乙
    await expect(tabOn(page)).toHaveText('乙')
  } finally {
    await run.close()
  }
})

test('收件箱：速记一句回车，进收件箱文件夹，计数加一，点开是那篇', async () => {
  const run = await launch({ '甲.md': '甲\n' })
  const { page, vault } = run
  try {
    await openInboxTab(page)
    await expect(page.getByTestId('inbox-count')).toHaveCount(0)
    await pane(page).getByLabel('速记').fill('周末看一下 Raycast 的 AI 命令')
    await page.keyboard.press('Enter')
    await expect(pane(page).getByLabel('速记')).toHaveValue('')
    await expect(pane(page).locator('.lcard')).toHaveCount(1)
    await expect(pane(page).locator('.lcard')).toContainText('周末看一下 Raycast 的 AI 命令')
    await expect(page.getByTestId('inbox-count')).toHaveText('1')
    const file = join(vault, '收件箱', '周末看一下 Raycast 的 AI 命令.md')
    expect(readFileSync(file, 'utf8')).toMatch(/^---\ncreated: \d{4}-\d\d-\d\d \d\d:\d\d\n---\n周末看一下 Raycast 的 AI 命令\n$/)
    await pane(page).locator('.lcard').click()
    await expect(tabOn(page)).toHaveText('周末看一下 Raycast 的 AI 命令')
  } finally {
    await run.close()
  }
})

test('Git 底栏：看改了哪些文件、提交、本周加一、历史里看这次提交改了哪些文件', async () => {
  const run = await launch({ '甲.md': '甲\n' })
  const { page, vault } = run
  try {
    await expect(bar(page).getByTestId('week-commits')).toHaveText('本周 1 次提交')
    await expect(bar(page).getByTestId('git-changed')).toHaveText('都提交了')
    await openNote(page, '甲')
    await page.keyboard.press('Meta+End')
    await page.keyboard.type('加一行')
    await waitSaved(page)
    await expect(bar(page).getByTestId('git-changed')).toHaveText('1 处没提交')
    await bar(page).getByTestId('git-changed').click()
    await expect(page.getByRole('dialog', { name: '没提交的改动' })).toContainText('甲.md')
    await page.keyboard.press('Escape')
    await tabOn(page).click()

    await gitAct(page, '提交')
    await expect(toast(page)).toContainText('提交好了：更新 1 个文件：甲')
    await expect(bar(page).getByTestId('git-changed')).toHaveText('都提交了')
    await expect(bar(page).getByTestId('week-commits')).toHaveText('本周 2 次提交')
    expect(gitStatus(vault)).toBe('')
    expect(execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()).toBe('更新 1 个文件：甲')

    await gitAct(page, '历史')
    const hist = page.getByRole('complementary', { name: '历史' })
    await expect(hist.locator('.commit')).toHaveCount(2)
    await expect(hist.locator('.commit').first()).toContainText('更新 1 个文件：甲')
    await expect(hist.locator('.commit.open .fr')).toContainText('甲.md')
    await expect(hist.locator('.commit.open .fr .add')).toHaveText('+1')
    // 右栏开着时中间栏还在，宽度够写字
    const box = await page.locator('.center').boundingBox()
    expect(box!.width).toBeGreaterThan(600)
    await hist.getByRole('button', { name: '关上历史' }).click()
    await expect(hist).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('同步：没有远程时说清楚；有远程时拉下另一台电脑的改动，正在写的字不丢', async () => {
  const BASE = '# 旅行\n\n第一段。\n\n第二段。\n'
  const run = await launch({ '旅行.md': BASE })
  const { page, vault } = run
  try {
    await gitAct(page, '同步')
    await expect(toast(page)).toContainText('还没有远程仓库')

    // 建一个远程，另一台电脑（other）克隆后改了第二段推上去
    const bare = join(vault, '..', 'remote.git')
    const other = join(vault, '..', 'other')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
    execFileSync('git', ['-C', vault, 'remote', 'add', 'origin', bare])
    execFileSync('git', ['-C', vault, 'push', '-q', '-u', 'origin', 'main'])
    execFileSync('git', ['clone', '-q', bare, other])
    writeFileSync(join(other, '旅行.md'), BASE.replace('第二段。', '第二段，另一台电脑写的。'))
    execFileSync('git', ['-C', other, '-c', 'user.name=T', '-c', 'user.email=t@example.com', 'commit', '-qam', '另一台'])
    execFileSync('git', ['-C', other, 'push', '-q'])

    await openNote(page, '旅行')
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('本机正在写')
    await waitSaved(page)
    await gitAct(page, '同步')
    await expect(toast(page)).toContainText('拉下 1 次提交')
    await expect(toast(page)).toContainText('推上去了')
    await expect.poll(() => editorText(page)).toContain('第二段，另一台电脑写的。')
    expect(await editorText(page)).toContain('第一段。本机正在写')
    expect(readFileSync(join(vault, '旅行.md'), 'utf8')).toBe('# 旅行\n\n第一段。本机正在写\n\n第二段，另一台电脑写的。\n')
    expect(gitStatus(vault)).toBe('')
    execFileSync('git', ['-C', other, 'pull', '-q'])
    expect(readFileSync(join(other, '旅行.md'), 'utf8')).toBe('# 旅行\n\n第一段。本机正在写\n\n第二段，另一台电脑写的。\n')
  } finally {
    await run.close()
  }
})
