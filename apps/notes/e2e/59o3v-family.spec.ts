/**
 * 设置 › 软件家族（task-59o3v，原型 25-软件家族 方向 A）：真点真读盘。
 * 装了哪些由测试写的文件说了算（CN_FAMILY_INSTALLED_FILE），「下载」「打开」「换到 ParaRead」在测试模式里只记下来（cnScreen）。
 */
import { expect, type Page, test } from '@playwright/test'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { BUILTIN } from '@cn/family'
import { launch, leftView, type Running, tabOn } from './app'
import { LECTURE } from './fixtures/pdf'

const dlg = (page: Page) => page.getByRole('dialog', { name: '设置' })
const nav = (page: Page) => dlg(page).getByRole('navigation', { name: '设置分页' })
const card = (page: Page, name: string) => dlg(page).getByRole('group', { name, exact: true })
const toast = (page: Page) => dlg(page).getByTestId('settings-toast')
const screenLog = (run: Running) => run.app.evaluate(() => (globalThis as unknown as { cnScreen: string[] }).cnScreen.slice())
const linksFile = (run: Running) => join(run.vault, '.canvas-notes/联动.json')
const links = (run: Running) => (existsSync(linksFile(run)) ? (JSON.parse(readFileSync(linksFile(run), 'utf8')) as Record<string, boolean>) : {})

let dir = ''
test.beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cn-family-'))
})
test.afterEach(() => rmSync(dir, { recursive: true, force: true }))
const installedFile = () => join(dir, 'installed.json')
const install = (apps: Record<string, string>) => writeFileSync(installedFile(), JSON.stringify(apps))

async function openFamily(page: Page) {
  await page.keyboard.press('Meta+Comma')
  await nav(page).getByRole('button', { name: '软件家族', exact: true }).click()
  await expect(dlg(page).getByRole('heading', { name: '软件家族' })).toBeVisible()
}

test('侧栏 18 页在 740 高的弹窗里都看得见，「高级」没被挤出去、不出滚动条', async () => {
  const run = await launch({ '随手记.md': '# 随手记\n' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1200, height: 820 })
    await page.keyboard.press('Meta+Comma')
    const list = nav(page).locator('.sa-navlist')
    const pages = nav(page).locator('.si')
    await expect(pages).toHaveCount(18)
    expect(await pages.allInnerTexts()).toEqual(['一般', '外观', '首页', '文档和白板', '文件和附件', '读PDF', '网页和视频', 'AI', '梦游', '自动化', '选中小条', '库', 'Git和同步', '隐私和联网', '软件家族', '插件', '快捷键', '高级'])
    const box = (await list.boundingBox())!
    for (const b of await pages.all()) {
      const r = (await b.boundingBox())!
      expect(r.y + r.height, await b.innerText()).toBeLessThanOrEqual(box.y + box.height + 0.5)
    }
    expect(await list.evaluate((e) => e.scrollHeight - e.clientHeight)).toBeLessThanOrEqual(0)
    // 段头上下 6 / 3、页和页之间不留缝
    expect(await nav(page).locator('.sa-sec').nth(1).evaluate((e) => getComputedStyle(e).padding)).toBe('6px 10px 3px')
    expect(await list.evaluate((e) => getComputedStyle(e).rowGap)).toBe('0px')
  } finally {
    await run.close()
  }
})

