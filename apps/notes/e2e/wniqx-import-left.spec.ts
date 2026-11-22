// 整库导入原样摆最外层、「用预设的分类」开关、把自己的文件夹放到左边（task-wniqx）。
// 用户定了「都按推荐来」，规格和图在 /private/tmp/canvas-notes-visual/09-导入后左栏/（section.md 三节、proto-pin-folder.html）：
// ① 「导入旧笔记」选整个 Obsidian 库：原来的顶层文件夹原样放在库的最外层、和分类同级；和分类同名的合到一起，同名笔记加「 2」；
//    双链、图片照旧；一次提交，能撤回；只选几个文件夹时照旧先进 收件箱/导入/<库名>/。
// ② 设置 › 文件和附件 › 左栏「用预设的分类」（默认开）：关掉以后图标栏只剩收件箱和自己放上去的几格，树里不分组、分类当普通文件夹按名字排、
//    空的分类不画、首页不写「分类」和「放什么」；文件一篇不动；再打开回到原样。
// ③ 从树里按住一个文件夹拖到图标栏：落点一道线、旁边「松手：放到左边」，松手就放上去；自己放的几格能拖着换顺序（「松手：挪到这里」）；
//    右键那一格「换图标和颜色…」排最前；「从左边拿下」能撤回。
// 一律无头（CN_E2E=1），菜单换成记录器（e2e/menu.ts），开关真点、拖是真按下真挪真松手、导入真导一个假的 Obsidian 库。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { launch, leftView, pane, tabOn, type Running } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

const SHOTS = process.env.CN_SHOTS_DIR
const shot = async (page: Page, name: string) => SHOTS && (await page.screenshot({ path: join(SHOTS, `${name}.png`) }))
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, '-c', 'core.quotepath=false', ...args], { encoding: 'utf8' })
const side = (page: Page) => page.locator('aside.side')
const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const barNames = (page: Page) => bar(page).locator('button.ab').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const cell = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })
const tree = (page: Page) => side(page).getByRole('tree')
const item = (page: Page, path: string) => tree(page).locator(`[role="treeitem"][data-path="${path}"]`)
/** 最外层那几行（第一行是库本身，最外层挂在它下面是第 2 层） */
const topNames = (page: Page) => tree(page).locator('[role=treeitem][aria-level="2"] .truncate').allTextContents()
const groupHeads = (page: Page) => tree(page).locator('.ft-gh span:first-child').allTextContents()
const leftJson = (vault: string) => JSON.parse(readFileSync(join(vault, '.canvas-notes/左栏.json'), 'utf8')) as { 左边: string[]; 预设分类?: boolean; 收起的分类?: string[] }
const sheet = (page: Page) => page.getByRole('dialog', { name: '导入旧笔记' })
const settings = (page: Page) => page.getByRole('dialog', { name: '设置' })

/** 照设计图那个样本库：八个分类里有几篇（写作、生活空着），加上自己的几个文件夹（像导进来以后的样子） */
const LIBRARY: Record<string, string> = {
  '收件箱/周三组会要问的.md': '# 周三组会要问的\n',
  '收件箱/一个 App 的点子.md': '# 一个 App 的点子\n',
  '课程/ecp/课程大纲.md': '# 课程大纲\n',
  '课程/study project/学习笔记：动手学深度学习.md': '# 学习笔记\n',
  '阅读/巴菲特传（纪念版）.md': '# 巴菲特传\n',
  '阅读/杀死一只知更鸟.md': '# 杀死一只知更鸟\n\n库里原来的。\n',
  '剪藏/冰岛旅行/一、最佳旅游季节.md': '# 一、最佳旅游季节\n',
  '周记/2026 第46周.md': '# 2026 第46周\n',
  '项目/冰岛自驾/行程.md': '# 行程\n',
  '读书笔记/《思考，快与慢》.md': '# 思考，快与慢\n',
  '读书笔记/系统1和系统2.md': '# 系统1和系统2\n',
  '工作/周会/2026-11-17 周会.md': '# 周会\n',
  '工作/项目A 需求.md': '# 项目A 需求\n',
  '灵感/一句话想法.md': '# 一句话想法\n',
  '日记/2026-11-18.md': '# 2026-11-18\n',
  '首页.md': '# 首页\n',
}
/** 空着的分类：Git 不记空文件夹，提交前在磁盘上建出来（和用户库里建过又清空的一样） */
const emptyCats = (vault: string) => ['写作', '生活'].forEach((d) => mkdirSync(join(vault, d), { recursive: true }))

