import { describe, expect, it } from 'vitest'
import { lanesOf } from '../src/renderer/reading/PdfMarks'
import type { ReadingThread } from '../src/shared/reading'

const th = (id: string, y: number, h: number): ReadingThread => ({ id, page: 1, rect: [0.1, y, 0.5, h], createdAt: 0 })
const lane = (ts: ReadingThread[], H = 1000) => Object.fromEntries(lanesOf(ts, H).map((k) => [k.t.id, k.lane]))

describe('读 PDF 纸里一列问过的：竖线排几道（task-2onrm）', () => {
  it('隔开的都在第一道；上下挨着（不到 4 像素）、叠着的换下一道', () => {
    expect(lane([th('a', 0.1, 0.05), th('b', 0.3, 0.05)])).toEqual({ a: 0, b: 0 })
    expect(lane([th('a', 0.1, 0.1), th('b', 0.15, 0.1)])).toEqual({ a: 0, b: 1 })
    // a 下沿 200，b 上沿 202：挨着不到 4 像素，错开
    expect(lane([th('a', 0.1, 0.1), th('b', 0.202, 0.05)])).toEqual({ a: 0, b: 1 })
    // 第一道空出来了就回第一道
    expect(lane([th('a', 0.1, 0.1), th('b', 0.15, 0.1), th('c', 0.3, 0.02)])).toEqual({ a: 0, b: 1, c: 0 })
  })
  it('最多三道，再多的叠在第三道；没有框的（问整页）是整页那么长', () => {
    expect(lane([th('a', 0.1, 0.3), th('b', 0.12, 0.3), th('c', 0.14, 0.3), th('d', 0.16, 0.3)])).toEqual({ a: 0, b: 1, c: 2, d: 2 })
    const whole: ReadingThread = { id: 'w', page: 1, createdAt: 0 }
    const ks = lanesOf([th('a', 0.5, 0.1), whole], 1000)
    expect(ks.map((k) => [k.t.id, k.top, k.h, k.lane])).toEqual([
      ['w', 0, 1, 0],
      ['a', 0.5, 0.1, 1],
    ])
  })
  it('框很矮也按最短 8 像素占位：紧跟着的下一处换道', () => {
    // a 只有 2 像素高（占到 108），b 从 110 起：不到 4 像素，换道
    expect(lane([th('a', 0.1, 0.002), th('b', 0.11, 0.05)])).toEqual({ a: 0, b: 1 })
  })
})