test('一个都没装：联动那几行写「装了以后能开」；点「下载」开官网（测试里只记下来）、那一格变成「等你装好」；装好了再看一下，整张表闪一下、开关出来', async () => {
  install({})
  const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_FAMILY_INSTALLED_FILE: installedFile() })
  const { page } = run
  try {
    await openFamily(page)
    // 能联动的五个在前，其余四个收在下面
    expect(await dlg(page).locator('.fm-card').evaluateAll((els) => els.map((e) => e.getAttribute('data-app')))).toEqual(['canvas-today', 'pararead', 'meetcaption', 'bookmarkkeeper', 'chatcards'])
    expect(await dlg(page).locator('.fm-more .fm-row').evaluateAll((els) => els.map((e) => e.getAttribute('data-app')))).toEqual(['askfree', 'getnewword', 'typeright', 'dispatch'])
    const ct = card(page, '画布今日')
    await expect(ct.locator('.fm-link[data-row="ct-open"]')).toContainText('装了以后：待办点开能直接跳过去')
    await expect(ct.locator('.fm-link[data-row="ct-open"] .fm-val')).toHaveText('装了以后能开')
    await expect(ct.getByRole('switch')).toHaveCount(0)
    // BookmarkKeeper 没装也能去插件里设
    await expect(card(page, 'BookmarkKeeper').getByRole('button', { name: '在插件里设' })).toBeVisible()

    await ct.getByRole('button', { name: '下载' }).click()
    await expect.poll(() => screenLog(run)).toContain('用浏览器打开 https://canvas-note.us-cloud.uk/#today')
    await expect(toast(page)).toContainText('在浏览器里打开了画布今日的下载页：canvas-note.us-cloud.uk/#today')
    await expect(ct.locator('.fm-wait')).toContainText('等你装好')

    // 还没装好就点：说一句，接着等
    await ct.getByRole('button', { name: '装好了，再看一下' }).click()
    await expect(toast(page)).toContainText('还没认出画布今日：装进「应用程序」以后再点一下')
    await expect(ct.locator('.fm-wait')).toBeVisible()

    install({ 'canvas-today': '0.3.0' })
    await ct.getByRole('button', { name: '装好了，再看一下' }).click()
    await expect(toast(page)).toContainText('认出来了：画布今日 0.3.0已装，联动的开关能开了')
    await expect(ct).toHaveClass(/sa-flash/)
    await expect(ct.locator('.fm-st')).toHaveText('已装 0.3.0')
    await expect(ct.getByRole('switch', { name: '待办旁边放「在画布今日里打开」' })).toHaveAttribute('aria-checked', 'true')
    await expect(ct.locator('.fm-link[data-row="same-vault"] .sa-ds')).toHaveText('画布今日也在用「测试库」：清单里每一条就是这边笔记里的一行')
    await expect(ct.locator('.fm-link[data-row="same-vault"] .dot')).toBeVisible()
  } finally {
    await run.close()
  }
})

test('已装：「打开」打开那个 App（测试里只记下来）；拨联动开关马上写进库里的联动.json，带「撤回」；待办里的按钮跟着变', async () => {
  install({ 'canvas-today': '0.3.0', pararead: '0.1.4', dispatch: '0.9.5' })
  const run = await launch({ '收件箱/待办.md': '# 待办\n\n- [ ] 回导师邮件\n' }, { CN_FAMILY_INSTALLED_FILE: installedFile() })
  const { page } = run
  try {
    await openFamily(page)
    const ct = card(page, '画布今日')
    await ct.getByRole('button', { name: '打开' }).click()
    await expect.poll(() => screenLog(run)).toContain('打开 /Applications/canvas-today.app')
    await expect(toast(page)).toContainText('打开了画布今日')
    // 家族里还有的那几行也能打开
    await dlg(page).locator('.fm-row[data-app="dispatch"]').getByRole('button', { name: '打开' }).click()
    await expect.poll(() => screenLog(run)).toContain('打开 /Applications/dispatch.app')

    // ParaRead 写进配对笔记要等 ParaRead 0.2.0
    await expect(card(page, 'ParaRead').locator('.fm-link[data-row="pr-write"] .fm-val')).toHaveText('先更新ParaRead')

    const sw = ct.getByRole('switch', { name: '待办旁边放「在画布今日里打开」' })
    expect(existsSync(linksFile(run))).toBe(false)
    await sw.click()
    await expect(sw).toHaveAttribute('aria-checked', 'false')
    await expect.poll(() => links(run)).toEqual({ 'ct-open': false })
    expect(readFileSync(linksFile(run), 'utf8')).toBe('{\n  "ct-open": false\n}\n')
    await expect(toast(page)).toContainText('已存 · 待办里不再放「在画布今日里打开」')

    // 待办详情里不再放那个按钮
    await page.keyboard.press('Escape')
    await leftView(page, '待办')
    const detail = page.getByRole('dialog', { name: '详情' })
    await page.locator('aside.side[aria-label="待办"] .td-r .td-t', { hasText: '回导师邮件' }).click()
    await expect(detail.getByRole('button', { name: '打开笔记，到这一行' })).toBeVisible()
    await expect(detail.getByRole('button', { name: '在画布今日里打开' })).toHaveCount(0)
    await page.keyboard.press('Escape')

    // 撤回：库里那份回到开着，按钮回来
    await openFamily(page)
    await card(page, '画布今日').getByRole('switch', { name: '待办旁边放「在画布今日里打开」' }).click()
    await expect(toast(page)).toContainText('已存 · 点开待办，最下面多了「在画布今日里打开」')
    await expect.poll(() => links(run)).toEqual({ 'ct-open': true })
    await card(page, '画布今日').getByRole('switch', { name: '待办旁边放「在画布今日里打开」' }).click()
    await expect.poll(() => links(run)).toEqual({ 'ct-open': false })
    await toast(page).getByRole('button', { name: '撤回' }).click()
    await expect.poll(() => links(run)).toEqual({ 'ct-open': true })
    await expect(card(page, '画布今日').getByRole('switch', { name: '待办旁边放「在画布今日里打开」' })).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await page.locator('aside.side[aria-label="待办"] .td-r .td-t', { hasText: '回导师邮件' }).click()
    await expect(detail.getByRole('button', { name: '在画布今日里打开' })).toBeVisible()
  } finally {
    await run.close()
  }
})

