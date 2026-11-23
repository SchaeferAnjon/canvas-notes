/**
 * 费曼「讲完以后」（shared/feynman/after.ts）：补进导图只动那一支的列表行、撤回一字不差；空框填了变成子节点；
 * 拍成导图的树；记进笔记写在末尾、不写成待办；导图第一层的进度小点；行尾注释 wrong / fix / blank 打开再保存不变。
 */
import { parseMindmap, withMindmap } from '@cn/format'
import { parseTaskLine } from '@cn/tasks'
import { describe, expect, it } from 'vitest'
import { applyMapMerge, branchOf, checkPlan, fillBlank, findGapNote, gapNote, likeness, mapProgress, materialNote, mergeLines, planMapMerge, roundTree, withGapNote } from '../src/shared/feynman/after'
import { addRound, setMeta } from '../src/shared/feynman/doc'
import { judgedMeta } from '../src/shared/feynman/rules'
import type { FeynmanMeta } from '../src/shared/feynman/types'

const PATH = '课程/线代/导图 · 线性代数 2.3.md'

const BOARD = `---
type: board
白板样式: 导图
---
- 线性代数 2.3
  - 标量和向量
    - 向量就是一列数
  - 矩阵乘法 <!-- fold -->
    - AB 是做 m 次矩阵乘向量
  - 范数
    - 量向量有多大，不管有几维
    - f(αx) = |α| f(x)
    - 三角不等式 f(x+y) ≤ f(x) + f(y)
    - 非负 f(x) ≥ 0
    - L2：平方和开根 · L1：绝对值之和
`

const base = (o: Partial<FeynmanMeta> = {}): FeynmanMeta => ({
  v: 1,
  id: 'f-20261123-a1b2',
  topic: '范数',
  scope: 'point',
  status: 'talking',
  from: [{ kind: 'map', path: PATH, node: '0.2', text: '范数' }],
  cover: [],
  points: [
    { id: 'c1', kind: 'core', text: '量的是向量有多大', answer: '范数给每个向量一个非负的「大小」', basis: '定义 2.3.1' },
    { id: 'c2', kind: 'core', text: '放大 α 倍会怎样', answer: 'f(αx) = |α|·f(x)，是 |α| 倍', basis: '公式 (2.3.10)' },
    { id: 'c3', kind: 'core', text: '两段路和直走', answer: '三角不等式：直走不比绕路长', basis: '公式 (2.3.11)' },
    { id: 'c4', kind: 'core', text: '能不能是负的', answer: '不能是负的，非负 f(x) ≥ 0', basis: '公式 (2.3.12)' },
    { id: 'e1', kind: 'extra', text: 'L2 和 L1 怎么算', answer: 'L2 平方和开根号，L1 绝对值相加', basis: '例 2.3.2' },
  ],
  myths: [],
  day: '2026-11-23',
  nth: 1,
  asked: [],
  peeks: 0,
  ...o,
})

/** 示例那一轮：没过（放大 α 倍讲错，能不能是负的含糊），量的是什么讲清（举了 (3, 4) 的例子） */
const judged = (o: Partial<FeynmanMeta> = {}) =>
  judgedMeta(base(o), {
    states: [
      { id: 'c1', state: 'clear', quote: '范数就是向量的长度。比如 (3, 4) 这个向量，长度是 5' },
      { id: 'c2', state: 'wrong', quote: '能啊，负号表示方向反过来了' },
      { id: 'c3', state: 'asked', quote: '两段路加起来不会比直走短' },
      { id: 'c4', state: 'vague', quote: '应该不会吧……为什么我说不上来' },
    ],
    rights: [
      { id: 'c2', right: '是 |α| 倍', src: '公式 (2.3.10)' },
      { id: 'c4', right: '不能是负的，只有零向量是 0', src: '公式 (2.3.12)' },
      { id: 'e1', right: 'L2 平方和开根号', src: '例 2.3.2', said: true },
    ],
    full: '范数量的是一个向量有多大。',
    today: '2026-11-23',
    prevPasses: 0,
  })

const withRound = (meta: FeynmanMeta, text = BOARD) => setMeta(addRound(text, { ...meta, status: 'talking' }), meta)

describe('导图行尾注释：讲错、正确说法、空框', () => {
  it('读进来再写回去一字不变；只改了标记只动注释', () => {
    const t = `- 范数\n  - f(αx) = |α| f(x) <!-- wrong -->\n    - 是 |α| 倍 <!-- fix -->\n  - 非负 <!-- fold blank -->\n    - x\n`
    const d = parseMindmap(t)
    expect(d.roots[0]!.children[0]!.wrong).toBe(true)
    expect(d.roots[0]!.children[0]!.children[0]!.fix).toBe(true)
    expect(d.roots[0]!.children[1]!.blank).toBe(true)
    expect(withMindmap(t, d.roots)).toBe(t)
    const filled = fillBlank(d.roots, '0.1', '只有零向量是 0')
    const out = withMindmap(t, filled)
    expect(out).toBe(`- 范数\n  - f(αx) = |α| f(x) <!-- wrong -->\n    - 是 |α| 倍 <!-- fix -->\n  - 非负\n    - x\n    - 只有零向量是 0\n`)
  })
})