const theme = (skin: string, frame: 'a' | 'b' = 'b') => (vault: string) => {
  emptyCats(vault)
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin, frame } }))
}

async function start(files: Record<string, string> = LIBRARY, env: Record<string, string> = {}, skin = 'sky', frame: 'a' | 'b' = 'b'): Promise<Running> {
  const run = await launch(files, env, theme(skin, frame))
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await armMenus(run)
  await leftView(run.page, '文件')
  return run
}

/** 一个假的 Obsidian 库：日记、读书笔记（双链、一张图）、工作（子文件夹）、灵感、和分类同名的「阅读」（同名笔记）、散放的「首页」 */
function obsidianVault(): string {
  const d = join(mkdtempSync(join(tmpdir(), 'cn-e2e-obs-')), '我的Obsidian库')
  const put = (p: string, s: string | Buffer) => {
    mkdirSync(dirname(join(d, p)), { recursive: true })
    writeFileSync(join(d, p), s)
  }
  put('.obsidian/app.json', '{"attachmentFolderPath":"附件"}')
  put('附件/封面.jpg', readFileSync(join(__dirname, 'fixtures/handwritten-map.jpg')))
  put('读书笔记/《思考，快与慢》.md', '# 思考，快与慢\n\n见 [[系统1和系统2]]。\n\n![[封面.jpg|200]]\n')
  put('读书笔记/系统1和系统2.md', '# 系统1和系统2\n\n回到 [[《思考，快与慢》]]。\n')
  put('读书笔记/《置身事内》.md', '# 置身事内\n')
  put('工作/周会/2026-11-17 周会.md', '# 周会\n')
  put('工作/项目A 需求.md', '# 项目A 需求\n')
  put('灵感/一句话想法.md', '# 一句话想法\n')
  put('日记/2026-11-18.md', '# 2026-11-18\n')
  put('日记/2026-11-19.md', '# 2026-11-19\n')
  put('阅读/杀死一只知更鸟.md', '# 杀死一只知更鸟\n\nObsidian 里写的。\n')
  put('首页.md', '# 首页\n\n[[日记/2026-11-18|昨天]]\n')
  return d
}

async function openImport(page: Page) {
  await page.keyboard.press('Meta+k')
  await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('导入旧笔记')
  await page.getByRole('option', { name: /导入旧笔记…/ }).click()
  await sheet(page).getByRole('button', { name: /^Markdown文件夹/ }).click()
}

