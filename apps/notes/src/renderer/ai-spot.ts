/**
 * 文档里 AI 动手的那一段（DESIGN.v3 2.3，流光方向 A2；字一点点长出来 task-6kun1，照原型 A2「写一段」）：
 * - 只写一段（doc_insert）、换掉选中的一段、/ 菜单的「AI 写一段」「AI 总结这页」、AI 对话里 AI 自己写进开着的这篇
 *   （全能模式下用命令、Edit 一次写进文件，笔记工具写的，AI 命令改的）：整篇不亮，只这一段。
 *   左边留白里 2px 竖线（和「刚插进来」同一处），里面一道光往下走（1.1 秒一趟）；这一段下面一颗「AI 在写这一段 · 停下 esc」，边上一圈光。
 *   新的字一点点长出来：照原型每 60 毫秒 2 个字，长的加速、4 秒内显完（shared/ai-grow.ts）；竖线跟着字往下长。
 *   这一轮做完、字也显完：竖线变实线 1.6 秒，0.4 秒淡出，那一颗收起；
 *   停下了：竖线变灰淡出，那一颗说「停下了：这一段留着」（/ 菜单写到一半停的：「停下了：写到一半的这段留着」）1.6 秒再收起。
 * - 整篇改写（整块亮着时外面改进来的字）：改到的每一处竖线里光走着、字一点点长出来，显完停成实线 1.6 秒、0.4 秒淡出。
 * - 一次改了很多处：只前 8 处长、画竖线，后面的直接显示；一个字一个字显的最多约 800 字（整段算），后面的一下子显出来。
 * - 用户正在那一段里打字：AI 改到那一段不藏不长，直接合并；藏着字的那一段被用户改了就一下全显。
 * - esc、「停下」：AI 还在答时停这一轮（字一下全显；/ 菜单的只留已经显出来的）；答完了只是一下全显。
 * - 减少动态：不藏不长，竖线不走。
 * 只是界面上的样子（竖线、块下面一颗小胶囊、还没显的字先藏着），不改文字：打开再保存文件不变，文件里就是 AI 写的。
 */
