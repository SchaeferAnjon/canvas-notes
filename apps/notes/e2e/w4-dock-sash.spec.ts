/**
 * 网页和 AI 并排、上下叠时，中间的分隔线能拖（task-rbtrz，用户：「这里需要能拖动」）：
 * - 并排两栏之间的竖线：指上去是左右箭头；拖着在这两栏之间分宽（左边宽多少右边就窄多少，中间不动），每栏最窄 300，网页那栏不设上限；
 *   双击两栏各一半；宽度记住，重开软件还在。以前这条缝只改右边那一栏，宽只能从中间要，中间到了 420 就一动不动，网页那栏也从来不变。
 * - 上下叠的横线：指上去是上下箭头；拖着改高低（拖过网页上面也跟手），一组最矮 18%；双击各一半；重开还在。
 * 网页里开的是本机假的微信读书阅读页（和用户截图一样是个真网页），窗口不上屏。
 */
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import electronPath from 'electron'
import { launch, openAi, rail } from './app'
import { type FakeWeread, READER, startFakeWeread } from './fixtures/fake-weread'

let fake: FakeWeread
test.beforeAll(async () => {
  fake = await startFakeWeread()
})
test.afterAll(() => fake.server.close())

const files = { '写作/草稿.md': '# 草稿\n\n写点什么。\n' }
type Box = { x: number; y: number; width: number; height: number }
const box = async (l: Locator): Promise<Box> => (await l.boundingBox())!
const mid = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const tab = (page: Page, v: string) => page.getByTestId(`dtab-${v}`)
const col = (page: Page, v: string) => page.locator('.dcol').filter({ has: tab(page, v) })
const grp = (page: Page, v: string) => page.locator('.dgrp').filter({ has: tab(page, v) })
const width = async (l: Locator) => (await box(l)).width
const centerW = (page: Page) => width(page.locator('.win > main.center'))

/** 两栏之间那条竖缝（量出来的：左边贴着网页那栏右边、右边贴着 AI 那栏左边） */
async function between(page: Page): Promise<Locator> {
  const w = await box(col(page, 'web'))
  const a = await box(col(page, 'ai'))
  const all = page.locator('.dsash-col')
  for (let i = 0; i < (await all.count()); i++) {
    const s = await box(all.nth(i))
    if (Math.abs(s.x + s.width / 2 - (w.x + w.width + a.x) / 2) < 6) return all.nth(i)
  }
  throw new Error('网页和 AI 两栏之间没有分隔线')
}

/** 真拖：按下、一步步挪、松开 */
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(120)
}

/** 指着它：拿到的是它自己（没被网页、AI 的内容盖住），鼠标是这个样子 */
async function hover(page: Page, l: Locator, cursor: string) {
  const m = mid(await box(l))
  await page.mouse.move(m.x, m.y)
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className ?? '', m)).toMatch(/dsash-/)
  expect(await l.evaluate((e) => getComputedStyle(e).cursor)).toBe(cursor)
}

async function openWeb(page: Page) {
  await rail(page).getByRole('button', { name: '网页' }).click()
  const addr = page.getByRole('complementary', { name: '网页' }).getByRole('textbox', { name: '网址' })
  await addr.fill(`${fake.base}${READER}`)
  await addr.press('Enter')
  await expect(page.locator('.right.web webview.on')).toBeVisible()
  const hint = page.getByTestId('dock-hint')
  if (await hint.count()) await hint.getByRole('button', { name: '关掉' }).click()
}

/** 按住 AI 标签拖到网页那一组的 zone（右边：并排一栏；下半：上下叠） */
async function dragAi(page: Page, zone: 'right' | 'bottom') {
  const t = mid(await box(tab(page, 'ai')))
  const g = await box(grp(page, 'web'))
  await page.mouse.move(t.x, t.y)
  await page.mouse.down()
  await page.mouse.move(t.x + 8, t.y + 3, { steps: 2 })
  await page.mouse.move(zone === 'right' ? g.x + g.width * 0.9 : g.x + g.width / 2, zone === 'right' ? g.y + g.height / 2 : g.y + g.height * 0.9, { steps: 12 })
  await expect(page.getByTestId('drop-mark')).toHaveText(zone === 'right' ? '在右边并排一栏' : '放到下半')
  await page.mouse.up()
}

