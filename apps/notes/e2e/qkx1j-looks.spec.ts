/**
 * 照用户看图定的三处（task-qkx1j，2026-11-22，/private/tmp/canvas-notes-visual/index.html）：
 * 1. 点数据库、图片的把手开块菜单时，那一块和退格选中整块一样「盖在卡上一层强调色 24%」，大小、圆角跟卡自己（以前是卡后面的 --acc-soft，卡有底色看不出）；
 *    正文段落的把手菜单也盖在字上 24%（比版心左右宽 8、上下 4）。
 * 2. 深色主题（松林、深湖、可可、墨夜、石墨）浮层那一圈 1px 细边从 10%–18% 的灰加深到 --t3 60%；浅色五套不动。
 * 3. 出卡弹窗中间去掉外面那层黑底 / 灰底，卡片铺满这块区域（左右和头、编号条对齐 18），「你当时问的」和按钮照旧在卡片下面。
 * 都是真点、真按键。CN_SHOTS_DIR=<目录> 时另截改前改后的图（浅色天青、深色深湖，A / B 两种风格；浮层十套主题各一张）。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { launch, openNote, pane, rail, type Running, tabOn } from './app'
import { ankiVault, fakeAnki } from './fixtures/anki'

const SHOTS = process.env.CN_SHOTS_DIR

const BASE = '```base\nfilters:\n  and:\n    - file.inFolder("阅读/未命名数据库")\nviews:\n  - type: table\n    name: 表格\n    order:\n      - file.name\n      - 状态\n      - 日期\n```'
const FILES: Record<string, string> = {
  '阅读/杀死一只知更鸟.md': `# 杀死一只知更鸟\n\n## 评价\n\n开篇很克制：从杰姆胳膊肘骨折这件小事讲起，再说「过了一些年」兄妹俩回头谈起它。\n\n${BASE}\n\n后面一段。\n`,
  '阅读/未命名数据库/第一条.md': '---\n状态: 未开始\n日期: 2026-11-21\n---\n',
  '阅读/未命名数据库/第二条.md': '---\n状态: 在读\n日期: 2026-11-20\n---\n',
}

const DARK = ['pine', 'petrol', 'cocoa', 'ink', 'graphite'] as const
const LIGHT = ['mint', 'sky', 'sakura', 'lilac', 'stone'] as const
/** 浅色五套改前那一圈细边（themes.css），这次不动 */
const LIGHT_RING: Record<(typeof LIGHT)[number], string> = {
  mint: 'rgba(23, 70, 50, 0.1)',
  sky: 'rgba(15, 70, 100, 0.14)',
  sakura: 'rgba(120, 40, 60, 0.1)',
  lilac: 'rgba(70, 40, 100, 0.1)',
  stone: 'rgba(28, 25, 23, 0.08)',
}

async function look(run: Running, skin: string, frame: 'a' | 'b' = 'b') {
  const { page, app } = run
  await page.evaluate(([s, f]) => window.cn.setSettings({ appearance: { followSystem: false, skin: s, frame: f as 'a' | 'b', winBg: 'aurora' } }), [skin, frame] as const)
  await page.reload()
  await page.locator('.vault b').waitFor()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 887))
  await page.waitForTimeout(300)
}

async function shot(page: Page, name: string) {
  if (!SHOTS) return
  mkdirSync(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

/** 「rgba(…)」「rgb(…)」「color(srgb r g b / a)」读成 0–255 的 r g b 和 a */
function rgba(c: string): [number, number, number, number] {
  let m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/)
  if (m) return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]]
  m = c.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)/)
  if (m) return [+m[1]! * 255, +m[2]! * 255, +m[3]! * 255, m[4] === undefined ? 1 : +m[4]]
  throw new Error(`认不出的颜色：${c}`)
}
/** box-shadow 第一层的颜色（「color 0px 0px 0px 1px, …」） */
const firstRing = (shadow: string) => shadow.match(/^(rgba?\([^)]*\)|color\([^)]*\))\s+0px 0px 0px 1px/)?.[1] ?? `没有 1px 那一圈：${shadow}`

const grip = (page: Page) => pane(page).locator('.blk-bar:not([hidden]) .blk-grip')
const blockMenu = (page: Page) => page.getByRole('menu', { name: '块菜单' })
const hotBg = (page: Page) => pane(page).locator('.cm-blk-hotbg')

/** 鼠标移到这一块上，点左边的把手，等块菜单出来 */
async function openBlockMenu(page: Page, target: ReturnType<Page['locator']>) {
  await expect(async () => {
    const box = (await target.boundingBox())!
    await page.mouse.move(box.x + 40, box.y + 12)
    await page.mouse.move(box.x + 60, box.y + 14)
    await grip(page).click({ timeout: 1000 })
    await expect(blockMenu(page)).toBeVisible({ timeout: 1000 })
  }).toPass({ timeout: 10_000 })
}

