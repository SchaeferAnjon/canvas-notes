/**
 * 块和块之间（task-ys1rr，照 Notion 的手感；用户：「这个块儿和这个Cursor还是用起来不丝滑 没有notion的感觉」）。
 *
 * md 里两块之间隔一个空行。以前这个空行是能停光标的一行：↓ → 每过一块多按一下，光标停上去时这一行从 12 撑成一整行、
 * 下面的字跳 15；在这里打字，字并进上一段；段末回车只是段里换行（还是同一块）；退格、Delete 先吃掉看不见的空行。现在：
 * - 「块缝」：挨着有字的一行的空行（代码块里的空行是代码，不算）。光标不停在块缝上：↑↓ 跨过去（横向位置不变），
 *   ←→ 一下从上一块末尾到下一块开头，点块缝落到离得近的那一块（横向位置照点的地方）；别的挪光标（PageDown、⌘↓、搜索……）落上去也挪走。
 *   文件最后那个空行紧挨着上一块时也是块缝：光标落上去就在文末新起一段（tail-line.ts），光标和灰字「输入 / 插入块」在同一行。
 * - 「空块」：一串空行里第一行以后的那几行（gap-lines.ts，照 Tolaria：N 个空行 = 1 道缝 + (N − 1) 个空块；标题前最后一行是留白），
 *   一整行高，光标停在这里打字就是新的一块。回车正好加一个换行、退格正好删一个（标题前头一回多加一行留白）。
 * - 回车（正文、标题）：新起一块——段末回车下面多一个空块、光标进去；段中间回车拆成两块；段首回车上面多一个空块；
 *   ⇧回车才是段里换行。全篇最后一块末尾回车等于点文末那一行。列表、待办、引用、提示块、代码块的回车照旧。
 * - 退格（块开头）：块的记号先拿掉（wysiwyg.ts，标题、列表变回正文），正文开头再退格并进上一块末尾；空块里退格删掉这个空块，
 *   光标回到上一块末尾（上一块是卡片就选中它、是代码块就进到它最后一行末尾）。Delete（块末尾）对称：下一块并上来，下面是空块就删掉它，
 *   全篇最后一块末尾 Delete 不做事（以前吃掉文件末尾的换行）。
 * 只改按键、光标和点哪里；空行在 md 里还是空行，「打开再保存不变」不受影响。块缝画多高在 block-gaps.ts。
 */
import { isolateHistory } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState, Prec, type Range, type SelectionRange, type Transaction, type TransactionSpec } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { blockEndingAt } from './atomic-blocks'
import { parseCallout } from './callout'
import { type Hidden, hiddenOk, hiddenRanges } from './hidden-syntax'
import { blankLine, blankRun, emptiesIn, emptyBlock, gapLine, headingLine, onGap, oneMore } from './gap-lines'
import { closeTail, moreTail, openTail, tailLineHere, tailPending } from './tail-line'
import { enterAfterTitle, headingOf } from './title-follow'
import { blockMarkEnd } from './wysiwyg'

type Node = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>

/** 第 n 行整行都藏着（卡片、公式块、代码块围栏、位置行、属性……）：盖住它的那一段 */
function wholeHidden(state: EditorState, n: number): Hidden | null {
  const line = state.doc.line(n)
  if (line.from === line.to) return null
  for (const h of hiddenRanges(state)) if (h.from <= line.from && h.to >= line.to) return h
  return null
}

/**
 * 第 n 行是画成一整块的东西（图片、表格、数据库、公式块、视频卡……）：那一块。
 * 不算代码块（能改字），也不算白板文档看法的列名（整块里还连着下面那张卡看得见的字，layout-lines.ts）
 */
function cardAt(state: EditorState, n: number, prev: EditorState = state): { from: number; to: number } | null {
  const line = state.doc.line(n)
  if (line.from === line.to) return null
  // 盖住这一行、又把整块盖全的那一段（一块常由几段拼成：```base 是 [前面的空行 + 开头行]、[整块]、[结尾行]，只认盖全的那段）
  const h = hiddenRanges(state, prev).find(
    (x) => x.from <= line.from && x.to >= line.to && x.side === 'near' && !!x.unit && x.unit.to > x.unit.from && x.unit.from >= x.from && x.unit.to <= x.to,
  )
  return h?.unit && !codeAt(state, n) ? h.unit : null
}

