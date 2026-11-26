/**
 * 面板透明度越往「透」越透（bug 一组，用户「当我选到最透的时候 反而越来越实了 这是对的吗」）：设置 › 外观里真按滑杆拉到 0 / 50 / 100，
 * 右边的数和滑块位置一样；关掉设置量左栏、中间、右栏三块面板和身后背景差多少（面板里的字藏起来，同一处去掉面板那层再截一次，逐像素比），
 * 0 → 50 → 100 一档比一档小。主题渐变（天青、丁香、深湖）和极光照片（天青、深湖）五种都量（用户报的是丁香这种紫色渐变）。
 * 以前往透那边每格把透上来的背景提亮 4%（浅色主题），浅色渐变背景亮处提成一片白：天青主题渐变上拉到最透差 35，比默认的 27 还大。
 * CN_SHOTS=目录 时每档存一张整窗图（交付页的三档对比）。
 */
import { expect, type Page, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { GLASS_DEFAULT, GLASS_MAX, GLASS_MIN } from '../../../packages/design/src/glass'
import { launch, openAi, openNote, type Running } from './app'

const FILES = { '写作/小论文计划.md': '# 小论文计划\n\n截稿前把实验和初稿弄完，周五交给导师。\n\n## 这周\n\n- [ ] 读完三篇相关论文\n- [x] 和导师约时间\n' }
const SHOTS = process.env.CN_SHOTS

type Box = { x: number; y: number; w: number; h: number }
const PANELS = { side: '.win > .side', center: '.win > .center', right: '.win .dgrp' } as const

/** 三块面板和身后背景的差：每个像素三个通道差的绝对值取平均（面板四边各缩 30，躲开圆角、投影和模糊的边） */
async function panelDiff(run: Running) {
  const page = run.page
  const hide = await page.addStyleTag({ content: '.win > .side > *, .win > .center > *, .win .dgrp > * { visibility: hidden !important; } *, *::before { transition: none !important; animation: none !important; }' })
  await page.waitForTimeout(300)
  const rects = await page.evaluate((sels) => {
    const r = (sel: string) => {
      const b = document.querySelector(sel)!.getBoundingClientRect()
      return { x: b.x + 30, y: b.y + 30, w: b.width - 60, h: b.height - 60 }
    }
    return { side: r(sels.side), center: r(sels.center), right: r(sels.right), iw: innerWidth }
  }, PANELS)
  const cap = () => run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
  const withPanel = await cap()
  const bare = await page.addStyleTag({
    content: '[data-glass] .win > .side::before, [data-glass] .win > .center::before, [data-glass] .win .dgrp::before { background: transparent !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }',
  })
  await page.waitForTimeout(300)
  const behind = await cap()
  await bare.evaluate((n) => (n as Element).remove())
  await hide.evaluate((n) => (n as Element).remove())
  return run.app.evaluate(
    ({ nativeImage }, [a, b, rects]) => {
      const x = nativeImage.createFromBuffer(Buffer.from(a, 'base64'))
      const y = nativeImage.createFromBuffer(Buffer.from(b, 'base64'))
      const W = x.getSize().width
      const s = W / rects.iw
      const p = x.toBitmap()
      const q = y.toBitmap()
      const one = (r: Box) => {
        let sum = 0
        let n = 0
        for (let yy = Math.round(r.y * s); yy < Math.round((r.y + r.h) * s); yy += 2)
          for (let xx = Math.round(r.x * s); xx < Math.round((r.x + r.w) * s); xx += 2) {
            const i = (yy * W + xx) * 4
            sum += Math.abs(p[i]! - q[i]!) + Math.abs(p[i + 1]! - q[i + 1]!) + Math.abs(p[i + 2]! - q[i + 2]!)
            n += 3
          }
        return Math.round((sum / n) * 10) / 10
      }
      return { side: one(rects.side), center: one(rects.center), right: one(rects.right) }
    },
    [withPanel, behind, rects] as const,
  )
}

/** 三块面板那层底的不透明度（百分数） */
const alphas = (page: Page) =>
  page.evaluate((sels) => {
    const a = (sel: string) => {
      const c = getComputedStyle(document.querySelector(sel)!, '::before').backgroundColor
      const m = c.match(/\/\s*([\d.]+)\)$/) ?? c.match(/rgba\([^)]*,\s*([\d.]+)\)$/)
      return m ? Math.round(Number(m[1]) * 100) : 100
    }
    return { side: a(sels.side), center: a(sels.center), right: a(sels.right) }
  }, PANELS)

