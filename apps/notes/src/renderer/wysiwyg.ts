/**
 * 所见即所得的手感（CN-124「像 Typora 一样顺滑」，文档方向 A）：记号永远藏着，光标和按键都按看得见的字走。
 * - 块的记号（标题 #、引用 >、列表 - 1.、待办 - [ ]、代码块围栏、分隔线）登记成藏着的语法：光标停不到它前面、字打不进去；
 * - 行内的记号（** * ~~ ` == [ ](网址)）是原子的（live-preview 交上来的）：←→ 跨过去时不白按一下；
 *   退格、Delete 删的是看得见的那个字，不删记号；一处加粗的字删光了，两边的记号一起拿掉（不剩「****」变成分隔线）；
 * - 标题、引用、列表行首（看得见的第一个字前面）退格：变回正文，不剩「##小节」；
 * - 打 ``` 回车：补上收尾的 ```，光标在块里；代码块最后一行是空行再回车：出块，下面新起一段；
 * - 打「| 日期 | 地点 |」回车：变成表格，补上分隔行和一行空格子，光标进第一格（Tab 跳下一格，md-widgets.ts）；
 * - ⌘B、⌘I：选中的字加粗、斜体，再按一次取消（按语法树认，不把加粗当成斜体剥掉一个 *）；
 * - 选中字粘贴一个网址：变成 [字](网址)，字留着。
 */
import { isolateHistory } from '@codemirror/commands'
import { EditorSelection, EditorState, findClusterBreak, Prec, type SelectionRange } from '@codemirror/state'
import { isKey } from './keys'
import { syntaxTree } from '@codemirror/language'
import { insertNewlineContinueMarkup } from '@codemirror/lang-markdown'
import { EditorView, keymap } from '@codemirror/view'
import { parseCallout } from './callout'
import { type Hidden, hiddenOk, hiddenSyntax } from './hidden-syntax'
import { editCellLater } from './table-edit'
import { standaloneLine } from '@cn/format'
import { openTail, tailPending } from './tail-line'
import { headingOf } from './title-follow'
import { blankLine, HEADING } from './gap-lines'

// ---------- 块的记号：登记成藏着的语法 ----------

/** 这一行开头藏着的块记号到哪（标题、引用、列表、待办）；没有返回 null */
export function blockMarkEnd(state: EditorState, lineFrom: number): number | null {
  const line = state.doc.lineAt(lineFrom)
  const text = line.text
  // 引用（可能套几层，也可能是提示块的头一行）
  const q = /^(\s{0,3}>[ \t]?)+/.exec(text)
  if (q) {
    let end = q[0].length
    const c = parseCallout(text)
    if (c) end = Math.max(end, c.prefix)
    const inner = text.slice(end)
    const li = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+)(\[[ xX]\][ \t]+)?/.exec(inner)
    if (li && inner.length > 0) end += li[0].length
    return line.from + end
  }
  const h = /^ {0,3}#{1,6}[ \t]+/.exec(text)
  if (h && inSyntax(state, line.from, (n) => /^ATXHeading/.test(n))) return line.from + h[0].length
  const li = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)(\[[ xX]\](?:[ \t]+|$))?/.exec(text)
  if (li && inSyntax(state, line.from + li[1]!.length, (n) => n === 'ListItem' || n === 'ListMark')) return line.from + li[0].length
  return null
}

function inSyntax(state: EditorState, pos: number, ok: (name: string) => boolean): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (ok(n.name)) return true
  return false
}

