import { expect, test, type Page } from '@playwright/test'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { acts, launch, leftView, openNote, type Running } from './app'
import { armMenus, enabledOf, menuLabels, openedMenu, pickMenu, type MenuShot } from './menu'

// 文档「⋯」、文件树右键加「导出 PDF…」「导出为 Markdown…」（用户：「在这里再帮我加导出 PDF 导出为 Markdown」）。
// 真点菜单项；系统存储面板换成返回临时文件夹里的路径（记下默认的名字和位置）；量 PDF 的页数和抽出来的字，看 md 文件夹里的文件和链接。

// 8×8 的红色 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC', 'base64')
const DOC = [
  '# 竞赛调研',
  '',
  '几家竞品的价格，见 [[别的笔记]] 和 [[别的笔记#第二节|第二节]]。',
  '',
  '| 产品 | 价格 |',
  '| --- | --- |',
  '| 甲软件 | 九十九元 |',
  '| 乙软件 | 免费 |',
  '',
  '![截图](../附件/写作/竞赛调研/截图1.png)',
  '',
  '![[logo.png]]',
  '',
  '$$',
  'E = mc^2',
  '$$',
  '',
  '> [!note] 提示',
  '> 价格是十一月看的',
  '',
].join('\n')
const FILES = {
  '写作/竞赛调研.md': DOC,
  '写作/别的笔记.md': '# 别的笔记\n\n## 第二节\n\n字\n',
  '附件/写作/竞赛调研/截图1.png': PNG,
  '图库/logo.png': PNG,
  '写作/白板一.md': '---\ntype: board\n---\n# 白板一\n\n## 一列\n\n一张卡\n',
}

const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const row = (page: Page, name: string) =>
  tree(page)
    .getByRole('treeitem')
    .filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
    .first()

/** 系统存储面板换成：记下默认路径，返回 out 里同名的路径 */
async function fakeSave(run: Running, out: string) {
  await run.app.evaluate(({ dialog }, out) => {
    const g = globalThis as unknown as { saveAsked: string[] }
    g.saveAsked = []
    dialog.showSaveDialog = (async (...args: unknown[]) => {
      const opts = args.find((a): a is Electron.SaveDialogOptions => !!a && typeof a === 'object' && 'defaultPath' in a)!
      g.saveAsked.push(opts.defaultPath!)
      return { canceled: false, filePath: `${out}/${opts.defaultPath!.split('/').pop()}` }
    }) as typeof dialog.showSaveDialog
  }, out)
}
const asked = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { saveAsked: string[] }).saveAsked)

/** 菜单项的悬停说明（MenuItem.toolTip） */
const tipOf = (run: Running, label: string) =>
  run.app.evaluate((_e, label) => {
    const m = (globalThis as unknown as { cnMenu: { menu: Electron.Menu } | null }).cnMenu
    return m?.menu.items.find((i) => i.label === label)?.toolTip ?? null
  }, label)

async function pdfText(file: string): Promise<{ pages: number; text: string }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: false }).promise
  let text = ''
  for (let i = 1; i <= doc.numPages; i++) text += (await (await doc.getPage(i)).getTextContent()).items.map((x) => ('str' in x ? x.str : '')).join(' ') + '\n'
  return { pages: doc.numPages, text }
}

/** 照真菜单的项画一个 macOS 样子的菜单（系统菜单截不到），灰的项画灰 */
async function drawMenu(page: Page, x: number, y: number, items: MenuShot[]) {
  await page.evaluate(
    ({ x, y, items }) => {
      const m = document.createElement('div')
      m.id = 'shot-menu'
      m.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:99999;min-width:190px;padding:5px;border-radius:7px;font:13px -apple-system,'PingFang SC',sans-serif;background:rgba(238,238,240,.9);backdrop-filter:blur(20px) saturate(1.6);box-shadow:0 0 0 .5px rgba(0,0,0,.25),0 8px 24px rgba(0,0,0,.22);color:#1d1d1f`
      for (const i of items) {
        const it = document.createElement('div')
        if (i.label === '—') it.style.cssText = 'height:1px;margin:5px 9px;background:rgba(0,0,0,.12)'
        else {
          it.textContent = (i.checked ? '✓ ' : '') + i.label
          it.style.cssText = `padding:3px 10px;border-radius:4px;line-height:16px;${i.label === '导出 PDF…' ? 'background:#0a63d7;color:#fff' : i.enabled ? '' : 'color:rgba(0,0,0,.28)'}`
        }
        m.append(it)
      }
      document.body.append(m)
    },
    { x, y, items },
  )
}

