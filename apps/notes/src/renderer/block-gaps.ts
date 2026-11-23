/**
 * 文档的竖向疏密（照小样 proposals2/D-读书与AI入口/v2/doc/proto-a.html，DESIGN.v3 6.1）：md 里块和块之间隔的那一个空行
 * 不占整整一行（15/1.75 是 26），压成小样里段落之间的距离：两块之间 12；标题上面 26、下面 10（三级以下 18、6）；
 * 标题下的元信息行到正文 26。2026-11-22 起（task-ys1rr，照 Notion）光标不停在这种空行上（block-flow.ts 的「块缝」），它一直是矮的，
 * 光标走过不再撑开、下面的字不跳。2026-11-23 起照 Tolaria 的数法（task-axoxy，gap-lines.ts）：一串空行里第一行是缝（压矮），
 * 后面每一行是一个「空块」（一整行高，下面带自己那道 12）；标题前那个留白的空行压成标题上方的距离；文件末尾不算块的空行压成 0。
 * 文末那一行灰字算一块。只加行装饰，不动文字。代码块里的空行是代码，不压。
 * 微信读书的书摘照它自己的疏密（review.ts 的 digestGaps：评价下面 14 等），这里整篇不管；引文和挂着的评价之间那一行（8、10）也是 review.ts 画。
 */
import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import { isBookDigest } from '../shared/plugins/weread'
import { heldLine } from './atomic-blocks'
import { blankRole } from './gap-lines'
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

/** 空块：一整行高，下面带 12 的间距（editor-blocks.css 的 .cm-emptyblk） */
const emptyDeco = Decoration.line({ class: 'cm-emptyblk' })

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
  // 兜底（task-axoxy）：光标真停在块缝上（改完规整、方向键都没接住的入口）时这一行不压矮，至少看得见光标；文件最后那一行交给 tail-line.ts
  const sel = state.selection.main
  const caret = sel.empty && state.selection.ranges.length === 1 ? doc.lineAt(sel.head).number : 0
  /** 这一行有字（空行、文末那一行灰字不算；代码块里的空行算字） */
  const text = (n: number) => n >= 1 && n <= doc.lines && n !== tail && (doc.line(n).text.trim() !== '' || inCode(state, doc.line(n).from))
  const prevBelow = (n: number) => (n >= 1 && text(n) ? below(doc.line(n).text, n === title) : 12)
  for (const { from, to } of view.visibleRanges) {
    for (let n = Math.max(2, doc.lineAt(from).number); n <= doc.lineAt(to).number; n++) {
      const l = doc.line(n)
      if (l.text.trim() !== '' || n === held || n === tail || review.has(l.from)) continue
      if (inCode(state, l.from)) continue
      const role = blankRole(state, n)
      if (!role) continue
      // 文件最后那个换行后面那一行：挨着有字的一行时是块缝，不然照常一整行（文末那一行的灰字画在这里，tail-line.ts）
      if (n === doc.lines) {
        if (text(n - 1)) out.push(gap(prevBelow(n - 1)).range(l.from))
        continue
      }
      const nextRole = blankRole(state, n + 1)
      if (role === 'empty') {
        // 空块一整行高，下面带自己那道 12 的间距（它和下一块之间没有缝那一行，Tolaria 的数法）；下面是标题的留白时由留白那一行出
        if (nextRole === 'empty' || nextRole === null) out.push(emptyDeco.range(l.from))
        continue
      }
      // 兜底（task-axoxy）：光标真停在缝上（改完规整、方向键都没接住的入口）时这一行不压矮，至少看得见光标
      if (n === caret && role !== 'pad') continue
      let px = 0
      if (role === 'sep') {
        const up = text(n - 1) ? prevBelow(n - 1) : 12
        if (nextRole === 'empty') px = up
        else if (nextRole === 'margin') px = Math.max(up, above(doc.line(n + 2).text))
        else if (nextRole === null && text(n + 1)) px = Math.max(up, above(doc.line(n + 1).text))
        else px = up
      } else if (role === 'margin') {
        px = blankRole(state, n - 1) === 'empty' ? above(doc.line(n + 1).text) : 0
      }
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
