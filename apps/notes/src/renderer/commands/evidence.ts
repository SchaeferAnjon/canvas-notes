/**
 * 「存成命令」对照区里亮出依据（task-9womr，小样 proto-c2.html「指一条规矩，左边亮出依据」）：
 * 编辑器扩展（依据那几行加 sc-ev，行号跟着亮；折起来的那一条写「里面有 N 处依据」），
 * 和几样只看文字的算法：并排里左右是同一行的算一处、折起来的是哪几段（照 @codemirror/merge 的折法）。
 */
import { Chunk, getChunks } from '@codemirror/merge'
import { type EditorState, RangeSet, RangeSetBuilder, StateEffect, StateField, Text } from '@codemirror/state'
import { type BlockInfo, Decoration, type DecorationSet, EditorView, gutter, GutterMarker, gutterLineClass, ViewPlugin, type WidgetType } from '@codemirror/view'
import { t } from '../../shared/i18n'

/** 这个编辑器里亮哪几行（从 1 起）；on：正指着一条规矩，别的行淡下去、折起的写里面有几处 */
export interface Spot {
  lines: readonly number[]
  on: boolean
}

export const setSpot = StateEffect.define<Spot>()

const spotField = StateField.define<Spot>({
  create: () => ({ lines: [], on: false }),
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setSpot)) v = e.value
    return v
  },
})

const sorted = (state: EditorState) => [...new Set(state.field(spotField).lines)].filter((n) => n >= 1 && n <= state.doc.lines).sort((a, b) => a - b)

const evLine = Decoration.line({ class: 'sc-ev' })
class EvMarker extends GutterMarker {
  elementClass = 'sc-ev'
}
const evMarker = new EvMarker()

/** 折起来的那一条：里面有几处依据（写在右端，外圈一道强调色） */
function markFolds(view: EditorView) {
  const { on } = view.state.field(spotField)
  const lines = sorted(view.state)
  for (const el of view.contentDOM.querySelectorAll<HTMLElement>('.cm-collapsedLines')) {
    let n = 0
    if (on && lines.length) {
      const blk = view.lineBlockAt(view.posAtDOM(el))
      const first = view.state.doc.lineAt(blk.from).number
      const last = view.state.doc.lineAt(blk.to).number
      n = lines.filter((l) => l >= first && l <= last).length
    }
    el.classList.toggle('sc-has-ev', n > 0)
    let tag = el.querySelector<HTMLElement>('.sc-evn')
    if (!n) tag?.remove()
    else {
      if (!tag) {
        tag = document.createElement('span')
        tag.className = 'sc-evn'
        el.append(tag)
      }
      tag.textContent = t('里面有 {n} 处依据', { n })
    }
  }
}

/** 对照区的编辑器都加上它：依据那几行（行号也跟着）加 sc-ev，折起来的那一条写里面有几处 */
export const evidence = [
  spotField,
  EditorView.decorations.compute([spotField], (state) => {
    const b = new RangeSetBuilder<Decoration>()
    for (const n of sorted(state)) b.add(state.doc.line(n).from, state.doc.line(n).from, evLine)
    return b.finish()
  }),
  gutterLineClass.compute([spotField], (state) => RangeSet.of(sorted(state).map((n) => evMarker.range(state.doc.line(n).from)))),
  // 折起来的那一条是编辑器自己画的（滚出去再滚回来会重画）：每次画完再写上
  ViewPlugin.fromClass(
    class {
      constructor(readonly view: EditorView) {
        this.mark()
      }
      update() {
        this.mark()
      }
      mark() {
        this.view.requestMeasure({ key: this, read: () => null, write: () => markFolds(this.view) })
      }
    },
  ),
]

/**
 * 对照里的空行收矮（小样的对照是一块挨一块，没有一整行高的空行）：空行加 sc-blank，行号不写；
 * 并排两边各自量高、对齐照旧（MergeView 按量出来的高补空白）
 */
const blankLine = Decoration.line({ class: 'sc-blank' })
class BlankMarker extends GutterMarker {
  elementClass = 'sc-blank'
}
const blankMarker = new BlankMarker()
const blanks = (state: EditorState) => {
  const out: number[] = []
  for (let n = 1; n <= state.doc.lines; n++) if (!state.doc.line(n).text.trim()) out.push(state.doc.line(n).from)
  return out
}
export const compact = [
  EditorView.decorations.compute(['doc'], (state) => Decoration.set(blanks(state).map((p) => blankLine.range(p)))),
  gutterLineClass.compute(['doc'], (state) => RangeSet.of(blanks(state).map((p) => blankMarker.range(p)))),
]

