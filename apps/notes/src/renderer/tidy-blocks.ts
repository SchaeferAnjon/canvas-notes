/**
 * 改完规整（task-axoxy，Fable 5.2 顾问报告整体看法第 1 条）：块的规矩挂在结果上，不挂在一个个按键上。
 *
 * 以前「两块之间正好一个空行」「光标不在块缝上」靠回车、退格、Delete、方向键各自保证，没被想到的入口（三击再打字、⌘⌫、
 * 不选字 ⌘X、选着字回车、选中卡片打字、撤回……）就漏：两段在文件里并成一段、剩两个空行、光标停在看不见的缝上。
 * 现在用户每改一下（打字、删、粘贴、拖放；输入法组完字以后），只看这一下碰到的那几行，做完再规整，和这一下算同一步撤销：
 * 1. 原来隔着空行的两块被这一下贴成了相邻两行（三击选中一段连同行尾换行再打字、删掉一行连同它的换行）：补回空行。
 * 2. 在空块里打字，同一串里别的空块留着（空行的数法在 gap-lines.ts：一串空行第一行是缝、后面每一行一个空块）。
 * 3. 改完光标落在块缝上：回车、打字撑成一个空块、光标在里面；粘贴、删除光标挪到下一块开头。
 * 4. 删到了文件末尾、把结尾的换行也删了：补回来。
 * 只管这一下碰到的地方，别处、别人写的文件原有的样子一个字节不动；撤回、重做、外面改的、软件插的不管。书摘（微信读书）有自己的疏密，不管。
 */
