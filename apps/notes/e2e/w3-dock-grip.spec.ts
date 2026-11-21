/**
 * 栏头的六点把手挪到 ⋯ 左边（task-331zt，用户：「这六个点可以放在三个点的左侧」）：
 * 把手是 26 方的一格，紧挨着「这一栏的布局」⋯（间距 2，垂直居中对齐），提示照旧「按住拖动这一栏，换左右位置」；
 * 栏在左边、在右边、只开一个标签、标签多到要挤（标签条让出这块，不压把手）都这样摆；A、B 两种风格都一样。
 * 按住把手真拖到另一边，栏换了左右；重开软件还在。窗口不上屏。
 *
 * CN_SHOT_DIR 给了时最后一条拍交付截图（天青、深湖，栏在右、在左），CN_SHOT_TAG 是文件名前缀（before / after）。
 */
import { _electron as electron, expect, test, type Locator, type Page } from '@playwright/test'
import { rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import electronPath from 'electron'
import { launch, openAi, rail } from './app'

const files = { '周记/2026-W47.md': '# 2026-W47\n\n## 这周读线代\n\n第三讲。\n\n## 下周\n\n复习。\n' }

type Box = { x: number; y: number; width: number; height: number }
const box = async (l: Locator): Promise<Box> => (await l.boundingBox())!
const mid = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const aiGroup = (page: Page) => page.locator('.dgrp').filter({ has: page.getByTestId('dtab-ai') })
const more = (g: Locator) => g.getByRole('button', { name: '这一栏的布局' })
/** 中间在 AI 那栏的左边还是右边 */
const side = (page: Page) =>
  page.evaluate(() => {
    const c = document.querySelector('.win > main.center')!.getBoundingClientRect()
    const d = document.querySelector('.dcol')!.getBoundingClientRect()
    return d.left < c.left ? 'left' : 'right'
  })

/** 量：把手 26 方，右边缘离 ⋯ 左边缘 0 到 2，垂直居中对齐，六点在把手正中，都在这一组里；指着它头上时六点露出来 */
async function gripBesideMore(page: Page, g: Locator) {
  const head = g.locator('.dhead')
  const hb = await box(head)
  await page.mouse.move(hb.x + 4, hb.y + hb.height / 2)
  const grab = g.locator('.dgrab')
  await expect(grab).toHaveAttribute('data-tip', '按住拖动这一栏，换左右位置')
  const h = await box(grab)
  const m = await box(more(g))
  const icon = await box(grab.locator('svg'))
  const grp = await box(g)
  expect(Math.round(h.width)).toBe(26)
  expect(Math.round(h.height)).toBe(26)
  const gap = m.x - (h.x + h.width)
  expect(gap).toBeGreaterThanOrEqual(-0.5)
  expect(gap).toBeLessThanOrEqual(2.5)
  expect(Math.abs(mid(h).y - mid(m).y)).toBeLessThanOrEqual(1)
  expect(Math.abs(mid(icon).x - mid(h).x)).toBeLessThanOrEqual(1)
  expect(Math.abs(mid(icon).y - mid(h).y)).toBeLessThanOrEqual(1)
  expect(h.x).toBeGreaterThanOrEqual(grp.x)
  expect(m.x + m.width).toBeLessThanOrEqual(grp.x + grp.width + 0.5)
  await expect.poll(() => grab.locator('.grip').evaluate((e) => getComputedStyle(e).opacity)).toBe('1')
  // 指在把手、⋯ 正中，拿到的是它们自己（标签多时标签不压上来）
  const hit = (p: { x: number; y: number }) => page.evaluate(({ x, y }) => (document.elementFromPoint(x, y)?.closest('.dgrab') ? 'grab' : document.elementFromPoint(x, y)?.closest('.dmore') ? 'more' : document.elementFromPoint(x, y)?.className), p)
  expect(await hit(mid(h))).toBe('grab')
  expect(await hit(mid(m))).toBe('more')
  return h
}

/** 真拖：按住把手、挪过 4、指到中间那边、松开 */
async function dragGrip(page: Page, g: Locator, to: 'left' | 'right') {
  const from = mid(await box(g.locator('.dgrab')))
  const c = await box(page.locator('main.center'))
  const x = to === 'left' ? c.x + 10 : c.x + c.width - 10
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x - 8, from.y + 3, { steps: 2 })
  await page.mouse.move(x, c.y + 300, { steps: 12 })
  await expect(page.getByTestId('drop-bar')).toBeVisible()
  await expect(page.getByTestId('drag-ghost')).toHaveText('挪这一栏')
  await page.mouse.up()
  await expect.poll(() => side(page)).toBe(to)
}

