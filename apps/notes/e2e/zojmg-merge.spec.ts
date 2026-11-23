// 英文版第 2–3 批合进最新 dev 之后（task-zojmg）：dev 新加的界面字在英文界面里是英文，中文界面照旧。
// 每一样都真点：文档里嵌的导图块、块菜单的上移 / 下移和「标成 AI 写的」（真把第二段挪上去、写进文件）、/ 菜单的「拍导图」、
// 白板右上角的缩放菜单、「课程」右键的新建一门课、右上角「网页占满 ↔ 还原」、图标栏左下的「最近删掉的」。
// 给了 CN_SHOTS 时顺手截图（中文、英文各一份，浅色天青），给设计复审并排看。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname, join } from 'node:path'
import { editorText, launch, leftView, pane, waitSaved, type Running } from './app'
import { armMenus, dismissMenu, openedMenu } from './menu'
import { cat, enVault, L } from './zojmg-lib'

type Lang = 'zh' | 'en'
const DIR = process.env.CN_SHOTS ?? ''

const MAP = '---\ntype: board\n白板样式: 导图\n---\n# 导图\n\n- 线性映射\n  - 定义\n  - 矩阵表示\n'
const NOTE = '# 笔记\n\n第一段。\n\n第二段。\n\n![[导图]]\n'
const BOARD = '---\ntype: board\n---\n# 复习\n\n## 要点\n\n一张卡\n'

function lib(lang: Lang): Record<string, string> {
  const files = { '课程/线性代数/导图.md': MAP, '课程/线性代数/笔记.md': NOTE, '课程/线性代数/复习.md': BOARD }
  return lang === 'en' ? (enVault(files) as Record<string, string>) : files
}

let server: Server
let pageUrl = ''
test.beforeAll(async () => {
  server = createServer((_q, r) => r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<!doctype html><title>Page</title><p>A page to read.</p>'))
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
  pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})
test.afterAll(() => new Promise<void>((ok) => server.close(() => ok())))

const shot = async (page: Page, name: string, lang: Lang) => {
  if (DIR) await page.screenshot({ path: join(DIR, `merge-${name}-${lang}.png`) })
}

async function open(page: Page, lang: Lang, title: string) {
  await page.keyboard.press('Meta+k')
  const pal = page.getByRole('dialog', { name: L(lang, '搜索和命令', 'Search and commands') })
  await expect(pal).toBeVisible()
  await pal.getByRole('textbox').first().fill(title)
  await expect(pal.getByRole('option').first()).toContainText(title)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('tab-on')).toHaveText(title)
}

