/**
 * cmdk 方案 A 的并排对照截图（只在给了 CN_CMDK_SHOTS=<目录> 时跑）：照小样 design/cmdk/proto-a.html 的点法一步步点真软件，
 * 每一步从主进程截整个窗口（屏幕外窗口里的 webview 只有这样截得对）。CN_SHOT_TONE=dark 时换成深色（深湖），文件名带 -dark。
 * 小样画的是 B 浮岛书桌 + 天青（深色是深湖），窗口 1440×887。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { launch, rail, type Running } from './app'

const DIR = process.env.CN_CMDK_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在给了 CN_CMDK_SHOTS 时截图')

let server: Server
let base = ''
test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8')
    const a = (s: string, t = s.replace(/_/g, ' ')) => `<a href="/wiki/${s}" style="color:#3366cc;text-decoration:none">${t}</a>`
    res.end(`<title>Geography of Iceland - Wikipedia</title><body style="font:14px Georgia,serif;padding:18px 22px;margin:0;background:#fff;color:#202122">
      <div style="font:22px Georgia,serif;margin-bottom:12px">WIKIPEDIA</div><h1 style="font:400 26px Georgia,serif;border-bottom:1px solid #ccc;margin:0 0 4px">Geography of Iceland</h1>
      <p style="font:12px sans-serif;color:#888">From Wikipedia, the free encyclopedia</p>
      <p>${a('Iceland')} is an ${a('Island_country', 'island country')} at the confluence of the ${a('Atlantic_Ocean', 'North Atlantic')} and ${a('Arctic_Ocean', 'Arctic')} oceans, east of ${a('Greenland')} and immediately south of the ${a('Arctic_Circle', 'Arctic Circle')}…</p></body>`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
test.afterAll(() => server.close())

const W = (s: string) => `https://en.wikipedia.org/wiki/${s}`
const L = (t: string, s: string) => `[${t}](${W(s)})`
const ICELAND = `---
created: 2026-11-21T11:59:00+01:00
source: https://en.wikipedia.org/wiki/Geography_of_Iceland
---
# Geography of Iceland

—— ${L('Geography of Iceland', 'Geography_of_Iceland')} · Contributors to Wikimedia projects

${L('Iceland', 'Iceland')} is an ${L('island country', 'Island_country')} at the confluence of the ${L('North Atlantic', 'Atlantic_Ocean')} and ${L('Arctic', 'Arctic_Ocean')} oceans, east of ${L('Greenland', 'Greenland')} and immediately south of the ${L('Arctic Circle', 'Arctic_Circle')}, atop the ${L('constructive boundary', 'Divergent_boundary')} of the northern ${L('Mid-Atlantic Ridge', 'Mid-Atlantic_Ridge')}. The island country is the world's ${L('18th largest in area', 'List_of_island_countries')} and one of the most ${L('sparsely populated', 'List_of_countries_by_population_density')}. It is the westernmost European country when not including Greenland and has more land covered by ${L('glaciers', 'Glacier')} than ${L('continental Europe', 'Continental_Europe')}. Its total size is 103,125 km2 (39,817 mi2) and possesses an ${L('exclusive economic zone', 'Exclusive_economic_zone')} of 751,345 km2 (290,096 mi2).

## Statistics

${L('Dettifoss', 'Dettifoss')}, located in northeast Iceland, is the second-largest ${L('waterfall in Europe', 'List_of_waterfalls')} in terms of volume discharge. Population figures here come from [Statistics Iceland](https://www.statice.is/), and long-term climate records from the [Icelandic Met Office](https://en.vedur.is/).
`
const FILES: Record<string, string> = {
  '收件箱/Geography of Iceland.md': ICELAND,
  '收件箱/第一条.md': '# 第一条\n\n剪藏来的网页先放这里，梦游时归类。\n',
  '课程/ecp/Lecture05 笔记.md': '# Lecture05 笔记\n\n第3讲的字幕和视频对不上，记下时间点再同步一次；首页的进度条也要改。\n',
  '课程/study project/说明.md': '# 说明\n\n课程说明。\n',
  '课程/study project 2/说明.md': '# 说明\n\n课程说明。\n',
  '项目/未命名数据库/说明.md': '# 说明\n\n项目说明。\n',
  '周记/2026-W47.md': '# 2026-W47\n\n这周把库同步到新电脑；ecp 的作业周五交，首页放了倒计时。\n',
  '写作/同步和备份怎么做.md': '# 同步和备份怎么做\n\nGit 推到远程仓库，每晚自动同步一次，冲突时留两份。\n',
  '生活/冰岛旅游 2.md': '# 冰岛旅游 2\n\n把 Kirkjufell 那张设成首页封面；冰川徒步要提前订。\n',
}

const pal = (page: Page) => page.getByRole('dialog', { name: '搜索和命令' })
const row = (page: Page, name: string) => pal(page).locator('.pal-row').filter({ has: page.locator('.nm', { hasText: new RegExp(`^${name}$`) }) }).first()
const menu = (page: Page) => page.getByRole('menu').filter({ has: page.locator('.pal-mhead') })

/** 交付页「在哪」标注图要的框（窗口坐标，CSS 像素） */
const boxes: Record<string, { x: number; y: number; width: number; height: number } | null> = {}
async function mark(page: Page, name: string, sel: string) {
  boxes[name] = await page.locator(sel).first().boundingBox()
}

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(350)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `real-${name}${DARK ? '-dark' : ''}.png`), Buffer.from(b64, 'base64'))
}

