import { describe, expect, it } from 'vitest'
import { boardOutline, docOutline } from '../src/renderer/shell/outline'
import { ICELAND } from '../e2e/fixtures/board'

describe('右栏大纲', () => {
  it('文档：按 # 标题列出，最浅的一级顶格；属性区和代码块里的 # 不算', () => {
    const md = '---\ntitle: x\n# 不是标题\n---\n# 思考，快与慢\n\n## 两个系统\n\n```\n# 代码里的\n```\n### 锚定效应\n## 前景理论 ##\n'
    expect(docOutline(md)).toEqual([
      { text: '思考，快与慢', depth: 0, line: 4 },
      { text: '两个系统', depth: 1, line: 6 },
      { text: '锚定效应', depth: 2, line: 11 },
      { text: '前景理论', depth: 1, line: 12 },
    ])
    expect(docOutline('## 只有二级\n')).toEqual([{ text: '只有二级', depth: 0, line: 0 }])
    expect(docOutline('没有标题\n')).toEqual([])
  })

  it('白板（2026-11-21 起就是这篇文档）：列（id 是 col:列名）、有标题的卡（加粗那一行、冒号那句；id 是白板上的名字），列里的缩一层', () => {
    const md = '---\ntype: board\n---\n# 冰岛\n\n**先定**\n两晚住哪。\n\n## 出发前\n\n**还没订的**\n- [ ] 车\n\n一段没标题的\n\n<!-- card id=d1 x=10 y=20 -->\n**摆在空白处的**\n'
    expect(boardOutline(md).map((o) => [o.text, o.depth, o.id])).toEqual([
      ['先定', 0, expect.stringMatching(/^k/)],
      ['出发前', 0, 'col:出发前'],
      ['还没订的', 1, expect.stringMatching(/^k/)],
      ['摆在空白处的', 0, 'd1'],
    ])
  })

  it('白板：有标题的卡片，再是列和列里的卡片（缩一层）', () => {
    expect(boardOutline(ICELAND).map((o) => [o.text, o.depth])).toEqual([
      ['出发前先定', 0],
      ['还没订的', 0],
      ['极光看哪两晚', 0],
      ['3 月 1 日，维克，云量预报 20%', 1],
      ['3 月 3 日，霍芬，看 [[极光预报]] 再定', 1],
    ])
  })
})
