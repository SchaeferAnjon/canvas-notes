/**
 * 量勾选框边的对比度（task-gr4sx）：换主题、截像素、找看得见的框（gr4sx-checkbox.spec.ts 用；画布今日那边是 apps/today/e2e/cb-measure.ts）。
 */
import { expect, type Page } from '@playwright/test'
import { edgeContrast, type Rgb } from '../../../packages/design/src/contrast'
import type { Running } from './app'

export const SKINS = ['mint', 'sky', 'sakura', 'lilac', 'stone', 'pine', 'petrol', 'cocoa', 'ink', 'graphite'] as const
export const LOOKS = [
  { name: 'B 极光', frame: 'b', winBg: 'aurora' },
  { name: 'B 冰洞', frame: 'b', winBg: 'cave' },
  { name: 'B 不用图', frame: 'b', winBg: 'none' },
  { name: 'A', frame: 'a', winBg: 'none' },
] as const

export const look = (skin: string, frame: string, winBg: string) => ({ appearance: { followSystem: false, skin, frame, winBg } })

/** 换主题（存进主进程，界面重新载入一次才按新的画） */
export async function setLook(page: Page, skin: string, frame: string, winBg: string) {
  await page.evaluate((p) => window.cn.setSettings(p as never), look(skin, frame, winBg))
  await page.reload()
  await page.locator('.vault b').waitFor()
  await expect(page.locator('html')).toHaveAttribute('data-skin', skin)
  await expect(page.locator('html')).toHaveAttribute('data-winbg', winBg === 'none' ? 'none' : 'photo')
  await page.waitForTimeout(300)
}

/** 窗口里几个点的像素（主进程截整窗，按比例换算；3×3 取平均） */
export async function pixels(run: Running, pts: [number, number][]): Promise<Rgb[]> {
  const vw = await run.page.evaluate(() => innerWidth)
  return run.app.evaluate(
    async ({ BrowserWindow }, { pts, vw }) => {
      const img = await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()
      const { width, height } = img.getSize()
      const sf = width / vw
      const bmp = img.toBitmap()
      return pts.map(([x, y]) => {
        const acc: [number, number, number] = [0, 0, 0]
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const px = Math.min(width - 1, Math.max(0, Math.round(x * sf) + dx))
            const py = Math.min(height - 1, Math.max(0, Math.round(y * sf) + dy))
            const i = (py * width + px) * 4
            acc[0] += bmp[i + 2]!
            acc[1] += bmp[i + 1]!
            acc[2] += bmp[i]!
          }
        return acc.map((v) => v / 9) as [number, number, number]
      })
    },
    { pts, vw },
  )
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
  border: string
  bg: string
}

/** 看得见的框（sel 只挑没勾、不是 ⏫ 的） */
export async function boxes(page: Page, sel: string): Promise<Box[]> {
  return page.evaluate((sel) => {
    const out: Box[] = []
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const r = el.getBoundingClientRect()
      if (r.width < 8 || r.bottom < 0 || r.top > innerHeight || !el.checkVisibility()) continue
      const s = getComputedStyle(el)
      out.push({ x: r.x, y: r.y, w: r.width, h: r.height, border: s.borderTopColor, bg: s.backgroundColor })
    }
    return out.slice(0, 8)
  }, sel)
}

/** 每个框的边对框里（正中）、框外（左边 3px）的底色，取最差的那个 */
export async function worst(run: Running, bs: Box[]): Promise<number> {
  const pts: [number, number][] = []
  for (const b of bs) pts.push([b.x + b.w / 2, b.y + b.h / 2], [b.x - 3, b.y + b.h / 2])
  const px = await pixels(run, pts)
  return Math.min(...bs.map((b, i) => edgeContrast(b.border, px[2 * i]!, px[2 * i + 1]!)))
}
