import { attr, content, parseBoard } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { addMomentToBoard, boardMomentStats } from '../src/renderer/video/board'
import {
  biliTracks,
  chaptersFor,
  cueAt,
  cuesAround,
  destFor,
  fmtTime,
  momentMd,
  parseBiliSubtitle,
  parseJson3,
  parseMoment,
  parseSummary,
  parseVideoCard,
  pickTrack,
  readTranslations,
  relLink,
  subtitleDoc,
  timeParam,
  timeUrl,
  videoCardMd,
  videoOf,
  ytTracks,
} from '../src/shared/video'

describe('认视频页', () => {
  it('YouTube 的 watch、shorts、live、youtu.be', () => {
    expect(videoOf('https://www.youtube.com/watch?v=kYB8IZa5AuE&t=10s')).toEqual({ site: 'youtube', id: 'kYB8IZa5AuE', key: 'youtube:kYB8IZa5AuE' })
    expect(videoOf('https://m.youtube.com/shorts/abcDEF12345')?.id).toBe('abcDEF12345')
    expect(videoOf('https://www.youtube.com/live/abcDEF12345')?.id).toBe('abcDEF12345')
    expect(videoOf('https://youtu.be/kYB8IZa5AuE')?.key).toBe('youtube:kYB8IZa5AuE')
    expect(videoOf('https://www.youtube.com/')).toBeNull()
    expect(videoOf('https://www.youtube.com/results?search_query=x')).toBeNull()
  })
  it('B 站的 /video/、英文界面的 /en/video/、分 P、/list/', () => {
    expect(videoOf('https://www.bilibili.com/video/BV1ys411472E')).toEqual({ site: 'bilibili', id: 'BV1ys411472E', key: 'bilibili:BV1ys411472E' })
    expect(videoOf('https://www.bilibili.com/en/video/BV1ys411472E?p=3')).toEqual({ site: 'bilibili', id: 'BV1ys411472E', p: 3, key: 'bilibili:BV1ys411472E:3' })
    expect(videoOf('https://www.bilibili.com/list/123?bvid=BV1ys411472E')?.id).toBe('BV1ys411472E')
    expect(videoOf('https://www.bilibili.com/')).toBeNull()
    expect(videoOf('https://example.com/watch?v=kYB8IZa5AuE')).toBeNull()
  })
  it('带时间的链接：YouTube 用秒加 s，B 站带 p', () => {
    expect(timeUrl({ site: 'youtube', id: 'kYB8IZa5AuE' }, 222.4)).toBe('https://www.youtube.com/watch?v=kYB8IZa5AuE&t=222s')
    expect(timeUrl({ site: 'bilibili', id: 'BV1ys411472E' }, 222.9)).toBe('https://www.bilibili.com/video/BV1ys411472E?p=1&t=222')
    expect(timeParam('https://www.youtube.com/watch?v=x&t=222s')).toBe(222)
    expect(timeParam('https://www.youtube.com/watch?v=x&t=3m42s')).toBe(222)
    expect(timeParam('https://www.bilibili.com/video/BV1?p=1&t=90')).toBe(90)
    expect(timeParam('https://www.youtube.com/watch?v=x')).toBeNull()
    expect(fmtTime(222.4)).toBe('03:42')
    expect(fmtTime(3723)).toBe('1:02:03')
  })
})

