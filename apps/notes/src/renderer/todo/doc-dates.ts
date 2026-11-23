/**
 * 文档里的待办（task-kzr3n，画布今日 v2 原型「画布笔记 · 一篇笔记里的待办」「定日子」两屏）：
 * - 行尾的 📅 那一截画成日子小块「明天 15:00」（有重复、提醒跟着 · 🔁 · 🔔；过期红字）；🆔 🔔 这些记号收进小块里不露
 *   （DESIGN.v3 6.1 方向 A：一个 md 记号都不露）。只加装饰不改文字，「打开再保存文件不变」照旧。
 * - 悬停一行，右边出「定日子」（没日子的才有）「看详情」「画布今日」（装了才有）；点日子小块也是定日子。
 * - 定日子：点日子小块、「定日子」那一颗弹定日子和时间的选择器（task-pd289 把原来的今天 / 明天 / 下周一小菜单扩成了它，
 *   最上面照旧是今天 / 明天 / 下周一，下面小月历、钟点、提醒、重复、清掉；when-assist.ts 的 openWhenFor），只改行尾那几个字，
 *   在编辑器里改（⌘Z 能撤），底栏说一句、带「撤回」。
 * - 小块是一整颗（光标跨过去）；紧跟在小块后面按退格只拿掉日子（🔔 🆔 这些留着），不把整截记号一下删光。
 */
import { syntaxTree } from '@codemirror/language'
import { Prec, type Range, StateEffect } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { parseTaskLine, setDate, type TaskLine } from '@cn/tasks'
import { codiconSvg } from '@cn/design/codicon-svg'
import { whenText } from '../../shared/todo'
import { t as tNow } from '../../shared/i18n'
import { app } from '../ctx/actions'
import { editorHost } from '../editor-host'
import todayIcon from '../assets/today-icon.png'
import { findTodoAt, isoToday, openInToday } from './store'
import { openWhenFor } from './when-assist'
import { openPopAt } from './TodoList'
import './doc-dates.css'

/** 装了画布今日没有（问一次；问到了让开着的文档重画一次，多出「画布今日」那一颗） */
let installed: boolean | null = null
let asking: Promise<boolean> | null = null
const refresh = StateEffect.define<null>()

/** 一行待办：它在第几行、记号那一截从哪到哪 */
interface Hit {
  line: number
  from: number
  to: number
  task: TaskLine
  /** 记号那一截（第一个记号前面的空白起，到最后一个记号止）；没有日子是 null */
  tail: { from: number; to: number } | null
}

/** 看得见的那几段里的待办行（照语法树认：代码块里长得像的不算） */
function taskLines(view: EditorView): Hit[] {
  const out: Hit[] = []
  const doc = view.state.doc
  const seen = new Set<number>()
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== 'TaskMarker') return
        const line = doc.lineAt(node.from)
        if (seen.has(line.number)) return
        seen.add(line.number)
        const task = parseTaskLine(line.text)
        if (!task) return
        const f = task.fields
        const tail = task.date && f.length ? { from: line.from + f[0]!.start, to: line.from + f[f.length - 1]!.end } : null
        out.push({ line: line.number, from: line.from, to: line.to, task, tail })
      },
    })
  }
  return out
}

/** 改一行：只换改了的那几个字（前后一样的不动） */
function replaceLine(view: EditorView, lineNo: number, next: string): { from: number; insert: string; removed: string } | null {
  const line = view.state.doc.line(lineNo)
  const cur = line.text
  if (cur === next) return null
  let a = 0
  while (a < cur.length && a < next.length && cur[a] === next[a]) a++
  let b = 0
  while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++
  const from = line.from + a
  const removed = cur.slice(a, cur.length - b)
  const insert = next.slice(a, next.length - b)
  view.dispatch({ changes: { from, to: from + removed.length, insert }, userEvent: 'input.date' })
  return { from, insert, removed }
}

/** 这一行在第几行（点的时候再认：之前上面加了行，行号变了） */
const lineOfDom = (view: EditorView, el: HTMLElement) => view.state.doc.lineAt(view.posAtDOM(el)).number

/** 那一行的框（小卡贴着它） */
function lineRect(view: EditorView, lineNo: number): DOMRect | null {
  if (lineNo > view.state.doc.lines) return null
  const at = view.domAtPos(view.state.doc.line(lineNo).from)
  const node = at.node instanceof HTMLElement ? at.node : at.node.parentElement
  return node?.closest('.cm-line')?.getBoundingClientRect() ?? null
}

// ---------- 小块和悬停的几颗 ----------

