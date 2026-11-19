// CN-130：微信读书同步不再整份重写书摘，按段合并：用户写的字、评价、类型都留着，新划线插进它那一章，用户删掉的不加回来。
// CN-131 / CN-123：同步写中文键「类型: 书摘」，书的编号藏起来；旧文件（type: weread、英文键）下次同步只改开头这几行。
// CN-122：书摘标题下一行摘要「书摘 · 作者 · 微信读书 N 条划线 · 同步于今天 21:25」。
import { readProps } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { type BookSync, bookFile, bookMeta, type Mark, mergeBook, OLD_WEREAD_FOLDER, syncedText, type Thought, WEREAD_FOLDER } from '../src/shared/plugins/weread'

const BOOK = { bookId: '900001', title: '思考，快与慢', author: '丹尼尔·卡尼曼' }
const URL = 'https://weread.qq.com/web/reader/abc'
const NOW = new Date(2026, 10, 17, 21, 25).getTime()
const mk = (id: string, chapterUid: number, chapter: string, range: string, text: string): Mark => ({ id, bookId: BOOK.bookId, chapterUid, chapter, text, created: 1794790000, range })
const M1 = mk('m1', 3, '第1章 两个系统', '5-40', '系统 1 的运行是无意识且快速的。')
const M2 = mk('m2', 3, '第1章 两个系统', '200-260', '系统 2 将注意力转移到需要费脑力的大脑活动上来。')
const M3 = mk('m3', 5, '第2章 注意力', '10-30', '努力是有代价的。')
const M4 = mk('m4', 7, '第3章 联想机器', '1-9', '启动效应无处不在。')
const T1: Thought = { id: 'r1', chapter: '第1章 两个系统', abstract: M1.text, content: '系统 1 就是直觉。', created: 1794790100, isReview: false }
const R1: Thought = { id: 'r9', chapter: '', abstract: '', content: '好书。', created: 0, isReview: true }
const sync = (marks: Mark[], thoughts: Thought[] = [], written: readonly string[] = [], now = NOW): BookSync => ({ book: BOOK, marks, thoughts, url: URL, written, now })
const types = (t: string) => readProps(t).filter((p) => p.key === 'type' || p.key === '类型')

