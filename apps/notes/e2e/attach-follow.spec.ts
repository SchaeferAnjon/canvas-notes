// 附件跟着笔记走（2026-11-23，用户：「剪藏里面的东西我都已经删光了，但是附件里面的剪藏冰岛还有很多东西都没删」）。
// 用户那次删的是文件夹（「移到废纸篓：剪藏/第三方（1 个文件）」），删文件夹以前不带附件。真点：
// 1. 删一篇带图的笔记：图进废纸篓、和笔记同一次提交，别的笔记也在用的留下；底栏撤回都回来（再一次提交）；「最近删掉的」放回，图回原处。
// 2. 删文件夹：里面笔记的附件（附件/<文件夹>/、文中用到的 附件/ 别处的）一起走，同一次提交；「最近删掉的」放回一篇，它的图回来。
// 3. 改名、挪动笔记和文件夹：附件文件夹跟着走、链接跟着改。
// 4. 以前留下的「没人用的附件」：「最近删掉的」上面一行，中间按原来属于哪篇分组带缩略图，点一下一起进废纸篓、一次提交、底栏撤回。
// 一律无头（CN_E2E=1），「废纸篓」是测试的临时文件夹。CN_SHOTS 指着一个文件夹时顺便截图（交付页用）。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, leftView, tabOn, type Running } from './app'
import { LECTURE } from './fixtures/pdf'
import { solidPng } from './fixtures/png'
import { armMenus, pickMenu } from './menu'

const git = (vault: string, args: string[]) => execFileSync('git', ['-C', vault, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim()
const put = (vault: string, path: string, data: string | Buffer) => {
  mkdirSync(dirname(join(vault, path)), { recursive: true })
  writeFileSync(join(vault, path), data)
}
const png = (i: number) => solidPng(120 + i * 6, 90, [40 + ((i * 47) % 180), 90 + ((i * 31) % 140), 150 - ((i * 23) % 100)])
const tree = (page: Page) => page.getByRole('tree', { name: '全部文件' })
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
const toast = (page: Page) => page.getByTestId('toast')
const panel = (page: Page) => page.getByTestId('trash-panel')
const rows = (page: Page) => panel(page).getByRole('list', { name: '最近删掉的' }).getByRole('listitem')
const trashCell = (page: Page) => page.getByRole('navigation', { name: '左栏' }).getByTestId('ab-trash')
const head = (vault: string) => git(vault, ['log', '-1', '--format=%s'])
const headFiles = (vault: string) => git(vault, ['show', '--no-renames', '--name-only', '--format=', 'HEAD']).split('\n').filter(Boolean).sort()

async function shot(run: Running, name: string) {
  const dir = process.env.CN_SHOTS
  if (!dir) return
  await run.page.waitForTimeout(350)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(dir, `${name}.png`), Buffer.from(b64, 'base64'))
}
/** 目录树里一层层展开到这几个文件夹 */
async function reveal(page: Page, ...folders: string[]) {
  await leftView(page, '文件')
  for (const f of folders) {
    await expect(row(page, f)).toBeVisible()
    if ((await row(page, f).getAttribute('aria-expanded')) !== 'true') await row(page, f).locator('.ft-tw').click()
    await expect(row(page, f)).toHaveAttribute('aria-expanded', 'true')
  }
}
const size = (run: Running) => run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))

