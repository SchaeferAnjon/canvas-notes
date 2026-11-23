/**
 * CN_AI_FAKE=1 时的假 AI（流程测试、界面线开发用）：不调模型，按材料和你说的话给固定的回答，回答的样子和真 AI 的 JSON 一样，
 * 走同一套认法（judge.ts），所以假的也测得到认 JSON、算判定、写文档那一截。
 *
 * 认得两个知识点（teaching.md 的「梯度下降」、原型的「范数」），别的按材料一行一条要点。
 * 学生：先确认「加还是减」→ 讲了一大半了解即可先拉回核心 → 一轮问一条没碰的核心；回答里有「不知道 / 说不上来 / 没想过」算没答对，
 * 同一条连着两次没答对说穿；三轮用完 done。判定：核心的关键词在你自己讲的那段里是讲清，在回答追问里才有是追问后补上，
 * 说穿了的是含糊；「加上」没改过来是讲错，先错后在回答里改成「减」「一起改」是说错后改对。
 */
import type { Entry, FeynmanMeta, Myth, Point } from './types'

interface Known {
  /** 认这个点的字 */
  match: RegExp
  topic: string
  points: (Point & { keys: RegExp; wrong?: RegExp; fixedBy?: RegExp })[]
  myths: Myth[]
}

const GD: Known = {
  match: /梯度下降|gradient descent/i,
  topic: '梯度下降',
  points: [
    { id: 'c1', kind: 'core', text: '从哪里开始、怎么一步步走', answer: '从一个初始猜测出发，反复挪参数，让损失一步步变小', basis: 'PPT p20', keys: /初始|随便猜|随机|一步|重复|迭代/ },
    { id: 'c2', kind: 'core', text: '每一步怎么改 θ', answer: '新 θ = 旧 θ − α × 坡度，沿负梯度走；坡度为负时 θ 变大', basis: 'p20 公式', keys: /减去|减阿尔法|减学习|旧的减|反方向|负梯度/, wrong: /加上/, fixedBy: /减去|减阿尔法/ },
    { id: 'c3', kind: 'core', text: '学习率太大、太小会怎样', answer: 'α 太小走得慢，太大来回跳甚至发散', basis: 'p20', keys: /跳|发散|震荡|振荡/ },
    { id: 'c4', kind: 'core', text: '好几个参数时怎么改', answer: '几个参数同时更新：先用旧 θ 把偏导全算完，再一起改', basis: 'p20「simultaneously」', keys: /同时|同事|一起改|旧的/, wrong: /新的西塔零去算/, fixedBy: /一起改/ },
    { id: 'e1', kind: 'extra', text: '大雾下山的类比', answer: '像大雾里下山，只看脚下的坡；不像的是步长跟着坡度变', basis: 'AI 判断', keys: /下山|大雾/ },
    { id: 'e2', kind: 'extra', text: '这个碗上 α 多大才收敛', answer: '这个碗上 0 < α < 0.5 才收敛', basis: '课外推算', keys: /零点五|0\.5/ },
  ],
  myths: [
    { id: 'm1', text: '梯度是负的，θ 就往小里走', right: '梯度负时减一个负数，θ 变大', core: 'c2' },
    { id: 'm2', text: 'α 就是每步走的距离', right: '每步走 α × 坡度', core: 'c3' },
    { id: 'm3', text: '先改完 θ₀，再用新的 θ₀ 去算 θ₁ 的偏导', right: '都用旧 θ 算完再一起改', core: 'c4' },
  ],
}

