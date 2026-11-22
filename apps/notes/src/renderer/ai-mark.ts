/**
 * 文档里的 AI 块（`> [!ai]`，task-dtc34）用户这边能做的：
 * - 在 AI 块里改了字：还是 AI 块，头上小字多一个「改过」（和这一下打字同一步，⌘Z 一起撤掉）；
 * - 「变成我的字」（右键、块菜单）：去掉框，正文变回普通的字；
 * - 「标成 AI 写的」（右键、块菜单）：选中碰到的几段（没选就是光标那一段）包成「AI 写的 · 补标」块，不编是哪家哪个模型。
 * 后两样都是一步撤销。算新文字的是 @cn/format 的纯函数（ai-block.ts）。
 */
import { aiBlockAt, findBlocks, isAiHead, isEdited, markEdited, textChanges, unwrapAiBlock, wrapRange } from '@cn/format'
import { EditorState, Prec, type Text, type TransactionSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { hiddenOk } from './hidden-syntax'

/** pos 所在那一段引用往上找到第一行：是 [!ai] 块的头就给头那一行，不在 AI 块里是 null */
function aiHeadAbove(doc: Text, pos: number): { from: number; to: number; text: string } | null {
  let line = doc.lineAt(pos)
  if (!/^ {0,3}>/.test(line.text)) return null
  while (line.number > 1) {
    const up = doc.line(line.number - 1)
    if (!/^ {0,3}>/.test(up.text)) break
    line = up
  }
  return isAiHead(line.text) ? { from: line.from, to: line.to, text: line.text } : null
}

/** 软件写进来的：AI 边写边长、标成 AI 写的 / 变成我的字、插进一块（剪藏、AI 回答、视频问答块和它下面的空段落、接着问，note-doc insertAtCursor 等用 input.clip）、读书同步、旁支写回 */
const BY_APP = ['input.ai', 'input.aimark', 'delete.aimark', 'input.clip', 'input.sync', 'input.side']
/** 用户自己改的字（打字、删、粘贴、拖进来）；软件写的（上面那些、外面改了文件合并进来）不算 */
const byHand = (tr: { isUserEvent(e: string): boolean }) => (tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move.drop')) && !BY_APP.some((e) => tr.isUserEvent(e))

/**
 * 在 AI 块正文里改了字：头一行加「改过」（加在头上的「回到对话」前面），和这一下打字是同一步。
 * 只改头一行的字（改标题）不算；整块删掉的（头也删了）不加
 */
export const markEditedOnType = Prec.lowest(
  EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !byHand(tr)) return tr
    const doc = tr.startState.doc
    const heads = new Map<number, { from: number; to: number; text: string }>()
    tr.changes.iterChanges((fromA, toA, _fb, _tb, ins) => {
      // 接在块最后一行后面另起的（空一行接着写、挂上一块 [!side] 旁支）不算改了块里的字
      const text = ins.toString()
      if (fromA === toA && fromA === doc.lineAt(fromA).to && /^\n(?:\n|(?! {0,3}>)|[ \t]*>[ \t]*\[!)/.test(text)) return
      const head = aiHeadAbove(doc, fromA) ?? (toA > fromA ? aiHeadAbove(doc, toA) : null)
      if (!head || isEdited(head.text) || heads.has(head.from)) return
      // 头一行整个删掉了：不加
      if (fromA <= head.from && toA >= head.to) return
      // 只在头一行里改（改标题字）：不算改了正文
      const onHead = fromA >= head.from && toA <= head.to
      if (onHead) {
        let nl = false
        tr.changes.iterChanges((a, b, _c, _d, ins) => {
          if (a >= head.from && b <= head.to && ins.toString().includes('\n')) nl = true
        })
        if (!nl) return
      }
      heads.set(head.from, head)
    })
    if (!heads.size) return tr
    const extra: { from: number; insert: string }[] = []
    for (const h of heads.values()) {
      const next = markEdited(h.text)
      let k = 0
      while (k < h.text.length && h.text[k] === next[k]) k++
      const at = tr.changes.mapPos(h.from + k, 1)
      extra.push({ from: at, insert: next.slice(k, k + next.length - h.text.length) })
    }
    const spec: TransactionSpec = { changes: extra, sequential: true, annotations: hiddenOk.of(true) }
    return [tr, spec]
  }),
)

/** 光标或右键点着的地方在一块 AI 块里：那一块 */
export function aiBlockOf(view: EditorView, pos: number): { from: number; to: number } | null {
  return aiBlockAt(view.state.doc.toString(), pos)
}

/** 「标成 AI 写的」能用：from–to 碰到能包的段落、列表、引用（已经是提示块的、标题、代码不算） */
export function canMarkAi(view: EditorView, from: number, to: number): boolean {
  if (view.state.readOnly) return false
  return wrapRange(view.state.doc.toString(), from, to).wrapped > 0
}

function apply(view: EditorView, next: string, cursor: number, userEvent: string) {
  const old = view.state.doc.toString()
  view.dispatch({ changes: textChanges(old, next), selection: { anchor: Math.max(0, Math.min(next.length, cursor)) }, userEvent, scrollIntoView: true, annotations: hiddenOk.of(true) })
  view.focus()
}

/** 标成 AI 写的：from–to 碰到的几段包成「AI 写的 · 补标」块（一步撤销）；光标落在块的末尾 */
export function markAi(view: EditorView, from: number, to: number): boolean {
  if (view.state.readOnly) return false
  const old = view.state.doc.toString()
  const r = wrapRange(old, from, to)
  if (!r.wrapped) return false
  // 光标放在碰到的最后一块末尾（后面的字没动，从文末倒着数）
  const last = findBlocks(old).filter((b) => b.from <= Math.max(from, to)).pop()
  apply(view, r.text, r.text.length - (old.length - (last ? Math.max(last.to, to) : to)), 'input.aimark')
  return true
}

/** 变成我的字：pos 所在的 AI 块去掉框，正文变回普通的字（一步撤销）；光标落在原来那块的开头 */
export function makeMine(view: EditorView, pos: number): boolean {
  if (view.state.readOnly) return false
  const old = view.state.doc.toString()
  const b = aiBlockAt(old, pos)
  if (!b) return false
  const plain = unwrapAiBlock(old.slice(b.from, b.to))
  apply(view, old.slice(0, b.from) + plain + old.slice(b.to), b.from, 'delete.aimark')
  return true
}
