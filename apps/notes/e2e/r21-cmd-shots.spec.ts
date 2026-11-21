// 并排对照图（task-9womr）：左边小样 proto-c2.html、右边软件，同一个状态、同一个窗口（1440×887），浅色天青、深色深湖各一套：
// 文档里打 /（我的命令在最上面）、视频里打 /（我的命令写「在这里用不了」）、按 9 次 ↓ 滚下去；
// 小样没有的三处只截软件：右键往下挪以后底栏那一句（app-slash-toast-*）、打一个字筛（app-slash-filter-*）、跑自己的命令先给你看（app-proposal-*）。
// 平时跳过：CN_SHOTS=<目录> npx playwright test e2e/r21-cmd-shots.spec.ts（小样路径 CN_PROTO，默认 canvas-notes-commands/v2）。
import { chromium, expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openAi, rail, type Running, tabOn } from './app'
import { skinned } from './fixtures/book-digest'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'

const SHOTS = process.env.CN_SHOTS
const PROTO = process.env.CN_PROTO ?? '/private/tmp/canvas-notes-commands/v2/proto-c2.html'
test.skip(!SHOTS, '截对照图才跑：CN_SHOTS=<目录>')
test.setTimeout(5 * 60_000)

/** 这台 Mac 上装着的无头 Chromium（Playwright 自己那份没下的时候用；CN_CHROMIUM 能换） */
const CHROMIUM = { ...(process.env.CN_CHROMIUM ? { executablePath: process.env.CN_CHROMIUM } : {}) }
const W = 1440
const H = 887
const LECTURE = '# 第2讲 预备知识\n\n## 张量\n\n张量就是多维数组，矩阵是两个轴的张量。\n\n## 广播\n\n形状不同时自动扩展。\n'
const MINE = { version: 1, own: [{ id: 'own-tidy', name: '整理成通顺笔记', kind: 'ai', target: '1. 分节', rules: [{ t: '按书的章节分节，每节一个「##」小标题' }], where: ['doc'], write: 'inplace', desc: '照「学习笔记」4 轮前后的对比提炼，每次先给你看' }] }

/** 整个窗口截下来（右栏网页也在里面） */
async function winShot(run: Running): Promise<Buffer> {
  await run.page.waitForTimeout(300)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  return Buffer.from(b64, 'base64')
}

/** 左小样、右软件拼成一张（上面一行写哪边是哪边） */
async function pair(name: string, left: Buffer, right: Buffer) {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: W * 2 + 24, height: H + 40 } })
  const img = (x: Buffer) => `data:image/png;base64,${x.toString('base64')}`
  await p.setContent(`<body style="margin:0;background:#888;font:14px -apple-system"><div style="display:flex;gap:24px"><div><div style="height:32px;line-height:32px;color:#fff;padding-left:8px">小样 proto-c2.html</div><img src="${img(left)}" style="width:${W}px;height:${H}px;display:block"></div><div><div style="height:32px;line-height:32px;color:#fff;padding-left:8px">软件</div><img src="${img(right)}" style="width:${W}px;height:${H}px;display:block"></div></div></body>`)
  await p.waitForTimeout(200)
  writeFileSync(join(SHOTS!, `${name}.png`), await p.screenshot({ fullPage: true }))
  await b.close()
}

/** 小样：存好那一条，换到某处打 /（ctx：doc、video）；down：按几次 ↓ */
async function protoShot(dark: boolean, ctx: 'doc' | 'video', down = 0): Promise<Buffer> {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: W, height: H } })
  await p.goto(`file://${PROTO}#theme=${dark ? 'dark' : 'light'}`)
  await p.click('[data-act="save"]')
  await p.click(`[data-ctx="${ctx}"]`)
  for (let i = 0; i < down; i++) await p.keyboard.press('ArrowDown')
  // 小样里演示用的切换条、提示条不算
  await p.addStyleTag({ content: '.proto,.toast{display:none!important}' })
  await p.waitForTimeout(200)
  const shot = await p.screenshot()
  await b.close()
  return shot
}

