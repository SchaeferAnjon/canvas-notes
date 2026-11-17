/**
 * PDF 精读增强（MinerU）：用假的 mineru-kit（e2e/fixtures/fake-mineru-kit.sh，输出固定的 middle.json）和假的 uv，
 * 「~」是临时目录（CN_MINERU_HOME），不碰本机真的 ~/.mineru-venv。
 * 测：没装时工具条下面的提示（安装 / 不再提示 / 许可证）、找到即用不提示、pdf.js 的块先出后台换成 MinerU 的（表格画成表、公式渲染、图注跟图）、
 * 失败退回和「重试」、装的进度。
 */
import { expect, type Page, test } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acts, launch, type Running, tabOn } from './app'
import { ROTATION } from './fixtures/pdf'
import { shotPart, shotTone, shotWindow } from './shots'

const PDF = '课程/线性代数/第3讲 线性映射.pdf'
const files = { [PDF]: ROTATION }
const FIX = join(__dirname, 'fixtures')

/** 和 ROTATION 这份 PDF 对得上的 middle_json（MinerU 4.x 的样子）：第 2 页有公式、表格、图和图注 */
const W = 612
const H = 792
const box = (x0: number, y0: number, x1: number, y1: number) => [x0 / W, y0 / H, x1 / W, y1 / H].map((v) => Math.round(v * 1000) / 1000)
const MIDDLE = {
  schema: 'docvortex.middle',
  schema_version: '2.0',
  extensions: { docvortex_layout: { pages: [0, 1, 2].map((i) => ({ page_idx: i, width_pt: W, height_pt: H })) } },
  pages: [
    {
      page_idx: 0,
      blocks: [
        { type: 'doc_title', index: 0, bbox: box(72, 72, 380, 100), content: [{ type: 'text', content: 'Lecture 3 Linear Maps' }] },
        {
          type: 'text',
          index: 1,
          bbox: box(72, 138, 500, 175),
          content: [
            { type: 'text', content: 'A linear map sends sums to sums and scalings to scalings. We write ' },
            { type: 'equation_inline', content: 'T' },
            { type: 'text', content: ' for a map between vector spaces.' },
          ],
        },
        { type: 'footer', index: 2, bbox: box(72, 745, 260, 756), content: [{ type: 'text', content: 'Linear Algebra - Lecture 3' }] },
      ],
    },
    {
      page_idx: 1,
      blocks: [
        { type: 'paragraph_title', index: 0, bbox: box(72, 72, 330, 100), content: [{ type: 'text', content: 'Example 3.4 Rotation' }] },
        { type: 'text', index: 1, bbox: box(72, 138, 400, 155), content: [{ type: 'text', content: 'Rotate the plane counter-clockwise by an angle ' }, { type: 'equation_inline', content: 't' }, { type: 'text', content: '.' }] },
        { type: 'equation', index: 2, bbox: box(72, 178, 260, 195), content: "x' = x \\cos t - y \\sin t \\tag{1}" },
        {
          type: 'table',
          index: 3,
          bbox: box(72, 330, 280, 420),
          content: [
            { type: 'table_caption', index: 3, bbox: box(72, 310, 280, 325), content: [{ type: 'text', content: 'Table 1. Rotation by t.' }] },
            {
              type: 'table_body',
              index: 4,
              bbox: box(72, 330, 280, 420),
              content: '<table><tr><td></td><td>column 1</td><td>column 2</td></tr><tr><td>row 1</td><td>$\\cos t$</td><td>$-\\sin t$</td></tr><tr><td>row 2</td><td>$\\sin t$</td><td>$\\cos t$</td></tr></table>',
            },
          ],
        },
        {
          type: 'image',
          index: 5,
          bbox: box(300, 312, 540, 492),
          content: [
            { type: 'image_body', index: 5, bbox: box(300, 312, 540, 492), content: '' },
            { type: 'image_caption', index: 6, bbox: box(300, 498, 540, 512), content: [{ type: 'text', content: 'Figure 1. The rotated basis vectors.' }] },
          ],
        },
        { type: 'page_number', index: 7, bbox: box(500, 745, 540, 756), content: [{ type: 'text', content: '2 / 3' }] },
      ],
    },
    {
      page_idx: 2,
      blocks: [
        { type: 'paragraph_title', index: 0, bbox: box(72, 72, 330, 100), content: [{ type: 'text', content: '3.5 Kernel and image' }] },
        { type: 'text', index: 1, bbox: box(72, 138, 450, 175), content: [{ type: 'text', content: 'The kernel is the set of vectors sent to zero. The image is everything T can reach.' }] },
      ],
    },
  ],
}