test('删一篇带图的笔记：图和笔记同一次提交进废纸篓，别的笔记也在用的留下；底栏撤回都回来；「最近删掉的」放回，图回原处', async () => {
  test.setTimeout(150_000)
  const run = await launch({
    '写作/极光.md': '# 极光\n\n![](../附件/写作/极光/绿光.png)\n\n![](../附件/写作/极光/共用.png)\n\n![](../附件/导入/老图.png)\n',
    '附件/写作/极光/绿光.png': png(1),
    '附件/写作/极光/没链着.png': png(2),
    '附件/写作/极光/共用.png': png(3),
    '附件/导入/老图.png': png(4),
    '写作/引用.md': '# 引用\n\n![](../附件/写作/极光/共用.png)\n',
  })
  const { page, vault } = run
  try {
    await size(run)
    await armMenus(run)
    await reveal(page, '写作')
    await row(page, '极光').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    const dlg = page.getByRole('dialog', { name: '把《极光》移到废纸篓？' })
    await expect(dlg.getByTestId('trash-note')).toHaveText('别的笔记也在用的1张不会一起删。勾不勾下次照这次。')
    await expect(dlg.locator('.t1')).toHaveText('连同3张图一起移到废纸篓')
    await shot(run, '1a-删一篇-确认')
    await dlg.getByRole('button', { name: '移到废纸篓' }).click()
    await expect(toast(page)).toContainText('已删除《极光》和3张图')
    // 同一次提交：笔记和 3 张图（自己文件夹里的 2 张、附件/导入/ 里文中用到的 1 张），共用的留着
    await expect.poll(() => head(vault)).toBe('移到废纸篓：写作/极光.md（连同 3 张图）')
    expect(headFiles(vault)).toEqual(['写作/极光.md', '附件/写作/极光/没链着.png', '附件/写作/极光/绿光.png', '附件/导入/老图.png'].sort())
    expect(readdirSync(join(vault, '附件/写作/极光'))).toEqual(['共用.png'])
    expect(existsSync(join(vault, '附件/导入'))).toBe(false)
    expect(git(vault, ['status', '--porcelain'])).toBe('')
    await shot(run, '1b-删一篇-删完')
    // 底栏撤回：笔记和图回原处，再一次提交
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(tabOn(page)).toHaveText('极光')
    await expect.poll(() => head(vault)).toBe('撤回删除：写作/极光.md（连同 3 张图）')
    expect(readdirSync(join(vault, '附件/写作/极光')).sort()).toEqual(['共用.png', '没链着.png', '绿光.png'])
    expect(existsSync(join(vault, '附件/导入/老图.png'))).toBe(true)
    expect(git(vault, ['status', '--porcelain'])).toBe('')

    // 再删一次，到「最近删掉的」里放回：图跟着回来
    await row(page, '极光').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    await dlg.getByRole('button', { name: '移到废纸篓' }).click()
    await expect.poll(() => existsSync(join(vault, '附件/写作/极光/绿光.png'))).toBe(false)
    await trashCell(page).click()
    await expect(rows(page).locator('.nm')).toHaveText(['极光'])
    await expect(rows(page).locator('.imgs')).toHaveText('和3张图')
    await expect(rows(page).locator('.when')).toHaveText('刚才')
    await rows(page).first().hover()
    await shot(run, '1c-最近删掉的-放回前')
    await rows(page).first().getByRole('button', { name: '放回' }).click()
    await expect(toast(page)).toContainText('「极光」放回了「写作」，连同3张图')
    await expect.poll(() => existsSync(join(vault, '写作/极光.md'))).toBe(true)
    expect(readdirSync(join(vault, '附件/写作/极光')).sort()).toEqual(['共用.png', '没链着.png', '绿光.png'])
    expect(existsSync(join(vault, '附件/导入/老图.png'))).toBe(true)
    expect(head(vault)).toMatch(/^放回：/)
    expect(headFiles(vault)).toEqual(['写作/极光.md', '附件/写作/极光/没链着.png', '附件/写作/极光/绿光.png', '附件/导入/老图.png'].sort())
  } finally {
    await run.close()
  }
})

