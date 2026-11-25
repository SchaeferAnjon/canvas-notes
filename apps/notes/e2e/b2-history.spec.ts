/**
 * 历史（0.4.2 施工，M1 录屏）：
 * - CN-116 方向 A「藏起来」：只动了软件自己设置的提交不出现，混着的只列自己的文件；⋯ 里关掉开关全部回来（设置提交灰一点、设置文件带齿轮）；
 *   直接修：自动提交的说明不写内部文件（只改了左栏写「改了左栏设置」）。
 * - CN-108 方向 A「放回文件」：右键删掉文件夹那次「把删掉的 N 个文件放回来」、右键被删的一篇「放回这一篇」；之后又改过左栏照样放得回；
 *   提示条「打开文件夹 / 打开」「撤回」；双击被删的一篇说右键能放回。
 * 真点、真右键（系统菜单换成记下来再点，e2e/menu.ts），窗口不上屏。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, leftView, rail, tabOn } from './app'
import { armMenus, enabledOf, menuLabels, openedMenu, pickMenu } from './menu'

const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const treeRow = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
const hist = (page: Page) => page.getByRole('complementary', { name: '历史' })
const commits = (page: Page) => hist(page).getByTestId('history-commit')
const commit = (page: Page, subject: string) => commits(page).filter({ has: page.locator('.subj', { hasText: new RegExp(`^${subject.replace(/[()（）]/g, '.')}$`) }) })
const rows = (page: Page, subject: string) => commit(page, subject).getByRole('listitem')
const toast = (page: Page) => page.getByTestId('toast')
const subjects = (page: Page) => commits(page).locator('.subj').allTextContents()
/** 展开那一次（已经展开着就不再点：再点是收起） */
async function openCommit(page: Page, subject: string) {
  const c = commit(page, subject)
  await expect(c).toBeVisible()
  // 最新的那次读进来就自己展开着（文件列表可能还没画出来）：看 open，不看列表
  if (!/\bopen\b/.test((await c.getAttribute('class')) ?? '')) await c.locator('.ch').click()
  await expect(c).toHaveClass(/\bopen\b/)
}

// 现在的格式（「版本: 2」）：没有版本的老文件读的时候会补上整套顶级分类（shared/left.ts）
const LEFT = JSON.stringify({ 版本: 2, 左边: ['课程', '课程/ecp', '收件箱'], 图标: {} }, null, 2) + '\n'
const files = {
  '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n\n第 27 页。\n',
  '课程/ecp/我的疑惑.md': '# 我的疑惑\n\n为什么用脉冲？\n',
  '课程/ecp/加速器为何又快又省.md': '# 加速器为何又快又省\n',
  '课程/ecp/.首页.json': '{ "style": "a" }\n',
  '收件箱/冰岛行程.md': '# 冰岛行程\n',
  '.canvas-notes/左栏.json': LEFT,
}

