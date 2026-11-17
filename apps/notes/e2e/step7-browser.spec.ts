import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { editorText, gitStatus, launch, openNote, pane, rail, shownText, starItem, waitSaved, webMore } from './app'
import { folder, installExtension, url, writeBookmarks, writeHistory } from './fake-chrome-data'
import { makeFakeChrome } from './fake-chrome'
import { solidPng } from './fixtures/png'
import { shotPart, shotTone } from './shots'

let server: Server
let base: string
const PNG = solidPng(64, 48, [40, 90, 160])

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith('/pic.png')) {
      res.setHeader('content-type', 'image/png')
      return res.end(PNG)
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/two') return res.end('<title>第二页</title><h1>第二页</h1><p><a id="nw" href="/three" target="_blank">新窗口打开第三页</a></p>')
    if (req.url === '/three') return res.end('<title>第三页</title><h1>第三页</h1>')
    // 慢的网页：1.2 秒后才回（用户在这期间往地址栏里打字）
    if (req.url === '/slow') return void setTimeout(() => res.end('<title>慢页</title><h1>慢页</h1>'), 1200)
    res.end(`<title>冰岛的黑沙滩 - 旅行杂志</title><body style="font:16px sans-serif;padding:20px;max-width:640px">
      <nav>首页 · 目的地 · 关于</nav>
      <article><h1>冰岛的黑沙滩</h1>
      <p>Reynisfjara 是冰岛南岸最有名的黑沙滩，玄武岩柱像管风琴一样排开，海浪很大，常有游客被卷走。</p>
      <img id="pic" src="/pic.png" alt="黑沙滩远景" width="320" height="240">
      <h2>怎么去</h2>
      <p>从雷克雅未克沿一号公路往东开两个半小时，到维克镇前右转就是。停车场免费，旁边有一家咖啡馆。</p>
      <p>${'海边风大，带一件防风外套。'.repeat(20)}</p></article></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')

/** 右栏打开网页面板（一个网页标签也没有时它自己开一个新标签页），在当前标签载入 url */
async function openWeb(page: Page, u: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  await expect(web(page)).toBeVisible()
  await expect(webTabs(page)).not.toHaveCount(0)
  await go(page, u)
}

async function go(page: Page, u: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

/** 在当前网页标签里跑一段 JS（只读位置和内容） */
function guest(page: Page, code: string, sel = '.right.web webview.on'): Promise<unknown> {
  return page.evaluate(
    ([c, s]) => {
      const w = document.querySelector(s!) as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
      return w ? w.executeJavaScript(c!) : Promise.resolve(null)
    },
    [code, sel],
  )
}

test('多标签：新建、切换、新窗口链接开成新标签、关闭；网页焦点时 ⌘W 关网页标签；重开软件标签还在；能在中间栏开成宽标签', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'cn-ud-'))
  let run = await launch({ 'a.md': '# a\n' }, { CN_USER_DATA: userData })
  try {
    let { page } = run
    await openWeb(page, `${base}/two`)
    await expect(webTabs(page)).toHaveText(['第二页'])
    // 新建第二个标签（按钮），载入文章页
    await web(page).getByRole('button', { name: '新网页' }).click()
    await expect(web(page).getByRole('textbox', { name: '网址' })).toBeFocused()
    await go(page, `${base}/a`)
    await expect(webTabs(page)).toHaveText(['第二页', '冰岛的黑沙滩 - 旅行杂志'])
    // 切回第一个：地址栏跟着变，网页没重新载入（还是同一个 webview）
    await webTabs(page).nth(0).getByRole('button').first().click()
    await expect(web(page).getByRole('textbox', { name: '网址' })).toHaveValue(`${base.replace(/^http:\/\//, '')}/two`)
    // 新窗口链接（target=_blank）开成新标签
    const link = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('nw').getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
    const box = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.click(box.x + link.x + link.width / 2, box.y + link.y + link.height / 2)
    await expect(webTabs(page)).toHaveText(['第二页', '第三页', '冰岛的黑沙滩 - 旅行杂志'])
    await expect(webTabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
    // 焦点在网页里时 ⌘W 关的是网页标签，不是中间栏的标签
    await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
    const centerTabs = await page.locator('.center .tabs .tab').count()
    const b3 = (await web(page).locator('webview.on').boundingBox())!
    await page.mouse.click(b3.x + 200, b3.y + 200)
    await page.keyboard.press('Meta+w')
    await expect(webTabs(page)).toHaveText(['第二页', '冰岛的黑沙滩 - 旅行杂志'])
    await page.waitForTimeout(300)
    await expect(page.locator('.center .tabs .tab')).toHaveCount(centerTabs)
    // 焦点在地址栏时 ⌘T 新建
    await web(page).getByRole('textbox', { name: '网址' }).click()
    await page.keyboard.press('Meta+t')
    await expect(webTabs(page)).toHaveCount(3)
    await expect(web(page).getByRole('textbox', { name: '网址' })).toBeFocused()
    // 三个标签挤在右栏里：标题至少留四个字宽（第 1 轮美学；× 浮在右端不占地方）
    const room = await webTabs(page).evaluateAll((els) => els.filter((e) => !e.classList.contains('on')).map((e) => { const t = e.querySelector('.truncate') as HTMLElement; return { t: t.clientWidth, full: t.scrollWidth <= t.clientWidth, x: !!(e.querySelector('.x') as HTMLElement).offsetParent } }))
    expect(room.every((r) => r.full || r.t >= 4 * 13), JSON.stringify(room)).toBe(true)
    // 点 × 关掉空的新标签
    await webTabs(page).nth(2).getByRole('button', { name: '关闭网页标签' }).click()
    await expect(webTabs(page)).toHaveCount(2)

    // 重开软件：标签还在
    await run.app.close()
    run = await launch({ 'a.md': '# a\n' }, { CN_USER_DATA: userData })
    page = run.page
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(webTabs(page)).toHaveText(['第二页', '冰岛的黑沙滩 - 旅行杂志'])

    // 在中间栏大屏看，再放回右栏；右栏还有别的网页，就显示那个，不留空页
    await webTabs(page).nth(1).getByRole('button').first().click()
    await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
    await page.getByRole('banner').getByRole('button', { name: '移到中间' }).click()
    const wide = page.locator('.wpane:not([hidden])')
    await expect(wide.locator('webview')).toBeVisible()
    await expect(page.locator('.center .tabs .tab.on')).toContainText('冰岛的黑沙滩')
    await expect.poll(() => guest(page, 'document.title', '.wpane:not([hidden]) webview')).toBe('冰岛的黑沙滩 - 旅行杂志')
    await expect(webTabs(page)).toHaveText(['第二页'])
    await expect(web(page)).toBeVisible()
    await expect(webTabs(page).nth(0)).toHaveAttribute('aria-selected', 'true')
    await expect(web(page).getByRole('region', { name: '书签首页' })).toHaveCount(0)
    const wideBox = (await wide.locator('webview').boundingBox())!
    expect(wideBox.width).toBeGreaterThan(600)
    await page.getByRole('banner').getByRole('button', { name: '放回右栏' }).click()
    await expect(page.locator('.wpane')).toHaveCount(0)
    await expect(webTabs(page)).toHaveText(['第二页', '冰岛的黑沙滩 - 旅行杂志'])
  } finally {
    await run.close()
    rmSync(userData, { recursive: true, force: true })
  }
})

test('网页还在载入时往地址栏里打字：载完不冲掉打的字，回车去打的那个网址；没打字时地址栏照常跟上网页', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page } = run
  try {
    await openWeb(page, `${base}/a`)
    const addr = web(page).getByRole('textbox', { name: '网址' })
    await addr.fill(`${base}/slow`)
    await addr.press('Enter')
    // 网页还没回来，用户点进地址栏改主意，打另一个网址
    await addr.click()
    await page.keyboard.type(`${base}/two`)
    await expect.poll(() => guest(page, 'document.title'), { timeout: 10_000 }).toBe('慢页')
    await expect(webTabs(page)).toHaveText(['慢页'])
    await expect(addr).toHaveValue(`${base}/two`)
    await addr.press('Enter')
    await expect.poll(() => guest(page, 'document.title')).toBe('第二页')
    await expect(addr).toHaveValue(`${base.replace(/^http:\/\//, '')}/two`)
    // 只是点进地址栏、没打字：网页换了，地址栏跟着换，而且还是全选着，接着打的字替换它
    await addr.click()
    await guest(page, `location.href = '${base}/three'`)
    await expect.poll(() => guest(page, 'document.title')).toBe('第三页')
    await expect(addr).toHaveValue(`${base}/three`)
    await page.keyboard.type(`${base}/a`)
    await expect(addr).toHaveValue(`${base}/a`)
  } finally {
    await run.close()
  }
})