test('删文件夹（用户删剪藏的那条路）：里面笔记的附件一起进废纸篓、同一次提交，外面也在用的留下；「最近删掉的」放回一篇，它的图回原处', async () => {
  test.setTimeout(150_000)
  const run = await launch({
    '剪藏/冰岛旅行/ttravel.md': '# ttravel\n\n![](../../附件/剪藏/冰岛旅行/ttravel/1.png)\n\n![](../../附件/剪藏/冰岛旅行/ttravel/2.png)\n\n视频里这一刻：![](../../附件/视频/yt-1/01-02.jpg)\n',
    '附件/剪藏/冰岛旅行/ttravel/1.png': png(5),
    '附件/剪藏/冰岛旅行/ttravel/2.png': png(6),
    '附件/视频/yt-1/01-02.jpg': png(7),
    '剪藏/冰岛旅行/第三方.md': '# 第三方\n\n![](../../附件/剪藏/冰岛旅行/第三方/共用.png)\n',
    '附件/剪藏/冰岛旅行/第三方/共用.png': png(8),
    '收件箱/摘一张.md': '# 摘一张\n\n![](../附件/剪藏/冰岛旅行/第三方/共用.png)\n',
  })
  const { page, vault } = run
  try {
    await size(run)
    await armMenus(run)
    await reveal(page, '剪藏')
    await row(page, '冰岛旅行').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    // 系统确认框（测试模式记下问的什么、当成点了「移到废纸篓」）
    const screen = () => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.slice())
    await expect.poll(screen).toContain('提示框：把「冰岛旅行」和里面 2 个文件移到废纸篓？')
    expect(await screen()).toContain('提示框说明：里面笔记的 3 个附件（图）一起移走，别的笔记也在用的留下。会提交一次，在历史里能撤回；也能在访达的废纸篓里找回。')
    await expect(toast(page)).toContainText('「冰岛旅行」和里面2个文件、3个附件移到了废纸篓，历史里能撤回')
    await expect.poll(() => head(vault)).toBe('移到废纸篓：剪藏/冰岛旅行（2 个文件，连同 3 个附件）')
    expect(headFiles(vault)).toEqual(['剪藏/冰岛旅行/ttravel.md', '剪藏/冰岛旅行/第三方.md', '附件/剪藏/冰岛旅行/ttravel/1.png', '附件/剪藏/冰岛旅行/ttravel/2.png', '附件/视频/yt-1/01-02.jpg'].sort())
    expect(existsSync(join(vault, '附件/剪藏/冰岛旅行/ttravel'))).toBe(false)
    expect(existsSync(join(vault, '附件/视频'))).toBe(false)
    expect(readdirSync(join(vault, '附件/剪藏/冰岛旅行/第三方'))).toEqual(['共用.png'])
    expect(git(vault, ['status', '--porcelain'])).toBe('')
    await shot(run, '2a-删文件夹-删完')

    // 「最近删掉的」：ttravel 带着 3 张图；放回它，图回原处
    await trashCell(page).click()
    await expect(rows(page).locator('.nm')).toHaveText(['ttravel', '第三方'])
    await expect(rows(page).first().locator('.imgs')).toHaveText('和3张图')
    await shot(run, '2b-删文件夹-最近删掉的')
    await rows(page).first().hover()
    await rows(page).first().getByRole('button', { name: '放回' }).click()
    await expect(toast(page)).toContainText('「ttravel」放回了「剪藏/冰岛旅行」，连同3张图')
    await expect.poll(() => existsSync(join(vault, '剪藏/冰岛旅行/ttravel.md'))).toBe(true)
    expect(readdirSync(join(vault, '附件/剪藏/冰岛旅行/ttravel')).sort()).toEqual(['1.png', '2.png'])
    expect(existsSync(join(vault, '附件/视频/yt-1/01-02.jpg'))).toBe(true)
    expect(head(vault)).toMatch(/^放回：/)
  } finally {
    await run.close()
  }
})

