// 课程首页、文件夹首页卡里的条目能拖走（task-r00en，用户看「study project 2」课程首页「课件进度」里的 PDF 问「这个pdf能不能拖动到其他的目录?」）：
// 1. 真拖课件封面到左栏文件树的文件夹上：经过的文件夹亮、停 0.6 秒自己展开；松手 = 移过去，PDF 挂着的笔记、可视化一起走，
//    库里的链接改好、一次提交（git log 读说明），底栏「撤回」原样挪回
// 2. 「笔记和导图」里的一篇拖到中间标签条上另一个课程首页的标签上：那个标签亮，松手挪进那门课
// 3. 缩略图右键「移到…」：打字找文件夹的小弹层，回车挪
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gitStatus, launch, leftView, type Running } from './app'
import { lecturePdf } from './fixtures/pdf'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const slidePdf = (title: string) => lecturePdf([{ title, lines: ['Approximate computing trades accuracy for energy.'], image: { x: 320, y: 300, w: 220, h: 160 } }, { title: `${title} (2)`, lines: ['More.'] }])
const NOTE = [
  '# Lecture03 笔记',
  '',
  '## 第 2 页 · 近似计算',
  '[第 2 页](Lecture03.pdf#page=2) · 10:20',
  '',
  '> [!question] 我的疑惑',
  '> 为什么省电',
  '',
  '[完整对话 · 1 轮](../../.canvas-notes/对话/Lecture03-p2-1.md) · [可视化 · 能耗](能耗.html)',
  '',
].join('\n')
const VAULT = {
  '课程/ecp/Lecture03.pdf': slidePdf('Approximate Computing'),
  '课程/ecp/Lecture03 笔记.md': NOTE,
  '课程/ecp/能耗.html': '<html><head><meta name="第几讲" content="3"></head><body>能耗</body></html>\n',
  '课程/ecp/讲义.md': '---\n类型: 笔记\n---\n# 讲义\n\n第一段。\n',
  '.canvas-notes/对话/Lecture03-p2-1.md': '# 完整对话\n\n[回到第 2 页](../../课程/ecp/Lecture03.pdf#page=2)\n',
  '课程/ml/作业/.gitkeep': '',
  '复习.md': '# 复习\n\n[[课程/ecp/Lecture03 笔记]] · [课件](课程/ecp/Lecture03.pdf#page=2) · [[课程/ecp/讲义]]\n',
}

