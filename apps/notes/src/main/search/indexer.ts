/**
 * 搜索进程里的索引：
 * 1. 先把库里每份 PDF 的字读出来（有缓存直接用），放在内存里给「文字」那一层搜；
 * 2. 再在后台给 md 和 PDF 一段一段算向量（意思相近那一层），一批 16 段，批和批之间让出去，查询随时插得进来；
 * 3. 隔一阵写一次盘，下次打开只算新的和改了的。
 * 不依赖 Electron：单元测试用假模型直接跑。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { decodeNote, type PdfBlock } from '@cn/format'
import { type MeaningHit, type PdfTextHit, queryWords, type SearchStatus } from '../../shared/search'
import { pdfHash, type PdfTextCache, textCachePath } from '../pdf-text-cache'
import { type Chunk, mdChunks, pdfChunks, pdfTextHits } from './chunks'
import type { Embedder } from './embedder'
import { VectorIndex } from './vector-index'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.obsidian'])
const BATCH = 16
/** 算了多少段写一次盘 */
const SAVE_EVERY = 400
/**
 * 意思相近：最多几条、多像才算。这个模型的分数挤在 0.78 到 0.92 之间，沾边的一般比不沾边的高出 0.03 以上：
 * 只留不低于 0.83、离第一名不到 0.04 的（2026-11-16 拿中英文混的小库量的）
 */
export const MEANING = { limit: 30, min: 0.83, near: 0.04 }

export interface IndexerOptions {
  root: string
  /** 软件设置目录（PDF 全文缓存在它的 reading/text/ 里） */
  userData: string
  /** 这个库的意思索引放哪 */
  indexDir: string
  /** 没有模型时是 null：只有文字那一层 */
  embedder: Embedder | null
  readPdf(abs: string): Promise<{ data: Uint8Array; pages: PdfBlock[][]; sizes: [number, number][] }>
  /** 多像才算（默认 MEANING；单元测试的假模型分数低，给宽一点的） */
  meaning?: typeof MEANING
  onStatus(s: SearchStatus): void
}

interface FileStat {
  path: string
  sig: string
}

const tick = () => new Promise<void>((r) => setImmediate(r))

export class Indexer {
  private pdfs = new Map<string, { sig: string; pages: PdfBlock[][]; sizes?: [number, number][] }>()
  private index: VectorIndex | null
  private status: SearchStatus
  private running: Promise<void> | null = null
  private again = false
  private closed = false

  constructor(private o: IndexerOptions) {
    this.index = o.embedder ? VectorIndex.load(o.indexDir, o.embedder.model, o.embedder.dims) : null
    this.status = { phase: o.embedder ? 'text' : 'off', done: 0, total: 0, files: this.index?.size ?? 0 }
  }

  get state(): SearchStatus {
    return this.status
  }

  private set(s: Partial<SearchStatus>) {
    this.status = { ...this.status, ...s }
    if (!s.error) delete this.status.error
    this.o.onStatus(this.status)
  }

