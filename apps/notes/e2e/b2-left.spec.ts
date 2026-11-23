// 左栏、分类、文件夹页和首页（2026-11-18，B-左栏与文件夹 v2：分类与入口方向 A + C、分类方案 3「分两组」，文件夹封面方向 A，
// 直接修 CN-102、103、104、105、106、113、114；删笔记时的图走所有入口；空库首页、写作首页走样）。每样都真点、真打字、真拖。
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, rail, tabOn, type Running } from './app'
import { B2_VAULT, withTimes } from './fixtures/b2-vault'
import { solidPng } from './fixtures/png'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'
import { DOC as DIGEST, PATH as DIGEST_PATH } from './fixtures/book-digest'

const side = (page: Page) => page.locator('aside.side')
const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const cell = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })
const tree = (page: Page) => side(page).getByRole('tree')
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
const home = (page: Page) => page.getByTestId('folder-home')
const toast = (page: Page) => page.getByTestId('toast')
const git = (vault: string, ...args: string[]) => execFileSync('git', ['-C', vault, ...args], { encoding: 'utf8' }).trim()
const CATS = ['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活']

async function start(files: Record<string, string | Buffer> = B2_VAULT): Promise<Running> {
  const run = await launch(files, {}, (v) => withTimes(v))
  await armMenus(run)
  return run
}
async function openFiles(page: Page) {
  const b = cell(page, '文件')
  if ((await b.getAttribute('aria-pressed')) !== 'true') await b.click()
}
/** 树里展开到这一行（点箭头，不开首页） */
async function expand(page: Page, ...names: string[]) {
  for (const n of names) if ((await row(page, n).first().getAttribute('aria-expanded')) !== 'true') await row(page, n).first().locator('.ft-tw').click()
}

test('活动栏平铺：文件、最近 | 收件箱 | 课程 阅读 剪藏 | 周记 写作 项目 生活 | 梦游；文件树最外层同一个先后、按组分段、第一行是库名', async () => {
  const run = await start()
  const { page } = run
  try {
    const names = await bar(page).locator('button.ab').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(names).toEqual(['文件', '待办', '日历', '最近', '书桌', ...CATS, '梦游报告', '最近删掉的', '库', '设置和外观'])
    // 每段之间一条线：最近后、收件箱后、剪藏后、生活后
    const groups = await bar(page).locator('.abg').evaluateAll((els) => els.map((g) => [...g.querySelectorAll('button.ab')].map((b) => b.getAttribute('aria-label'))))
    expect(groups).toEqual([['文件', '待办', '日历', '最近', '书桌'], ['收件箱'], ['课程', '阅读', '剪藏'], ['周记', '写作', '项目', '生活'], ['梦游报告']])
    await openFiles(page)
    const root = tree(page).locator('.ft-root')
    await expect(root).toContainText('测试库')
    // 一个 PDF 一篇笔记：Lecture05.pdf 和它的笔记在树里是一行，少算一个
    await expect(root.locator('.ft-count')).toHaveText(String(Object.keys(B2_VAULT).length - 1))
    const top = await tree(page).locator('[role=treeitem][aria-level="2"] .truncate').allTextContents()
    expect(top.slice(0, 8)).toEqual(CATS)
    expect(await tree(page).locator('.ft-gh').allTextContents()).toEqual(['读进来的', '自己写的', '不在分类里的'])
    // 组头：12 号 500、颜色 --t3、后面一条 1px 线
    const gh = await tree(page).locator('.ft-gh').first().evaluate((e) => ({ fs: getComputedStyle(e).fontSize, fw: getComputedStyle(e).fontWeight, ln: getComputedStyle(e.querySelector('.ln')!).height }))
    expect(gh).toEqual({ fs: '12px', fw: '500', ln: '1px' })
  } finally {
    await run.close()
  }
})

test('点一格：左栏是那一枝（底下「在「文件」里看位置」），中间开它的首页；亮着的再点收起左栏；新建笔记建在这一类里', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await cell(page, '阅读').click()
    await expect(cell(page, '阅读')).toHaveAttribute('aria-pressed', 'true')
    await expect(home(page)).toHaveAttribute('data-folder', '阅读')
    await expect(tabOn(page)).toHaveText('阅读')
    await expect(side(page).locator('.vh .t')).toHaveText('阅读')
    expect(await tree(page).locator('[aria-level="1"] .truncate').allTextContents()).toEqual(['趣说明朝276年', '人类简史', '长安的荔枝'])
    await expect(side(page).locator('.sall')).toContainText('在「文件」里看位置')
    await expect(side(page).locator('.sall')).toContainText('阅读/')
    // 头上的「新建笔记」：建在阅读里
    await side(page).getByRole('button', { name: '新建笔记' }).click()
    await expect(tabOn(page)).toHaveText(/未命名/)
    await page.keyboard.type('三体读后')
    await page.keyboard.press('Enter')
    await expect.poll(() => existsSync(join(vault, '阅读/三体读后.md'))).toBe(true)
    // 亮着的那格再点：收起左栏
    await cell(page, '阅读').click()
    await expect(page.locator('.win')).toHaveClass(/side-hidden/)
    // 收件箱一格：左栏是收件箱那一枝，数字还在
    await cell(page, '收件箱').click()
    await expect(home(page)).toHaveAttribute('data-folder', '收件箱')
    await expect(bar(page).getByTestId('inbox-count')).toHaveText('4')
    expect((await tree(page).locator('[aria-level="1"] .truncate').allTextContents()).sort()).toEqual(['Kindle 导出的标注', '一个 App 的点子', '周三组会要问的', '拍的白板 11月15日'].sort())
    // 「在「文件」里看位置」：换到文件，展开到它、一圈外圈
    await side(page).locator('.sall button').click()
    await expect(cell(page, '文件')).toHaveAttribute('aria-pressed', 'true')
    await expect(row(page, '收件箱')).toHaveClass(/ring/)
  } finally {
    await run.close()
  }
})

