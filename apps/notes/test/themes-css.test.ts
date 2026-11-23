import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SKINS } from '../src/shared/appearance'
import { contrast, parseColor } from '../src/shared/vscode-theme'

// 自带的十套主题（packages/design/src/themes.css）：变量齐全、字看得清、窗口刚建时的底色和 --win 一致
const css = readFileSync(join(__dirname, '../../../packages/design/src/themes.css'), 'utf8')
const blocks = new Map<string, Record<string, string>>()
for (const m of css.matchAll(/\[data-skin='([a-z]+)'\] \{([^}]*)\}/g)) {
  const vars: Record<string, string> = {}
  for (const v of m[2]!.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) vars[v[1]!] = v[2]!.trim()
  blocks.set(m[1]!, vars)
}
const NEED = 'title bar side win tabbar tab-on status status-t board dotc card clip clip-bar pop t1 t2 t3 line line2 fill fill2 solid solid-t acc acc-bg acc-t acc-soft acc-ring shadow shadow-up glass green yellow red wire w0 w1 w2 w3 w4 r-card r-wid seg-on'.split(' ')
const hex = (v: string | undefined) => {
  const c = parseColor(v)
  if (!c) throw new Error(`不是实色：${v}`)
  return c
}

describe('自带的十套主题', () => {
  it('每套都有一段样式，变量一个不少', () => {
    expect([...blocks.keys()].sort()).toEqual(SKINS.map((s) => s.id).sort())
    for (const [id, v] of blocks) for (const k of NEED) expect(v[k], `${id} --${k}`).toBeTruthy()
  })

  // 分段控件的选中格是淡底（偏好「图标别做白底突起块」：统一底色上只放符号，选中靠颜色和细指示），和选中行同一个 --fill2
  it('分段选中格 --seg-on 每套都是 --fill2，不是白底', () => {
    for (const [id, v] of blocks) expect(v['seg-on'], id).toBe('var(--fill2)')
  })

  it.each(SKINS.map((s) => [s.id, s] as const))('%s：正文对底 ≥ 7:1，次要字 ≥ 4.5:1，底栏的字、强调底上的字看得清，--win 和窗口底色一致', (id, s) => {
    const v = blocks.get(id)!
    const win = hex(v.win)
    expect(contrast(hex(v.t1), win)).toBeGreaterThanOrEqual(7)
    expect(contrast(hex(v.t2), win)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(hex(v.t2), hex(v.side))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(hex(v['status-t']), hex(v.status))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(hex(v['acc-on'] ?? '#ffffff'), hex(v['acc-bg']))).toBeGreaterThanOrEqual(4.5)
    expect(contrast(hex(v['acc-t']), win)).toBeGreaterThanOrEqual(4.5)
    expect(v.win).toBe(s.win)
    expect(v['color-scheme'] ?? css.match(new RegExp(`\\[data-skin='${id}'\\] \\{\\s*color-scheme: (\\w+)`))?.[1]).toBe(s.tone)
  })

  // 读 PDF 纸里那一列问过的竖线（task-2onrm）画在纸上：纸不跟主题，浅色是白纸（竖条处 #f9f9f9），深色压暗到 #ebebeb（竖条处 #e5e5e5）；
  // 竖线用 --acc-paper（没给就是 --acc），指着时不透明，对纸 ≥ 3（图形元素）
  it.each(SKINS.map((s) => [s.id, s] as const))('%s：--acc-paper 画在纸上 ≥ 3:1', (id, s) => {
    const v = blocks.get(id)!
    const paper = hex(s.tone === 'dark' ? '#e5e5e5' : '#f9f9f9')
    expect(contrast(hex(v['acc-paper'] ?? v.acc), paper)).toBeGreaterThanOrEqual(3)
  })

  // 「写不进去，字只在内存里」是红字（第 6 轮）：12px 也要 ≥ 4.5。--red 是点的颜色，字用 --red-t（没给就是 --red）；
  // A 的底栏是彩色一条的主题（天青、深湖）那一项换成红底白字（--status-err-bg / --status-err-t，照 VS Code 的 errorBackground）
  it.each(SKINS.map((s) => [s.id] as const))('%s：红字对编辑区、侧栏、标签条、两种底栏都 ≥ 4.5', (id) => {
    const v = blocks.get(id)!
    const red = hex(v['red-t'] ?? v.red)
    for (const k of ['win', 'side', 'tabbar', 'tab-on', 'title']) expect(contrast(red, hex(v[k])), `${id} --red-t 对 ${k}`).toBeGreaterThanOrEqual(4.5)
    const errBg = v['status-err-bg'] ?? v.status
    const errT = v['status-err-t'] ?? v['red-t'] ?? v.red
    expect(contrast(hex(errT), hex(errBg)), `${id} A 底栏的写不进去`).toBeGreaterThanOrEqual(4.5)
  })

  // 先给你看里少了整节（task-1l29q）：红字写在 --pop 的横条上，横条铺 8% 的 --red（color-mix）；设计复审量到深湖 4.00、松林 3.95
  it.each(SKINS.map((s) => [s.id] as const))('%s：红字对弹层底 --pop、对铺了 8% 红的横条都 ≥ 4.5', (id) => {
    const v = blocks.get(id)!
    const red = hex(v['red-t'] ?? v.red)
    const pop = hex(v.pop)
    const dot = hex(v.red)
    const tinted = [0, 1, 2].map((i) => dot[i]! * 0.08 + pop[i]! * 0.92).concat(1) as [number, number, number, number]
    expect(contrast(red, pop), `${id} --red-t 对 --pop`).toBeGreaterThanOrEqual(4.5)
    expect(contrast(red, tinted), `${id} --red-t 对 8% 红的 --pop`).toBeGreaterThanOrEqual(4.5)
  })

  // 「更弱」的字（时间、篇数、说明、占位）也要看得清（第 2 轮美学：天青 2.65、深湖 2.87 读着费劲）：
  // 对每一块实底，和选中行、悬停行（--fill2 / --fill 叠在 --win、--side、--pop、--card 上）都 ≥ 3:1；还得比 --t2 淡
  it.each(SKINS.map((s) => [s.id] as const))('%s：--t3 对各块底色、选中和悬停的行 ≥ 3:1，仍比 --t2 淡', (id) => {
    const v = blocks.get(id)!
    const rgba = (c: string): [number, number, number, number] => {
      const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(c)
      return m ? [+m[1]!, +m[2]!, +m[3]!, +m[4]!] : hex(c)
    }
    const over = (top: string, bottom: string) => {
      const [t, b] = [rgba(top), hex(bottom)]
      return [0, 1, 2].map((i) => t[i]! * t[3] + b[i]! * (1 - t[3])).concat(1) as [number, number, number, number]
    }
    const t3 = hex(v.t3)
    const grounds: [string, [number, number, number, number]][] = ['title', 'bar', 'side', 'win', 'tabbar', 'tab-on', 'board', 'card', 'clip', 'pop'].map((k) => [k, hex(v[k])])
    for (const f of ['fill', 'fill2']) for (const k of ['win', 'side', 'pop', 'card']) grounds.push([`${f}/${k}`, over(v[f]!, v[k]!)])
    for (const [k, g] of grounds) expect(contrast(t3, g), `${id} --t3 对 ${k}`).toBeGreaterThanOrEqual(3)
    expect(contrast(hex(v.t2), hex(v.win))).toBeGreaterThan(contrast(t3, hex(v.win)))
  })

  // 导图配色「彩虹」（task-wuv05 第二批 ⑩）：第一层每枝一个颜色。线（2px 连线、下划线）对白板底 ≥ 3:1；
  // 第一层卡片铺 16% 的这个颜色，卡片上的主题字 ≥ 4.5:1（13px 的字照 WCAG AA）；六个颜色两两分得开
  it.each(SKINS.map((s) => [s.id] as const))('%s：导图彩虹配色的六个颜色线看得见、卡片上的字看得清、彼此分得开', (id) => {
    const v = blocks.get(id)!
    const board = hex(v.board)
    const card = hex(v.card)
    const t1 = hex(v.t1)
    const cols = [0, 1, 2, 3, 4, 5].map((i) => hex(v[`mm-b${i}`]))
    for (const [i, c] of cols.entries()) {
      expect(contrast(c, board), `${id} --mm-b${i} 对白板底`).toBeGreaterThanOrEqual(3)
      const tint: [number, number, number, number] = [0, 1, 2].map((k) => c[k]! * 0.16 + card[k]! * 0.84).concat(1) as [number, number, number, number]
      expect(contrast(t1, tint), `${id} 正文对 --mm-b${i} 16% 的卡片`).toBeGreaterThanOrEqual(4.5)
    }
    for (let i = 0; i < 6; i++)
      for (let j = i + 1; j < 6; j++) {
        const [a, b] = [cols[i]!, cols[j]!]
        expect(Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]), `${id} --mm-b${i} 和 --mm-b${j}`).toBeGreaterThan(60)
      }
  })

  it('配色真不一样：两两之间编辑区、侧栏、强调色至少有一样差得多', () => {
    const ids = [...blocks.keys()]
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = [blocks.get(ids[i]!)!, blocks.get(ids[j]!)!]
        const far = ['win', 'side', 'acc'].some((k) => {
          const [x, y] = [hex(a[k]), hex(b[k])]
          return Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]) > 40
        })
        expect(far, `${ids[i]} 和 ${ids[j]}`).toBe(true)
      }
  })
})
