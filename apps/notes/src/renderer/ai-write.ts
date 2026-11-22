/**
 * 文档里 / 菜单的「AI 写一段」「AI 总结这页」边收边写（task-6kun1，照流光原型 A2「写一段」）：
 * AI 的字一到就接进编辑器，先藏着，照原型每 60 毫秒显 2 个字（落下的 1.5 秒内追上，ai-spot.ts）；左边竖线里光往下走，
 * 下面「AI 在写这一段 · 停下 esc」。
 * - 写完：字显完以后收成撤销记录里的一步（⌘Z 一下撤掉 AI 写的整段，和以前一次插进去一样），竖线实线 1.6 秒淡出。
 * - 停下（esc、那一颗的「停下」）：只留已经显出来的那些，没显的拿掉，「停下了：写到一半的这段留着」；留下的也是一步撤销。
 * - 写进文件的字和以前一样：写一段插在那一空行（行里有字另起一段），总结这页插在标题下面、后面空一行；头尾的空白去掉。
 * - 给了 head（task-dtc34）：AI 写的整段包在一个 `> [!ai] AI 写的 · 哪家 · 模型` 块里，边写边是带框的样子（每行前面接「> 」）。
 */
import type { EditorView } from '@codemirror/view'
import { endLocal, startLocal } from './ai-act-store'
import { canStream, type StreamIds, streamCommit, streamDone, streamPush, streamRange, streamShown, streamShownTo, streamStart, streamStop } from './ai-spot'
import { hiddenOk } from './hidden-syntax'
import { flashRange } from './insert-flash'

/** 第一批字到了：收起问 AI 写什么的小框，说插在哪（pos 前面接 before，AI 的字后面接 after）；小框已经收了（不写了）是 null */
export type BeginAt = () => { pos: number; before: string; after: string } | null

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 包进 [!ai] 块的正文：每个换行后面接「> 」（边收边写时前面写过的不变）；收尾时空行写成「>」（quoteDone） */
const quoteLive = (s: string) => s.replace(/\n/g, '\n> ')
const quoteDone = (s: string) => quoteLive(s).replace(/^> $/gm, '>')

export class AiStreamWrite {
  /** 已经开始往编辑器里写了（问的小框收起来了） */
  started = false
  /** 收到的 */
  private got = ''
  /** 已经写进编辑器的（去掉开头的空白；结尾的空白等后面有字再写） */
  private put = ''
  private at: StreamIds | null = null
  private parts = { before: '', after: '' }
  private stopping = false
  private finished = false

  constructor(
    private view: EditorView,
    private turn: number,
    private path: string,
    private begin: BeginAt,
    /** 包进 [!ai] 块：头一行「> [!ai] 」后面那一截（aiWroteHead） */
    private head?: string,
  ) {}

  /** 写进编辑器的样子：包块时每行接「> 」 */
  private shape(s: string): string {
    return this.head ? quoteLive(s) : s
  }

  /** 插在哪、前后接什么：包块时前面多一行头、一个「> 」 */
  private where(): ReturnType<BeginAt> {
    const w = this.begin()
    if (!w || !this.head) return w
    return { ...w, before: `${w.before}> [!ai] ${this.head}\n> ` }
  }

  /** 收到 AI 的一截字 */
  push(delta: string) {
    if (this.stopping || this.finished) return
    this.got += delta
    // 白板卡里就地改的小编辑器：不边收边写，写完一次插进去（done）
    if (!canStream(this.view.state)) return
    const want = this.shape(this.got.trimStart().replace(/\s+$/, ''))
    if (want.length <= this.put.length) return
    if (!this.at) this.open(want)
    else streamPush(this.view, this.at, want.slice(this.put.length))
    if (this.at) this.put = want
  }

  /** 按了停下（不是出错） */
  get stopped(): boolean {
    return this.stopping
  }

