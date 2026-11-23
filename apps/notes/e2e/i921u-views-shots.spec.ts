/**
 * 数据库第三批第 2 块（task-i921u）的对照截图：和原型 14-数据库第三批/proto-a.html 的 #scene=kanban / calendar / gallery 同样的数据，
 * 截数据库那一块。B 浮岛书桌、天青（浅）/ 深湖（深）。只在截交付图时跑：CN_SHOTS=目录，CN_SHOT_TONE=dark 截深色；
 * CN_SHOT_FIGS=目录 放原型画廊里那三张图（「第2讲 需求和效用-light.png」这样的名字），没有就用 1×1 的图。交互的验收在 i921u-layouts.spec.ts。
 */
import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { EXERCISES, LECTURES } from '../../../packages/format/test/base-samples'
import { launch, openNote, pane } from './app'
import { DOCS } from './fixtures/ecp-views'

const DIR = process.env.CN_SHOTS
const FIGS = process.env.CN_SHOT_FIGS
const DARK = process.env.CN_SHOT_TONE === 'dark'
const TONE = DARK ? 'dark' : 'light'
test.skip(!DIR, '只在截交付图时跑（CN_SHOTS=目录）')

const fig = (name: string) => {
  const p = FIGS ? join(FIGS, `${name}-${TONE}.png`) : ''
  return p && existsSync(p) ? readFileSync(p) : Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkqM+oBwAEZgGBe0a7fQAAAABJRU5ErkJggg==', 'base64')
}

const skin = (vault: string) => {
  const ud = join(dirname(vault), 'user-data')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: DARK ? 'petrol' : 'sky', frame: 'b', winBg: 'aurora' } }))
}

test('看板、日历、画廊对照截图', async () => {
  mkdirSync(DIR!, { recursive: true })
  const files: Record<string, string | Uint8Array> = {
    ...DOCS,
    ...LECTURES,
    ...EXERCISES,
    '课程/ecp/课程计划/第2讲 需求和效用/需求曲线.png': fig('第2讲 需求和效用'),
    '课程/ecp/课程计划/边际产量.png': fig('第3讲 生产'),
    '课程/ecp/课程计划/市场.png': fig('第4讲 市场结构'),
  }
  const run = await launch(files, {}, skin)
  const { page } = run
  try {
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
    const db = pane(page).locator('[data-part="数据库块"]')
    await openNote(page, 'ecp 看板')
    await expect(db.locator('[data-part="看板一列"]')).toHaveCount(3)
    await page.waitForTimeout(400)
    await db.screenshot({ path: join(DIR!, `kanban-${TONE}.png`) })

    await openNote(page, 'ecp 日历')
    const cal = db.locator('[data-part="日历"]')
    for (let k = 0; k < 60 && (await cal.locator('.bl-calh b').textContent()) !== '2026年11月'; k++) {
      const [y, m] = ((await cal.locator('.bl-calh b').textContent()) ?? '').match(/\d+/g)!.map(Number) as [number, number]
      await cal.getByRole('button', { name: y * 12 + m - 1 > 2026 * 12 + 10 ? '上个月' : '下个月' }).click()
    }
    await page.waitForTimeout(400)
    await db.screenshot({ path: join(DIR!, `calendar-${TONE}.png`) })

    await openNote(page, 'ecp 画廊')
    await expect(db.locator('.bl-gcard')).toHaveCount(8)
    await page.waitForTimeout(600)
    await db.screenshot({ path: join(DIR!, `gallery-${TONE}.png`) })

    // 窄窗口（中栏窄了）：画廊两列，看板在块里横滑、右边渐隐
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(900, 887))
    await page.waitForTimeout(600)
    await db.screenshot({ path: join(DIR!, `gallery-narrow-${TONE}.png`) })
    await openNote(page, 'ecp 看板')
    await page.waitForTimeout(600)
    await db.screenshot({ path: join(DIR!, `kanban-narrow-${TONE}.png`) })
    await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 887))
    await openNote(page, 'ecp 画廊')

    // 量 DOM（和原型 proto-shots 量的同几样比）
    const m = await page.evaluate(() => {
      const r = (s: string) => {
        const e = document.querySelector('.pane:not([hidden]) ' + s)
        if (!e) return null
        const b = e.getBoundingClientRect()
        return [Math.round(b.width * 10) / 10, Math.round(b.height * 10) / 10]
      }
      return { gcard: r('.bl-gcard'), gcov: r('.bl-gcov'), ginfo: r('.bl-ginfo'), db: r('[data-part="数据库块"]') }
    })
    console.log('gallery', JSON.stringify(m))
  } finally {
    await run.close()
  }
})
