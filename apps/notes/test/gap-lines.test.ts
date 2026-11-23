/**
 * 空行怎么数（task-axoxy，用户定的方案 B，照 Tolaria）：N 个空行 = 1 道缝 + (N − 1) 个空块；标题前最后一个空行是留白；
 * 文件末尾的空行不算块；代码块里的空行不算空行。
 */
import { markdown } from '@codemirror/lang-markdown'
import { ensureSyntaxTree } from '@codemirror/language'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { blankRole, emptiesIn, oneMore } from '../src/renderer/gap-lines'

const roles = (doc: string) => {
  const state = EditorState.create({ doc, extensions: [markdown()] })
  ensureSyntaxTree(state, state.doc.length, 5000)
  return Array.from({ length: state.doc.lines }, (_, i) => blankRole(state, i + 1) ?? 'text')
}

describe('空行的数法', () => {
  it('一个空行是缝，两个是缝 + 一个空块，三个是缝 + 两个空块', () => {
    expect(roles('上\n\n下')).toEqual(['text', 'sep', 'text'])
    expect(roles('上\n\n\n下')).toEqual(['text', 'sep', 'empty', 'text'])
    expect(roles('上\n\n\n\n下')).toEqual(['text', 'sep', 'empty', 'empty', 'text'])
  })

  it('标题前最后一个空行算标题上方的留白：两个空行照旧画成一道缝，三个才有一个空块', () => {
    expect(roles('上\n\n## 题')).toEqual(['text', 'sep', 'text'])
    expect(roles('上\n\n\n## 题')).toEqual(['text', 'sep', 'margin', 'text'])
    expect(roles('上\n\n\n\n## 题')).toEqual(['text', 'sep', 'empty', 'margin', 'text'])
  })

  it('文件末尾的空行不算块，文件本来以空行结尾时最后那一行是灰字的地方；代码块里的空行不算', () => {
    expect(roles('上\n')).toEqual(['text', 'sep'])
    expect(roles('上\n\n\n\n')).toEqual(['text', 'sep', 'pad', 'pad', 'empty'])
    expect(roles('```\na\n\n\nb\n```')).toEqual(['text', 'text', 'text', 'text', 'text', 'text'])
  })

  it('几个空行几个空块、再加一个空块要几个换行', () => {
    expect([1, 2, 3].map((k) => emptiesIn(k, false))).toEqual([0, 1, 2])
    expect([1, 2, 3, 4].map((k) => emptiesIn(k, true))).toEqual([0, 0, 1, 2])
    expect([0, 1, 2].map((k) => oneMore(k, false))).toEqual([2, 1, 1])
    expect([0, 1, 2, 3].map((k) => oneMore(k, true))).toEqual([3, 2, 1, 1])
  })
})