  /** 扫一遍（打开库时、文件变了时）；正在扫就扫完再来一遍 */
  scan(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.pass()
        } while (this.again && !this.closed)
      } catch (e) {
        this.set({ phase: 'error', error: String((e as Error).message ?? e) })
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  close() {
    this.closed = true
  }

  private async walk(): Promise<{ md: FileStat[]; pdf: FileStat[] }> {
    const md: FileStat[] = []
    const pdf: FileStat[] = []
    const go = async (dir: string) => {
      let ents
      try {
        ents = await readdir(dir, { withFileTypes: true })
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return
        throw e
      }
      for (const ent of ents) {
        if (ent.name.startsWith('.')) continue
        const abs = join(dir, ent.name)
        if (ent.isDirectory()) {
          if (!SKIP_DIRS.has(ent.name)) await go(abs)
          continue
        }
        const low = ent.name.toLowerCase()
        if (!ent.isFile() || !(low.endsWith('.md') || low.endsWith('.pdf'))) continue
        let st
        try {
          st = await stat(abs)
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === 'ENOENT') continue
          throw e
        }
        const f = { path: relative(this.o.root, abs).split(sep).join('/'), sig: `${st.mtimeMs}:${st.size}` }
        ;(low.endsWith('.md') ? md : pdf).push(f)
      }
    }
    await go(this.o.root)
    return { md, pdf }
  }

  private async pass() {
    const { md, pdf } = await this.walk()
    // ---- PDF 里的字 ----
    const seenPdf = new Set(pdf.map((f) => f.path))
    for (const p of this.pdfs.keys()) if (!seenPdf.has(p)) this.pdfs.delete(p)
    const todo = pdf.filter((f) => this.pdfs.get(f.path)?.sig !== f.sig)
    if (todo.length && this.status.phase !== 'off') this.set({ phase: 'text', done: 0, total: todo.length })
    let n = 0
    for (const f of todo) {
      if (this.closed) return
      try {
        this.pdfs.set(f.path, { sig: f.sig, ...(await this.pdfText(f.path)) })
      } catch (e) {
        // 坏的、加了密码的 PDF：搜不到它的字，别的照常
        console.error(`读不了 ${f.path} 的字`, e)
        this.pdfs.set(f.path, { sig: f.sig, pages: [] })
      }
      if (this.status.phase !== 'off') this.set({ done: ++n })
      await tick()
    }
    if (!this.index || !this.o.embedder) return

    // ---- 意思索引 ----
    const index = this.index
    const all = [...md, ...pdf]
    const keep = new Set(all.map((f) => f.path))
    for (const p of index.paths()) if (!keep.has(p)) index.remove(p)
    const stale = all.filter((f) => !index.fresh(f.path, f.sig))
    if (!stale.length) {
      this.set({ phase: 'ready', done: 0, total: 0, files: index.size })
      return
    }
    // 先切好所有要算的段，进度按段数走
    const jobs: { f: FileStat; chunks: Chunk[] }[] = []
    for (const f of stale) {
      const chunks = f.path.toLowerCase().endsWith('.pdf') ? pdfChunks(f.path, this.pdfs.get(f.path)?.pages ?? []) : await this.mdChunksOf(f.path)
      if (chunks) jobs.push({ f, chunks })
    }
    const total = jobs.reduce((s, j) => s + j.chunks.length, 0)
    this.set({ phase: 'embed', done: 0, total, files: index.size })
    let done = 0
    let sinceSave = 0
    for (const { f, chunks } of jobs) {
      const vecs: Float32Array[] = []
      for (let i = 0; i < chunks.length; i += BATCH) {
        if (this.closed) return
        vecs.push(...(await this.o.embedder.embed(chunks.slice(i, i + BATCH).map((c) => c.text), 'passage')))
        done += Math.min(BATCH, chunks.length - i)
        this.set({ done })
        await tick()
      }
      index.set(f.path, f.sig, chunks, vecs)
      sinceSave += chunks.length
      if (sinceSave >= SAVE_EVERY) {
        index.save(this.o.indexDir)
        sinceSave = 0
      }
    }
    index.save(this.o.indexDir)
    this.set({ phase: 'ready', done: total, total, files: index.size })
  }

  private async mdChunksOf(path: string): Promise<Chunk[] | null> {
    try {
      return mdChunks(path, decodeNote(await readFile(join(this.o.root, path))).text)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  /** 一份 PDF 的段落块：缓存里有（PDF 标签读过、上次扫过）就用，没有现读一遍再写进缓存 */
  private async pdfText(path: string): Promise<{ pages: PdfBlock[][]; sizes?: [number, number][] }> {
    const abs = join(this.o.root, path)
    const data = new Uint8Array(await readFile(abs))
    const cachePath = textCachePath(this.o.userData, pdfHash(data))
    if (existsSync(cachePath)) {
      const c = JSON.parse(readFileSync(cachePath, 'utf8')) as PdfTextCache
      if (c.sizes) return { pages: c.pages, sizes: c.sizes }
    }
    const r = await this.o.readPdf(abs)
    mkdirSync(dirname(cachePath), { recursive: true })
    writeFileSync(cachePath + '.tmp', JSON.stringify({ pdf: path, pages: r.pages, sizes: r.sizes } satisfies PdfTextCache))
    renameSync(cachePath + '.tmp', cachePath)
    return { pages: r.pages, sizes: r.sizes }
  }

  /** 文字那一层的 PDF 部分：每份 PDF 最多 10 页，一共最多 limit 条 */
  pdfSearch(q: string, limit = 40): PdfTextHit[] {
    const words = queryWords(q)
    if (!words.length) return []
    const out: PdfTextHit[] = []
    for (const [path, p] of this.pdfs) {
      out.push(...pdfTextHits(path, p.pages, p.sizes, words, 10))
      if (out.length >= limit * 3) break
    }
    return out.slice(0, limit)
  }

  async meaning(q: string): Promise<MeaningHit[]> {
    if (!this.index || !this.o.embedder || !q.trim()) return []
    const [v] = await this.o.embedder.embed([q.trim()], 'query')
    return this.index.search(v!, this.o.meaning ?? MEANING)
  }
}
