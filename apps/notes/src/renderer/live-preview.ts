import { syntaxTree } from '@codemirror/language'
import { Prec, type Range, StateEffect, StateField } from '@codemirror/state'
import { codiconEl } from '@cn/design'
import { splitImageAlt, wikiShown } from '@cn/format'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { blockIds } from './block-id'
import { hiddenLayoutLine } from './layout-lines'
import { type CalloutHead, parseCallout } from './callout'
import { engineLogoEl, type LogoEngine } from './engine-logo'
import { highlightsIn } from './highlight'
import { hlDot } from './reading/hl-kinds'
import { linkCard } from './link-card'
import { editorHost } from './editor-host'
import { imageSrc } from './md-widgets'
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

/** 零宽的一个字：撑起一行没有看得见的字的行（行高照常、光标照常高） */
class ZeroWidth extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-zw'
    el.textContent = '\u200b'
    return el
  }
  ignoreEvent() {
    return false
  }
}
const zeroWidth = new ZeroWidth()
const line = (cls: string) => Decoration.line({ class: cls })
/** 行尾的划线注释 <!-- cn:hl=p2-h1 k=key -->：取键 */
const HL_KEY = /<!--\s*cn:hl=\S+?\s+k=([a-z][a-z0-9-]*)\s*-->/
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
    /** 不画图标（没写哪家的「AI 总结」块，task-5yp97） */
    readonly bare = false,
  ) {
    super()
  }
  eq(o: CalloutIcon) {
    return o.icon === this.icon && o.label === this.label && o.engine === this.engine && o.bare === this.bare
  }
  toDOM(view: EditorView) {
    const s = document.createElement('span')
    s.className = 'cm-callout-icon' + (this.bare ? ' bare' : '')
    if (!this.bare) s.appendChild(this.engine ? engineLogoEl(this.engine, 14) : codiconEl(this.icon, 14))
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

/**
 * 脚注（读 PDF 配对笔记旧写法里多段引用的 ①②，@cn/format reading-note.ts renderDoc；用户自己写的 [^1] 同一套）：
 * 引用 [^p1-4-3] 画成 ③（编号是标签末尾的数，和输入框里材料的 ①② 一个样子），一段末尾的定义行
 * 「[^p1-4-1]: ![粘贴的图|180](…)」画成 ① + 缩略图、「[^p1-4-3]: 「原文」 出处」画成 ③ + 引文、出处淡一号。只加装饰，文字一字不动
 */
const FOOT_DEF = /^\[\^([^\]\s]+)\]:[ \t]?/
const FOOT_REF = /\[\^([^\]\s]+)\](?!:)/g
const FOOT_IMG = /^!\[([^\]\n]*)\]\(([^)\s]+)\)\s*$/
const FOOT_QUOTE = /^(「.*」)(\s+.*)?$/
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳'
/** 标签 → 显示的记号：末尾是数（p1-4-3、1）画成圈号，别的照写标签 */
const footSign = (label: string) => {
  const n = Number(/(?:^|-)(\d+)$/.exec(label)?.[1] ?? 0)
  return n >= 1 && n <= CIRCLED.length ? CIRCLED[n - 1]! : label
}

class FootMark extends WidgetType {
  constructor(
    readonly sign: string,
    /** 定义行开头那一个 */
    readonly def: boolean,
    /** 指着看：这一条脚注写的是什么 */
    readonly tip: string,
    /** 一串引用的最后一个：和后面的字隔开 4 */
    readonly end = false,
  ) {
    super()
  }
  eq(o: FootMark) {
    return o.sign === this.sign && o.def === this.def && o.tip === this.tip && o.end === this.end
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = this.def ? 'cm-fn-sign' : this.end ? 'cm-fn-ref end' : 'cm-fn-ref'
    s.textContent = this.sign
    if (this.tip) s.title = this.tip
    return s
  }
  ignoreEvent() {
    return false
  }
}

