import { attr, content, parseBoard, serializeBoard } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { align, duplicateCard, intoNewColumn, takeOut, tidyGrid } from '../src/renderer/ctx/board-ops'

const TEXT = `---
type: board
---
# 板

<!-- card id=a x=100 y=50 w=280 -->
甲

<!-- card id=b x=400 y=20 w=280 -->
乙

<!-- column id=c x=800 y=0 w=300 title="列" -->

<!-- card id=d in=c -->
丁

<!-- card id=e in=c -->
戊
`

const doc = () => parseBoard(TEXT)
const pos = (d: ReturnType<typeof parseBoard>, id: string) => {
  const b = d.blocks.find((x) => attr(x, 'id') === id)!
  return { x: attr(b, 'x'), y: attr(b, 'y'), in: attr(b, 'in') }
}
const rects = { a: { x: 100, y: 50, w: 280, h: 80 }, b: { x: 400, y: 20, w: 280, h: 120 }, d: { x: 810, y: 40, w: 280, h: 60 } }

describe('白板右键的整理', () => {
  it('复制一份：画布上的往右下错开，内容一样', () => {
    const r = duplicateCard(doc(), 'a')
    expect(pos(r.doc, r.id)).toEqual({ x: '124', y: '74', in: undefined })
    expect(content(r.doc.blocks.find((b) => attr(b, 'id') === r.id)!)).toBe('甲')
    expect(parseBoard(serializeBoard(r.doc)).blocks).toHaveLength(6)
  })
  it('复制一份：列里的放在它下面一格', () => {
    const r = duplicateCard(doc(), 'd')
    const ids = r.doc.blocks.filter((b) => attr(b, 'in') === 'c').map((b) => attr(b, 'id'))
    expect(ids).toEqual(['d', r.id, 'e'])
  })
  it('从列里拿出来：放到列右边，不再在列里', () => {
    expect(pos(takeOut(doc(), 'd', rects.d), 'd')).toEqual({ x: '1114', y: '40', in: undefined })
  })
  it('左对齐、顶对齐：列里的不动', () => {
    const l = align(doc(), ['a', 'b', 'd'], 'left')
    expect([pos(l, 'a').x, pos(l, 'b').x, pos(l, 'd').in]).toEqual(['100', '100', 'c'])
    const t = align(doc(), ['a', 'b'], 'top')
    expect([pos(t, 'a').y, pos(t, 'b').y]).toEqual(['20', '20'])
  })
  it('排整齐：按上下左右的顺序排成格子', () => {
    const g = tidyGrid(doc(), ['a', 'b'], rects)
    // b 更靠上，排第一个
    expect([pos(g, 'b'), pos(g, 'a')]).toEqual([
      { x: '100', y: '20', in: undefined },
      { x: '404', y: '20', in: undefined },
    ])
  })
  it('放进新列：建一列，按原来的上下顺序放进去', () => {
    const n = intoNewColumn(doc(), ['a', 'b'], rects)
    const col = n.blocks.find((b) => b.kind === 'column' && attr(b, 'id') !== 'c')!
    const id = attr(col, 'id')!
    expect(n.blocks.filter((b) => attr(b, 'in') === id).map((b) => attr(b, 'id'))).toEqual(['b', 'a'])
    expect([attr(col, 'x'), attr(col, 'y')]).toEqual(['100', '20'])
  })
})