import { contentBlocks, type MdBlock } from '@cn/format'
import { Annotation, type EditorState, Facet, Prec, type Range, StateEffect, StateField, type Text, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { capOf, catchUpStep, GROW_SPANS, GROW_TICK, growStep, hiddenRanges, type Seg, segUnits, shownAt, trimSpan, unitsOf } from '../shared/ai-grow'
import { actEntries, onActs, spotWrote, still, stopActing, writing } from './ai-act-store'
import { finishCards } from './ai-card-grow'
import { ringElement } from './ai-glow'
import { hiddenOk } from './hidden-syntax'
import { t as tNow } from '../shared/i18n'

interface Spot {
  id: number
  from: number
  to: number
  turn: number
  /** spot：只写这一段（下面有「停下」那颗，跟着这一轮）；pass：只有竖线（整篇改写改到的、一次改了几处里别的几处） */
  kind: 'spot' | 'pass'
  /** 这一段的字跟着哪一次长（grows 里的 id）；不长的是 0 */
  grow: number
  /** / 菜单写到一半停下、没显的字拿掉了：「停下了：写到一半的这段留着」 */
  cut?: boolean
}

/** 一次写进来的字：按文档顺序的几截，显到第 shown 个单位（一个字一个单位，一整块表格、图片算 1 个） */
interface Grow {
  id: number
  turn: number
  segs: Seg[]
  shown: number
  units: number
  /** 一个字一个字显到这里就一下子全显 */
  cap: number
  /** 每 60 毫秒出几个 */
  step: number
  /** 按时间算显到哪：t0 时已经显了 base 个 */
  base: number
  t0: number
  /** / 菜单边收边写：后面还有字来，最后一截跟着长，追着收到的字显 */
  stream: boolean
  /** 停下了：不再长（写的那边把没显的拿掉） */
  frozen: boolean
}

interface AiDoc {
  spots: Spot[]
  grows: Grow[]
}

let ids = 0
const addSpot = StateEffect.define<Spot>()
const dropSpot = StateEffect.define<number>()
const addGrow = StateEffect.define<Grow>()
const setShown = StateEffect.define<{ id: number; shown: number }>()
/** 边收边写：最后一截写到 to 了；more：后面还有 */
const extendGrow = StateEffect.define<{ id: number; to: number; more: boolean }>()
const freezeGrow = StateEffect.define<number>()
/** 一下全显（显完了、按了 esc、用户改了那一段） */
const dropGrow = StateEffect.define<number>()
const markCut = StateEffect.define<number>()

/** 合进编辑器的外部改动是 AI 写的（NoteDoc 合之前问过 ai-act-store）：值是哪一轮，0 是没有一轮的 AI 命令 */
export const aiWroteNote = Annotation.define<number>()
/** / 菜单边收边写自己往里接的字：不算用户改了那一段 */
const growOwn = Annotation.define<boolean>()

/** 这个编辑器是哪篇（整篇改写时认是不是正在改的这篇） */
export const aiSpotPath = Facet.define<() => string, () => string>({ combine: (v) => v[0] ?? (() => '') })

/** 这一篇整块亮着、还在改：是哪一轮 */
function wholeTurn(path: string): number | null {
  return actEntries().find((e) => e.area === 'doc' && e.whole && !e.end && e.path === path)?.turn ?? null
}

/** 用户最近一次在这个编辑器里打字（打字的那一段 AI 改到了不藏不长） */
const typedAt = StateField.define<number>({
  create: () => 0,
  update: (v, tr) => (tr.docChanged && !tr.annotation(Transaction.remote) && !tr.annotation(growOwn) && (tr.isUserEvent('input') || tr.isUserEvent('delete')) ? Date.now() : v),
})
/** 打完字多久以内算「正在打字」 */
const TYPING_MS = 3000

// ---------- 一整块显的（表格、图片……编辑器整块画，不能从中间切开） ----------

const ATOM_KINDS = new Set<MdBlock['kind']>(['table', 'image', 'html', 'hr', 'frontmatter', 'columns'])
const IMG_LINE = /^\s*(!\[[^\]\n]*\]\([^)\n]*\)|!\[\[[^\]\n]+\]\])\s*$/
const blockCache = new WeakMap<Text, MdBlock[]>()
function blocksOf(doc: Text): MdBlock[] {
  let b = blockCache.get(doc)
  if (!b) blockCache.set(doc, (b = contentBlocks(doc.toString())))
  return b
}
const atomBlock = (doc: Text, b: MdBlock) => ATOM_KINDS.has(b.kind) || (b.kind === 'paragraph' && doc.sliceString(b.from, b.from + 2) === '$$')

/** pos 这一行是不是整块画的（表格、图片）：藏着的那截不往它那一行接 */
function drawnWhole(doc: Text, pos: number): boolean {
  const line = doc.lineAt(pos)
  if (IMG_LINE.test(line.text)) return true
  return blocksOf(doc).some((b) => b.from <= pos && pos <= b.to && (b.kind === 'table' || b.kind === 'image'))
}

/** 写进来的一截切成一个字一个字显的和一整块显的；切进了原来就有的一整块（往表格里加一行）返回 null：这一处不长，直接显示 */
function segsOf(doc: Text, from: number, to: number): Seg[] | null {
  const atoms: { from: number; to: number }[] = []
  for (const b of blocksOf(doc)) {
    if (b.to < from || b.from >= to) continue
    if (atomBlock(doc, b)) {
      if (b.from < from || b.to > to) return null
      atoms.push({ from: b.from, to: b.to })
      continue
    }
    // 段落里单独占一行的图（编辑器整行画成图）
    for (let n = doc.lineAt(Math.max(b.from, from)).number, last = doc.lineAt(Math.min(b.to, to)).number; n <= last; n++) {
      const line = doc.line(n)
      if (!IMG_LINE.test(line.text)) continue
      if (line.from < from || line.to > to) return null
      atoms.push({ from: line.from, to: line.to })
    }
  }
  atoms.sort((a, b) => a.from - b.from)
  const segs: Seg[] = []
  let at = from
  for (const a of atoms) {
    if (a.from > at) segs.push({ from: at, to: a.from })
    segs.push({ from: a.from, to: a.to, atom: true })
    at = a.to
  }
  if (at < to) segs.push({ from: at, to })
  return segs
}

