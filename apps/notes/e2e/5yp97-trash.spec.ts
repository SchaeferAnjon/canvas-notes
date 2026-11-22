// 左栏文件树最底下「最近删掉的」，只列 30 天（task-5yp97；用户看了 /private/tmp/canvas-notes-visual/06-文件管理/2-30天-浅.png
// 说「这个最近删除倒是可以加上」，偏好「最近删掉的列 30 天」）。从 Git 历史读、不另存一份：
// 一行写名字、原来在哪、什么时候删的；指着出「看一看」「放回」；点一条右边是删掉前的样子（只能看）；「放回」回到原来的文件夹，
// 一次提交，底栏能撤回；挪动、改名不算删；31 天前删的不列；刚删的（还没提交）也在，写「刚才」。
// 一律无头（CN_E2E=1），「废纸篓」是测试的临时文件夹。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, tabOn } from './app'
import { armMenus, pickMenu } from './menu'
import { solidPng } from './fixtures/png'

const DAY = 86400_000
const git = (vault: string, args: string[], at?: number) =>
  execFileSync('git', ['-C', vault, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...(at ? { GIT_AUTHOR_DATE: new Date(at).toISOString(), GIT_COMMITTER_DATE: new Date(at).toISOString() } : {}) },
  }).trim()
const put = (vault: string, path: string, text: string) => {
  mkdirSync(dirname(join(vault, path)), { recursive: true })
  writeFileSync(join(vault, path), text)
}

const PLAN = '# 旧的读书计划\n\n今年想读完的书：\n\n1. 《巴菲特传》，每周两章，周日写一段读后感。\n2. 《杀死一只知更鸟》，配着电影一起看。\n'
const ICE = '---\ntype: board\ncolor: "#C9853A"\n---\n# 冰岛行程 第一版\n\n## 第一天\n\n雷克雅未克。\n'

/** 样本库的历史：40 天前建好；31 天前删一篇（不该列）；5 天前删一块白板、3 天前删一篇（该列）；2 天前挪走一篇、改名一篇（不算删） */
function history(vault: string) {
  const now = Date.now()
  put(vault, '旧东西/很早删的.md', '# 很早删的\n\n一个多月前就删了。\n')
  put(vault, '写作/旧的读书计划.md', PLAN)
  put(vault, '项目/冰岛行程 第一版.md', ICE)
  put(vault, '收件箱/挪走的.md', '# 挪走的\n\n只是换了个文件夹。\n')
  put(vault, '写作/改名前.md', '# 改名前\n\n只是改了个名字，正文一个字没动。\n')
  git(vault, ['add', '旧东西', '写作', '项目', '收件箱/挪走的.md'])
  git(vault, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '建好'], now - 40 * DAY)
  git(vault, ['rm', '-q', '旧东西/很早删的.md'])
  git(vault, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '删除 很早删的'], now - 31 * DAY)
  git(vault, ['rm', '-q', '项目/冰岛行程 第一版.md'])
  git(vault, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '删除 冰岛行程'], now - 5 * DAY)
  git(vault, ['rm', '-q', '写作/旧的读书计划.md'])
  git(vault, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '删除 旧的读书计划'], now - 3 * DAY)
  git(vault, ['mv', '收件箱/挪走的.md', '写作/挪走的.md'])
  git(vault, ['mv', '写作/改名前.md', '写作/改名后.md'])
  git(vault, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', '挪动和改名'], now - 2 * DAY)
}

const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const trashRow = (page: Page) => tree(page).getByRole('button', { name: /^最近删掉的/ })
const page$ = (page: Page) => page.getByTestId('trash-page')
const rows = (page: Page) => page$(page).getByRole('list', { name: '最近删掉的' }).getByRole('listitem')
const toast = (page: Page) => page.locator('footer, .status')

