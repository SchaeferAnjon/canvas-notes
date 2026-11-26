/**
 * A2 弹框点外面就关（偏好「弹框点外面就关」）：清单里每个弹层，打开 → 点空白处关；再打开 → Esc 关；再打开 → 点网页（webview）/ 编辑器 / 白板画布关。
 * 网页里的按下、Esc 不冒泡到软件窗口（以前字幕设置、记到哪、视频问 AI 的小框点视频关不掉，图10、图13）；
 * 白板画布、编辑器自己拦了 mousedown 的，冒泡阶段听 mousedown 的弹层也关不掉。现在全走公共的 useDismiss / dismissable。
 * 真点、真按键；一律无头（CN_E2E=1）、假 AI；视频站是本机假的（fixtures/fake-video.ts）。
 */
import { expect, test, type Locator, type Page } from '@playwright/test'
import type { Server } from 'node:http'
import { launch, openAi, openNote, pane, rail, type Running } from './app'
import { openBoard } from './fixtures/board-doc'
import { FAKE_VIDEO_ID, startFakeVideoSite } from './fixtures/fake-video'
import { BOOK_PAGE, feynmanFiles } from './fixtures/feynman'
import { feynmanVault } from './fixtures/feynman-after'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

let server: Server
let base: string
test.beforeAll(async () => {
  ;({ server, base } = await startFakeVideoSite())
})
test.afterAll(() => server.close())

const web = (page: Page) => page.getByRole('complementary', { name: '网页' })
const strip = (page: Page) => web(page).getByRole('region', { name: '视频条' })
const guest = (page: Page, code: string): Promise<unknown> =>
  page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
const box = async (l: Locator) => (await l.boundingBox())!

type Where = 'webview' | 'editor' | 'board' | 'pane'

/** 一个弹层：怎么打开、开着时认它的那块、第三步点哪些地方（默认点网页和编辑器） */
interface Pop {
  name: string
  open(page: Page): Promise<void>
  shown(page: Page): Locator
  /** 第三步点哪些地方（每一处都重新打开一次） */
  away?: Where[]
  /** 打开前先摆好（换到白板、换到别的标签） */
  before?(page: Page): Promise<void>
}

/** 空白处：左栏文件树下面没有东西的地方 */
async function clickBlank(page: Page) {
  const side = await box(page.locator('aside.side'))
  await page.mouse.click(side.x + side.width / 2, side.y + side.height - 60)
}
async function clickAway(page: Page, where: Where) {
  if (where === 'webview') {
    // 视频下面的说明文字那一片（网页里真按下鼠标，宿主窗口收不到 pointerdown）
    const wv = await box(web(page).locator('webview.on'))
    await page.mouse.click(wv.x + wv.width / 2, wv.y + wv.height - 40)
  } else if (where === 'editor') {
    // 第一行靠右那头（靠左可能正被弹层盖着，比如「新建」）
    const c = await box(pane(page).locator('.cm-content'))
    await page.mouse.click(c.x + c.width - 30, c.y + 10)
  } else if (where === 'board') {
    const b = await box(pane(page).locator('[data-testid="doc-board"]').first())
    await page.mouse.click(b.x + b.width - 60, b.y + b.height - 60)
  } else {
    // 中间这一页（导图、白板）右下角空处
    const b = await box(pane(page))
    await page.mouse.click(b.x + b.width - 40, b.y + b.height - 40)
  }
}

/** 测一个弹层的每一步，每步记「关 / 没关」；没关的那一步之后想办法收掉（Esc、点它的按钮），接着测下一步 */
async function check(page: Page, p: Pop, fails: string[]) {
  const row: string[] = []
  await p.before?.(page)
  const step = async (how: string, act: () => Promise<void>) => {
    if (!(await p.shown(page).count())) await p.open(page)
    await expect(p.shown(page), `${p.name}：打开`).toBeVisible()
    await act()
    const closed = await expect(p.shown(page))
      .toHaveCount(0, { timeout: 1500 })
      .then(() => true)
      .catch(() => false)
    row.push(`${how}${closed ? '关' : '没关'}`)
    if (closed) return
    fails.push(`${p.name}：${how}没关`)
    await page.keyboard.press('Escape')
    if (await p.shown(page).count()) await clickBlank(page)
    if (await p.shown(page).count()) await p.open(page)
  }
  await step('点空白处', () => clickBlank(page))
  await step('Esc', () => page.keyboard.press('Escape'))
  for (const w of p.away ?? ['webview', 'editor']) await step(w === 'webview' ? '点网页' : w === 'editor' ? '点编辑器' : w === 'board' ? '点白板画布' : '点这一页空处', () => clickAway(page, w))
  return `${p.name}：${row.join('，')}`
}

