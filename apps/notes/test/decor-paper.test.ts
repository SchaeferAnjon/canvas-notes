// 便签纸色只有一份：packages/format 的 NOTE_PAPER；Mac 的 decor.css 里浅深两套 --p0/--p1/--p2 要和它一样（iPad 的 DecorPaint 直接用 CanvasCore 的同一份）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NOTE_COLORS, NOTE_PAPER } from '@cn/format'

const css = readFileSync(join(__dirname, '../src/renderer/doc-board/decor/decor.css'), 'utf8')

/** 这个纸色那一段规则里的三档：浅色是不带 data-tone 的那段，深色是 :root[data-tone='dark'] 那段 */
function paperOf(color: string, dark: boolean): string[] {
  const sel = `${dark ? ":root[data-tone='dark'] " : ''}.dc-note[data-note='${color}']`
  let from = -1
  for (let i = css.indexOf(sel); i !== -1; i = css.indexOf(sel, i + 1)) {
    const lineStart = css.lastIndexOf('\n', i) + 1
    if (dark || !css.slice(lineStart, i).includes('data-tone')) {
      from = i
      break
    }
  }
  expect(from, sel).toBeGreaterThanOrEqual(0)
  const body = css.slice(css.indexOf('{', from), css.indexOf('}', from))
  return [0, 1, 2].map((i) => new RegExp(`--p${i}:\\s*(#[0-9a-fA-F]{6})`).exec(body)![1]!.toUpperCase())
}

describe('便签纸色：decor.css 和 NOTE_PAPER 一样', () => {
  for (const c of NOTE_COLORS)
    it(c, () => {
      expect(paperOf(c, false)).toEqual([...NOTE_PAPER[c].light])
      expect(paperOf(c, true)).toEqual([...NOTE_PAPER[c].dark])
    })
})