test('改名、挪动笔记和文件夹：附件文件夹跟着走，链接跟着改', async () => {
  test.setTimeout(150_000)
  const run = await launch({
    '写作/游记.md': '# 游记\n\n![](../附件/写作/游记/黑沙滩.png)\n',
    '附件/写作/游记/黑沙滩.png': png(9),
    '写作/书评/a.md': '# a\n\n![](../../附件/写作/书评/a/封面.png)\n',
    '附件/写作/书评/a/封面.png': png(10),
    '写作/目录.md': '# 目录\n\n[游记](游记.md) · [a](书评/a.md) · ![](../附件/写作/书评/a/封面.png)\n',
  })
  const { page, vault } = run
  const text = (p: string) => readFileSync(join(vault, p), 'utf8')
  try {
    await size(run)
    await armMenus(run)
    await reveal(page, '写作')
    // 笔记改名
    await row(page, '游记').click({ button: 'right' })
    await pickMenu(run, '重命名')
    const input = tree(page).getByRole('textbox', { name: '新名字' })
    await input.fill('冰岛游记')
    await input.press('Enter')
    await expect.poll(() => existsSync(join(vault, '附件/写作/冰岛游记/黑沙滩.png'))).toBe(true)
    expect(existsSync(join(vault, '附件/写作/游记'))).toBe(false)
    await expect.poll(() => text('写作/冰岛游记.md')).toContain('![](../附件/写作/冰岛游记/黑沙滩.png)')
    await expect.poll(() => text('写作/目录.md')).toContain('[游记](冰岛游记.md)')
    // 笔记挪进别的文件夹（右键「移到…」）
    await row(page, '冰岛游记').click({ button: 'right' })
    await pickMenu(run, '移到…')
    const mover = page.getByRole('dialog', { name: '移到' })
    await mover.getByRole('searchbox').fill('项目')
    await mover.getByRole('searchbox').press('Enter')
    await expect.poll(() => existsSync(join(vault, '附件/项目/冰岛游记/黑沙滩.png'))).toBe(true)
    expect(existsSync(join(vault, '附件/写作/冰岛游记'))).toBe(false)
    await expect.poll(() => text('项目/冰岛游记.md')).toContain('![](../附件/项目/冰岛游记/黑沙滩.png)')
    await expect.poll(() => text('写作/目录.md')).toContain('(../项目/冰岛游记.md)')
    // 挪一篇是一次提交：笔记、附件文件夹、改了链接的那篇都在里面
    await expect.poll(() => headFiles(vault)).toEqual(expect.arrayContaining(['写作/冰岛游记.md', '项目/冰岛游记.md', '附件/写作/冰岛游记/黑沙滩.png', '附件/项目/冰岛游记/黑沙滩.png', '写作/目录.md']))
    // 文件夹改名
    await row(page, '书评').click({ button: 'right' })
    await pickMenu(run, '重命名…')
    const fin = tree(page).getByRole('textbox')
    await fin.fill('书单')
    await fin.press('Enter')
    await expect.poll(() => existsSync(join(vault, '附件/写作/书单/a/封面.png'))).toBe(true)
    expect(existsSync(join(vault, '附件/写作/书评'))).toBe(false)
    await expect.poll(() => text('写作/书单/a.md')).toContain('![](../../附件/写作/书单/a/封面.png)')
    await expect.poll(() => text('写作/目录.md')).toContain('![](../附件/写作/书单/a/封面.png)')
    // 文件夹挪进别的文件夹
    await row(page, '书单').click({ button: 'right' })
    await pickMenu(run, '移到…')
    await mover.getByRole('searchbox').fill('项目')
    await mover.getByRole('searchbox').press('Enter')
    await expect.poll(() => existsSync(join(vault, '附件/项目/书单/a/封面.png'))).toBe(true)
    expect(existsSync(join(vault, '附件/写作/书单'))).toBe(false)
    await expect.poll(() => text('项目/书单/a.md')).toContain('![](../../附件/项目/书单/a/封面.png)')
    await expect.poll(() => text('写作/目录.md')).toContain('![](../附件/项目/书单/a/封面.png)')
    // 挪文件夹是一次提交：附件文件夹和改了链接的那篇都在里面（改名笔记照旧留给自动提交）
    await expect.poll(() => head(vault)).toBe('移动文件夹：写作/书单 → 项目/书单')
    await expect.poll(() => headFiles(vault)).toEqual(expect.arrayContaining(['附件/写作/书单/a/封面.png', '附件/项目/书单/a/封面.png', '项目/书单/a.md', '写作/目录.md']))
  } finally {
    await run.close()
  }
})

