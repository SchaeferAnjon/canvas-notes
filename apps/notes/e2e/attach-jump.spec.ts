// 附件弹层里单击一张图跳到文中用它的那一处（2026-11-23 用户：「属性里点这张图 我希望能跳到文档里对应的位置」）：
// 用了几处就一处一处跳（到最后一处再点回第一处），那张图外圈亮一下；双击放大看图，文中没用到的单击也是；
// 「在访达中显示」挪进右键菜单；白板看法里单击平移到那张卡、外圈闪一下；配对笔记里「我框的」、[!ai] 块里的图也认得出位置。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, pane, type Running } from './app'
import { solidPng } from './fixtures/png'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const NOTE = '课程/ecp/Lecture05 笔记.md'
const OWN = '附件/课程/ecp/Lecture05 笔记'
const CROP = '附件/Lecture05/p28-1.png'
const FIG = '附件/Lecture05/p30-1-fig.png'
const filler = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `${tag}第 ${i + 1} 段：水位一到门槛就发一个 spike，同时把水位减掉一个门槛的量，接着再漏、再积。`).join('\n\n')

function vault(): Record<string, string | Buffer> {
  const text = [
    '---',
    '类型: 笔记',
    '来源: "[[Lecture05.pdf]]"',
    '---',
    '',
    '# Lecture05 笔记',
    '',
    '## 第 28 页 · LIF 神经元的三条公式',
    '[第 28 页](Lecture05.pdf#page=28&rect=0.06,0.3,0.89,0.6) · 20:21 <!-- cn:thread=Lecture05-p28-1 -->',
    '',
    '![我框的|268](../../附件/Lecture05/p28-1.png)',
    '',
    '> [!question] 给我讲解一下',
    '',
    filler(14, '一'),
    '',
    '## 第 30 页 · 再看一遍',
    '',
    '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了第 30 页',
    '> 换个看法，先看这张：',
    '> ![第 30 页的图](../../附件/Lecture05/p30-1-fig.png)',
    '>',
    '> - 要点一',
    '',
    filler(14, '二'),
    '',
    '## 第 32 页 · 回头看',
    '',
    '![我框的|268](../../附件/Lecture05/p28-1.png)',
    '',
    filler(6, '三'),
    '',
  ].join('\n')
  return {
    [NOTE]: text,
    [CROP]: solidPng(268, 120, [60, 140, 200]),
    [FIG]: solidPng(200, 140, [200, 120, 60]),
    ...Object.fromEntries([1, 2, 3, 4].map((i) => [`${OWN}/没用到 ${i}.png`, solidPng(180, 120, [90, 150 + i * 20, 110])])),
  }
}

