/**
 * 从真库里抽评测题：每题一篇 A，带几篇候选 B，一次问 AI。
 * - 正例：A 里本来链着的一篇（库里的 [[双链]]），把 A↔B 那条链接所在的行拿掉，再看找候选能不能把它找回来、AI 判不判得对。
 * - 找回来的邻居：和梦游一样两路找候选（关键词 TF-IDF + 本机向量，再加「标题对正文」），按名次合并，取前几名（不含正例）。
 *   这些没有链接，可能是真相关没链上，也可能是字面像意思不像，标注时逐条判。
 * - 反例「常见词」：字面最像（关键词分高）但向量离得远、两步以内连不上的一篇，专测「靠常见词连两篇」。
 * - 反例「同文件夹」：同一个文件夹里、两步以内连不上的一篇，专测「同一门课不同章节算不算相关」。
 * 抽题、算向量都在本机，结果只写进 out 目录（不进仓库）。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { chunksOf, dot, type Embed, maxSim } from './embed'
import { cleanText, inDegree, neighbors, type Note } from './vault'

export type CandSource = 'link' | 'retrieved' | 'decoy-word' | 'decoy-folder'

export interface Cand {
  path: string
  source: CandSource
  /** 找候选时的名次（1 起；正例找不回来是 0） */
  rank: number
  vec: number
  kw: number
}

export interface Query {
  id: string
  a: string
  /** 正例（A 本来链着的那篇） */
  b: string
  split: 'dev' | 'test'
  cands: Cand[]
}

export interface SampleOptions {
  n: number
  dev: number
  seed: number
  /** 每题取几个找回来的邻居（不含正例） */
  retrieved: number
  /** 这些笔记不当 A（另抽一批没见过的题当留出集时，排除前一批的 A） */
  exclude?: Set<string>
}

/** 不当两头：目录页、总览、模板、日志、临时名 */
const HUB = /(^|[-_\s])(MOC|Hub|index|README)([-_\s]|$)|course-map|总览|目录|模板|template|未命名|Untitled|更新日志|Vault-Home|词表|glossary-index/i
const SKIP_DIRS = /^(80-Meta|Excalidraw)\//

