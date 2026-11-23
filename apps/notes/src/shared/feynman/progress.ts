/**
 * 进度不另存文件（teaching.md 3.4）：从各篇里每一节的费曼注释读出来。课程首页「费曼」那一块、列头这一节的进度、导图上的小点都用这里。
 */
import { diffDays } from '@cn/tasks'
import type { CourseSummary, NextUp, TopicState } from './api'
import { findRounds } from './doc'
import type { FeynmanMeta, Verdict } from './types'

export interface NoteText {
  path: string
  text: string
}

export interface Found {
  path: string
  meta: FeynmanMeta
}

/** 几篇里所有的费曼轮，按开讲的日子排（同一天按文档里的先后） */
export function roundsIn(notes: readonly NoteText[]): Found[] {
  const out: (Found & { i: number })[] = []
  let i = 0
  for (const n of notes) for (const r of findRounds(n.text)) out.push({ path: n.path, meta: r.meta, i: i++ })
  return out.sort((a, b) => a.meta.day.localeCompare(b.meta.day) || a.i - b.i).map(({ i: _i, ...x }) => x)
}

/** 知识点名认同一个点：去掉空白、大小写 */
export const topicKey = (t: string) => t.replace(/\s+/g, '').toLowerCase()

/** 这个点以前过了几次（不算当场补讲的）：judge 的 prevPasses */
export function passesBefore(rounds: readonly Found[], topic: string, exceptId?: string): number {
  const k = topicKey(topic)
  return rounds.filter((r) => r.meta.id !== exceptId && topicKey(r.meta.topic) === k && r.meta.verdict === 'pass' && !r.meta.redone).length
}

/** 这个点讲过几次（新开一轮的 nth = 这个数 + 1） */
export const roundsOf = (rounds: readonly Found[], topic: string) => rounds.filter((r) => topicKey(r.meta.topic) === topicKey(topic)).length

/** 每个点最近一次的样子（只算一个知识点的；串讲另算） */
export function topicStates(rounds: readonly Found[]): TopicState[] {
  const by = new Map<string, TopicState>()
  for (const r of rounds) {
    if (r.meta.scope !== 'point') continue
    const k = topicKey(r.meta.topic)
    const was = by.get(k)
    const judged = r.meta.status === 'judged' && r.meta.verdict
    const s: TopicState = {
      topic: r.meta.topic,
      path: r.path,
      id: r.meta.id,
      ...(r.meta.lecture ? { lecture: r.meta.lecture } : was?.lecture ? { lecture: was.lecture } : {}),
      scope: 'point',
      verdict: judged ? r.meta.verdict! : (was?.verdict ?? null),
      ...(judged ? (r.meta.redone ? { redone: true } : {}) : was?.redone ? { redone: true } : {}),
      day: r.meta.day,
      ...(judged && r.meta.next ? { next: r.meta.next } : was?.next ? { next: was.next } : {}),
      rounds: (was?.rounds ?? 0) + 1,
    }
    by.set(k, s)
  }
  return [...by.values()]
}

/** 这一篇（白板）里每个点最近的判定：列头这一节的进度、导图上的小点（绿过、黄差一点、红没过；正在讲的 talking） */
export function docProgress(text: string): { id: string; topic: string; verdict: Verdict | null; status: FeynmanMeta['status']; day: string; from: FeynmanMeta['from'] }[] {
  const latest = new Map<string, ReturnType<typeof docProgress>[number]>()
  for (const r of findRounds(text)) latest.set(topicKey(r.meta.topic), { id: r.meta.id, topic: r.meta.topic, verdict: r.meta.status === 'judged' ? (r.meta.verdict ?? null) : null, status: r.meta.status, day: r.meta.day, from: r.meta.from })
  return [...latest.values()]
}

/**
 * 课程首页「费曼」那一块（teaching.md 3.4）：一行数、每讲一颗、「下次先讲」一个。
 * 下次先讲：没过的（到了隔一天那天）→ 差一点的（到了三天）→ 学过的讲里还没讲过的点（按讲的顺序）→ 考前两周按章串讲 → 过了的到期重讲。
 * exam：考试那天（YYYY-MM-DD），设了才有考前串讲
 */