/** 脚注定义里的图：缩略图（写着的宽，最宽 180），点了选中这一行（同文档里的图：再按退格删） */
class FootImage extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
  ) {
    super()
  }
  eq(o: FootImage) {
    return o.src === this.src && o.alt === this.alt
  }
  toDOM(view: EditorView) {
    const { caption, width } = splitImageAlt(this.alt)
    const img = document.createElement('img')
    img.className = 'cm-fn-img'
    img.alt = caption
    img.title = caption
    img.draggable = false
    img.src = this.src
    if (width) img.style.maxWidth = `${Math.min(width, 180)}px`
    img.addEventListener('error', () => img.classList.add('broken'))
    img.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      const line = view.state.doc.lineAt(view.posAtDOM(img))
      view.focus()
      view.dispatch({ selection: { anchor: line.from, head: line.to } })
    })
    return img
  }
  ignoreEvent() {
    return true
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
  /** 双链 [[笔记]] 里面那一对 [ ]（lezer 认成链接，双链自己画） */
  const inWiki = (from: number, to: number) => doc.sliceString(from - 1, from) === '[' && doc.sliceString(to, to + 1) === ']'
  /** 文里有没有「[字]: 网址」的链接定义（只在碰到光一对方括号时才看全文） */
  let defs: Set<string> | null = null
  const refDefined = (label: string) => {
    defs ??= new Set([...doc.toString().matchAll(/^ {0,3}\[([^\]\n]+)\]:/gm)].map((m) => m[1]!.trim().toLowerCase()))
    return defs.has(label.trim().toLowerCase())
  }
  /** 已经整段换成部件的范围（提示块的「> [!question] 」），里面的节点不再加装饰 */
  const skips: [number, number][] = []

  /** 提示块：整段 --fill 底的卡，第一行「> [!type] 」换成图标，AI 讲解的标题里「引擎 · 模型 · 看了什么」淡一号 */
  /** 已经画过的提示块（看得见的范围被块部件隔成几段时，同一个提示块会走到好几次；装饰加两遍，名字套两层、被截成「讲…」） */
  const calloutsDone = new Set<number>()
  /** 同上，代码块 */
  const fencedDone = new Set<number>()
  function callout(from: number, to: number, c: CalloutHead) {
    if (calloutsDone.has(from)) return
    calloutsDone.add(from)
    const a = doc.lineAt(from)
    const b = doc.lineAt(to)
    // 划成「看不懂」的问题段（ParaRead 联动）：红问号，和 PDF 上的红色波浪线一个颜色
    const tone = c.kind === 'question' && /<!--\s*cn:hl=\S+\s+k=confused\s*-->/.test(doc.sliceString(from, to)) ? 'red' : c.tone
    for (let n = a.number; n <= b.number; n++) {
      const cls = ['cm-callout', `cm-callout-${c.kind}`, `cm-tone-${tone}`]
      if (n === a.number) cls.push('cm-callout-head')
      if (n === b.number) {
        cls.push('cm-callout-bot')
        // 正文末尾回车续出的空「> 」行（还没打字）：「>」藏起来以后这一行没有字，高度是 0、光标看不见；
        // 放一个零宽的字撑成一整行，光标照常高（task-axoxy 设计复审）
        if (n > a.number && /^\s*>\s*$/.test(doc.line(n).text)) decos.push(Decoration.widget({ widget: zeroWidth, side: 1 }).range(doc.line(n).to))
      }
      // 块里隔开两段的「>」空行：「>」藏起来以后这一行没有字、高度是 0，两段挤在一起；留出段落间距（task-dtc34）
      else if (n > a.number && /^\s*>\s*$/.test(doc.line(n).text)) cls.push('cm-callout-blank')
      decos.push(line(cls.join(' ')).range(doc.line(n).from))
    }
    const end = a.from + c.prefix
    skips.push([a.from, end])
    decos.push(Decoration.replace({ widget: new CalloutIcon(c.icon, c.title ? '' : c.label, c.engine, !!c.bare) }).range(a.from, end))
    // AI 讲解的头固定两行（task-6cxtc 复审）：第一行名字「讲解一下」「你问：原话」，第二行「Claude Code · Opus 5.5 · 2.2.1 读取数据集 ↩」，
    // 中间那个「 · 」只是不画（md 一个字不变）；回到网页那一段的链接整段不断行，放不下先截小标题（省略号）、留住 ↩
    if (c.kind === 'ai' && c.title) {
      const cut = c.title.indexOf(' · ')
      const t0 = end + (a.text.slice(c.prefix).length - a.text.slice(c.prefix).trimStart().length)
      if (cut > 0) {
        const m0 = t0 + cut + 3
        // 名字一行放不下省略号（你问的原话长），指着看全
        decos.push(mark('cm-callout-name', { title: c.title.slice(0, cut) }).range(t0, t0 + cut))
        decos.push(hide.range(t0 + cut, m0))
        decos.push(mark('cm-callout-meta').range(m0, a.to))
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
            // 脚注引用 [^p1-4-3]（lezer 认成链接，下面 footnotes 画成圈号）：不当链接藏「[」「]」，不然露成「^p1-4-3」
            if (doc.sliceString(node.from, node.from + 2) === '[^') return false
            const url = node.node.getChild('URL')
            // 光一对方括号（「tensor([0, 1, 2, 3])」，task-busas）：lezer 也认成链接，可文里没有「[字]: 网址」就不是链接，原样露着
            if (!url && !node.node.getChild('LinkLabel') && !inWiki(node.from, node.to) && !refDefined(doc.sliceString(node.from + 1, node.to - 1))) return false
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
            // 提示块、引文里的代码块整块画成部件（md-widgets.ts calloutWidgets，task-83vl3、task-6cxtc），这里不再加装饰
            if (parent?.name === 'Blockquote') return false
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
      // PDF 上划的线（ParaRead 联动）：这一行行尾注释写着含义的键，荧光笔换成那种颜色；看不懂只画红色波浪线
      const k = HL_KEY.exec(doc.lineAt(s).text)?.[1]
      if (k) decos.push(Decoration.mark({ class: k === 'confused' ? 'cm-hl cm-hl-k cm-hl-wv' : 'cm-hl cm-hl-k', attributes: { style: `--hl: ${hlDot(k)}`, 'data-k': k } }).range(s + 2, e - 2))
      else decos.push(mark('cm-hl').range(s + 2, e - 2))
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
      // data-wiki：整截（带 #标题、#^块），⌘点时滚到那里（task-3e53q）
      decos.push(mark('cm-wikilink', { 'data-target': target, 'data-wiki': m[1]! }).range(start + 2 + shown.from, start + 2 + shown.to))
      markOf(start, start + 2 + shown.from)
      markOf(start + 2 + shown.to, end)
    }
    footnotes(from, to)
  }

  /** 脚注：定义行、引用（见 FootMark 上面的说明）；代码里的不算 */
  function footnotes(from: number, to: number) {
    if (!doc.sliceString(from, to).includes('[^')) return
    const all = doc.toString()
    const tips = new Map<string, string>()
    for (const m of all.matchAll(/^\[\^([^\]\s]+)\]:[ \t]?(.*)$/gm)) {
      const im = FOOT_IMG.exec(m[2]!)
      tips.set(m[1]!, im ? splitImageAlt(im[1]!).caption || '图' : m[2]!.trim())
    }
    const path = state.facet(editorHost).path()
    for (let n = doc.lineAt(from).number, last = doc.lineAt(to).number; n <= last; n++) {
      const l = doc.line(n)
      if (l.from < fmEnd || !l.text.includes('[^') || inCode(l.from)) continue
      const d = FOOT_DEF.exec(l.text)
      let refFrom = 0
      if (d) {
        const prev = n > 1 ? doc.line(n - 1).text : ''
        decos.push(line(FOOT_DEF.test(prev) ? 'cm-fn' : 'cm-fn cm-fn-first').range(l.from))
        const body = l.from + d[0].length
        decos.push(Decoration.replace({ widget: new FootMark(footSign(d[1]!), true, '') }).range(l.from, body))
        const rest = l.text.slice(d[0].length)
        const im = FOOT_IMG.exec(rest)
        const q = im ? null : FOOT_QUOTE.exec(rest)
        if (im) {
          decos.push(Decoration.replace({ widget: new FootImage(imageSrc(path, im[2]!), im[1]!) }).range(body, l.to))
          continue
        }
        if (q) {
          decos.push(mark('cm-fn-quote').range(body, body + q[1]!.length))
          if (q[2]) decos.push(mark('cm-fn-src').range(body + q[1]!.length, l.to))
        }
        refFrom = d[0].length
      }
      for (const m of l.text.slice(refFrom).matchAll(FOOT_REF)) {
        const s = l.from + refFrom + m.index!
        if (inCode(s)) continue
        const after = l.text.slice(s - l.from + m[0].length)
        decos.push(Decoration.replace({ widget: new FootMark(footSign(m[1]!), false, tips.get(m[1]!) ?? '', !!after && !after.startsWith('[^')) }).range(s, s + m[0].length))
      }
    }
  }

  /**
   * 围栏代码块：--fill 底、圆角 8；上下两行围栏永远藏起来，只当 12 高的内边距（光标进不去，wysiwyg.ts），
   * 语言名放在右上角。提示块里的代码块是 md-widgets.ts 的 calloutWidgets 整块画（上面 FencedCode 那里就跳过了）
   */
  function fenced(from: number, to: number) {
    if (fencedDone.has(from)) return
    fencedDone.add(from)
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

/**
 * [!ai] 块头第二行放不下时（task-6cxtc 复审）：回到网页那一段的链接整段不断行，先截小标题（省略号）、留住 ↩。
 * 链接的字得是一整段（点「↩」、按字找都靠它），所以不拆开画：量出这一行超出多少，给最后几个链接外面套一层
 * 有最宽的 .cm-cut（字尾省略号，↩ 由 ::after 画在右端，editor-blocks.css）。CodeMirror 管着的 DOM 不能直接改，
 * 量好的宽度走一个装饰（fitField）
 */
const setFit = StateEffect.define<{ from: number; to: number; w: number }[]>()
const fitField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(v, tr) {
    v = v.map(tr.changes)
    for (const e of tr.effects)
      if (e.is(setFit)) v = Decoration.set(e.value.map((c) => Decoration.mark({ class: 'cm-cut', attributes: { style: `max-width:${c.w}px` } }).range(c.from, c.to)), true)
    return v
  },
  // 优先级高的套在里面：套在链接里面，不把块头第二行拆开（低了会套在外面，把第二行拆成两截）
  provide: (f) => Prec.highest(EditorView.decorations.from(f)),
})

