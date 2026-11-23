/**
 * 文末那一行（CN-107 方向 A「照原稿」，DESIGN.v3 6.1–6.4）：文档最后常驻一行灰字「输入 / 插入块，或者直接写」。
 * 它不在文件里，是编辑器画出来的：
 * - 最后一行本来就是空行、上面隔着一个空行时，灰字就画在那个空行上（光标点进去就是那一行，打字就是新的一段）；
 * - 别的时候画在文档最后（文件末尾后面），点它、点它下面更远的空白：在文末新起一段（前面和上一块隔一个空行），光标进去。
 *   这时新起的几个换行是「暂时的」：不存盘；光标走到它上面、编辑器失焦时只有空白或只打了个「/」又没选，就原样拿掉，
 *   文件一个字节都不多（守住「打开再保存文件不变」）。打了正文才算数，和别的打字一样存盘。在里面回车再起一行，也是暂时的
 *   （task-axoxy：文末的空块只在屏上，gap-lines.ts 把这几行当空块）；撤回把字撤光了又算暂时的。
 * 新建的笔记（正文还是空的、文件名跟着标题）这一行写「回车开始写正文；标题改了，文件名和标签跟着改」（CN-11 A 的稿子）。
 * 悬停也出「+ ⋮⋮」（block-handles.tsx 认 .cm-tailline）。
 */
import { isolateHistory } from '@codemirror/commands'
import { Annotation, EditorSelection, EditorState, type Range, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { titleOf } from '../shared/layout'
import { editorHost } from './editor-host'
import { emptyBlock, setScreenTail } from './gap-lines'
import { hiddenOk, hiddenRanges } from './hidden-syntax'
import { headingOf } from './title-follow'
import { t as tNow } from '../shared/i18n'

// 不翻：两句灰字是键，画的地方（TailWidget）翻
export const TAIL_TEXT = '输入 / 插入块，或者直接写'
export const NEW_NOTE_TEXT = '回车开始写正文；标题改了，文件名和标签跟着改' // 不翻：键，画的地方翻

/** 只是为文末那一行暂时加的字（还没打正文）：NoteDoc 不为它存盘 */
export const provisional = Annotation.define<boolean>()

interface Pending {
  /** 文末那一行（第一行暂时加的空行）行首 */
  at: number
  /** 暂时加的字从哪起：从这里到文件末尾只有空白（和打了一半的「/筛选字」）时都不算数、不存盘 */
  from: number
}

const setPending = StateEffect.define<Pending | null>()

/**
 * 记着文末暂时加的那一段（task-axoxy 起：光标离开时打了字也不忘，撤回把字撤光了它又是暂时的，再离开就拿掉；
 * 再从文末新起一段、或「+」「/」选了一项定下来时才换掉）
 */
export const tailPending = StateField.define<Pending | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setPending)) return e.value
    if (!v || !tr.docChanged) return v
    const from = tr.changes.mapPos(v.from, -1)
    return { at: Math.max(from, tr.changes.mapPos(v.at, -1)), from }
  },
})

/** 只有空白，或只打了一个「/筛选字」：这几个字不算数（task-axoxy：只按了空格也不算，以前文件末尾多出一行空格） */
const onlyTyped = (text: string) => /^\s*([/、][^\s/、]*)?\s*$/.test(text)

/**
 * 暂时加的那一段（文末只在屏上的空块，还没打正文）：存盘时不写进去（NoteDoc 存的是去掉它的字），保证「打开再保存文件不变」。
 * 打了正文就返回 null（照常存）
 */
export function provisionalRange(state: EditorState): { from: number; to: number } | null {
  const p = state.field(tailPending, false)
  if (!p || p.from > state.doc.length) return null
  return onlyTyped(state.doc.sliceString(p.from)) ? { from: p.from, to: state.doc.length } : null
}

/** 文末只在屏上的空块从第几行起（暂时的、还没打正文时）；没有是 0 */
function screenLines(state: EditorState): number {
  if (!provisionalRange(state)) return 0
  const p = state.field(tailPending)!
  return state.doc.lineAt(Math.min(p.at, state.doc.length)).number
}
setScreenTail(screenLines)

/** 第 n 行是文末只在屏上的那几行（文末那一行，和在它里面回车加的） */
export function tailLineHere(state: EditorState, n: number): boolean {
  const t = screenLines(state)
  return t > 0 && n >= t && n < state.doc.lines
}

