/**
 * 画成卡片的整块（图片、视频卡、时刻块、问答块、数据库、嵌入的白板和笔记、表格）：
 * - 在它下面紧挨的一行行首按退格、上面紧挨的一行行尾按 Delete（Ctrl+D 一样），先选中这一块，
 *   再按一次才删（CN-86；task-6lsvd 补上 Delete），连同它占的那几行删掉，上下只留一个空行；⌘Z 一次回来；
 *   单独成行的公式（math-preview.ts 自己选中）选中以后也走这里删；
 * - 选区正好是一整块时，在它上面盖一层强调色 24%（和单独成行的公式、正文选区一个颜色），大小、圆角跟这张卡自己
 *   （块自己是替换掉原文的部件，选区高亮画不到它；task-6lsvd 以前是画在卡后面的 --acc-soft，卡有不透明底，几乎看不出）；
 *   按键那一行（块下面、上面的空行）选中时照旧一整行高（block-gaps.ts 认 heldLine），下面的字不跳；
 * - 能改字的块（代码块、提示块、AI 讲解、旁支）：下面一行行首退格、上面一行行尾 Delete 不删它的记号，光标走进块里
 *   （退格到最后一行末尾，Delete 到第一行的字前面），和 ← → 走进去一样。
 * 哪些算「整块」：各自的装饰通过 EditorView.atomicRanges 交上来的块部件（spec.block）。
 */
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, type EditorState, type Line, Prec, StateField, type Text } from '@codemirror/state'
import { EditorView, keymap, layer, type LayerMarker } from '@codemirror/view'
import { parseCallout } from './callout'
import { offGap } from './gap-lines'
import { hiddenOk, hiddenRanges } from './hidden-syntax'

/** 正好在 pos 结束（end）或开始（start）的整块 */
function blockAt(view: EditorView, pos: number, edge: 'end' | 'start'): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null
  for (const f of view.state.facet(EditorView.atomicRanges)) {
    f(view).between(Math.max(0, pos - 1), Math.min(view.state.doc.length, pos + 1), (from, to, d) => {
      // 画成部件的整块（展开着的折叠块藏起来的 </details> 也是 block，但没有部件，不算）；
      // 白板文档看法里的列名（layout-lines.ts，spec.fixed）是白板的结构，退格不选中它、不删它
      if ((edge === 'end' ? to : from) === pos && d.spec.block && d.spec.widget && !d.spec.fixed) hit = { from, to }
    })
    if (hit) return hit
  }
  return null
}

/** 正好在 pos 结束的整块 */
export const blockEndingAt = (view: EditorView, pos: number) => blockAt(view, pos, 'end')

/** 选区正好盖住的一整块 */
function selectedBlock(view: EditorView, state: EditorState): { from: number; to: number } | null {
  const sel = state.selection.main
  if (sel.empty) return null
  const b = blockEndingAt(view, sel.to)
  return b && b.from === sel.from ? b : null
}

function select(view: EditorView, b: { from: number; to: number }): boolean {
  view.dispatch({ selection: EditorSelection.range(b.from, b.to), userEvent: 'select', scrollIntoView: true })
  return true
}

/** 在块的末尾、或块下面一行的行首按退格：先选中这一块 */
export function backspaceSelectsBlock(view: EditorView): boolean {
  const sel = view.state.selection.main
  if (!sel.empty || view.state.readOnly) return false
  const line = view.state.doc.lineAt(sel.head)
  // 光标在块下面一行的行首；中间隔着一个空行也算（空行和块连着护住，hidden-syntax.ts 的 wholeBlock，退格删不掉它）
  const up = line.number > 1 ? view.state.doc.line(line.number - 1) : null
  const b =
    blockEndingAt(view, sel.head) ??
    (sel.head === line.from && up ? (blockEndingAt(view, line.from - 1) ?? (up.text.trim() === '' && up.number > 1 ? blockAt(view, up.from - 1, 'end') : null)) : null)
  return b ? select(view, b) : false
}

/** 在块的开头、或块上面一行的行尾按 Delete：先选中这一块（和退格对称，中间隔着一个空行也算） */
export function deleteSelectsBlock(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  const down = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null
  const b =
    blockAt(view, sel.head, 'start') ??
    (sel.head === line.to && down ? (blockAt(view, down.from, 'start') ?? (down.text.trim() === '' && down.number < state.doc.lines ? blockAt(view, down.to + 1, 'start') : null)) : null)
  return b ? select(view, b) : false
}

/**
 * 选区正好是一整块（块部件，或单独成行的公式这种整行藏着的块）：它占的那几行
 */
