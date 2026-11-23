/**
 * 文档里的公式（task-o48fa，「这里需要支持 latex」）：哪段算公式由 @cn/format 的 findMath 认（白板卡片、AI 回答同一个认法），
 * 排版用 tex.ts（和 AI 回答同一份 KaTeX、同一套选项）。照「只文档白板不露源码」：
 * - 平时只看排好的公式：行内的 $…$、\(…\) 跟着字走；单独成行的 $$…$$、\[…\] 居中一整块，宽了自己横着滚，不撑宽版心；
 * - 光标走进去（→ 从左边、← 从右边、↑↓ 到那一行、点一下）露出这一个公式的写法来改，行内的下面浮一个排好的样子，
 *   单独成行的在写法下面接着排；光标走开又排好；
 * - 排好的公式是一整颗：退格（在它后面）、Delete（在它前面）先选中它，再按一次才删；挪行、删词这些键改不到它的半截
 *   （hidden-syntax 的看守）；选中复制带出原来的 $…$ 写法（复制的是文件里的字）；
 * - 写错的不排：原文照写，红色波浪线，悬停（和光标在里面时的浮层）说哪里错。
 * - 引文、提示块里单独成行的（剪藏进来的 `> $$ … > $$`，task-6cxtc）照样排成一整块，外面接着引文的竖线、提示块的底。
 * 只加装饰，不动文字，所以不影响「打开再保存文件不变」。
 */
import { findMath, type MathSpan } from '@cn/format'
import { EditorSelection, type EditorState, type Line, Prec, type Range, type SelectionRange, StateField, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, showTooltip, type Tooltip, WidgetType } from '@codemirror/view'
import { parseCallout } from './callout'
import { type Hidden, hiddenSyntax } from './hidden-syntax'
import { fadeEdges, renderTex } from './tex'

/** 人动过光标或打过字以后才露写法（打开文档时编辑器自己放的光标不算；live-preview 的记号也看它） */
export const touched = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => v || ['select', 'input', 'delete', 'move', 'undo', 'redo'].some((e) => tr.isUserEvent(e)),
})

const spanCache = new WeakMap<Text, MathSpan[]>()

/** 整篇的公式（文字一变才重找） */
export function mathSpans(state: EditorState): MathSpan[] {
  let s = spanCache.get(state.doc)
  if (!s) spanCache.set(state.doc, (s = findMath(state.doc.toString())))
  return s
}

/** 一个公式在文档里占的地方：单独成行的占整行（a 行首、b 行尾） */
export interface Placed {
  span: MathSpan
  a: number
  b: number
  block: boolean
  /** 光标在里面：露出写法 */
  open: boolean
  /** 选区整个盖住它 */
  selected: boolean
  html: string | null
  error: string | null
  /** 在引文里（「 q」：接着画竖线）、提示块里（「 c」：接着画块的底，「 c bot」是块的最后几行）；不在是 '' */
  inq: string
}

/** 引文里的公式在普通引文还是提示块里、是不是块的最后几行 */
function quoteCtx(doc: Text, span: MathSpan): string {
  if (!span.quote) return ''
  let first = doc.lineAt(span.from).number
  while (first > 1 && /^\s*>/.test(doc.line(first - 1).text)) first--
  const last = doc.lineAt(span.to).number
  const bot = last === doc.lines || !/^\s*>/.test(doc.line(last + 1).text)
  return parseCallout(doc.line(first).text) ? ` c${bot ? ' bot' : ''}` : ' q'
}

function inside(r: SelectionRange, p: { a: number; b: number; block: boolean }): boolean {
  if (r.empty) return p.block ? r.head >= p.a && r.head <= p.b : r.head > p.a && r.head < p.b
  return p.block ? r.from >= p.a && r.to <= p.b && !(r.from === p.a && r.to === p.b) : r.from > p.a && r.to < p.b
}

const placedCache = new WeakMap<EditorState, Placed[]>()

