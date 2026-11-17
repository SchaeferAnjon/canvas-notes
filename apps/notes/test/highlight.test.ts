import { describe, expect, it } from 'vitest'
import { highlightsIn, inHighlight, toggleHighlightIn } from '../src/renderer/highlight'

const apply = (doc: string, from: number, to: number) => {
  const r = toggleHighlightIn(doc, from, to)
  if (!r) return { doc, sel: null }
  let out = doc
  for (const c of [...r.changes].sort((a, b) => b.from - a.from)) out = out.slice(0, c.from) + c.insert + out.slice(c.to)
  return { doc: out, sel: out.slice(Math.min(r.anchor, r.head), Math.max(r.anchor, r.head)) }
}

describe('高亮 ==文字==（CN-67）', () => {
  it('选中的字包上 ==，选区还是那几个字；再按一次去掉', () => {
    const doc = '天地者，万物之逆旅。'
    const one = apply(doc, 4, 9)
    expect(one.doc).toBe('天地者，==万物之逆旅==。')
    expect(one.sel).toBe('万物之逆旅')
    const two = apply(one.doc, 6, 11)
    expect(two.doc).toBe(doc)
    expect(two.sel).toBe('万物之逆旅')
  })

  it('选区连 == 一起选上也能取消；两头的空格不包进去', () => {
    expect(apply('a ==bc== d', 2, 8).doc).toBe('a bc d')
    expect(apply('a bc d', 1, 5).doc).toBe('a ==bc== d')
  })

  it('光标在一处高亮里（没选字）：去掉这一处；不在高亮里什么都不改', () => {
    expect(apply('x ==重点== y', 5, 5).doc).toBe('x 重点 y')
    expect(toggleHighlightIn('没有高亮', 2, 2)).toBeNull()
    expect(inHighlight('x ==重点== y', 5, 5)).toBe(true)
    expect(inHighlight('x ==重点== y', 4, 6)).toBe(true)
    expect(inHighlight('x 重点 y', 2, 4)).toBe(false)
  })

  it('认出一行里的高亮，== 后面紧跟空格的不算', () => {
    expect(highlightsIn('a ==b== c ==d e== f')).toEqual([
      [2, 7],
      [10, 17],
    ])
    expect(highlightsIn('a == b == c')).toEqual([])
    expect(highlightsIn('x === y')).toEqual([])
  })
})