test('活动栏右键：从左边拿下（底部能撤回）、在「文件」里看位置；窗口矮时放不下的收进「⋯」', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await cell(page, '写作').click({ button: 'right' })
    // 「换图标和颜色…」排最前；分类那几格最后一项去设置里关掉预设（task-wniqx）
    expect(menuLabels(await openedMenu(run))).toEqual(['换图标和颜色…', '从左边拿下', '在「文件」里看位置', '上移', '下移', '不想要预设分类？去设置里关掉…'])
    await pickMenu(run, '从左边拿下')
    await expect(cell(page, '写作')).toHaveCount(0)
    await expect(toast(page)).toContainText('「写作」从左边拿下了；文件夹没动，右键文件夹「放到左边」能放回')
    await expect.poll(() => JSON.parse(readFileSync(join(vault, '.canvas-notes/左栏.json'), 'utf8')).左边).toEqual(CATS.filter((c) => c !== '写作'))
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect(cell(page, '写作')).toHaveCount(1)
    // 窗口最矮（600）、又摘了三个文件夹上来：放不下的从最后一格往前收进「⋯」，点开是这几格。
    // 「待办」「书桌」不收（2026-11-22 用户看图定「用旧做法」，task-2okp6）；库、设置不再被压扁腾地方；底部多了「最近删掉的」一格（task-iq2ow）以后 600 高时末尾四个分类收进「⋯」，
    // 又多了「日历」一格（task-kzr3n）以后是末尾五个
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 600))
    await page.waitForTimeout(300)
    await expect(bar(page).getByTestId('ab-more')).toHaveAttribute('data-tip', '还有5个：剪藏、周记、写作、项目、生活')
    for (const c of ['待办', '日历', '书桌', ...CATS.slice(0, 3)]) await expect(cell(page, c)).toBeVisible()
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    for (const [parent, f] of [['项目', '冰岛旅行'], ['项目', '搬家'], ['阅读', '人类简史']] as const) {
      await openFiles(page)
      await expand(page, parent)
      await row(page, f).click({ button: 'right' })
      await pickMenu(run, '放到左边')
      await expect(cell(page, f)).toHaveAttribute('aria-pressed', 'true')
    }
    // 先换回「文件」（亮着的那格再点是收起左栏，菜单里点它也一样）
    await openFiles(page)
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1200, 600))
    await expect(bar(page).getByTestId('ab-more')).toBeVisible()
    const hidden = await bar(page).getByTestId('ab-more').getAttribute('aria-label')
    expect(hidden).toMatch(/^还有\d+个$/)
    const fits = await bar(page).evaluate((el) => el.scrollHeight <= el.clientHeight + 1)
    expect(fits).toBe(true)
    // 库、设置还在最下面
    await expect(bar(page).getByRole('button', { name: '设置和外观' })).toBeInViewport()
    await bar(page).getByTestId('ab-more').click()
    const more = menuLabels(await openedMenu(run))
    expect(more.length).toBe(Number(hidden!.match(/\d+/)![0]))
    // 从最后一格往前收：菜单最后一项是最先收的那一格
    expect(more.at(-1)).toBe('人类简史')
    await pickMenu(run, '人类简史')
    await expect(home(page)).toHaveAttribute('data-folder', '阅读/人类简史')
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
    await expect(bar(page).getByTestId('ab-more')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('分类的首页：横幅、图标压在下沿、「分类 · N篇 · 改于」、「放什么」点一下改（写进分类.json）、双击名字说不改名；课程页是在上的课、复习、考试倒计时', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await cell(page, '课程').click()
    await expect(home(page)).toHaveAttribute('data-folder', '课程')
    // Lecture05.pdf 和它的笔记算一篇（一个 PDF 一篇笔记，和左栏那一行数得一样，task-9okg5）
    await expect(page.getByTestId('folder-lead')).toHaveText(/^分类 · 2门课 · 4篇 · 改于今天 \d\d:\d\d$/)
    expect(await home(page).locator('.wgrid [data-widget]').evaluateAll((els) => els.map((e) => e.getAttribute('data-widget')))).toEqual(['courses', 'review', 'exam'])
    await expect(home(page).locator('[data-widget=courses] .fw-course')).toHaveCount(2)
    await expect(home(page).locator('[data-widget=courses] .fw-course').filter({ hasText: 'ecpc' }).locator('.r')).toHaveText('1/1讲')
    // 量：横幅 150 高，图标方块 64、压进横幅 32
    const m = await home(page).evaluate((el) => {
      const r = (s: string) => el.querySelector(s)!.getBoundingClientRect()
      return { bn: r('.cover').height, ico: [r('.fh-ico').width, r('.fh-ico').height], over: r('.cover').bottom - r('.fh-ico').top, title: getComputedStyle(el.querySelector('.fh-tx h2')!).fontSize, lead: getComputedStyle(el.querySelector('.fh-tx p')!).fontSize }
    })
    expect(m).toEqual({ bn: 150, ico: [64, 64], over: 32, title: '28px', lead: '13px' })
    // 放什么：点一下就能改，回车存进 .canvas-notes/分类.json
    const desc = page.getByTestId('cat-desc')
    await expect(desc).toHaveText('放什么：在上的课：课件、笔记、疑惑，一门课一个文件夹')
    await desc.locator('.ed').click()
    await desc.getByRole('textbox', { name: '这一类放什么' }).fill('在上的课和讲座')
    await page.keyboard.press('Enter')
    await expect(toast(page)).toContainText('写进了库里的「.canvas-notes/分类.json」：梦游归类、「移到…」菜单都按这句排')
    await expect(desc).toHaveText('放什么：在上的课和讲座')
    expect(JSON.parse(readFileSync(join(vault, '.canvas-notes/分类.json'), 'utf8'))).toEqual({ 放什么: { 课程: '在上的课和讲座' } })
    // 首页分类卡（方向 C）也换成这一句
    await page.getByRole('banner').getByRole('button', { name: '首页', exact: true }).click()
    await expect(page.getByTestId('cat-课程')).toContainText('在上的课和讲座')
    await page.getByTestId('cat-课程').click()
    await expect(home(page)).toHaveAttribute('data-folder', '课程')
    // 双击名字：自带的分类不改名
    await home(page).locator('.fh-tx h2').dblclick()
    await expect(toast(page)).toContainText('「课程」是软件自带的分类，不改名；封面、图标、颜色都能换')
  } finally {
    await run.close()
  }
})