/** 一个可以复现的随机数（mulberry32） */
export function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const shuffle = <T>(xs: T[], r: () => number): T[] => {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

// ---------- 关键词：英文去停用词，中文两字片，TF-IDF ----------
const STOP = new Set(
  'a an the and or but if of to in on at by for with from as is are was were be been being it its this that these those he she they we you i his her their our your not no so than then there here which who whom what when where why how all any each few more most other some such only own same too very can will just should now also into over under after before between through during about against up down out off again further once one two three second first third new used use using may might would could has have had do does did many much while both either per via within without upon among get got make like see note notes'.split(
    ' ',
  ),
)

export function terms(t: string): string[] {
  const out: string[] = []
  for (const w of t.toLowerCase().match(/[a-z][a-z0-9+#]+/g) ?? []) if (w.length > 2 && !STOP.has(w)) out.push(w)
  for (const run of t.match(/\p{Script=Han}+/gu) ?? []) for (let i = 0; i + 2 <= run.length; i++) out.push(run.slice(i, i + 2))
  return out
}

export class Keywords {
  df = new Map<string, number>()
  n = 0
  constructor(texts: Iterable<string>) {
    for (const t of texts) {
      this.n++
      for (const k of new Set(terms(t))) this.df.set(k, (this.df.get(k) ?? 0) + 1)
    }
  }
  idf(k: string): number {
    const d = this.df.get(k) ?? 1
    // 三成以上的笔记都有的词不当证据
    return d / this.n > 0.3 ? 0 : Math.log(1 + this.n / d)
  }
  vec(t: string): Map<string, number> {
    const tf = new Map<string, number>()
    for (const k of terms(t)) tf.set(k, (tf.get(k) ?? 0) + 1)
    const v = new Map<string, number>()
    let s = 0
    for (const [k, c] of tf) {
      const w = (1 + Math.log(c)) * this.idf(k)
      if (w <= 0) continue
      v.set(k, w)
      s += w * w
    }
    s = Math.sqrt(s) || 1
    for (const [k, w] of v) v.set(k, w / s)
    return v
  }
}

export function cos(a: Map<string, number>, b: Map<string, number>): number {
  const [x, y] = a.size <= b.size ? [a, b] : [b, a]
  let s = 0
  for (const [k, w] of x) s += w * (y.get(k) ?? 0)
  return s
}

export interface Corpus {
  notes: Map<string, Note>
  eligible: string[]
  clean: Map<string, string>
  kw: Keywords
  kwVec: Map<string, Map<string, number>>
  chunks: Map<string, Float32Array[]>
  titleVec: Map<string, Float32Array>
}

export function isEligible(n: Note, clean: string): boolean {
  return !SKIP_DIRS.test(n.path) && !HUB.test(n.title) && clean.length >= 200
}

/** 全库每篇的干净正文、关键词向量、分段向量（向量缓存在 out 目录，换模型或库变了重算） */
export async function buildCorpus(notes: Map<string, Note>, embed: Embed, cacheFile: string, log: (s: string) => void): Promise<Corpus> {
  const clean = new Map<string, string>()
  for (const n of notes.values()) clean.set(n.path, cleanText(n.raw))
  const eligible = [...notes.values()].filter((n) => isEligible(n, clean.get(n.path)!)).map((n) => n.path).sort()
  const kw = new Keywords(eligible.map((p) => `${notes.get(p)!.title}\n${clean.get(p)!}`))
  const kwVec = new Map(eligible.map((p) => [p, kw.vec(`${notes.get(p)!.title}\n${clean.get(p)!}`)]))
  const chunks = new Map<string, Float32Array[]>()
  const titleVec = new Map<string, Float32Array>()
  // 缓存：<cacheFile>.json 记每篇的指纹和段数，<cacheFile>.f32 按同样的顺序存向量（每篇先标题、再各段）
  const meta: Record<string, { h: string; n: number }> = existsSync(`${cacheFile}.json`) ? JSON.parse(readFileSync(`${cacheFile}.json`, 'utf8')) : {}
  if (existsSync(`${cacheFile}.f32`)) {
    const buf = readFileSync(`${cacheFile}.f32`)
    const all = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
    const D = Number(meta['\0dims']?.n ?? 0)
    let off = 0
    for (const [p, m] of Object.entries(meta)) {
      if (p === '\0dims') continue
      titleVec.set(p, all.slice(off, off + D))
      off += D
      const cs: Float32Array[] = []
      for (let i = 0; i < m.n; i++, off += D) cs.push(all.slice(off, off + D))
      chunks.set(p, cs)
    }
  }
  const todo = eligible.filter((p) => meta[p]?.h !== hashOf(clean.get(p)!))
  log(`向量：${eligible.length} 篇，缓存里有 ${eligible.length - todo.length} 篇，要算 ${todo.length} 篇（${embed.name}）`)
  const save = () => {
    const keep = Object.keys(meta).filter((p) => p !== '\0dims' && chunks.has(p))
    const parts: Float32Array[] = []
    const m2: Record<string, { h: string; n: number }> = {}
    for (const p of keep) {
      parts.push(titleVec.get(p)!, ...chunks.get(p)!)
      m2[p] = meta[p]!
    }
    m2['\0dims'] = { h: '', n: parts[0]?.length ?? 0 }
    const out = new Float32Array(parts.reduce((s, x) => s + x.length, 0))
    let off = 0
    for (const x of parts) {
      out.set(x, off)
      off += x.length
    }
    writeFileSync(`${cacheFile}.f32`, Buffer.from(out.buffer))
    writeFileSync(`${cacheFile}.json`, JSON.stringify(m2))
  }
  const t0 = Date.now()
  let done = 0
  // 几篇同时算（向量接口在显卡上排队；ONNX 在本进程里其实是一篇一篇算）
  let next = 0
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < todo.length) {
        const p = todo[next++]!
        const cs = chunksOf(notes.get(p)!.title, clean.get(p)!)
        const [tv, ...vs] = await embedBatched(embed, [notes.get(p)!.title, ...cs])
        chunks.set(p, vs)
        titleVec.set(p, tv!)
        meta[p] = { h: hashOf(clean.get(p)!), n: cs.length }
        if (++done % 200 === 0) {
          log(`  算了 ${done}/${todo.length} 篇，${Math.round((Date.now() - t0) / 1000)} 秒`)
          save()
        }
      }
    }),
  )
  if (todo.length) save()
  return { notes, eligible, clean, kw, kwVec, chunks, titleVec }
}