function newGrow(doc: Text, turn: number, segs: Seg[], stream = false): Grow {
  const units = unitsOf(segs)
  const cap = stream ? units : capOf(segs, (s) => doc.sliceString(s.from, s.to))
  const step = growStep(cap)
  // 头两个字和竖线、「AI 在写这一段」同一帧出来（那一颗不先贴在上一段下面再往下跳）
  return { id: ++ids, turn, segs, shown: Math.min(units, step), units, cap, step, base: 0, t0: performance.now(), stream, frozen: false }
}

/** 显到哪（第一个还藏着的位置）；都显了是 Infinity */
function boundaryOf(g: Grow): number {
  let left = g.shown
  for (const s of g.segs) {
    const u = segUnits(s)
    if (left < u) return s.atom ? s.from : s.from + left
    left -= u
  }
  return Infinity
}

/** 用户正在打字的那一段（光标所在的连着的几行，到空行为止） */
function paraAround(doc: Text, pos: number): { from: number; to: number } {
  const line = doc.lineAt(pos)
  let a = line
  let b = line
  for (let i = 0; i < 200 && a.number > 1 && a.text.trim(); i++) {
    const up = doc.line(a.number - 1)
    if (!up.text.trim()) break
    a = up
  }
  for (let i = 0; i < 200 && b.number < doc.lines && b.text.trim(); i++) {
    const down = doc.line(b.number + 1)
    if (!down.text.trim()) break
    b = down
  }
  return { from: a.from, to: b.to }
}

/**
 * AI 写进来的外部改动（整篇改写、AI 自己写的文件）：按 diff 新的那几截（去掉头尾空白）长出来，左边竖线。
 * 用户正在打字的那一段不长；前 GROW_SPANS 处以外直接显示、不画竖线
 */
function fromRemote(tr: Transaction, turn: number, whole: boolean): { spots: Spot[]; grow: Grow | null } {
  const doc = tr.state.doc
  const typing = Date.now() - tr.startState.field(typedAt) < TYPING_MS ? paraAround(doc, tr.state.selection.main.head) : null
  const spans: { from: number; to: number }[] = []
  tr.changes.iterChanges((_fa, _ta, fb, tb, ins) => {
    const t = trimSpan(ins.toString(), fb)
    if (!t) return
    if (typing && fb <= typing.to && tb >= typing.from) return
    spans.push(t)
  })
  const use = spans.slice(0, GROW_SPANS)
  if (!use.length) return { spots: [], grow: null }
  const segs = still() ? [] : use.flatMap((s) => segsOf(doc, s.from, s.to) ?? [])
  const grow = segs.length ? newGrow(doc, turn, segs) : null
  const spots: Spot[] = use.map((s) => {
    const grows = !!grow && grow.segs.some((g) => g.from < s.to && g.to > s.from)
    return { id: ++ids, from: doc.lineAt(s.from).from, to: doc.lineAt(s.to).to, turn, kind: 'pass', grow: grows ? grow.id : 0 }
  })
  // AI 自己写进来的（不是整篇改写）：最大的那一处下面「AI 在写这一段 · 停下 esc」
  if (!whole) {
    const big = spots.reduce((a, b) => (b.to - b.from > a.to - a.from ? b : a))
    big.kind = 'spot'
  }
  return { spots, grow }
}

function mapGrow(g: Grow, tr: Transaction): Grow {
  const segs = g.segs.map((s) => ({ ...s, from: tr.changes.mapPos(s.from, 1), to: tr.changes.mapPos(s.to, -1) })).filter((s) => s.to > s.from)
  return { ...g, segs, units: unitsOf(segs) }
}

