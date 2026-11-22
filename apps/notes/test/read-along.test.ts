import { describe, expect, it } from 'vitest'
import { anchorAt, findAnchor, firstSentence, likeness } from '../src/shared/read-anchor'
import { bookPrefix, bookTitle, booksOf, cleanHead, deskFile, deskJson, deskSummary, inBook, isWholeBook, normalizeDesk, normalizePositions, pageHead, positionsJson, remapDesk, sameDesk, samePos, stripHash } from '../src/shared/read-along'

const D2L = 'https://zh.d2l.ai/chapter_preliminaries/ndarray.html'

describe('配成一对：哪些网页算这本书', () => {
  it('整本书是网站根；网址去掉 #… 以后以前缀开头才算', () => {
    expect(bookPrefix(D2L + '#id1')).toBe('https://zh.d2l.ai/')
    expect(isWholeBook('https://zh.d2l.ai/')).toBe(true)
    expect(isWholeBook(D2L)).toBe(false)
    expect(inBook('https://zh.d2l.ai/', 'https://zh.d2l.ai/chapter_preface/index.html')).toBe(true)
    expect(inBook('https://zh.d2l.ai/', 'https://zh.d2l.ai.evil.com/x')).toBe(false)
    expect(inBook(D2L, D2L + '#subsec')).toBe(true)
    expect(inBook(D2L, 'https://zh.d2l.ai/chapter_preliminaries/pandas.html')).toBe(false)
    expect(stripHash('https://a.b/c?d=1#e')).toBe('https://a.b/c?d=1')
    expect(booksOf(['https://zh.d2l.ai/', D2L, 'https://zh.d2l.ai/'], D2L)).toEqual(['https://zh.d2l.ai/', D2L])
  })

  it('书名取网页标题最后一截，去掉 Sphinx 的版本号和 documentation；这一页叫标题第一截', () => {
    expect(bookTitle('2.1. 数据操作 — 动手学深度学习 2.0.0 documentation', D2L)).toBe('动手学深度学习')
    expect(bookTitle('前言 — 动手学深度学习', D2L)).toBe('动手学深度学习')
    expect(bookTitle('只有一截的标题', D2L)).toBe('zh.d2l.ai')
    expect(bookTitle('', 'https://www.example.com/a')).toBe('example.com')
    expect(pageHead('2.1. 数据操作 — 动手学深度学习 2.0.0 documentation', D2L)).toBe('2.1. 数据操作')
    expect(pageHead('', D2L)).toBe('ndarray.html')
    expect(cleanHead('2.1.4. 索引和切片¶')).toBe('2.1.4. 索引和切片')
  })
})

describe('读到哪.json', () => {
  it('读回来时扔掉不对的（不是网址的键、没有网址的条目），比例夹在 0–1；写出去按书排好', () => {
    const m = normalizePositions({
      'https://zh.d2l.ai/': { url: D2L, text: '和 Python 的列表一样', before: 'a', after: 'b', ratio: 1.7, head: '2.1.4. 索引和切片', at: '2026-11-21T20:00:00Z' },
      'not a url': { url: D2L },
      'https://b.example/': { url: 'javascript:alert(1)' },
    })
    expect(Object.keys(m)).toEqual(['https://zh.d2l.ai/'])
    expect(m['https://zh.d2l.ai/']!.ratio).toBe(1)
    expect(normalizePositions('坏了')).toEqual({})
    const json = positionsJson({ 'https://z.example/': m['https://zh.d2l.ai/']!, 'https://a.example/': m['https://zh.d2l.ai/']! })
    expect(json.indexOf('https://a.example/')).toBeLessThan(json.indexOf('https://z.example/'))
    expect(json.endsWith('}\n')).toBe(true)
  })

  it('同一处（比例差不到 0.5%）不算变了', () => {
    const a = { url: D2L, text: 't', before: '', after: '', ratio: 0.5 }
    expect(samePos(a, { ...a, ratio: 0.503 })).toBe(true)
    expect(samePos(a, { ...a, ratio: 0.52 })).toBe(false)
    expect(samePos(a, { ...a, text: 'u' })).toBe(false)
  })
})

