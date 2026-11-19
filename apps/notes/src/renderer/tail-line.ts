/**
 * 文末那一行（CN-107 方向 A「照原稿」，DESIGN.v3 6.1–6.4）：文档最后常驻一行灰字「输入 / 插入块，或者直接写」。
 * 它不在文件里，是编辑器画出来的：
 * - 最后一行本来就是空行、上面隔着一个空行时，灰字就画在那个空行上（光标点进去就是那一行，打字就是新的一段）；
 * - 别的时候画在文档最后（文件末尾后面），点它、点它下面更远的空白：在文末新起一段（前面和上一块隔一个空行），光标进去。
 *   这时新起的几个换行是「暂时的」：不存盘、不进撤销；光标离开那一行、编辑器失焦、只打了个「/」又没选，就原样拿掉，
 *   文件一个字节都不多（守住「打开再保存文件不变」）。打了正文才算数，和别的打字一样存盘。
 * 新建的笔记（正文还是空的、文件名跟着标题）这一行写「回车开始写正文；标题改了，文件名和标签跟着改」（CN-11 A 的稿子）。
 * 悬停也出「+ ⋮⋮」（block-handles.tsx 认 .cm-tailline）。
 */
import { Annotation, EditorSelection, EditorState, type Range, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { titleOf } from '../shared/layout'
import { editorHost } from './editor-host'
import { hiddenOk } from './hidden-syntax'
import { headingOf } from './title-follow'

export const TAIL_TEXT = '输入 / 插入块，或者直接写'
export const NEW_NOTE_TEXT = '回车开始写正文；标题改了，文件名和标签跟着改'

/** 只是为文末那一行暂时加的字（还没打正文）：NoteDoc 不为它存盘 */
export const provisional = Annotation.define<boolean>()

interface Pending {
  /** 新起的那一行行首 */
  at: number
  /** 暂时加进去的范围（含后来在这一行里打的「/」） */
  from: number
  to: number
}

const setPending = StateEffect.define<Pending | null>()

/** 光标还在那一行时一直记着（打了字又删光，离开时照样整段拿掉）；光标离开时才定下来：有正文就算数，没有就拿掉 */
export const tailPending = StateField.define<Pending | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setPending)) return e.value
    if (!v || !tr.docChanged) return v
    return { at: tr.changes.mapPos(v.at, -1), from: tr.changes.mapPos(v.from, -1), to: tr.changes.mapPos(v.to, 1) }
  },
})

/** 那一行现在只有空的或「/筛选字」：这几个字不算数 */
const onlyTyped = (text: string) => /^([/、][^\s/、]*)?$/.test(text)

/**
 * 暂时加的那一段（还没打正文）：存盘时不写进去（NoteDoc 存的是去掉它的字），保证「打开再保存文件不变」。
 * 那一行打了正文就返回 null（照常存）
 */
export function provisionalRange(state: EditorState): { from: number; to: number } | null {
  const p = state.field(tailPending, false)
  if (!p || p.to > state.doc.length) return null
  const line = state.doc.lineAt(Math.min(p.at, state.doc.length))
  return onlyTyped(line.text) ? { from: p.from, to: p.to } : null
}

/** 最后一行是空行、上面隔着空行（或者就是第一行）：灰字画在这一行上，不用另起 */
function lineSlot(state: EditorState): number | null {
  const doc = state.doc
  const last = doc.line(doc.lines)
  if (last.text !== '') return null
  if (last.number === 1) return last.from
  const up = doc.line(last.number - 1)
  return up.text.trim() === '' ? last.from : null
}

/**
 * 文末那一行灰字画在第几行（block-gaps.ts 把它上面那个空行当成块和块之间的空行压矮）：画在最后那个空行上、
 * 点进来还没打字的那一行是那一行；画在文件末尾后面是 doc.lines + 1；没有文末那一行（只读、没装这个扩展）是 0
 */
export function tailLineAt(state: EditorState): number {
  if (state.readOnly || state.field(tailDeco, false) === undefined) return 0
  const pending = state.field(tailPending)
  if (pending) {
    const line = state.doc.lineAt(Math.min(pending.at, state.doc.length))
    if (onlyTyped(line.text)) return line.number
  }
  const slot = lineSlot(state)
  return slot !== null ? state.doc.lineAt(slot).number : state.doc.lines + 1
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
  if (pending) {
    if (pick) view.dispatch({ effects: setPending.of(null) })
    view.dispatch({ selection: { anchor: pending.at }, scrollIntoView: true })
    return pending.at
  }
  const slot = lineSlot(state)
  if (slot !== null) {
    view.dispatch({ selection: { anchor: slot }, userEvent: 'select.pointer', scrollIntoView: true })
    return slot
  }
  const doc = state.doc
  const L = doc.length
  const t = /\n*$/.exec(doc.sliceString(Math.max(0, L - 4), L))![0].length
  // 前面补到和上一块隔一个空行，后面留一个换行（打了字以后文件照样以换行结尾）
  const before = '\n'.repeat(Math.max(0, 2 - t))
  const insert = before + '\n'
  const at = L + before.length
  view.dispatch({
    changes: { from: L, insert },
    selection: EditorSelection.cursor(at),
    effects: pick ? [] : setPending.of({ at, from: L, to: L + insert.length }),
    userEvent: pick ? 'input.block' : 'select.tail',
    // 暂时的也进撤销：打了字以后 ⌘Z 先撤字、再撤这一行，文件回到原样；没打字就离开时由 dropPending 不进撤销地拿掉
    annotations: pick ? [hiddenOk.of(true)] : [provisional.of(true), hiddenOk.of(true)],
    scrollIntoView: true,
  })
  return at
}