describe('微信读书同步：按段合并，不整份重写（CN-130）', () => {
  it('新书：中文键、类型是书摘、书的编号藏着不写书名；按章节排，想法挂在它那一段下面，书评单独一节', () => {
    const r = mergeBook(null, sync([M3, M1], [T1, R1]))
    expect(r.text).toBe(
      [
        '---',
        '类型: 书摘',
        '作者: 丹尼尔·卡尼曼',
        `来源: ${URL}`,
        '划线: 2',
        '想法: 1',
        'bookId: 900001',
        'updated: 2026-11-17 21:25',
        '---',
        '# 思考，快与慢',
        '',
        '## 第1章 两个系统',
        '',
        '> 系统 1 的运行是无意识且快速的。',
        '',
        '微信读书的想法：系统 1 就是直觉。',
        '',
        '## 第2章 注意力',
        '',
        '> 努力是有代价的。',
        '',
        '## 书评',
        '',
        '好书。',
        '',
      ].join('\n'),
    )
    expect(r.added.map((m) => m.id)).toEqual(['m1', 'm3'])
    expect(new Set(r.written)).toEqual(new Set(['m1', 'm3', 't:r1', 't:r9']))
  })

  it('同一份数据同步两次，文件一个字节不变（换一台电脑、插件什么都没记着也一样）', () => {
    const r = mergeBook(null, sync([M1, M2, M3], [T1, R1]))
    const again = mergeBook(r.text, sync([M1, M2, M3], [T1, R1], r.written, NOW + 3600_000))
    expect(again.text).toBe(r.text)
    expect(again.added).toEqual([])
    const fresh = mergeBook(r.text, sync([M1, M2, M3], [T1, R1], [], NOW + 3600_000))
    expect(fresh.text).toBe(r.text)
  })

  it('用户写的评价、自己的一段、改过的类型都留着；新划线插在这一章最后一条引文（连同它的评价）后面', () => {
    const base = mergeBook(null, sync([M1])).text
    const user = base
      .replace('类型: 书摘', '类型: 笔记')
      .replace('> 系统 1 的运行是无意识且快速的。\n', '> 系统 1 的运行是无意识且快速的。\n\n我的评价：省力是天性。\n\n我自己的想法：要多用系统 2\n')
    const r = mergeBook(user, sync([M1, M2], [], ['m1'], NOW + 60_000))
    expect(r.added.map((m) => m.id)).toEqual(['m2'])
    expect(r.text).toContain('类型: 笔记\n')
    expect(r.text).toContain('划线: 2\n')
    expect(r.text).toContain('updated: 2026-11-17 21:26\n')
    expect(r.text.slice(r.text.indexOf('## 第1章'))).toBe(
      ['## 第1章 两个系统', '', '> 系统 1 的运行是无意识且快速的。', '', '我的评价：省力是天性。', '', '> 系统 2 将注意力转移到需要费脑力的大脑活动上来。', '', '我自己的想法：要多用系统 2', ''].join('\n'),
    )
    // 用户写的那几行一个字没动：去掉新插的那一段、两个数和时间，就是用户的原文
    const back = r.text.replace('\n\n> 系统 2 将注意力转移到需要费脑力的大脑活动上来。', '').replace('划线: 2', '划线: 1').replace('updated: 2026-11-17 21:26', 'updated: 2026-11-17 21:25')
    expect(back).toBe(user)
  })

  it('用户删掉的划线不加回来（插件记着写过哪些）；删掉的想法也不加回来', () => {
    const r0 = mergeBook(null, sync([M1, M2], [T1]))
    const user = r0.text.replace('\n\n> 系统 2 将注意力转移到需要费脑力的大脑活动上来。', '').replace('\n\n微信读书的想法：系统 1 就是直觉。', '')
    expect(user).not.toContain('系统 2 将注意力')
    const r = mergeBook(user, sync([M1, M2], [T1], r0.written, NOW + 60_000))
    expect(r.text).toBe(user)
    expect(r.added).toEqual([])
  })

  it('同一章里早一点的划线插在后面那条前面（按书里的先后）；没有的章按章节先后新起一节', () => {
    const r0 = mergeBook(null, sync([M2, M4]))
    const r = mergeBook(r0.text, sync([M1, M2, M3, M4], [], r0.written))
    const body = r.text.slice(r.text.indexOf('# 思考'))
    expect(body).toBe(
      [
        '# 思考，快与慢',
        '',
        '## 第1章 两个系统',
        '',
        '> 系统 1 的运行是无意识且快速的。',
        '',
        '> 系统 2 将注意力转移到需要费脑力的大脑活动上来。',
        '',
        '## 第2章 注意力',
        '',
        '> 努力是有代价的。',
        '',
        '## 第3章 联想机器',
        '',
        '> 启动效应无处不在。',
        '',
      ].join('\n'),
    )
    expect(r.added.map((m) => m.id)).toEqual(['m1', 'm3'])
  })

  it('新想法挂在它那段引文下面、用户的评价前面；对不上引文的放进「想法」一节', () => {
    const base = mergeBook(null, sync([M1, M3])).text.replace('> 系统 1 的运行是无意识且快速的。\n', '> 系统 1 的运行是无意识且快速的。\n\n我的评价：说得对。\n')
    const lone: Thought = { id: 'r5', chapter: '第9章', abstract: '一段没划线的原文。', content: '记一笔。', created: 1, isReview: false }
    const r = mergeBook(base, sync([M1, M3], [T1, lone], ['m1', 'm3']))
    expect(r.text).toContain('> 系统 1 的运行是无意识且快速的。\n\n微信读书的想法：系统 1 就是直觉。\n\n我的评价：说得对。\n')
    expect(r.text.endsWith('## 想法\n\n> 一段没划线的原文。\n\n微信读书的想法：记一笔。\n')).toBe(true)
    expect(r.text).toContain('想法: 2\n')
  })

  it('旧文件（type: weread、英文键、开头一句说明、「想法：」）同步一次：开头只剩一个类型字段，键换成中文，正文只改想法的写法', () => {
    const OLD = [
      '---',
      'type: weread',
      'title: 思考，快与慢',
      'author: 丹尼尔·卡尼曼',
      'bookId: 900001',
      `source: ${URL}`,
      'marks: 1',
      'thoughts: 1',
      '---',
      '# 思考，快与慢',
      '',
      '丹尼尔·卡尼曼 · 微信读书里的划线和想法，软件自动同步，改这里不会改回微信读书。',
      '',
      '## 第1章 两个系统',
      '',
      '> 系统 1 的运行是无意识且快速的。',
      '',
      '想法：系统 1 就是直觉。',
      '',
      '我自己的想法：系统 1 就是偷懒',
      '',
    ].join('\n')
    const r = mergeBook(OLD, sync([M1], [T1]))
    expect(r.text).toBe(
      [
        '---',
        '类型: 书摘',
        '作者: 丹尼尔·卡尼曼',
        'bookId: 900001',
        `来源: ${URL}`,
        '划线: 1',
        '想法: 1',
        'updated: 2026-11-17 21:25',
        '---',
        '# 思考，快与慢',
        '',
        '## 第1章 两个系统',
        '',
        '> 系统 1 的运行是无意识且快速的。',
        '',
        '微信读书的想法：系统 1 就是直觉。',
        '',
        '我自己的想法：系统 1 就是偷懒',
        '',
      ].join('\n'),
    )
    expect(types(r.text)).toEqual([{ key: '类型', value: '书摘' }])
    expect(r.added).toEqual([])
    // 录屏里那份：用户在属性里选过「书摘」，多了一行「类型: 书摘」；同步后只剩这一行
    const both = OLD.replace('thoughts: 1\n', 'thoughts: 1\n类型: 书摘\n')
    expect(types(mergeBook(both, sync([M1], [T1])).text)).toEqual([{ key: '类型', value: '书摘' }])
    // 用户选的别的类型照样留着
    expect(types(mergeBook(OLD.replace('thoughts: 1\n', 'thoughts: 1\n类型: 笔记\n'), sync([M1], [T1])).text)).toEqual([{ key: '类型', value: '笔记' }])
  })

  it('同步提示的字：一段写章节；几段同一章写段数；跨章只写段数', () => {
    expect(syncedText('趣说明朝276年', [M1])).toBe('已同步到《趣说明朝276年》· 第1章 两个系统')
    expect(syncedText('趣说明朝276年', [M1, M2])).toBe('已同步到《趣说明朝276年》· 第1章 两个系统 · 2 段')
    expect(syncedText('趣说明朝276年', [M1, M3])).toBe('已同步到《趣说明朝276年》· 2 段')
  })

  it('书摘写进「阅读」（顶级分类改了以后）；旧的「素材/微信读书」照样认', () => {
    expect(WEREAD_FOLDER).toBe('阅读')
    expect(OLD_WEREAD_FOLDER).toBe('素材/微信读书')
    expect(bookFile('a/b: c?')).toBe('阅读/a b c.md')
  })
})

describe('书摘标题下一行摘要（CN-122）', () => {
  it('类型 · 作者 · 微信读书 N 条划线 · 同步于什么时候', () => {
    const t = mergeBook(null, sync([M1, M2], [T1])).text
    expect(bookMeta(t, NOW + 60_000)).toBe('书摘 · 丹尼尔·卡尼曼 · 微信读书 2 条划线 · 同步于今天 21:25')
    expect(bookMeta(t, NOW + 86400_000)).toBe('书摘 · 丹尼尔·卡尼曼 · 微信读书 2 条划线 · 同步于昨天 21:25')
    // 旧文件还没同步过：type: weread 当书摘，没有同步时间就不写
    expect(bookMeta('---\ntype: weread\ntitle: A\nauthor: 某人\nbookId: 1\nmarks: 3\n---\n# A\n', NOW)).toBe('书摘 · 某人 · 微信读书 3 条划线')
    // 不是微信读书同步来的书摘：没有这一行
    expect(bookMeta('---\n类型: 书摘\n---\n# 手抄的\n', NOW)).toBeNull()
  })
})
