// 英文版第二批的中英对照图（task-zojmg）：同一份样本库，中文那一遍是中文库，英文那一遍是英文库（分类文件夹英文名、记着库语言），
// 浅色天青、深色深湖。只在给了 CN_SHOTS（放图的文件夹）时跑；CN_SHOT_TONE=dark 截深色。窗口 1440 × 887，浮岛书桌。
// 每一步都真点：目录树、文档的 / 菜单、属性、白板工具板和卡片、白板收件箱、数据库列头菜单、文件夹首页和它的两个弹窗、历史、移到废纸篓、归档。
// 右键菜单是系统原生的，截不到图：读出每个菜单的项，存成 menus-<lang>.json，对照页上列成表。
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { acts, launch, leftView, pane, type Running } from './app'
import { armMenus, dismissMenu, menuLabels, openedMenu, pickMenu } from './menu'
import { cat, enVault, L } from './zojmg-lib'

const DIR = process.env.CN_SHOTS ?? ''
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TONE = DARK ? 'dark' : 'light'
test.skip(!DIR, '只在 CN_SHOTS 给了时截图')

type Lang = 'zh' | 'en'

/** 样本库：内容是英文（对照的是界面），分类文件夹照这一遍的库语言 */
function lib(lang: Lang): Record<string, string> {
  const P = cat(lang, '项目')
  return {
    '收件箱/Call the landlord.md': '# Call the landlord\n\nAsk about the heating before Friday.\n',
    '收件箱/Podcast idea.md': '# Podcast idea\n\nShort episodes on how people take notes.\n',
    '课程/Machine Learning/Lecture 5 Attention.md':
      '---\n类型: 笔记\n课程: Machine Learning\n第几讲: 5\n---\n# Lecture 5 Attention\n\nHow one word "looks at" the other words in a sentence.\n\n## Queries and keys\n\nEach token asks a question and every other token answers.\n\n## Softmax\n\nThe scores become weights that sum to one.\n',
    '课程/Machine Learning/Lecture 4 Backprop.md': '---\n类型: 笔记\n课程: Machine Learning\n第几讲: 4\n---\n# Lecture 4 Backprop\n\nThe chain rule, one layer at a time.\n',
    '课程/Linear Algebra/Week 3 Linear maps.md': '# Week 3 Linear maps\n\nKernel and image.\n',
    '阅读/Thinking, Fast and Slow.md': '# Thinking, Fast and Slow\n\nSystem 1 is fast and automatic; System 2 is slow and effortful.\n',
    '剪藏/Travel/How to see the aurora.md': '---\nsource: https://example.com/aurora\n---\n# How to see the aurora\n\n> Go out when cloud cover is under 30%.\n',
    '周记/2026-W47.md': '# 2026-W47\n\nMonday: started the homework for lecture 5.\n',
    '写作/On slow reading.md': '# On slow reading\n\nA draft about reading one book for a whole month.\n',
    '项目/Iceland trip/Itinerary.md': `# Itinerary\n\nDay 1: Reykjavík. Day 2: the south coast.\n\n## Stays\n\n\`\`\`base\nfilters:\n  and:\n    - file.inFolder("${P}/Iceland trip/Stays")\nviews:\n  - type: table\n    name: Stays\n    order:\n      - file.name\n      - Price\n      - Rating\n\`\`\`\n`,
    '项目/Iceland trip/Stays/Reykjavik Loft.md': '---\nPrice: 1080\nRating: 9.1\n---\n',
    '项目/Iceland trip/Stays/Vik Black Beach Inn.md': '---\nPrice: 980\nRating: 8.6\n---\n',
    '项目/Iceland trip/Trip board.md':
      '---\ntype: board\n---\n# Trip board\n\n## Before we go\n\nBook the ice cave tour two weeks ahead.\n\n- [ ] Rent a car\n- [ ] Buy crampons\n\n## Day 1\n\nLand at KEF, drive to Reykjavík.\n\n## Day 2\n\nSouth coast: Seljalandsfoss and Vík.\n',
    '生活/Running log.md': '# Running log\n\n5 km, 31 min.\n',
  }
}

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  // 删笔记前每次都问：截「移到废纸篓」那个确认框
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' }, files: { delAsk: 'always' } }))
}