test('书签：一键从 Chrome 导入（按用户选）、书签栏和文件夹、☆ 加删、面板里按文件夹看和删；历史能搜、能从 Chrome 导入；都不进库', async () => {
  const chrome = mkdtempSync(join(tmpdir(), 'cn-fake-chrome-'))
  makeFakeChrome(chrome, [])
  writeBookmarks(
    join(chrome, 'Default'),
    [url('第二页', `${base}/two`), folder('旅行', [url('黑沙滩', `${base}/a`), folder('冰岛', [url('第三页', `${base}/three`)])])],
    [url('别处的', 'https://example.com/other')],
  )
  writeHistory(join(chrome, 'Default'), [
    { url: 'https://example.com/gullfoss', title: '黄金瀑布攻略', visits: 3, at: new Date(Date.now() - 86400_000) },
    { url: 'https://example.com/geysir', title: '盖歇尔间歇泉', visits: 1, at: new Date(Date.now() - 2 * 86400_000) },
  ])
  const run = await launch({ 'a.md': '# a\n' }, { CN_CHROME_ROOT: chrome })
  const { page, vault } = run
  try {
    await openWeb(page, `${base}/two`)
    // 导入书签：两个 Chrome 用户，选「工作」
    await webMore(page, '书签和历史')
    const lib = page.getByRole('dialog', { name: '书签和历史' })
    await expect(lib).toContainText('还没有书签')
    await lib.getByRole('button', { name: '从Chrome导入' }).click()
    await page.getByRole('menu', { name: '选 Chrome 用户' }).getByRole('menuitem', { name: /工作/ }).click()
    await expect(page.locator('.toast-cn')).toContainText('从Chrome导入了4个书签')
    await expect(lib.getByRole('list', { name: '书签' }).getByRole('listitem')).toHaveCount(4)
    // 按文件夹看
    await lib.getByRole('list', { name: '书签文件夹' }).getByRole('button', { name: '旅行' }).click()
    await expect(lib.getByRole('list', { name: '书签' }).getByRole('listitem')).toHaveText([/黑沙滩/, /第三页/])
    // 再导一次不重复
    await lib.getByRole('button', { name: '从Chrome导入' }).click()
    await page.getByRole('menu', { name: '选 Chrome 用户' }).getByRole('menuitem', { name: /工作/ }).click()
    await expect(page.locator('.toast-cn')).toContainText('导入了0个书签，4个已经有了')
    // 点面板外面收起
    await web(page).getByRole('textbox', { name: '网址' }).click()
    await expect(lib).toHaveCount(0)

    // 书签栏：第二页直接摆着，「旅行」是文件夹菜单，「其他书签」在最右
    const bar = web(page).getByRole('toolbar', { name: '书签栏' })
    await expect(bar).toContainText('第二页')
    await bar.getByRole('button', { name: '旅行' }).click()
    await expect(page.getByRole('menu', { name: '旅行' }).getByRole('menuitem')).toHaveText([/黑沙滩/, /第三页冰岛/])
    await page.getByRole('menu', { name: '旅行' }).getByRole('menuitem', { name: /黑沙滩/ }).click()
    await expect.poll(() => guest(page, 'location.href')).toBe(`${base}/a`)
    // 当前网页已经在书签里：「⋯」里那一项是勾上的（实心星）；点开书签管家删掉，再点一下又收藏上（像 Chrome，收藏并开书签管家）
    let star = await starItem(page)
    await expect(star).toHaveAttribute('aria-checked', 'true')
    await expect(star).toHaveText('已收藏 · 改标签和备注')
    await star.click()
    const keeper = page.getByRole('dialog', { name: '书签管家' })
    await keeper.getByRole('button', { name: '删掉书签', exact: true }).click()
    await expect(keeper).toHaveCount(0)
    star = await starItem(page)
    await expect(star).toHaveAttribute('aria-checked', 'false')
    await expect(star).toHaveText('加书签')
    await star.click()
    await expect(keeper).toContainText('已收藏')
    await expect(bar).toContainText('冰岛的黑沙滩 - 旅行杂志')
    // 再点「⋯」：小卡收起，菜单打开
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    await expect(keeper).toHaveCount(0)
    await page.keyboard.press('Escape')
    // 面板里删一个
    await webMore(page, '书签和历史')
    await lib.getByRole('button', { name: '删掉书签 第二页' }).click()
    await expect(bar).not.toContainText('第二页')

    // 历史：刚才去过的能搜到；从 Chrome 导入后也能搜
    await lib.getByRole('tab', { name: '历史' }).click()
    await lib.getByRole('textbox', { name: '搜历史' }).fill('黑沙滩')
    await expect(lib.getByRole('list', { name: '历史' }).getByRole('listitem')).toHaveCount(1)
    await expect(lib.getByRole('list', { name: '历史' })).toContainText(`${base}/a`)
    await lib.getByRole('button', { name: '从Chrome导入' }).click()
    await page.getByRole('menu', { name: '选 Chrome 用户' }).getByRole('menuitem', { name: /工作/ }).click()
    await expect(page.locator('.toast-cn')).toContainText('从Chrome导入了2条历史')
    await lib.getByRole('textbox', { name: '搜历史' }).fill('瀑布')
    await expect(lib.getByRole('list', { name: '历史' }).getByRole('listitem')).toHaveText([/黄金瀑布攻略/])
    await lib.getByRole('list', { name: '历史' }).getByRole('button', { name: /黄金瀑布攻略/ }).click({ modifiers: ['Meta'] })
    await expect(webTabs(page)).toHaveCount(2)

    // 书签和历史放在软件设置目录，库里什么都没多
    expect(gitStatus(vault)).toBe('')
    expect(readdirSync(vault).sort()).toEqual(['.git', 'a.md'])
  } finally {
    await run.close()
    rmSync(chrome, { recursive: true, force: true })
  }
})

