/**
 * 按意思搜的索引：每个文件切成几段，每段一个向量（已经归一化，点积就是余弦相似度）。
 * 存在软件设置目录（不进库）：index.json 记文件、段和行号，vectors.f32 是一行一个向量。
 * 文件按「修改时间 + 大小」认：没变的不重算，变了的整篇换掉，删了的去掉。模型换了整个重建。
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MeaningHit } from '../../shared/search'
import { jsScorer, type Scorer } from './matmul'
import { atomicWriteSync } from '@cn/atomic'

/** 库里至少这么多篇（PDF 按页算）才拿中位数卡：篇数太少中位数说明不了「这个库的一般水平」 */
const SPREAD_FROM = 20

interface FileEntry {
  /** 修改时间 + 大小 */
  sig: string
  rows: number[]
  chunks: { page?: number; snippet: string }[]
}

interface Saved {
  model: string
  dims: number
  /** 整个库建完过一遍（换模型时：建完以前查询照用旧模型的索引） */
  built?: boolean
  files: Record<string, FileEntry>
}

/** 一篇和另一篇最像的那一对段：i 是这篇的第几段，j 是那篇的第几段 */
export interface PairHit {
  path: string
  score: number
  i: number
  j: number
}

export class VectorIndex {
  private files = new Map<string, FileEntry>()
  private vec: Float32Array
  /** 用到第几行（删掉的行进 free，下回先用） */
  private rows = 0
  private free: number[] = []
  /** 整个库建完过一遍（Indexer 第一次扫完时设，存进 index.json） */
  built = false

  constructor(
    readonly model: string,
    readonly dims: number,
  ) {
    this.vec = new Float32Array(dims * 256)
  }

  get size(): number {
    return this.files.size
  }

  /** 这篇在索引里而且没变 */
  fresh(path: string, sig: string): boolean {
    return this.files.get(path)?.sig === sig
  }

  paths(): string[] {
    return [...this.files.keys()]
  }

  /** 换掉一篇的全部段 */
  set(path: string, sig: string, chunks: { page?: number; snippet: string }[], vectors: Float32Array[]) {
    if (chunks.length !== vectors.length) throw new Error('段数和向量数对不上')
    this.remove(path)
    const rows = vectors.map((v) => {
      if (v.length !== this.dims) throw new Error(`向量是 ${v.length} 维，应该是 ${this.dims} 维`)
      const r = this.free.pop() ?? this.rows++
      if ((r + 1) * this.dims > this.vec.length) {
        const bigger = new Float32Array(Math.max(this.vec.length * 2, (r + 1) * this.dims))
        bigger.set(this.vec)
        this.vec = bigger
      }
      this.vec.set(v, r * this.dims)
      return r
    })
    this.files.set(path, { sig, rows, chunks: chunks.map((c) => ({ snippet: c.snippet, ...(c.page ? { page: c.page } : {}) })) })
  }

  remove(path: string) {
    const f = this.files.get(path)
    if (!f) return
    this.free.push(...f.rows)
    this.files.delete(path)
  }

  /**
   * 和 q 最像的几处：同一篇 md 只留最像的一段，PDF 每页只留一段。
   * 只留「够像」的（门槛见 Indexer 的 MEANING）：不低于 min；比各篇（各页）的中位数高出 spread 以上（不到 SPREAD_FROM 篇不看）；
   * 不比第一名低出 near 以上。anchor：已知最像的能有多像（索引没建完时给，见 Indexer.meaning），比库里找到的最像的还高就按它卡
   */
  search(q: Float32Array, o: { limit: number; min: number; near: number; spread: number; anchor?: number }): MeaningHit[] {
    const best = new Map<string, MeaningHit>()
    const d = this.dims
    for (const [path, f] of this.files) {
      f.rows.forEach((r, i) => {
        let s = 0
        const off = r * d
        for (let k = 0; k < d; k++) s += this.vec[off + k]! * q[k]!
        const c = f.chunks[i]!
        const key = c.page ? `${path}#${c.page}` : path
        const had = best.get(key)
        if (!had || s > had.score) best.set(key, { path, snippet: c.snippet, score: s, ...(c.page ? { page: c.page } : {}) })
      })
    }
    const all = [...best.values()].sort((a, b) => b.score - a.score)
    const top = Math.max(all[0]?.score ?? 0, o.anchor ?? 0)
    const median = all.length >= SPREAD_FROM ? all[all.length >> 1]!.score : -Infinity
    return all.filter((h) => h.score >= o.min && h.score - median >= o.spread && h.score >= top - o.near).slice(0, o.limit)
  }

