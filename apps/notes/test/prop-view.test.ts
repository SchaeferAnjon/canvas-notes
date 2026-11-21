import { describe, expect, it } from 'vitest'
import { langLabel, propRows, showValue, typeOf } from '../src/shared/prop-view'

const rows = (t: string) => propRows(t).map((r) => [r.label, r.shown, r.kind])

describe('属性弹层列哪几行（按类型，界面上是中文名，文件里的键不改）', () => {
  it('视频：类型、网站、频道、时长、字幕、译成、来源；读来的只看', () => {
    const t = '---\ntype: video\nsource: https://www.youtube.com/watch?v=x\nsite: youtube\nchannel: 我拿过诺奖\nduration: 1719\nsubtitles: en · 自动生成\ntranslated: zh-CN\n---\n# 视频\n'
    expect(rows(t)).toEqual([
      ['类型', '视频', 'select'],
      ['网站', 'YouTube', 'text'],
      ['频道', '我拿过诺奖', 'input'],
      ['时长', '28:39', 'text'],
      ['字幕', '英语 · 自动生成', 'text'],
      ['译成', '简体中文', 'text'],
      ['来源', 'https://www.youtube.com/watch?v=x', 'text'],
    ])
    expect(propRows(t).map((r) => r.key)).toEqual(['类型', 'site', 'channel', 'duration', 'subtitles', 'translated', 'source'])
  })
  it('剪藏的网页：类型、来源、剪于；书摘照旧五项', () => {
    expect(rows('---\ncreated: 2026-11-20 16:08\nsource: https://example.com/a\n---\n# a\n')).toEqual([
      ['类型', '剪藏', 'select'],
      ['来源', 'https://example.com/a', 'text'],
      ['剪于', '2026-11-20 16:08', 'text'],
    ])
    expect(propRows('---\n类型: 书摘\n作者: 关丁\nbookId: 1\n---\n# 书\n').map((r) => r.label)).toEqual(['类型', '作者', '来源', '划线', '想法'])
  })
  it('写了「类型」的照写的；别的英文键显示中文名、自己起的名字原样', () => {
    expect(typeOf('---\n类型: 笔记\nsource: https://a.b\n---\n')).toEqual({ type: '笔记', written: true })
    expect(rows('---\n类型: 笔记\nauthor: Ann\n老师: 王\n---\n')).toEqual([
      ['类型', '笔记', 'select'],
      ['课程', '', 'select'],
      ['作者', 'Ann', 'input'],
      ['老师', '王', 'input'],
    ])
  })
  it('值的写法：时长过一小时写 h:mm:ss、B 站、认不出的语言原样', () => {
    expect(showValue('duration', '3725')).toBe('1:02:05')
    expect(showValue('site', 'bilibili')).toBe('哔哩哔哩')
    expect(showValue('subtitles', 'zh · 人工字幕')).toBe('中文 · 人工字幕')
    expect(langLabel('xx-weird-1')).toBe('xx-weird-1')
  })
})
