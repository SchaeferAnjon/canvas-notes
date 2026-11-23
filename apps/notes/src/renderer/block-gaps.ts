/**
 * 文档的竖向疏密（照小样 proposals2/D-读书与AI入口/v2/doc/proto-a.html，DESIGN.v3 6.1）：md 里块和块之间隔的那一个空行
 * 不占整整一行（15/1.75 是 26），压成小样里段落之间的距离：两块之间 12；标题上面 26、下面 10（三级以下 18、6）；
 * 标题下的元信息行到正文 26。2026-11-22 起（task-ys1rr，照 Notion）光标不停在这种空行上（block-flow.ts 的「块缝」），它一直是矮的，
 * 光标走过不再撑开、下面的字不跳；连着好几个空行时只有挨着字的头尾两行压矮，中间的是「空块」（回车新起的一块、删光了字的一段），一整行高；
 * 文末那一行灰字算一块。只加行装饰，不动文字。代码块里的空行是代码，不压。
 * 微信读书的书摘照它自己的疏密（review.ts 的 digestGaps：评价下面 14 等），这里整篇不管；引文和挂着的评价之间那一行（8、10）也是 review.ts 画。
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { isBookDigest } from '../shared/plugins/weread'
import { heldLine } from './atomic-blocks'
import { reviewGroups } from './review'
import { tailLineAt } from './tail-line'
import { headingOf } from './title-follow'

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]|$)/
const level = (text: string) => HEADING.exec(text)?.[1]!.length ?? 0

/** 这一块下面要留多少（小样的 margin-bottom）：标题下的元信息行 26，一二级标题 10，三级以下 6，别的 12 */
function below(text: string, title: boolean): number {
  if (title) return 26
  const h = level(text)
  return h === 0 ? 12 : h <= 2 ? 10 : 6
}

/** 这一块上面要留多少（小样的 margin-top）：一二级标题 26，三级以下 18，别的 0 */
function above(text: string): number {
  const h = level(text)
  return h === 0 ? 0 : h <= 2 ? 26 : 18
}

const gapDeco = new Map<number, Decoration>()
const gap = (px: number) => {
  let d = gapDeco.get(px)
  if (!d) gapDeco.set(px, (d = Decoration.line({ class: 'cm-gap', attributes: { style: `--gap: ${px}px` } })))
  return d
}

/** 代码块（围栏的、缩进的）、多行注释里的空行：是内容，不压 */
function inCode(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'CommentBlock') return true
  }
  return false
}

function build(view: EditorView): DecorationSet {
  const { state } = view
  const doc = state.doc
  const out: Range<Decoration>[] = []
  const head = doc.sliceString(0, Math.min(doc.length, 20000))
  if (isBookDigest(head)) return Decoration.none
  const review = new Set((state.field(reviewGroups, false)?.groups ?? []).flatMap((g) => g.gaps))
  // 退格 / Delete 选中整块时：光标原来那一行照旧一整行高（task-6lsvd：不然它压成 12，下面的字跳一下）
  const hold = heldLine(state)
  const held = hold === null ? 0 : doc.lineAt(hold).number
  const tail = tailLineAt(state)
  const title = headingOf(head)?.line ?? 0
  /** 这一行有字（空行、文末那一行灰字不算；代码块里的空行算字） */
  const text = (n: number) => n >= 1 && n <= doc.lines && n !== tail && (doc.line(n).text.trim() !== '' || inCode(state, doc.line(n).from))
  for (const { from, to } of view.visibleRanges) {
    for (let n = Math.max(2, doc.lineAt(from).number); n <= doc.lineAt(to).number; n++) {
      const l = doc.line(n)
      if (l.text.trim() !== '' || n === held || n === tail || review.has(l.from)) continue
      // 块缝（挨着有字的一行的空行，task-ys1rr）压矮，光标不停在这里（block-flow.ts）；两边都是空行的是空块，照常一整行
      const up = text(n - 1)
      const down = text(n + 1)
      if (!up && !down) continue
      if (inCode(state, l.from)) continue
      // 挨着空块的那一边，空块当一段正文算（它下面要 12、上面不留）
      const px = Math.max(up ? below(doc.line(n - 1).text, n - 1 === title) : 12, down ? above(doc.line(n + 1).text) : 0)
      out.push(gap(px).range(l.from))
    }
  }
  return Decoration.set(out)
}

export const blockGaps = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((t) => t.reconfigured)) this.decorations = build(u.view)
    }
  },
  { decorations: (p) => p.decorations },
)
