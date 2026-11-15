import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { gitStatus, launch, rail, type Running, webMore } from './app'

let server: Server
let base: string

const LONG = Array.from({ length: 40 }, (_, i) => `<p id="p${i}">Paragraph ${i} talks about glaciers, black sand beaches and the long winter nights in Iceland.</p>`).join('\n')

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    if (req.url === '/b') return res.end('<title>Second page</title><h1>Second page</h1><p>Another page about Reykjavik.</p>')
    if (req.url === '/c') return res.end('<title>Aurora guide</title><h1>Aurora guide</h1><p>Where to see the northern lights.</p>')
    res.end(`<!doctype html><html lang="en"><title>Iceland travel notes</title><body style="font:16px/1.5 sans-serif;padding:20px;max-width:640px">
      <nav><a href="/b">Home</a> · <a href="/c">About</a></nav>
      <article><h1 id="h">Iceland travel notes</h1>
      <p id="first">Reykjavik is the capital and largest city of Iceland.</p>
      <p id="second">The Ring Road circles the whole island and takes about a week to drive.</p>
      <pre id="code">const road = 'Route 1'</pre>
      <button id="btn">Subscribe now</button>
      <ul><li id="li1">Pack a windproof jacket.</li><li id="li2">Book huts early in summer.</li></ul>
      ${LONG}
      <p id="far">The last paragraph is far below the first screen.</p>
      </article></body></html>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
/** 地址栏里「这一页」的开关（双语翻译、星星） */
const pluginBar = (page: Page) => web(page).getByRole('toolbar', { name: '这一页' })

function guest(page: Page, code: string): Promise<unknown> {
  return page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
}

async function go(page: Page, u: string) {
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(u)
  await addr.press('Enter')
  await expect.poll(() => guest(page, 'document.readyState + "|" + location.href')).toBe(`complete|${u}`)
}

async function openWeb(page: Page, u: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  await expect(web(page)).toBeVisible()
  await go(page, u)
}

/** 假引擎的译文：「译文：」加原文前 40 个字 */
const fake = (t: string) => '译文：' + t.slice(0, 40)

/** 某个元素里我们插的译文（没有就是 null） */
const trOf = (page: Page, id: string) => guest(page, `document.getElementById('${id}')?.querySelector('cn-tr')?.textContent ?? null`)

const stats = (page: Page) => page.evaluate(() => window.cnPlugins.call<{ aiCalls: number; fromCache: number; fromAi: number }>('translate', 'stats'))

/**
 * 在网页里按键：Playwright 的 keyboard 只到软件界面、到不了 webview 里的网页，
 * 所以从主进程往当前网页送真的按键（和人在网页里按一样，走网页预加载的监听）
 */
async function pressInPage(run: Running, key: string, modifiers: ('alt' | 'meta' | 'shift')[] = []) {
  const id = await run.page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())
  await run.app.evaluate(
    ({ webContents }, [wcId, k, mods]) => {
      const wc = webContents.fromId(wcId as number)!
      wc.sendInputEvent({ type: 'keyDown', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: k as string, modifiers: mods as ('alt' | 'meta' | 'shift')[] })
    },
    [id, key, modifiers] as const,
  )
}

async function guestRect(page: Page, code: string) {
  const w = (await web(page).locator('webview.on').boundingBox())!
  const r = JSON.parse(String(await guest(page, `JSON.stringify(${code}.getBoundingClientRect())`))) as { x: number; y: number; width: number; height: number }
  return { x: w.x + r.x + r.width / 2, y: w.y + r.y + r.height / 2 }
}

test('双语翻译：按钮开、段落下出现译文（跳过代码、导航、按钮）、滚动后续翻、再按恢复；同页再开读缓存不再问 AI；⌥A 和 ⌘F 也能开；选中一段弹译文卡片；只看译文；关掉插件', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '700' })
  const { page } = run
  try {
    await openWeb(page, `${base}/article`)
    const original = await guest(page, `document.querySelector('article').innerText`)
    const btn = pluginBar(page).getByRole('button', { name: '双语翻译' })
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await btn.click()
    // 先是「翻译中…」占位，再换成译文
    await expect.poll(() => trOf(page, 'first'), { timeout: 2000 }).toBe('翻译中…')
    await expect.poll(() => trOf(page, 'first')).toBe(fake('Reykjavik is the capital and largest city of Iceland.'))
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await expect(btn).toHaveClass(/\bon\b/)
    expect(await trOf(page, 'h')).toBe(fake('Iceland travel notes'))
    expect(await trOf(page, 'li1')).toBe(fake('Pack a windproof jacket.'))
    // 代码、按钮、导航不翻
    expect(await guest(page, `document.querySelectorAll('pre cn-tr, button cn-tr, nav cn-tr').length`)).toBe(0)
    // 只翻看得见的：最下面那段还没翻
    expect(await trOf(page, 'far')).toBeNull()
    const before = await stats(page)
    expect(before.aiCalls).toBeGreaterThan(0)
    // 滚到底：新看见的段落也翻了
    await guest(page, `window.scrollTo(0, document.body.scrollHeight)`)
    await expect.poll(() => trOf(page, 'far')).toBe(fake('The last paragraph is far below the first screen.'))
    expect((await stats(page)).aiCalls).toBeGreaterThan(before.aiCalls)

    // 再按一次：恢复原文，一个字不差
    await btn.click()
    await expect.poll(() => guest(page, `document.querySelectorAll('cn-tr').length`)).toBe(0)
    expect(await guest(page, `document.querySelector('article').innerText`)).toBe(original)
    await expect(btn).toHaveAttribute('aria-pressed', 'false')

    // 同一页重新载入，焦点在网页里按 ⌥A：都从缓存来，不再问 AI
    const cachedBefore = await stats(page)
    await web(page).getByRole('button', { name: '重新载入' }).click()
    await expect.poll(() => guest(page, 'document.readyState')).toBe('complete')
    await guest(page, 'window.scrollTo(0, 0)')
    const p = await guestRect(page, `document.getElementById('second')`)
    await page.mouse.click(p.x, p.y)
    await pressInPage(run, 'A', ['alt'])
    await expect.poll(() => trOf(page, 'first')).toBe(fake('Reykjavik is the capital and largest city of Iceland.'))
    await guest(page, `window.scrollTo(0, document.body.scrollHeight)`)
    await expect.poll(() => trOf(page, 'far')).toBe(fake('The last paragraph is far below the first screen.'))
    const after = await stats(page)
    expect(after.aiCalls).toBe(cachedBefore.aiCalls)
    expect(after.fromCache).toBeGreaterThan(cachedBefore.fromCache)

    // 设置 · 插件里换成「只看译文」：原文藏起来，只剩译文
    await webMore(page, '插件')
    await page.getByRole('dialog', { name: '插件' }).getByRole('button', { name: '双语翻译 设置' }).click()
    const settings = page.getByRole('dialog', { name: '设置' })
    await expect(settings.getByRole('radiogroup', { name: '译文怎么显示' })).toBeVisible()
    await settings.getByRole('radio', { name: '只看译文' }).click()
    await expect.poll(() => guest(page, `getComputedStyle(document.querySelector('#first cn-orig')).display`)).toBe('none')
    await expect.poll(() => guest(page, `document.getElementById('first').innerText.trim()`)).toBe(fake('Reykjavik is the capital and largest city of Iceland.'))
    await settings.getByRole('radio', { name: '译文在下' }).click()
    await expect.poll(() => guest(page, `document.querySelectorAll('cn-orig').length`)).toBe(0)
    await page.keyboard.press('Escape')

    // ⌘F 面板里的命令：恢复原文
    await page.keyboard.press('Meta+f')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('恢复原文')
    await expect(page.getByRole('option', { name: /恢复原文/ }).first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect.poll(() => guest(page, `document.querySelectorAll('cn-tr').length`)).toBe(0)
    // 焦点在软件界面（不在输入框）时 ⌥A 也开关右栏网页
    await page.keyboard.press('Alt+a')
    await expect.poll(() => guest(page, `document.querySelectorAll('cn-tr').length`)).toBeGreaterThan(3)
    await page.keyboard.press('Alt+a')
    await expect.poll(() => guest(page, `document.querySelectorAll('cn-tr').length`)).toBe(0)

    // 选中一段，工具条上点「翻译」：选区下面弹译文卡片
    await guest(page, 'window.scrollTo(0, 0)')
    const s = await guestRect(page, `document.getElementById('second')`)
    for (let i = 0; i < 3; i++) {
      await page.mouse.click(s.x, s.y, { clickCount: 3 })
      if (await expect.poll(() => guest(page, 'getSelection().toString().length'), { timeout: 1000 }).toBeGreaterThan(0).then(() => true, () => false)) break
    }
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host')?.shadowRoot?.querySelector('button.tr')?.hidden`)).toBe(false)
    const tb = await guestRect(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('button.tr')`)
    await page.mouse.click(tb.x, tb.y)
    await expect
      .poll(() => guest(page, `document.getElementById('cn-tr-card')?.shadowRoot?.querySelector('.body')?.textContent ?? ''`))
      .toBe(fake('The Ring Road circles the whole island and takes about a week to drive.'))
    expect(await guest(page, `document.getElementById('cn-tr-card').shadowRoot.querySelector('.head span').textContent`)).toBe('译文 · 简体中文')
    // 卡片在选区下面
    const card = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('cn-tr-card').getBoundingClientRect())`))) as { top: number }
    const sel = JSON.parse(String(await guest(page, `JSON.stringify(document.getElementById('second').getBoundingClientRect())`))) as { bottom: number }
    expect(card.top).toBeGreaterThanOrEqual(sel.bottom)
    await pressInPage(run, 'Escape')
    await expect.poll(() => guest(page, `document.getElementById('cn-tr-card').style.display`)).toBe('none')

    // 插件面板里关掉双语翻译：按钮没了，选区工具条上也没有「翻译」
    await webMore(page, '插件')
    const panel = page.getByRole('dialog', { name: '插件' })
    await expect(panel.getByRole('list', { name: '内置插件' }).getByRole('listitem')).toHaveText([/双语翻译.*读改当前网页 · 联网/, /书签管家.*写笔记/])
    await panel.getByRole('switch', { name: '启用 双语翻译' }).click()
    await expect(panel.getByRole('switch', { name: '启用 双语翻译' })).toHaveAttribute('aria-checked', 'false')
    await expect(pluginBar(page).getByRole('button', { name: '双语翻译' })).toHaveCount(0)
    await expect.poll(() => guest(page, `document.getElementById('cn-clip-host').shadowRoot.querySelector('button.tr').hidden`)).toBe(true)
    // 网页里按 ⌥A 也不动了
    await pressInPage(run, 'A', ['alt'])
    await page.keyboard.press('Alt+a')
    await page.waitForTimeout(500)
    expect(await guest(page, `document.querySelectorAll('cn-tr').length`)).toBe(0)
  } finally {
    await run.close()
  }
})

