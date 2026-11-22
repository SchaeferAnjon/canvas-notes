// 交付截图（task-dtc34「AI 写进文档的一律显示成带 Claude 标志的 AI 块」），浅色天青、深色深湖各一套：
// - before：以前 AI 直接写进书摘的样子（用户截图 img1：「## 评价」下面两段普通的字，选中了）；
// - after：AI 对话全能模式里 AI 写一节评价，这一轮结束补包成 AI 块（右栏开着那段对话）；
// - block / marked / menu：AI 块特写、「标成 AI 写的」以后再改一个字（补标 · 改过）、块菜单里的「变成我的字」；
// - compare/：左边原型（/private/tmp/canvas-notes-branch/proto.html「文档里的 AI 讲解」）、右边软件，同一种块。
// 平时跳过：CN_SHOTS=<目录> npx playwright test e2e/dtc34-shots.spec.ts（原型路径 CN_PROTO）。
import { chromium, expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, type Running } from './app'
import { skinned } from './fixtures/book-digest'

const SHOTS = process.env.CN_SHOTS
const PROTO = process.env.CN_PROTO ?? '/private/tmp/canvas-notes-branch/proto.html'
test.skip(!SHOTS, '截交付图才跑：CN_SHOTS=<目录>')
test.setTimeout(5 * 60_000)

const CHROMIUM = { ...(process.env.CN_CHROMIUM ? { executablePath: process.env.CN_CHROMIUM } : {}) }

const BOOK = `---
类型: 书摘
作者: 哈珀·李
---
# 杀死一只知更鸟（同名电影原著）

## 第一章

> 我哥哥杰姆快满十三岁的时候，胳膊肘遭受了一次严重的骨折。等到伤痛痊愈，他也不再担惊受怕，唯恐永远也玩不成橄榄球之后，就很少想到自己受伤的事儿了。
—— [《杀死一只知更鸟》 · 第一章](https://weread.qq.com/web/reader/abc)

> 等过了一些年，日子长到足够让当事人回首往事时，我们有时候会谈论导致他受伤的那些过往事件。
—— [《杀死一只知更鸟》 · 第一章](https://weread.qq.com/web/reader/abc)

> 从迪尔来到我们这儿的那个夏天起——确切地说，是当迪尔怂恿我们把怪人拉德利引出来的时候，事情就开始了。
—— [《杀死一只知更鸟》 · 第一章](https://weread.qq.com/web/reader/abc)
`
const P1 = '开篇很克制：从杰姆胳膊肘骨折这件小事讲起，再说"过了一些年"兄妹俩回头谈起它。'
const P2 = '"事情就开始了"这一句把源头指向迪尔和怪人拉德利，先抛一个悬念。'
const OLD = `${BOOK}\n## 评价\n\n${P1}\n\n${P2}\n`
const PATH = '阅读/杀死一只知更鸟（同名电影原著）.md'

async function winShot(run: Running): Promise<Buffer> {
  await run.page.waitForTimeout(400)
  const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  return Buffer.from(b64, 'base64')
}

/** 左右拼一张（上面一行写哪边是哪边） */
async function pair(file: string, left: { title: string; png: Buffer }, right: { title: string; png: Buffer }, w: number, h: number) {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: w * 2 + 24, height: h + 40 } })
  const img = (x: Buffer) => `data:image/png;base64,${x.toString('base64')}`
  const col = (c: { title: string; png: Buffer }) =>
    `<div><div style="height:32px;line-height:32px;color:#fff;padding-left:8px">${c.title}</div><img src="${img(c.png)}" style="width:${w}px;height:${h}px;display:block;object-fit:contain;object-position:top left;background:#fff"></div>`
  await p.setContent(`<body style="margin:0;background:#888;font:14px -apple-system"><div style="display:flex;gap:24px">${col(left)}${col(right)}</div></body>`)
  await p.waitForTimeout(200)
  writeFileSync(file, await p.screenshot({ fullPage: true }))
  await b.close()
}

/** 原型「文档里的 AI 讲解」那一块（带框、框头 Claude 标志） */
async function protoBlock(dark: boolean): Promise<Buffer> {
  const b = await chromium.launch(CHROMIUM)
  const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  await p.goto(`file://${PROTO}#dir=a&scene=doc&theme=${dark ? 'dark' : 'light'}`)
  await p.waitForTimeout(500)
  const el = p.locator('.callout.ans').first()
  await el.scrollIntoViewIfNeeded()
  const png = await el.screenshot()
  await b.close()
  return png
}

const box = (page: Page) => page.getByRole('complementary', { name: 'AI 对话' }).getByRole('textbox', { name: '问 AI' })

/** 文档里 AI 块那几行合起来的框 */
async function blockShot(page: Page, file: string) {
  const lines = pane(page).locator('.cm-line.cm-callout-ai')
  const first = (await lines.first().boundingBox())!
  const last = (await lines.last().boundingBox())!
  await page.screenshot({ path: file, clip: { x: first.x - 24, y: first.y - 16, width: first.width + 48, height: last.y + last.height - first.y + 32 } })
}

