import { readFileSync } from 'node:fs'
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

describe('白板操作（2026-11-21 起白板就是这篇文档：## 是列、一段是一张卡）', () => {
  const T = `---\ntype: board\n---\n# 旅行\n\n## 要订的\n\n机票\n\n租车\n\n## 住哪\n\n维克两晚\n`
  it('列出：列的 id 是列名，卡的 id 是白板上的名字（data-id）', () => {
    const s = summarize(T)
    expect(s.columns.map((c) => [c.id, c.cards.length])).toEqual([
      ['要订的', 2],
      ['住哪', 1],
    ])
    expect(s.cards.map((c) => [c.text, c.column])).toEqual([
      ['机票', '要订的'],
      ['租车', '要订的'],
      ['维克两晚', '住哪'],
    ])
    expect(s.loose).toEqual([])
  })

  it('加卡片进列 = 插进那一节；加列 = 新起一节；放进列 = 这段挪进那一节；挪到空白处 = 前面一行位置，名字不变；连线 = 两头留编号；排整齐只动空白处的', () => {
    const a = addCard(T, { text: '换钱', column: '要订的' })
    expect(a.text).toContain('租车\n\n换钱\n\n## 住哪')
    expect(summarize(a.text).cards.find((c) => c.id === a.id)!.text).toBe('换钱')
    const col = addColumn(a.text, { title: '吃什么' })
    expect(col.id).toBe('吃什么')
    expect(col.text.endsWith('维克两晚\n\n## 吃什么\n')).toBe(true)
    const ticket = summarize(col.text).cards.find((c) => c.text === '机票')!.id
    const moved = putInColumn(col.text, ticket, '吃什么')
    expect(moved.endsWith('## 吃什么\n\n机票\n')).toBe(true)
    // 挪到空白处：位置行的编号就是它的名字，挪完再找还是它
    const placed = moveTo(moved, ticket, 400, 80)
    expect(placed).toContain(`<!-- card id=${ticket} x=400 y=80 -->\n机票`)
    expect(summarize(placed).cards.find((c) => c.id === ticket)).toMatchObject({ x: 400, y: 80 })
    const stay = summarize(placed).cards.find((c) => c.text === '维克两晚')!.id
    const linked = link(placed, ticket, stay)
    expect(linked).toContain(`links:\n  - ${ticket} -> ${stay}\n`)
    expect(linked).toContain(`<!-- card id=${stay} -->\n维克两晚`)
    expect(() => setCardText(linked, 'nope', 'x')).toThrow('board_list')
    expect(setCardText(linked, stay, '维克住两晚')).toContain('维克住两晚')
    // 排整齐：只有一张空白处的卡，已经整齐，不动
    expect(arrange(linked, 'grid')).toBe(linked)
    expect(() => addCard(T, { text: 'x', column: '没有这列' })).toThrow('没有叫「没有这列」的列')
  })

  it('加卡片不给列也不给坐标：有节就加在最后一节；白板上只有散着的卡（没分节）就放在空白处，最下面那张的下面，不塞进最左一组', () => {
    expect(addCard(T, { text: '换钱' }).text.endsWith('维克两晚\n\n换钱\n')).toBe(true)
    const free = '---\ntype: board\n---\n# 旅行\n\n<!-- card id=a x=420 y=300 -->\n出发前先定住处\n\n<!-- card id=b x=60 y=80 -->\n冰岛环岛十天\n'
    const r = addCard(free, { text: '订机票' })
    expect(r.text.endsWith('冰岛环岛十天\n\n<!-- card id=d1 x=420 y=500 -->\n订机票\n')).toBe(true)
    // 告诉 AI 的是白板上画的位置：a（420）原来离 b（60）并排 360、列加宽到 400 以后叠了，画的时候推到 60 + 400 + 22，摞在 a 下面的新卡跟着 a
    expect(summarize(r.text).cards.find((c) => c.id === r.id)).toMatchObject({ text: '订机票', x: 482, y: 500 })
    // 一张卡都没有的空白板：加在文末
    expect(addCard('---\ntype: board\n---\n', { text: '第一张' }).text).toBe('---\ntype: board\n---\n\n第一张\n')
  })
})

describe('AI 整理配对笔记白板（r147）：拖进来的卡落在问答一节里', () => {
  const PAIR = readFileSync(new URL('./fixtures/pair-board-drop.md', import.meta.url), 'utf8')
  it('board_list 里那张是空白处的卡；问答列标 fixed', () => {
    const s = summarize(PAIR)
    expect(s.cards.find((c) => c.id === 'd1')).toMatchObject({ text: '![[过度捕鱼]]', x: 383, y: 2075 })
    expect(s.columns.find((c) => c.fixed)?.cards.length).toBe(3)
  })
  it('挪那张：只改位置行；挪问答列里的卡：报错、不写文件', () => {
    expect(moveTo(PAIR, 'd1', 900, 64)).toBe(PAIR.replace('<!-- card id=d1 x=383 y=2075 -->', '<!-- card id=d1 x=900 y=64 -->'))
    const fixed = summarize(PAIR).columns.find((c) => c.fixed)!
    for (const id of fixed.cards) expect(() => moveTo(PAIR, id, 340, 64)).toThrow(/问过 AI/)
  })
  it('排整齐：只改空白处那张的位置行', () => {
    const out = arrange(PAIR, 'grid')
    expect(out.replace(/<!-- card id=d1 x=\d+ y=\d+ -->/, '')).toBe(PAIR.replace('<!-- card id=d1 x=383 y=2075 -->', ''))
  })
})