/** 光标停在文件最后那个空行上，它紧挨着上面有字的一行（文件以一个换行结尾，这一行只是换行后面的空）；只读时不算 */
function attachedLastLine(state: EditorState): boolean {
  const sel = state.selection.main
  const doc = state.doc
  if (!sel.empty || state.readOnly || doc.lines < 2) return false
  const last = doc.line(doc.lines)
  return sel.head === last.from && last.text === '' && doc.line(doc.lines - 1).text.trim() !== ''
}

/** 光标停在文件最后那个空行上，文件本来以空行结尾（灰字画在这一行，lineSlot）：也在这里新起一段，打了字文件照样以换行结尾 */
function onSlot(state: EditorState): boolean {
  const sel = state.selection.main
  if (!sel.empty || state.readOnly) return false
  const slot = lineSlot(state)
  return slot !== null && sel.head === slot
}

/**
 * 光标停在文件最末尾，最后一行整行藏着（画成卡片的数据库块、图片，代码块的收尾围栏，在文件最末、后面没有换行）：
 * 光标在藏着的记号后面，打的字落不到块后面（看守把它挪到块上面去了）；改成在文末新起一段（task-ys1rr，用户报的「只有一个数据库块时文末打不了字，
 * 光标进不去块后面」：↓、→ 走过最后一个块就停在这里）
 */
function pastHiddenEnd(state: EditorState): boolean {
  const sel = state.selection.main
  const doc = state.doc
  if (!sel.empty || state.readOnly || sel.head !== doc.length) return false
  const last = doc.line(doc.lines)
  if (last.text.trim() === '') return false
  return hiddenRanges(state).some((h) => h.from <= last.from && h.to >= last.to)
}

/** 最后一行是空行、上面隔着空行（或者就是第一行）：灰字画在这一行上 */
function lineSlot(state: EditorState): number | null {
  const doc = state.doc
  const last = doc.line(doc.lines)
  if (last.text !== '') return null
  if (last.number === 1) return last.from
  const up = doc.line(last.number - 1)
  return up.text.trim() === '' ? last.from : null
}

/**
 * 文末那一行灰字画在第几行（block-gaps.ts 把它上面那个空行当成块和块之间的空行压矮）：暂时的那几行里光标那一行（没在里面就是第一行）；
 * 画在文件末尾后面是 doc.lines + 1；没有文末那一行（只读、没装这个扩展）是 0
 */
export function tailLineAt(state: EditorState): number {
  if (state.readOnly || state.field(tailDeco, false) === undefined) return 0
  const t = screenLines(state)
  if (t) return caretTailLine(state, t)
  const slot = lineSlot(state)
  return slot !== null ? state.doc.lineAt(slot).number : state.doc.lines + 1
}

/** 文末那几行（从第 t 行起）里光标那一行；光标不在里面就是第一行 */
function caretTailLine(state: EditorState, t: number): number {
  const n = state.doc.lineAt(state.selection.main.head).number
  return n >= t && n < state.doc.lines ? n : t
}

/** 正文还是空的（只有 frontmatter、标题和空行），文件名跟着标题：新建的笔记 */
function freshNote(state: EditorState): boolean {
  const text = state.doc.toString()
  const h = headingOf(text)
  if (!h) return false
  const body = text.split('\n').slice(h.line).join('\n')
  return body.trim() === '' && h.title === titleOf(state.facet(editorHost).path())
}

/**
 * 文末新起一段，光标放进去；返回那一行行首。pick：从「+」菜单、块菜单选了一项要插在这里（算数的，不是暂时的）
 */