const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen)
const SHOTS = '/private/tmp/canvas-notes-visual/83-附件点图跳文中'
async function shot(run: Running, name: string) {
  if (!process.env.CN_SHOTS) return
  await run.page.waitForTimeout(250)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(b64, 'base64'))
}
const settings = (v: string) => {
  const ud = join(dirname(v), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
}

/** 打开属性 › 全部 6 张 */
async function openGrid(page: Page) {
  await acts(page).getByRole('button', { name: '属性' }).click()
  await page.getByRole('dialog', { name: '属性' }).getByRole('region', { name: '附件' }).getByRole('button', { name: /全部 6 张/ }).click()
  const grid = page.getByRole('dialog', { name: '附件' })
  await expect(grid.locator('.pa-cell')).toHaveCount(6)
  return grid
}
/** 中间栏里看得见的那一块（弹层下沿到窗口下沿）里有没有这个元素 */
async function below(page: Page, el: import('@playwright/test').Locator) {
  const pop = await page.getByRole('dialog', { name: '附件' }).boundingBox()
  const r = await el.boundingBox()
  const port = await pane(page).locator('.cm-editor').evaluate((e) => {
    let s: HTMLElement | null = e as HTMLElement
    while (s && !(['auto', 'scroll'].includes(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight)) s = s.parentElement
    const b = (s ?? document.body).getBoundingClientRect()
    return { top: b.top, bottom: b.bottom }
  })
  return !!pop && !!r && r.y >= pop.y + pop.height && r.y + r.height <= port.bottom + 1
}
/** 弹层盖不全：左边露出一截，或整个在弹层下面 */
async function seen(page: Page, el: import('@playwright/test').Locator) {
  const pop = (await page.getByRole('dialog', { name: '附件' }).boundingBox())!
  const r = await el.boundingBox()
  return !!r && (r.x < pop.x - 40 || r.y >= pop.y + pop.height) && r.y >= 0
}
const flashTop = (page: Page) => pane(page).locator('.cm-flashbar:not([hidden])').evaluate((b) => b.getBoundingClientRect().top)

test('附件弹层里单击一张图：跳到文中第一处、再点跳第二处、再点回第一处，图外圈亮一下、滚到弹层下面；双击先跳再放大看图；[!ai] 块里的图那一行闪；没用到的单击看大图；右键在访达中显示；白板看法平移到那张卡', async () => {
  const run = await launch(vault(), {}, settings)
  const { page, vault: v } = run
  try {
    await armMenus(run)
    await page.locator('.nav .si').filter({ hasText: 'Lecture05 笔记' }).first().click()
    await expect(pane(page).locator('.cm-content')).toBeVisible()
    const grid = await openGrid(page)
    const cells = grid.locator('.pa-cell')
    await expect(cells.locator('.n')).toHaveText(['p28-1.png', 'p30-1-fig.png', '没用到 · 没用到 1.png', '没用到 · 没用到 2.png', '没用到 · 没用到 3.png', '没用到 · 没用到 4.png'])
    await expect(grid.locator('.pa-foot')).toHaveText('单击跳到文中那一处 · 双击放大 · 右键更多')
    // 用了两处的角上写「2 处」
    await expect(cells.nth(0).locator('.uses')).toHaveText('2处')
    await expect(cells.nth(1).locator('.uses')).toHaveCount(0)

    const crop = pane(page).locator('.cm-content .cm-image img[src$="p28-1.png"]')
    const h28 = pane(page).locator('.cm-line', { hasText: '第 28 页 · LIF 神经元的三条公式' })
    const h32 = pane(page).locator('.cm-line', { hasText: '第 32 页 · 回头看' })
    // 先滚到最底下，第一处不在眼前
    await pane(page).locator('.cm-content').evaluate((e) => {
      let s: HTMLElement | null = e as HTMLElement
      while (s && !(['auto', 'scroll'].includes(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight)) s = s.parentElement
      s!.scrollTop = s!.scrollHeight
    })
    await expect(h28).toHaveCount(0)
    // 单击：第一处（第 28 页那张「我框的」）
    await cells.nth(0).click()
    await expect(cells.nth(0).locator('.uses')).toHaveText('1/2')
    await expect(h28).toBeVisible()
    const flown = pane(page).locator('.cm-image img.flown')
    await expect(flown).toHaveCount(1)
    // 第一处在文档最上面，滚不到弹层下面：左半露在弹层外面
    await expect.poll(() => seen(page, flown)).toBe(true)
    // 画成图的只亮外圈，不闪左边那道「刚插进来」的竖线
    await expect(pane(page).locator('.cm-flashbar:not([hidden])')).toHaveCount(0)
    // 没用到的缩略图 2px 黄框
    expect(await cells.nth(2).locator('img').evaluate((i) => getComputedStyle(i).boxShadow)).toMatch(/0px 0px 0px 2px$/)
    await shot(run, '1-单击跳到第一处')
    // 网格还开着；再点：第二处（第 32 页）
    await cells.nth(0).click()
    await expect(cells.nth(0).locator('.uses')).toHaveText('2/2')
    await expect(h32).toBeVisible()
    await expect.poll(() => below(page, pane(page).locator('.cm-image img.flown'))).toBe(true)
    await shot(run, '1b-再点跳第二处')
    // 到最后一处再点回第一处
    await cells.nth(0).click()
    await expect(cells.nth(0).locator('.uses')).toHaveText('1/2')
    await expect.poll(() => seen(page, pane(page).locator('.cm-image img.flown'))).toBe(true)
    await expect(h28).toBeVisible()
    // 双击：第一下照单击先跳（往下走一处），第二下放大看图（用户「单击跳到位置 双击放大打开」）
    await cells.nth(0).dblclick()
    await expect(cells.nth(0).locator('.uses')).toHaveText('2/2')
    const big = page.getByRole('dialog', { name: '看大图' })
    await expect(big).toBeVisible()
    await expect(big.locator('img')).toHaveAttribute('src', /p28-1\.png$/)
    await expect(big).toContainText('p28-1.png')
    await expect(big).toContainText('第 28 页 · LIF 神经元的三条公式')
    // 放大：小截图（268 宽）也撑到刚好放下
    await expect.poll(async () => (await big.locator('img').boundingBox())?.width ?? 0).toBeGreaterThan(600)
    await shot(run, '1c-双击放大')
    await page.keyboard.press('Escape')
    await expect(big).toHaveCount(0)
    await expect(grid).toBeVisible()
    await expect(h32).toBeVisible()
    expect(await crop.count()).toBeGreaterThan(0)

    // [!ai] 块里的图（画成原文）：滚到那一行、那一行左边闪
    await cells.nth(1).click()
    const aiLine = pane(page).locator('.cm-line.cm-callout-ai', { hasText: '![第 30 页的图]' })
    await expect.poll(() => below(page, aiLine)).toBe(true)
    await expect.poll(async () => Math.abs((await flashTop(page)) - (await aiLine.boundingBox())!.y)).toBeLessThan(6)

    // 没用到的：单击看大图；点空白收起，网格还开着
    await cells.nth(2).click()
    await expect(big).toBeVisible()
    await expect(big.locator('img')).toHaveAttribute('src', /%E6%B2%A1%E7%94%A8%E5%88%B0%201\.png$/)
    await expect(big).toContainText('没用到 1.png')
    await shot(run, '2-没用到的看大图')
    await page.mouse.click(10, 10)
    await expect(big).toHaveCount(0)
    await expect(grid).toBeVisible()
    // Esc 先收大图，再按才收弹层
    await cells.nth(2).click()
    await expect(big).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(big).toHaveCount(0)
    await expect(grid).toBeVisible()

    // 右键：在访达中显示（测试模式记下来，不真开访达）
    await cells.nth(0).click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['在访达中显示', '拷贝图片', '拷贝路径', '移到废纸篓'])
    await pickMenu(run, '在访达中显示')
    await expect.poll(() => screen(run)).toContain(`在访达中显示 ${join(v, CROP)}`)

    // 白板看法：单击平移到装着那张图的卡、外圈闪一下
    await page.keyboard.press('Escape')
    await expect(grid).toHaveCount(0)
    await acts(page).getByRole('tab', { name: '白板' }).click()
    await expect(pane(page).getByTestId('doc-board')).toBeVisible()
    const g2 = await openGrid(page)
    await g2.locator('.pa-cell').nth(1).click()
    const card = pane(page).locator('.db-card.flown')
    await expect(card).toHaveCount(1)
    await expect(card).toContainText('先看这张')
    await expect(card).toBeInViewport()
    // 还在白板看法
    await expect(acts(page).getByRole('tab', { name: '白板' })).toHaveAttribute('aria-selected', 'true')
    await shot(run, '3-白板看法平移到那张卡')
  } finally {
    await run.close()
  }
})
