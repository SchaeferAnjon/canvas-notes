/**
 * 视频框一块问（CN-84 方向 B）：不再弹 AI 浮窗，文档光标处先出一个占位「AI 正在看 00:06 这一帧…」（灰条 +「停下 esc」），
 * 答好了原地换成 [!ai] 提示块。占位只是编辑器里的装饰，不写进 md（「打开再保存文件不变」不受影响）。
 * 底栏同时一项「AI 在记笔记 · 未命名 3」。
 */
import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, keymap, WidgetType } from '@codemirror/view'
import { useSyncExternalStore } from 'react'

interface Pending {
  id: number
  pos: number
  label: string
}

const add = StateEffect.define<Pending>({ map: (v, ch) => ({ ...v, pos: ch.mapPos(v.pos, 1) }) })
const remove = StateEffect.define<number>()
const stoppers = new Map<number, () => void>()

class Wait extends WidgetType {
  constructor(readonly p: Pending) {
    super()
  }
  eq(o: Wait) {
    return o.p.id === this.p.id && o.p.label === this.p.label
  }
  toDOM() {
    const box = document.createElement('div')
    box.className = 'cm-aiwait'
    box.dataset.part = 'AI 占位'
    box.setAttribute('role', 'status')
    const dot = document.createElement('i')
    dot.className = 'dot'
    const tx = document.createElement('span')
    tx.className = 'tx'
    tx.textContent = this.p.label
    const bar = document.createElement('span')
    bar.className = 'bar'
    const stop = document.createElement('button')
    stop.type = 'button'
    stop.className = 'stop'
    stop.innerHTML = '停下 <kbd>esc</kbd>'
    stop.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      stoppers.get(this.p.id)?.()
    })
    box.append(dot, tx, bar, stop)
    return box
  }
  ignoreEvent() {
    return true
  }
}

const field = StateField.define<Pending[]>({
  create: () => [],
  update(list, tr) {
    let out = tr.docChanged ? list.map((p) => ({ ...p, pos: tr.changes.mapPos(p.pos, 1) })) : list
    for (const e of tr.effects) {
      if (e.is(add)) out = [...out, e.value]
      else if (e.is(remove)) out = out.filter((p) => p.id !== e.value)
    }
    return out
  },
  provide: (f) => EditorView.decorations.from(f, (list) => Decoration.set(list.map((p) => Decoration.widget({ widget: new Wait(p), block: true, side: 1 }).range(p.pos)), true)),
})

/** esc：停下最近的那一问（有在等的才接） */
const escape = keymap.of([
  {
    key: 'Escape',
    run: (view) => {
      const list = view.state.field(field, false)
      const last = list?.[list.length - 1]
      if (!last) return false
      stoppers.get(last.id)?.()
      return true
    },
  },
])

export const askPending = [field, escape]

// ---------------------------------------------------------------- 底栏「AI 在记笔记」

let jobs: { id: number; text: string }[] = []
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
export function useAskJobs(): { id: number; text: string }[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => jobs,
  )
}

let seq = 0

/**
 * 开始等一问：view 给了就在光标所在段后面放占位；底栏加一项。onStop：点「停下」或按 esc。
 * pos() 是占位现在的位置（期间打了字、挪了光标都跟着走），答好了插在这里。
 */
export function beginAsk(o: { view: EditorView | null; label: string; job: string; onStop(): void }): { pos(): number | null; end(): void } {
  const id = ++seq
  const view = o.view
  if (view) {
    const at = view.state.doc.lineAt(view.state.selection.main.head).to
    view.dispatch({ effects: add.of({ id, pos: at, label: o.label }) })
  }
  stoppers.set(id, o.onStop)
  jobs = [...jobs, { id, text: o.job }]
  emit()
  return {
    pos: () => (view ? (view.state.field(field, false)?.find((p) => p.id === id)?.pos ?? null) : null),
    end() {
      stoppers.delete(id)
      jobs = jobs.filter((j) => j.id !== id)
      emit()
      if (view && view.state.field(field, false)?.some((p) => p.id === id)) view.dispatch({ effects: remove.of(id) })
    },
  }
}
