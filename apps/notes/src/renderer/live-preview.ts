import { syntaxTree } from '@codemirror/language'
import { type Range, StateField } from '@codemirror/state'
import { codiconEl } from '@cn/design'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { hiddenLayoutLine } from './layout-lines'
import { type CalloutHead, parseCallout } from './callout'
import { highlightsIn } from './highlight'

/**
 * 文档模式的实时预览：记号（# ** * ` > [[ ]] - ```）藏起来、按排版显示。
 * 光标停在哪个记号所在的那一段（一处加粗、一个链接），只露那一处的记号，小一号、淡色；拖选一段时什么都不露，
 * 选中前后每一行的宽高都不变（CN-65、CN-68）。列表圆点永远是圆点。链接的网址收成一颗域名小块，光标走进它才展开（CN-58）。
 * 人还没点、没打字（刚打开时光标停在开头）就什么都不露，打开时不会先看到原文再跳一下（DESIGN.v3 6.5）。
 * 只加装饰，不动文字，所以不影响「打开再保存文件不变」。
 */

const FRONTMATTER = /^---\n[\s\S]*?\n---(?:\n|$)/
const WIKILINK = /\[\[([^\]\n]+?)\]\]/g
const FENCE = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/

const hide = Decoration.replace({})
const line = (cls: string) => Decoration.line({ class: cls })
const mark = (cls: string, attrs?: Record<string, string>) => Decoration.mark({ class: cls, attributes: attrs })
const shown = mark('cm-mdmark')

/** 无序列表的记号画成 5px 圆点 */
class Bullet extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-bullet'
    s.setAttribute('aria-hidden', 'true')
    return s
  }
}
const bullet = Decoration.replace({ widget: new Bullet() })

/** 网址收成的小块：「zh.wikipedia.org…」；点它光标进到网址末尾，网址展开 */
export function urlLabel(url: string): string {
  try {
    const u = new URL(url)
    if (u.host) return u.host + (u.pathname.length > 1 || u.search ? '…' : '')
  } catch {
    // 相对路径（附件/…）：只写文件名
  }
  const name = decodeURIComponentSafe(url.split(/[?#]/)[0]!.split('/').pop() ?? url)
  return name.length > 24 ? name.slice(0, 23) + '…' : name
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

class UrlChip extends WidgetType {
  constructor(
    readonly url: string,
    readonly end: number,
  ) {
    super()
  }
  eq(o: UrlChip) {
    return o.url === this.url && o.end === this.end
  }
  toDOM(view: EditorView) {
    const s = document.createElement('span')
    s.className = 'cm-urlchip'
    s.textContent = urlLabel(this.url)
    s.title = this.url
    s.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.end }, userEvent: 'select' })
    })
    return s
  }
  ignoreEvent() {
    return true
  }
}

/** 提示块第一行开头的图标（没写标题时后面带上类型名） */
class CalloutIcon extends WidgetType {
  constructor(
    readonly icon: Parameters<typeof codiconEl>[0],
    readonly label: string,
  ) {
    super()
  }
  eq(o: CalloutIcon) {
    return o.icon === this.icon && o.label === this.label
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-callout-icon'
    s.appendChild(codiconEl(this.icon, 14))
    if (this.label) {
      const t = document.createElement('span')
      t.className = 'cm-callout-label'
      t.textContent = this.label
      s.appendChild(t)
    }
    return s
  }
}

/** 代码块的语言名，放在块的右上角 */
class CodeLang extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(o: CodeLang) {
    return o.lang === this.lang
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-codelang'
    s.textContent = this.lang
    return s
  }
}

/** 人动过光标或打过字以后才露记号（打开文档时编辑器自己放的光标不算） */
const touched = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) =>
    v || ['select', 'input', 'delete', 'move', 'undo', 'redo'].some((e) => tr.isUserEvent(e)),
})

