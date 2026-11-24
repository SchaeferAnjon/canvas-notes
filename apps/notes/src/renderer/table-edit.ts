/**
 * 文档里的普通 Markdown 表格（DESIGN.v3 6.5，方向 A：平时一个记号都看不到；task-cle3x 照 Notion 的简单表格补手感）。
 * 光标在哪都画成表格。格子有两种状态，和数据库表格同一套格子焦点（grid-focus.ts）：
 * - 改字：点一格就在这一格里打字（一个输入框，光标落在点的地方），字写回 md 里这一格两条竖线之间；
 *   Tab / ⇧Tab 走格（最后一格 Tab 加一行），回车到下一行同一列（最后一行回车加一行），↑↓ 上下一格，←→ 字走到头跨到隔壁格，
 *   第一行再 ↑、最后一行再 ↓ 出表回到正文；Esc 停下、这一格变成「选中」。
 * - 选中：一格蓝框（cn-cell-sel），方向键 / Tab 走格，回车进改字、直接打字换掉这一格，退格清空，⌘C ⌘X ⌘V 一格或一块，Esc 回正文。
 * 悬停一行左边出行把手（拖着挪行，点开：上面 / 下面加一行、删掉这一行），一列上边出列把手（拖着挪列，点开：左边 / 右边加一列、
 * 靠左 / 居中 / 靠右、删掉这一列）；两列之间的竖线能拖宽窄（存在第二行「-」的个数里，见 @cn/format table-ops）。
 * 只看、选中、进出格子不改字时文件一字节不变；改一格只动那一格；每一样改动一次 ⌘Z 撤回。
 */
import { codiconSvg } from '@cn/design/codicon-svg'
import { trackDrag } from '@cn/design/drag-end'
import {
  addTableRow,
  deleteTableCol,
  deleteTableRow,
  findBlocks,
  gridToTable,
  inlineMath,
  insertTableCol,
  insertTableRow,
  type MdBlock,
  moveTableCol,
  moveTableRow,
  type ParsedTable,
  parseTable,
  pasteTableCells,
  setTableAlign,
  setTableCell,
  setTableWidths,
  type TableAlign,
  tableWidths,
  wikiLabel,
} from '@cn/format'
import { redo, undo } from '@codemirror/commands'
import { EditorSelection, Prec, type EditorState, StateEffect, StateField } from '@codemirror/state'
import { EditorView, keymap, WidgetType } from '@codemirror/view'
import { gridKey, gridText, parseGridText, tabFrom } from './grid-focus'
import { hiddenOk } from './hidden-syntax'
import { runAppKey } from './keys'
import { openTableMenu, type TableMenuItem, tableMenuOpen } from './table-menu'
import { fadeEdges, renderTex } from './tex'
import { t as tNow } from '../shared/i18n'

/** 这一格的状态：第几行（-1 表头）、第几列 */
export interface CellAt {
  table: number
  row: number
  col: number
  /** 用 Tab、回车走到这一格：格子里的字全选上，直接打字就换掉（像表格软件） */
  all?: boolean
  /** 选中这一格（蓝框），不是在改字 */
  sel?: boolean
  /** 改字时光标放在第几个字后面（不给：末尾） */
  caret?: number
}
type Cell = Omit<CellAt, 'table'>

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
 * 可 Chromium 先处理输入、后跑定时器：点完马上打字，字先进了正文，表格跟着挪了位置、部件重画，下一个键落进格子。
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

/** 格子里的 md 画成字：公式（和正文同一个认法，task-o48fa）排好，别的交给 marks */
function inline(text: string, into: HTMLElement) {
  let last = 0
  for (const m of inlineMath(text)) {
    marks(text.slice(last, m.from), into)
    const t = renderTex(m.tex, false)
    const el = document.createElement('span')
    if (t.html !== null) {
      el.className = 'cm-math'
      el.innerHTML = t.html
    } else {
      el.className = 'cm-math-err'
      el.title = t.error
      el.textContent = text.slice(m.from, m.to)
    }
    into.append(el)
    last = m.to
  }
  marks(text.slice(last), into)
}

/** **粗**、*斜*、`代码`、[字](网址)、[[双链]]、==高亮==（记号不露） */
function marks(text: string, into: HTMLElement) {
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

const shown = (md: string) => md.replace(/\\\|/g, '|')

const sameCell = (a: Cell | null, b: Cell | null) =>
  a === b || (!!a && !!b && a.row === b.row && a.col === b.col && !!a.all === !!b.all && !!a.sel === !!b.sel && a.caret === b.caret)

/** 每列至少多宽（和 CSS 的 6em 一样，13px 字） */
const MIN_COL = 78

const ctls = new WeakMap<HTMLElement, TableCtl>()
/** 把手的深色提示（和块把手同一个样子 .blk-tip：悬停 0.4 秒，贴在下面 6） */
const tip = {
  el: null as HTMLDivElement | null,
  timer: undefined as ReturnType<typeof setTimeout> | undefined,
  show(btn: HTMLElement, text: string) {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      if (!btn.isConnected || !btn.matches(':hover')) return
      if (!this.el) {
        this.el = document.createElement('div')
        this.el.className = 'blk-tip'
        this.el.setAttribute('role', 'tooltip')
        document.body.appendChild(this.el)
      }
      const r = btn.getBoundingClientRect()
      this.el.textContent = text
      this.el.style.left = Math.round(r.left - 4) + 'px'
      this.el.style.top = Math.round(r.bottom + 6) + 'px'
      this.el.hidden = false
    }, 400)
  },
  hide() {
    clearTimeout(this.timer)
    if (this.el) this.el.hidden = true
  },
}

/** 现在露着把手的那张表 */
let gripsOn: TableCtl | null = null