test('Chrome 插件：一键导入（拷一份，Chrome 那边不动）、内容脚本生效、工具栏按钮点开弹窗、关掉和移除；缺接口的标出多半用不了', async () => {
  const chrome = mkdtempSync(join(tmpdir(), 'cn-fake-chrome-'))
  makeFakeChrome(chrome, [])
  const good = installExtension(
    join(chrome, 'Default'),
    {
      name: '__MSG_name__',
      default_locale: 'en',
      permissions: ['storage', 'activeTab'],
      action: { default_title: '测试插件', default_popup: 'popup.html', default_icon: { '16': 'icon.png', '32': 'icon.png' } },
      icons: { '32': 'icon.png' },
      content_scripts: [{ matches: ['http://127.0.0.1/*'], js: ['content.js'], run_at: 'document_end' }],
    },
    {
      '_locales/en/messages.json': JSON.stringify({ name: { message: 'Test Highlighter' } }),
      '_locales/zh_CN/messages.json': JSON.stringify({ name: { message: '测试高亮' } }),
      'content.js': `document.documentElement.dataset.cnTestExt = 'on'`,
      'popup.html': '<!doctype html><meta charset="utf-8"><body style="width:220px;height:80px"><p id="hello">弹窗里好</p></body>',
      'icon.png': solidPng(32, 32, [154, 72, 173]),
    },
  )
  const bad = installExtension(join(chrome, 'Default'), { name: '假密码管理器', permissions: ['nativeMessaging', 'storage'], action: { default_title: '假密码管理器' } }, {})
  const userData = mkdtempSync(join(tmpdir(), 'cn-ud-'))
  const run = await launch({ 'a.md': '# a\n' }, { CN_CHROME_ROOT: chrome, CN_USER_DATA: userData })
  const { page, app } = run
  try {
    await openWeb(page, `${base}/two`)
    await expect.poll(() => guest(page, 'document.documentElement.dataset.cnTestExt ?? "none"')).toBe('none')
    await webMore(page, '插件')
    const panel = page.getByRole('dialog', { name: '插件' })
    await expect(panel).toContainText('还没有插件')
    await panel.getByRole('button', { name: '从Chrome导入' }).click()
    await page.getByRole('menu', { name: '选 Chrome 用户' }).getByRole('menuitem', { name: /工作/ }).click()
    await expect(page.locator('.toast-cn')).toContainText('导入了2个插件，其中1个多半用不了')
    const list = panel.getByRole('list', { name: '插件列表' })
    await expect(list.getByRole('listitem', { name: '测试高亮' }).getByTestId('verdict')).toHaveText('应该能用')
    await expect(list.getByRole('listitem', { name: '假密码管理器' }).getByTestId('verdict')).toHaveText('多半用不了：缺和电脑上的程序通信')
    // 拷了一份到软件设置目录；Chrome 那边原样
    expect(existsSync(join(userData, 'web', 'extensions', good, 'content.js'))).toBe(true)
    expect(existsSync(join(chrome, 'Default', 'Extensions', good, '1.0.0_0', 'content.js'))).toBe(true)
    expect(bad).toMatch(/^[a-p]{32}$/)

    // 导入后网页重新载入，内容脚本进去了
    await expect.poll(() => guest(page, 'document.documentElement.dataset.cnTestExt ?? "none"'), { timeout: 10_000 }).toBe('on')
    // 插件按钮默认不摆出来；在插件面板里点图钉固定到地址栏右边，点开是插件的弹窗（一个小窗口）
    const btn = web(page).getByRole('toolbar', { name: '插件按钮' }).getByRole('button', { name: '测试插件' })
    await expect(btn).toHaveCount(0)
    await webMore(page, '插件')
    await list.getByRole('button', { name: '固定到地址栏 测试高亮' }).click()
    await expect(btn).toBeVisible()
    await expect.poll(() => btn.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
    const popupP = app.waitForEvent('window')
    await btn.click()
    const popup = await popupP
    await expect(popup.locator('#hello')).toHaveText('弹窗里好')
    expect(popup.url()).toBe(`chrome-extension://${good}/popup.html`)

    // 关掉：再载入网页，内容脚本没了；重开插件面板还在、开关是关的
    await webMore(page, '插件')
    await list.getByRole('switch', { name: '启用 测试高亮' }).click()
    await expect(list.getByRole('switch', { name: '启用 测试高亮' })).not.toBeChecked()
    await expect(web(page).getByRole('toolbar', { name: '插件按钮' }).getByRole('button', { name: '测试插件' })).toHaveCount(0)
    // 点面板外面（重新载入）面板就收起
    await web(page).getByRole('button', { name: '重新载入' }).click()
    await expect(panel).toHaveCount(0)
    await expect.poll(() => guest(page, 'document.readyState + (document.documentElement.dataset.cnTestExt ?? "none")')).toBe('completenone')
    // 移除：列表里没了，拷过来的文件夹删了
    await webMore(page, '插件')
    await list.getByRole('button', { name: '移除 测试高亮' }).click()
    await expect(list.getByRole('listitem')).toHaveCount(1)
    expect(existsSync(join(userData, 'web', 'extensions', good))).toBe(false)
  } finally {
    await run.close()
    rmSync(chrome, { recursive: true, force: true })
    rmSync(userData, { recursive: true, force: true })
  }
})

/** 在页面里造一个 DataTransfer 往 sel 上扔：网页拖来的（uri-list + html）或者文件 */
async function dropOn(page: Page, sel: string, data: { uri?: string; html?: string; file?: { name: string; type: string; base64: string } }, at?: { x: number; y: number }) {
  const box = (await page.locator(sel).first().boundingBox())!
  const x = at ? box.x + at.x : box.x + box.width / 2
  const y = at ? box.y + at.y : box.y + box.height / 2
  await page.evaluate(
    ({ sel, data, x, y }) => {
      const dt = new DataTransfer()
      if (data.uri) dt.setData('text/uri-list', data.uri)
      if (data.html) dt.setData('text/html', data.html)
      if (data.file) dt.items.add(new File([Uint8Array.from(atob(data.file.base64), (c) => c.charCodeAt(0))], data.file.name, { type: data.file.type }))
      const target = document.elementFromPoint(x, y) ?? document.querySelector(sel)!
      for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }))
    },
    { sel, data, x, y },
  )
}

