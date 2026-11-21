/**
 * cmdk 方案 A 的网页「⋯」和链接（DESIGN.v3 6.5、9.3，task-vcov6）：
 * 「⋯」四组（这一页、这个网站、书签、浏览器）+「调整这个菜单…」藏起、在组里拖着换顺序，存在库里；
 * 剪藏来的维基文档：链接后面的域名小块从十几个到 0，来源只在标题下写一次「剪自」；指着链接出链接卡，点「右栏打开」右栏网页开那个网址；
 * 卡上改链接、右键去掉链接改的都是那一段 [字](网址)。都是真点、真拖。
 */
import { expect, type Page, test } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { editorText, launch, openNote, pane, rail, waitSaved } from './app'
import { armMenus, menuLabels, openedMenu, pickMenu } from './menu'

let server: Server
let base: string
const W = (s: string) => `/wiki/${s}`
const LINKS = ['Iceland', 'Island_country', 'Atlantic_Ocean', 'Arctic_Ocean', 'Greenland', 'Arctic_Circle', 'Divergent_boundary', 'Mid-Atlantic_Ridge', 'List_of_island_countries', 'Glacier', 'Continental_Europe', 'Exclusive_economic_zone', 'Dettifoss']

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const a = (s: string, t = s.replace(/_/g, ' ')) => `<a href="${W(s)}">${t}</a>`
    if (req.url?.startsWith('/wiki/Geography')) {
      res.end(`<title>Geography of Iceland - Wikipedia</title><body style="font:16px sans-serif;padding:20px;max-width:640px">
        <article><h1>Geography of Iceland</h1>
        <p>${a('Iceland')} is an ${a('Island_country', 'island country')} at the confluence of the ${a('Atlantic_Ocean', 'North Atlantic')} and ${a('Arctic_Ocean', 'Arctic')} oceans, east of ${a('Greenland')} and immediately south of the ${a('Arctic_Circle', 'Arctic Circle')}, atop the ${a('Divergent_boundary', 'constructive boundary')} of the northern ${a('Mid-Atlantic_Ridge', 'Mid-Atlantic Ridge')}. The island country is the world's ${a('List_of_island_countries', '18th largest in area')}. It has more land covered by ${a('Glacier', 'glaciers')} than ${a('Continental_Europe', 'continental Europe')} and possesses an ${a('Exclusive_economic_zone', 'exclusive economic zone')} of 751,345 km2.</p>
        <p>${a('Dettifoss')}, located in northeast Iceland, is the second-largest waterfall in Europe in terms of volume discharge, and it is worth a long visit in summer.</p>
        </article></body>`)
    } else res.end(`<title>${decodeURIComponent(req.url ?? '').split('/').pop()}</title><body><h1>${req.url}</h1></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const more = (page: Page) => web(page).getByRole('menu', { name: '更多', exact: true })
const groupLabels = (page: Page) => more(page).locator(':scope > [role=group]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
const groupItems = (page: Page, g: string) => more(page).getByRole('group', { name: g, exact: true }).locator('.mlabel').allTextContents()
const address = (page: Page) => web(page).getByRole('textbox', { name: '网址' })

async function openPage(page: Page, path: string) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  await address(page).fill(`${base}${path}`)
  await address(page).press('Enter')
  await expect(web(page).locator('webview.on')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<string> }).executeJavaScript('document.readyState'))).toBe('complete')
}

test('网页「⋯」四组；调整这个菜单：点眼睛藏起「稍后再看」、在组里拖着换顺序、插件…锁着；存在库里，再开菜单照这个样子', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openPage(page, '/wiki/Geography_of_Iceland')
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    expect(await groupLabels(page)).toEqual(['这一页', '这个网站', '书签', '浏览器', '调整'])
    expect(await groupItems(page, '这一页')).toEqual(['剪藏这一页', '稍后再看', '双语翻译'])
    expect(await groupItems(page, '这个网站')).toEqual(['不拦这个网站的广告'])
    await expect(more(page).getByRole('menuitemcheckbox', { name: '在127.0.0.1不拦广告' }).locator('.h')).toHaveText('127.0.0.1')
    expect(await groupItems(page, '书签')).toEqual(['加书签', '书签首页', '书签和历史…'])
    expect(await groupItems(page, '浏览器')).toEqual(['插件…', '导入Chrome登录…'])
    // 量排版宽度（菜单弹出时有一点缩放动画，boundingBox 会小一点）
    expect(await more(page).evaluate((e) => (e as HTMLElement).offsetWidth)).toBe(280)
    await page.screenshot({ path: 'test-results/cmdk-web-menu.png' })

    // 调整这个菜单…
    await more(page).getByRole('menuitem', { name: '调整这个菜单…' }).click()
    await expect(more(page).locator('.wm-head')).toHaveText('点眼睛藏起不用的，拖着在组里换顺序')
    await more(page).getByRole('button', { name: '藏起「稍后再看」' }).click()
    await expect(more(page).locator('.wm-row.dim .mlabel')).toHaveText(['稍后再看'])
    // 插件… 是一把锁，点不动
    await more(page).getByRole('button', { name: '一直在' }).click()
    await expect(more(page).locator('.wm-row.dim')).toHaveCount(1)
    // 「双语翻译」拖到「剪藏这一页」上面
    const tr = more(page).locator('.wm-row[data-wi="translate"] .grip')
    const clip = (await more(page).locator('.wm-row[data-wi="clip"]').boundingBox())!
    const g = (await tr.boundingBox())!
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(clip.x + 60, clip.y + 6, { steps: 6 })
    await expect(more(page).locator('.pal-dropline')).toBeVisible()
    await page.screenshot({ path: 'test-results/cmdk-web-menu-edit.png' })
    await page.mouse.up()
    await expect(more(page).locator('[data-wg="page"] .wm-row .mlabel')).toHaveText(['双语翻译', '剪藏这一页', '稍后再看'])
    // 「完成」是一颗实心胶囊（设计复审：之前被菜单按钮的样式盖成了整行、没有底色）
    const done = more(page).getByRole('button', { name: '完成' })
    const look = await done.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }))
    expect(look.bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(look.w).toBeLessThan(80)
    expect(look.h).toBe(28)
    await done.click()
    await expect(page.locator('.toast-cn')).toContainText('网页「⋯」里藏起了 1 样')
    expect(await groupItems(page, '这一页')).toEqual(['双语翻译', '剪藏这一页'])
    const saved = JSON.parse(readFileSync(join(vault, '.canvas-notes/命令.json'), 'utf8')) as { webMenu: { hidden: string[]; order: Record<string, string[]> } }
    expect(saved.webMenu).toEqual({ hidden: ['later'], order: { page: ['translate', 'clip', 'later'] } })
    // 收起再开：照调好的样子
    await page.keyboard.press('Escape')
    await expect(more(page)).toHaveCount(0)
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    expect(await groupItems(page, '这一页')).toEqual(['双语翻译', '剪藏这一页'])
  } finally {
    await run.close()
  }
})

test('自己设的快捷键在哪都能按：网页有焦点时按 ⌥⌘S 也跑「同步」（主进程转回界面）', async () => {
  // 库里已经存着 命令.json：⌥⌘S 给了「同步」
  const run = await launch({ 'a.md': '# a\n', '.canvas-notes/命令.json': JSON.stringify({ version: 1, keys: { sync: '⌥⌘S' } }) })
  const { page, app } = run
  try {
    await openPage(page, '/wiki/Geography_of_Iceland')
    const id = await page.evaluate(() => (document.querySelector('.right.web webview.on') as unknown as { getWebContentsId(): number }).getWebContentsId())
    // 从主进程往网页送真的按键（Playwright 的 keyboard 到不了 webview 里）
    await app.evaluate(({ webContents }, wcId) => {
      const wc = webContents.fromId(wcId)!
      wc.focus()
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'S', modifiers: ['alt', 'meta'] })
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'S', modifiers: ['alt', 'meta'] })
    }, id)
    await expect(page.locator('.toast-cn')).toContainText('这个库还没有远程仓库')
  } finally {
    await run.close()
  }
})

test('剪藏来的维基：链接后面的域名小块 0 个，标题下写一次「剪自」；指着链接出卡，右栏打开那个网址；卡上改链接、右键去掉链接改的是那一段', async () => {
  const run = await launch({ 'a.md': '# a\n' })
  const { page, vault } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await armMenus(run)
    await openPage(page, '/wiki/Geography_of_Iceland')
    await web(page).getByRole('button', { name: '更多', exact: true }).click()
    await more(page).getByRole('menuitem', { name: '剪藏这一页' }).click()
    await expect(web(page).locator('.wnote')).toContainText('整页存进收件箱了：Geography of Iceland')
    const file = join(vault, '收件箱', readdirSync(join(vault, '收件箱'))[0]!)
    const md0 = readFileSync(file, 'utf8')
    for (const l of LINKS) expect(md0).toContain(`(${base}${W(l)})`)
    await web(page).locator('.wnote').getByRole('button', { name: '打开' }).click()
    await expect(pane(page).locator('.cm-link').first()).toBeVisible()
    // 13 个链接，后面一个域名小块都没有；字里不露网址
    await expect(pane(page).locator('.cm-link')).toHaveCount(LINKS.length + 1)
    await expect(pane(page).locator('.cm-urlchip')).toHaveCount(0)
    expect(await pane(page).locator('.cm-line', { hasText: 'island country' }).innerText()).not.toContain('127.0.0.1')
    expect(await pane(page).locator('.cm-line', { hasText: 'Dettifoss' }).innerText()).not.toContain('127.0.0.1')
    // 来源只写一次：标题下面那一行「剪自 127.0.0.1」
    await expect(pane(page).locator('.cm-meta-src')).toHaveText('剪自127.0.0.1')
    await page.screenshot({ path: 'test-results/cmdk-links.png' })

    // 指着「Arctic Circle」停 0.3 秒：下面出链接卡
    const arctic = pane(page).locator('.cm-link', { hasText: 'Arctic Circle' })
    await arctic.hover()
    const card = page.getByRole('dialog', { name: '链接' })
    await expect(card).toBeVisible()
    await expect(card.locator('.top b')).toHaveText('Arctic Circle')
    await expect(card.locator('.u')).toHaveText(`127.0.0.1:${base.split(':').pop()}/wiki/Arctic_Circle`)
    await expect(card.getByRole('button')).toHaveText(['右栏打开 ⌘点', '拷贝', '改链接', '去掉链接'])
    const lb = (await arctic.boundingBox())!
    const cb = (await card.boundingBox())!
    expect(Math.round(cb.width)).toBe(372)
    expect(Math.abs(cb.y - (lb.y + lb.height) - 6)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: 'test-results/cmdk-link-card.png' })
    // 右栏打开：右栏网页的地址换成这个链接
    await card.getByRole('button', { name: /右栏打开/ }).click()
    await expect(card).toHaveCount(0)
    await expect(address(page)).toHaveValue(new RegExp(`/wiki/Arctic_Circle$`))

    // 卡上改链接：网址那一行变成输入框，回车改好
    const glacier = pane(page).locator('.cm-link', { hasText: 'glaciers' })
    await glacier.hover()
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: '改链接' }).click()
    const box = card.getByRole('textbox', { name: '链接的网址' })
    await expect(box).toBeFocused()
    await box.fill('https://example.com/冰川')
    await box.press('Enter')
    await expect(page.locator('.toast-cn')).toContainText('链接改好了')
    await waitSaved(page)
    expect(readFileSync(file, 'utf8')).toContain('[glaciers](https://example.com/冰川)')

    // 右键「Greenland」：系统菜单多一组「改链接…」「去掉链接」；去掉链接只留字，⌘Z 撤回
    await pane(page).locator('.cm-link', { hasText: 'Greenland' }).click({ button: 'right' })
    const items = menuLabels(await openedMenu(run))
    expect(items.slice(0, 6)).toEqual(['打开链接', '在中间栏打开', '用默认浏览器打开', '拷贝链接', '改链接…', '去掉链接'])
    await pickMenu(run, '去掉链接')
    await expect(page.locator('.toast-cn')).toContainText('「Greenland」不再是链接 · ⌘Z 撤回')
    expect(await editorText(page)).toContain('east of Greenland and')
    await page.keyboard.press('Meta+z')
    await expect.poll(() => editorText(page)).toContain(`[Greenland](${base}${W('Greenland')})`)
    // 右键「改链接…」：链接下面出卡，网址那一行就是输入框
    await pane(page).locator('.cm-link', { hasText: 'Dettifoss' }).click({ button: 'right' })
    await pickMenu(run, '改链接…')
    await expect(card.getByRole('textbox', { name: '链接的网址' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(card).toHaveCount(0)
  } finally {
    await run.close()
  }
})