// ---------------------------------------------------------------- 对照照小样的样子（只在这张表里，历史里的对比标签不动）

const isFold = (w: WidgetType | null) => (w as { type?: string } | null)?.type === 'collapsed-unchanged-code'

/**
 * 整行都换掉的行不画字级的 28%（小样只给只改了几个字的行画）：这一行没改的字不到一半就加 sc-whole；
 * 左右各只有一行的那一块（标题改了几个字）按两行合起来算
 */
function wholeLines(state: EditorState): DecorationSet {
  const c = getChunks(state)
  if (!c || !c.side) return Decoration.none
  const isA = c.side === 'a'
  const b = new RangeSetBuilder<Decoration>()
  const mark = Decoration.line({ class: 'sc-whole' })
  for (const ch of c.chunks) {
    const [from, end, ofrom, oend] = isA ? [ch.fromA, ch.endA, ch.fromB, ch.endB] : [ch.fromB, ch.endB, ch.fromA, ch.endA]
    if (end <= from) continue
    const mine = ch.changes.map((x) => (isA ? [from + x.fromA, from + x.toA] : [from + x.fromB, from + x.toB]) as [number, number])
    const lines: { from: number; to: number; text: string }[] = []
    for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(end).number; n++) lines.push(state.doc.line(n))
    const changed = (a: number, z: number, rs: [number, number][]) => rs.reduce((s, [p, q]) => s + Math.max(0, Math.min(z, q) - Math.max(a, p)), 0)
    // 左右各一行：两行的字合起来，没改的不到一半才算整行换掉
    const otherLen = oend - ofrom
    const otherChanged = ch.changes.reduce((s, x) => s + (isA ? x.toB - x.fromB : x.toA - x.fromA), 0)
    const single = lines.length === 1 && otherLen > 0 && !ch.changes.some((x) => (isA ? x.toB - x.fromB : x.toA - x.fromA) > otherLen)
    for (const l of lines) {
      if (!l.text.trim()) continue
      const len = l.to - l.from
      const kept = single ? len - changed(l.from, l.to, mine) + (otherLen - otherChanged) : len - changed(l.from, l.to, mine)
      const all = single ? len + otherLen : len
      if (kept / all < 0.5) b.add(l.from, l.from, mark)
    }
  }
  return b.finish()
}

/** 一块里有几个看得到的单位（一行字、一张图、一张表）：照文档的先后编号 1、2、3…，空行不编号；折起来的照里面的行算，展开以后号不变 */
function unitsOf(view: EditorView): number[] {
  const out: number[] = []
  const doc = view.state.doc
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const blk = view.lineBlockAt(line.from)
    const fold = isFold(blk.widget)
    if (!fold && blk.from !== line.from) continue
    if (!line.text.trim() && (fold || !blk.widget)) continue
    out.push(line.from)
  }
  return out
}

class NumberMarker extends GutterMarker {
  constructor(readonly n: number) {
    super()
  }
  eq(o: NumberMarker) {
    return o.n === this.n
  }
  toDOM() {
    return document.createTextNode(String(this.n))
  }
}

const units = new WeakMap<EditorView, { doc: Text; list: number[] }>()
function numberAt(view: EditorView, pos: number): GutterMarker | null {
  let u = units.get(view)
  if (!u || u.doc !== view.state.doc) units.set(view, (u = { doc: view.state.doc, list: unitsOf(view) }))
  let lo = 0
  let hi = u.list.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (u.list[mid] === pos) return new NumberMarker(mid + 1)
    if (u.list[mid]! < pos) lo = mid + 1
    else hi = mid - 1
  }
  return null
}

/**
 * 图旁边写文件名（小样里写的是「截图 1.png」）；图、表格这种整块在改动里的红绿和竖条是对比标签共用的（diff/blocks.ts）
 */
