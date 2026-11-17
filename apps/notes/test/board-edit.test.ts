/**
 * 真白板上改卡时外面改了白板（第 6 轮）：外面删了正在改的卡、外面只挪了这张卡、外面改了别的卡、外面也改了这张卡的字。
 */
import { parseBoard, serializeBoard } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { cardSave, keepEditing } from '../src/renderer/board-edit'

const BOARD = (c1: string, pos = 'x=260 y=0') =>
  `---\ntype: board\n---\n<!-- card id=c0 x=0 y=0 w=220 -->\n## 十一月\n\n<!-- card id=c1 ${pos} w=220 -->\n${c1}\n\n<!-- card id=c2 x=520 y=0 w=220 -->\n## 想写的\n`
const base = BOARD('## 十二月')
const deleted = base.replace('<!-- card id=c1 x=260 y=0 w=220 -->\n## 十二月\n\n', '')

describe('cardSave：改卡的框存下时', () => {
  it('外面把正在改的卡删了：卡和我打的字放回去，外面那版存成副本，说是删了', () => {
    const r = cardSave(base, deleted, 'c1', '## 十二月正在写的一大段字')
    expect(r.kind).toBe('conflict')
    if (r.kind !== 'conflict') return
    expect(r.deleted).toBe(true)
    expect(r.text).toBe(BOARD('## 十二月正在写的一大段字'))
    expect(r.theirs).toBe(deleted)
  })

  it('外面只挪了这张卡的位置：字是我的、位置是外面的，不出副本', () => {
    const moved = BOARD('## 十二月', 'x=600 y=400')
    const r = cardSave(base, moved, 'c1', '## 十二月我写')
    expect(r).toEqual({ kind: 'update', text: BOARD('## 十二月我写', 'x=600 y=400'), merged: true })
  })

  it('外面改的是别的卡：合在一起', () => {
    const other = base.replace('## 想写的', '## 想写的外面')
    const r = cardSave(base, other, 'c1', '## 十二月我的')
    expect(r).toEqual({ kind: 'update', text: BOARD('## 十二月我的').replace('## 想写的', '## 想写的外面'), merged: true })
  })

  it('外面也改了这张卡的字：留我的，外面那版存副本，不算删', () => {
    const r = cardSave(base, BOARD('## 十二月外面'), 'c1', '## 十二月我的')
    expect(r.kind).toBe('conflict')
    if (r.kind !== 'conflict') return
    expect(r.deleted).toBe(false)
    expect(r.text).toBe(BOARD('## 十二月我的'))
  })

  it('外面没改：照常写', () => {
    expect(cardSave(base, base, 'c1', '## 十二月我的')).toEqual({ kind: 'update', text: BOARD('## 十二月我的'), merged: false })
    expect(cardSave(base, base, 'c1', '## 十二月')).toEqual({ kind: 'none' })
  })
})

describe('keepEditing：开着框时卡被外面删了', () => {
  it('照开框时的样子画回原来的位置；卡还在、没在改、没有底时原样', () => {
    const doc = keepEditing(parseBoard(deleted), base, 'c1')
    expect(serializeBoard(doc)).toBe(base)
    const same = parseBoard(base)
    expect(keepEditing(same, base, 'c1')).toBe(same)
    const gone = parseBoard(deleted)
    expect(keepEditing(gone, base, null)).toBe(gone)
    expect(keepEditing(gone, null, 'c1')).toBe(gone)
  })
})