/** 指着这一行，点左边的把手开块菜单 */
async function blockMenu(page: Page, lang: Lang, text: string) {
  const line = pane(page).locator('.cm-line', { hasText: text })
  const menu = page.getByRole('menu', { name: L(lang, '块菜单', 'Block menu') })
  await expect(async () => {
    const box = (await line.boundingBox())!
    await page.mouse.move(box.x + 30, box.y + box.height / 2)
    await page.mouse.move(box.x + 50, box.y + box.height / 2)
    await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click({ timeout: 1000 })
    await expect(menu).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
  return menu
}

async function walk(lang: Lang) {
  // 浅色天青、浮岛书桌（同对照图）
  const run: Running = await launch(lib(lang), { CN_LANG: lang }, (vault) => {
    const ud = join(dirname(vault), 'user-data')
    mkdirSync(ud, { recursive: true })
    writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame: 'b', winBg: 'aurora' } }))
  })
  const { page, app, vault } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await armMenus(run)
    const course = cat(lang, '课程')
    const notePath = join(vault, course, '线性代数', '笔记.md')

    // 图标栏左下「最近删掉的」
    await expect(page.getByTestId('ab-trash')).toHaveAccessibleName(L(lang, '最近删掉的', 'Recently deleted'))

    // 文档里嵌的导图：头一行「导图 · 3个主题」「打开 ›」
    await open(page, lang, '笔记')
    const emb = pane(page).locator('[data-part="笔记里的导图块"]')
    await expect(emb).toHaveAttribute('aria-label', L(lang, '导图「导图」', 'Mind map “导图”'))
    await expect(emb).toContainText(L(lang, '导图 · 3个主题', '导图 · 3 topics'))
    await expect(emb).toContainText(L(lang, '打开 ›', 'Open ›'))

    // 块菜单：上移 / 下移、标成 AI 写的；点「上移」真把第二段挪到第一段前面
    const menu = await blockMenu(page, lang, '第二段。')
    for (const name of [L(lang, '上移', 'Move up'), L(lang, '下移', 'Move down'), L(lang, '标成 AI 写的', 'Mark as written by AI'), L(lang, '复制一块', 'Duplicate')]) {
      await expect(menu.getByRole('menuitem', { name })).toBeVisible()
    }
    await shot(page, 'block-menu', lang)
    await menu.getByRole('menuitem', { name: L(lang, '上移', 'Move up') }).click()
    await expect.poll(() => editorText(page)).toContain('第二段。\n\n第一段。')
    await waitSaved(page)
    expect(readFileSync(notePath, 'utf8')).toContain('第二段。\n\n第一段。')

    // / 菜单：「拍导图」和它的说明
    await pane(page).locator('.cm-line', { hasText: '第一段。' }).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type(L(lang, '/拍导图', '/snap'))
    const slash = page.locator('.slash-menu')
    await expect(slash).toBeVisible()
    await expect(slash.locator('button.on')).toContainText(L(lang, '拍导图', 'Snap a mind map'))
    await expect(slash).toContainText(L(lang, '拍手写的导图，插一块缩略图', 'Photo of a hand-drawn map'))
    await shot(page, 'slash', lang)
    await page.keyboard.press('Escape')

    // 白板右上角：缩放「100% ▾」，点开是缩放菜单
    await open(page, lang, '复习')
    const zoom = pane(page).getByTestId('board-corner').getByTestId('board-zoom')
    await expect(zoom).toHaveAccessibleName(L(lang, '缩放', 'Zoom'))
    await zoom.click()
    const zm = (await openedMenu(run)).map((m) => m.label)
    expect(zm).toEqual([L(lang, '放大', 'Zoom in'), L(lang, '缩小', 'Zoom out'), '100%', L(lang, '适合窗口', 'Fit to window'), '—', L(lang, '触控板捏合、按住 ⌘ 滚动也能缩放', 'Pinch or ⌘-scroll to zoom too')])
    await dismissMenu(run)
    await shot(page, 'board', lang)

    // 「课程」右键：新建一门课
    await leftView(page, L(lang, '文件', 'Files'))
    await page.locator(`[role=treeitem][data-path="${course}"]`).first().click({ button: 'right' })
    const fm = (await openedMenu(run)).map((m) => m.label)
    expect(fm.slice(0, 4)).toEqual([L(lang, '新建笔记', 'New note'), L(lang, '新建白板', 'New board'), L(lang, '新建一门课', 'New course'), L(lang, '新建文件夹', 'New folder')])
    await dismissMenu(run)

    // 右上角「网页占满 ↔ 还原」：右栏开着网页才有
    await page.getByRole('navigation', { name: L(lang, '右栏', 'Right sidebar') }).getByRole('button', { name: L(lang, '网页', 'Web'), exact: true }).click()
    const addr = page.locator('aside.right.web').getByRole('textbox', { name: '网址' })
    await addr.click()
    await addr.fill(pageUrl)
    await addr.press('Enter')
    const tb = page.getByTestId('tb-web')
    await expect(tb).toHaveAccessibleName(L(lang, '网页占满', 'Expand page'))
    await expect(tb).toHaveAttribute('data-tip', L(lang, '网页占满：中间那篇让出地方，剪的照样记进它', 'Expand page: the center note steps aside; clips still go into it'))
    await shot(page, 'web', lang)
    await tb.click()
    await expect(tb).toHaveAccessibleName(L(lang, '还原', 'Restore'))
    await expect(tb).toHaveAttribute('aria-pressed', 'true')
    await shot(page, 'web-full', lang)
    await tb.click()
    await expect(tb).toHaveAccessibleName(L(lang, '网页占满', 'Expand page'))
  } finally {
    await run.close()
  }
}

test('英文界面：合进 dev 后新加的字都是英文（导图块、块菜单、/ 拍导图、白板缩放、新建一门课、网页占满、最近删掉的）', async () => {
  await walk('en')
})

test('中文界面：同一套照旧中文', async () => {
  await walk('zh')
})
