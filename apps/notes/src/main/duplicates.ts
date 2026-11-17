/**
 * 找重复：把整个库读一遍，交给 @cn/format 的 3-gram + MinHash 找讲同一件事的笔记对。
 * 只给建议，不改任何文件。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeNote, findSimilarPairs, jaccard, notePathFor, plainText, prop, resolveLink, shingles, similarity, type SimilarPair } from '@cn/format'
import type { DuplicatePair } from '../shared/api'
import { titleOf } from '../shared/layout'

/**
 * 软件自己汇总出来的那几篇（我的疑惑、视频里的疑惑）：front matter 写着「生成: 软件」。
 * 它们本来就是从别的笔记里摘出来的，和来源笔记像是应该的，不参加找重复（CN-56）
 */
export const isAutoSummary = (text: string) => prop(text, '生成') === '软件'

/** a 明确链着 b：[[b 的名字]]、指到 b 的相对链接，或者指到 b 这篇读 PDF 笔记的那份 PDF（我的疑惑里每条都链着 PDF 那一页） */
export function linksTo(a: { id: string; text: string }, b: { id: string }): boolean {
  const name = titleOf(b.id).toLowerCase()
  for (const m of a.text.matchAll(/\[\[([^\]|#\n]+)/g)) if (m[1]!.trim().toLowerCase() === name || m[1]!.trim() === b.id) return true
  for (const m of a.text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const to = resolveLink(a.id, m[1]!.replace(/#.*$/, ''))
    if (to && (to === b.id || (/\.pdf$/i.test(to) && notePathFor(to) === b.id))) return true
  }
  return false
}

/** 读库里所有 md（相对路径 → 文字） */
export async function readAll(root: string, paths: string[]): Promise<{ id: string; text: string }[]> {
  return Promise.all(paths.map(async (p) => ({ id: p, text: decodeNote(await readFile(join(root, p))).text })))
}

/**
 * 找重复的前后两头：参加比的（软件汇总的不算），和把像的一对变成给人看的那条（一篇明确链着另一篇当来源的不算，返回 null）。
 * 中间的比较在 @cn/format（单元测试在这个进程里一口气比；软件里拆到几个线程，similar/worker.ts）。
 */
export function dupEnds(docs: { id: string; text: string }[]) {
  const own = docs.filter((d) => !isAutoSummary(d.text))
  const byId = new Map(own.map((d) => [d.id, d]))
  // 一篇明确链着另一篇当来源（「记在 [[Lecture05 笔记]]」），不算重复
  const linked = (a: string, b: string) => linksTo(byId.get(a)!, { id: b }) || linksTo(byId.get(b)!, { id: a })
  const toPair = (p: SimilarPair): DuplicatePair | null =>
    linked(p.a, p.b)
      ? null
      : {
          a: p.a,
          b: p.b,
          score: p.score,
          why:
            p.score >= 0.4
              ? `两篇约${Math.round(p.score * 100)}%的字句相同${p.passage ? `，都有「${p.passage}」` : ''}`
              : `短的那篇有${Math.round(p.containment * 100)}%在另一篇里${p.passage ? `，比如「${p.passage}」` : ''}`,
        }
  return { own, toPair }
}

export function duplicatesOf(docs: { id: string; text: string }[]): DuplicatePair[] {
  const { own, toPair } = dupEnds(docs)
  return findSimilarPairs(own)
    .map(toPair)
    .filter((p): p is DuplicatePair => p !== null)
}

/** 梦游补双链的一处：p 这篇末尾加「相关：[[to]]」 */
export interface LinkCand {
  p: string
  to: string
  score: number
  passage: string
}

/**
 * 补双链的候选：收件箱和素材里的每篇（loose）在全库里找最像的另一篇（讲到同一件事，又不是重复），像的在前。
 * 软件汇总的（我的疑惑、视频里的疑惑）不当两头。每篇和全库比一遍，几千篇的库要算几分钟，软件里放在单独的进程算（similar/）
 */
export function linkCandidates(texts: [string, string][], loose: string[]): LinkCand[] {
  const byPath = new Map(texts)
  const sets = new Map<string, Set<string>>()
  for (const [p, t] of texts) if (!isAutoSummary(t)) sets.set(p, shingles(plainText(t)))
  const cands: LinkCand[] = []
  for (const p of loose) {
    const mine = sets.get(p)
    if (!mine || mine.size < 12) continue
    let best: { path: string; score: number } | null = null
    for (const [q, other] of sets) {
      if (q === p || other.size < 12) continue
      const s = jaccard(mine, other)
      if (s >= 0.06 && s < 0.4 && (!best || s > best.score)) best = { path: q, score: s }
    }
    if (!best) continue
    const text = byPath.get(p)!
    if (text.includes(`[[${titleOf(best.path)}`)) continue
    const sim = similarity(text, byPath.get(best.path)!)
    if (sim.containment >= 0.8 || Array.from(sim.passage).length < 4) continue
    cands.push({ p, to: best.path, score: best.score, passage: sim.passage })
  }
  return cands.sort((a, b) => b.score - a.score)
}
