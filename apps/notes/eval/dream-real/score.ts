/**
 * 给一种判法打分（只算标注过的对）：
 * - 准确率：提出来的（过线、证据核得上）里，标注「该连」的比例（两可的不算对也不算错，单独数）
 * - 误报率：标注「不该连」的里，被提出来的比例（乱连）
 * - 漏报率：标注「该连」的里，既没提、也没进「拿不准」的比例；进了「拿不准」的单独数
 * - 拿不准占比：进「拿不准，你来定」的对占全部的比例，和里面该连的比例
 */
import { type Judgement, type LinkDecision, linkDecision } from '../../src/shared/dream-judge'
import type { Label } from './label'

export interface PairResult {
  q: string
  a: string
  b: string
  source: string
  label: Label
  j?: Judgement
  aText: string
  bText: string
}

export interface Metrics {
  pairs: number
  proposed: number
  proposedRight: number
  proposedMaybe: number
  proposedWrong: number
  precision: number
  falsePositive: number
  miss: number
  missToAsk: number
  ask: number
  askShare: number
  askLinkShare: number
  noAnswer: number
  /** 按来源：正例、找回来的、常见词反例、同文件夹反例 */
  bySource: Record<string, { n: number; link: number; ask: number }>
}

export function decide(r: PairResult, pass?: number, ask?: number): LinkDecision {
  return r.j ? linkDecision(r.j, r.aText, r.bText, pass, ask) : 'drop'
}

export function metrics(rows: PairResult[], pass?: number, ask?: number): Metrics {
  const d = rows.map((r) => ({ r, d: decide(r, pass, ask) }))
  const count = (f: (x: (typeof d)[number]) => boolean) => d.filter(f).length
  const proposed = count((x) => x.d === 'link')
  const right = count((x) => x.d === 'link' && x.r.label === 'link')
  const maybe = count((x) => x.d === 'link' && x.r.label === 'maybe')
  const wrong = count((x) => x.d === 'link' && x.r.label === 'no')
  const links = count((x) => x.r.label === 'link')
  const nos = count((x) => x.r.label === 'no')
  const asks = count((x) => x.d === 'ask')
  const bySource: Metrics['bySource'] = {}
  for (const x of d) {
    const s = (bySource[x.r.source] ??= { n: 0, link: 0, ask: 0 })
    s.n++
    if (x.d === 'link') s.link++
    if (x.d === 'ask') s.ask++
  }
  return {
    pairs: rows.length,
    proposed,
    proposedRight: right,
    proposedMaybe: maybe,
    proposedWrong: wrong,
    precision: right + wrong ? right / (right + wrong) : 1,
    falsePositive: nos ? wrong / nos : 0,
    miss: links ? count((x) => x.r.label === 'link' && x.d === 'drop') / links : 0,
    missToAsk: links ? count((x) => x.r.label === 'link' && x.d === 'ask') / links : 0,
    ask: asks,
    askShare: rows.length ? asks / rows.length : 0,
    askLinkShare: asks ? count((x) => x.d === 'ask' && x.r.label === 'link') / asks : 0,
    noAnswer: count((x) => !x.r.j),
    bySource,
  }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

export function line(name: string, m: Metrics): string {
  return `${name.padEnd(34)} 提 ${String(m.proposed).padStart(4)}  准确率 ${pct(m.precision).padStart(6)}（错 ${m.proposedWrong}，两可 ${m.proposedMaybe}）  误报率 ${pct(m.falsePositive).padStart(6)}  漏报 ${pct(m.miss).padStart(6)}  进拿不准的该连 ${pct(m.missToAsk).padStart(6)}  拿不准占 ${pct(m.askShare).padStart(6)}（其中该连 ${pct(m.askLinkShare)}）  没答 ${m.noAnswer}`
}