function relaunch(run: { vault: string; userData: string; trash: string }) {
  return electron.launch({
    executablePath: electronPath as unknown as string,
    args: [join(__dirname, '../out/main/index.js')],
    env: { ...process.env, CN_VAULT: run.vault, CN_USER_DATA: run.userData, CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: run.trash, CN_WEREAD_ORIGIN: fake.base },
  })
}

test('网页和 AI 并排：中间的竖线指上去是左右箭头，拖着两栏一宽一窄、中间不动，各自最窄 300，双击各一半，重开还在', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_WEREAD_ORIGIN: fake.base })
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1512, 900))
    await openAi(page)
    await openWeb(page)
    await dragAi(page, 'right')
    await expect(page.locator('.dcol')).toHaveCount(2)
    const web0 = await width(col(page, 'web'))
    const ai0 = await width(col(page, 'ai'))
    const c0 = await centerW(page)
    const sum = web0 + ai0
    const sash = await between(page)
    await hover(page, sash, 'col-resize')

    // 往左拖 60：网页窄 60、AI 宽 60，中间不动（以前：网页不动，AI 只在中间还能让时才变宽）
    let s = mid(await box(sash))
    await drag(page, { x: s.x, y: s.y + 200 }, { x: s.x - 60, y: s.y + 200 })
    await expect.poll(() => width(col(page, 'web'))).toBeCloseTo(web0 - 60, 0)
    expect(await width(col(page, 'ai'))).toBeCloseTo(ai0 + 60, 0)
    expect(Math.abs((await centerW(page)) - c0)).toBeLessThanOrEqual(1)
    // 拖着的时候跟手：一路量（拖过网页上面也不丢）
    s = mid(await box(await between(page)))
    await page.mouse.move(s.x, s.y + 200)
    await page.mouse.down()
    for (const dx of [20, 50, 80]) {
      await page.mouse.move(s.x + dx, s.y + 200, { steps: 4 })
      await expect.poll(() => width(col(page, 'web'))).toBeCloseTo(web0 - 60 + dx, 0)
    }
    await page.mouse.up()
    // 往右拖到底：AI 停在 300，网页拿走剩下的
    s = mid(await box(await between(page)))
    await drag(page, { x: s.x, y: s.y + 200 }, { x: s.x + 800, y: s.y + 200 })
    await expect.poll(() => width(col(page, 'ai'))).toBeCloseTo(300, 0)
    expect(await width(col(page, 'web'))).toBeCloseTo(sum - 300, 0)
    // 往左拖到底：网页停在 300
    s = mid(await box(await between(page)))
    await drag(page, { x: s.x, y: s.y + 200 }, { x: s.x - 1200, y: s.y + 200 })
    await expect.poll(() => width(col(page, 'web'))).toBeCloseTo(300, 0)
    expect(await width(col(page, 'ai'))).toBeCloseTo(sum - 300, 0)
    expect(Math.abs((await centerW(page)) - c0)).toBeLessThanOrEqual(1)
    // 双击：两栏各一半
    await (await between(page)).dblclick()
    await expect.poll(() => width(col(page, 'web'))).toBeCloseTo(sum / 2, 0)
    expect(await width(col(page, 'ai'))).toBeCloseTo(sum / 2, 0)
    // 再拖一下停在一个不对称的地方，重开软件还在
    s = mid(await box(await between(page)))
    await drag(page, { x: s.x, y: s.y + 200 }, { x: s.x + 30, y: s.y + 200 })
    await expect.poll(() => width(col(page, 'web'))).toBeCloseTo(sum / 2 + 30, 0)
    const keep = { web: await width(col(page, 'web')), ai: await width(col(page, 'ai')) }
    await page.waitForTimeout(400)
    await run.app.close()
    const app2 = await relaunch(run)
    try {
      const p2 = await app2.firstWindow()
      await app2.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1512, 900))
      await expect(col(p2, 'ai')).toBeVisible()
      await expect.poll(() => width(col(p2, 'web'))).toBeCloseTo(keep.web, 0)
      expect(await width(col(p2, 'ai'))).toBeCloseTo(keep.ai, 0)
      // A 风格（平的，缝是 0 宽、手柄两边各伸 3）：一样指得到、拖得动
      await p2.evaluate(() => (window as unknown as { cn: { setSettings(p: unknown): Promise<unknown> } }).cn.setSettings({ appearance: { frame: 'a' } }))
      await p2.reload()
      await expect(p2.locator('.win')).toHaveClass(/frame-a/)
      await expect(col(p2, 'ai')).toBeVisible()
      const sashA = await between(p2)
      await hover(p2, sashA, 'col-resize')
      const webA = await width(col(p2, 'web'))
      const aiA = await width(col(p2, 'ai'))
      const sA = mid(await box(sashA))
      await drag(p2, { x: sA.x, y: sA.y + 200 }, { x: sA.x - 40, y: sA.y + 200 })
      await expect.poll(() => width(col(p2, 'web'))).toBeCloseTo(webA - 40, 0)
      expect(await width(col(p2, 'ai'))).toBeCloseTo(aiA + 40, 0)
    } finally {
      await app2.close()
    }
  } finally {
    await run.close().catch(() => undefined)
  }
})

