/**
 * 文档模式的几个键：
 * - 回车（CN-14）：光标在一段引用（剪进来的引文）最后一行末尾，回车新起一个普通段落（中间空一行），
 *   不再续出 `> `；空的 `> ` 行回车一次就退出。在引用中间回车照旧续写；要在引用里换段用 ⇧回车。
 * - 提示块（`> [!tip] 标题`）不一样（和 Obsidian 一样）：标题行、正文最后一行末尾回车在块里续一行 `> `，
 *   空的 `> ` 行再回车才出块。
 * - Tab / ⇧Tab（CN-18，task-busas；键在命令表里能改：indent、outdent）：
 *   列表、待办里缩进一级 / 退一级（上面没有同一层的一项可挂时 Tab 不做事，像 Notion）；代码块里插、删一级缩进；
 *   光标紧跟在剪进来的一段（引文）后面：Tab 给它开一段「我的评价」，光标进去；空着的评价里 ⇧Tab 撤掉（review.ts）；
 *   别处（普通段落、标题、评价里）什么都不做，光标不离开正文（md 里行首制表符会变成代码块，不插）。
 *   键盘要离开正文：先按 Esc 再按 Tab（CodeMirror 自带）。输入法正在选字时不接（isKey 不认）。
 */
import { indentLess, indentMore } from '@codemirror/commands'
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { indentUnit, syntaxTree } from '@codemirror/language'
import { type EditorState, Prec } from '@codemirror/state'
import { type EditorView, keymap } from '@codemirror/view'
import { comboOf } from '../shared/cmd-keys'
import { isKey, keysFor } from './keys'
import { blankLine, blankRun, headingLine, oneMore } from './gap-lines'
import { hiddenOk } from './hidden-syntax'
import { shiftTabOutOfReview, tabToReview } from './review'
import { openTail, tailPending } from './tail-line'

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
    // 后面没有别的块了：这一行拿掉，文末新起一行（只在屏上，打了字才写进文件；task-axoxy，文末的空块只在屏上）
    if (line.number > 1 && state.doc.sliceString(line.to).trim() === '' && state.field(tailPending, false) !== undefined) {
      view.dispatch({ changes: { from: line.from - 1, to: line.to }, selection: { anchor: line.from - 1 }, userEvent: 'input', annotations: hiddenOk.of(true) })
      openTail(view)
      return true
    }
    // 空的 `> ` 行：这一行变成空行（缝），下面正好多一个空块、光标进去（gap-lines.ts 的数法：这一行本身就多了一个空行，
    // 下面原来的空行、下一块是不是标题决定还要补几个；以前一律补一个，出块以后下面多一个空块，task-axoxy 第 21 条的图）
    const after = line.number < state.doc.lines && blankLine(state, line.number + 1) ? blankRun(state, line.number + 1) : null
    const next = after ? after.next : line.number < state.doc.lines ? line.number + 1 : 0
    const extra = Math.max(0, oneMore(after?.k ?? 0, !!next && headingLine(state, next)) - 1)
    view.dispatch({ changes: { from: line.from, to: line.to, insert: '\n'.repeat(extra) }, selection: { anchor: line.from + 1 }, userEvent: 'input', scrollIntoView: true })
    return true
  }
  if (sel.head !== q.to || line.to !== q.to) return false
  if (/^\s*>\s*\[!/.test(state.doc.lineAt(q.from).text)) {
    // 提示块：块里续一行
    const mark = /^\s*>\s?/.exec(line.text)![0].replace(/\s*$/, ' ')
    view.dispatch({ changes: { from: sel.head, insert: '\n' + mark }, selection: { anchor: sel.head + 1 + mark.length }, userEvent: 'input', scrollIntoView: true })
    return true
  }
  // 下面多一个空块（gap-lines.ts 的数法：下面原来有几个空行、下一块是不是标题，加的换行不一样；task-axoxy）
  const run = line.number < state.doc.lines && blankLine(state, line.number + 1) ? blankRun(state, line.number + 1) : null
  // 全篇最后一块：文末新起一行（只在屏上，tail-line.ts）
  if (state.doc.sliceString(line.to).trim() === '' && state.field(tailPending, false) !== undefined) return openTail(view) !== null
  const add = run && !run.next ? 2 : oneMore(run?.k ?? 0, !!run?.next && headingLine(state, run.next))
  view.dispatch({ changes: { from: sel.head, insert: '\n'.repeat(add) }, selection: { anchor: sel.head + 2 }, userEvent: 'input', scrollIntoView: true })
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

/**
 * 列表项能再缩一级：选区（每一段的第一行）所在的那一项上面有同一层的一项可以挂（像 Notion、Tolaria，task-axoxy 第 16 条）。
 * 第一项没有：Tab 不做事（以前照样在行首加两个空格，md 里不算层级，屏上却缩进了一级）
 */
function canIndent(state: EditorState): boolean {
  return state.selection.ranges.every((r) => {
    const line = state.doc.lineAt(r.from)
    for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(line.from + line.text.search(/\S|$/), 1); n; n = n.parent)
      if (n.name === 'ListItem') return n.prevSibling?.name === 'ListItem'
    return false
  })
}