/** 这一行属于哪个收了尾的代码块（围栏行、里面的行都算）；```base 画成数据库表格，是卡片不算代码块 */
function codeAt(state: EditorState, n: number): { from: number; to: number } | null {
  const line = state.doc.line(n)
  for (let x: Node | null = syntaxTree(state).resolveInner(line.from + line.text.search(/\S|$/), 1); x; x = x.parent)
    if (x.name === 'FencedCode') {
      const a = state.doc.lineAt(x.from)
      const z = state.doc.lineAt(x.to)
      if (/^ {0,3}(`{3,}|~{3,})\s*base\b/.test(a.text)) return null
      return z.number > a.number && /^ {0,3}(`{3,}|~{3,})\s*$/.test(z.text) ? { from: x.from, to: x.to } : null
    }
  return null
}

/** 一行看得见的开头：块记号（标题、列表、引用、待办、提示块头）、评价的标签这些藏着的前缀后面 */
const visibleStart = (state: EditorState, n: number): number => {
  const line = state.doc.line(n)
  let pos = blockMarkEnd(state, line.from) ?? line.from
  const hs = hiddenRanges(state)
  for (let i = 0; i < 4; i++) {
    const h = hs.find((x) => x.from <= pos && x.to > pos && x.to <= line.to && x.toOk)
    if (!h) break
    pos = h.to
  }
  return pos
}

/** 行尾藏着的 ^块编号（block-id.ts）前面：看得见的末尾 */
const BLOCK_ID = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/
const visibleEnd = (state: EditorState, n: number): number => {
  const line = state.doc.line(n)
  const m = BLOCK_ID.exec(line.text)
  return m ? line.to - m[0].length : line.to
}

// ---------------------------------------------------------------- 光标不停在块缝上

/** 从第 n 行往下（dir 1）或往上（-1）找第一个能停光标的地方：空块那一行、有字的一行、代码块里第一行 / 最后一行（卡片跨过去） */
function stopFrom(state: EditorState, n: number, dir: 1 | -1): number | null {
  const doc = state.doc
  for (let m = n; m >= 1 && m <= doc.lines; m += dir) {
    if (gapLine(state, m)) continue
    const code = codeAt(state, m)
    if (code) {
      const a = doc.lineAt(code.from).number
      const z = doc.lineAt(code.to).number
      if (dir > 0) return a + 1 < z ? doc.line(a + 1).from : doc.line(a).to
      return z - 1 > a ? doc.line(z - 1).to : doc.line(z).from
    }
    const card = cardAt(state, m)
    if (card) {
      m = doc.lineAt(dir > 0 ? Math.min(card.to, doc.length) : card.from).number
      continue
    }
    const line = doc.line(m)
    return dir > 0 ? line.from : line.to
  }
  return null
}

/** 从第 n 行往 dir 那边，跨过块缝以后紧挨着的是一张卡片：那张卡 */
function cardNext(state: EditorState, n: number, dir: 1 | -1): { from: number; to: number } | null {
  let m = n
  while (m >= 1 && m <= state.doc.lines && gapLine(state, m)) m += dir
  return m >= 1 && m <= state.doc.lines ? cardAt(state, m) : null
}

/**
 * 挪之前选区正好是一张卡片（图、表、数据库……）：那张卡。
 * 按挪以后的 state、照挪之前藏着的样子认（光标收到卡片边上时它自己的 state 里那张卡露着写法，认不出）
 */
function heldCard(tr: Transaction): { from: number; to: number } | null {
  const r = tr.startState.selection.main
  if (r.empty || tr.startState.selection.ranges.length > 1 || tr.docChanged) return null
  const card = cardAt(tr.state, tr.state.doc.lineAt(r.from).number, tr.startState)
  return card && card.from === r.from && card.to === r.to ? card : null
}

/**
 * 挪光标（键盘、搜索、PageDown、⌘↓……）落到块缝上：往挪的方向挪到下一块开头 / 上一块末尾；
 * 从上一块末尾 → 过来、下一块开头 ← 过来，那边紧挨着的是卡片：选中这张卡（像 Notion），再按一下才走过去。
 * ↑↓ 和点在下面单独做（横向位置不变）；这里兜住别的。文件最后那个空行交给 tail-line.ts（新起一段）
 */
const gapFilter = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged || tr.annotation(hiddenOk)) return tr
  if (!tr.isUserEvent('select') || tr.isUserEvent('select.tail')) return tr
  const state = tr.state
  if (state.selection.ranges.length > 1) return tr
  const r = state.selection.main
  if (!r.empty) return extendOverGap(tr)
  // 选中着的卡片按方向键收起（CodeMirror 收到卡片的头或尾）：走过这张卡，到下一块开头 / 上一块末尾；
  // 那边紧挨着的又是一张卡：选中它（图片下面接着表格，↓ 一下一张，不一下跳过表格）。点的不管
  const held = tr.isUserEvent('select.pointer') ? null : heldCard(tr)
  if (held && (r.head === held.from || r.head === held.to)) {
    const fwd = r.head === held.to
    const n = fwd ? state.doc.lineAt(held.to).number + 1 : state.doc.lineAt(held.from).number - 1
    const next = n >= 1 && n <= state.doc.lines ? cardNext(state, n, fwd ? 1 : -1) : null
    if (next && next.from !== held.from) return [tr, { selection: EditorSelection.single(next.from, next.to), sequential: true }]
    const to = stopFrom(state, n, fwd ? 1 : -1)
    if (to !== null) return [tr, { selection: EditorSelection.cursor(to, fwd ? 1 : -1), sequential: true }]
    return tr
  }
  const line = state.doc.lineAt(r.head)
  if (line.number === state.doc.lines || !gapLine(state, line.number)) return tr
  // 从上一块末尾 → 过来：往下走；从下一块开头 ← 过来：往上走；挨着走过来的（只挪了一个字：空块里 →、⌃F 到标题上方的留白）：往挪的方向走；
  // 跳过来的（搜索、PageDown、软件放的）：去不是卡片的那一边，先上面
  const run = blankRun(state, line.number)
  const was = tr.startState.selection.main.head
  const fromAbove = run.prev > 0 && was === state.doc.line(run.prev).to
  const fromBelow = run.next > 0 && was >= state.doc.line(run.next).from && was <= visibleStart(state, run.next)
  // 跳过来的：上面紧挨着卡片、下面有能停的地方（下一块、空块、文末那一行）就往下，不然往上
  const down = stopFrom(state, line.number + 1, 1)
  const upCard = !run.prev || cardAt(state, run.prev) !== null
  // 挨着走过来的只认键盘挪了一个字、那一边不是卡片（卡片那边照下面「跳过来的」走，点的也是）
  let step: -1 | 0 | 1 = !tr.isUserEvent('select.pointer') && Math.abs(r.head - was) === 1 ? (r.head > was ? 1 : -1) : 0
  if ((step < 0 && upCard) || (step > 0 && (!run.next || cardAt(state, run.next) !== null))) step = 0
  const dir: 1 | -1 = fromAbove ? 1 : fromBelow ? -1 : step || (upCard && down !== null ? 1 : -1)
  const card = fromAbove || fromBelow ? cardNext(state, line.number, dir) : null
  if (card) return [tr, { selection: EditorSelection.single(card.from, card.to), sequential: true }]
  const to = dir > 0 ? (down ?? stopFrom(state, line.number - 1, -1)) : (stopFrom(state, line.number - 1, -1) ?? down)
  if (to === null || to === r.head) return tr
  return [tr, { selection: EditorSelection.cursor(to, dir > 0 ? 1 : -1, undefined, r.goalColumn), sequential: true }]
})

