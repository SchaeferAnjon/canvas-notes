/**
 * design/feynman/teaching.md 第 6 节的四段口语稿（梯度下降，核心 C1 到 C4）：自己讲的一段、追问和回答、说穿，和 teaching.md 写的状态、判定。
 * 字照抄 teaching.md，不改（同音字、没标点、口头禅都是故意的）。
 */
import type { CoreState, FeynmanMeta, Verdict } from '../../src/shared/feynman/types'

export const GD_META: FeynmanMeta = {
  v: 1,
  id: 'f-eval',
  topic: '梯度下降',
  scope: 'point',
  status: 'talking',
  from: [{ kind: 'word', word: '梯度下降' }],
  cover: [],
  points: [
    { id: 'c1', kind: 'core', text: '从哪里开始、怎么一步步走', answer: '从一个初始猜测出发，反复挪参数，让损失一步步变小', basis: 'PPT p20' },
    { id: 'c2', kind: 'core', text: '每一步怎么改 θ', answer: '新 θ = 旧 θ − α × 坡度（沿负梯度走）；坡度为负时 θ 变大', basis: 'p20 加框公式' },
    { id: 'c3', kind: 'core', text: '学习率太大、太小会怎样', answer: 'α 太小走得慢，太大来回跳甚至发散', basis: 'p20「learning rate α」' },
    { id: 'c4', kind: 'core', text: '好几个参数时怎么改', answer: '几个参数要同时更新：先用旧 θ 把偏导全算完，再一起改', basis: 'p20「simultaneously for all d」' },
    { id: 'e1', kind: 'extra', text: '大雾下山的类比，和它不像的地方', answer: '像大雾里下山；不像的是步长跟着坡度变', basis: '网站补的类比' },
    { id: 'e2', kind: 'extra', text: '这个碗上 α 多大才收敛', answer: '这个碗上 0 < α < 0.5 才收敛', basis: '课外推算' },
    { id: 'e3', kind: 'extra', text: '一次更新用哪些样本', answer: '留给下一个知识点', basis: 'p20 最后一行' },
  ],
  myths: [
    { id: 'm1', text: '梯度是负的，θ 就往小里走', right: '减一个负数，θ 变大', core: 'c2' },
    { id: 'm2', text: 'α 就是每步走的距离', right: '每步走 α × 坡度', core: 'c3' },
    { id: 'm3', text: '先改完 θ₀，再用新的 θ₀ 去算 θ₁ 的偏导', right: '都用旧 θ 算完再一起改', core: 'c4' },
    { id: 'm4', text: 'α 越大越快', right: '太大会来回跳甚至发散', core: 'c3' },
  ],
  day: '2026-11-23',
  nth: 1,
  asked: [],
  peeks: 0,
}

export type Line = { kind: 'me' | 'student' | 'reveal' | 'confirm'; text: string }

export interface Draft {
  name: string
  /** 自己讲的那一段（学生第一句看它） */
  own: string
  /** 整段记录（判定看它） */
  lines: Line[]
  /** teaching.md 写的每条核心的状态 */
  states: Record<'c1' | 'c2' | 'c3' | 'c4', CoreState>
  verdict: Verdict
  /** 学生听完自己讲的那一段，第一句应该是哪一种（只有说得清的才写） */
  first: { act: 'ask' | 'confirm' | 'redirect'; points?: string[] }
}

const D1_OWN =
  '嗯 梯度下降呢 就是说 我们要找那个让损失最小的西塔 对吧 但是你又不能一个一个去试 那怎么办呢 就先随便猜一个西塔 然后看脚下这个坡 就是那个提度 嗯 梯度 坡往哪边下就往哪边走一小步 公式的话就是 新的西塔等于旧的西塔 减去 学习力乘以这个坡度 对 是减 因为要往下坡走嘛 比如说 x 等于二 t 等于四 从零开始 坡度是负八 减负八 西塔就变大了 变成零点八 然后一直这样走 走很多步就到碗底了 那个阿尔法啊 就是学习力 不能太大 太大的话他就会在碗两边跳来跳去 甚至越跳越远 就发散了 太小的话就走得特别慢 还有就是 参数有好几个的话 要同事更新 就是先用旧的把所有偏倒都算完 再一起改 不能改一个算一个 嗯 大概就这样'
const D2_OWN =
  '梯度下降就是 让损失函数变小的一个方法 先给参数一个初始值 然后每次都往梯度的反方向走 新的西塔等于西塔减阿尔法乘梯度 这样损失就会越来越小 学习力的话 就是每一步走多远 大一点就走得快 小一点就走得慢 然后呃 重复很多次 直到损失不怎么变了 就停'
const D3_OWN =
  '梯度下降的话 梯度呢就是坡度嘛 嗯 我们从一个随机的西塔开始 梯度是负的话 就说明在往下走 那西塔就继续往小了走 公式是新的西塔等于旧的西塔加上学习力乘梯度 学习力太大会震荡 太小会很慢 一直迭代到收敛'
