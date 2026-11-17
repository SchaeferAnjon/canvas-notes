import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { apiError, bookFile, bookIdOfReader, bookMd, isReader, isWeread, loginOf, marksToInsert, newMarks, normalizeWeread, parseBookmarks, parseNotebooks, parseReviews, quoteMd, readerCode } from '../src/shared/plugins/weread'

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
    // 真账号上的样子（2026-11-17 量的字段）：划了 2 条时 noteCount=2、bookmarkCount=0
    expect(parseNotebooks({ books: [{ bookId: '1', book: { title: 'A', author: 'B' }, noteCount: 2, bookmarkCount: 0, reviewCount: 1, reviewLikeCount: 0, reviewCommentCount: 0, sort: 9 }, { bookId: '', book: {} }] })).toEqual([{ bookId: '1', title: 'A', author: 'B', marks: 2, reviews: 1, updated: 9 }])
    // 只有 bookmarkCount 的旧写法也认
    expect(parseNotebooks({ books: [{ bookId: '2', book: { title: 'C' }, bookmarkCount: 3 }] })[0]!.marks).toBe(3)
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
  it('阅读页地址 ↔ 书的编号：拆得回来、编得回去；翻章时后面接的 k… 不影响；对不上的（假网站、乱写的）不认', () => {
    const md5 = (t: string) => createHash('md5').update(t).digest('hex')
    // 真微信读书书架上的一条阅读页地址（2026-11-17 量的，只有编号）
    expect(readerCode('3300207982', md5)).toBe('fdf32730813abb7beg012542')
    expect(bookIdOfReader('https://weread.qq.com/web/reader/fdf32730813abb7beg012542', md5)).toBe('3300207982')
    expect(bookIdOfReader(`https://weread.qq.com/web/reader/fdf32730813abb7beg012542k${readerCode('15', md5)}`, md5)).toBe('3300207982')
    // 不是纯数字的编号（类型 4）也能来回
    expect(bookIdOfReader(`https://weread.qq.com/web/reader/${readerCode('CB_3Ft7ab', md5)}`, md5)).toBe('CB_3Ft7ab')
    // 短的编号（要拿 md5 补到 20 位）
    expect(bookIdOfReader(`https://weread.qq.com/web/reader/${readerCode('695233', md5)}`, md5)).toBe('695233')
    expect(bookIdOfReader('https://weread.qq.com/web/reader/ce032b305a9bc1ce0b0dd2b', md5)).toBeNull()
    expect(bookIdOfReader('https://weread.qq.com/web/reader/fdf32730813abb7beg012543', md5)).toBeNull()
    expect(bookIdOfReader('https://weread.qq.com/web/shelf', md5)).toBeNull()
  })
  it('网页版接口的出错：errCode 和 errcode 两种写法，-2012 登录超时、-2010 用户不存在都算没登录', () => {
    expect(apiError({ errCode: -2012, errMsg: '登录超时' })).toEqual({ login: true, message: '登录超时' })
    expect(apiError({ errcode: -2010, errmsg: '用户不存在' })).toEqual({ login: true, message: '用户不存在' })
    expect(apiError({ errCode: -1, errMsg: '' })).toEqual({ login: false, message: '微信读书出错（-1）' })
    expect(apiError({ books: [] })).toBeNull()
    expect(apiError(null)).toBeNull()
  })
  it('右栏的 cookie 里认登录：wr_vid 和 wr_skey 都在才算', () => {
    expect(loginOf([{ name: 'wr_vid', value: '123' }, { name: 'wr_skey', value: 'abc' }])).toEqual({ vid: '123' })
    expect(loginOf([{ name: 'wr_vid', value: '123' }])).toBeNull()
    expect(loginOf([])).toBeNull()
  })
  it('该插进文档的划线：见过这本书就是没见过的；打开书那次没取成，划线触发时 2 分钟内新建的算新的', () => {
    const { marks } = parseBookmarks(LIST, '900001')
    expect(marksToInsert(marks, ['900001_5_10-30'], 'tap', 1794800100).map((m) => m.id)).toEqual(['900001_3_200-260'])
    // 第一次打开这本书：只记下，不插
    expect(marksToInsert(marks, undefined, 'open', 1794800100)).toEqual([])
    // 打开那次没取成，紧接着划了一条：刚建的那条（100 秒前）插，早的不插
    expect(marksToInsert(marks, undefined, 'tap', 1794800100).map((m) => m.id)).toEqual(['900001_5_10-30'])
    expect(marksToInsert(marks, undefined, 'mouseup', 1794800000 + 121)).toEqual([])
  })
})
