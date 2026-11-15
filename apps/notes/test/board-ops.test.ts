import { parseBoard, parseLinks } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { addCard, addColumn, arrange, link, moveTo, putInColumn, setCardText, summarize } from '../src/main/agent/board-ops'

const BOARD = `---
type: board
---
# 旅行

<!-- card id=a x=300 y=100 w=280 -->
第二张

<!-- card id=b x=40 y=110 w=280 -->
第一张

<!-- column id=c x=700 y=90 w=300 title="要订的" -->
<!-- card id=d in=c -->
机票

<!-- card id=e x=60 y=600 w=200 -->
最下面
`

describe('白板操作', () => {
  it('列出卡片和列', () => {
    const s = summarize(BOARD)
    expect(s.cards.map((c) => c.id)).toEqual(['a', 'b', 'd', 'e'])
    expect(s.columns).toEqual([{ id: 'c', title: '要订的', x: 700, y: 90, w: 300, cards: ['d'] }])
    expect(s.cards.find((c) => c.id === 'd')).toEqual({ id: 'd', text: '机票', column: 'c' })
  })

  it('加卡片：放在最下面一张的下面，和最左边对齐；别的卡一个字都不动', () => {
    const { text, id } = addCard(BOARD, { text: '新卡片' })
    expect(text.startsWith(BOARD.replace(/\n$/, ''))).toBe(true)
    const card = summarize(text).cards.find((c) => c.id === id)!
    expect(card).toMatchObject({ text: '新卡片', x: 40, w: 280 })
    expect(card.y!).toBeGreaterThan(600 + 40)
  })

  it('加卡片到列里：排在列里最后一张后面', () => {
    const { text, id } = addCard(BOARD, { text: '租车', column: 'c' })
    expect(summarize(text).columns[0]!.cards).toEqual(['d', id])
    expect(text).toContain(`<!-- card id=d in=c -->\n机票\n\n<!-- card id=${id} in=c -->\n租车\n\n<!-- card id=e`)
  })

  it('改内容只动那张卡的正文', () => {
    const next = setCardText(BOARD, 'b', '改过的第一张')
    expect(next).toBe(BOARD.replace('第一张\n', '改过的第一张\n'))
    expect(() => setCardText(BOARD, 'zz', 'x')).toThrow('没有 id 是 zz')
    expect(() => setCardText(BOARD, 'b', '  ')).toThrow('空的')
  })

  it('挪位置只改注释那一行；列里的卡挪出来', () => {
    expect(moveTo(BOARD, 'a', 500, 120)).toBe(BOARD.replace('<!-- card id=a x=300 y=100 w=280 -->', '<!-- card id=a x=500 y=120 w=280 -->'))
    const out = moveTo(BOARD, 'd', 10, 20)
    expect(summarize(out).cards.find((c) => c.id === 'd')).toMatchObject({ x: 10, y: 20, w: 280 })
  })

  it('放进列、按位置排', () => {
    const out = putInColumn(BOARD, 'a', 'c', 0)
    expect(summarize(out).columns[0]!.cards).toEqual(['a', 'd'])
    expect(out).toContain('<!-- card id=a in=c -->\n第二张')
    const end = putInColumn(BOARD, 'e', 'c')
    expect(summarize(end).columns[0]!.cards).toEqual(['d', 'e'])
  })

  it('加列', () => {
    const { text, id } = addColumn(BOARD, { title: '去哪玩' })
    expect(summarize(text).columns.find((c) => c.id === id)).toMatchObject({ title: '去哪玩', x: 40 })
  })

  it('连线写进 frontmatter；连过的不重复', () => {
    const out = link(BOARD, 'b', 'a')
    expect(parseLinks(parseBoard(out))).toEqual([{ from: 'b', to: 'a' }])
    expect(link(out, 'b', 'a')).toBe(out)
    expect(() => link(BOARD, 'a', 'c')).toThrow('只有卡片之间能连线')
  })

  it('按网格排：阅读顺序，一行一样高，不重叠', () => {
    const out = arrange(BOARD, 'grid', { per: 2, sizes: { a: { w: 280, h: 100 }, b: { w: 280, h: 150 }, c: { w: 300, h: 200 }, e: { w: 200, h: 80 } } })
    const s = summarize(out)
    const at = (id: string) => (id === 'c' ? s.columns[0]! : s.cards.find((c) => c.id === id)!) as { x: number; y: number }
    // b(40,110)、a(300,100)、c(700,90) 上下差不到 40px，算同一行，从左到右是 b a c；一行两个
    expect(at('b')).toMatchObject({ x: 40, y: 90 })
    expect(at('a')).toMatchObject({ x: 40 + 300 + 24, y: 90 })
    expect(at('c')).toMatchObject({ x: 40, y: 90 + 150 + 24 })
    expect(at('e')).toMatchObject({ x: 364, y: 264 })
    // 列里的卡不动
    expect(out).toContain('<!-- card id=d in=c -->\n机票')
  })

  it('按列排：放进最矮的那一竖', () => {
    const sizes = { a: { w: 280, h: 300 }, b: { w: 280, h: 100 }, c: { w: 300, h: 100 }, e: { w: 280, h: 100 } }
    const out = arrange(BOARD, 'columns', { per: 2, sizes })
    const s = summarize(out)
    // 顺序 b a c e：b 左、a 右、c 进左（b 下面）、e 进左（左边更矮）
    expect(s.cards.find((c) => c.id === 'b')).toMatchObject({ x: 40, y: 90 })
    expect(s.cards.find((c) => c.id === 'a')).toMatchObject({ x: 364, y: 90 })
    expect(s.columns[0]).toMatchObject({ x: 40, y: 90 + 100 + 24 })
    expect(s.cards.find((c) => c.id === 'e')).toMatchObject({ x: 40, y: 90 + 100 + 24 + 100 + 24 })
  })

  it('已经整齐时再排一次，文件不变', () => {
    const once = arrange(BOARD, 'grid')
    expect(arrange(once, 'grid')).toBe(once)
  })
})
