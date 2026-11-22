/**
 * 引文下面的评价（CN-38 方案 B 的样子，CN-121 方向 A「悬停出写评价」，小样 proposals2/D-读书与AI入口/v2/review/proto-a.html）：
 * - 引文下面隔一个空行、以「我的评价：」或「微信读书的想法：」开头的一段挂在这条引文上：标签画成小块（文件里的冒号藏起来），
 *   从引文竖线拐下来一道弯钩连到它；一条引文下面可以挂好几段（微信读书的想法在前，我的评价在后）。
 * - 鼠标移到一条还没挂评价、想法的引文上，右下角出一颗「写评价」；点了在下面开一段「我的评价」，光标就在里面（灰字「写下你对这一段的看法…」）。
 *   回车写完，光标落到下面新的一段；什么都没写按 esc、点别处，这一段消失，不留空标签。光标在引文里按 ⌘↵、紧跟在引文后面按 Tab 也能开（Tab 开的空评价按 ⇧Tab 撤掉，task-busas）。
 * - 没写评价的引文下面什么都不多（偏好 `引用别塞评价占位`）。
 * 存进文件就是引文下面一段普通文字「我的评价：…」，Obsidian 里也看得懂。标签那几个字是藏起来的语法（hidden-syntax）：打字、删除碰不到，光标停不进去。
 */