test('文件夹封面：没选图是自己颜色的渐变；悬停「换封面」，图片八张、颜色八个；换好「封面换好了 · 撤回」，git 里只多了这个文件夹的 .首页.json；调整位置拖一下「存好」', async () => {
  const run = await start()
  const { page, vault } = run
  try {
    await openFiles(page)
    await expand(page, '项目')
    await row(page, '冰岛旅行').click()
    await expect(home(page)).toHaveAttribute('data-folder', '项目/冰岛旅行')
    await expect(page.getByTestId('folder-lead')).toHaveText(/^项目 \/ 冰岛旅行 · 4篇 · 改于今天 \d\d:\d\d$/)
    const cover = page.getByTestId('folder-cover')
    // 冰岛旅行在「项目」里、自己没设颜色：项目的橙色渐变
    expect(await cover.evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('linear-gradient')
    await expect(cover.getByRole('button', { name: '调整位置' })).toHaveCount(0)
    await cover.hover()
    await cover.getByRole('button', { name: '换封面' }).click()
    const gal = page.getByRole('dialog', { name: '换封面' })
    await expect(gal.locator('.ft-hd')).toHaveText('换封面只改这个文件夹')
    await expect(gal.locator('.gh2')).toHaveText(['图片', '颜色（没选图时用文件夹自己的颜色）'])
    await expect(gal.locator('.th:not(.sw)')).toHaveCount(8)
    await expect(gal.locator('.th.sw')).toHaveCount(8)
    await expect(gal.getByRole('button')).toContainText(['从电脑选一张…', '去掉图片'])
    const before = git(vault, 'status', '--porcelain')
    await gal.getByRole('button', { name: '教会山' }).click()
    await expect(gal).toHaveCount(0)
    await expect(toast(page)).toContainText('封面换好了')
    await expect.poll(() => git(vault, 'status', '--porcelain')).toBe([before, '?? 项目/冰岛旅行/.首页.json'].filter(Boolean).join('\n'))
    expect(JSON.parse(readFileSync(join(vault, '项目/冰岛旅行/.首页.json'), 'utf8')).cover).toEqual({ kind: 'builtin', id: 'kirkjufell' })
    // 撤回：回到原来的渐变
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => JSON.parse(readFileSync(join(vault, '项目/冰岛旅行/.首页.json'), 'utf8')).cover).toEqual({ kind: 'none' })
    // 换一张图再调整位置：上下拖、存好
    await cover.hover()
    await cover.getByRole('button', { name: '换封面' }).click()
    await gal.getByRole('button', { name: '黄金瀑布' }).click()
    await cover.hover()
    await cover.getByRole('button', { name: '调整位置' }).click()
    await expect(cover.locator('.hint')).toHaveText('上下拖动图片')
    await expect(cover.getByRole('button')).toHaveText(['存好', '取消'])
    const b = (await cover.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + 70)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width / 2, b.y + 20, { steps: 5 })
    await page.mouse.up()
    await cover.getByRole('button', { name: '存好' }).click()
    await expect(toast(page)).toContainText('位置存好了：写在这个文件夹的「.首页.json」里')
    expect(JSON.parse(readFileSync(join(vault, '项目/冰岛旅行/.首页.json'), 'utf8')).coverY).toBeGreaterThan(50)
    // 别的文件夹（不是分类）双击名字能改名
    await home(page).locator('.fh-tx h2').dblclick()
    await expect(home(page).getByRole('textbox', { name: '文件夹名字' })).toBeVisible()
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

test('写作首页只有「最近改的」「待办」两块（走样修）；按条件列出没找到东西时平时不占一整块，编辑首页时照常在', async () => {
  const run = await start()
  const { page } = run
  try {
    await cell(page, '写作').click()
    await expect(home(page)).toHaveAttribute('data-folder', '写作')
    expect(await home(page).locator('.wgrid [data-widget]').evaluateAll((els) => els.map((e) => [e.getAttribute('data-widget'), [...e.classList].find((c) => /^s\d$/.test(c))]))).toEqual([
      ['recent', 's2'],
      ['todo', 's2'],
    ])
    await expect(home(page)).not.toContainText('没有符合条件的文件')
    // 加一个「这个月写完的」：这个库里一篇都没有 → 平时不出现，编辑时在
    await page.getByTestId('tab-acts').getByRole('button', { name: '编辑首页' }).click()
    await home(page).getByRole('button', { name: '加组件' }).click()
    const lib = page.getByRole('dialog', { name: '加组件' })
    await lib.getByRole('button', { name: '加上 这个月写完的' }).click()
    await lib.getByRole('button', { name: '完成' }).click()
    await expect(home(page).locator('[data-widget=list]')).toHaveCount(1)
    await page.getByTestId('tab-acts').getByRole('button', { name: '完成' }).click()
    await expect(home(page).locator('[data-widget=list]')).toHaveCount(0)
    await expect(home(page)).not.toContainText('没有符合条件的文件')
  } finally {
    await run.close()
  }
})

test('CN-102、103、114 加组件：一个列表三组（这门课的 / 通用 / 按条件列出），每项的「加上」整个在那一行里；搜索只剩命中的、空的组藏起来；草稿说明对', async () => {
  const run = await start()
  const { page } = run
  try {
    await openFiles(page)
    await expand(page, '课程')
    await row(page, 'ecpc').click()
    await expect(home(page)).toHaveAttribute('data-folder', '课程/ecpc')
    await page.getByTestId('tab-acts').getByRole('button', { name: '编辑首页' }).click()
    await home(page).getByRole('button', { name: '加组件' }).click()
    const lib = page.getByRole('dialog', { name: '加组件' })
    await expect(lib.getByRole('navigation')).toHaveCount(0)
    await expect(lib.locator('.gh')).toHaveText(['这门课的7', '通用8', '按条件列出5'])
    await expect(lib.getByTestId('lib-slides')).toContainText('已在页面上')
    await expect(lib.getByTestId('lib-drafts')).toContainText('正文不到100字的笔记')
    await expect(lib.getByTestId('lib-clips')).toContainText('剪藏只列主题和篇数')
    // 每项一行：「加上」按钮整个在那一行里（以前定高网格把卡片压到 145、按钮露出 0）
    const out = await lib.locator('.lw').evaluateAll((rows) =>
      rows.flatMap((r) => {
        const b = r.querySelector('.add, em')
        if (!b) return ['没有加上：' + r.textContent]
        const o = r.getBoundingClientRect()
        const i = b.getBoundingClientRect()
        return i.top >= o.top && i.bottom <= o.bottom && i.left >= o.left && i.right <= o.right && i.height > 0 ? [] : [r.textContent!]
      }),
    )
    expect(out).toEqual([])
    // 通用里的能加：加上以后出现在最后、闪一下
    await lib.getByTestId('lib-board').getByRole('button', { name: '加上 嵌一块白板' }).click()
    await expect(lib.getByTestId('lib-board')).toContainText('已在页面上')
    // 搜索：只剩命中的，没有项的组标题藏起来
    await lib.getByRole('textbox', { name: '找组件' }).fill('日历')
    await expect(lib.locator('.gh')).toHaveText(['这门课的1', '通用1'])
    await lib.getByRole('textbox', { name: '找组件' }).fill('预设')
    await expect(lib.locator('.gh')).toHaveText(['按条件列出3'])
    await lib.getByRole('button', { name: '完成' }).click()
    const last = home(page).locator('.wgrid [data-widget]').last()
    await expect(last).toHaveAttribute('data-widget', 'board')
    await expect(last).toHaveClass(/flash/)
  } finally {
    await run.close()
  }
})

test('CN-113 中间栏 420 宽：课件进度最后一格只有加号和一行「拖PDF」，整句放悬停提示；课件名完整，「没开始」放不下整段藏起来', async () => {
  const run = await start()
  const { page } = run
  try {
    await openFiles(page)
    await expand(page, '课程')
    await row(page, 'ecpc').click()
    await expect(home(page)).toHaveAttribute('data-folder', '课程/ecpc')
    // 和录屏里一样：窗口 1100 宽、左栏和右栏「历史」都开着，中间栏只剩 400 上下
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 860))
    await rail(page).getByRole('button', { name: /^历史/ }).click()
    await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
    await expect.poll(async () => Math.round((await page.locator('.center').boundingBox())!.width)).toBeLessThan(460)
    const cellEl = home(page).getByTestId('slides-dropcell')
    await expect(cellEl).toHaveText('拖PDF')
    await expect(cellEl).toHaveAttribute('data-tip', '把PDF拖到这张卡上，就收进ecpc')
    const lines = await cellEl.locator('span').evaluate((e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)))
    expect(lines).toBe(1)
    const name = home(page).getByTestId('slide-cover').first().locator('.nm .truncate')
    expect(await name.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true)
  } finally {
    await run.close()
  }
})