describe('那一段：记下、找回', () => {
  const blocks = [
    '2.1. 数据操作',
    '为了完成各种数据操作，我们需要某种方法来存储和操作数据。',
    '2.1.4. 索引和切片',
    '和 Python 的列表一样，张量里的元素可以用索引访问：第一个元素的索引是 0，最后一个是 -1；也可以指定范围取出一段。',
    '除了读，还可以通过指定索引把元素写进矩阵。想给多个元素赋同一个值，只要索引出它们，再一起赋值。',
  ]

  it('开头一句到第一个句号为止（最多 80 字），太短就多带些字；前后各 32 个字', () => {
    expect(firstSentence(blocks[1]!)).toBe('为了完成各种数据操作，我们需要某种方法来存储和操作数据。')
    expect(firstSentence('是的。后面还有很长很长的一段话，用来凑够字数，不然太短到处都对得上。')).not.toBe('是的。')
    expect(firstSentence('x'.repeat(200))).toHaveLength(80)
    const a = anchorAt(blocks, 3)
    expect(a.text.startsWith('和 Python 的列表一样')).toBe(true)
    expect(a.before.length).toBeLessThanOrEqual(32)
    expect(a.before.endsWith('2.1.4. 索引和切片')).toBe(true)
    expect(a.after.length).toBeLessThanOrEqual(32)
  })

  it('一字不差的找得回；段落挪了位置也找得回', () => {
    const a = anchorAt(blocks, 3)
    expect(findAnchor(blocks, a)).toEqual({ index: 3, how: 'exact' })
    const moved = [blocks[0]!, blocks[3]!, blocks[1]!, blocks[2]!, blocks[4]!]
    expect(findAnchor(moved, a)).toEqual({ index: 1, how: 'exact' })
  })

  it('同一句出现几次：看前后文', () => {
    const dup = ['第一节', '下面这段在两处都有，一字不差，只有前后文不一样。', '第二节', '下面这段在两处都有，一字不差，只有前后文不一样。', '后面']
    const a = anchorAt(dup, 3)
    expect(findAnchor(dup, a)?.index).toBe(3)
    expect(findAnchor(dup, anchorAt(dup, 1))?.index).toBe(1)
  })

  it('网页改了一两个字：模糊找回；整段改写了：找不到（这时按滚动比例停，说一句）', () => {
    const a = anchorAt(blocks, 3)
    const edited = blocks.map((b, i) => (i === 3 ? b.replace('第一个元素', '首个元素') : b))
    expect(findAnchor(edited, a)).toEqual({ index: 3, how: 'fuzzy' })
    const rewritten = blocks.map((b, i) => (i === 3 ? '张量支持像列表那样按位置取值，也能一次取出一段连续的元素。' : b))
    expect(findAnchor(rewritten, a)).toBeNull()
    expect(likeness('abc', 'abc')).toBe(1)
    expect(likeness('', 'abc')).toBe(0)
  })
})

describe('书桌文件', () => {
  it('读回来时去掉不对的笔记路径和网址，名字空了用文件名；样子、自动记下照读', () => {
    const d = normalizeDesk(
      {
        name: '',
        notes: ['课程/a.md', '../x.md', 'b.txt', '课程/a.md'],
        active: '课程/a.md',
        web: [{ url: D2L, title: 't', pos: { url: D2L, text: 'x', before: '', after: '', ratio: 0.3 } }, { url: 'file:///etc/passwd' }, { url: 'https://zh.d2l.ai/x', book: 'https://zh.d2l.ai/' }],
        webActive: 1,
        layout: { left: false },
        auto: false,
      },
      '动手学深度学习',
    )
    expect(d.name).toBe('动手学深度学习')
    expect(d.notes).toEqual(['课程/a.md'])
    expect(d.web.map((t) => t.url)).toEqual([D2L, 'https://zh.d2l.ai/x'])
    expect(d.web[1]!.book).toBe('https://zh.d2l.ai/')
    expect(d.web[0]!.pos?.ratio).toBe(0.3)
    expect(d.webActive).toBe(1)
    expect(d.layout).toEqual({ left: false, web: true })
    expect(d.auto).toBe(false)
    expect(deskSummary(d)).toBe('1 篇笔记 · 2 个网页')
    expect(deskFile('动手/学:深度')).toBe('.canvas-notes/书桌/动手 学 深度.json')
    expect(deskJson(d).endsWith('}\n')).toBe(true)
  })

  it('只差「上次存」的两张算一样；笔记改名、删掉时书桌里的路径跟着换', () => {
    const d = normalizeDesk({ name: 'x', notes: ['a.md', 'b.md'], active: 'b.md', web: [], saved: '1' }, 'x')
    expect(sameDesk(d, { ...d, saved: '2' })).toBe(true)
    expect(remapDesk(d, () => undefined)).toBeNull()
    const r = remapDesk(d, (p) => (p === 'b.md' ? '课程/b.md' : undefined))!
    expect(r.notes).toEqual(['a.md', '课程/b.md'])
    expect(r.active).toBe('课程/b.md')
    const gone = remapDesk(d, (p) => (p === 'b.md' ? null : undefined))!
    expect(gone.notes).toEqual(['a.md'])
    expect(gone.active).toBeUndefined()
  })
})