class Chip extends WidgetType {
  constructor(
    readonly text: string,
    readonly red: boolean,
    readonly bell: boolean,
    readonly repeat: boolean,
    readonly raw: string,
  ) {
    super()
  }
  eq(o: Chip) {
    return o.text === this.text && o.red === this.red && o.bell === this.bell && o.repeat === this.repeat && o.raw === this.raw
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = 'cm-tdchip' + (this.red ? ' red' : '')
    el.title = this.raw.trim()
    el.setAttribute('role', 'button')
    el.setAttribute('aria-label', tNow('定日子：{when}', { when: this.text }))
    // v2 原型 .dchip：日历图标 + 「明天 15:00」，有重复、提醒再跟 · 🔁 · 🔔
    el.innerHTML = codiconSvg('calendar', { size: 12 })
    el.append(this.text)
    for (const [on, icon] of [[this.repeat, 'sync'], [this.bell, 'bell']] as const) {
      if (!on) continue
      const r = document.createElement('span')
      r.className = 'sub'
      r.innerHTML = codiconSvg(icon, { size: 12 })
      el.append(' · ', r)
    }
    el.addEventListener('mousedown', (e) => {
      e.preventDefault()
      if (view.state.readOnly) return
      openWhenFor(view, view.state.doc.line(lineOfDom(view, el)).from, 'chip', el)
    })
    return el
  }
  ignoreEvent() {
    return true
  }
}

class Tools extends WidgetType {
  constructor(
    readonly dated: boolean,
    readonly today: boolean,
  ) {
    super()
  }
  eq(o: Tools) {
    return o.dated === this.dated && o.today === this.today
  }
  toDOM(view: EditorView) {
    const el = document.createElement('span')
    el.className = 'cm-tdtools'
    el.contentEditable = 'false'
    const btn = (label: string, icon: string | null, run: (b: HTMLButtonElement) => void, img?: string) => {
      const b = document.createElement('button')
      b.className = 'cm-tdbtn'
      b.type = 'button'
      b.setAttribute('aria-label', label)
      if (icon) b.innerHTML = codiconSvg(icon as 'calendar', { size: 12 })
      if (img) {
        const i = document.createElement('img')
        i.src = img
        i.width = 12
        i.height = 12
        i.alt = ''
        b.append(i)
      }
      b.append(label)
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        run(b)
      })
      el.append(b)
    }
    const path = () => view.state.facet(editorHost).path()
    // 小菜单贴着这一排几颗的右边（原型 .pop right:0），开着时这一排留着（原型 .ln.keep）
    if (!this.dated) btn(tNow('定日子'), 'calendar', (b) => !view.state.readOnly && openWhenFor(view, view.state.doc.line(lineOfDom(view, el)).from, 'chip', b))
    btn(tNow('看详情'), 'checklist', () => {
      const n = lineOfDom(view, el)
      void findTodoAt(path(), n - 1, view.state.doc.line(n).text).then((it) => {
        if (!it) return app().notice(tNow('这一行刚被别处改了'))
        openPopAt(it.key, () => lineRect(view, lineOfDom(view, el)))
      })
    })
    if (this.today)
      btn(
        tNow('画布今日'),
        null,
        () => {
          const n = lineOfDom(view, el)
          const text = view.state.doc.line(n).text
          void openInToday({ path: path(), line: n - 1, raw: text, title: parseTaskLine(text)?.title ?? '' })
        },
        todayIcon,
      )
    return el
  }
  ignoreEvent() {
    return true
  }
}

function build(view: EditorView): { decos: DecorationSet; chips: DecorationSet } {
  const today = isoToday()
  const out: Range<Decoration>[] = []
  const chips: Range<Decoration>[] = []
  for (const h of taskLines(view)) {
    out.push(Decoration.line({ class: 'cm-tdline' }).range(h.from))
    const t = h.task
    if (h.tail && t.date) {
      const red = t.date < today && !t.done && !t.cancelled
      const d = Decoration.replace({ widget: new Chip(whenText(t.date, t.time, today), red, !!t.remind, !!t.repeat, view.state.doc.sliceString(h.tail.from, h.tail.to)) }).range(h.tail.from, h.tail.to)
      out.push(d)
      chips.push(d)
    }
    out.push(Decoration.widget({ widget: new Tools(!!t.date, installed === true), side: 1 }).range(h.to))
  }
  return { decos: Decoration.set(out, true), chips: Decoration.set(chips, true) }
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    chips: DecorationSet
    constructor(view: EditorView) {
      ;({ decos: this.decorations, chips: this.chips } = build(view))
      if (installed === null) {
        asking ??= window.cnTodo.todayInstalled().catch(() => false)
        void asking.then((v) => {
          installed = v
          if (v) queueMicrotask(() => view.dispatch({ effects: refresh.of(null) }))
        })
      }
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.startState) !== syntaxTree(u.state) || u.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)))) {
        ;({ decos: this.decorations, chips: this.chips } = build(u.view))
      }
    }
    destroy() {}
  },
  {
    decorations: (v) => v.decorations,
    provide: (p) => EditorView.atomicRanges.of((view) => view.plugin(p)?.chips ?? Decoration.none),
  },
)

/** 紧跟在日子小块后面按退格：只拿掉日子（setDate null），🔔 🆔 这些记号留着 */
function backspaceDate(view: EditorView): boolean {
  const s = view.state.selection.main
  if (!s.empty || view.state.readOnly) return false
  const line = view.state.doc.lineAt(s.head)
  const task = parseTaskLine(line.text)
  if (!task?.date || !task.fields.length) return false
  const end = line.from + task.fields[task.fields.length - 1]!.end
  if (s.head !== end) return false
  replaceLine(view, line.number, setDate(line.text, null))
  return true
}

export const docDates = [plugin, Prec.high(keymap.of([{ key: 'Backspace', run: backspaceDate }]))]