import { codiconEl } from '@cn/design'
import { syntaxTree } from '@codemirror/language'
import { type EditorState, Prec, type Range, StateEffect, StateField, type Text, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { isBookDigest } from '../shared/plugins/weread'
import { blankGlue, type Hidden, hiddenOk, hiddenSyntax } from './hidden-syntax'
import './review.css'

export const REVIEW_TAG = '我的评价'
export const THOUGHT_TAG = '微信读书的想法'
export const REVIEW_PLACEHOLDER = '写下你对这一段的看法…'

type Kind = 'me' | 'wr'

/** 挂在引文下面的一段 */
export interface Attached {
  kind: Kind
  /** 标签所在那一行的行首 */
  from: number
  /** 标签（连加粗记号、冒号、后面的空格）的末尾：正文从这里开始 */
  tagTo: number
  /** 这一段最后一行的末尾 */
  to: number
  /** 标签后面什么都没写 */
  empty: boolean
  /** 这一段第二行起（同一段里接着写的几行）的行首 */
  cont: number[]
}

/** 一条引文和挂在它下面的几段 */
export interface QuoteGroup {
  /** 引文第一行行首、最后一行（连来源行）行尾 */
  from: number
  to: number
  /** 引文最后一行的行首（「写评价」挂在这一行右下角） */
  lastLine: number
  /** 隔开的空行的行首：第一个在引文和第一段之间，后面的在两段之间 */
  gaps: number[]
  items: Attached[]
}

const TAG = /^(\*\*)?(我的评价|微信读书的想法)(\*\*)?([：:])?(\*\*)?[ \t]*/
const QUOTE = /^ {0,3}>/
const CALLOUT = /^ {0,3}>\s*\[!/
/** 起一个新块的行（引文后面紧跟着它就不是引文的续行） */
const BLOCK = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|`{3,}|~{3,}|<!--|\|)/
const FENCE = /^\s*(`{3,}|~{3,})/

/** 这一行是不是以评价、想法的标签开头：哪种、标签多长。「微信读书的想法」要带冒号；「我的评价」没冒号也认（CN-38 的写法） */
export function tagOf(text: string): { kind: Kind; len: number } | null {
  const m = TAG.exec(text)
  if (!m) return null
  const wr = m[2] === THOUGHT_TAG
  if (wr && !m[4]) return null
  return { kind: wr ? 'wr' : 'me', len: m[0].length }
}

/** 一段的第二行起（同一段里接着写的几行），直到空行、新块、另一段标签 */
function paraEnd(doc: Text, first: number, cont: number[]): number {
  let end = first
  while (end + 1 <= doc.lines) {
    const t = doc.line(end + 1).text
    if (!t.trim() || BLOCK.test(t) || QUOTE.test(t) || tagOf(t)) break
    end++
    cont.push(doc.line(end).from)
  }
  return end
}

function item(doc: Text, n: number, tag: { kind: Kind; len: number }): { it: Attached; end: number } {
  const tl = doc.line(n)
  const cont: number[] = []
  const end = paraEnd(doc, n, cont)
  return { it: { kind: tag.kind, from: tl.from, tagTo: tl.from + tag.len, to: doc.line(end).to, empty: !tl.text.slice(tag.len).trim() && !cont.length, cont }, end }
}

export interface Reviews {
  /** 引文和挂在它下面的几段 */
  groups: QuoteGroup[]
  /** 没挂在引文下面、自己起一段的「我的评价：」「微信读书的想法：」（引文删了、中间插了一段）：照样画标签，不画弯钩 */
  solo: Attached[]
}

/**
 * 整篇里每条引文（不算提示块、代码里的）和挂在它下面的几段，还有自己起一段的标签段；
 * 按字一行一行看，不靠语法树（长文档没解析完也认得全）
 */
export function scanReviews(doc: Text): Reviews {
  const groups: QuoteGroup[] = []
  const solo: Attached[] = []
  let n = 1
  if (doc.lines > 1 && doc.line(1).text === '---') {
    let k = 2
    while (k <= doc.lines && doc.line(k).text !== '---') k++
    if (k <= doc.lines) n = k + 1
  }
  const body = n
  let fence: string | null = null
  while (n <= doc.lines) {
    const l = doc.line(n)
    const f = FENCE.exec(l.text)
    if (fence) {
      if (f && l.text.trim().startsWith(fence)) fence = null
      n++
      continue
    }
    if (f) {
      fence = f[1]!
      n++
      continue
    }
    if (!QUOTE.test(l.text) || CALLOUT.test(l.text)) {
      // 自己起一段的标签段：上面是空行、标题或者正文开头，标签带冒号
      const tag = tagOf(l.text)
      const prev = n > body ? doc.line(n - 1).text : ''
      if (tag && /[：:]/.test(l.text.slice(0, tag.len)) && (n === body || !prev.trim() || /^#{1,6}\s/.test(prev))) {
        const { it, end } = item(doc, n, tag)
        solo.push(it)
        n = end + 1
      } else n++
      continue
    }
    // 引文：连着的「>」行，和后面不空、不起新块的行（剪进来的来源行「—— [..](..)」是懒续行）
    let last = n
    while (last + 1 <= doc.lines) {
      const t = doc.line(last + 1).text
      if (!t.trim() || (!QUOTE.test(t) && BLOCK.test(t)) || CALLOUT.test(t)) break
      last++
    }
    const g: QuoteGroup = { from: l.from, to: doc.line(last).to, lastLine: doc.line(last).from, gaps: [], items: [] }
    let k = last + 1
    // 隔一个空行、以标签开头的一段就挂上；一段接一段
    while (k + 1 <= doc.lines && !doc.line(k).text.trim()) {
      const tag = tagOf(doc.line(k + 1).text)
      if (!tag) break
      const { it, end } = item(doc, k + 1, tag)
      g.gaps.push(doc.line(k).from)
      g.items.push(it)
      k = end + 1
    }
    groups.push(g)
    n = Math.max(k, last + 1)
  }
  return { groups, solo }
}

/** 每条引文和挂着的几段、自己起一段的标签段：文字变了才重认 */
export const reviewGroups = StateField.define<Reviews>({
  create: (s) => scanReviews(s.doc),
  update: (v, tr) => (tr.docChanged ? scanReviews(tr.state.doc) : v),
})

const reviewsOf = (state: EditorState): Reviews => state.field(reviewGroups, false) ?? { groups: [], solo: [] }
const groupAt = (state: EditorState, pos: number) => reviewsOf(state).groups.find((g) => pos >= g.from && pos <= g.to) ?? null
const itemAt = (state: EditorState, pos: number): { g: QuoteGroup | null; it: Attached } | null => {
  const r = reviewsOf(state)
  for (const g of r.groups) for (const it of g.items) if (pos >= it.from && pos <= it.to) return { g, it }
  for (const it of r.solo) if (pos >= it.from && pos <= it.to) return { g: null, it }
  return null
}
const allItems = (state: EditorState) => {
  const r = reviewsOf(state)
  return [...r.groups.flatMap((g) => g.items), ...r.solo]
}

// ---------------------------------------------------------------- 画

/** 标签小块：「我的评价」「微信读书的想法」（文件里的冒号藏起来，小样 .rtag） */
class ReviewTag extends WidgetType {
  constructor(readonly kind: Kind) {
    super()
  }
  eq(o: ReviewTag) {
    return o.kind === this.kind
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-review-tag' + (this.kind === 'wr' ? ' wr' : '')
    s.textContent = this.kind === 'wr' ? THOUGHT_TAG : REVIEW_TAG
    return s
  }
  ignoreEvent() {
    return false
  }
}

/** 还没写字的评价：灰字「写下你对这一段的看法…」 */
class ReviewPlaceholder extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-review-ph'
    s.textContent = REVIEW_PLACEHOLDER
    s.setAttribute('aria-hidden', 'true')
    return s
  }
  ignoreEvent() {
    return false
  }
}