const aiDoc = StateField.define<AiDoc>({
  create: () => ({ spots: [], grows: [] }),
  update(v, tr) {
    let { spots, grows } = v
    // 没有竖线、没在长字的时候什么都不动（打字时这一格不变，竖线那一层不跟着重排）
    if (tr.docChanged && (spots.length || grows.length)) {
      // 有人改了还藏着字的那一截（用户在那里打字、外面又改了它）：那一次一下全显；/ 菜单自己往后接的字不算
      if (!tr.annotation(growOwn)) grows = grows.filter((g) => !g.segs.some((s) => tr.changes.touchesRange(s.from, s.to)))
      grows = grows.map((g) => mapGrow(g, tr)).filter((g) => g.stream || g.shown < g.units)
      spots = spots.map((s) => ({ ...s, from: tr.changes.mapPos(s.from, 1), to: tr.changes.mapPos(s.to, -1) }))
    }
    for (const e of tr.effects) {
      if (e.is(addSpot)) spots = [...spots.filter((s) => s.id !== e.value.id), e.value]
      else if (e.is(dropSpot)) spots = spots.filter((s) => s.id !== e.value)
      else if (e.is(markCut)) spots = spots.map((s) => (s.id === e.value ? { ...s, cut: true } : s))
      else if (e.is(addGrow)) grows = [...grows, e.value]
      else if (e.is(dropGrow)) grows = grows.filter((g) => g.id !== e.value)
      else if (e.is(freezeGrow)) grows = grows.map((g) => (g.id === e.value ? { ...g, frozen: true } : g))
      else if (e.is(setShown)) grows = grows.map((g) => (g.id === e.value.id ? { ...g, shown: e.value.shown } : g)).filter((g) => g.stream || g.shown < g.units)
      else if (e.is(extendGrow))
        grows = grows.map((g) => {
          if (g.id !== e.value.id) return g
          const segs = g.segs.map((s, i) => (i === g.segs.length - 1 ? { ...s, to: e.value.to } : s))
          const units = unitsOf(segs)
          // 不再来字了：剩下的照「追上」的快慢显完
          if (!e.value.more) return { ...g, segs, units, stream: false, base: g.shown, t0: performance.now(), cap: units, step: catchUpStep(units - g.shown) }
          return { ...g, segs, units }
        })
    }
    // AI 写进来的外部改动：整篇改写（整块亮着）、AI 自己写的文件（主进程说过）
    if (tr.docChanged && tr.annotation(Transaction.remote)) {
      const mark = tr.annotation(aiWroteNote)
      const whole = wholeTurn(tr.state.facet(aiSpotPath)())
      if (mark !== undefined || whole !== null) {
        const r = fromRemote(tr, whole ?? mark!, whole !== null)
        if (r.spots.length) spots = [...spots, ...r.spots]
        if (r.grow) grows = [...grows, r.grow]
      }
    }
    return spots === v.spots && grows === v.grows ? v : { spots, grows }
  },
})

// ---------- 画：块下面那一颗、还没显的字藏起来 ----------

class InlWidget extends WidgetType {
  constructor(readonly id: number) {
    super()
  }
  eq(o: InlWidget) {
    return o.id === this.id
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div')
    wrap.className = 'cm-ai-inl'
    wrap.dataset.spot = String(this.id)
    wrap.innerHTML = '<span class="pill" data-testid="ai-spot-bar"><i class="dot on"></i><span class="t"></span><button type="button" class="stop"></button></span>'
    wrap.querySelector('.t')!.textContent = tNow('AI 在写这一段')
    wrap.querySelector('.stop')!.textContent = tNow('停下 esc')
    wrap.querySelector('.stop')!.addEventListener('mousedown', (e) => {
      e.preventDefault()
      stopSpot(view, this.id)
    })
    return wrap
  }
  ignoreEvent() {
    return true
  }
}

const inlines = EditorView.decorations.compute([aiDoc], (state) => {
  const r: Range<Decoration>[] = []
  for (const s of state.field(aiDoc).spots) if (s.kind === 'spot') r.push(Decoration.widget({ widget: new InlWidget(s.id), block: true, side: 1 }).range(state.doc.lineAt(s.to).to))
  return Decoration.set(r, true) as DecorationSet
})

const hide = Decoration.replace({})
/** 还没显出来的字：不跨块地藏起来（文字照样在编辑器里、照样存盘），显到哪藏到哪 */
const hides = Prec.highest(
  EditorView.decorations.compute([aiDoc], (state) => {
    const { grows } = state.field(aiDoc)
    if (!grows.length) return Decoration.none
    const doc = state.doc
    const r: Range<Decoration>[] = []
    for (const g of grows)
      for (const h of hiddenRanges(
        g.segs,
        g.shown,
        (p) => doc.lineAt(p),
        (p) => drawnWhole(doc, p),
      ))
        r.push(hide.range(h.from, h.to))
    return Decoration.set(r, true)
  }),
)

