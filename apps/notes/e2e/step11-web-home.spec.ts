/**
 * 新网页标签 = 用户自己的开源插件 BookmarkKeeper 原样的新标签页（cn-ext://bookmarkkeeper/newtab/index.html）。
 * 用软件自带的那份插件文件（CN_BOOKMARKKEEPER_DIR），iCloud 容器指到临时目录（CN_ICLOUD_CONTAINER），不碰真的 iCloud。
 * 网页里的点和打字都是发给那个网页的真的鼠标、键盘事件（sendInputEvent）。
 */
import { expect, test, type Page } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, rail, type Running, starItem, webMore } from './app'

const BUNDLED = join(__dirname, '../resources/bookmarkkeeper')
const NEWTAB = 'cn-ext://bookmarkkeeper/newtab/index.html'

let server: Server
let base: string
/** 假的 AI 接口收到的请求 */
let aiAsked = 0

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').slice(1)) || '首页'
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      // OpenAI 兼容的假接口：把收到的书签全分进「冰岛」
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        aiAsked++
        const user = (JSON.parse(body) as { messages: { role: string; content: string }[] }).messages.find((m) => m.role === 'user')!.content
        const ids = user.split('\n').map((l) => l.split('\t')[0])
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ choices: [{ message: { content: '```json\n' + JSON.stringify({ categories: [{ name: '冰岛', ids }] }) + '\n```' } }] }))
      })
      return
    }
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (name === '死链') {
      res.statusCode = 404
      return res.end('没有这一页')
    }
    res.end(`<title>${name}</title><h1>${name}</h1><p>这是 ${name} 这一页。</p>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const webTabs = (page: Page) => web(page).getByRole('tablist', { name: '网页标签' }).getByRole('tab')
const ON = '.right.web webview.on'

/** 在右栏当前网页里跑一段 js（网页还没载好时是 null） */
function guest<T = unknown>(page: Page, code: string): Promise<T> {
  return page.evaluate(
    ([c, s]) => {
      const w = document.querySelector(s!) as unknown as { executeJavaScript(c: string): Promise<unknown> } | null
      try {
        // dom-ready 之前 webview 不让跑：当作还没有
        return w ? w.executeJavaScript(c!).catch(() => null) : Promise.resolve(null)
      } catch {
        return Promise.resolve(null)
      }
    },
    [code, ON],
  ) as Promise<T>
}

const guestWc = (page: Page) => page.evaluate((s) => (document.querySelector(s) as unknown as { getWebContentsId(): number }).getWebContentsId(), ON)

/** 等右栏当前网页里的一个条件成立 */
async function until(page: Page, code: string, timeout = 15_000) {
  await expect.poll(() => guest(page, `(() => { try { return !!(${code}) } catch { return false } })()`), { timeout }).toBe(true)
}

/** 真的鼠标点右栏网页里的一个元素（先滚到看得见） */
async function clickIn(run: Running, css: string, text?: string) {
  const find = `[...document.querySelectorAll(${JSON.stringify(css)})].find((e) => ${text ? `e.textContent.includes(${JSON.stringify(text)})` : 'true'})`
  await until(run.page, find)
  const p = await guest<{ x: number; y: number }>(
    run.page,
    `(() => { const e = ${find}; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) } })()`,
  )
  const id = await guestWc(run.page)
  await run.app.evaluate(
    ({ webContents }, [id, x, y]) => {
      const wc = webContents.fromId(id!)!
      wc.sendInputEvent({ type: 'mouseMove', x: x!, y: y! })
      wc.sendInputEvent({ type: 'mouseDown', x: x!, y: y!, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: x!, y: y!, button: 'left', clickCount: 1 })
    },
    [id, p.x, p.y],
  )
}

/** 往右栏网页里有焦点的输入框打字 */
async function typeIn(run: Running, text: string) {
  const id = await guestWc(run.page)
  await run.app.evaluate(
    ({ webContents }, [id, text]) => {
      const wc = webContents.fromId(id as number)!
      for (const ch of text as string) wc.sendInputEvent({ type: 'char', keyCode: ch })
    },
    [id, text],
  )
}

/** 软件设置目录里先放好几个书签（和从 Chrome 导进来的一样的格式） */
function seed(userData: string, extra: { title: string; folder: string }[] = []) {
  mkdirSync(join(userData, 'web'), { recursive: true })
  const bm = (id: string, title: string, folder = '书签栏') => ({ id, title, url: `${base}/${encodeURIComponent(title)}`, folder, addedMs: Date.now() - 86400_000 })
  writeFileSync(
    join(userData, 'web', 'bookmarks.json'),
    JSON.stringify([bm('b1', '黑沙滩'), bm('b2', '黄金瀑布'), bm('b3', '蓝湖', '书签栏 / 行程'), bm('b5', '租车攻略', '其他书签 / 出发前'), ...extra.map((x, i) => bm('x' + i, x.title, x.folder))]),
  )
}

/** 另一台 Mac 的 Chrome 经 iCloud 写来的快捷书签文件（BKCore 的格式） */
function otherMac(container: string) {
  const dir = join(container, 'QuickLinks')
  mkdirSync(dir, { recursive: true })
  const rec = (id: string, kind: string, title: string, extra: Record<string, unknown> = {}) => ({ id, kind, title, url: '', parent: '', order: 0, deleted: false, t: 1_700_000_000_000, d: 'dev-other', ...extra })
  const records = {
    'q-1': rec('q-1', 'link', '黑沙滩', { url: `${base}/${encodeURIComponent('黑沙滩')}`, order: 0 }),
    'g-1': rec('g-1', 'group', '冰岛', { order: 1 }),
    'q-2': rec('q-2', 'link', '冰川', { url: `${base}/${encodeURIComponent('冰川')}`, parent: 'g-1', order: 0 }),
    'q-3': rec('q-3', 'link', '极光', { url: `${base}/${encodeURIComponent('极光')}`, parent: 'g-1', order: 1 }),
    // 那台机器删掉的（墓碑）：不该出现
    'q-4': rec('q-4', 'link', '删掉的', { url: `${base}/gone`, order: 2, deleted: true }),
  }
  const file = join(dir, 'mac-othermac-chrome.json')
  writeFileSync(file, JSON.stringify({ schema: 1, writer: 'mac-othermac-chrome', updated: 1, records }))
  return file
}

/** 快捷书签那一排的名字（分组是它的名字） */
const quickTitles = (page: Page) => guest<string[]>(page, `[...document.querySelectorAll('#bkQuick .bk-tile .bk-t-title')].map((e) => e.textContent)`)

test('新网页标签就是 BookmarkKeeper 的新标签页：别的 Mac 的快捷书签合并读进来；搜的是内置书签；打开的标签里加快捷书签写进我们自己的 JSON；点快捷书签在当前标签打开；稍后再看进它的列表', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cn-bk-'))
  const userData = join(root, 'user-data')
  const container = join(root, 'iCloud~io~github~schaeferanjon~BookmarkKeeper')
  seed(userData)
  const theirs = otherMac(container)
  const theirsBefore = readFileSync(theirs, 'utf8')
  const run = await launch({ 'a.md': '# a\n' }, { CN_USER_DATA: userData, CN_BOOKMARKKEEPER_DIR: BUNDLED, CN_ICLOUD_CONTAINER: container })
  try {
    const { page } = run
    // 右栏还没开过网页：新网页标签载入插件的新标签页
    await rail(page).getByRole('button', { name: '网页' }).click()
    await expect(page.locator(ON)).toHaveAttribute('src', NEWTAB)
    await until(page, `document.querySelector('#greeting').textContent.length > 0`)
    expect(await guest(page, 'document.title')).toBe('新标签页 · 书签管家')
    // 新标签页自己就是书签：不摆书签栏；地址栏是空的
    await expect(web(page).locator('.bmbar')).toHaveCount(0)
    await expect(web(page).getByRole('textbox', { name: '网址' })).toHaveValue('')

    // 快捷书签：另一台 Mac 的 JSON 合并读进来，删掉的不出现；分组点开看到里面两个
    await until(page, `document.querySelectorAll('#bkQuick .bk-tile').length === 2`)
    expect(await quickTitles(page)).toEqual(['黑沙滩', '冰岛'])
    // iCloud 在：不出「只存在本机」的提示
    expect(await guest(page, `document.querySelector('#bkSyncNote').hidden`)).toBe(true)
    await clickIn(run, '#bkQuick .bk-tile.is-group')
    await until(page, `[...document.querySelectorAll('#bkGroupRow .bk-t-title')].map((e) => e.textContent).join() === '冰川,极光'`)

    // 搜全部书签：搜的是内置浏览器的书签（chrome.bookmarks 接到书签表）
    await clickIn(run, '#bkSearch')
    await typeIn(run, '瀑布')
    await until(page, `document.querySelector('#bkResults .bk-r-title')?.textContent === '黄金瀑布'`)
    expect(await guest(page, `document.querySelector('#bkResults .bk-r-sub').textContent`)).toContain('书签栏')
    // 「All folders」里是书签栏、行程这些文件夹
    await clickIn(run, '#bkFoldersToggle')
    await until(page, `document.querySelector('#bkCards').textContent.includes('行程')`)

    // 地址栏打开一个网页，⌘T 再开一个新标签页：「打开的标签」里列着它
    await web(page).getByRole('textbox', { name: '网址' }).fill(`${base}/${encodeURIComponent('蓝湖')}`)
    await web(page).getByRole('textbox', { name: '网址' }).press('Enter')
    await expect(webTabs(page).first()).toContainText('蓝湖')
    await web(page).getByRole('button', { name: '新网页', exact: true }).click()
    await expect(webTabs(page)).toHaveCount(2)
    await expect(page.locator(ON)).toHaveAttribute('src', NEWTAB)
    await until(page, `document.querySelector('#openTabsMissions .page-chip[data-tab-url*="127.0.0.1"]')`)
    // 新标签页自己不列进「打开的标签」（插件看到的它是 chrome://newtab/，和在 Chrome 里一样）
    expect(await guest(page, `document.querySelectorAll('#openTabsMissions .mission-card').length`)).toBe(1)
    // 页脚的标签数和 Chrome 一样算上新标签页自己
    expect(await guest(page, `document.querySelector('#statTabs').textContent`)).toBe('2')

    // 它旁边的 ☆ 把它加进快捷书签：写进 QuickLinks 里我们自己的文件（BKCore 的格式），别人的文件不动
    await clickIn(run, '#openTabsMissions .chip-quick')
    await until(page, `[...document.querySelectorAll('#bkQuick .bk-t-title')].some((e) => e.textContent === '蓝湖')`)
    const dir = join(container, 'QuickLinks')
    // 页面先画出来再写盘：等文件里有它
    await expect.poll(() => readdirSync(dir).some((n) => n.endsWith('-canvasnotes.json') && readFileSync(join(dir, n), 'utf8').includes('蓝湖'))).toBe(true)
    const mine = readdirSync(dir).find((n) => n.endsWith('-canvasnotes.json'))!
    expect(mine).toMatch(/^mac-[0-9a-z]+-canvasnotes\.json$/)
    const doc = JSON.parse(readFileSync(join(dir, mine), 'utf8')) as { schema: number; writer: string; records: Record<string, { kind: string; url: string; title: string; t: number; d: string; deleted: boolean }> }
    expect(doc.schema).toBe(1)
    expect(doc.writer).toBe(mine.replace(/\.json$/, ''))
    const added = Object.values(doc.records).find((r) => r.kind === 'link' && r.url === `${base}/${encodeURIComponent('蓝湖')}`)!
    expect(added).toMatchObject({ title: '蓝湖', deleted: false })
    expect(typeof added.t).toBe('number')
    expect(added.d).toMatch(/^dev-/)
    expect(readFileSync(theirs, 'utf8')).toBe(theirsBefore)

    // 点「打开的标签」里那一页：切到那个网页标签
    await clickIn(run, '#openTabsMissions .page-chip[data-action="focus-tab"] .chip-text')
    await expect(webTabs(page).first()).toHaveAttribute('aria-selected', 'true')
    await webTabs(page).nth(1).getByRole('button').first().click()
    await expect(page.locator(ON)).toHaveAttribute('src', NEWTAB)

    // 点快捷书签：在这个标签里打开，地址栏、标签名跟着变
    await clickIn(run, '#bkQuick .bk-tile', '黑沙滩')
    await expect(webTabs(page).nth(1)).toContainText('黑沙滩')
    await expect(web(page).getByRole('textbox', { name: '网址' })).toHaveValue(`${base.replace(/^http:\/\//, '')}/黑沙滩`)

    // 「⋯ › 稍后再看」：进 BookmarkKeeper 自己的「Saved for later」，新标签页里看得到
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    await web(page).getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: '稍后再看' }).click()
    await expect(page.getByText('存到稍后再看了')).toBeVisible()
    await web(page).getByRole('button', { name: '新网页', exact: true }).click()
    await until(page, `document.querySelector('#deferredList')?.textContent.includes('黑沙滩')`)

    // 「⋯ › 加书签」还是收藏当前网页（书签表里多一个，新标签页的搜索也搜得到）
    await webTabs(page).nth(1).getByRole('button').first().click()
    await (await starItem(page)).click()
    await expect.poll(() => (JSON.parse(readFileSync(join(userData, 'web', 'bookmarks.json'), 'utf8')) as { url: string }[]).some((b) => b.url === `${base}/${encodeURIComponent('黑沙滩')}`)).toBe(true)
  } finally {
    await run.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('iCloud 容器不在（iCloud 云盘没开、没装 BookmarkKeeper App）：快捷书签存在本机，页面上说只存在这台 Mac', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cn-bk-'))
  const userData = join(root, 'user-data')
  seed(userData)
  const run = await launch({ 'a.md': '# a\n' }, { CN_USER_DATA: userData, CN_BOOKMARKKEEPER_DIR: BUNDLED, CN_ICLOUD_CONTAINER: join(root, '没有这个容器') })
  try {
    const { page } = run
    await rail(page).getByRole('button', { name: '网页' }).click()
    await web(page).getByRole('textbox', { name: '网址' }).fill(`${base}/${encodeURIComponent('极光')}`)
    await web(page).getByRole('textbox', { name: '网址' }).press('Enter')
    await expect(webTabs(page).first()).toContainText('极光')
    await web(page).getByRole('button', { name: '新网页', exact: true }).click()
    await until(page, `!document.querySelector('#bkSyncNote').hidden`)
    expect(await guest(page, `document.querySelector('#bkSyncNote').textContent`)).toContain('只保存在这台 Mac 上')
    // 还没有快捷书签的那句中文提示不用斜体（中文没有斜体字形，硬斜出来笔画发歪）
    await until(page, `document.querySelector('#bkQuick .bk-quick-empty')`)
    await expect.poll(() => guest(page, `getComputedStyle(document.querySelector('#bkQuick .bk-quick-empty')).fontStyle`)).toBe('normal')
    await clickIn(run, '#openTabsMissions .chip-quick')
    await until(page, `[...document.querySelectorAll('#bkQuick .bk-t-title')].some((e) => e.textContent === '极光')`)
    const local = join(userData, 'web', 'bookmarkkeeper', 'QuickLinks')
    await expect.poll(() => (existsSync(local) ? readdirSync(local).filter((n) => n.endsWith('-canvasnotes.json')) : [])).toHaveLength(1)
    expect(existsSync(join(root, '没有这个容器'))).toBe(false)
  } finally {
    await run.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('整理书签页：失效链接检测找出 404；AI 整理（OpenAI 兼容接口）分好类，应用后书签挪进书签栏里新建的文件夹', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cn-bk-'))
  const userData = join(root, 'user-data')
  seed(userData, [{ title: '死链', folder: '其他书签' }])
  // BookmarkKeeper 自己的设置（存在它的 storage.local）：AI 用自定义的 OpenAI 兼容接口
  mkdirSync(join(userData, 'web', 'bookmarkkeeper'), { recursive: true })
  writeFileSync(join(userData, 'web', 'bookmarkkeeper', 'storage.json'), JSON.stringify({ local: { aiConfig: { provider: 'custom', apiKey: 'test-key', baseUrl: `${base}/v1`, model: 'fake' } }, sync: {} }))
  const run = await launch({ 'a.md': '# a\n' }, { CN_USER_DATA: userData, CN_BOOKMARKKEEPER_DIR: BUNDLED, CN_ICLOUD_CONTAINER: join(root, 'icloud') })
  try {
    const { page } = run
    await rail(page).getByRole('button', { name: '网页' }).click()
    // 新标签页上的「整理书签」：同一个标签里开插件的整理页
    await clickIn(run, '#bkTools a', '整理书签')
    await until(page, `location.pathname === '/manager/manager.html' && document.querySelector('#all-count').textContent.includes('5')`)

    await clickIn(run, '.nav-btn[data-panel="panel-dead"]')
    await clickIn(run, '#scan-btn')
    await until(page, `document.querySelector('#scan-progress').textContent.startsWith('扫描完成')`, 30_000)
    expect(await guest(page, `document.querySelector('#scan-progress').textContent`)).toBe('扫描完成：共 5 条，失效 1，疑似问题 0')
    expect(await guest(page, `document.querySelector('#dead-list').textContent`)).toContain('死链')

    await clickIn(run, '.nav-btn[data-panel="panel-ai"]')
    await until(page, `document.querySelector('#ai-config-status').textContent.includes('fake')`)
    await clickIn(run, '#ai-start')
    await until(page, `!document.querySelector('#ai-preview').hidden`, 30_000)
    expect(aiAsked).toBeGreaterThan(0)
    await clickIn(run, '#ai-apply')
    await until(page, `document.querySelector('#ai-apply-status').textContent.startsWith('✅')`)
    const saved = JSON.parse(readFileSync(join(userData, 'web', 'bookmarks.json'), 'utf8')) as { title: string; folder: string }[]
    expect(saved.map((b) => b.folder)).toEqual(Array(5).fill(`书签栏 / AI 整理 ${new Date().toISOString().slice(0, 10)} / 冰岛`))
    // 软件的「书签和历史」看到的是同一份
    await webMore(page, '书签和历史')
    await expect(web(page).getByText(/AI 整理/).first()).toBeVisible()
  } finally {
    await run.close()
    rmSync(root, { recursive: true, force: true })
  }
})