test('① 整个 Obsidian 库：顶层文件夹原样放在最外层、和分类同级；同名文件夹合并、同名笔记加「 2」；双链和图照旧；一次提交，撤回回到导入前；只选几个文件夹进收件箱', async () => {
  const src = obsidianVault()
  const base = { '收件箱/周三组会要问的.md': '# 周三组会要问的\n', '阅读/杀死一只知更鸟.md': '# 杀死一只知更鸟\n\n库里原来的。\n', '课程/ecp/课程大纲.md': '# 课程大纲\n' }
  const run = await start(base, { CN_IMPORT_DIR: src })
  const { page, vault } = run
  try {
    const before = Number(git(vault, 'rev-list', '--count', 'HEAD').trim())
    await openImport(page)
    await expect(sheet(page).getByTestId('import-summary')).toContainText('10篇')
    // 选的是整个库：说清楚放哪
    await expect(sheet(page).getByTestId('import-where')).toHaveText('整个库：原来的文件夹原样放在最外层，和分类同级；和分类同名的合在一起，同名的笔记加「 2」')
    await shot(page, 'wniqx-import-1-folders')
    await sheet(page).getByRole('button', { name: '导入10篇' }).click()
    const result = sheet(page).getByTestId('import-result')
    await expect(result).toContainText('从「我的Obsidian库」导入了10篇', { timeout: 15_000 })
    await expect(result).toContainText('原样放在库的最外层')
    await shot(page, 'wniqx-import-2-result')
    expect(Number(git(vault, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 1)
    expect(git(vault, 'status', '--porcelain')).toBe('')
    // 原样摆在最外层，不再塞进 收件箱/导入/
    expect(existsSync(join(vault, '收件箱/导入'))).toBe(false)
    for (const p of ['读书笔记/《思考，快与慢》.md', '读书笔记/系统1和系统2.md', '工作/周会/2026-11-17 周会.md', '灵感/一句话想法.md', '日记/2026-11-19.md', '首页.md'])
      expect(existsSync(join(vault, p)), p).toBe(true)
    // 和分类「阅读」同名：合在一起；同名的笔记加「 2」，原来那篇不动
    expect(readFileSync(join(vault, '阅读/杀死一只知更鸟.md'), 'utf8')).toBe('# 杀死一只知更鸟\n\n库里原来的。\n')
    expect(readFileSync(join(vault, '阅读/杀死一只知更鸟 2.md'), 'utf8')).toContain('Obsidian 里写的。')
    // 双链照旧（名字不重的只留名字）；图拷进 附件/导入/我的Obsidian库/，链接是从这篇算的相对路径、宽留着
    const main = readFileSync(join(vault, '读书笔记/《思考，快与慢》.md'), 'utf8')
    expect(main).toContain('见 [[系统1和系统2]]。\n')
    expect(main).toContain('![|200](../附件/导入/我的Obsidian库/附件/封面.jpg)\n')
    expect(existsSync(join(vault, '附件/导入/我的Obsidian库/附件/封面.jpg'))).toBe(true)
    expect(readFileSync(join(vault, '首页.md'), 'utf8')).toContain('[[2026-11-18|昨天]]')
    // 撤回：一次反向提交，库回到导入前
    await sheet(page).getByRole('button', { name: '撤回这次导入' }).click()
    await expect(page.getByTestId('toast')).toContainText('撤回了这次导入')
    expect(Number(git(vault, 'rev-list', '--count', 'HEAD').trim())).toBe(before + 2)
    for (const p of ['读书笔记', '工作', '灵感', '日记', '首页.md', '阅读/杀死一只知更鸟 2.md', '附件/导入']) expect(existsSync(join(vault, p)), p).toBe(false)
    expect(readFileSync(join(vault, '阅读/杀死一只知更鸟.md'), 'utf8')).toBe('# 杀死一只知更鸟\n\n库里原来的。\n')

    // 只选几个文件夹（去掉「日记」）：照旧先进 收件箱/导入/我的Obsidian库/
    await openImport(page)
    await sheet(page).getByRole('group', { name: '要导入的文件夹' }).getByRole('checkbox', { name: '日记', exact: true }).uncheck()
    await expect(sheet(page).getByTestId('import-where')).toHaveText('只选了几个文件夹：先放进 收件箱/导入/我的Obsidian库/，梦游再分')
    await sheet(page).getByRole('button', { name: '导入8篇' }).click()
    await expect(sheet(page).getByTestId('import-result')).toContainText('进了收件箱/导入/我的Obsidian库/', { timeout: 15_000 })
    expect(existsSync(join(vault, '收件箱/导入/我的Obsidian库/读书笔记/《思考，快与慢》.md'))).toBe(true)
    expect(existsSync(join(vault, '读书笔记'))).toBe(false)
    await sheet(page).getByRole('button', { name: '撤回这次导入' }).click()
    await expect.poll(() => existsSync(join(vault, '收件箱/导入'))).toBe(false)

    // 再导整个库：树里分类照旧在上面分组，导进来的文件夹在「不在分类里的」，和分类同一层；打开那一篇，图画得出来
    await openImport(page)
    await sheet(page).getByRole('button', { name: '导入10篇' }).click()
    await expect(sheet(page).getByTestId('import-result')).toContainText('原样放在库的最外层', { timeout: 15_000 })
    await sheet(page).getByRole('button', { name: '关闭' }).click()
    await expect.poll(() => topNames(page)).toEqual(['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活', '读书笔记', '附件', '工作', '灵感', '日记', '首页'])
    await item(page, '读书笔记').locator('.ft-tw').click()
    await item(page, '读书笔记/《思考，快与慢》.md').click()
    await expect(tabOn(page)).toHaveText('《思考，快与慢》')
    const img = pane(page).locator('.cm-content img[src*="jpg"]').first()
    await expect.poll(() => img.evaluate((e) => (e as HTMLImageElement).complete && (e as HTMLImageElement).naturalWidth > 0), { timeout: 5000 }).toBe(true)
    await shot(page, 'wniqx-import-3-tree')
  } finally {
    await run.close()
    rmSync(dirname(src), { recursive: true, force: true })
  }
})

test('② 设置 › 文件和附件 › 左栏「用预设的分类」：关掉后图标栏只剩收件箱和自己放的几格，树不分组、按名字排、空的分类不画，首页不写「分类」；文件不动；打开回到原样', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    // 读书笔记先放到左边（自己放的一格，关掉预设也留着）
    await item(page, '读书笔记').click({ button: 'right' })
    await pickMenu(run, '放到左边')
    await leftView(page, '文件')
    const CATS = ['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活']
    expect(await barNames(page)).toEqual(['文件', '待办', '最近', '书桌', ...CATS, '读书笔记', '梦游报告', '库', '设置和外观'])
    expect(await groupHeads(page)).toEqual(['读进来的', '自己写的', '不在分类里的'])
    const notesBefore = git(vault, 'ls-files').split('\n').filter((p) => p.endsWith('.md')).sort()

    await page.keyboard.press('Meta+,')
    await settings(page).getByRole('navigation', { name: '设置分页' }).getByRole('button', { name: '文件和附件', exact: true }).click()
    const group = settings(page).getByRole('group', { name: '左栏' })
    await expect(group.locator('.sa-lb')).toHaveText(['用预设的分类', '收件箱', '放在左边的文件夹'])
    await expect(group.locator('[data-row="leftOwn"] .sa-cc')).toHaveText('1个')
    await expect(group.locator('[data-row="leftInbox"] .sa-cc')).toHaveText('一直在')
    const sw = group.getByRole('switch', { name: '用预设的分类' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await shot(page, 'wniqx-presets-1-settings')
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('settings-toast')).toContainText('预设分类关掉了：文件夹和笔记都没动，只是当普通文件夹显示')
    await shot(page, 'wniqx-presets-2-settings-off')
    await page.keyboard.press('Escape')
    await expect(settings(page)).toHaveCount(0)

    // 图标栏：收件箱和自己放的那一格
    expect(await barNames(page)).toEqual(['文件', '待办', '最近', '书桌', '收件箱', '读书笔记', '梦游报告', '库', '设置和外观'])
    // 树：没有分组标题；收件箱在最前，别的按名字排；空的写作、生活不画；分类是普通文件夹的图标
    expect(await groupHeads(page)).toEqual([])
    expect(await topNames(page)).toEqual(['收件箱', '读书笔记', '工作', '剪藏', '课程', '灵感', '日记', '项目', '阅读', '周记', '首页'])
    await expect(item(page, '课程').locator('.fglyph').first()).toHaveAttribute('data-icon', 'folder')
    // 课程的首页还在，只是不写「分类」和「放什么」
    await item(page, '课程').locator('.truncate').click()
    await expect(tabOn(page)).toHaveText('课程')
    await expect(pane(page).getByTestId('cat-desc')).toHaveCount(0)
    await expect(pane(page).getByTestId('folder-lead')).toContainText(/^文件夹 · 2门课/)
    await shot(page, 'wniqx-presets-3-off')
    // 文件一篇不动；左栏.json 记着关了、收起了哪几个
    expect(git(vault, 'ls-files').split('\n').filter((p) => p.endsWith('.md')).sort()).toEqual(notesBefore)
    expect(git(vault, 'status', '--porcelain', '--', '.', ':!.canvas-notes')).toBe('')
    await expect.poll(() => leftJson(vault).预设分类).toBe(false)
    expect(leftJson(vault).收起的分类).toEqual(['课程', '阅读', '剪藏', '周记', '写作', '项目', '生活'])

    // 图标栏上收件箱那格右键：没有「不想要预设分类？」（已经关了）
    // 再打开：一切回到原样
    await page.keyboard.press('Meta+,')
    await settings(page).getByRole('switch', { name: '用预设的分类' }).click()
    await page.keyboard.press('Escape')
    expect(await barNames(page)).toEqual(['文件', '待办', '最近', '书桌', ...CATS, '读书笔记', '梦游报告', '库', '设置和外观'])
    await leftView(page, '文件')
    expect(await groupHeads(page)).toEqual(['读进来的', '自己写的', '不在分类里的'])
    await expect.poll(() => leftJson(vault).预设分类).toBeUndefined()

    // 分类那一格右键：「换图标和颜色…」排最前，最后一项去设置里关掉
    await cell(page, '课程').click({ button: 'right' })
    const m = menuLabels(await openedMenu(run))
    expect(m[0]).toBe('换图标和颜色…')
    expect(m.at(-1)).toBe('不想要预设分类？去设置里关掉…')
    await pickMenu(run, '不想要预设分类？去设置里关掉…')
    await expect(settings(page).locator('[data-row="leftPresets"]')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('③ 从树里拖一个文件夹到图标栏：落点一道线、「松手：放到左边」，松手放上去；几格之间拖着换顺序；右键「换图标和颜色…」排最前；「从左边拿下」能撤回', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    const line = page.getByTestId('bar-drop-line')
    const say = page.getByTestId('bar-drop-say')
    /** 按住一个东西，挪到图标栏上某一点（真按下、真挪，不松手） */
    const hold = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x + 8, from.y + 8, { steps: 3 })
      await page.mouse.move(to.x, to.y, { steps: 8 })
      // Playwright 送的拖动：挪进新的一格只发 dragenter，同一格里再动才有 dragover（真鼠标停着时 Chromium 一直发）；停着微微动两下
      await page.mouse.move(to.x + 1, to.y)
      await page.mouse.move(to.x, to.y)
    }
    const center = async (l: ReturnType<typeof item>) => {
      const b = (await l.boundingBox())!
      return { x: b.x + Math.min(60, b.width / 2), y: b.y + b.height / 2 }
    }
    const barBox = (await bar(page).boundingBox())!
    const lastCat = (await cell(page, '生活').boundingBox())!
    // 拖「读书笔记」到最后一格分类的下面
    await hold(await center(item(page, '读书笔记')), { x: barBox.x + barBox.width / 2, y: lastCat.y + lastCat.height + 6 })
    await expect(line).toBeVisible()
    await expect(say).toHaveText('松手：放到左边')
    const lb = (await line.boundingBox())!
    expect(Math.abs(lb.y - (lastCat.y + lastCat.height))).toBeLessThan(12)
    await shot(page, 'wniqx-drag-1-tree')
    await page.mouse.up()
    await expect(line).toHaveCount(0)
    await expect(cell(page, '读书笔记')).toHaveCount(1)
    await expect.poll(() => leftJson(vault).左边.at(-1)).toBe('读书笔记')
    // 文件夹本身没挪（拖到图标栏不是挪文件）
    expect(existsSync(join(vault, '读书笔记/系统1和系统2.md'))).toBe(true)
    // 再拖「工作」，放到「读书笔记」那一格的上半：排在它前面
    await leftView(page, '文件')
    const rb = (await cell(page, '读书笔记').boundingBox())!
    await hold(await center(item(page, '工作')), { x: rb.x + rb.width / 2, y: rb.y + 6 })
    await expect(say).toHaveText('松手：放到左边')
    await page.mouse.up()
    await expect.poll(() => leftJson(vault).左边.slice(-2)).toEqual(['工作', '读书笔记'])
    // 已经在左边的、分类，拖过去不出线
    await leftView(page, '文件')
    await hold(await center(item(page, '工作')), { x: rb.x + rb.width / 2, y: rb.y + rb.height + 20 })
    await expect(line).toHaveCount(0)
    await page.mouse.up()

    // 几格之间拖着换顺序：读书笔记拖到工作上半
    const wb = (await cell(page, '工作').boundingBox())!
    const db = (await cell(page, '读书笔记').boundingBox())!
    await hold({ x: db.x + db.width / 2, y: db.y + db.height / 2 }, { x: wb.x + wb.width / 2, y: wb.y + 5 })
    await expect(say).toHaveText('松手：挪到这里')
    await shot(page, 'wniqx-drag-2-reorder')
    await page.mouse.up()
    await expect.poll(() => leftJson(vault).左边.slice(-2)).toEqual(['读书笔记', '工作'])

    // 右键自己放的那一格：「换图标和颜色…」排最前
    await cell(page, '工作').click({ button: 'right' })
    expect(menuLabels(await openedMenu(run))).toEqual(['换图标和颜色…', '从左边拿下', '在「文件」里看位置', '上移', '下移'])
    await pickMenu(run, '从左边拿下')
    await expect(cell(page, '工作')).toHaveCount(0)
    await expect(page.getByTestId('toast')).toContainText('「工作」从左边拿下了')
    expect(existsSync(join(vault, '工作/项目A 需求.md'))).toBe(true)
    await page.getByTestId('toast').getByRole('button', { name: '撤回' }).click()
    await expect(cell(page, '工作')).toHaveCount(1)
    await expect.poll(() => leftJson(vault).左边.slice(-2)).toEqual(['读书笔记', '工作'])
  } finally {
    await run.close()
  }
})