describe('补进导图', () => {
  const meta = judged()
  const text = withRound(meta)
  const roots = parseMindmap(text).roots

  it('材料是这张导图的一支：认得出是哪一支；路径变了按字找回来；别的篇的不算', () => {
    expect(branchOf(text, PATH, meta)).toBe('0.2')
    const moved = withRound({ ...meta, from: [{ kind: 'map', path: PATH, node: '0.0', text: '范数' }] })
    expect(branchOf(moved, PATH, { ...meta, from: [{ kind: 'map', path: PATH, node: '0.0', text: '范数' }] })).toBe('0.2')
    expect(branchOf(text, '别的.md', meta)).toBeNull()
    expect(branchOf(text, PATH, { ...meta, from: [{ kind: 'card', path: PATH, head: 'x' }] })).toBeNull()
  })

  it('先列出要改的几处：讲错的标红挂正确说法，含糊的留空框，你讲了导图上没有的用原话加一个，讲清的不动', () => {
    const plan = planMapMerge(roots, '0.2', meta)
    expect(plan.ops).toEqual([
      { kind: 'add', under: '0.2', text: '范数就是向量的长度' },
      { kind: 'wrong', at: '0.2.1', fix: '是 |α| 倍' },
      { kind: 'blank', at: '0.2.3' },
    ])
    expect(mergeLines(roots, plan)).toEqual([
      { kind: 'add', text: '范数就是向量的长度' },
      { kind: 'wrong', node: 'f(αx) = |α| f(x)', fix: '是 |α| 倍' },
      { kind: 'blank', node: '非负 f(x) ≥ 0' },
      { kind: 'kept', n: 3 },
    ])
  })

  it('放进去：只改那一支的列表行（加在末尾、标在行尾注释），别处一字不动；撤回（原来的树写回去）一字不差', () => {
    const plan = planMapMerge(roots, '0.2', meta)
    const { roots: next, grow } = applyMapMerge(roots, plan)
    const out = withMindmap(text, next)
    expect(out).toBe(
      text
        .replace('    - f(αx) = |α| f(x)\n', '    - f(αx) = |α| f(x) <!-- wrong -->\n      - 是 |α| 倍 <!-- fix -->\n')
        .replace('    - 非负 f(x) ≥ 0\n', '    - 非负 f(x) ≥ 0 <!-- blank -->\n')
        .replace('    - L2：平方和开根 · L1：绝对值之和\n', '    - L2：平方和开根 · L1：绝对值之和\n    - 范数就是向量的长度\n'),
    )
    expect(grow).toEqual(['0.2.5', '0.2.1.0', '0.2.3#blank'])
    expect(withMindmap(out, roots)).toBe(text)
  })

  it('收着的一支补进去先展开（长出来看得见）', () => {
    const plan = { branch: '0.1', ops: [{ kind: 'add' as const, under: '0.1', text: '要先对齐维数' }], kept: 1 }
    const out = withMindmap(text, applyMapMerge(roots, plan).roots)
    expect(out).toContain('  - 矩阵乘法\n    - AB 是做 m 次矩阵乘向量\n    - 要先对齐维数\n')
  })

  it('导图上没有这条核心：加一个节点再标', () => {
    const t2 = BOARD.replace('    - 非负 f(x) ≥ 0\n', '')
    const r2 = parseMindmap(withRound(meta, t2)).roots
    const plan = planMapMerge(r2, '0.2', meta)
    expect(plan.ops).toContainEqual({ kind: 'add', under: '0.2', text: '能不能是负的', mark: 'blank' })
    const { roots: next } = applyMapMerge(r2, plan)
    expect(withMindmap(t2, next)).toContain('    - 能不能是负的 <!-- blank -->\n')
  })

  it('真 AI 回的单子：只认这一支里的编号，不认中心标红、不认重复的', () => {
    const plan = checkPlan(roots, '0.2', {
      ops: [
        { kind: 'wrong', at: '0.2.1', fix: '是 |α| 倍' },
        { kind: 'wrong', at: '0.2.1', fix: '重复' },
        { kind: 'blank', at: '0.2' },
        { kind: 'blank', at: '0.0.0' },
        { kind: 'add', under: '0.2', text: '例：(3, 4) 的长度是 5' },
        { kind: 'add', under: '0.2', text: '没写正确说法', mark: 'wrong' },
      ],
    })
    expect(plan!.ops).toEqual([
      { kind: 'wrong', at: '0.2.1', fix: '是 |α| 倍' },
      { kind: 'add', under: '0.2', text: '例：(3, 4) 的长度是 5' },
    ])
    expect(plan!.kept).toBe(4)
    expect(checkPlan(roots, '0.2', 'x')).toBeNull()
  })

  it('字像不像', () => {
    expect(likeness('放大 α 倍会怎样 f(αx) = |α|·f(x)，是 |α| 倍', 'f(αx) = |α| f(x)')).toBeGreaterThan(0.5)
    expect(likeness('能不能是负的', '三角不等式 f(x+y) ≤ f(x) + f(y)')).toBeLessThan(0.34)
  })
})

