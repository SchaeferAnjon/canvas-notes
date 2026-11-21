import { contentBlocks, imageEmbed, resolveLink, splitImageAlt, toggleTask, type MdBlock } from '@cn/format'
import { syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField, type Text } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { editorHost } from './editor-host'
import { type Hidden, hiddenSyntax, wholeBlock } from './hidden-syntax'
import { inVideoBlock } from './video/block-head'
import { editCell, tableCellFlush, tableEditField, TableWidget } from './table-edit'

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

/** 只有换成勾选框的「- [x] 」是一整颗（光标一下跨过去）；勾上的那条的字（划线的 mark）不是：不然退格一下整条字全删了 */
function boxesOf(decos: DecorationSet): DecorationSet {
  const out: Range<Decoration>[] = []
  for (const it = decos.iter(); it.value; it.next()) if (it.value.point) out.push(it.value.range(it.from, it.to))
  return Decoration.set(out, true)
}

const tasks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    boxes: DecorationSet
    constructor(view: EditorView) {
      this.decorations = taskDecos(view)
      this.boxes = boxesOf(this.decorations)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = taskDecos(u.view)
        this.boxes = boxesOf(this.decorations)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.boxes ?? Decoration.none),
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

/**
 * 一整行只有一张图：`![说明](地址)`，或者套着链接的 `[![说明](地址)](网址)`（剪藏整页时维基百科的图都套着链接，第 8 轮 r8-img2）。
 * 这一行在段落里（白板卡片里图片下一行紧跟「—— [来源](网址)」，第 8 轮 r8-img1）也画成图，段里别的行照旧是字
 */
const PLAIN_IMAGE = /^( {0,3})!\[([^\]\n]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\s*\)[ \t]*$/
const LINKED_IMAGE = /^( {0,3}\[)!\[([^\]\n]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\s*\)\]\([^)\s]*(?:\s+"[^"]*")?\s*\)[ \t]*$/