export class TableWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly from: number,
    readonly editing: Cell | null,
    /** 提示块里的表格（每行「> 」开头，src 是去掉「> 」的；task-83vl3）：只看不改，外面套一层提示块的底；bot：它是提示块最后一块 */
    readonly quoted: { bot: boolean } | null = null,
  ) {
    super()
  }
  eq(o: TableWidget) {
    return o.src === this.src && o.from === this.from && sameCell(o.editing, this.editing) && o.quoted?.bot === this.quoted?.bot
  }
  toDOM(view: EditorView) {
    const c = new TableCtl(view, this)
    ctls.set(c.root, c)
    return c.root
  }
  /** 只是换了改哪一格、哪一格的字变了：在原来的 DOM 上改（横滑的位置、悬停的把手都留着，不闪） */
  updateDOM(dom: HTMLElement, view: EditorView) {
    const c = ctls.get(dom)
    return !!c && c.view === view && c.update(this)
  }
  ignoreEvent() {
    return true
  }
  destroy(dom: HTMLElement) {
    ctls.get(dom)?.destroy()
    ctls.delete(dom)
  }
}

/** 一张画出来的表：格子、输入框、把手、拖列宽 */
class TableCtl {
  readonly root: HTMLElement
  /** 横着滚的那一层（data-part="表格"） */
  readonly wrap: HTMLDivElement
  private table!: HTMLTableElement
  private t!: ParsedTable
  private src = ''
  private cols = 0
  private widths: number[] | null = null
  /** cells[行 + 1][列]：表头是第 0 行 */
  private cells: HTMLTableCellElement[][] = []
  private cur: Cell | null = null
  private input: HTMLInputElement | null = null
  /** 写回正在改的那一格并换到 next（null：不再改格子） */
  private commit: ((next: Cell | null, opts?: { addRow?: boolean; keepSel?: boolean; leave?: 'up' | 'down'; then?: (v: EditorView) => void }) => void) | null = null
  private readonly quoted: { bot: boolean } | null
  private readonly unfade: () => void
  private readonly ro: ResizeObserver
  private rowGrip: HTMLButtonElement | null = null
  private colGrip: HTMLButtonElement | null = null
  private drop: HTMLDivElement | null = null
  private hover: { row: number; col: number } | null = null
  private hideTimer: ReturnType<typeof setTimeout> | undefined
  private dragging = false

  constructor(
    readonly view: EditorView,
    w: TableWidget,
  ) {
    this.quoted = w.quoted
    this.wrap = document.createElement('div')
    this.wrap.className = 'cm-table scroll-x'
    this.wrap.dataset.part = '表格' // 不翻：e2e 认的 data-part
    // 放不下横着滚时，哪一边还有列哪一边渐隐（和公式同一套，task-c22p9）
    this.unfade = fadeEdges(this.wrap)
    this.ro = new ResizeObserver(() => this.layout())
    this.ro.observe(this.wrap)
    this.build(w.src)
    if (this.quoted) {
      const box = document.createElement('div')
      box.className = 'cm-inquote' + (this.quoted.bot ? ' bot' : '')
      box.appendChild(this.wrap)
      this.root = box
      return
    }
    // 整块还是横着滚的那一层（对比标签按它打整块红绿、老的测试按它量横滑）；把手画在编辑器外框上，不被横滑截掉
    this.root = this.wrap
    if (!view.state.readOnly) this.handles()
    this.setCell(w.editing)
  }

  private get editable() {
    return !this.quoted && !this.view.state.readOnly
  }

  /** 这张表现在从文档哪里开始（部件记的位置可能是上面改动以前的） */
  private pos(): number {
    return this.view.posAtDOM(this.root)
  }

  private rows() {
    return this.t.rows.length
  }

  private cell(row: number, col: number) {
    return this.cells[row + 1]?.[col] ?? null
  }

  /** 这一格显示、改的字：转义的竖线「\\|」显示成「|」（写回时 setTableCell 再转义） */
  private text(row: number, col: number) {
    return shown((row < 0 ? this.t.head[col] : this.t.rows[row]?.[col])?.text ?? '')
  }

  // ---------- 画 ----------

  private build(src: string) {
    this.src = src
    this.t = parseTable(src, { kind: 'table', from: 0, to: src.length })
    this.cols = Math.max(this.t.head.length, ...this.t.rows.map((r) => r.length))
    this.widths = tableWidths(src, { kind: 'table', from: 0, to: src.length })
    const table = document.createElement('table')
    // 每列至少多宽（CSS 的 --cols）：窄栏里不挤成一字一行，放不下就在这一块里横着滚（task-c22p9）
    table.style.setProperty('--cols', String(this.cols))
    if (this.widths) {
      // 拖过列宽：照比例；ResizeObserver 再按实际宽度算成像素（每列不窄于 6em，加起来比版心宽就横着滚）
      const cg = document.createElement('colgroup')
      for (const r of this.widths) {
        const c = document.createElement('col')
        c.style.width = (r * 100).toFixed(3) + '%'
        cg.appendChild(c)
      }
      table.appendChild(cg)
      table.classList.add('sized')
    }
    this.cells = []
    const head = table.createTHead().insertRow()
    this.cells.push(Array.from({ length: this.cols }, (_, k) => this.makeCell(head, 'th', -1, k)))
    const body = table.createTBody()
    this.t.rows.forEach((_, i) => {
      const tr = body.insertRow()
      this.cells.push(Array.from({ length: this.cols }, (_, k) => this.makeCell(tr, 'td', i, k)))
    })
    this.table?.remove()
    this.table = table
    this.wrap.prepend(table)
    this.layout()
  }

  private makeCell(tr: HTMLTableRowElement, tag: 'th' | 'td', row: number, col: number) {
    const el = document.createElement(tag)
    el.dataset.row = String(row)
    el.dataset.col = String(col)
    const a = this.t.align[col]
    if (a) el.style.textAlign = a
    inline(this.text(row, col), el)
    tr.appendChild(el)
    el.addEventListener('mousedown', (e) => this.cellDown(e, row, col))
    if (this.editable) el.addEventListener('keydown', (e) => this.selKey(e, row, col))
    return el
  }

