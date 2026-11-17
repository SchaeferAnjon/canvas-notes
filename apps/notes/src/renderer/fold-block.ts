/**
 * 文档里能收起的两种块（收起 / 展开只记在内存里，不改文件）：
 * - 折叠块（CN-25）：`<details><summary>没讲通 · 第 1 版</summary>` … `</details>`。画成一行「›  没讲通 · 第 1 版」，默认收着；
 *   点它展开，里面的旧讲法缩进 16、左边 1px 细线，照常编辑；看不到任何 HTML 标签。不配对的照 HANDOFF 当普通段落。
 * - 提示块（CN-59）：`> [!ai]`（AI 讲解）和写了 `[!type]+` / `[!type]-` 的提示块，标题行右端一个 chevron，点了收起正文。
 * 跨行的替换只能由 StateField 交给编辑器，所以放在这里，不在 live-preview（ViewPlugin）里。
 */
import { codiconEl } from '@cn/design'
import { detailsHead, textChanges } from '@cn/format'
import { ChangeSet, EditorSelection, EditorState, Prec, type Range, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from '@codemirror/view'
import { parseCallout } from './callout'
import { blankGlue, type Hidden, hiddenOk, hiddenSyntax } from './hidden-syntax'

/** 点了某一块的开关：pos 是这一块第一行的行首 */
export const toggleFold = StateEffect.define<number>()

const DETAILS_CLOSE = /^\s*<\/details>\s*$/i

export interface FoldBlock {
  kind: 'details' | 'callout'
  /** 第一行行首 */
  from: number
  /** 最后一行行尾 */
  to: number
  /** 第一行行尾 */
  headTo: number
  /** 折叠块：最后一行（</details>）行首 */
  closeFrom: number
  /** 折叠块：<summary> 里标题字的范围（展开时就地改标题） */
  titleFrom: number
  titleTo: number
  title: string
  /** 文件里写的默认状态：折叠块默认收着（写了 open 是展开），提示块 `-` 收着 */
  folded: boolean
}

/** 找出整篇里能收起的块（纯函数，单元测试在 test/fold-block.test.ts） */
export function foldBlocks(text: string): FoldBlock[] {
  const lines = text.split('\n')
  const starts: number[] = []
  let p = 0
  for (const l of lines) {
    starts.push(p)
    p += l.length + 1
  }
  const end = (n: number) => starts[n]! + lines[n]!.length
  const out: FoldBlock[] = []
  let fence = false
  for (let n = 0; n < lines.length; n++) {
    const l = lines[n]!
    if (/^\s*(```|~~~)/.test(l)) fence = !fence
    if (fence) continue
    // 一行写（<details><summary>…）或两行写（<details> 下一行 <summary>…）
    const d = detailsHead(lines, n)
    if (d) {
      // 里面套着的折叠块：数着开、关配对，外层到和它配对的那个 </details> 为止；里面的接着认（外层展开时它也收成一行）
      let c = -1
      let depth = 0
      for (let k = n + d.lines; k < lines.length && c === -1; k++) {
        const inner = detailsHead(lines, k)
        if (inner) {
          depth++
          k += inner.lines - 1
        } else if (DETAILS_CLOSE.test(lines[k]!)) {
          if (depth === 0) c = k
          else depth--
        }
      }
      if (c === -1) continue
      const headTo = end(n + d.lines - 1)
      const sum = text.slice(starts[n]!, headTo)
      // 标题字的范围：<summary> 后面到 </summary> 前面，去掉两头的空白和换行（<summary> 写成好几行时，标题行看得到的只有字）
      let titleFrom = starts[n]! + sum.search(/<summary>/i) + '<summary>'.length
      let titleTo = starts[n]! + sum.search(/<\/summary>\s*$/i)
      while (titleFrom < titleTo && /\s/.test(text[titleFrom]!)) titleFrom++
      while (titleTo > titleFrom && /\s/.test(text[titleTo - 1]!)) titleTo--
      out.push({ kind: 'details', from: starts[n]!, to: end(c), headTo, closeFrom: starts[c]!, titleFrom, titleTo, title: d.title, folded: !d.open })
      n += d.lines - 1
      continue
    }
    if (n > 0 && /^\s*>/.test(lines[n - 1]!)) continue
    const h = parseCallout(l)
    if (!h || !h.foldable) continue
    let last = n
    while (last + 1 < lines.length && lines[last + 1]!.trim() !== '') last++
    if (last === n) continue
    out.push({ kind: 'callout', from: starts[n]!, to: end(last), headTo: end(n), closeFrom: -1, titleFrom: -1, titleTo: -1, title: h.title, folded: h.folded })
    n = last
  }
  return out
}

class DetailsHead extends WidgetType {
  constructor(
    readonly title: string,
    readonly open: boolean,
    readonly at: number,
    /** 套在几层展开着的折叠块里：0 是最外层；套着的和那一层的正文一样缩进、左边细线（每层一条） */
    readonly depth = 0,
  ) {
    super()
  }
  eq(o: DetailsHead) {
    return o.title === this.title && o.open === this.open && o.at === this.at && o.depth === this.depth
  }
  toDOM(view: EditorView) {
    const row = document.createElement('div')
    row.className = 'cm-fold-head' + (this.open ? ' open' : '') + (this.depth ? ' cm-fold-in' : '')
    if (this.depth) row.style.setProperty('--fd', String(this.depth))
    row.setAttribute('role', 'button')
    row.setAttribute('aria-expanded', String(this.open))
    row.appendChild(codiconEl(this.open ? 'chevron-down' : 'chevron-right', 14))
    const t = document.createElement('span')
    t.textContent = this.title || '收起的内容'
    row.appendChild(t)
    row.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      view.dispatch({ effects: toggleFold.of(this.at) })
    })
    return row
  }
  ignoreEvent() {
    return true
  }
}

/** 展开着的折叠块标题行开头的 chevron：点它收起；标题字本身就地能改 */
class DetailsChevron extends WidgetType {
  constructor(
    readonly at: number,
    /** 标题空着：后面淡淡写「收起的内容」（不进文件） */
    readonly empty: boolean,
  ) {
    super()
  }
  eq(o: DetailsChevron) {
    return o.at === this.at && o.empty === this.empty
  }
  toDOM(view: EditorView) {
    const b = document.createElement('span')
    b.className = 'cm-fold-chev'
    b.setAttribute('role', 'button')
    b.setAttribute('aria-label', '收起')
    b.setAttribute('aria-expanded', 'true')
    b.appendChild(codiconEl('chevron-down', 14))
    b.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      view.dispatch({ effects: toggleFold.of(this.at) })
    })
    if (!this.empty) return b
    const wrap = document.createElement('span')
    const ph = document.createElement('span')
    ph.className = 'cm-fold-ph'
    ph.textContent = '收起的内容'
    wrap.append(b, ph)
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

class CalloutToggle extends WidgetType {
  constructor(
    readonly folded: boolean,
    readonly at: number,
  ) {
    super()
  }
  eq(o: CalloutToggle) {
    return o.folded === this.folded && o.at === this.at
  }
  toDOM(view: EditorView) {
    const b = document.createElement('span')
    b.className = 'cm-callout-fold'
    b.setAttribute('role', 'button')
    b.setAttribute('aria-label', this.folded ? '展开' : '收起')
    b.title = this.folded ? '展开' : '收起'
    b.appendChild(codiconEl(this.folded ? 'chevron-right' : 'chevron-down', 14))
    b.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      view.dispatch({ effects: toggleFold.of(this.at) })
    })
    return b
  }
  ignoreEvent() {
    return true
  }
}

interface FoldState {
  /** 用户点过的块：行首 → 现在是不是收着 */
  over: Map<number, boolean>
  deco: DecorationSet
  atomic: DecorationSet
  /** 交给 hidden-syntax 看守的范围 */
  hidden: Hidden[]
  /** 提示块标题字的范围（「> [!ai]- 」后面到行尾） */
  calloutTitles: { from: number; to: number }[]
}

function build(state: EditorState, over: Map<number, boolean>): Pick<FoldState, 'deco' | 'atomic' | 'hidden' | 'calloutTitles'> {
  const out: Range<Decoration>[] = []
  const atomic: Range<Decoration>[] = []
  const hidden: Hidden[] = []
  const calloutTitles: { from: number; to: number }[] = []
  const doc = state.doc
  const len = doc.length
  /** 展开的折叠块标题下面：紧挨着的空行（不是收尾的 </details>）算到藏着的一段里，光标从标题往下直接到正文第一行 */
  const gapEnd = (b: FoldBlock) => {
    const next = doc.lineAt(b.headTo + 1)
    return next.text.trim() === '' && next.from < b.closeFrom ? next.to + 1 : b.headTo + 1
  }
  /** 一整行（几行）的块：连同上下的换行；收尾在文件末尾时，插在后面的字先另起一段 */
  const around = (from: number, to: number, side: Hidden['side'], unit: Hidden['unit']): Hidden => ({
    from: from > 0 ? from - 1 : 0,
    to: to < len ? to + 1 : to,
    fromOk: from > 0,
    toOk: true,
    side,
    unit,
    ...(to < len ? {} : { pad: '\n\n' }),
  })
  /** 收着的外层折叠块盖住的范围：里面套着的不再画 */
  let hiddenTo = -1
  /** 展开着的折叠块的正文范围：套在里面的按套了几层缩进 */
  const openBodies: [number, number][] = []
  const depthAt = (pos: number) => openBodies.filter(([a, z]) => pos > a && pos < z).length
  /** 不画成正文行的：里层展开的标题行、里层的 </details> 行、里层收着的整块 */
  const notBody: [number, number][] = []
  for (const b of foldBlocks(doc.toString())) {
    if (b.from < hiddenTo) continue
    const folded = over.get(b.from) ?? b.folded
    if (folded && b.kind === 'details') hiddenTo = b.to
    const depth = depthAt(b.from)
    if (b.kind === 'details' && !folded) openBodies.push([b.headTo, b.closeFrom])
    if (b.kind === 'details') {
      if (folded) {
        const r = Decoration.replace({ widget: new DetailsHead(b.title, false, b.from, depth), block: true }).range(b.from, b.to)
        out.push(r)
        atomic.push(r)
        notBody.push([b.from, b.to])
        hidden.push(around(b.from, b.to, 'near', { from: b.from, to: b.to }))
        continue
      }
      // 展开着：<details><summary> 和 </summary> 藏起来（标题前一个 chevron），标题字照常能改（斜杠插进来的「收起的内容」就地改成自己的）
      const pre = Decoration.replace({ widget: new DetailsChevron(b.from, !b.title) }).range(b.from, b.titleFrom)
      const post = Decoration.replace({}).range(b.titleTo, b.headTo)
      const close = Decoration.replace({ block: true }).range(b.closeFrom, b.to)
      // <summary> 写成好几行：标题字的每一行都画在标题条里（第 5 轮：只有第一行在条里，后面几行跑到块外像正文）
      const t0 = doc.lineAt(b.titleFrom).number
      const t1 = doc.lineAt(Math.max(b.titleFrom, b.titleTo)).number
      const more = t1 > t0
      const fd = depth ? { attributes: { style: `--fd:${depth}` } } : {}
      out.push(Decoration.line({ class: 'cm-fold-headline' + (more ? ' cm-fold-hl-top' : ''), ...fd }).range(b.from), pre)
      for (let n = t0 + 1; n <= t1; n++) out.push(Decoration.line({ class: 'cm-fold-headline cm-fold-hl-more' + (n === t1 ? ' cm-fold-hl-end' : ''), ...fd }).range(doc.line(n).from))
      if (b.titleTo > b.titleFrom) out.push(Decoration.mark({ class: 'cm-fold-title' }).range(b.titleFrom, b.titleTo))
      out.push(post, close)
      atomic.push(pre, post, close)
      notBody.push([b.from, b.headTo], [b.closeFrom, b.to])
      // 第 5 轮：展开着时 ↓ 落在 <details> 前、退格删掉 </details>，整块露成 HTML。
      // 开头「(上一行的换行)<details><summary>」挨着标题，「</summary> + 换行」挨着标题末尾，「换行 + </details> + 换行」挨着正文最后一行末尾
      const whole = { from: b.from, to: b.to }
      hidden.push(
        { from: b.from > 0 ? b.from - 1 : 0, to: b.titleFrom, fromOk: b.from > 0, toOk: true, side: 'to', unit: whole },
        // 标题下面紧挨的那个空行（md 要它才认正文）也算：光标停进去打字，字紧贴在 </summary> 下面又成了 HTML
        { from: b.titleTo, to: gapEnd(b), fromOk: true, toOk: true, side: 'from', unit: whole, step: false },
        { ...around(b.closeFrom, b.to, 'from', whole), from: b.closeFrom - 1, fromOk: true },
      )
      continue
    }
    out.push(Decoration.widget({ widget: new CalloutToggle(folded, b.from), side: -1 }).range(b.headTo))
    if (folded) {
      out.push(Decoration.line({ class: 'cm-callout-folded' }).range(b.from))
      const r = Decoration.replace({}).range(b.headTo, b.to)
      out.push(r)
      atomic.push(r)
      // 收着的提示块正文：光标停在标题末尾，打的字不进藏着的正文；下面那个空行留住（删掉它、在里面打字，
      // 后面的字按 md 的懒续行并进提示块，跟着藏起来）
      const z = b.to < len ? b.to + 1 : b.to
      hidden.push({
        from: b.headTo,
        to: z,
        fromOk: true,
        toOk: true,
        side: 'from',
        unit: { from: b.from, to: b.to },
        sep: true,
        glue: blankGlue(doc, b.headTo + 1, b.to),
        ...(z < len ? {} : { pad: '\n\n' }),
      })
    }
  }
  // 提示块第一行的「> [!ai]- 」画成图标（live-preview）：也是藏着的语法，光标停在它后面（标题字前），行首打字、删掉它上面的换行会拆坏提示块
  let fence = false
  for (let n = 1; n <= doc.lines; n++) {
    const l = doc.line(n)
    if (/^\s*(```|~~~)/.test(l.text)) fence = !fence
    if (fence || (n > 1 && /^\s*>/.test(doc.line(n - 1).text))) continue
    const c = l.text.startsWith('>') ? parseCallout(l.text) : null
    if (!c) continue
    let last = n
    while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last++
    hidden.push({ from: l.from > 0 ? l.from - 1 : 0, to: l.from + c.prefix, fromOk: l.from > 0, toOk: true, side: 'to', unit: { from: l.from, to: doc.line(last).to } })
    calloutTitles.push({ from: l.from + c.prefix, to: l.to })
    n = last
  }
  // 展开着的折叠块里的每一行：套了几层（--fd）就缩进几级，每层左边一条细线（第 4 轮：以前里层正文和外层排在同一条线上）。
  // 里面的空行只当 6 高的缝（md 里 <details> 前后要空行，展开时不留大段空白）
  const lines = new Set<number>()
  for (const [a, z] of openBodies) for (let n = doc.lineAt(a).number + 1; n < doc.lineAt(z).number; n++) lines.add(n)
  for (const n of lines) {
    const l = doc.line(n)
    if (notBody.some(([a, z]) => l.from >= a && l.from <= z)) continue
    const depth = depthAt(l.from)
    out.push(Decoration.line({ class: l.text.trim() ? 'cm-fold-body' : 'cm-fold-body cm-fold-gap', ...(depth > 1 ? { attributes: { style: `--fd:${depth}` } } : {}) }).range(l.from))
  }
  return { deco: Decoration.set(out, true), atomic: Decoration.set(atomic, true), hidden, calloutTitles }
}

const foldField = StateField.define<FoldState>({
  create: (s) => ({ over: new Map(), ...build(s, new Map()) }),
  update(v, tr) {
    let over = v.over
    if (tr.docChanged && over.size) {
      const next = new Map<number, boolean>()
      for (const [k, f] of over) next.set(tr.changes.mapPos(k, 1), f)
      over = next
    }
    let toggled = false
    for (const e of tr.effects) {
      if (!e.is(toggleFold)) continue
      const b = foldBlocks(tr.state.doc.toString()).find((x) => x.from === e.value)
      if (!b) continue
      over = new Map(over)
      over.set(b.from, !(over.get(b.from) ?? b.folded))
      toggled = true
    }
    if (!tr.docChanged && !toggled) return v
    return { over, ...build(tr.state, over) }
  },
  provide: (f) => [EditorView.decorations.from(f, (v) => v.deco), EditorView.atomicRanges.of((view) => view.state.field(f).atomic), hiddenSyntax.of((state) => state.field(f).hidden)],
})

/**
 * 光标在展开着的折叠块标题上按回车：不在标题里断行（会把 <summary> 拆坏）；块里有字时在正文最前面新起一段，
 * 块里空着时光标进块里第一行接着写
 */
export function enterInFoldTitle(view: EditorView): boolean {
  const { state } = view
  const sel = state.selection.main
  if (!sel.empty) return false
  // 标题字末尾到行尾之间是藏着的「</summary>」：标题末尾再按 → 光标跨过它落在行尾（headTo），也算在标题上
  // （第 4 轮：只认到 titleTo 时这里照常断行，新起的一行紧贴在 </summary> 下面，md 当它是 HTML，粗体、链接原样露出来）
  const b = foldBlocks(state.doc.toString()).find((x) => x.kind === 'details' && sel.head >= x.titleFrom && sel.head <= x.headTo)
  if (!b) return false
  const over = state.field(foldField).over
  if (over.get(b.from) ?? b.folded) return false
  const head = state.doc.lineAt(b.headTo).number
  const close = state.doc.lineAt(b.closeFrom).number
  if (head + 1 >= close) {
    // 块里一行都没有：在 </details> 前面插一个空行
    view.dispatch({ changes: { from: b.closeFrom, insert: '\n' }, selection: { anchor: b.closeFrom }, userEvent: 'input', annotations: hiddenOk.of(true), scrollIntoView: true })
    return true
  }
  // 块里已经有字：在正文最前面新起一段（和 Notion、Obsidian 折叠标题回车一样），不跑到第一段末尾让接着打的字粘上去
  for (let n = head + 1; n < close; n++) {
    const l = state.doc.line(n)
    if (l.text.trim() === '') continue
    // md 里 <summary> 下面要空一行才认正文：新的一段和标题、和原来的第一段之间都空一行
    const gap = n === head + 1 ? '\n' : ''
    view.dispatch({ changes: { from: l.from, insert: gap + '\n\n' }, selection: { anchor: l.from + gap.length }, userEvent: 'input', annotations: hiddenOk.of(true), scrollIntoView: true })
    return true
  }
  // 块里只有空行（斜杠刚插出来的）：进空行接着写
  const first = state.doc.line(head + 1)
  const to = first.text.trim() === '' && head + 2 < close ? state.doc.line(head + 2) : first
  view.dispatch({ selection: { anchor: to.to }, userEvent: 'select', scrollIntoView: true })
  return true
}

/**
 * 往展开着的折叠块标题、提示块标题里粘贴、拖进带换行的字：换行换成空格（标题里断行、空行会把 <summary> 拆坏，整块露成 HTML；
 * 提示块标题断开后正文跑出块外；
 * 回车由 enterInFoldTitle 管）
 */
const oneLineTitle = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent('input.paste') || tr.isUserEvent('input.drop'))) return tr
  const st = tr.startState.field(foldField, false)
  if (!st) return tr
  const titles = foldBlocks(tr.startState.doc.toString())
    .filter((b) => b.kind === 'details' && !(st.over.get(b.from) ?? b.folded))
    .map((b) => ({ titleFrom: b.titleFrom, titleTo: b.titleTo }))
  // 提示块标题（「> [!ai]- 」后面那一行字）也是一行
  for (const t of st.calloutTitles) titles.push({ titleFrom: t.from, titleTo: t.to })
  if (!titles.length) return tr
  let hit = false
  const specs: { from: number; to: number; insert: string }[] = []
  tr.changes.iterChanges((fromA, toA, _fromB, _toB, ins) => {
    let text = ins.toString()
    if (/\n/.test(text) && titles.some((b) => fromA >= b.titleFrom && toA <= b.titleTo)) {
      text = text.replace(/\s*\n\s*/g, ' ').trim()
      hit = true
    }
    specs.push({ from: fromA, to: toA, insert: text })
  })
  if (!hit) return tr
  const changes = ChangeSet.of(specs, tr.startState.doc.length)
  return {
    changes,
    selection: EditorSelection.create(tr.startState.selection.ranges.map((r) => EditorSelection.cursor(changes.mapPos(r.empty ? r.head : r.from, 1)))),
    userEvent: tr.annotation(Transaction.userEvent),
    scrollIntoView: true,
  }
})