const line = (cls: string) => Decoration.line({ class: cls })

/** 挂在引文下面的几段的样子：在可见范围里的才画 */
export function reviewDecos(state: EditorState, ranges: readonly { from: number; to: number }[], decos: Range<Decoration>[]) {
  const doc = state.doc
  const seen = (from: number, to: number) => ranges.some((r) => r.from <= to && r.to >= from)
  const tag = (it: Attached, cls: string) => {
    decos.push(line(cls + (it.kind === 'wr' ? ' cm-review-wr' : '')).range(it.from))
    decos.push(Decoration.replace({ widget: new ReviewTag(it.kind) }).range(it.from, it.tagTo))
    if (it.empty && doc.lineAt(it.from).to === it.tagTo) decos.push(Decoration.widget({ widget: new ReviewPlaceholder(), side: 1 }).range(it.tagTo))
    for (const c of it.cont) decos.push(line(cls === 'cm-review' ? 'cm-review-cont' : 'cm-review-solo-cont').range(c))
  }
  const r = reviewsOf(state)
  for (const g of r.groups) {
    if (!g.items.length || !seen(g.from, g.items[g.items.length - 1]!.to)) continue
    g.items.forEach((it, i) => {
      decos.push(line(i === 0 ? 'cm-review-gap' : 'cm-review-gap cm-review-gap2').range(g.gaps[i]!))
      tag(it, 'cm-review')
    })
  }
  for (const it of r.solo) if (seen(it.from, it.to)) tag(it, 'cm-review-solo')
  if (state.field(bookDigest, false)) digestGaps(state, ranges, decos)
}

// ---------------------------------------------------------------- 书摘的疏密（照小样：块和块之间不空整整一行）

/** 这篇是不是微信读书同步来的书摘：是的话正文照小样的疏密排（cm-digest） */
const bookDigest = StateField.define<boolean>({
  create: (s) => isBookDigest(s.doc.sliceString(0, Math.min(s.doc.length, 20000))),
  update: (v, tr) => (tr.docChanged ? isBookDigest(tr.state.doc.sliceString(0, Math.min(tr.state.doc.length, 20000))) : v),
})

const HEADING = /^#{1,6}\s/

/**
 * 书摘里块和块之间隔的那一个空行压矮（小样：两段之间 12，评价、想法下面 14，章节标题上面 26、下面 10；
 * 引文和评价之间的 8、10 在上面画）。光标停在这一行时照常一整行高，好在这里打字。只改样子，不动文字
 */