import { type ChangeSet, EditorSelection, EditorState, Transaction, type TransactionSpec } from '@codemirror/state'
import { type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { isBookDigest } from '../shared/plugins/weread'
import { blankLine, blankRun, emptyBlock, gapLine } from './gap-lines'

/** 这一下是用户改字：打字、删、粘贴、拖放、软件的按键处理（回车、退格这些 userEvent 是 input / delete 的） */
function userEdit(tr: Transaction): boolean {
  if (!tr.docChanged || tr.annotation(Transaction.remote)) return false
  const ev = tr.annotation(Transaction.userEvent)
  if (!ev || ev.startsWith('input.type.compose')) return false
  // 软件自己有意改的（delete.review 撤掉空评价、input.block 插块……）不管，它们自己算好了空行
  return ev === 'input' || ev.startsWith('input.type') || ev.startsWith('input.paste') || ev.startsWith('input.drop') || /^delete($|\.(backward|forward|cut|selection|line))/.test(ev) || ev === 'move.drop'
}

/** 位置行、白板的卡片行和列行、折叠块的标签行（fold-block.ts 自己排空行） */
const LAYOUT = /^\s*(<!--\s*(card|column)\b|<\/?(details|summary)\b|.*<\/summary>)/

interface Fix {
  changes: { from: number; to?: number; insert?: string }
  /** 改完光标放哪（改完以后的位置）；不给就照改动挪 */
  cursor?: number
}

interface Ctx {
  start: EditorState
  /** 从 start 到现在的全部改动 */
  total: ChangeSet
  state: EditorState
}

/** 这次改动碰到的行（现在的行号，上下各多一行） */
function touchedLines(c: Ctx): [number, number] | null {
  let a = Infinity
  let b = -Infinity
  c.total.iterChangedRanges((_fa, _ta, fb, tb) => {
    a = Math.min(a, fb)
    b = Math.max(b, tb)
  })
  if (a === Infinity) return null
  const doc = c.state.doc
  return [Math.max(1, doc.lineAt(Math.min(a, doc.length)).number - 1), Math.min(doc.lines, doc.lineAt(Math.min(b, doc.length)).number + 1)]
}

/** 现在 pos 这个字是原来就有的（不是这一下插进来的） */
function preExisting(c: Ctx, pos: number): boolean {
  let ok = true
  c.total.iterChanges((_fa, _ta, fb, tb) => {
    if (pos >= fb && pos < tb) ok = false
  })
  return ok
}

/** 一串空行 [first, last] 这一下碰到了（行里或挨着它的换行改过） */
function touched(c: Ctx, first: number, last: number): boolean {
  const doc = c.state.doc
  const a = doc.line(first).from - (first > 1 ? 1 : 0)
  const z = Math.min(doc.length, doc.line(last).to + 1)
  let hit = false
  c.total.iterChangedRanges((_fa, _ta, fb, tb) => {
    if (fb <= z && tb >= a) hit = true
  })
  return hit
}

/** 规矩 1：原来隔着空行的两块，这一下贴成了相邻两行 */
function rejoined(c: Ctx, a: number, z: number): Fix | null {
  const { state, start } = c
  const back = c.total.invertedDesc
  for (let n = a; n < z; n++) {
    if (blankLine(state, n) || blankLine(state, n + 1)) continue
    if (state.doc.line(n).text.trim() === '' || state.doc.line(n + 1).text.trim() === '') continue
    const p = state.doc.line(n).to
    if (!preExisting(c, p)) continue
    const q = back.mapPos(p, 1)
    if (q >= start.doc.length || start.doc.sliceString(q, q + 1) !== '\n') continue
    const up = start.doc.lineAt(q).number
    // 文件最后那个换行后面的空串不是块和块之间的空行（tail-line.ts 管在那里打字）
    const below = up + 1 < start.doc.lines && blankLine(start, up + 1)
    if (blankLine(start, up) || below) return { changes: { from: p, insert: '\n' } }
  }
  return null
}

/** [a, z] 这几行里有几个空块 */
function empties(state: EditorState, a: number, z: number): number {
  let k = 0
  for (let n = Math.max(1, a); n <= Math.min(z, state.doc.lines); n++) if (emptyBlock(state, n)) k++
  return k
}

/**
 * 规矩 2：在空块里打了字，同一串里别的空块都留着（一串空行第一行是缝、后面每一行一个空块：这一块有了字，它下面那几行
 * 的第一行成了缝，少了一个空块，补一行；文件开头那一串同理补在上面）。只在那一边的空块数比原来少时补（补过就不再补）
 */
function typedIntoEmpty(c: Ctx): Fix | null {
  const { state, start } = c
  let fix: Fix | null = null
  c.total.iterChanges((fa, ta, fb, tb) => {
    if (fix || tb <= fb) return
    const was = start.doc.lineAt(fa)
    if (start.doc.lineAt(ta).number !== was.number || !emptyBlock(start, was.number)) return
    const now = state.doc.lineAt(fb)
    // 打的是「/筛选字」（插入菜单开着）：等选了再说，不在菜单底下改文档
    if (state.doc.lineAt(tb).number !== now.number || now.text.trim() === '' || /^[/、]/.test(now.text)) return
    const run = blankRun(start, was.number)
    const upBefore = empties(start, run.first, was.number - 1)
    const downBefore = empties(start, was.number + 1, run.last)
    const up = now.number > 1 && blankLine(state, now.number - 1) ? blankRun(state, now.number - 1) : null
    const down = now.number < state.doc.lines && blankLine(state, now.number + 1) ? blankRun(state, now.number + 1) : null
    if (up && empties(state, up.first, up.last) < upBefore) fix = { changes: { from: now.from, insert: '\n' } }
    else if (down && empties(state, down.first, down.last) < downBefore) fix = { changes: { from: now.to, insert: '\n' } }
  })
  return fix
}

/**
 * 规矩 3：改完光标落在块缝上。回车、打字（想要一块新的）：撑成一个空块，光标在里面；粘贴、拖放、删除：光标挪到下一块开头
 * （粘贴的最后是卡片时看守把光标放到它下面的缝上，不为它多起一个空块）
 */
function caretOnGap(c: Ctx, ev: string): Fix | null {
  const { state } = c
  const sel = state.selection
  if (sel.ranges.length > 1 || !sel.main.empty) return null
  const line = state.doc.lineAt(sel.main.head)
  if (line.number === state.doc.lines || !gapLine(state, line.number)) return null
  const run = blankRun(state, line.number)
  if (!run.prev || !run.next || !touched(c, run.first, run.last)) return null
  if (ev === 'input' || ev.startsWith('input.type')) {
    // 多一行成一个空块（缝在第一行；标题前最后一行是留白，空块在它上面）
    const cursor = line.number === run.first ? line.from + 1 : line.from
    return { changes: { from: line.from, insert: '\n' }, cursor }
  }
  const next = state.doc.line(run.next)
  return { changes: { from: next.from, insert: '' }, cursor: next.from }
}

/** 规矩 4：删到文件末尾连结尾的换行也删了 */
function lostEnd(c: Ctx): Fix | null {
  const { state, start } = c
  if (!start.doc.length || start.doc.sliceString(start.doc.length - 1) !== '\n') return null
  if (!state.doc.length || state.doc.sliceString(state.doc.length - 1) === '\n') return null
  // 只认删掉了结尾那个换行的（在文件最末打字、文件本来就以空行结尾时不算，task-axoxy：不然打一个字再删多出一个换行）
  let end = false
  c.total.iterChangedRanges((fa, ta) => {
    if (ta >= start.doc.length && fa < start.doc.length) end = true
  })
  return end ? { changes: { from: state.doc.length, insert: '\n' } } : null
}

/**
 * 从 start 改到 state（改动 total）以后要补的几下；每一下都按上一下改完的样子算（sequential）。没有要补的给空数组
 */
export function tidyAfter(start: EditorState, total: ChangeSet, state: EditorState, ev: string): TransactionSpec[] {
  if (isBookDigest(state.doc.sliceString(0, Math.min(state.doc.length, 20000)))) return []
  const out: TransactionSpec[] = []
  let c: Ctx = { start, total, state }
  for (let round = 0; round < 6; round++) {
    const w = touchedLines(c)
    if (!w) break
    // 碰到的几行挨着位置行、白板的卡片行和列行（layout-lines.ts）、折叠块的标签：那是它们自己排的空行，只补结尾的换行
    const doc = c.state.doc
    let layout = false
    for (let n = Math.max(1, w[0] - 1); n <= Math.min(doc.lines, w[1] + 1) && !layout; n++) layout = LAYOUT.test(doc.line(n).text)
    const fix = layout ? lostEnd(c) : (typedIntoEmpty(c) ?? rejoined(c, w[0], w[1]) ?? caretOnGap(c, ev) ?? lostEnd(c))
    if (!fix) break
    const cs = c.state.changes(fix.changes)
    const selection = fix.cursor !== undefined ? EditorSelection.cursor(fix.cursor) : c.state.selection.map(cs, -1)
    out.push({ changes: fix.changes, selection, sequential: true })
    const next = c.state.update({ changes: cs, selection, filter: false }).state
    c = { start, total: c.total.compose(cs), state: next }
  }
  return out
}

/** 打字、删除、粘贴这一下（不是输入法组字）：同一个改动里接着规整 */
const tidyFilter = EditorState.transactionFilter.of((tr) => {
  if (!userEdit(tr) || tr.startState.readOnly) return tr
  const specs = tidyAfter(tr.startState, tr.changes, tr.state, tr.annotation(Transaction.userEvent) ?? '')
  return specs.length ? [tr, ...specs] : tr
})

/**
 * 输入法组字：组的时候不动（改文档会打断输入法），组完以后照同样的规矩补，记成 input.type.compose（并进组字那一步撤销）
 */
class AfterCompose {
  private start: EditorState | null = null
  private total: ChangeSet | null = null
  private timer = 0
  constructor(readonly view: EditorView) {
    view.contentDOM.addEventListener('compositionend', this.onEnd)
  }
  update(u: ViewUpdate) {
    for (const tr of u.transactions) {
      if (!tr.docChanged) continue
      if (tr.isUserEvent('input.type.compose') && !this.start) {
        this.start = tr.startState
        this.total = tr.changes
      } else if (this.total) this.total = this.total.compose(tr.changes)
    }
    if (this.start && !u.view.composing) this.later()
  }
  private onEnd = () => this.later()
  private later() {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.run(), 0)
  }
  private run() {
    const view = this.view
    if (!this.start || !this.total || view.composing) return
    const start = this.start
    const total = this.total
    this.start = null
    this.total = null
    if (view.state.readOnly) return
    const specs = tidyAfter(start, total, view.state, 'input.type.compose')
    if (!specs.length) return
    specs[0] = { ...specs[0], userEvent: 'input.type.compose' }
    view.dispatch(...specs)
  }
  destroy() {
    clearTimeout(this.timer)
    this.view.contentDOM.removeEventListener('compositionend', this.onEnd)
  }
}

export const tidyBlocks = [tidyFilter, ViewPlugin.fromClass(AfterCompose)]