test('CN-106 放在最外层的：标题下写库名（库图标），「移到」菜单第一项是库名；软件里看不到「库的最外层」', async () => {
  const run = await start()
  const { page } = run
  try {
    await openFiles(page)
    await row(page, '视频里的疑惑').click()
    await expect(tabOn(page)).toHaveText('视频里的疑惑')
    const chip = pane(page).locator('.cm-folder')
    await expect(chip).toHaveText('测试库')
    await chip.click()
    const m = menuLabels(await openedMenu(run))
    expect(m.slice(0, 3)).toEqual(['收件箱', '课程', '阅读'])
    await pickMenu(run, '阅读 › 放进「阅读」')
    await expect(chip).toHaveText('阅读')
    await expect(page.locator('body')).not.toContainText('库的最外层')
    // 阅读里那篇右键「移到…」（task-4891y 起是打字找的小弹层）：第一项是库名
    await expand(page, '阅读')
    await row(page, '视频里的疑惑').click({ button: 'right' })
    await pickMenu(run, '移到…')
    const mover = page.getByRole('dialog', { name: '移到' })
    await expect(mover.getByRole('menuitem').first().locator('.truncate')).toHaveText('测试库')
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})

test('CN-104 白板筛选：最外层的白板挂在库名下面；附件筛选：附件挂在用它的笔记下面，一篇先列 3 张、再显示，没有笔记的附件放最下面一组', async () => {
  const png = (i: number) => solidPng(40 + i, 30, [30 * i, 90, 160])
  const files: Record<string, string | Buffer> = {
    ...B2_VAULT,
    '写作/游记/去冰岛之前要知道的十件事.md': '# 去冰岛之前要知道的十件事\n\n' + [1, 2, 3, 4].map((i) => `![](../../附件/写作/游记/去冰岛之前要知道的十件事/截图%20${i}.png)\n`).join('\n'),
    ...Object.fromEntries([1, 2, 3, 4].map((i) => [`附件/写作/游记/去冰岛之前要知道的十件事/截图 ${i}.png`, png(i)])),
    '附件/老的/没人用.png': png(9),
    // 第 4 层的笔记（用户真库里课程笔记都在这一层）：名字长，「N张」也要看得见
    '课程/ecpc/第五讲/Lecture05 读书笔记和这一讲的疑惑.md': '# Lecture05 读书笔记和这一讲的疑惑\n\n![](../../../附件/课程/ecpc/第五讲/Lecture05 读书笔记和这一讲的疑惑/截图%201.png)\n',
    '附件/课程/ecpc/第五讲/Lecture05 读书笔记和这一讲的疑惑/截图 1.png': png(5),
  }
  const run = await start(files)
  const { page } = run
  try {
    await openFiles(page)
    await side(page).getByRole('tab', { name: '白板' }).click()
    await expect(tree(page).locator('.ft-root')).toContainText('测试库')
    // 最外层的「未命名白板」挂在库下面（第 2 层），在「不在分类里的」那一组
    await expect(row(page, '未命名白板')).toHaveAttribute('aria-level', '2')
    await expect(tree(page).locator('.ft-gh')).toHaveText(['自己写的', '不在分类里的'])
    // 附件
    await side(page).getByRole('tab', { name: '附件' }).click()
    await expand(page, '写作', '游记')
    await expect(row(page, '去冰岛之前要知道的十件事').locator('.ft-count')).toHaveText('4张')
    await expand(page, '课程', 'ecpc', '第五讲')
    await expect(row(page, 'Lecture05 读书笔记和这一讲的疑惑').locator('.ft-count')).toHaveText('1张')
    // 「N张」整个在这一行里看得见（没掉到藏起来的第二行），展开箭头和行竖直居中，名字让位打省略号
    for (const n of ['去冰岛之前要知道的十件事', 'Lecture05 读书笔记和这一讲的疑惑']) {
      const box = await row(page, n).evaluate((r) => {
        const b = r.getBoundingClientRect()
        const c = r.querySelector('.ft-count')!.getBoundingClientRect()
        const tw = r.querySelector('.ft-tw > svg, .ft-tw > .ci, .ft-tw > *')!.getBoundingClientRect()
        return { top: c.top - b.top, bottom: b.bottom - c.bottom, right: b.right - c.right, w: c.width, mid: Math.abs(tw.top + tw.height / 2 - (b.top + b.height / 2)) }
      })
      expect(box.w).toBeGreaterThan(10)
      expect(box.top).toBeGreaterThanOrEqual(0)
      expect(box.bottom).toBeGreaterThanOrEqual(0)
      expect(box.right).toBeGreaterThanOrEqual(0)
      expect(box.mid).toBeLessThanOrEqual(1)
    }
    await row(page, '去冰岛之前要知道的十件事').locator('.ft-tw').click()
    await expect(tree(page).locator('.ft-att')).toHaveCount(3 + 1)
    await expect(tree(page).locator('.ft-att .ft-thumb').first()).toBeVisible()
    await tree(page).getByRole('button', { name: '再显示1张' }).click()
    await expect(tree(page).locator('.ft-att')).toHaveCount(4 + 1)
    await expect(tree(page).locator('.ft-gh').last()).toHaveText('没有笔记的附件')
    await expect(tree(page).locator('.ft-att').last()).toContainText('没人用.png')
    // 点一张在访达中显示
    await tree(page).locator('.ft-att').first().click()
    await expect.poll(() => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.join('|'))).toContain('截图 1.png')
    // 「全部」时附件/ 目录本身也在树里
    await side(page).getByRole('tab', { name: '全部' }).click()
    await expect(row(page, '附件')).toHaveAttribute('aria-level', '2')
  } finally {
    await run.close()
  }
})