/** 光标附近几行（藏着的语法每一下都要算，整篇长文不必全扫） */
function nearLines(state: EditorState, prev: EditorState): [number, number] {
  const heads = [...state.selection.ranges, ...prev.selection.ranges].flatMap((r) => [r.from, r.to]).map((p) => Math.min(p, state.doc.length))
  const a = state.doc.lineAt(Math.min(...heads)).number
  const b = state.doc.lineAt(Math.max(...heads)).number
  return [Math.max(1, a - 3), Math.min(state.doc.lines, b + 3)]
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/

const blockMarks = hiddenSyntax.of((state, prev) => {
  const out: Hidden[] = []
  const doc = state.doc
  const [a, b] = nearLines(state, prev)
  const len = doc.length
  for (let n = a; n <= b; n++) {
    const line = doc.line(n)
    const end = blockMarkEnd(state, line.from)
    if (end !== null && end > line.from) {
      out.push({ from: line.from, to: end, fromOk: false, toOk: true, side: 'to', unit: { from: line.from, to: line.to } })
      continue
    }
    // 分隔线：整行藏着，光标跨过去
    if (/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(line.text) && inSyntax(state, line.from, (x) => x === 'HorizontalRule')) {
      out.push({ from: Math.max(0, line.from - 1), to: Math.min(len, line.to + 1), fromOk: line.from > 0, toOk: true, side: 'near', unit: { from: line.from, to: line.to } })
      continue
    }
    // 代码块的围栏行：整行藏着（连同把它和上一行隔开的换行），光标跨过去。
    // 只认收了尾的代码块：正在打的「```」还没回车（没收尾）时照常是一行字，光标留在行尾。
    // 删除盖住了整个代码块（从上一段拖选到下一段、选中整块）时围栏跟着删（task-ys1rr，以前 unit 是 null：字删了、两行围栏永远删不掉，剩一个空代码块）
    const code = FENCE.test(line.text) ? codeNodeAt(state, line.from) : null
    if (code && closedFence(state, code)) {
      out.push({ from: Math.max(0, line.from - 1), to: Math.min(len, line.to + 1), fromOk: line.from > 0, toOk: true, side: 'near', unit: code })
    }
  }
  return out
})

// ---------- ←→：跨过藏着的记号时不白按 ----------

function spot(view: EditorView, pos: number): { x: number; y: number } | null {
  const c = view.coordsAtPos(pos, 1) ?? view.coordsAtPos(pos, -1)
  return c && { x: Math.round(c.left), y: Math.round(c.top) }
}

function moveVisible(forward: boolean, extend: boolean) {
  return (view: EditorView): boolean => {
    const sel = view.state.selection.main
    if (!extend && !sel.empty) return false
    let range: SelectionRange = EditorSelection.cursor(sel.head, sel.assoc)
    const start = spot(view, sel.head)
    if (!start) return false
    let moved = false
    for (let i = 0; i < 6; i++) {
      const next = view.moveByChar(range, forward)
      if (next.head === range.head) break
      range = next
      const c = spot(view, next.head)
      if (!c || Math.abs(c.x - start.x) > 1 || Math.abs(c.y - start.y) > 1) {
        moved = true
        break
      }
    }
    if (!moved || range.head === sel.head) return false
    // 同一个地方有两个位置（「A|**B」和「A**|B」）：停在左边那个，接着打的字跟左边的字一个样子（像 Notion）
    const head = leftmost(view, range.head)
    // 退回原地（代码块最后一行末尾，收尾的围栏藏着）：不白按，交给后面（block-flow 出块）
    if (head === sel.head) return false
    const first = view.moveByChar(EditorSelection.cursor(sel.head, sel.assoc), forward)
    // 一步就走到看得见的别处（没跨记号）：交给 CodeMirror 自己的 ←→
    if (first.head === head) return false
    view.dispatch({ selection: extend ? EditorSelection.range(sel.anchor, head) : EditorSelection.cursor(head), userEvent: 'select', scrollIntoView: true })
    return true
  }
}

/**
 * ← 在一行看得见的开头（列表、待办、引用、标题的记号藏在前面）：走到上一行末尾（task-ys1rr）。
 * 不走这一步时 CodeMirror 挪进记号里（列表的圆点画在那里，屏上的位置变了），看守又把光标推回原处，按了不动
 */
function leftOverMark(extend: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view
    const sel = state.selection.main
    if (!extend && !sel.empty) return false
    const line = state.doc.lineAt(sel.head)
    if (line.number === 1 || blockMarkEnd(state, line.from) !== sel.head || sel.head === line.from) return false
    const to = line.from - 1
    view.dispatch({ selection: extend ? EditorSelection.range(sel.anchor, to) : EditorSelection.cursor(to), userEvent: 'select', scrollIntoView: true })
    return true
  }
}

/** pos 正好在藏着的记号后面：挪到记号前面（屏上是同一个地方） */
function leftmost(view: EditorView, pos: number): number {
  for (let i = 0; i < 6; i++) {
    let next = pos
    for (const f of view.state.facet(EditorView.atomicRanges))
      f(view).between(Math.max(0, pos - 1), pos, (from, to, d) => {
        if (to === pos && from < pos && !d.spec.widget && !d.spec.block) next = from
      })
    if (next === pos) return pos
    pos = next
  }
  return pos
}

