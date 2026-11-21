import { syntaxTree } from '@codemirror/language'
import type { Range } from '@codemirror/state'
import { codiconEl } from '@cn/design'
import { wikiShown } from '@cn/format'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { hiddenLayoutLine } from './layout-lines'
import { type CalloutHead, parseCallout } from './callout'
import { engineLogoEl, type LogoEngine } from './engine-logo'
import { highlightsIn } from './highlight'
import { linkCard } from './link-card'
import { mathPreview, mathSpans, touched } from './math-preview'
import { reviewDecos, reviewExtension } from './review'

/**
 * 文档模式的所见即所得（文档方向 A「块上露写法」，2026-11-17 用户定）：记号（# ** * ` > [[ ]] - ``` ==）永远藏着，
 * 光标停在旁边、拖选一段也不露，选中前后每一行的宽高都不变（CN-65、CN-68）。列表圆点永远是圆点。
 * 链接只画下划线，后面什么都不露（2026-11-21 cmdk 方案 A，CN-58 的常显域名小块拿掉了）；指着出链接卡，看网址、改链接都在卡上（link-card.tsx）。
 * 藏起来的行内记号是「原子」的（光标一下跨过去，wysiwyg.ts 让 ←→ 不白按、退格删的是看得见的字）。
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

/** 提示块第一行开头的图标（没写标题时后面带上类型名） */
class CalloutIcon extends WidgetType {
  constructor(
    readonly icon: Parameters<typeof codiconEl>[0],
    readonly label: string,
    /** AI 讲解：写它的那一家（画它的标志） */
    readonly engine: LogoEngine | null = null,
  ) {
    super()
  }
  eq(o: CalloutIcon) {
    return o.icon === this.icon && o.label === this.label && o.engine === this.engine
  }
  toDOM(view: EditorView) {
    const s = document.createElement('span')
    s.className = 'cm-callout-icon'
    s.appendChild(this.engine ? engineLogoEl(this.engine, 14) : codiconEl(this.icon, 14))
    if (this.label) {
      const t = document.createElement('span')
      t.className = 'cm-callout-label'
      t.textContent = this.label
      s.appendChild(t)
    }
    // 点图标（和没写标题时的类型名）：光标放在标题字最前面。第 6 轮：浏览器自己把光标放进部件里，
    // CodeMirror 量出来是第 0 个字，打的字跑到整篇最前面、标题成了正文，页面滚到最上面
    s.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const line = view.state.doc.lineAt(view.posAtDOM(s))
      const c = parseCallout(line.text)
      view.focus()
      view.dispatch({ selection: { anchor: line.from + (c?.prefix ?? 0) }, userEvent: 'select.pointer' })
    })
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