function digestGaps(state: EditorState, ranges: readonly { from: number; to: number }[], decos: Range<Decoration>[]) {
  const doc = state.doc
  const review = new Set(reviewsOf(state).groups.flatMap((g) => g.gaps))
  const ends = new Set(allItems(state).map((it) => doc.lineAt(it.to).number))
  const caret = doc.lineAt(state.selection.main.head).number
  const body = doc.lines > 1 && doc.line(1).text === '---' ? (() => {
    for (let k = 2; k <= doc.lines; k++) if (doc.line(k).text === '---') return k + 1
    return 1
  })() : 1
  for (const { from, to } of ranges) {
    for (let n = Math.max(body + 1, doc.lineAt(from).number); n <= doc.lineAt(to).number && n < doc.lines; n++) {
      const l = doc.line(n)
      if (l.text !== '' || n === caret || review.has(l.from)) continue
      const prev = doc.line(n - 1).text
      const next = doc.line(n + 1).text
      if (!prev.trim() || !next.trim()) continue
      const cls = HEADING.test(next) ? 'cm-dg-gap cm-dg-h' : HEADING.test(prev) ? 'cm-dg-gap cm-dg-ah' : ends.has(n - 1) ? 'cm-dg-gap cm-dg-r' : 'cm-dg-gap'
      decos.push(line(cls).range(l.from))
    }
  }
}

// ---------------------------------------------------------------- 写评价：悬停的按钮、⌘↵、开一段

const setHover = StateEffect.define<number | null>()

/** 鼠标停在哪条引文上（引文第一行行首）；没停在能写评价的引文上是 null */
const hoverField = StateField.define<number | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setHover)) return e.value
    return v === null || !tr.docChanged ? v : tr.changes.mapPos(v, 1)
  },
})

/** 能不能给这一条写评价：还没挂评价、想法的才行（已有的点评价本身就能改） */
const canReview = (g: QuoteGroup | null): g is QuoteGroup => !!g && g.items.length === 0

class ReviewButton extends WidgetType {
  constructor(readonly at: number) {
    super()
  }
  eq(o: ReviewButton) {
    return o.at === this.at
  }
  toDOM(view: EditorView) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cm-review-btn'
    b.setAttribute('aria-label', '写评价')
    b.append(codiconEl('comment', 13), document.createTextNode('写评价'))
    // 点它不挪光标、不让编辑器先拿到这一下
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    b.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      const g = groupAt(view.state, view.state.field(hoverField) ?? -1)
      if (g) openReview(view, g)
    })
    return b
  }
  ignoreEvent() {
    return true
  }
}

const hoverDecos = EditorView.decorations.compute([hoverField, reviewGroups], (state) => {
  const at = state.field(hoverField)
  const g = at === null ? null : groupAt(state, at)
  if (!canReview(g) || state.readOnly) return Decoration.none
  return Decoration.set([Decoration.widget({ widget: new ReviewButton(g.from), side: 1 }).range(state.doc.lineAt(g.lastLine).to)])
})

/** 鼠标移到引文上：记下是哪一条（按钮画在它最后一行右下角）；移开、按着键拖选时不出 */
const hoverWatch = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    set(v: number | null) {
      if (this.view.state.field(hoverField) !== v) this.view.dispatch({ effects: setHover.of(v) })
    }
  },
  {
    eventHandlers: {
      mousemove(e) {
        if (e.buttons || this.view.state.readOnly) return this.set(null)
        if ((e.target as Element | null)?.closest?.('.cm-review-btn')) return
        const pos = this.view.posAtCoords({ x: e.clientX, y: e.clientY }, false)
        const g = groupAt(this.view.state, pos)
        // 只认真的停在引文那几行上（行尾右边的空白也算，按钮就在那里）
        const inQuote = canReview(g) && (e.target as Element | null)?.closest?.('.cm-quote')
        this.set(inQuote ? g.from : null)
      },
      mouseleave() {
        this.set(null)
      },
    },
  },
)

/**
 * 给这条引文开一段「我的评价」：插在引文（连同它下面的微信读书的想法）后面，隔一个空行；光标放进去（标签后面）。
 * 已经有我的评价：光标放到那一段末尾。开的这一下不进撤销（不写就走开时它自己消失）
 */
