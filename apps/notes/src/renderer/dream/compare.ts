/**
 * 梦游对照里编辑器那一层（task-m552v，demo proto.html 的 .cmpwrap）：
 * - 「只看改动」按段折（foldPlan / foldExt）：两次改动之间没改的，前后各留一段，中间三段以上折成「展开没改的 N 段」，点一下两边一起开。
 *   折叠条自己带着 key，点了按 key 找那一段（@codemirror/merge 自带的折叠条按 posAtDOM 找：文首的属性表这类块部件盖住折叠段开头时，
 *   折叠条映射回的位置和那段起点对不上，点了不展开，录屏里要连点三下的就是它）。
 * - 改的段下面一句人话（noteExt）：只改了图片地址、梦游加的可视化、补上的双链。
 * - 「收下后的样子」改的段左边一道强调色竖线、淡底（markExt）。
 * - 小地图、上一处 / 下一处、打开就滚到第一处并闪一下要的位置（changeSpots）。
 * - 合一时删掉的那几段用和对面同一套实时预览画（delExt），不露源码；整段新加、整段删掉的不再给字上更深的底（pureExt）。
 */
import { contentBlocks, resolveLink } from '@cn/format'
import { Chunk } from '@codemirror/merge'
import { EditorState, type Extension, Prec, type Range, StateEffect, StateField, Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { codiconEl } from '@cn/design'

/** 两版按行比出来的改动（和 MergeView 里用的是同一个算法） */
export function chunksOf(before: string, after: string): readonly Chunk[] {
  return Chunk.build(Text.of(before.split('\n')), Text.of(after.split('\n')))
}

export interface FoldRange {
  key: string
  from: number
  to: number
  /** 折起来的有几段 */
  n: number
}

/**
 * 「只看改动」折哪几段：改动之间没改的那一截，按块（段落、标题、列表、图、表格……）数，
 * 挨着改动的前后各留一段（文首、文末那一截不用留），中间够三段才折（demo foldPlan）。a、b 两边折的是同一段字，各自的位置
 */
export function foldPlan(before: string | null, after: string, chunks: readonly Chunk[]): { a: FoldRange[]; b: FoldRange[] } {
  const blocks = contentBlocks(after)
  const a: FoldRange[] = []
  const b: FoldRange[] = []
  const lenB = after.length
  let prevA = 0
  let prevB = 0
  for (let i = 0; i <= chunks.length; i++) {
    const c = chunks[i]
    const endB = c ? c.fromB : lenB
    const inside = blocks.filter((x) => x.from >= prevB && x.to <= endB && x.to > x.from - 1)
    const lead = prevB === 0 ? 0 : 1
    const tail = c ? 1 : 0
    const fold = inside.slice(lead, inside.length - tail)
    if (fold.length >= 3) {
      const from = fold[0]!.from
      const to = fold[fold.length - 1]!.to
      const key = `f${i}`
      b.push({ key, from, to, n: fold.length })
      if (before !== null) a.push({ key, from: prevA + (from - prevB), to: prevA + (to - prevB), n: fold.length })
    }
    if (!c) break
    prevA = Math.min(c.toA, before?.length ?? 0)
    prevB = Math.min(c.toB, lenB)
  }
  return { a, b }
}

/** 两边（并排的 a、b，或合一的那一个）一起开：点了哪一边的折叠条都按 key 开两边 */
export class FoldCtl {
  views: EditorView[] = []
  onChange: (() => void) | null = null
  unfold(key: string) {
    for (const v of this.views) v.dispatch({ effects: unfoldFx.of(key) })
    this.onChange?.()
  }
}

const unfoldFx = StateEffect.define<string>()

class FoldBar extends WidgetType {
  constructor(
    readonly r: FoldRange,
    readonly ctl: FoldCtl,
    /** 并排时只在左边写字，右边那半条空着（看起来是横过两栏的一条） */
    readonly text: boolean,
  ) {
    super()
  }
  eq(o: FoldBar) {
    return o.r.key === this.r.key && o.r.n === this.r.n && o.text === this.text
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'dv-fold' + (this.text ? '' : ' mute')
    el.dataset.k = this.r.key
    if (this.text) {
      el.setAttribute('role', 'button')
      el.append(codiconEl('unfold', 14), document.createTextNode(`展开没改的 ${this.r.n} 段`))
    } else el.setAttribute('aria-hidden', 'true')
    // 并排时两半是一颗按钮：哪一半都能点，指着哪一半两半一起亮
    const both = (on: boolean) => {
      for (const x of el.closest('.dt-diff')?.querySelectorAll<HTMLElement>(`.dv-fold[data-k="${this.r.key}"]`) ?? [el]) x.classList.toggle('hot', on)
    }
    el.addEventListener('mouseenter', () => both(true))
    el.addEventListener('mouseleave', () => both(false))
    // 按下就开（mousedown 先拦下，编辑器不拿焦点、不动选区）
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      this.ctl.unfold(this.r.key)
    })
    return el
  }
  ignoreEvent() {
    return true
  }
  get estimatedHeight() {
    return 30
  }
}