// ---------- 退格、Delete：删看得见的字 ----------

/** 和 pos 挨着（往 forward 那边）的行内原子段：藏着的记号、域名小块 */
function hiddenNext(view: EditorView, pos: number, forward: boolean): { from: number; to: number } | null {
  let hit: { from: number; to: number } | null = null
  for (const f of view.state.facet(EditorView.atomicRanges)) {
    f(view).between(Math.max(0, pos - 1), pos + 1, (from, to, d) => {
      if (hit || d.spec.block) return
      if (forward ? from === pos : to === pos) hit = { from, to }
    })
    if (hit) return hit
  }
  return null
}

function deleteVisible(forward: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view
    const sel = state.selection.main
    if (!sel.empty || state.readOnly) return false
    let pos = sel.head
    for (let i = 0; i < 6; i++) {
      const h = hiddenNext(view, pos, forward)
      if (!h) break
      pos = forward ? h.to : h.from
    }
    if (pos === sel.head) return false
    const line = state.doc.lineAt(pos)
    if (forward ? pos >= line.to : pos <= line.from) return false
    const target = findClusterBreak(line.text, pos - line.from, forward) + line.from
    const [from, to] = forward ? [pos, target] : [target, pos]
    view.dispatch({ changes: { from, to }, selection: { anchor: forward ? sel.head : sel.head - (to - from) }, userEvent: forward ? 'delete.forward' : 'delete.backward', scrollIntoView: true })
    return true
  }
}

/** 一处加粗、斜体、删除线、行内代码、高亮里的字删光了：两边的记号一起拿掉 */
const FORMAT = new Set(['StrongEmphasis', 'Emphasis', 'Strikethrough', 'InlineCode'])

const dropEmptyMarks = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('delete')) return tr
  const start = tr.startState
  const drop: { from: number; to: number }[] = []
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (toA <= fromA) return
    syntaxTree(start).iterate({
      from: Math.max(0, fromA - 1),
      to: Math.min(start.doc.length, toA + 1),
      enter: (n) => {
        if (!FORMAT.has(n.name)) return
        const open = n.node.firstChild
        const close = n.node.lastChild
        if (!open || !close || open === close) return
        if (fromA <= open.to && toA >= close.from && (fromA > n.from || toA < n.to) && close.from > open.to) drop.push({ from: n.from, to: n.to })
      },
    })
    // 高亮 ==字==（lezer 不认）
    const before = start.doc.sliceString(Math.max(0, fromA - 2), fromA)
    const after = start.doc.sliceString(toA, toA + 2)
    if (before === '==' && after === '==') drop.push({ from: fromA - 2, to: toA + 2 })
  })
  if (!drop.length) return tr
  const changes = drop.map((d) => ({ from: tr.changes.mapPos(d.from, 1), to: tr.changes.mapPos(d.to, -1) })).filter((d) => d.to > d.from)
  if (!changes.length) return tr
  return [tr, { changes, sequential: true, annotations: hiddenOk.of(true) }]
})

// ---------- 块开头退格：变回正文 ----------

function backspaceBlockStart(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  const end = blockMarkEnd(state, line.from)
  if (end === null || sel.head !== end) return false
  // 引用、提示块里不是第一行的（task-axoxy，像 Notion 一块里的换行）：一下并到上一行末尾；上一行是空的「>」就删掉那一行；
  // 上一行是提示块的标题：不把正文并进标题，光标走到标题末尾。以前只删「> 」，这一行还画在引用里（懒续行），按第二下才并
  const prev = line.number > 1 ? state.doc.line(line.number - 1) : null
  if (prev && /^\s{0,3}>/.test(line.text) && /^\s{0,3}>/.test(prev.text)) {
    if (parseCallout(prev.text)) {
      view.dispatch({ selection: { anchor: prev.to }, userEvent: 'select', scrollIntoView: true })
      return true
    }
    if (/^[\s>]*$/.test(prev.text)) {
      view.dispatch({ changes: { from: prev.from, to: line.from }, selection: { anchor: end - (line.from - prev.from) }, userEvent: 'delete.backward', annotations: [hiddenOk.of(true), isolateHistory.of('full')], scrollIntoView: true })
      return true
    }
    if (!/[ \t]+\^[A-Za-z0-9-]+[ \t]*$/.test(prev.text)) {
      view.dispatch({ changes: { from: prev.to, to: end }, selection: { anchor: prev.to }, userEvent: 'delete.backward', annotations: [hiddenOk.of(true), isolateHistory.of('full')], scrollIntoView: true })
      return true
    }
  }
  // 标题、列表、待办、引用的第一行：去掉记号，连同上下的空行一起改成独立的一段（task-axoxy，@cn/format 的 standaloneLine）
  return lineOut(view, line.number, end - line.from, 'delete.backward')
}