// ---------- 竖线、长字的节拍、esc ----------

interface Bar {
  el: HTMLDivElement
  comet: Animation | null
  ring: ReturnType<typeof ringElement> | null
  /** live：光在走；done：实线等淡出；stopped：灰了等淡出 */
  state: 'live' | 'done' | 'stopped'
  timers: ReturnType<typeof setTimeout>[]
  born: number
}

/** 竖线上下各让多少（原型 .lbar 的 top: 3px; bottom: 3px） */
const BAR_INSET = 3

/** 开着的编辑器里还在长字的（esc 一下全显） */
const growingViews = new Set<EditorView>()

/** 这个编辑器里的字一下全显（/ 菜单边收边写的不管：它的「停下」由 ai-act-store 交给它自己） */
function finishView(view: EditorView): boolean {
  const ids = view.state.field(aiDoc, false)?.grows.filter((g) => !g.stream && !g.frozen).map((g) => g.id) ?? []
  if (ids.length) view.dispatch({ effects: ids.map((id) => dropGrow.of(id)) })
  return ids.length > 0
}

let escWired = false
/** esc：AI 还在动手时 ai-act-store 先接住（停这一轮，下面跟着一下全显）；答完了还在长的，一下全显 */
function wireEsc() {
  if (escWired) return
  escWired = true
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing) return
      let done = false
      for (const v of growingViews) done = finishView(v) || done
      done = finishCards() || done
      if (!done) return
      e.preventDefault()
      e.stopPropagation()
    },
    true,
  )
}

/** 那一颗上的「停下」：这一轮还在答就停这一轮；答完了只是一下全显 */
function stopSpot(view: EditorView, id: number) {
  const s = view.state.field(aiDoc).spots.find((x) => x.id === id)
  if (s && actEntries().some((e) => e.turn === s.turn && !e.end)) return stopActing()
  finishView(view)
}

class SpotBars {
  private bars = new Map<number, Bar>()
  private off: () => void
  private timer: ReturnType<typeof setTimeout> | null = null
  /** 已经替这一轮记过一处的（AI 自己写的那一段，ai-act-store 的 spotWrote） */
  private claimed = new Set<number>()
  /** 用户自己滚过（滚轮、触控板）的时候：/ 菜单边收边写时就不再跟着字往下滚 */
  private wheeled = 0
  private onWheel = () => {
    this.wheeled = performance.now()
  }

  constructor(readonly view: EditorView) {
    this.off = onActs(() => this.onActs())
    view.dom.addEventListener('wheel', this.onWheel, { passive: true })
    wireEsc()
    this.sync()
    this.tickSoon()
  }

  update(u: ViewUpdate) {
    const was = u.startState.field(aiDoc)
    const now = u.state.field(aiDoc)
    if (was !== now) {
      this.sync()
      this.tickSoon()
    }
    if (this.bars.size && (u.docChanged || u.geometryChanged || u.heightChanged || u.viewportChanged)) this.place()
  }

  /** 这一处的字还在长（还有没显出来的） */
  private growing(s: Spot): boolean {
    const g = s.grow ? this.view.state.field(aiDoc).grows.find((x) => x.id === s.grow) : null
    return !!g && boundaryOf(g) < s.to
  }

  /** 这一轮停下了：外面写进来的字一下全显，/ 菜单边收边写的停在那里（写的那边把没显的拿掉） */
  private onActs() {
    const path = this.view.state.facet(aiSpotPath)()
    const stopped = (turn: number) => actEntries().some((e) => e.turn === turn && e.area === 'doc' && (e.stopping || !!e.end?.stopped) && (e.whole ? e.path === path : true))
    const effects = this.view.state.field(aiDoc).grows.flatMap((g) => (g.frozen || !stopped(g.turn) ? [] : [g.stream ? freezeGrow.of(g.id) : dropGrow.of(g.id)]))
    if (effects.length) this.view.dispatch({ effects })
    else this.sync()
  }