test('CN-116 + CN-108：删了课程文件夹、又改了左栏；历史只列自己的文件，⋯ 里能看设置；放回一篇再撤回，整个放回、打开文件夹', async () => {
  const run = await launch(files)
  const { page, vault } = run
  const has = (p: string) => existsSync(join(vault, p))
  try {
    await armMenus(run)
    // 目录树里把 ecp 移到废纸篓（一次提交，里面的首页设置和左栏那一项一起拿掉）
    await leftView(page, '文件')
    if ((await treeRow(page, '课程').getAttribute('aria-expanded')) !== 'true') await treeRow(page, '课程').locator('.ft-tw').click()
    await treeRow(page, 'ecp').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect.poll(() => has('课程/ecp/我的疑惑.md')).toBe(false)
    // 之后又改了左栏（拿下「课程」）：底栏现在提交，说明写人话、不写 .canvas-notes
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '课程', exact: true }).click({ button: 'right' })
    await pickMenu(run, '从左边拿下')
    await expect.poll(() => readFileSync(join(vault, '.canvas-notes/左栏.json'), 'utf8')).not.toContain('"课程",')
    await page.getByTestId('git-changed').click()
    await page.getByRole('dialog', { name: '没提交的改动' }).getByRole('button', { name: '提交' }).click()
    await expect(toast(page)).toHaveText('提交好了：改了左栏设置')

    // ---- CN-116：历史默认不列设置 ----
    await rail(page).getByRole('button', { name: '历史' }).click()
    await expect(commits(page).first()).toBeVisible()
    expect(await subjects(page)).toEqual(['移到废纸篓：课程/ecp（3 个文件）', '样本'])
    await expect(commit(page, '移到废纸篓：课程/ecp（3 个文件）').locator('.when')).toContainText('· 3个文件')
    await openCommit(page, '移到废纸篓：课程/ecp（3 个文件）')
    await expect(rows(page, '移到废纸篓：课程/ecp（3 个文件）')).toHaveText([/课程\/ecp\/Lecture05 笔记\.md/, /课程\/ecp\/加速器为何又快又省\.md/, /课程\/ecp\/我的疑惑\.md/])
    // ⋯ 里关掉开关：设置提交回来（灰、虚线点），设置文件带齿轮
    await hist(page).getByRole('button', { name: '更多' }).click()
    const sw = page.getByRole('dialog', { name: '历史的设置' }).getByRole('menuitemcheckbox', { name: '藏起软件自己的设置文件' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('dialog', { name: '历史的设置' })).toContainText('左栏、首页、置顶这些设置的改动不列出来')
    await sw.click()
    await expect(toast(page)).toHaveText('设置文件也列出来了：多了1次提交')
    await expect.poll(() => subjects(page)).toEqual(['改了左栏设置', '移到废纸篓：课程/ecp（3 个文件）', '样本'])
    await expect(commit(page, '改了左栏设置')).toHaveClass(/\bgear\b/)
    await openCommit(page, '移到废纸篓：课程/ecp（3 个文件）')
    await expect(rows(page, '移到废纸篓：课程/ecp（3 个文件）')).toHaveCount(5)
    // 自己的文件在前，设置文件排在后面
    await expect(rows(page, '移到废纸篓：课程/ecp（3 个文件）')).toHaveText([/Lecture05 笔记/, /加速器为何又快又省/, /我的疑惑/, /\.canvas-notes\/左栏\.json/, /\.首页\.json/])
    await expect(rows(page, '移到废纸篓：课程/ecp（3 个文件）').filter({ hasText: '.canvas-notes/左栏.json' })).toHaveClass(/\bgear\b/)
    await expect(rows(page, '移到废纸篓：课程/ecp（3 个文件）').filter({ hasText: '课程/ecp/.首页.json' })).toHaveClass(/\bgear\b/)
    // 再打开：记住了
    await hist(page).getByRole('button', { name: '更多' }).click()
    await page.getByRole('dialog', { name: '历史的设置' }).getByRole('menuitemcheckbox', { name: '藏起软件自己的设置文件' }).click()
    await expect(toast(page)).toHaveText('藏起了软件自己的设置文件')
    await expect.poll(() => subjects(page)).toEqual(['移到废纸篓：课程/ecp（3 个文件）', '样本'])
    expect(await page.evaluate(() => localStorage.getItem('cn.historyHideInternal'))).toBe('1')

    // ---- CN-108：双击被删的一篇说能放回；右键一篇「放回这一篇」，再撤回 ----
    const del = commit(page, '移到废纸篓：课程/ecp（3 个文件）')
    await openCommit(page, '移到废纸篓：课程/ecp（3 个文件）')
    const doubt = rows(page, '移到废纸篓：课程/ecp（3 个文件）').filter({ hasText: '我的疑惑' })
    await expect(doubt).toHaveClass(/\bgone\b/)
    await doubt.dblclick()
    await expect(toast(page)).toHaveText('这篇已经删了：右键「放回这一篇」')
    // 提示前面一个 info（CN-108 小样）
    await expect(toast(page).locator('.tl-ic')).toHaveCount(1)
    await doubt.click({ button: 'right' })
    const fm = await openedMenu(run)
    expect(menuLabels(fm)).toEqual(['打开', '在新标签打开', '看这一版', '放回这一篇', '在访达中显示', '拷贝路径'])
    expect(enabledOf(fm, '打开')).toBe(false)
    await pickMenu(run, '放回这一篇')
    await expect.poll(() => has('课程/ecp/我的疑惑.md')).toBe(true)
    await expect(toast(page)).toContainText('放回了「我的疑惑」')
    await expect(toast(page).getByRole('button')).toHaveText(['打开', '撤回'])
    // 前面一个绿色对勾（CN-108 小样）
    await expect(toast(page).locator('.tl-ic.ok')).toHaveCount(1)
    await expect(commits(page).first()).toHaveClass(/\bnew\b/)
    await expect(commits(page).first().locator('.subj')).toHaveText('放回：课程/ecp/我的疑惑.md')
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => has('课程/ecp/我的疑惑.md')).toBe(false)
    await expect(toast(page)).toHaveText('撤回了，又回到删掉的样子')

    // ---- 整次放回：之后改过左栏也照样放得回；左栏那一项加回来 ----
    await del.locator('.ch').click({ button: 'right' })
    const cm = await openedMenu(run)
    expect(menuLabels(cm)).toEqual(['看这次改了什么', '把删掉的 3 个文件放回来', '拷贝提交号', '拷贝说明'])
    await pickMenu(run, '把删掉的 3 个文件放回来')
    await expect.poll(() => ['课程/ecp/Lecture05 笔记.md', '课程/ecp/我的疑惑.md', '课程/ecp/加速器为何又快又省.md', '课程/ecp/.首页.json'].every(has)).toBe(true)
    await expect(toast(page)).toContainText('放回了「课程/ecp」里的3个文件')
    await expect(toast(page).getByRole('button')).toHaveText(['打开文件夹', '撤回'])
    await expect(commits(page).first().locator('.subj')).toHaveText('放回：课程/ecp（3 个文件）')
    await expect(commits(page).first()).toHaveClass(/\bnew\b/)
    // 删掉的那次还展开着，里面的文件不再是「不在了」
    await expect(rows(page, '移到废纸篓：课程/ecp（3 个文件）').filter({ hasText: '我的疑惑' })).not.toHaveClass(/\bgone\b/)
    expect(JSON.parse(readFileSync(join(vault, '.canvas-notes/左栏.json'), 'utf8')).左边).toContain('课程/ecp')
    expect(gitStatus(vault)).toBe('')
    // 目录树里放回的文件夹和几篇都亮一圈（约 2 秒）
    await expect(tree(page).locator('.ft-row.ring')).toHaveCount(4)
    await toast(page).getByRole('button', { name: '打开文件夹' }).click()
    await expect(tabOn(page)).toHaveText('ecp')
    // 上一层「课程」的首页：ecp 那张卡写「刚放回」（CN-108 小样）
    await treeRow(page, '课程').click()
    await expect(tabOn(page)).toHaveText('课程')
    await expect(page.getByTestId('folder-content').locator('.fc-fcard', { hasText: 'ecp' }).locator('.fm')).toHaveText('3篇 · 刚放回')
    // 都放回来了：这一项灰掉
    await del.locator('.ch').click({ button: 'right' })
    const again = await openedMenu(run)
    expect(menuLabels(again)).toEqual(['看这次改了什么', '删掉的都已经放回来了', '拷贝提交号', '拷贝说明'])
    expect(enabledOf(again, '删掉的都已经放回来了')).toBe(false)
  } finally {
    await run.close()
  }
})