describe('字幕', () => {
  it('YouTube 人工字幕：一个事件一条', () => {
    const cues = parseJson3({ events: [{ tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] }, { tStartMs: 2000, dDurationMs: 10, aAppend: 1, segs: [{ utf8: '\n' }] }, { tStartMs: 3000, dDurationMs: 1500, segs: [{ utf8: 'Second\nline' }] }] }, false)
    expect(cues).toEqual([
      { start: 0, end: 2, text: 'Hello world' },
      { start: 3, end: 4.5, text: 'Second line' },
    ])
  })
  it('自动生成的：词按停顿和句末合成句子，留着开始时间', () => {
    const cues = parseJson3(
      {
        events: [
          { tStartMs: 0, dDurationMs: 4000, segs: [{ utf8: 'so' }, { utf8: ' this', tOffsetMs: 300 }, { utf8: ' is', tOffsetMs: 600 }, { utf8: ' it.', tOffsetMs: 900 }] },
          { tStartMs: 1500, dDurationMs: 10, aAppend: 1, segs: [{ utf8: '\n' }] },
          { tStartMs: 4000, dDurationMs: 2000, segs: [{ utf8: 'next' }, { utf8: ' one', tOffsetMs: 200 }] },
        ],
      },
      true,
    )
    expect(cues.map((c) => [c.start, c.text])).toEqual([
      [0, 'so this is it.'],
      [4, 'next one'],
    ])
  })
  it('B 站字幕和字幕列表；没登录拿不到列表时说要登录', () => {
    expect(parseBiliSubtitle('{"body":[{"from":1.2,"to":3,"content":"你好"},{"from":3,"to":4,"content":" "}]}')).toEqual([{ start: 1.2, end: 3, text: '你好' }])
    const r = biliTracks({ data: { login_mid: 1, subtitle: { subtitles: [{ lan: 'ai-zh', lan_doc: '中文（自动生成）', subtitle_url: '//aisubtitle.hdslb.com/a.json' }, { lan: 'en-US', lan_doc: '英语', subtitle_url: 'https://x/b.json' }] } } })
    expect(r.tracks.map((t) => [t.lang, t.auto, t.url])).toEqual([
      ['en-US', false, 'https://x/b.json'],
      ['ai-zh', true, 'https://aisubtitle.hdslb.com/a.json'],
    ])
    expect(biliTracks({ data: { login_mid: 0, subtitle: { subtitles: [] } } }).needLogin).toBe(true)
  })
  it('YouTube 的字幕列表：人工在前，上次选的还在就用它', () => {
    const t = ytTracks([{ languageCode: 'en', kind: 'asr', name: { simpleText: 'English (auto-generated)' } }, { languageCode: 'en', name: { simpleText: 'English' } }, { languageCode: 'de', name: { runs: [{ text: 'German' }] } }])
    expect(t.map((x) => [x.lang, x.auto])).toEqual([
      ['en', false],
      ['de', false],
      ['en', true],
    ])
    expect(pickTrack(t, 'de')?.lang).toBe('de')
    expect(pickTrack(t, 'fr')).toEqual(t[0])
    expect(pickTrack([], null)).toBeNull()
  })
  it('正在播的那条、前后几条', () => {
    const cues = [0, 5, 10, 15, 20, 25].map((s) => ({ start: s, end: s + 3, text: `c${s}` }))
    expect(cueAt(cues, 11)).toBe(2)
    expect(cueAt(cues, 14)).toBe(2)
    expect(cueAt(cues, 14.9)).toBe(-1)
    const a = cuesAround(cues, 11)
    expect(a.list.map((c) => c.text)).toEqual(['c0', 'c5', 'c10', 'c15', 'c20'])
    expect(a.current).toBe(2)
    expect(cuesAround(cues, 1).current).toBe(0)
  })
})

