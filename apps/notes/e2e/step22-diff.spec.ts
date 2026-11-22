// 对比标签（录屏 CN-46 / 47 / 48 / 57 / 63，方向 A「对比标签」）：历史里点文件、梦游报告里点一处改动，中间栏开一个像 GitHub 那样的对比标签。
// 两列各有行号、改的行整行着色、没改的折起来能一路展开到整篇；新建的 md 一列全文，新建的 HTML 一行；预览标签斜体、双击固定；
// 窄于 900 自动合一；侧栏只列文件和一句人话；历史面板里没有「打开这篇」，双击打开，右键菜单。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { gitAct, launch, leftView, pane, tabOn, type Running } from './app'
import { DREAM_VAULT } from './fixtures/dream'
import { solidPng } from './fixtures/png'
import { shotTone, shotWindow } from './shots'
import { armMenus, menuLabels, openedMenu, enabledOf, pickMenu } from './menu'

const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })
const hist = (page: Page) => page.getByRole('complementary', { name: '历史' })
const diffTab = (page: Page) => page.locator('[data-testid="diff-tab"]:not([hidden])')


/** 一篇 300 多行的读 PDF 笔记：第 10 页那段改一行，上下都是没改的 */
const PAGES = Array.from({ length: 40 }, (_, i) => `## 第 ${i + 1} 页 · 小标题 ${i + 1}\n第 ${i + 1} 页 · 20:${String(i).padStart(2, '0')}\n\n> [!question] 我的疑惑\n> 第 ${i + 1} 页这里为什么这样？\n\n讲通的讲法：第 ${i + 1} 页这样想就通了。\n`)
const NOTE = ['# Lecture05 笔记', '', ...PAGES].join('\n')
const NOTE_PATH = '课程/ecp/Lecture05 笔记.md'

function prepare(vault: string) {
  const put = (p: string, t: string | Uint8Array) => {
    mkdirSync(dirname(join(vault, p)), { recursive: true })
    writeFileSync(join(vault, p), t)
  }
  put(NOTE_PATH, NOTE)
  put('收件箱/剪藏整页：雷克雅未克.md', '# 剪藏整页：雷克雅未克\n\n雷克雅未克是冰岛的首都。\n')
  git(vault, 'add', '-A')
  git(vault, 'commit', '-qm', '剪藏整页：雷克雅未克')
  // 一次改了三个文件：笔记第 10 页那段末尾加了可视化链接、新建 HTML、一张图
  put(NOTE_PATH, NOTE.replace('讲通的讲法：第 10 页这样想就通了。', '讲通的讲法：第 10 页这样想就通了。\n[可视化 · 高维准正交](高维准正交.html)'))
  put('课程/ecp/高维准正交.html', '<!doctype html><title>高维准正交</title>\n' + '<p>拖动维度看夹角</p>\n'.repeat(450))
  put('附件/image-3.png', solidPng(64, 40, [80, 140, 120]))
  git(vault, 'add', '-A')
  git(vault, 'commit', '-qm', '可视化：高维准正交 · 拖维度看夹角')
  // 剪藏后来挪走了
  mkdirSync(join(vault, '素材/冰岛'), { recursive: true })
  renameSync(join(vault, '收件箱/剪藏整页：雷克雅未克.md'), join(vault, '素材/冰岛/剪藏整页：雷克雅未克.md'))
  git(vault, 'add', '-A')
  git(vault, 'commit', '-qm', '挪走')
  writeFileSync(join(vault, '随手记.md'), '# 随手记\n')
}

/** 历史里某次提交展开，返回它的文件行 */
async function commitFiles(page: Page, subject: string) {
  const c = hist(page).locator('.commit', { hasText: subject })
  if (!(await c.evaluate((el) => el.classList.contains('open')))) await c.locator('.ch').click()
  return c.getByRole('listitem')
}