export function openTail(view: EditorView, pick = false): number | null {
  const state = view.state
  if (state.readOnly) return null
  const pending = state.field(tailPending)
  if (pending && provisionalRange(state)) {
    if (pick) view.dispatch({ effects: setPending.of(null) })
    view.dispatch({ selection: { anchor: pending.at }, scrollIntoView: true })
    return pending.at
  }
  // 上一回文末新起的那段已经打了字：换成这一回的
  if (pending) view.dispatch({ effects: setPending.of(null) })
  const doc = state.doc
  const L = doc.length
  const slot = lineSlot(state)
  if (slot !== null) {
    if (pick) {
      view.dispatch({ selection: { anchor: slot }, userEvent: 'select.pointer', scrollIntoView: true })
      return slot
    }
    // 文件本来以空行结尾：灰字那一行就是文末那一行，后面暂时补一个换行（打了字文件照样以换行结尾，task-axoxy 第 19 条）
    view.dispatch({
      changes: { from: L, insert: '\n' },
      selection: EditorSelection.cursor(slot),
      effects: setPending.of({ at: slot, from: L }),
      userEvent: 'select.tail',
      annotations: [provisional.of(true), hiddenOk.of(true), isolateHistory.of('full')],
      scrollIntoView: true,
    })
    return slot
  }
  const t = /\n*$/.exec(doc.sliceString(Math.max(0, L - 4), L))![0].length
  // 前面补到和上一块隔一个空行，后面留一个换行（打了字以后文件照样以换行结尾）
  const before = '\n'.repeat(Math.max(0, 2 - t))
  const insert = before + '\n'
  const at = L + before.length
  view.dispatch({
    changes: { from: L, insert },
    selection: EditorSelection.cursor(at),
    effects: pick ? [] : setPending.of({ at, from: L }),
    userEvent: pick ? 'input.block' : 'select.tail',
    // 暂时的也进撤销：打了字以后 ⌘Z 先撤字、再撤这一行，文件回到原样；没打字就离开时由 dropPending 不进撤销地拿掉。
    // 单独一步（task-axoxy 第 7 条）：不然半秒内接着打的字和这一行并成一步，⌘Z 一下连这一行一起撤掉，光标跳回原来的地方，重打的字落到别处
    annotations: pick ? [hiddenOk.of(true), isolateHistory.of('full')] : [provisional.of(true), hiddenOk.of(true), isolateHistory.of('full')],
    scrollIntoView: true,
  })
  return at
}

/** 文末那几行里回车：再起一行，也只在屏上、不进撤销（像 Notion 空的最后一块里回车能一直加，task-axoxy 第 15 条） */
export function moreTail(view: EditorView): boolean {
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  view.dispatch({
    changes: { from: line.from, insert: '\n' },
    selection: EditorSelection.cursor(line.from + 1),
    userEvent: 'input',
    annotations: [provisional.of(true), Transaction.addToHistory.of(false), hiddenOk.of(true)],
    scrollIntoView: true,
  })
  return true
}

/**
 * 文末那一行（点进来、还没打正文）上打「/」选了 AI 两项：这一行定下来，和「+」从文末新起的一行一样算数，返回行首；
 * pos 不在那一行上是 null。不定下来的话，问 AI 写什么的小框一拿走焦点，这一行就被当成没打字拿掉，
 * AI 的字落到上一段紧下面（不隔空行、文件末尾也没了换行）。AI 框什么都没写就收起时，由斜杠菜单的 made 把它拿掉。
 */
export function keepTail(view: EditorView, pos: number): number | null {
  const p = view.state.field(tailPending, false)
  if (!p || !provisionalRange(view.state)) return null
  const line = view.state.doc.lineAt(Math.min(pos, view.state.doc.length))
  if (!tailLineHere(view.state, line.number)) return null
  view.dispatch({ effects: setPending.of(null) })
  return line.from
}

/**
 * 文末那几行（还没打字）里按退格：第一行连同暂时加的换行全拿掉（不存盘、不进撤销），光标回到上一块
 * （task-ys1rr，像 Notion 删掉空的最后一块）；下面几行（回车加的）只拿掉这一行，光标回到上一行。where 由调用的地方按拿掉以后的文字算
 */
export function closeTail(view: EditorView, where: (state: EditorState) => EditorSelection | null): boolean {
  const p = view.state.field(tailPending, false)
  if (!p || !provisionalRange(view.state)) return false
  const state = view.state
  const line = state.doc.lineAt(state.selection.main.head)
  const at = state.doc.lineAt(Math.min(p.at, state.doc.length))
  if (line.number > at.number) {
    view.dispatch({ changes: { from: line.from - 1, to: line.from }, selection: EditorSelection.cursor(line.from - 1), userEvent: 'delete.backward', annotations: [provisional.of(true), Transaction.addToHistory.of(false), hiddenOk.of(true)], scrollIntoView: true })
    return true
  }
  const to = state.doc.length
  const after = state.update({ changes: { from: p.from, to }, effects: setPending.of(null) }).state
  const sel = where(after)
  view.dispatch({
    changes: { from: p.from, to },
    effects: setPending.of(null),
    ...(sel ? { selection: sel } : {}),
    userEvent: 'select',
    annotations: [provisional.of(true), Transaction.addToHistory.of(false), hiddenOk.of(true)],
    scrollIntoView: true,
  })
  return true
}

/** 把暂时加的拿掉（光标离开、失焦、只打了「/」没选） */
function dropPending(view: EditorView) {
  const r = provisionalRange(view.state)
  if (!r) return
  view.dispatch({
    changes: { from: r.from, to: r.to },
    effects: setPending.of(null),
    annotations: [provisional.of(true), Transaction.addToHistory.of(false), hiddenOk.of(true)],
  })
}