test('块菜单开着时：数据库块整块盖上强调色 24%（在卡上面一层、大小圆角跟卡自己，和退格选中一样）；正文段落也盖在字上 24%', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    await openNote(page, '杀死一只知更鸟')
    const db = pane(page).locator('[data-part="数据库块"]')
    await expect(db.locator('tbody tr')).toHaveCount(2)
    const card = (await db.boundingBox())!
    await openBlockMenu(page, db)
    await expect(hotBg(page)).toHaveCount(1)
    const st = await hotBg(page).evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      r: getComputedStyle(el).borderTopLeftRadius,
      above: el.parentElement!.classList.contains('cm-layer-above'),
      pe: getComputedStyle(el.parentElement!).pointerEvents,
    }))
    expect(rgba(st.bg)[3], st.bg).toBeCloseTo(0.24, 2)
    expect(st.above, '选中底在卡上面一层').toBe(true)
    expect(st.pe).toBe('none')
    expect(st.r).toBe('10px')
    const bg = (await hotBg(page).boundingBox())!
    for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(bg[k] - card[k]), k).toBeLessThanOrEqual(1)
    // 卡中间那一点看到的颜色带着强调色：选中底不被卡盖住
    await page.keyboard.press('Escape')
    await expect(blockMenu(page)).toHaveCount(0)
    await expect(hotBg(page)).toHaveCount(0)

    // 正文段落：也是 24%、在字上面一层，比版心左右各宽 8、上下各 4
    const para = pane(page).locator('.cm-line', { hasText: '开篇很克制' })
    await openBlockMenu(page, para)
    await expect(hotBg(page)).toHaveCount(1)
    const p = await hotBg(page).evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, above: el.parentElement!.classList.contains('cm-layer-above') }))
    expect(rgba(p.bg)[3], p.bg).toBeCloseTo(0.24, 2)
    expect(p.above).toBe(true)
    const pb = (await hotBg(page).boundingBox())!
    const lb = (await para.boundingBox())!
    expect(pb.height - lb.height).toBeCloseTo(8, 0)
    // 菜单开着时点菜单里的项照样点得到（选中底不挡鼠标）
    await blockMenu(page).getByRole('menuitem', { name: /复制一块/ }).click()
    await expect(pane(page).locator('.cm-line', { hasText: '开篇很克制' })).toHaveCount(2)
  } finally {
    await run.close()
  }
})

test('深色五套主题的浮层细边是 --t3 60%（深湖里加一列菜单的边看得清），浅色五套不动', async () => {
  const run = await launch(FILES)
  const { page } = run
  try {
    for (const skin of [...DARK, ...LIGHT]) {
      await look(run, skin)
      await openNote(page, '杀死一只知更鸟')
      const db = pane(page).locator('[data-part="数据库块"]')
      await expect(db.locator('tbody tr')).toHaveCount(2)
      const addBtn = db.getByRole('button', { name: '加一列' })
      await addBtn.scrollIntoViewIfNeeded()
      await page.waitForTimeout(150)
      await addBtn.click()
      const add = page.getByRole('dialog', { name: '加一列' })
      await expect(add).toBeVisible()
      const got = await add.evaluate((el) => ({ shadow: getComputedStyle(el).boxShadow, t3: getComputedStyle(el).getPropertyValue('--t3').trim() }))
      const ring = firstRing(got.shadow)
      if ((DARK as readonly string[]).includes(skin)) {
        const [r, g, b, a] = rgba(ring)
        const hex = got.t3.replace('#', '')
        const want = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
        expect.soft([Math.round(r), Math.round(g), Math.round(b)], `${skin} 细边颜色是 --t3 ${got.t3}`).toEqual(want)
        expect.soft(a, `${skin} 细边 60%`).toBeCloseTo(0.6, 2)
      } else {
        expect.soft(ring, `${skin} 浅色不动`).toBe(LIGHT_RING[skin as (typeof LIGHT)[number]])
      }
      await shot(page, `2-浮层-${skin}`)
      await page.keyboard.press('Escape')
      await expect(add).toHaveCount(0)
    }
  } finally {
    await run.close()
  }
})

// ---------------------------------------------------------------- 出卡弹窗

const notes = (page: Page) => page.getByRole('complementary', { name: '笔记', exact: true })
const dlg = (page: Page) => page.getByRole('dialog', { name: '出卡' })
const palInput = (page: Page) => page.getByRole('textbox', { name: '搜索笔记、输入网址或命令' })

async function openCards(page: Page) {
  await page.keyboard.press('Meta+k')
  await palInput(page).fill('Lecture05')
  await page.locator('.pal-row', { hasText: 'Lecture05.pdf' }).first().click()
  await expect(tabOn(page)).toHaveText('Lecture05.pdf')
  if (!(await notes(page).isVisible())) await rail(page).getByRole('button', { name: '笔记' }).click()
  await notes(page).getByRole('tab', { name: '只看我问的' }).click()
  await notes(page).getByRole('button', { name: '出卡 · 6问' }).click()
  await expect(dlg(page).locator('.dh .sub')).toHaveText(/^改好了/, { timeout: 20_000 })
}