  /** 部件换了：字变了的格子重画，换到要改 / 选中的那一格；行数、列数、列宽变了就整张重画 */
  update(w: TableWidget): boolean {
    if (!!w.quoted !== !!this.quoted || w.quoted?.bot !== this.quoted?.bot) return false
    if (w.src !== this.src) {
      const t = parseTable(w.src, { kind: 'table', from: 0, to: w.src.length })
      const cols = Math.max(t.head.length, ...t.rows.map((r) => r.length))
      const widths = tableWidths(w.src, { kind: 'table', from: 0, to: w.src.length })
      const shape = t.rows.length === this.t.rows.length && cols === this.cols && JSON.stringify(widths) === JSON.stringify(this.widths) && t.align.join() === this.t.align.join()
      if (!shape) {
        this.closeCell()
        this.build(w.src)
        this.cur = null
      } else {
        const old = this.t
        this.t = t
        this.src = w.src
        for (let r = -1; r < t.rows.length; r++)
          for (let k = 0; k < cols; k++) {
            const was = shown((r < 0 ? old.head[k] : old.rows[r]?.[k])?.text ?? '')
            const el = this.cell(r, k)
            if (!el || was === this.text(r, k) || (this.cur && !this.cur.sel && this.cur.row === r && this.cur.col === k)) continue
            el.textContent = ''
            inline(this.text(r, k), el)
          }
      }
    }
    this.setCell(w.editing)
    if (this.hover) this.placeGrips()
    return true
  }

  /** 列宽：拖过的表按比例算成像素，每列不窄于 6em；拖列宽的缝跟着放 */
  private layout() {
    if (!this.widths || !this.table.isConnected) return
    const W = this.wrap.clientWidth
    if (!W) return
    const px = this.widths.map((r) => Math.max(MIN_COL, Math.round(r * W)))
    this.setColPx(px)
  }

  private setColPx(px: number[]) {
    let cg = this.table.querySelector('colgroup')
    if (!cg) {
      cg = document.createElement('colgroup')
      for (let k = 0; k < this.cols; k++) cg.appendChild(document.createElement('col'))
      this.table.prepend(cg)
      this.table.classList.add('sized')
    }
    Array.from(cg.children).forEach((c, k) => ((c as HTMLElement).style.width = (px[k] ?? MIN_COL) + 'px'))
    this.table.style.width = px.reduce((a, x) => a + x, 0) + 'px'
  }

  // ---------- 改字、选中 ----------

  private closeCell() {
    const c = this.cur
    if (!c) return
    // 先撒手再拿掉输入框：拿掉时它失焦，失焦那一下看到不归它管了就不写回
    const input = this.input
    this.input = null
    this.commit = null
    this.cur = null
    if (input) pendingCommit.delete(this.view)
    const el = this.cell(c.row, c.col)
    if (el) {
      el.classList.remove('editing', 'cn-cell-edit', 'cn-cell-sel')
      el.removeAttribute('tabindex')
      if (input) {
        el.textContent = ''
        inline(this.text(c.row, c.col), el)
      }
    }
  }

  /** 换到这一格（改字或选中）；同一格同一种状态不动 */
  private setCell(c: Cell | null, now = false) {
    if (!this.editable) c = null
    if (sameCell(c, this.cur)) return
    // 刚打字进来的那一格（同一格、已经在改字）：不重开输入框，打的字留着
    if (c && this.cur && !c.sel && !this.cur.sel && c.row === this.cur.row && c.col === this.cur.col && this.input) {
      this.cur = c
      return
    }
    this.closeCell()
    if (!c) return
    const el = this.cell(c.row, c.col)
    if (!el) return
    this.cur = c
    if (c.sel) {
      el.classList.add('cn-cell-sel')
      el.tabIndex = 0
      const take = () => el.isConnected && this.cur === c && el.focus()
      if (now) take()
      else queueMicrotask(() => (el.isConnected ? take() : requestAnimationFrame(take)))
      return
    }
    this.openInput(el, c, now)
  }