/** 对照页上标框的几块（有就记） */
const MARKS: Record<string, string> = {
  side: 'aside.side',
  chips: 'aside.side .tchips',
  slash: '.slash-menu',
  props: '.mm-props',
  meta: '.cm-chip, .fchip',
  palette: '.bpal',
  inbox: '.db-inbox-pop',
  colmenu: '.base-colmenu',
  base: '[data-part="数据库块"]',
  lead: '[data-testid="folder-lead"]',
  lib: '.fh-win.lib',
  cond: '.fh-win.cond',
  history: '[role=complementary][aria-label="History"], [role=complementary][aria-label="历史"]',
  trash: '.trash-dlg',
  tabs: '[data-testid="tab-list"]',
  acts: '[data-testid="tab-acts"]',
  toast: '[data-testid="toast"]',
}

async function shot(page: Page, name: string, lang: Lang) {
  await page.waitForTimeout(450)
  await page.screenshot({ path: join(DIR, `${name}-${lang}-${TONE}.png`) })
  const m = await page.evaluate(measure)
  const marks: Record<string, number[]> = {}
  for (const [k, sel] of Object.entries(MARKS)) {
    const loc = page.locator(sel).first()
    // 没有的不等（boundingBox 默认会等 30 秒）
    const r = (await loc.count()) ? await loc.boundingBox({ timeout: 500 }).catch(() => null) : null
    if (r && r.width && r.height) marks[k] = [r.x, r.y, r.width, r.height].map((v) => Math.round(v))
  }
  writeFileSync(join(DIR, `${name}-${lang}-${TONE}.json`), JSON.stringify({ ...m, marks }, null, 1))
}

/** 量：被截掉的、按钮和标签折了行的、还露着的中文（用户的字也在里面，人工分） */
function measure() {
  const HAN = /\p{Script=Han}/u
  const out: { cut: { text: string; why: string; box: number[] }[]; wrap: { text: string; box: number[] }[]; han: string[] } = { cut: [], wrap: [], han: [] }
  const vis = (r: DOMRect) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth
  const box = (r: DOMRect) => [r.x, r.y, r.width, r.height].map((v) => Math.round(v))
  const han = new Set<string>()
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const r = el.getBoundingClientRect()
    if (!vis(r)) continue
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').replace(/\s+/g, ' ').trim()
    const cs = getComputedStyle(el)
    if (own && HAN.test(own) && cs.visibility !== 'hidden') han.add(own.slice(0, 60))
    const ph = (el as HTMLInputElement).placeholder
    if (ph && HAN.test(ph)) han.add('[提示字] ' + ph)
    if (!own && !ph) continue
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && (cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis'))
      out.cut.push({ text: (own || ph).slice(0, 80), why: cs.textOverflow === 'ellipsis' ? '省略号' : '裁掉', box: box(r) })
    const clickable = /^(BUTTON|A|LABEL)$/.test(el.tagName) || ['tab', 'menuitem', 'radio', 'option'].includes(el.getAttribute('role') ?? '')
    if (clickable && cs.whiteSpace !== 'nowrap') {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4
      const tops = new Set<number>()
      for (const n of el.childNodes) {
        if (n.nodeType !== 3 || !(n.textContent ?? '').trim()) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const x of range.getClientRects()) tops.add(Math.round(x.top))
      }
      if (tops.size > 1 && r.height > lh * 1.6) out.wrap.push({ text: own.slice(0, 80), box: box(r) })
    }
  }
  out.han = [...han]
  return out
}

const tree = (page: Page) => page.locator('aside.side').getByRole('tree')
const row = (page: Page, name: string) =>
  tree(page)
    .getByRole('treeitem')
    .filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
    .first()
