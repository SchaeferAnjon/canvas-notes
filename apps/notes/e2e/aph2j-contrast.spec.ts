/**
 * 主题渐变上的字和图标看得清（task-aph2j）：十套 × 浓淡三档 × 不动 / 动到三个位置，B 量直接画在渐变上的图标、底栏的字、
 * 半透明面板（待办首页）上的正文、次要字、更弱的字；A + 渐变量标题栏和两条图标栏上的图标。
 * 量法同设计稿 26-纯色背景渐变：整窗截一张把字和图标藏起来的图，每个字、每个图标所在那一块的底色逐点取，
 * 用最差的那一点和它自己的颜色（半透明的先叠在那一点上）算对比度。
 * 要求：正文 ≥ 7，按钮和标签上的字、次要字 ≥ 4.5（DESIGN.md「每套都过对比度」），更弱的字、图标 ≥ 3（themes-css.test.ts）。
 * APH_CONTRAST_OUT=<文件> 时把每一格的最差值写成 JSON（交付页的表用它）。
 */
import { expect, type Page, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { open } from './aph2j-look'
import type { Running } from './app'

const SKINS = ['mint', 'sky', 'sakura', 'lilac', 'stone', 'pine', 'petrol', 'cocoa', 'ink', 'graphite']
const MIXES = ['soft', 'mid', 'rich'] as const
/** 不动（transform 原样），「快」那一档（挪得最远）动到 33%、66%、100% 那三个关键帧 */
const POSES = [null, 0.33, 0.66, 1] as const

/** control：按钮、标签、分段里的字（设计稿：按钮字不算正文，照次要字 4.5 要求） */
type Kind = 'body' | 'control' | 'second' | 'weak' | 'icon'
interface Target {
  kind: Kind
  where: string
  x: number
  y: number
  w: number
  h: number
  color: string
  /** 哪个字 / 哪颗按钮（没过时报出来） */
  label: string
}
const NEED: Record<Kind, number> = { body: 7, control: 4.5, second: 4.5, weak: 3, icon: 3 }

/** 页面里要量的字和图标：位置、颜色、算哪一类 */
async function targets(page: Page, frame: 'a' | 'b'): Promise<Target[]> {
  return page.evaluate((frame) => {
    const out: Target[] = []
    const solidOpacity = (el: Element | null) => {
      for (let e = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.99) return false
      return true
    }
    const vis = (r: DOMRect) => r.width > 2 && r.height > 2 && r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight
    // 直接画在渐变上的图标：两条图标栏没亮、没变淡的，标题栏的按钮
    const icons = [...document.querySelectorAll('.abar .ab:not(.on):not(.dim) svg, .titlebar .tb-btn:not(:disabled) svg')]
    for (const svg of icons) {
      const btn = svg.closest('button')!
      const r = svg.getBoundingClientRect()
      if (!vis(r) || !solidOpacity(btn)) continue
      out.push({ kind: 'icon', where: btn.closest('.titlebar') ? '标题栏' : '图标栏', x: r.x, y: r.y, w: r.width, h: r.height, color: getComputedStyle(btn).color, label: btn.getAttribute('aria-label') ?? '' })
    }
    if (frame === 'a') return out
    // 字：底栏、半透明的中间岛（待办首页）。按它的颜色等于这一处的 --t1 / --t2 / --t3 分类，别的颜色（强调色、红字）不算
    // 左栏、中间、右栏（AI 那一组）三块半透明的岛（<html data-glass>，task-jgely 合进来的那一路），底栏
    const areas: [string, Element | null][] = [
      ['底栏', document.querySelector('.frame-b > .status')],
      ['左栏', document.querySelector('.frame-b > .side')],
      ['中间', document.querySelector('.frame-b > .center')],
      ['右栏', document.querySelector('.frame-b > .dview[data-view="ai"]')],
    ]
    for (const [where, root] of areas) {
      if (!root || !document.documentElement.hasAttribute('data-glass')) continue
      const probe = document.createElement('span')
      const tone = (v: string) => {
        probe.style.color = `var(${v})`
        root.appendChild(probe)
        const c = getComputedStyle(probe).color
        probe.remove()
        return c
      }
      const t1 = tone('--t1'),
        t2 = tone('--t2'),
        t3 = tone('--t3')
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!n.textContent?.trim()) continue
        const el = n.parentElement!
        const c = getComputedStyle(el).color
        const ctl = !!el.closest('button, [role="tab"], [role="radio"], [role="menuitem"], .tab')
        const kind: Kind | null = c === t1 ? (ctl ? 'control' : 'body') : c === t2 ? 'second' : c === t3 ? 'weak' : null
        if (!kind || !solidOpacity(el)) continue
        const range = document.createRange()
        range.selectNodeContents(n)
        for (const r of range.getClientRects()) if (vis(r)) out.push({ kind, where, x: r.x, y: r.y, w: r.width, h: r.height, color: c, label: n.textContent.trim().slice(0, 16) })
      }
    }
    return out
  }, frame)
}

