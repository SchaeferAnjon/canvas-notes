/**
 * 费曼一轮的存法（shared/feynman/doc.ts）：打开再保存一字不变；只动该动的那一段；缺口不写成待办；白板上注释那一行不成卡。
 */
import { splitDoc } from '@cn/format'
import { parseTaskLine } from '@cn/tasks'
import { describe, expect, it } from 'vitest'
import { addRound, appendEntry, EN_WORDS, entryText, findRounds, metaLine, parseMetaLine, putBlock, roundById, setMeta } from '../src/shared/feynman/doc'
import { gapNoteSection, gapsBody, judgedMeta, verdictBody } from '../src/shared/feynman/rules'
import type { FeynmanMeta } from '../src/shared/feynman/types'

const meta = (o: Partial<FeynmanMeta> = {}): FeynmanMeta => ({
  v: 1,
  id: 'f-20261123-a1b2',
  topic: '范数',
  scope: 'point',
  status: 'talking',
  from: [{ kind: 'map', path: '课程/线代/第2讲 导图.md', node: '0.1', text: '范数' }],
  cover: [{ kind: 'web', url: 'https://zh.d2l.ai/chapter_preliminaries/linear-algebra.html' }],
  points: [
    { id: 'c1', kind: 'core', text: '量的是向量有多大', answer: '范数给每个向量一个非负的「大小」', basis: '定义 2.3.1' },
    { id: 'c2', kind: 'core', text: '放大 α 倍会怎样', answer: '是 |α| 倍', basis: '公式 (2.3.10)' },
    { id: 'c3', kind: 'core', text: '能不能是负的', answer: '不能，只有零向量是 0', basis: '定义 2.3.1' },
    { id: 'e1', kind: 'extra', text: 'L2 和 L1 怎么算', answer: 'L2 平方和开根号，L1 绝对值相加', basis: '例 2.3.2' },
  ],
  myths: [{ id: 'm1', text: '范数就是长度', right: 'L2 只是一种', core: 'c1' }],
  day: '2026-11-23',
  nth: 1,
  asked: [],
  peeks: 0,
  ...o,
})

const BOARD = `---
type: board
白板样式: 导图
read-along: https://zh.d2l.ai/
---
- 线性代数
  - 范数
    - L2
  - 矩阵

## 别的列

一张卡。
`

