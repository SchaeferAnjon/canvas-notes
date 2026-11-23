// 英文库的分类文件夹用英文名（task-zojmg 第二批，库语言，设计稿第 4 节）：英文界面新建的库里八个分类叫 Inbox、Courses、Reading、
// Clippings、Weekly、Writing、Projects、Life，速记、⌘N 新笔记进 Inbox/，图标栏、文件树、首页、文件夹首页都认英文名；
// 已有的中文库切到英文界面，分类照磁盘上的中文名，速记、⌘N 照旧进 收件箱/。一律无头（CN_E2E=1）、临时库、临时设置目录。
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { launch, pane, tabOn } from './app'

type QuickHook = { menu: Electron.Menu }

const EN_CATS = ['Inbox', 'Courses', 'Reading', 'Clippings', 'Weekly', 'Writing', 'Projects', 'Life']
const ZH_CATS = ['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活']

const bar = (page: Page) => page.getByRole('navigation', { name: /^(左栏|Left sidebar)$/ })
const cell = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })
const side = (page: Page) => page.locator('aside.side')
const home = (page: Page) => page.getByTestId('folder-home')
const mdIn = (dir: string) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : [])
const lastSubjects = (vault: string, n = 5) => execFileSync('git', ['-C', vault, 'log', `-${n}`, '--format=%s'], { encoding: 'utf8' }).trim().split('\n')

/** 用一个空文件夹（软件自己 git init，就是「新建的库」）启动 */
async function launchAt(vault: string, userData: string, env: Record<string, string>) {
  const app = await electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: userData, CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(userData, '..', 'trash'), ...env },
  })
  const page = await app.firstWindow()
  await expect(page.locator('.vault b')).toHaveText(vault.split('/').pop()!)
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))))
  return { app, page }
}

/** 菜单栏图标里点「速记」，在小窗里打一句、回车 */
async function quickNote(app: ElectronApplication, text: string) {
  const open = app.windows().find((w) => w.url().endsWith('/quick.html'))
  const click = () => app.evaluate(() => (globalThis as unknown as { cnQuick: QuickHook }).cnQuick.menu.items[0]!.click())
  let quick = open
  if (quick) await click()
  else [quick] = await Promise.all([app.waitForEvent('window'), click()])
  await quick.waitForLoadState()
  const box = quick.getByRole('textbox', { name: /^(速记内容|Quick note text)$/ })
  await expect(box).toBeVisible()
  await box.pressSequentially(text)
  await box.press('Enter')
}

/** ⌘N 新建一篇，标题打 title、回车（标签上先是「未命名」，回车后按标题改名） */
async function newNote(page: Page, title: string) {
  await page.locator('.vault b').click()
  await page.keyboard.press('Meta+n')
  await expect(tabOn(page)).toHaveText(/未命名/)
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
}