  /** 照原型每 60 毫秒出几个字（定时器，不跟着画面帧：窗口在后台也照样走完） */
  private tickSoon() {
    const grows = this.view.state.field(aiDoc).grows
    if (grows.length) growingViews.add(this.view)
    else growingViews.delete(this.view)
    if (this.timer || !grows.some((g) => !g.frozen)) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.tick()
    }, GROW_TICK)
  }

  private tick() {
    const view = this.view
    const grows = view.state.field(aiDoc).grows
    if (!grows.length) return
    // 输入法正在拼字：先不动编辑器里的东西
    if (view.composing) return this.tickSoon()
    // 编辑器不在屏幕上（白板看法、换到别的标签）：不长了，一下全显
    const hidden = !view.dom.isConnected || view.dom.offsetParent === null
    const doc = view.state.doc
    const now = performance.now()
    const effects: StateEffect<unknown>[] = []
    for (const g of grows) {
      if (g.frozen) continue
      if (hidden && !g.stream) {
        effects.push(dropGrow.of(g.id))
        continue
      }
      let next: number
      if (g.stream) next = g.shown + Math.min(g.units - g.shown, catchUpStep(g.units - g.shown))
      else next = g.base + shownAt(Math.floor((now - g.t0) / GROW_TICK) + 1, g.step, g.cap - g.base, g.units - g.base)
      // 一个字的两半（表情、生僻字）不从中间切
      const at = boundaryOf({ ...g, shown: next })
      if (at < doc.length) {
        const c = doc.sliceString(at, at + 1).charCodeAt(0)
        if (c >= 0xdc00 && c <= 0xdfff) next++
      }
      if (next >= g.units && !g.stream) effects.push(dropGrow.of(g.id))
      else if (next !== g.shown) {
        effects.push(setShown.of({ id: g.id, shown: Math.min(next, g.units) }))
        // / 菜单写的那一段长到屏幕下面去了：跟着往下滚（用户自己滚过就不跟）
        const to = Math.min(boundaryOf({ ...g, shown: Math.min(next, g.units) }), g.segs.at(-1)?.to ?? 0, doc.length)
        if (g.stream && this.wheeled < g.t0) effects.push(EditorView.scrollIntoView(to, { y: 'nearest', yMargin: 48 }))
      }
    }
    if (effects.length) view.dispatch({ effects })
    else this.tickSoon()
  }

  private sync() {
    const state = this.view.state
    const list = state.field(aiDoc).spots
    for (const [id, b] of this.bars)
      if (!list.some((s) => s.id === id)) {
        this.clear(b)
        b.el.remove()
        this.bars.delete(id)
      }
    const path = state.facet(aiSpotPath)()
    for (const s of list) {
      const growing = this.growing(s)
      let b = this.bars.get(s.id)
      if (!b) {
        const el = document.createElement('div')
        el.className = 'cm-ai-bar'
        el.dataset.testid = 'ai-spot-line'
        el.setAttribute('aria-hidden', 'true')
        this.view.dom.appendChild(el)
        b = { el, comet: null, ring: null, state: 'live', timers: [], born: performance.now() }
        this.bars.set(s.id, b)
        if (!still()) {
          const c = document.createElement('i')
          c.className = 'comet'
          el.appendChild(c)
          b.comet = c.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(320%)' }], {
            duration: 1100,
            iterations: s.kind === 'spot' || growing ? Infinity : 1,
            easing: 'cubic-bezier(.45,0,.55,1)',
          })
        }
      }
      if (b.state !== 'live') continue
      if (s.kind === 'pass') {
        // 整篇改写改到的：字显完了（至少走完一趟光）停成实线
        if (!growing && !b.timers.length) this.settle(s, b, false, still() ? 0 : Math.max(0, 1100 - (performance.now() - b.born)))
        continue
      }
      const e = actEntries().find((x) => x.turn === s.turn && x.area === 'doc')
      // AI 自己写进来的、这一轮还在答：替这一轮记一处（「停下」、esc 停的是这一轮）
      if (!e && writing(s.turn) && !this.claimed.has(s.turn)) {
        this.claimed.add(s.turn)
        queueMicrotask(() => spotWrote(s.turn, path))
      }
      const stopped = !!e && (e.stopping || !!e.end?.stopped)
      const turnLive = e ? !e.end : writing(s.turn)
      this.ringOn(s.id, b, (turnLive || growing) && !stopped)
      if (e?.end?.stopped) this.settle(s, b, true, 0)
      else if (!turnLive && !growing) this.settle(s, b, false, 0)
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
  private settle(s: Spot, b: Bar, stopped: boolean, after: number) {
    const id = s.id
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
          const cut = this.view.state.field(aiDoc).spots.find((x) => x.id === id)?.cut
          inl.querySelector('.t')!.textContent = cut ? tNow('停下了：写到一半的这段留着') : tNow('停下了：这一段留着')
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

  /**
   * 竖线从这一段第一行顶到已经显出来的最后一行底（字还在长，竖线跟着往下长），照原型上下各让 3px，
   * 不跟着伸到下面那一颗「AI 在写这一段」旁边；这一段一个字都还没显时先不画
   */
  private place() {
    this.view.requestMeasure({
      key: this,
      read: (view) => {
        const dom = view.dom.getBoundingClientRect()
        const { spots, grows } = view.state.field(aiDoc)
        return spots.map((s) => {
          const g = s.grow ? grows.find((x) => x.id === s.grow) : null
          const shownTo = g ? boundaryOf(g) : Infinity
          if (shownTo <= s.from) return { id: s.id, top: 0, height: 0, hide: true }
          const top = view.documentTop - dom.top + view.lineBlockAt(s.from).top
          const end = Math.max(s.from, Math.min(s.to, shownTo))
          // 最后一行字的底（不算挂在这一行后面的那一颗）；那一行不在屏幕上量不到时用整行块的底
          const c = view.coordsAtPos(end, -1)
          const bottom = c ? c.bottom - dom.top : view.documentTop - dom.top + view.lineBlockAt(end).bottom
          return { id: s.id, top: top + BAR_INSET, height: bottom - top - 2 * BAR_INSET, hide: false }
        })
      },
      write: (ms) => {
        for (const m of ms) {
          const b = this.bars.get(m.id)
          if (!b) continue
          b.el.style.display = m.hide ? 'none' : ''
          b.el.style.top = Math.round(m.top) + 'px'
          b.el.style.height = Math.max(4, Math.round(m.height)) + 'px'
        }
      },
    })
  }

  destroy() {
    this.off()
    this.view.dom.removeEventListener('wheel', this.onWheel)
    if (this.timer) clearTimeout(this.timer)
    growingViews.delete(this.view)
    for (const b of this.bars.values()) {
      this.clear(b)
      b.el.remove()
    }
  }
}