const side = (page: Page) => page.locator('aside.side')
const tree = (page: Page) => side(page).getByRole('tree', { name: '全部文件' })
const row = (page: Page, path: string) => tree(page).locator(`[role="treeitem"][data-path="${path}"]`)
const home = (page: Page) => page.getByTestId('folder-home')
const covers = (page: Page) => home(page).getByTestId('fw-slides').getByTestId('slide-cover')
const toast = (page: Page) => page.locator('.toast-cn')
const lastMsg = (vault: string) => execFileSync('git', ['-C', vault, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).trim()
const commits = (vault: string) => Number(execFileSync('git', ['-C', vault, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim())
const read = (vault: string, p: string) => readFileSync(join(vault, p), 'utf8')

/** 左栏 文件 › 课程 展开 */
async function showCourses(page: Page) {
  await leftView(page, '文件')
  const c = row(page, '课程')
  await expect(c).toBeVisible()
  if ((await c.getAttribute('aria-expanded')) !== 'true') await c.getByRole('button', { name: '展开 课程', exact: true }).click()
  await expect(row(page, '课程/ml')).toBeVisible()
}

/** 点「ecp」开它的首页（课件封面画出来） */
async function openEcp(run: Running) {
  const { page } = run
  await showCourses(page)
  await row(page, '课程/ecp').click()
  await expect(home(page)).toHaveAttribute('data-folder', '课程/ecp')
  await expect(covers(page).first().locator('img')).toBeVisible({ timeout: 15_000 })
}

const center = async (page: Page, sel: ReturnType<Page['locator']>) => {
  const b = (await sel.boundingBox())!
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}
/** 拖着停在一处 ms 毫秒（真鼠标停着时 Chromium 每 50 毫秒发一次 dragover；Playwright 只在鼠标动时送，停着的这段每 60 毫秒挪 1 像素） */
async function dwell(page: Page, at: ReturnType<Page['locator']>, ms: number) {
  const p = await center(page, at)
  await page.mouse.move(p.x, p.y, { steps: 5 })
  for (let t = 0; t < ms; t += 60) {
    await page.waitForTimeout(60)
    await page.mouse.move(p.x + ((t / 60) % 2 ? 1 : 0), p.y)
  }
}

test('课件封面真拖到左栏「ml」：经过亮、停 0.6 秒展开；松手 PDF、笔记、可视化一起过去，链接改好，一次提交；「撤回」原样挪回', async () => {
  const run = await launch(VAULT)
  const { page, vault } = run
  try {
    await openEcp(run)
    await expect(covers(page).locator('.nm .truncate')).toHaveText(['Lecture03'])
    const n0 = commits(vault)
    const ml = row(page, '课程/ml')
    await expect(ml).toHaveAttribute('aria-expanded', 'false')
    // 按住封面拖起来
    const cover = covers(page).first()
    const s = await center(page, cover)
    await page.mouse.move(s.x, s.y)
    await page.mouse.down()
    await page.mouse.move(s.x + 12, s.y + 12, { steps: 4 })
    // 原处变淡；经过「ecp」（本来就在的）不亮
    await expect(cover).toHaveClass(/fw-dragging/)
    await dwell(page, row(page, '课程/ecp'), 180)
    await expect(row(page, '课程/ecp')).not.toHaveClass(/\bdrop\b/)
    // 停在「ml」上：亮；停够 0.6 秒自己展开，露出「作业」
    await dwell(page, ml, 150)
    await expect(ml).toHaveClass(/\bdrop\b/)
    await page.screenshot({ path: 'test-results/r00en-drag-over.png' })
    await dwell(page, ml, 700)
    await expect(ml).toHaveAttribute('aria-expanded', 'true')
    await expect(row(page, '课程/ml/作业')).toBeVisible()
    await dwell(page, ml, 120)
    await page.mouse.up()

    await expect(toast(page)).toContainText('「Lecture03.pdf」和它的笔记、1个可视化挪到了「课程/ml」')
    await expect.poll(() => existsSync(join(vault, '课程/ml/Lecture03.pdf'))).toBe(true)
    for (const p of ['课程/ml/Lecture03 笔记.md', '课程/ml/能耗.html']) expect(existsSync(join(vault, p)), p).toBe(true)
    for (const p of ['课程/ecp/Lecture03.pdf', '课程/ecp/Lecture03 笔记.md', '课程/ecp/能耗.html']) expect(existsSync(join(vault, p)), p).toBe(false)
    // 链接：别处带路径的双链、相对链接、完整对话里的回链都换成新地方；笔记里指 PDF、可视化的照旧（一起挪的）
    expect(read(vault, '复习.md')).toBe('# 复习\n\n[[课程/ml/Lecture03 笔记]] · [课件](课程/ml/Lecture03.pdf#page=2) · [[课程/ecp/讲义]]\n')
    expect(read(vault, '.canvas-notes/对话/Lecture03-p2-1.md')).toContain('(../../课程/ml/Lecture03.pdf#page=2)')
    expect(read(vault, '课程/ml/Lecture03 笔记.md')).toBe(NOTE)
    // 一次提交，说明照实写；git 干净
    await expect.poll(() => commits(vault)).toBe(n0 + 1)
    expect(lastMsg(vault)).toBe('移动：Lecture03.pdf → 课程/ml（连同笔记、1 个可视化）')
    expect(gitStatus(vault)).toBe('')
    // ecp 首页的课件卡空了；左栏 ml 下面多了这份
    await expect(covers(page)).toHaveCount(0)
    await expect(row(page, '课程/ml/Lecture03.pdf')).toBeVisible()

    // 撤回：原样挪回 ecp
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, '课程/ecp/Lecture03.pdf'))).toBe(true)
    expect(existsSync(join(vault, '课程/ecp/Lecture03 笔记.md'))).toBe(true)
    expect(existsSync(join(vault, '课程/ml/能耗.html'))).toBe(false)
    expect(read(vault, '复习.md')).toBe(VAULT['复习.md'])
    await expect(covers(page).locator('.nm .truncate')).toHaveText(['Lecture03'])
    await expect.poll(() => gitStatus(vault)).toBe('')
    expect(commits(vault)).toBe(n0 + 2)
  } finally {
    await run.close()
  }
})