test('task-1df7j 附件筛选：读 PDF 的完整对话在用的截图挂在那份 PDF 的笔记下面、不算「没有笔记的附件」；多选删真没人用的两张，当场一次只含它们的提交，历史里放回来', async () => {
  const png = (i: number) => solidPng(40 + i, 30, [30 * i, 90, 160])
  const files: Record<string, string | Buffer> = {
    ...B2_VAULT,
    // 用户真库里的旧 PDF 笔记：只链着完整对话，框的截图只有对话记录在用
    '课程/ecpc/Lecture05 笔记.md': '---\n进度: 2/2\n---\n# Lecture05 笔记\n\n## 第 1 页 · 阈值\n[第 1 页](Lecture05.pdf#page=1) · 10:20\n\n[完整对话 · 2 轮](../../.canvas-notes/对话/Lecture05-p1-1.md)\n',
    '.canvas-notes/对话/Lecture05-p1-1.md': '# Lecture05 · 第 1 页 · 完整对话\n\n[回到第 1 页](../../课程/ecpc/Lecture05.pdf#page=1&rect=0.1,0.2,0.3,0.4)\n\n### 我 · 10:20\n\n![我框的](../../附件/Lecture05/p1-1.png)\n\n讲讲\n',
    '附件/Lecture05/p1-1.png': png(1),
    // PDF 已经删了的对话：图照样在用，单列一组
    '.canvas-notes/对话/旧讲义-p2-1.md': '# 旧讲义 · 第 2 页 · 完整对话\n\n[回到第 2 页](../../课程/旧讲义.pdf#page=2)\n\n![我框的](../../附件/旧讲义/p2-1.png)\n',
    '附件/旧讲义/p2-1.png': png(2),
    '附件/老的/没人用.png': png(3),
    '附件/老的/也没人用.png': png(4),
  }
  const run = await start(files)
  const { page, vault, trash } = run
  try {
    const head0 = git(vault, 'rev-parse', 'HEAD')
    await openFiles(page)
    await side(page).getByRole('tab', { name: '附件' }).click()
    await expect(tree(page).locator('.ft-gh')).toHaveText(['读进来的', '完整对话在用的附件', '没有笔记的附件'])
    // 对话记录本身不进树
    await expect(tree(page).locator('[data-path^=".canvas-notes"]')).toHaveCount(0)
    // 只有对话在用的截图：挂在 Lecture05 笔记下面，不在「没有笔记的附件」里
    await expand(page, '课程', 'ecpc')
    await expect(row(page, 'Lecture05 笔记').locator('.ft-count')).toHaveText('1张')
    await row(page, 'Lecture05 笔记').locator('.ft-tw').click()
    await expect(tree(page).locator('.ft-att[data-path="附件/Lecture05/p1-1.png"]')).toHaveCount(1)
    const groupOf = (path: string) =>
      tree(page)
        .locator(`.ft-att[data-path="${path}"]`)
        .evaluateAll((els) =>
          els.map((el) => {
            let p = el.previousElementSibling
            while (p && !p.classList.contains('ft-gh') && !(p.getAttribute('aria-level') === '2' && !p.classList.contains('ft-att'))) p = p.previousElementSibling
            return p?.classList.contains('ft-gh') ? p.textContent : '挂在笔记下面'
          }),
        )
    expect(await groupOf('附件/Lecture05/p1-1.png')).toEqual(['挂在笔记下面'])
    expect(await groupOf('附件/旧讲义/p2-1.png')).toEqual(['完整对话在用的附件'])
    expect(await groupOf('附件/老的/没人用.png')).toEqual(['没有笔记的附件'])
    expect(await groupOf('附件/老的/也没人用.png')).toEqual(['没有笔记的附件'])
    // 平铺的两组：名字后面灰字写所在的文件夹（p2-1.png 这种名字每份 PDF 都有）；笔记下面的不写
    await expect(tree(page).locator('.ft-att[data-path="附件/旧讲义/p2-1.png"] .truncate')).toHaveText('p2-1.png旧讲义')
    await expect(tree(page).locator('.ft-att[data-path="附件/老的/没人用.png"] .truncate')).toHaveText('没人用.png老的')
    await expect(tree(page).locator('.ft-att[data-path="附件/Lecture05/p1-1.png"] .truncate')).toHaveText('p1-1.png')
    // 完整对话那一组：双击打开用它的那份对话
    await tree(page).locator('.ft-att[data-path="附件/旧讲义/p2-1.png"]').dblclick()
    await expect(tabOn(page)).toHaveText('旧讲义-p2-1')
    await expect(pane(page).locator('.cm-content')).toContainText('旧讲义 · 第 2 页 · 完整对话')
    await expect(tree(page).locator('.ft-gh').last()).toHaveText('没有笔记的附件')
    expect(await tree(page).locator('.ft-gh').last().evaluate((gh) => {
      const out: string[] = []
      for (let el = gh.nextElementSibling; el; el = el.nextElementSibling) if (el.classList.contains('ft-att')) out.push(el.getAttribute('data-path')!)
      return out
    })).toEqual(['附件/老的/也没人用.png', '附件/老的/没人用.png'])
    // 多选「没有笔记的附件」那两张，底部「删除」
    await tree(page).locator('.ft-att[data-path="附件/老的/也没人用.png"]').click()
    await tree(page).locator('.ft-att[data-path="附件/老的/没人用.png"]').click({ modifiers: ['Shift'] })
    const bar2 = side(page).getByRole('toolbar', { name: '选中的' })
    await expect(bar2.locator('b')).toHaveText('已选2个')
    await bar2.getByRole('button', { name: '删除' }).click()
    const dlg = page.getByRole('dialog', { name: '把选中的2个移到废纸篓？' })
    await dlg.getByRole('button', { name: '移到废纸篓' }).click()
    await expect(toast(page)).toContainText('2个移到了废纸篓')
    expect(existsSync(join(vault, '附件/老的/没人用.png'))).toBe(false)
    expect(readdirSync(trash).filter((f) => f.endsWith('没人用.png'))).toHaveLength(2)
    // 当场一次提交，只含这两张；工作区里没有挂着的删除
    expect(git(vault, 'rev-list', '--count', `${head0}..HEAD`)).toBe('1')
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('删除 2 个文件：附件/老的/也没人用.png、附件/老的/没人用.png')
    expect(git(vault, 'show', '--name-status', '--format=', 'HEAD').split('\n').sort()).toEqual(['D\t附件/老的/也没人用.png', 'D\t附件/老的/没人用.png'])
    expect(git(vault, 'status', '--porcelain')).toBe('')
    // 对话在用的那张还在、还挂在笔记下面
    expect(existsSync(join(vault, '附件/Lecture05/p1-1.png'))).toBe(true)
    await expect(tree(page).locator('.ft-att[data-path="附件/Lecture05/p1-1.png"]')).toHaveCount(1)
    await expect(tree(page).locator('.ft-gh')).toHaveText(['读进来的', '完整对话在用的附件'])
    // 历史里撤回：右键那次提交「把删掉的 2 个文件放回来」
    await rail(page).getByRole('button', { name: '历史' }).click()
    const hist = page.getByRole('complementary', { name: '历史' })
    const del = hist.getByTestId('history-commit').filter({ has: page.locator('.subj', { hasText: '删除 2 个文件：附件/老的/也没人用.png、附件/老的/没人用.png' }) })
    await expect(del).toHaveCount(1)
    await del.locator('.ch').click({ button: 'right' })
    await pickMenu(run, '把删掉的 2 个文件放回来')
    await expect.poll(() => ['附件/老的/没人用.png', '附件/老的/也没人用.png'].every((p) => existsSync(join(vault, p)))).toBe(true)
    expect(readFileSync(join(vault, '附件/老的/没人用.png'))).toEqual(png(3))
    // 放回是一次提交：等它提交完
    await expect.poll(() => git(vault, 'status', '--porcelain')).toBe('')
  } finally {
    await run.close()
  }
})