  private open(first: string) {
    const where = this.where()
    if (!where) {
      // 字来之前小框已经收了：AI 不用再写
      this.stopping = this.finished = true
      void window.cn.aiStop(this.turn)
      return
    }
    this.started = true
    const { pos, before, after } = where
    this.parts = { before, after }
    startLocal(this.turn, this.path, () => this.stop())
    this.at = streamStart(this.view, pos, { before, first, after }, this.turn)
  }

  /** AI 答完了（reply 是整段）：剩下的显完，再收成一步撤销 */
  async done(reply: string) {
    if (this.finished || this.stopping) return
    const final = this.shape(reply.trim())
    if (!canStream(this.view.state)) return this.once(this.head ? quoteDone(reply.trim()) : final)
    // 有的命令行不边生成边给：整段一次来
    if (!this.at) {
      if (!final) return
      this.push(reply.trim())
      if (!this.at) return
    }
    const at = this.at
    // 边收边写没收全（有的命令行最后一截只在整段里）：用户没动过这截时照最后那整段补上
    const r = streamRange(this.view.state, at.spot)
    if (r && final.length > this.put.length && final.startsWith(this.put) && this.view.state.doc.sliceString(r.from, r.to) === this.put) {
      streamPush(this.view, at, final.slice(this.put.length))
      this.put = final
    }
    streamDone(this.view, at)
    const t0 = Date.now()
    while (!streamShown(this.view.state, at.grow) && !this.stopping && Date.now() - t0 < 6000) await sleep(60)
    if (this.stopping || this.finished) return
    this.commit(null)
    endLocal(this.turn, false)
  }

  /** 不边收边写的编辑器：照以前，答完一次插进去、闪一下「刚插进来」，一步撤销 */
  private once(final: string) {
    if (!final) return
    const where = this.where()
    if (!where) return
    this.started = true
    this.finished = true
    const { pos, before, after } = where
    const from = pos + before.length
    this.view.dispatch({ changes: { from: pos, insert: before + final + after }, selection: { anchor: from + final.length }, userEvent: 'input.ai', annotations: hiddenOk.of(true), scrollIntoView: true })
    flashRange(this.view, { from, to: from + final.length })
  }

  /** 停下（esc、那一颗的「停下」、出错）：AI 不再写，只留已经显出来的那些 */
  stop() {
    if (this.finished || this.stopping) return
    this.stopping = true
    void window.cn.aiStop(this.turn)
    const at = this.at
    if (!at) {
      this.finished = true
      return
    }
    const r = streamRange(this.view.state, at.spot)
    const shownTo = streamShownTo(this.view.state, at.grow)
    const cut = !!r && shownTo !== null && shownTo < r.to
    streamStop(this.view, at, cut)
    this.commit(cut ? shownTo : null)
    endLocal(this.turn, true)
  }

  /** 收成一步撤销；keepTo：只留到这里（停下时没显的拿掉） */
  private commit(keepTo: number | null) {
    this.finished = true
    const at = this.at!
    const r = streamRange(this.view.state, at.spot)
    if (!r) return
    const doc = this.view.state.doc
    const cut = doc.sliceString(r.from, keepTo === null ? r.to : Math.max(r.from, Math.min(r.to, keepTo))).replace(/\s+$/, '')
    // 包块时空行写成「>」（边写时是「> 」，行尾不留空格）；停在半截时末尾多出来的「>」去掉
    const text = this.head ? cut.replace(/\n> (?=\n|$)/g, '\n>').replace(/(?:\n>)+$/, '') : cut
    // 前后接的那几个换行还在原处才一起收（用户删了就不管）
    const { before, after } = this.parts
    const b = before && doc.sliceString(r.from - before.length, r.from) === before ? before : ''
    const a = after && doc.sliceString(r.to, r.to + after.length) === after ? after : ''
    const range = { from: r.from - b.length, to: r.to + a.length }
    streamCommit(this.view, at, range, text ? b + text + a : '', { from: b.length, to: b.length + text.length })
  }
}