/** 编辑器扩展：path 给整篇改写时认这篇 */
export function aiSpot(path: () => string) {
  return [aiSpotPath.of(path), typedAt, aiDoc, inlines, hides, ViewPlugin.fromClass(SpotBars)]
}

/** AI 只写了这一段（插进来、换掉选中的）：只亮这一段、字一点点长出来，turn 是哪一轮 */
export function spotRange(view: EditorView, range: { from: number; to: number }, turn: number) {
  const doc = view.state.doc
  const t = trimSpan(doc.sliceString(range.from, range.to), range.from)
  const segs = t && !still() ? segsOf(doc, t.from, t.to) : null
  const grow = segs?.length ? newGrow(doc, turn, segs) : null
  view.dispatch({
    effects: [...(grow ? [addGrow.of(grow)] : []), addSpot.of({ id: ++ids, from: range.from, to: range.to, turn, kind: 'spot', grow: grow?.id ?? 0 })],
  })
}

// ---------- / 菜单边收边写（ai-write.ts 用） ----------

/** 这个编辑器认不认边收边写（文档编辑器有；白板卡里就地改的小编辑器没有，照旧写完一次插进去） */
export const canStream = (state: EditorState) => state.field(aiDoc, false) !== undefined

export interface StreamIds {
  spot: number
  grow: number
}

/**
 * 开始边收边写：在 pos 插 before + first + after（一个改动，不进撤销记录），first 那一截先藏着、一点点长出来；
 * 返回那一处（竖线、「AI 在写这一段」）和这一次长的编号
 */
