import { decodePoints, inkStrokes, parseInk } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { INK_DOC, INK_HAND } from '../../../packages/format/test/ink-cases'
import { nibOf, roughBox, scanPoints } from '../src/renderer/doc-board/ink-draw'

// Mac 画白板笔迹（ink-draw.ts）：快读点列和 @cn/format 的 decodePoints 读出来的一样；笔尖宽照 PencilKit 实测

describe('白板笔迹：Mac 怎么画', () => {
  it('快读点列：x、y、宽、方位角和 decodePoints 一样，写法不对一样是 null', () => {
    const ps = [...inkStrokes(parseInk(INK_DOC)), ...inkStrokes(parseInk(INK_HAND))].map((s) => s.p)
    for (const p of [...ps, '', '1,2', '1,2,3,4,x', '1,2,3,4,5;1,2,3,4', '-0,0,0,0,0', '5,5,5,5,5,5,5,5,5', '1,2,3,4,5;', '--1,2,3,4,5', '1,-,3,4,5']) {
      const d = decodePoints(p)
      const s = scanPoints(p)
      if (d === null) expect(s, p).toBeNull()
      else expect(Array.from(s!), p).toEqual(d.flatMap((q) => [q.x, q.y, q.w, q.az]))
    }
  })

  it('笔尖宽（PencilKit 实测）：钢笔 2×(点宽−2)、铅笔 1.55×、荧光笔扁头 1.18× 和 0.32×（加了软边）', () => {
    const pen = nibOf('pen').nib
    expect(pen.kind === 'round' && pen.w(4)).toBe(4)
    expect(pen.kind === 'round' && pen.w(2.1)).toBe(0.5)
    const pencil = nibOf('pencil')
    expect(pencil.nib.kind === 'round' && pencil.nib.w(4)).toBeCloseTo(6.2)
    const m = nibOf('marker')
    expect(m.nib.kind === 'flat' && m.nib.along(10)).toBeCloseTo(11.8)
    expect(m.nib.kind === 'flat' && m.nib.across(10)).toBeCloseTo(3.2)
    expect(nibOf('com.apple.ink.future').nib.kind).toBe('round')
  })

  it('大概的外框包住所有控制点和笔宽', () => {
    for (const s of inkStrokes(parseInk(INK_DOC))) {
      const b = roughBox(s)!
      for (const q of decodePoints(s.p)!) {
        expect(q.x).toBeGreaterThan(b[0])
        expect(q.x).toBeLessThan(b[2])
        expect(q.y).toBeGreaterThan(b[1])
        expect(q.y).toBeLessThan(b[3])
      }
    }
  })
})