  /**
   * 和这篇最像的 k 篇（不含自己）：两篇之间按「最像的那一对段落」的余弦比，带回是哪一对（段的序号）。这篇不在索引里是空的。
   * 这篇的几段和全库每一段的点乘一次交给 score 算（搜索进程里是 onnxruntime 的 Gemm，7 万段的库一篇几十毫秒；
   * 单元测试用 JS 的，结果一样），再按篇取最大。算的时候索引可能在变（还在建），先把各篇的行号记下来
   */
  async related(path: string, k: number, score: Scorer = jsScorer): Promise<PairHit[]> {
    const me = this.files.get(path)
    if (!me?.rows.length || k <= 0) return []
    const d = this.dims
    const n = me.rows.length
    const a = new Float32Array(n * d)
    me.rows.forEach((r, i) => a.set(this.vec.subarray(r * d, (r + 1) * d), i * d))
    const m = this.rows
    const others = [...this.files].filter(([p, f]) => p !== path && f.rows.length).map(([p, f]) => [p, [...f.rows]] as const)
    const sc = await score(a, n, this.vec.subarray(0, m * d), m, d)
    const out: PairHit[] = []
    for (const [p, rows] of others) {
      let best = -Infinity
      let bi = 0
      let bj = 0
      rows.forEach((r, j) => {
        for (let i = 0; i < n; i++) {
          const s = sc[i * m + r]!
          if (s > best) {
            best = s
            bi = i
            bj = j
          }
        }
      })
      out.push({ path: p, score: best, i: bi, j: bj })
    }
    return out.sort((x, y) => y.score - x.score).slice(0, k)
  }

  /**
   * 几句话各自在全库最像的 k 段（梦游 Wiki 化：一句日记直接在全库每一段里找，不先挑篇）：qs 是 n 句的向量连着放。
   * 一次交给 score 算 n 句 × 全库每一段，每 32 句一批（7 万段的库一批 9 MB）
   */
  async topChunks(qs: Float32Array, n: number, k: number, score: Scorer = jsScorer): Promise<{ path: string; j: number; score: number }[][]> {
    const d = this.dims
    const m = this.rows
    const owner: ([string, number] | undefined)[] = new Array(m)
    for (const [p, f] of this.files) f.rows.forEach((r, j) => (owner[r] = [p, j]))
    const out: { path: string; j: number; score: number }[][] = []
    for (let s = 0; s < n; s += 32) {
      const b = Math.min(32, n - s)
      const sc = await score(qs.subarray(s * d, (s + b) * d), b, this.vec.subarray(0, m * d), m, d)
      for (let i = 0; i < b; i++) {
        const best: { r: number; s: number }[] = []
        for (let r = 0; r < m; r++) {
          if (!owner[r]) continue
          const v = sc[i * m + r]!
          if (best.length < k) {
            best.push({ r, s: v })
            best.sort((x, y) => y.s - x.s)
          } else if (v > best[k - 1]!.s) {
            best[k - 1] = { r, s: v }
            best.sort((x, y) => y.s - x.s)
          }
        }
        out.push(best.map((x) => ({ path: owner[x.r]![0], j: owner[x.r]![1], score: x.s })))
      }
    }
    return out
  }

  /** 写盘：先写临时文件再换名；行号顺手排紧 */
  save(dir: string) {
    mkdirSync(dir, { recursive: true })
    const files: Record<string, FileEntry> = {}
    let n = 0
    for (const f of this.files.values()) n += f.rows.length
    const out = new Float32Array(n * this.dims)
    let r = 0
    for (const [path, f] of this.files) {
      const rows = f.rows.map((old) => {
        out.set(this.vec.subarray(old * this.dims, (old + 1) * this.dims), r * this.dims)
        return r++
      })
      files[path] = { ...f, rows }
    }
    // 先换向量再换说明：说明里记着每篇在向量里的哪几行，两份各自原子写
    atomicWriteSync(join(dir, 'vectors.f32'), new Uint8Array(out.buffer))
    atomicWriteSync(join(dir, 'index.json'), JSON.stringify({ model: this.model, dims: this.dims, ...(this.built ? { built: true } : {}), files } satisfies Saved))
  }

  /** 只看一眼存的是哪个模型、建完过没有（不读向量）；没有或坏了是 null */
  static peek(dir: string): { model: string; built: boolean } | null {
    try {
      const saved = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Saved
      return { model: saved.model, built: saved.built === true }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return null
      throw e
    }
  }

  /** 读回来；没有、坏了或模型不一样就是空的 */
  static load(dir: string, model: string, dims: number): VectorIndex {
    const ix = new VectorIndex(model, dims)
    let saved: Saved
    let bytes: Buffer
    try {
      saved = JSON.parse(readFileSync(join(dir, 'index.json'), 'utf8')) as Saved
      bytes = readFileSync(join(dir, 'vectors.f32'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || e instanceof SyntaxError) return ix
      throw e
    }
    if (saved.model !== model || saved.dims !== dims) return ix
    const vec = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const rows = vec.length / dims
    for (const f of Object.values(saved.files)) if (f.rows.some((r) => r >= rows)) return new VectorIndex(model, dims)
    ix.vec = vec.length ? vec : ix.vec
    ix.rows = rows
    ix.files = new Map(Object.entries(saved.files))
    ix.built = saved.built === true
    return ix
  }
}