const D4_OWN =
  '我先说一个类比 梯度下降就像大雾里下山 你看不见山脚 只能感受脚下哪边是往下的 往下迈一步 再感受 再迈一步 但是它跟下山不一样的地方是 步子大小是 阿尔法乘坡度 坡越陡迈得越大 然后呢 在这个碗上 每一步离碗底的距离会乘一减四阿尔法 所以阿尔法要小于零点五才会收敛 等于零点二五的时候一步就到了 大于零点五就越跳越远 就发散了'

export const DRAFTS: Draft[] = [
  {
    name: '稿 1 讲得好，口语很乱',
    own: D1_OWN,
    lines: [
      { kind: 'me', text: D1_OWN },
      { kind: 'student', text: '你说『减负八西塔就变大了』。那坡度是正三的时候，西塔往哪边走？' },
      { kind: 'me', text: '正的话 那就是减三乘学习力 变小 往左走' },
    ],
    states: { c1: 'clear', c2: 'clear', c3: 'clear', c4: 'clear' },
    verdict: 'pass',
    first: { act: 'ask' },
  },
  {
    name: '稿 2 差一点',
    own: D2_OWN,
    lines: [
      { kind: 'me', text: D2_OWN },
      { kind: 'student', text: '你说『大一点就走得快』。那学习率特别大，是不是一下就到了？越大越快？' },
      { kind: 'me', text: '呃 也不是 太大会走过头 在最低点两边来回跳 严重的话越跳越远 就收不回来了' },
      { kind: 'student', text: '要是有两个参数，西塔零和西塔一，你怎么改？' },
      { kind: 'me', text: '那就 各算各的偏导 各自更新吧' },
      { kind: 'student', text: '改西塔一的时候，算坡度用的西塔零，是改之前的还是改之后的？' },
      { kind: 'me', text: '这个……我没想过 说不上来' },
      { kind: 'reveal', text: '用改之前的。坡度是在原来那个点量的，所有偏导先用旧 θ 算完，再一起改，叫同时更新。出处：PPT p20『simultaneously for all d』。' },
    ],
    states: { c1: 'clear', c2: 'clear', c3: 'asked', c4: 'vague' },
    verdict: 'almost',
    first: { act: 'ask', points: ['c3', 'c4'] },
  },
  {
    name: '稿 3 有概念错',
    own: D3_OWN,
    lines: [
      { kind: 'me', text: D3_OWN },
      { kind: 'confirm', text: '你说的是加上学习率乘梯度，还是减？' },
      { kind: 'me', text: '加吧 因为梯度是负的 加一个负的 西塔就变小了 就往下走了' },
      { kind: 'student', text: '拿 x 等于 2、t 等于 4 试试：西塔从 0 开始，坡度是 −8，学习率 0.1，走一步西塔变成多少？损失变小了吗？' },
      { kind: 'me', text: '零加零点一乘负八 负零点八 损失 应该变小了吧' },
      { kind: 'student', text: '西塔是 −0.8 的时候，h = θx 是多少？离 t = 4 是近了还是远了？' },
      { kind: 'me', text: 'h 是负一点六 离四 呃 远了 那可能是学习力太大了 调小一点就好' },
      { kind: 'reveal', text: '坡度是负的，说明往右（θ 变大）才是下坡，所以要减：θ := 0 − 0.1 × (−8) = 0.8。用加，每一步都往上坡走，α 调多小都只是走得慢一点。出处：PPT p20 更新规则。' },
      { kind: 'student', text: '要是有两个参数，你先改哪个？' },
      { kind: 'me', text: '两个都先用原来的值算 再一起改' },
    ],
    states: { c1: 'clear', c2: 'wrong', c3: 'clear', c4: 'asked' },
    verdict: 'fail',
    first: { act: 'confirm' },
  },
  {
    name: '稿 4 讲偏到了解即可',
    own: D4_OWN,
    lines: [
      { kind: 'me', text: D4_OWN },
      { kind: 'student', text: '大雾下山我听懂了。α 小于 0.5 那个是课外推的，了解即可，先讲核心：每一步，θ 具体怎么改？' },
      { kind: 'me', text: '新的西塔 等于旧的减阿尔法乘坡度 坡度负的话就是加 西塔变大' },
      { kind: 'student', text: '要是有两个参数，你先改哪个？' },
      { kind: 'me', text: '先改西塔零 然后用新的西塔零去算西塔一的偏导 这样更准吧' },
      { kind: 'student', text: '先改了西塔零，再算西塔一的坡度时，你站的还是原来那个点吗？' },
      { kind: 'me', text: '哦 那就不是同一个点了 坡度是在原来那个点量的 应该两个都用旧的算完 再一起改' },
    ],
    states: { c1: 'clear', c2: 'asked', c3: 'clear', c4: 'fixed' },
    verdict: 'pass',
    first: { act: 'redirect', points: ['c2', 'c4'] },
  },
]
