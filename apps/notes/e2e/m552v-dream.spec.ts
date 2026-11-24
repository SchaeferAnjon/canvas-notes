/**
 * 梦游重新设计（task-m552v，用户点过的 demo /private/tmp/canvas-notes-dream/v2/proto.html）：
 * 现状交付页（/private/tmp/canvas-notes-dream/now/index.html）里标「有问题」的那几样，每样一条，编号对得上：
 * 5 点归类的条目中间不换 · 6「预览」只换树 · 8 默认折起来 · 9 展开要点三下 · 10「打开这篇」不写哪篇 · 11 新建、挪走的灰掉 ·
 * 12 点另一个文件中间不换 · 13「预览可视化」和对比里的「预览」 · 15 收下后跳回第一条 · 18 笔记里的可视化是一行链接 ·
 * 19 PDF 和笔记一行、HTML 和 PDF 平级 · 20 剪藏筛选里有 PDF、HTML · 23 没有整篇和小地图；
 * 另外：J / K / ⌘↵ / ⌘⌫ 只在梦游报告和对照里算、走命令表；历史里看同一个样子；梦游对照里没有「源码」。
 * 2026-11-24 用户定（梦游对比滚动）：对照就用历史那一套（两列行号、没改的折成「展开没改的 N 行」、并排 / 合一），
 * 梦游自己那套整篇并排、收下后的样子、小地图、闪一下去掉；8、9、13、17、23、24 跟着改。
 * 22（「第 3 页」开出空白页）另有 task-j2vv8 在修，这里不测。
 * 样本库照录屏里那份库造（e2e/fixtures/dream2.ts），假 AI 梦游一次 7 条。都是真点，窗口不上屏。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, gitStatus, launch, leftView, tabOn, type Running } from './app'
import { AURORA, DREAM2_VAULT, NOTE, PDF, prepareDream2 } from './fixtures/dream2'

const VIZ = '课程/study project 2/旋转矩阵.html'
const VIZ_TITLE = '旋转矩阵 · 拖动角度看基向量'

/** 跑一次梦游、打开报告 */
async function dreamed(): Promise<{ run: Running; page: Page; panel: Locator }> {
  // 下面单是等梦游跑完就给了 60 秒（假 AI，7 条改动、建分支、一条条提交），和整条测试默认的 60 秒一样长：
  // 机器忙时梦游一慢，后面的步骤就没时间了。整条给梦游那 60 秒再加 60 秒
  test.setTimeout(120_000)
  const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, prepareDream2)
  const { page } = run
  const card = page.getByTestId('dream-card')
  await card.getByRole('button', { name: '现在梦游' }).click()
  await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
  await card.getByRole('button', { name: '看报告' }).click()
  const panel = page.getByRole('complementary', { name: '梦游报告' })
  await expect(panel.getByTestId('dream-item')).toHaveCount(7)
  return { run, page, panel }
}

const item = (panel: Locator, text: string | RegExp) => panel.getByTestId('dream-item').filter({ hasText: text })
/** 中间开着的这一条（梦游对照） */
const dtab = (page: Page) => page.locator('[data-testid="dream-tab"]:not([hidden])')
/** 中间的对照，新旧都认：旧的是对比标签（diff-tab），新的是梦游对照（dream-tab）：先在旧代码上红，红在要改的那一处 */
const center = (page: Page) => page.locator('[data-testid="dream-tab"]:not([hidden]), [data-testid="diff-tab"]:not([hidden])')
/**
 * 点报告里的一条，中间开它；file 给了再点左栏小卡里那个文件的一行。
 * 旧代码点条目中间不换（录屏第 1 条），只有点小卡里的人话行才开对比：这里照旧代码的路也走一遍，好让测试红在要测的那一处
 */
async function openItem(page: Page, panel: Locator, text: string | RegExp, file?: string) {
  await item(panel, text).click()
  const rows = panel.getByTestId('dream-detail').getByTestId('dream-change')
  if (file) await rows.filter({ hasText: file }).click()
  else if (!(await dtab(page).count())) await rows.first().click()
  await expect(center(page)).toBeVisible()
}
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })

test('5 点「归类和改名」的一条：中间像历史那样开这一条（条目头、这条改的每个文件、挪动那一块、对照）', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await item(panel, '原名「极光」').click()
    await expect(tabOn(page)).toContainText('梦游 · 极光 2')
    const t = dtab(page)
    await expect(t.getByTestId('dream-k')).toHaveText('归类和改名 · 第3条，共7条')
    await expect(t.locator('h2')).toHaveText('极光 2')
    await expect(t.getByTestId('dream-why')).toHaveText('都是旅行的事')
    // 这条改了两个文件：挪的那篇、别的笔记里 [[旧名]] 换新名的那篇
    await expect(t.getByTestId('dream-file')).toHaveCount(2)
    await expect(t.getByTestId('dream-file').nth(1)).toContainText('冰岛行程')
    // 挪动和改名单独一块
    const mv = t.getByTestId('dream-move')
    await expect(mv).toContainText('收件箱/')
    await expect(mv.locator('s')).toHaveText('极光')
    await expect(mv).toContainText('剪藏/旅行/')
    await expect(mv.locator('.to')).toHaveText('极光 2')
    // 对照：左「现在的 · main」右「收下后 · dream/…」，标题加的「2」标出来
    await expect(t.locator('.dv-cols')).toContainText('现在的 · main')
    await expect(t.locator('.dv-cols')).toContainText('收下后 · dream/')
    await expect(t.locator('.cm-merge-b .cm-changedText').first()).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('5-file-item.png') })
  } finally {
    await run.close()
  }
})

test('6 归类组头「预览」改叫「在树里看」：左栏换成挪完以后的树，顶上一条「正在看梦游挪完的样子 · 回到报告」，点它或 esc 回到报告', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await panel.getByRole('button', { name: '在树里看' }).click()
    const strip = page.getByTestId('dream-tree-strip')
    await expect(strip).toHaveText(/正在看梦游挪完的样子\s*回到报告/)
    await expect(page.getByRole('complementary', { name: '梦游报告' })).toHaveCount(0)
    await strip.getByRole('button', { name: '回到报告' }).click()
    await expect(page.getByRole('complementary', { name: '梦游报告' })).toBeVisible()
    await page.getByRole('complementary', { name: '梦游报告' }).getByRole('button', { name: '在树里看' }).click()
    await expect(page.getByTestId('dream-tree-strip')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('complementary', { name: '梦游报告' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('8 对照就是历史那一套：两列行号，没改的折成「展开没改的 N 行」，改的那一行在眼前；标签条右端并排 / 合一（不露源码）', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, '↔ [[极光预报]]')
    const t = dtab(page)
    // 末尾加的那一行（前面四十几行没改的折起来了，不用滚就看得见）
    const added = t.locator('.cm-merge-b .cm-changedLine', { hasText: '相关：' })
    await expect(added).toBeInViewport()
    await expect(t.locator('.cm-merge-b .cm-collapsedLines').first()).toHaveText(/^展开没改的 \d+ 行$/)
    await expect(t.locator('.cm-merge-a .cm-lineNumbers').first()).toBeVisible()
    await expect(t.locator('.cm-merge-b .cm-lineNumbers').first()).toBeVisible()
    for (const name of ['并排', '合一']) await expect(acts(page).getByRole('tab', { name })).toBeVisible()
    // 梦游对照不露源码（偏好「只文档白板不露源码」）；梦游自己那套的看法都没了
    for (const name of ['源码', '整篇', '只看改动', '对照', '收下后的样子']) await expect(acts(page).getByRole('tab', { name })).toHaveCount(0)
    await expect(t.getByTestId('dream-minimap')).toHaveCount(0)
    await expect(t.locator('.dv-diff.doc-look')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('8-history-look.png') })
  } finally {
    await run.close()
  }
})