/** 光标（选区的每一头）在代码块里（围栏那两行不算） */
function inCode(state: EditorState): boolean {
  return state.selection.ranges.every((r) =>
    [r.from, r.to].every((pos) => {
      for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
        if (n.name === 'CodeBlock') return true
        if (n.name !== 'FencedCode') continue
        const l = state.doc.lineAt(pos)
        return l.from !== state.doc.lineAt(n.from).from && !(l.to === state.doc.lineAt(n.to).to && /^\s*(`{3,}|~{3,})\s*$/.test(l.text))
      }
      return false
    }),
  )
}

/** 代码块里 Tab：没选字插一级缩进，选了几行整行进一级 */
function codeTab(view: EditorView): boolean {
  const sel = view.state.selection.main
  if (!sel.empty) return indentMore(view)
  const unit = view.state.facet(indentUnit)
  view.dispatch({ changes: { from: sel.head, insert: unit }, selection: { anchor: sel.head + unit.length }, userEvent: 'input.indent', scrollIntoView: true })
  return true
}

const TAB = comboOf({ key: 'Tab', code: 'Tab' })!
const BACKTAB = comboOf({ key: 'Tab', code: 'Tab', shiftKey: true })!

/** 按下 Tab / ⇧Tab：命令表里这个键现在给了哪条就做哪条，没给谁就接住不做事；输入法正在选字时让给输入法 */
const byCombo = (combo: string) => (view: EditorView) => {
  if (view.composing || view.compositionStarted) return false
  if (keysFor('indent').includes(combo)) return tabKey(view)
  if (keysFor('outdent').includes(combo)) return shiftTabKey(view)
  return true
}

/** Tab（命令表 indent）：代码块、列表、剪进来的一段后面写评价；别处接住不做事（光标不离开正文） */
export function tabKey(view: EditorView): boolean {
  if (view.state.readOnly) return true
  if (inCode(view.state)) return codeTab(view)
  if (inList(view.state)) return canIndent(view.state) ? indentMore(view) : true
  tabToReview(view)
  return true
}

/** ⇧Tab（命令表 outdent）：代码块、列表退一级；空着的「我的评价」撤掉 */
export function shiftTabKey(view: EditorView): boolean {
  if (view.state.readOnly) return true
  if (inCode(view.state)) return indentLess(view)
  if (inList(view.state)) return indentLess(view)
  shiftTabOutOfReview(view)
  return true
}

// markdown() 自己的回车是 Prec.high、排在前面，这里要 highest 才先轮到（/ 菜单的回车也是 highest、排在更前面，菜单开着时照旧先给它）
export const docKeys = Prec.highest(
  keymap.of([
    { key: 'Enter', run: enterInQuote },
    { key: 'Backspace', run: backspaceOutOfQuote },
    { key: 'Shift-Enter', run: shiftEnter },
    // 真按 Tab、⇧Tab：按命令表现在归谁做（默认缩进 / 写评价、退一级）；改给了别的键就接住不做事，光标不离开正文。
    // 写成具名的键（不是 any）：hidden-syntax.test 照键表把每个会改文档的键在每种藏起来的语法上按一遍
    { key: 'Tab', run: byCombo(TAB), shift: byCombo(BACKTAB) },
    // 改成别的键（⌃] 这种）以后：那个键做缩进 / 写评价、退一级
    { any: (v, e) => !e.isComposing && e.key !== 'Tab' && (isKey(e, 'indent') ? tabKey(v) : isKey(e, 'outdent') ? shiftTabKey(v) : false) },
  ]),
)