test('CN-46/47/48 历史：点文件中间开对比标签（并排、两列行号、整行着色、折起的能一路展开到整篇）；新 HTML 一行；预览标签斜体、双击固定；没有「打开这篇」按钮', async () => {
  const run = await launch({ 'a.md': '# a\n' }, {}, prepare)
  const { page, vault } = run
  try {
    await shotTone(page)
    // 左栏收起，中间栏够宽（≥ 900）才并排
    await page.getByRole('button', { name: '收起左栏' }).click()
    await gitAct(page, '历史')
    const rows = await commitFiles(page, '可视化：高维准正交')
    await expect(rows).toHaveText([/课程\/ecp\/Lecture05 笔记\.md\+1$/, /课程\/ecp\/高维准正交\.html\+451$/, /附件\/image-3\.png$/])
    // 侧栏自己不画 diff，也没有「打开这篇」
    await expect(hist(page).getByRole('button', { name: '打开这篇' })).toHaveCount(0)
    await expect(hist(page).locator('.dl, [data-testid="history-diff"]')).toHaveCount(0)

    await rows.filter({ hasText: 'Lecture05 笔记.md' }).click()
    const hash = git(vault, 'log', '-1', '--grep=可视化', '--format=%h').trim()
    await expect(tabOn(page)).toHaveText(`Lecture05 笔记 · ${hash}`)
    await expect(tabOn(page)).toHaveClass(/preview/)
    expect(await tabOn(page).locator('.truncate').evaluate((el) => getComputedStyle(el).fontStyle)).toBe('italic')
    const dv = diffTab(page)
    const md = dv.locator(`[data-file="${NOTE_PATH}"]`)
    await expect(md.locator('.dv-fh')).toContainText('+1 −0')
    await expect(md.locator('.dv-sum')).toHaveText('「第 10 页 · 小标题 10」那段加了链接「可视化 · 高维准正交」')
    // 源码看法、并排：两列各有行号，抬头写清楚哪一版
    await page.getByTestId('tab-acts').getByRole('tab', { name: '源码' }).click()
    await expect(page.getByTestId('tab-acts').getByRole('tab', { name: '并排' })).toHaveAttribute('aria-selected', 'true')
    await expect(md.locator('.dv-cols > span')).toHaveText([/^改之前 · [0-9a-f]{7}$/, `这次提交后 · ${hash}`])
    await expect(md.locator('.cm-mergeViewEditor')).toHaveCount(2)
    await expect(md.locator('.cm-merge-a .cm-lineNumbers .cm-gutterElement').filter({ hasText: /^\d+$/, visible: true }).first()).toBeVisible()
    await expect(md.locator('.cm-merge-b .cm-lineNumbers .cm-gutterElement').filter({ hasText: /^\d+$/, visible: true }).first()).toBeVisible()
    // 改的那行整行淡绿，改的字更深
    const added = md.locator('.cm-merge-b .cm-changedLine', { hasText: '[可视化 · 高维准正交](高维准正交.html)' })
    await expect(added).toHaveCount(1)
    const [lineBg, textBg] = await added.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el.querySelector('.cm-changedText') ?? el).backgroundColor])
    expect(lineBg).not.toBe('rgba(0, 0, 0, 0)')
    expect(textBg).not.toBe(lineBg)
    // 没改的折起来：上面、下面各一条；一直点开，最后整篇都在（两边行数 = 文件行数）
    const folds = md.locator('.cm-merge-b .cm-collapsedLines')
    await expect(folds).toHaveCount(2)
    await expect(folds.first()).toHaveText(/^展开没改的 \d+ 行$/)
    await shotWindow(run, 'cn48-history-split')
    while ((await folds.count()) > 0) await folds.first().click()
    const total = NOTE.split('\n').length + 1
    // 编辑器只画看得见的那几行：滚到这一段的底，看得到最后一行
    await md.locator('.cm-merge-b .cm-content').evaluate((el) => el.scrollIntoView({ block: 'end' }))
    await expect.poll(() => md.locator('.cm-merge-b .cm-lineNumbers .cm-gutterElement').filter({ hasText: /^\d+$/ }).evaluateAll((els) => Math.max(...els.filter((e) => getComputedStyle(e).visibility !== 'hidden').map((e) => Number(e.textContent))))).toBe(total)

    // 新建的 HTML：一行「新文件 · 18 KB · 451 行」，预览、看源码；源码默认收起
    const html = dv.locator('[data-file="课程/ecp/高维准正交.html"]')
    await expect(html.locator('.dv-one .meta')).toHaveText(/^新文件 · \d+ KB · 452行$/)
    await expect(html.locator('.cm-editor')).toHaveCount(0)
    await html.getByRole('button', { name: '看源码' }).click()
    await expect(html.locator('.cm-editor')).toHaveCount(1)
    await html.getByRole('button', { name: '收起源码' }).click()
    // 图片：那一张小图
    await expect(dv.locator('[data-file="附件/image-3.png"] img')).toHaveCount(1)

    // 侧栏点第二个文件：同一个标签，滚到那一段
    await rows.filter({ hasText: '高维准正交.html' }).click()
    await expect(page.locator('[data-testid="diff-tab"]')).toHaveCount(1)
    // 先滚回最上面，再点：滚到 HTML 那一段（它在最后，滚到底也就到了）
    await dv.locator('.dv-body').evaluate((el) => (el.scrollTop = 0))
    await rows.filter({ hasText: 'Lecture05 笔记.md' }).click()
    await rows.filter({ hasText: '高维准正交.html' }).click()
    await expect(html.locator('.dv-fh')).toBeInViewport()
    await expect.poll(() => dv.locator('.dv-body').evaluate((el) => el.scrollTop)).toBeGreaterThan(300)

    // 文档看法：标题画成标题（实时预览），不露 ## 记号
    await page.getByTestId('tab-acts').getByRole('tab', { name: '文档' }).click()
    await expect(md.locator('.dv-diff.doc-look')).toHaveCount(1)
    await dv.locator('.dv-body').evaluate((el) => (el.scrollTop = 0))
    const h11 = md.locator('.cm-merge-b .cm-line', { hasText: '第 11 页 · 小标题 11' }).first()
    await expect(h11).toBeVisible()
    await expect(h11).not.toContainText('##')

    // 双击标签固定；再点别的提交的文件开一个新的预览标签，固定的那个还在
    await tabOn(page).dblclick()
    await expect(tabOn(page)).not.toHaveClass(/preview/)
    const old = await commitFiles(page, '剪藏整页：雷克雅未克')
    await old.filter({ hasText: '雷克雅未克' }).click()
    await expect(page.locator('[data-testid="diff-tab"]')).toHaveCount(2)
    await expect(tabOn(page)).toHaveClass(/preview/)
    // 那篇剪藏现在已经挪走了：照样看得到那一版全文（新建的 md：一列「这一版全文」）
    const clipSec = diffTab(page).locator('[data-file="收件箱/剪藏整页：雷克雅未克.md"]')
    await expect(clipSec.locator('.dv-cols')).toHaveText('这一版全文')
    await expect(clipSec.locator('.cm-content')).toContainText('雷克雅未克是冰岛的首都。')
    await expect(clipSec.getByRole('button', { name: '打开这篇' })).toBeDisabled()
    await shotWindow(run, 'cn47-moved-file')

    // 中间栏窄于 900：自动合一（左栏开回来）
    await page.getByRole('button', { name: '展开左栏' }).click()
    await (await commitFiles(page, '可视化：高维准正交')).filter({ hasText: 'Lecture05 笔记.md' }).click()
    await expect(page.getByTestId('tab-acts').getByRole('tab', { name: '合一' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('tab-acts').getByRole('tab', { name: '并排' })).toBeDisabled()
    await expect(diffTab(page).locator(`[data-file="${NOTE_PATH}"] .cm-mergeViewEditor`)).toHaveCount(0)
    await expect(diffTab(page).locator(`[data-file="${NOTE_PATH}"] .dv-unified .cm-changedLine`).first()).toBeVisible()
  } finally {
    await run.close()
  }
})

