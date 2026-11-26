// 文件夹图标、AI 对话菜单组头图标的颜色对菜单底色（--pop）够不够 3:1（2026-11-25 对话菜单分组）：
// 从 themes.css 读十套主题的 --pop、--t1、--acc-t 和浅深，从 files/look.css 读深色主题往 --t1 掺多少，八种 FOLDER_COLORS 一个个算
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FOLDER_COLORS } from '../src/shared/left'

const root = join(__dirname, '..', '..', '..')
const themes = readFileSync(join(root, 'packages/design/src/themes.css'), 'utf8')
const look = readFileSync(join(root, 'apps/notes/src/renderer/files/look.css'), 'utf8')
const menu = readFileSync(join(root, 'apps/notes/src/renderer/ai.css'), 'utf8')

type Skin = { name: string; dark: boolean; pop: string; t1: string; accT: string }
function skins(): Skin[] {
  const out: Skin[] = []
  for (const m of themes.matchAll(/\[data-skin='([a-z]+)'\]\s*\{([\s\S]*?)\n\}/g)) {
    const body = m[2]!
    const v = (k: string) => body.match(new RegExp(`\\n\\s*--${k}:\\s*(#[0-9a-f]{6})\\s*;`, 'i'))?.[1]
    const pop = v('pop')
    if (!pop) continue
    out.push({ name: m[1]!, dark: /color-scheme:\s*dark/.test(body), pop, t1: v('t1')!, accT: v('acc-t')! })
  }
  return out
}

const rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const lum = (c: number[]) => 0.2126 * lin(c[0]!) + 0.7152 * lin(c[1]!) + 0.0722 * lin(c[2]!)
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}
/** color-mix(in srgb, a p%, b) */
const mix = (a: number[], b: number[], p: number) => a.map((v, i) => v * p + b[i]! * (1 - p))

const k = Number(look.match(/\[data-tone='dark'\] \.fglyph\.tint \{\s*color: color-mix\(in srgb, var\(--fc\) (\d+)%, var\(--t1\)\)/)![1]) / 100

describe('文件夹图标颜色对菜单底色 ≥ 3:1（十套主题）', () => {
  const all = skins()

  it('读到十套主题，五浅五深；菜单底色是 --pop，没文件夹颜色的组头图标是 --acc-t', () => {
    expect(all.map((s) => s.name)).toEqual(['mint', 'sky', 'sakura', 'lilac', 'stone', 'pine', 'petrol', 'cocoa', 'ink', 'graphite'])
    expect(all.filter((s) => s.dark)).toHaveLength(5)
    expect(menu).toMatch(/\.aih \.convmenu \{[^}]*background: var\(--pop\)/)
    expect(menu).toMatch(/\.convmenu \.gh \.gi:not\(\.tint\) \{\s*color: var\(--acc-t\)/)
    expect(k).toBe(0.7)
  })

  for (const s of skins())
    it(`${s.name}：八种文件夹颜色${s.dark ? `（掺 ${Math.round((1 - k) * 100)}% --t1）` : ''}和 --acc-t 都 ≥ 3:1`, () => {
      const pop = rgb(s.pop)
      const rows = Object.entries(FOLDER_COLORS).map(([name, hex]) => {
        const c = s.dark ? mix(rgb(hex), rgb(s.t1), k) : rgb(hex)
        return [name, Math.round(ratio(c, pop) * 100) / 100] as const
      })
      rows.push(['acc-t', Math.round(ratio(rgb(s.accT), pop) * 100) / 100])
      for (const [name, r] of rows) expect(r, `${s.name} ${name}`).toBeGreaterThanOrEqual(3)
    })
})
