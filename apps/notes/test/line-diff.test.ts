/**
 * 对比按行比（梦游对比滚动，src/renderer/diff/line-diff.ts）：几千行的两篇比出来的改动数和 git 一样，照改动能从改前拼回之后，
 * 改了的那一行里只标改了的字；@codemirror/merge 默认的比法在这么长的两篇上整篇算一处（满屏红绿）。
 */
import { Chunk, presentableDiff } from '@codemirror/merge'
import { Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { LINE_DIFF, lineDiff } from '../src/renderer/diff/line-diff'
import { LONG_CHANGES, longPair } from '../e2e/fixtures/dream-long'

/** 照改动从 a 拼出 b（改动之间没改的那几段两边要一样） */
function apply(a: string, b: string, changes: ReturnType<typeof lineDiff>): string {
  let out = ''
  let posA = 0
  let posB = 0
  for (const c of changes) {
    expect(a.slice(posA, c.fromA)).toBe(b.slice(posB, c.fromB))
    out += a.slice(posA, c.fromA) + b.slice(c.fromB, c.toB)
    posA = c.toA
    posB = c.toB
  }
  expect(a.slice(posA)).toBe(b.slice(posB))
  return out + a.slice(posA)
}

const chunks = (a: string, b: string, conf?: typeof LINE_DIFF) => Chunk.build(Text.of(a.split('\n')), Text.of(b.split('\n')), conf)

describe('lineDiff', () => {
  it('两篇各两千多行、改了 36 处：比出 36 处，照改动拼得回去，比一次不到 100 毫秒', () => {
    const { a, b } = longPair()
    expect(a.split('\n').length).toBeGreaterThan(2500)
    const t0 = performance.now()
    const c = chunks(a, b, LINE_DIFF)
    const ms = performance.now() - t0
    expect(c).toHaveLength(LONG_CHANGES)
    expect(ms).toBeLessThan(100)
    expect(apply(a, b, lineDiff(a, b))).toBe(b)
    // @codemirror/merge 对比默认的比法（scanLimit 500）：整篇算一处
    expect(chunks(a, b, { scanLimit: 500 })).toHaveLength(1)
    // 整段加、整段删的标「这一段 + 段后空行」，不从段前那个空行开始（git 的做法）
    const tb = Text.of(b.split('\n'))
    const ta = Text.of(a.split('\n'))
    for (const x of c) {
      if (x.fromA === x.toA) expect(tb.lineAt(x.fromB).text.trim()).not.toBe('')
      if (x.fromB === x.toB) expect(ta.lineAt(x.fromA).text.trim()).not.toBe('')
    }
  })

  it('改了的那一行里只标改了的字', () => {
    const a = '# 标题\n\n第一段没改。\n\n这一段讲监督学习。\n\n末尾\n'
    const b = '# 标题\n\n第一段没改。\n\n这一段改成讲监督学习。\n\n末尾\n'
    const c = lineDiff(a, b)
    expect(c).toHaveLength(1)
    expect(b.slice(c[0]!.fromB, c[0]!.toB)).toBe('改成')
    expect(c).toEqual(presentableDiff(a, b))
  })

  it('开头、末尾加行删行，最后一行有没有换行都拼得回去', () => {
    const cases: [string, string][] = [
      ['x', 'x\ny'],
      ['x\ny', 'x'],
      ['', 'a\nb\n'],
      ['a\nb\n', ''],
      ['a\nb\nc', 'z\na\nc\nd'],
      ['同一行\n同一行\n同一行\n', '同一行\n新的\n同一行\n'],
    ]
    for (const [a, b] of cases) expect(apply(a, b, lineDiff(a, b))).toBe(b)
  })
})
