import { contentBlocks, parseTable, resolveLink, toggleTask, type MdBlock } from '@cn/format'
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { editorHost } from './editor-host'
import { type Hidden, hiddenSyntax, wholeBlock } from './hidden-syntax'
import { inVideoBlock } from './video/block-head'

/**
 * 文档模式里画成控件的 md：待办的勾选框、表格、图片。
 * 只加装饰不改文字；点勾选框改的是 md 里的 [ ] / [x] 那一个字。
 */

// ---------- 待办 ----------

class TaskBox extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(o: TaskBox) {
    return o.checked === this.checked
  }
  toDOM(view: EditorView) {
    const box = document.createElement('span')
    box.className = 'cm-taskbox' + (this.checked ? ' on' : '')
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.setAttribute('aria-label', this.checked ? '已完成，点一下取消' : '点一下勾上')
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      if (view.state.readOnly) return
      const line = view.state.doc.lineAt(view.posAtDOM(box))
      const next = toggleTask(line.text)
      if (next === line.text) return
      view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: 'input.toggle' })
    })
    return box
  }
  ignoreEvent() {
    return true
  }
}

function taskDecos(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = []
  const doc = view.state.doc
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'TaskMarker') return
        const mark = node.node.parent?.parent?.firstChild
        if (!mark || mark.name !== 'ListMark') return
        const checked = /x/i.test(doc.sliceString(node.from, node.to))
        let end = node.to
        if (doc.sliceString(end, end + 1) === ' ') end++
        out.push(Decoration.replace({ widget: new TaskBox(checked) }).range(mark.from, end))
        if (checked) out.push(Decoration.mark({ class: 'cm-task-done' }).range(end, doc.lineAt(end).to))
      },
    })
  }
  return Decoration.set(out, true)
}

const tasks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = taskDecos(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = taskDecos(u.view)
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
  },
)

/** 行首打 [] 再打空格 → 待办「- [ ] 」 */
const taskInput = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ' ' || from !== to) return false
  const line = view.state.doc.lineAt(from)
  const m = /^([ \t]*)\[( |x|X)?\]$/.exec(line.text.slice(0, from - line.from))
  if (!m) return false
  const box = m[2] && m[2] !== ' ' ? '[x]' : '[ ]'
  const insert = `- ${box} `
  view.dispatch({
    changes: { from: line.from + m[1]!.length, to: from, insert },
    selection: { anchor: line.from + m[1]!.length + insert.length },
    userEvent: 'input.type',
  })
  return true
})

// ---------- 表格、图片 ----------

class TableWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly block: MdBlock,
  ) {
    super()
  }
  eq(o: TableWidget) {
    return o.src === this.src && o.block.from === this.block.from
  }
  toDOM(view: EditorView) {
    const t = parseTable(this.src, { ...this.block, from: 0, to: this.src.length })
    const wrap = document.createElement('div')
    wrap.className = 'cm-table'
    const table = document.createElement('table')
    const cell = (tag: 'th' | 'td', c: { text: string; from: number; to: number }, k: number) => {
      const el = document.createElement(tag)
      el.textContent = c.text
      const a = t.align[k]
      if (a) el.style.textAlign = a
      el.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const at = this.block.from + c.to
        view.focus()
        view.dispatch({ selection: { anchor: at }, scrollIntoView: true })
      })
      return el
    }
    const thead = table.createTHead().insertRow()
    t.head.forEach((c, k) => thead.appendChild(cell('th', c, k)))
    const body = table.createTBody()
    for (const r of t.rows) {
      const tr = body.insertRow()
      r.forEach((c, k) => tr.appendChild(cell('td', c, k)))
    }
    wrap.appendChild(table)
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