/** 藏起字和图标截一张，主进程里逐点算每个目标最差的对比度 */
async function measure(run: Running, list: Target[]) {
  const { page, app } = run
  await page.evaluate(() => {
    const st = document.createElement('style')
    st.id = 'aph-hide'
    st.textContent =
      '*{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important}*::placeholder{color:transparent!important}svg{visibility:hidden!important}'
    document.head.appendChild(st)
  })
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
  // 机器忙时截图可能还是藏字前那一帧：再等一会儿
  await page.waitForTimeout(250)
  const res: { kind: Kind; where: string; worst: number; label: string }[] = await app.evaluate(async ({ BrowserWindow }, list) => {
    const w = BrowserWindow.getAllWindows()[0]!
    const img = await w.webContents.capturePage()
    const size = img.getSize()
    const scale = size.width / w.getContentBounds().width
    const bmp = img.toBitmap()
    const lin = (v: number) => {
      const s = v / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }
    const L = (r: number, g: number, b: number) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    const parse = (c: string): [number, number, number, number] => {
      let m = c.match(/^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/)
      if (m) return [+m[1]!, +m[2]!, +m[3]!, m[4] === undefined ? 1 : +m[4]]
      m = c.match(/^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/)
      if (m) return [+m[1]! * 255, +m[2]! * 255, +m[3]! * 255, m[4] === undefined ? 1 : +m[4]]
      throw new Error(`认不出的颜色 ${c}`)
    }
    return list.map((t) => {
      const [fr, fg, fb, fa] = parse(t.color)
      let worst = Infinity
      const x0 = Math.max(0, Math.round(t.x * scale) + 1),
        y0 = Math.max(0, Math.round(t.y * scale) + 1)
      const x1 = Math.min(size.width, Math.round((t.x + t.w) * scale) - 1),
        y1 = Math.min(size.height, Math.round((t.y + t.h) * scale) - 1)
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const i = (y * size.width + x) * 4
          const b = bmp[i]!,
            g = bmp[i + 1]!,
            r = bmp[i + 2]!
          const lf = L(fr * fa + r * (1 - fa), fg * fa + g * (1 - fa), fb * fa + b * (1 - fa))
          const lb = L(r, g, b)
          const k = (Math.max(lf, lb) + 0.05) / (Math.min(lf, lb) + 0.05)
          if (k < worst) worst = k
        }
      return { kind: t.kind, where: t.where, label: t.label, worst: Number.isFinite(worst) ? +worst.toFixed(2) : 99 }
    })
  }, list)
  await page.evaluate(() => document.getElementById('aph-hide')?.remove())
  return res
}

/** 每一类、每一处最差的那个 */
function worstOf(res: { kind: Kind; where: string; worst: number; label: string }[]) {
  const w: Record<string, number> = {}
  for (const r of res) {
    const k = `${r.where}·${r.kind}`
    if (r.worst < (w[k] ?? 99)) {
      w[k] = r.worst
      labels[k] = r.label
    }
  }
  return w
}
/** 每一格最差的是哪个字（只给没过的报名字用） */
const labels: Record<string, string> = {}

/** 色块那一层停在动画的某个位置（null = 不动） */
async function pose(page: Page, at: number | null) {
  await page.evaluate((at) => {
    const r = document.documentElement
    if (at === null) {
      delete r.dataset.wallmove
      return
    }
    r.dataset.wallmove = 'fast'
    const a = document.querySelector('.cn-wall > i')!.getAnimations()[0]!
    a.pause()
    a.currentTime = Number((a.effect as KeyframeEffect).getTiming().duration) * at
  }, at)
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
}

const table: Record<string, Record<string, number>> = {}
test.afterAll(() => {
  if (process.env.APH_CONTRAST_OUT) writeFileSync(process.env.APH_CONTRAST_OUT, JSON.stringify(table, null, 2))
})

for (const skin of process.env.APH_SKINS?.split(',') ?? SKINS)
  test(`${skin}：B + 渐变 浓淡三档 × 不动 / 动的三个位置；A + 渐变的图标`, async () => {
    test.setTimeout(240_000)
    const fails: string[] = []
    const check = (label: string, w: Record<string, number>) => {
      table[`${skin}|${label}`] = w
      for (const [k, v] of Object.entries(w)) {
        const kind = k.split('·')[1] as Kind
        if (v < NEED[kind]) fails.push(`${label} ${k}「${labels[k]}」${v} < ${NEED[kind]}`)
      }
    }
    // B：文档开着（文档正文、左栏「最近」、右栏 AI、图标栏、标题栏、底栏），再换到待办首页
    let run = await open({ skin, frame: 'b', winBg: 'wall' })
    try {
      const { page } = run
      await expect(page.locator('html')).toHaveAttribute('data-glass', '')
      for (const where of ['文档', '待办首页'] as const) {
        if (where === '待办首页') {
          await page.getByRole('navigation', { name: '左栏' }).getByRole('button', { name: '待办', exact: true }).click()
          await expect(page.getByTestId('todo-home')).toBeVisible()
          await page.waitForTimeout(400)
        }
        for (const mix of MIXES)
          for (const at of POSES) {
            await page.evaluate((m) => (document.documentElement.dataset.wallmix = m), mix)
            await pose(page, at)
            const list = await targets(page, 'b')
            expect(list.filter((t) => t.kind === 'icon').length).toBeGreaterThan(8)
            expect(list.filter((t) => t.where === '中间' && t.kind === 'body').length).toBeGreaterThan(3)
            check(`B ${where} ${mix} ${at === null ? '不动' : `动到${Math.round(at * 100)}%`}`, worstOf(await measure(run, list)))
          }
      }
    } finally {
      await run.close()
    }
    // A：标题栏、两条图标栏透出渐变
    run = await open({ skin, frame: 'a', winBg: 'wall' })
    try {
      const { page } = run
      for (const mix of MIXES)
        for (const at of [null, 0.66] as const) {
          await page.evaluate((m) => (document.documentElement.dataset.wallmix = m), mix)
          await pose(page, at)
          const list = await targets(page, 'a')
          expect(list.length).toBeGreaterThan(8)
          check(`A ${mix} ${at === null ? '不动' : '动到66%'}`, worstOf(await measure(run, list)))
        }
    } finally {
      await run.close()
    }
    expect(fails).toEqual([])
  })