async function setup(run: Running) {
  const { page } = run
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900))
  await openNote(page, '看视频的笔记')
  await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(`${base}/watch?v=${FAKE_VIDEO_ID}`)
  await addr.press('Enter')
  await expect(strip(page)).toBeVisible({ timeout: 15_000 })
  await guest(page, `(() => { const v = document.querySelector('video'); v.currentTime = 6; v.pause(); return true })()`)
}

const POPS: Pop[] = [
  // 图10：字幕设置面板
  {
    name: '字幕设置',
    open: (page) => strip(page).getByRole('button', { name: '字幕', exact: true }).click(),
    shown: (page) => web(page).locator('.vmenu').filter({ hasText: '双语' }),
  },
  // 图13：记到哪
  {
    name: '记到哪（视频条）',
    open: (page) => strip(page).locator('.vdest').click(),
    shown: (page) => web(page).getByRole('menu', { name: '记到哪' }),
  },
  {
    name: 'N 个时刻',
    open: (page) => strip(page).locator('.vcount').click(),
    shown: (page) => web(page).locator('.vmenu').filter({ hasText: '时刻' }),
  },
  // 视频框选问 AI 的小框
  {
    name: '视频问 AI 小框',
    open: async (page) => {
      await pane(page).locator('.cm-content').click({ position: { x: 40, y: 8 } })
      await page.keyboard.press('Alt+KeyD')
      await expect.poll(() => guest(page, `!!document.getElementById('cn-video-host').shadowRoot.querySelector('.box')`)).toBe(true)
      const wv = await box(web(page).locator('webview.on'))
      await page.mouse.move(wv.x + 40, wv.y + 30)
      await page.mouse.down()
      await page.mouse.move(wv.x + 200, wv.y + 120, { steps: 6 })
      await page.mouse.up()
    },
    shown: (page) => web(page).getByRole('dialog', { name: '问 AI' }),
  },
  // 右栏网页的「⋯」（WebPanel 那一套，以前自己听网页报来的按下）
  {
    name: '网页「⋯」',
    open: (page) => web(page).getByRole('button', { name: '更多', exact: true }).click(),
    shown: (page) => web(page).getByRole('menu', { name: '更多', exact: true }),
  },
  // 标题栏「新建 ⌄」：shell 的 Popover（移到…、换图标、库、改动、同步这些都是它；以前冒泡阶段听 mousedown，白板、编辑器拦了就关不掉）
  {
    name: '新建（shell Popover）',
    open: (page) => page.locator('.titlebar').getByRole('button', { name: '新建白板、数据库…' }).click(),
    shown: (page) => page.getByRole('dialog', { name: '新建', exact: true }),
  },
  // 编辑器块把手的块菜单（不是 React 画的，dismissable）
  {
    name: '块菜单',
    open: async (page) => {
      const para = pane(page).locator('.cm-content .cm-line').filter({ hasText: '我先写的一句' })
      await expect(async () => {
        const b = (await para.boundingBox())!
        await page.mouse.move(b.x + 40, b.y + 8)
        await page.mouse.move(b.x + 60, b.y + 10)
        await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click({ timeout: 1000 })
        await expect(page.getByRole('menu', { name: '块菜单' })).toBeVisible({ timeout: 1000 })
      }).toPass({ timeout: 10_000 })
    },
    shown: (page) => page.getByRole('menu', { name: '块菜单' }),
  },
  // 表格把手的行菜单（不是 React 画的，dismissable；以前 Esc 只在焦点在菜单上时管用）
  {
    name: '表格行菜单',
    open: async (page) => {
      const tbl = pane(page).locator('[data-part="表格"]').first()
      await tbl.locator('[data-row="1"][data-col="1"]').hover()
      await pane(page).locator('.tbl-rgrip').click()
    },
    shown: (page) => page.getByRole('menu', { name: '行菜单' }),
  },
  // 编辑器块把手旁「+」开的插入菜单（不是 React 画的，slash-menu.tsx）
  {
    name: '编辑器「+」插入菜单',
    open: async (page) => {
      const para = pane(page).locator('.cm-content .cm-line').filter({ hasText: '后面一段' })
      await expect(async () => {
        const b = (await para.boundingBox())!
        await page.mouse.move(b.x + 40, b.y + 8)
        await page.mouse.move(b.x + 60, b.y + 10)
        await pane(page).locator('.blk-bar:not([hidden]) .blk-add').click({ timeout: 1000 })
        await expect(page.locator('.ed-pop.slash-pop:not([hidden])')).toBeVisible({ timeout: 1000 })
      }).toPass({ timeout: 10_000 })
    },
    shown: (page) => page.locator('.ed-pop.slash-pop:not([hidden])'),
  },
  // 编辑器里打「/」弹出的菜单：在最后那一行空行打（点外面以后打的「/」不留）
  {
    name: '编辑器打「/」的菜单',
    // 第三步只点网页：点编辑器别的行本来就是「光标离开那一行」，换了地方打字，不算点外面
    away: ['webview'],
    open: async (page) => {
      // 「后面一段。」末尾回车起一个空行，在行首打「/」
      await pane(page).locator('.cm-content .cm-line').filter({ hasText: '后面一段' }).click()
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')
      await page.keyboard.type('/')
      await expect(page.locator('.ed-pop.slash-pop:not([hidden])')).toBeVisible()
    },
    shown: (page) => page.locator('.ed-pop.slash-pop:not([hidden])'),
  },
]

