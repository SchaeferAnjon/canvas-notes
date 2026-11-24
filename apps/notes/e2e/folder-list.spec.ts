// 文件夹首页组件底下「全部 N 份 · 打开列表看」（2026-11-24 用户报：点了跳到全库「最近」，混着别处的文档、白板、网页）：
// 开的是这个文件夹里那一类的整页列表。ParaRead 组件 → 这个文件夹的 PDF（读到多少、读、笔记，能按读到多少、修改时间排）；
// 「笔记和导图」→ 只列这个文件夹里的笔记。别处的 PDF、笔记不进来。给了 CN_SHOTS 时截一张薄荷的。
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, tabOn } from './app'
import { lecturePdf } from './fixtures/pdf'

test.setTimeout(180_000)

const DIR = '项目/研究'
const pdf = (title: string) => lecturePdf([{ title, lines: ['Some research notes.'] }, { title: `${title} (2)`, lines: ['More.'] }])
const NAMES = ['论文 1', '论文 2', '论文 3', '论文 4', '论文 5', '论文 6', '论文 7', '论文 8']
const note = (title: string) => `---\n类型: 笔记\n---\n# ${title}\n\n正文。\n`
const HOME = {
  style: 'a',
  cover: { kind: 'none' },
  coverY: 40,
  icon: 'book-open',
  color: null,
  order: ['pararead', 'notes'],
  hidden: [],
  sizes: { pararead: 4, notes: 4 },
  widgets: {
    pararead: { type: 'pararead' },
    notes: { type: 'notes', cond: { name: '笔记和导图', scope: 'folder', all: true, rules: [{ prop: '类型', op: '是其中', value: '笔记, 导图' }], sort: { prop: '改过', dir: 'desc' }, view: 'list', limit: 4 } },
  },
}
const now = Date.now()
/** ParaRead 读过三份：论文 3 读到 80%（最近读的）、论文 5 读到 20%、论文 2 读到 50% */
const at = (page: number, pct: number, ago: number) => ({ page, pages: 10, pct, at: now - ago, by: 'pararead', ms: { pararead: 60_000 } })
const READ_AT = JSON.stringify({ files: { [`${DIR}/论文 3.pdf`]: at(8, 80, 60_000), [`${DIR}/论文 5.pdf`]: at(2, 20, 120_000), [`${DIR}/论文 2.pdf`]: at(5, 50, 180_000) } }) + '\n'

const files: Record<string, string | Uint8Array> = {
  ...Object.fromEntries(NAMES.map((n) => [`${DIR}/${n}.pdf`, pdf(n)])),
  [`${DIR}/.首页.json`]: JSON.stringify(HOME, null, 2) + '\n',
  ...Object.fromEntries(['方法', '实验', '结果', '讨论', '摘要'].map((n) => [`${DIR}/${n}.md`, note(n)])),
  // 别处的：不该进这个文件夹的列表
  '项目/别的/外面 1.pdf': pdf('外面 1'),
  '项目/别的/外面 2.pdf': pdf('外面 2'),
  '收件箱/外面 3.pdf': pdf('外面 3'),
  '收件箱/别处的笔记.md': note('别处的笔记'),
  '项目/别的/另一篇.md': note('另一篇'),
  '.canvas-notes/读到哪.json': READ_AT,
}

const home = (page: Page) => page.getByTestId('folder-home')
const widget = (page: Page) => home(page).getByTestId('pararead-widget')
const list = (page: Page) => page.locator('[data-testid="folder-list"]:visible')
const pdfNames = (page: Page) => list(page).getByTestId('flist-pdf').locator('.ti')