/** 折起来的那几段：优先级最高，盖住里面的属性表、图片这些块部件，折叠条的位置就是那一段的起点 */
export function foldExt(ranges: FoldRange[], ctl: FoldCtl, text: boolean): Extension {
  const build = (keep: FoldRange[]) => Decoration.set(keep.map((r) => Decoration.replace({ widget: new FoldBar(r, ctl, text), block: true }).range(r.from, r.to)))
  const field = StateField.define<{ keep: FoldRange[]; deco: DecorationSet }>({
    create: () => ({ keep: ranges, deco: build(ranges) }),
    update(v, tr) {
      let keep = v.keep
      for (const e of tr.effects) if (e.is(unfoldFx)) keep = keep.filter((r) => r.key !== e.value)
      return keep === v.keep ? v : { keep, deco: build(keep) }
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  return Prec.highest(field)
}

class NoteWidget extends WidgetType {
  constructor(readonly text: string) {
    super()
  }
  eq(o: NoteWidget) {
    return o.text === this.text
  }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'dv-cnote'
    el.textContent = this.text
    return el
  }
  ignoreEvent() {
    return true
  }
}

/** 改的段下面一句人话：pos 是那一段最后一行行尾 */
export function noteExt(notes: { pos: number; text: string }[]): Extension {
  return EditorView.decorations.of(Decoration.set(notes.map((n) => Decoration.widget({ widget: new NoteWidget(n.text), block: true, side: 1 }).range(n.pos)), true))
}

/** 「收下后的样子」：改的那几行左边一道强调色竖线、淡底；整块画成部件的（图、表格、嵌着的可视化）也一样 */
export function markExt(ranges: { from: number; to: number }[]): Extension {
  const lines = (doc: Text): Range<Decoration>[] => {
    const out: Range<Decoration>[] = []
    for (const r of ranges) {
      const last = doc.lineAt(Math.max(r.from, Math.min(r.to, doc.length))).number
      for (let n = doc.lineAt(r.from).number; n <= last; n++) out.push(Decoration.line({ class: 'dv-mark' }).range(doc.line(n).from))
    }
    return out
  }
  const blocks = ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.mark(view)
      }
      update(u: ViewUpdate) {
        this.mark(u.view)
      }
      mark(view: EditorView) {
        view.requestMeasure({
          key: this,
          read: () => null,
          write: () => {
            for (const el of view.contentDOM.children) {
              if (!(el instanceof HTMLElement) || el.classList.contains('cm-line')) continue
              const b = view.lineBlockAt(view.posAtDOM(el))
              el.classList.toggle('dv-mark', ranges.some((r) => r.from < b.to + 1 && r.to > b.from))
            }
          },
        })
      }
    },
  )
  return [EditorView.decorations.of((v) => Decoration.set(lines(v.state.doc), true)), blocks]
}