describe('存进笔记', () => {
  const v = videoOf('https://www.youtube.com/watch?v=kYB8IZa5AuE')!
  const around = {
    list: [
      { start: 214, end: 218, text: 'i-hat, pointing one unit to the right,', tr: 'i 帽，向右一个单位；' },
      { start: 222, end: 227, text: "It's all about where those two basis vectors land.", tr: '关键就在于这两个基向量落到了哪里。' },
      { start: 227, end: 230, text: 'Take any vector.' },
    ],
    current: 1,
  }
  it('时刻写成普通 md，读回来一样', () => {
    const md = momentMd(v, { title: 'Linear transformations [and] matrices' }, 222.4, '附件/视频/youtube-kYB8IZa5AuE/03-42.jpg', around)
    expect(md).toBe(
      [
        '<!-- moment video=youtube:kYB8IZa5AuE t=222.4 -->',
        '![03:42](附件/视频/youtube-kYB8IZa5AuE/03-42.jpg)',
        '[▶ 03:42 · Linear transformations ［and］ matrices](https://www.youtube.com/watch?v=kYB8IZa5AuE&t=222s)',
        '> 03:34 i-hat, pointing one unit to the right, / i 帽，向右一个单位；',
        "> **03:42 It's all about where those two basis vectors land. / 关键就在于这两个基向量落到了哪里。**",
        '> 03:47 Take any vector.',
      ].join('\n'),
    )
    const m = parseMoment(md)!
    expect(m.key).toBe('youtube:kYB8IZa5AuE')
    expect(m.t).toBe(222.4)
    expect(m.image).toBe('附件/视频/youtube-kYB8IZa5AuE/03-42.jpg')
    expect(m.lines.map((l) => [l.time, l.tr, l.current])).toEqual([
      ['03:34', 'i 帽，向右一个单位；', false],
      ['03:42', '关键就在于这两个基向量落到了哪里。', true],
      ['03:47', '', false],
    ])
    expect(parseMoment('普通的一段')).toBeNull()
  })
  it('视频卡：白板卡片认得出，文档里多一行注释也认得出', () => {
    const meta = { title: 'Linear transformations and matrices', channel: '3Blue1Brown', duration: 658 }
    const card = videoCardMd(v, meta, '附件/视频/youtube-kYB8IZa5AuE/cover.jpg', { comment: false })
    expect(card).toBe('![Linear transformations and matrices](附件/视频/youtube-kYB8IZa5AuE/cover.jpg)\n[Linear transformations and matrices](https://www.youtube.com/watch?v=kYB8IZa5AuE)\n3Blue1Brown · 10:58')
    expect(parseVideoCard(card)).toMatchObject({ title: meta.title, meta: '3Blue1Brown · 10:58', cover: '附件/视频/youtube-kYB8IZa5AuE/cover.jpg' })
    expect(parseVideoCard(videoCardMd(v, meta, null, { comment: true }))?.ref.key).toBe('youtube:kYB8IZa5AuE')
    // 光秃秃的一个视频链接也算（白板上原来只显示域名的那种）
    expect(parseVideoCard('https://www.youtube.com/watch?v=kYB8IZa5AuE')).toBeNull()
    expect(parseVideoCard('[看这个](https://www.youtube.com/watch?v=kYB8IZa5AuE)')?.title).toBe('看这个')
    expect(parseVideoCard('[一个网页](https://example.com/)')).toBeNull()
  })
  it('字幕全文：摘要带时间链接、按章节、下一行译文；读回译文', () => {
    const cues = [
      { start: 0, end: 4, text: 'Hello.', tr: '你好。' },
      { start: 320, end: 324, text: 'Later.', tr: '后来。' },
    ]
    const doc = subtitleDoc({
      ref: v,
      meta: { title: 'T', channel: 'C', duration: 658 },
      track: { lang: 'en', name: 'English', auto: false },
      target: 'zh-CN',
      cues,
      chapters: [],
      summary: [{ t: 52, text: '矩阵是空间的变换。' }],
      moments: [{ t: 222, text: '基向量落到哪', note: '第3讲 笔记' }],
      withTranslation: true,
    })
    expect(doc).toContain('type: video\nsource: https://www.youtube.com/watch?v=kYB8IZa5AuE\n')
    expect(doc).toContain('- [00:52](https://www.youtube.com/watch?v=kYB8IZa5AuE&t=52s) 矩阵是空间的变换。')
    expect(doc).toContain('- [03:42](https://www.youtube.com/watch?v=kYB8IZa5AuE&t=222s) 基向量落到哪 · [[第3讲 笔记]]')
    expect(doc).toContain('## 00:00 00:00 起\n[00:00](https://www.youtube.com/watch?v=kYB8IZa5AuE&t=0s) Hello.\n你好。')
    expect(doc).toContain('## 05:00 05:00 起\n[05:20]')
    expect(readTranslations(doc).get('05:20 Later.')).toBe('后来。')
    expect(chaptersFor(cues, [{ start: 0, title: '开场' }])).toEqual([{ start: 0, title: '开场' }])
  })
  it('图片链接按笔记所在文件夹算', () => {
    expect(relLink('第3讲.md', '附件/视频/youtube-x/03-42.jpg')).toBe('附件/视频/youtube-x/03-42.jpg')
    expect(relLink('课程/线性代数/第3讲.md', '附件/视频/youtube-x/03-42.jpg')).toBe('../../附件/视频/youtube-x/03-42.jpg')
    expect(relLink('附件/a.md', '附件/视频/a b.jpg')).toBe('视频/a%20b.jpg')
  })
  it('AI 摘要的回答：每行一个时间一句话', () => {
    expect(parseSummary('- 00:52 矩阵是变换\n[03:00] 线性\n乱写一行\n1:02:03 — 结尾')).toEqual([
      { t: 52, text: '矩阵是变换' },
      { t: 180, text: '线性' },
      { t: 3723, text: '结尾' },
    ])
  })
  it('记到哪：文档插光标处，白板进时刻列，字幕全文记进上一篇文档，什么都没开进收件箱', () => {
    expect(destFor({ kind: 'doc', path: 'a.md', title: 'a' }, null, 'V')).toEqual({ kind: 'doc', path: 'a.md', title: 'a' })
    expect(destFor({ kind: 'board', path: 'b.md', title: 'b' }, null, 'V').kind).toBe('board')
    expect(destFor({ kind: 'material', path: '素材/视频/V.md', title: 'V' }, { path: 'a.md', title: 'a' }, 'V')).toEqual({ kind: 'doc', path: 'a.md', title: 'a' })
    expect(destFor({ kind: 'none' }, null, 'Linear: transformations?')).toEqual({ kind: 'inbox', path: '收件箱/Linear transformations.md', title: 'Linear transformations' })
  })
})