/** 用户真库里的样子：笔记已经删了（只删了 md），附件还在；还有不能列的几种 */
function leftovers(vault: string) {
  put(vault, '剪藏/第三方/冰岛.md', '# 冰岛\n\n![](../../附件/剪藏/第三方/冰岛/瀑布.png)\n')
  for (let i = 1; i <= 5; i++) put(vault, `附件/剪藏/第三方/冰岛/${['瀑布', '黑沙滩', '极光', '冰川', '蓝湖'][i - 1]}.png`, png(20 + i))
  put(vault, '剪藏/视频/讲座.md', '# 讲座\n\n![](../../附件/视频/yt-9/03-04.jpg)\n')
  put(vault, '附件/视频/yt-9/03-04.jpg', png(30))
  put(vault, '附件/视频/yt-9/cover.jpg', png(31))
  // 还在用的：链着的、iPad 手写（按文档名）、首页封面
  put(vault, '写作/测试.md', '# 测试\n\n![](../附件/写作/测试/在用.png)\n')
  put(vault, '附件/写作/测试/在用.png', png(32))
  put(vault, '附件/手写/测试/手写-1.png', png(33))
  put(vault, '附件/封面/首页.jpg', png(34))
  git(vault, ['add', '-A'])
  git(vault, ['commit', '-q', '-m', '建好'])
  git(vault, ['rm', '-q', '剪藏/第三方/冰岛.md', '剪藏/视频/讲座.md'])
  git(vault, ['commit', '-q', '-m', '移到废纸篓：剪藏/第三方（1 个文件）'])
  // launch 最后还要提交一次「样本」
  put(vault, '写作/随笔.md', '# 随笔\n')
}

test('以前留下的没人用的附件：「最近删掉的」上面一行，中间按原来属于哪篇分组带缩略图；点一下一起进废纸篓、一次提交、底栏撤回；一组一组也能移', async () => {
  test.setTimeout(150_000)
  const run = await launch({ '写作/日记.md': '# 日记\n' }, {}, leftovers)
  const { page, vault } = run
  try {
    await size(run)
    await trashCell(page).click()
    const orow = panel(page).getByTestId('orphan-row')
    await expect(orow.locator('.nm')).toHaveText('没人用的附件')
    await expect(orow.locator('.imgs')).toHaveText('7个')
    await orow.click()
    await expect(tabOn(page)).toHaveText('最近删掉的')
    const view = page.getByTestId('orphans')
    await expect(view.locator('.tr-bar .t')).toContainText('没人用的附件7个')
    await expect(view.locator('.or-name')).toHaveText(['冰岛', '讲座'])
    await expect(view.locator('.or-meta').first()).toHaveText('那篇已经删了 · 原来在「剪藏 / 第三方」 · 5个')
    await expect(view.locator('.or-grp').first().locator('img')).toHaveCount(5)
    // 缩略图真画出来了
    await expect.poll(() => view.locator('.or-grp img').first().evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(100)
    await expect(orow).toHaveClass(/\bon\b/)
    await shot(run, '4a-没人用的附件')

    // 只移「讲座」那一组
    const before = Number(git(vault, ['rev-list', '--count', 'HEAD']))
    await view.locator('.or-grp').nth(1).getByRole('button', { name: '移到废纸篓' }).click()
    await expect(toast(page)).toContainText('2个没人用的附件移到了废纸篓，在「最近删掉的」里能放回')
    await expect.poll(() => head(vault)).toBe('移到废纸篓：没人用的附件 2 个')
    expect(Number(git(vault, ['rev-list', '--count', 'HEAD']))).toBe(before + 1)
    expect(existsSync(join(vault, '附件/视频'))).toBe(false)
    await expect(view.locator('.or-name')).toHaveText(['冰岛'])
    await expect(orow.locator('.imgs')).toHaveText('5个')
    // 「最近删掉的」里是一行「「讲座」的附件」
    await expect(rows(page).locator('.nm')).toContainText(['「讲座」的附件'])

    // 「全部移到废纸篓」
    await view.getByRole('button', { name: '全部移到废纸篓' }).click()
    await expect(toast(page)).toContainText('5个没人用的附件移到了废纸篓')
    await expect.poll(() => head(vault)).toBe('移到废纸篓：没人用的附件 5 个')
    expect(existsSync(join(vault, '附件/剪藏'))).toBe(false)
    // 不该列的都还在
    for (const p of ['附件/写作/测试/在用.png', '附件/手写/测试/手写-1.png', '附件/封面/首页.jpg']) expect(existsSync(join(vault, p))).toBe(true)
    await expect(panel(page).getByTestId('orphan-row')).toHaveCount(0)
    await expect(page.getByTestId('trash-page')).toContainText('在左栏「最近删掉的」里点一条，看它删掉前的样子')
    await expect(rows(page).locator('.nm')).toContainText(['「冰岛」的附件'])
    await shot(run, '4b-没人用的附件-移完')
    // 底栏撤回：反向提交，5 张回原处，这一行回来
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => (existsSync(join(vault, '附件/剪藏/第三方/冰岛')) ? readdirSync(join(vault, '附件/剪藏/第三方/冰岛')).length : 0)).toBe(5)
    await expect(panel(page).getByTestId('orphan-row').locator('.imgs')).toHaveText('5个')
    expect(git(vault, ['status', '--porcelain'])).toBe('')
  } finally {
    await run.close()
  }
})

