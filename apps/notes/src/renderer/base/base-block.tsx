/**
 * 文档里的 ```base 代码块画成数据库表格（CN-19 A，照 Notion 做全），一整块：光标跨过去、下面行首退格先选中它。
 * 表头上的操作（加列、改类型、改列名、排序、筛选、隐藏、列宽、计算）只改代码块里对应那几行；
 * 要直接改写法点块头上的「改写法」，只在这一块露出 YAML（方向 A「块上露写法」）。
 * 斜杠菜单「数据库」插这个块，同时在旁边建一个放每条记录的文件夹。
 */
import { baseYaml, parseBase, setBaseFilters, setBaseOrder, setBaseSort } from '@cn/format'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { flushSync } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import { editorHost } from '../editor-host'
import { type Hidden, hiddenSyntax, wholeBlock } from '../hidden-syntax'
import { type BaseEdits, BaseTable } from './BaseTable'

/** 整篇里的 ```base 块：[开头行首, 结尾行尾, 中间的 YAML] */
export function baseBlocks(text: string): { from: number; to: number; src: string }[] {
  const out: { from: number; to: number; src: string }[] = []
  const re = /^(```|~~~)base[ \t]*\n([\s\S]*?)^\1[ \t]*$/gm
  for (let m = re.exec(text); m; m = re.exec(text)) out.push({ from: m.index, to: m.index + m[0].length, src: m[2]!.replace(/\n$/, '') })
  return out
}

class BaseWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly from: number,
  ) {
    super()
  }
  eq(o: BaseWidget) {
    return o.src === this.src
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    this.mount(dom, view)
    return true
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div')
    el.className = 'cm-base'
    this.mount(el, view)
    return el
  }
  private mount(el: HTMLElement, view: EditorView) {
    const root = ((el as HTMLElement & { _root?: Root })._root ??= createRoot(el))
    /** 改代码块里的 YAML：只换这一块的内容（filters、order、sort 那几行由 base.ts 算） */
    const write = (next: (src: string) => string) => {
      const b = baseBlocks(view.state.doc.toString()).find((x) => x.src === this.src)
      if (!b || view.state.readOnly) return
      const start = view.state.doc.lineAt(b.from).to + 1
      let out: string
      try {
        out = next(b.src)
      } catch (e) {
        return view.state.facet(editorHost).notice(String((e as Error).message))
      }
      if (out !== b.src) view.dispatch({ changes: { from: start, to: start + b.src.length, insert: out }, userEvent: 'input.base' })
    }
    const edit: BaseEdits = {
      sort: (prop, desc) => write((src) => setBaseSort(src, prop, desc)),
      filters: (match, conds) => write((src) => setBaseFilters(src, match, conds)),
      order: (columns) => write((src) => setBaseOrder(src, columns)),
      src: (next) => write(next),
    }
    flushSync(() => root.render(<BaseTable spec={parseBase(this.src)} src={this.src} edit={edit} anchor={el} />))
  }
  destroy(dom: HTMLElement) {
    const root = (dom as HTMLElement & { _root?: Root })._root
    if (root) queueMicrotask(() => root.unmount())
  }
  ignoreEvent() {
    return true
  }
  get estimatedHeight() {
    return 220
  }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = []
  for (const b of baseBlocks(state.doc.toString())) out.push(Decoration.replace({ widget: new BaseWidget(b.src, b.from), block: true }).range(b.from, b.to))
  return Decoration.set(out, true)
}

const field = StateField.define<DecorationSet>({
  create: build,
  update: (v, tr) => (tr.docChanged ? build(tr.state) : v),
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f)),
    hiddenSyntax.of((state) => {
      const out: Hidden[] = []
      state.field(f).between(0, state.doc.length, (from, to) => void out.push(wholeBlock(state.doc, from, to)))
      return out
    }),
  ],
})

export const baseBlock = field

/** 新建一个空的数据库：在笔记旁边建一个记录文件夹（先放一条），返回 ```base 块（斜杠菜单、白板工具板「数据库」共用） */
export async function createBase(notePath: string): Promise<string> {
  const dir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : ''
  const names = new Set((await window.cn.listNotes()).map((n) => n.path.split('/').slice(0, -1).join('/')))
  let name = '未命名数据库'
  for (let n = 2; names.has(dir ? `${dir}/${name}` : name); n++) name = `未命名数据库 ${n}`
  const folder = dir ? `${dir}/${name}` : name
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  await window.cn.createNote(folder, '第一条', `---\n状态: 未开始\n日期: ${today}\n---\n`)
  return '```base\n' + baseYaml(folder, ['file.name', '状态', '日期']) + '\n```'
}

/** 斜杠菜单「数据库」：在笔记旁边建一个记录文件夹（先放一条），插一个 ```base 块 */
export async function insertBase(view: EditorView, notePath: string, from: number, to: number) {
  const md = await createBase(notePath)
  const line = view.state.doc.lineAt(from)
  const pre = line.number > 1 && view.state.doc.line(line.number - 1).text.trim() !== '' ? '\n' : ''
  const rest = view.state.doc.sliceString(to, line.to)
  const insert = pre + md + '\n\n' + rest
  view.dispatch({ changes: { from, to: line.to, insert }, selection: { anchor: from + pre.length + md.length + 2 }, userEvent: 'input.slash', scrollIntoView: true })
  view.focus()
}