/**
 * ⇧→ ⇧←（⇧⌥→ 这些一样）扩选，选区的头落到块缝上：接着往同一个方向走到下一块开头 / 上一块末尾，一下跨块
 * （task-axoxy 第 17 条：以前第一下选中的是看不见的那个换行，屏上没变化）。⇧↑↓ 在 lineMove 里，拖选不管（松手在哪就选到哪）
 */
function extendOverGap(tr: Transaction): TransactionSpec | readonly TransactionSpec[] {
  if (tr.isUserEvent('select.pointer')) return tr
  const state = tr.state
  const r = state.selection.main
  const start = tr.startState.selection.main
  const was = start.head
  // 只管扩选（锚点没动、头挪了）；软件整块选中卡片（头落在卡片后面那一行）这些不管
  if (was === r.head || r.anchor !== start.anchor) return tr
  const line = state.doc.lineAt(r.head)
  if (line.text.trim() !== '' || line.number === state.doc.lines || !gapLine(state, line.number)) return tr
  const to = r.head > was ? stopFrom(state, line.number + 1, 1) : stopFrom(state, line.number - 1, -1)
  if (to === null) return tr
  return [tr, { selection: EditorSelection.range(r.anchor, to), sequential: true }]
}

/** ↑↓：落到块缝上就接着走，横向位置不变（像两块之间没有那一行）；要离开这一块、那边紧挨着的是卡片：选中它（像 Notion，以前一下跳过去） */
function lineMove(forward: boolean, extend: boolean) {
  return (view: EditorView): boolean => {
    const { state } = view
    if (state.selection.ranges.length > 1) return false
    const r = state.selection.main
    if (!extend && !r.empty) return false
    let next: SelectionRange = view.moveVertically(r, forward)
    const cur = state.doc.lineAt(r.head).number
    if (!extend && next.head !== r.head && state.doc.lineAt(next.head).number !== cur) {
      const card = cardNext(state, cur + (forward ? 1 : -1), forward ? 1 : -1)
      if (card) {
        // 滚到整张卡看得见；卡比窗口高（长的数据库表）时露出走过来的那一头（↓ 露卡头，↑ 露卡底），不跳到另一头（task-cle3x 设计复审）
        const near = forward ? EditorSelection.range(card.to, card.from) : EditorSelection.range(card.from, card.to)
        view.dispatch({ selection: EditorSelection.single(card.from, card.to), userEvent: 'select', effects: EditorView.scrollIntoView(near, { y: 'nearest', yMargin: 8 }) })
        return true
      }
    }
    if (next.head !== r.head && leavesCode(state, cur, next.head)) return codeOut(view, cur, forward, extend, next.goalColumn)
    if (next.head === r.head || !onGap(state, next.head)) return false
    for (let i = 0; i < 4 && onGap(state, next.head); i++) {
      const again = view.moveVertically(next, forward)
      if (again.head === next.head) break
      next = again
    }
    // 挪不出这道矮缝（缝下面紧挨着空块时 CodeMirror 量不过去）：直接到那边能停的那一行，横向照原来那一列
    // （task-axoxy 第 14 条：以前交给 gapFilter 挪，横向位置丢了，再往下就到了行首）
    const nl = state.doc.lineAt(next.head).number
    if (onGap(state, next.head) && nl < state.doc.lines) {
      const to = stopFrom(state, nl + (forward ? 1 : -1), forward ? 1 : -1)
      if (to !== null) next = EditorSelection.cursor(atColumn(view, to, forward, next.goalColumn), forward ? 1 : -1, undefined, next.goalColumn)
    }
    // 走到头还在块缝上（下面就是文末）：放到这一行，tail-line.ts 接着新起一段
    const sel = extend ? EditorSelection.range(r.anchor, next.head, next.goalColumn) : EditorSelection.cursor(next.head, next.assoc, undefined, next.goalColumn)
    // 包成 EditorSelection 再交：直接给一个 SelectionRange，CodeMirror 只取 anchor、head 重建，横向位置（goalColumn）就丢了，
    // 停在空块里再往下走就到了行首（task-axoxy 第 14 条的原因）
    view.dispatch({ selection: EditorSelection.create([sel]), userEvent: 'select', scrollIntoView: true })
    return true
  }
}