const pdfPane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const bar = (page: Page) => pdfPane(page).getByTestId('mineru-bar')
const tool = (page: Page) => acts(page).getByTestId('mineru-tool')
const reflow = (page: Page) => pdfPane(page).getByTestId('reflow')

let root = ''
test.beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'cn-mineru-e2e-'))
  writeFileSync(join(root, 'middle.json'), JSON.stringify(MIDDLE))
})
test.afterAll(() => rmSync(root, { recursive: true, force: true }))

/** 一个临时的「~」；kit：放好假的 mineru-kit 和模型（「本机已经装好了」） */
function home(kit: boolean) {
  const h = mkdtempSync(join(root, 'home-'))
  if (kit) {
    const k = join(h, '.mineru-venv/bin/mineru-kit')
    mkdirSync(join(k, '..'), { recursive: true })
    copyFileSync(join(FIX, 'fake-mineru-kit.sh'), k)
    chmodSync(k, 0o755)
    mkdirSync(join(h, '.mineru/models'), { recursive: true })
    writeFileSync(join(h, '.mineru/models/basic.ok'), '')
  }
  return h
}

const env = (h: string, more: Record<string, string> = {}) => ({
  CN_AI_FAKE: '1',
  CN_AI_FAKE_DELAY_MS: '50',
  CN_MINERU_HOME: h,
  CN_FAKE_MIDDLE: join(root, 'middle.json'),
  CN_FAKE_MINERU_KIT: join(FIX, 'fake-mineru-kit.sh'),
  CN_FAKE_MINERU_SLEEP: '0.3',
  ...more,
})

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPane(page).locator('.pdfpage[data-page="1"] canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

/** 对照 → 重排（看得到每一块怎么画） */
async function toReflow(page: Page) {
  await acts(page).getByTestId('bi-mode').getByRole('button', { name: '原文 / 对照 / 只看译文' }).click()
  await acts(page).getByRole('radiogroup', { name: '原文 对照 只看译文' }).getByRole('radio', { name: '对照' }).click()
  const bb = pdfPane(page).getByRole('toolbar', { name: '双语工具条' })
  await bb.getByRole('radio', { name: '重排' }).click()
  await expect(reflow(page)).toBeVisible()
}

const ai = (page: Page) => page.getByRole('complementary', { name: '边读边问 AI' })
/** 第 n 个回答答完了（发送键回来了） */
async function answered(page: Page, n: number) {
  await expect(ai(page).getByTestId('reading-msg')).toHaveCount(n)
  await expect(ai(page).getByTestId('reading-msg').last().locator('.txt')).not.toBeEmpty()
  await expect(ai(page).getByRole('button', { name: '发送' })).toBeVisible()
}

const screen = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen)