const box = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' }).getByRole('textbox', { name: '问 AI' })

for (const dark of [false, true]) {
  const tone = dark ? 'dark' : 'light'
  test(`/ 菜单对照（${tone}）：文档里、按 9 次 ↓、视频里`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const { server, base } = await startFakeVideoSite()
    const run = await launch({ '课程/study project/第2讲 预备知识.md': LECTURE, '课程/study project/学习笔记.md': LECTURE, '.canvas-notes/命令.json': JSON.stringify(MINE) }, { CN_AI_FAKE: '1', CN_VIDEO_TEST_ORIGIN: base }, skinned(dark ? 'petrol' : 'sky'))
    const { page, app } = run
    try {
      await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setContentSize(s.w, s.h), { w: W, h: H })
      await page.keyboard.press('Meta+k')
      await page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' }).fill('学习笔记')
      await page.locator('.pal-row', { has: page.locator('.nm', { hasText: /^学习笔记$/ }) }).first().click()
      await expect(tabOn(page)).toHaveText('学习笔记')
      await openAi(page)
      await box(page).click()
      await page.keyboard.type('/')
      await expect(page.getByTestId('slash-menu')).toBeVisible()
      await pair(`slash-doc-${tone}`, await protoShot(dark, 'doc'), await winShot(run))
      for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowDown')
      await pair(`slash-down9-${tone}`, await protoShot(dark, 'doc', 9), await winShot(run))
      // 小样没画的三处只截软件：右键往下挪以后底栏那一句、打一个字筛、先给你看
      const sm = page.getByTestId('slash-menu')
      await sm.locator('.it:has(.n:text-is("截图转成文字"))').click({ button: 'right' })
      await page.getByRole('menu', { name: '截图转成文字' }).getByRole('menuitem', { name: '往下挪' }).click()
      await expect(sm.locator('.ft .sl-toast')).toContainText('往下挪了一格')
      writeFileSync(join(SHOTS!, `app-slash-toast-${tone}.png`), await winShot(run))
      await sm.locator('.ft .sl-toast').getByRole('button', { name: '撤回' }).click()
      await expect(sm.locator('.it:not(.put) .n').nth(1)).toHaveText('截图转成文字')
      await box(page).click()
      await page.keyboard.press('End')
      await page.keyboard.type('题')
      await expect(page.getByTestId('slash-menu').locator('.it')).toHaveCount(1)
      writeFileSync(join(SHOTS!, `app-slash-filter-${tone}.png`), await winShot(run))
      await box(page).fill('')
      await page.keyboard.type('/')
      await page.keyboard.press('Enter')
      await expect(page.getByTestId('proposal-bar')).toBeVisible({ timeout: 15_000 })
      writeFileSync(join(SHOTS!, `app-proposal-${tone}.png`), await winShot(run))
      await page.getByTestId('proposal-bar').getByRole('button', { name: '不要' }).click()
      await expect(page.getByTestId('proposal-bar')).toHaveCount(0)
      // 视频：右栏网页开着视频时 AI 是边读边问那一格
      await rail(page).getByRole('button', { name: '网页' }).click()
      const web = page.getByRole('complementary', { name: '网页' })
      await web.getByRole('textbox', { name: '网址' }).fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
      await web.getByRole('textbox', { name: '网址' }).press('Enter')
      await expect(web.getByRole('region', { name: '视频条' })).toBeVisible({ timeout: 15_000 })
      await openAi(page)
      const rbox = page.getByRole('complementary', { name: '边读边问 AI' }).getByRole('textbox', { name: '问 AI' })
      await rbox.click()
      await page.keyboard.type('/')
      await expect(page.getByTestId('slash-menu')).toBeVisible()
      await pair(`slash-video-${tone}`, await protoShot(dark, 'video'), await winShot(run))
    } finally {
      await run.close()
      server.close()
    }
  })
}