/**
 * to 那一行里横向在 goal 那一列的位置（goal 照 CodeMirror 的 goalColumn，从正文左边量；往下走取那一行头一截，往上取最后一截）；
 * 没给 goal、量不到原样给 to
 */
function atColumn(view: EditorView, to: number, forward: boolean, goal: number | undefined): number {
  if (goal === undefined) return to
  const line = view.state.doc.lineAt(to)
  const blk = view.lineBlockAt(line.from)
  const y = view.documentTop + (forward ? blk.top + Math.min(blk.height / 2, 10) : blk.bottom - Math.min(blk.height / 2, 10))
  const p = view.posAtCoords({ x: view.contentDOM.getBoundingClientRect().left + goal, y }, false)
  return p >= line.from && p <= line.to ? p : to
}

/** 光标从代码块里第 cur 行挪到 pos：出了这一块的字（落到藏着的围栏、块缝、更远） */
function leavesCode(state: EditorState, cur: number, pos: number): boolean {
  const code = codeAt(state, cur)
  if (!code) return false
  const a = state.doc.lineAt(code.from).number
  const z = state.doc.lineAt(code.to).number
  if (cur === a || cur === z) return false
  const n = state.doc.lineAt(pos).number
  return n <= a || n >= z
}

/**
 * 从代码块第一行 ↑、最后一行 ↓、最后一行末尾 → 出块（task-axoxy 第 9 条）：藏着的围栏、块缝一下过去，到上一块 / 下一块，
 * ↑↓ 横向位置照原来（goal 给了就按它落，同 CodeMirror 的 goalColumn）；那边紧挨着卡片就选中它。那边没有块（代码块在全篇最后）给 false，照旧交给文末那一行
 */
function codeOut(view: EditorView, cur: number, forward: boolean, extend: boolean, goal?: number): boolean {
  const { state } = view
  const code = codeAt(state, cur)!
  const dir: 1 | -1 = forward ? 1 : -1
  const edge = forward ? state.doc.lineAt(code.to).number + 1 : state.doc.lineAt(code.from).number - 1
  if (edge < 1 || edge > state.doc.lines) return false
  const r = state.selection.main
  const card = extend ? null : cardNext(state, edge, dir)
  if (card) {
    view.dispatch({ selection: EditorSelection.single(card.from, card.to), userEvent: 'select', scrollIntoView: true })
    return true
  }
  let to = stopFrom(state, edge, dir)
  if (to === null) return false
  to = atColumn(view, to, forward, goal)
  const sel = extend ? EditorSelection.range(r.anchor, to, goal) : EditorSelection.cursor(to, forward ? 1 : -1, undefined, goal)
  view.dispatch({ selection: EditorSelection.create([sel]), userEvent: 'select', scrollIntoView: true })
  return true
}

/** → ⌃F 在代码块最后一行末尾：出块到下一块开头（以前按了不动：收尾的围栏藏着，光标进不去又被推回来） */
function rightOutOfCode(view: EditorView): boolean {
  const { state } = view
  const r = state.selection.main
  if (!r.empty || state.selection.ranges.length > 1) return false
  const line = state.doc.lineAt(r.head)
  const code = codeAt(state, line.number)
  if (!code || r.head !== line.to || line.number !== state.doc.lineAt(code.to).number - 1 || line.number === state.doc.lineAt(code.from).number) return false
  return codeOut(view, line.number, true, false)
}

/** 点在块缝上：落到离得近的那一块，横向位置照点的地方（卡片那一边不落，落另一边） */
function clickPos(view: EditorView, x: number, y: number): number {
  const pos = view.posAtCoords({ x, y }, false)
  const state = view.state
  const line = state.doc.lineAt(pos)
  if (!gapLine(state, line.number)) return pos
  const blk = view.lineBlockAt(line.from)
  const mid = view.documentTop + blk.top + blk.height / 2
  const run = blankRun(state, line.number)
  const upOk = run.prev > 0 && line.number === run.first && !wholeHidden(state, run.prev)
  const downOk = run.next > 0 && line.number === run.last && !wholeHidden(state, run.next)
  if (upOk && (y < mid || !downOk)) return view.posAtCoords({ x, y: view.documentTop + view.lineBlockAt(state.doc.line(run.prev).to).bottom - 3 }, false)
  if (downOk) return view.posAtCoords({ x, y: view.documentTop + view.lineBlockAt(state.doc.line(run.next).from).top + 3 }, false)
  return pos
}

/**
 * 点版心左右的留白（加号把手那 56 宽的槽、再外面中间栏的空白）：光标落到这一高度那一行的开头 / 末尾（像 Notion；
 * 以前点左边光标不动，点右边编辑器失焦）。点在卡片旁边选中卡片。按钮、目录条、文末「提到这篇的」这些自己有事的不管
 */