/** 第 n 行变成独立的一段（去掉 mark 长的记号、上下补空行、后面的编号重排），光标在它看得见的开头；改块的结构，单独一步撤销 */
export function lineOut(view: EditorView, n: number, mark: number, userEvent: string): boolean {
  const out = standaloneLine(view.state.doc.toString(), n, mark)
  if (out.trailing && view.state.field(tailPending, false) === undefined) {
    // 没有文末那一行的编辑器（白板卡里的小编辑器）：这一行清成空行，和上一块隔一个空行，光标在里面
    const line = view.state.doc.line(n)
    const pre = n > 1 && view.state.doc.line(n - 1).text.trim() !== '' ? '\n' : ''
    view.dispatch({ changes: { from: line.from, to: line.to, insert: pre }, selection: { anchor: line.from + pre.length }, userEvent, annotations: [hiddenOk.of(true), isolateHistory.of('full')], scrollIntoView: true })
    return true
  }
  view.dispatch({ changes: out.changes, selection: { anchor: out.at }, userEvent, annotations: [hiddenOk.of(true), isolateHistory.of('full')], scrollIntoView: true })
  // 后面没有别的块了：文末新起一行（只在屏上，打了字才写进文件；白板卡里的小编辑器没有文末那一行）
  if (out.trailing && view.state.field(tailPending, false) !== undefined) openTail(view)
  return true
}

/** 分隔线下面一行的行首退格：拿掉这条分隔线（像 Notion），光标不动 */
function backspaceAfterRule(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  if (sel.head !== line.from || line.number === 1) return false
  let up = state.doc.line(line.number - 1)
  if (up.text.trim() === '' && up.number > 1) up = state.doc.line(up.number - 1)
  if (!/^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(up.text) || !inSyntax(state, up.from, (x) => x === 'HorizontalRule')) return false
  view.dispatch({ changes: { from: up.from, to: line.from }, userEvent: 'delete.backward', annotations: hiddenOk.of(true), scrollIntoView: true })
  return true
}

/** 合并两行（行尾 Delete、行首退格）时，被并上来的那一行开头藏着的记号一起拿掉（不露出「##」） */
function joinStripsMarks(forward: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view
    const sel = state.selection.main
    if (!sel.empty || state.readOnly) return false
    const line = state.doc.lineAt(sel.head)
    if (forward ? sel.head !== line.to || line.number === state.doc.lines : sel.head !== line.from || line.number === 1) return false
    // 空行行尾 Delete 不并：并上来就把下面提示块的「> [!tip]」、标题的「## 」拿掉了，块变成一段正文（task-6lsvd）
    if (forward && line.text.trim() === '') return false
    const next = forward ? state.doc.line(line.number + 1) : line
    if (next.text.trim() === '') return false
    const end = blockMarkEnd(state, next.from)
    if (end === null || !forward) return false
    view.dispatch({ changes: { from: line.to, to: end }, selection: { anchor: line.to }, userEvent: 'delete.forward', annotations: hiddenOk.of(true) })
    return true
  }
}

// ---------- 回车 ----------

/** 打 ``` 回车：补收尾的围栏，光标在中间；代码块最后一行是空行再回车：出块 */
function enterCode(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  const m = /^( {0,3})(`{3,}|~{3,})\s*([^\s`]*)\s*$/.exec(line.text)
  if (m && sel.head === line.to) {
    // 只有开头的围栏、后面没有收尾（打的这一行把后面的字都吞进了代码块）：补一个收尾
    const node = codeNodeAt(state, line.from)
    const closed = node && state.doc.lineAt(node.to).number > line.number && FENCE.test(state.doc.lineAt(node.to).text)
    if (!closed) {
      const fence = m[1]! + m[2]!
      view.dispatch({ changes: { from: line.to, insert: '\n\n' + fence }, selection: { anchor: line.to + 1 }, userEvent: 'input', annotations: hiddenOk.of(true), scrollIntoView: true })
      return true
    }
  }
  // 代码块里最后一行（下面就是收尾的围栏）是空行：回车出块
  const node = codeNodeAt(state, sel.head)
  if (!node || line.text.trim() !== '' || line.number >= state.doc.lines) return false
  const close = state.doc.line(line.number + 1)
  if (!FENCE.test(close.text) || close.to !== state.doc.lineAt(node.to).to || line.number <= state.doc.lineAt(node.from).number) return false
  // 收尾围栏后面空一行，新起一段（和别的块隔一个空行）
  const insert = '\n\n'
  const changes = [
    { from: line.from - 1, to: line.to },
    { from: close.to, insert },
  ]
  const removed = line.to - (line.from - 1)
  view.dispatch({ changes, selection: { anchor: close.to - removed + insert.length }, userEvent: 'input', annotations: hiddenOk.of(true), scrollIntoView: true })
  return true
}