/**
 * <summary> 写成好几行的标题，把其中一行删空（退格、Delete、选中删）：标题里多出一个空行，md 就不认它是折叠块，整块露成 HTML。
 * 改完标题里有空行就顺手把空行去掉
 */
const noBlankInTitle = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged || !(tr.isUserEvent('delete') || tr.isUserEvent('input'))) return tr
  const st = tr.startState.field(foldField, false)
  if (!st) return tr
  const fixes: { from: number; to?: number; insert?: string }[] = []
  for (const b of foldBlocks(tr.startState.doc.toString())) {
    if (b.kind !== 'details' || (st.over.get(b.from) ?? b.folded)) continue
    let touched = false
    tr.changes.iterChangedRanges((fromA, toA) => void (fromA <= b.headTo && toA >= b.titleFrom && (touched = true)))
    if (!touched) continue
    const from = tr.changes.mapPos(b.from, 1)
    const to = tr.changes.mapPos(b.headTo, -1)
    const head = tr.newDoc.sliceString(from, to)
    if (detailsHead(head.split('\n'), 0)) continue
    const fixed = head.replace(/(<summary>)([\s\S]*?)(<\/summary>\s*)$/i, (_m, a: string, inner: string, c: string) => a + inner.replace(/\n[ \t]*(?=\n)/g, '') + c)
    if (fixed === head || !detailsHead(fixed.split('\n'), 0)) continue
    for (const ch of textChanges(head, fixed)) fixes.push({ from: from + ch.from, to: from + ch.to, insert: ch.insert })
  }
  return fixes.length ? [tr, { changes: fixes, sequential: true }] : tr
})

// markdown() 自己的回车是 Prec.high、排在前面：要 highest 才先轮到（不在标题上时不管）
export const foldBlock = [foldField, oneLineTitle, noBlankInTitle, Prec.highest(keymap.of([{ key: 'Enter', run: enterInFoldTitle }]))]
