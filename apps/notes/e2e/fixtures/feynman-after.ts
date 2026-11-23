/**
 * 费曼「讲完以后」（③ feynman-after，task-yvabi）的样例库：一门课「线性代数」——
 * - 导图白板「导图 · 线性代数 2.3」：原型那张图，「范数」那一支讲完了一轮（没过：放大 α 倍讲错，能不能是负的含糊），判定、缺口、完整版都在这一节里；
 * - 卡片白板「范数 白板」：四张剪自 d2l 的卡，讲完了一轮（差一点），材料是卡片（「拍成导图」）；
 * - 一份笔记「第2讲 笔记」。
 * 日子按今天算：判过的那一轮是昨天讲的（没过隔一天，今天到期，课程首页「下次先讲」挑它）。
 */
import { addRound, appendEntry, putBlock, setMeta } from '../../src/shared/feynman/doc'
import { gapsBody, judgedMeta, verdictBody } from '../../src/shared/feynman/rules'
import type { CoreJudged, FeynmanMeta } from '../../src/shared/feynman/types'

const day = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const TODAY = day(0)
export const YESTERDAY = day(-1)

export const COURSE = '课程/线性代数'
export const MAP_PATH = `${COURSE}/导图 · 线性代数 2.3.md`
export const CARDS_PATH = `${COURSE}/范数 白板.md`
export const NOTE_PATH = `${COURSE}/第2讲 笔记.md`
export const BY = 'Claude Code · Opus 5.5'

export const MAP_HEAD = `---
type: board
白板样式: 导图
类型: 导图
课程: 线性代数
第几讲: 2
---
# 导图 · 线性代数 2.3

- 线性代数 2.3
  - 标量和向量
    - 向量就是一列数
  - 矩阵乘法
    - AB 是做 m 次矩阵乘向量
    - 别和 Hadamard 积（按元素乘）混
  - 范数
    - 量向量有多大，不管有几维
    - f(αx) = |α| f(x)
    - 三角不等式 f(x+y) ≤ f(x) + f(y)
    - 非负 f(x) ≥ 0
    - L2：平方和开根 · L1：绝对值之和
`

const POINTS: FeynmanMeta['points'] = [
  { id: 'c1', kind: 'core', text: '量的是向量有多大', answer: '范数给每个向量一个非负的「大小」', basis: '定义 2.3.1' },
  { id: 'c2', kind: 'core', text: '放大 α 倍会怎样', answer: 'f(αx) = |α|·f(x)，是 |α| 倍', basis: '公式 (2.3.10)' },
  { id: 'c3', kind: 'core', text: '两段路和直走', answer: '三角不等式：直走不比绕路长', basis: '公式 (2.3.11)' },
  { id: 'c4', kind: 'core', text: '能不能是负的', answer: '不能是负的，非负 f(x) ≥ 0', basis: '公式 (2.3.12)' },
  { id: 'e1', kind: 'extra', text: 'L2 和 L1 怎么算', answer: 'L2 平方和开根号，L1 绝对值相加', basis: '例 2.3.2' },
]

const metaOf = (o: Partial<FeynmanMeta>): FeynmanMeta => ({
  v: 1,
  id: 'f-x',
  topic: '范数',
  scope: 'point',
  status: 'talking',
  from: [],
  cover: [],
  points: POINTS,
  myths: [{ id: 'm1', text: '范数就是向量的长度', right: '长度（L2）只是范数的一种', core: 'c1' }],
  siblings: ['标量和向量', '矩阵乘法', '范数'],
  lecture: 2,
  by: BY,
  day: YESTERDAY,
  nth: 1,
  asked: [],
  peeks: 1,
  ...o,
})

const SAID = '范数就是向量的长度。比如 (3, 4) 这个向量，长度是 5。放大 α 倍的话，范数也是 α 倍，负号表示方向反过来了。'