/** 底栏那条磨砂条的不透明度（百分数）：跟着面板透明度和三块一起变（2026-11-25 按推荐小改，以前固定 82%） */
const statusAlpha = (page: Page) =>
  page.evaluate(() => {
    const c = getComputedStyle(document.querySelector('.win > .status')!).backgroundColor
    const m = c.match(/\/\s*([\d.]+)\)$/) ?? c.match(/rgba\([^)]*,\s*([\d.]+)\)$/)
    return m ? Math.round(Number(m[1]) * 100) : 100
  })

/** 设置 › 外观里把面板透明度拉到 v（0 按 Home、100 按 End、50 点「恢复默认」），看右边的数，关掉设置 */
async function setLevel(page: Page, v: number) {
  await page.keyboard.press('Meta+Comma')
  const set = page.getByRole('dialog', { name: '设置' })
  await expect(set).toBeVisible()
  await set.getByRole('button', { name: '外观' }).first().click()
  const slider = set.getByRole('slider', { name: '面板透明度' })
  await slider.scrollIntoViewIfNeeded()
  const row = set.locator('[data-row="glass"]')
  if (v === GLASS_DEFAULT) {
    const reset = row.getByRole('button', { name: '恢复默认' })
    if (await reset.isEnabled()) await reset.click()
  } else {
    await slider.focus()
    await page.keyboard.press(v === GLASS_MIN ? 'Home' : 'End')
  }
  await expect(slider).toHaveValue(String(v))
  // 右边的数就是滑块的位置
  await expect(row.locator('.gl-val')).toHaveText(`${v}%`)
  await page.keyboard.press('Escape')
  await expect(set).toBeHidden()
  await page.mouse.move(700, 790)
  await page.waitForTimeout(400)
}

const CASES = [
  { skin: 'sky', bg: 'wall', k: 80, far: 16, name: '天青-主题渐变' },
  { skin: 'lilac', bg: 'wall', k: 80, far: 16, name: '丁香-主题渐变' },
  { skin: 'sky', bg: 'aurora', k: 80, far: 16, name: '天青-极光照片' },
  { skin: 'petrol', bg: 'wall', k: 82, far: 10, name: '深湖-主题渐变' },
  { skin: 'petrol', bg: 'aurora', k: 82, far: 10, name: '深湖-极光照片' },
] as const

for (const c of CASES) {
  test(`面板透明度 0 → 50 → 100 越来越透：${c.name}`, async () => {
    test.setTimeout(150_000)
    const run = await launch(FILES, {}, (vault) => {
      const ud = join(dirname(vault), 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: c.skin, frame: 'b', winBg: c.bg, wallMove: false } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1280, 800))
      await expect.poll(() => page.evaluate(() => innerHeight)).toBe(800)
      await expect(page.locator('html')).toHaveAttribute('data-glass', '')
      await openNote(page, '小论文计划')
      await openAi(page)
      const out: Record<number, { side: number; center: number; right: number }> = {}
      for (const v of [GLASS_MIN, GLASS_DEFAULT, GLASS_MAX]) {
        await setLevel(page, v)
        // 不透明度：0 不透、50 主题默认、100 再降 --isle-far（一般 16 个百分点，深湖 10）
        const op = Math.round(v <= GLASS_DEFAULT ? 100 - ((100 - c.k) * v) / GLASS_DEFAULT : c.k - (c.far * (v - GLASS_DEFAULT)) / (GLASS_MAX - GLASS_DEFAULT))
        expect(await alphas(page)).toEqual({ side: op, center: op, right: op })
        expect(await statusAlpha(page), '底栏跟着一起变').toBe(op)
        if (SHOTS) {
          mkdirSync(SHOTS, { recursive: true })
          const b64 = await run.app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'))
          writeFileSync(join(SHOTS, `${c.name}-${v}.png`), Buffer.from(b64, 'base64'))
        }
        out[v] = await panelDiff(run)
      }
      console.log(`${c.name}：${JSON.stringify(out)}`)
      if (SHOTS) {
        const f = join(SHOTS, `diff-${c.name}.json`)
        writeFileSync(f, JSON.stringify(out, null, 1))
      }
      for (const k of ['side', 'center', 'right'] as const) {
        expect(out[GLASS_DEFAULT]![k], `${k}：50 比 0 透`).toBeLessThan(out[GLASS_MIN]![k] - 0.5)
        expect(out[GLASS_MAX]![k], `${k}：100 比 50 透`).toBeLessThan(out[GLASS_DEFAULT]![k] - 0.5)
      }
    } finally {
      await run.close()
    }
  })
}
