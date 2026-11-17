/**
 * 文档白板留在文档里的位置行（`<!-- card id=d1 x=618 y=693 -->`，拖到空白处时写的，packages/format/src/doc-board.ts）：
 * 文档里整行藏起来，光标进不去（字和退格永远落在看得见的字里）；「源文件」里照旧看得到。
 * type: board 的白板不藏（那里每张卡都靠这一行，文档里看着才知道卡从哪开始）。
 *
 * 藏的是「上一行的换行 + 这一行」（并到上面那行末尾），不是「这一行 + 它的换行」（并到下面那段开头）：
 * 并到下面那段开头时，那段在屏上的行首其实是位置行的行首，Home、点行最左边、Ctrl+A、← 都停在那儿，打的字落进注释前面
 * （第 4 轮：屏上露出「Y<!-- card … -->」，卡在白板上弹回列里）。并到上面那行末尾后，下面那段的行首就是它自己的行首；
 * 光标、编辑不进藏着的那段由 hidden-syntax.ts 统一看守（这里只交上范围）
 */
import { ChangeSet, type ChangeSpec, EditorSelection, EditorState, Prec, type Range, StateField, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap } from '@codemirror/view'
import { fmValue } from '@cn/format'
import { type Hidden, hiddenOk, hiddenRanges, hiddenSyntax } from './hidden-syntax'

const CARD_LINE = /^<!--\s*card\s[^>]*-->\s*$/

/** 这篇是 type: board 的白板 */
const isBoard = (doc: Text) => fmValue(doc.sliceString(0, Math.min(doc.length, 4000)), 'type') === 'board'

/** 文档里藏起来的位置行（live-preview 不再给它画灰色等宽的样子） */
export function hiddenLayoutLine(doc: Text, lineText: string): boolean {
  return lineText.startsWith('<!--') && CARD_LINE.test(lineText) && !isBoard(doc)
}

function build(state: EditorState): DecorationSet {
  const doc = state.doc
  if (isBoard(doc)) return Decoration.none
  const out: Range<Decoration>[] = []
  for (let n = 1; n < doc.lines; n++) {
    const line = doc.line(n)
    if (!line.text.startsWith('<!--') || !CARD_LINE.test(line.text)) continue
    // 第一行上面没有行可并：藏「这一行 + 换行」，光标停在下一行行首
    out.push(n > 1 ? Decoration.replace({}).range(line.from - 1, line.to) : Decoration.replace({}).range(line.from, line.to + 1))
    // 上面是空行：这一行里只剩藏起来的部件，撑不起高度（光标用的两个 img 挪出了排版，app.css），
    // 给它一个空字撑成普通空行的高，↓ 能停、点得进（第 6 轮：两段挤在一起，看不出是两段）
    if (n > 1 && doc.line(n - 1).text === '') out.push(Decoration.line({ class: 'cm-cardgap' }).range(doc.line(n - 1).from))
  }
  return Decoration.set(out, true)
}

/** 位置行连着它那一段：段尾（下面第一个空行前） */
function paraEnd(doc: Text, n: number): number {
  let end = n
  while (end < doc.lines && doc.line(end + 1).text.trim() !== '') end++
  return doc.line(end).to
}

/**
 * 交给 hidden-syntax 看守的范围：「上一行的换行 + 位置行 + 它的换行」，光标挨着上一行末尾；
 * 第一行的位置行是「位置行 + 换行」，挨着下面那段段首。一次删除盖住位置行连它那整段才跟着删
 */
function ranges(state: EditorState): Hidden[] {
  const doc = state.doc
  if (isBoard(doc)) return []
  const out: Hidden[] = []
  for (let n = 1; n < doc.lines; n++) {
    const line = doc.line(n)
    if (!line.text.startsWith('<!--') || !CARD_LINE.test(line.text)) continue
    const unit = { from: line.from, to: paraEnd(doc, n + 1) }
    if (n > 1) out.push({ from: line.from - 1, to: line.to + 1, fromOk: true, toOk: true, side: 'from', unit })
    else out.push({ from: 0, to: line.to + 1, fromOk: false, toOk: true, side: 'to', unit })
  }
  return out
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (v, tr) => (tr.docChanged ? build(tr.state) : v),
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f)), hiddenSyntax.of((state) => ranges(state))],
})

/** 这一行（不算行尾换行）碰到藏着的语法（属性的 ---、</details>、<details>、收着的块、另一条位置行）：不并，交给 hidden-syntax 原地不动 */
function touchesHidden(state: EditorState, above: { from: number; to: number }): boolean {
  return hiddenRanges(state).some((h) => h.from < above.to && h.to > above.from)
}