test('文档「⋯」导出 PDF、导出为 Markdown；文件树右键也有；白板上两项是灰的', async () => {
  const run = await launch(FILES)
  const { page } = run
  const out = mkdtempSync(join(tmpdir(), 'cn-export-'))
  try {
    await openNote(page, '竞赛调研')
    await fakeSave(run, out)
    await armMenus(run)
    await acts(page).getByRole('button', { name: '更多' }).click()
    const items = await openedMenu(run)
    const labels = menuLabels(items)
    // 在「在访达中显示 / 拷贝路径 / 拷贝双链」那一组下面另成一组
    const at = labels.indexOf('拷贝双链')
    expect(labels.slice(at - 2, at + 4)).toEqual(['在访达中显示', '拷贝路径', '拷贝双链', '导出 PDF…', '导出为 Markdown…', '移到废纸篓'])
    const seps = items.map((i) => i.label)
    expect(seps.slice(seps.indexOf('拷贝双链'), seps.indexOf('移到废纸篓') + 1)).toEqual(['拷贝双链', '—', '导出 PDF…', '导出为 Markdown…', '—', '移到废纸篓'])
    expect(enabledOf(items, '导出 PDF…')).toBe(true)
    expect(enabledOf(items, '导出为 Markdown…')).toBe(true)
    if (process.env.CN_SHOT_DIR) {
      mkdirSync(process.env.CN_SHOT_DIR, { recursive: true })
      const b = (await acts(page).getByRole('button', { name: '更多' }).boundingBox())!
      await drawMenu(page, b.x + b.width - 200, b.y + b.height + 4, items)
      await page.waitForTimeout(300)
      await page.screenshot({ path: join(process.env.CN_SHOT_DIR, '1-文档更多菜单.png') })
      await page.evaluate(() => document.getElementById('shot-menu')?.remove())
    }

    // 导出 PDF：默认「下载/竞赛调研.pdf」
    await pickMenu(run, '导出 PDF…')
    const pdf = join(out, '竞赛调研.pdf')
    await expect.poll(() => existsSync(pdf), { timeout: 30_000 }).toBe(true)
    expect((await asked(run))[0]).toMatch(/\/Downloads\/竞赛调研\.pdf$/)
    expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
    if (process.env.CN_SHOT_DIR) copyFileSync(pdf, join(process.env.CN_SHOT_DIR, '竞赛调研.pdf'))
    const p = await pdfText(pdf)
    expect(p.pages).toBeGreaterThan(0)
    for (const s of ['竞赛调研', '甲软件', '九十九元', '乙软件', '提示', '价格是十一月看的']) expect(p.text.normalize('NFKC').replace(/\s+/g, '')).toContain(s)
    // 印完打印层拿掉，窗口照常
    await expect(page.locator('#cn-print')).toHaveCount(0)
    await expect(page.getByTestId('toast')).toContainText('已导出 PDF：竞赛调研.pdf')

    // 导出为 Markdown：默认「下载/竞赛调研」，一个文件夹：竞赛调研.md + 附件/
    await acts(page).getByRole('button', { name: '更多' }).click()
    await pickMenu(run, '导出为 Markdown…')
    const dir = join(out, '竞赛调研')
    await expect.poll(() => existsSync(join(dir, '竞赛调研.md'))).toBe(true)
    expect((await asked(run))[1]).toMatch(/\/Downloads\/竞赛调研$/)
    expect(readdirSync(join(dir, '附件')).sort()).toEqual(['logo.png', '截图1.png'])
    expect(readFileSync(join(dir, '附件', 'logo.png')).equals(PNG)).toBe(true)
    const md = readFileSync(join(dir, '竞赛调研.md'), 'utf8')
    expect(md).toContain('![截图](附件/截图1.png)')
    expect(md).toContain('![logo](附件/logo.png)')
    // 双链：那篇不在导出的文件夹里，只留字
    expect(md).toContain('几家竞品的价格，见 别的笔记 和 第二节。')
    expect(md).not.toContain('[[')
    expect(md).toContain('| 甲软件 | 九十九元 |')
    expect(md).toContain('$$\nE = mc^2\n$$')
    // 库里那篇一个字没动
    expect(readFileSync(join(run.vault, '写作/竞赛调研.md'), 'utf8')).toBe(DOC)

    // 文件树右键：同样两项；白板那篇两项灰掉，悬停说为什么
    await leftView(page, '文件')
    if ((await row(page, '写作').getAttribute('aria-expanded')) !== 'true') await row(page, '写作').locator('.ft-tw').click()
    await row(page, '竞赛调研').click({ button: 'right' })
    const treeItems = await openedMenu(run)
    expect(enabledOf(treeItems, '导出 PDF…')).toBe(true)
    expect(enabledOf(treeItems, '导出为 Markdown…')).toBe(true)
    await pickMenu(run, '导出为 Markdown…')
    await expect.poll(() => asked(run).then((a) => a.length)).toBe(3)
    await armMenus(run)
    await row(page, '白板一').click({ button: 'right' })
    const boardItems = await openedMenu(run)
    expect(enabledOf(boardItems, '导出 PDF…')).toBe(false)
    expect(enabledOf(boardItems, '导出为 Markdown…')).toBe(false)
    expect(await tipOf(run, '导出 PDF…')).toBe('白板 / 数据库暂不支持导出')

    // 白板打开着（白板看法），「⋯」里这两项也是灰的
    await armMenus(run)
    await row(page, '白板一').click()
    await expect(page.locator('.pane:not([hidden])').locator('[data-testid="doc-board"], [data-testid="board"]').first()).toBeVisible()
    await acts(page).getByRole('button', { name: '更多' }).click()
    const boardMore = await openedMenu(run)
    expect(enabledOf(boardMore, '导出 PDF…')).toBe(false)
    expect(enabledOf(boardMore, '导出为 Markdown…')).toBe(false)
    expect(await tipOf(run, '导出为 Markdown…')).toBe('白板 / 数据库暂不支持导出')
  } finally {
    await run.close()
    rmSync(out, { recursive: true, force: true })
  }
})
