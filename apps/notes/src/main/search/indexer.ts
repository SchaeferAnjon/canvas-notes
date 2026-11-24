/**
 * 搜索进程里的索引：
 * 1. 先把库里每份 PDF 的字读出来（有缓存直接用），放在内存里给「文字」那一层搜；
 * 2. 再在后台给 md 和 PDF 一段一段算向量（意思相近那一层），一批 16 段，批和批之间让出去，查询随时插得进来；
 * 3. 隔一阵写一次盘，下次打开只算新的和改了的。
 * 不依赖 Electron：单元测试用假模型直接跑。
 */
import { mkdirSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { decodeNote, type PdfBlock } from '@cn/format'
import { type MeaningHit, type PdfTextHit, queryWords, type RelatedNote, type SearchStatus } from '../../shared/search'
import { pdfHash, type PdfTextCache, readTextCache, textCachePath } from '../pdf-text-cache'
import { type Chunk, mdChunks, pdfChunks, pdfTextHits } from './chunks'
import type { Embedder } from './embedder'
import type { Scorer } from './matmul'
import { VectorIndex } from './vector-index'
import { atomicWriteSync } from '@cn/atomic'

/** md 切段的版本，切法一变就加一（2：摘要去掉 ```base 等数据库块，第 4 轮美学） */
const MD_CHUNKS_V = ':c2'

const SKIP_DIRS = new Set(['.git', 'node_modules', '.trash', '.obsidian'])
const BATCH = 16
/** 算了多少段写一次盘 */
const SAVE_EVERY = 400
/**
 * 意思相近出哪几条（2026-11-21 收紧，task-j0249）。这个模型对什么都给 0.8 上下，看绝对分数分不开沾边和不沾边
 * （「没有这个qq」最像的是 0.872，「买菜」配购物清单是 0.857），所以每一条都要过三道：
 * - over：比这句话和几句空泛的套话（FILLER）平均像出 0.05 以上（套话分数就是「什么都不说」的底）；
 * - spread：比库里各篇的中位数高出 0.035 以上（库不到 20 篇不看这道）。乱词多的大库，套话那道会被凑上（垫 500 篇乱词笔记时
 *   「天气预报」比套话高 0.055，因为乱词里有「极光预报」），各篇都跟着高，中位数这道拦得住；
 * - near：不比第一名低出 0.03 以上；最多 limit 5 条（以前 30 条，不沾边的也能列满一屏）。
 * 过了的都「有把握」（sure），可以当 ⌘K 回车的默认；没过的一条不列，宁可少出也不出不沾边的。
 *
 * 量的数（e2e/fixtures/meaning-vault.ts：30 篇中英混的课程、书摘、视频字幕、剪藏、白板、周报加 2 份英文 PDF，40 篇「随便写点」垫底；
 * 列的是最像那篇减套话）：
 * - 不沾边 23 个都在 0.046 以下：没有这个qq 0.045、特斯拉股价 0.043、天气预报 0.040、量子力学 0.030、区块链 0.029、笔记 0.029、
 *   钢琴调音 0.025、老布什abc 0.022、张三 0.021、马斯克 0.020、今天 0.017、李白 0.016、高考志愿 0.013、好 0.008、巴黎 0.007、
 *   世界杯 0.002、Taylor Swift 0.000、test −0.006、嗯 −0.015、hello −0.046。旧门槛下 23 个里 13 个列出 1 到 30 条（垫 500 篇乱词笔记时 15 个，多数列满 30 条），新门槛 0 个。
 * - 沾边 30 个里 26 个出了最该出的那篇（或文字搜索已经找到）：sleep and learning 0.109、先验和后验概率 0.105、五花肉怎么炖 0.105、
 *   javascript 事件循环 0.097、周末去哪玩 0.094、发版清单 0.091、睡前喝咖啡 0.087、基金怎么投 0.086、矩阵怎么变换 0.084、
 *   朱高煦造反 0.080、减肥锻炼 0.077、linear transformation 0.075、支付功能进度 0.073、日本旅游攻略 0.070、特征向量是什么 0.068、
 *   注意力机制 0.065、宠物打针 0.064、人为什么能合作 0.061、撤销提交 0.059、贝叶思 0.055、怎么养成好习惯 0.052、红绕肉 0.050；
 *   每个词出 0 到 5 条，平均 1 条。
 * - 漏掉 4 个（MISSED）：特征直 0.043、看极光（最像的是 readme，0.029）、how to write an essay（最像线性代数讲义 0.049）、
 *   borrow checker（0.023）。还有「买菜」配购物清单 0.035，也不出。这些靠 ⌥↵ 让 Claude 找。
 * 重新量：CN_MEASURE=1 npx vitest run apps/notes/test/search-model.test.ts -t 量门槛
 */
export const MEANING = { limit: 5, near: 0.03, over: 0.05, spread: 0.035 }
export const FILLER = ['正文。', '这是一段笔记。', 'hello']

export interface IndexerOptions {
  root: string
  /** 软件设置目录（PDF 全文缓存在它的 reading/text/ 里） */
  userData: string
  /** 这个库的意思索引放哪 */
  indexDir: string
  /** 没有模型时是 null：只有文字那一层 */
  embedder: Embedder | null
  readPdf(abs: string): Promise<{ data: Uint8Array; pages: PdfBlock[][]; sizes: [number, number][] }>
  /** 多像才算（默认 MEANING；单元测试的假模型分数和真模型不在一个范围，给宽的） */
  meaning?: typeof MEANING
  onStatus(s: SearchStatus): void
  /** related 算一大块点乘用的（搜索进程给 onnxruntime 的，单元测试不给就用 JS 的） */
  scorer?: Scorer
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
  /** 先不算向量（换大模型时：大模型在建自己那份，这份只管查询和 PDF 里的字，不和它抢） */
  private held = false

  constructor(private o: IndexerOptions) {
    this.index = o.embedder ? VectorIndex.load(o.indexDir, o.embedder.model, o.embedder.dims) : null
    this.status = { phase: o.embedder ? 'text' : 'off', done: 0, total: 0, files: this.index?.size ?? 0 }
  }

  get state(): SearchStatus {
    return this.status
  }

  /** 意思索引用的模型名；没有模型是 null */
  get model(): string | null {
    return this.o.embedder?.model ?? null
  }

  /** 整个库用这个模型建完过一遍（换模型时看它决定什么时候换过去） */
  get built(): boolean {
    return this.index?.built ?? false
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

  /** 停下算向量：正在算的这一批算完就停（算好的存盘），以后扫库只读 PDF 的字。查询照常用已有的索引 */
  holdEmbed() {
    this.held = true
  }

  /** 接着算（大模型载不了、建不成时） */
  resumeEmbed() {
    if (!this.held) return
    this.held = false
    void this.scan()
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
        const isMd = low.endsWith('.md')
        // md 的签名带上切段的版本：切法变了（如摘要不再露数据库块），没改过的笔记也重算一次
        const f = { path: relative(this.o.root, abs).split(sep).join('/'), sig: `${st.mtimeMs}:${st.size}${isMd ? MD_CHUNKS_V : ''}` }
        ;(isMd ? md : pdf).push(f)
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
    if (this.held) {
      this.set({ phase: this.index.built ? 'ready' : 'embed', done: 0, total: 0, files: this.index.size })
      return
    }

    // ---- 意思索引 ----
    const index = this.index
    const all = [...md, ...pdf]
    const keep = new Set(all.map((f) => f.path))
    for (const p of index.paths()) if (!keep.has(p)) index.remove(p)
    const stale = all.filter((f) => !index.fresh(f.path, f.sig))
    if (!stale.length) {
      if (!index.built) {
        index.built = true
        index.save(this.o.indexDir)
      }
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
        if (this.held) {
          index.save(this.o.indexDir)
          this.set({ phase: index.built ? 'ready' : 'embed', done: 0, total: 0, files: index.size })
          return
        }
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
    index.built = true
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
    const hash = pdfHash(data)
    const cachePath = textCachePath(this.o.userData, hash)
    const c = readTextCache(this.o.userData, hash)
    if (c?.sizes) return { pages: c.pages, sizes: c.sizes }
    const r = await this.o.readPdf(abs)
    mkdirSync(dirname(cachePath), { recursive: true })
    atomicWriteSync(cachePath, JSON.stringify({ pdf: path, pages: r.pages, sizes: r.sizes } satisfies PdfTextCache))
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

  private filler: Float32Array[] | null = null

  /**
   * 梦游补双链找候选：每篇在全库里最像的 k 篇（不含自己），按两篇最像的那一对段落的余弦排，带回那一对段落的原文。
   * 不在索引里的篇是空数组。一篇算完让出去一下，查询插得进来
   */
  async related(paths: string[], k: number): Promise<Map<string, RelatedNote[]>> {
    const out = new Map<string, RelatedNote[]>()
    if (!this.index) return out
    const texts = new Map<string, Promise<string[]>>()
    const textOf = (p: string) => {
      let t = texts.get(p)
      if (!t) texts.set(p, (t = this.chunkTexts(p)))
      return t
    }
    for (const path of paths) {
      if (this.closed) break
      const hits = await this.index.related(path, k, this.o.scorer)
      const mine = await textOf(path)
      out.set(
        path,
        await Promise.all(hits.map(async (h) => ({ path: h.path, score: h.score, mine: mine[h.i] ?? '', theirs: (await textOf(h.path))[h.j] ?? '' }))),
      )
      await tick()
    }
    return out
  }

  /** 几句话各自在全库最像的 k 段（梦游 Wiki 化），带回那一段的原文（和建索引同一个切法、去掉标题） */
  async passages(qs: string[], k: number): Promise<{ path: string; score: number; text: string }[][]> {
    if (!this.index || !this.o.embedder || !qs.length) return qs.map(() => [])
    const d = this.index.dims
    const all = new Float32Array(qs.length * d)
    for (let i = 0; i < qs.length; i += 16) {
      const vs = await this.o.embedder.embed(qs.slice(i, i + 16).map((q) => q.trim() || '。'), 'query')
      vs.forEach((v, j) => all.set(v, (i + j) * d))
      await tick()
    }
    const top = await this.index.topChunks(all, qs.length, k, this.o.scorer)
    const texts = new Map<string, Promise<string[]>>()
    const textOf = (p: string) => texts.get(p) ?? texts.set(p, this.chunkTexts(p)).get(p)!
    return Promise.all(top.map((hits) => Promise.all(hits.filter((h) => h.path.toLowerCase().endsWith('.md')).map(async (h) => ({ path: h.path, score: h.score, text: (await textOf(h.path))[h.j] ?? '' })))))
  }

  /** 一篇的各段原文（和建索引时同一个切法，去掉每段前面的标题）；读不到的是空 */
  private async chunkTexts(path: string): Promise<string[]> {
    const pdf = path.toLowerCase().endsWith('.pdf')
    const chunks = pdf ? pdfChunks(path, this.pdfs.get(path)?.pages ?? []) : await this.mdChunksOf(path)
    if (!chunks) return []
    return chunks.map((c) => {
      const nl = c.text.indexOf('\n')
      return nl === -1 ? c.text : c.text.slice(nl + 1)
    })
  }

  async meaning(q: string): Promise<MeaningHit[]> {
    if (!this.index || !this.o.embedder || !q.trim()) return []
    const e = this.o.embedder
    const [v] = await e.embed([q.trim()], 'query')
    const dot = (a: Float32Array, b: Float32Array) => {
      let s = 0
      for (let k = 0; k < a.length; k++) s += a[k]! * b[k]!
      return s
    }
    const o = this.o.meaning ?? e.gate ?? MEANING
    this.filler ??= await e.embed(FILLER, 'passage')
    const filler = this.filler.reduce((s, f) => s + dot(v!, f), 0) / this.filler.length
    // 索引还没建完（「先找建好的」）：真正最像的那篇可能还没算进来，「比最像的低不过 near」就没了依据，
    // 本机小模型给不沾边的段也有 0.84 上下，过得了 min（2000 篇只写「随便写点。」的库，搜「线性代数复习」列出 30 篇）。
    // 这时拿「正文就是这句话的一段」和查询的分数当最像的来卡，建完再照常
    const anchor = this.status.phase !== 'ready' ? dot(v!, (await e.embed([q.trim()], 'passage'))[0]!) : undefined
    const hits = this.index.search(v!, { limit: o.limit, near: o.near, min: filler + o.over, spread: o.spread, ...(anchor === undefined ? {} : { anchor }) })
    return hits.map((h) => ({ ...h, sure: true }))
  }
}