test('只开 AI：把手在 ⋯ 左边、提示照旧；按住把手拖到左边，栏换到左边、把手还在 ⋯ 左边；重开软件还在；再拖回右边', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page, vault } = run
  const root = dirname(vault)
  try {
    await openAi(page)
    await expect(page.locator('.dgrp')).toHaveCount(1)
    expect(await side(page)).toBe('right')
    const h = await gripBesideMore(page, aiGroup(page))
    // 指着把手：提示照旧，出在把手下面
    await page.mouse.move(mid(h).x, mid(h).y)
    const tip = page.getByTestId('tooltip')
    await expect(tip).toHaveText('按住拖动这一栏，换左右位置')
    const tb = await box(tip)
    expect(tb.y).toBeGreaterThan(h.y + h.height)
    expect(tb.x).toBeLessThanOrEqual(mid(h).x)
    expect(tb.x + tb.width).toBeGreaterThanOrEqual(mid(h).x)

    await dragGrip(page, aiGroup(page), 'left')
    await gripBesideMore(page, aiGroup(page))
    await page.waitForTimeout(400)

    // 重开软件：栏还在左边，把手还在 ⋯ 左边
    await run.app.close()
    const app2 = await electron.launch({
      executablePath: electronPath as unknown as string,
      args: [join(__dirname, '../out/main/index.js')],
      env: { ...process.env, CN_VAULT: vault, CN_USER_DATA: join(root, 'user-data'), CN_AI_FAKE: '1', CN_E2E: '1', CN_NO_AX: '1', CN_QUICK_KEY: 'Alt+Command+Shift+F19', CN_TRASH_DIR: join(root, 'trash'), CN_ICLOUD_CONTAINER: join(root, 'icloud') },
    })
    try {
      const p2 = await app2.firstWindow()
      await expect(p2.locator('.vault b')).toHaveText('测试库')
      await expect(aiGroup(p2)).toBeVisible()
      await expect.poll(() => side(p2)).toBe('left')
      await gripBesideMore(p2, aiGroup(p2))
      // 再按住把手拖回右边
      await dragGrip(p2, aiGroup(p2), 'right')
      await gripBesideMore(p2, aiGroup(p2))
    } finally {
      await app2.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('标签多到要挤：标签条让出把手和 ⋯ 那块，当前标签露着；A、B 两种风格，栏在右、在左都一样', async () => {
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.keyboard.press('Meta+o')
    await page.keyboard.type('2026-W47')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await openAi(page)
    for (const name of ['网页', '历史']) await rail(page).getByRole('button', { name, exact: true }).click()
    await rail(page).getByRole('button', { name: /^大纲/ }).click()
    await expect(page.locator('.dgrp')).toHaveCount(1)
    await expect(page.locator('.dgrp .dtab')).toHaveCount(4)
    // 这一栏拉到最窄（300）：四个标签放不下
    const sash = await box(page.locator('.dsash-col').first())
    await page.mouse.move(mid(sash).x, sash.y + 300)
    await page.mouse.down()
    await page.mouse.move(mid(sash).x + 300, sash.y + 300, { steps: 8 })
    await page.mouse.up()
    const g = page.locator('.dgrp').first()
    await expect.poll(async () => Math.round((await box(g)).width)).toBeLessThanOrEqual(301)
    const tabsW = await g.locator('.dtab').evaluateAll((ts) => ts.reduce((s, t) => s + t.getBoundingClientRect().width, 0))
    expect(tabsW).toBeGreaterThan((await box(g)).width - 60)

    for (const frame of ['b', 'a'] as const) {
      if (frame === 'a') {
        await page.evaluate(() => (window as unknown as { cn: { setSettings(p: unknown): Promise<unknown> } }).cn.setSettings({ appearance: { frame: 'a' } }))
        await page.reload()
        await expect(page.locator('.win')).toHaveClass(/frame-a/)
      }
      for (const where of ['right', 'left'] as const) {
        if ((await side(page)) !== where) await dragGrip(page, g, where)
        const h = await gripBesideMore(page, g)
        // 标签条在把手左边就截住了；当前那个标签整个露着
        const strip = await box(g.locator('.dtabs'))
        expect(strip.x + strip.width).toBeLessThanOrEqual(h.x + 0.5)
        const on = await box(g.locator('.dtab.on'))
        expect(on.x).toBeGreaterThanOrEqual(strip.x - 0.5)
        expect(on.x + on.width).toBeLessThanOrEqual(strip.x + strip.width + 0.5)
        // 藏着标签的那一头淡出（同中间标签条）
        await expect(g.locator('.dtabs')).toHaveClass(/more-[lr]/)
      }
    }
  } finally {
    await run.close()
  }
})

test('交付截图：天青、深湖，栏在右、在左（CN_SHOT_DIR 给了才拍）', async () => {
  test.skip(!process.env.CN_SHOT_DIR, '只在拍交付截图时跑')
  const dir = process.env.CN_SHOT_DIR!
  const tag = process.env.CN_SHOT_TAG ?? 'after'
  const run = await launch(files, { CN_AI_FAKE: '1' })
  const { page } = run
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    for (const skin of ['sky', 'petrol'] as const) {
      await page.evaluate((s) => (window as unknown as { cn: { setSettings(p: unknown): Promise<unknown> } }).cn.setSettings({ appearance: { followSystem: false, skin: s } }), skin)
      await page.reload()
      await page.locator('.vault b').waitFor()
      await openAi(page)
      // 和用户截图一样：历史 · 网页 · AI 一组
      for (const [name, v] of [['网页', 'web'], ['历史', 'history']] as const) {
        if (!(await page.getByTestId(`dtab-${v}`).count())) await rail(page).getByRole('button', { name, exact: true }).click()
      }
      const hint = page.getByTestId('dock-hint')
      if (await hint.count()) await hint.getByRole('button', { name: '关掉' }).click()
      await page.getByTestId('dtab-ai').click()
      for (const where of ['right', 'left'] as const) {
        if ((await side(page)) !== where) {
          await more(aiGroup(page)).click()
          await page.getByRole('dialog', { name: '这一栏的布局' }).getByRole('menuitem', { name: where === 'left' ? '这一栏往左挪' : '这一栏往右挪' }).click()
          await expect.poll(() => side(page)).toBe(where)
        }
        // 指着把手（提示出来），拍整个窗口和这一栏的头
        const grab = mid(await box(aiGroup(page).locator('.dgrab')))
        await page.mouse.move(grab.x, grab.y)
        await expect(page.getByTestId('tooltip')).toHaveText('按住拖动这一栏，换左右位置')
        await page.waitForTimeout(250)
        await page.screenshot({ path: join(dir, `${tag}-${skin}-${where}.png`) })
        const g = await box(aiGroup(page))
        await page.screenshot({ path: join(dir, `${tag}-${skin}-${where}-head.png`), clip: { x: g.x, y: Math.max(0, g.y - 8), width: g.width, height: 110 } })
      }
      // 栏拉到最窄（300）：三个标签挤着（拍完拉回原来的宽）
      const wide = (await box(aiGroup(page))).width
      const pull = async (dx: number) => {
        const sash = await box(page.locator('.dsash-col').first())
        await page.mouse.move(mid(sash).x, sash.y + 300)
        await page.mouse.down()
        await page.mouse.move(mid(sash).x + dx, sash.y + 300, { steps: 8 })
        await page.mouse.up()
      }
      await pull(-400)
      await page.waitForTimeout(200)
      const grab = mid(await box(aiGroup(page).locator('.dgrab')))
      await page.mouse.move(grab.x, grab.y)
      await expect(page.getByTestId('tooltip')).toBeVisible()
      await page.waitForTimeout(250)
      const narrow = await box(aiGroup(page))
      await page.screenshot({ path: join(dir, `${tag}-${skin}-narrow-head.png`), clip: { x: narrow.x - 8, y: Math.max(0, narrow.y - 8), width: narrow.width + 16, height: 110 } })
      // 浮起来：把手在「停靠」左边
      await more(aiGroup(page)).click()
      await page.getByRole('dialog', { name: '这一栏的布局' }).getByRole('menuitem', { name: '把「AI」浮起来' }).click()
      const fl = page.locator('.dfloat')
      await expect(fl).toBeVisible()
      const fg = mid(await box(fl.locator('.dgrab')))
      await page.mouse.move(fg.x, fg.y)
      await expect(page.getByTestId('tooltip')).toHaveText('按住拖动浮窗')
      await page.waitForTimeout(250)
      const fb = await box(fl)
      await page.screenshot({ path: join(dir, `${tag}-${skin}-float-head.png`), clip: { x: fb.x - 8, y: Math.max(0, fb.y - 8), width: fb.width + 16, height: 110 } })
      await fl.getByRole('button', { name: '停靠' }).click()
      await expect(fl).toHaveCount(0)
      await pull(wide - (await box(aiGroup(page))).width)
    }
    // A 风格（35 高、平的）：组头，栏在右；先拍指着组头空处（六点 --t3），再拍指着把手（底色 + 提示）
    await page.evaluate(() => (window as unknown as { cn: { setSettings(p: unknown): Promise<unknown> } }).cn.setSettings({ appearance: { frame: 'a', skin: 'sky' } }))
    await page.reload()
    await expect(page.locator('.win')).toHaveClass(/frame-a/)
    if ((await side(page)) !== 'right') {
      await more(aiGroup(page)).click()
      await page.getByRole('dialog', { name: '这一栏的布局' }).getByRole('menuitem', { name: '这一栏往右挪' }).click()
      await expect.poll(() => side(page)).toBe('right')
    }
    const ga = await box(aiGroup(page))
    const clip = { x: ga.x, y: Math.max(0, ga.y - 8), width: ga.width, height: 110 }
    const sp = await box(aiGroup(page).locator('.dspace'))
    await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2)
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(dir, `${tag}-a-sky-right-head-idle.png`), clip })
    const ag = mid(await box(aiGroup(page).locator('.dgrab')))
    await page.mouse.move(ag.x, ag.y)
    await expect(page.getByTestId('tooltip')).toHaveText('按住拖动这一栏，换左右位置')
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(dir, `${tag}-a-sky-right-head.png`), clip })
  } finally {
    await run.close()
  }
})
