/**
 * 找候选用的本机模型换成 bge-m3（2026-11-23 用户定，第一次用时下载）：主进程这一半。
 * 「按意思找」开着、bge-m3 还没下好时在后台下（model-fetch.ts：续传、sha256、主地址不行换备用），下好叫 onReady，
 * 搜索进程用它在后台重建索引，建完再换过去；在那以前查询和梦游照用 e5 的旧索引。
 * 状态合成一个 EmbedModelStatus 推给界面（设置 › 梦游的 EmbedModelRow）。
 * 测试模式（CN_E2E / E2E / CN_AI_FAKE）不联网：几秒走完一段假进度，然后让搜索进程拿 e5 换个名字（bge-m3-fake）当大模型；
 * CN_EMBED_REAL=1 时测试模式也真下（真跑测速用）。
 */
import type { EmbedModelStatus } from '../../shared/search'
import { BGE_BASES, BGE_FILES } from './bge'
import { fetchModel, type ModelFile, modelReady } from './model-fetch'
import type { BigModel, EmbedFromWorker } from './protocol'

export interface EmbedModelOptions {
  /** 下到哪（用户级缓存里的 models/bge-m3，CN_EMBED_DIR 能换） */
  dir: string
  fake: boolean
  semantic(): boolean
  onStatus(s: EmbedModelStatus): void
  /** 下好、校验过了：叫搜索进程用它重建索引 */
  onReady(big: BigModel): void
  /** 第一次要下时等多久再开始（别和刚打开软件时的载入抢网和 CPU）；假下载走多久 */
  delayMs?: number
  fakeMs?: number
  /** 单元测试换成本机 http 服务器上的小文件 */
  files?: ModelFile[]
  bases?: string[]
}

type Dl = { phase: 'idle' | 'waiting' | 'downloading' | 'verifying' | 'done' | 'error'; got: number; size: number; error?: string }

export class EmbedModel {
  private dl: Dl
  private worker: EmbedFromWorker = { model: null, big: 'none', done: 0, total: 0 }
  private ac: AbortController | null = null
  private timer: NodeJS.Timeout | null = null
  private files: ModelFile[]

  constructor(private o: EmbedModelOptions) {
    this.files = o.files ?? BGE_FILES
    const size = this.files.reduce((s, f) => s + f.size, 0)
    const ready = !o.fake && modelReady(o.dir, this.files)
    this.dl = { phase: ready ? 'done' : 'idle', got: ready ? size : 0, size }
  }

  /** 给搜索进程的大模型：下好了才有；「按意思找」关着时不给 */
  big(): BigModel | null {
    if (!this.o.semantic() || this.dl.phase !== 'done') return null
    return this.o.fake ? { dir: null, fake: true } : { dir: this.o.dir }
  }

  status(): EmbedModelStatus {
    const semantic = this.o.semantic()
    const base = { semantic, model: semantic ? this.worker.model : null, got: this.dl.got, size: this.dl.size, done: this.worker.done, total: this.worker.total, ...(this.o.fake ? { fake: true } : {}) }
    if (!semantic) return { ...base, phase: 'e5' }
    const w = this.worker
    if (w.big === 'ready') return { ...base, phase: 'ready' }
    if (w.big === 'indexing') return { ...base, phase: 'indexing' }
    if (w.big === 'error') return { ...base, phase: 'error', error: w.error ?? '' }
    if (this.dl.phase === 'downloading' || this.dl.phase === 'verifying') return { ...base, phase: this.dl.phase }
    if (this.dl.phase === 'error') return { ...base, phase: 'error', error: this.dl.error ?? '' }
    // 下好了、搜索进程还没开始建（刚叫它）
    if (this.dl.phase === 'done') return { ...base, phase: 'indexing', done: 0, total: 0 }
    return { ...base, phase: 'e5' }
  }

  private push() {
    this.o.onStatus(this.status())
  }

  /** 搜索进程报来的：现在用哪个模型、大模型的索引建到哪 */
  fromWorker(w: EmbedFromWorker) {
    this.worker = w
    this.push()
  }

  /** 「按意思找」开着就该下的开始下；关了就停（下了的那截留着，下次接着下） */
  sync() {
    if (!this.o.semantic()) {
      this.stop()
      this.push()
      return
    }
    if (this.dl.phase === 'idle') {
      this.dl = { ...this.dl, phase: 'waiting' }
      this.timer = setTimeout(() => void this.run(), this.o.delayMs ?? (this.o.fake ? 300 : 15_000))
    }
    this.push()
  }

  /** 出错后重试：已下的那截不丢 */
  retry() {
    if (this.dl.phase === 'error') this.dl = { ...this.dl, phase: 'idle', error: undefined }
    if (this.worker.big === 'error') this.worker = { ...this.worker, big: 'none', error: undefined }
    this.sync()
    // 下好了而是建索引出的错：再叫一次搜索进程
    const big = this.big()
    if (big && this.dl.phase === 'done') this.o.onReady(big)
  }

  stop() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.ac?.abort()
    this.ac = null
    if (this.dl.phase === 'waiting' || this.dl.phase === 'downloading' || this.dl.phase === 'verifying') this.dl = { ...this.dl, phase: 'idle' }
  }

  private async run() {
    this.timer = null
    const ac = new AbortController()
    this.ac = ac
    this.dl = { ...this.dl, phase: 'downloading' }
    this.push()
    try {
      if (this.o.fake) await this.fakeFetch(ac.signal)
      else
        await fetchModel({
          dir: this.o.dir,
          files: this.files,
          bases: this.o.bases ?? BGE_BASES,
          signal: ac.signal,
          onProgress: (p) => {
            const turned = p.phase !== this.dl.phase
            this.dl = { ...this.dl, phase: p.phase, got: p.got, size: p.total }
            if (turned) this.push()
            else this.pushSoon()
          },
        })
    } catch (e) {
      if (ac.signal.aborted) return
      this.ac = null
      this.dl = { ...this.dl, phase: 'error', error: String((e as Error).message ?? e) }
      this.push()
      return
    }
    if (ac.signal.aborted) return
    this.ac = null
    this.dl = { ...this.dl, phase: 'done', got: this.dl.size }
    this.push()
    const big = this.big()
    if (big) this.o.onReady(big)
  }

  /** 进度一秒最多推 5 次（下载的 data 事件很密） */
  private last = 0
  private pushSoon() {
    const now = Date.now()
    if (now - this.last < 200) return
    this.last = now
    this.push()
  }

  private async fakeFetch(signal: AbortSignal) {
    const ms = this.o.fakeMs ?? 3000
    const steps = 15
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, ms / steps))
      if (signal.aborted) throw new Error('停下了')
      this.dl = { ...this.dl, phase: i === steps ? 'verifying' : 'downloading', got: Math.round((this.dl.size * i) / steps) }
      this.push()
    }
  }
}
