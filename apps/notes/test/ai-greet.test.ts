// AI 空对话打招呼（task-0tgz2，小样 design/ai-empty 方向 A）：钟点问候、跟着在看的东西走的那一句、底部快捷命令挑哪几条
import { describe, expect, it } from 'vitest'
import { askLine, hello, quickCmds, shortTitle } from '../src/renderer/ai-greet'

describe('钟点问候', () => {
  it('0–5 点夜深了，5–11 早上好，11–13 中午好，13–18 下午好，18–24 晚上好', () => {
    expect([0, 4, 5, 10, 11, 12, 13, 17, 18, 23].map(hello)).toEqual(['夜深了', '夜深了', '早上好', '早上好', '中午好', '中午好', '下午好', '下午好', '晚上好', '晚上好'])
  })
})

describe('问候下面那一句里的名字', () => {
  it('去掉「（微信读书首发）」这类尾巴，取冒号前那一截（前面至少两个字），最多 12 个字', () => {
    expect(shortTitle('读懂红楼：六神磊磊读红楼+红楼梦（微信读书首发）')).toBe('读懂红楼')
    expect(shortTitle('趣说明朝276年（微信读书出品）')).toBe('趣说明朝276年')
    expect(shortTitle('第3讲: 矩阵乘法')).toBe('第3讲')
    expect(shortTitle('A：一个字的前缀不切')).toBe('A：一个字的前缀不切')
    expect(shortTitle('一个很长很长很长很长很长的笔记名字')).toBe('一个很长很长很长很长很长…')
    expect(shortTitle('随手记')).toBe('随手记')
  })
})

describe('跟着在看的东西走的那一句', () => {
  const o = { board: false, inbox: 2, label: '' }
  it('文档、书摘写名字，白板多「白板」两个字', () => {
    expect(askLine({ id: 'a', type: 'note', path: '阅读/读懂红楼：六神磊磊读红楼+红楼梦（微信读书首发）.md' }, { ...o, label: '读懂红楼：六神磊磊读红楼+红楼梦' })).toBe('要对《读懂红楼》做点什么？')
    expect(askLine({ id: 'a', type: 'note', path: '写作/白板草稿.md' }, { ...o, board: true, label: '白板草稿' })).toBe('要对白板《白板草稿》做点什么？')
  })
  it('文件夹用「」，收件箱说有几条，首页、别的页不写名字', () => {
    expect(askLine({ id: 'a', type: 'folder', folder: '周记' }, { ...o, label: '周记' })).toBe('要对「周记」做点什么？')
    expect(askLine({ id: 'a', type: 'topic', topic: '冰岛' }, { ...o, label: '冰岛' })).toBe('要对「冰岛」做点什么？')
    expect(askLine({ id: 'a', type: 'inbox' }, { ...o, label: '收件箱' })).toBe('收件箱里有2条，要分一分吗？')
    expect(askLine({ id: 'a', type: 'inbox' }, { ...o, inbox: 0, label: '收件箱' })).toBe('收件箱是空的，想做点什么？')
    expect(askLine({ id: 'a', type: 'home' }, { ...o, label: '首页' })).toBe('今天想整理点什么？')
    expect(askLine({ id: 'a', type: 'recent' }, { ...o, label: '最近' })).toBe('想做点什么？')
    expect(askLine(null, { ...o, label: '空白页' })).toBe('想做点什么？')
  })
  it('网页写标题，读 PDF 说框一块就能问（去掉 .pdf）', () => {
    expect(askLine({ id: 'a', type: 'web', url: 'https://weread.qq.com/', title: '微信读书' }, { ...o, label: '微信读书' })).toBe('要对《微信读书》做点什么？')
    expect(askLine({ id: 'a', type: 'pdf', path: '课程/线代/第3讲.pdf' }, { ...o, label: '第3讲.pdf' })).toBe('要问《第3讲》哪里？框一块就能问。')
  })
})

describe('底部快捷命令挑哪几条', () => {
  const doc = { id: 'a', type: 'note', path: '随手记.md' } as const
  const o = { web: false, board: false, inbox: 2 }
  it('右栏开着网页时剪藏这一页排第一；文档是翻译、整理收件箱', () => {
    expect(quickCmds(doc, { ...o, web: true })).toEqual(['剪藏这一页', '翻译', '整理收件箱'])
    expect(quickCmds(doc, o)).toEqual(['翻译', '整理收件箱'])
  })
  it('收件箱空着不放整理收件箱，不拿别的凑数', () => {
    expect(quickCmds(doc, { ...o, inbox: 0 })).toEqual(['翻译'])
  })
  it('白板四条：整理、总结、写成文章、整理收件箱；最多四条', () => {
    expect(quickCmds(doc, { ...o, board: true })).toEqual(['整理当前白板', '总结这块白板', '写成文章', '整理收件箱'])
    expect(quickCmds(doc, { ...o, board: true, web: true })).toEqual(['剪藏这一页', '整理当前白板', '总结这块白板', '写成文章'])
  })
  it('收件箱、首页、别的页', () => {
    expect(quickCmds({ id: 'a', type: 'inbox' }, o)).toEqual(['整理收件箱', '找重复', '现在梦游'])
    expect(quickCmds({ id: 'a', type: 'inbox' }, { ...o, inbox: 0 })).toEqual(['找重复'])
    expect(quickCmds({ id: 'a', type: 'home' }, o)).toEqual(['整理收件箱', '现在梦游', '找重复'])
    expect(quickCmds({ id: 'a', type: 'recent' }, o)).toEqual(['整理收件箱', '找重复'])
    expect(quickCmds(null, { ...o, inbox: 0 })).toEqual(['找重复'])
  })
})