test('另一个软件改了库里的联动.json（画布今日拨了、Git 拉下来）：开着的家族页一两秒内跟着变', async () => {
  install({ 'canvas-today': '0.3.0' })
  const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_FAMILY_INSTALLED_FILE: installedFile() })
  const { page } = run
  try {
    await openFamily(page)
    const sw = card(page, '画布今日').getByRole('switch', { name: '待办旁边放「在画布今日里打开」' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    mkdirSync(dirname(linksFile(run)), { recursive: true })
    writeFileSync(linksFile(run), '{\n  "cn-open": false,\n  "ct-open": false\n}\n')
    await expect(sw).toHaveAttribute('aria-checked', 'false', { timeout: 5000 })
    // 别的软件的开关原样留着
    await sw.click()
    await expect.poll(() => links(run)).toEqual({ 'cn-open': false, 'ct-open': true })
  } finally {
    await run.close()
  }
})

test('「在插件里设 ›」翻到插件页的书签管家、闪一下；搜「家族」「ParaRead」都到这一页', async () => {
  install({})
  const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_FAMILY_INSTALLED_FILE: installedFile() })
  const { page } = run
  try {
    await openFamily(page)
    await card(page, 'BookmarkKeeper').getByRole('button', { name: '在插件里设' }).click()
    await expect(nav(page).getByRole('button', { name: '插件', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(dlg(page).locator('[data-row="plBook"]')).toHaveClass(/sa-flash/)

    const search = dlg(page).getByRole('textbox', { name: '搜设置' })
    await search.fill('ParaRead')
    await expect(dlg(page).getByRole('list', { name: '搜到的设置' })).toContainText('软件家族 › 能和画布笔记接上的')
    await search.press('Enter')
    await expect(dlg(page).getByRole('heading', { name: '软件家族' })).toBeVisible()
    await expect(card(page, 'ParaRead')).toHaveClass(/sa-flash/)
    await search.fill('家族')
    await expect(dlg(page).getByRole('list', { name: '搜到的设置' }).getByRole('listitem')).not.toHaveCount(0)
    await search.fill('下载')
    await expect(dlg(page).getByRole('list', { name: '搜到的设置' })).toContainText('Dispatch')
  } finally {
    await run.close()
  }
})

test('装了 ParaRead：PDF「⋯」里有「在ParaRead里读（双语）」，点了用 ParaRead 打开这份；家族页里关了就不放', async () => {
  install({ pararead: '0.1.4' })
  const run = await launch({ '课程/第3讲 线性映射.pdf': LECTURE }, { CN_FAMILY_INSTALLED_FILE: installedFile() })
  const { page } = run
  const more = () => page.getByTestId('tab-acts').getByRole('button', { name: '更多' })
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await more().click()
    await page.getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: '在ParaRead里读（双语）' }).click()
    await expect.poll(() => screenLog(run)).toContain('用 ParaRead 打开 课程/第3讲 线性映射.pdf')

    await openFamily(page)
    await card(page, 'ParaRead').getByRole('switch', { name: 'PDF的「⋯」里放「在ParaRead里读（双语）」' }).click()
    await expect(toast(page)).toContainText('已存 · PDF的「⋯」里不再放ParaRead')
    await expect.poll(() => links(run)).toEqual({ 'pr-menu': false })
    await page.keyboard.press('Escape')
    await more().click()
    await expect(page.getByRole('menu', { name: '更多' })).toContainText('在访达中显示')
    await expect(page.getByRole('menu', { name: '更多' }).getByRole('menuitem', { name: '在ParaRead里读（双语）' })).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('没装 ParaRead：PDF「⋯」最下面顺手提一句，点了到设置 › 软件家族的 ParaRead 那张表；点 × 以后不再提（重开软件也不提）', async () => {
  install({})
  const run = await launch({ '课程/第3讲 线性映射.pdf': LECTURE }, { CN_FAMILY_INSTALLED_FILE: installedFile() })
  const { page } = run
  const more = () => page.getByTestId('tab-acts').getByRole('button', { name: '更多' })
  const menu = () => page.getByRole('menu', { name: '更多' })
  try {
    await page.keyboard.press('Meta+k')
    await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('第3讲')
    await page.locator('.pal-row', { hasText: '第3讲 线性映射' }).first().click()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await more().click()
    await expect(menu().getByRole('menuitem', { name: '在ParaRead里读（双语）' })).toHaveCount(0)
    await menu().getByRole('menuitem', { name: '想原文下面跟着译文读：ParaRead' }).click()
    await expect(dlg(page).getByRole('heading', { name: '软件家族' })).toBeVisible()
    await expect(card(page, 'ParaRead')).toHaveClass(/sa-flash/)
    await page.keyboard.press('Escape')
    await more().click()
    await menu().getByRole('button', { name: '不再提ParaRead' }).click()
    await expect(page.getByTestId('pararead-tip')).toHaveCount(0)
    await page.reload()
    await expect(tabOn(page)).toHaveText('第3讲 线性映射.pdf')
    await more().click()
    await expect(menu()).toContainText('在访达中显示')
    await expect(page.getByTestId('pararead-tip')).toHaveCount(0)
  } finally {
    await run.close()
  }
})

test('名单每天从总站看一次：总站加了新软件，不用发版就出现在「家族里还有」；隐私和联网里关了只用带的那份', async () => {
  install({})
  const remote = {
    ...BUILTIN,
    updated: '2099-01-01',
    apps: [...BUILTIN.apps, { id: 'newapp', name: { zh: '新软件' }, one: { zh: '总站上刚加的一个软件。' }, icon: 'newapp.png', download: 'https://new.example' }],
  }
  let hits = 0
  const srv = createServer((_req, res) => {
    hits++
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(remote))
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/family.json`
  const run = await launch({ '随手记.md': '# 随手记\n' }, { CN_FAMILY_INSTALLED_FILE: installedFile(), CN_FAMILY_URL: url })
  const { page } = run
  try {
    await expect.poll(() => hits).toBe(1)
    await openFamily(page)
    await expect(dlg(page).locator('.fm-row[data-app="newapp"]')).toContainText('新软件总站上刚加的一个软件。')
    await expect(dlg(page).locator('.fm-note')).toContainText(/名单每天从apps\.us-cloud\.uk看一次有没有新软件（上次 今天 \d\d:\d\d），没网时用软件里带的那份。/)
    expect(JSON.parse(readFileSync(join(run.userData, 'family.json'), 'utf8')).list.apps.at(-1).id).toBe('newapp')

    await nav(page).getByRole('button', { name: '隐私和联网', exact: true }).click()
    const sw = dlg(page).locator('[data-row="netFamily"]').getByRole('switch', { name: '每天看一次家族名单' })
    await expect(sw).toHaveAttribute('aria-checked', 'true')
    await sw.click()
    await expect(toast(page)).toContainText('已存 · 不再去总站看家族名单，只用软件里带的那份')
    await expect.poll(() => JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8')).familyFetch).toBe(false)
    await nav(page).getByRole('button', { name: '软件家族', exact: true }).click()
    await expect(dlg(page).locator('.fm-note')).toContainText('名单只用软件里带的那份（隐私和联网里关了每天看一次）。')
  } finally {
    await run.close()
    srv.close()
  }
})