function nameImages(view: EditorView) {
  for (const el of view.contentDOM.children) {
    if (!(el instanceof HTMLElement)) continue
    const img = el.classList.contains('cm-image') ? el.querySelector('img') : null
    if (img && !el.querySelector('.sc-imgname')) {
      const tag = document.createElement('span')
      tag.className = 'sc-imgname'
      const last = img.getAttribute('src')?.split(/[/?#]/).filter(Boolean).at(-1) ?? ''
      // 文件名是写在笔记里的地址：%xx 不成对时照原样写
      let name = last
      try {
        name = decodeURIComponent(last)
      } catch (e) {
        if (!(e instanceof URIError)) throw e
      }
      tag.textContent = name || img.alt
      el.append(tag)
    }
  }
}

/** 并排、改前、改后都加：整行换掉的不画字级底、图和表的整块上红绿、图旁写文件名、看得到的单位连续编号（编辑器自己的行号藏起来） */
export const tidyDiff = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = wholeLines(view.state)
        this.mark(view)
      }
      update(u: { view: EditorView; docChanged: boolean }) {
        if (u.docChanged) this.decorations = wholeLines(u.view.state)
        this.mark(u.view)
      }
      mark(view: EditorView) {
        view.requestMeasure({ key: this, read: () => null, write: () => nameImages(view) })
      }
    },
    { decorations: (v) => v.decorations },
  ),
  gutter({
    class: 'sc-ln',
    lineMarker: (view: EditorView, line: BlockInfo) => (isFold(line.widget) ? null : numberAt(view, line.from)),
    // 对齐用的空位（一个点上的块，没有字）和折起的那一条不编号
    widgetMarker: (view: EditorView, w: WidgetType, block: BlockInfo) => (isFold(w) || block.from === block.to ? null : numberAt(view, block.from)),
    lineMarkerChange: (u) => u.docChanged || u.heightChanged,
    initialSpacer: () => new NumberMarker(99),
  }),
]

// ---------------------------------------------------------------- 只看文字的算法

/** 并排里一处依据：只在左边（改前）的一行、只在右边（现在）的一行，或者左右是同一行（没改的那几行） */
export interface Place {
  a?: number
  b?: number
}

/** 没改的那几行：改前第几行对现在第几行 */
export function sameLines(before: string, after: string): Map<number, number> {
  const a = Text.of(before.split('\n'))
  const b = Text.of(after.split('\n'))
  const chunks = Chunk.build(a, b)
  const map = new Map<number, number>()
  let pa = 0
  let pb = 0
  for (let i = 0; i <= chunks.length; i++) {
    const ch = chunks[i]
    if (pa <= a.length && pb <= b.length) {
      const lastA = ch ? a.lineAt(ch.fromA).number - 1 : a.lines
      for (let la = a.lineAt(pa).number, lb = b.lineAt(pb).number; la <= lastA && lb <= b.lines; la++, lb++) map.set(la, lb)
    }
    if (!ch) break
    pa = ch.toA
    pb = ch.toB
  }
  return map
}

/** 并排里的几处：左右是同一行的算一处 */
export function placesOf(before: readonly number[], after: readonly number[], same: ReadonlyMap<number, number>): Place[] {
  const B = new Set(after)
  const paired = new Set<number>()
  const out: Place[] = []
  for (const a of new Set(before)) {
    const b = same.get(a)
    if (b !== undefined && B.has(b)) {
      paired.add(b)
      out.push({ a, b })
    } else out.push({ a })
  }
  for (const b of B) if (!paired.has(b)) out.push({ b })
  return out
}

/**
 * 折起来的几段（和 @codemirror/merge 的 collapseUnchanged 一样的算法：两段改动之间没改的行，挨着改动各留 margin 行，够 minSize 行才折）：
 * 每段从哪个位置起（展开时认它）、第几行到第几行。并排的左右两边算出来一样多、一一对应
 */
export function foldRanges(state: EditorState, margin: number, minSize: number): { from: number; first: number; last: number }[] {
  const c = getChunks(state)
  if (!c) return []
  const isA = c.side === 'a'
  const out: { from: number; first: number; last: number }[] = []
  let prev = 1
  for (let i = 0; ; i++) {
    const ch = i < c.chunks.length ? c.chunks[i]! : null
    const first = i ? prev + margin : 1
    const last = ch ? state.doc.lineAt(isA ? ch.fromA : ch.fromB).number - 1 - margin : state.doc.lines
    if (last - first + 1 >= minSize) out.push({ from: state.doc.line(first).from, first, last })
    if (!ch) break
    prev = state.doc.lineAt(Math.min(state.doc.length, isA ? ch.toA : ch.toB)).number
  }
  return out
}