/** 白板上的弹层：第三步点网页和白板画布 */
const BOARD_POPS: Pop[] = [
  {
    name: '白板收件箱',
    open: (page) => pane(page).getByTestId('db-inbox').click(),
    shown: (page) => pane(page).locator('.db-inbox-pop'),
    away: ['webview', 'board'],
  },
  {
    name: '放一张数据库卡',
    open: (page) => pane(page).locator('.bpal [data-kind="base"]').click(),
    shown: (page) => page.getByRole('menu', { name: '放一张数据库卡' }),
    away: ['webview', 'board'],
  },
]

/** AI 那一格里的：开了 AI 以后右栏换成 AI，第三步只点编辑器 */
const AI_POPS: Pop[] = [
  {
    name: 'AI 引擎菜单',
    open: (page) => page.getByRole('button', { name: '选 AI 引擎' }).first().click(),
    shown: (page) => page.getByRole('menu', { name: 'AI 引擎' }),
    away: ['editor'],
  },
  {
    name: 'AI 输入框「/」命令',
    open: async (page) => {
      const box = page.getByRole('textbox', { name: '问 AI' }).first()
      await box.fill('')
      await box.type('/')
    },
    shown: (page) => page.getByTestId('slash-menu'),
    away: ['editor'],
  },
]

const NOTE = '# 看视频的笔记\n\n我先写的一句。\n\n| 城市 | 人口 |\n|---|---|\n| 雷克雅未克 | 14 万 |\n| 阿克雷里 | 2 万 |\n\n后面一段。\n'

const BOARD = `---
type: board
---
# 白板

## 出发前

- [ ] 租四驱车

11 月白天只有 6 个小时左右。

## 住哪

南岸在维克住两晚。
`

test('A2 弹框点外面就关：清单里每个弹层点空白处、按 Esc、点网页 / 编辑器 / 白板画布都关', async () => {
  test.setTimeout(600_000)
  const run = await launch(
    { '看视频的笔记.md': NOTE, '白板.md': BOARD },
    { CN_AI_FAKE: '1', CN_AI_FAKE_DELAY_MS: '60', CN_VIDEO_TEST_ORIGIN: base },
  )
  const { page } = run
  const log: string[] = []
  const fails: string[] = []
  const all = async (list: Pop[]) => {
    for (const p of list) {
      try {
        log.push(await check(page, p, fails))
      } catch (e) {
        fails.push(`${p.name}：${String((e as Error).message).split('\n')[0]}`)
        log.push(`${p.name}：没测完`)
        await page.keyboard.press('Escape')
      }
    }
  }
  try {
    await setup(run)
    await all(POPS)
    // 叠着的两层：视频问框里再开「记进…」菜单，Esc 先收菜单、问框留着；点外面（网页）两层一起收
    try {
      await POPS.find((p) => p.name === '视频问 AI 小框')!.open(page)
      const ask = web(page).getByRole('dialog', { name: '问 AI' })
      await expect(ask).toBeVisible()
      await ask.locator('button.ak-dst').click()
      await expect(page.getByRole('menu', { name: '记到哪' })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu', { name: '记到哪' })).toHaveCount(0)
      await expect(ask).toBeVisible()
      await ask.locator('button.ak-dst').click()
      await expect(page.getByRole('menu', { name: '记到哪' })).toBeVisible()
      await clickAway(page, 'webview')
      await expect(page.getByRole('menu', { name: '记到哪' })).toHaveCount(0)
      await expect(ask).toHaveCount(0)
      log.push('叠层（问框 + 记进菜单）：Esc 先收菜单问框留着，点网页两层都收')
    } catch (e) {
      fails.push(`叠层：${String((e as Error).message).split('\n')[0]}`)
      log.push('叠层（问框 + 记进菜单）：没过')
      await page.keyboard.press('Escape')
      await clickBlank(page)
    }
    // 白板：中间换成白板（白板看法），右栏网页照旧开着（先点回编辑器，焦点不在网页里，⌘O 才是软件的）
    await clickAway(page, 'editor')
    await openBoard(page, '白板')
    await expect(pane(page).locator('[data-testid="doc-board"]').first()).toBeVisible()
    await all(BOARD_POPS)
    // AI 那一格：回到笔记，开 AI
    await openNote(page, '看视频的笔记')
    await openAi(page)
    await all(AI_POPS)
    expect(fails, fails.join('\n')).toEqual([])
  } finally {
    console.log('结果\n' + log.join('\n'))
    await run.close()
  }
})

/** 费曼那两处各开一个库：右栏开一个网页（点网页那一步用） */
async function feynmanRun(files: Record<string, string | Uint8Array>, book: string) {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_FAKE_SAY_MS: '2' })
  const { page } = run
  await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await rail(page).getByRole('button', { name: '网页', exact: true }).click()
  const addr = web(page).getByRole('textbox', { name: '网址' })
  await addr.fill(book)
  await addr.press('Enter')
  await expect(web(page).locator('webview.on')).toBeVisible()
  await page.waitForTimeout(800)
  return run
}