const NORM: Known = {
  match: /范数|norm/i,
  topic: '范数',
  points: [
    { id: 'c1', kind: 'core', text: '量的是向量有多大', answer: '范数给每个向量一个非负的「大小」', basis: '定义 2.3.1', keys: /大小|多大|长度/ },
    { id: 'c2', kind: 'core', text: '放大 α 倍会怎样', answer: '‖αx‖ = |α|·‖x‖，是 |α| 倍', basis: '公式 (2.3.10)', keys: /倍/, wrong: /不变|α 倍不变/ },
    { id: 'c3', kind: 'core', text: '两段路和直走', answer: '‖x+y‖ ≤ ‖x‖+‖y‖，直走不比绕路长', basis: '公式 (2.3.11)', keys: /三角|绕|直走/ },
    { id: 'c4', kind: 'core', text: '能不能是负的', answer: '不能是负的，只有零向量的范数是 0', basis: '定义 2.3.1', keys: /负|非负|零向量/ },
    { id: 'e1', kind: 'extra', text: 'L2 和 L1 怎么算', answer: 'L2 是平方和开根号，L1 是绝对值相加', basis: '例 2.3.2', keys: /L2|L1|平方和|绝对值/ },
  ],
  myths: [
    { id: 'm1', text: '范数就是向量的长度', right: '长度（L2）只是范数的一种', core: 'c1' },
    { id: 'm2', text: '放大 α 倍范数也放大 α 倍（α 为负也一样）', right: '是 |α| 倍', core: 'c2' },
  ],
}

const KNOWN = [GD, NORM]
const knownOf = (s: string) => KNOWN.find((k) => k.match.test(s))
const strip = (p: Point & { keys?: RegExp }): Point => ({ id: p.id, kind: p.kind, text: p.text, answer: p.answer, basis: p.basis })