let dir = ''
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-flist-'))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('文件夹首页「全部 N 份 · 打开列表看」开这个文件夹里那一类：8 份 PDF 带读到多少、能改排序；笔记和导图只列这个文件夹的', async () => {
  const installed = join(dir, 'installed.json')
  writeFileSync(installed, JSON.stringify({ pararead: '0.2.0' }))
  const run = await launch(files, { CN_FAMILY_INSTALLED_FILE: installed, CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => window.cn.setSettings({ appearance: { followSystem: false, skin: 'mint' } }))
    await page.reload()
    await page.locator('.vault b').waitFor()
    // 论文 8 是最近改的（排「修改时间」时在最上面），论文 1 最早
    NAMES.forEach((n, i) => utimesSync(join(vault, DIR, `${n}.pdf`), new Date(now - (10 - i) * 3600_000), new Date(now - (10 - i) * 3600_000)))
    // 笔记：方法最早、摘要最近
    ;['方法', '实验', '结果', '讨论', '摘要'].forEach((n, i) => utimesSync(join(vault, DIR, `${n}.md`), new Date(now - (10 - i) * 60_000), new Date(now - (10 - i) * 60_000)))

    await run.app.evaluate(({ app }, u) => app.emit('open-url', { preventDefault: () => undefined }, u), 'canvas-notes://open?file=' + encodeURIComponent(DIR))
    await expect(home(page)).toHaveAttribute('data-folder', DIR)
    await expect(widget(page).getByTestId('pararead-row')).toHaveCount(6)
    await expect(widget(page).locator('.fw-more')).toHaveText('全部8份 · 打开列表看')
    await widget(page).locator('.fw-more').click()

    // 中间开「研究 · PDF」：正好这 8 份，别处的 3 份不在；默认和组件一样最近读的在前
    await expect(tabOn(page)).toHaveText('研究 · PDF')
    await expect(list(page)).toHaveAttribute('data-folder', DIR)
    await expect(list(page).getByTestId('flist-pdf')).toHaveCount(8)
    await expect(list(page)).not.toContainText('外面')
    await expect(list(page).locator('.fl-hd')).toHaveText(/研究.*PDF/)
    await expect(page.getByTestId('tab-acts')).toContainText('8份 PDF')
    await expect(pdfNames(page)).toHaveText(['论文 3', '论文 5', '论文 2', '论文 1', '论文 4', '论文 6', '论文 7', '论文 8'])
    // 每份带读到多少，没读过的写「没读过」
    await expect(list(page).getByTestId('flist-pdf').first().getByTestId('flist-read')).toHaveText('80%')
    await expect(list(page).getByTestId('flist-pdf').filter({ hasText: '论文 7' }).getByTestId('flist-read')).toHaveText('没读过')
    await expect(list(page).getByTestId('flist-pdf').first().getByRole('button', { name: '读' })).toBeVisible()
    await expect(list(page).getByTestId('flist-pdf').first().getByRole('button', { name: '笔记' })).toBeDisabled()

    // 按读到多少：80 → 50 → 20 → 没读过的按名字
    await list(page).getByRole('tab', { name: '读到多少' }).click()
    await expect(list(page).getByRole('tab', { name: '读到多少' })).toHaveAttribute('aria-selected', 'true')
    await expect(pdfNames(page)).toHaveText(['论文 3', '论文 2', '论文 5', '论文 1', '论文 4', '论文 6', '论文 7', '论文 8'])
    // 按修改时间：最近改的在前
    await list(page).getByRole('tab', { name: '修改时间' }).click()
    await expect(pdfNames(page)).toHaveText(['论文 8', '论文 7', '论文 6', '论文 5', '论文 4', '论文 3', '论文 2', '论文 1'])
    // 筛选名字
    await list(page).getByRole('textbox', { name: '筛选' }).fill('论文 4')
    await expect(pdfNames(page)).toHaveText(['论文 4'])
    await list(page).getByRole('textbox', { name: '筛选' }).fill('')
    await list(page).getByRole('tab', { name: '读到多少' }).click()
    const shots = process.env.CN_SHOTS
    if (shots) {
      mkdirSync(shots, { recursive: true })
      await page.screenshot({ path: join(shots, '01-全部PDF-薄荷.png') })
    }

    // 点一行没读过的「读」：ParaRead 打开它（深链）
    const screen = () => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.slice())
    await list(page).getByTestId('flist-pdf').filter({ hasText: '论文 7' }).getByRole('button', { name: '读' }).click()
    await expect.poll(screen).toContainEqual(expect.stringContaining('pararead://open'))

    // 回首页：「笔记和导图 · 全部 5 篇」只列这个文件夹的 5 篇
    await list(page).locator('.fl-hd .lnk').click()
    await expect(home(page)).toHaveAttribute('data-folder', DIR)
    await expect(home(page).locator('.fw-more', { hasText: '全部5篇 · 打开列表看' })).toBeVisible()
    await home(page).locator('.fw-more', { hasText: '全部5篇 · 打开列表看' }).click()
    await expect(tabOn(page)).toHaveText('研究 · 笔记和导图')
    await expect(list(page).getByTestId('flist-file')).toHaveCount(5)
    // 默认照组件的排法（改过，新的在前）
    await expect(list(page).getByTestId('flist-file').locator('.ti')).toHaveText(['摘要', '讨论', '结果', '实验', '方法'])
    await expect(list(page)).not.toContainText('别处的笔记')
    await expect(list(page)).not.toContainText('另一篇')
    await list(page).getByRole('tab', { name: '名字' }).click()
    await expect(list(page).getByTestId('flist-file').locator('.ti')).toHaveText(['方法', '讨论', '实验', '结果', '摘要'].sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true })))
    // 点一篇：开这篇笔记
    await list(page).getByTestId('flist-file').filter({ hasText: '实验' }).click()
    await expect(tabOn(page)).toHaveText('实验')
  } finally {
    await run.close()
  }
})