test('CN-116：只建了空文件夹那次（只有 .gitkeep）列成一行「课程/ecpc/」，文件夹图标；藏不藏设置文件都这样', async () => {
  const run = await launch({ '课程/线性代数/第1讲.md': '# 第1讲\n' })
  const { page, vault } = run
  try {
    mkdirSync(join(vault, '课程/ecpc'), { recursive: true })
    writeFileSync(join(vault, '课程/ecpc/.gitkeep'), '')
    execFileSync('git', ['-C', vault, 'add', '-A'])
    execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', '新建文件夹：课程/ecpc'])
    await rail(page).getByRole('button', { name: '历史' }).click()
    await openCommit(page, '新建文件夹：课程/ecpc')
    const r = rows(page, '新建文件夹：课程/ecpc')
    await expect(r).toHaveCount(1)
    await expect(r.locator('.truncate')).toHaveText('课程/ecpc/')
    await expect(r).toHaveAttribute('data-kind', 'folder')
    // 设置文件也列出来：照样是这一行
    await page.getByRole('complementary', { name: '历史' }).getByRole('button', { name: '更多' }).click()
    await page.getByRole('dialog', { name: '历史的设置' }).getByRole('menuitemcheckbox').click()
    await page.keyboard.press('Escape')
    await openCommit(page, '新建文件夹：课程/ecpc')
    await expect(r).toHaveCount(1)
    await expect(r.locator('.truncate')).toHaveText('课程/ecpc/')
  } finally {
    await run.close()
  }
})

