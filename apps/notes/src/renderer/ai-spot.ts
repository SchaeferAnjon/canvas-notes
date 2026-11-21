/**
 * 文档里 AI 动手的那一段（DESIGN.v3 2.3，流光方向 A2）：
 * - 只写一段（doc_insert）、换掉选中的一段：整篇不亮，只这一段。左边留白里 2px 竖线（和「刚插进来」同一处），里面一道光往下走（1.1 秒一趟）；
 *   这一段下面一颗「AI 在写这一段 · 停下 esc」，边上一圈光。这一轮做完：竖线变实线 1.6 秒，0.4 秒淡出，那一颗收起；
 *   停下了：竖线变灰淡出，那一颗说「停下了：这一段留着」1.6 秒再收起。
 * - 整篇改写（整块亮着时外面改进来的字）：改到的每一段竖线里光走一趟，再实线 1.6 秒、0.4 秒淡出。
 * 只是界面上的样子（竖线、块下面一颗小胶囊），不改文字：打开再保存文件不变。
 */
import { Facet, type Range, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { actEntries, onActs, still, stopActing } from './ai-act-store'
import { ringElement } from './ai-glow'

interface Spot {
  id: number
  from: number
  to: number
  turn: number
  /** spot：只写这一段（下面有「停下」那颗）；pass：整篇改写时改到的一段 */
  kind: 'spot' | 'pass'
}

let ids = 0
const addSpot = StateEffect.define<Spot>()
const dropSpot = StateEffect.define<number>()

/** 这个编辑器是哪篇（整篇改写时认是不是正在改的这篇） */
export const aiSpotPath = Facet.define<() => string, () => string>({ combine: (v) => v[0] ?? (() => '') })

/** 这一篇整块亮着、还在改：是哪一轮 */
function wholeTurn(path: string): number | null {
  return actEntries().find((e) => e.area === 'doc' && e.whole && !e.end && e.path === path)?.turn ?? null
}

const spots = StateField.define<Spot[]>({
  create: () => [],
  update(v, tr) {
    let out = tr.docChanged ? v.map((s) => ({ ...s, from: tr.changes.mapPos(s.from, 1), to: tr.changes.mapPos(s.to, -1) })) : v
    for (const e of tr.effects) {
      if (e.is(addSpot)) out = [...out.filter((s) => s.id !== e.value.id), e.value]
      if (e.is(dropSpot)) out = out.filter((s) => s.id !== e.value)
    }
    // 整篇改写：外面改进来的（AI 写的文件合进编辑器）每一处，整段亮一趟
    if (tr.docChanged && tr.annotation(Transaction.remote)) {
      const turn = wholeTurn(tr.state.facet(aiSpotPath)())
      if (turn !== null)
        tr.changes.iterChangedRanges((_fa, _ta, fb, tb) => {
          const doc = tr.state.doc
          const a = doc.lineAt(fb)
          const b = doc.lineAt(Math.max(fb, tb - (tb > fb && doc.sliceString(tb - 1, tb) === '\n' ? 1 : 0)))
          if (!doc.sliceString(a.from, b.to).trim()) return
          out = [...out, { id: ++ids, from: a.from, to: b.to, turn, kind: 'pass' }]
        })
    }
    return out
  },
})

class InlWidget extends WidgetType {
  constructor(readonly id: number) {
    super()
  }
  eq(o: InlWidget) {
    return o.id === this.id
  }
  toDOM() {
    const wrap = document.createElement('div')
    wrap.className = 'cm-ai-inl'
    wrap.dataset.spot = String(this.id)
    wrap.innerHTML = '<span class="pill" data-testid="ai-spot-bar"><i class="dot on"></i><span class="t">AI 在写这一段</span><button type="button" class="stop">停下 esc</button></span>'
    wrap.querySelector('.stop')!.addEventListener('mousedown', (e) => {
      e.preventDefault()
      stopActing()
    })
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

const inlines = EditorView.decorations.compute([spots], (state) => {
  const r: Range<Decoration>[] = []
  for (const s of state.field(spots)) if (s.kind === 'spot') r.push(Decoration.widget({ widget: new InlWidget(s.id), block: true, side: 1 }).range(state.doc.lineAt(s.to).to))
  return Decoration.set(r, true) as DecorationSet
})

interface Bar {
  el: HTMLDivElement
  comet: Animation | null
  ring: ReturnType<typeof ringElement> | null
  /** live：光在走；done：实线等淡出；stopped：灰了等淡出 */
  state: 'live' | 'done' | 'stopped'
  timers: ReturnType<typeof setTimeout>[]
}

class SpotBars {
  private bars = new Map<number, Bar>()
  private off: () => void

  constructor(readonly view: EditorView) {
    this.off = onActs(() => this.sync())
    this.sync()
  }

  update(u: ViewUpdate) {
    if (u.startState.field(spots) !== u.state.field(spots)) this.sync()
    if (this.bars.size && (u.docChanged || u.geometryChanged || u.heightChanged || u.viewportChanged)) this.place()
  }

  private sync() {
    const list = this.view.state.field(spots)
    for (const [id, b] of this.bars)
      if (!list.some((s) => s.id === id)) {
        this.clear(b)
        b.el.remove()
        this.bars.delete(id)
      }
    for (const s of list) {
      let b = this.bars.get(s.id)
      if (!b) {
        const el = document.createElement('div')
        el.className = 'cm-ai-bar'
        el.dataset.testid = 'ai-spot-line'
        el.setAttribute('aria-hidden', 'true')
        this.view.dom.appendChild(el)
        b = { el, comet: null, ring: null, state: 'live', timers: [] }
        this.bars.set(s.id, b)
        if (!still()) {
          const c = document.createElement('i')
          c.className = 'comet'
          el.appendChild(c)
          b.comet = c.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(320%)' }], {
            duration: 1100,
            iterations: s.kind === 'spot' ? Infinity : 1,
            easing: 'cubic-bezier(.45,0,.55,1)',
          })
        }
        // 整篇改写的一段：光走完一趟就停成实线
        if (s.kind === 'pass') this.settle(s.id, b, false, still() ? 0 : 1100)
      }
      if (s.kind === 'spot' && b.state === 'live') {
        const e = actEntries().find((x) => x.turn === s.turn && x.area === 'doc')
        this.ringOn(s.id, b, !!e && !e.end && !e.stopping)
        if (!e || e.end) this.settle(s.id, b, !e || e.end!.stopped, 0)
      }
    }
    this.place()
  }

  /** 「停下」那颗边上的一圈光（AI 在写的时候才有） */
  private ringOn(id: number, b: Bar, on: boolean) {
    if (!on) {
      b.ring?.stop()
      b.ring = null
      return
    }
    if (b.ring) return
    const pill = this.view.dom.querySelector<HTMLElement>(`.cm-ai-inl[data-spot="${id}"] .pill`)
    if (!pill) return requestAnimationFrame(() => this.bars.get(id) === b && b.state === 'live' && this.ringOn(id, b, true))
    b.ring = ringElement()
    pill.prepend(b.ring.el)
    b.ring.start()
  }

  /** 写好了：实线 1.6 秒、0.4 秒淡出；停下的：变灰淡出，那一颗说「停下了」1.6 秒再收起 */
  private settle(id: number, b: Bar, stopped: boolean, after: number) {
    b.state = stopped ? 'stopped' : 'done'
    const go = () => {
      b.comet?.cancel()
      b.comet = null
      b.el.replaceChildren()
      b.el.classList.add(stopped ? 'grey' : 'solid')
      if (stopped) b.el.classList.add('out')
      this.ringOn(id, b, false)
      const inl = this.view.dom.querySelector<HTMLElement>(`.cm-ai-inl[data-spot="${id}"]`)
      if (inl) {
        if (stopped) {
          inl.querySelector('.t')!.textContent = '停下了：这一段留着'
          inl.querySelector('.stop')?.remove()
          inl.querySelector('.dot')?.classList.remove('on')
        } else inl.classList.add('hide')
      }
      b.timers.push(
        setTimeout(() => {
          b.el.classList.add('out')
          inl?.classList.add('hide')
        }, 1600),
        setTimeout(() => this.view.dispatch({ effects: dropSpot.of(id) }), 2000),
      )
    }
    if (after) b.timers.push(setTimeout(go, after))
    else go()
  }

  private clear(b: Bar) {
    for (const t of b.timers) clearTimeout(t)
    b.timers = []
    b.comet?.cancel()
    b.ring?.stop()
  }

  private place() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const dom = view.dom.getBoundingClientRect()
        return view.state.field(spots).map((s) => {
          const top = view.lineBlockAt(s.from).top
          const bottom = view.lineBlockAt(Math.max(s.from, s.to)).bottom
          return { id: s.id, top: view.documentTop - dom.top + top, height: bottom - top }
        })
      },
      write: (ms) => {
        for (const m of ms) {
          const b = this.bars.get(m.id)
          if (!b) continue
          b.el.style.top = Math.round(m.top) + 'px'
          b.el.style.height = Math.max(4, Math.round(m.height)) + 'px'
        }
      },
    })
  }

  destroy() {
    this.off()
    for (const b of this.bars.values()) {
      this.clear(b)
      b.el.remove()
    }
  }
}

/** 编辑器扩展：path 给整篇改写时认这篇 */
export function aiSpot(path: () => string) {
  return [aiSpotPath.of(path), spots, inlines, ViewPlugin.fromClass(SpotBars)]
}

/** AI 只写了这一段（插进来、换掉选中的）：只亮这一段，turn 是哪一轮 */
export function spotRange(view: EditorView, range: { from: number; to: number }, turn: number) {
  view.dispatch({ effects: addSpot.of({ id: ++ids, from: range.from, to: range.to, turn, kind: 'spot' }) })
}
