/**
 * 费曼一节在白板文档里的边界（② 界面线，task-yvabi）：白板的位置行、旧白板和导图白板的卡片块是后面那一样的，
 * 这一节到它为止；往这一节里加话不会写进后面那张卡、那一列里。
 */
import { describe, expect, it } from 'vitest'
import { addRound, appendEntry, findRounds } from '../src/shared/feynman/doc'
import type { FeynmanMeta } from '../src/shared/feynman/types'

const meta: FeynmanMeta = { v: 1, id: 'f-20261123-a1b2', topic: '范数', scope: 'point', status: 'talking', from: [], cover: [], points: [], myths: [], day: '2026-11-23', nth: 1, asked: [], peeks: 0 }

describe('费曼一节到白板的位置行为止', () => {
  it('文档白板：后面拖到空白处的卡（位置行）不算进这一节，加的话写在位置行前面', () => {
    const base = '# 白板\n\n## 第一列\n\n一张卡。\n'
    let t = addRound(base, meta)
    t = t + '\n<!-- card id=d1 x=10 y=20 -->\n拖到空白处的卡\n'
    t = appendEntry(t, meta.id, 'me', '范数就是向量有多大。')
    expect(t).toContain('范数就是向量有多大。\n\n<!-- card id=d1 x=10 y=20 -->\n拖到空白处的卡\n')
    const r = findRounds(t)[0]!
    expect(r.entries.map((e) => e.text)).toEqual(['范数就是向量有多大。'])
  })

  it('导图白板：这一节插在卡片块前面，往里加话不进最后一张卡', () => {
    const map = '---\ntype: board\n白板样式: 导图\n---\n# 导图\n\n- 中心\n  - 范数\n\n<!-- card id=k1 x=40 y=620 w=300 -->\n一张卡\n'
    const at = map.indexOf('<!-- card')
    let t = addRound(map, meta, { at })
    t = appendEntry(t, meta.id, 'me', '我讲的一段。')
    expect(t.indexOf('## 费曼 · 范数')).toBeLessThan(t.indexOf('<!-- card id=k1'))
    expect(t).toContain('我讲的一段。\n\n<!-- card id=k1 x=40 y=620 w=300 -->\n一张卡\n')
    expect(t.startsWith('---\ntype: board\n白板样式: 导图\n---\n# 导图\n\n- 中心\n  - 范数\n\n')).toBe(true)
  })
})
