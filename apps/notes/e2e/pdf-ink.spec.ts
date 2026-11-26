/**
 * 读 PDF 时显示 iPad 上写的笔迹（设计页 159「iPad 读 PDF 手写和白板同一套」；格式 packages/format/src/ink.ts 组行带 pg，
 * Mac 这边 renderer/reading/pdf-ink.tsx）：附件/<PDF 名>/笔迹.ink 里第 1 页、第 2 页的笔画在各自那一页的原处，放大以后还对得上；
 * 照白板 Mac 第一版：点一笔选中那一组、改颜色、拖着挪（只改组行）、⌘Z 撤回 / ⇧⌘Z 重做、⌫ 删，每一下只改笔迹文件里那几行、提交一次；
 * PDF 原文件一个字节不动；点空白处照旧框一块（不写笔）。
 */
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'
import { circle, highlight, scribble } from './ink-samples'

const PDF = '课程/线代/第3讲 线性映射.pdf'
const INK = '附件/第3讲 线性映射/笔迹.ink'
/** 第 1 页一组（钢笔一行字 + 一个圈，组原点 (100, 200)），第 2 页一组荧光笔；还有迁移记的一行 */
const INK_TEXT =
  '{"ink":1}\n' +
  '{"moved":"附件/手写/第3讲 线性映射/第 1 页.drawing","sha":"0123456789ab","pg":1}\n' +
  '{"g":"pg1grp01","pg":1,"x":100,"y":200}\n' +
  `{"id":"pg1str01","g":"pg1grp01","pen":"pen","c":"#1d2421","p":"${scribble(200, 2)}"}\n` +
  `{"id":"pg1str02","g":"pg1grp01","pen":"pen","c":"#1d2421","p":"${circle(260, 40, 24)}"}\n` +
  '{"g":"pg2grp01","pg":2,"x":72,"y":140}\n' +
  `{"id":"pg2str01","g":"pg2grp01","pen":"marker","c":"#ffd84d","p":"${highlight(220)}"}\n`

const mint = (vault: string) => {
  const ud = join(vault, '..', 'user-data')
  mkdirSync(ud, { recursive: true })
  // 交付页截图：CN_PDF_INK_SKIN=petrol 换深湖
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: process.env.CN_PDF_INK_SKIN || 'mint', frame: 'b' } }))
}

const pane = (page: Page) => page.locator('.pdfpane:not([hidden])')
const pdfPage = (page: Page, n: number) => pane(page).locator(`.pdfpage[data-page="${n}"]`)
const ink = (page: Page, n: number) => pane(page).locator(`canvas.pdfink[data-page="${n}"]`)

async function openPdf(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲 线性映射')
  await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
  await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
  await expect(pdfPage(page, 1).locator('canvas[data-ready="1"]')).toBeAttached({ timeout: 15_000 })
}

/** 页内坐标（PDF 点，左上角起）→ 窗口坐标 */
async function at(page: Page, n: number, x: number, y: number) {
  const r = (await pdfPage(page, n).boundingBox())!
  const s = r.width / 612
  return { x: r.x + x * s, y: r.y + y * s, s }
}

/** 笔迹那层画布在页内坐标 (x, y) 附近（±r 点）有没有画上东西 */
async function inked(page: Page, n: number, x: number, y: number, r = 3) {
  return ink(page, n).evaluate(
    (cv, [x, y, r]) => {
      const c = cv as HTMLCanvasElement
      const k = c.width / c.getBoundingClientRect().width
      const s = c.getBoundingClientRect().width / 612
      const px = Math.round(x * s * k)
      const py = Math.round(y * s * k)
      const d = Math.ceil(r * s * k)
      const data = c.getContext('2d')!.getImageData(px - d, py - d, 2 * d + 1, 2 * d + 1).data
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 40) return true
      return false
    },
    [x, y, r] as const,
  )
}

const lines = (vault: string) => readFileSync(join(vault, INK), 'utf8').split('\n')