const IMAGE = /!\[([^\]\n]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\s*\)/

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly from: number,
  ) {
    super()
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt && o.from === this.from
  }
  toDOM(view: EditorView) {
    const fig = document.createElement('div')
    fig.className = 'cm-image'
    const img = document.createElement('img')
    img.alt = this.alt
    img.draggable = false
    img.src = this.src
    img.addEventListener('error', () => {
      fig.classList.add('broken')
      fig.textContent = `图片打不开：${this.alt || this.src}`
    })
    fig.appendChild(img)
    // 库里的图：悬停时右上角写它存在哪（附件 / 未命名 3 / 截图 1.png），能在访达中显示（CN-40）
    const rel = this.src.startsWith('cn-file://vault/') ? this.src.slice('cn-file://vault/'.length).split('/').map(decodeURIComponent).join('/') : null
    if (rel) {
      const tag = document.createElement('div')
      tag.className = 'cm-image-tag'
      const where = document.createElement('span')
      where.textContent = rel.split('/').join(' / ')
      const show = document.createElement('button')
      show.type = 'button'
      show.tabIndex = -1
      show.textContent = '在访达中显示'
      show.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        void window.cnMenu.reveal(rel)
      })
      tag.append(where, show)
      fig.appendChild(tag)
    }
    // 说明（alt）写在图下面一行（DESIGN.v3 6.5）；没写说明时什么都不显示，悬停才出一行灰字「加说明…」，点了就地写
    const cap = document.createElement('div')
    cap.className = 'cm-image-cap' + (this.alt.trim() ? '' : ' add')
    cap.textContent = this.alt.trim() || '加说明…'
    cap.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || view.state.readOnly) return
      e.preventDefault()
      e.stopPropagation()
      this.editCaption(view, cap)
    })
    fig.appendChild(cap)
    fig.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      // 点图选中这一块（再按退格删掉）；光标不进原文
      const end = view.state.doc.lineAt(this.from).to
      view.focus()
      view.dispatch({ selection: { anchor: this.from, head: end } })
    })
    return fig
  }
  /** 就地改说明：回车写进 ![说明](…)，Esc 不改 */
  private editCaption(view: EditorView, cap: HTMLElement) {
    const input = document.createElement('input')
    input.className = 'cm-image-capin'
    input.value = this.alt
    input.placeholder = '加说明…'
    input.setAttribute('aria-label', '图片说明')
    cap.replaceChildren(input)
    cap.classList.remove('add')
    cap.classList.add('editing')
    let done = false
    const finish = (save: boolean) => {
      if (done) return
      done = true
      const v = input.value.replace(/[[\]\n]/g, ' ').trim()
      const at = this.from
      const alt = view.state.doc.sliceString(at, at + 2 + this.alt.length + 1)
      if (save && v !== this.alt && alt === `![${this.alt}]`) view.dispatch({ changes: { from: at + 2, to: at + 2 + this.alt.length, insert: v }, userEvent: 'input.caption' })
      else {
        cap.classList.remove('editing')
        cap.classList.toggle('add', !this.alt.trim())
        cap.textContent = this.alt.trim() || '加说明…'
      }
      view.focus()
    }
    input.addEventListener('mousedown', (e) => e.stopPropagation())
    input.addEventListener('keydown', (e) => {
      e.stopPropagation()
      if (e.key === 'Enter' && !e.isComposing) (e.preventDefault(), finish(true))
      else if (e.key === 'Escape') (e.preventDefault(), finish(false))
    })
    input.addEventListener('blur', () => finish(true))
    input.focus()
  }
  ignoreEvent() {
    return true
  }
}

/** 笔记里写的图片地址 → 能显示的地址：库里的文件走 cn-file://，网址原样 */
export function imageSrc(notePath: string, url: string): string {
  if (/^(https?:|data:)/.test(url)) return url
  const p = resolveLink(notePath, url)
  return p ? 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/') : url
}

function touches(state: EditorState, b: MdBlock): boolean {
  const from = state.doc.lineAt(b.from).from
  const to = state.doc.lineAt(b.to).to
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from)
}

/** 光标一动就要重画，块按文字缓存，文字没变不重找 */
const blockCache = new WeakMap<Text, MdBlock[]>()

function blockWidgets(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  const path = state.facet(editorHost).path()
  let blocks = blockCache.get(state.doc)
  if (!blocks) blockCache.set(state.doc, (blocks = contentBlocks(state.doc.toString())))
  for (const b of blocks) {
    if (b.kind === 'table') {
      if (touches(state, b)) continue
      const src = state.doc.sliceString(b.from, b.to)
      out.push(Decoration.replace({ widget: new TableWidget(src, b), block: true }).range(b.from, b.to))
    } else if (b.kind === 'image') {
      // 视频块里的截图由 video/doc-widgets 画
      if (inVideoBlock(state, b.from)) continue
      const m = IMAGE.exec(state.doc.sliceString(b.from, b.to))
      if (!m) continue
      // 光标在哪都画成图，不露 ![说明](附件/…) 原文（CN-86、CN-40）
      out.push(Decoration.replace({ widget: new ImageWidget(imageSrc(path, m[2]!), m[1]!, b.from), block: true }).range(b.from, b.to))
    }
  }
  return Decoration.set(out, true)
}

const widgets = StateField.define<DecorationSet>({
  create: blockWidgets,
  update: (v, tr) => (tr.docChanged || tr.selection ? blockWidgets(tr.state) : v),
  provide: (f) => [
    EditorView.decorations.from(f),
    // 图片是一整块（表格点进去要改格子，不算）
    EditorView.atomicRanges.of((view) => {
      const out: Range<Decoration>[] = []
      view.state.field(f).between(0, view.state.doc.length, (from, to, d) => void (d.spec.widget instanceof ImageWidget && out.push(d.range(from, to))))
      return Decoration.set(out)
    }),
    hiddenSyntax.of((state) => {
      const out: Hidden[] = []
      state.field(f).between(0, state.doc.length, (from, to, d) => void (d.spec.widget instanceof ImageWidget && out.push(wholeBlock(state.doc, from, to, true))))
      return out
    }),
  ],
})

export const mdWidgets = [tasks, taskInput, widgets]
