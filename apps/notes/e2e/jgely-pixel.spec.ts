/**
 * 面板半透明（task-jgely）不许动到的样子：A「照 VS Code」（窗口背景是极光照片也一样，A 不铺图）和 B「不用图」，
 * 几个主要页面逐像素和改前一样。面板透明度拉到两头也不影响这两种（它只管有窗口背景时的岛）。
 *
 * 一个像素三个通道差都在 2 以内算一样、差得多的最多 3 个点（同一个构建跑两次也有这么多抖动）。
 * 要两次构建：先用改前的构建跑一遍，CN_PIXEL_DIR=目录 CN_PIXEL_SAVE=1 存下每张；再用现在的构建跑，CN_PIXEL_DIR 同一个目录，逐像素比。
 * 没给 CN_PIXEL_DIR 时跳过。
 */
import { expect, type Page, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ECP_DOC, LECTURES } from '../../../packages/format/test/base-samples'
import { acts, launch, leftView, openNote, pane, type Running, tabOn } from './app'
import { ICELAND } from './fixtures/board'
import { DOCS } from './fixtures/ecp-views'
import { LECTURE } from './fixtures/pdf'

const DIR = process.env.CN_PIXEL_DIR
const SAVE = process.env.CN_PIXEL_SAVE === '1'
test.skip(!DIR, '只在比改前改后时跑（CN_PIXEL_DIR=目录）')

const FILES: Record<string, string | Uint8Array> = {
  '课程/ecp/ecp 课程计划.md': ECP_DOC,
  ...DOCS,
  ...LECTURES,
  '课程/线代/第3讲.pdf': LECTURE,
  '旅行/冰岛.md': ICELAND,
  '写作/小论文计划.md': '# 小论文计划\n\n截稿前把实验和初稿弄完，周五交给导师。\n\n## 这周\n\n- [ ] 读完三篇相关论文\n- [x] 和导师约时间\n\n> 写作不是把想好的东西抄下来，是在写的时候想清楚。\n',
}

const CASES = [
  { name: 'a-aurora-mint', look: { frame: 'a', winBg: 'aurora', skin: 'mint' } },
  { name: 'a-aurora-petrol', look: { frame: 'a', winBg: 'aurora', skin: 'petrol' } },
  { name: 'b-none-sky', look: { frame: 'b', winBg: 'none', skin: 'sky' } },
  { name: 'b-none-pine', look: { frame: 'b', winBg: 'none', skin: 'pine' } },
] as const

/** 不闪的东西才比：光标不画、鼠标停在底栏外面 */
async function settle(page: Page) {
  await page.addStyleTag({ content: '* { caret-color: transparent !important; } *, *::before, *::after { animation: none !important; transition: none !important; }' })
  // 软件这次自己写的文件（首页配置这些）在「最近」里是几点几分，两次跑不一样：只把这种字换成 00:00；问候换成「你好」
  await page.evaluate(() => {
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (w.nextNode()) {
      const t = w.currentNode.nodeValue!.trim()
      if (/^\d{1,2}:\d{2}$/.test(t)) w.currentNode.nodeValue = '00:00'
      // 首页的问候跟着钟走（下午好、晚上好）
      else if (/^(早上|上午|中午|下午|晚上|夜里|凌晨)好/.test(t)) w.currentNode.nodeValue = '你好'
    }
  })
  await page.mouse.move(1430, 600)
  await page.waitForTimeout(600)
}

async function compare(run: Running, name: string) {
  await settle(run.page)
  const file = join(DIR!, `${name}.png`)
  const png = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  if (SAVE) {
    mkdirSync(DIR!, { recursive: true })
    writeFileSync(file, Buffer.from(png, 'base64'))
    return
  }
  expect(existsSync(file), `没有改前的 ${name}.png`).toBe(true)
  writeFileSync(join(DIR!, `${name}.now.png`), Buffer.from(png, 'base64'))
  const diff = await run.app.evaluate(
    ({ nativeImage }, [a, b]) => {
      const x = nativeImage.createFromBuffer(Buffer.from(a, 'base64'))
      const y = nativeImage.createFromBuffer(Buffer.from(b, 'base64'))
      const [sa, sb] = [x.getSize(), y.getSize()]
      if (sa.width !== sb.width || sa.height !== sb.height) return { size: `${sa.width}×${sa.height} / ${sb.width}×${sb.height}`, n: -1, box: '' }
      const p = x.toBitmap(), q = y.toBitmap()
      let n = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1
      for (let i = 0; i < p.length; i += 4) {
        if (Math.abs(p[i]! - q[i]!) > 2 || Math.abs(p[i + 1]! - q[i + 1]!) > 2 || Math.abs(p[i + 2]! - q[i + 2]!) > 2) {
          n++
          const k = i / 4, px = k % sa.width, py = Math.floor(k / sa.width)
          x0 = Math.min(x0, px), y0 = Math.min(y0, py), x1 = Math.max(x1, px), y1 = Math.max(y1, py)
        }
      }
      return { size: '', n, box: n ? `${x0},${y0}–${x1},${y1}` : '' }
    },
    [readFileSync(file).toString('base64'), png] as const,
  )
  expect.soft(diff.size, `${name} 大小变了`).toBe('')
  // 一个像素三个通道差都在 2 以内算一样，再差的最多 3 个点：同一个构建跑两次，首页封面照片（JPEG）和圆角抗锯齿就有 ±1、±2（最多 148 个点），
  // 标题栏搜索框的圆角偶尔有 1 个点差得多一点（量过）
  expect.soft(diff.n, `${name} 有 ${diff.n} 个像素不一样（${diff.box}）`).toBeLessThanOrEqual(3)
}

for (const c of CASES) {
  test(`和改前逐像素一样：${c.name}`, async () => {
    test.setTimeout(180_000)
    const run = await launch(FILES, {}, (vault) => {
      // 左栏「最近」按修改时间排：每篇定一个不一样的时间（今天 9 点往前一篇一分钟），两次跑排得一样
      Object.keys(FILES).forEach((f, i) => {
        const at = new Date()
        at.setHours(9, -i, 0, 0)
        utimesSync(join(vault, f), at, at)
      })
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      // 透明度拉到最透：A 和「不用图」也不许变（改前的构建不认这一项）
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...c.look, glass: 100 } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 800))
      await expect.poll(() => page.evaluate(() => innerHeight)).toBe(800)
      await page.getByRole('button', { name: '首页', exact: true }).first().click()
      await page.waitForTimeout(600)
      await compare(run, `${c.name}-01-home`)

      await leftView(page, '文件')
      await openNote(page, '小论文计划')
      await compare(run, `${c.name}-02-doc`)

      await openNote(page, '冰岛')
      await acts(page).getByRole('tab', { name: '白板' }).click()
      await expect(pane(page).locator('[data-testid="doc-board"], [data-testid="board"]').first()).toBeVisible()
      await compare(run, `${c.name}-03-board`)

      await openNote(page, 'ecp 看板')
      await expect(pane(page).locator('[data-part="数据库块"]').locator('[data-part="看板一列"]')).toHaveCount(3)
      await compare(run, `${c.name}-04-db`)

      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲.pdf')
      await page.locator('.pal-row', { hasText: '第3讲' }).first().click()
      await expect(tabOn(page)).toHaveText('第3讲.pdf')
      await page.waitForTimeout(1500)
      await compare(run, `${c.name}-05-pdf`)
    } finally {
      await run.close()
    }
  })
}