describe('拍成导图', () => {
  it('这一轮整理成一棵树：中心是知识点，讲清的挂你的原话，讲错的标红挂正确说法，含糊的留空框，讲到的了解即可也挂上', () => {
    const [root] = roundTree(judged({ from: [{ kind: 'card', path: '剪藏/范数.md', head: '范数表示' }] }))
    expect(root!.text).toBe('范数')
    expect(root!.children.map((c) => [c.text, !!c.wrong, !!c.blank, c.children.map((k) => [k.text, !!k.fix])])).toEqual([
      ['量的是向量有多大', false, false, [['范数就是向量的长度', false]]],
      ['放大 α 倍会怎样', true, false, [['是 |α| 倍', true]]],
      ['两段路和直走', false, false, [['两段路加起来不会比直走短', false]]],
      ['能不能是负的', false, true, []],
      ['L2 和 L1 怎么算', false, false, []],
    ])
  })
})

describe('记进笔记', () => {
  const meta = judged()

  it('材料来自的那篇：导图、卡片、笔记是那一篇，PDF 是旁边的笔记，一个词没有', () => {
    expect(materialNote(meta)).toBe(PATH)
    expect(materialNote(base({ from: [{ kind: 'pdf', path: '课程/线代/第2讲.pdf' }] }))).toBe('课程/线代/第2讲 笔记.md')
    expect(materialNote(base({ from: [{ kind: 'word', word: '范数' }] }))).toBeNull()
  })

  it('末尾一块「费曼缺口 · 范数」：判定一行和缺口，AI 块；不写成待办（不进画布今日）', () => {
    const note = '# 线代笔记\n\n正文。\n'
    const block = gapNote(meta, { by: 'Claude Code · Opus 5.5' })
    const out = withGapNote(note, meta.topic, block)
    expect(out.startsWith(note)).toBe(true)
    expect(out.slice(note.length)).toBe(`\n${block}`)
    expect(block).toMatch(/^## 费曼缺口 · 范数\n\n> \[!ai\] 缺口 · Claude Code · Opus 5\.5\n> 没过：/)
    expect(block).toContain('> - 讲错 · 放大 α 倍会怎样：你说「能啊，负号表示方向反过来了」 → 是 |α| 倍（公式 (2.3.10)）')
    for (const l of out.split('\n')) expect(parseTaskLine(l.replace(/^>\s?/, ''))).toBeNull()
  })

  it('同一个点再记一次：原地换掉，前后一字不动', () => {
    const block1 = gapNote(meta)
    const note = withGapNote('# 笔记\n', meta.topic, block1) + '\n## 后面的\n\n别的。\n'
    const block2 = gapNote({ ...meta, verdict: 'pass', redone: true })
    const out = withGapNote(note, meta.topic, block2)
    expect(out).toBe(note.replace(block1, block2))
    expect(findGapNote(out, meta.topic)).toEqual({ from: note.indexOf('## 费曼缺口'), to: note.indexOf('## 费曼缺口') + block2.length + 1 })
  })
})

describe('导图上的进度小点', () => {
  it('第一层每个点讲过没有、过没过；中心下面讲过几个', () => {
    expect(mapProgress(BOARD, PATH)).toEqual({ dots: { '0.0': { key: '0.0', state: 'none', times: 0 }, '0.1': { key: '0.1', state: 'none', times: 0 }, '0.2': { key: '0.2', state: 'none', times: 0 } }, done: 0, total: 3 })
    // 正在讲
    const talking = addRound(BOARD, base())
    expect(mapProgress(talking, PATH).dots['0.2']).toEqual({ key: '0.2', state: 'talking', day: '2026-11-23', times: 0 })
    // 判过：没过；同一支再讲一次过了，看最近一次
    let t = withRound(judged())
    expect(mapProgress(t, PATH)).toMatchObject({ done: 1, total: 3, dots: { '0.2': { state: 'fail', day: '2026-11-23', times: 1 } } })
    const again = judgedMeta(base({ id: 'f-20261124-c3d4', day: '2026-11-24' }), {
      states: ['c1', 'c2', 'c3', 'c4'].map((id) => ({ id, state: 'clear' as const, quote: 'x' })),
      rights: [],
      full: '',
      today: '2026-11-24',
      prevPasses: 0,
    })
    t = withRound(again, t)
    expect(mapProgress(t, PATH).dots['0.2']).toEqual({ key: '0.2', state: 'pass', day: '2026-11-24', times: 2 })
    // 材料是第一层一个点下面的一枝：算这个点的
    const sub = withRound(judged({ id: 'f-20261123-e5f6', from: [{ kind: 'map', path: PATH, node: '0.0.0', text: '向量就是一列数' }] }))
    expect(mapProgress(sub, PATH).dots['0.0']!.state).toBe('fail')
  })
})