/**
 * 代码块里退格（task-ys1rr，用户报「代码块删不掉」：围栏藏着、删不到，空代码块按退格没反应）：
 * - 代码块是空的（里面只有空行）：整块换成一个空段落，光标留在这里（像 Notion 把块变回正文），再退格照常删掉这个空段落；
 * - 光标在第一行最前面：先选中整个代码块（再按一次删掉，atomic-blocks 的 deleteSelectedBlock，同卡片）。
 */
function backspaceInCode(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const code = codeNodeAt(state, sel.head)
  if (!code || !closedFence(state, code)) return false
  const open = state.doc.lineAt(code.from)
  const close = state.doc.lineAt(code.to)
  const line = state.doc.lineAt(sel.head)
  if (line.number <= open.number || line.number >= close.number) return false
  const inner = state.doc.sliceString(open.to + 1, close.from)
  if (inner.trim() === '') {
    const e = emptyBlockAt(state, open.from, close.to)
    view.dispatch({ changes: e.changes, selection: { anchor: e.at }, userEvent: 'delete.backward', annotations: [hiddenOk.of(true), isolateHistory.of('full')], scrollIntoView: true })
    return true
  }
  if (line.number !== open.number + 1 || sel.head !== line.from) return false
  view.dispatch({ selection: EditorSelection.range(code.from, code.to), userEvent: 'select', scrollIntoView: true })
  return true
}

/**
 * 把 [from, to)（整行）换成一个空块（gap-lines.ts 的数法：一串空行第一行是缝、后面每一行一个空块；标题前最后一行是留白）：
 * 上面没有空行就补一道缝；下面原来的那个空行并进来（不然多出一个空块），下面紧挨着标题时留着当留白；at 是那一行
 */
export function emptyBlockAt(state: EditorState, from: number, to: number): { changes: { from: number; to: number; insert: string }; at: number } {
  const doc = state.doc
  const a = doc.lineAt(from)
  const z = doc.lineAt(to)
  const blank = (n: number) => n >= 1 && n <= doc.lines && doc.line(n).text.trim() === ''
  const blankAbove = a.number === 1 || blank(a.number - 1)
  let next = z.number + 1
  while (blank(next)) next++
  const heading = next <= doc.lines && HEADING.test(doc.line(next).text)
  const pre = blankAbove ? '' : '\n'
  if (blank(z.number + 1) && !heading && next <= doc.lines) return { changes: { from: a.from, to: z.to + 1, insert: pre }, at: a.from + pre.length }
  const post = heading && next === z.number + 1 ? '\n' : ''
  return { changes: { from: a.from, to: z.to, insert: pre + post }, at: a.from + pre.length }
}

/** 代码块有收尾的围栏（最后一行是 ``` 而且不是开头那一行） */
function closedFence(state: EditorState, code: { from: number; to: number }): boolean {
  const a = state.doc.lineAt(code.from)
  const b = state.doc.lineAt(code.to)
  return b.number > a.number && FENCE.test(b.text)
}

function codeNodeAt(state: EditorState, pos: number): { from: number; to: number } | null {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) if (n.name === 'FencedCode') return { from: n.from, to: n.to }
  return null
}

/**
 * 标题的字开头回车：上面空出一行，这一块不动（不把「## 」留在上面一行）。
 * 上面隔着空行（或在文首）的标题交给 block-flow 的 enterBlock：上面多一个空块、光标还在标题上（task-axoxy 第 11 条，像 Notion；
 * 以前这里先接走，只插一个换行，成了标题上方的留白，光标进不去）。这里只管笔记名那一行、紧贴着上一行的标题
 */