for (const dark of [false, true]) {
  const tone = dark ? '深湖' : '天青'
  const skin = dark ? 'petrol' : 'sky'

  test(`改前（${tone}）：AI 写的两段看着就是普通正文（照 img1，两段选中）`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const run = await launch({ [PATH]: OLD }, { CN_AI_FAKE: '1' }, skinned(skin))
    const { page } = run
    try {
      await openNote(page, '杀死一只知更鸟（同名电影原著）')
      const l2 = pane(page).locator('.cm-line', { hasText: '先抛一个悬念' })
      const head = pane(page).locator('.cm-line', { hasText: /^评价$/ })
      await head.click({ position: { x: 2, y: 8 } })
      await page.keyboard.press('Home')
      const b2 = (await l2.boundingBox())!
      await page.keyboard.down('Shift')
      await page.mouse.click(b2.x + b2.width - 4, b2.y + b2.height - 6)
      await page.keyboard.up('Shift')
      writeFileSync(join(SHOTS!, `before-${skin}.png`), await winShot(run))
    } finally {
      await run.close()
    }
  })

  test(`改后（${tone}）：全能模式里 AI 写一节评价，这一轮结束包成 AI 块；特写、补标改过、块菜单；和原型并排`, async () => {
    mkdirSync(join(SHOTS!, 'compare'), { recursive: true })
    const run = await launch({ [PATH]: BOOK }, { CN_AI_FAKE: '1' }, skinned(skin))
    const { page } = run
    try {
      await openNote(page, '杀死一只知更鸟（同名电影原著）')
      await page.keyboard.press('Meta+j')
      await box(page).click()
      await box(page).fill(`在「${PATH}」末尾写一节评价`)
      await box(page).press('Enter')
      await expect(pane(page).locator('.cm-line.cm-callout-ai.cm-callout-head')).toHaveCount(1, { timeout: 20_000 })
      await page.getByRole('complementary', { name: 'AI 对话' }).getByRole('button', { name: '发送' }).waitFor({ timeout: 20_000 })
      await page.waitForTimeout(2500)
      await pane(page).locator('.cm-line', { hasText: /^评价$/ }).scrollIntoViewIfNeeded()
      const after = await winShot(run)
      writeFileSync(join(SHOTS!, `after-${skin}.png`), after)
      const size = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
      await blockShot(page, join(SHOTS!, `block-${skin}.png`))

      // 原型那一块和软件这一块并排
      const proto = await protoBlock(dark)
      const lines = pane(page).locator('.cm-line.cm-callout-ai')
      const f = (await lines.first().boundingBox())!
      const l = (await lines.last().boundingBox())!
      const app = await page.screenshot({ clip: { x: f.x - 8, y: f.y - 8, width: f.width + 16, height: l.y + l.height - f.y + 16 } })
      await pair(join(SHOTS!, 'compare', `block-${skin}.png`), { title: '原型 proto.html「文档里的 AI 讲解」', png: proto }, { title: '软件：AI 写的（全能模式补包）', png: app }, Math.round(size.w * 0.55), 260)

      // 块菜单：AI 块上是「变成我的字」
      const head = pane(page).locator('.cm-line.cm-callout-ai.cm-callout-head').first()
      await expect(async () => {
        const hb = (await head.boundingBox())!
        await page.mouse.move(hb.x + 40, hb.y + 8)
        await page.mouse.move(hb.x + 60, hb.y + 10)
        await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click({ timeout: 1000 })
        await expect(page.getByRole('menu', { name: '块菜单' })).toBeVisible({ timeout: 1000 })
      }).toPass({ timeout: 10_000 })
      writeFileSync(join(SHOTS!, `menu-${skin}.png`), await winShot(run))
      await page.keyboard.press('Escape')
    } finally {
      await run.close()
    }
  })

  test(`补标、改过（${tone}）：以前那两段「标成 AI 写的」，再在块里改一个字`, async () => {
    mkdirSync(SHOTS!, { recursive: true })
    const run = await launch({ [PATH]: OLD }, { CN_AI_FAKE: '1' }, skinned(skin))
    const { page } = run
    try {
      await openNote(page, '杀死一只知更鸟（同名电影原著）')
      const head = pane(page).locator('.cm-line', { hasText: '开篇很克制' })
      await expect(async () => {
        const hb = (await head.boundingBox())!
        await page.mouse.move(hb.x + 40, hb.y + 8)
        await page.mouse.move(hb.x + 60, hb.y + 10)
        await pane(page).locator('.blk-bar:not([hidden]) .blk-grip').click({ timeout: 1000 })
        await expect(page.getByRole('menu', { name: '块菜单' })).toBeVisible({ timeout: 1000 })
      }).toPass({ timeout: 10_000 })
      writeFileSync(join(SHOTS!, `menu-mark-${skin}.png`), await winShot(run))
      await page.getByRole('menu', { name: '块菜单' }).getByRole('menuitem', { name: '标成 AI 写的' }).click()
      await expect(pane(page).locator('.cm-line.cm-callout-ai.cm-callout-head')).toHaveCount(1)
      await blockShot(page, join(SHOTS!, `marked-${skin}.png`))
      await pane(page).locator('.cm-line', { hasText: '开篇很克制' }).click()
      await page.keyboard.press('End')
      await page.keyboard.type('写得好')
      await expect(pane(page).locator('.cm-callout-meta')).toContainText('改过')
      await blockShot(page, join(SHOTS!, `edited-${skin}.png`))
    } finally {
      await run.close()
    }
  })
}