function build(view: EditorView): DecorationSet {
  const { state } = view
  const doc = state.doc
  const decos: Range<Decoration>[] = []
  /** 链接里整段藏起来的「](网址)」，里面的记号不再单独加装饰 */
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
    decos.push(Decoration.replace({ widget: new CalloutIcon(c.icon, c.title ? '' : c.label, c.engine) }).range(a.from, end))
    if (c.kind === 'ai' && c.title) {
      const cut = c.title.indexOf(' · ')
      const t0 = end + (a.text.slice(c.prefix).length - a.text.slice(c.prefix).trimStart().length)
      if (cut > 0) {
        decos.push(mark('cm-callout-name').range(t0, t0 + cut))
        decos.push(mark('cm-callout-meta').range(t0 + cut, a.to))
      }
    }
  }

  const lineDeco = (from: number, to: number, cls: string) => {
    for (let n = doc.lineAt(from).number; n <= doc.lineAt(to).number; n++) decos.push(line(cls).range(doc.line(n).from))
  }
  /** 记号：一律藏起来（后面紧跟的空格一起算） */
  const markOf = (from: number, to: number, withSpace = false) => {
    if (withSpace && doc.sliceString(to, to + 1) === ' ') to++
    if (to <= from) return
    decos.push(hide.range(from, to))
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
        switch (name) {
          case 'HeaderMark':
            if (parent?.name.startsWith('ATXHeading')) markOf(node.from, node.to, true)
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
            markOf(node.from, node.to)
            return
          case 'InlineCode':
            decos.push(mark('cm-icode').range(node.from, node.to))
            return
          case 'CodeMark':
            if (parent?.name === 'InlineCode') markOf(node.from, node.to)
            return
          case 'Link': {
            const url = node.node.getChild('URL')
            const close = node.node.lastChild
            // 链接的字（「[」后面到「]」前面）；「[」「](网址)」另外藏
            const textEnd = url ? url.from - 2 : node.to
            if (textEnd > node.from + 1) decos.push(mark('cm-link').range(node.from + 1, textEnd))
            if (url && close?.name === 'LinkMark') {
              // 「](网址)」整段藏起来，后面什么都不露（cmdk 方案 A：CN-58 的常显域名小块拿掉了）；看网址、改网址在链接卡上（link-card.tsx）
              chips.push([url.from - 2, close.to])
              decos.push(hide.range(url.from - 2, close.to))
            }
            return
          }
          case 'LinkMark':
          case 'URL':
          case 'LinkTitle':
            if (parent?.name === 'Link' && !inChip(node.from, node.to)) markOf(node.from, node.to)
            return
          case 'Blockquote': {
            const c = parent?.name === 'Document' ? parseCallout(doc.lineAt(node.from).text) : null
            if (c) callout(node.from, node.to, c)
            else lineDeco(node.from, node.to, 'cm-quote')
            return
          }
          case 'QuoteMark':
            markOf(node.from, node.to, true)
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
            decos.push(hide.range(node.from, node.to))
            lineDeco(node.from, node.to, 'cm-hr cm-hr-line')
            return
          case 'Escape':
            // \$ 是普通的美元符号（task-o48fa）：反斜杠和别的记号一样藏起来，只露 $
            if (doc.sliceString(node.from, node.to) === '\\$') markOf(node.from, node.from + 1)
            return
          case 'Comment':
            // 行里的注释（导图节点记着它在照片上的哪一块）：连前面的空格一起藏起来
            if (doc.sliceString(node.from, node.from + 4) === '<!--') {
              const a = doc.sliceString(node.from - 1, node.from) === ' ' ? node.from - 1 : node.from
              decos.push(hide.range(a, node.to))
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
      markOf(s, s + 2)
      markOf(e - 2, e)
    }
    for (const m of text.matchAll(WIKILINK)) {
      const start = from + m.index!
      if (start < fmEnd) continue
      const end = start + m[0].length
      const target = m[1]!.split('|')[0]!.split('#')[0]!.split('^')[0]!.trim()
      // 只露别名或笔记名（[[课程/ecp/第五讲]] 露「第五讲」），前面的路径、「|」和 .md 跟 [[ ]] 一起藏着，白板卡上同一个认法
      const shown = wikiShown(m[1]!)
      decos.push(mark('cm-wikilink', { 'data-target': target }).range(start + 2 + shown.from, start + 2 + shown.to))
      markOf(start, start + 2 + shown.from)
      markOf(start + 2 + shown.to, end)
    }
  }

  /**
   * 围栏代码块：--fill 底、圆角 8；上下两行围栏永远藏起来，只当 12 高的内边距（光标进不去，wysiwyg.ts），
   * 语言名放在右上角。
   */
  function fenced(from: number, to: number) {
    const a = doc.lineAt(from)
    const b = doc.lineAt(to)
    const m = FENCE.exec(a.text)
    const closed = b.number > a.number && FENCE.test(b.text)
    // 还没收尾（正在打的「```」，回车才补收尾，wysiwyg.ts）：围栏照原样露着，打的字看得见
    const editing = !closed
    const head = state.selection.main.head
    const inside = head >= a.from && head <= b.to
    for (let n = a.number; n <= b.number; n++) {
      const l = doc.line(n)
      const cls = ['cm-codeblock']
      if (n === a.number) cls.push(inside ? 'cm-code-top cm-code-on' : 'cm-code-top')
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

  // 引文下面挂着的「我的评价」「微信读书的想法」：标签小块、弯钩（review.ts）
  reviewDecos(state, view.visibleRanges, decos)
  // 公式（math-preview.ts）里的字不是 md：「$x_i$, $\mathbf{x}_i$」中间那截 _…_ 不当斜体，公式里的 * [ ] 不藏。
  // 和公式沾边又没整个包住它的装饰都不要（整个包住的照旧：**$x$** 加粗）
  const spans = mathSpans(state).map((m) => (m.block ? { a: doc.lineAt(m.from).from, b: doc.lineAt(m.to).to, block: true } : { a: m.from, b: m.to, block: false }))
  const clash = (d: Range<Decoration>) =>
    spans.some((m) => (d.from === d.to ? m.block && d.from >= m.a && d.from <= m.b : d.from < m.b && d.to > m.a && !(d.from <= m.a && d.to >= m.b)))
  return Decoration.set(spans.length ? decos.filter((d) => !clash(d)) : decos, true)
}

/** 藏起来的行内记号、换成部件的那几段（域名小块、圆点、提示块图标）：光标一下跨过去（原子） */
function atomicOf(decos: DecorationSet): DecorationSet {
  const out: Range<Decoration>[] = []
  const it = decos.iter()
  for (; it.value; it.next()) if (it.to > it.from && it.value.point) out.push(it.value.range(it.from, it.to))
  return Decoration.set(out, true)
}

export const livePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    atomic: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
      this.atomic = atomicOf(this.decorations)
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        u.startState.field(touched) !== u.state.field(touched) ||
        syntaxTree(u.startState) !== syntaxTree(u.state)
      ) {
        this.decorations = build(u.view)
        this.atomic = atomicOf(this.decorations)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.atomic ?? Decoration.none),
  },
)

export const livePreview = [mathPreview, reviewExtension, livePlugin, linkCard, EditorView.contentAttributes.of({ class: 'cm-live' })]