function build(view: EditorView): DecorationSet {
  const { state } = view
  const doc = state.doc
  const decos: Range<Decoration>[] = []
  const live = state.field(touched)

  /** 光标（没有选区时）碰到 from..to（两头算）；拖选时什么记号都不露 */
  const near = (from: number, to: number) => live && state.selection.ranges.some((r) => r.empty && r.from <= to && r.to >= from)
  /** 链接里收成域名小块的「(网址)」，里面的记号不再单独加装饰 */
  const chips: [number, number][] = []
  const inChip = (from: number, to: number) => chips.some(([a, b]) => from >= a && to <= b)
  const inCode = (pos: number) => {
    for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent)
      if (n.name === 'InlineCode' || n.name === 'FencedCode' || n.name === 'CodeBlock' || n.name === 'CommentBlock' || n.name === 'HTMLBlock') return true
    return false
  }
  /** 已经整段换成部件的范围（提示块的「> [!question] 」），里面的节点不再加装饰 */
  const skips: [number, number][] = []

  /** 提示块：整段 --fill 底的卡，第一行「> [!type] 」换成图标，AI 讲解的标题里「引擎 · 模型 · 看了什么」淡一号 */
  function callout(from: number, to: number, c: CalloutHead) {
    const a = doc.lineAt(from)
    const b = doc.lineAt(to)
    for (let n = a.number; n <= b.number; n++) {
      const cls = ['cm-callout', `cm-callout-${c.kind}`, `cm-tone-${c.tone}`]
      if (n === a.number) cls.push('cm-callout-head')
      if (n === b.number) cls.push('cm-callout-bot')
      decos.push(line(cls.join(' ')).range(doc.line(n).from))
    }
    const end = a.from + c.prefix
    skips.push([a.from, end])
    decos.push(Decoration.replace({ widget: new CalloutIcon(c.icon, c.title ? '' : c.label) }).range(a.from, end))
    if (c.kind === 'ai' && c.title) {
      const cut = c.title.indexOf(' · ')
      const t0 = end + (a.text.slice(c.prefix).length - a.text.slice(c.prefix).trimStart().length)
      if (cut > 0) {
        decos.push(mark('cm-callout-name').range(t0, t0 + cut))
        decos.push(mark('cm-callout-meta').range(t0 + cut, a.to))
      }
    }
  }

  /**
   * 引文下面一段以「我的评价」开头的正文：前面一个小标签，从引文竖线拐下来一道弯钩连到它（CN-38 B）。
   * 没写评价就什么都不画（不放「写点想法」占位：`引用别塞评价占位`）。
   */
  function review(quoteTo: number) {
    const q = doc.lineAt(quoteTo)
    const gaps: number[] = []
    let n = q.number + 1
    while (n <= doc.lines && doc.line(n).text.trim() === '' && gaps.length < 1) gaps.push(n++)
    if (n > doc.lines) return
    const l = doc.line(n)
    // 后面紧跟的冒号并进小标签：「我的评价：」一体（加粗的 ** 在冒号前后都认）
    const m = /^(\*\*)?我的评价([：:]|\*\*[：:])?/.exec(l.text)
    if (!m) return
    for (const g of gaps) decos.push(line('cm-review-gap').range(doc.line(g).from))
    decos.push(line('cm-review').range(l.from))
    const at = l.from + (m[1] ? 2 : 0)
    decos.push(mark('cm-review-tag').range(at, at + 4 + (m[2]?.length ?? 0)))
  }
  const lineDeco = (from: number, to: number, cls: string) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) decos.push(line(cls).range(doc.line(n).from))
  }
  /** 记号：owner（这一处加粗、这个链接……）被光标碰到时淡淡露出来，否则藏起来；后面紧跟的空格一起算 */
  const markOf = (from: number, to: number, owner: [number, number] = [from, to], withSpace = false) => {
    if (withSpace && doc.sliceString(to, to + 1) === ' ') to++
    if (to <= from) return
    decos.push((near(owner[0], owner[1]) ? shown : hide).range(from, to))
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
        if (skips.some(([a, b]) => node.from >= a && node.to <= b)) return false
        const name = node.name
        const h = /^ATXHeading(\d)$/.exec(name)
        if (h) {
          decos.push(line(`cm-h cm-h${h[1]}`).range(doc.lineAt(node.from).from))
          return
        }
        const parent = node.node.parent
        const own: [number, number] = parent ? [parent.from, parent.to] : [node.from, node.to]
        switch (name) {
          case 'HeaderMark':
            if (parent?.name.startsWith('ATXHeading')) markOf(node.from, node.to, undefined, true)
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
            markOf(node.from, node.to, own)
            return
          case 'InlineCode':
            decos.push(mark('cm-icode').range(node.from, node.to))
            return
          case 'CodeMark':
            if (parent?.name === 'InlineCode') markOf(node.from, node.to, own)
            return
          case 'Link': {
            decos.push(mark('cm-link').range(node.from, node.to))
            const url = node.node.getChild('URL')
            const close = node.node.lastChild
            if (url && close?.name === 'LinkMark' && near(node.from, node.to) && !near(url.from, url.to)) {
              // 光标在链接文字上：只淡淡露出 [ ]，「(网址)」收成一颗域名小块
              const open = url.from - 1
              chips.push([open, close.to])
              decos.push(Decoration.replace({ widget: new UrlChip(doc.sliceString(url.from, url.to), url.to) }).range(open, close.to))
            }
            return
          }
          case 'LinkMark':
          case 'URL':
          case 'LinkTitle':
            if (parent?.name === 'Link' && !inChip(node.from, node.to)) markOf(node.from, node.to, own)
            return
          case 'Blockquote': {
            const c = parent?.name === 'Document' ? parseCallout(doc.lineAt(node.from).text) : null
            if (c) callout(node.from, node.to, c)
            else {
              lineDeco(node.from, node.to, 'cm-quote')
              if (parent?.name === 'Document') review(node.to)
            }
            return
          }
          case 'QuoteMark':
            markOf(node.from, node.to, undefined, true)
            return
          case 'FencedCode':
            fenced(node.from, node.to)
            return false
          case 'CodeBlock':
            lineDeco(node.from, node.to, 'cm-codeblock')
            return false
          case 'ListItem': {
            // 每一级缩进 24：行首的空格藏起来，缩进交给行的左内边距
            let depth = 0
            for (let p = parent; p; p = p.parent) if (p.name === 'ListItem') depth++
            const first = doc.lineAt(node.from)
            const lead = node.from - first.from
            if (depth > 0 && lead > 0) decos.push(hide.range(first.from, node.from))
            decos.push(Decoration.line({ class: 'cm-li', attributes: { style: `--li-depth:${depth}` } }).range(first.from))
            return
          }
          case 'ListMark': {
            const task = parent?.getChild('Task')
            if (parent?.parent?.name === 'BulletList' && !task) {
              decos.push(bullet.range(node.from, node.to))
            } else if (!task) decos.push(mark('cm-listmark cm-olmark').range(node.from, node.to))
            return
          }
          case 'HorizontalRule':
            if (near(node.from, node.to)) lineDeco(node.from, node.to, 'cm-hr')
            else {
              decos.push(hide.range(node.from, node.to))
              lineDeco(node.from, node.to, 'cm-hr cm-hr-line')
            }
            return
          case 'Comment':
            // 行里的注释（导图节点记着它在照片上的哪一块）：不在光标处时连前面的空格一起藏起来
            if (doc.sliceString(node.from, node.from + 4) === '<!--') {
              const a = doc.sliceString(node.from - 1, node.from) === ' ' ? node.from - 1 : node.from
              if (!near(node.from, node.to)) decos.push(hide.range(a, node.to))
              else decos.push(shown.range(a, node.to))
            }
            return
          case 'CommentBlock':
          case 'HTMLBlock':
            if (doc.sliceString(node.from, node.from + 4) === '<!--' && !hiddenLayoutLine(doc, doc.lineAt(node.from).text)) lineDeco(node.from, node.to, 'cm-layout')
            return false
        }
        return
      },
    })

    // 双链 [[笔记]]：lezer 不认识，自己找
    const text = doc.sliceString(from, to)
    // 高亮 ==文字==（CN-67）：lezer 也不认识；代码里的不算
    for (const [a, b] of highlightsIn(text)) {
      const s = from + a
      const e = from + b
      if (s < fmEnd || inCode(s)) continue
      decos.push(mark('cm-hl').range(s + 2, e - 2))
      markOf(s, s + 2, [s, e])
      markOf(e - 2, e, [s, e])
    }
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index!
      if (start < fmEnd) continue
      const end = start + m[0].length
      const target = m[1]!.split('|')[0]!.split('#')[0]!.split('^')[0]!.trim()
      decos.push(mark('cm-wikilink', { 'data-target': target }).range(start + 2, end - 2))
      markOf(start, start + 2, [start, end])
      markOf(end - 2, end, [start, end])
    }
  }

  /**
   * 围栏代码块：--fill 底、圆角 8；光标不在块里时上下两行围栏藏起来，只当 12 高的内边距，
   * 语言名放在右上角；光标进来时围栏淡淡露出来，照样能改。
   */
  function fenced(from: number, to: number) {
    const a = doc.lineAt(from)
    const b = doc.lineAt(to)
    const editing = near(a.from, b.to)
    const m = FENCE.exec(a.text)
    const closed = b.number > a.number && FENCE.test(b.text)
    for (let n = a.number; n <= b.number; n++) {
      const l = doc.line(n)
      const cls = ['cm-codeblock']
      if (n === a.number) cls.push('cm-code-top')
      if (n === b.number) cls.push('cm-code-bot')
      const fence = n === a.number || (closed && n === b.number)
      if (fence) cls.push(editing ? 'cm-code-fence' : 'cm-code-fence cm-code-hidden')
      decos.push(line(cls.join(' ')).range(l.from))
      if (!fence || l.length === 0) continue
      if (editing) decos.push(shown.range(l.from, l.to))
      else if (n === a.number && m?.[2]) decos.push(Decoration.replace({ widget: new CodeLang(m[2]) }).range(l.from, l.to))
      else decos.push(hide.range(l.from, l.to))
    }
  }

  return Decoration.set(decos, true)
}

export const livePreview = [
  touched,
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.selectionSet ||
          u.viewportChanged ||
          u.startState.field(touched) !== u.state.field(touched) ||
          syntaxTree(u.startState) !== syntaxTree(u.state)
        )
          this.decorations = build(u.view)
      }
    },
    { decorations: (v) => v.decorations },
  ),
  EditorView.contentAttributes.of({ class: 'cm-live' }),
]