class MarginClicks {
  private host: HTMLElement
  constructor(readonly view: EditorView) {
    const doc = view.dom.parentElement
    this.host = (doc?.parentElement?.classList.contains('body') ? doc.parentElement : doc) ?? view.dom
    this.host.addEventListener('mousedown', this.onDown)
  }
  private onDown = (e: MouseEvent) => {
    const view = this.view
    if (e.button !== 0 || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || view.state.readOnly) return
    const t = e.target as HTMLElement
    const ok = t === this.host || t === view.dom.parentElement || t === view.dom || t === view.scrollDOM || t.classList.contains('blk-bar')
    if (!ok) return
    const c = view.contentDOM.getBoundingClientRect()
    // 点第一行上面的留白（标签条和标题之间，task-axoxy 第 22 条，像 Tolaria）：落到第一行，横向照点的地方
    const above = e.clientY < c.top
    if (e.clientY > c.bottom - 2 || (!above && e.clientX >= c.left && e.clientX <= c.right)) return
    // 中间栏的滚动条
    if (t === this.host && e.offsetX >= this.host.clientWidth) return
    const x = Math.max(c.left + 1, Math.min(c.right - 1, e.clientX))
    const first = above ? view.viewportLineBlocks.find((b) => b.height > 1) : undefined
    const pos = clickPos(view, x, first ? view.documentTop + first.top + first.height / 2 : e.clientY)
    const card = cardAt(view.state, view.state.doc.lineAt(pos).number)
    e.preventDefault()
    view.focus()
    view.dispatch({ selection: card ? EditorSelection.single(card.from, card.to) : EditorSelection.cursor(pos), userEvent: 'select.pointer', scrollIntoView: true })
  }
  destroy() {
    this.host.removeEventListener('mousedown', this.onDown)
  }
}