export function placedMath(state: EditorState): Placed[] {
  const hit = placedCache.get(state)
  if (hit) return hit
  const live = state.field(touched, false) ?? true
  const doc = state.doc
  const out = mathSpans(state).map((span) => {
    const block = span.block
    const a = block ? doc.lineAt(span.from).from : span.from
    const b = block ? doc.lineAt(span.to).to : span.to
    const p = { a, b, block }
    // 一行中间的 $$…$$、\[…\] 照行内的排（和 AI 回答、白板卡片一样），只有单独成行的按 displayMode
    const t = renderTex(span.tex, block)
    return {
      span,
      a,
      b,
      block,
      open: live && state.selection.ranges.some((r) => inside(r, p)),
      selected: state.selection.ranges.some((r) => !r.empty && r.from <= a && r.to >= b),
      html: t.html,
      error: t.error,
      inq: block ? quoteCtx(doc, span) : '',
    }
  })
  placedCache.set(state, out)
  return out
}

/** 排好的、光标不在里面的（画成一整颗的那些） */
const shut = (state: EditorState) => placedMath(state).filter((p) => !p.open && p.html !== null)

/** 点排好的公式：光标放进写法末尾（结尾记号前面；单独成行、结尾记号自己一行的，放在上一行末尾） */
function caretOf(state: EditorState, p: Placed): number {
  const end = p.span.to - p.span.close
  if (!p.block || end <= p.span.from + p.span.open) return end
  // 结尾记号自己一行（引文里的那一行前面只有「> 」）：放在上一行末尾
  const line = state.doc.lineAt(end)
  return line.from > p.span.from && end === line.from + (p.span.quote?.length ?? 0) ? line.from - 1 : end
}

class MathWidget extends WidgetType {
  constructor(
    readonly html: string,
    readonly tex: string,
    readonly block: boolean,
    readonly from: number,
    readonly selected: boolean,
    /** 单独成行的公式露着写法时，下面接着排的那一份（只看，点了光标到写法末尾） */
    readonly preview = false,
    /** 行内的紧挨着汉字：那一边留 1/8 字宽（「 gl」「 gr」，同 AI 回答的 md-render） */
    readonly gap = '',
    /** 引文、提示块里的（Placed.inq）：外面套一层接着画竖线、块的底 */
    readonly inq = '',
  ) {
    super()
  }
  eq(o: MathWidget) {
    return o.html === this.html && o.block === this.block && o.from === this.from && o.selected === this.selected && o.preview === this.preview && o.gap === this.gap && o.inq === this.inq
  }
  toDOM(view: EditorView) {
    const el: HTMLElement = document.createElement(this.block ? 'div' : 'span')
    el.className = (this.block ? 'cm-math-block' : 'cm-math') + (this.selected ? ' cm-math-sel' : '') + (this.preview ? ' cm-math-preview' : '') + this.gap
    el.setAttribute('role', 'math')
    el.setAttribute('aria-label', this.tex)
    el.innerHTML = this.html
    let dom = el
    if (this.inq) {
      // 宽了横着滚的是里面那层，竖线、块的底在外面这层不跟着滚
      dom = document.createElement('div')
      dom.className = 'cm-math-inquote' + this.inq
      dom.appendChild(el)
    }
    if (this.block) (dom as HTMLElement & { unfade?: () => void }).unfade = fadeEdges(el)
    el.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey) return
      e.preventDefault()
      const p = placedMath(view.state).find((x) => x.span.from === this.from)
      if (!p) return
      view.focus()
      view.dispatch({ selection: { anchor: caretOf(view.state, p) }, userEvent: 'select.pointer', scrollIntoView: true })
    })
    return dom
  }
  destroy(dom: HTMLElement) {
    ;(dom as HTMLElement & { unfade?: () => void }).unfade?.()
  }
  ignoreEvent() {
    return true
  }
}

/** 汉字、假名、谚文（中西文之间要留 1/8 字宽的那一边；标点不算） */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

