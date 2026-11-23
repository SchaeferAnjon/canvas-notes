import { describe, expect, it } from 'vitest'
import { alignPlaced, boxOf, hitKeys, touches } from '../src/renderer/doc-board/board-select'
import { barSpot } from '../src/renderer/multi-select/SelBar'

/** 白板框选（task-5ryf9）：碰到就选、对齐和等距只挪空白处的几张；操作条浮在选区上方 10，放不下翻到下面 */
describe('框碰到就选', () => {
  it('有一点重叠就算；只贴着边、在外面不算；哪个方向拖都一样', () => {
    const card = { left: 100, top: 100, right: 376, bottom: 170 }
    expect(touches(boxOf({ x: 0, y: 0 }, { x: 101, y: 101 }), card)).toBe(true)
    expect(touches(boxOf({ x: 101, y: 101 }, { x: 0, y: 0 }), card)).toBe(true)
    expect(touches(boxOf({ x: 0, y: 0 }, { x: 100, y: 300 }), card)).toBe(false)
    expect(touches(boxOf({ x: 400, y: 0 }, { x: 500, y: 500 }), card)).toBe(false)
    const cards = [
      { key: 'a', r: card },
      { key: 'b', r: { left: 400, top: 150, right: 676, bottom: 260 } },
      { key: 'c', r: { left: 800, top: 600, right: 1076, bottom: 671 } },
    ]
    expect(hitKeys(boxOf({ x: 90, y: 80 }, { x: 420, y: 160 }), cards)).toEqual(['a', 'b'])
  })
})

describe('对齐、等距、排整齐：只挪空白处的那几张', () => {
  const W = 276
  const cards = [
    { key: 'f1', x: 120, y: 420, w: W, h: 68 },
    { key: 'f2', x: 430, y: 470, w: W, h: 110 },
    { key: 'f3', x: 760, y: 520, w: W, h: 71 },
  ]
  it('左、右、水平居中、顶、底、垂直居中（原型：左边 120、430、760 都变 120）', () => {
    expect([...alignPlaced(cards, 'left', W).values()].map((p) => p.x)).toEqual([120, 120, 120])
    expect([...alignPlaced(cards, 'right', W).values()].map((p) => p.x)).toEqual([760, 760, 760])
    expect([...alignPlaced(cards, 'hc', W).values()].map((p) => p.x)).toEqual([440, 440, 440])
    expect([...alignPlaced(cards, 'top', W).values()].map((p) => p.y)).toEqual([420, 420, 420])
    expect([...alignPlaced(cards, 'bottom', W).values()].map((p) => p.y)).toEqual([523, 481, 520])
    expect([...alignPlaced(cards, 'vc', W).values()].map((p) => p.y)).toEqual([472, 451, 470])
    // 只改了要改的那一个方向
    expect([...alignPlaced(cards, 'left', W).values()].map((p) => p.y)).toEqual([420, 470, 520])
  })
  it('等距：三张起，按左右（上下）先后，间距一样，最少 16；两张不动', () => {
    const h = alignPlaced(cards, 'dh', W)
    expect([...h.values()].map((p) => p.x)).toEqual([120, 440, 760])
    const v = alignPlaced(cards, 'dv', W)
    expect([...v.values()].map((p) => p.y)).toEqual([420, 504, 630])
    expect(alignPlaced(cards.slice(0, 2), 'dh', W).get('f2')).toEqual({ x: 430, y: 470 })
  })
  it('排整齐：从上到下、从左到右排成方阵，一张之间空 24', () => {
    const t = alignPlaced(cards, 'tidy', W)
    expect(t.get('f1')).toEqual({ x: 120, y: 420 })
    expect(t.get('f2')).toEqual({ x: 420, y: 420 })
    expect(t.get('f3')).toEqual({ x: 120, y: 554 })
  })
})

describe('操作条放在哪（barSpot）', () => {
  const area = { left: 100, top: 80, right: 1300, bottom: 900 }
  it('浮在选区上方 10、水平居中；左右夹在这一格里', () => {
    expect(barSpot({ left: 400, top: 500, right: 800, bottom: 700 }, area, 584, 40)).toEqual({ left: 308, top: 450, below: false })
    expect(barSpot({ left: 100, top: 500, right: 200, bottom: 700 }, area, 584, 40).left).toBe(108)
    expect(barSpot({ left: 1200, top: 500, right: 1300, bottom: 700 }, area, 584, 40).left).toBe(1300 - 8 - 584)
  })
  it('上面放不下翻到下面；上下都放不下贴在顶上 8；选区滚出了这一格贴着那一边', () => {
    expect(barSpot({ left: 400, top: 100, right: 800, bottom: 300 }, area, 584, 40)).toMatchObject({ top: 310, below: true })
    expect(barSpot({ left: 400, top: 90, right: 800, bottom: 880 }, area, 584, 40)).toMatchObject({ top: 88, below: false })
    expect(barSpot({ left: 400, top: 1400, right: 800, bottom: 1500 }, area, 584, 40).top).toBe(900 - 8 - 40)
  })
})