export function openReview(view: EditorView, g: QuoteGroup) {
  const me = g.items.find((it) => it.kind === 'me')
  // 点「写评价」时焦点可能在别处（右栏网页）：拿回来
  if (view.dom?.isConnected) view.focus()
  if (me) {
    view.dispatch({ selection: { anchor: me.to }, scrollIntoView: true, userEvent: 'select' })
    return
  }
  const doc = view.state.doc
  const at = g.items.length ? g.items[g.items.length - 1]!.to : g.to
  // 后面紧挨着就是下一块（只隔一个换行）：再补一个换行，评价和它之间空一行
  const tight = doc.sliceString(at, at + 1) === '\n' && at + 1 < doc.length && doc.sliceString(at + 1, at + 2) !== '\n'
  const insert = `\n\n${REVIEW_TAG}：` + (tight ? '\n' : '')
  const caret = at + 2 + REVIEW_TAG.length + 1
  view.dispatch({
    changes: { from: at, insert },
    selection: { anchor: caret },
    annotations: [Transaction.addToHistory.of(false), hiddenOk.of(true)],
    userEvent: 'input.review',
    scrollIntoView: true,
    effects: setHover.of(null),
  })
}

/** 空着的评价（只有标签）整段去掉，连同上面隔开的空行；返回去掉了没有 */
function dropEmpty(view: EditorView, it: Attached, caretTo?: number): boolean {
  const doc = view.state.doc
  if (!it.empty) return false
  const from = doc.sliceString(it.from - 2, it.from) === '\n\n' ? it.from - 2 : Math.max(0, it.from - 1)
  view.dispatch({
    changes: { from, to: it.to },
    ...(caretTo !== undefined ? { selection: { anchor: Math.min(caretTo, from) } } : {}),
    annotations: [Transaction.addToHistory.of(false), hiddenOk.of(true)],
    userEvent: 'delete.review',
  })
  return true
}

/** / 菜单、AI 写一段开着：回车、esc 归它们 */
const menuOpen = (view: EditorView) => !!view.dom?.ownerDocument.querySelector('.slash-menu, .slash-ai')

/** 光标停在一段评价、想法的哪里（没选中字时） */
function caretItem(state: EditorState) {
  const sel = state.selection.main
  if (!sel.empty) return null
  const hit = itemAt(state, sel.head)
  return hit && sel.head >= hit.it.tagTo ? hit : null
}

/** 回车：评价写完了，光标落到下面新的一段；什么都没写就去掉这一段，光标落到引文下面新的一段（小样 paraAfter） */
function enterInReview(view: EditorView): boolean {
  if (view.state.readOnly || menuOpen(view)) return false
  const hit = caretItem(view.state)
  if (!hit) return false
  const { it } = hit
  if (it.empty) {
    // 标签去掉，这一行留成空行，光标在这一行（引文下面新的一段）
    view.dispatch({ changes: { from: it.from, to: it.to }, selection: { anchor: it.from }, annotations: [Transaction.addToHistory.of(false), hiddenOk.of(true)], userEvent: 'delete.review', scrollIntoView: true })
    return true
  }
  view.dispatch({ changes: { from: it.to, insert: '\n\n' }, selection: { anchor: it.to + 2 }, userEvent: 'input', scrollIntoView: true })
  return true
}

/** 回车：光标在挂着评价、想法的引文末尾：新的一段开在这一组后面，不插进引文和评价中间（插进去评价就和引文断开了） */
function enterAfterGroup(view: EditorView): boolean {
  if (view.state.readOnly || menuOpen(view)) return false
  const sel = view.state.selection.main
  if (!sel.empty) return false
  const g = groupAt(view.state, sel.head)
  if (!g || !g.items.length || sel.head !== g.to) return false
  const end = g.items[g.items.length - 1]!.to
  view.dispatch({ changes: { from: end, insert: '\n\n' }, selection: { anchor: end + 2 }, userEvent: 'input', scrollIntoView: true })
  return true
}

