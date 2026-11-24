/**
 * 字对它身后那一块的对比度，逐像素量（task-jgely 所有栏半透明）：页面里每段看得见的字记下框和字色、按它所在那一处的变量分成正文（--t1）和次要（--t2 / --t3），
 * 把字全藏起来再截一张，字色对它身后每个像素比，取最差的 5%（照片最亮、最暗的地方都算进去）。glass-all-shots、jgely-contrast 共用
 */
import type { Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import type { Running } from './app'

/** 一张的量法：页面里每段可见的字记下框和字色、算哪一类（正文 --t1 / 次要 --t2 --t3，按它所在那一处的变量比），藏起字再截一张，在主进程里逐像素比 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
  c: [number, number, number, number]
  k: 'body' | 'sec'
  where: string
  text: string
}

async function textBoxes(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const out: Box[] = []
    // color-mix() 算出来的色写成 color(srgb 0.3 0.4 0.5 / 0.8)（0 到 1），别的是 rgb(77, 102, 128)
    const rgba = (s: string): [number, number, number, number] => {
      const m = s.replace(/^color\(srgb/, '').match(/[\d.]+(e-?\d+)?/g)!.map(Number)
      const k = s.startsWith('color(') ? 255 : 1
      return [m[0]! * k, m[1]! * k, m[2]! * k, m[3] ?? 1]
    }
    const probe = (el: Element, v: string) => {
      const p = document.createElement('i')
      p.style.cssText = `color: var(${v}); display: none`
      el.appendChild(p)
      const c = getComputedStyle(p).color
      p.remove()
      return c
    }
    const regions: [string, string][] = [
      ['左栏', 'aside.side'],
      ['中间', 'main.center'],
      ['右栏', '.win > .dview:not([hidden])'],
      ['设置', '[role="dialog"][aria-label="设置"]'],
    ]
    for (const [where, sel] of regions) {
      for (const root of Array.from(document.querySelectorAll(sel))) {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const seen = new Set<Element>()
        while (w.nextNode()) {
          const n = w.currentNode as Text
          if (!n.data.trim()) continue
          const el = n.parentElement!
          if (seen.has(el)) continue
          seen.add(el)
          const cs = getComputedStyle(el)
          if (cs.visibility !== 'visible' || Number(cs.opacity) < 0.95) continue
          const r = document.createRange()
          r.selectNodeContents(n)
          const b0 = r.getBoundingClientRect()
          // 只量看得见的那一截：被外面滚动区、岛的圆角框裁掉的部分不算（白板卡伸出岛外那段字，后面是窗口背景图）
          let L = b0.left, T = b0.top, R = b0.right, Bt = b0.bottom
          for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
            const s = getComputedStyle(a)
            if (s.overflowX === 'visible' && s.overflowY === 'visible') continue
            const c = a.getBoundingClientRect()
            L = Math.max(L, c.left), T = Math.max(T, c.top), R = Math.min(R, c.right), Bt = Math.min(Bt, c.bottom)
          }
          if (R - L < 4 || Bt - T < 6 || (R - L) * (Bt - T) < 0.6 * b0.width * b0.height) continue
          const b = { left: L, top: T, width: R - L, height: Bt - T, right: R, bottom: Bt }
          if (b.width < 4 || b.height < 6 || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
          if (!hit || !(hit === el || el.contains(hit) || hit.contains(el))) continue
          const col = cs.color
          const k = col === probe(el, '--t1') ? 'body' : col === probe(el, '--t2') || col === probe(el, '--t3') ? 'sec' : null
          if (!k) continue
          out.push({ x: b.left, y: b.top, w: b.width, h: b.height, c: rgba(col), k, where, text: n.data.trim().slice(0, 16) })
        }
      }
    }
    return out
  })
}

export interface Result {
  body: number | null
  sec: number | null
  worstBody?: string
  worstSec?: string
  byWhere: Record<string, { body: number | null; sec: number | null; bodyAt?: string; secAt?: string }>
}

export async function measure(run: Running, dbg?: string): Promise<Result> {
  const boxes = await textBoxes(run.page)
  const css = await run.page.evaluate(() => {
    const s = document.createElement('style')
    s.id = 'glass-measure'
    s.textContent = '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; text-decoration-color: transparent !important }'
    document.head.appendChild(s)
    return true
  })
  void css
  await run.page.waitForTimeout(250)
  const res = await run.app.evaluate(async ({ BrowserWindow }, boxes) => {
    const wc = BrowserWindow.getAllWindows()[0]!.webContents
    const img = await wc.capturePage()
    const { width, height } = img.getSize()
    const bmp = img.toBitmap() // BGRA
    const vw = await wc.executeJavaScript('innerWidth')
    const s = width / vw
    const lin = (v: number) => {
      v /= 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    const lum = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const vals0 = boxes.map((bx) => {
      const vals: number[] = []
      const x0 = Math.max(0, Math.floor(bx.x * s)), x1 = Math.min(width - 1, Math.ceil((bx.x + bx.w) * s))
      const y0 = Math.max(0, Math.floor(bx.y * s)), y1 = Math.min(height - 1, Math.ceil((bx.y + bx.h) * s))
      const step = Math.max(1, Math.floor(Math.min(x1 - x0, y1 - y0) / 12))
      for (let y = y0; y <= y1; y += step)
        for (let x = x0; x <= x1; x += step) {
          const i = (y * width + x) * 4
          const B = bmp[i]!, G = bmp[i + 1]!, R = bmp[i + 2]!
          const a = bx.c[3]
          const tr = bx.c[0] * a + R * (1 - a), tg = bx.c[1] * a + G * (1 - a), tb = bx.c[2] * a + B * (1 - a)
          const L1 = lum(tr, tg, tb), L2 = lum(R, G, B)
          vals.push((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05))
        }
      vals.sort((a, b) => a - b)
      return vals.length ? vals[Math.floor(vals.length * 0.05)]! : 99
    })
    return { vals: vals0, png: img.toPNG().toString('base64') }
  }, boxes)
  await run.page.evaluate(() => document.getElementById('glass-measure')?.remove())
  if (dbg) writeFileSync(dbg, Buffer.from(res.png, 'base64'))
  const out: Result = { body: null, sec: null, byWhere: {} }
  boxes.forEach((b, i) => {
    const v = Math.round(res.vals[i]! * 100) / 100
    const w = (out.byWhere[b.where] ??= { body: null, sec: null })
    if (w[b.k] === null || v < w[b.k]!) {
      w[b.k] = v
      w[b.k === 'body' ? 'bodyAt' : 'secAt'] = `「${b.text}」@${Math.round(b.x)},${Math.round(b.y)}`
    }
    if (out[b.k] === null || v < out[b.k]!) {
      out[b.k] = v
      out[b.k === 'body' ? 'worstBody' : 'worstSec'] = `${b.where}「${b.text}」@${Math.round(b.x)},${Math.round(b.y)}`
    }
  })
  return out
}

