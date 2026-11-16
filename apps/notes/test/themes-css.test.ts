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
