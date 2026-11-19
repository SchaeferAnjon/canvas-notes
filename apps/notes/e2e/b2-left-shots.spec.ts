// 顶级分类、文件夹封面、左栏这一组（B-左栏与文件夹 v2）和小样并排对照用的截图：B 浮岛书桌，浅色天青、深色深湖，1440 × 887。
// 只在给了 CN_SHOTS（截图放哪）时跑；每张都是真点出来的状态，编号和小样那边（scripts/proto-shots2.cjs）一一对上。
// CN_SHOTS=<文件夹> npx playwright test e2e/b2-left-shots.spec.ts（外壳那一区的对照图是 b2-shots.spec.ts）
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launch, rail, type Running } from './app'
import { B2_VAULT, withTimes } from './fixtures/b2-vault'
import { armMenus, pickMenu } from './menu'
import { solidPng } from './fixtures/png'

const SHOTS = process.env.CN_SHOTS
test.skip(!SHOTS, '只在截对照图时跑（给 CN_SHOTS）')

const png = (i: number) => solidPng(160 + i * 10, 100, [40 + 30 * i, 110, 170])
/** 小样那个库，再加几张图（「附件」筛选那张要有东西） */
const VAULT: Record<string, string | Buffer> = {
  ...B2_VAULT,
  '写作/游记/去冰岛之前要知道的十件事.md': '# 去冰岛之前要知道的十件事\n\n冬天去冰岛，最要紧的是看天气和路况。\n\n' + [1, 2, 3, 4].map((i) => `![](../../附件/写作/游记/去冰岛之前要知道的十件事/截图%20${i}.png)\n`).join('\n'),
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`附件/写作/游记/去冰岛之前要知道的十件事/截图 ${i}.png`, png(i)])),
  '附件/老的/没人用.png': png(6),
  // 小样里这两个文件夹选了图当封面（冰岛旅行教会山、ecpc 冰洞）；别的用分类表里的
  '项目/冰岛旅行/.首页.json': JSON.stringify({ cover: { kind: 'builtin', id: 'kirkjufell' } }),
  '课程/ecpc/.首页.json': JSON.stringify({ cover: { kind: 'builtin', id: 'ice-cave' } }),
}

const settings = (appearance: Record<string, unknown>, times = true) => (v: string) => {
  if (times) withTimes(v)
  const ud = join(dirname(v), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, ...appearance } }))
}
async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(SHOTS!, `${name}.png`), Buffer.from(b64, 'base64'))
}
/** 「在哪」标注图用：几块东西在截图上的框（设备像素，和 capturePage 一样） */
async function boxes(run: Running, name: string, sel: Record<string, string>) {
  const r = await run.page.evaluate((sel) => {
    const k = window.devicePixelRatio
    const out: Record<string, number[]> = {}
    for (const [label, css] of Object.entries(sel)) {
      const els = [...document.querySelectorAll(css)].filter((e) => (e as HTMLElement).offsetParent !== null)
      if (!els.length) continue
      const rs = els.map((e) => e.getBoundingClientRect())
      const x = Math.min(...rs.map((b) => b.left)), y = Math.min(...rs.map((b) => b.top))
      const x2 = Math.max(...rs.map((b) => b.right)), y2 = Math.max(...rs.map((b) => b.bottom))
      out[label] = [x * k, y * k, (x2 - x) * k, (y2 - y) * k].map(Math.round)
    }
    return out
  }, sel)
  writeFileSync(join(SHOTS!, `${name}.boxes.json`), JSON.stringify(r, null, 1))
}
const bar = (page: Page) => page.getByRole('navigation', { name: '左栏' })
const cell = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })
const side = (page: Page) => page.locator('aside.side')
const tree = (page: Page) => side(page).getByRole('tree')
const row = (page: Page, name: string) => tree(page).getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
const home = (page: Page) => page.getByTestId('folder-home')
async function openFiles(page: Page) {
  if ((await cell(page, '文件').getAttribute('aria-pressed')) !== 'true') await cell(page, '文件').click()
}
async function expand(page: Page, ...names: string[]) {
  for (const n of names) if ((await row(page, n).first().getAttribute('aria-expanded')) !== 'true') await row(page, n).first().locator('.ft-tw').click()
}
async function openCell(page: Page, name: string) {
  // 亮着的那格再点是收起左栏：先换到「文件」
  if ((await cell(page, name).getAttribute('aria-pressed')) === 'true') await openFiles(page)
  await cell(page, name).click()
  await expect(home(page)).toHaveAttribute('data-folder', name)
}
async function openInTree(page: Page, path: string) {
  await openFiles(page)
  const parts = path.split('/')
  await expand(page, ...parts.slice(0, -1))
  await row(page, parts.at(-1)!).click()
  await expect(home(page)).toHaveAttribute('data-folder', path)
}