/**
 * 在藏着位置行的那段（第 line 行）开头按退格要做的改动；不归这里管返回 null。
 * 上面是空行：删掉空行，位置行留着，这张卡在白板上还摆在原处（不然退格整行删掉位置行，卡悄悄弹回列里）。
 * 上面紧挨着一段字：照常把这段并到上一行末尾，位置行挪到并好的那段前面。上面是标题就照常并进去，位置行跟着删（标题不当单独摆的卡）
 */
function joinOverLayout(state: EditorState, lineNo: number): { changes: ChangeSpec; at: number; empty: boolean } | null {
  if (isBoard(state.doc) || lineNo < 3) return null
  const line = state.doc.line(lineNo)
  const card = state.doc.line(lineNo - 1)
  if (!card.text.startsWith('<!--') || !CARD_LINE.test(card.text)) return null
  const above = state.doc.line(card.number - 1)
  if (touchesHidden(state, above) || touchesHidden(state, line)) return null
  if (above.text.trim() === '') return { changes: { from: above.from, to: above.to + 1 }, at: line.from - (above.length + 1), empty: true }
  const join = { from: above.to, to: line.from, insert: '' }
  if (/^#{1,6} /.test(above.text)) return { changes: join, at: above.to, empty: false }
  let top = above
  while (top.number > 1) {
    const up = state.doc.line(top.number - 1)
    if (up.text.trim() === '' || /^#{1,6} /.test(up.text) || CARD_LINE.test(up.text)) break
    top = up
  }
  return { changes: [{ from: top.from, insert: card.text + '\n' }, join], at: above.to + card.length + 1, empty: false }
}

/** 在藏着位置行的那段开头按退格（见 joinOverLayout） */
export function backspaceOverLayout(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty || sel.head !== state.doc.lineAt(sel.head).from) return false
  const j = joinOverLayout(state, state.doc.lineAt(sel.head).number)
  if (!j) return false
  view.dispatch({ changes: j.changes, selection: { anchor: j.at }, userEvent: 'delete.backward', annotations: hiddenOk.of(true), scrollIntoView: true })
  return true
}

/**
 * 下一行就是藏着的位置行时按 Delete / Ctrl+D（第 5 轮：一下就把位置行整行删掉，屏上不变、卡回到列里）：
 * 和在下面那段段首退格一样。空行上按：删掉空行，光标到那段段首；段尾按：并段，光标留在并的地方
 */
export function deleteOverLayout(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  const line = state.doc.lineAt(sel.head)
  if (sel.head !== line.to || line.number + 2 > state.doc.lines) return false
  const j = joinOverLayout(state, line.number + 2)
  if (!j) return false
  view.dispatch({ changes: j.changes, selection: { anchor: j.at }, userEvent: 'delete.forward', annotations: hiddenOk.of(true), scrollIntoView: true })
  return true
}

/**
 * 粘贴进文档的字里带着位置行：去掉。在文档里选中、复制了摆在白板上的一段，藏着的位置行跟着进了剪贴板；
 * 贴到别处同一张卡出现两次，贴到另一段段首两条位置行叠在一起（第 6 轮存疑），白板上卡跳来跳去。白板（type: board）里照原样贴
 */
const pasteDropsLayout = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !tr.isUserEvent('input.paste') || isBoard(tr.startState.doc)) return tr
  let hit = false
  const specs: { from: number; to: number; insert: string }[] = []
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => {
    const text = ins.toString()
    const clean = text
      .split('\n')
      .filter((l) => !(l.startsWith('<!--') && CARD_LINE.test(l)))
      .join('\n')
    if (clean !== text) hit = true
    specs.push({ from: fromA, to: toA, insert: clean })
  })
  if (!hit) return tr
  const changes = ChangeSet.of(specs, tr.startState.doc.length)
  // 光标在每处贴进来的字后面（hidden-syntax 可能已经把插的位置挪开了，不按原来的选区算）
  const ins = specs.filter((s) => s.insert)
  const ranges = tr.startState.selection.ranges
  const ends = ins.length === ranges.length ? ins.map((s) => changes.mapPos(s.from, -1) + s.insert.length) : ranges.map((r) => changes.mapPos(r.to, 1))
  return {
    changes,
    selection: EditorSelection.create(ends.map((p) => EditorSelection.cursor(p))),
    userEvent: 'input.paste',
    scrollIntoView: true,
  }
})

export const layoutLines = [
  field,
  pasteDropsLayout,
  Prec.high(
    keymap.of([
      { key: 'Backspace', run: backspaceOverLayout },
      { key: 'Delete', run: deleteOverLayout },
      { mac: 'Ctrl-d', run: deleteOverLayout },
    ]),
  ),
]