function wholeSelected(view: EditorView): { from: number; to: number } | null {
  const { state } = view
  const sel = state.selection.main
  if (sel.empty || state.selection.ranges.length > 1) return null
  const doc = state.doc
  const lines = (b: { from: number; to: number }) => doc.lineAt(b.from).from === b.from && doc.lineAt(b.to).to === b.to
  const h = hiddenRanges(state).find((x) => x.side === 'near' && x.unit && x.unit.from === sel.from && x.unit.to === sel.to && lines(x.unit))
  if (h) return h.unit
  const b = selectedBlock(view, state)
  return b && lines(b) ? b : null
}

/** 删掉第 a 到 b 行（连同一个换行，文件最后一行连同它前面那个） */
function lineRange(doc: Text, a: number, b: number): { from: number; to: number } {
  if (b < doc.lines) return { from: doc.line(a).from, to: doc.line(b + 1).from }
  if (a > 1) return { from: doc.line(a - 1).to, to: doc.line(b).to }
  return { from: 0, to: doc.length }
}

/**
 * 选中整块再按退格 / Delete：连同它占的那几行删掉。上下原来各有一个空行（或文件头尾）的，再拿掉一个，上下两段之间只留一个空行；
 * 光标留在按键的那一边（退格：块下面那一行；Delete：块上面那一行末尾）
 */
function deleteSelectedBlock(forward: boolean) {
  return (view: EditorView): boolean => {
    if (view.state.readOnly) return false
    const b = wholeSelected(view)
    if (!b) return false
    const doc = view.state.doc
    let s = doc.lineAt(b.from).number
    let e = doc.lineAt(b.to).number
    // 文件最后那个换行后面的空行不算空行：块是全篇最后一样时只删块，上一段下面的空行留着，光标停在那里打字是新起一段
    // （灰字「输入 / 插入块」也画在这一行，tail-line.ts）
    const blank = (n: number) => n < 1 || n > doc.lines || (doc.line(n).text.trim() === '' && !(n === doc.lines && n > 1 && doc.line(n).length === 0))
    if (blank(s - 1) && blank(e + 1)) {
      const above = s > 1
      const below = e < doc.lines
      if (forward ? below : !above) {
        if (below) e++
      } else if (above) s--
    }
    const r = lineRange(doc, s, e)
    // 删掉的范围前面的位置不变：Delete 停在上面那一行末尾；退格停在删掉的地方（就是下面那一行行首）。
    // 落在块和块之间的空行上（task-ys1rr 起光标不停在那里）：退格去下一块开头（按键的那一边），Delete 回上一块末尾
    const at = forward ? (s > 1 ? doc.line(s - 1).to : 0) : r.from
    const head = offGap(view.state.update({ changes: r }).state, at, forward ? 'up' : 'down')
    view.dispatch({
      changes: r,
      selection: EditorSelection.cursor(head),
      userEvent: forward ? 'delete.forward' : 'delete.backward',
      // 删的是整行（块连同一个空行），上下的块都不会并进正文：不用看守再改写
      annotations: hiddenOk.of(true),
      scrollIntoView: true,
    })
    return true
  }
}

/** 这一行是代码块、提示块（> [!…]，AI 讲解、旁支）的第一行（start）/ 最后一行（end）：那一块的范围 */
function textBlockAt(state: EditorState, line: Line, edge: 'start' | 'end'): { from: number; to: number } | null {
  if (line.text.trim() === '') return null
  const lead = line.from + line.text.search(/\S/)
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(lead, 1); n; n = n.parent) {
    const code = n.name === 'FencedCode'
    if (!code && n.name !== 'Blockquote') continue
    // 套在提示块里的引用（旁支里「> > 那一句」）：接着往外找提示块
    if (!code && !parseCallout(state.doc.lineAt(n.from).text)) continue
    const hit = edge === 'start' ? state.doc.lineAt(n.from).number === line.number : state.doc.lineAt(n.to).number === line.number
    return hit ? { from: n.from, to: n.to } : null
  }
  return null
}

/**
 * 能改字的块下面一行行首退格、上面一行行尾 Delete：光标走进块里（看守把它挪到藏着的记号旁边：退格到最后一行末尾，
 * Delete 到第一行的字前面）。不走这一步时，删掉的换行落在藏着的围栏、记号上被看守拦下，按了没反应；
 * 上面一行是空行时 Delete 还会把提示块的「> [!tip]」记号拿掉（wysiwyg.ts 的并行，task-6lsvd 改成空行不并）
 */
function enterTextBlock(forward: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view
    const sel = state.selection.main
    if (!sel.empty || state.readOnly) return false
    const line = state.doc.lineAt(sel.head)
    if (forward ? sel.head !== line.to || line.number === state.doc.lines : sel.head !== line.from || line.number === 1) return false
    const next = state.doc.line(line.number + (forward ? 1 : -1))
    const b = textBlockAt(state, next, forward ? 'start' : 'end')
    if (!b) return false
    view.dispatch({ selection: EditorSelection.cursor(forward ? next.from : next.to), userEvent: 'select', scrollIntoView: true })
    return true
  }
}

