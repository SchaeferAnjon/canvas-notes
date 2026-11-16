import { describe, expect, it } from 'vitest'
import { bookFile, bookMd, isReader, isWeread, newMarks, normalizeWeread, parseBookmarks, parseNotebooks, parseReviews, quoteMd } from '../src/shared/plugins/weread'

const LIST = {
  synckey: 1,
  book: { bookId: '900001', title: '思考，快与慢', author: '丹尼尔·卡尼曼' },
  chapters: [
    { chapterUid: 3, title: '第1章 两个系统' },
    { chapterUid: 5, title: '第2章 注意力' },
  ],
  updated: [
    { bookmarkId: '900001_5_10-30', bookId: '900001', chapterUid: 5, range: '10-30', markText: '努力是有代价的。', createTime: 1794800000 },
    { bookmarkId: '900001_3_200-260', bookId: '900001', chapterUid: 3, range: '200-260', markText: '系统 1 的运行是无意识且快速的，\n不怎么费脑力。', createTime: 1794790000 },
    { bookmarkId: '900001_3_5-9', bookId: '900001', chapterUid: 3, chapterName: '第1章 两个系统', range: '5-9', markText: '  ', createTime: 1 },
  ],
}

describe('微信读书', () => {
  it('认阅读页', () => {
    expect(isReader('https://weread.qq.com/web/reader/ce032b305a9bc1ce0b0dd2a')).toBe(true)
    expect(isReader('https://weread.qq.com/web/shelf')).toBe(false)
    expect(isWeread('https://weread.qq.com/web/shelf')).toBe(true)
    expect(isReader('https://example.com/web/reader/x')).toBe(false)
    expect(normalizeWeread(undefined)).toEqual({ insert: true, sync: true })
    expect(normalizeWeread({ insert: false })).toEqual({ insert: false, sync: true })
  })
  it('拆划线：章节名从 chapters 里补；空的不要；没见过的才算新划的', () => {
    const { marks, book } = parseBookmarks(LIST, '900001')
    expect(book).toEqual({ bookId: '900001', title: '思考，快与慢', author: '丹尼尔·卡尼曼' })
    expect(marks.map((m) => [m.id, m.chapter])).toEqual([
      ['900001_5_10-30', '第2章 注意力'],
      ['900001_3_200-260', '第1章 两个系统'],
    ])
    expect(newMarks(marks, new Set(['900001_5_10-30'])).map((m) => m.id)).toEqual(['900001_3_200-260'])
  })
  it('插进文档的引文：和剪进文档同一个写法，多行每行一个 >，来源是书名和章节，链接回微信读书', () => {
    const { marks } = parseBookmarks(LIST, '900001')
    expect(quoteMd(marks[1]!, { title: '思考，快与慢' }, 'https://weread.qq.com/web/reader/abc (1)')).toBe(
      '> 系统 1 的运行是无意识且快速的，\n> 不怎么费脑力。\n—— [《思考，快与慢》 · 第1章 两个系统](https://weread.qq.com/web/reader/abc%20%281%29)',
    )
  })
  it('想法、书评、有笔记的书', () => {
    const t = parseReviews({ reviews: [{ review: { reviewId: 'r1', chapterName: '第2章 注意力', abstract: '努力是有代价的。', content: '所以要省着用。', createTime: 1794800100 } }, { review: { reviewId: 'r2', content: '好书。', type: 4 } }, { review: { reviewId: 'r3', content: ' ' } }] })
    expect(t.map((x) => [x.id, x.isReview])).toEqual([
      ['r1', false],
      ['r2', true],
    ])
    expect(parseNotebooks({ books: [{ bookId: '1', book: { title: 'A', author: 'B' }, bookmarkCount: 3, reviewCount: 1, sort: 9 }, { bookId: '', book: {} }] })).toEqual([{ bookId: '1', title: 'A', author: 'B', marks: 3, reviews: 1, updated: 9 }])
  })
  it('一本书的素材：按章节排、想法跟在它那一段后面、书评单独一节', () => {
    const { marks, book } = parseBookmarks(LIST, '900001')
    const thoughts = parseReviews({ reviews: [{ review: { reviewId: 'r1', abstract: '努力是有代价的。', content: '所以要省着用。' } }, { review: { reviewId: 'r2', content: '好书。', type: 4 } }] })
    const md = bookMd(book!, marks, thoughts, 'https://weread.qq.com/web/reader/abc')
    expect(md).toBe(
      [
        '---',
        'type: weread',
        'title: 思考，快与慢',
        'author: 丹尼尔·卡尼曼',
        'bookId: 900001',
        'source: https://weread.qq.com/web/reader/abc',
        'marks: 2',
        'thoughts: 1',
        '---',
        '# 思考，快与慢',
        '',
        '丹尼尔·卡尼曼 · 微信读书里的划线和想法，软件自动同步，改这里不会改回微信读书。',
        '',
        '## 第1章 两个系统',
        '',
        '> 系统 1 的运行是无意识且快速的，',
        '> 不怎么费脑力。',
        '',
        '## 第2章 注意力',
        '',
        '> 努力是有代价的。',
        '',
        '想法：所以要省着用。',
        '',
        '## 书评',
        '',
        '好书。',
        '',
      ].join('\n'),
    )
    expect(bookFile('a/b: c?')).toBe('素材/微信读书/a b c.md')
  })
})
