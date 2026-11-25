/**
 * 白板笔迹的性能（design/ipad-ink 的 Mac 那一组数：200 张卡 + 5000 笔）：同一块白板（200 张摆在空白处的卡）带 5000 笔、不带笔迹各开一次，
 * 程序自己滚 4 秒（100% 和最小的 25%），量帧率和慢帧。结果打在输出里（INK_PERF …），CN_PERF_OUT=文件 时也写进去。
 * 只报数、不卡门槛（这台 Mac 上常有几条线同时跑，数会跳）；硬条件只有「5000 笔都画出来了、滚得动」。
 */
import { expect, test, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodePoints, type InkPoint } from '@cn/format'
import { acts, launch, openNote, pane } from './app'

const W = 12000
const H = 8000
let seed = 42
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
const R = (a: number, b: number) => a + (b - a) * rnd()

function board(): string {
  let s = '# 大白板\n\n'
  for (let i = 0; i < 200; i++) {
    const col = (i / 10) | 0
    const row = i % 10
    s += `<!-- card id=d${i + 1} x=${200 + col * 560} y=${300 + row * 420 + (col >= 10 ? 3600 : 0)} -->\n第 ${i + 1} 张卡：EDA、HR、BVP、TEMP、ACC 五种信号，GAT 看信号之间的关系，Bi-LSTM 看时间上的变化。\n\n`
  }
  return s
}

function ink(n: number): string {
  const out = ['{"ink":1}']
  const colors = ['#1d2421', '#2459c6', '#d64545', '#12805a']
  for (let k = 0; k < n; k++) {
    if (k % 40 === 0) out.push(`{"g":"g${(k / 40).toString(36).padStart(7, '0')}","x":${Math.round(R(100, W - 600))},"y":${Math.round(R(100, H - 300))}}`)
    const pts: InkPoint[] = []
    let x = (k % 40 % 10) * 30 + R(0, 20)
    let y = (((k % 40) / 10) | 0) * 40 + R(0, 20)
    let vx = R(-2, 2)
    let vy = R(-2, 2)
    const m = R(20, 60) | 0
    for (let j = 0; j < m; j++) {
      vx = vx * 0.8 + R(-1.2, 1.2)
      vy = vy * 0.8 + R(-1.2, 1.2)
      x += vx
      y += vy
      pts.push({ x, y, w: 3 + 1.2 * Math.sin(j / 7) ** 2, f: 0.5, t: j / 240, az: 0, al: Math.PI / 2, h: 3, o: 1 })
    }
    const marker = k % 23 === 0
    out.push(`{"id":"s${k.toString(36).padStart(7, '0')}","g":"g${((k / 40) | 0).toString(36).padStart(7, '0')}","pen":"${marker ? 'marker' : 'pen'}","c":"${marker ? '#ffd84d' : colors[((k / 40) | 0) % 4]}","p":"${encodePoints(pts)}"}`)
  }
  return out.join('\n') + '\n'
}

/** 程序自己滚 secs 秒（照 mac-perf.html 的走法：余弦来回），量帧间隔 */
const scroll = (page: Page, secs: number) =>
  page.evaluate(async (secs) => {
    const w = document.querySelector<HTMLElement>('[data-testid="doc-board"] .board-wrap')!
    const mx = w.scrollWidth - w.clientWidth
    const my = w.scrollHeight - w.clientHeight
    const iv: number[] = []
    const draw: number[] = []
    const shown: number[] = []
    const cv = document.querySelector<HTMLCanvasElement>('[data-testid="db-ink"]')
    await new Promise<void>((done) => {
      const start = performance.now()
      let last = 0
      const f = (ts: number) => {
        const t = (performance.now() - start) / 1000
        if (t > secs) return done()
        if (last) iv.push(ts - last)
        last = ts
        if (cv?.dataset.ms) draw.push(Number(cv.dataset.ms))
        if (cv?.dataset.shown) shown.push(Number(cv.dataset.shown))
        w.scrollLeft = mx * (0.5 - 0.5 * Math.cos(t * 1.3))
        w.scrollTop = my * (0.5 - 0.5 * Math.cos(t * 0.9))
        requestAnimationFrame(f)
      }
      requestAnimationFrame(f)
    })
    const s = [...iv].sort((a, b) => a - b)
    const p = (k: number) => Math.round(s[Math.floor((s.length - 1) * k)]! * 10) / 10
    const d = [...draw].sort((a, b) => a - b)
    const pd = (k: number) => (d.length ? Math.round(d[Math.floor((d.length - 1) * k)]! * 100) / 100 : null)
    const sh = shown.length ? Math.round(shown.reduce((a, b) => a + b, 0) / shown.length) : null
    return { 能滚: mx > 0 || my > 0, 画笔迹ms中位: pd(0.5), 画笔迹msp95: pd(0.95), 每帧画几笔: sh, fps: Math.round((iv.length / (iv.reduce((a, b) => a + b, 0) / 1000)) * 10) / 10, 帧间隔中位ms: p(0.5), 帧间隔p95ms: p(0.95), 慢帧: iv.filter((x) => x > 25).length, 帧数: iv.length }
  }, secs)

test('白板笔迹性能：200 张卡 + 5000 笔，100% 和 25% 滚动的帧率（和不带笔迹的同一块白板比）', async () => {
  test.setTimeout(300_000)
  const results: Record<string, unknown> = {}
  for (const withInk of [true, false]) {
    const files: Record<string, string> = { '大白板.md': board() }
    if (withInk) files['附件/大白板/笔迹.ink'] = ink(5000)
    const run = await launch(files, {}, (vault) => {
      const ud = join(vault, '..', 'user-data')
      mkdirSync(ud, { recursive: true })
      writeFileSync(join(ud, 'settings.json'), JSON.stringify({ appearance: { followSystem: false, skin: 'mint', frame: 'b' } }))
    })
    const { page } = run
    try {
      await run.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900))
      await openNote(page, '大白板')
      await acts(page).getByRole('tab', { name: '白板' }).click()
      const b = pane(page).getByTestId('doc-board')
      await expect(b).toBeVisible()
      if (withInk) await expect(b.getByTestId('db-ink')).toHaveAttribute('data-strokes', '5000', { timeout: 30_000 })
      await page.waitForTimeout(1500)
      const key = withInk ? '5000笔' : '没有笔迹'
      // 打开后第一次画（5000 笔的轮廓都在这一次算好）用了多久
      if (withInk) results['5000笔 打开后第一次画ms'] = Number(await b.getByTestId('db-ink').getAttribute('data-first'))
      results[`${key} 100%`] = await scroll(page, 4)
      // ⌘− 一档一档缩到最小（25%）
      await b.click({ position: { x: 600, y: 700 } })
      for (let i = 0; i < 8; i++) await page.keyboard.press('Meta+Minus')
      await expect(b.getByTestId('board-zoom')).toContainText('25%')
      await page.waitForTimeout(800)
      results[`${key} 25%`] = await scroll(page, 4)
    } finally {
      await run.close()
    }
  }
  console.log('INK_PERF ' + JSON.stringify(results, null, 1))
  if (process.env.CN_PERF_OUT) writeFileSync(process.env.CN_PERF_OUT, JSON.stringify(results, null, 1))
})