export function streamStart(view: EditorView, pos: number, parts: { before: string; first: string; after: string }, turn: number): StreamIds {
  const from = pos + parts.before.length
  const to = from + parts.first.length
  const spot = ++ids
  const grow = still() ? null : { ...newGrow(view.state.doc, turn, [], true), segs: [{ from, to }], units: to - from, cap: to - from, shown: Math.min(to - from, catchUpStep(to - from)) }
  view.dispatch({
    changes: { from: pos, insert: parts.before + parts.first + parts.after },
    effects: [...(grow ? [addGrow.of(grow)] : []), addSpot.of({ id: spot, from, to, turn, kind: 'spot', grow: grow?.id ?? 0 })],
    annotations: [growOwn.of(true), hiddenOk.of(true), Transaction.addToHistory.of(false)],
    userEvent: 'input.ai',
    scrollIntoView: true,
  })
  return { spot, grow: grow?.id ?? 0 }
}

/** AI 写的这一截现在在哪（用户在别处打字它跟着挪）；那一处不在了是 null */
export function streamRange(state: EditorState, spot: number): { from: number; to: number } | null {
  const s = state.field(aiDoc, false)?.spots.find((x) => x.id === spot)
  return s ? { from: s.from, to: s.to } : null
}

/** 往 AI 写的这一截后面接 more（不进撤销记录，写完由 streamCommit 收成一步） */
export function streamPush(view: EditorView, at: StreamIds, more: string) {
  const s = view.state.field(aiDoc).spots.find((x) => x.id === at.spot)
  if (!s || !more) return
  const to = s.to + more.length
  view.dispatch({
    changes: { from: s.to, insert: more },
    effects: [addSpot.of({ ...s, to }), ...(at.grow ? [extendGrow.of({ id: at.grow, to, more: true })] : [])],
    annotations: [growOwn.of(true), hiddenOk.of(true), Transaction.addToHistory.of(false)],
    userEvent: 'input.ai',
  })
}

/** 不再来字了：剩下的追着显完（1.5 秒内） */
export function streamDone(view: EditorView, at: StreamIds) {
  const s = streamRange(view.state, at.spot)
  if (s && at.grow && view.state.field(aiDoc).grows.some((g) => g.id === at.grow)) view.dispatch({ effects: extendGrow.of({ id: at.grow, to: s.to, more: false }) })
}

/** 这一次的字都显出来了（显完、一下全显、被用户改了都算） */
export function streamShown(state: EditorState, grow: number): boolean {
  return !state.field(aiDoc, false)?.grows.some((g) => g.id === grow)
}

/** 显到哪了（第一个还藏着的位置）；都显了是 null */
export function streamShownTo(state: EditorState, grow: number): number | null {
  const g = state.field(aiDoc, false)?.grows.find((x) => x.id === grow)
  if (!g) return null
  const b = boundaryOf(g)
  return Number.isFinite(b) ? b : null
}

/** 停下：不再长；cut：没显的拿掉了（那一颗说「停下了：写到一半的这段留着」） */
export function streamStop(view: EditorView, at: StreamIds, cut: boolean) {
  view.dispatch({ effects: [...(at.grow ? [dropGrow.of(at.grow)] : []), ...(cut ? [markCut.of(at.spot)] : [])] })
}

/**
 * 收成撤销记录里的一步：[from, to) 先不记撤销地拿掉，再记着放回 insert（⌘Z 一下撤掉 AI 写的整段，和以前一次插进去一样）；
 * AI 写的字在 insert 里是 [textFrom, textTo)，那一处跟着，光标放在 AI 写的末尾。insert 是空的：只拿掉，不留撤销
 */
export function streamCommit(view: EditorView, at: StreamIds, range: { from: number; to: number }, insert: string, text: { from: number; to: number }) {
  const s = view.state.field(aiDoc).spots.find((x) => x.id === at.spot)
  view.dispatch({
    changes: { from: range.from, to: range.to },
    effects: !insert && s ? [dropSpot.of(s.id)] : [],
    annotations: [growOwn.of(true), hiddenOk.of(true), Transaction.addToHistory.of(false)],
    userEvent: 'input.ai',
  })
  if (!insert) return
  const cur = view.state.field(aiDoc).spots.find((x) => x.id === at.spot)
  view.dispatch({
    changes: { from: range.from, insert },
    selection: { anchor: range.from + text.to },
    effects: cur ? [addSpot.of({ ...cur, from: range.from + text.from, to: range.from + text.to })] : [],
    annotations: [growOwn.of(true), hiddenOk.of(true)],
    userEvent: 'input.ai',
  })
}
