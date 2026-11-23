/**
 * 拿标注样例（cases.ts）给一种判法打分：准确率、误报率、漏报率，外加没标注却连上的几对（多半是乱连，要人看一眼）。
 * 判法只要给出「连上了哪几对、理由是什么」，梦游底层方案换了算法也能接着用。
 */
import type { Labeled } from './cases'

export interface Pred {
  a: string
  b: string
  why: string
}

export interface Score {
  total: number
  correct: number
  /** 准确率：标注的几对里判对的比例 */
  accuracy: number
  /** 误报率：不该连（不该算重复）的几对里被连上的比例 */
  falsePositive: number
  /** 漏报率：该连的几对里没连上的比例 */
  falseNegative: number
  rows: { a: string; b: string; yes: boolean; got: boolean; why: string; label: string }[]
  /** 没标注、却判成连上的 */
  extra: Pred[]
}

const key = (a: string, b: string) => (a < b ? `${a}\0${b}` : `${b}\0${a}`)

export function score(labeled: Labeled[], preds: Pred[]): Score {
  const got = new Map(preds.map((p) => [key(p.a, p.b), p]))
  const known = new Set(labeled.map((l) => key(l.a, l.b)))
  const rows = labeled.map((l) => {
    const p = got.get(key(l.a, l.b))
    return { a: l.a, b: l.b, yes: l.yes, got: !!p, why: p?.why ?? '', label: l.why }
  })
  const neg = rows.filter((r) => !r.yes)
  const pos = rows.filter((r) => r.yes)
  const correct = rows.filter((r) => r.yes === r.got).length
  return {
    total: rows.length,
    correct,
    accuracy: correct / rows.length,
    falsePositive: neg.length ? neg.filter((r) => r.got).length / neg.length : 0,
    falseNegative: pos.length ? pos.filter((r) => !r.got).length / pos.length : 0,
    rows,
    extra: preds.filter((p) => !known.has(key(p.a, p.b))),
  }
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const name = (p: string) => p.replace(/\.md$/, '').split('/').pop()!

/** 给人看的一段：总数、每一对判得对不对、理由 */
export function report(title: string, s: Score): string {
  const lines = [`## ${title}`, `准确率 ${pct(s.accuracy)}（${s.correct}/${s.total}） · 误报率 ${pct(s.falsePositive)} · 漏报率 ${pct(s.falseNegative)}`]
  for (const r of s.rows) {
    const mark = r.yes === r.got ? '对' : r.got ? '误报' : '漏报'
    lines.push(`- [${mark}] ${r.yes ? '该' : '不该'}：${name(r.a)} ↔ ${name(r.b)}${r.got ? ` · 理由：${r.why}` : ''}`)
  }
  if (s.extra.length) {
    lines.push(`没标注却连上的 ${s.extra.length} 对：`)
    for (const p of s.extra) lines.push(`- ${name(p.a)} ↔ ${name(p.b)} · 理由：${p.why}`)
  }
  return lines.join('\n')
}
