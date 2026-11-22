/**
 * 行尾的 `^块编号`（`定义…… ^def1`，[[笔记#^def1]] 指的就是这一段；从 Obsidian 导进来的笔记里很多）：
 * 永远藏着，光标在哪都不露（DESIGN.v3 6.5 方向 A：平时一个 md 记号都不露，要看原文只有块上的「改写法」；task-4xtbp 设计复审）。
 * 交给 hidden-syntax 看守：光标停不进去、打的字落在它前面，块编号永远留在行尾；整行删掉时跟着删。
 * 在块编号前面回车（屏上就是行尾回车）：新的一行起在块编号后面，块编号留在原来那一段上。
 * 顶格单独一行的 `^块编号`（Obsidian 给表格、列表整块编号的写法）、代码里的、属性里的不管。只加装饰，不动文字。
 */
import { syntaxTree } from '@codemirror/language'
import { EditorState, StateField, Transaction, type TransactionSpec } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'
import { editKind, type Hidden, hiddenOk, hiddenSyntax } from './hidden-syntax'

const ID = /[ \t]+\^[A-Za-z0-9-]+[ \t]*$/
const FM = /^---\n[\s\S]*?\n---(?:\n|$)/

/** 这一行末尾的块编号从哪一格开始（连前面的空格；前面的字删光了只剩「 ^def1」也算）；没有是 -1 */
export function blockIdAt(text: string): number {
  const m = ID.exec(text)
  return m ? m.index : -1
}

interface Hit {
  /** 块编号（连前面的空格）[from, to)，to 是行尾 */
  from: number
  to: number
  line: number
}

const CODE = new Set(['InlineCode', 'FencedCode', 'CodeBlock', 'CommentBlock', 'HTMLBlock', 'Comment'])

function scan(state: EditorState): Hit[] {
  const doc = state.doc
  const text = doc.toString()
  if (!text.includes('^')) return []
  const fm = FM.exec(text.slice(0, 20000))
  const fmEnd = fm ? fm[0].length : 0
  const tree = syntaxTree(state)
  const out: Hit[] = []
  for (let n = doc.lineAt(fmEnd).number; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (line.from < fmEnd || !line.text.includes('^')) continue
    const at = blockIdAt(line.text)
    if (at < 0) continue
    const from = line.from + at
    let code = false
    for (let x: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(line.to, -1); x; x = x.parent) if (CODE.has(x.name)) code = true
    if (!code) out.push({ from, to: line.to, line: line.from })
  }
  return out
}

const hits = StateField.define<Hit[]>({
  create: scan,
  update: (v, tr) => (tr.docChanged ? scan(tr.state) : v),
})

const hide = Decoration.replace({})

const decorate = (state: EditorState) => Decoration.set(state.field(hits).map((h) => hide.range(h.from, h.to)))

const decos = StateField.define({
  create: decorate,
  update: (v, tr) => (tr.docChanged ? decorate(tr.state) : v),
  // 藏着的那一截光标一下跨过去
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
})

/** 块编号连同行尾的换行：光标停不进去（停在它前面），删不掉；整行一起删时跟着删 */
const guard = hiddenSyntax.of((state) => {
  const len = state.doc.length
  return state.field(hits).map(
    (h): Hidden => ({
      from: h.from,
      to: h.to < len ? h.to + 1 : h.to,
      fromOk: true,
      toOk: h.to < len,
      side: 'from',
      unit: { from: h.line, to: h.to },
    }),
  )
})

/**
 * 在块编号前面（看得见的行尾）回车、⌘↩、Ctrl+O：换行插在块编号后面，块编号不被挤到下一行变成单独一行。
 * 排在 hidden-syntax 改写编辑之后跑（那边把落进块编号里的字挪到它前面）
 */
const enterAfter = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || tr.annotation(hiddenOk) || editKind(tr) !== 'edit') return tr
  const start = tr.startState
  let one: { at: number; text: string } | null = null
  let n = 0
  tr.changes.iterChanges((fromA, toA, _fb, _tb, ins) => {
    n++
    if (fromA === toA) one = { at: fromA, text: ins.toString() }
  })
  const c = one as { at: number; text: string } | null
  if (n !== 1 || !c || !c.text.startsWith('\n')) return tr
  const h = start.field(hits).find((x) => x.from === c.at)
  if (!h) return tr
  const len = c.text.length
  const head = tr.state.selection.main.head
  const spec: TransactionSpec = {
    changes: { from: h.to, insert: c.text },
    // 光标在插进去的那几个字里（一般是末尾）：跟着挪到块编号后面
    selection: { anchor: head <= c.at ? head : head <= c.at + len ? h.to + (head - c.at) : head },
    effects: tr.effects,
    annotations: Transaction.userEvent.of(tr.annotation(Transaction.userEvent)!),
    scrollIntoView: tr.scrollIntoView,
  }
  return spec
})

export const blockIds = [hits, decos, guard, enterAfter]