test('没装：PDF 工具条下面一行提示（大小、许可证、安装、不再提示），点「不再提示」以后不再出；设置里能打开', async () => {
  const h = home(false)
  const run = await launch(files, env(h))
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    await expect(bar(page)).toBeVisible()
    await expect(bar(page)).toHaveAttribute('data-state', 'hint')
    await expect(bar(page).locator('.ln')).toHaveText('装上PDF精读增强，表格、公式、双栏和配图认得更准')
    await expect(bar(page).locator('.size')).toHaveText('下载约1.3 GB · 占盘约2.2 GB')
    // 中间窄于 900（测试窗口就是）：大小先藏起来、放进「安装」的悬停提示，说明句留全；许可证不被省略号截掉
    await expect(page.locator('main.center')).toHaveClass(/compact/)
    await expect(bar(page).locator('.size')).toBeHidden()
    await expect(bar(page).getByRole('button', { name: '安装' })).toHaveAttribute('title', '下载约1.3 GB，占盘约2.2 GB')
    for (const el of [bar(page).locator('.ln'), bar(page).getByRole('link', { name: 'MinerU许可证' })]) expect(await el.evaluate((e) => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().width > 20)).toBe(true)
    await expect(bar(page).getByRole('button', { name: '安装' })).toBeVisible()
    // 不是弹框：PDF 照常能翻、能框
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(pdfPane(page).getByTestId('pdf-view')).toBeVisible()
    // 一行：高 36（多一像素是下边线），字不换行
    const bb = await bar(page).boundingBox()
    expect(Math.round(bb!.height)).toBeLessThanOrEqual(37)
    await shotWindow(run, 'mineru-hint')
    await shotPart(bar(page), 'mineru-hint-bar')
    // 许可证：用浏览器打开 MinerU 的 LICENSE.md
    await bar(page).getByRole('link', { name: 'MinerU许可证' }).click()
    await expect.poll(async () => (await screen(run)).join('|')).toContain('用浏览器打开 https://github.com/opendatalab/MinerU/blob/master/LICENSE.md')
    // 没装时不会去识别：工具条右端没有那行小字
    await expect(tool(page)).toHaveCount(0)

    // 不再提示：这一行收起，设置文件里记着；再打开 PDF 也不出
    await bar(page).getByRole('button', { name: '不再提示' }).click()
    await expect(bar(page)).toHaveCount(0)
    expect(JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8')).mineruHint).toBe(false)
    await page.reload()
    await page.locator('.vault b').waitFor()
    await openPdf(page)
    await page.waitForTimeout(800)
    await expect(bar(page)).toHaveCount(0)

    // 设置 › AI：写着没找到；打开「没找到时提示」，回到 PDF 又出
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: 'AI', exact: true }).click()
    await expect(page.getByTestId('mineru-state')).toContainText('没找到：打开PDF时在工具条下面提示安装')
    const sw = page.getByRole('switch', { name: '没找到时提示安装PDF精读增强' })
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    expect(JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8')).mineruHint).toBeUndefined()
  } finally {
    await run.close()
  }
})

