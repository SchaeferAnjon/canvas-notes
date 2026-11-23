/**
 * 找重复：把整个库读一遍，交给 @cn/format 的切片 + MinHash 找讲同一件事的笔记对；梦游补双链的候选也在这里。
 * 只给建议，不改任何文件。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { decodeNote, findSimilarPairs, hanBigrams, notePathFor, prop, resolveLink, similarity, type SimilarPair, termRuns, type TermRun } from '@cn/format'
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

/** 梦游补双链的一处：p 这篇末尾加「相关：[[to]]」；terms 是两篇共同的几个关键词（给人看的理由），分量重的在前 */
export interface LinkCand {
  p: string
  to: string
  score: number
  terms: string[]
}

/** 两篇的词向量余弦（去掉停用词、按词的稀有程度加权）到这个数才考虑补双链 */
export const LINK_MIN_SCORE = 0.12
/** 至少要有这么多个共同的关键词（中文连着的几片拼成一个词）：只有一两个词相同多半是碰巧 */
export const LINK_MIN_TERMS = 3
/** 库够大时，这么多笔记里都有的词算高频词，不当证据 */
const COMMON_SHARE = 0.3
const COMMON_MIN_DOCS = 20

/** 一篇的词频：英文词、中文两字片 */
function countsOf(runs: TermRun[]): Map<string, number> {
  const tf = new Map<string, number>()
  const add = (t: string) => tf.set(t, (tf.get(t) ?? 0) + 1)
  for (const r of runs) {
    if (r.kind === 'word') add(r.term)
    else for (const b of hanBigrams(r.text)) add(b)
  }
  return tf
}

/**
 * 两篇共同的关键词，照 p 里的写法：英文一个词一个，中文连着都在另一篇里出现的两字片拼成一个词（「云」「量」「低于三成」→「云量低于三成」），
 * 被更长的那个包住的不再单列；按分量（稀有程度相加）排
 */
function sharedTerms(runs: TermRun[], other: Map<string, number>, idf: (t: string) => number): string[] {
  const got = new Map<string, { show: string; w: number }>()
  const put = (key: string, show: string, w: number) => {
    const old = got.get(key)
    if (old) old.w = Math.max(old.w, w)
    else got.set(key, { show, w })
  }
  for (const r of runs) {
    if (r.kind === 'word') {
      if (other.has(r.term) && idf(r.term) > 0) put(r.term, r.surface, idf(r.term))
      continue
    }
    const chars = Array.from(r.text)
    const bs = hanBigrams(r.text)
    let i = 0
    while (i < bs.length) {
      if (!(other.has(bs[i]!) && idf(bs[i]!) > 0)) {
        i++
        continue
      }
      let j = i
      let w = 0
      while (j < bs.length && other.has(bs[j]!) && idf(bs[j]!) > 0) w += idf(bs[j++]!)
      const s = chars.slice(i, j + 1).join('')
      put(s, s, w)
      i = j
    }
  }
  const list = [...got.values()].sort((a, b) => b.w - a.w || a.show.localeCompare(b.show))
  const han = (s: string) => /\p{Script=Han}/u.test(s)
  return list.filter((x) => !(han(x.show) && list.some((y) => y !== x && han(y.show) && y.show.includes(x.show)))).map((x) => x.show)
}

const round = (x: number) => Math.round(x * 100) / 100

/**
 * 补双链的候选（task-eler2 改过）：收件箱和素材里的每篇（loose）在全库里找讲同一件事的另一篇（又不是重复），像的在前。
 * 先去掉停用词、高频虚词、序数词（the second、第三方、我们），剩下的词按稀有程度加权（TF-IDF），算两篇的余弦；
 * 余弦够高、而且共同的关键词至少 LINK_MIN_TERMS 个才算。以前按字切三个一片比，两篇英文只要都有「the second」就能连上。
 * 软件汇总的（我的疑惑、视频里的疑惑）不当两头。软件里放在单独的进程算（similar/）
 */
export function linkCandidates(texts: [string, string][], loose: string[]): LinkCand[] {
  const byPath = new Map(texts)
  const runs = new Map<string, TermRun[]>()
  const tfs = new Map<string, Map<string, number>>()
  for (const [p, t] of texts) {
    if (isAutoSummary(t)) continue
    // 文件名也算正文：「极光.md」这种没写标题的随手记，名字就是它讲什么
    const r = termRuns(`${t}\n${titleOf(p)}`)
    runs.set(p, r)
    tfs.set(p, countsOf(r))
  }
  const n = tfs.size
  const df = new Map<string, number>()
  for (const tf of tfs.values()) for (const k of tf.keys()) df.set(k, (df.get(k) ?? 0) + 1)
  const idf = (k: string) => {
    const d = df.get(k)
    if (!d || (n >= COMMON_MIN_DOCS && d / n > COMMON_SHARE)) return 0
    return Math.log(1 + n / d)
  }
  // 每篇的向量（长度归一）和倒排表：一篇只和有共同词的那几篇比
  const vecs = new Map<string, Map<string, number>>()
  const postings = new Map<string, [string, number][]>()
  for (const [p, tf] of tfs) {
    const v = new Map<string, number>()
    let norm = 0
    for (const [k, c] of tf) {
      const w = (1 + Math.log(c)) * idf(k)
      if (w <= 0) continue
      v.set(k, w)
      norm += w * w
    }
    norm = Math.sqrt(norm)
    for (const [k, w] of v) {
      v.set(k, w / norm)
      let list = postings.get(k)
      if (!list) postings.set(k, (list = []))
      list.push([p, w / norm])
    }
    vecs.set(p, v)
  }
  const cands: LinkCand[] = []
  for (const p of loose) {
    const mine = vecs.get(p)
    if (!mine || mine.size < LINK_MIN_TERMS) continue
    const dot = new Map<string, number>()
    for (const [k, w] of mine) for (const [q, v] of postings.get(k)!) if (q !== p) dot.set(q, (dot.get(q) ?? 0) + w * v)
    const ranked = [...dot]
      .filter(([, s]) => s >= LINK_MIN_SCORE)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
    const text = byPath.get(p)!
    for (const [q, s] of ranked) {
      // 已经链着最像的那篇：这篇不用补
      if (text.includes(`[[${titleOf(q)}`)) break
      // 那篇已经链着这篇：两篇本来就连着，不用再补
      if (linksTo({ id: q, text: byPath.get(q)! }, { id: p })) continue
      const terms = sharedTerms(runs.get(p)!, tfs.get(q)!, idf)
      if (terms.length < LINK_MIN_TERMS) continue
      // 是重复，不是相关（找重复那边会报）
      const sim = similarity(text, byPath.get(q)!)
      if (sim.score >= 0.4 || sim.containment >= 0.8) continue
      cands.push({ p, to: q, score: round(s), terms: terms.slice(0, 4) })
      break
    }
  }
  return cands.sort((a, b) => b.score - a.score)
}

/** 补双链给人看的理由：两篇共同的几个关键词（不再写「都讲到『the second』」这种碰巧相同的一段） */
export const linkWhy = (terms: string[]) => `两篇共同的关键词：${terms.join('、')}`