test('「最近删掉的」：树最底下一行带数；30 天里删的都列（刚删的写「刚才」），31 天前的、挪动改名的不列；看一看是删掉前的样子（只能看）；放回回到原来的文件夹、一次提交、底栏撤回', async () => {
  test.setTimeout(150_000)
  const run = await launch({ '收件箱/草稿 2.md': '# 草稿 2\n\n还没想好写什么。\n', '写作/日记.md': '# 日记\n\n今天。\n' }, {}, history)
  const { page, vault } = run
  const count = () => Number(git(vault, ['rev-list', '--count', 'HEAD']))
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).click()
    // 树最底下一行：30 天里删了 2 篇
    await expect(trashRow(page)).toBeVisible()
    await expect(trashRow(page).locator('.ft-count')).toHaveText('2')

    // 在树里删一篇（右键「移到废纸篓」，还没提交）：马上算进来，写「刚才」
    await armMenus(run)
    const draft = tree(page).getByRole('treeitem', { name: /^草稿 2/ })
    if (!(await draft.isVisible())) await tree(page).getByRole('button', { name: '展开 收件箱' }).click()
    await draft.click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await expect.poll(() => existsSync(join(vault, '收件箱/草稿 2.md'))).toBe(false)
    await expect(trashRow(page).locator('.ft-count')).toHaveText('3')

    // 点那一行：中间开「最近删掉的」，新的在前；挪动、改名、31 天前删的都不在
    await trashRow(page).click()
    await expect(tabOn(page)).toHaveText('最近删掉的')
    await expect(page$(page).getByRole('heading', { name: '最近删掉的' })).toBeVisible()
    await expect(page$(page).locator('.tr-sub')).toHaveText('30天里删掉的3篇。放回去还在原来的文件夹；更早删掉的去「历史」里找。')
    await expect(rows(page).locator('.nm')).toHaveText(['草稿 2', '旧的读书计划', '冰岛行程 第一版'])
    await expect(rows(page).locator('.where')).toHaveText(['原来在「收件箱」', '原来在「写作」', '原来在「项目」'])
    await expect(rows(page).first().locator('.when')).toHaveText('刚才')
    await expect(rows(page).nth(1).locator('.when')).not.toHaveText('刚才')
    await expect(page$(page)).not.toContainText('很早删的')
    await expect(page$(page)).not.toContainText('挪走的')
    await expect(page$(page)).not.toContainText('改名前')
    // 白板画它自己的颜色方块
    await expect(rows(page).nth(2).locator('.sw')).toHaveCSS('background-color', 'rgb(201, 133, 58)')
    await expect(page$(page).locator('.tr-foot')).toHaveText('到了30天自己从这里拿掉，文件还在Git历史里。')

    // 指着一行：出「看一看」「放回」；看一看：右边是删掉前的样子，只能看
    const plan = rows(page).nth(1)
    await expect(plan.getByRole('button', { name: '看一看' })).toBeHidden()
    await plan.hover()
    await expect(plan.getByRole('button', { name: '看一看' })).toBeVisible()
    await expect(plan.getByRole('button', { name: '放回' })).toBeVisible()
    await plan.getByRole('button', { name: '看一看' }).click()
    const prev = page$(page).getByRole('region', { name: '删掉前的样子' })
    await expect(prev.locator('.tr-bar .t')).toContainText('「旧的读书计划」删掉前的样子 ·')
    await expect(prev.locator('.tr-bar .t')).toContainText('删的 · 只能看，不能改')
    await expect(prev.getByRole('heading', { name: '旧的读书计划' })).toBeVisible()
    await expect(prev).toContainText('《巴菲特传》，每周两章，周日写一段读后感。')
    await expect(prev.locator('[contenteditable="true"], textarea, input')).toHaveCount(0)
    await expect(plan).toHaveClass(/\bon\b/)
    // 点一条（不用按钮）也一样
    await rows(page).nth(2).click()
    await expect(prev.locator('.tr-bar .t')).toContainText('「冰岛行程 第一版」删掉前的样子')
    await rows(page).nth(1).click()

    // 放回「写作」：文件回到原来的文件夹、内容一个字不差，一次提交；这一行不在了，树里数字少一
    const before = count()
    await prev.getByRole('button', { name: '放回「写作」' }).click()
    await expect.poll(() => existsSync(join(vault, '写作/旧的读书计划.md'))).toBe(true)
    expect(readFileSync(join(vault, '写作/旧的读书计划.md'), 'utf8')).toBe(PLAN)
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toBe('放回：写作/旧的读书计划.md')
    expect(count()).toBe(before + 1)
    await expect(toast(page).getByText('「旧的读书计划」放回了「写作」')).toBeVisible()
    await expect(rows(page).locator('.nm')).toHaveText(['草稿 2', '冰岛行程 第一版'])
    await expect(trashRow(page).locator('.ft-count')).toHaveText('2')
    // 底栏撤回：又回到删掉的样子，这一行回来
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, '写作/旧的读书计划.md'))).toBe(false)
    await expect(rows(page).locator('.nm')).toHaveText(['草稿 2', '旧的读书计划', '冰岛行程 第一版'])

    // 刚删的那篇（还没提交）也能放回：先记下删掉的那一次，再放回，照样一次「放回」提交
    const draftRow = rows(page).first()
    await draftRow.hover()
    await draftRow.getByRole('button', { name: '放回' }).click()
    await expect.poll(() => existsSync(join(vault, '收件箱/草稿 2.md'))).toBe(true)
    expect(readFileSync(join(vault, '收件箱/草稿 2.md'), 'utf8')).toBe('# 草稿 2\n\n还没想好写什么。\n')
    await expect.poll(() => git(vault, ['log', '-2', '--format=%s'])).toMatch(/^放回：收件箱\/草稿 2\.md\n.*草稿 2/)
    await expect(rows(page).locator('.nm')).toHaveText(['旧的读书计划', '冰岛行程 第一版'])
    await expect(trashRow(page).locator('.ft-count')).toHaveText('2')
  } finally {
    await run.close()
  }
})