test('书签管家：地址栏的星星收藏当前页并开小卡（改标题、加标签和备注、选文件夹），星星变实心、书签栏同一份；小卡里「整理全部书签」；搜、按标签筛、排序、改、删；选中的存进库是收件箱里的一篇，一次提交', async () => {
  const run = await launch({ 'a.md': '# a\n' }, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  try {
    await openWeb(page, `${base}/b`)
    // 书签只有一个入口：地址栏的星星（地址栏右边的插件按钮里没有书签管家）
    await expect(web(page).getByRole('toolbar', { name: '插件按钮' }).getByRole('button', { name: '书签管家', exact: true })).toHaveCount(0)
    const btn = web(page).getByRole('button', { name: '书签管家', exact: true })
    await expect(btn).not.toHaveClass(/\bon\b/)
    await btn.click()
    const dlg = page.getByRole('dialog', { name: '书签管家' })
    await expect(btn).toHaveClass(/\bon\b/)
    await expect(dlg).toContainText('已收藏')
    await expect(dlg.getByRole('textbox', { name: '书签标题' })).toHaveValue('Second page')
    await dlg.getByRole('textbox', { name: '书签标题' }).fill('雷克雅未克第二页')
    await dlg.getByRole('combobox', { name: '书签标签' }).fill('冰岛')
    await dlg.getByRole('combobox', { name: '书签标签' }).press('Enter')
    await dlg.getByRole('combobox', { name: '书签标签' }).fill('城市，')
    await dlg.getByRole('textbox', { name: '书签备注' }).fill('首都的一页，回头细看')
    // 星星开的是只管这一页的小卡：点「完成」存好收起
    await expect(dlg.getByRole('list', { name: '书签管家列表' })).toHaveCount(0)
    await dlg.getByRole('button', { name: '完成' }).click()
    await expect(dlg).toHaveCount(0)
    // 书签栏、地址栏的星星是同一份
    await expect(web(page).getByRole('toolbar', { name: '书签栏' })).toContainText('雷克雅未克第二页')

    // 第二个、第三个书签：去别的页点星星收藏
    await go(page, `${base}/c`)
    await btn.click()
    await expect(dlg.getByRole('textbox', { name: '书签标题' })).toHaveValue('Aurora guide')
    await dlg.getByRole('combobox', { name: '书签标签' }).fill('极光')
    await dlg.getByRole('combobox', { name: '书签标签' }).press('Enter')
    await dlg.getByRole('button', { name: '完成' }).click()
    await expect(dlg).toHaveCount(0)
    await go(page, `${base}/article`)
    await btn.click()
    // 收藏过的再点星星是收起
    await expect(dlg).toContainText('已收藏')
    await btn.click()
    await expect(dlg).toHaveCount(0)
    // 小卡底下「整理全部书签」：整个书签管家
    await btn.click()
    await dlg.getByRole('button', { name: '整理全部书签 →' }).click()
    const list = dlg.getByRole('list', { name: '书签管家列表' })
    await expect(list.getByRole('listitem')).toHaveCount(3)
    await expect(list.getByRole('listitem', { name: '雷克雅未克第二页' })).toHaveText(/雷克雅未克第二页.*#冰岛.*#城市.*首都的一页，回头细看/)
    await expect(list.getByRole('listitem', { name: 'Aurora guide' })).toContainText('#极光')

    // 搜：标题、网址、标签、备注都能搜
    const search = dlg.getByRole('textbox', { name: '搜书签' })
    await search.fill('回头细看')
    await expect(list.getByRole('listitem')).toHaveText([/雷克雅未克第二页/])
    await search.fill('#极光')
    await expect(list.getByRole('listitem')).toHaveText([/Aurora guide/])
    await search.fill('/article')
    await expect(list.getByRole('listitem')).toHaveText([/Iceland travel notes/])
    await search.fill('')
    // 按标签筛
    await dlg.getByRole('list', { name: '按标签筛' }).getByRole('button', { name: '#冰岛' }).click()
    await expect(list.getByRole('listitem')).toHaveText([/雷克雅未克第二页/])
    await dlg.getByRole('list', { name: '按标签筛' }).getByRole('button', { name: '全部' }).click()
    // 排序：添加时间（新的在前）、标题、上次访问
    await expect(list.getByRole('listitem')).toHaveText([/Iceland travel notes/, /Aurora guide/, /雷克雅未克第二页/])
    await dlg.getByRole('combobox', { name: '书签排序' }).selectOption({ label: '按标题' })
    await expect(list.getByRole('listitem')).toHaveText([/雷克雅未克第二页/, /Aurora guide/, /Iceland travel notes/])
    // 再去一次第二页：它成了最近访问的
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await go(page, `${base}/b`)
    await btn.click()
    await dlg.getByRole('button', { name: '整理全部书签 →' }).click()
    await dlg.getByRole('combobox', { name: '书签排序' }).selectOption({ label: '按上次访问' })
    await expect(list.getByRole('listitem').first()).toContainText('雷克雅未克第二页')

    // 改：标题和备注
    await list.getByRole('button', { name: '改书签 Aurora guide' }).click()
    const edit = list.getByRole('listitem', { name: '改 Aurora guide' })
    await edit.getByRole('textbox', { name: '书签标题' }).fill('极光指南')
    await edit.getByRole('textbox', { name: '书签备注' }).fill('十月到三月')
    await edit.getByRole('button', { name: '保存' }).click()
    await expect(list.getByRole('listitem', { name: '极光指南' })).toContainText('十月到三月')
    // 删
    await list.getByRole('button', { name: '删掉书签 Iceland travel notes' }).click()
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(web(page).getByRole('toolbar', { name: '书签栏' })).not.toContainText('Iceland travel notes')

    // 书签存在软件设置目录，和书签栏同一份文件；标签和备注是新加的两项
    const saved = JSON.parse(readFileSync(join(run.userData, 'web', 'bookmarks.json'), 'utf8')) as { title: string; tags?: string[]; note?: string }[]
    expect(saved.map((b) => [b.title, b.tags ?? [], b.note ?? ''])).toEqual([
      ['雷克雅未克第二页', ['冰岛', '城市'], '首都的一页，回头细看'],
      ['极光指南', ['极光'], '十月到三月'],
    ])
    expect(gitStatus(vault)).toBe('')

    // 存进库：选两个，一次提交，收件箱里两篇，frontmatter 带 source 和 tags
    await list.getByRole('checkbox', { name: '选中 雷克雅未克第二页' }).check()
    await list.getByRole('checkbox', { name: '选中 极光指南' }).check()
    await dlg.getByRole('button', { name: '存进库' }).click()
    await expect(page.locator('.toast-cn')).toContainText('存进收件箱 2 篇，一次提交')
    const files = readdirSync(join(vault, '收件箱')).sort()
    expect(files).toEqual(['极光指南.md', '雷克雅未克第二页.md'])
    const md = readFileSync(join(vault, '收件箱', '雷克雅未克第二页.md'), 'utf8')
    expect(md).toMatch(new RegExp(`^---\\ncreated: \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d\\nsource: ${base.replace(/\./g, '\\.')}/b\\ntags: \\["冰岛", "城市"\\]\\n---\\n# 雷克雅未克第二页\\n\\n—— \\[雷克雅未克第二页\\]\\(${base.replace(/\./g, '\\.')}/b\\)\\n\\n首都的一页，回头细看\\n$`))
    expect(gitStatus(vault)).toBe('')
    const log = execFileSync('git', ['-C', vault, 'log', '-1', '--name-only', '--format=%s'], { encoding: 'utf8' })
    expect(log).toContain('书签存进库：2 个')
    expect(log).toContain('收件箱/雷克雅未克第二页.md')
    expect(log).toContain('收件箱/极光指南.md')
    // 左栏收件箱里看得到
    await expect(page.locator('.nav')).toContainText('收件箱')

    // ⌘F 里的「书签管家」能开弹窗；右键一行有菜单
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
    await page.keyboard.press('Meta+f')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('书签管家')
    await expect(page.getByRole('option', { name: /书签管家/ }).first()).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(dlg).toBeVisible()
    await list.getByRole('listitem', { name: '极光指南' }).click({ button: 'right' })
    await page.getByRole('menu', { name: '书签菜单' }).getByRole('menuitem', { name: '删掉' }).click()
    await expect(list.getByRole('listitem')).toHaveText([/雷克雅未克第二页/])
  } finally {
    await run.close()
  }
})