const clickGap = EditorView.mouseSelectionStyle.of((view, event) => {
  if (event.button !== 0 || event.detail > 1 || event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return null
  if (!onGap(view.state, view.posAtCoords({ x: event.clientX, y: event.clientY }, false))) return null
  return {
    get: (cur) => EditorSelection.single(clickPos(view, event.clientX, event.clientY), clickPos(view, cur.clientX, cur.clientY)),
    update: () => false,
  }
})

// ---------------------------------------------------------------- 回车

/** 这一行属于顶层的段落或标题：那一块的范围；别的（列表、引用、代码、表格、HTML……）给 null */
function textBlock(state: EditorState, n: number): { from: number; to: number } | null {
  const line = state.doc.line(n)
  if (line.text.trim() === '') return null
  for (let x: Node | null = syntaxTree(state).resolveInner(line.from + line.text.search(/\S|$/), 1); x; x = x.parent) {
    if ((x.name === 'Paragraph' || /^ATXHeading/.test(x.name)) && x.parent?.name === 'Document') return { from: x.from, to: x.to }
    if (/^(ListItem|Blockquote|FencedCode|CodeBlock|HTMLBlock|CommentBlock|Table|SetextHeading|FrontMatter)/.test(x.name)) return null
  }
  return null
}

/** 拆开的地方不落在行内记号中间（链接、加粗、行内代码……）：落在里面就挪到它后面 */
function splitPoint(state: EditorState, pos: number): number {
  let at = pos
  for (let x: Node | null = syntaxTree(state).resolveInner(pos, 1); x; x = x.parent)
    if (/^(Link|Image|InlineCode|Emphasis|StrongEmphasis|Strikethrough|Autolink|URL|HTMLTag)$/.test(x.name) && x.from < pos && x.to > pos) at = Math.max(at, x.to)
  return at
}

/** 改块的结构（新起、拆开、并上、删掉一块）：单独一步撤销（不和前后打的字、删的字并成一步，⌘Z 一下回到这一步之前） */
function put(view: EditorView, change: { from: number; to?: number; insert?: string }, anchor: number, userEvent = 'input'): boolean {
  view.dispatch({ changes: change, selection: EditorSelection.cursor(anchor), userEvent, annotations: [hiddenOk.of(true), isolateHistory.of('full')], scrollIntoView: true })
  return true
}

/** 在第 n 行（一块的最后一行）后面新起一个空块，光标进去；后面没有别的块了就是文末那一行 */
function blockAfter(view: EditorView, n: number): boolean {
  const { state } = view
  const line = state.doc.line(n)
  // 全篇最后一块：文末新起一行（只在屏上，打了字才写进文件，tail-line.ts）
  if (state.doc.sliceString(line.to).trim() === '' && state.field(tailPending, false) !== undefined) return openTail(view) !== null
  const run = blankLine(state, n + 1) ? blankRun(state, n + 1) : null
  const add = oneMore(run?.k ?? 0, !!run?.next && headingLine(state, run.next))
  return put(view, { from: line.to, insert: '\n'.repeat(add) }, line.to + 2)
}

/** 在 pos 拆块要做的改动（照没选字回车的规矩，见 enterBlock）；拆不了（不是顶层段落、标题）给 null */
function splitAt(state: EditorState, pos: number): { change: { from: number; insert: string }; anchor: number } | null {
  const doc = state.doc
  const line = doc.lineAt(pos)
  if (blankLine(state, line.number)) return gapLine(state, line.number) ? null : { change: { from: line.from, insert: '\n' }, anchor: line.from + 1 }
  const blk = textBlock(state, line.number)
  if (!blk) return null
  const first = doc.lineAt(blk.from).number
  const last = doc.lineAt(blk.to).number
  const start = visibleStart(state, line.number)
  const end = visibleEnd(state, line.number)
  const at = pos >= end ? end : pos <= start ? start : splitPoint(state, pos)
  if (headingOf(doc.toString())?.line === line.number && at < end) return null
  if (at >= end) {
    if (line.number !== last) return { change: { from: line.to, insert: '\n\n' }, anchor: line.to + 2 }
    const run = blankLine(state, line.number + 1) ? blankRun(state, line.number + 1) : null
    return { change: { from: line.to, insert: '\n'.repeat(oneMore(run?.k ?? 0, !!run?.next && headingLine(state, run.next))) }, anchor: line.to + 2 }
  }
  if (at <= start) {
    if (line.number !== first) return { change: { from: line.from, insert: '\n' }, anchor: pos + 1 }
    if (line.number > 1 && !blankLine(state, line.number - 1)) return null
    const add = oneMore(line.number > 1 ? blankRun(state, line.number - 1).k : 0, headingLine(state, line.number))
    return { change: { from: line.from, insert: '\n'.repeat(add) }, anchor: pos + add }
  }
  return { change: { from: at, insert: '\n\n' }, anchor: at + 2 }
}

/**
 * 选着字回车（task-axoxy 第 10 条，像 Notion）：先照删除的规矩删掉选中的（跨块的照跨块删），再在那一点拆块，两下算一步撤销；
 * 选中的是一整张卡片（第 13 条）：在它下面新起一个空块，光标进去，卡片不动
 */
function enterOverSelection(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (sel.empty || state.selection.ranges.length > 1 || state.readOnly) return false
  const card = cardAt(state, state.doc.lineAt(sel.from).number)
  if (card && card.from === sel.from && card.to === sel.to) return blockAfter(view, state.doc.lineAt(card.to).number)
  const del = state.update({ changes: { from: sel.from, to: sel.to }, selection: EditorSelection.cursor(sel.from), userEvent: 'delete.selection' })
  const split = splitAt(del.state, del.state.selection.main.head)
  if (!split) return false
  const changes = del.changes.compose(del.state.changes(split.change))
  view.dispatch({ changes, selection: EditorSelection.cursor(split.anchor), userEvent: 'input', annotations: [hiddenOk.of(true), isolateHistory.of('full')], scrollIntoView: true })
  return true
}

/** 回车（正文、标题）：新起一块（见文件头） */
export function enterBlock(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return enterOverSelection(view)
  if (state.readOnly) return false
  const doc = state.doc
  const line = doc.lineAt(sel.head)
  const text = doc.toString()
  // 新建笔记的标题末尾：title-follow 接（到标题下面空一行的正文处）
  if (enterAfterTitle(text, sel.head) !== null) return false
  if (blankLine(state, line.number)) {
    if (gapLine(state, line.number)) return false
    // 文末那一行里回车：再起一行，也只在屏上（像 Notion 空的最后一块里回车能一直加，task-axoxy 第 15 条）
    if (tailLineHere(state, line.number)) return moreTail(view)
    // 空块里回车：下面再多一个空块
    return put(view, { from: line.from, insert: '\n' }, line.from + 1)
  }
  const blk = textBlock(state, line.number)
  if (!blk) return false
  const last = doc.lineAt(blk.to).number
  const end = visibleEnd(state, line.number)
  const at = sel.head >= end ? end : sel.head
  // 笔记名（开头的一级标题，就是文件名）：只有末尾回车新起一块，中间、开头照旧
  if (headingOf(text)?.line === line.number && at < end) return false
  if (at >= end && line.number === last) return blockAfter(view, line.number)
  const split = splitAt(state, sel.head)
  if (!split) return false
  return put(view, split.change, split.anchor)
}

// ---------------------------------------------------------------- 退格、Delete

/** 回到第 n 行那一块：卡片就选中它，代码块进到最后一行末尾，别的停在看得见的末尾 */
function backInto(view: EditorView, state: EditorState, n: number): EditorSelection {
  const line = state.doc.line(n)
  const card = blockEndingAt(view, line.to)
  if (card) return EditorSelection.single(card.from, card.to)
  const code = codeAt(state, n)
  if (code && state.doc.lineAt(code.to).number === n) return EditorSelection.single(Math.max(state.doc.lineAt(code.from).to, line.from - 1))
  return EditorSelection.single(visibleEnd(state, n))
}

/** 这一行能并字：有字、没整行藏着、不在代码块里；source：被并走的那一块，提示块的头一行不并（会把提示块拆开） */
function joinable(state: EditorState, n: number, source: boolean): boolean {
  if (n < 1 || blankLine(state, n) || wholeHidden(state, n) || codeAt(state, n)) return false
  return !(source && parseCallout(state.doc.line(n).text))
}

/**
 * 第 n 行那一块并到第 p 行末尾要删的那一段（p 行尾到 n 行看得见的开头：中间的空行、n 行开头的块记号）；
 * 碰到别的藏着的东西（提示块护着的空行、折叠块的标签、评价的标签、p 行尾的块编号）不并，给 null
 */
function joinRange(state: EditorState, p: number, n: number): { from: number; to: number } | null {
  if (!joinable(state, p, false) || !joinable(state, n, true)) return null
  const pl = state.doc.line(p)
  if (visibleEnd(state, p) !== pl.to) return null
  const nl = state.doc.line(n)
  const from = pl.to
  const to = visibleStart(state, n)
  for (const h of hiddenRanges(state)) {
    const own = h.from >= nl.from && h.to <= to
    if (!own && h.from < to && h.to > from) return null
    for (const g of h.glue ?? []) if (g.from < to && g.to > from) return null
  }
  return { from, to }
}

/** 第 n 行在提示块（> [!type]，AI 讲解、旁支）里 */
function inCallout(state: EditorState, n: number): boolean {
  const line = state.doc.line(n)
  let quote: Node | null = null
  for (let x: Node | null = syntaxTree(state).resolveInner(line.from + line.text.search(/\S|$/), 1); x; x = x.parent) if (x.name === 'Blockquote') quote = x
  return !!quote && !!parseCallout(state.doc.lineAt(quote.from).text)
}

/**
 * 退格在文末那一行（点进来还没打字）：这一行和暂时加的换行拿掉，回到上一块（卡片就选中它），同一下做完，灰字不挪位。
 * 比 atomic-blocks 的「下面一行行首退格选中卡片」先轮到（不然先选中卡片、那一行过一会儿才拿掉）
 */
function backspaceTail(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const doc = state.doc
  const line = doc.lineAt(sel.head)
  if (line.text.trim() !== '' || !tailLineHere(state, line.number)) return false
  return closeTail(view, (after) => {
    let m = after.doc.lines
    while (m > 1 && blankLine(after, m)) m--
    return blankLine(after, m) ? null : backInto(view, after, m)
  })
}

/** 删掉一个空块要删几个换行：下一块是标题、删完只剩缝和留白时连留白一起删（回到一道缝，task-axoxy） */
function dropCount(state: EditorState, run: { k: number; next: number }): number {
  return run.next && headingLine(state, run.next) && run.k === 3 ? 2 : 1
}

/** 退格：空块、块开头（见文件头） */
export function backspaceBlock(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const doc = state.doc
  const line = doc.lineAt(sel.head)
  if (blankLine(state, line.number)) {
    if (gapLine(state, line.number)) return false
    // 空块：删掉它，光标回到上一块末尾（上面还有空块就回到那个空块）
    const run = blankRun(state, line.number)
    if (!run.prev) return false
    const from = line.from - dropCount(state, run)
    const after = state.update({ changes: { from, to: line.from } }).state
    const to = line.number === run.first + 1 ? backInto(view, after, run.prev) : EditorSelection.single(from)
    view.dispatch({ changes: { from, to: line.from }, selection: to, userEvent: 'delete.backward', annotations: [hiddenOk.of(true), isolateHistory.of('full')], scrollIntoView: true })
    return true
  }
  // 块开头（看得见的第一个字前面），上面隔着空行；块记号先由 wysiwyg.ts 拿掉
  if (line.number === 1 || sel.head !== visibleStart(state, line.number) || !blankLine(state, line.number - 1)) return false
  if (blockMarkEnd(state, line.from) !== null) return false
  const run = blankRun(state, line.number - 1)
  if (emptiesIn(run.k, headingLine(state, line.number)) > 0 && run.prev) {
    // 中间夹着空块：删掉紧挨着的那一个（Tolaria 的数法：一个换行就是一个空块）
    const n = dropCount(state, { k: run.k, next: line.number })
    return put(view, { from: line.from - n, to: line.from }, sel.head - n, 'delete.backward')
  }
  if (!run.prev) return false
  const j = joinRange(state, run.prev, line.number)
  if (j) return put(view, j, j.from, 'delete.backward')
  // 上一块是代码块、提示块、卡片（中间隔一个空行的卡片在这之前已经由 atomic-blocks 选中）：光标回到它那里，不删字。
  // 别的藏着的（折叠块……）照旧交给后面
  if (!codeAt(state, run.prev) && !cardAt(state, run.prev) && !inCallout(state, run.prev)) return false
  view.dispatch({ selection: backInto(view, state, run.prev), userEvent: 'select', scrollIntoView: true })
  return true
}

/** Delete：空块、块末尾（见文件头） */
export function deleteBlock(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const doc = state.doc
  const line = doc.lineAt(sel.head)
  if (blankLine(state, line.number)) {
    if (gapLine(state, line.number)) return false
    const run = blankRun(state, line.number)
    if (!run.next) return true
    // 空块：删掉它；下面没有空块了光标到下一块开头
    const n = dropCount(state, run)
    const after = state.update({ changes: { from: line.from, to: line.from + n } }).state
    let to = line.from
    if (!emptyBlock(state, line.number + 1)) {
      let m = after.doc.lineAt(line.from).number
      while (m < after.doc.lines && blankLine(after, m)) m++
      to = visibleStart(after, m)
    }
    return put(view, { from: line.from, to: line.from + n }, to, 'delete.forward')
  }
  if (sel.head !== line.to || sel.head !== visibleEnd(state, line.number)) return false
  if (line.number === doc.lines || !blankLine(state, line.number + 1)) return false
  const run = blankRun(state, line.number + 1)
  // 全篇最后一块末尾：不做事（以前吃掉文件末尾的换行，看不见）
  if (!run.next) return true
  if (emptiesIn(run.k, headingLine(state, run.next)) > 0) return put(view, { from: line.to, to: line.to + dropCount(state, run) }, line.to, 'delete.forward')
  const j = joinRange(state, line.number, run.next)
  if (j) return put(view, j, j.from, 'delete.forward')
  // 下一块是卡片：选中它（中间隔两个空行时 atomic-blocks 不认）；代码块、提示块：光标进到第一行的字前面，不删字；别的照旧交给后面
  const card = cardAt(state, run.next)
  if (card) {
    view.dispatch({ selection: EditorSelection.single(card.from, card.to), userEvent: 'select', scrollIntoView: true })
    return true
  }
  const code = codeAt(state, run.next)
  const at = code ? Math.min(doc.lineAt(code.from).to + 1, doc.length) : inCallout(state, run.next) ? visibleStart(state, run.next) : null
  if (at === null) return false
  view.dispatch({ selection: EditorSelection.cursor(at), userEvent: 'select', scrollIntoView: true })
  return true
}

/**
 * 删到行首、删一个词、⌃K 在块边上并块：只在这一块和上一块（下一块）之间没有藏着的整块（折叠块、卡片、公式、代码围栏、位置行……）时做，
 * 那些交给这个键原来的做法和看守（退格、Delete 有自己一串先轮到的处理，这几个键没有）
 */
function plainEdge(run: (view: EditorView) => boolean, dir: 1 | -1) {
  return (view: EditorView): boolean => {
    const { state } = view
    const sel = state.selection.main
    if (!sel.empty || state.selection.ranges.length > 1) return false
    const line = state.doc.lineAt(sel.head)
    let n = line.number + dir
    while (n >= 1 && n <= state.doc.lines && blankLine(state, n)) n += dir
    if (n < 1 || n > state.doc.lines) return false
    const other = state.doc.line(n)
    const from = Math.min(line.from, other.from)
    const to = Math.max(line.to, other.to)
    // 块记号（标题、列表、引用的「## 」「- 」「> 」）不算；位置行、白板的卡片行这些单独成行藏着的都算
    const mark = (h: Hidden) => h.side === 'to' && h.from === state.doc.lineAt(h.from).from && blockMarkEnd(state, h.from) === h.to
    if (hiddenRanges(state).some((h) => h.from <= to && h.to >= from && !mark(h))) return false
    return run(view)
  }
}

/**
 * 选区跨过一块的末尾（⇧→ 从段尾一下选到下一块开头，task-axoxy 第 17 条）：段尾画一小截选区色，表示连那个换行一起选上了
 * （编辑器用系统选区，换行和压矮的块缝涂不出颜色，屏上看不出选了东西，这时打字、退格会把两块并起来；设计复审 2026-11-23）
 */
class SelectedBreak extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-selbreak'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
  ignoreEvent() {
    return false
  }
}
const selectedBreak = Decoration.widget({ widget: new SelectedBreak(), side: 1 })

