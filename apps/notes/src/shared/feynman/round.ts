/**
 * 一轮的簿记：新开一轮的注释、追问了几轮、同一处连着没答对几次、看过材料几次。都是纯函数，主进程和界面都用。
 */
import type { Draft } from './api'
import { applyEdits } from './rules'
import { type Asked, type FeynmanMeta, ROUNDS_MAX } from './types'

/** 这一轮的编号：f-20261123-a1b2 */
export function newRoundId(today: string, rand: () => number = Math.random): string {
  const tail = Math.floor(rand() * 0x10000)
    .toString(16)
    .padStart(4, '0')
  return `f-${today.replace(/-/g, '')}-${tail}`
}

/** 「开始讲」：抽好的「这次要讲到」（加上你的改动）变成一轮的注释；nth 是第几次讲这个点 */
export function newMeta(d: Draft, o: { today: string; nth?: number; id?: string; edits?: FeynmanMeta['edits'] }): FeynmanMeta {
  const edits = o.edits?.length ? o.edits : undefined
  return {
    v: 1,
    id: o.id ?? newRoundId(o.today),
    topic: d.topic,
    scope: d.scope,
    status: 'talking',
    from: d.from,
    cover: d.cover,
    points: applyEdits(d.points, edits),
    myths: d.myths,
    ...(edits ? { edits } : {}),
    ...(d.noMaterial ? { noMaterial: true } : {}),
    ...(d.siblings?.length ? { siblings: d.siblings } : {}),
    ...(d.lecture ? { lecture: d.lecture } : {}),
    by: d.by,
    day: o.today,
    nth: o.nth ?? 1,
    asked: [],
    peeks: 0,
  }
}

/** 算一轮的那几种（确认加还是减、答「要不要会」不算） */
const COUNTS = new Set(['ask', 'redirect'])

/**
 * 用了几轮追问：一轮只盯一条核心，同一条连着问（最多两次，含说穿）算一轮；换了一条算新的一轮
 */
export function roundsUsed(asked: readonly Asked[]): number {
  let n = 0
  let last: string | undefined
  for (const a of asked) {
    if (!COUNTS.has(a.act)) continue
    if (a.point !== last || a.point === undefined) n++
    last = a.point
  }
  return n
}

/** 三轮用完了 */
export const roundsDone = (asked: readonly Asked[]) => roundsUsed(asked) >= ROUNDS_MAX

/** 最后一次追问（ask / redirect）：盯着哪条、那时已经连着没答对几次 */
export function lastAsk(asked: readonly Asked[]): Asked | undefined {
  for (let i = asked.length - 1; i >= 0; i--) {
    const a = asked[i]!
    if (COUNTS.has(a.act)) return a
    if (a.act === 'reveal') return undefined
  }
  return undefined
}

/** 讲的时候看过一次材料（按住「看一眼」、暂停露出后接着讲，已定 2、5） */
export const withPeek = (m: FeynmanMeta): FeynmanMeta => ({ ...m, peeks: m.peeks + 1 })

/** 暂停：讲过的都留着；接着讲时记一次看过材料（暂停时材料露出来了） */
export const paused = (m: FeynmanMeta): FeynmanMeta => ({ ...m, status: 'paused' })
export const resumed = (m: FeynmanMeta): FeynmanMeta => ({ ...m, status: 'talking', peeks: m.peeks + 1 })

/**
 * 列头那一行要的数（设计稿「第1轮 · 问了3轮」「这一节第3个 · 共3个」）：第几次讲这个点、追问了几轮、
 * 在同一张单子（PDF 一讲、导图一支）里是第几个、一共几个；不在单子上的没有后两项
 */
export function headerInfo(m: FeynmanMeta): { nth: number; rounds: number; index?: number; total?: number } {
  const i = m.siblings?.findIndex((s) => s.replace(/\s+/g, '') === m.topic.replace(/\s+/g, '')) ?? -1
  return { nth: m.nth, rounds: roundsUsed(m.asked), ...(i >= 0 ? { index: i + 1, total: m.siblings!.length } : {}) }
}