describe('白板的「时刻」列', () => {
  const key = 'youtube:kYB8IZa5AuE'
  const card = '![T](附件/视频/youtube-kYB8IZa5AuE/cover.jpg)\n[T](https://www.youtube.com/watch?v=kYB8IZa5AuE)\n3B1B · 10:58'
  const m1 = '<!-- moment video=youtube:kYB8IZa5AuE t=10 -->\n[▶ 00:10 · T](https://www.youtube.com/watch?v=kYB8IZa5AuE&t=10s)'
  const m2 = '<!-- moment video=youtube:kYB8IZa5AuE t=20 -->\n[▶ 00:20 · T](https://www.youtube.com/watch?v=kYB8IZa5AuE&t=20s)'
  it('没有视频卡：先放一张，右边建「时刻」列，时刻进列；再记一个排在最上面', () => {
    const start = '---\ntype: board\n---\n# 线性代数\n\n<!-- card id=a1 x=60 y=60 w=280 -->\n别的卡片\n'
    const one = addMomentToBoard(start, key, m1, card)
    const two = addMomentToBoard(one.text, key, m2, card)
    const doc = parseBoard(two.text)
    const video = doc.blocks.find((b) => content(b).startsWith('![T]'))!
    expect(attr(video, 'x')).toBe('380')
    const col = doc.blocks.find((b) => b.kind === 'column')!
    expect(attr(col, 'title')).toBe('时刻')
    expect(attr(col, 'moments')).toBe(key)
    const inCol = doc.blocks.filter((b) => attr(b, 'in') === attr(col, 'id')).map((b) => content(b))
    expect(inCol).toEqual([m2, m1])
    expect(boardMomentStats(two.text, key)).toEqual({ moments: 2, asked: 0 })
    // 别的卡片原样
    expect(two.text.startsWith('---\ntype: board\n---\n# 线性代数\n\n<!-- card id=a1 x=60 y=60 w=280 -->\n别的卡片\n\n')).toBe(true)
  })
  it('白板上已经有这个视频的卡：列建在它右边', () => {
    const start = `---\ntype: board\n---\n<!-- card id=v1 x=100 y=200 w=262 -->\n${card}\n`
    const r = addMomentToBoard(start, key, m1, card)
    const col = parseBoard(r.text).blocks.find((b) => b.kind === 'column')!
    expect([attr(col, 'x'), attr(col, 'y')]).toEqual(['386', '200'])
    expect(parseBoard(r.text).blocks.filter((b) => content(b).startsWith('![T]'))).toHaveLength(1)
  })
})