test('照小样的点法截真软件', async () => {
  test.setTimeout(180_000)
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(FILES)
  const { page, app } = run
  try {
    await page.evaluate((dark) => window.cn.setSettings({ appearance: { followSystem: false, skin: dark ? 'petrol' : 'sky' } }), DARK)
    await page.reload()
    await page.locator('.vault b').waitFor()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await page.waitForTimeout(400)
    // 右栏开着维基那一页，中间开着剪藏来的那篇（小样的样子）
    await rail(page).getByRole('button', { name: '网页' }).click()
    const web = page.getByRole('complementary', { name: '网页' })
    await web.getByRole('textbox', { name: '网址' }).fill(`${base}/wiki/Geography_of_Iceland`)
    await web.getByRole('textbox', { name: '网址' }).press('Enter')
    await expect(web.locator('webview.on')).toBeVisible()
    await page.keyboard.press('Meta+o')
    await page.getByRole('dialog', { name: '按名字跳到' }).getByRole('textbox').fill('Geography of Iceland')
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('tab-on')).toContainText('Geography of Iceland')
    await page.waitForTimeout(600)

    // 1 ⌘K 没打字
    await page.keyboard.press('Meta+k')
    await expect(pal(page)).toBeVisible()
    await page.mouse.move(5, 5)
    await shot(run, '01-palette')
    await mark(page, 'groups', '.pal-list')
    // 5 ⋯ 开菜单，指着「挪到」
    const sync = row(page, '同步')
    await sync.scrollIntoViewIfNeeded()
    await sync.hover()
    await sync.locator('.pal-more').click()
    await menu(page).getByRole('menuitem', { name: '挪到' }).hover()
    await shot(run, '05-move-sub')
    await mark(page, 'palette', '.pal')
    await mark(page, 'menu', '.pal-menu:not(.pal-sub)')
    await mark(page, 'sub', '.pal-sub')
    await mark(page, 'pinGroup', '.pal-sec[data-g="pin"]')
    // 6 钉住
    await menu(page).getByRole('menuitem', { name: /^钉住/ }).hover()
    await menu(page).getByRole('menuitem', { name: /^钉住/ }).click()
    await shot(run, '06-pinned-toast')
    // 8 设快捷键：按 ⌘N 撞了新建笔记
    await row(page, '同步').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: /设快捷键/ }).click()
    await page.keyboard.press('Meta+n')
    await shot(run, '08-keys-clash')
    await page.keyboard.press('Escape')
    // 10 起别名 tb
    await row(page, '同步').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: /起别名/ }).click()
    await page.keyboard.type('tb')
    await page.keyboard.press('Enter')
    await shot(run, '10-alias-done')
    // 跑一次「同步」（小样里同步是最近用过的）：之后搜它，「最合适」后面写「· 最近用过」
    await pal(page).getByRole('textbox').fill('tb')
    await page.waitForTimeout(500)
    await page.keyboard.press('Enter')
    await expect(pal(page)).toHaveCount(0)
    await page.keyboard.press('Meta+k')
    await expect(pal(page)).toBeVisible()
    // 12 藏起归档，展开藏着的
    await row(page, '归档').click({ button: 'right' })
    await menu(page).getByRole('menuitem', { name: /藏起/ }).click()
    await row(page, '藏着的 1 条').scrollIntoViewIfNeeded()
    await row(page, '藏着的 1 条').click()
    await page.waitForTimeout(200)
    await shot(run, '12-hidden-open')
    // 13 / 14 搜别名、搜同步
    const box = pal(page).getByRole('textbox')
    await box.fill('tb')
    await page.waitForTimeout(600)
    await shot(run, '13-search-alias')
    await box.fill('同步')
    await page.waitForTimeout(900)
    await shot(run, '14-search-sync')
    await box.fill('')
    // 16 加一条自己的命令
    await row(page, '加一条自己的命令…').scrollIntoViewIfNeeded()
    await row(page, '加一条自己的命令…').click()
    await shot(run, '16-form')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(pal(page)).toHaveCount(0)
    // 17 拖「找重复」到「让AI做」
    await page.keyboard.press('Meta+k')
    const dup = row(page, '找重复')
    await dup.scrollIntoViewIfNeeded()
    await dup.hover()
    const g = (await dup.locator('.pal-grip').boundingBox())!
    await page.mouse.move(g.x + 5, g.y + 5)
    await page.mouse.down()
    await page.mouse.move(g.x + 5, g.y - 40, { steps: 5 })
    const art = row(page, '写成文章')
    const a = (await art.boundingBox())!
    await page.mouse.move(a.x + 100, a.y + a.height - 6, { steps: 10 })
    await shot(run, '17-dragging')
    await page.mouse.up()
    await page.keyboard.press('Escape')
    await expect(pal(page)).toHaveCount(0)
    // 19 / 20 网页「⋯」和调整
    await web.getByRole('button', { name: '更多', exact: true }).click()
    await shot(run, '19-webmenu')
    await mark(page, 'webmenu', '.menu.wmore')
    await mark(page, 'source', '.pane:not([hidden]) .cm-meta-src')
    await mark(page, 'links', '.pane:not([hidden]) .cm-line:has-text("island country")')
    await web.getByRole('menu', { name: '更多', exact: true }).getByRole('menuitem', { name: '调整这个菜单…' }).click()
    await shot(run, '20-webmenu-edit')
    await page.keyboard.press('Escape')
    // 23 指着链接出卡
    const link = page.locator('.pane:not([hidden]) .cm-link', { hasText: 'Arctic Circle' })
    await link.hover()
    await expect(page.getByRole('dialog', { name: '链接' })).toBeVisible()
    await shot(run, '23-linkcard')
    await mark(page, 'card', '.lk-card')
    writeFileSync(join(DIR!, `boxes${DARK ? '-dark' : ''}.json`), JSON.stringify(boxes, null, 1))
  } finally {
    await run.close()
  }
})
