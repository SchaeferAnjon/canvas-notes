/**
 * 按意思搜的索引：每个文件切成几段，每段一个向量（已经归一化，点积就是余弦相似度）。
 * 存在软件设置目录（不进库）：index.json 记文件、段和行号，vectors.f32 是一行一个向量。
 * 文件按「修改时间 + 大小」认：没变的不重算，变了的整篇换掉，删了的去掉。模型换了整个重建。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { MeaningHit } from '../../shared/search'

interface FileEntry {
  /** 修改时间 + 大小 */
  sig: string
  rows: number[]
  chunks: { page?: number; snippet: string }[]
}

interface Saved {
  model: string
  dims: number
  files: Record<string, FileEntry>
}

export class VectorIndex {
  private files = new Map<string, FileEntry>()
  private vec: Float32Array
  /** 用到第几行（删掉的行进 free，下回先用） */
  private rows = 0
  private free: number[] = []

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
   * 只留「够像」的：不低于 min，也不比第一名低出 near 以上（这个模型的分数都挤在 0.75 到 0.9 之间，看相对高低更准）
   */
  /** anchor：已知最像的能有多像（索引没建完时给，见 Indexer.meaning），比库里找到的最像的还高就按它卡 */
  search(q: Float32Array, o: { limit: number; min: number; near: number; anchor?: number }): MeaningHit[] {
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
    return all.filter((h) => h.score >= o.min && h.score >= top - o.near).slice(0, o.limit)
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
    writeFileSync(join(dir, 'vectors.f32.tmp'), new Uint8Array(out.buffer))
    writeFileSync(join(dir, 'index.json.tmp'), JSON.stringify({ model: this.model, dims: this.dims, files } satisfies Saved))
    renameSync(join(dir, 'vectors.f32.tmp'), join(dir, 'vectors.f32'))
    renameSync(join(dir, 'index.json.tmp'), join(dir, 'index.json'))
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
    return ix
  }
}
