/**
 * 文档里的表格（DESIGN.v3 6.5，方向 A：平时一个记号都看不到）：光标在哪都画成表格，撑满版心、几列平分；
 * 点一格就在这一格里改字（一个输入框，字写回 md 里这一格两条竖线之间），Tab 跳下一格、⇧Tab 上一格，
 * 回车到下一行同一列（最后一行回车加一行），esc 收起。不再露出「| a | b |」原文。
 */
import { addTableRow, findBlocks, type MdBlock, parseTable, setTableCell, wikiLabel } from '@cn/format'
import { Prec, StateEffect, StateField } from '@codemirror/state'
import { EditorView, WidgetType } from '@codemirror/view'
import { hiddenOk } from './hidden-syntax'

/** 正在改的那一格：表格从哪开始（文字位置）、第几行（-1 表头）、第几列 */
export interface CellAt {
  table: number
  row: number
  col: number
  /** 用 Tab、回车走到这一格：格子里的字全选上，直接打字就换掉（像表格软件）；点进来的光标在末尾 */
  all?: boolean
}

export const editCell = StateEffect.define<CellAt | null>()

export const tableEditField = StateField.define<CellAt | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(editCell)) return e.value
    return v && tr.docChanged ? { ...v, table: tr.changes.mapPos(v.table, 1) } : v
  },
})

/** 下一帧开始改这一格（刚插进来的表格：部件这一帧才画出来） */
export function editCellLater(view: EditorView, table: number, row: number, col: number) {
  view.dispatch({ effects: editCell.of({ table, row, col }) })
}

/**
 * 格子失焦（点了正文别处）后还没写回的那一格：失焦时等这一轮点击走完（setTimeout 0）才写回，光标好留在点的地方。
 * 可 Chromium 先处理输入、后跑定时器：点完马上打字（验收用机器速度，点和打之间 0 到 40 毫秒），字先进了正文，
 * 表格跟着挪了位置、部件重画，重画的格子把焦点抢回去，下一个键落进格子，原来打的字也没写回。
 * 所以编辑器收到下一个键、输入法、粘贴之前，先把这一格写回去
 */
const pendingCommit = new WeakMap<EditorView, () => void>()

const flushCell = (_e: Event, view: EditorView) => {
  const run = pendingCommit.get(view)
  if (run) {
    pendingCommit.delete(view)
    run()
  }
  return false
}

export const tableCellFlush = Prec.highest(EditorView.domEventHandlers({ keydown: flushCell, beforeinput: flushCell, compositionstart: flushCell, paste: flushCell, drop: flushCell }))

function tableAt(text: string, from: number): MdBlock | null {
  return findBlocks(text).find((b) => b.kind === 'table' && b.from === from) ?? null
}

/** 格子里的 md 画成字：**粗**、*斜*、`代码`、[字](网址)、[[双链]]、==高亮==（记号不露） */
function inline(text: string, into: HTMLElement) {
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\[[^\]]+\]\]|\[[^\]]*\]\([^)]*\)|==[^=]+==)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > last) into.append(text.slice(last, m.index))
    const t = m[0]
    let el: HTMLElement
    if (t.startsWith('**')) (el = document.createElement('b')), (el.textContent = t.slice(2, -2))
    else if (t.startsWith('`')) (el = document.createElement('code')), (el.textContent = t.slice(1, -1))
    else if (t.startsWith('[[')) (el = document.createElement('span')), (el.className = 'cm-wikilink'), (el.textContent = wikiLabel(t.slice(2, -2)))
    else if (t.startsWith('[')) (el = document.createElement('span')), (el.className = 'cm-link'), (el.textContent = t.slice(1, t.indexOf('](')))
    else if (t.startsWith('==')) (el = document.createElement('span')), (el.className = 'cm-hl'), (el.textContent = t.slice(2, -2))
    else (el = document.createElement('i')), (el.textContent = t.slice(1, -1))
    into.append(el)
    last = m.index! + t.length
  }
  if (last < text.length) into.append(text.slice(last))
}