const srcMark = Decoration.mark({ class: 'cm-math-src' })
const delimMark = Decoration.mark({ class: 'cm-math-delim' })

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  for (const p of placedMath(state)) {
    const { span } = p
    if (p.html !== null && !p.open) {
      const gap = p.block ? '' : `${CJK.test(doc.sliceString(p.a - 1, p.a)) ? ' gl' : ''}${CJK.test(doc.sliceString(p.b, p.b + 1)) ? ' gr' : ''}`
      out.push(Decoration.replace({ widget: new MathWidget(p.html, span.tex, p.block, span.from, p.selected, false, gap, p.inq), block: p.block }).range(p.a, p.b))
      continue
    }
    // 露着写法（光标在里面）或者写错了：原文照写
    if (p.block) {
      const first = doc.lineAt(p.a).number
      const last = doc.lineAt(p.b).number
      for (let n = first; n <= last; n++) {
        const cls = ['cm-math-line']
        if (n === first) cls.push('cm-math-top')
        if (n === last) cls.push('cm-math-bot')
        out.push(Decoration.line({ class: cls.join(' ') }).range(doc.line(n).from))
      }
    }
    if (p.error !== null) out.push(Decoration.mark({ class: 'cm-math-err', attributes: { title: p.error } }).range(span.from, span.to))
    if (p.open) {
      if (!p.block) out.push(srcMark.range(span.from, span.to))
      out.push(delimMark.range(span.from, span.from + span.open), delimMark.range(span.to - span.close, span.to))
      if (p.block && p.html !== null) out.push(Decoration.widget({ widget: new MathWidget(p.html, span.tex, true, span.from, false, true, '', p.inq), block: true, side: 1 }).range(p.b))
    }
  }
  return Decoration.set(out, true)
}

const decorations = StateField.define<DecorationSet>({
  create: build,
  update: (v, tr) => (tr.docChanged || tr.selection || tr.startState.field(touched) !== tr.state.field(touched) ? build(tr.state) : v),
  provide: (f) => EditorView.decorations.from(f),
})

/** 光标在行内公式里：下面浮一个排好的样子（写错了就说错在哪） */
function tipOf(state: EditorState): Tooltip | null {
  const sel = state.selection.main
  const p = placedMath(state).find((x) => x.open && !x.block && inside(sel, x))
  if (!p) return null
  return {
    pos: p.a,
    // 默认放在这一行上方（下一行多半是正要对照的那条，不盖住它），上面放不下才到下方
    above: true,
    strictSide: false,
    arrow: false,
    create: () => {
      const dom = document.createElement('div')
      dom.className = 'cm-math-tip' + (p.error !== null ? ' err' : '')
      if (p.html !== null) dom.innerHTML = p.html
      else dom.textContent = p.error
      return { dom }
    },
  }
}

const tip = StateField.define<Tooltip | null>({
  create: tipOf,
  update: (v, tr) => {
    if (!tr.docChanged && !tr.selection) return v
    const next = tipOf(tr.state)
    // 同一个公式、写法没变：留着原来的浮层（不重建，不闪）
    if (v && next && v.pos === next.pos && !tr.docChanged) return v
    return next
  },
  provide: (f) => showTooltip.from(f),
})

/**
 * 排好的公式交给 hidden-syntax 看守：用户的编辑改不到它的半截（整个选中了才删），光标停在两头。
 * 光标在里面（露着写法）的那一个不交：随便改。← → 不一下跨过去（step: false），交给下面的键走进写法
 */
const guard = hiddenSyntax.of((state) => {
  const out: Hidden[] = []
  const len = state.doc.length
  for (const p of shut(state)) {
    if (!p.block) {
      out.push({ from: p.a, to: p.b, fromOk: true, toOk: true, side: 'to', unit: { from: p.a, to: p.b }, step: false })
      continue
    }
    // 单独成行的：连上下的换行一起，和图片一样整块选中才删
    const from = p.a > 0 ? p.a - 1 : 0
    const to = p.b < len ? p.b + 1 : p.b
    out.push({ from, to, fromOk: from > 0, toOk: true, side: 'near', unit: { from: p.a, to: p.b }, step: false, ...(to < len ? {} : { pad: '\n\n' }) })
  }
  return out
})

function move(view: EditorView, pos: number): boolean {
  view.dispatch({ selection: EditorSelection.cursor(pos), userEvent: 'select', scrollIntoView: true })
  return true
}

function select(view: EditorView, p: Placed): boolean {
  view.dispatch({ selection: EditorSelection.range(p.a, p.b), userEvent: 'select', scrollIntoView: true })
  return true
}

/** 光标（没有选区）在 pos：挨着它的排好的公式 */
function cursorAt(view: EditorView): number | null {
  const sel = view.state.selection.main
  return sel.empty ? sel.head : null
}

