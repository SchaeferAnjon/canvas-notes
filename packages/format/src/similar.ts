/**
 * 找讲同一件事的笔记：按字符 3-gram 切片，用 MinHash 签名加分段（LSH）先挑出候选对，
 * 再对候选对算真的 Jaccard 相似度。纯函数，不读文件，手机版也能用。
 */

export interface SimilarDoc {
  id: string
  /** md 原文（frontmatter、排版注释、记号会先去掉） */
  text: string
}

export interface SimilarPair {
  a: string
  b: string
  /** 两篇 3-gram 集合的 Jaccard 相似度，0 到 1 */
  score: number
  /** 短的那篇有多少落在长的那篇里，0 到 1 */
  containment: number
  /** 两篇都有的最长一段（去掉记号后的文字，最多 40 个字） */
  passage: string
}

export interface SimilarOptions {
  /** Jaccard 到这个数就算可能重复（默认 0.4） */
  threshold?: number
  /** 短的那篇这么多落在长的那篇里也算（默认 0.8） */
  containment?: number
  /** 切片少于这个数的笔记太短，不比（默认 20） */
  minShingles?: number
}

const N = 3
/** 签名长度 = 分段数 × 每段行数；64 段 × 2 行，Jaccard 0.15 以上的几乎都会成为候选 */
const BANDS = 64
const ROWS = 2
const K = BANDS * ROWS

/** 去掉 frontmatter、排版注释、网址和 md 记号，标点和空白并成一个空格，转小写（keepCase 时不转，给人看的那段用） */
export function plainText(md: string, keepCase = false): string {
  const s = md
    .replace(/^﻿?---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|#^]+)[^\]]*\]\]/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[*_`~#>=]+/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    // 汉字之间的空白（原来的标点）不算，中文按连着的字切
    .replace(/(?<=\p{Script=Han})\s+(?=\p{Script=Han})/gu, '')
    .trim()
  return keepCase ? s : s.toLowerCase()
}

/** 按字（不是字节）切成连续 3 个字一片 */
export function shingles(text: string, n = N): Set<string> {
  const chars = Array.from(text)
  const out = new Set<string>()
  for (let i = 0; i + n <= chars.length; i++) out.add(chars.slice(i, i + n).join(''))
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0
  let inter = 0
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  for (const s of small) if (big.has(s)) inter++
  return inter / (a.size + b.size - inter)
}

function overlap(a: Set<string>, b: Set<string>): number {
  const [small, big] = a.size <= b.size ? [a, b] : [b, a]
  if (!small.size) return 0
  let inter = 0
  for (const s of small) if (big.has(s)) inter++
  return inter / small.size
}

/** FNV-1a，32 位 */
function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 把一个 32 位数打散（当作一个随机排列） */
function mix(x: number): number {
  x ^= x >>> 16
  x = Math.imul(x, 0x7feb352d)
  x ^= x >>> 15
  x = Math.imul(x, 0x846ca68b)
  x ^= x >>> 16
  return x >>> 0
}

const SEEDS = Array.from({ length: K }, (_, i) => mix(Math.imul(i + 1, 0x9e3779b9)))

/** MinHash 签名：K 个排列下各自最小的哈希 */
export function minhash(set: Set<string>, k = K): Uint32Array {
  const sig = new Uint32Array(k).fill(0xffffffff)
  for (const s of set) {
    const h = fnv(s)
    for (let i = 0; i < k; i++) {
      const v = mix(h ^ SEEDS[i]!)
      if (v < sig[i]!) sig[i] = v
    }
  }
  return sig
}

/** 两个签名估出来的 Jaccard */
export function estimate(a: Uint32Array, b: Uint32Array): number {
  let same = 0
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++
  return same / a.length
}

/** 两段文字都有的最长一段（只看前 3000 个字），用来告诉人为什么像 */
export function commonPassage(a: string, b: string, max = 40): string {
  const x = Array.from(a.slice(0, 3000))
  const y = Array.from(b.slice(0, 3000))
  let best = 0
  let end = 0
  let prev = new Uint16Array(y.length + 1)
  let cur = new Uint16Array(y.length + 1)
  for (let i = 1; i <= x.length; i++) {
    for (let j = 1; j <= y.length; j++) {
      cur[j] = x[i - 1] === y[j - 1] ? prev[j - 1]! + 1 : 0
      if (cur[j]! > best) {
        best = cur[j]!
        end = i
      }
    }
    ;[prev, cur] = [cur, prev]
    cur.fill(0)
  }
  const s = x
    .slice(end - best, end)
    .join('')
    .trim()
  return Array.from(s).length > max ? Array.from(s).slice(0, max).join('') + '…' : s
}

/** 一对笔记有多像（不经过 MinHash，直接算） */
export function similarity(a: string, b: string): { score: number; containment: number; passage: string } {
  const pa = plainText(a)
  const pb = plainText(b)
  const sa = shingles(pa)
  const sb = shingles(pb)
  return { score: round(jaccard(sa, sb)), containment: round(overlap(sa, sb)), passage: commonPassage(plainText(a, true), plainText(b, true)) }
}

const round = (x: number) => Math.round(x * 100) / 100

/** 在一堆笔记里找可能重复的对，像的在前 */
export function findSimilarPairs(docs: SimilarDoc[], opts: SimilarOptions = {}): SimilarPair[] {
  const threshold = opts.threshold ?? 0.4
  const contain = opts.containment ?? 0.8
  const minShingles = opts.minShingles ?? 20
  const items = docs
    .map((d) => {
      const set = shingles(plainText(d.text))
      return { id: d.id, text: d.text, set }
    })
    .filter((d) => d.set.size >= minShingles)
  const sigs = items.map((d) => minhash(d.set))

  // 分段：任何一段签名完全一样就成为候选
  const candidates = new Set<string>()
  for (let band = 0; band < BANDS; band++) {
    const buckets = new Map<string, number[]>()
    for (let i = 0; i < items.length; i++) {
      const sig = sigs[i]!
      let key = ''
      for (let r = 0; r < ROWS; r++) key += sig[band * ROWS + r]!.toString(36) + ','
      const list = buckets.get(key)
      if (list) list.push(i)
      else buckets.set(key, [i])
    }
    for (const list of buckets.values()) {
      if (list.length < 2 || list.length > 200) continue
      for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) candidates.add(`${list[x]} ${list[y]}`)
    }
  }

  const out: SimilarPair[] = []
  for (const c of candidates) {
    const [i, j] = c.split(' ').map(Number) as [number, number]
    const a = items[i]!
    const b = items[j]!
    const score = jaccard(a.set, b.set)
    const containment = overlap(a.set, b.set)
    if (score < threshold && !(containment >= contain && Math.min(a.set.size, b.set.size) >= minShingles * 1.5)) continue
    const [first, second] = a.id < b.id ? [a, b] : [b, a]
    out.push({ a: first.id, b: second.id, score: round(score), containment: round(containment), passage: commonPassage(plainText(first.text, true), plainText(second.text, true)) })
  }
  return out.sort((x, y) => y.score - x.score || y.containment - x.containment || x.a.localeCompare(y.a))
}