test('CN-105 Shift 连选 5 篇、⌘ 加选、空白处拖框选；底部「已选 N 个 · 移到… · 删除」；一起挪进别的文件夹，链接都改好，一次提交', async () => {
  const files: Record<string, string | Buffer> = { ...B2_VAULT, '写作/索引.md': '# 索引\n\n' + ['周三组会要问的', '一个 App 的点子', 'Kindle 导出的标注'].map((n) => `- [${n}](../收件箱/${encodeURIComponent(n)}.md)\n`).join('') }
  const run = await start(files)
  const { page, vault } = run
  try {
    await openFiles(page)
    await expand(page, '收件箱')
    const inbox = await tree(page).locator('[data-path^="收件箱/"] .truncate').allTextContents()
    expect(inbox).toHaveLength(4)
    await row(page, inbox[0]!).click()
    await row(page, inbox[3]!).click({ modifiers: ['Shift'] })
    const bar2 = side(page).getByRole('toolbar', { name: '选中的' })
    await expect(bar2.locator('b')).toHaveText('已选4个')
    // ⌘ 点去掉一个、再加回来
    await row(page, inbox[1]!).click({ modifiers: ['Meta'] })
    await expect(bar2.locator('b')).toHaveText('已选3个')
    await row(page, inbox[1]!).click({ modifiers: ['Meta'] })
    // 再 ⌘ 加一篇别处的：一共 5 个
    await expand(page, '周记')
    await row(page, '2026 第44周').click({ modifiers: ['Meta'] })
    await expect(bar2.locator('b')).toHaveText('已选5个')
    // 右键对着这一组
    await row(page, inbox[2]!).click({ button: 'right' })
    const m = await openedMenu(run)
    expect(m.find((i) => i.label === '重命名…')!.enabled).toBe(false)
    expect(m.find((i) => i.label === '移到废纸篓（5个）')).toBeTruthy()
    // 「移到…」小弹层（task-4891y）：打「项目」，点「项目」那一项
    await pickMenu(run, '移到…')
    const mover = page.getByRole('dialog', { name: '移到' })
    await expect(mover.locator('.mv-hd')).toHaveText('把选中的5个移到…')
    await mover.getByRole('searchbox').fill('项目')
    await mover.getByRole('menuitem').filter({ has: page.locator('.truncate', { hasText: /^项目$/ }) }).click()
    await expect(toast(page)).toContainText('5个挪进了「项目」，库里指向它们的链接一起改好了')
    expect(git(vault, 'log', '-1', '--format=%s')).toMatch(/^移动 5 个：.* → 项目$/)
    expect(git(vault, 'status', '--porcelain')).toBe('')
    expect(readFileSync(join(vault, '写作/索引.md'), 'utf8')).toContain('(../项目/')
    expect(readFileSync(join(vault, '写作/索引.md'), 'utf8')).not.toContain('收件箱')
    // 框选：全部收起后，在树下面的空白处按下往上拖到「周记」那一行，碰到的行都选上
    await side(page).getByRole('button', { name: '全部收起' }).click()
    const t = (await tree(page).boundingBox())!
    const last = (await tree(page).getByRole('treeitem').last().boundingBox())!
    await page.mouse.move(t.x + 120, last.y + last.height + 30)
    await page.mouse.down()
    const first = (await row(page, '周记').boundingBox())!
    await page.mouse.move(t.x + 130, first.y + 4, { steps: 8 })
    await expect(tree(page).locator('.ft-lasso')).toBeVisible()
    await page.mouse.up()
    await expect(bar2.locator('b')).toHaveText(/^已选\d+个$/)
    await page.keyboard.press('Escape')
    await expect(bar2).toHaveCount(0)
  } finally {
    await run.close()
  }
})