const cell = (page: Page, name: string) => page.getByRole('navigation', { name: /^(左栏|Left sidebar)$/ }).getByRole('button', { name, exact: true })

/** 展开树里的一行（点箭头，不开首页） */
async function expand(page: Page, name: string) {
  const r = row(page, name)
  if ((await r.getAttribute('aria-expanded')) !== 'true') await r.locator('.ft-tw').click()
  await expect(r).toHaveAttribute('aria-expanded', 'true')
}

/** ⌘K 打名字、回车开第一个 */
async function open(page: Page, lang: Lang, title: string) {
  await page.keyboard.press('Meta+k')
  const pal = page.getByRole('dialog', { name: L(lang, '搜索和命令', 'Search and commands') })
  await expect(pal).toBeVisible()
  await pal.getByRole('textbox').first().fill(title)
  await expect(pal.getByRole('option').first()).toContainText(title)
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('tab-on')).toHaveText(title)
}

/** 读出这一次弹的右键菜单，收起来 */
async function menuOf(run: Running): Promise<string[]> {
  const labels = menuLabels(await openedMenu(run))
  await dismissMenu(run)
  return labels
}

async function walk(lang: Lang) {
  const files = lang === 'en' ? (enVault(lib('en')) as Record<string, string>) : lib('zh')
  const run: Running = await launch(files, { CN_AI_FAKE: '1', CN_LANG: lang }, look)
  const { page, app } = run
  const menus: Record<string, string[]> = {}
  try {
    await armMenus(run)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await expect.poll(() => page.evaluate(() => innerHeight)).toBe(887)
    await page.waitForTimeout(800)

    // 1 目录树：文件、展开项目和冰岛那一枝
    await leftView(page, L(lang, '文件', 'Files'))
    await expand(page, cat(lang, '项目'))
    await expand(page, 'Iceland trip')
    await shot(page, 'tree', lang)
    // 右键：一篇笔记、一个文件夹、一个分类（系统菜单读项）
    await row(page, 'Itinerary').click({ button: 'right' })
    menus.note = await menuOf(run)
    await row(page, 'Iceland trip').click({ button: 'right' })
    menus.folder = await menuOf(run)
    await row(page, cat(lang, '课程')).click({ button: 'right' })
    menus.category = await menuOf(run)

    // 2 文档：标题下那一行、/ 菜单、属性
    await open(page, lang, 'Lecture 5 Attention')
    const doc = pane(page).locator('.cm-content')
    await expect(doc).toBeVisible()
    await shot(page, 'doc', lang)
    await doc.click()
    await page.keyboard.press('Meta+ArrowDown')
    await page.keyboard.press('Enter')
    await page.keyboard.type('/')
    await expect(page.locator('.slash-menu')).toBeVisible()
    await shot(page, 'slash', lang)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Backspace')
    await acts(page).locator('.mm-propbtn button').click()
    await expect(page.locator('.mm-props')).toBeVisible()
    await shot(page, 'props', lang)
    await page.keyboard.press('Escape')

    // 3 白板：工具板、列、卡片；收件箱弹窗；卡片右键
    await open(page, lang, 'Trip board')
    await expect(pane(page).getByTestId('doc-board')).toBeVisible()
    await expect(pane(page).locator('.bpal')).toBeVisible()
    await shot(page, 'board', lang)
    await pane(page).locator('.db-card').first().click({ button: 'right' })
    menus.card = await menuOf(run)
    await pane(page).getByTestId('board-corner').getByTestId('db-inbox').click()
    await expect(pane(page).locator('.db-inbox-pop')).toBeVisible()
    await pane(page).locator('.db-inbox-pop').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)))
    await shot(page, 'board-inbox', lang)
    await pane(page).getByTestId('board-corner').getByTestId('db-inbox').click()

    // 4 数据库：文档里的表，点列头开列菜单
    await open(page, lang, 'Itinerary')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)
    await db.getByRole('button', { name: 'Price', exact: true }).click()
    await expect(page.locator('.base-colmenu')).toBeVisible()
    await shot(page, 'base', lang)
    await page.keyboard.press('Escape')

    // 5 文件夹首页：课程那一格、一门课、编辑首页的加组件、按条件列出
    await cell(page, cat(lang, '课程')).click()
    await expect(page.getByTestId('folder-home')).toHaveAttribute('data-folder', cat(lang, '课程'))
    await shot(page, 'folder-courses', lang)
    await page.getByTestId('folder-home').locator('.fw-course', { hasText: 'Machine Learning' }).first().click()
    await expect(page.getByTestId('folder-home')).toHaveAttribute('data-folder', `${cat(lang, '课程')}/Machine Learning`)
    await shot(page, 'folder-course', lang)
    await acts(page).getByRole('button', { name: L(lang, '编辑首页', 'Edit home') }).click()
    const home = page.getByTestId('folder-home')
    await home.getByRole('button', { name: L(lang, '加组件', 'Add widget') }).click()
    await expect(page.locator('.fh-win.lib')).toBeVisible()
    await shot(page, 'folder-lib', lang)
    await page.keyboard.press('Escape')
    await expect(page.locator('.fh-win.lib')).toHaveCount(0)
    await home.getByRole('button', { name: L(lang, '条件', 'Filter') }).first().click()
    await expect(page.locator('.fh-win.cond')).toBeVisible()
    // 加一条「来源 包含」：比较那个下拉里最长的几项（is any of、contains）要放得下
    const cond = page.locator('.fh-win.cond')
    await cond.getByRole('button', { name: L(lang, '加条件', 'Add filter') }).click()
    await cond.getByRole('combobox', { name: L(lang, '属性', 'Property') }).nth(1).selectOption('来源')
    await cond.getByRole('combobox', { name: L(lang, '比较', 'Operator') }).nth(1).selectOption('包含')
    await shot(page, 'folder-cond', lang)
    await page.keyboard.press('Escape')
    await expect(page.locator('.fh-win.cond')).toHaveCount(0)
    await shot(page, 'folder-edit', lang)
    await acts(page).getByRole('button', { name: L(lang, '完成', 'Done') }).click()

    // 6 历史：底栏「N 处没提交」弹层里点历史
    await page.getByTestId('git-changed').click()
    await page.getByRole('dialog', { name: L(lang, '没提交的改动', 'Uncommitted changes') }).getByRole('button', { name: L(lang, '历史', 'History'), exact: true }).click()
    await expect(page.getByRole('complementary', { name: L(lang, '历史', 'History') })).toBeVisible()
    await shot(page, 'history', lang)

    // 7 移到废纸篓：树里右键一篇，点「移到废纸篓」，弹确认框（不真删，点取消）
    await leftView(page, L(lang, '文件', 'Files'))
    await expand(page, cat(lang, '收件箱'))
    await row(page, 'Podcast idea').click({ button: 'right' })
    await pickMenu(run, L(lang, '移到废纸篓', 'Move to Trash'))
    await expect(page.locator('.trash-dlg')).toBeVisible()
    await shot(page, 'trash', lang)
    await page.locator('.trash-dlg').getByRole('button', { name: L(lang, '取消', 'Cancel') }).click()

    // 8 归档：左栏「最近」最下面一行
    await leftView(page, L(lang, '最近', 'Recent'))
    await page.locator('aside.side .sall .si').first().click()
    await page.waitForTimeout(400)
    await shot(page, 'archive', lang)
  } finally {
    writeFileSync(join(DIR, `menus-${lang}.json`), JSON.stringify(menus, null, 1))
    await run.close()
  }
}

test('第二批画面：中文', async () => {
  test.setTimeout(300_000)
  mkdirSync(DIR, { recursive: true })
  await walk('zh')
})

test('第二批画面：英文', async () => {
  test.setTimeout(300_000)
  mkdirSync(DIR, { recursive: true })
  await walk('en')
})
