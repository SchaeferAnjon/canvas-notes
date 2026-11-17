/**
 * 选区和插入点（CN-66 A）：不用 CodeMirror 的 drawSelection（它把整行铺满一块底），用系统选区，只涂选中的字，
 * 颜色是这套主题的强调色 24%（app.css 的 ::selection）。系统光标在文档有焦点时才画，
 * 所以文档没焦点（焦点在右栏网页）时自己画一条「插入点」：2px 强调色、45% 透明、不闪，标出剪进来会落在哪；
 * 只有网页开着时显示（app.css 里 .web-open 才放出来）。
 */
import { EditorSelection } from '@codemirror/state'
import { layer, RectangleMarker } from '@codemirror/view'

export const insertPoint = layer({
  above: true,
  class: 'cm-insertLayer',
  markers(view) {
    if (view.hasFocus) return []
    const head = view.state.selection.main.head
    return RectangleMarker.forRange(view, 'cm-insertpoint', EditorSelection.cursor(head))
  },
  update: (u) => u.focusChanged || u.selectionSet || u.docChanged || u.geometryChanged,
})