/** → 在行内公式左边：进到写法里（第一个记号后面）；在上一行末尾、下一行是单独成行的公式：到那一行行首 */
export function enterRight(view: EditorView): boolean {
  const h = cursorAt(view)
  if (h === null) return false
  const line = view.state.doc.lineAt(h)
  const p = shut(view.state).find((x) => !x.block && x.a === h) ?? (h === line.to ? blockBeside(view.state, line, true) : undefined)
  return p ? move(view, p.block ? p.a : p.a + p.span.open) : false
}

/** ← 在行内公式右边：进到写法里（最后一个记号前面）；在下一行行首、上一行是单独成行的公式：到那一行末尾 */
export function enterLeft(view: EditorView): boolean {
  const h = cursorAt(view)
  if (h === null) return false
  const line = view.state.doc.lineAt(h)
  const p = shut(view.state).find((x) => !x.block && x.b === h) ?? (h === line.from ? blockBeside(view.state, line, false) : undefined)
  return p ? move(view, p.block ? p.b : p.b - p.span.close) : false
}

/**
 * 单独成行的公式紧挨着第 line 行下面（down）/ 上面，或者中间只隔一个空行（块缝：光标不停在那里，task-ys1rr，
 * 以前要先走到空行上、再按一下才进公式；现在从上一块末尾、下一块开头直接进去、选中它）
 */
function blockBeside(state: EditorState, line: Line, down: boolean): Placed | undefined {
  const doc = state.doc
  const at = (pos: number) => shut(state).find((x) => x.block && (down ? x.a === pos : x.b === pos))
  const direct = down ? at(line.to + 1) : at(line.from - 1)
  if (direct) return direct
  const n = line.number + (down ? 1 : -1)
  if (n < 1 || n > doc.lines || doc.line(n).text.trim() !== '') return undefined
  return down ? at(doc.line(n).to + 1) : at(doc.line(n).from - 1)
}

/** ↓ ↑ 要离开这一行、挨着的那一行是单独成行的公式：进到它的第一行行首 / 最后一行末尾 */
function enterVertical(down: boolean) {
  return (view: EditorView): boolean => {
    const h = cursorAt(view)
    if (h === null) return false
    const line = view.state.doc.lineAt(h)
    const p = blockBeside(view.state, line, down)
    if (!p) return false
    // 一行折成好几行显示时，先在这一行里上下走
    const next = view.moveVertically(EditorSelection.cursor(h), down)
    if (next.head >= line.from && next.head <= line.to && next.head !== h) return false
    return move(view, down ? p.a : p.b)
  }
}

/** 退格在排好的公式后面（单独成行的：在它下一行行首）：先选中它 */
export function backspaceMath(view: EditorView): boolean {
  const h = cursorAt(view)
  if (h === null || view.state.readOnly) return false
  const line = view.state.doc.lineAt(h)
  const p = shut(view.state).find((x) => !x.block && x.b === h) ?? (h === line.from ? blockBeside(view.state, line, false) : undefined)
  return p ? select(view, p) : false
}

/** Delete 在排好的公式前面（单独成行的：在它上一行末尾）：先选中它 */
export function deleteMath(view: EditorView): boolean {
  const h = cursorAt(view)
  if (h === null || view.state.readOnly) return false
  const line = view.state.doc.lineAt(h)
  const p = shut(view.state).find((x) => !x.block && x.a === h) ?? (h === line.to ? blockBeside(view.state, line, true) : undefined)
  return p ? select(view, p) : false
}

/** 比 wysiwyg 的 ←→（跨过藏着的记号）、hidden-syntax 的 stepOver 先轮到 */
export const mathKeys = Prec.highest(
  keymap.of([
    { key: 'ArrowRight', run: enterRight },
    { key: 'ArrowLeft', run: enterLeft },
    { key: 'ArrowDown', run: enterVertical(true) },
    { key: 'ArrowUp', run: enterVertical(false) },
    { key: 'Backspace', run: backspaceMath },
    { key: 'Delete', run: deleteMath },
    { mac: 'Ctrl-d', run: deleteMath },
  ]),
)

export const mathPreview = [touched, decorations, tip, guard, mathKeys]