test('「笔记和导图」里的一篇拖到标签条上「ml」首页的标签：那个标签亮，松手挪进 ml；双链跟着改', async () => {
  const run = await launch(VAULT)
  const { page, vault } = run
  try {
    // 先开 ml 的首页（另一个标签），再回到 ecp
    await showCourses(page)
    await row(page, '课程/ml').click()
    await expect(home(page)).toHaveAttribute('data-folder', '课程/ml')
    await openEcp(run)
    const tabs = page.getByTestId('tab-list').getByRole('tab')
    const mlTab = tabs.filter({ hasText: /^ml$/ })
    await expect(mlTab).toHaveCount(1)
    const note = home(page).locator('[data-testid^="fw-"] .fw-row', { hasText: '讲义' }).first()
    await expect(note).toBeVisible()
    const s = await center(page, note)
    // 拖到 ml 标签上又按 esc 取消：标签马上灭，什么都没挪（designer 复审：以前取消后标签一直亮着）
    await page.mouse.move(s.x, s.y)
    await page.mouse.down()
    await page.mouse.move(s.x + 10, s.y + 10, { steps: 4 })
    await dwell(page, mlTab, 200)
    await expect(mlTab).toHaveClass(/\bdrop\b/)
    await page.keyboard.press('Escape')
    await page.mouse.up()
    await expect(mlTab).not.toHaveClass(/\bdrop\b/)
    expect(existsSync(join(vault, '课程/ecp/讲义.md'))).toBe(true)
    await page.mouse.move(s.x, s.y)
    await page.mouse.down()
    await page.mouse.move(s.x + 10, s.y + 10, { steps: 4 })
    // 指到 ecp 自己的标签：不亮；指到 ml 的标签：亮
    await dwell(page, tabs.filter({ hasText: /^ecp$/ }), 150)
    await expect(tabs.filter({ hasText: /^ecp$/ })).not.toHaveClass(/\bdrop\b/)
    await dwell(page, mlTab, 200)
    await expect(mlTab).toHaveClass(/\bdrop\b/)
    await page.screenshot({ path: 'test-results/r00en-drag-tab.png' })
    await page.mouse.up()
    await expect(mlTab).not.toHaveClass(/\bdrop\b/)
    await expect.poll(() => existsSync(join(vault, '课程/ml/讲义.md'))).toBe(true)
    expect(existsSync(join(vault, '课程/ecp/讲义.md'))).toBe(false)
    await expect(toast(page)).toContainText('「讲义」挪到了「课程/ml」')
    await expect.poll(() => read(vault, '复习.md')).toContain('[[课程/ml/讲义]]')
    await expect.poll(() => gitStatus(vault)).toBe('')
  } finally {
    await run.close()
  }
})

test('缩略图右键有「移到…」：打字找文件夹的小弹层，ecp 灰着；打「作业」回车，PDF 连笔记、可视化挪进去', async () => {
  const run = await launch(VAULT)
  const { page, vault } = run
  try {
    await openEcp(run)
    await armMenus(run)
    await covers(page).first().click({ button: 'right' })
    const labels = menuLabels(await openedMenu(run))
    expect(labels).toContain('移到…')
    await pickMenu(run, '移到…')
    const mover = page.getByRole('dialog', { name: '移到' })
    await expect(mover).toBeVisible()
    await expect(mover.locator('.mv-hd')).toHaveText('把「Lecture03.pdf」移到…')
    await expect(mover.getByRole('menuitem', { name: /^ecp/ })).toBeDisabled()
    // 整个弹层在窗口里（封面在中间偏下，下面放不下就往上挪，不被窗口底边切掉）
    const mb = (await mover.boundingBox())!
    const vh = await page.evaluate(() => innerHeight)
    expect(mb.y).toBeGreaterThanOrEqual(0)
    expect(mb.y + mb.height).toBeLessThanOrEqual(vh)
    await page.screenshot({ path: 'test-results/r00en-move-picker.png' })
    await mover.getByRole('searchbox', { name: '挪到哪个文件夹' }).fill('作业')
    await page.keyboard.press('Enter')
    await expect(mover).toHaveCount(0)
    await expect.poll(() => existsSync(join(vault, '课程/ml/作业/Lecture03.pdf'))).toBe(true)
    expect(existsSync(join(vault, '课程/ml/作业/Lecture03 笔记.md'))).toBe(true)
    expect(existsSync(join(vault, '课程/ml/作业/能耗.html'))).toBe(true)
    expect(read(vault, '复习.md')).toContain('[课件](课程/ml/作业/Lecture03.pdf#page=2)')
    await expect.poll(() => gitStatus(vault)).toBe('')
    expect(lastMsg(vault)).toBe('移动：Lecture03.pdf → 课程/ml/作业（连同笔记、1 个可视化）')
  } finally {
    await run.close()
  }
})
