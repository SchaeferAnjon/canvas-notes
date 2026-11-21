/**
 * 交付对照图（task-0tgz2 AI 空白页打招呼）：软件摆成和小样 design/ai-empty 同一个状态，整窗截下来。
 * 只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色（天青 / 深湖，B 浮岛书桌，同用户截图）。平时跳过。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, join } from 'node:path'
import { launch, rail, tabOn, type Running } from './app'

const DIR = process.env.CN_SHOTS
const DARK = process.env.CN_SHOT_TONE === 'dark'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const BOOK = '读懂红楼：六神磊磊读红楼+红楼梦（微信读书首发）'
const DOC = `---
类型: 书摘
作者: "[清]曹雪芹 六神磊磊"
来源: https://weread.qq.com/web/reader/1
bookId: "1"
划线: 4
---
# ${BOOK}

## 宝黛相逢

> 先拜见大舅舅，也就是贾赦。哪知贾赦却不出来，倒让下人给林黛玉回了这么一句话。

> 为什么他不出来应酬客套一下？因为贾赦觉得犯不着。

## 有眼无珠

> 身后有余忘缩手，眼前无路想回头。
`
const files = {
  [`阅读/${BOOK}.md`]: DOC,
  '周记/2026-W47.md': '# 2026-W47\n\n这周主要在读 ECP。\n',
  '收件箱/菜谱.md': '# 菜谱\n\n番茄炒蛋。\n',
  '收件箱/机票.md': '# 机票\n\n冰岛的机票订好了。\n',
  '写作/白板草稿.md': '---\ntype: board\n---\n# 白板草稿\n\n## 想法\n\n一张卡。\n\n## 素材\n\n另一张卡。\n',
}

const look = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}
const chat = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' })

async function shot(run: Running, name: string) {
  await run.page.waitForTimeout(450)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(DIR!, `${name}-${DARK ? 'dark' : 'light'}.png`), Buffer.from(b64, 'base64'))
}
async function open(page: Page, name: string, tab = name) {
  await page.keyboard.press('Meta+o')
  await page.keyboard.type(name)
  await page.waitForTimeout(250)
  await page.keyboard.press('Enter')
  await expect(tabOn(page)).toHaveText(tab)
}
/** 右栏拖到 w 宽（拖分隔线，跟人一样） */
async function rightWidth(page: Page, w: number) {
  const now = (await chat(page).boundingBox())!.width
  const sep = (await page.getByRole('separator', { name: '拖动调整右栏宽度' }).boundingBox())!
  const left = (await chat(page).boundingBox())!.x < 400
  const dx = (w - now) * (left ? 1 : -1)
  await page.mouse.move(sep.x + sep.width / 2, sep.y + 300)
  await page.mouse.down()
  await page.mouse.move(sep.x + sep.width / 2 + dx, sep.y + 300, { steps: 8 })
  await page.mouse.up()
  await page.waitForTimeout(200)
}

test('AI 空对话：书摘开着 + 右栏网页标签，窄 340 / 宽 600，栏在右 / 在左', async () => {
  mkdirSync(DIR!, { recursive: true })
  const server = createServer((_q, r) => r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<title>微信读书</title><p>一段字</p>'))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/book`
  const run = await launch(files, { CN_AI_FAKE: '1' }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await open(page, '读懂红楼', BOOK)
    // 右栏开网页（和用户截图一样：网页、AI 叠在同一组，AI 在前）
    await rail(page).getByRole('button', { name: '网页' }).click()
    const addr = page.getByRole('complementary', { name: '网页' }).getByRole('textbox', { name: '网址' })
    await addr.fill(url)
    await addr.press('Enter')
    await page.keyboard.press('Meta+j')
    await expect(chat(page)).toBeVisible()
    // 第一次两个标签时的「拖标签」提示：关掉（小样里没有它）
    await page.getByTestId('dock-hint').getByRole('button', { name: '关掉' }).click()
    await page.mouse.move(700, 450)
    await rightWidth(page, 340)
    await shot(run, 'web-340-right')
    await rightWidth(page, 600)
    await shot(run, 'web-600-right')
    // 栏挪到左边（⋯「这一栏往左挪」）
    await page.getByRole('button', { name: '这一栏的布局' }).first().click()
    await page.getByRole('menuitem', { name: '这一栏往左挪' }).click()
    await page.waitForTimeout(300)
    await page.mouse.move(700, 450)
    await shot(run, 'web-600-left')
    await rightWidth(page, 340)
    await shot(run, 'web-340-left')
  } finally {
    await run.close()
    server.close()
  }
})

test('AI 空对话：白板 380（四颗放不下收进「⋯」、点开）、600（都露着）', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(files, { CN_AI_FAKE: '1' }, look)
  const { page, app } = run
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await open(page, '白板草稿')
    await page.keyboard.press('Meta+j')
    await expect(chat(page)).toBeVisible()
    await page.mouse.move(700, 450)
    await shot(run, 'board-380')
    const more = chat(page).getByRole('button', { name: '更多命令' })
    if (await more.isVisible()) {
      await more.click()
      await shot(run, 'board-380-more')
      await page.keyboard.press('Escape')
    }
    await rightWidth(page, 600)
    await page.mouse.move(700, 450)
    await shot(run, 'board-600')
  } finally {
    await run.close()
  }
})

test('左栏多选 4 个（两篇、一个文件夹、一块白板）：底部那一条带「问AI」；点了 AI 看得到「选中的4个」，快捷命令是好几篇的', async () => {
  mkdirSync(DIR!, { recursive: true })
  const run = await launch(files, { CN_AI_FAKE: '1' }, look)
  const { page, app } = run
  const tree = page.locator('aside.side').getByRole('tree')
  const row = (name: string) => tree.getByRole('treeitem').filter({ has: page.locator('.truncate', { hasText: new RegExp(`^${name}$`) }) })
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
    await page.locator('.abar.left').getByRole('button', { name: /^文件/ }).first().click()
    await row('周记').click({ modifiers: ['Meta'] })
    await row('写作').locator('.ft-tw').click()
    await row('白板草稿').click({ modifiers: ['Meta'] })
    await row('收件箱').locator('.ft-tw').click()
    await row('菜谱').click({ modifiers: ['Meta'] })
    await row('机票').click({ modifiers: ['Meta'] })
    await page.mouse.move(700, 450)
    await shot(run, 'pick-bar')
    await page.locator('aside.side').getByRole('toolbar', { name: '选中的' }).getByRole('button', { name: '问AI' }).click()
    await expect(chat(page).getByTestId('ai-picked')).toBeVisible()
    await page.mouse.move(700, 450)
    await shot(run, 'pick-ai')
  } finally {
    await run.close()
  }
})
