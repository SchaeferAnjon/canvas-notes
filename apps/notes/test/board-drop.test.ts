import { parseBoard, serializeBoard } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { addCard, addColumn, columnAt, dropOrigin, GRAB, movedEnough, putInColumn, slotInColumn, TODO_BODY } from '../src/renderer/board-drop'

const BOARD = `---
type: board
---
<!-- card id=a x=40 y=100 w=280 -->
画布上的

<!-- column id=c x=700 y=90 w=300 title="要订的" -->
<!-- card id=d in=c -->
机票

<!-- card id=e in=c -->
车

<!-- column id=z x=1200 y=90 w=300 title=空列 -->
`

// 白板画出来的位置（画布坐标）
const RECTS = {
  a: { x: 40, y: 100, w: 280, h: 60 },
  c: { x: 700, y: 90, w: 300, h: 200 },
  d: { x: 712, y: 130, w: 276, h: 50 },
  e: { x: 712, y: 190, w: 276, h: 50 },
  z: { x: 1200, y: 90, w: 300, h: 110 },
}

describe('白板落点', () => {
  it('超过几像素才算拖', () => {
    expect(movedEnough({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false)
    expect(movedEnough({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(true)
    expect(movedEnough({ x: 10, y: 10 }, { x: 10, y: 5 })).toBe(true)
  })

  it('新东西的左上角是落点减去捏住的那一点', () => {
    expect(dropOrigin({ x: 500.4, y: 300.6 })).toEqual({ x: 500 - GRAB.x, y: 301 - GRAB.y })
  })

  it('落点在哪一列：列下面多留 40；正在拖的列自己不算', () => {
    const doc = parseBoard(BOARD)
    expect(columnAt(doc, RECTS, { x: 800, y: 150 })).toBe('c')
    expect(columnAt(doc, RECTS, { x: 800, y: 320 })).toBe('c')
    expect(columnAt(doc, RECTS, { x: 800, y: 340 })).toBe(null)
    expect(columnAt(doc, RECTS, { x: 100, y: 120 })).toBe(null)
    expect(columnAt(doc, RECTS, { x: 800, y: 150 }, 'c')).toBe(null)
  })

  it('在列里排第几：按卡片中线算，正在拖的卡自己不算', () => {
    const doc = parseBoard(BOARD)
    expect(slotInColumn(doc, RECTS, 'c', 120)).toBe(0)
    expect(slotInColumn(doc, RECTS, 'c', 170)).toBe(1)
    expect(slotInColumn(doc, RECTS, 'c', 280)).toBe(2)
    expect(slotInColumn(doc, RECTS, 'c', 280, 'd')).toBe(1)
    expect(slotInColumn(doc, RECTS, 'z', 150)).toBe(0)
  })

  it('新卡放在画布上：写在最后，带 x y w', () => {
    const out = serializeBoard(addCard(parseBoard(BOARD), 'n', '', { at: { x: 300.2, y: 420.7 } }))
    expect(out.startsWith(BOARD)).toBe(true)
    expect(out).toMatch(/\n<!-- card id=n x=300 y=421 w=280 -->\n+$/)
  })

  it('新待办放进列的中间：只带 in，文件里排在两张卡之间', () => {
    const out = serializeBoard(addCard(parseBoard(BOARD), 'n', TODO_BODY, { column: 'c', slot: 1 }))
    expect(out).toContain('<!-- card id=d in=c -->\n机票\n\n<!-- card id=n in=c -->\n**待办**\n- [ ] \n\n<!-- card id=e in=c -->\n车\n')
    expect(out.match(/id=n/g)).toHaveLength(1)
  })

  it('新卡放进列的最前和最后', () => {
    const first = serializeBoard(addCard(parseBoard(BOARD), 'n', '甲', { column: 'c', slot: 0 }))
    expect(first).toContain('title="要订的" -->\n<!-- card id=n in=c -->\n甲\n\n<!-- card id=d in=c -->')
    const last = serializeBoard(addCard(parseBoard(BOARD), 'n', '乙', { column: 'c', slot: 9 }))
    expect(last).toContain('<!-- card id=e in=c -->\n车\n\n<!-- card id=n in=c -->\n乙\n\n<!-- column id=z')
  })

  it('新卡放进空列：紧跟在列后面', () => {
    const out = serializeBoard(addCard(parseBoard(BOARD), 'n', '丙', { column: 'z', slot: 0 }))
    expect(out.endsWith('<!-- column id=z x=1200 y=90 w=300 title=空列 -->\n<!-- card id=n in=z -->\n丙\n\n')).toBe(true)
  })

  it('画布上的卡拖进列：去掉 x y w，挪到落点', () => {
    const doc = parseBoard(BOARD)
    const out = serializeBoard(putInColumn(doc, 0, 'c', slotInColumn(doc, RECTS, 'c', 185, 'a')))
    expect(out).toContain('<!-- card id=d in=c -->\n机票\n\n<!-- card id=a in=c -->\n画布上的\n\n<!-- card id=e in=c -->')
    expect(out).not.toContain('id=a x=')
  })

  it('新列只放在画布上，不带 in', () => {
    const out = serializeBoard(addColumn(parseBoard(BOARD), 'n', { x: 760, y: 120 }))
    expect(out).toMatch(/\n<!-- column id=n x=760 y=120 w=300 title=新的列 -->\n+$/)
    expect(out).not.toMatch(/column id=n in=/)
  })
})
