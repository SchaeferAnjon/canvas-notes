import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'

/**
 * 文档模式的实时预览：光标所在行显示 md 原文，其他行把记号藏起来、按排版显示。
 * 只加装饰，不动文字，所以不影响「打开再保存文件不变」。
 */

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/
const WIKILINK = /\[\[([^\]\n]+?)\]\]/g

const hide = Decoration.replace({})
const line = (cls: string) => Decoration.line({ class: cls })
const mark = (cls: string, attrs?: Record<string, string>) => Decoration.mark({ class: cls, attributes: attrs })

function build(view: EditorView): DecorationSet {
  const { state } = view
  const doc = state.doc
  const decos: Range<Decoration>[] = []

  // 光标和选区碰到的行显示原文
  const active = new Set<number>()
  for (const r of state.selection.ranges) {
    const a = doc.lineAt(r.from).number
    const b = doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) active.add(n)
  }
  const isActive = (pos: number) => active.has(doc.lineAt(pos).number)
  const lineDeco = (from: number, to: number, cls: string) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) decos.push(line(cls).range(doc.line(n).from))
  }
  /** 把记号藏起来；后面紧跟的空格一起藏 */
  const hideMark = (from: number, to: number, withSpace = false) => {
    if (isActive(from)) return
    if (withSpace && doc.sliceString(to, to + 1) === ' ') to++
    if (to > from) decos.push(hide.range(from, to))
  }

  const fm = FRONTMATTER.exec(doc.sliceString(0, Math.min(doc.length, 20000)))
  const fmEnd = fm ? fm[0].length : 0
  if (fm) lineDeco(0, Math.max(0, fmEnd - 1), 'cm-fm')

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.from < fmEnd) return node.name === 'Document' ? undefined : false
        const name = node.name
        const h = /^ATXHeading(\d)$/.exec(name)
        if (h) {
          decos.push(line(`cm-h cm-h${h[1]}`).range(doc.lineAt(node.from).from))
          return
        }
        switch (name) {
          case 'HeaderMark':
            if (node.node.parent?.name.startsWith('ATXHeading')) hideMark(node.from, node.to, true)
            return
          case 'StrongEmphasis':
            decos.push(mark('cm-strong').range(node.from, node.to))
            return
          case 'Emphasis':
            decos.push(mark('cm-em').range(node.from, node.to))
            return
          case 'Strikethrough':
            decos.push(mark('cm-strike').range(node.from, node.to))
            return
          case 'EmphasisMark':
          case 'StrikethroughMark':
            hideMark(node.from, node.to)
            return
          case 'InlineCode':
            decos.push(mark('cm-icode').range(node.from, node.to))
            return
          case 'CodeMark':
            if (node.node.parent?.name === 'InlineCode') hideMark(node.from, node.to)
            return
          case 'Link':
            decos.push(mark('cm-link').range(node.from, node.to))
            return
          case 'LinkMark':
          case 'URL':
          case 'LinkTitle':
            if (node.node.parent?.name === 'Link') hideMark(node.from, node.to)
            return
          case 'Blockquote':
            lineDeco(node.from, node.to, 'cm-quote')
            return
          case 'QuoteMark':
            hideMark(node.from, node.to, true)
            return
          case 'FencedCode':
          case 'CodeBlock':
            lineDeco(node.from, node.to, 'cm-codeblock')
            return false
          case 'ListMark':
            decos.push(mark('cm-listmark').range(node.from, node.to))
            return
          case 'HorizontalRule':
            lineDeco(node.from, node.to, 'cm-hr')
            return
          case 'CommentBlock':
          case 'HTMLBlock':
            if (doc.sliceString(node.from, node.from + 4) === '<!--') lineDeco(node.from, node.to, 'cm-layout')
            return false
        }
        return
      },
    })

    // 双链 [[笔记]]：lezer 不认识，自己找
    const text = doc.sliceString(from, to)
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index!
      if (start < fmEnd) continue
      const end = start + m[0].length
      const target = m[1]!.split('|')[0]!.split('#')[0]!.split('^')[0]!.trim()
      decos.push(mark('cm-wikilink', { 'data-target': target }).range(start + 2, end - 2))
      hideMark(start, start + 2)
      hideMark(end - 2, end)
    }
  }
  return Decoration.set(decos, true)
}

export const livePreview = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state))
          this.decorations = build(u.view)
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.contentAttributes.of({ class: 'cm-live' }),
]