/** esc：离开这一段（没写字的随即消失） */
function escInReview(view: EditorView): boolean {
  if (menuOpen(view) || !caretItem(view.state)) return false
  view.contentDOM?.blur()
  return true
}

/** 退格：光标在标签后面、评价空着：整段去掉，光标回到上面那段末尾；有字时标签不跟着删 */
function backspaceInReview(view: EditorView): boolean {
  if (view.state.readOnly) return false
  const hit = caretItem(view.state)
  if (!hit || view.state.selection.main.head !== hit.it.tagTo) return false
  if (hit.it.empty) dropEmpty(view, hit.it, hit.it.from)
  return true
}

/**
 * Tab 写评价（task-busas）：光标紧跟在哪条引文（剪进来的摘录）后面。算紧跟的：光标在引文里（不算提示块），
 * 或者在它（连同挂着的评价、想法）下面、中间至多隔一个空行、还没打字的空行上（剪进来以后光标就停在这里）。
 * 回车再起一行（隔了两个空行）就不算了，Tab 是普通的缩进
 */
export function quoteForTab(state: EditorState): QuoteGroup | null {
  const sel = state.selection.main
  if (!sel.empty) return null
  const groups = reviewsOf(state).groups.filter((g) => isExcerpt(state, g))
  const inside = groups.find((g) => sel.head >= g.from && sel.head <= g.to)
  if (inside) return inside
  const doc = state.doc
  const at = doc.lineAt(sel.head)
  if (at.text.trim()) return null
  for (let n = at.number - 1, blanks = 0; n >= 1 && blanks <= 1; n--) {
    const l = doc.line(n)
    if (!l.text.trim()) {
      blanks++
      continue
    }
    return groups.find((g) => (g.items.length ? g.items[g.items.length - 1]!.to : g.to) === l.to) ?? null
  }
  return null
}

/**
 * 这一条是自己起一块的引文（剪进来的摘录就是：上面隔着空行）：提示块里「> 正文」那几行、时刻块里的「> 原文一句」
 * 也是一行行的「>」，可它们是那一块的一部分，Tab 不给它们开评价
 */
function isExcerpt(state: EditorState, g: QuoteGroup): boolean {
  const doc = state.doc
  const first = doc.lineAt(g.from)
  if (first.number > 1 && !/^(---)?\s*$/.test(doc.line(first.number - 1).text)) return false
  const lead = first.from + first.text.search(/\S|$/)
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(lead, 1); n; n = n.parent)
    if (n.name === 'Blockquote') return n.from === lead && n.parent?.name === 'Document'
  return false
}

/** Tab：光标紧跟在一条引文后面，给它开一段「我的评价」（已经有的光标到那一段末尾）；不归这里返回 false */
export function tabToReview(view: EditorView): boolean {
  if (view.state.readOnly) return false
  const g = quoteForTab(view.state)
  if (!g) return false
  openReview(view, g)
  return true
}

/**
 * ⇧Tab：光标在一段还没写字的「我的评价」里：撤掉它，光标回到摘录后面（剪进来时停的那一行还在就回那一行，不然到引文末尾）。
 * 写了字的不撤（⇧Tab 不删字）；不归这里返回 false
 */
export function shiftTabOutOfReview(view: EditorView): boolean {
  if (view.state.readOnly) return false
  const hit = caretItem(view.state)
  if (!hit || hit.it.kind !== 'me' || !hit.it.empty) return false
  // 连同上面隔开的空行一起去掉；进撤销（文件里本来就有的空评价按了 ⇧Tab，⌘Z 能找回来）
  const { it } = hit
  const from = view.state.doc.sliceString(it.from - 2, it.from) === '\n\n' ? it.from - 2 : Math.max(0, it.from - 1)
  view.dispatch({ changes: { from, to: it.to }, selection: { anchor: from }, annotations: hiddenOk.of(true), userEvent: 'delete.review' })
  const doc = view.state.doc
  const end = from
  // 引文下面隔一个空行、还空着的那一行（剪进来时光标停的地方）
  const below = doc.lineAt(end).number + 2
  const back = below <= doc.lines && doc.line(below - 1).text === '' && doc.line(below).text === '' ? doc.line(below).from : end
  view.dispatch({ selection: { anchor: back }, userEvent: 'select', scrollIntoView: true })
  return true
}