test('读 PDF：iPad 写的笔迹画在原页原处（放大也对得上）；点选、改色、挪、⌘Z、⌫，只改那几行、提交一次；PDF 不动', async () => {
  const run = await launch({ [PDF]: LECTURE, [INK]: INK_TEXT }, {}, mint)
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    const pdfBefore = readFileSync(join(vault, PDF))
    await openPdf(page)
    // 第 1 页两笔、第 2 页一笔；圈的最上面那一点（组原点 + (260, 40 − 24)）画上了，圈中间空着
    await expect(ink(page, 1)).toHaveAttribute('data-strokes', '2')
    await expect.poll(() => inked(page, 1, 100 + 260, 200 + 16)).toBe(true)
    expect(await inked(page, 1, 100 + 260, 200 + 40, 4)).toBe(false)
    await pane(page).getByTestId('pdf-view').evaluate((el) => (el.scrollTop += 500))
    await expect(ink(page, 2)).toHaveAttribute('data-strokes', '1')
    await expect.poll(() => inked(page, 2, 72 + 110, 140)).toBe(true)
    await pane(page).getByTestId('pdf-view').evaluate((el) => (el.scrollTop = 0))
    const shot = (name: string) => page.screenshot({ path: process.env.CN_PDF_INK_SHOTS ? join(process.env.CN_PDF_INK_SHOTS, `mac-${name}-${process.env.CN_PDF_INK_SKIN || 'mint'}.png`) : test.info().outputPath(`mac-${name}.png`) })
    await shot('pdfink')

    // 放大两档：还在页内的同一处
    await pane(page).getByTestId('pdf-view').focus()
    await page.keyboard.press('Meta+Equal')
    await page.keyboard.press('Meta+Equal')
    await expect.poll(() => inked(page, 1, 100 + 260, 200 + 16)).toBe(true)
    expect(await inked(page, 1, 100 + 260, 200 + 40, 4)).toBe(false)
    await page.keyboard.press('Meta+Digit0')

    // 点圈上那一点：选中这一组（两笔），出操作条
    const top = await at(page, 1, 100 + 260, 200 + 16)
    await page.mouse.click(top.x, top.y)
    const bar = page.getByTestId('pdf-ink-selbar')
    await expect(bar).toBeVisible()
    await expect(bar).toContainText('已选2笔')
    // 操作条出来有 0.12 秒的淡入：等它站稳再截
    await page.waitForTimeout(300)
    await shot('pdfink-sel')
    expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('')

    // 改颜色：两笔那两行换颜色，别的行不动；提交一次
    const before = lines(vault)
    const commits = () => Number(execFileSync('git', ['-C', vault, 'rev-list', '--count', 'HEAD']).toString().trim())
    const c0 = commits()
    await bar.locator('[data-k="color"]').click()
    await page.getByTestId('ink-colors').locator('[data-c="#9f2323"]').click()
    await expect.poll(() => lines(vault).filter((l) => l.includes('"c":"#9f2323"')).length).toBe(2)
    const recolored = lines(vault)
    expect(recolored.map((l, i) => (l === before[i] ? null : i)).filter((i) => i !== null)).toEqual([3, 4])
    await expect.poll(commits).toBe(c0 + 1)

    // 拖着挪：只改组行（x、y 加上挪的点数），笔画行不动
    const s = top.s
    await page.mouse.move(top.x, top.y)
    await page.mouse.down()
    await page.mouse.move(top.x + 30, top.y + 20, { steps: 4 })
    await page.mouse.move(top.x + 60 * s, top.y + 40 * s, { steps: 6 })
    await page.mouse.up()
    await expect.poll(() => lines(vault)[2]).toMatch(/^\{"g":"pg1grp01","pg":1,"x":16\d(\.\d+)?,"y":24\d(\.\d+)?,"t":\d+\}$/)
    const moved = lines(vault)
    expect(moved.map((l, i) => (l === recolored[i] ? null : i)).filter((i) => i !== null)).toEqual([2])
    await expect.poll(() => inked(page, 1, 160 + 260, 240 + 16)).toBe(true)

    // ⌘Z：回到挪之前；⇧⌘Z：又挪过去
    await page.keyboard.press('Meta+z')
    await expect.poll(() => lines(vault).join('\n')).toBe(recolored.join('\n'))
    await page.keyboard.press('Shift+Meta+z')
    await expect.poll(() => lines(vault).join('\n')).toBe(moved.join('\n'))

    // ⌫ 删：这一组两笔和组行都没了，第 2 页那组、迁移那一行不动
    const now = await at(page, 1, 160 + 260, 240 + 16)
    await page.mouse.click(now.x, now.y)
    await expect(bar).toBeVisible()
    await page.keyboard.press('Backspace')
    await expect.poll(() => lines(vault).some((l) => l.includes('pg1'))).toBe(false)
    expect(lines(vault).filter((l) => l.includes('pg2')).length).toBe(2)
    expect(lines(vault)[1]).toContain('"moved"')
    await expect(ink(page, 1)).toHaveCount(0)

    // PDF 一个字节不动
    expect(readFileSync(join(vault, PDF)).equals(pdfBefore)).toBe(true)
    // 点空白处照旧能框一块（不写笔）
    const a = await at(page, 1, 80, 420)
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move(a.x + 160, a.y + 60, { steps: 6 })
    await page.mouse.up()
    await expect(pane(page).getByTestId('pdf-box')).toBeVisible()
  } finally {
    await run.close()
  }
})