/** 把暂时加的拿掉（光标离开、失焦、只打了「/」没选） */
function dropPending(view: EditorView) {
  const p = view.state.field(tailPending)
  if (!p) return
  const to = Math.min(p.to, view.state.doc.length)
  view.dispatch({
    changes: { from: p.from, to },
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
    el.dataset.part = '文末那一行'
    el.setAttribute('aria-hidden', 'true')
    const t = document.createElement('span')
    t.className = 'cm-tail-ph'
    t.textContent = this.text
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

function build(state: EditorState): DecorationSet {
  if (state.readOnly) return Decoration.none
  const out: Range<Decoration>[] = []
  const pending = state.field(tailPending)
  const fresh = freshNote(state)
  const text = fresh ? NEW_NOTE_TEXT : TAIL_TEXT
  if (pending) {
    const line = state.doc.lineAt(Math.min(pending.at, state.doc.length))
    // 点进来还没打字：灰字就写在这一行上；只打了「/」：这一行在挑块，下面先不画
    if (line.text === '') out.push(Decoration.widget({ widget: new TailWidget(TAIL_TEXT, false, false), side: 1 }).range(line.from))
    if (onlyTyped(line.text)) return Decoration.set(out)
    // 打了正文：和平时一样，下面又是一行灰字
  }
  const slot = lineSlot(state)
  if (slot !== null) {
    // 光标就在这一行（点进来了、还没打字）：照样写着灰字，打字就换掉；新建的笔记光标进了正文这一行就换成「输入 / 插入块…」
    const head = state.selection.main.head
    const here = head >= slot && head <= state.doc.line(state.doc.lines).to
    out.push(Decoration.widget({ widget: new TailWidget(fresh && !here ? NEW_NOTE_TEXT : TAIL_TEXT, false, false), side: 1 }).range(slot))
    return Decoration.set(out)
  }
  const doc = state.doc
  // 文件末尾没有换行（最后一行就是正文）：和上一块之间空出一行的高度
  const gap = doc.line(doc.lines).text !== ''
  out.push(Decoration.widget({ widget: new TailWidget(text, true, gap), block: true, side: 1 }).range(doc.length))
  return Decoration.set(out)
}

const tailDeco = StateField.define<DecorationSet>({
  create: build,
  update(v, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(setPending)) && !tr.reconfigured) return v
    return build(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f),
})

/** 暂时的那一行：只在里面打「/筛选字」也不算数（不存盘） */
const keepProvisional = EditorState.transactionExtender.of((tr) => {
  const p = tr.startState.field(tailPending)
  if (!p || !tr.docChanged || tr.annotation(provisional)) return null
  let inside = true
  tr.changes.iterChangedRanges((fromA, toA) => {
    if (fromA < p.from || toA > p.to) inside = false
  })
  if (!inside) return null
  const p2 = tr.state.field(tailPending)
  return p2 && onlyTyped(tr.state.doc.lineAt(Math.min(p2.at, tr.state.doc.length)).text) ? { annotations: provisional.of(true) } : null
})

class TailView {
  private onDown = (e: MouseEvent) => {
    // 点在正文最后一块下面的空白（.doc 的下留白、.doc 下面 .body 的空白）：和点文末那一行一样
    if (e.button !== 0 || this.view.state.readOnly) return
    const t = e.target as HTMLElement
    if (this.view.dom.contains(t) && !t.classList.contains('cm-scroller') && !t.classList.contains('cm-content')) return
    // 点的是中间栏的滚动条：照常拖
    if (t === this.host && e.offsetX >= this.host.clientWidth) return
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
    const p = u.state.field(tailPending)
    if (!p) return
    // 光标离开那一行、编辑器失焦：只有空的或「/」（没选）就整段拿掉；打了正文就定下来
    const head = u.state.selection.main.head
    const line = u.state.doc.lineAt(Math.min(p.at, u.state.doc.length))
    const left = (u.focusChanged && !u.view.hasFocus) || head < line.from || head > line.to
    if (!left) return
    if (onlyTyped(line.text)) queueMicrotask(() => dropPending(this.view))
    else queueMicrotask(() => this.view.dispatch({ effects: setPending.of(null) }))
  }

  destroy() {
    this.host.removeEventListener('mousedown', this.onDown)
  }
}

export const tailLine = [tailPending, tailDeco, keepProvisional, ViewPlugin.fromClass(TailView)]