const BOARD = '---\ntype: board\n---\n# 冰岛自驾\n\n<!-- card id=a1 x=40 y=40 w=280 -->\n先订住处。\n'

test('图片拖进白板：网页拖来的下载进这块白板的附件文件夹「附件/冰岛自驾/」带来源，访达的文件、剪贴板的截图（叫「截图 1」、不带说明）也行；卡片显示库里的本地图', async () => {
  const run = await launch({ '冰岛自驾.md': BOARD })
  const { page, vault } = run
  try {
    await shotTone(page)
    await page.locator('.nav .si', { hasText: '冰岛自驾' }).click()
    await expect(pane(page).getByTestId('board')).toBeVisible()
    await openWeb(page, `${base}/a`)
    // 1. 从网页拖来：uri-list + html，来源是右栏当前网页
    await dropOn(page, '.pane:not([hidden]) .board-wrap', { uri: `${base}/pic.png`, html: `<img src="${base}/pic.png" alt="黑沙滩远景">` }, { x: 420, y: 300 })
    const card = pane(page).locator('.bcard.k-image')
    await expect(card).toHaveCount(1)
    await expect(card.locator('figcaption')).toHaveText('黑沙滩远景')
    await expect(card.locator('.src')).toContainText('冰岛的黑沙滩 - 旅行杂志')
    await expect.poll(() => card.locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(64)
    expect(await card.locator('img').getAttribute('src')).toMatch(/^cn-file:\/\/vault\//)
    await waitSaved(page)
    // 附件按笔记分文件夹（CN-40 A）：附件/<笔记路径>/，附件名用图片说明，读得懂
    const dir = join(vault, '附件', '冰岛自驾')
    expect(readdirSync(join(vault, '附件'))).toEqual(['冰岛自驾'])
    expect(readdirSync(dir)).toEqual(['黑沙滩远景.png'])
    expect(readFileSync(join(dir, '黑沙滩远景.png')).equals(PNG)).toBe(true)
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toMatch(
      new RegExp(`<!-- card id=\\w+ x=\\d+ y=\\d+ w=280 -->\\n!\\[黑沙滩远景\\]\\(附件/冰岛自驾/黑沙滩远景\\.png\\)\\n—— \\[冰岛的黑沙滩 - 旅行杂志\\]\\(${base.replace(/\./g, '\\.')}/a\\)\\n+$`),
    )
    // 2. 访达里拖来的文件
    await dropOn(page, '.pane:not([hidden]) .board-wrap', { file: { name: '地图 截图.png', type: 'image/png', base64: solidPng(20, 10, [0, 0, 0]).toString('base64') } }, { x: 100, y: 420 })
    await expect(card).toHaveCount(2)
    await waitSaved(page)
    expect(readdirSync(dir).sort()).toEqual(['地图-截图.png', '黑沙滩远景.png'])
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toContain('![地图 截图](附件/冰岛自驾/地图-截图.png)\n')
    // 3. 剪贴板里的图：白板有焦点时粘贴
    await pane(page).getByTestId('board').focus()
    await page.evaluate((b64) => {
      const dt = new DataTransfer()
      dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'image.png', { type: 'image/png' }))
      document.activeElement!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    }, solidPng(8, 8, [255, 0, 0]).toString('base64'))
    await expect(card).toHaveCount(3)
    await waitSaved(page)
    // 剪贴板的截图不叫 image：「截图 1」，说明留空，卡片下面不写「image」（CN-40）
    expect(readdirSync(dir)).toContain('截图 1.png')
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toContain('![](附件/冰岛自驾/截图%201.png)\n')
    await expect(card.nth(2).locator('figcaption')).toHaveCount(0)
    await expect.poll(() => card.nth(2).locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(8)
    await shotPart(pane(page).locator('.board-wrap'), 'board-paste-shot')
    // 不是图片的拖进来不动
    await dropOn(page, '.pane:not([hidden]) .board-wrap', { uri: `${base}/two` })
    await page.waitForTimeout(300)
    await expect(pane(page).locator('.bcard')).toHaveCount(4)
    // 4. 真从网页里拖出来、界面却没收到 drop（真鼠标试出来有时这样）：网页松手时报落点，界面在那里放下
    const wv = (await web(page).locator('webview.on').boundingBox())!
    const wrap = (await pane(page).locator('.board-wrap').boundingBox())!
    const at = { x: wrap.x + 200 - wv.x, y: wrap.y + 500 - wv.y }
    await guest(
      page,
      `(() => { const img = document.getElementById('pic');
        img.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: new DataTransfer() }));
        img.dispatchEvent(new DragEvent('dragend', { bubbles: true, clientX: ${at.x}, clientY: ${at.y} })) })()`,
    )
    await expect(card).toHaveCount(4)
    await waitSaved(page)
    expect(readdirSync(dir)).toContain('黑沙滩远景-2.png')
    expect(readFileSync(join(vault, '冰岛自驾.md'), 'utf8')).toContain('![黑沙滩远景](附件/冰岛自驾/黑沙滩远景-2.png)\n—— [冰岛的黑沙滩 - 旅行杂志]')
  } finally {
    await run.close()
  }
})

test('图片拖进文档：存进这篇的附件文件夹，插入 ![说明](附件/<笔记>/…)；子文件夹里的笔记用 ../附件/<文件夹>/<笔记>/；库外的路径看不到', async () => {
  const run = await launch({ '所思所想.md': '# 所思所想\n\n第一段。\n\n第二段。\n' })
  const { page, vault } = run
  try {
    await openNote(page, '所思所想')
    await openWeb(page, `${base}/a`)
    const line = pane(page).locator('.cm-line', { hasText: '第一段' })
    const lb = (await line.boundingBox())!
    const pb = (await pane(page).locator('.cm-content').boundingBox())!
    await dropOn(page, '.pane:not([hidden]) .cm-content', { uri: `${base}/pic.png`, html: `<img src="/pic.png" alt="黑沙滩远景">` }, { x: lb.x - pb.x + 20, y: lb.y - pb.y + lb.height / 2 })
    await waitSaved(page)
    await expect.poll(() => readFileSync(join(vault, '所思所想.md'), 'utf8')).toBe(
      `# 所思所想\n\n第一段。\n\n![黑沙滩远景](附件/所思所想/黑沙滩远景.png)\n\n—— [冰岛的黑沙滩 - 旅行杂志](${base}/a)\n\n第二段。\n`,
    )
    expect(readdirSync(join(vault, '附件', '所思所想'))).toEqual(['黑沙滩远景.png'])
    expect(await editorText(page)).toContain('![黑沙滩远景](附件/所思所想/黑沙滩远景.png)')
    // 文档里图片画成卡片（显示库里的本地图），看得到的字里不露 md 原文（CN-86）
    await expect(pane(page).locator('.cm-content img[src^="cn-file://vault/"]')).toHaveCount(1)
    expect(await shownText(page)).not.toContain('附件/')

    // 子文件夹里的笔记：相对路径往上一层
    mkdirSync(join(vault, '游记'))
    writeFileSync(join(vault, '游记', '南岸.md'), '# 南岸\n\n')
    await openNote(page, '南岸')
    await dropOn(page, '.pane:not([hidden]) .cm-content', { file: { name: 'b.png', type: 'image/png', base64: solidPng(4, 4, [1, 2, 3]).toString('base64') } })
    await waitSaved(page)
    await expect.poll(() => readFileSync(join(vault, '游记', '南岸.md'), 'utf8')).toBe('# 南岸\n\n![b](../附件/游记/南岸/b.png)\n')

    // cn-file://（主线的协议）只给库里的图片
    const load = (src: string) =>
      page.evaluate(
        (s) =>
          new Promise<string>((r) => {
            const i = new Image()
            i.onload = () => r(`ok ${i.naturalWidth}`)
            i.onerror = () => r('error')
            i.src = s
          }),
        src,
      )
    expect(await load('cn-file://vault/附件/游记/南岸/b.png')).toBe('ok 4')
    expect(await load('cn-file://vault/%E9%99%84%E4%BB%B6/%E6%B8%B8%E8%AE%B0/%E5%8D%97%E5%B2%B8/b.png')).toBe('ok 4')
    expect(await load('cn-file://vault/../../etc/hosts.png')).toBe('error')
    expect(await load('cn-file://vault/所思所想.md')).toBe('error')
  } finally {
    await run.close()
  }
})

test('整页剪藏：右栏网页点剪刀，正文转成 md 进收件箱新的一篇（带 created、source），单独一次提交；撤回就删掉；window.cn.clipCurrentPage 也能调（AI 用）', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  try {
    await openWeb(page, `${base}/a`)
    await web(page).getByRole('button', { name: '整页剪藏' }).click()
    await expect(web(page).locator('.wnote')).toContainText('整页存进收件箱了：冰岛的黑沙滩')
    const files = readdirSync(join(vault, '收件箱'))
    expect(files).toEqual(['冰岛的黑沙滩.md'])
    const md = readFileSync(join(vault, '收件箱', files[0]!), 'utf8')
    expect(md).toMatch(new RegExp(`^---\\ncreated: \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d\\nsource: ${base.replace(/\./g, '\\.')}/a\\n---\\n# 冰岛的黑沙滩 - 旅行杂志\\n\\n—— \\[冰岛的黑沙滩 - 旅行杂志\\]\\(`))
    expect(md).toContain('Reynisfjara 是冰岛南岸最有名的黑沙滩')
    expect(md).toContain('## 怎么去')
    expect(md).toContain(`![黑沙滩远景](${base}/pic.png)`)
    expect(md).not.toContain('首页 · 目的地')
    const log = () => execFileSync('git', ['-C', vault, 'log', '--format=%s', '--name-status', '-3'], { encoding: 'utf8' })
    expect(log()).toMatch(/^剪藏整页：冰岛的黑沙滩 - 旅行杂志\n\nA\t收件箱\/冰岛的黑沙滩\.md\n/)
    expect(gitStatus(vault)).toBe('')
    // 撤回
    await web(page).locator('.wnote').getByRole('button', { name: '撤回' }).click()
    await expect(web(page).locator('.wnote')).toContainText('撤回了')
    expect(existsSync(join(vault, '收件箱', '冰岛的黑沙滩.md'))).toBe(false)
    expect(log()).toMatch(/^撤回剪藏整页：冰岛的黑沙滩 - 旅行杂志/)
    // AI 那边调的接口
    const p = await page.evaluate((u) => window.cn.clipCurrentPage({ webUrl: u }), `${base}/a`)
    expect(p).toBe('收件箱/冰岛的黑沙滩.md')
    expect(existsSync(join(vault, p))).toBe(true)
  } finally {
    await run.close()
  }
})
