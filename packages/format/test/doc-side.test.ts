import { describe, expect, test } from 'vitest'
import { aiBodyAt, aiBodyOf, docAiBlocks, locateQuote, quoteOfRange, sideBlockMd, sideInsert, sideRemove } from '../src/doc-side'

const DOC = [
  '# 第5讲 注意力机制',
  '',
  '这一讲从「一句话里每个词该看谁」讲起。',
  '',
  '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧',
  '> 这一帧在讲缩放点积注意力：先拿 Q 和每个 K 做点积。分数要先除以 √d，再过 softmax 变成权重。',
  '>',
  '> 最后用这些权重把 **V** 加起来，就是这个位置的输出。维度 d 越大，',
  '> 不缩放时点积越大，梯度就没了。',
  '',
  '我的理解：缩放是为了让分数别太极端。',
  '',
].join('\n')

describe('文档里 AI 讲解块的旁支（task-4edsc）', () => {
  test('认出讲解块、它的段；还没有旁支', () => {
    const [b, ...rest] = docAiBlocks(DOC)
    expect(rest).toEqual([])
    expect(b).toEqual({ head: 4, end: 8, paras: [{ from: 5, to: 5 }, { from: 7, to: 8 }], sides: [], tail: null })
    expect(aiBodyOf(DOC, b!)).toBe('这一帧在讲缩放点积注意力：先拿 Q 和每个 K 做点积。分数要先除以 √d，再过 softmax 变成权重。\n\n最后用这些权重把 **V** 加起来，就是这个位置的输出。维度 d 越大，\n不缩放时点积越大，梯度就没了。')
  })

  test('第一问写在讲解下面、带那一句；接着问的不带，写在那条旁支后面；再开一条写在最后；读回来一条一条对得上', () => {
    let text = DOC
    const write = (side: number, q: string, a: string, quote: string) => {
      const b = docAiBlocks(text)[0]!
      const ins = sideInsert(text, b, side, { q, a }, quote)
      text = text.slice(0, ins.at) + ins.insert + text.slice(ins.at)
    }
    write(0, 'V 在这里是什么？', '#### 旁支的回答\n\nV 是每个词带的内容。\n\n第二段。', '最后用这些权重把 **V** 加起来，就是这个位置的输出。')
    write(1, '为什么除以根号 d？', '怕点积太大。', '分数要先除以 √d，再过 softmax 变成权重。')
    write(0, '那 K 呢？', 'K 是用来比的。', '')
    expect(text).toBe(
      [
        '# 第5讲 注意力机制',
        '',
        '这一讲从「一句话里每个词该看谁」讲起。',
        '',
        '> [!ai] AI 讲解 · Claude Code · Opus 5.5 · 看了 00:06 这一帧',
        '> 这一帧在讲缩放点积注意力：先拿 Q 和每个 K 做点积。分数要先除以 √d，再过 softmax 变成权重。',
        '>',
        '> 最后用这些权重把 **V** 加起来，就是这个位置的输出。维度 d 越大，',
        '> 不缩放时点积越大，梯度就没了。',
        '',
        '> [!side] V 在这里是什么？',
        '> > 最后用这些权重把 **V** 加起来，就是这个位置的输出。',
        '>',
        '> #### 旁支的回答',
        '>',
        '> V 是每个词带的内容。',
        '>',
        '> 第二段。',
        '',
        '> [!side] 那 K 呢？',
        '>',
        '> K 是用来比的。',
        '',
        '> [!side] 为什么除以根号 d？',
        '> > 分数要先除以 √d，再过 softmax 变成权重。',
        '>',
        '> 怕点积太大。',
        '',
        '我的理解：缩放是为了让分数别太极端。',
        '',
      ].join('\n'),
    )
    const [b] = docAiBlocks(text)
    expect(b!.sides).toEqual([
      {
        quote: '最后用这些权重把 **V** 加起来，就是这个位置的输出。',
        turns: [
          { q: 'V 在这里是什么？', a: '#### 旁支的回答\n\nV 是每个词带的内容。\n\n第二段。' },
          { q: '那 K 呢？', a: 'K 是用来比的。' },
        ],
        first: 10,
        last: 21,
      },
      { quote: '分数要先除以 √d，再过 softmax 变成权重。', turns: [{ q: '为什么除以根号 d？', a: '怕点积太大。' }], first: 23, last: 26 },
    ])
    expect(b!.tail).toEqual({ from: 9, to: 26 })
    // 删掉第一条：连它前面那个空行一起，剩下的第二条照旧挂在讲解下面
    const r = sideRemove(text, b!.sides[0]!)
    const left = text.slice(0, r.from) + text.slice(r.to)
    expect(left).toContain('梯度就没了。\n\n> [!side] 为什么除以根号 d？\n> > 分数要先除以')
    expect(docAiBlocks(left)[0]!.sides.map((x) => x.turns.length)).toEqual([1])
  })

  test('讲解块后面紧跟着一段字（md 会把它并进引用）：插进去时多空一行，那段字不并进旁支', () => {
    const t = '> [!ai] AI 讲解\n> 一句话。\n后面紧跟的字\n'
    const b = docAiBlocks(t)[0]!
    expect(b.end).toBe(1)
    const ins = sideInsert(t, b, 0, { q: '问', a: '答' }, '一句话。')
    expect(t.slice(0, ins.at) + ins.insert + t.slice(ins.at)).toBe('> [!ai] AI 讲解\n> 一句话。\n\n> [!side] 问\n> > 一句话。\n>\n> 答\n\n后面紧跟的字\n')
  })

  test('那一句在正文里的位置：跨行、带记号也找得到；选区原文去掉行首「> 」；落在哪一段', () => {
    const b = docAiBlocks(DOC)[0]!
    const q = '维度 d 越大， 不缩放时点积越大'
    const r = locateQuote(DOC, b, q)!
    expect(DOC.slice(r.from, r.to)).toBe('维度 d 越大，\n> 不缩放时点积越大')
    expect(quoteOfRange(DOC, r.from, r.to)).toBe(q)
    const v = locateQuote(DOC, b, '最后用这些权重把 **V** 加起来，就是这个位置的输出。')!
    expect(DOC.slice(v.from, v.to)).toBe('最后用这些权重把 **V** 加起来，就是这个位置的输出。')
    expect(aiBodyAt(DOC, [b], v.to)).toEqual({ block: 0, para: 1 })
    expect(aiBodyAt(DOC, [b], DOC.indexOf('这一帧在讲'))).toEqual({ block: 0, para: 0 })
    // 头一行、讲解外面的字不算
    expect(aiBodyAt(DOC, [b], DOC.indexOf('AI 讲解'))).toBeNull()
    expect(aiBodyAt(DOC, [b], DOC.indexOf('我的理解'))).toBeNull()
    expect(locateQuote(DOC, b, '没有这句')).toBeNull()
  })

  test('代码块里的、引用里接着的 [!ai] 不算；同一句开两条旁支各是各的', () => {
    expect(docAiBlocks('```\n> [!ai] 不是\n> 字\n```\n')).toEqual([])
    expect(docAiBlocks('> 引用\n> [!ai] 不是头\n')).toEqual([])
    const t = '> [!ai] AI 讲解\n> 一句话。\n\n' + sideBlockMd({ q: '问一', a: '答一' }, '一句话。') + '\n\n' + sideBlockMd({ q: '讲讲这句', a: '答二' }, '一句话。') + '\n'
    expect(docAiBlocks(t)[0]!.sides.map((s) => [s.quote, s.turns.map((x) => x.q)])).toEqual([
      ['一句话。', ['问一']],
      ['一句话。', ['讲讲这句']],
    ])
  })
})