test('改名一篇带图的笔记时，开着的读 PDF 笔记里指向那张图的链接在编辑器里也跟着变（右栏读 PDF 的笔记、疑问卡这些地方读了它也不吞掉这次改动）', async () => {
  // 收尾清单：读笔记的地方（主进程 reading:note、疑问卡、名词卡……）用 vault.read 时把盘上的字记成「编辑器手里的」，
  // 改名挪附件改好的链接监听比对时当成没变、不报给编辑器（同 g2-editor 粘贴截图那条、ai-note-switch 修的 ainote:has）
  const note = '课程/线代/第3讲 笔记.md'
  const run = await launch({
    '课程/线代/第3讲.pdf': LECTURE,
    [note]: '# 第3讲 笔记\n\n## 第 2 页 · 旋转矩阵\n\n![甲那张图](../../附件/收件箱/甲/图.png)\n\n> [!question] 给我讲解一下\n\n回答原文。\n',
    '收件箱/甲.md': '# 甲\n\n![](../附件/收件箱/甲/图.png)\n',
    '附件/收件箱/甲/图.png': png(40),
  })
  const { page, vault } = run
  const slot = (p: 0 | 1) => page.locator(`main.center > .cslot[data-pane="${p}"]:not([hidden])`)
  const open = async (name: string) => {
    await page.keyboard.press('Meta+o')
    await page.keyboard.type(name)
    await expect(page.getByRole('option').first()).toContainText(name)
    await page.keyboard.press('Enter')
    await expect(tabOn(page)).toHaveText(new RegExp(name))
  }
  try {
    await size(run)
    await armMenus(run)
    // 左边那格：读 PDF 的笔记当文档开着；右边那格：那份 PDF（它的 AI 栏、笔记会去读这篇笔记）
    await open('第3讲 笔记')
    await page.keyboard.press('Control+Backslash')
    await expect(page.locator('main.center')).toHaveClass(/\bsplit\b/)
    await open('第3讲.pdf')
    await expect(slot(0).locator('.cm-image img')).toBeVisible()
    // 目录树里把甲改名成乙：附件/收件箱/甲/ 挪成 附件/收件箱/乙/，读 PDF 笔记里的链接跟着改
    await reveal(page, '收件箱')
    await row(page, '甲').click({ button: 'right' })
    await pickMenu(run, '重命名')
    const input = tree(page).getByRole('textbox', { name: '新名字' })
    await input.fill('乙')
    await input.press('Enter')
    await expect.poll(() => existsSync(join(vault, '附件/收件箱/乙/图.png'))).toBe(true)
    await expect.poll(() => readFileSync(join(vault, note), 'utf8')).toContain('![甲那张图](../../附件/收件箱/乙/图.png)')
    // 编辑器里是新的链接，图照样画得出来
    const editor = () => slot(0).locator('.cm-editor').evaluate((el) => (el as HTMLElement & { cnText: string }).cnText)
    await expect.poll(editor).toContain('![甲那张图](../../附件/收件箱/乙/图.png)')
    await expect(slot(0).locator('.cm-image img')).toHaveAttribute('src', /%E4%B9%99/)
    // 再在这篇里打几个字存盘：旧链接没写回去
    await slot(0).locator('.cm-line', { hasText: '回答原文' }).click()
    await page.keyboard.press('End')
    await page.keyboard.type('又')
    await page.keyboard.press('Meta+s')
    await expect.poll(() => readFileSync(join(vault, note), 'utf8')).toContain('回答原文。又')
    expect(readFileSync(join(vault, note), 'utf8')).toContain('附件/收件箱/乙/图.png')
  } finally {
    await run.close()
  }
})