export class TableWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly from: number,
    readonly editing: { row: number; col: number; all?: boolean } | null,
  ) {
    super()
  }
  eq(o: TableWidget) {
    return o.src === this.src && o.from === this.from && o.editing?.row === this.editing?.row && o.editing?.col === this.editing?.col && o.editing?.all === this.editing?.all
  }
  toDOM(view: EditorView) {
    const t = parseTable(this.src, { kind: 'table', from: 0, to: this.src.length })
    const wrap = document.createElement('div')
    wrap.className = 'cm-table'
    wrap.dataset.part = '表格'
    const table = document.createElement('table')
    const cols = Math.max(t.head.length, ...t.rows.map((r) => r.length))
    /** 这张表正在改的那一格的输入框：点别的格子时先把它的字写回去 */
    let open: ((next: { row: number; col: number; all?: boolean } | null, opts?: { addRow?: boolean; keepSel?: boolean }) => void) | null = null
    const cell = (tag: 'th' | 'td', text: string, row: number, col: number) => {
      const el = document.createElement(tag)
      const a = t.align[col]
      if (a) el.style.textAlign = a
      if (this.editing && this.editing.row === row && this.editing.col === col && !view.state.readOnly) {
        const { input, commit } = this.input(view, text, row, col, t.rows.length, cols)
        open = commit
        el.classList.add('editing')
        el.appendChild(input)
      } else inline(text, el)
      el.addEventListener('mousedown', (e) => {
        if (e.button !== 0 || view.state.readOnly || (e.target as HTMLElement).tagName === 'INPUT') return
        e.preventDefault()
        if (open) open({ row, col })
        else view.dispatch({ effects: editCell.of({ table: this.from, row, col }) })
      })
      return el
    }
    const head = table.createTHead().insertRow()
    for (let k = 0; k < cols; k++) head.appendChild(cell('th', t.head[k]?.text ?? '', -1, k))
    const body = table.createTBody()
    t.rows.forEach((r, i) => {
      const tr = body.insertRow()
      for (let k = 0; k < cols; k++) tr.appendChild(cell('td', r[k]?.text ?? '', i, k))
    })
    wrap.appendChild(table)
    return wrap
  }

  /** 这一格的输入框：字写回 md 里这一格；Tab / ⇧Tab / 回车 / esc 走格子 */
  private input(view: EditorView, text: string, row: number, col: number, rows: number, cols: number) {
    const input = document.createElement('input')
    input.className = 'cm-cellin'
    input.value = text
    input.setAttribute('aria-label', row < 0 ? `表头第 ${col + 1} 格` : `第 ${row + 1} 行第 ${col + 1} 格`)
    let done = false
    /** 写回这一格并换到 next 那一格（null：不再改格子；keepSel：光标留在人点的地方） */
    const commit = (next: { row: number; col: number; all?: boolean } | null, opts: { addRow?: boolean; keepSel?: boolean } = {}) => {
      if (done) return
      done = true
      pendingCommit.delete(view)
      const doc = view.state.doc.toString()
      // 表格这会儿从哪开始：改格子的状态跟着上面的改动挪过（这个部件记的 from 可能是挪动前的）
      const ed = view.state.field(tableEditField, false)
      const from = ed && ed.row === row && ed.col === col ? ed.table : this.from
      const b = tableAt(doc, from)
      if (!b) return view.dispatch({ effects: editCell.of(null) })
      let out = input.value === text ? doc : setTableCell(doc, b, row, col, input.value)
      if (opts.addRow) {
        const b2 = tableAt(out, from)
        if (b2) out = addTableRow(out, b2)
      }
      const after = tableAt(out, from)
      view.dispatch({
        changes: out === doc ? [] : minimalChange(doc, out),
        effects: editCell.of(next ? { table: from, ...next } : null),
        ...(next || opts.keepSel ? {} : { selection: { anchor: after ? Math.min(out.length, after.to) : from } }),
        userEvent: 'input.table',
        annotations: hiddenOk.of(true),
      })
      if (!next && !opts.keepSel) view.focus()
    }
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Tab') {
        e.preventDefault()
        let r = row
        let c = col + (e.shiftKey ? -1 : 1)
        if (c >= cols) (c = 0), (r = row + 1)
        if (c < 0) (c = cols - 1), (r = row - 1)
        if (r < -1 || r >= rows) return
        commit({ row: r, col: c, all: true })
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (row >= rows - 1) commit({ row: row + 1, col: 0, all: true }, { addRow: true })
        else commit({ row: row + 1, col, all: true })
      } else if (e.key === 'Escape') {
        // 收起格子：打的字留着（像 Notion 的表格），光标回到表格下面
        e.preventDefault()
        commit(null)
      }
    })
    // 点了正文别处：这一格的字写回去，光标留在点的地方
    input.addEventListener('blur', () => {
      const run = () => commit(null, { keepSel: true })
      pendingCommit.set(view, run)
      setTimeout(run, 0)
    })
    for (const t of ['mousedown', 'keyup', 'input', 'paste', 'copy', 'cut', 'beforeinput'] as const) input.addEventListener(t, (e) => e.stopPropagation())
    const all = !!this.editing?.all
    // 编辑器这一轮画完就把焦点给新格子（微任务，下一个按键之前）：Tab 以后马上打的字不会掉进别处；还没挂上就等下一帧
    const take = () => {
      input.focus()
      input.setSelectionRange(all ? 0 : input.value.length, input.value.length)
    }
    queueMicrotask(() => (input.isConnected ? take() : requestAnimationFrame(take)))
    return { input, commit }
  }

  ignoreEvent() {
    return true
  }
}

/** 整篇换成 next 时只改有差别的那一段（一次 ⌘Z 撤回，光标、外部合并都按最小改动走） */
function minimalChange(a: string, b: string): { from: number; to: number; insert: string }[] {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let ea = a.length
  let eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) ea--, eb--
  return [{ from: s, to: ea, insert: b.slice(s, eb) }]
}