const keys = Prec.high(
  keymap.of([
    { key: 'Backspace', run: (v) => deleteSelectedBlock(false)(v) || backspaceSelectsBlock(v) || enterTextBlock(false)(v) },
    { key: 'Delete', run: (v) => deleteSelectedBlock(true)(v) || deleteSelectsBlock(v) || enterTextBlock(true)(v) },
    { mac: 'Ctrl-d', run: (v) => deleteSelectedBlock(true)(v) || deleteSelectsBlock(v) || enterTextBlock(true)(v) },
  ]),
)

/** 盖在选中的那张卡上的一层：位置相对 .cm-scroller（同 CodeMirror 的 layer），圆角跟卡自己；cls 是这层的类名（退格选中 cm-blk-selbg，块菜单开着 cm-blk-hotbg） */
class CardMarker implements LayerMarker {
  constructor(
    readonly cls: string,
    readonly left: number,
    readonly top: number,
    readonly width: number,
    readonly height: number,
    readonly radius: string,
  ) {}
  draw() {
    const el = document.createElement('div')
    el.className = this.cls
    this.place(el)
    return el
  }
  update(el: HTMLElement, prev: CardMarker) {
    if (prev.radius !== this.radius || prev.left !== this.left || prev.top !== this.top || prev.width !== this.width || prev.height !== this.height) this.place(el)
    return true
  }
  eq(o: CardMarker) {
    return o.cls === this.cls && o.left === this.left && o.top === this.top && o.width === this.width && o.height === this.height && o.radius === this.radius
  }
  private place(el: HTMLElement) {
    el.style.cssText = `left:${this.left}px;top:${this.top}px;width:${this.width}px;height:${this.height}px;border-radius:${this.radius}`
  }
}

/**
 * 从 from 起的那个块部件（数据库、图片、视频卡、嵌入……）的卡：盖在它上面的一层，大小、圆角跟卡自己；不是块部件给 null。
 * 退格选中整块和点把手开块菜单（block-handles.tsx 的 hotLayer）用同一个，两处一个样子（task-qkx1j）
 */
export function cardMarker(view: EditorView, from: number, cls: string): LayerMarker | null {
  // 块部件的那个元素：卡在它的内容框里（外层用上下内边距和别的块留缝），圆角读卡自己（第一个子元素）
  const el = Array.from(view.contentDOM.children).find((c) => !c.classList.contains('cm-line') && view.posAtDOM(c) === from) as HTMLElement | undefined
  if (!el) return null
  const sc = view.scrollDOM.getBoundingClientRect()
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  const card = el.firstElementChild ? getComputedStyle(el.firstElementChild) : cs
  const radius = card.borderRadius && card.borderRadius !== '0px' ? card.borderRadius : '6px'
  const pt = parseFloat(cs.paddingTop) || 0
  const pb = parseFloat(cs.paddingBottom) || 0
  const left = r.left - sc.left + view.scrollDOM.scrollLeft
  const top = r.top - sc.top + view.scrollDOM.scrollTop + pt
  return new CardMarker(cls, left, top, r.width, r.height - pt - pb, radius)
}

const selectedLayer = layer({
  above: true,
  class: 'cm-blkSelLayer',
  markers(view) {
    const b = selectedBlock(view, view.state)
    const m = b && cardMarker(view, b.from, 'cm-blk-selbg')
    return m ? [m] : []
  },
  update: (u) => u.selectionSet || u.docChanged || u.geometryChanged,
})

/**
 * 按退格 / Delete 选中整块时光标原来在的那一行（行首位置）：选中期间这一行照旧一整行高（block-gaps.ts），
 * 不然光标一离开，这个空行压成 12，下面的字往上跳 14；再按一下删掉、或选区挪走就不记了
 */
const held = StateField.define<number | null>({
  create: () => null,
  update(v, tr) {
    if (tr.docChanged) return null
    if (!tr.selection) return v
    const was = tr.startState.selection.main
    const now = tr.state.selection.main
    if (!was.empty || now.empty) return null
    const whole = hiddenRanges(tr.state).some((h) => h.side === 'near' && h.unit && h.unit.from === now.from && h.unit.to === now.to)
    return whole ? tr.startState.doc.lineAt(was.head).from : null
  },
})

/** 选中整块时要照旧一整行高的那一行（行首位置） */
export const heldLine = (state: EditorState): number | null => state.field(held, false) ?? null

export const atomicBlocks = [keys, selectedLayer, held]