/** 第一条是标题（query），其余是段（passage）；e5 两种前缀不同要分开问，bge-m3 不分 */
async function embedBatched(embed: Embed, texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = [...(await embed.embed(texts.slice(0, 1), 'query'))]
  for (let i = 1; i < texts.length; i += 9) out.push(...(await embed.embed(texts.slice(i, i + 9), 'passage')))
  return out
}

function hashOf(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return `${s.length}:${h.toString(36)}`
}

/** A（拿掉指向 hide 那几篇的行）在全库里的三路名次，按名次合并（RRF） */
export interface Ranked {
  path: string
  rrf: number
  vec: number
  kw: number
}

export function rankFor(
  c: Corpus,
  a: { title: string; chunks: Float32Array[]; kw: Map<string, number>; titleVec: Float32Array },
  pool: string[],
  override: Map<string, { chunks: Float32Array[]; kw: Map<string, number> }> = new Map(),
): Ranked[] {
  const rows = pool.map((q) => {
    const o = override.get(q)
    const qc = o?.chunks ?? c.chunks.get(q)!
    const vec = maxSim(a.chunks, qc)
    const kw = cos(a.kw, o?.kw ?? c.kwVec.get(q)!)
    let title = -1
    for (const x of qc) title = Math.max(title, dot(a.titleVec, x))
    for (const x of a.chunks) title = Math.max(title, dot(c.titleVec.get(q)!, x))
    return { path: q, vec, kw, title }
  })
  const rrf = new Map<string, number>()
  for (const key of ['vec', 'kw', 'title'] as const)
    [...rows].sort((x, y) => y[key] - x[key]).forEach((r, i) => rrf.set(r.path, (rrf.get(r.path) ?? 0) + 1 / (10 + i)))
  return rows.map((r) => ({ path: r.path, rrf: rrf.get(r.path)!, vec: round(r.vec), kw: round(r.kw) })).sort((x, y) => y.rrf - x.rrf)
}

const round = (x: number) => Math.round(x * 1000) / 1000