function enterAtBlockStart(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  const end = blockMarkEnd(state, line.from)
  if (end === null || sel.head !== end || end === line.to) return false
  if (!/^ {0,3}#/.test(line.text)) return false
  if (headingOf(state.doc.toString())?.line !== line.number && (line.number === 1 || blankLine(state, line.number - 1))) return false
  view.dispatch({ changes: { from: line.from, insert: '\n' }, selection: { anchor: sel.head + 1 }, userEvent: 'input', annotations: hiddenOk.of(true), scrollIntoView: true })
  return true
}

/**
 * 空的列表项、待办（只剩记号）回车：套着的子项先退一级（成了上一级的一项）；顶层的拿掉记号出列表（像 Notion、Typora），
 * 这一行上下各一个空行，成了一个空块、光标在里面（task-axoxy：以前只删记号，接着写的正文在文件里是上一项的续行）
 */
function enterEmptyItem(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  const end = blockMarkEnd(state, line.from)
  if (end === null || end !== line.to || sel.head !== end) return false
  const m = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+\[[ xX]\])?[ \t]*$/.exec(line.text)
  if (!m) return false
  const indent = m[1]!.length
  if (indent > 0) {
    // 往上找上一级（缩进比它少的那一项），这一项退到它那一层
    for (let k = line.number - 1; k >= 1; k--) {
      const t = state.doc.line(k).text
      if (t.trim() === '') continue
      const p = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]/.exec(t)
      const lead = /^[ \t]*/.exec(t)![0].length
      if (lead >= indent) continue
      if (!p) break
      const to = p[1]!.length
      view.dispatch({ changes: { from: line.from, to: line.from + indent, insert: t.slice(0, to) }, selection: { anchor: sel.head - indent + to }, userEvent: 'input', annotations: [hiddenOk.of(true), isolateHistory.of('full')], scrollIntoView: true })
      return true
    }
  }
  return lineOut(view, line.number, line.length, 'input')
}

/**
 * 编号列表里回车：照 markdown 的续一项、后面的编号往后数，但这一下改的编号在藏着的记号里，看守会把「4」挪到记号后面
 * （成了「3. 4编号丙」）；这里整个算软件有意改的（task-axoxy）
 */
function enterOrdered(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  if (!/^[ \t]*\d{1,9}[.)][ \t]/.test(line.text) || blockMarkEnd(state, line.from) === null) return false
  // 命令自己 state.update 时过滤器就跑了：给它一个 update 带着 hiddenOk 的 state
  const marked = Object.create(state) as EditorState
  marked.update = (...specs) => state.update(...specs, { annotations: hiddenOk.of(true) })
  return insertNewlineContinueMarkup({ state: marked, dispatch: (tr) => view.dispatch(tr) })
}

/** 打「| 日期 | 地点 |」回车：变成表格（分隔行 + 一行空格子），光标进第一格 */
function enterTableHead(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const line = state.doc.lineAt(sel.head)
  const m = /^\s*\|(.+)\|\s*$/.exec(line.text)
  if (!m || sel.head !== line.to) return false
  if (inSyntax(state, line.from, (x) => x === 'Table' || x === 'FencedCode')) return false
  const next = line.number < state.doc.lines ? state.doc.line(line.number + 1) : null
  if (next && /^\s*\|?\s*:?-+/.test(next.text)) return false
  const cols = m[1]!.split('|').map((c) => c.trim())
  if (!cols.length || cols.every((c) => c === '')) return false
  const row = (cells: string[]) => '| ' + cells.join(' | ') + ' |'
  const head = row(cols)
  const md = [head, row(cols.map(() => '---')), row(cols.map(() => ''))].join('\n')
  const up = line.number > 1 ? state.doc.line(line.number - 1) : null
  const pre = up && up.text.trim() !== '' ? '\n' : ''
  const post = next && next.text.trim() !== '' ? '\n\n' : next ? '' : '\n'
  view.dispatch({ changes: { from: line.from, to: line.to, insert: pre + md + post }, selection: { anchor: line.from + pre.length + md.length }, userEvent: 'input', annotations: hiddenOk.of(true), scrollIntoView: true })
  // 光标进第一行空格子（表格画成部件，格子在 md-widgets 里就地改）
  editCellLater(view, line.from + pre.length, 0, 0)
  return true
}

// ---------- ⌘B、⌘I ----------