/** 中间那块：没有自己的底色；卡片宽度占这块的比例；卡片、按钮一排填到这块底下 */
const measure = (page: Page) =>
  dlg(page).evaluate((d) => {
    const body = d.querySelector('.rvbody') as HTMLElement
    const paper = d.querySelector('.paper') as HTMLElement
    const keys = d.querySelector('.keys, .orig.done') as HTMLElement
    const b = body.getBoundingClientRect()
    const p = paper.getBoundingClientRect()
    const k = keys.getBoundingClientRect()
    const sq = d.querySelector('.strip .sq button')!.getBoundingClientRect()
    return {
      bg: getComputedStyle(body).backgroundColor,
      ratio: p.width / body.clientWidth,
      left: p.left - b.left,
      stripLeft: sq.left - d.getBoundingClientRect().left,
      gapBelow: b.bottom - k.bottom,
      shadow: getComputedStyle(paper).boxShadow,
      scrolls: body.scrollHeight > body.clientHeight + 1,
    }
  })

test('出卡弹窗：中间没有外面那层黑底 / 灰底，卡片铺满这块（左右和编号条对齐 18，宽占 95% 以上、高填到底），浅色深色都一样', async () => {
  const anki = await fakeAnki({})
  const run = await launch(ankiVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '20' })
  const { page } = run
  try {
    for (const skin of ['sky', 'petrol']) {
      await look(run, skin)
      await openCards(page)
      const m = await measure(page)
      expect(m.bg, `${skin} 中间那块没有自己的底色`).toBe('rgba(0, 0, 0, 0)')
      expect(m.ratio, `${skin} 卡片宽占这块的比例`).toBeGreaterThan(0.95)
      expect(Math.round(m.left), '卡片左边和编号条第一格对齐').toBe(Math.round(m.stripLeft))
      expect(m.shadow).toBe('none')
      // 卡片往下长，「你当时问的」和那排按钮落在这块底下（不再在卡片下面留一大片空）
      expect(m.scrolls).toBe(false)
      expect(m.gapBelow, `${skin} 按钮一排离这块底下`).toBeLessThanOrEqual(20)
      // 照旧能一张张过：→ 换到下一张，卡片照样铺满
      await page.keyboard.press('ArrowRight')
      await expect(dlg(page).getByRole('group', { name: '每一张' }).getByRole('button').nth(1)).toHaveClass(/\bcur\b/)
      expect((await measure(page)).ratio).toBeGreaterThan(0.95)
      await page.keyboard.press('Escape')
      await expect(dlg(page)).toHaveCount(0)
    }
  } finally {
    await run.close()
    await anki.close()
  }
})

// ---------------------------------------------------------------- 对照图

test('截图：块菜单选中底、出卡弹窗（天青、深湖 × A、B）', async () => {
  test.skip(!SHOTS, '只在给了 CN_SHOTS_DIR 时截图')
  test.setTimeout(240_000)
  const anki = await fakeAnki({})
  const run = await launch({ ...FILES, ...ankiVault() }, { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '20' })
  const { page } = run
  try {
    for (const frame of ['a', 'b'] as const)
      for (const skin of ['sky', 'petrol']) {
        const tag = `${skin === 'sky' ? '天青' : '深湖'}-${frame.toUpperCase()}`
        await look(run, skin, frame)
        await openNote(page, '杀死一只知更鸟')
        const db = pane(page).locator('[data-part="数据库块"]')
        await expect(db.locator('tbody tr')).toHaveCount(2)
        await openBlockMenu(page, db)
        await shot(page, `1-块菜单-${tag}`)
        await page.keyboard.press('Escape')
        await openCards(page)
        await shot(page, `3-出卡-${tag}`)
        await page.keyboard.press('Escape')
        await expect(dlg(page)).toHaveCount(0)
      }
  } finally {
    await run.close()
    await anki.close()
  }
})

test('截图：Anki 没开着、「怎么装」展开时的出卡弹窗（天青、深湖）', async () => {
  test.skip(!SHOTS, '只在给了 CN_SHOTS_DIR 时截图')
  const anki = await fakeAnki({ down: true })
  const run = await launch(ankiVault(), { CN_AI_FAKE: '1', CN_ANKI_URL: anki.url, CN_FAKE_CARD_MS: '20' })
  const { page } = run
  try {
    for (const skin of ['sky', 'petrol']) {
      await look(run, skin)
      await openCards(page)
      await dlg(page).getByRole('button', { name: /^送进Anki/ }).click()
      await expect(dlg(page).getByTestId('anki-off')).toBeVisible()
      await dlg(page).getByTestId('anki-off').getByRole('button', { name: /怎么装/ }).click()
      await expect(dlg(page).getByRole('region', { name: '连上Anki' })).toBeVisible()
      await shot(page, `3-出卡-怎么装-${skin === 'sky' ? '天青' : '深湖'}`)
      await page.keyboard.press('Escape')
      await expect(dlg(page)).toHaveCount(0)
    }
  } finally {
    await run.close()
    await anki.close()
  }
})