/** 按顶层文件夹分配题数：剪藏多给（梦游默认就整理剪藏和收件箱），课程、系列、其余各占一些 */
const QUOTA: [RegExp, number][] = [
  [/^40-Clippings\//, 0.4],
  [/^30-Courses\//, 0.3],
  [/^50-Series\//, 0.17],
  [/./, 0.13],
]

export async function sampleQueries(c: Corpus, embed: Embed, o: SampleOptions, log: (s: string) => void): Promise<Query[]> {
  const r = rng(o.seed)
  const { notes } = c
  const elig = new Set(c.eligible)
  const indeg = inDegree(notes)
  const nb = neighbors(notes)
  // 每篇 A 的可选正例：A 链出去的、两头都合格、B 不是被链太多的总入口
  const pairsOf = new Map<string, string[]>()
  for (const a of c.eligible) {
    const n = notes.get(a)!
    if (n.out.size > 40 || o.exclude?.has(a)) continue
    const bs = [...n.out].filter((b) => elig.has(b) && (indeg.get(b) ?? 0) <= 60)
    if (bs.length) pairsOf.set(a, bs.sort())
  }
  // 分组：顶层文件夹配额，组内按二级文件夹轮流抽，免得一门课占满
  const picked: { a: string; b: string }[] = []
  const used = new Set<string>()
  const groupOf = (a: string) => QUOTA.findIndex(([re]) => re.test(a))
  for (const [gi, [, share]] of QUOTA.entries()) {
    const want = Math.round(o.n * share)
    const pool = shuffle([...pairsOf.keys()].filter((a) => groupOf(a) === gi && !used.has(a)), r)
    const bySub = new Map<string, string[]>()
    for (const a of pool) {
      const sub = a.split('/').slice(0, 3).join('/')
      if (!bySub.has(sub)) bySub.set(sub, [])
      bySub.get(sub)!.push(a)
    }
    const subs = shuffle([...bySub.keys()], r)
    let got = 0
    while (got < want && subs.some((s) => bySub.get(s)!.length))
      for (const s of subs) {
        if (got >= want) break
        const a = bySub.get(s)!.shift()
        if (!a) continue
        const bs = pairsOf.get(a)!
        picked.push({ a, b: bs[Math.floor(r() * bs.length)]! })
        used.add(a)
        got++
      }
  }
  const order = shuffle(picked, r)
  const queries: Query[] = []
  const hops2 = (a: string) => {
    const s = new Set<string>([a])
    for (const x of nb.get(a) ?? []) {
      s.add(x)
      for (const y of nb.get(x) ?? []) s.add(y)
    }
    return s
  }
  for (const [i, { a, b }] of order.entries()) {
    const na = notes.get(a)!
    const nbb = notes.get(b)!
    // 拿掉 A↔B 的链接行以后的正文，重算这两篇的向量和关键词
    const aText = cleanText(na.raw, new Set([nbb.title]))
    const bText = cleanText(nbb.raw, new Set([na.title]))
    const aChunks = await embed.embed(chunksOf(na.title, aText), 'passage')
    const bChunks = await embed.embed(chunksOf(nbb.title, bText), 'passage')
    const aKw = c.kw.vec(`${na.title}\n${aText}`)
    const bKw = c.kw.vec(`${nbb.title}\n${bText}`)
    // 梦游不会再提已经连着的：A 的邻居（除了被拿掉的 B）不进候选
    const near = nb.get(a) ?? new Set()
    const pool = c.eligible.filter((q) => q !== a && (q === b || !near.has(q)))
    const ranked = rankFor(c, { title: na.title, chunks: aChunks, kw: aKw, titleVec: c.titleVec.get(a)! }, pool, new Map([[b, { chunks: bChunks, kw: bKw }]]))
    const rankOf = new Map(ranked.map((x, j) => [x.path, j + 1]))
    const bRank = rankOf.get(b) ?? 0
    const cands: Cand[] = [{ path: b, source: 'link', rank: bRank, vec: ranked[bRank - 1]!.vec, kw: ranked[bRank - 1]!.kw }]
    for (const x of ranked) {
      if (cands.filter((y) => y.source === 'retrieved').length >= o.retrieved) break
      if (x.path === b) continue
      cands.push({ path: x.path, source: 'retrieved', rank: rankOf.get(x.path)!, vec: x.vec, kw: x.kw })
    }
    const far = hops2(a)
    const taken = new Set(cands.map((y) => y.path))
    // 常见词反例：关键词分高、向量名次在 300 名以后
    const byVec = [...ranked].sort((x, y) => y.vec - x.vec)
    const vecRank = new Map(byVec.map((x, j) => [x.path, j + 1]))
    const word = [...ranked]
      .filter((x) => !far.has(x.path) && !taken.has(x.path) && dirname(x.path) !== dirname(a) && vecRank.get(x.path)! > 300)
      .sort((x, y) => y.kw - x.kw)[0]
    if (word) cands.push({ path: word.path, source: 'decoy-word', rank: rankOf.get(word.path)!, vec: word.vec, kw: word.kw })
    // 同文件夹反例：同一个文件夹（没有就上一层）里两步以内连不上的
    for (const dir of [dirname(a), dirname(dirname(a))]) {
      const same = ranked.filter((x) => !far.has(x.path) && !taken.has(x.path) && x.path !== word?.path && x.path.startsWith(dir + '/'))
      if (!same.length) continue
      const f = same[Math.floor(r() * same.length)]!
      cands.push({ path: f.path, source: 'decoy-folder', rank: rankOf.get(f.path)!, vec: f.vec, kw: f.kw })
      break
    }
    queries.push({ id: `q${String(i + 1).padStart(3, '0')}`, a, b, split: i < o.dev ? 'dev' : 'test', cands: shuffle(cands, r) })
    if ((i + 1) % 25 === 0) log(`  抽了 ${i + 1}/${order.length} 题`)
  }
  return queries
}

/** 一篇在题里给 AI 看的正文：A 拿掉指向 B 的行，B 拿掉指向 A 的行（别的候选也拿掉指向 A 的行） */
export function textFor(notes: Map<string, Note>, path: string, hide: string[]): string {
  return cleanText(notes.get(path)!.raw, new Set(hide.map((p) => notes.get(p)!.title)))
}

export const outFile = (out: string, name: string) => join(out, name)