test('删笔记连着删掉的图不单列，跟着那一篇（「和1张图」）；放回时一起回来', async () => {
  test.setTimeout(120_000)
  const run = await launch({ '收件箱/有图的一篇.md': '# 有图的一篇\n\n看这张：\n\n![](../附件/收件箱/有图的一篇/截图 1.png)\n', '附件/收件箱/有图的一篇/截图 1.png': solidPng(60, 40, [200, 80, 40]) })
  const { page, vault } = run
  try {
    await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '文件', exact: true }).click()
    await armMenus(run)
    const note = tree(page).getByRole('treeitem', { name: /^有图的一篇/ })
    if (!(await note.isVisible())) await tree(page).getByRole('button', { name: '展开 收件箱' }).click()
    await note.click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    const dlg = page.getByRole('dialog', { name: '把《有图的一篇》移到废纸篓？' })
    await expect(dlg.locator('.t1')).toHaveText('连同1张图一起移到废纸篓')
    await dlg.getByRole('button', { name: '移到废纸篓' }).click()
    await expect.poll(() => existsSync(join(vault, '附件/收件箱/有图的一篇/截图 1.png'))).toBe(false)
    await expect(trashRow(page).locator('.ft-count')).toHaveText('1')
    await trashRow(page).click()
    await expect(rows(page).locator('.nm')).toHaveText(['有图的一篇'])
    await expect(rows(page).locator('.imgs')).toHaveText('和1张图')
    await rows(page).first().hover()
    await rows(page).first().getByRole('button', { name: '放回' }).click()
    await expect.poll(() => existsSync(join(vault, '收件箱/有图的一篇.md'))).toBe(true)
    expect(existsSync(join(vault, '附件/收件箱/有图的一篇/截图 1.png'))).toBe(true)
    await expect(toast(page).getByText('「有图的一篇」放回了「收件箱」，连同1张图')).toBeVisible()
    await expect.poll(() => git(vault, ['log', '-1', '--format=%s'])).toMatch(/^放回：/)
    expect(git(vault, ['show', '--name-only', '--format=', 'HEAD']).split('\n').sort()).toEqual(['收件箱/有图的一篇.md', '附件/收件箱/有图的一篇/截图 1.png'].sort())
    await expect(rows(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})