  /** 这一格的输入框：字写回 md 里这一格；键盘照文件头说的走 */
  private openInput(el: HTMLTableCellElement, c: Cell, now: boolean, seed?: string) {
    const { row, col } = c
    const text = this.text(row, col)
    const input = document.createElement('input')
    input.className = 'cm-cellin'
    input.value = seed ?? text
    input.setAttribute('aria-label', row < 0 ? tNow('表头第 {col} 格', { col: col + 1 }) : tNow('第 {row} 行第 {col} 格', { row: row + 1, col: col + 1 }))
    el.textContent = ''
    el.classList.add('editing', 'cn-cell-edit')
    el.appendChild(input)
    this.input = input
    const view = this.view
    let done = false
    const commit = (next: Cell | null, opts: { addRow?: boolean; keepSel?: boolean; leave?: 'up' | 'down'; then?: (v: EditorView) => void } = {}) => {
      if (done) return
      done = true
      pendingCommit.delete(view)
      const doc = view.state.doc.toString()
      const from = this.pos()
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
        ...(next || opts.keepSel || opts.leave ? {} : { selection: { anchor: after ? Math.min(out.length, after.to) : from } }),
        userEvent: 'input.table',
        annotations: hiddenOk.of(true),
      })
      if (opts.leave && after) leaveTable(view, after, opts.leave)
      else if (!next && !opts.keepSel) view.focus()
      opts.then?.(view)
    }
    this.commit = commit
    const rows = this.rows()
    const cols = this.cols
    const go = (r: number, k: number, more: Partial<Cell> = {}) => commit({ row: r, col: k, ...more })
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.isComposing || e.keyCode === 229) return
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'z' || e.key === 'Z')) {
        // 输入框里还没改过字：⌘Z 撤的是文档上一步（加的行、改的上一格），不是输入框自己的
        if (input.value !== text) return
        e.preventDefault()
        commit({ row, col, sel: true }, { then: (v) => (e.shiftKey ? redo : undo)(v) })
        return
      }
      // 别的 ⌘ ⌥ 键：上面拦着不往上冒（编辑器不能当成自己的键），窗口上的全局命令（⌘K 搜索、⌘O、⌘[ 后退……）就收不到：在这里交给它
      if (mod || e.altKey) {
        if (runAppKey(e)) e.preventDefault()
        return
      }
      const atStart = input.selectionStart === 0 && input.selectionEnd === 0
      const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length
      if (e.key === 'Tab') {
        e.preventDefault()
        const at = { row: row + 1, col }
        const to = tabFrom(at, { rows: rows + 1, cols }, e.shiftKey ? -1 : 1)
        if (to.row === at.row && to.col === at.col) {
          // 最后一格 Tab：加一行，进新一行第一格（第一格 ⇧Tab 不动）
          if (!e.shiftKey) commit({ row: rows, col: 0, all: true }, { addRow: true })
          return
        }
        go(to.row - 1, to.col, { all: true })
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (row >= rows - 1) commit({ row: row + 1, col, all: true }, { addRow: true })
        else go(row + 1, col, { all: true })
      } else if (e.key === 'Escape') {
        // 停下：打的字留着（像 Notion），这一格变成选中
        e.preventDefault()
        go(row, col, { sel: true })
      } else if (e.key === 'ArrowUp' && !e.shiftKey) {
        e.preventDefault()
        if (row < 0) commit(null, { leave: 'up' })
        else go(row - 1, col)
      } else if (e.key === 'ArrowDown' && !e.shiftKey) {
        e.preventDefault()
        if (row >= rows - 1) commit(null, { leave: 'down' })
        else go(row + 1, col)
      } else if (e.key === 'ArrowLeft' && !e.shiftKey && atStart) {
        const to = tabFrom({ row: row + 1, col }, { rows: rows + 1, cols }, -1)
        if (to.row === row + 1 && to.col === col) return
        e.preventDefault()
        go(to.row - 1, to.col)
      } else if (e.key === 'ArrowRight' && !e.shiftKey && atEnd) {
        const to = tabFrom({ row: row + 1, col }, { rows: rows + 1, cols }, 1)
        if (to.row === row + 1 && to.col === col) return
        e.preventDefault()
        go(to.row - 1, to.col, { caret: 0 })
      }
    })
    // 点了正文别处：这一格的字写回去，光标留在点的地方
    input.addEventListener('blur', () => {
      // 这个框已经收掉了（贴一块、加删行列时先收的）：不再写回
      if (done || this.input !== input) return
      const run = () => commit(null, { keepSel: true })
      pendingCommit.set(view, run)
      setTimeout(run, 0)
    })
    for (const t of ['mousedown', 'keyup', 'input', 'beforeinput'] as const) input.addEventListener(t, (e) => e.stopPropagation())
    const take = () => {
      if (!input.isConnected || this.input !== input) return
      input.focus()
      if (c.all) input.setSelectionRange(0, input.value.length)
      else {
        const at = c.caret === undefined ? input.value.length : Math.min(c.caret, input.value.length)
        input.setSelectionRange(at, at)
      }
    }
    // 编辑器这一轮画完就把焦点给新格子（微任务，下一个按键之前）；还没挂上就等下一帧
    if (now) take()
    else queueMicrotask(() => (input.isConnected ? take() : requestAnimationFrame(take)))
  }

  /** 点一格：进这一格改字，光标落在点的地方（格子里有记号、公式的落在末尾） */
  private cellDown(e: MouseEvent, row: number, col: number) {
    if (e.button !== 0 || this.view.state.readOnly || (e.target as HTMLElement).tagName === 'INPUT') return
    e.preventDefault()
    // 提示块里的表格（每行前面有「> 」，就地改写回去会丢「> 」）：光标放进这一行原文（「> 」后面），这一块露出原文能改（md-widgets.ts calloutWidgets）
    if (this.quoted) {
      const first = this.view.state.doc.lineAt(this.pos()).number
      const line = this.view.state.doc.line(Math.min(this.view.state.doc.lines, first + (row < 0 ? 0 : row + 2)))
      this.view.focus()
      this.view.dispatch({ selection: { anchor: line.from + (/^\s*>\s?/.exec(line.text)?.[0].length ?? 0) }, userEvent: 'select.pointer' })
      return
    }
    const next: Cell = { row, col, caret: caretAt(this.cell(row, col)!, this.text(row, col), e) }
    if (this.commit) this.commit(next)
    else this.view.dispatch({ effects: editCell.of({ table: this.pos(), ...next }) })
  }

  /** 选中一格时按的键（grid-focus 翻成要做什么） */
  private selKey(e: KeyboardEvent, row: number, col: number) {
    if (!this.cur?.sel || this.cur.row !== row || this.cur.col !== col || e.target !== this.cell(row, col)) return
    const mod = e.metaKey || e.ctrlKey
    if (mod && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault()
      e.stopPropagation()
      ;(e.shiftKey ? redo : undo)(this.view)
      return
    }
    const act = gridKey(e, { row: row + 1, col }, { rows: this.rows() + 1, cols: this.cols })
    if (!act) return
    e.stopPropagation()
    const from = this.pos()
    if (act.kind === 'edit' && act.typed) {
      // 直接打字：同一下就把输入框放进这一格、拿到焦点，这个键的字落进去换掉原来的字（输入法也是）
      const el = this.cell(row, col)!
      this.closeCell()
      const c: Cell = { row, col }
      this.cur = c
      this.openInput(el, c, true, '')
      this.view.dispatch({ effects: editCell.of({ table: from, ...c }) })
      return
    }
    e.preventDefault()
    if (act.kind === 'move') this.view.dispatch({ effects: editCell.of({ table: from, row: act.to.row - 1, col: act.to.col, sel: true }) })
    else if (act.kind === 'edit') this.view.dispatch({ effects: editCell.of({ table: from, row, col }) })
    else if (act.kind === 'clear') this.edit((doc, b) => setTableCell(doc, b, row, col, ''), { row, col, sel: true }, 'delete.table')
    else if (act.kind === 'leave' || act.kind === 'escape') {
      const b = tableAt(this.view.state.doc.toString(), from)
      this.view.dispatch({ effects: editCell.of(null) })
      if (b) leaveTable(this.view, b, act.kind === 'leave' ? act.dir : 'down')
    }
  }

  /** 改这张表：fn 算出整篇新文字，按最小改动写进去（一次 ⌘Z 撤回），然后停在 next 那一格 */
  edit(fn: (doc: string, b: MdBlock) => string, next: Cell | null, userEvent = 'input.table') {
    const view = this.view
    const run = () => {
      const doc = view.state.doc.toString()
      const from = this.pos()
      const b = tableAt(doc, from)
      if (!b) return
      const out = fn(doc, b)
      view.dispatch({ changes: out === doc ? [] : minimalChange(doc, out), effects: editCell.of(next ? { table: from, ...next } : null), userEvent, annotations: hiddenOk.of(true) })
    }
    // 正在改字的那一格先写回去（这一步和它分开撤）
    if (this.commit && this.cur && !this.cur.sel) this.commit(this.cur, { keepSel: true })
    run()
  }

  // ---------- 复制、剪切、粘贴 ----------

  clip(e: ClipboardEvent) {
    const c = this.cur
    if (!c || !this.editable || !e.clipboardData) return
    if (e.type === 'paste') {
      const text = e.clipboardData.getData('text/plain')
      const grid = parseGridText(text)
      // 改字时贴一段普通的字：输入框自己收
      if (!c.sel && grid.length === 1 && grid[0]!.length === 1) return
      if (!text) return
      e.preventDefault()
      e.stopPropagation()
      const val = !c.sel && this.input ? this.input.value : null
      const orig = this.text(c.row, c.col)
      const next = { row: c.row, col: c.col, sel: true }
      // 贴进来的几行几格从这一格往右下铺，不够加行加列；改字时这一格先写回去（同一步）
      this.closeCell()
      this.edit((doc, b) => {
        const d = val !== null && val !== orig ? setTableCell(doc, b, c.row, c.col, val) : doc
        const b2 = tableAt(d, b.from) ?? b
        return pasteTableCells(d, b2, c.row, c.col, grid)
      }, next, 'input.paste')
      return
    }
    if (!c.sel) return
    e.preventDefault()
    e.stopPropagation()
    e.clipboardData.setData('text/plain', gridText([[this.text(c.row, c.col)]]))
    if (e.type === 'cut') this.edit((doc, b) => setTableCell(doc, b, c.row, c.col, ''), { ...c }, 'delete.cut')
  }

  // ---------- 行把手、列把手、拖列宽 ----------

  private handles() {
    const layer = this.view.dom
    const grip = (cls: string, label: string) => {
      const b = document.createElement('button')
      b.className = 'tbl-grip ' + cls
      b.type = 'button'
      b.tabIndex = -1
      b.setAttribute('aria-label', label)
      b.innerHTML = codiconSvg('gripper', { size: 14 })
      b.hidden = true
      layer.appendChild(b)
      // 从表格挪到把手上：不收起
      b.addEventListener('mouseenter', () => {
        clearTimeout(this.hideTimer)
        tip.show(b, label)
      })
      b.addEventListener('mouseleave', () => {
        tip.hide()
        this.hideSoon()
      })
      // 按下就收提示（拖着、开菜单时不挂着）
      b.addEventListener('mousedown', () => tip.hide(), true)
      return b
    }
    this.rowGrip = grip('tbl-rgrip', tNow('拖动挪这一行 · 点一下打开菜单'))
    this.colGrip = grip('tbl-cgrip', tNow('拖动挪这一列 · 点一下打开菜单'))
    this.rowGrip.addEventListener('mousedown', (e) => this.gripDown(e, 'row'))
    this.colGrip.addEventListener('mousedown', (e) => this.gripDown(e, 'col'))
    this.wrap.addEventListener('mousemove', (e) => {
      if (this.dragging) return
      const td = (e.target as HTMLElement).closest('td,th') as HTMLElement | null
      if (td && this.table.contains(td)) {
        clearTimeout(this.hideTimer)
        // 只露一张表的把手：上一张悬停过的马上收起
        if (gripsOn && gripsOn !== this) gripsOn.hideNow()
        gripsOn = this
        this.hover = { row: Number(td.dataset.row), col: Number(td.dataset.col) }
        this.placeGrips()
      }
    })
    this.wrap.addEventListener('mouseleave', () => this.hideSoon())
    this.wrap.addEventListener('scroll', () => this.placeGrips(), { passive: true })
    this.view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true })
    // 挂在横滑那一层上（表格本身加删行列后会整张重画，挂在它上面的会丢）
    for (const t of ['copy', 'cut', 'paste'] as const) this.wrap.addEventListener(t, (e) => this.clip(e))
    this.resizers()
  }

  private onScroll = () => this.placeGrips()

  hideNow() {
    clearTimeout(this.hideTimer)
    this.hover = null
    this.placeGrips()
  }

  /** 鼠标离开表格和把手 300 毫秒后收起把手（拖着、菜单开着不收） */
  private hideSoon() {
    clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      if (this.dragging || tableMenuOpen()) return
      this.hover = null
      this.placeGrips()
    }, 300)
  }

  /** 把手放到悬停的那一行左边框、那一列上边框的正中；那一格横着滚出去了就收起列把手 */
  private placeGrips() {
    const h = this.hover
    if (!this.rowGrip || !this.colGrip) return
    if (!h || this.cols === 0) {
      this.rowGrip.hidden = this.colGrip.hidden = true
      return
    }
    if (!this.wrap.isConnected) return
    const box = this.view.dom.getBoundingClientRect()
    const tr = this.cell(h.row, 0)?.parentElement?.getBoundingClientRect()
    const cell = this.cell(-1, h.col)?.getBoundingClientRect()
    const vis = this.wrap.getBoundingClientRect()
    // 表头那一行不出行把手：它挪不了，而且会和左边留白里的块把手「⋮⋮」挤在一起（设计复审）
    this.rowGrip.hidden = !tr || h.row < 0
    this.colGrip.hidden = !cell
    if (tr) {
      this.rowGrip.style.top = tr.top - box.top + tr.height / 2 + 'px'
      this.rowGrip.style.left = vis.left - box.left + 'px'
      this.rowGrip.dataset.row = String(h.row)
    }
    if (cell) {
      const mid = cell.left + cell.width / 2
      this.colGrip.hidden = mid < vis.left || mid > vis.right
      this.colGrip.style.left = mid - box.left + 'px'
      this.colGrip.style.top = cell.top - box.top + 'px'
      this.colGrip.dataset.col = String(h.col)
    }
  }

  /** 按住把手：拖开 4 像素算挪，没拖开是点（开菜单） */
  private gripDown(e: MouseEvent, kind: 'row' | 'col') {
    if (e.button !== 0 || !this.hover) return
    e.preventDefault()
    e.stopPropagation()
    const at = kind === 'row' ? this.hover.row : this.hover.col
    const grip = kind === 'row' ? this.rowGrip! : this.colGrip!
    const x0 = e.clientX
    const y0 = e.clientY
    let moving = false
    let target = -1
    // 表头那一行不能挪（Markdown 的第一行就是表头）
    const canMove = kind === 'col' ? this.cols > 1 : at >= 0 && this.rows() > 1
    dragEsc(e, {
      move: (m) => {
        if (!canMove) return
        if (!moving && Math.hypot(m.clientX - x0, m.clientY - y0) < 4) return
        if (!moving) {
          moving = this.dragging = true
          this.view.dom.classList.add('tbl-dragging')
          this.mark(kind, at, true)
        }
        target = this.dropAt(kind, m)
      },
      end: (how) => {
        this.dragging = false
        this.view.dom.classList.remove('tbl-dragging')
        this.mark(kind, at, false)
        this.drop?.remove()
        this.drop = null
        if (!moving) return how === 'up' ? this.menu(kind, at, grip) : undefined
        if (how !== 'up' || target < 0) return
        // target：落在第几条缝前面（0 是最上 / 最左）→ 挪完以后在第几个
        const to = target > at ? target - 1 : target
        if (to === at) return
        if (kind === 'row') this.edit((doc, b) => moveTableRow(doc, b, at, to), { row: to, col: Math.max(0, this.hover?.col ?? 0), sel: true }, 'move.table')
        else this.edit((doc, b) => moveTableCol(doc, b, at, to), { row: -1, col: to, sel: true }, 'move.table')
      },
    })
  }

  private markHot(kind: 'row' | 'col', at: number, on: boolean) {
    if (kind === 'row') for (let k = 0; k < this.cols; k++) this.cell(at, k)?.classList.toggle('tbl-hot', on)
    else for (let r = -1; r < this.rows(); r++) this.cell(r, at)?.classList.toggle('tbl-hot', on)
  }

  /** 拖着的那一行 / 列变淡 */
  private mark(kind: 'row' | 'col', at: number, on: boolean) {
    if (kind === 'row') this.cell(at, 0)?.parentElement?.classList.toggle('tbl-ghost', on)
    else for (let r = -1; r < this.rows(); r++) this.cell(r, at)?.classList.toggle('tbl-ghost', on)
  }

  /** 拖到哪条缝：画一道落点线，返回缝的序号（行：表头下面的行之间；列：每列之间） */
  private dropAt(kind: 'row' | 'col', m: MouseEvent): number {
    const box = this.view.dom.getBoundingClientRect()
    const vis = this.wrap.getBoundingClientRect()
    if (!this.drop) {
      this.drop = document.createElement('div')
      this.drop.className = 'tbl-drop'
      this.view.dom.appendChild(this.drop)
    }
    const d = this.drop
    const tb = this.table.getBoundingClientRect()
    if (kind === 'row') {
      const rs = Array.from({ length: this.rows() }, (_, i) => this.cell(i, 0)!.parentElement!.getBoundingClientRect())
      let k = rs.findIndex((r) => m.clientY < r.top + r.height / 2)
      if (k < 0) k = rs.length
      const y = k < rs.length ? rs[k]!.top : rs[rs.length - 1]!.bottom
      Object.assign(d.style, { left: vis.left - box.left + 'px', width: Math.min(vis.width, tb.width) + 'px', top: y - box.top - 1 + 'px', height: '2px' })
      return k
    }
    const cs = Array.from({ length: this.cols }, (_, k) => this.cell(-1, k)!.getBoundingClientRect())
    let k = cs.findIndex((c) => m.clientX < c.left + c.width / 2)
    if (k < 0) k = cs.length
    const x = Math.max(vis.left, Math.min(vis.right, k < cs.length ? cs[k]!.left : cs[cs.length - 1]!.right))
    Object.assign(d.style, { left: x - box.left - 1 + 'px', width: '2px', top: tb.top - box.top + 'px', height: tb.height + 'px' })
    return k
  }

  private menu(kind: 'row' | 'col', at: number, grip: HTMLElement) {
    grip.classList.add('on')
    // 菜单开着：这一行 / 这一列盖一层强调色（和块菜单开着时那一块一样），删之前看得清删的是哪一处
    this.markHot(kind, at, true)
    const rows = this.rows()
    const items: TableMenuItem[] =
      kind === 'row'
        ? [
            { id: 'above', label: tNow('上面加一行'), icon: 'arrow-up' },
            { id: 'below', label: tNow('下面加一行'), icon: 'arrow-down' },
            { id: 'del', label: tNow('删掉这一行'), icon: 'trash', sep: true, off: at < 0 && rows === 0 },
          ]
        : [
            { id: 'left', label: tNow('左边加一列'), icon: 'arrow-left' },
            { id: 'right', label: tNow('右边加一列'), icon: 'arrow-right' },
            { id: 'a-left', label: tNow('靠左'), icon: 'blank', sep: true, on: (this.t.align[at] ?? null) === null || this.t.align[at] === 'left' },
            { id: 'a-center', label: tNow('居中'), icon: 'blank', on: this.t.align[at] === 'center' },
            { id: 'a-right', label: tNow('靠右'), icon: 'blank', on: this.t.align[at] === 'right' },
            { id: 'del', label: tNow('删掉这一列'), icon: 'trash', sep: true, off: this.cols <= 1 },
          ]
    openTableMenu(grip, kind === 'row' ? tNow('行菜单') : tNow('列菜单'), items, (id) => this.pick(kind, at, id), () => {
      grip.classList.remove('on')
      this.markHot(kind, at, false)
      if (!this.wrap.matches(':hover')) {
        this.hover = null
        this.placeGrips()
      }
    })
  }

  private pick(kind: 'row' | 'col', at: number, id: string) {
    if (kind === 'row') {
      if (id === 'above' || id === 'below') {
        // 新的一行：进它第一格打字
        const row = id === 'above' ? at : at + 1
        return this.edit((doc, b) => insertTableRow(doc, b, at, id), { row: Math.max(0, row), col: 0 })
      }
      // 删了以后选中同一处的一格（键盘接着能用，⌘Z 撤得回）
      if (id === 'del') return this.edit((doc, b) => deleteTableRow(doc, b, at), { row: Math.max(-1, Math.min(at, this.rows() - 2)), col: 0, sel: true }, 'delete.table')
      return
    }
    if (id === 'left' || id === 'right') return this.edit((doc, b) => insertTableCol(doc, b, at, id), { row: -1, col: id === 'left' ? at : at + 1 })
    if (id === 'del') return this.edit((doc, b) => deleteTableCol(doc, b, at), { row: -1, col: Math.max(0, Math.min(at, this.cols - 2)), sel: true }, 'delete.table')
    const align: TableAlign = id === 'a-center' ? 'center' : id === 'a-right' ? 'right' : null
    const now = this.t.align[at] ?? null
    // 「靠左」：本来写着 :--- 的留着，没写的不加（默认就是靠左）
    if (id === 'a-left' && (now === null || now === 'left')) return
    this.edit((doc, b) => setTableAlign(doc, b, at, align), { row: -1, col: at, sel: true })
  }

  /** 两列之间的缝：按住左右拖改宽窄（左右两列此消彼长，整张表还是那么宽），松手写进第二行 */
  private resizers() {
    this.wrap.addEventListener('mousemove', (e) => {
      if (this.dragging || (e.buttons & 1) !== 0) return
      const k = this.borderAt(e.clientX, e.clientY)
      this.wrap.classList.toggle('tbl-rz-hot', k >= 0)
      this.wrap.style.setProperty('--rz-x', k >= 0 ? this.cell(-1, k)!.getBoundingClientRect().right - this.wrap.getBoundingClientRect().left + this.wrap.scrollLeft + 'px' : '0px')
    })
    this.wrap.addEventListener('mouseleave', () => !this.dragging && this.wrap.classList.remove('tbl-rz-hot'))
    this.wrap.addEventListener(
      'mousedown',
      (e) => {
        if (e.button !== 0) return
        const k = this.borderAt(e.clientX, e.clientY)
        if (k < 0) return
        e.preventDefault()
        e.stopPropagation()
        const px = Array.from({ length: this.cols }, (_, i) => this.cell(-1, i)!.getBoundingClientRect().width)
        const pair = px[k]! + px[k + 1]!
        const x0 = e.clientX
        this.dragging = true
        this.wrap.classList.add('tbl-rz-on')
        // 拖列宽时把手收起来（列把手会停在旧位置上）
        this.hideNow()
        let cur = px.slice()
        dragEsc(e, {
          move: (m) => {
            const a = Math.max(MIN_COL, Math.min(pair - MIN_COL, px[k]! + m.clientX - x0))
            cur = px.slice()
            cur[k] = a
            cur[k + 1] = pair - a
            this.setColPx(cur)
            this.wrap.style.setProperty('--rz-x', cur.slice(0, k + 1).reduce((s, x) => s + x, 0) + 'px')
          },
          end: (how) => {
            this.dragging = false
            this.wrap.classList.remove('tbl-rz-on', 'tbl-rz-hot')
            const sum = cur.reduce((s, x) => s + x, 0)
            if (how !== 'up' || cur.every((x, i) => Math.abs(x - px[i]!) < 1)) {
              // 没拖开、拖丢了：照原来的宽
              if (this.widths) this.layout()
              else {
                this.table.querySelector('colgroup')?.remove()
                this.table.classList.remove('sized')
                this.table.style.width = ''
              }
              return
            }
            this.edit((doc, b) => setTableWidths(doc, b, cur.map((x) => x / sum)), this.cur, 'input.table')
          },
        })
      },
      true,
    )
  }

  /** 指着哪两列之间的缝（左边那一列的序号；最后一列右边、表外面给 -1） */
  private borderAt(x: number, y: number): number {
    const tb = this.table.getBoundingClientRect()
    if (y < tb.top || y > tb.bottom) return -1
    for (let k = 0; k < this.cols - 1; k++) {
      const r = this.cell(-1, k)!.getBoundingClientRect().right
      if (Math.abs(x - r) <= 4) return k
    }
    return -1
  }

  destroy() {
    clearTimeout(this.hideTimer)
    if (gripsOn === this) gripsOn = null
    this.rowGrip?.remove()
    this.colGrip?.remove()
    this.drop?.remove()
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll)
    if (this.input) pendingCommit.delete(this.view)
    this.unfade()
    this.ro.disconnect()
  }
}