export function courseSummary(notes: readonly NoteText[], today: string, exam?: string): CourseSummary {
  const rounds = roundsIn(notes)
  const topics = topicStates(rounds)
  const talked = new Set(topics.map((t) => topicKey(t.topic)))
  // 单子上有、还没讲过的点
  const never: { topic: string; path: string; lecture?: number; order: number }[] = []
  let order = 0
  for (const r of rounds)
    for (const s of r.meta.siblings ?? []) {
      const k = topicKey(s)
      if (talked.has(k) || never.some((n) => topicKey(n.topic) === k)) continue
      never.push({ topic: s, path: r.path, ...(r.meta.lecture ? { lecture: r.meta.lecture } : {}), order: order++ })
    }
  const count = (v: Verdict) => topics.filter((t) => t.verdict === v).length
  const unjudged = topics.filter((t) => !t.verdict).length
  const lectures = new Map<number | null, { pass: number; total: number }>()
  for (const t of [...topics, ...never.map((n) => ({ ...n, verdict: null as Verdict | null }))]) {
    const l = t.lecture ?? null
    const e = lectures.get(l) ?? { pass: 0, total: 0 }
    e.total++
    if (t.verdict === 'pass') e.pass++
    lectures.set(l, e)
  }
  const due = (t: TopicState) => !!t.next && diffDays(t.next, today) <= 0
  const pickTopic = (list: TopicState[], why: NextUp['why']): NextUp | null => {
    const t = [...list].sort((a, b) => (a.next ?? '').localeCompare(b.next ?? '') || (a.day ?? '').localeCompare(b.day ?? ''))[0]
    return t ? { topic: t.topic, why, path: t.path, ...(t.lecture ? { lecture: t.lecture } : {}), ...(t.id ? { id: t.id } : {}) } : null
  }
  let next: NextUp | null = pickTopic(topics.filter((t) => t.verdict === 'fail' && due(t)), 'fail') ?? pickTopic(topics.filter((t) => t.verdict === 'almost' && due(t)), 'almost')
  if (!next) {
    const n = [...never].sort((a, b) => (a.lecture ?? 1e9) - (b.lecture ?? 1e9) || a.order - b.order)[0]
    if (n) next = { topic: n.topic, why: 'new', path: n.path, ...(n.lecture ? { lecture: n.lecture } : {}) }
  }
  if (!next && exam) {
    const left = diffDays(exam, today)
    const chained = rounds.some((r) => r.meta.scope === 'chapter' && diffDays(exam, r.meta.day) <= 14 && diffDays(exam, r.meta.day) >= 0)
    if (left >= 0 && left <= 14 && !chained) next = { topic: '按章串讲一遍', why: 'exam', path: topics[0]?.path ?? '' }
  }
  next ??= pickTopic(topics.filter((t) => t.verdict === 'pass' && due(t)), 'due')
  // 该串讲一次的那一讲：这一讲的点都讲过、判过了，之后还没串讲过这一讲
  let chain: number | null = null
  for (const [l, e] of [...lectures].sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))) {
    if (l === null || e.total < 2) continue
    const pts = topics.filter((t) => t.lecture === l)
    if (pts.length < e.total || pts.some((t) => !t.verdict)) continue
    const lastPoint = pts.map((t) => t.day ?? '').sort().pop() ?? ''
    const done = rounds.some((r) => r.meta.scope !== 'point' && r.meta.lecture === l && r.meta.day >= lastPoint)
    if (!done) {
      chain = l
      break
    }
  }
  return {
    total: topics.length + never.length,
    pass: count('pass'),
    almost: count('almost'),
    fail: count('fail'),
    never: never.length + unjudged,
    lectures: [...lectures].map(([lecture, e]) => ({ lecture, ...e })).sort((a, b) => (a.lecture ?? 1e9) - (b.lecture ?? 1e9)),
    next,
    chain,
    topics,
  }
}
