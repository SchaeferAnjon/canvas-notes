/**
 * 画成卡片的整块（图片、视频卡、时刻块、问答块）：
 * - 在它下面紧挨的一行行首按退格，先选中这一块（--acc-soft 底，同块菜单的选中），再按一次才删（CN-86）；
 * - 选区正好是一整块时，在它后面画一层 --acc-soft 底，和正文一样宽（块自己是替换掉原文的部件，选区高亮画不到它）。
 * 哪些算「整块」：各自的装饰通过 EditorView.atomicRanges 交上来的块部件（spec.block）。
 */
import { EditorSelection, type EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, layer, RectangleMarker } from '@codemirror/view'

/** 正好在 pos 结束的整块 */
export function blockEndingAt(view: EditorView, pos: number): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null
  for (const f of view.state.facet(EditorView.atomicRanges)) {
    f(view).between(Math.max(0, pos - 1), pos, (from, to, d) => {
      // 画成部件的整块（展开着的折叠块藏起来的 </details> 也是 block，但没有部件，不算）
      if (to === pos && d.spec.block && d.spec.widget) hit = { from, to }
    })
    if (hit) return hit
  }
  return null
}

/** 选区正好盖住的一整块 */
function selectedBlock(view: EditorView, state: EditorState): { from: number; to: number } | null {
  const sel = state.selection.main
  if (sel.empty) return null
  const b = blockEndingAt(view, sel.to)
  return b && b.from === sel.from ? b : null
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
    (sel.head === line.from && up ? (blockEndingAt(view, line.from - 1) ?? (up.text.trim() === '' && up.number > 1 ? blockEndingAt(view, up.from - 1) : null)) : null)
  if (!b) return false
  view.dispatch({ selection: EditorSelection.range(b.from, b.to), userEvent: 'select', scrollIntoView: true })
  return true
}

const backspace = Prec.high(keymap.of([{ key: 'Backspace', run: backspaceSelectsBlock }]))

const selectedLayer = layer({
  above: false,
  class: 'cm-blkSelLayer',
  markers(view) {
    const b = selectedBlock(view, view.state)
    if (!b) return []
    // 块部件的范围 forRange 量不出来：按块的上下沿和正文左右自己算（坐标相对 .cm-scroller，同 CodeMirror 的 layer）
    const sc = view.scrollDOM.getBoundingClientRect()
    const content = view.contentDOM.getBoundingClientRect()
    const baseLeft = sc.left - view.scrollDOM.scrollLeft
    const baseTop = sc.top - view.scrollDOM.scrollTop
    const top = view.documentTop + view.lineBlockAt(b.from).top - baseTop
    const bottom = view.documentTop + view.lineBlockAt(b.to).bottom - baseTop
    // 和正文一样宽：宽出去会让 .cm-scroller 多出横向滚动，选中时整篇往左滚一截
    return [new RectangleMarker('cm-blk-selbg', content.left - baseLeft, top, content.width, bottom - top)]
  },
  update: (u) => u.selectionSet || u.docChanged || u.geometryChanged,
})

export const atomicBlocks = [backspace, selectedLayer]