function breakMarks(state: EditorState): DecorationSet {
  const r = state.selection.main
  if (r.empty || state.selection.ranges.length > 1) return Decoration.none
  const out: Range<Decoration>[] = []
  const last = state.doc.lineAt(r.to).number
  for (let n = state.doc.lineAt(r.from).number; n < last && out.length < 200; n++) {
    const line = state.doc.line(n)
    if (line.to < r.from || blankLine(state, n) || !blankLine(state, n + 1)) continue
    out.push(selectedBreak.range(line.to))
  }
  return Decoration.set(out)
}

const selBreaks = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = breakMarks(view.state)
      }
      update(u: ViewUpdate) {
        if (u.selectionSet || u.docChanged) this.decorations = breakMarks(u.state)
      }
    },
    { decorations: (p) => p.decorations },
  ),
  EditorView.baseTheme({
    '.cm-selbreak': {
      display: 'inline-block',
      width: '7px',
      height: '1.2em',
      verticalAlign: 'text-bottom',
      background: 'color-mix(in srgb, var(--acc) 24%, transparent)',
    },
  }),
]

export const blockFlow = [
  selBreaks,
  gapFilter,
  clickGap,
  ViewPlugin.fromClass(MarginClicks),
  Prec.highest(
    keymap.of([
      { key: 'ArrowDown', run: lineMove(true, false), shift: lineMove(true, true) },
      { key: 'ArrowUp', run: lineMove(false, false), shift: lineMove(false, true) },
      { key: 'ArrowRight', run: rightOutOfCode },
      { mac: 'Ctrl-f', run: rightOutOfCode },
      { key: 'Backspace', run: backspaceTail },
    ]),
  ),
  // 回车、退格、Delete 排在 markdown()（列表、引用续行）、位置行、整块（atomic-blocks）后面：它们不管的才轮到这里
  Prec.high(
    keymap.of([
      { key: 'Enter', run: enterBlock },
      { key: 'Backspace', run: backspaceBlock },
      { key: 'Delete', run: deleteBlock },
      { mac: 'Ctrl-d', run: deleteBlock },
      // 删到行首、删一个词在块开头，删到行尾、删一个词在块末尾：和退格、Delete 一样一下并块（task-axoxy 第 12 条，像 Notion）；不在块边上照旧
      { key: 'Mod-Backspace', run: plainEdge(backspaceBlock, -1) },
      { key: 'Alt-Backspace', run: plainEdge(backspaceBlock, -1) },
      { key: 'Alt-Delete', run: plainEdge(deleteBlock, 1) },
      { key: 'Mod-Delete', run: plainEdge(deleteBlock, 1) },
      { mac: 'Ctrl-k', run: plainEdge(deleteBlock, 1) },
    ]),
  ),
]