test('本机已经装好：直接用、不提示；pdf.js 的块先出，后台跑完换成 MinerU 的（表格成表、公式渲染、图注跟图），下次打开直接用缓存', async () => {
  const h = home(true)
  const run = await launch(files, env(h, { CN_FAKE_MINERU_SLEEP: '1.5' }))
  const { page } = run
  try {
    await shotTone(page)
    // 记下每次问 AI 带了什么（这一页的文字、换版面后告诉 AI 的旧编号）
    await run.app.evaluate(({ ipcMain }) => {
      const m = (ipcMain as unknown as { _invokeHandlers: Map<string, (e: unknown, req: { pageText: string; renamed?: unknown }) => unknown> })._invokeHandlers
      const h = m.get('reading:ask')!
      const g = globalThis as unknown as { cnAsks: { pageText: string; renamed: unknown }[] }
      g.cnAsks = []
      m.set('reading:ask', (e, req) => {
        g.cnAsks.push({ pageText: req.pageText, renamed: req.renamed ?? null })
        return h(e, req)
      })
    })
    const asks = () => run.app.evaluate(() => (globalThis as unknown as { cnAsks: { pageText: string; renamed: Record<string, string> | null }[] }).cnAsks)
    await openPdf(page)
    // 换版面之前先问一次第 2 页：AI 看到的是 pdf.js 拼的块（图是 p2-b5）
    await acts(page).getByTestId('pdf-pager').getByRole('button').click()
    await page.getByRole('textbox', { name: '跳到第几页' }).fill('2')
    await page.keyboard.press('Enter')
    await acts(page).getByRole('button', { name: '问这一页' }).click()
    await expect.poll(async () => (await asks()).length, { timeout: 20_000 }).toBe(1)
    expect((await asks())[0]!.pageText).toContain('[图 p2-b5]')
    await answered(page, 1)
    await toReflow(page)
    // pdf.js 的块先出：公式是照原页裁的图，没有表格
    await expect(reflow(page).locator('[data-group="p2"] .fc.formula img')).toBeVisible()
    await expect(reflow(page).locator('.mtable')).toHaveCount(0)
    // 后台在认：工具条右端一行小字
    await expect(tool(page)).toBeVisible()
    await expect(tool(page)).toContainText('增强识别')
    await shotPart(acts(page), 'mineru-running-tool')
    // 找到了：不出提示
    await expect(bar(page)).toHaveCount(0)

    // 认完换上：表格画成表（格子里的公式也渲染）、公式用 KaTeX、图注紧跟图
    const p2 = reflow(page).locator('[data-group="p2"]')
    await expect(p2.locator('.fc.table.rendered table')).toBeVisible({ timeout: 20_000 })
    await expect(tool(page)).toHaveCount(0)
    await expect(page.locator('.notice, [role="status"]').filter({ hasText: '已换成PDF精读增强认的版面' }).first()).toBeVisible()
    const rows = p2.locator('.fc.table tr')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toHaveText(/column 1\s*column 2/)
    await expect(rows.nth(1).locator('.katex')).toHaveCount(2)
    await expect(p2.locator('.fc.formula.rendered .katex-display')).toHaveCount(1)
    await expect(p2.locator('.fc.formula.rendered .katex-mathml annotation')).toHaveText("x' = x \\cos t - y \\sin t \\tag{1}")
    // 正文里的行内公式也渲染
    await expect(p2.locator('.fb', { hasText: 'Rotate the plane' }).locator('.o .katex')).toHaveCount(1)
    // 图注：图后面紧跟着，按图注的样子（翻译）；表注在表的上面
    const kinds = await p2.locator(':scope > .fb, :scope > .fc').evaluateAll((els) => els.map((e) => e.className.replace(/\s+(staged|rendered)/g, '').trim()))
    expect(kinds).toEqual(['fb heading', 'fb text', 'fc formula', 'fb caption', 'fc table', 'fc figure', 'fb caption'])
    await expect(p2.locator('.fb.caption').last().locator('.o')).toHaveText('Figure 1. The rotated basis vectors.')
    await expect(p2.locator('.fb.caption').last().locator('.t')).toContainText('译文：Figure 1.')
    // 页脚（footer、page_number）丢掉
    await expect(reflow(page)).not.toContainText('Linear Algebra - Lecture 3')

    // 换完再问：这一页的文字里表写成「[表 …]」加格子、公式是 LaTeX；AI 提过的旧图编号 p2-b5 对到新的 p2-b6（只说一次）
    await acts(page).getByRole('button', { name: '问这一页' }).click()
    await expect.poll(async () => (await asks()).length, { timeout: 20_000 }).toBe(2)
    await answered(page, 2)
    const second = (await asks())[1]!
    expect(second.renamed).toEqual({ 'p2-b5': 'p2-b6' })
    expect(second.pageText).toContain('[表 p2-b5]\n | column 1 | column 2')
    expect(second.pageText).toContain("$$x' = x \\cos t - y \\sin t \\tag{1}$$")
    expect(second.pageText).toContain('[图 p2-b6]\nFigure 1. The rotated basis vectors.')
    await acts(page).getByRole('button', { name: '问这一页' }).click()
    await expect.poll(async () => (await asks()).length, { timeout: 20_000 }).toBe(3)
    expect((await asks())[2]!.renamed).toBeNull()
    await shotPart(p2, 'mineru-reflow-p2')
    await shotWindow(run, 'mineru-reflow')

    // 缓存：原样结果 + m1 块，和 pdf.js 的 b2 并排；解析只跑了一次，参数里没有 --remote
    const text = readdirSync(join(run.userData, 'reading/text'))
    expect(text.filter((f) => f.endsWith('.m1.json'))).toHaveLength(1)
    expect(text.filter((f) => f.endsWith('.b2.json'))).toHaveLength(1)
    expect(readdirSync(join(run.userData, 'reading/mineru')).filter((f) => /\.4\.2\.3\.basic\.json$/.test(f))).toHaveLength(1)
    const log = readFileSync(join(h, 'mineru-parse.log'), 'utf8')
    expect(log.trim().split('\n')).toHaveLength(1)
    expect(log).toMatch(/-f middle_json --tier basic -v/)
    expect(log).not.toMatch(/remote/)
    // 临时目录用完删了
    expect(readdirSync(join(run.userData, 'mineru/tmp'))).toEqual([])

    // 重新打开：直接用 m1，不再跑
    await page.reload()
    await page.locator('.vault b').waitFor()
    await openPdf(page)
    await toReflow(page)
    await expect(reflow(page).locator('[data-group="p2"] .fc.table.rendered table')).toBeVisible()
    await page.waitForTimeout(500)
    expect(readFileSync(join(h, 'mineru-parse.log'), 'utf8').trim().split('\n')).toHaveLength(1)
    await expect(tool(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('失败退回：退出码非 0 照常用 pdf.js 的块，工具条「增强识别没成功 · 重试」（悬停看原因）；重试成功就换上', async () => {
  const h = home(true)
  const run = await launch(files, env(h, { CN_FAKE_MINERU_FAIL: 'exit' }))
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    await expect(tool(page)).toHaveAttribute('data-state', 'failed', { timeout: 15_000 })
    await expect(tool(page)).toHaveText('增强识别没成功 · 重试')
    await expect(tool(page)).toHaveAttribute('data-tip', '原因：退出码 3：RuntimeError: out of memory · 先照常用PDF自带的文字')
    await expect(bar(page)).toHaveCount(0)
    await toReflow(page)
    await expect(reflow(page).locator('[data-group="p2"] .fc.formula img')).toBeVisible()
    await expect(reflow(page).locator('.mtable')).toHaveCount(0)
    expect(readdirSync(join(run.userData, 'reading/text')).filter((f) => f.endsWith('.m1.json'))).toHaveLength(0)
    await shotPart(acts(page), 'mineru-failed-tool')
    // 坏 JSON 也算没成功
    await run.app.evaluate(() => {
      process.env.CN_FAKE_MINERU_FAIL = 'badjson'
    })
    await tool(page).getByRole('button', { name: '重试' }).click()
    await expect(tool(page)).toHaveAttribute('data-state', 'failed', { timeout: 15_000 })
    await expect(tool(page)).toHaveAttribute('data-tip', /结果读不了：MinerU 的结果不是完整的 JSON/)
    // 修好了（比如内存够了）再点重试：换上
    await run.app.evaluate(() => {
      delete process.env.CN_FAKE_MINERU_FAIL
    })
    await tool(page).getByRole('button', { name: '重试' }).click()
    await expect(reflow(page).locator('[data-group="p2"] .fc.table.rendered table')).toBeVisible({ timeout: 15_000 })
    await expect(tool(page)).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('找到的版本不对：不替它重装、不提示安装，照常用 pdf.js，工具条说原因', async () => {
  const h = home(true)
  const run = await launch(files, env(h, { CN_FAKE_MINERU_VERSION: '3.1.0' }))
  const { page } = run
  try {
    await openPdf(page)
    await expect(tool(page)).toHaveAttribute('data-state', 'failed', { timeout: 15_000 })
    await expect(tool(page)).toHaveAttribute('data-tip', /~\/\.mineru-venv的 MinerU 版本是 3\.1\.0，要 4\.0\.12 以上、5 以下/)
    await expect(bar(page)).toHaveCount(0)
    expect(existsSync(join(h, 'mineru-parse.log'))).toBe(false)
  } finally {
    await run.close()
  }
})

test('装：点「安装」这一行变成进度（哪一步、百分比、底边进度条），装进 ~/.mineru-venv，装完接着识别开着的 PDF', async () => {
  // 假的 uv 放在本机的一个下载地址
  const name = `uv-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin`
  const pkg = mkdtempSync(join(root, 'uvpkg-'))
  mkdirSync(join(pkg, name))
  copyFileSync(join(FIX, 'fake-uv.sh'), join(pkg, name, 'uv'))
  chmodSync(join(pkg, name, 'uv'), 0o755)
  execFileSync('/usr/bin/tar', ['-czf', join(pkg, 'uv.tar.gz'), '-C', pkg, name])
  const tgz = readFileSync(join(pkg, 'uv.tar.gz'))
  const server = createServer((_q, res) => {
    res.writeHead(200, { 'content-length': tgz.length })
    res.end(tgz)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/uv.tar.gz`
  const h = home(false)
  const run = await launch(files, env(h, { CN_MINERU_UV_URL: url, CN_FAKE_UV_SLEEP: '0.6', CN_MINERU_WATCH_MS: '200' }))
  const { page } = run
  try {
    await shotTone(page)
    await openPdf(page)
    await toReflow(page)
    await bar(page).getByRole('button', { name: '安装' }).click()
    await expect(bar(page)).toHaveAttribute('data-state', 'installing')
    await expect(bar(page)).toContainText('正在装PDF精读增强')
    await expect(bar(page).locator('.step')).toHaveText('下载MinerU和PyTorch（约1.3 GB）', { timeout: 15_000 })
    await expect(bar(page).locator('.ln.out')).toContainText('Downloading torch')
    const pct = Number((await bar(page).locator('.pct').textContent())!.replace('%', ''))
    expect(pct).toBeGreaterThanOrEqual(8)
    await shotPart(bar(page), 'mineru-installing-bar')
    await shotWindow(run, 'mineru-installing')
    // 装完：这一行收起，开着的 PDF 接着识别、换上
    await expect(bar(page)).toHaveCount(0, { timeout: 30_000 })
    await expect(reflow(page).locator('[data-group="p2"] .fc.table.rendered table')).toBeVisible({ timeout: 20_000 })
    expect(existsSync(join(h, '.mineru-venv/bin/mineru-kit'))).toBe(true)
    expect(existsSync(join(h, '.mineru/models/basic.ok'))).toBe(true)
    expect(existsSync(join(h, '.mineru/python'))).toBe(true)
    // uv 的缓存装完删了；uv 自己留在数据目录（下次不用再下）
    expect(existsSync(join(run.userData, 'mineru/cache'))).toBe(false)
    expect(existsSync(join(run.userData, 'mineru/uv'))).toBe(true)
    expect(readFileSync(join(h, 'uv.log'), 'utf8')).toContain('mineru==4.2.3')
    // 设置里写着在用这份
    await page.keyboard.press('Meta+,')
    await page.getByRole('button', { name: 'AI', exact: true }).click()
    await expect(page.getByTestId('mineru-state')).toContainText('在用~/.mineru-venv的MinerU 4.2.3')
  } finally {
    await run.close()
    server.close()
  }
})

test('第 2 轮：没网装不上：一句一个冒号「PDF精读增强没装成，下载不下来：检查网络后点「重试」」', async () => {
  // 下载地址指向一个关掉的端口
  const server = createServer()
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((r) => server.close(() => r()))
  const h = home(false)
  const run = await launch(files, env(h, { CN_MINERU_UV_URL: `http://127.0.0.1:${port}/uv.tar.gz` }))
  const { page } = run
  try {
    await openPdf(page)
    await toReflow(page)
    await bar(page).getByRole('button', { name: '安装' }).click()
    await expect(bar(page)).toHaveAttribute('data-state', 'failed', { timeout: 15_000 })
    await expect(bar(page).locator('.ln')).toHaveText('PDF精读增强没装成，下载不下来：检查网络后点「重试」')
  } finally {
    await run.close()
  }
})