test('英文界面新建的库：八个分类叫英文名，速记和 ⌘N 进 Inbox/，图标栏、文件树、首页、文件夹首页都认', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'cn-vault-en-'))
  const vault = join(root, 'My Notes')
  mkdirSync(vault)
  try {
    const { app, page } = await launchAt(vault, join(root, 'ud'), { CN_LANG: 'en' })
    await expect.poll(() => existsSync(join(vault, '.canvas-notes', '库.json'))).toBe(true)
    expect(JSON.parse(readFileSync(join(vault, '.canvas-notes', '库.json'), 'utf8'))).toEqual({ 语言: 'en' })

    // 图标栏：八格是英文名，一个中文分类名都没有
    for (const name of EN_CATS) await expect(cell(page, name)).toBeVisible()
    for (const name of ZH_CATS) await expect(cell(page, name)).toHaveCount(0)

    // 速记进 Inbox/，提交说明是英文
    await quickNote(app, 'buy milk')
    await expect.poll(() => mdIn(join(vault, 'Inbox'))).toEqual(['buy milk.md'])
    await expect.poll(() => lastSubjects(vault, 1)[0]).toBe('Quick note: buy milk')
    expect(existsSync(join(vault, '收件箱'))).toBe(false)

    // ⌘N：新笔记也进 Inbox/
    await newNote(page, 'Groceries')
    await expect.poll(() => mdIn(join(vault, 'Inbox'))).toEqual(['Groceries.md', 'buy milk.md'])

    // 收件箱那一格：左栏是 Inbox 那一枝，中间开它的首页，数字是 2
    await cell(page, 'Inbox').click()
    await expect(home(page)).toHaveAttribute('data-folder', 'Inbox')
    await expect(bar(page).getByTestId('inbox-count')).toHaveText('2')
    await expect(side(page).getByRole('tree').locator('[aria-level="1"] .truncate')).toHaveCount(2)
    expect((await side(page).getByRole('tree').locator('[aria-level="1"] .truncate').allTextContents()).sort()).toEqual(['Groceries', 'buy milk'])

    // Courses 那一格：认得出是「课程」（首页那一行是「Category」、课程那套组件）；新建一门课建在 Courses/ 下面
    await cell(page, 'Courses').click()
    await expect(home(page)).toHaveAttribute('data-folder', 'Courses')
    await expect(page.getByTestId('folder-lead')).toHaveText(/^Category · /)
    await expect(home(page)).toContainText('Current courses')

    // 首页的分类卡：英文名，Courses 那张数的是课（「0 courses」）
    await page.getByRole('banner').getByRole('button', { name: 'Home', exact: true }).click()
    for (const name of EN_CATS) await expect(page.getByTestId(`cat-${name}`)).toBeVisible()
    await expect(page.getByTestId('cat-Courses')).toContainText('0 courses')
    await expect(page.getByTestId('cat-Inbox')).toContainText('2 notes')

    // 文件树最外层（第一行是库名，下面一层）：八个分类照分类表的先后、英文名；组名是英文
    await cell(page, 'Files').click()
    const tree = side(page).getByRole('tree')
    await expect(tree.locator('[role=treeitem][aria-level="2"] .truncate').first()).toHaveText('Inbox')
    expect((await tree.locator('[role=treeitem][aria-level="2"] .truncate').allTextContents()).slice(0, 8)).toEqual(EN_CATS)
    expect(await tree.locator('.ft-gh').allTextContents()).toEqual(['Collected', 'Written'])
    await expect(side(page)).not.toContainText('收件箱')
    // 图标栏的分段：收件箱单独一段，读进来的、自己写的各一段
    const groups = await bar(page).locator('.abg').evaluateAll((els) => els.map((g) => [...g.querySelectorAll('button.ab')].map((b) => b.getAttribute('aria-label'))))
    expect(groups.slice(1, 4)).toEqual([['Inbox'], ['Courses', 'Reading', 'Clippings'], ['Weekly', 'Writing', 'Projects', 'Life']])
    await app.close()
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5 })
  }
})

test('已有的中文库切到英文界面：分类照磁盘上的中文名，速记和 ⌘N 照旧进 收件箱/，不记库语言', async () => {
  test.setTimeout(120_000)
  const run = await launch(
    {
      '收件箱/想法.md': '# 想法\n\n随手记一句。\n',
      '课程/机器学习/第1讲.md': '# 第1讲\n\n梯度下降。\n',
      '阅读/人类简史.md': '# 人类简史\n\n认知革命。\n',
    },
    { CN_LANG: 'en' },
  )
  const { app, page, vault } = run
  try {
    // 界面是英文，分类格照磁盘上的中文名
    for (const name of ZH_CATS) await expect(cell(page, name)).toBeVisible()
    await expect(cell(page, 'Inbox')).toHaveCount(0)
    expect(existsSync(join(vault, '.canvas-notes', '库.json'))).toBe(false)

    // 速记进 收件箱/，提交说明照库语言用中文
    await quickNote(app, '买牛奶')
    await expect.poll(() => mdIn(join(vault, '收件箱'))).toEqual(['买牛奶.md', '想法.md'])
    await expect.poll(() => lastSubjects(vault, 1)[0]).toBe('速记：买牛奶')
    expect(existsSync(join(vault, 'Inbox'))).toBe(false)

    // ⌘N 进 收件箱/
    await newNote(page, '周末')
    await expect.poll(() => mdIn(join(vault, '收件箱'))).toEqual(['买牛奶.md', '周末.md', '想法.md'])

    // 首页：课程那张认得出是课（「1 course」），说明是英文
    await page.getByRole('banner').getByRole('button', { name: 'Home', exact: true }).click()
    await expect(page.getByTestId('cat-课程')).toContainText('1 course')
    // 课程那一格的首页：认得出是「课程」
    await cell(page, '课程').click()
    await expect(home(page)).toHaveAttribute('data-folder', '课程')
    await expect(page.getByTestId('folder-lead')).toHaveText(/^Category · 1 course · /)
    await expect(pane(page)).toContainText('Current courses')
  } finally {
    await run.close()
  }
})