test('网页和 AI 上下叠：中间的横线指上去是上下箭头，拖着改高低（拖过网页上面也跟手），一组最矮 18%，双击各一半，重开还在', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1', CN_WEREAD_ORIGIN: fake.base })
  const { page } = run
  try {
    await openAi(page)
    await openWeb(page)
    await dragAi(page, 'bottom')
    await expect(page.locator('.dgrp')).toHaveCount(2)
    const sash = page.locator('.dsash-row')
    await hover(page, sash, 'row-resize')
    const top0 = (await box(grp(page, 'web'))).height
    const bot0 = (await box(grp(page, 'ai'))).height
    const both = top0 + bot0
    // 往下拖 120：网页高 120、AI 矮 120
    let s = mid(await box(sash))
    await drag(page, s, { x: s.x, y: s.y + 120 })
    await expect.poll(async () => Math.abs((await box(grp(page, 'web'))).height - (top0 + 120))).toBeLessThanOrEqual(2)
    expect(Math.abs((await box(grp(page, 'ai'))).height - (bot0 - 120))).toBeLessThanOrEqual(2)
    // 往上拖，一路经过网页：跟手
    s = mid(await box(sash))
    await page.mouse.move(s.x, s.y)
    await page.mouse.down()
    for (const dy of [60, 160, 260]) {
      await page.mouse.move(s.x, s.y - dy, { steps: 4 })
      await expect.poll(async () => Math.abs((await box(grp(page, 'web'))).height - (top0 + 120 - dy))).toBeLessThanOrEqual(2)
    }
    await page.mouse.up()
    // 往上拖到底：网页那组停在 18%（按整栏算）
    s = mid(await box(sash))
    await drag(page, s, { x: s.x, y: 0 })
    const colH = (await box(col(page, 'web'))).height
    await expect.poll(async () => (await box(grp(page, 'web'))).height / colH).toBeGreaterThan(0.16)
    expect((await box(grp(page, 'web'))).height / colH).toBeLessThan(0.2)
    // 双击：各一半
    await sash.dblclick()
    await expect.poll(async () => Math.abs((await box(grp(page, 'web'))).height - (both / 2))).toBeLessThanOrEqual(2)
    // 拖到 1/3 左右，重开还在
    s = mid(await box(sash))
    await drag(page, s, { x: s.x, y: s.y - both / 6 })
    await page.waitForTimeout(400)
    const keep = (await box(grp(page, 'web'))).height / both
    await run.app.close()
    const app2 = await relaunch(run)
    try {
      const p2 = await app2.firstWindow()
      await expect(grp(p2, 'ai')).toBeVisible()
      const both2 = (await box(grp(p2, 'web'))).height + (await box(grp(p2, 'ai'))).height
      await expect.poll(async () => (await box(grp(p2, 'web'))).height / both2).toBeCloseTo(keep, 2)
    } finally {
      await app2.close()
    }
  } finally {
    await run.close().catch(() => undefined)
  }
})