const pasteImage = async (page: Page) => {
  const png = [...solidPng(200, 120, [40, 120, 200])]
  await page.evaluate((bytes) => {
    const dt = new DataTransfer()
    dt.items.add(new File([new Uint8Array(bytes)], 'image.png', { type: 'image/png' }))
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
  }, png)
}

test('删笔记时的图：粘贴一张图 → 文件树右键删 → 弹窗、缩略图 → 确认后图也进废纸篓；图在 附件/ 别处（视频时刻）也问；⌘⌫、标签条「⋯」和多选删除走同一个确认', async () => {
  const files: Record<string, string | Buffer> = {
    ...B2_VAULT,
    '剪藏/视频/看过的视频.md': '# 看过的视频\n\n![](../../附件/视频/youtube-abc/01-02.jpg)\n',
    '附件/视频/youtube-abc/01-02.jpg': solidPng(60, 40, [200, 80, 40]),
  }
  const run = await start(files)
  const { page, vault, trash } = run
  try {
    await openFiles(page)
    await expand(page, '收件箱')
    await row(page, '周三组会要问的').click()
    await expect(tabOn(page)).toHaveText('周三组会要问的')
    await pane(page).locator('.cm-line', { hasText: '问一下数据集的划分' }).click()
    await page.keyboard.press('End')
    await pasteImage(page)
    await expect(pane(page).locator('.cm-image img')).toBeVisible()
    await expect.poll(() => existsSync(join(vault, '附件/收件箱/周三组会要问的/截图 1.png'))).toBe(true)
    // 文件树右键删
    await row(page, '周三组会要问的').click({ button: 'right' })
    await pickMenu(run, '移到废纸篓')
    const dlg = page.getByRole('dialog', { name: '把《周三组会要问的》移到废纸篓？' })
    await expect(dlg).toBeVisible()
    await expect(dlg.locator('.t1')).toHaveText('连同1张图一起移到废纸篓')
    await expect(dlg.locator('.t2')).toHaveText('附件/收件箱/周三组会要问的/')
    await expect(dlg.locator('.trash-thumbs img')).toHaveCount(1)
    await expect.poll(() => dlg.locator('.trash-thumbs img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth)).toBeGreaterThan(100)
    await dlg.getByRole('button', { name: '移到废纸篓' }).click()
    await expect(toast(page)).toContainText('已删除《周三组会要问的》和1张图')
    expect(existsSync(join(vault, '附件/收件箱/周三组会要问的'))).toBe(false)
    expect(readdirSync(trash).some((f) => f.endsWith('截图 1.png'))).toBe(true)
    // 图在 附件/视频/…（不在这篇自己的附件文件夹里）：以前不问也不删，现在一样问
    await expand(page, '剪藏', '视频')
    await row(page, '看过的视频').click()
    await row(page, '看过的视频').focus()
    await page.keyboard.press('Meta+Backspace')
    const dlg2 = page.getByRole('dialog', { name: '把《看过的视频》移到废纸篓？' })
    await expect(dlg2.locator('.t1')).toHaveText('连同1张图一起移到废纸篓')
    await expect(dlg2.locator('.t2')).toHaveText('附件/视频/youtube-abc/')
    await dlg2.getByRole('button', { name: '移到废纸篓' }).click()
    await expect.poll(() => existsSync(join(vault, '附件/视频'))).toBe(false)
    // 标签条右端「⋯」里的「移到废纸篓」：同一个确认、图一起走
    await row(page, '一个 App 的点子').click()
    await expect(tabOn(page)).toHaveText('一个 App 的点子')
    await pane(page).locator('.cm-content').click()
    await page.keyboard.press('Meta+End')
    await pasteImage(page)
    await expect.poll(() => existsSync(join(vault, '附件/收件箱/一个 App 的点子/截图 1.png'))).toBe(true)
    await page.getByTestId('tab-acts').getByRole('button', { name: '更多' }).click()
    await pickMenu(run, '移到废纸篓')
    const dlg4 = page.getByRole('dialog', { name: '把《一个 App 的点子》移到废纸篓？' })
    await expect(dlg4.locator('.t1')).toHaveText('连同1张图一起移到废纸篓')
    await dlg4.getByRole('button', { name: '移到废纸篓' }).click()
    await expect.poll(() => existsSync(join(vault, '附件/收件箱/一个 App 的点子'))).toBe(false)
    // 多选删除：一个确认框（没有图时也问一次）
    await expand(page, '周记')
    await row(page, '2026 第44周').click()
    await row(page, '2026 第46周').click({ modifiers: ['Shift'] })
    await side(page).getByRole('toolbar', { name: '选中的' }).getByRole('button', { name: '删除' }).click()
    const dlg3 = page.getByRole('dialog', { name: '把选中的3个移到废纸篓？' })
    await expect(dlg3).toBeVisible()
    await dlg3.getByRole('button', { name: '移到废纸篓' }).click()
    await expect(toast(page)).toContainText('已删除3个')
    expect(readdirSync(join(vault, '周记'))).toEqual([])
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => existsSync(join(vault, '周记/2026 第46周.md'))).toBe(true)
  } finally {
    await run.close()
  }
})

test('老库打开时整理一次：素材 → 剪藏、素材/微信读书 → 阅读，一次提交，链接、置顶、左栏跟着改；活动栏、树里是新的名字', async () => {
  const run = await launch({
    '素材/微信读书/人类简史.md': '---\n书名: 人类简史\n---\n> 我们没有驯化小麦\n',
    '素材/冰岛旅行/住哪.md': '# 住哪\n\n维克镇。\n',
    '写作/游记.md': '# 游记\n\n见 [住哪](../素材/冰岛旅行/住哪.md)。\n',
    '.canvas-notes/左栏.json': JSON.stringify({ 左边: ['课程', '收件箱', '素材/微信读书'] }),
    '.canvas-notes/置顶.json': JSON.stringify(['素材/冰岛旅行/住哪.md']),
  })
  const { page, vault } = run
  try {
    expect(git(vault, 'log', '-1', '--format=%s')).toBe('整理顶级分类：素材/微信读书/ → 阅读/，素材/ → 剪藏/（链接、附件、置顶、左栏跟着改）')
    expect(git(vault, 'status', '--porcelain')).toBe('')
    expect(existsSync(join(vault, '阅读/人类简史.md'))).toBe(true)
    expect(readFileSync(join(vault, '写作/游记.md'), 'utf8')).toContain('(../剪藏/冰岛旅行/住哪.md)')
    const names = await bar(page).locator('button.ab').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(names.slice(5, 13)).toEqual(CATS)
    await openFiles(page)
    await expect(row(page, '剪藏')).toHaveCount(1)
    await expect(row(page, '素材')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('空库首页：「欢迎，这是一个新库」「先存点东西进来，首页会慢慢长出来。」，封面是深海光；首页有分类卡八张', async () => {
  // 一篇笔记都没有的库（git 要有一次提交，放一个 .gitignore）
  const run = await launch({ '.gitignore': '.DS_Store\n' })
  const { page } = run
  try {
    await expect(page.getByTestId('home-title')).toHaveText('欢迎，这是一个新库')
    await expect(page.getByTestId('home').locator('.hello .lead')).toHaveText('先存点东西进来，首页会慢慢长出来。')
    expect(await page.getByTestId('home-cover').evaluate((e) => getComputedStyle(e).backgroundImage)).toContain('radial-gradient')
    await expect(page.getByTestId('home-cats').locator('.ccard')).toHaveCount(8)
    await expect(page.getByTestId('widget-cats').locator('.wk')).toHaveText('分类8个 · 点开看它的首页')
    await expect(page.getByTestId('cat-收件箱')).toContainText('0篇 · 还没想好放哪的先进这里')
  } finally {
    await run.close()
  }
})

test('书摘（frontmatter 有 bookId）开成标签用 quote 图标，和「阅读」首页的 book 分得开；阅读/ 里自己写的照旧是文档图标', async () => {
  const run = await launch({ [DIGEST_PATH]: DIGEST, '阅读/三体读后.md': '# 三体读后\n\n自己写的。\n' })
  const { page } = run
  // 标签上那个图标的第一段路径：quote 的是「M5.99902 2.99902」开头（@cn/design 的 codicons.gen.ts）
  const iconOf = () => tabOn(page).locator('svg').first().evaluate((s) => s.innerHTML.slice(0, 40))
  try {
    await openNote(page, '三体读后')
    await expect(tabOn(page)).toHaveText('三体读后')
    expect(await iconOf()).not.toContain('M5.99902 2.99902')
    await openNote(page, DIGEST_PATH.slice('阅读/'.length, -'.md'.length))
    await expect(tabOn(page)).toContainText('趣说明朝')
    await expect.poll(iconOf).toContain('M5.99902 2.99902')
  } finally {
    await run.close()
  }
})

test('同一篇在哪都是同一个图标：剪藏页「最近改的」、下面的笔记列表、左栏树、⌘K 都一样；书摘（bookId）都是 quote，剪来的普通笔记都是文档', async () => {
  const run = await start({ ...B2_VAULT, [DIGEST_PATH]: DIGEST })
  const { page } = run
  // 一个 svg 图标的样子（路径），比较是不是同一个图标；quote 的路径以「M5.99902 2.99902」开头（@cn/design 的 codicons.gen.ts）
  const QUOTE = 'M5.99902 2.99902'
  const svg = (l: ReturnType<Page['locator']>) => l.locator('svg').first().evaluate((s) => s.innerHTML)
  const icons = async (name: string) => {
    const h = home(page)
    const recent = h.locator('.fw-row', { hasText: name }).first()
    const list = h.locator('.fc-row', { hasText: name }).first()
    await expect(recent).toBeVisible()
    await expect(list).toBeVisible()
    return { recent: await svg(recent), list: await svg(list), tree: await svg(row(page, name).first()) }
  }
  try {
    await cell(page, '剪藏').click()
    await expect(home(page)).toBeVisible()
    const clip = await icons('一段播客文字稿')
    expect(clip.list).toBe(clip.recent)
    expect(clip.tree).toBe(clip.recent)
    expect(clip.recent).not.toContain(QUOTE)
    await cell(page, '阅读').click()
    await expect(home(page)).toContainText('阅读')
    const book = await icons(DIGEST_PATH.slice('阅读/'.length, -'.md'.length))
    expect(book.recent).toContain(QUOTE)
    expect(book.list).toBe(book.recent)
    expect(book.tree).toBe(book.recent)
    // ⌘K 里搜到它也是 quote
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('趣说明朝')
    const hit = page.locator('.pal-row').filter({ has: page.locator('.nm', { hasText: /^趣说明朝276年（微信读书出品）$/ }) }).first()
    await expect(hit).toBeVisible()
    expect(await svg(hit)).toBe(book.recent)
    await page.keyboard.press('Escape')
  } finally {
    await run.close()
  }
})