/**
 * 改的段下面那句人话（demo 的 .cnote）：
 * - 只改了图片地址、图还是同一张：「只改了图片地址：../附件/… → ../../附件/…，图没变」；
 * - 梦游嵌进来的可视化：「梦游加的：第2页那段末尾嵌进可视化（收下后在笔记里就是这一块，能直接拖）」；
 * - 补上的双链：「补上的双链：只在这篇末尾加一行，「极光预报」那篇不改」。
 */
export function chunkNotes(o: { before: string | null; after: string; chunks: readonly Chunk[]; fromPath: string; toPath: string; group: string; say: string; linkTo?: string }): { pos: number; text: string }[] {
  const out: { pos: number; text: string }[] = []
  const img = /^\s*!\[([^\]\n]*)\]\(([^)\s]+)\)\s*$/
  const shortUrl = (u: string) => {
    const parts = u.split('/')
    const keep = parts.findIndex((p) => p !== '..')
    return parts.length > keep + 3 ? parts.slice(0, keep + 2).join('/') + '/…' : u
  }
  for (const c of o.chunks) {
    const b = o.after.slice(c.fromB, Math.min(c.toB, o.after.length)).replace(/\n$/, '')
    const a = o.before === null ? '' : o.before.slice(c.fromA, Math.min(c.toA, o.before.length)).replace(/\n$/, '')
    if (c.fromB === c.toB) continue
    let text: string | null = null
    if (o.group === 'viz' && /!\[可视化 · /.test(b)) text = `梦游加的：${o.say}（收下后在笔记里就是这一块，能直接拖）`
    else if (o.group === 'link' && /相关：\[\[/.test(b)) text = `补上的双链：只在这篇末尾加一行，${o.linkTo ? `「${o.linkTo}」那篇不改` : '那篇不改'}`
    else {
      const la = a.split('\n').filter((l) => l.trim())
      const lb = b.split('\n').filter((l) => l.trim())
      if (la.length && la.length === lb.length && la.every((l, k) => img.test(l) && img.test(lb[k]!))) {
        const same = la.every((l, k) => {
          const x = img.exec(l)!
          const y = img.exec(lb[k]!)!
          return x[1] === y[1] && x[2] !== y[2] && resolveLink(o.fromPath, x[2]!) === resolveLink(o.toPath, y[2]!)
        })
        if (same) {
          const x = img.exec(la[0]!)!
          const y = img.exec(lb[0]!)!
          text = `只改了图片地址：${shortUrl(x[2]!)} → ${shortUrl(y[2]!)}，图没变`
        }
      }
    }
    // 挂在这一处最后一行的行尾（toB 是最后一行后面那个位置）
    if (text) out.push({ pos: Math.min(c.toB - 1, o.after.length), text })
  }
  return out
}

const pureLine = Decoration.line({ class: 'dv-pure' })

/** 整段新加（b 边）、整段删掉（a 边）的那几行：只铺段底，不再给字上更深的底（demo：整段新加只有 10% 段底，28% 只给段里改了的字） */
export function pureExt(chunks: readonly Chunk[], side: 'a' | 'b'): Extension {
  return EditorView.decorations.of((v) => {
    const doc = v.state.doc
    const out: Range<Decoration>[] = []
    for (const c of chunks) {
      const pure = side === 'b' ? c.fromA === c.toA : c.fromB === c.toB
      const from = side === 'b' ? c.fromB : c.fromA
      const to = side === 'b' ? c.toB : c.toA
      if (!pure || to <= from) continue
      const last = doc.lineAt(Math.min(to - 1, doc.length)).number
      for (let n = doc.lineAt(Math.min(from, doc.length)).number; n <= last; n++) out.push(pureLine.range(doc.line(n).from))
    }
    return Decoration.set(out, true)
  })
}

/** 合一里删掉的那几段里面的编辑器：块拿掉时一起拆 */
const nested = new WeakMap<HTMLElement, () => void>()

class DelWidget extends WidgetType {
  constructor(
    readonly text: string,
    /** 段里删掉的字（相对这几段开头）；整段删的是空的 */
    readonly marks: readonly { from: number; to: number }[],
    readonly ext: Extension,
    readonly key: string,
  ) {
    super()
  }
  eq(o: DelWidget) {
    return o.key === this.key && o.text === this.text
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'dv-del'
    const marks = Decoration.set(
      this.marks.filter((m) => m.to > m.from).map((m) => Decoration.mark({ class: 'cm-deletedText' }).range(m.from, m.to)),
      true,
    )
    const inner = new EditorView({ parent: wrap, state: EditorState.create({ doc: this.text, extensions: [this.ext, EditorView.decorations.of(marks)] }) })
    // 里面的图、表格画好了会变高：外面跟着重新量
    const ro = new ResizeObserver(() => view.requestMeasure())
    ro.observe(wrap)
    nested.set(wrap, () => (ro.disconnect(), inner.destroy()))
    return wrap
  }
  destroy(dom: HTMLElement) {
    nested.get(dom)?.()
    nested.delete(dom)
  }
  ignoreEvent() {
    return true
  }
  get estimatedHeight() {
    return 25 * (this.text.split('\n').length || 1)
  }
}

/**
 * 合一时删掉的那几段（demo 合一）：@codemirror/merge 自己画删掉的行是源码（「# 极光」「![封面](…)」），这里换成一个只读的小编辑器，
 * 用和对面同一套实时预览画（标题是标题、图是图），红底、左边竖条；改了的段里删掉的字更深，整段删的不标字。ext 是改前那篇的文档样子
 */
export function delExt(chunks: readonly Chunk[], before: string, docLength: number, ext: Extension): Extension {
  const decos: Range<Decoration>[] = []
  chunks.forEach((c, i) => {
    if (c.toA <= c.fromA) return
    const text = before.slice(c.fromA, Math.min(c.toA, before.length)).replace(/\n$/, '')
    const marks = c.fromB === c.toB ? [] : c.changes.map((ch) => ({ from: Math.min(ch.fromA, text.length), to: Math.min(ch.toA, text.length) }))
    decos.push(Decoration.widget({ widget: new DelWidget(text, marks, ext, `d${i}:${c.fromA}`), block: true, side: -1 }).range(Math.min(c.fromB, docLength)))
  })
  return EditorView.decorations.of(Decoration.set(decos, true))
}

/** 一处改动在滚动的那一块里的上下（像素，相对滚动内容的顶）和是加的、删的还是改的 */
export interface Spot {
  top: number
  bottom: number
  kind: 'add' | 'del' | 'mod'
}

/**
 * 每处改动在滚动的那一块里在哪（小地图、上一处 / 下一处、打开就滚到第一处用）：按编辑器的高度表算，没画出来的行也有位置。
 * a、b 是并排的两边；只删了的那处画在左边（a）的位置，别的在右边（b）
 */
export function changeSpots(scroller: HTMLElement, chunks: readonly Chunk[], b: EditorView | null, a: EditorView | null): Spot[] {
  const base = scroller.getBoundingClientRect().top - scroller.scrollTop
  const at = (v: EditorView, from: number, to: number) => {
    const doc = v.state.doc
    // 这一处两头的空行（段和段之间那一个）不算：闪的外圈、小地图的色块和绿底一样高
    let first = doc.lineAt(Math.min(from, doc.length)).number
    let last = doc.lineAt(Math.max(from, Math.min(to, doc.length))).number
    while (first < last && !doc.line(first).text.trim()) first++
    while (last > first && !doc.line(last).text.trim()) last--
    const top = v.lineBlockAt(doc.line(first).from).top + v.documentTop - base
    const end = v.lineBlockAt(doc.line(last).from).bottom + v.documentTop - base
    return { top, bottom: Math.max(end, top + 4) }
  }
  const out: Spot[] = []
  for (const c of chunks) {
    const kind = c.fromA === c.toA ? 'add' : c.fromB === c.toB ? 'del' : 'mod'
    if (kind === 'del' && a) out.push({ ...at(a, c.fromA, c.toA - 1), kind })
    else if (b) out.push({ ...at(b, c.fromB, Math.max(c.fromB, c.toB - 1)), kind })
  }
  return out
}