/** 这一行是一张图：![ 在行里第几个字、说明、地址 */
function imageLine(text: string): { at: number; alt: string; url: string } | null {
  const m = PLAIN_IMAGE.exec(text) ?? LINKED_IMAGE.exec(text)
  return m ? { at: m[1]!.length, alt: m[2]!, url: m[3]! } : null
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly alt: string,
    readonly from: number,
    /** Obsidian 写法 ![[图.png|300]]：| 后面那截是宽或说明，就地改说明只认 ![说明](…)，这种不给改 */
    readonly embed = false,
    /** 这一行行首（套着链接的图 [![…](…)](…)，![ 不在行首） */
    readonly start = from,
    /** 段落里的一行（上下还有字）：不靠空行隔开 */
    readonly inPara = false,
  ) {
    super()
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt && o.from === this.from && o.embed === this.embed && o.start === this.start && o.inPara === this.inPara
  }
  toDOM(view: EditorView) {
    const fig = document.createElement('div')
    // 段落里的一行图（白板卡片里图下面紧跟「—— 出处」）：下面那行字就是它的说明，不再留「加说明…」那一行的高（设计复审：出处离自己的图 33、离下一张 16，像下一张的图注）
    fig.className = 'cm-image' + (this.inPara ? ' in-para' : '')
    const img = document.createElement('img')
    // 「我框的|268」：说明只露前半，图照写着的宽显示（读 PDF 的笔记写的是框在 PDF 上 100% 时的宽，Obsidian 的写法）
    const { caption, width } = splitImageAlt(this.embed && /^\d/.test(this.alt) ? '|' + this.alt : this.alt)
    img.alt = caption
    img.draggable = false
    img.src = this.src
    if (width) {
      img.style.width = `${width}px`
      img.style.maxWidth = '100%'
    }
    img.addEventListener('error', () => {
      fig.classList.add('broken')
      fig.textContent = `图片打不开：${caption || (this.embed ? decodeURIComponent(new URL(this.src).pathname.slice(1)) : this.src)}`
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
    cap.className = 'cm-image-cap' + (caption.trim() ? '' : ' add')
    cap.textContent = caption.trim() || '加说明…'
    if (this.embed && !caption.trim()) cap.hidden = true
    cap.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || view.state.readOnly || this.embed) return
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
      view.dispatch({ selection: { anchor: this.start, head: end } })
    })
    return fig
  }
  /** 就地改说明：回车写进 ![说明](…)，Esc 不改；写着宽度（「|268」）的改的是前半，宽度留着 */
  private editCaption(view: EditorView, cap: HTMLElement) {
    const { caption, size } = splitImageAlt(this.alt)
    const input = document.createElement('input')
    input.className = 'cm-image-capin'
    input.value = caption
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
      if (save && v !== caption && alt === `![${this.alt}]`) view.dispatch({ changes: { from: at + 2, to: at + 2 + this.alt.length, insert: v + size }, userEvent: 'input.caption' })
      else {
        cap.classList.remove('editing')
        cap.classList.toggle('add', !caption.trim())
        cap.textContent = caption.trim() || '加说明…'
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

/** ![[图.png]] 里写的名字或路径 → 能显示的地址：主进程照 Obsidian 的找法定到库里哪个文件（attachments.ts） */
export const embedImageSrc = (notePath: string, target: string) => `cn-file://embed/${target.split('/').map(encodeURIComponent).join('/')}?from=${encodeURIComponent(notePath)}`

/** 笔记里写的图片地址 → 能显示的地址：库里的文件走 cn-file://，网址原样 */
export function imageSrc(notePath: string, url: string): string {
  if (/^(https?:|data:)/.test(url)) return url
  const p = resolveLink(notePath, url)
  return p ? 'cn-file://vault/' + p.split('/').map(encodeURIComponent).join('/') : url
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
      // 光标在哪都画成表格（方向 A：不露「| a | b |」），点格子就地改（table-edit.ts）
      const src = state.doc.sliceString(b.from, b.to)
      const ed = state.field(tableEditField, false)
      out.push(Decoration.replace({ widget: new TableWidget(src, b.from, ed && ed.table === b.from ? { row: ed.row, col: ed.col, all: ed.all } : null), block: true }).range(b.from, b.to))
    } else if (b.kind === 'image' || b.kind === 'paragraph') {
      // 视频块里的截图由 video/doc-widgets 画
      if (inVideoBlock(state, b.from)) continue
      // Obsidian 写法 ![[图.png]]、![[图.png|300]] 单独一行：一样画成图
      const em = b.kind === 'paragraph' ? imageEmbed(state.doc.sliceString(b.from, b.to)) : null
      if (em) {
        out.push(Decoration.replace({ widget: new ImageWidget(embedImageSrc(path, em.target), em.alt, b.from, true), block: true }).range(b.from, b.to))
        continue
      }
      // 光标在哪都画成图，不露 ![说明](附件/…) 原文（CN-86、CN-40）；段落里单独占一行的图也画（白板卡片的图下面紧跟来源行）
      for (let n = state.doc.lineAt(b.from).number, last = state.doc.lineAt(b.to).number; n <= last; n++) {
        const line = state.doc.line(n)
        const img = imageLine(line.text)
        if (img) out.push(Decoration.replace({ widget: new ImageWidget(imageSrc(path, img.url), img.alt, line.from + img.at, false, line.from, line.from !== b.from || line.to !== b.to), block: true }).range(line.from, line.to))
      }
    }
  }
  return Decoration.set(out, true)
}

const widgets = StateField.define<DecorationSet>({
  create: blockWidgets,
  update: (v, tr) => (tr.docChanged || tr.effects.some((e) => e.is(editCell)) ? blockWidgets(tr.state) : v),
  provide: (f) => [
    EditorView.decorations.from(f),
    // 图片、表格是一整块（表格的格子在部件里就地改）
    EditorView.atomicRanges.of((view) => {
      const out: Range<Decoration>[] = []
      view.state.field(f).between(0, view.state.doc.length, (from, to, d) => void ((d.spec.widget instanceof ImageWidget || d.spec.widget instanceof TableWidget) && out.push(d.range(from, to))))
      return Decoration.set(out)
    }),
    hiddenSyntax.of((state) => {
      const out: Hidden[] = []
      // 单独成段的图、表格靠空行和正文隔开（sep）；段落里的一行图（下面紧跟来源行）只藏它自己这一行
      state.field(f).between(0, state.doc.length, (from, to, d) => {
        const w = d.spec.widget
        if (w instanceof TableWidget || w instanceof ImageWidget) out.push(wholeBlock(state.doc, from, to, !(w instanceof ImageWidget && w.inPara)))
      })
      return out
    }),
  ],
})

export const mdWidgets = [tableEditField, tableCellFlush, tasks, taskInput, widgets]
