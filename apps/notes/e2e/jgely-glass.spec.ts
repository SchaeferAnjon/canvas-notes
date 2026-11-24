/**
 * 设置 › 外观 ›「面板透明度」（task-jgely）真点：拖滑杆、方向键、恢复默认，窗口上的面板跟着变透 / 变实，停手后存进设置，重开还是那个值；
 * A 照 VS Code、「不用图」时滑杆是灰的（面板是实的）。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { GLASS_MAX, GLASS_MIN } from '../../../packages/design/src/glass'
import { launch, type Running } from './app'

const FILES = { '写作/小论文计划.md': '# 小论文计划\n\n截稿前把实验和初稿弄完。\n' }

const lookOf = (appearance: Record<string, unknown>) => (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'sky', frame: 'b', winBg: 'aurora', ...appearance } }))
}

/** 左栏、中间那层半透明底的不透明度（::before 的底色 alpha） */
const alphas = (page: Page) =>
  page.evaluate(() => {
    const a = (sel: string) => {
      const c = getComputedStyle(document.querySelector(sel)!, '::before').backgroundColor
      const m = c.match(/\/\s*([\d.]+)\)$/) ?? c.match(/rgba\([^)]*,\s*([\d.]+)\)$/)
      return m ? Math.round(Number(m[1]) * 100) : 100
    }
    return { side: a('.win > .side'), center: a('.win > .center') }
  })

const saved = (run: Running) => JSON.parse(readFileSync(join(run.userData, 'settings.json'), 'utf8')).appearance.glass as number

async function openLook(page: Page) {
  await page.keyboard.press('Meta+Comma')
  const set = page.getByRole('dialog', { name: '设置' })
  await expect(set).toBeVisible()
  await set.getByRole('button', { name: '外观' }).first().click()
  const slider = set.getByRole('slider', { name: '面板透明度' })
  await slider.scrollIntoViewIfNeeded()
  return { set, slider, row: set.locator('[data-row="glass"]') }
}

test('拖面板透明度：窗口跟着变、存下、重开记得', async () => {
  test.setTimeout(120_000)
  const run = await launch(FILES, {}, lookOf({}))
  let again: Running | undefined
  try {
    const { page } = run
    await expect(page.locator('html')).toHaveAttribute('data-glass', '')
    // 默认：用户认可的那版（天青浅色，面板 80% 不透明，透 20%）
    expect(await alphas(page)).toEqual({ side: 80, center: 80 })
    const { slider, row } = await openLook(page)
    await expect(slider).toHaveValue('0')
    await expect(slider).toBeEnabled()
    await expect(row.locator('.gl-val')).toHaveText('20%')
    await expect(row.getByRole('button', { name: '恢复默认' })).toBeHidden()

    // 真拖：按住滑块拖到最右（最透）
    const b = (await slider.boundingBox())!
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + b.width * 0.75, b.y + b.height / 2, { steps: 5 })
    // 拖到一半窗口已经跟着变了（还没松手）
    await expect.poll(async () => (await alphas(page)).center).toBeLessThan(80)
    await page.mouse.move(b.x + b.width + 30, b.y + b.height / 2, { steps: 5 })
    await page.mouse.up()
    await expect(slider).toHaveValue(String(GLASS_MAX))
    await expect(row.locator('.gl-val')).toHaveText(`${20 + GLASS_MAX}%`)
    expect(await alphas(page)).toEqual({ side: 80 - GLASS_MAX, center: 80 - GLASS_MAX })
    // 停手 300ms 后存进设置
    await expect.poll(() => saved(run)).toBe(GLASS_MAX)

    // 方向键：Home 到最实那头，← → 一格一格
    await slider.focus()
    await page.keyboard.press('Home')
    await expect(slider).toHaveValue(String(GLASS_MIN))
    expect(await alphas(page)).toEqual({ side: 80 - GLASS_MIN, center: 80 - GLASS_MIN })
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(slider).toHaveValue(String(GLASS_MIN + 2))
    await expect.poll(() => saved(run)).toBe(GLASS_MIN + 2)

    // 恢复默认
    await row.getByRole('button', { name: '恢复默认' }).click()
    await expect(slider).toHaveValue('0')
    expect(await alphas(page)).toEqual({ side: 80, center: 80 })
    await expect.poll(() => saved(run)).toBe(0)

    // 拖到最左（最实），关掉设置再退出：重开还是最实
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x - 30, b.y + b.height / 2, { steps: 6 })
    await page.mouse.up()
    await expect(slider).toHaveValue(String(GLASS_MIN))
    await page.keyboard.press('Escape')
    await expect.poll(() => saved(run)).toBe(GLASS_MIN)
    await run.close({ keep: true })
    again = await launch(FILES, { CN_USER_DATA: run.userData })
    expect(await alphas(again.page)).toEqual({ side: 80 - GLASS_MIN, center: 80 - GLASS_MIN })
    const o = await openLook(again.page)
    await expect(o.slider).toHaveValue(String(GLASS_MIN))
    await expect(o.row.locator('.gl-val')).toHaveText(`${20 + GLASS_MIN}%`)
  } finally {
    if (again) await again.close()
    rmSync(join(run.userData, '..'), { recursive: true, force: true })
  }
})

test('A 照 VS Code、不用图：面板是实的，滑杆灰着', async () => {
  test.setTimeout(90_000)
  const run = await launch(FILES, {}, lookOf({ winBg: 'none', glass: 8 }))
  try {
    const { page } = run
    await expect(page.locator('html')).not.toHaveAttribute('data-glass')
    const { set, slider, row } = await openLook(page)
    await expect(slider).toBeDisabled()
    await expect(row).toHaveClass(/off/)
    await expect(set.locator('.gl-note')).toHaveText('B浮岛书桌配了窗口背景时面板才透，现在是实的')
    // 换上极光：马上能拉、面板透（还是存着的那一档）
    await set.getByRole('radio', { name: '极光照片' }).click()
    await expect(slider).toBeEnabled()
    await expect(page.locator('html')).toHaveAttribute('data-glass', '')
    expect(await alphas(page)).toEqual({ side: 72, center: 72 })
    // 换成 A：窗口上没有半透明；A 里设置开成中间的一个标签，再打开外观页，滑杆又灰了
    await set.getByRole('radio', { name: /照VS Code/ }).click()
    await expect(page.locator('html')).not.toHaveAttribute('data-glass')
    if (!(await page.getByRole('slider', { name: '面板透明度' }).count())) {
      await page.keyboard.press('Escape')
      await page.keyboard.press('Meta+Comma')
      await page.getByRole('button', { name: '外观' }).first().click()
    }
    await expect(page.getByRole('slider', { name: '面板透明度' })).toBeDisabled()
  } finally {
    await run.close()
  }
})