test('画布订阅的记录文件（.canvas-feeds/）也算软件自己的：混着的提交里带齿轮排在后面，只记了订阅的提交灰着；没提交的只有它时写「软件自己的设置」', async () => {
  const run = await launch({ '收件箱/冰岛行程.md': '# 冰岛行程\n' })
  const { page, vault } = run
  const commitAll = (msg: string) => {
    execFileSync('git', ['-C', vault, 'add', '-A'])
    execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', msg])
  }
  try {
    mkdirSync(join(vault, '.canvas-feeds'), { recursive: true })
    writeFileSync(join(vault, '.canvas-feeds/mac-a.jsonl'), '{"seq":1,"op":"read"}\n')
    writeFileSync(join(vault, '收件箱/冰岛行程.md'), '# 冰岛行程\n\n订机票。\n')
    commitAll('改了冰岛行程')
    writeFileSync(join(vault, '.canvas-feeds/mac-a.jsonl'), '{"seq":1,"op":"read"}\n{"seq":2,"op":"star"}\n')
    commitAll('同步了订阅和已读')
    // 没提交的只有订阅记录
    writeFileSync(join(vault, '.canvas-feeds/mac-a.jsonl'), '{"seq":1,"op":"read"}\n{"seq":2,"op":"star"}\n{"seq":3,"op":"read"}\n')
    // 库的监听不看点开头的文件夹：原样再写一遍一篇笔记，让软件重读一次 git 状态（git 里只多了订阅记录）
    writeFileSync(join(vault, '收件箱/冰岛行程.md'), '# 冰岛行程\n\n订机票。\n')
    await rail(page).getByRole('button', { name: '历史' }).click()
    await expect(commits(page).first()).toBeVisible()
    // 默认藏着：只记了订阅的那次不出现，混着的只列自己的
    await expect.poll(() => subjects(page)).toEqual(['改了冰岛行程', '样本'])
    await openCommit(page, '改了冰岛行程')
    await expect(rows(page, '改了冰岛行程')).toHaveText([/收件箱\/冰岛行程\.md/])
    await expect(hist(page).getByTestId('history-pending')).toContainText('软件自己的设置')
    // 设置文件也列出来：订阅记录带齿轮、排在自己的文件后面；只记了订阅的那次灰着
    await hist(page).getByRole('button', { name: '更多' }).click()
    await page.getByRole('dialog', { name: '历史的设置' }).getByRole('menuitemcheckbox', { name: '藏起软件自己的设置文件' }).click()
    await expect(toast(page)).toHaveText('设置文件也列出来了：多了1次提交')
    await expect.poll(() => subjects(page)).toEqual(['同步了订阅和已读', '改了冰岛行程', '样本'])
    await expect(commit(page, '同步了订阅和已读')).toHaveClass(/\bgear\b/)
    await openCommit(page, '改了冰岛行程')
    await expect(rows(page, '改了冰岛行程')).toHaveText([/收件箱\/冰岛行程\.md/, /\.canvas-feeds\/mac-a\.jsonl/])
    await expect(rows(page, '改了冰岛行程').filter({ hasText: '.canvas-feeds/mac-a.jsonl' })).toHaveClass(/\bgear\b/)
    await expect(rows(page, '改了冰岛行程').filter({ hasText: '冰岛行程.md' })).not.toHaveClass(/\bgear\b/)
  } finally {
    await run.close()
  }
})