test('CN-46 历史文件行：双击打开这篇；右键「打开 · 在新标签打开 · 看这一版 · 在访达中显示 · 拷贝路径」，挪走的只有「看这一版」「拷贝路径」能点', async () => {
  const run = await launch({ 'a.md': '# a\n' }, {}, prepare)
  const { page } = run
  try {
    await armMenus(run)
    await gitAct(page, '历史')
    const rows = await commitFiles(page, '可视化：高维准正交')
    await rows.filter({ hasText: 'Lecture05 笔记.md' }).dblclick()
    await expect(page.locator('.tabs .tab', { hasText: /^Lecture05 笔记$/ })).toHaveAttribute('aria-selected', 'true')

    // 图片：右键「看这一版」能看到那一版的图
    await rows.filter({ hasText: 'image-3.png' }).click({ button: 'right' })
    const m = await openedMenu(run)
    expect(menuLabels(m)).toEqual(['打开', '在新标签打开', '看这一版', '在访达中显示', '拷贝路径'])
    await pickMenu(run, '看这一版')
    await expect(tabOn(page)).toHaveText(/^image-3\.png · [0-9a-f]{7}那一版$/)
    await expect(diffTab(page).locator('.dv-imgs img')).toHaveCount(1)

    // 挪走了的剪藏
    const old = await commitFiles(page, '剪藏整页：雷克雅未克')
    await old.filter({ hasText: '雷克雅未克' }).click({ button: 'right' })
    const m2 = await openedMenu(run)
    for (const l of ['打开', '在新标签打开', '在访达中显示']) expect(enabledOf(m2, l)).toBe(false)
    expect(enabledOf(m2, '看这一版')).toBe(true)
    await pickMenu(run, '看这一版')
    await expect(diffTab(page).locator('.cm-content')).toContainText('雷克雅未克是冰岛的首都。')
  } finally {
    await run.close()
  }
})

