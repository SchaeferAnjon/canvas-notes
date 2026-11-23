/**
 * 课程首页「下次先讲」「串讲这一讲」：打开那块白板，直接开讲那一个点（② 的 store.start，先列「这次要讲到」）。
 * 材料：讲过的照上次那一轮的材料（同一个点下次照你的改动，② 那边认）；没讲过的只有名字，按一个词找材料；串讲是这一讲几轮材料合起来。
 */
import { findRounds } from '../../shared/feynman/doc'
import type { MaterialRef, Scope } from '../../shared/feynman/types'
import * as Fy from '../feynman/store'
import { noteText } from './after'

export interface StartNext {
  /** 在哪块白板上讲（上次那一轮所在的那篇；没讲过的是知识点单子所在的那篇） */
  path: string
  topic: string
  /** 上次那一轮；没讲过的没有 */
  roundId?: string
  scope: Scope
  /** 串讲哪一讲 */
  lecture?: number
}

const key = (r: MaterialRef) => JSON.stringify(r)

/** 这一回讲哪些材料 */
export function materialFor(text: string, o: StartNext): MaterialRef[] {
  const rounds = findRounds(text).map((r) => r.meta)
  if (o.roundId) {
    const m = rounds.find((r) => r.id === o.roundId)
    if (m?.from.length) return m.from
  }
  if (o.scope !== 'point' && o.lecture !== undefined) {
    const seen = new Map<string, MaterialRef>()
    for (const m of rounds) if (m.lecture === o.lecture && m.scope === 'point') for (const f of m.from) seen.set(key(f), f)
    if (seen.size) return [...seen.values()]
  }
  return [{ kind: 'word', word: o.topic }]
}

/** 打开那块白板（open 由调的地方给：课程首页的 onOpen），等它读进来，开讲 */
export async function startNext(o: StartNext, open: (path: string) => void): Promise<void> {
  open(o.path)
  const from = materialFor(await noteText(o.path), o)
  await Fy.start({ path: o.path, from, ...(o.scope !== 'point' ? { scope: o.scope } : {}) })
}