/** ⌘↵：光标在引文里，给它开一段评价（三个方向通用） */
function cmdEnterInQuote(view: EditorView): boolean {
  if (view.state.readOnly) return false
  const sel = view.state.selection.main
  const g = groupAt(view.state, sel.head)
  if (!g || sel.head > g.to) return false
  openReview(view, g)
  return true
}

/**
 * 光标离开一段空着的评价（点了别处、按了 esc、编辑器没了焦点）：这一段去掉，不留空标签。
 * 只看光标停过的那一段（打开文件时文件里本来就有的空标签不动，「打开再保存文件不变」）
 */
const dropWhenLeft = ViewPlugin.fromClass(
  class {
    /** 光标正停着的那段空评价（标签那一行的行首） */
    at: number | null = null
    constructor(readonly view: EditorView) {}
    update(u: ViewUpdate) {
      if (!u.docChanged && !u.selectionSet && !u.focusChanged) return
      const was = this.at === null ? null : u.changes.mapPos(this.at, 1)
      const hit = caretItem(u.state)
      this.at = hit && hit.it.empty && u.view.hasFocus ? hit.it.from : null
      if (was === null || was === this.at) return
      queueMicrotask(() => {
        const left = itemAt(this.view.state, was)
        const still = this.view.hasFocus && caretItem(this.view.state)?.it.from === was
        if (left && left.it.from === was && left.it.empty && !still) dropEmpty(this.view, left.it)
      })
    }
  },
)

/**
 * 标签那几个字是藏起来的语法：光标停不进去，打字、删除碰不到（连同前面那个换行，← 从正文开头跳到上一行末尾）。
 * 和引文隔开的空行也护着（sep、glue，同图片）：空行里打的字另起一行，空行删不掉，评价不会并进引文里
 */
const reviewHidden = hiddenSyntax.of((state) => {
  const doc = state.doc
  const out: Hidden[] = []
  for (const it of allItems(state)) {
    const glue = blankGlue(doc, it.from, it.to)
    // 下面隔开的空行：这一段末尾的换行也护着（不然在评价末尾按 Delete，下一段并进评价里）
    if (it.to + 1 < doc.length && doc.lineAt(it.to + 1).text === '') glue.push({ from: it.to, to: it.to + 1 })
    // 整段（连上面那个换行）都删了才跟着删：⌘⌫、⌘⇧K 只删字，标签留着，空了以后光标一走就消失（dropWhenLeft）
    const from = Math.max(0, it.from - 1)
    out.push({ from, to: it.tagTo, fromOk: it.from > 0, toOk: true, side: 'to', unit: { from, to: it.to }, sep: true, glue })
  }
  return out
})

/** 认挂着的几段、把标签当藏起来的语法看守（test/hidden-syntax.test.ts 拿它和每个键对一遍） */
export const reviewSyntax = [reviewGroups, reviewHidden]

/** 文档看法里的评价：画、悬停按钮、键、空了就去掉 */
export const reviewExtension = [
  reviewSyntax,
  bookDigest,
  EditorView.contentAttributes.compute([bookDigest], (s): Record<string, string> => (s.field(bookDigest) ? { class: 'cm-digest' } : {})),
  hoverField,
  hoverDecos,
  hoverWatch,
  dropWhenLeft,
  Prec.highest(
    keymap.of([
      { key: 'Enter', run: (v) => enterInReview(v) || enterAfterGroup(v) },
      { key: 'Escape', run: escInReview },
      { key: 'Backspace', run: backspaceInReview },
      { key: 'Mod-Enter', run: cmdEnterInQuote },
    ]),
  ),
]