test('CN-57/63 + task-m552v 梦游报告：每处改动一行人话（不再铺源码），点了中间开梦游对照：左列「现在的 · main」、右列「收下后」；周记左边写 main 上还没有；可能重复两篇并排', async () => {
  const run = await launch(DREAM_VAULT, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await shotTone(page)
    await leftView(page, '梦游报告')
    const panel = page.getByRole('complementary', { name: '梦游报告' })
    await panel.getByRole('button', { name: '现在梦游' }).click()
    await expect(panel.getByTestId('dream-summary')).toContainText('整理了', { timeout: 30_000 })
    const branch = (await page.evaluate(() => window.cn.dreamReport()))!.branch
    const dt = page.locator('[data-testid="dream-tab"]:not([hidden])')

    await panel.getByTestId('dream-item').filter({ hasText: '↔ [[极光预报]]' }).click()
    const detail = panel.getByTestId('dream-detail')
    const change = detail.getByTestId('dream-change')
    await expect(change.locator('.tx > span')).toHaveText('极光：末尾加了一行 相关：[[极光预报]]')
    await expect(change.locator('.p')).toHaveText('收件箱')
    // 侧栏里没有源码：没有 ---、by: 梦游、加减号
    await expect(detail).not.toContainText('by: 梦游')
    await expect(detail.locator('.dl')).toHaveCount(0)
    await change.click()
    await expect(tabOn(page)).toHaveText('梦游 · 极光')
    await expect(dt.getByTestId('dream-cols')).toHaveText(`现在的 · main收下后 · ${branch}`)
    await expect(page.getByTestId('tab-acts').getByTestId('page-note')).toHaveText('梦游 · 还没收下')
    await shotWindow(run, 'cn57-dream-diff')

    // 周记：新建的 md，左边写 main 上还没有、右边这一版全文（文档样子）
    await panel.getByTestId('dream-item').filter({ hasText: '周记' }).click()
    await expect(detail.getByTestId('dream-change')).toContainText('新建 周记/')
    await detail.getByTestId('dream-change').click()
    await expect(dt.getByTestId('dream-void')).toContainText('main 上还没有这个文件')
    await expect(dt.locator('.cm-line', { hasText: '这周主要在准备冰岛自驾' })).toBeVisible()
    // 换掉的是同一个预览标签
    await expect(page.locator('[data-testid="dream-tab"]')).toHaveCount(1)

    // 可能重复：两篇并排
    await panel.getByTestId('dream-item').filter({ hasText: '相似度' }).click()
    await expect(dt.getByTestId('dream-cols').locator('b')).toHaveText(['巴黎深度漫游指南', '巴黎自由行全景指南'])
    await expect(dt.locator('.dv-mark').first()).toBeVisible()
  } finally {
    await run.close()
  }
})

/** 一篇带一级标题、图、表格的笔记：第二版改了标题、换了图、表格里改了一格 */
const BOOK = '读书/读书笔记.md'
const BOOK_A = '# 读书笔记\n\n第一段正文。\n\n![图](../附件/a.png)\n\n| 写法 | 意思 |\n| --- | --- |\n| x | 标量 |\n'
const BOOK_B = '# 读书笔记（改）\n\n第一段正文。\n\n![图](../附件/b.png)\n\n| 写法 | 意思 |\n| --- | --- |\n| x | 向量 |\n'