/** 按住拖，Esc 取消（像按了 Esc 的拖块：当没拖过，end 收到 lost） */
function dragEsc(down: MouseEvent, h: { move(m: MouseEvent): void; end(how: 'up' | 'lost', e: MouseEvent | null): void }) {
  const esc = (k: KeyboardEvent) => {
    if (k.key !== 'Escape') return
    k.preventDefault()
    k.stopPropagation()
    window.removeEventListener('keydown', esc, true)
    stop()
    h.end('lost', null)
  }
  window.addEventListener('keydown', esc, true)
  const stop = trackDrag(down, {
    move: h.move,
    end: (how, e) => {
      window.removeEventListener('keydown', esc, true)
      h.end(how, e)
    },
  })
}

/** 点在格子里哪个字后面：格子里的字就是原文（没有记号、公式）时照点的地方，不然放末尾 */
function caretAt(el: HTMLElement, text: string, e: MouseEvent): number | undefined {
  if (el.textContent !== text) return undefined
  const r = document.caretRangeFromPoint?.(e.clientX, e.clientY)
  if (!r || !el.contains(r.startContainer)) return undefined
  const pre = document.createRange()
  pre.selectNodeContents(el)
  pre.setEnd(r.startContainer, r.startOffset)
  return pre.toString().length
}