/** 讲完、判过的一轮写进文档：你讲的一段、学生一问、你答的、判定、缺口、完整版（和 ② 写的一样，用 ① 的写法） */
function judgedRound(text: string, meta: FeynmanMeta, states: CoreJudged[], said: string): string {
  let t = addRound(text, meta)
  t = appendEntry(t, meta.id, 'me', said)
  t = appendEntry(t, meta.id, 'student', '你说「负号表示方向反过来了」。那 α = −2 时，范数是变成负的吗？', BY)
  t = appendEntry(t, meta.id, 'me', '能啊，负号表示方向反过来了')
  const j = judgedMeta(meta, {
    states,
    rights: [
      { id: 'c2', right: '是 |α| 倍', src: '公式 (2.3.10)' },
      { id: 'c4', right: '不能是负的，只有零向量是 0', src: '公式 (2.3.12)' },
      { id: 'e1', right: 'L2 平方和开根号', src: '例 2.3.2', said: true },
    ],
    full: '范数量的是一个向量有多大，不管它有几维；比如你说的 (3, 4)，用 L2 量是 5。',
    today: YESTERDAY,
    prevPasses: 0,
  })
  t = setMeta(t, j)
  t = putBlock(t, j.id, 'verdict', verdictBody(j), BY)
  t = putBlock(t, j.id, 'gaps', gapsBody(j), BY)
  t = putBlock(t, j.id, 'full', '范数量的是一个向量有多大，不管它有几维；比如你说的 (3, 4)，用 L2 量是 5。', BY)
  return t
}

export const MAP_ROUND = metaOf({ id: 'f-map-a1b2', from: [{ kind: 'map', path: MAP_PATH, node: '0.2', text: '范数' }] })
export const MAP_STATES: CoreJudged[] = [
  { id: 'c1', state: 'clear', quote: '范数就是向量的长度。比如 (3, 4) 这个向量，长度是 5' },
  { id: 'c2', state: 'wrong', quote: '能啊，负号表示方向反过来了' },
  { id: 'c3', state: 'asked', quote: '两段路加起来不会比直走短' },
  { id: 'c4', state: 'vague', quote: '应该不会吧……为什么我说不上来' },
]
export const MAP_TEXT = judgedRound(MAP_HEAD, MAP_ROUND, MAP_STATES, SAID)

export const CARDS_HEAD = `---
type: board
课程: 线性代数
第几讲: 2
---
# 范数 白板

## 剪自 d2l

范数表示一个向量有多大，不涉及维度，只看分量的大小。

按常数 α 缩放向量，范数按 |α| 缩放：f(αx) = |α| f(x)

三角不等式：f(x + y) ≤ f(x) + f(y)

范数必须非负：f(x) ≥ 0
`

export const CARD_ROUND = metaOf({ id: 'f-card-c3d4', from: [{ kind: 'card', path: CARDS_PATH, head: '范数表示一个向量有多大，不涉及维度，只看分量的大小。' }] })
export const CARDS_TEXT = judgedRound(
  CARDS_HEAD,
  CARD_ROUND,
  [
    { id: 'c1', state: 'clear', quote: '范数就是向量的长度' },
    { id: 'c2', state: 'fixed', quote: '是 |α| 倍，负的也一样变大' },
    { id: 'c3', state: 'clear', quote: '两段路加起来不会比直走短' },
    { id: 'c4', state: 'missing', quote: '' },
  ],
  '范数就是向量的长度。放大 α 倍就是 α 倍。两段路加起来不会比直走短。',
)

export const NOTE_TEXT = `# 第2讲 笔记

线性代数第 2 讲：标量、向量、矩阵、范数。
`

/** 「标量和向量」这一支又讲了一轮，过了（课程首页、导图小点跟着变） */
export function passRound(text: string): string {
  const m = metaOf({
    id: 'f-map-e5f6',
    topic: '标量和向量',
    day: TODAY,
    from: [{ kind: 'map', path: MAP_PATH, node: '0.0', text: '标量和向量' }],
    points: [
      { id: 'c1', kind: 'core', text: '标量是什么', answer: '一个数', basis: '2.3.1' },
      { id: 'c2', kind: 'core', text: '向量是什么', answer: '一列数', basis: '2.3.2' },
    ],
    peeks: 0,
  })
  let t = addRound(text, m)
  t = appendEntry(t, m.id, 'me', '标量就是一个数，向量就是一列数。')
  const j = judgedMeta(m, { states: [{ id: 'c1', state: 'clear', quote: '标量就是一个数' }, { id: 'c2', state: 'clear', quote: '向量就是一列数' }], rights: [], full: '标量是一个数，向量是一列数。', today: TODAY, prevPasses: 0 })
  t = setMeta(t, j)
  return putBlock(t, j.id, 'verdict', verdictBody(j), BY)
}

export const feynmanVault = (): Record<string, string> => ({
  [MAP_PATH]: MAP_TEXT,
  [CARDS_PATH]: CARDS_TEXT,
  [NOTE_PATH]: NOTE_TEXT,
})