/** 文末那一行的灰字（画在最后那个空行上，或文件末尾后面） */
class TailWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly after: boolean,
    readonly gap: boolean,
  ) {
    super()
  }
  eq(o: TailWidget) {
    return o.text === this.text && o.after === this.after && o.gap === this.gap
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.after ? 'div' : 'span')
    el.className = 'cm-tailline' + (this.after ? ' after' : ' inline') + (this.gap ? ' gap' : '')
    el.dataset.part = '文末那一行' // 不翻：e2e 认的 data-part
    el.setAttribute('aria-hidden', 'true')
    const t = document.createElement('span')
    t.className = 'cm-tail-ph'
    t.textContent = tNow(this.text)
    el.appendChild(t)
    if (this.after)
      el.addEventListener('mousedown', (e) => {
        if ((e as MouseEvent).button !== 0) return
        e.preventDefault()
        view.focus()
        openTail(view)
      })
    return el
  }
  ignoreEvent() {
    // 画在空行上的那种：点它交给编辑器（光标落进那一行）
    return this.after
  }
  get estimatedHeight() {
    return this.after ? 30 : -1
  }
}

/** 空块里的灰字：和文末那一行同一个样子，但不是文末那一行（点它、悬停把手都照普通的一行） */
class EmptyBlockWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-blockph'
    el.dataset.part = '空块的灰字' // 不翻：e2e 认的 data-part
    el.setAttribute('aria-hidden', 'true')
    el.textContent = tNow(TAIL_TEXT)
    return el
  }
  ignoreEvent() {
    return false
  }
}

/** 光标停在一个空块里（回车新起、还没打字的一块，gap-lines.ts 的数法；不是文末那几行）：它的行首 */
function emptyBlockAtCaret(state: EditorState): number | null {
  const sel = state.selection.main
  if (!sel.empty || state.selection.ranges.length > 1) return null
  const line = state.doc.lineAt(sel.head)
  if (line.number === state.doc.lines || !emptyBlock(state, line.number)) return null
  // 文末那几行（点进来、还没打字）自己写着灰字
  if (tailLineHere(state, line.number)) return null
  return line.from
}

function build(state: EditorState): DecorationSet {
  if (state.readOnly) return Decoration.none
  const out: Range<Decoration>[] = []
  // 光标所在的空块里也写着这一行灰字（照 Notion 空块里的「Press / to insert blocks」，task-ys1rr 设计复审）；光标走开就没有，不写进文件
  const empty = emptyBlockAtCaret(state)
  if (empty !== null) out.push(Decoration.widget({ widget: new EmptyBlockWidget(), side: 1 }).range(empty))
  // 光标所在的空块后面一直到文末都是空行（提示块里空的「> 」回车出块、文件末尾多了几个空行）：灰字只写在光标这一行，
  // 文末那一行不再写一遍（以前紧挨着上下两行一样的灰字，task-0nz63）
  if (empty !== null && state.doc.sliceString(empty).trim() === '') return Decoration.set(out, true)
  const fresh = freshNote(state)
  const text = fresh ? NEW_NOTE_TEXT : TAIL_TEXT
  const t = screenLines(state)
  if (t) {
    // 文末那几行（还没打正文）：灰字写在光标那一行（光标不在里面就是第一行）；只打了「/」：这一行在挑块，不画
    const n = caretTailLine(state, t)
    const line = state.doc.line(n)
    if (line.text.trim() === '') out.push(Decoration.widget({ widget: new TailWidget(fresh && n === t && state.selection.main.head !== line.from ? NEW_NOTE_TEXT : TAIL_TEXT, false, false), side: 1 }).range(line.from))
    return Decoration.set(out, true)
  }
  const slot = lineSlot(state)
  if (slot !== null) {
    // 光标就在这一行（点进来了、还没打字）：照样写着灰字，打字就换掉；新建的笔记光标进了正文这一行就换成「输入 / 插入块…」
    const head = state.selection.main.head
    const here = head >= slot && head <= state.doc.line(state.doc.lines).to
    out.push(Decoration.widget({ widget: new TailWidget(fresh && !here ? NEW_NOTE_TEXT : TAIL_TEXT, false, false), side: 1 }).range(slot))
    return Decoration.set(out, true)
  }
  const doc = state.doc
  // 文件末尾没有换行（最后一行就是正文）：和上一块之间空出一行的高度
  const gap = doc.line(doc.lines).text !== ''
  out.push(Decoration.widget({ widget: new TailWidget(text, true, gap), block: true, side: 1 }).range(doc.length))
  return Decoration.set(out, true)
}