/** 材料里一条条的说法：列表项、一句句，去掉 md 写法 */
function linesOf(material: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of material.split(/\n|。|；/)) {
    const t = raw
      .replace(/^[\s>#*\-+\d.、]+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)|<!--[\s\S]*?-->|\[\[|\]\]|[*_`]/g, '')
      .trim()
    if ([...t].length < 4 || seen.has(t) || /^(来源|——)/.test(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

/** 假的抽要点：回答的 JSON 和真 AI 的一样（judge.ts 的 parseExtract 认） */
export function fakeExtract(material: string, o: { topic?: string; scope: string }): string {
  const k = knownOf(`${o.topic ?? ''}\n${material}`)
  if (k) return JSON.stringify({ points: [{ topic: o.topic && !k.match.test(o.topic) ? o.topic : k.topic, core: k.points.filter((p) => p.kind === 'core').map(strip), extra: k.points.filter((p) => p.kind === 'extra').map(strip), myths: k.myths }] })
  const lines = linesOf(material)
  const topic = o.topic || lines[0]?.slice(0, 12) || '这个知识点'
  const mk = (t: string, i: number, kind: 'core' | 'extra') => ({ id: `${kind === 'core' ? 'c' : 'e'}${i + 1}`, text: t.slice(0, 24), answer: t.slice(0, 40), basis: material.trim() ? '材料' : 'AI 判断' })
  if (!lines.length) return JSON.stringify({ points: [{ topic, core: [`${topic}是什么`, `${topic}有什么用`, `举一个${topic}的例子`].map((t, i) => mk(t, i, 'core')), extra: [], myths: [] }] })
  // 超过 5 条：按 5 条一组分成几个点（演「核心超过 5 条，拆成几个点让你挑」）
  const groups: string[][] = []
  for (let i = 0; i < lines.length; i += 5) groups.push(lines.slice(i, i + 5))
  return JSON.stringify({
    points: groups.map((g, gi) => ({
      topic: groups.length > 1 ? `${topic}（${gi + 1}）` : topic,
      core: g.slice(0, Math.max(2, g.length)).map((t, i) => mk(t, i, 'core')),
      extra: [],
      myths: [],
    })),
  })
}

/** 假的 PDF 知识点单子：每页的第一行当一个点，几页一组 */
export function fakePdfList(pages: { page: number; text: string }[]): string {
  const items = pages
    .filter((p) => p.text.trim())
    .map((p) => ({ name: p.text.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean)!.slice(0, 16), from: p.page, to: p.page, level: 'core', cores: 3 }))
  return JSON.stringify({ title: items[0]?.name ?? 'PDF', items })
}

/** 假的「讲同一件事」：卡上有这个点名字的 */
export function fakeSameThing(topic: string, cards: { n: number; text: string }[]): string {
  return JSON.stringify({ same: cards.filter((c) => c.text.includes(topic)).map((c) => c.n) })
}

const MISS = /不知道|说不上来|没想过|忘了|不清楚/

/** 原话截一句：at 前后各十来个字，截断处加「…」 */
function snippet(t: string, at: number): string {
  const a = Math.max(0, at - 12)
  const z = Math.min(t.length, at + 16)
  return `${a > 0 ? '…' : ''}${t.slice(a, z)}${z < t.length ? '…' : ''}`
}

type Lite = Pick<Entry, 'kind' | 'text'>

function keysOf(meta: FeynmanMeta): Map<string, RegExp> {
  const k = knownOf(meta.topic)
  const out = new Map<string, RegExp>()
  for (const p of meta.points) {
    const kp = k?.points.find((x) => x.id === p.id && x.text === p.text)
    const words = (p.answer || p.text).split(/[，,。、；\s]/).filter((w) => [...w].length >= 2).slice(0, 2)
    out.set(p.id, kp?.keys ?? new RegExp(words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '$^'))
  }
  return out
}

/** 假的学生：回答的 JSON 和真 AI 的一样（judge.ts 的 parseTurn 认） */
export function fakeTurn(meta: FeynmanMeta, entries: readonly Lite[], only?: string[]): string {
  const keys = keysOf(meta)
  const mine = entries.filter((e) => e.kind === 'me')
  const last = mine[mine.length - 1]?.text ?? ''
  const all = mine.map((e) => e.text).join('\n')
  const cores = meta.points.filter((p) => p.kind === 'core' && (!only || only.includes(p.id)))
  const touched = cores.filter((p) => keys.get(p.id)!.test(all)).map((p) => p.id)
  const asks = meta.asked.filter((a) => a.act === 'ask' || a.act === 'redirect')
  const prev = meta.asked[meta.asked.length - 1]
  const quote = last.replace(/\s+/g, ' ').trim().slice(0, 16)
  const lastVerdict = prev && (prev.act === 'ask' || prev.act === 'redirect') ? (MISS.test(last) ? 'miss' : 'right') : 'none'
  const say = (o: Record<string, unknown>) => JSON.stringify({ last: lastVerdict, touched, quote, ...o })
  // 加还是减：只确认一次
  if (/加上/.test(last) && !meta.asked.some((a) => a.act === 'confirm')) return say({ act: 'confirm', say: '你说的是加上学习率乘梯度，还是减？' })
  // 同一条第二次没答对：说穿，接着问别的
  let revealed: string | undefined
  if (lastVerdict === 'miss' && prev?.point && (prev.miss ?? 0) >= 1) {
    const p = meta.points.find((x) => x.id === prev.point)!
    revealed = `${p.answer}。出处：${p.basis}。`
  } else if (lastVerdict === 'miss' && prev?.point) {
    const p = meta.points.find((x) => x.id === prev.point)!
    return say({ act: 'ask', point: p.id, say: `换个说法问：${p.text}，具体是怎样？` })
  }
  const askedIds = new Set(asks.map((a) => a.point))
  const rounds = new Set(asks.map((a) => a.point)).size
  if (rounds >= 3) return say({ act: 'done', say: '', ...(revealed ? { reveal: revealed } : {}) })
  const extraWords = meta.points.filter((p) => p.kind === 'extra' && keys.get(p.id)!.test(last))
  const untouched = cores.find((p) => !touched.includes(p.id) && !askedIds.has(p.id))
  if (!meta.asked.length && extraWords.length && untouched && touched.length <= cores.length / 2)
    return say({ act: 'redirect', point: untouched.id, say: `${extraWords[0]!.text}我听懂了。这些了解即可，先讲核心：${untouched.text}？` })
  const target = untouched ?? cores.find((p) => !askedIds.has(p.id))
  if (!target) return say({ act: 'done', say: '', ...(revealed ? { reveal: revealed } : {}) })
  const q = untouched ? `${target.text}？` : `能拿一个带数的例子说说「${target.text}」吗？`
  return say({ act: 'ask', point: target.id, say: `你说「${quote}」。那${q}`, ...(revealed ? { reveal: revealed } : {}) })
}

/** 假的判定：回答的 JSON 和真 AI 的一样（judge.ts 的 parseJudge 认） */
export function fakeJudge(meta: FeynmanMeta, entries: readonly Lite[], only?: string[]): string {
  const k = knownOf(meta.topic)
  const keys = keysOf(meta)
  const firstMe = entries.find((e) => e.kind === 'me')?.text ?? ''
  // 自己讲的：第一个学生问题之前你说的
  const firstAsk = entries.findIndex((e) => e.kind === 'student')
  const own = entries.filter((e, i) => e.kind === 'me' && (firstAsk === -1 || i < firstAsk)).map((e) => e.text).join('\n') || firstMe
  const answers = entries.filter((e, i) => e.kind === 'me' && firstAsk !== -1 && i > firstAsk).map((e) => e.text)
  const revealedIds = new Set(meta.asked.filter((a) => a.act === 'reveal').map((a) => a.point))
  const core = meta.points
    .filter((p) => p.kind === 'core' && (!only || only.includes(p.id)))
    .map((p) => {
      const kp = k?.points.find((x) => x.id === p.id && x.text === p.text)
      const key = keys.get(p.id)!
      const all = [own, ...answers]
      const wrongAt = kp?.wrong ? all.findIndex((t) => kp.wrong!.test(t)) : -1
      if (wrongAt !== -1) {
        const fixedAt = kp!.fixedBy ? all.findIndex((t, i) => i > wrongAt && kp!.fixedBy!.test(t) && !kp!.wrong!.test(t)) : -1
        const hit = kp!.wrong!.exec(all[wrongAt]!)!
        const quote = snippet(all[wrongAt]!, hit.index)
        if (fixedAt !== -1 && !revealedIds.has(p.id)) return { id: p.id, state: 'fixed', quote: all[fixedAt]!.slice(0, 30) }
        return { id: p.id, state: 'wrong', quote }
      }
      if (revealedIds.has(p.id)) return { id: p.id, state: 'vague', quote: (answers.find((a) => key.test(a)) ?? answers[answers.length - 1] ?? '').slice(0, 30) }
      if (key.test(own)) return { id: p.id, state: 'clear', quote: (own.match(new RegExp(`[^\\s]{0,12}(${key.source})[^\\s]{0,12}`))?.[0] ?? own.slice(0, 20)) }
      const a = answers.find((x) => key.test(x) && !MISS.test(x))
      if (a) return { id: p.id, state: 'asked', quote: a.slice(0, 30) }
      return { id: p.id, state: 'missing', quote: '' }
    })
  const said = [own, ...answers].join('\n')
  const extra = meta.points.filter((p) => p.kind === 'extra').map((p) => ({ id: p.id, said: keys.get(p.id)!.test(said) }))
  const rights = meta.points.map((p) => ({ id: p.id, right: p.answer.slice(0, 40), src: p.basis }))
  const full = meta.points
    .filter((p) => p.kind === 'core')
    .map((p) => p.answer)
    .join('；')
    .slice(0, 148)
  return JSON.stringify({ core, extra, rights, wording: /学习力的话 就是每一步走多远/.test(said) ? ['每一步走的是 α 乘坡度，坡缓了步子会自己变小。'] : [], full: full + '。' })
}