test.describe('A2 费曼两处', () => {
  let bookServer: Server
  let book = ''
  test.beforeAll(async () => {
    bookServer = createServer((_q, r) => (r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }), r.end(BOOK_PAGE)))
    await new Promise<void>((r) => bookServer.listen(0, '127.0.0.1', r))
    book = `http://127.0.0.1:${(bookServer.address() as AddressInfo).port}`
  })
  test.afterAll(() => bookServer.close())

  test('「补进导图」核对框：点空白处、按 Esc、点网页、点导图空处都关', async () => {
    test.setTimeout(200_000)
    const run = await feynmanRun(feynmanVault(), book)
    const { page } = run
    const log: string[] = []
    const fails: string[] = []
    try {
      await page.locator('.nav .si', { hasText: '导图 · 线性代数 2.3' }).first().click()
      await expect(pane(page).getByTestId('fy-col')).toBeVisible()
      log.push(
        await check(
          page,
          { name: '补进导图核对', open: (page) => pane(page).getByTestId('fy-col').getByTestId('fy-tomap').click(), shown: (page) => page.getByTestId('feynman-merge'), away: ['webview', 'pane'] },
          fails,
        ),
      )
      expect(fails, fails.join('\n')).toEqual([])
    } finally {
      console.log('结果\n' + log.join('\n'))
      await run.close()
    }
  })

  test('「聊到哪了」小单：点空白处、按 Esc、点网页、点白板画布都关', async () => {
    test.setTimeout(200_000)
    const run = await feynmanRun(feynmanFiles(book), book)
    const { page } = run
    const log: string[] = []
    const fails: string[] = []
    try {
      // 白板上开一轮聊到底，讲一段，点列头的小点
      await openBoard(page, '线性代数 2.3 白板')
      await pane(page).locator('[data-testid="doc-board"]').first().getByTestId('pal-feynman').click()
      const pop = page.getByTestId('fy-start')
      await pop.getByRole('textbox', { name: '直接写一个词' }).fill('梯度下降')
      await pop.getByTestId('fy-start-go').click()
      const c = pane(page).getByTestId('fy-col')
      await expect(c.getByTestId('fy-begin')).toBeVisible({ timeout: 15_000 })
      await c.getByTestId('fy-mode-long').click()
      await c.getByTestId('fy-begin').click()
      const ans = c.getByTestId('fy-answer')
      await expect(ans).toBeVisible({ timeout: 15_000 })
      await ans.locator('textarea').fill('先随便猜一个初始值，然后一步步往下走。每一步把 θ 减去学习率乘坡度，沿负梯度走。')
      await c.getByTestId('fy-send').click()
      await expect(c.getByTestId('fy-thinking')).toHaveCount(0, { timeout: 15_000 })
      await expect(c.getByTestId('fy-answer')).toBeVisible({ timeout: 15_000 })
      log.push(
        await check(
          page,
          { name: '聊到哪了', open: (page) => pane(page).getByTestId('fy-col').getByTestId('fy-dots').click(), shown: (page) => page.getByTestId('fy-talk-list'), away: ['webview', 'board'] },
          fails,
        ),
      )
      expect(fails, fails.join('\n')).toEqual([])
    } finally {
      console.log('结果\n' + log.join('\n'))
      await run.close()
    }
  })
})
