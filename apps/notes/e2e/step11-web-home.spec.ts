import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, rail, webMore } from './app'

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const name = decodeURIComponent((req.url ?? '/').slice(1)) || '首页'
    res.end(`<title>${name}</title><h1>${name}</h1><p>这是 ${name} 这一页。</p>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const home = (page: Page) => web(page).getByRole('region', { name: '书签首页' })
const quick = (page: Page) => home(page).getByRole('list', { name: '快捷书签' })
const tiles = (page: Page) => quick(page).locator(':scope > [role=listitem]')

function guest(page: Page, code: string, sel = '.right.web webview.on'): Promise<unknown> {
  return page.evaluate(
    ([c, s]) => {
      const w = document.querySelector(s!) as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
      return w ? w.executeJavaScript(c!) : Promise.resolve(null)
    },
    [code, sel],
  )
}

/** 软件设置目录里先放好几个书签（和从 Chrome 导进来的一样的格式） */
function seed(userData: string) {
  mkdirSync(join(userData, 'web'), { recursive: true })
  const bm = (id: string, title: string, folder = '书签栏') => ({ id, title, url: `${base}/${encodeURIComponent(title)}`, folder, addedMs: Date.now() - 86400_000 })
  writeFileSync(
    join(userData, 'web', 'bookmarks.json'),
    JSON.stringify([bm('b1', '黑沙滩'), bm('b2', '黄金瀑布'), bm('b3', '蓝湖'), bm('b4', '冰川徒步'), bm('b5', '租车攻略', '其他书签 / 出发前')]),
  )
}
const saved = (userData: string) => JSON.parse(readFileSync(join(userData, 'web', 'bookmarks.json'), 'utf8')) as { id: string; title: string; folder: string }[]

/**
 * 按住一个快捷书签拖（真的鼠标按下、移动、松开）：
 * merge = 停在另一个图标正中 0.4 秒再松手（合并成分组）；after / before = 松在那一格的右边 / 左边（排序）
 */
async function dragTile(page: Page, from: string, to: string, how: 'merge' | 'after' | 'before') {
  const a = (await tiles(page).filter({ has: page.getByRole('button', { name: from, exact: true }) }).locator('.qt-ic').boundingBox())!
  const toTile = tiles(page).filter({ has: page.getByRole('button', { name: to, exact: true }) })
  const ic = (await toTile.locator('.qt-ic').boundingBox())!
  const box = (await toTile.boundingBox())!
  const x = how === 'merge' ? ic.x + ic.width / 2 : how === 'after' ? box.x + box.width - 3 : box.x + 3
  const y = ic.y + ic.height / 2
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 8; i++) await page.mouse.move(a.x + a.width / 2 + ((x - a.x - a.width / 2) * i) / 8, a.y + a.height / 2 + ((y - a.y - a.height / 2) * i) / 8)
  if (how === 'merge') {
    await expect(toTile).toHaveClass(/\bmerge\b/)
    await expect(toTile).toContainText('合并成分组')
  }
  await page.mouse.up()
}

test('书签首页：新开网页标签就是它；搜书签、点快捷书签在当前标签打开；拖到一起合成分组（书签栏里多一个文件夹）、拖到两格之间排序、改名、移出分组；文件夹里的加到快捷书签；打开的标签按网站分组，收藏、稍后看、全部关闭；重开还在', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cn-ud-'))
  seed(userData)
  let run = await launch({ 'a.md': '# a\n' }, { CN_USER_DATA: userData })
  try {
    let { page } = run
    // 右栏网页还没开过网页：直接是书签首页
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(home(page)).toBeVisible()
    await expect(home(page).getByRole('heading', { level: 1 })).toHaveText(/^(早上好|中午好|下午好|晚上好|夜深了)$/)
    await expect(home(page)).toContainText('5 个书签 · 2 个文件夹')
    await expect(tiles(page)).toHaveText(['黑沙滩', '黄金瀑布', '蓝湖', '冰川徒步'])

    // 搜：别的文件夹里的也搜得到，回车在当前标签打开
    await home(page).getByRole('heading', { level: 1 }).click()
    await page.keyboard.press('/')
    await expect(home(page).getByRole('textbox', { name: '搜索全部书签' })).toBeFocused()
    await page.keyboard.type('攻略')
    const results = home(page).getByRole('listbox', { name: '搜到的书签' })
    await expect(results.getByRole('option')).toHaveText([/租车攻略.*出发前/])
    await expect(results.locator('mark').first()).toHaveText('攻略')
    await page.keyboard.press('Enter')
    await expect.poll(() => guest(page, 'document.title')).toBe('租车攻略')
    await expect(webTabs(page)).toHaveText(['租车攻略'])
    await expect(home(page)).toHaveCount(0)

    // ⌘T 新开一个：又是书签首页；点快捷书签在这个新标签里打开
    await web(page).getByRole('textbox', { name: '网址' }).click()
    await page.keyboard.press('Meta+t')
    await expect(webTabs(page)).toHaveCount(2)
    await expect(home(page)).toBeVisible()
    await quick(page).getByRole('button', { name: '黑沙滩', exact: true }).click()
    await expect.poll(() => guest(page, 'document.title')).toBe('黑沙滩')
    await expect(webTabs(page)).toHaveText(['租车攻略', '黑沙滩'])

    // 标签条的 + 新开一个：打开的标签按网站分组，两个都在 127.0.0.1 下面
    await web(page).getByRole('button', { name: '新网页' }).click()
    await expect(home(page)).toBeVisible()
    const site = home(page).getByRole('group', { name: '127.0.0.1' })
    await expect(site.locator('.bkh-n')).toHaveText('2')
    await expect(site.locator('.bkh-n')).toHaveAttribute('title', '2 个标签')
    await expect(site.getByRole('listitem')).toHaveText(['租车攻略', '黑沙滩'])

    // 拖「蓝湖」到「黄金瀑布」正中停一下：合并成分组，名字处直接改名
    await dragTile(page, '蓝湖', '黄金瀑布', 'merge')
    const rename = home(page).getByRole('textbox', { name: '名字' })
    await expect(rename).toBeFocused()
    await expect(rename).toHaveValue('新分组')
    await rename.fill('冰岛南岸')
    await rename.press('Enter')
    await expect(tiles(page)).toHaveText(['黑沙滩', '冰岛南岸', '冰川徒步'])
    // 分组就是书签栏里的子文件夹
    await expect.poll(() => saved(userData).filter((b) => b.folder === '书签栏 / 冰岛南岸').map((b) => b.title).sort()).toEqual(['蓝湖', '黄金瀑布'])
    // 书签首页上不摆书签栏
    await expect(web(page).getByRole('toolbar', { name: '书签栏' })).toHaveCount(0)
    // 再拖一个进分组
    await dragTile(page, '冰川徒步', '冰岛南岸', 'merge')
    await expect(tiles(page)).toHaveText(['黑沙滩', '冰岛南岸'])
    // 拖到一格的右边：排序
    await dragTile(page, '黑沙滩', '冰岛南岸', 'after')
    await expect(tiles(page)).toHaveText(['冰岛南岸', '黑沙滩'])

    // 点分组：下面弹出浮层；右键一个书签「移出分组」，回到书签栏、排在分组后面
    await quick(page).getByRole('button', { name: '冰岛南岸' }).click()
    const pop = home(page).getByRole('group', { name: '分组 冰岛南岸' })
    await expect(pop.getByRole('listitem')).toHaveText(['黄金瀑布', '蓝湖', '冰川徒步'])
    await pop.getByRole('listitem', { name: '冰川徒步' }).click({ button: 'right' })
    await home(page).getByRole('menu', { name: '书签菜单' }).getByRole('menuitem', { name: '移出分组' }).click()
    await expect(tiles(page)).toHaveText(['冰岛南岸', '冰川徒步', '黑沙滩'])
    await page.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    // 右键改名
    await tiles(page).filter({ hasText: '冰川徒步' }).click({ button: 'right' })
    await home(page).getByRole('menu', { name: '书签菜单' }).getByRole('menuitem', { name: '改名' }).click()
    await rename.fill('冰川')
    await rename.press('Enter')
    await expect(tiles(page)).toHaveText(['冰岛南岸', '冰川', '黑沙滩'])

    // 打开的标签：「租车攻略」那一行已经是书签（实心星）；「黑沙滩」稍后看：存进稍后再看、标签关掉
    await expect(site.getByRole('button', { name: '取消收藏 租车攻略' })).toBeVisible()
    // 不悬停时只露实心星；悬停时三个小图标
    await expect(site.getByRole('button', { name: '稍后看 黑沙滩' })).toBeHidden()
    await site.getByRole('listitem', { name: '黑沙滩' }).hover()
    await site.getByRole('button', { name: '稍后看 黑沙滩' }).click()
    await expect(page.locator('.toast-cn')).toContainText('存到稍后再看了：黑沙滩')
    await expect(webTabs(page)).toHaveCount(2)
    const later = home(page).getByRole('list', { name: '稍后再看列表' })
    await expect(later.getByRole('listitem')).toHaveText([/黑沙滩.*127\.0\.0\.1 · 今天/])
    // 全部关闭：那个网站的标签都关掉，只剩这个新标签
    await expect(site.getByRole('button', { name: '全部关闭' })).toBeHidden()
    await site.hover()
    await site.getByRole('button', { name: '全部关闭' }).click()
    await expect(webTabs(page)).toHaveCount(1)
    await expect(home(page).getByRole('group', { name: '127.0.0.1' })).toHaveCount(0)
    await expect(home(page)).toContainText('现在只开着这一个标签。')

    // 全部文件夹：展开，只写最后一段名字；点开「出发前」，右键「加到快捷书签」
    await home(page).getByRole('button', { name: /全部文件夹/ }).click()
    const folders = home(page).getByRole('list', { name: '全部文件夹' })
    await expect(folders.locator('.bkh-folder')).toHaveText([/^书签栏\d+$/, /^冰岛南岸2$/, /^出发前1$/])
    await folders.getByRole('button', { name: /出发前/ }).click()
    const inFolder = folders.getByRole('list', { name: '其他书签 / 出发前 里的书签' })
    await inFolder.getByRole('listitem', { name: '租车攻略' }).click({ button: 'right' })
    await home(page).getByRole('menu', { name: '书签菜单' }).getByRole('menuitem', { name: '加到快捷书签' }).click()
    await expect(tiles(page)).toHaveText(['冰岛南岸', '冰川', '黑沙滩', '租车攻略'])

    // 「整理书签」开书签管家
    await home(page).getByRole('button', { name: '整理书签' }).click()
    await expect(page.getByRole('dialog', { name: '书签管家' })).toBeVisible()
    await page.keyboard.press('Escape')

    // 重开软件：快捷书签、分组、稍后再看都还在
    await run.close()
    run = await launch({ 'a.md': '# a\n' }, { CN_USER_DATA: userData })
    page = run.page
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(tiles(page)).toHaveText(['冰岛南岸', '冰川', '黑沙滩', '租车攻略'])
    const later2 = home(page).getByRole('list', { name: '稍后再看列表' })
    await later2.getByRole('button', { name: '看完了 黑沙滩' }).click()
    await expect(home(page)).toContainText('没有稍后再看的')
    // 编辑：「完成」是主按钮；「−」移出快捷书签（挪到其他书签，书签还在）
    await home(page).getByRole('button', { name: '编辑' }).click()
    await expect(home(page).getByRole('button', { name: '完成' })).toHaveClass(/btn-primary/)
    await quick(page).getByRole('button', { name: '移出快捷书签 黑沙滩' }).click()
    await expect(tiles(page)).toHaveText(['冰岛南岸', '冰川', '租车攻略', '添加'])
    await expect.poll(() => saved(userData).find((b) => b.title === '黑沙滩')?.folder).toBe('其他书签')
    // 「添加」：填网址和名字
    await quick(page).getByRole('button', { name: '添加' }).click()
    const add = home(page).getByRole('form', { name: '添加快捷书签' })
    await add.getByRole('textbox', { name: '网址' }).fill(`${base}/新加的`)
    await add.getByRole('textbox', { name: '名字' }).fill('新加的')
    await add.getByRole('button', { name: '添加' }).click()
    await expect(tiles(page)).toHaveText(['冰岛南岸', '冰川', '租车攻略', '新加的', '添加'])
    await home(page).getByRole('button', { name: '完成' }).click()
    await expect(tiles(page)).toHaveText(['冰岛南岸', '冰川', '租车攻略', '新加的'])
  } finally {
    await run.close()
    rmSync(userData, { recursive: true, force: true })
  }
})

test('移到中间：右栏只有这一个网页时，挪过去后右栏收起，不留空白页；「放回右栏」照旧放回；新标签页上没有这个按钮', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const wideBtn = web(page).getByRole('button', { name: '移到中间' })
    await expect(wideBtn).toHaveCount(0)
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/冰岛`)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.title')).toBe('冰岛')
    await expect(wideBtn).toHaveText('移到中间')
    await expect(wideBtn).toHaveAttribute('title', '开成宽标签，右栏空出来')
    await wideBtn.click()
    const wide = page.locator('.wpane:not([hidden])')
    await expect.poll(() => guest(page, 'document.title', '.wpane:not([hidden]) webview')).toBe('冰岛')
    // 右栏收起了：没有留一个空的新网页
    await expect(web(page)).toBeHidden()
    await expect(rail(page).getByRole('button', { name: '网页' })).toHaveAttribute('aria-pressed', 'false')
    // 再开右栏：书签首页「打开的标签」里列着中间栏的这个网页，点它切过去
    await page.locator('.center .tabs .tab').first().click()
    await rail(page).getByRole('button', { name: '网页' }).click()
    const site = home(page).getByRole('group', { name: '127.0.0.1' })
    await expect(site.getByRole('listitem')).toHaveText(['冰岛'])
    await site.getByRole('button', { name: '冰岛' }).click()
    await expect(page.locator('.center .tabs .tab.on')).toContainText('冰岛')
    await expect(wide.locator('webview')).toBeVisible()
    await wide.getByRole('button', { name: '放回右栏' }).click()
    await expect(page.locator('.wpane')).toHaveCount(0)
    await expect(web(page)).toBeVisible()
    await expect(webTabs(page)).toHaveText(['冰岛'])
    await expect.poll(() => guest(page, 'document.title')).toBe('冰岛')
  } finally {
    await run.close()
  }
})