/** 每一组新开一次软件（标签、提示条不串到下一组），1440 × 887 */
async function fresh(tone: 'light' | 'dark', body: (run: Running, t: string) => Promise<void>, files: Record<string, string | Buffer> = VAULT) {
  const run = await launch(files, {}, settings({ skin: tone === 'light' ? 'sky' : 'petrol', frame: 'b' }, files === VAULT))
  try {
    await armMenus(run)
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await run.page.waitForTimeout(300)
    await body(run, tone === 'light' ? '浅' : '深')
  } finally {
    await run.close()
  }
}

for (const tone of ['light', 'dark'] as const)
  test(`左栏和文件夹页对照截图（${tone === 'light' ? '浅色' : '深色'}）`, async () => {
    test.setTimeout(300_000)
    await fresh(tone, async (run, t) => {
      const { page } = run
      // ---------- A 活动栏平铺：每一格 ----------
      await openCell(page, '课程')
      await shot(run, `A0-课程-${t}`)
      await boxes(run, `A0-课程-${t}`, {
        活动栏分类: 'nav.abar.left [data-testid^="ab-dir:"], nav.abar.left [data-testid="ab-inbox"]',
        左栏那一枝: 'aside.side',
        横幅和图标: '.pane:not([hidden]) [data-testid="folder-cover"], .pane:not([hidden]) .fh-ico',
        种类篇数和放什么: '.pane:not([hidden]) .fh-tx, .pane:not([hidden]) [data-testid="cat-desc"]',
        组件: '.pane:not([hidden]) .wgrid',
      })
      for (const name of ['收件箱', '课程', '阅读', '剪藏', '周记', '写作', '项目', '生活']) {
        await openCell(page, name)
        await shot(run, `A1-${name}-${t}`)
      }
      await openFiles(page)
      await expand(page, '收件箱', '课程', 'ecpc', '阅读', '剪藏', '周记', '写作')
      await tree(page).evaluate((el) => el.closest('.nav')?.scrollTo(0, 0))
      await shot(run, `A1-文件-${t}`)
      await cell(page, '最近').click()
      await shot(run, `A1-最近-${t}`)
      // 悬停「阅读」那一格：名字提示
      await openCell(page, '课程')
      await cell(page, '阅读').hover()
      await expect(page.getByTestId('tooltip')).toHaveText('阅读')
      await shot(run, `A2-悬停阅读-${t}`)
      // 右键写作 → 从左边拿下：底部能撤回（系统菜单本身截不到）
      await cell(page, '写作').click({ button: 'right' })
      await pickMenu(run, '从左边拿下')
      await expect(page.getByTestId('toast')).toContainText('从左边拿下了')
      await page.mouse.move(700, 400)
      await shot(run, `A4-拿下写作-${t}`)
      await page.getByTestId('toast').getByRole('button', { name: '撤回' }).click()
      await expect(cell(page, '写作')).toHaveCount(1)
      // 放什么：点一下改、回车存好
      await openCell(page, '阅读')
      await page.getByTestId('cat-desc').locator('.ed').click()
      await shot(run, `A7-改放什么-${t}`)
      await page.keyboard.press('End')
      await page.keyboard.type('，还有纸书')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('toast')).toContainText('分类.json')
      await shot(run, `A8-改好放什么-${t}`)
      // 在「文件」里看位置
      await side(page).locator('.sall button').click()
      await expect(row(page, '阅读')).toHaveClass(/ring/)
      await shot(run, `A9-在文件里看位置-${t}`)
    })
    await fresh(tone, async (run, t) => {
      const { page } = run
      // ---------- C 首页一排分类卡（左栏和小样一样开着「文件」） ----------
      await openFiles(page)
      await page.getByRole('banner').getByRole('button', { name: '首页', exact: true }).click()
      await expect(page.getByTestId('home-cats')).toBeVisible()
      await shot(run, `C0-首页-${t}`)
      await boxes(run, `C0-首页-${t}`, { 分类卡: '[data-testid="widget-cats"]' })
      await page.getByTestId('cat-阅读').click()
      await expect(home(page)).toHaveAttribute('data-folder', '阅读')
      await shot(run, `C1-点阅读卡-${t}`)
    })
    await fresh(tone, async (run, t) => {
      const { page } = run
      // ---------- F 文件夹封面 ----------
      for (const [n, p] of [['课程', '课程'], ['ecpc', '课程/ecpc'], ['冰岛旅行', '项目/冰岛旅行'], ['剪藏', '剪藏'], ['趣说明朝', '阅读/趣说明朝276年']] as const) {
        await openInTree(page, p)
        await shot(run, `F-${n}-${t}`)
      }
      await openInTree(page, '项目/冰岛旅行')
      const cover = page.getByTestId('folder-cover')
      await cover.hover()
      await shot(run, `F-悬停横幅-${t}`)
      await cover.getByRole('button', { name: '换封面' }).click()
      const gal = page.getByRole('dialog', { name: '换封面' })
      await expect(gal).toBeVisible()
      await shot(run, `F-换封面-${t}`)
      await gal.getByRole('button', { name: '极光', exact: true }).click()
      await expect(page.getByTestId('toast')).toContainText('封面换好了')
      await shot(run, `F-换好封面-${t}`)
      await cover.hover()
      await cover.getByRole('button', { name: '调整位置' }).click()
      await shot(run, `F-调整位置-${t}`)
      const b = (await cover.boundingBox())!
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 5 })
      await page.mouse.up()
      await cover.getByRole('button', { name: '存好' }).click()
      await expect(page.getByTestId('toast')).toContainText('位置存好了')
      await shot(run, `F-存好位置-${t}`)
      await home(page).locator('.fh-tx h2').dblclick()
      await expect(home(page).getByRole('textbox', { name: '文件夹名字' })).toBeFocused()
      await shot(run, `F-改名冰岛旅行-${t}`)
      await page.keyboard.press('Escape')
    })
    await fresh(tone, async (run, t) => {
      const { page } = run
      // ---------- 直接修 ----------
      // CN-102、103、114 加组件：一个列表三组
      await openInTree(page, '课程/ecpc')
      await page.getByTestId('tab-acts').getByRole('button', { name: '编辑首页' }).click()
      await home(page).getByRole('button', { name: '加组件' }).click()
      await expect(page.getByRole('dialog', { name: '加组件' })).toBeVisible()
      await shot(run, `CN102-加组件-${t}`)
      await page.getByRole('dialog', { name: '加组件' }).getByRole('button', { name: '完成' }).click()
      await page.getByTestId('tab-acts').getByRole('button', { name: '完成' }).click()
      // CN-104 白板筛选（最外层的白板挂在库名下面）、附件筛选
      await openFiles(page)
      await side(page).getByRole('tab', { name: '白板' }).click()
      await shot(run, `CN104-白板筛选-${t}`)
      await side(page).getByRole('tab', { name: '附件' }).click()
      await expand(page, '写作', '游记')
      await row(page, '去冰岛之前要知道的十件事').locator('.ft-tw').click()
      await shot(run, `CN104-附件筛选-${t}`)
      await side(page).getByRole('tab', { name: '全部' }).click()
      // CN-105 Shift 连选、框选
      await side(page).getByRole('button', { name: '全部收起' }).click()
      await expand(page, '收件箱')
      const inbox = await tree(page).locator('[data-path^="收件箱/"] .truncate').allTextContents()
      await row(page, inbox[0]!).click()
      await row(page, inbox[2]!).click({ modifiers: ['Shift'] })
      await expect(side(page).getByRole('toolbar', { name: '选中的' })).toBeVisible()
      await shot(run, `CN105-Shift多选-${t}`)
      await page.keyboard.press('Escape')
      const tb = (await tree(page).boundingBox())!
      const last = (await tree(page).getByRole('treeitem').last().boundingBox())!
      await page.mouse.move(tb.x + 150, last.y + last.height + 30)
      await page.mouse.down()
      const top = (await row(page, '写作').boundingBox())!
      await page.mouse.move(tb.x + 170, top.y + 6, { steps: 8 })
      await expect(tree(page).locator('.ft-lasso')).toBeVisible()
      await shot(run, `CN105-框选-${t}`)
      await page.mouse.up()
      await page.keyboard.press('Escape')
      // CN-113 中间栏窄：课件进度最后一格「拖PDF」
      await openInTree(page, '课程/ecpc')
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1100, 860))
      await rail(page).getByRole('button', { name: /^历史/ }).click()
      await expect(page.getByRole('complementary', { name: '历史' })).toBeVisible()
      await shot(run, `CN113-拖PDF-${t}`)
    })
    // 走样修：空库首页（一篇笔记都没有；库里要有一次提交，放一个忽略文件）、写作首页
    await fresh(
      tone,
      async (run, t) => {
        await expect(run.page.getByTestId('home-title')).toHaveText('欢迎，这是一个新库')
        await shot(run, `Z13-空库首页-${t}`)
      },
      { ['.' + 'gitignore']: '.DS_Store\n' },
    )
    await fresh(tone, async (run, t) => {
      await openCell(run.page, '写作')
      await shot(run, `Z14-写作首页-${t}`)
    })
  })
