/**
 * 块上露写法（文档方向 A「块上露写法」，2026-11-17 用户定）：文档里平时一个记号都看不到，也没有「源文件」看法；
 * 画成一整块的东西（图片、视频卡、时刻块、问答块、表格……）要改原文时，块菜单「改写法」只在这一块露出它的 md：
 * 一块 --card 的卡里一个等宽的文本框，下面一行「只在这一块里露出写法 · esc 收回」和「完成」。
 * 「完成」（或 ⌘↵）把改过的字写回这一块，esc 收回什么都不改。数据库的「改写法」在它自己的块头上（BaseTable.tsx）。
 */
import { type EditorState, Prec, type Range, StateEffect, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'
import { hiddenOk } from './hidden-syntax'
import { t as tNow } from '../shared/i18n'

/** 改写法下面那行提示（数据库块头上也用）：键，画的地方 t(RAW_HINT) */
export const RAW_HINT = '只在这一块里露出写法 · esc 收回' // 不翻：键，画的地方翻

const openRawEffect = StateEffect.define<{ from: number; to: number } | null>()

/** 正在改写法的那一块（文字范围） */
export const rawField = StateField.define<{ from: number; to: number } | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(openRawEffect)) return e.value
    if (!v || !tr.docChanged) return v
    const from = tr.changes.mapPos(v.from, 1)
    const to = tr.changes.mapPos(v.to, -1)
    return to > from ? { from, to } : null
  },
})

export function openRaw(view: EditorView, from: number, to: number) {
  view.dispatch({ effects: openRawEffect.of({ from, to }) })
}

export function closeRaw(view: EditorView) {
  view.dispatch({ effects: openRawEffect.of(null) })
  view.focus()
}

/** 改写法的文本框和下面那一行（数据库块头上的改写法也用这一套 DOM） */
export function rawEditor(src: string, done: (text: string) => void, cancel: () => void): HTMLElement {
  const box = document.createElement('div')
  box.className = 'cm-raw'
  box.dataset.part = '改写法' // 不翻：e2e 认的 data-part
  const ta = document.createElement('textarea')
  ta.className = 'cm-raw-text'
  ta.spellcheck = false
  ta.value = src
  ta.setAttribute('aria-label', tNow('这一块的写法'))
  const foot = document.createElement('div')
  foot.className = 'cm-raw-foot'
  const hint = document.createElement('span')
  hint.textContent = tNow(RAW_HINT)
  const ok = document.createElement('button')
  ok.type = 'button'
  ok.className = 'cm-raw-done'
  ok.textContent = tNow('完成')
  ok.addEventListener('mousedown', (e) => e.preventDefault())
  ok.addEventListener('click', () => done(ta.value))
  foot.append(hint, ok)
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      done(ta.value)
    }
  })
  // 编辑器不管这一块里的鼠标和键盘（字在文本框里改）
  for (const t of ['mousedown', 'keydown', 'keyup', 'input', 'paste', 'copy', 'cut', 'beforeinput'] as const) box.addEventListener(t, (e) => e.stopPropagation())
  box.append(ta, foot)
  requestAnimationFrame(() => {
    ta.focus()
    ta.setSelectionRange(0, 0)
  })
  return box
}

class RawWidget extends WidgetType {
  constructor(
    readonly src: string,
    readonly from: number,
  ) {
    super()
  }
  eq(o: RawWidget) {
    return o.src === this.src && o.from === this.from
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-rawwrap'
    wrap.appendChild(
      rawEditor(
        this.src,
        (text) => {
          const r = view.state.field(rawField)
          if (!r) return
          const now = view.state.doc.sliceString(r.from, r.to)
          view.dispatch({
            changes: text === now ? [] : { from: r.from, to: r.to, insert: text },
            effects: openRawEffect.of(null),
            selection: { anchor: r.from },
            userEvent: 'input.raw',
            annotations: hiddenOk.of(true),
          })
          view.focus()
        },
        () => closeRaw(view),
      ),
    )
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

function build(state: EditorState): DecorationSet {
  const r = state.field(rawField)
  if (!r) return Decoration.none
  const out: Range<Decoration>[] = [Decoration.replace({ widget: new RawWidget(state.doc.sliceString(r.from, r.to), r.from), block: true }).range(r.from, r.to)]
  return Decoration.set(out)
}

const rawDeco = StateField.define<DecorationSet>({
  create: build,
  update: (v, tr) => (tr.docChanged || tr.effects.some((e) => e.is(openRawEffect)) ? build(tr.state) : v),
  // 比别的块部件优先：这一块这时画成文本框，不画图、不画卡
  provide: (f) => Prec.highest(EditorView.decorations.from(f)),
})

export const blockSource = [rawField, rawDeco]
