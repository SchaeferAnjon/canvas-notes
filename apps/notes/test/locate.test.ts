// 读 PDF 贴截图问：截图里认出的字是这份 PDF 的哪一页哪一段（shared/locate.ts，0.5.9）
import { describe, expect, it } from 'vitest'
import type { PdfBlock } from '@cn/format'
import { blocksRect, locateShot } from '../src/shared/locate'

const blk = (page: number, i: number, text: string, y = 100 + i * 60): PdfBlock => ({ id: `p${page}-b${i}`, page, kind: 'text', text, x: 72, y, w: 460, h: 40 })
const FOOT = 'Linear Algebra - Lecture 3'
const PAGES: PdfBlock[][] = [
  [blk(1, 1, 'Vectors and spaces'), blk(1, 2, 'A vector space is a set closed under addition and scalar multiplication.'), blk(1, 3, FOOT, 750)],
  [blk(2, 1, 'Matrices'), blk(2, 2, 'Matrix multiplication composes linear maps; it is associative but not commutative.'), blk(2, 3, FOOT, 750)],
  [
    blk(3, 1, 'Attention weights'),
    blk(3, 2, 'The attention weights are derived from (1), and the resulting node representations are updated through multi-head aggregation as defined in (2).'),
    blk(3, 3, 'where N(i) denotes the neighborhood of node i (fully connected over modalities, including self-loops).'),
    blk(3, 4, FOOT, 750),
  ],
]

describe('locateShot', () => {
  it('截图里的字对上第 3 页那两段：给第 3 页和那两块，页脚不算', () => {
    const ocr = 'aij = exp (LeakyReLU (aT [Wihi || Wjhj]))  (1)\nwhere N(i) denotes the neighborhood of node i (fully\nconnected over modalities, including self-loops), K is the\nThe attention weights are derived from (1), and the\nresulting node representations are updated through multi-head\nLinear Algebra - Lecture 3'
    const at = locateShot(ocr, PAGES)
    expect(at.page).toBe(3)
    expect('blocks' in at && at.blocks.map((b) => b.id)).toEqual(['p3-b2', 'p3-b3'])
  })
  it('只认出页脚（每页都有）：不算认出', () => {
    expect(locateShot('Linear Algebra - Lecture 3', PAGES)).toEqual({ page: 0, foreign: false })
  })
  it('认出不少字、这份 PDF 里大半没有：别处的截图（foreign）', () => {
    expect(locateShot('Banana smoothie recipe: blend frozen strawberries, yogurt and honey until creamy', PAGES)).toEqual({ page: 0, foreign: true })
    expect(locateShot('今天天气很好我们去公园散步吧', PAGES)).toEqual({ page: 0, foreign: true })
  })
  it('没认出几个字（公式、图）：不算别处的', () => {
    expect(locateShot('h = 1/K Σ σ', PAGES)).toEqual({ page: 0, foreign: false })
  })
})

describe('blocksRect', () => {
  it('几块的外框按页面宽高算比例', () => {
    expect(blocksRect([blk(3, 2, 'a', 160), blk(3, 3, 'b', 220)], { w: 612, h: 792 })).toEqual([0.118, 0.202, 0.752, 0.126])
    expect(blocksRect([], { w: 612, h: 792 })).toBeUndefined()
  })
})
