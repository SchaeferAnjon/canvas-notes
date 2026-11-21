// 找重复（CN-56）：软件汇总的「我的疑惑」「视频里的疑惑」不参加；一篇明确链着另一篇当来源的也不配成一对
import { doubtsNote, type DoubtItem } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { duplicatesOf, isAutoSummary, linksTo } from '../src/main/duplicates'

const PARA = '加速器为什么又快又省：把常用的运算做成专门的电路，流水线每人只做一步，不用再看菜谱、找工具，所以同样的电费能算更多。'

describe('找重复', () => {
  it('两篇自己写的、讲同一件事：照样配成一对', () => {
    const pairs = duplicatesOf([
      { id: '课程/ecp/Lecture05 笔记.md', text: `# Lecture05 笔记\n\n${PARA}\n\n第 6 页讲物理启发。\n` },
      { id: '收件箱/加速器.md', text: `# 加速器\n\n${PARA}\n` },
    ])
    expect(pairs).toHaveLength(1)
    // 理由里百分数和中文之间不手打空格，间距交给 autospace（第 4 轮美学）
    expect(pairs[0]!.why).toMatch(/^(两篇约\d+%的字句相同|短的那篇有\d+%在另一篇里)，/)
    expect(pairs[0]!.why).not.toMatch(/ \d+%|% /)
  })

  it('我的疑惑（生成: 软件）和它的来源笔记：不配对', () => {
    const item: DoubtItem = {
      id: 'x',
      pdf: '课程/ecp/Lecture05.pdf',
      lecture: 5,
      section: { id: 'x', page: 5, title: '加速器', doubts: [PARA], good: PARA, rect: null, time: '20:50' } as unknown as DoubtItem['section'],
    }
    const doubts = doubtsNote('课程/ecp', 'ecp', [item], new Set())
    expect(isAutoSummary(doubts)).toBe(true)
    const pairs = duplicatesOf([
      { id: '课程/ecp/Lecture05 笔记.md', text: `# Lecture05 笔记\n\n## 第 5 页\n\n> [!question] 我的疑惑\n> ${PARA}\n\n> [!success] 讲通的讲法\n> ${PARA}\n` },
      { id: '课程/ecp/我的疑惑.md', text: doubts },
    ])
    expect(pairs).toEqual([])
  })

  it('以前写的「视频里的疑惑」（front matter「生成: 软件」，2026-11-20 起不再写）：它不参加找重复', () => {
    const entry = `## 01:37 · 赛百味\n> ${PARA}\n\n${PARA}\n\n[▶ 01:37](https://www.youtube.com/watch?v=a&t=97) · 记在 [[又贵又难吃的赛百味]]`
    const old = `---\n类型: 视频里的疑惑\n生成: 软件\n---\n\n# 视频里的疑惑\n\n看视频时框一块问过 AI 的地方，新的在后面。读 PDF 时问的在「我的疑惑」。\n\n${entry}\n`
    expect(duplicatesOf([{ id: '视频里的疑惑.md', text: old }, { id: '又贵又难吃的赛百味.md', text: `# 赛百味\n\n${PARA}\n\n${PARA}\n` }])).toEqual([])
  })

  it('一篇明确链着另一篇（[[名字]]、相对链接、链到它那份 PDF）：不配对；没链着的照样配', () => {
    expect(linksTo({ id: 'a.md', text: '记在 [[Lecture05 笔记]]' }, { id: '课程/ecp/Lecture05 笔记.md' })).toBe(true)
    expect(linksTo({ id: '课程/ecp/我的疑惑.md', text: '[第 5 页](Lecture05.pdf#page=5)' }, { id: '课程/ecp/Lecture05 笔记.md' })).toBe(true)
    expect(linksTo({ id: '课程/ecp/a.md', text: '[看这篇](../ecp/b.md)' }, { id: '课程/ecp/b.md' })).toBe(true)
    expect(linksTo({ id: 'a.md', text: '没有链接 [[别的]]' }, { id: 'b.md' })).toBe(false)
    const pairs = duplicatesOf([
      { id: 'a.md', text: `# a\n\n${PARA}\n\n相关：[[b]]\n` },
      { id: 'b.md', text: `# b\n\n${PARA}\n` },
    ])
    expect(pairs).toEqual([])
  })
})
