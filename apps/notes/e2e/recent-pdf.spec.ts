/**
 * 左栏「最近」也列 PDF、网页（2026-11-24 用户「在这个最近文档里面 我发现不能显示PDF」「网页也放进去」）：
 * 打开一篇 PDF → 「最近」第一条是它，带 PDF 小标和问到第几页，配对笔记并进这一条（右边「笔记」小字，点它开笔记）；
 * 筛「PDF」只剩 PDF；右栏开两个网页 → 「最近」里有这两条，筛「网页」只剩它们，点一条在右栏重开，右键去掉一条，
 * 设置 › 网页和视频 关掉「记下看过的网页」后不再记。都是真点。截图：CN_SHOTS=目录 时存一张薄荷的。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { launch, leftView, rail, tabOn } from './app'
import { lecturePdf } from './fixtures/pdf'
import { armMenus, openedMenu, pickMenu } from './menu'

let server: Server
let base: string
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const name = decodeURIComponent(req.url ?? '/').slice(1)
    res.end(`<title>${name}</title><body><h1>${name}</h1></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const PDF = '课程/c72/YitingWei_2026_C72_BST-GATNet_driver_stress.pdf'
const NOTE = '课程/c72/YitingWei_2026_C72_BST-GATNet_driver_stress 笔记.md'
const pdf = lecturePdf(Array.from({ length: 7 }, (_, i) => ({ title: `GATNet page ${i + 1}`, lines: ['Graph attention for driver stress.'] })))
const FILES = {
  [PDF]: pdf,
  [NOTE]: '---\n进度: 2/7\n---\n# YitingWei_2026_C72_BST-GATNet_driver_stress 笔记\n\n第 2 页：注意力怎么算。\n',
  '学习笔记.md': '# 学习笔记\n\n今天读了一篇。\n',
  '预算.md': '---\ntype: board\n---\n# 预算\n',
}

const side = (page: Page) => page.locator('aside.side')
const rows = (page: Page) => side(page).locator('.nav .si:not(.s-fold)')
const chips = (page: Page) => side(page).locator('.side-chips .chip').allInnerTexts()
const chip = (page: Page, name: string) => side(page).locator('.side-chips').getByRole('tab', { name, exact: true })
const web = (page: Page) => page.getByRole('complementary', { name: '网页' })

async function start(shots?: string) {
  const run = await launch(FILES, {}, (vault) => {
    if (!shots) return
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b', winBg: 'wall', wallMix: 'mid', wallMove: false } }))
  })
  await armMenus(run)
  return run
}

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('YitingWei_2026_C72_BST-GATNet_driver_stress')
  await page.locator('.pal-row', { hasText: 'YitingWei_2026_C72_BST-GATNet_driver_stress.pdf' }).first().click()
  await expect(tabOn(page)).toHaveText('YitingWei_2026_C72_BST-GATNet_driver_stress.pdf')
}

async function openWeb(page: Page, path: string) {
  if (!(await web(page).isVisible())) await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.click()
  await addr.fill(`${base}/${path}`)
  await addr.press('Enter')
  await expect(web(page).locator('webview.on')).toBeVisible()
  await expect.poll(() => web(page).locator('webview.on').evaluate((w) => (w as unknown as { getTitle(): string }).getTitle())).toBe(path)
}

test('打开 PDF：「最近」第一条是它，带 PDF 小标和 2/7，配对笔记并进这一条；点「笔记」开笔记；筛「PDF」只剩它', async () => {
  const run = await start()
  const { page } = run
  try {
    await leftView(page, '最近')
    // 还没开过 PDF：笔记照旧单列，顶上没有「PDF」那颗
    await expect(rows(page).filter({ hasText: 'YitingWei_2026_C72_BST-GATNet_driver_stress 笔记' })).toHaveCount(1)
    expect(await chips(page)).not.toContain('PDF')

    await openPdf(page)
    const first = rows(page).first()
    await expect(first).toHaveAttribute('data-kind', 'pdf')
    await expect(first.locator('.s-title')).toHaveText('YitingWei_2026_C72_BST-GATNet_driver_stress')
    // 默认栏宽 248：名字一行占满，至少露 12 个字（类型、页数、时间、「笔记」在第二行）
    expect(await side(page).evaluate((e) => Math.round(e.getBoundingClientRect().width))).toBeLessThanOrEqual(248)
    const fit = await first.locator('.s-title').evaluate((el) => {
      const r = document.createRange()
      r.setStart(el.firstChild!, 0)
      r.setEnd(el.firstChild!, 12)
      return { shown: el.clientWidth, twelve: r.getBoundingClientRect().width }
    })
    expect(fit.shown).toBeGreaterThanOrEqual(fit.twelve)
    await expect(first.locator('.s-sub')).toContainText(/^PDF·2\/7·\d\d:\d\d笔记$/)
    await expect(first.locator('.s-kind')).toHaveText(/^PDF/)
    await expect(first.locator('.s-prog')).toHaveText('2/7')
    await expect(first.locator('.s-note')).toHaveText('笔记')
    // 笔记那一行并进来了，不再单列
    await expect(rows(page).filter({ hasText: 'YitingWei_2026_C72_BST-GATNet_driver_stress 笔记' })).toHaveCount(0)
    await expect(first).toHaveClass(/\bon\b/)

    // 点「笔记」小字：开配对笔记
    await first.locator('.s-note').click()
    await expect(tabOn(page)).toHaveText('YitingWei_2026_C72_BST-GATNet_driver_stress 笔记')
    // 点 PDF 那一行本身：回到 PDF
    await rows(page).first().locator('.s-main').click()
    await expect(tabOn(page)).toHaveText('YitingWei_2026_C72_BST-GATNet_driver_stress.pdf')

    // 筛「PDF」：只剩 PDF
    expect(await chips(page)).toEqual(['全部', '文档', '白板', 'PDF'])
    await chip(page, 'PDF').click()
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toHaveAttribute('data-kind', 'pdf')
    await chip(page, '全部').click()
    await expect(rows(page)).toHaveCount(3)
    // 文件树里没有「PDF」那颗，选着它时文件树当「全部」
    await chip(page, 'PDF').click()
    await leftView(page, '文件')
    expect(await side(page).locator('.side-chips .chip').allInnerTexts()).toEqual(['全部', '文档', '白板', '剪藏', '附件'])
    await expect(side(page).getByRole('tab', { name: '全部', exact: true })).toHaveAttribute('aria-selected', 'true')
    await leftView(page, '最近')
    await chip(page, '全部').click()

    // 中间的「最近」页也有这一条
    await side(page).getByRole('button', { name: '在中间打开' }).click()
    const center = page.getByTestId('recent-page')
    await expect(center.locator('.rp-rec[data-kind="pdf"] .rp-kind')).toHaveText('PDF')
    await center.locator('.rp-rec[data-kind="pdf"] .rp-note').click()
    await expect(tabOn(page)).toHaveText('YitingWei_2026_C72_BST-GATNet_driver_stress 笔记')
  } finally {
    await run.close()
  }
})

test('右栏开两个网页：「最近」里有这两条、筛「网页」只剩它们、点一条在右栏重开、右键去掉一条；设置里关掉后不再记', async () => {
  const run = await start(process.env.CN_SHOTS)
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await leftView(page, '最近')
    await openWeb(page, '动手学深度学习')
    await openWeb(page, 'Graph Attention Networks')
    await expect(side(page).locator('.nav .s-rec[data-kind="web"] .s-title')).toHaveText(['Graph Attention Networks', '动手学深度学习'])
    await expect(side(page).locator('.nav .s-rec[data-kind="web"] .s-host').first()).toHaveText("127.0.0.1")
    await expect(side(page).locator('.nav .s-rec[data-kind="web"] .s-kind').first()).toHaveText('网页')

    // 也开一篇 PDF，截图里三类都有
    await openPdf(page)
    expect(await chips(page)).toEqual(['全部', '文档', '白板', 'PDF', '网页'])
    if (process.env.CN_SHOTS) {
      mkdirSync(process.env.CN_SHOTS, { recursive: true })
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(process.env.CN_SHOTS, '最近-全部.png') })
      // 用户截图里左栏约 360 宽：拖宽了再截一张（域名这时露出来）
      const sep = (await page.getByRole('separator', { name: '拖动调整左栏宽度' }).boundingBox())!
      await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
      await page.mouse.down()
      await page.mouse.move(sep.x + sep.width / 2 + 112, sep.y + 300, { steps: 6 })
      await page.mouse.up()
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(process.env.CN_SHOTS, '最近-全部-宽栏.png') })
    }

    // 筛「网页」：只剩这两条
    await chip(page, '网页').click()
    await expect(rows(page)).toHaveCount(2)
    if (process.env.CN_SHOTS) await page.screenshot({ path: join(process.env.CN_SHOTS, '最近-网页.png') })

    // 点「动手学深度学习」：右栏开回这一页
    await side(page).locator('.nav .s-rec[data-kind="web"]', { hasText: '动手学深度学习' }).locator('.s-main').click()
    await expect.poll(() => web(page).locator('webview.on').evaluate((w) => (w as unknown as { getURL(): string }).getURL())).toBe(`${base}/${encodeURI('动手学深度学习')}`)

    // 右键「从最近里去掉」：少一条
    await side(page).locator('.nav .s-rec[data-kind="web"]', { hasText: 'Graph Attention Networks' }).click({ button: 'right' })
    await openedMenu(run)
    await pickMenu(run, '从最近里去掉')
    await expect(side(page).locator('.nav .s-rec[data-kind="web"]')).toHaveCount(1)
    await expect(side(page).locator('.nav .s-rec[data-kind="web"]')).toContainText('动手学深度学习')

    // 设置 › 网页和视频：关掉「记下看过的网页」：「最近」里不列，再开网页也不记
    await page.keyboard.press('Meta+,')
    const dlg = page.getByRole('dialog', { name: '设置' })
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '网页和视频', exact: true }).click()
    const sw = dlg.locator('[data-row="keepRecent"]').getByRole('switch')
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await page.keyboard.press('Escape')
    await expect(side(page).locator('.nav .s-rec[data-kind="web"]')).toHaveCount(0)
    await openWeb(page, '关掉以后看的')
    // 打开回来：只有关之前记的那一条，关着时看的没记
    await page.keyboard.press('Meta+,')
    await dlg.getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '网页和视频', exact: true }).click()
    await dlg.locator('[data-row="keepRecent"]').getByRole('switch').click()
    await page.keyboard.press('Escape')
    await chip(page, '全部').click()
    await expect(side(page).locator('.nav .s-rec[data-kind="web"]')).toHaveCount(1)
    await expect(side(page).locator('.nav .s-rec[data-kind="web"]')).toContainText('动手学深度学习')
  } finally {
    await run.close()
  }
})