test('交付截图：天青、深湖，网页和 AI 并排时点「注」、指着和拖着中间的竖线（CN_SHOT_DIR 给了才拍）', async () => {
  test.skip(!process.env.CN_SHOT_DIR, '只在拍交付截图时跑')
  const dir = process.env.CN_SHOT_DIR!
  const tag = process.env.CN_SHOT_TAG ?? 'after'
  const run = await launch(files, { CN_AI_FAKE: '1', CN_WEREAD_ORIGIN: fake.base })
  const { page } = run
  const guest = (code: string) => page.evaluate((c) => (document.querySelector('.right.web webview.on') as unknown as { executeJavaScript(c: string): Promise<unknown> }).executeJavaScript(c), code)
  /**
   * 拍整个窗口。窗口不上屏时，整窗截图里网页那块是网页上一次画到窗口上的样子（栏变窄后字还是旧的排法、刚弹出的东西缺一半），
   * 所以网页那块另用它自己的 capturePage 拍，按 webview 的位置贴回整窗截图上（magick，截图只在本机拍）
   */
  const shot = async (name: string) => {
    const win = join(dir, `${name}.png`)
    await page.screenshot({ path: win })
    const wv = await box(page.locator('.right.web webview.on'))
    const img = await run.app.evaluate(async ({ webContents }) => {
      const g = webContents.getAllWebContents().find((w) => w.getType() === 'webview' && w.getURL().includes('/web/reader/'))
      return g ? (await g.capturePage()).toPNG().toString('base64') : ''
    })
    expect(img).not.toBe('')
    const web = join(dir, `${name}-web.png`)
    writeFileSync(web, Buffer.from(img, 'base64'))
    const k = await page.evaluate(() => devicePixelRatio)
    execFileSync('magick', [win, '(', web, '-resize', `${Math.round(wv.width * k)}x${Math.round(wv.height * k)}!`, ')', '-geometry', `+${Math.round(wv.x * k)}+${Math.round(wv.y * k)}`, '-composite', win])
    rmSync(web)
  }
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1512, 900))
    await page.evaluate(() => window.cnPlugins.setEnabled('weread', true))
    await openAi(page)
    await openWeb(page)
    await dragAi(page, 'right')
    for (const skin of ['sky', 'petrol'] as const) {
      await page.evaluate((s) => (window as unknown as { cn: { setSettings(p: unknown): Promise<unknown> } }).cn.setSettings({ appearance: { followSystem: false, skin: s } }), skin)
      await page.reload()
      await expect(page.locator('.right.web webview.on')).toBeVisible()
      await expect.poll(() => guest('document.readyState')).toBe('complete')
      await page.waitForTimeout(400)
      // 点靠左的「注」
      await guest(`document.getElementById('fnL').scrollIntoView({ block: 'center' })`)
      await page.waitForTimeout(150)
      const wv = await box(page.locator('.right.web webview.on'))
      const n = JSON.parse(String(await guest(`JSON.stringify(document.getElementById('fnL').getBoundingClientRect())`))) as Box
      await page.mouse.click(wv.x + n.x + n.width / 2, wv.y + n.y + n.height / 2)
      await expect.poll(() => guest(`!!document.querySelector('.reader_footerNote_container')`)).toBe(true)
      await page.waitForTimeout(250)
      await shot(`${tag}-${skin}-footnote`)
      await page.mouse.click(wv.x + 4, wv.y + 4)
      // 指着两栏之间的竖线
      const s = mid(await box(await between(page)))
      await page.mouse.move(s.x, s.y + 200)
      await page.waitForTimeout(250)
      await shot(`${tag}-${skin}-sash-hover`)
      // 按住往左拖 140、还没松手
      await page.mouse.down()
      await page.mouse.move(s.x - 140, s.y + 200, { steps: 8 })
      await page.waitForTimeout(250)
      await shot(`${tag}-${skin}-sash-drag`)
      await page.mouse.up()
      await (await between(page)).dblclick()
      await page.waitForTimeout(250)
    }
  } finally {
    await run.close()
  }
})