const calloutFit = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {
      this.fit()
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.geometryChanged || u.transactions.some((t) => t.effects.some((e) => e.is(setFit)))) this.fit()
    }
    fit() {
      this.view.requestMeasure({
        read: (view) => {
          const out: { from: number; to: number; w: number }[] = []
          for (const meta of view.contentDOM.querySelectorAll<HTMLElement>('.cm-callout-meta')) {
            const links = [...meta.querySelectorAll<HTMLElement>('.cm-link')].filter((l) => /↩\s*$/.test(l.textContent ?? ''))
            if (!links.length) continue
            const pad = parseFloat(getComputedStyle(meta).fontSize) * 1.4
            // 截着的（链接里面套着 .cm-cut）：整段的宽是 scrollWidth 减去给 ↩ 的内边距；没截的就是链接自己的宽
            const cutOf = (l: HTMLElement) => l.querySelector<HTMLElement>('.cm-cut')
            const now = links.map((l) => l.getBoundingClientRect().width)
            const natural = links.map((l, i) => {
              const c = cutOf(l)
              return c ? c.scrollWidth - pad : now[i]!
            })
            // 链接以外的字（「Claude Code · Opus 5.5 · 」、几个链接之间的「 · 」）：从这一行左边量到每个链接
            const rects = links.map((l) => l.getBoundingClientRect())
            let other = rects[0]!.left - (meta.getBoundingClientRect().left + meta.clientLeft)
            for (let i = 1; i < rects.length; i++) other += rects[i]!.left - rects[i - 1]!.right
            let over = other + natural.reduce((s, w) => s + w, 0) - meta.clientWidth
            for (let i = links.length - 1; i >= 0 && over > 0; i--) {
              const keep = Math.max(pad * 2, Math.floor(natural[i]! - over - 1))
              over -= natural[i]! - keep
              const from = view.posAtDOM(links[i]!, 0)
              // 最宽量的是字（content-box），右边还有给 ↩ 的内边距
              out.push({ from, to: from + (links[i]!.textContent ?? '').length, w: Math.max(pad, keep - pad) })
            }
          }
          return out.sort((a, b) => a.from - b.from)
        },
        write: (out, view) => {
          const cur: { from: number; to: number; w: number }[] = []
          view.state.field(fitField).between(0, view.state.doc.length, (from, to, d) => void cur.push({ from, to, w: parseFloat(/max-width:([\d.]+)/.exec(String(d.spec.attributes?.style))?.[1] ?? '0') }))
          if (JSON.stringify(cur) === JSON.stringify(out)) return
          // 量的时候不能发改动：等这一轮量完
          queueMicrotask(() => view.dispatch({ effects: setFit.of(out) }))
        },
      })
    }
  },
)

export const livePreview = [mathPreview, reviewExtension, livePlugin, fitField, calloutFit, blockIds, linkCard, EditorView.contentAttributes.of({ class: 'cm-live' })]