describe('费曼一轮的存法', () => {
  it('注释一行：-- 不会让注释提前收尾，读回来一样', () => {
    const m = meta({ topic: '箭头 --> 和 -- 两个减号', points: [{ id: 'c1', kind: 'core', text: 'a-->b', answer: '--', basis: 'x' }] })
    const line = metaLine(m)
    expect(line.indexOf('-->')).toBe(line.length - 3)
    expect(parseMetaLine(line)).toEqual(m)
  })

  it('新的一节接在文末：前面隔一个空行，别处一字不动；打开再保存一字不变', () => {
    const text = addRound(BOARD, meta())
    expect(text.startsWith(BOARD)).toBe(true)
    expect(text.slice(BOARD.length)).toBe(`\n## 费曼 · 范数\n${metaLine(meta())}\n`)
    const [r] = findRounds(text)
    expect(r!.meta).toEqual(meta())
    expect(r!.entries).toEqual([])
    // 什么都没改：setMeta 原样返回
    expect(setMeta(text, r!.meta)).toBe(text)
  })

  it('插在下一节前面：两边都隔空行，下一节一字不动', () => {
    const at = BOARD.indexOf('## 别的列')
    const text = addRound(BOARD, meta(), { at })
    expect(text).toContain(`${metaLine(meta())}\n\n## 别的列\n\n一张卡。\n`)
    const r = roundById(text, meta().id)!
    expect(text.slice(r.end)).toBe('## 别的列\n\n一张卡。\n')
  })

  it('讲、问、答一段段加进去：你说的原话一字不改，AI 的是 [!ai] 块；读回来分得清', () => {
    let text = addRound(BOARD, meta(), { at: BOARD.indexOf('## 别的列') })
    const said = '范数嘛 就是量这个向量有多大  嗯\n比如 (3, 4) 的长度是五\n\n放大两倍的话 范数不变吧'
    text = appendEntry(text, meta().id, 'me', said)
    text = appendEntry(text, meta().id, 'student', '你说「放大两倍的话 范数不变吧」。那 (3, 4) 乘 2 以后呢？', 'Claude Code · Opus 5.5')
    text = appendEntry(text, meta().id, 'me', '哦 那就是 10 变成两倍了')
    const r = roundById(text, meta().id)!
    expect(r.entries.map((e) => e.kind)).toEqual(['me', 'student', 'me'])
    expect(r.entries[0]!.text).toBe(said)
    expect(r.entries[1]!.by).toBe('Claude Code · Opus 5.5')
    expect(r.entries[1]!.text).toBe('你说「放大两倍的话 范数不变吧」。那 (3, 4) 乘 2 以后呢？')
    expect(text).toContain('> [!ai] 学生 · Claude Code · Opus 5.5\n> 你说「放大两倍的话 范数不变吧」。那 (3, 4) 乘 2 以后呢？')
    // 下一节还在、一字不动
    expect(text.endsWith('\n\n## 别的列\n\n一张卡。\n')).toBe(true)
    // 导图那一段一字不动
    expect(text.startsWith(BOARD.slice(0, BOARD.indexOf('## 别的列')))).toBe(true)
  })

  it('判定、缺口、说法提醒、完整版：各一块，再判一次原地换掉；缺口不是待办', () => {
    let text = addRound(BOARD, meta())
    text = appendEntry(text, meta().id, 'me', '范数就是向量的长度 放大α倍还是α倍 不会是负的')
    const m = judgedMeta(meta(), {
      states: [
        { id: 'c1', state: 'clear', quote: '范数就是向量的长度' },
        { id: 'c2', state: 'wrong', quote: '放大α倍还是α倍' },
        { id: 'c3', state: 'clear', quote: '不会是负的' },
      ],
      rights: [{ id: 'c2', right: '是 |α| 倍：α 是负的也取绝对值', src: '公式 (2.3.10)' }],
      full: '范数量向量有多大……',
      today: '2026-11-23',
      prevPasses: 0,
    })
    text = setMeta(text, m)
    text = putBlock(text, m.id, 'verdict', verdictBody(m), 'Claude Code · Opus 5.5')
    text = putBlock(text, m.id, 'gaps', gapsBody(m))
    text = putBlock(text, m.id, 'wording', '- 长度（L2）只是范数的一种。')
    text = putBlock(text, m.id, 'full', '范数量向量有多大……')
    const once = text
    const r = roundById(text, m.id)!
    expect(r.entries.map((e) => e.kind)).toEqual(['me', 'verdict', 'gaps', 'wording', 'full'])
    expect(r.meta.verdict).toBe('fail')
    // 再写一次同样的：一字不变
    text = putBlock(text, m.id, 'verdict', verdictBody(m))
    text = putBlock(text, m.id, 'gaps', gapsBody(m))
    expect(text).toBe(once)
    // 缺口送进 Anki 以后只换缺口那一块
    const sent = { ...m, gaps: m.gaps!.map((g, i) => (i === 0 ? { ...g, sent: true } : g)) }
    const after = putBlock(setMeta(text, sent), m.id, 'gaps', gapsBody(sent))
    expect(after).toContain('✓ 已送进Anki')
    expect(after.slice(0, after.indexOf('> [!ai] 缺口'))).toBe(setMeta(text, sent).slice(0, setMeta(text, sent).indexOf('> [!ai] 缺口')))
    // 待办、画布今日都认不出任务
    expect(after.split('\n').filter((l) => parseTaskLine(l))).toEqual([])
    expect(gapNoteSection(sent)).not.toMatch(/- \[[ x]\]/)
    // 删掉说法提醒那一块
    const gone = putBlock(after, m.id, 'wording', '')
    expect(roundById(gone, m.id)!.entries.map((e) => e.kind)).toEqual(['me', 'verdict', 'gaps', 'full'])
    expect(gone).not.toContain('说法提醒')
    expect(gone).not.toMatch(/\n\n\n/)
  })

  it('白板上：注释那一行不成卡，学生的话是 AI 卡', () => {
    let text = addRound('# 白板\n\n## 第一列\n\n卡。\n', meta())
    text = appendEntry(text, meta().id, 'me', '我讲的一段')
    text = appendEntry(text, meta().id, 'student', '学生问一句')
    const col = splitDoc(text).columns.find((c) => c.title === '费曼 · 范数')!
    expect(col.cards.map((c) => c.kind)).toEqual(['text', 'callout'])
  })

  it('英文库写英文的头，两种都认；用户在块里改过（头上「改过」）照样认', () => {
    let text = addRound('', meta(), { words: EN_WORDS })
    text = appendEntry(text, meta().id, 'student', 'You said X. Then?', 'Claude Code · Opus 5.5', EN_WORDS)
    expect(text).toContain('## Feynman · 范数')
    expect(text).toContain('> [!ai] Student · Claude Code · Opus 5.5')
    text = text.replace('> [!ai] Student · Claude Code · Opus 5.5', '> [!ai] Student · Claude Code · Opus 5.5 · edited')
    const r = findRounds(text)[0]!
    expect(r.entries[0]).toMatchObject({ kind: 'student', by: 'Claude Code · Opus 5.5' })
  })

  it('不是一轮的：标题叫「费曼 · x」但下面没有注释、代码块里的，都不认', () => {
    const text = '## 费曼 · 自己写的\n\n随便写。\n\n```\n## 费曼 · 代码里\n' + metaLine(meta()) + '\n```\n'
    expect(findRounds(text)).toEqual([])
  })

  it('坏了的注释（手改坏的 JSON）不认，也不报错', () => {
    expect(findRounds('## 费曼 · x\n<!-- feynman {"v":1,"id": -->\n')).toEqual([])
  })

  it('你说的是 entryText 原样（只去掉首尾空行）', () => {
    expect(entryText('me', '\n  第一行 \n\n第二段\n\n')).toBe('  第一行 \n\n第二段')
  })
})