test('9「展开没改的 N 行」点一下就开（以前要连点三下）', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, '↔ [[极光预报]]')
    // 对照是历史那一套：打开就折着
    const t = center(page)
    const folds = t.locator('.cm-merge-b .cm-collapsedLines')
    await t.getByTestId('dream-scroll').evaluate((el) => (el.scrollTop = 0))
    await expect(folds.first()).toBeVisible()
    const n = await folds.count()
    await expect(folds.first()).toHaveText(/^展开没改的 \d+ 行$/)
    // 真点一下（隔 0.4 秒再看）：那一条就没了，里面的字露出来
    await folds.first().click()
    await page.waitForTimeout(400)
    await expect(folds).toHaveCount(n - 1, { timeout: 600 })
    await expect(t.locator('.cm-merge-b .cm-line', { hasText: '视频 · youtube.com' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('9b 历史里的对比标签：「展开没改的 N 行」也是点一下就开（同一个原因：文首的属性表盖住了折叠那段的开头）', async () => {
  const long = '---\nsource: https://example.com/a\n---\n# 长笔记\n\n' + Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 段。`).join('\n\n') + '\n'
  const run = await launch({ '收件箱/长笔记.md': long + '\n末尾加的一句。\n' }, {}, (vault) => {
    writeFileSync(join(vault, '收件箱/长笔记.md'), long)
    execFileSync('git', ['-C', vault, 'add', '-A'])
    execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', '第一版'])
    writeFileSync(join(vault, '收件箱/长笔记.md'), long + '\n末尾加的一句。\n')
  })
  const { page } = run
  try {
    await page.keyboard.press('Meta+y')
    const hist = page.getByRole('complementary', { name: '历史' })
    await hist.getByText('收件箱/长笔记.md').first().click()
    const folds = page.locator('[data-testid="diff-tab"]:not([hidden]) .cm-merge-b .cm-collapsedLines')
    await expect(folds.first()).toBeVisible()
    const n = await folds.count()
    // 真点一下，隔 0.4 秒再看：文首那一段展开了
    await folds.first().click()
    await page.waitForTimeout(400)
    await expect(folds).toHaveCount(n - 1, { timeout: 600 })
    await expect(page.locator('[data-testid="diff-tab"]:not([hidden]) .cm-merge-b .cm-line', { hasText: '第 3 段。' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('10「打开这篇」写明打开哪篇：打开「文件名」，白板加「· 白板」', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, '↔ [[极光预报]]')
    const open = center(page).locator('[data-testid="dream-open"], .dv-fh button:has-text("打开")').first()
    await expect(open).toHaveText('打开「极光」')
    await openItem(page, panel, VIZ_TITLE)
    await expect(dtab(page).getByTestId('dream-open')).toHaveText(/^打开「YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC 笔记」$/)
  } finally {
    await run.close()
  }
})

test('11 新建的、挪走的「打开」不灰：新建的 HTML 开梦游分支上那份；先收下归类再看补双链，开现在那份、写「挪到了旅行」', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, VIZ_TITLE, '旋转矩阵.html')
    // 旧的：HTML 那段文件条上的「打开这篇」灰着
    const open = center(page).locator(`[data-testid="dream-open"], [data-file="${VIZ}"] .dv-fh button:has-text("打开")`).first()
    await expect(open).toBeEnabled()
    await expect(open).toHaveText('打开「旋转矩阵.html」· 梦游分支上的')
    await open.click()
    await expect(acts(page).getByTestId('page-note')).toContainText('梦游做的可视化')
    await expect(page.frameLocator('.htmlpane:not([hidden]) [data-testid="html-frame"]').locator('h1')).toHaveText('第 2 页 · 拖动角度')

    // 先收下归类（收件箱/极光 → 剪藏/旅行/极光 2），再看补双链那条
    await item(panel, '原名「极光」').click()
    await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    await expect(item(panel, '原名「极光」')).toContainText('已收下')
    await item(panel, '↔ [[极光预报]]').click()
    const o2 = dtab(page).getByTestId('dream-open')
    await expect(o2).toHaveText('打开「极光 2」挪到了旅行')
    await expect(o2).toBeEnabled()
    await o2.click()
    await expect(tabOn(page)).toContainText('极光 2')
  } finally {
    await run.close()
  }
})

test('12 一条改了两个文件：点左栏小卡里 HTML 那行、中间的文件条，中间换成那个文件', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, VIZ_TITLE)
    // 左栏小卡里 HTML 那一行
    await panel.getByTestId('dream-detail').getByTestId('dream-change').filter({ hasText: '旋转矩阵.html' }).click()
    const t = dtab(page)
    await expect(t.getByTestId('dream-fbar')).toContainText('旋转矩阵.html')
    await expect(t.getByTestId('dream-file').filter({ hasText: '旋转矩阵.html' })).toHaveAttribute('aria-selected', 'true')
    // 右边就是那张能拖的图；框跟着那一页的高（这一页很矮，取最矮的 140），不截掉一半
    await expect(t.frameLocator('[data-testid="viz-frame"]').locator('h1')).toHaveText('第 2 页 · 拖动角度')
    await expect(t.getByTestId('viz-frame')).toHaveCSS('height', '140px')
    await expect(t.getByTestId('dream-void')).toContainText('main 上还没有这个文件')
    // 中间的文件条：点回笔记
    await t.getByTestId('dream-file').first().click()
    await expect(t.getByTestId('dream-fbar')).toContainText('笔记')
  } finally {
    await run.close()
  }
})

test('13 没有「预览可视化」、没有「收下后的样子」：笔记那边收下后那栏里嵌着的可视化就能拖；HTML 那一格就是能拖的图', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, VIZ_TITLE)
    await expect(page.getByRole('button', { name: '预览可视化' })).toHaveCount(0)
    await expect(center(page).getByRole('button', { name: '预览', exact: true })).toHaveCount(0)
    await expect(acts(page).getByRole('tab', { name: '收下后的样子' })).toHaveCount(0)
    const t = dtab(page)
    // 嵌进来的那一块：收下后那栏改的那几行里，就是梦游分支上那张图
    await expect(t.locator('.cm-merge-b .cm-changedLine').first()).toBeVisible()
    await expect(t.frameLocator('.cm-merge-b .cm-viz iframe').locator('h1')).toHaveText('第 2 页 · 拖动角度')
    await t.getByTestId('dream-file').filter({ hasText: '旋转矩阵.html' }).click()
    await expect(t.locator('[data-testid="viz-frame"]')).toBeVisible()
    await expect(t.frameLocator('[data-testid="viz-frame"]').locator('h1')).toHaveText('第 2 页 · 拖动角度')
  } finally {
    await run.close()
  }
})

test('15 收下后往下走一条（0.7 秒），不跳回第一条；顶上进度一格变绿', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await item(panel, VIZ_TITLE).click()
    await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    await expect(item(panel, VIZ_TITLE)).toContainText('已收下')
    // 下一条没处理的：补双链（第 5 条），不是第 1 条「冰洞」
    await expect(panel.locator('[data-testid="dream-item"].on')).toContainText('↔ [[极光预报]]', { timeout: 3000 })
    await expect(dtab(page).getByTestId('dream-k')).toHaveText('补上的双链 · 第5条，共7条')
    const cells = panel.getByTestId('dream-progress').locator('button')
    await expect(cells).toHaveCount(7)
    await expect(cells.nth(3)).toHaveClass(/taken/)
    await expect(panel.getByTestId('dream-progress')).toContainText('7条 · 看过3 · 收下1 · 丢掉0')
  } finally {
    await run.close()
  }
})

test('15b 收下后 0.7 秒里点了别的（打开这一篇）：留在打开的那篇，不被拉去下一条（真 AI 走一遍时碰到的）', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await item(panel, VIZ_TITLE).click()
    const t = dtab(page)
    await t.getByRole('button', { name: '收下', exact: true }).click()
    // 收下以后马上点「打开「…笔记」」（不等那 0.7 秒）
    await expect(item(panel, VIZ_TITLE)).toContainText('已收下')
    await t.getByTestId('dream-open').click()
    await expect(tabOn(page)).toContainText('笔记')
    await page.waitForTimeout(1200)
    await expect(tabOn(page)).toContainText('笔记')
    await expect(panel.locator('[data-testid="dream-item"].on')).toContainText(VIZ_TITLE)
  } finally {
    await run.close()
  }
})

test('18 收下可视化后打开笔记：可视化是一块嵌着的图（不是一行链接），就地能拖、右上能放大；md 里写成嵌入', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await item(panel, VIZ_TITLE).click()
    await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    await expect(item(panel, VIZ_TITLE)).toContainText('已收下')
    expect(readFileSync(join(run.vault, NOTE), 'utf8')).toContain(`![可视化 · ${VIZ_TITLE}](旋转矩阵.html)`)
    expect(gitStatus(run.vault)).toBe('')
    await item(panel, VIZ_TITLE).click()
    await dtab(page).getByTestId('dream-open').click()
    await expect(tabOn(page)).toContainText('YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC 笔记')
    const viz = page.locator('.pane:not([hidden]) .cm-viz')
    await expect(viz).toBeVisible()
    await expect(viz.locator('.vz-h')).toContainText(`可视化 · ${VIZ_TITLE}`)
    await expect(viz.locator('.vz-badge')).toHaveText('能拖')
    // 框跟着那一页的高（这一页很矮，取最矮的 160）
    await expect(viz.locator('iframe')).toHaveCSS('height', '160px')
    const range = viz.frameLocator('iframe').locator('input[type=range]')
    await range.fill('120')
    await expect(range).toHaveValue('120')
    // 右上放大：中间整页开这个 HTML
    await viz.getByRole('button', { name: '在中间整页打开' }).click()
    await expect(tabOn(page)).toContainText('旋转矩阵')
    // 打开再保存：嵌入那一行原样
    expect(readFileSync(join(run.vault, NOTE), 'utf8')).toContain(`![可视化 · ${VIZ_TITLE}](旋转矩阵.html)`)
  } finally {
    await run.close()
  }
})

test('19 文件树：PDF › 笔记 › 可视化一层挂一层；没收下的可视化淡着写「没收下」，点了开报告里那一条', async () => {
  const { run, page } = await dreamed()
  try {
    await leftView(page, '文件')
    const tree = page.getByRole('tree', { name: '全部文件' })
    const folder = tree.locator('[data-path="课程/study project 2"]')
    if ((await folder.getAttribute('aria-expanded')) !== 'true') await folder.getByRole('button', { name: '展开 study project 2' }).click()
    const pdfRow = tree.locator(`[data-path="${PDF}"]`)
    await expect(pdfRow).toBeVisible()
    const noteRow = tree.locator(`[data-path="${NOTE}"]`)
    await expect(noteRow).toBeVisible()
    await expect(noteRow.locator('.truncate')).toHaveText('笔记')
    await expect(noteRow).toHaveAttribute('title', /YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC 笔记/)
    expect(Number(await noteRow.getAttribute('aria-level'))).toBe(Number(await pdfRow.getAttribute('aria-level')) + 1)
    const viz = tree.locator(`[data-path="${VIZ}"]`)
    await expect(viz).toHaveClass(/ghost/)
    await expect(viz).toContainText('没收下')
    expect(Number(await viz.getAttribute('aria-level'))).toBe(Number(await noteRow.getAttribute('aria-level')) + 1)
    await viz.click()
    await expect(dtab(page).getByTestId('dream-k')).toHaveText('可视化 · 第4条，共7条')
    await page.screenshot({ path: test.info().outputPath('19-tree.png') })
  } finally {
    await run.close()
  }
})

test('20「剪藏」筛选只列真剪下来的：剪藏/ 里的、收件箱里带来源的；PDF、HTML 跟着自己的笔记走，不在这里', async () => {
  const { run, page } = await dreamed()
  try {
    await leftView(page, '文件')
    await page.getByRole('tablist', { name: '类型' }).first().getByRole('tab', { name: '剪藏' }).click()
    const tree = page.getByRole('tree', { name: '全部文件' })
    await expect(tree.locator(`[data-path="${AURORA}"]`)).toBeVisible()
    await expect(tree.locator('[data-path="剪藏/巴黎/巴黎深度漫游指南.md"]')).toBeVisible()
    await expect(tree.locator(`[data-path="${PDF}"]`)).toHaveCount(0)
    await expect(tree.locator('[data-path$=".html"]')).toHaveCount(0)
    await expect(page.getByTestId('clip-rule')).toHaveText('剪藏只列从网页、视频剪下来的；PDF 和梦游做的可视化跟着自己的笔记走，不在这里。')
  } finally {
    await run.close()
  }
})

test('23 上一处 / 下一处：点到最后一处再点，说「后面没有改动了」（长文里一处一处往下跳见 dream-scroll-perf）', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await openItem(page, panel, '原名「极光」')
    const t = dtab(page)
    await expect(t.locator('.cm-merge-b .cm-changedLine').first()).toBeVisible()
    for (let i = 0; i < 10 && !(await page.getByText('后面没有改动了').count()); i++) await acts(page).getByRole('button', { name: '下一处' }).click()
    await expect(page.getByText('后面没有改动了')).toBeVisible()
    await expect(t.locator('.cm-merge-b .cm-changedLine').last()).toBeInViewport()
  } finally {
    await run.close()
  }
})

test('24 设计复审改的几处：条目头第一行 26 高；还没收下的挪动文件条写原名和收件箱；窄于 900 按钮挪到为什么下面、自动合一', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await item(panel, '原名「极光」').click()
    const t = dtab(page)
    await expect(t.getByTestId('dream-move')).toBeVisible()
    // 条目头第一行（第几条 + 上一条 / 下一条）26 高，标题紧跟着
    expect(Math.round((await t.locator('.dt-head .k').boundingBox())!.height)).toBe(26)
    // 还没收下的挪动：文件条写 main 上那份（原名「极光」、收件箱），和「打开「极光」」一致
    await expect(t.getByTestId('dream-fbar').locator('.nm')).toHaveText('极光')
    await expect(t.getByTestId('dream-fbar').locator('.dir')).toHaveText('收件箱')
    await expect(t.getByTestId('dream-open')).toContainText('打开「极光」')

    // 窄窗口（中间窄于 900）：按钮挪到为什么下面
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 768))
    await item(panel, '原名「极光」').click()
    await expect(t).toHaveClass(/\bnarrow\b/)
    const why = (await t.getByTestId('dream-why').boundingBox())!
    const btns = (await t.locator('.dt-head .acts').boundingBox())!
    expect(btns.y).toBeGreaterThan(why.y + why.height - 1)
    await expect(acts(page).getByRole('tab', { name: '合一' })).toHaveAttribute('aria-selected', 'true')
    await expect(t.locator('.dv-diff.dv-unified')).toBeVisible()
  } finally {
    await run.close()
  }
})

for (const frame of ['b', 'a'] as const)
  test(`25 左栏展开的小卡（${frame.toUpperCase()}）：和上下条目同宽、底色和选中那条一样的淡色不是白卡；1024 × 768 窄窗口点最下面那条，收下 / 丢掉整个露着不被底边截掉`, async () => {
    const run = await launch(DREAM2_VAULT, { CN_AI_FAKE: '1' }, (vault) => {
      prepareDream2(vault)
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { frame } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 768))
      const card = page.getByTestId('dream-card')
      await card.getByRole('button', { name: '现在梦游' }).click()
      await expect(card.locator('h3')).toContainText('等你过目', { timeout: 60_000 })
      await card.getByRole('button', { name: '看报告' }).click()
      const panel = page.getByRole('complementary', { name: '梦游报告' })
      // 最下面那条（本周小结）：小卡在列表最底下
      const last = panel.getByTestId('dream-item').filter({ hasText: '周记' })
      await last.click()
      const detail = panel.getByTestId('dream-detail')
      await expect(detail.getByRole('button', { name: '收下', exact: true })).toBeVisible()
      await page.waitForTimeout(400)
      const m = await page.evaluate(() => {
        const box = (e: Element | null) => (e as HTMLElement).getBoundingClientRect()
        const on = document.querySelector('.dream-panel .di.on')!
        const dd = document.querySelector('.dream-panel .dd')!
        const list = document.querySelector('.dream-panel .dlist')!
        const acts = document.querySelector('.dream-panel .dd .pv-acts, .dream-panel .dd .pv-cb')!
        const others = [...document.querySelectorAll('.dream-panel .di:not(.on)')].map((x) => box(x))
        const a = box(acts)
        const l = box(list)
        return {
          left: Math.round(box(dd).left - box(on).left),
          right: Math.round(box(dd).right - box(on).right),
          otherLeft: Math.round(box(dd).left - others[0]!.left),
          bg: getComputedStyle(dd).backgroundColor,
          onBg: getComputedStyle(on).backgroundColor,
          shadow: getComputedStyle(dd).boxShadow,
          actsIn: a.top >= l.top - 0.5 && a.bottom <= l.bottom + 0.5,
          gap: Math.round(box(dd).top - box(on).bottom),
        }
      })
      // 同宽：左右边和选中那条、别的条目对齐，不缩进
      expect(m.left).toBe(0)
      expect(m.right).toBe(0)
      expect(m.otherLeft).toBe(0)
      // 淡底：和选中那条同一个颜色，不是白卡、不浮起来
      expect(m.bg).toBe(m.onBg)
      expect(m.shadow).toBe('none')
      // 和选中那条连成一块
      expect(m.gap).toBe(0)
      // 收下 / 丢掉整个在列表看得见的范围里
      expect(m.actsIn).toBe(true)
      await page.screenshot({ path: test.info().outputPath(`25-card-${frame}.png`) })
    } finally {
      await run.close()
    }
  })

test('快捷键：焦点在梦游报告或对照里时 J / K 换条、⌘↵ 收下、⌘⌫ 丢掉；在命令表里能改', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await item(panel, '原名「冰洞」').click()
    await expect(dtab(page).getByTestId('dream-k')).toHaveText('归类和改名 · 第1条，共7条')
    await page.keyboard.press('j')
    await expect(dtab(page).getByTestId('dream-k')).toHaveText('归类和改名 · 第2条，共7条')
    await page.keyboard.press('k')
    await expect(dtab(page).getByTestId('dream-k')).toHaveText('归类和改名 · 第1条，共7条')
    await page.keyboard.press('Meta+Backspace')
    await expect(item(panel, '原名「冰洞」')).toContainText('已丢掉')
    await expect(dtab(page).getByTestId('dream-k')).toHaveText('归类和改名 · 第2条，共7条', { timeout: 3000 })
    // 焦点在对照里也算
    await dtab(page).getByTestId('dream-scroll').click()
    await page.keyboard.press('Meta+Enter')
    await expect(item(panel, '原名「巴黎自由行全景指南」')).toContainText('已收下')
    // 设置 › 快捷键里有这几条，能改：「梦游：下一条」换成 ⌥⌘G（⌥⌘J 从 task-3e53q 起是「右栏切到这篇的 AI」），J 就不再换条
    await page.keyboard.press('Meta+Comma')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '快捷键', exact: true }).click()
    const row = dlg.locator('[data-row="k-cmd-dream-next"]')
    await expect(row).toContainText('梦游：下一条')
    const keyb = row.getByRole('button', { name: '改 梦游：下一条 的快捷键' })
    // 先按一个撞了的 ⌥⌘J：键位上先写着（待定），Esc 只收撞键那一句、设置还开着，键位回到 J
    await keyb.click()
    await page.keyboard.press('Alt+Meta+j')
    await expect(keyb).toHaveText('⌥⌘J')
    await expect(keyb).toHaveClass(/\bpend\b/)
    await page.keyboard.press('Escape')
    await expect(keyb).not.toHaveClass(/\bpend\b/)
    await expect(keyb).toHaveText('J')
    await expect(dlg).toHaveCount(1)
    await keyb.click()
    await page.keyboard.press('Alt+Meta+g')
    await expect(row.getByRole('button', { name: '改 梦游：下一条 的快捷键' })).toHaveText('⌥⌘G')
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await item(panel, '原名「极光」').click()
    await expect(dtab(page).getByTestId('dream-k')).toHaveText('归类和改名 · 第3条，共7条')
    await page.keyboard.press('j')
    await expect(dtab(page).getByTestId('dream-k')).toHaveText('归类和改名 · 第3条，共7条')
    await page.keyboard.press('Alt+Meta+g')
    await expect(dtab(page).getByTestId('dream-k')).toHaveText('可视化 · 第4条，共7条')
  } finally {
    await run.close()
  }
})

test('17 历史里看收下的那次：和梦游报告里同一个样子，顶上「历史 · …」带「在梦游报告里看这条」；梦游对照里没有「源码」', async () => {
  const { run, page, panel } = await dreamed()
  try {
    await item(panel, VIZ_TITLE).click()
    await expect(acts(page).getByRole('tab', { name: '源码' })).toHaveCount(0)
    await panel.getByTestId('dream-detail').getByRole('button', { name: '收下', exact: true }).click()
    await expect(item(panel, VIZ_TITLE)).toContainText('已收下')
    const head = git(run.vault, 'rev-parse', '--short=7', 'HEAD').trim()
    await page.keyboard.press('Meta+y')
    const hist = page.getByRole('complementary', { name: '历史' })
    await hist.locator('.commit, [data-testid="commit"]').filter({ hasText: '梦游：做了可视化' }).first().click()
    await hist.getByText('YitingWei_2026_C72_BST-GATNet_driver_stress_EMBC 笔记.md').first().click()
    const t = dtab(page)
    await expect(t.getByTestId('dream-hist')).toContainText(`历史 · 梦游：做了可视化「${VIZ_TITLE}」`)
    await expect(t.getByTestId('dream-hist').getByRole('button', { name: '在梦游报告里看这条' })).toBeVisible()
    await expect(t.locator('.dv-cols')).toContainText(`这次提交后 · ${head}`)
  } finally {
    await run.close()
  }
})
