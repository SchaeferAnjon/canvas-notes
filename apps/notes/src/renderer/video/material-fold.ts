/**
 * 「素材/视频」里的字幕全文（frontmatter 里 type: video）：按章节收起（偏好「别把上万条全铺开」）。
 * 每章标题下面一行「▸ 展开 · 31 行」，点开才露出这一章的字幕；默认只展开上次看到的那一章。
 * AI 摘要、记下的时刻两节不收。只加装饰不改文字；⌘F 全局搜索照样搜得到每一行。
 */
import { type EditorState, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType } from '@codemirror/view'
import { videoOf } from '../../shared/video'

const CHAPTER = /^## (\d+:\d{2}(?::\d{2})?) /
const toggle = StateEffect.define<number>()

/** 这一篇是不是字幕全文；是的话给视频网址 */
function videoSource(state: EditorState): string | null {
  const head = state.doc.sliceString(0, Math.min(state.doc.length, 600))
  if (!/^---\n(?:[\s\S]*?\n)?type: video\n/.test(head)) return null
  return /\nsource: (\S+)/.exec(head)?.[1] ?? null
}

interface Chapter {
  /** 标题那一行的开头（当 id） */
  at: number
  start: number
  from: number
  to: number
  lines: number
}

function chapters(state: EditorState): Chapter[] {
  const doc = state.doc
  const out: Chapter[] = []
  let cur: Chapter | null = null
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    const m = CHAPTER.exec(line.text)
    if (m || /^#{1,2} /.test(line.text)) {
      if (cur) out.push(cur)
      cur = null
      if (m) {
        const [a, b, c] = m[1]!.split(':').map(Number) as [number, number, number?]
        cur = { at: line.from, start: c === undefined ? a * 60 + b : a * 3600 + b * 60 + c, from: line.to, to: line.to, lines: 0 }
      }
      continue
    }
    if (cur) {
      cur.to = line.to
      if (/^\[\d+:\d{2}/.test(line.text)) cur.lines++
    }
  }
  if (cur) out.push(cur)
  return out.filter((c) => c.to > c.from)
}

class FoldWidget extends WidgetType {
  constructor(
    readonly at: number,
    readonly lines: number,
    readonly open: boolean,
  ) {
    super()
  }
  eq(o: FoldWidget) {
    return o.at === this.at && o.lines === this.lines && o.open === this.open
  }
  toDOM(view: EditorView) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'cm-vfold'
    b.textContent = this.open ? '▴ 收起这一章' : `▸ 展开 · ${this.lines}行`
    b.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ effects: toggle.of(this.at) })
    })
    return b
  }
  ignoreEvent() {
    return true
  }
}

interface FoldState {
  open: Set<number>
  deco: DecorationSet
}

function build(state: EditorState, open: Set<number>): DecorationSet {
  if (!videoSource(state)) return Decoration.none
  const out: Range<Decoration>[] = []
  for (const c of chapters(state)) {
    const isOpen = open.has(c.at) || state.selection.ranges.some((r) => r.from > c.from && r.to <= c.to)
    if (isOpen) out.push(Decoration.widget({ widget: new FoldWidget(c.at, c.lines, true), block: true, side: 1 }).range(c.to))
    else out.push(Decoration.replace({ widget: new FoldWidget(c.at, c.lines, false), block: true }).range(c.from + 1 > c.to ? c.from : c.from + 1, c.to))
  }
  return Decoration.set(out, true)
}

const field = StateField.define<FoldState>({
  create: (s) => ({ open: new Set(), deco: build(s, new Set()) }),
  update(v, tr) {
    let open = v.open
    for (const e of tr.effects) {
      if (!e.is(toggle)) continue
      open = new Set(open)
      if (open.has(e.value)) open.delete(e.value)
      else open.add(e.value)
    }
    if (tr.docChanged) open = new Set([...open].map((p) => tr.changes.mapPos(p)))
    return open === v.open && !tr.docChanged && !tr.selection ? v : { open, deco: build(tr.state, open) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

/** 打开时展开上次看到的那一章 */
function expandLast(view: EditorView) {
  const ref = videoOf(videoSource(view.state))
  if (!ref || !window.cnVideo) return
  void window.cnVideo.lastPos(ref.key).then((pos) => {
    const list = chapters(view.state)
    const hit = [...list].reverse().find((c) => c.start <= pos) ?? list[0]
    if (hit && !view.state.field(field).open.has(hit.at)) view.dispatch({ effects: toggle.of(hit.at) })
  })
}

const opener = ViewPlugin.define((view) => {
  // 挂上时还不能 dispatch：放到下一轮
  setTimeout(() => expandLast(view), 0)
  return {}
})

export const materialFold = [field, opener]