const tailDeco = StateField.define<DecorationSet>({
  create: build,
  update(v, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(setPending)) && !tr.reconfigured) return v
    return build(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f),
})

/**
 * 暂时的那几行里打「/筛选字」、空格、回车：照样不算数（不存盘）。改之前就已经有正文的（撤回把字撤光）不算：那一下要存盘，文件回到原样
 */
const keepProvisional = EditorState.transactionExtender.of((tr) => {
  const p = tr.startState.field(tailPending)
  if (!p || !tr.docChanged || tr.annotation(provisional) || !provisionalRange(tr.startState)) return null
  let inside = true
  tr.changes.iterChangedRanges((fromA) => {
    if (fromA < p.from) inside = false
  })
  return inside && provisionalRange(tr.state) ? { annotations: provisional.of(true) } : null
})

/**
 * 文末那几行是全篇最后的块：光标不再往下走到只为让文件以换行结尾的那个空行（会把这一行当成没打字拿掉，
 * 光标落回藏着的收尾后面，打的字落不到块后面；task-ys1rr）。像 Notion 最后一块按 ↓ 不动
 */
const stayOnTail = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection || tr.docChanged) return tr
  const sel = tr.state.selection.main
  if (!sel.empty || tr.state.selection.ranges.length > 1) return tr
  const t = screenLines(tr.startState)
  if (!t) return tr
  const doc = tr.state.doc
  const was = doc.lineAt(tr.startState.selection.main.head).number
  if (was < t || doc.lineAt(sel.head).number < doc.lines) return tr
  return [tr, { selection: EditorSelection.cursor(doc.line(doc.lines - 1).to), sequential: true }]
})

class TailView {
  private onDown = (e: MouseEvent) => {
    // 点在正文最后一块下面的空白（.doc 的下留白、.doc 下面 .body 的空白）：和点文末那一行一样
    if (e.button !== 0 || this.view.state.readOnly) return
    const t = e.target as HTMLElement
    if (this.view.dom.contains(t) && !t.classList.contains('cm-scroller') && !t.classList.contains('cm-content')) return
    // 点的是中间栏的滚动条：照常拖；点的是文末「提到这篇的」（doc-embeds.tsx）：那是链接，不新起一段
    if (t === this.host && e.offsetX >= this.host.clientWidth) return
    if (t.closest?.('.doc-backlinks')) return
    const content = this.view.contentDOM.getBoundingClientRect()
    if (e.clientY <= content.bottom - 2) return
    e.preventDefault()
    this.view.focus()
    openTail(this.view)
  }
  private host: HTMLElement

  constructor(readonly view: EditorView) {
    // 接点击的是整个中间栏（.body，里面是 .doc 版心）：短文档 .doc 早早结束，下面那一大片空白也是 .body 的（验收：点中间岛下半截焦点丢了，字落到第一段末尾）
    const doc = view.dom.parentElement
    this.host = (doc?.parentElement?.classList.contains('body') ? doc.parentElement : doc) ?? view.dom
    this.host.addEventListener('mousedown', this.onDown)
  }

  update(u: ViewUpdate) {
    const t = screenLines(u.state)
    if (!t) {
      // 光标落到文件最后那个空行、它紧挨着上面有字的一块（用户截图：引文下面那一行，灰字却在再下面一行；在这里打字会并进引文）：
      // 那一行是块和块之间的空，不停光标，改成在文末新起一段，光标和灰字在同一行（task-ys1rr）
      // 最后一个块藏着收尾、后面没有换行，光标走过它停在文件最末尾；文件本来以空行结尾、光标落在灰字那一行：也一样
      const atEnd = (s: EditorState) => attachedLastLine(s) || pastHiddenEnd(s) || onSlot(s)
      if (u.selectionSet && !u.docChanged && u.view.hasFocus && !u.view.composing && atEnd(u.state)) queueMicrotask(() => {
        if (atEnd(this.view.state) && !screenLines(this.view.state)) openTail(this.view)
      })
      return
    }
    // 光标走到文末那几行上面、编辑器失焦：还没打正文（只有空白或「/」没选）就整段拿掉，文件一个字节不多
    const head = u.state.selection.main.head
    const left = (u.focusChanged && !u.view.hasFocus) || u.state.doc.lineAt(head).number < t
    if (left) queueMicrotask(() => dropPending(this.view))
  }

  destroy() {
    this.host.removeEventListener('mousedown', this.onDown)
  }
}

export const tailLine = [tailPending, tailDeco, keepProvisional, stayOnTail, ViewPlugin.fromClass(TailView)]
