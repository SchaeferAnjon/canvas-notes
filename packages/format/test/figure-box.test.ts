import { describe, expect, it } from 'vitest'
import { locateFigure, parseFigureMark, saneFigure, stripFigureMark, toPageRect } from '../src'

describe('配图的框（CN-60）', () => {
  const answer = '这页讲的是计算栈。\n\n〔配图 0.10,0.40,0.60,0.30 · 九层结构图〕'
  it('认出回答最后那一行，显示时去掉', () => {
    expect(parseFigureMark(answer)).toEqual({ rect: [0.1, 0.4, 0.6, 0.3], caption: '九层结构图' })
    expect(stripFigureMark(answer)).toBe('这页讲的是计算栈。')
    expect(parseFigureMark('没有配图')).toBeNull()
    // 边生成边显示：半截的「〔配」也不露出来
    expect(stripFigureMark('讲完了。\n〔配图 0.1,')).toBe('讲完了。')
  })
  it('框的那块上的比例换成整页上的比例', () => {
    expect(toPageRect([0.5, 0.5, 0.5, 0.5], [0.2, 0.2, 0.4, 0.4])).toEqual([0.4, 0.4, 0.2, 0.2])
    expect(toPageRect([0.1, 0.2, 0.3, 0.4])).toEqual([0.1, 0.2, 0.3, 0.4])
  })
  it('太小、几乎整页、出界的不算，退回下一种办法', async () => {
    expect(saneFigure([0.1, 0.4, 0.6, 0.3])).toBe(true)
    expect(saneFigure([0.1, 0.1, 0.05, 0.05])).toBe(false)
    expect(saneFigure([0, 0, 1, 1])).toBe(false)
    expect(saneFigure([0.6, 0.6, 0.6, 0.6])).toBe(false)
    const bad = { name: 'AI 回的框', locate: () => ({ rect: [0, 0, 1, 1] as [number, number, number, number], caption: '整页' }) }
    const good = { name: '图片块', locate: async () => ({ rect: [0.2, 0.2, 0.4, 0.3] as [number, number, number, number], caption: '图' }) }
    expect(await locateFigure([bad, good])).toEqual({ rect: [0.2, 0.2, 0.4, 0.3], caption: '图', by: '图片块' })
    expect(await locateFigure([bad])).toBeNull()
  })
})