test('对比标签照 DESIGN.v3 2.7：图、表格整块碰到改动也整块红绿加竖条，一级标题和正文从同一个位置起，抬头的提交号等宽（task-9womr 设计复审找到的）', async () => {
  const run = await launch({ 'a.md': '# a\n' }, {}, (vault) => {
    mkdirSync(join(vault, '读书'), { recursive: true })
    mkdirSync(join(vault, '附件'), { recursive: true })
    writeFileSync(join(vault, '附件/a.png'), solidPng(64, 40, [80, 140, 120]))
    writeFileSync(join(vault, '附件/b.png'), solidPng(64, 40, [200, 90, 60]))
    writeFileSync(join(vault, BOOK), BOOK_A)
    git(vault, 'add', '-A')
    git(vault, 'commit', '-qm', '读书笔记第一版')
    writeFileSync(join(vault, BOOK), BOOK_B)
    git(vault, 'add', '-A')
    git(vault, 'commit', '-qm', '读书笔记改了表和图')
    // launch 自己还要提交一次「样本」：留一篇没提交的给它
    writeFileSync(join(vault, '随手记.md'), '# 随手记\n')
  })
  const { page, vault } = run
  try {
    await page.getByRole('button', { name: '收起左栏' }).click()
    await gitAct(page, '历史')
    await (await commitFiles(page, '读书笔记改了表和图')).filter({ hasText: '读书笔记.md' }).click()
    const hash = git(vault, 'log', '-1', '--grep=读书笔记改了表和图', '--format=%h').trim()
    const sec = diffTab(page).locator(`[data-file="${BOOK}"]`)
    await expect(sec.locator('.dv-diff.doc-look .cm-mergeViewEditor')).toHaveCount(2)
    // 抬头：提交号是等宽字
    await expect(sec.locator('.dv-cols > span').nth(1).locator('.mono')).toHaveText(hash)
    expect(await sec.locator('.dv-cols > span .mono').first().evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/mono|Menlo|SF Mono/i)
    // 图、表格：左边（改前）整块淡红，右边整块淡绿，左边都有 3px 竖条
    for (const [side, cls] of [['a', 'dv-blk-del'], ['b', 'dv-blk-add']] as const) {
      for (const kind of ['cm-image', 'cm-table']) {
        const el = sec.locator(`.cm-merge-${side} .${kind}`)
        await expect(el).toHaveClass(new RegExp(cls))
        const look = await el.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, bar: getComputedStyle(e, '::before').width }))
        expect(look.bg).not.toBe('rgba(0, 0, 0, 0)')
        expect(look.bar).toBe('3px')
      }
    }
    // 两边的一级标题都和正文从同一个位置起（量第一个字的左边）：左边改掉的标题包在 <del class="cm-deletedLine"> 里，也不往右错
    const glyphLeft = (sel: string, has?: string) =>
      sec
        .locator(sel, has ? { hasText: has } : {})
        .first()
        .evaluate((e) => {
          const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT)
          let n = w.nextNode()
          while (n && !n.textContent!.trim()) n = w.nextNode()
          const r = document.createRange()
          r.selectNodeContents(n!)
          return Math.round(r.getBoundingClientRect().left)
        })
    for (const side of ['a', 'b']) {
      const body = await glyphLeft(`.cm-merge-${side} .cm-line`, '第一段正文。')
      expect(Math.abs((await glyphLeft(`.cm-merge-${side} .cm-line.cm-h1`)) - body)).toBeLessThanOrEqual(1)
    }
    await expect(sec.locator('.cm-merge-a .cm-h1 del.cm-deletedLine')).toHaveCount(1)
    // 合一（左栏开回来，中间窄于 900）：加上的整块淡绿
    await page.getByRole('button', { name: '展开左栏' }).click()
    await (await commitFiles(page, '读书笔记改了表和图')).filter({ hasText: '读书笔记.md' }).click()
    await expect(diffTab(page).locator(`[data-file="${BOOK}"] .dv-unified .cm-table.dv-blk-add`)).toHaveCount(1)
  } finally {
    await run.close()
  }
})