export function toggleFormat(kind: 'StrongEmphasis' | 'Emphasis') {
  const mark = kind === 'StrongEmphasis' ? '**' : '*'
  return (view: EditorView): boolean => {
    const { state } = view
    if (state.readOnly) return true
    let { from, to } = state.selection.main
    // 光标在一个词里（没选字）：这个词
    if (from === to) {
      const w = state.wordAt(from)
      if (!w) {
        // 在一处加粗里：整处取消
        const n = formatNodeAt(state, from, kind)
        if (!n) return true
        from = n.cFrom
        to = n.cTo
      } else {
        from = w.from
        to = w.to
      }
    }
    // 选中的正好是一处加粗（斜体）里的字：拿掉两边的记号
    const n = formatNodeAt(state, from, kind)
    if (n && n.cFrom <= from && n.cTo >= to && (n.cFrom === from && n.cTo === to)) {
      view.dispatch({ changes: [{ from: n.from, to: n.cFrom }, { from: n.cTo, to: n.to }], selection: { anchor: from - (n.cFrom - n.from), head: to - (n.cFrom - n.from) }, userEvent: 'input.format', annotations: hiddenOk.of(true) })
      return true
    }
    view.dispatch({ changes: [{ from, insert: mark }, { from: to, insert: mark }], selection: { anchor: from + mark.length, head: to + mark.length }, userEvent: 'input.format', annotations: hiddenOk.of(true) })
    return true
  }
}

function formatNodeAt(state: EditorState, pos: number, kind: string): { from: number; to: number; cFrom: number; cTo: number } | null {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name !== kind) continue
    const open = n.firstChild
    const close = n.lastChild
    if (!open || !close || open === close) return null
    return { from: n.from, to: n.to, cFrom: open.to, cTo: close.from }
  }
  // 光标正好在一处的最后（结束记号前面）：resolveInner 往后看会落在外面，往前再看一次
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name !== kind) continue
    const open = n.firstChild
    const close = n.lastChild
    if (!open || !close || open === close) return null
    return { from: n.from, to: n.to, cFrom: open.to, cTo: close.from }
  }
  return null
}

// ---------- 选中字粘贴网址：变成链接 ----------

const URL_ONLY = /^https?:\/\/\S+$/

const pasteLink = EditorState.transactionFilter.of((tr) => {
  if (!tr.isUserEvent('input.paste') || !tr.docChanged) return tr
  const sel = tr.startState.selection
  if (sel.ranges.length !== 1 || sel.main.empty) return tr
  const { from, to } = sel.main
  let pasted: string | null = null
  let one = true
  tr.changes.iterChanges((fromA, toA, _fb, _tb, ins) => {
    if (pasted !== null) one = false
    if (fromA !== from || toA !== to) one = false
    pasted = ins.toString()
  })
  const url = (pasted ?? '').trim()
  if (!one || !URL_ONLY.test(url)) return tr
  const text = tr.startState.doc.sliceString(from, to)
  if (!text.trim() || text.includes('\n') || URL_ONLY.test(text.trim())) return tr
  const insert = `[${text}](${url})`
  return { changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: 'input.paste', annotations: hiddenOk.of(true) }
})

export const wysiwyg = [
    blockMarks,
    dropEmptyMarks,
    pasteLink,
    // 比 markdown() 自己的回车、退格先轮到（/ 菜单开着时它的键更先，在 slash-menu 里是 highest）
    Prec.highest(
      keymap.of([
        { key: 'Enter', run: (v) => enterEmptyItem(v) || enterTableHead(v) || enterCode(v) || enterAtBlockStart(v) || enterOrdered(v) },
        { key: 'Backspace', run: (v) => backspaceInCode(v) || backspaceBlockStart(v) || backspaceAfterRule(v) || deleteVisible(false)(v) },
        { key: 'Delete', run: (v) => joinStripsMarks(true)(v) || deleteVisible(true)(v) },
        { key: 'ArrowRight', run: moveVisible(true, false), shift: moveVisible(true, true) },
        { key: 'ArrowLeft', run: (v) => leftOverMark(false)(v) || moveVisible(false, false)(v), shift: (v) => leftOverMark(true)(v) || moveVisible(false, true)(v) },
        // 加粗、斜体的键照命令表（设置 › 快捷键里能改）
        { any: (v, e) => isKey(e, 'bold') && toggleFormat('StrongEmphasis')(v) },
        { any: (v, e) => isKey(e, 'italic') && toggleFormat('Emphasis')(v) },
      ]),
    ),
]