/** 出表：第一行往上回到上面的正文，最后一行往下回到下面的（和数据库表格同一个走法，task-cle3x） */
function leaveTable(view: EditorView, b: { from: number; to: number }, dir: 'up' | 'down') {
  view.focus()
  view.dispatch({ selection: EditorSelection.single(b.from, b.to) })
  // 选中整块再收到头 / 尾：block-flow 的 gapFilter 照「选中的卡片按方向键收起」走到上一块末尾 / 下一块开头
  view.dispatch({ selection: EditorSelection.cursor(dir === 'up' ? b.from : b.to), userEvent: 'select', scrollIntoView: true })
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

// ---------- 从正文进表 ----------

/** 选区正好是一整张表（从正文按 ↑↓ 走到表上，整块选中） */
function selectedTable(state: EditorState): MdBlock | null {
  const s = state.selection.main
  if (s.empty || state.selection.ranges.length > 1) return null
  return findBlocks(state.doc.toString()).find((b) => b.kind === 'table' && b.from === s.from && b.to === s.to) ?? null
}

/** 整表选中是从哪边过来的：上面按 ↓ 过来再按 ↓ 进表头第一格；下面按 ↑ 过来再按 ↑ 进最后一行第一格 */
const arrive = StateEffect.define<'above' | 'below' | null>()
const arrived = StateField.define<'above' | 'below' | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(arrive)) return e.value
    if (!tr.selection) return tr.docChanged ? null : v
    const b = selectedTable(tr.state)
    if (!b) return null
    const was = tr.startState.selection.main
    if (was.from === b.from && was.to === b.to) return v
    if (tr.isUserEvent('select.pointer')) return null
    return was.head <= b.from ? 'above' : was.head >= b.to ? 'below' : null
  },
})

