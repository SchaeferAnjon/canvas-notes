/**
 * 文档视图里的属性表（方向 B「文档顶上一块」）：文件开头有给人看的属性（类型、课程、第几讲……）时，
 * frontmatter 原文藏起来，标题下面画一张表（只有软件自己用的键时只藏不画表）：名字 12 `--t2`、值 13、右端「AI 填的」。
 * 点一行，光标落到文件开头那一行，露出原文直接改（和别的 md 记号一样，光标所在处显示原文）。
 * 只加装饰不动文字，「打开再保存文件不变」不受影响。
 */
import { aiFilled, HIDDEN_KEYS, readProps, type Prop } from '@cn/format'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { type Hidden, hiddenOk, hiddenSyntax } from '../hidden-syntax'

const FM = /^---\n[\s\S]*?\n---(?:\n|$)/

class PropsTable extends WidgetType {
  constructor(
    readonly props: Prop[],
    readonly ai: string[],
  ) {
    super()
  }
  eq(o: PropsTable) {
    return JSON.stringify([o.props, o.ai]) === JSON.stringify([this.props, this.ai])
  }
  toDOM(view: EditorView) {
    const box = document.createElement('div')
    box.className = 'cm-props'
    box.setAttribute('aria-label', '属性')
    for (const p of this.props) {
      const row = document.createElement('div')
      row.className = 'pr'
      row.title = '点一下改'
      const k = document.createElement('span')
      k.className = 'k'
      k.textContent = p.key
      const v = document.createElement('span')
      v.className = 'v'
      v.textContent = p.value
      const ai = document.createElement('span')
      ai.className = 'ai'
      ai.textContent = this.ai.includes(p.key) ? 'AI填的' : ''
      row.append(k, v, ai)
      row.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const text = view.state.doc.sliceString(0, Math.min(view.state.doc.length, 20000))
        const at = new RegExp(`^${p.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:.*$`, 'm').exec(text)
        if (!at) return
        view.focus()
        // 点属性表进原文是有意的：hidden-syntax 不把光标挪出来
        view.dispatch({ selection: { anchor: at.index + at[0].length }, annotations: hiddenOk.of(true) })
      })
      box.append(row)
    }
    return box
  }
  ignoreEvent() {
    return false
  }
}

/** 开头那段属性原文的末尾（收尾 --- 后面）；没有属性是 -1 */
function fmEnd(state: EditorState): number {
  const fm = FM.exec(state.doc.sliceString(0, Math.min(state.doc.length, 20000)))
  if (!fm) return -1
  return fm[0].endsWith('\n') ? fm[0].length - 1 : fm[0].length
}

/** 光标在开头那段里（刚打开时光标在最前面，不算）：露出原文 */
const inside = (state: EditorState, end: number) => state.selection.ranges.some((r) => r.to > 0 && r.from <= end)

/**
 * 交给 hidden-syntax 看守：藏着的时候（改之前光标不在里面）整段连同收尾换行都不许键盘进、不许改；
 * 光标挨着下面第一段段首（第 5 轮：段首按 ←、退格，字落进收尾的 ---，属性整个坏掉）
 */
function hidden(state: EditorState, prev: EditorState): Hidden[] {
  const end = fmEnd(state)
  if (end < 0) return []
  const was = fmEnd(prev)
  if (was >= 0 && inside(prev, was)) return []
  const len = state.doc.length
  return [{ from: 0, to: end < len ? end + 1 : end, fromOk: false, toOk: true, side: 'to', unit: null, ...(end < len ? {} : { pad: '\n' }) }]
}

function build(state: EditorState): DecorationSet {
  const text = state.doc.sliceString(0, Math.min(state.doc.length, 20000))
  const end = fmEnd(state)
  if (end < 0) return Decoration.none
  if (inside(state, end)) return Decoration.none
  const props = readProps(text).filter((p) => !HIDDEN_KEYS.has(p.key))
  const decos: Range<Decoration>[] = [Decoration.replace({ block: true }).range(0, end)]
  // 只有软件自己用的键（created、source、type……，收件箱、剪藏常见）：整段藏起来，不画表（以前原样露出「---」）
  if (!props.length) return Decoration.set(decos)
  const table = Decoration.widget({ widget: new PropsTable(props, aiFilled(text)), block: true, side: 1 })
  // 紧跟着一级标题的话，表放在标题下面（和设计稿一样）；不然放在原来 frontmatter 的位置
  const next = end + 1 <= state.doc.length ? state.doc.lineAt(Math.min(state.doc.length, end + 1)) : null
  if (next && /^# /.test(next.text)) decos.push(table.range(next.to))
  else decos.push(table.range(end))
  return Decoration.set(decos, true)
}

export const propsBlock = StateField.define<DecorationSet>({
  create: build,
  update: (deco, tr) => (tr.docChanged || tr.selection ? build(tr.state) : deco),
  provide: (f) => [EditorView.decorations.from(f), hiddenSyntax.of(hidden)],
})
