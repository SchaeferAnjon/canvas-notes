import { describe, expect, it } from 'vitest'
import { judgePrompt, linkDecision, parseJudgements, quoteFound, type Judgement } from '../src/shared/dream-judge'

const A = '两篇都讲 MESI 协议。Modified 状态的块被别的核读到时要先写回。'
const B = 'MESI 协议的四个状态：Modified、Exclusive、Shared、Invalid。Modified 的块是脏的，只有这一份。'
const j = (x: Partial<Judgement>): Judgement => ({ index: 0, kind: '同一主题', reason: '', quoteA: 'Modified 状态的块被别的核读到时要先写回', quoteB: 'Modified 的块是脏的，只有这一份', confidence: 0.9, ...x })

describe('梦游补双链的 AI 判断', () => {
  it('取最后一个代码块：模型先答一遍再「更正」一遍', () => {
    const reply = '```json\n[{"b":1,"kind":"无关","reason":"x","quote_a":"","quote_b":"","confidence":0.9}]\n```\n更正一下：\n```json\n[{"b":1,"kind":"同一主题","reason":"y","quote_a":"a","quote_b":"b","confidence":0.8}]\n```'
    expect(parseJudgements(reply, 1)).toMatchObject([{ index: 0, kind: '同一主题', confidence: 0.8 }])
  })

  it('中文里没转义的英文双引号：按字段顺序抠出来', () => {
    const reply = '```json\n[{"b": 1, "kind": "同一主题", "reason": "都讲记忆层", "quote_a": "记忆层定义"记住什么"", "quote_b": "定期提炼至MEMORY.md", "confidence": 0.7}, {"b": 2, "kind": "无关", "reason": "不是一回事", "quote_a": "", "quote_b": "", "confidence": 0.95}]\n```'
    expect(parseJudgements(reply, 2)).toMatchObject([
      { index: 0, kind: '同一主题', quoteA: '记忆层定义"记住什么"', confidence: 0.7 },
      { index: 1, kind: '无关', confidence: 0.95 },
    ])
  })

  it('没有围栏也认；认不得的档、越界的序号丢掉', () => {
    const reply = '[{"b":1,"kind":"同一主题","confidence":0.9},{"b":2,"kind":"相关","confidence":0.9},{"b":7,"kind":"无关","confidence":1}]'
    expect(parseJudgements(reply, 2).map((x) => x.index)).toEqual([0])
  })

  it('摘的原文要真在笔记里（不管空白和标点），太短的不算', () => {
    expect(quoteFound('Modified 状态的块，被别的核读到时', A)).toBe(true)
    expect(quoteFound('Owned 状态的块被别的核读到', A)).toBe(false)
    expect(quoteFound('MESI', A)).toBe(false)
  })

  it('过线才提，差一点进拿不准，原文核不上作废，同一内容不当双链', () => {
    expect(linkDecision(j({}), A, B)).toBe('link')
    expect(linkDecision(j({ confidence: 0.6 }), A, B)).toBe('ask')
    expect(linkDecision(j({ kind: '拿不准', confidence: 0.3 }), A, B)).toBe('ask')
    expect(linkDecision(j({ quoteB: '这句 B 里没有' }), A, B)).toBe('drop')
    expect(linkDecision(j({ kind: '同一内容' }), A, B)).toBe('drop')
    expect(linkDecision(j({ kind: '只是沾边', confidence: 0.99 }), A, B)).toBe('drop')
  })

  it('提示词里每篇候选按 B1、B2 编号，长文截断', () => {
    const p = judgePrompt({ title: 'A', text: 'x'.repeat(5000) }, [{ title: '甲', text: '一' }, { title: '乙', text: '二' }])
    expect(p).toContain('=== B1 ===\n标题：甲')
    expect(p).toContain('=== B2 ===\n标题：乙')
    expect(p.length).toBeLessThan(5000)
  })
})
