// 读 PDF 那一套记进笔记的一问（2026-11-24 新写法）：问的原话、回答原文、材料，不让 AI 改写；「看不懂」那一问写回看不懂那一句
import { confusedAsk, confusedQ, decodeNote, parseReadingNote } from '@cn/format'
import { describe, expect, it } from 'vitest'
import { answerMd, matsOf, questionOf } from '../src/main/reading/section'
import { FIXTURES } from '../../../packages/format/test/fixtures'

describe('记进笔记的一问', () => {
  it('回答原文：去掉可视化、配图那两行标记，标题降级（不切开笔记里的小标题）', () => {
    const md = answerMd('## 水位怎么变\n\n一句话：LIF 是个漏水的桶。\n\n〔可以做个可视化〕\n〔配图 0.1,0.2,0.3,0.4 · 示意图〕')
    expect(md).not.toMatch(/可视化|配图/)
    expect(md).not.toMatch(/^##\s/m)
    expect(md).toContain('一句话：LIF 是个漏水的桶。')
  })

  it('材料：引用的字原样，图换成拷进库里的那张；拷不进来的图不写', () => {
    const got = matsOf(
      [
        { kind: 'quote', text: '一段', src: 'AI的回答 · 第28页' },
        { kind: 'image', name: 'a.png', src: '粘贴的图' },
        { kind: 'image', name: 'gone.png', src: '粘贴的图' },
      ],
      (n) => (n === 'a.png' ? '附件/Lecture05/p28-1-a.png' : ''),
    )
    expect(got).toEqual([
      { kind: 'quote', text: '一段', src: 'AI的回答 · 第28页' },
      { kind: 'image', path: '附件/Lecture05/p28-1-a.png', src: '粘贴的图' },
    ])
    expect(matsOf([], () => '')).toBeUndefined()
  })

  it('问话：原样（身份注释去掉）；看不懂那一段点「问 AI」发出去的那句写回「看不懂：原文」', () => {
    expect(questionOf('给我讲解一下')).toBe('给我讲解一下')
    const note = 'paper/2026_C72_BST-GATNet 笔记.md'
    const old = parseReadingNote(decodeNote(FIXTURES['2026_C72_BST-GATNet 笔记.md']!).text, note).find((s) => s.qas?.[0]?.q.includes('cn:hl='))
    expect(old).toBeTruthy()
    const text = /==(.+?)==/.exec(old!.qas![0]!.q)![1]!
    expect(questionOf(confusedAsk(text), old)).toMatch(/^看不懂：/)
    expect(questionOf(confusedAsk(text), old)).toContain(text)
    // 在那一段里接着问的别的话照原样
    expect(questionOf('那 GAT 呢？', old)).toBe('那 GAT 呢？')
    expect(confusedQ({ id: 'h1', text })).toContain('cn:hl=h1')
  })
})
