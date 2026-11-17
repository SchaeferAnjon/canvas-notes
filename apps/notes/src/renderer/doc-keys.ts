/**
 * 文档模式的几个键：
 * - 回车（CN-14）：光标在一段引用（剪进来的引文）最后一行末尾，回车新起一个普通段落（中间空一行），
 *   不再续出 `> `；空的 `> ` 行回车一次就退出。在引用中间回车照旧续写；要在引用里换段用 ⇧回车。
 * - 提示块（`> [!tip] 标题`）不一样（和 Obsidian 一样）：标题行、正文最后一行末尾回车在块里续一行 `> `，
 *   空的 `> ` 行再回车才出块。
 * - Tab / ⇧Tab（CN-18）：列表、待办里缩进一级 / 退一级；别处什么都不做，光标不离开正文（md 里行首制表符会变成代码块，不插）。
 *   键盘要离开正文：先按 Esc 再按 Tab（CodeMirror 自带）。
 */
import { indentLess, indentMore } from '@codemirror/commands'
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { syntaxTree } from '@codemirror/language'
import { type EditorState, Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'

/** pos 所在的最外层引用 */
function quoteAt(state: EditorState, pos: number): { from: number; to: number } | null {
  let out: { from: number; to: number } | null = null
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === 'Blockquote') out = { from: n.from, to: n.to }
  }
  return out
}

/** 回车：引用最后一行末尾 → 新起一段；空的 `> ` 行 → 退出引用 */
export function enterInQuote(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  const q = quoteAt(state, sel.head)
  if (!q) return false
  const empty = /^\s*>\s*$/.test(line.text)
  if (empty && sel.head === line.to) {
    // 空的 `> ` 行：这一行变成空行，光标到下一行新起一段
    const insert = '\n'
    view.dispatch({ changes: { from: line.from, to: line.to, insert }, selection: { anchor: line.from + insert.length }, userEvent: 'input', scrollIntoView: true })
    return true
  }
  if (sel.head !== q.to || line.to !== q.to) return false
  if (/^\s*>\s*\[!/.test(state.doc.lineAt(q.from).text)) {
    // 提示块：块里续一行
    const mark = /^\s*>\s?/.exec(line.text)![0].replace(/\s*$/, ' ')
    view.dispatch({ changes: { from: sel.head, insert: '\n' + mark }, selection: { anchor: sel.head + 1 + mark.length }, userEvent: 'input', scrollIntoView: true })
    return true
  }
  view.dispatch({ changes: { from: sel.head, insert: '\n\n' }, selection: { anchor: sel.head + 2 }, userEvent: 'input', scrollIntoView: true })
  return true
}

/**
 * 退格：引用、提示块最后一行是空的 `> `，光标在行尾：删掉 `> ` 就出块（和空行回车一样，上面空一行）。
 * 不然 md 的懒续行规则还把这一行画在块里，看着像没退出来（第 2 轮写作区存疑）。块中间的空 `> ` 行照常退格
 */
export function backspaceOutOfQuote(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  if (!/^\s*>\s*$/.test(line.text) || sel.head !== line.to || line.number === 1) return false
  if (!/^\s*>/.test(state.doc.line(line.number - 1).text)) return false
  if (line.number < state.doc.lines && /^\s*>/.test(state.doc.line(line.number + 1).text)) return false
  view.dispatch({ changes: { from: line.from, to: line.to, insert: '\n' }, selection: { anchor: line.from + 1 }, userEvent: 'delete.backward', scrollIntoView: true })
  return true
}

/** ⇧回车：在引用里换行，续出 `> ` */
function shiftEnter(view: EditorView): boolean {
  if (!quoteAt(view.state, view.state.selection.main.head)) return false
  return insertNewlineContinueMarkup(view)
}

/** 光标（或选区的每一行）在列表项里 */
function inList(state: EditorState): boolean {
  return state.selection.ranges.every((r) => {
    for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(state.doc.lineAt(r.from).from + state.doc.lineAt(r.from).text.search(/\S|$/), 1); n; n = n.parent)
      if (n.name === 'ListItem') return true
    return false
  })
}

const tab = (dir: 1 | -1) => (view: EditorView) => {
  if (view.state.readOnly || !inList(view.state)) return true
  return dir === 1 ? indentMore(view) : indentLess(view)
}

// markdown() 自己的回车是 Prec.high、排在前面，这里要 highest 才先轮到（/ 菜单的回车也是 highest、排在更前面，菜单开着时照旧先给它）
export const docKeys = Prec.highest(
  keymap.of([
    { key: 'Enter', run: enterInQuote },
    { key: 'Backspace', run: backspaceOutOfQuote },
    { key: 'Shift-Enter', run: shiftEnter },
    { key: 'Tab', run: tab(1), shift: tab(-1) },
  ]),
)