function enterTable(view: EditorView, last: boolean): boolean {
  const b = selectedTable(view.state)
  if (!b || view.state.readOnly) return false
  const rows = parseTable(view.state.doc.toString(), b).rows.length
  view.dispatch({ selection: EditorSelection.cursor(b.from), effects: [arrive.of(null), editCell.of({ table: b.from, row: last ? rows - 1 : -1, col: 0, sel: true })] })
  return true
}

const enterKeys = Prec.highest(
  keymap.of([
    { key: 'Enter', run: (v) => enterTable(v, false) },
    { key: 'ArrowDown', run: (v) => v.state.field(arrived) === 'above' && enterTable(v, false) },
    { key: 'ArrowUp', run: (v) => v.state.field(arrived) === 'below' && enterTable(v, true) },
  ]),
)

export const tableNav = [arrived, enterKeys]

// ---------- 粘贴：制表符隔开的几行几格（Numbers、Excel、Google 表格复制的）贴进正文成一张表 ----------

/** 像表格软件复制来的：至少两行、每行都有制表符 */
export function looksLikeGrid(text: string): boolean {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  return lines.length >= 2 && lines.every((l) => l.includes('\t'))
}

export const pasteGrid = EditorView.domEventHandlers({
  paste(e, view) {
    const dt = e.clipboardData
    if (!dt || view.state.readOnly || dt.files.length) return false
    // 带 HTML 表格的（网页、Excel）归 paste-html 转
    if (/<table[\s>]/i.test(dt.getData('text/html'))) return false
    const text = dt.getData('text/plain')
    if (!looksLikeGrid(text)) return false
    const sel = view.state.selection.main
    const line = view.state.doc.lineAt(sel.from)
    const end = view.state.doc.lineAt(sel.to)
    const pre = view.state.sliceDoc(line.from, sel.from).trim() ? '\n\n' : line.from > 0 && view.state.doc.lineAt(line.from - 1).text.trim() ? '\n' : ''
    // 后面紧跟着一行字：空一行隔开，不然那一行被认成表格的一行
    const post = view.state.sliceDoc(sel.to, end.to).trim() ? '\n\n' : end.to < view.state.doc.length && view.state.doc.lineAt(end.to + 1).text.trim() ? '\n' : ''
    const md = gridToTable(parseGridText(text))
    e.preventDefault()
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert: pre + md + post }, selection: { anchor: sel.from + pre.length + md.length }, userEvent: 'input.paste', scrollIntoView: true })
    return true
  },
})