test('网页右上角：标签条右边只有「移到中间」和收起；地址栏里是双语翻译和星星，右边是剪藏和「⋯」；「⋯」里分三组，稍后再看能存能移出，键盘能选；每个按钮有中文说明；书签栏每项最宽 120，摆不下的进「»」', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cn-ud-'))
  mkdirSync(join(userData, 'web'), { recursive: true })
  const many = Array.from({ length: 14 }, (_, i) => ({ id: `m${i}`, title: `第 ${i + 1} 个很长很长的书签名字`, url: `${base}/m${i}`, folder: '书签栏', addedMs: 1 }))
  writeFileSync(join(userData, 'web', 'bookmarks.json'), JSON.stringify(many))
  const run = await launch({ 'a.md': '# a\n' }, { CN_USER_DATA: userData })
  const { page } = run
  try {
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/冰岛`)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.title')).toBe('冰岛')

    const label = (sel: string) => web(page).locator(sel).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(await label('.wtabs > button')).toEqual(['新网页', '移到中间', '收起网页'])
    expect(await label('.rhead > button')).toEqual(['后退', '前进', '重新载入', '整页剪藏'])
    expect(await label('.addr-acts button')).toEqual(['双语翻译', '书签管家'])
    expect(await label('.rhead .wactions button')).toEqual([])
    expect(await label('.rhead > .imp > button')).toEqual(['更多'])
    // 书签只有一个入口：地址栏的星星（书签栏里的是书签本身）
    await expect(web(page).locator('.wtabs, .rhead').getByRole('button', { name: /书签/ })).toHaveCount(1)
    // 书签栏：每项最宽 120，摆不下的进「»」，菜单里是剩下的
    const bar = web(page).getByRole('toolbar', { name: '书签栏' })
    const widths = await bar.locator('[data-bm]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width))
    expect(widths.length).toBeGreaterThan(0)
    expect(widths.length).toBeLessThan(14)
    for (const w of widths) expect(w).toBeLessThanOrEqual(120)
    await bar.getByRole('button', { name: '更多书签' }).click()
    await expect(bar.getByRole('menu', { name: '更多书签' }).getByRole('menuitem')).toHaveCount(14 - widths.length)
    await bar.getByRole('menu', { name: '更多书签' }).getByRole('menuitem').last().click()
    await expect.poll(() => guest(page, 'document.title')).toBe('m13')
    // 每个按钮都有中文说明
    const titles = await web(page).locator('.wtabs > button, .rhead button').evaluateAll((els) => els.map((e) => e.getAttribute('title') ?? ''))
    for (const t of titles) expect(t).toMatch(/[一-龥]/)

    // 「⋯」：三组；第一项自动有焦点，↓ 走到下一项，esc 收起
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    const more = web(page).getByRole('menu', { name: '更多', exact: true })
    await expect(more.getByRole('group')).toHaveCount(3)
    await expect(more.getByRole('menuitem')).toHaveText(['稍后再看', '双语翻译⌥A', '书签首页⌘T', '书签和历史…', '插件…', '导入 Chrome 登录…'])
    await expect(more.getByRole('menuitem').first()).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(more.getByRole('menuitem', { name: /双语翻译/ })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(more).toHaveCount(0)
    // 稍后再看：存进去，新标签页里看得到；再开菜单变成「移出稍后再看」
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    await more.getByRole('menuitem', { name: '稍后再看' }).click()
    await expect(page.locator('.toast-cn')).toContainText('存到稍后再看了')
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    await expect(more.getByRole('menuitem', { name: '移出稍后再看' })).toBeVisible()
    await more.getByRole('menuitem', { name: /书签首页/ }).click()
    await expect(home(page).getByRole('list', { name: '稍后再看列表' }).getByRole('listitem')).toHaveText([/m13/])
    await webTabs(page).first().getByRole('button').first().click()

    // 另外三项各开各的面板；点外面收起
    await webMore(page, '书签和历史')
    await expect(page.getByRole('dialog', { name: '书签和历史' })).toBeVisible()
    await addr.click()
    await expect(page.getByRole('dialog', { name: '书签和历史' })).toHaveCount(0)
    await webMore(page, '插件')
    await expect(page.getByRole('dialog', { name: '插件' }).getByRole('list', { name: '内置插件' })).toBeVisible()
    await webMore(page, '导入 Chrome 登录')
    await expect(web(page).getByRole('menu', { name: '选 Chrome 用户' })).toBeVisible()
    await addr.click()
    await expect(web(page).getByRole('menu', { name: '选 Chrome 用户' })).toHaveCount(0)
  } finally {
    await run.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
