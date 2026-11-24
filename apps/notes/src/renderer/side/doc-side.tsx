/**
 * 文档里 AI 写的那一块（`> [!ai]` 提示块：视频框一块问的讲解、AI 回答插进文档的、AI 命令写的）上开旁支
 * （task-4edsc，用户选的方向 A「就地展开」，原型 proto.html#dir=a 的「文档里的 AI 讲解」）：
 * - 讲解里拖选一句：离选中高亮的下沿 8 同一个小框（AskBoxView）「引用 ⌘↵ · 问这句 ↵」；自己写的字不出（照旧右键、⌘J 问 AI）；
 * - 「问这句」：那句所在的那一段下面长出旁支（块部件，createRoot 画 SideInline），右栏 AI 的输入框不缩（旁支在中间）；
 * - 问答写进这篇：挂在这块讲解下面 `> [!side] 问题` + `> > 那一句` + 回答（@cn/format 的 doc-side.ts，和读 PDF 笔记一个写法），
 *   答好了一次写进去（不进撤销，软件写的）；文档里那几行藏起来，只在那句后面露小标（一句一个，数字是这一句几条），点小标开 / 收；
 * - 讲解块没有会话可分叉：第一问开新会话、那段讲解放在前面（ai:side 带 fresh），接着问接着旁支自己的会话（主进程记在这篇的对话文件里）。
 * 只加装饰、藏起来的行原样留着，打开再保存文件不变。
 */
import { aiBodyAt, type DocAiBlock, docAiBlocks, isSummaryHead, locateQuote, quoteOfRange, sideInsert, sideRemove } from '@cn/format'
import { EditorState, Prec, type Range, StateEffect, StateField, Transaction } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, keymap, type PluginValue, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view'
import { type ReactNode, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { Root } from 'react-dom/client'
import { guardedRoot } from '../crash/root'
import type { AiPick, EngineInfo } from '@cn/ai-engines/shared'
import { convPick, hasEffort } from '@cn/ai-engines/shared'
import { titleOf } from '../../shared/layout'
import type { Material } from '../../shared/materials'
import { useConvPick } from '@cn/ai-chat/composer'
import { app } from '../ctx/actions'
import { editorHost } from '../editor-host'
import { calloutFolded } from '../fold-block'
import { type Hidden, hiddenOk, hiddenSyntax } from '../hidden-syntax'
import { badgeEl, closeRun, flashMark, groupMark } from '@cn/ai-chat/side/marks'
import { AskBoxView, highlightBottom, highlightTop } from '@cn/ai-chat/side/AskBox'
import { ASK_THIS, sideAsks, sideName } from './name'
import { askSide, blockAgain, nameOf, setName, type SideTarget, sideIndex, writeOnDisk } from './side-core'
import { SideInline, type SideMsgView } from '@cn/ai-chat/side/SideInline'
import { useT } from '../i18n'
import { t as tNow } from '../../shared/i18n'
import { ipcOn } from '../crash/ipc'

/** 开着的那一条：哪一块讲解（头一行行首，跟着改动挪）、第几条（等于已有的条数是刚开、还没写进去的那条）、那一句 */
interface Open {
  head: number
  side: number
  quote: string
}

/** 问出去、还没写进文档的那一问：答着、或者没答出来（出错的留着，再问一次换掉它） */
interface Pend {
  id: number
  head: number
  side: number
  quote: string
  q: string
  mats?: Material[]
  a: string
  running: boolean
  error?: string
  /** 接着问的是哪一条（那一句 + 它的第一问，写的时候按它找，不按第几条）；新开的一条是 null */
  target: SideTarget
}

interface State {
  blocks: DocAiBlock[]
  open: Open | null
  pend: Pend[]
  /** 刚收起的那一句（那句闪一下） */
  flash: { key: string; seq: number } | null
  /** 变一次加一：块部件按它重画 */
  ver: number
}

const setOpen = StateEffect.define<Open | null>()
const pendAdd = StateEffect.define<Pend>()
const pendText = StateEffect.define<{ id: number; delta: string }>()
/** 答完了：drop 是已经写进文档了；没写进去的（出错）留着、写上原因 */
const pendEnd = StateEffect.define<{ id: number; drop: boolean; error?: string }>()
/**
 * 新开的一条写进去了：它原来排在第 slot 条（还没写进去的几条排在已有的后面），写进去成了第 at 条（已有的最后面）；
 * 排在它前面、还没写进去的那几条往后挪一个，开着的那条跟着
 */
const pendWrote = StateEffect.define<{ head: number; slot: number; at: number }>()

let flashSeq = 0

const lineFrom = (state: EditorState, n: number) => state.doc.line(n + 1).from
const lineTo = (state: EditorState, n: number) => state.doc.line(n + 1).to

/** 这一句的编号（这块讲解头一行的位置 + 这一句里最早开的那条）：小标、虚线上的 data-side */
const keyOf = (head: number, first: number) => `d${head}-${first}`

/** 一块讲解里同一句开的几条并成一组（按开的先后）；开着的那条刚开、还没写进去时也算进它那一句 */
function groupsOf(state: EditorState, b: DocAiBlock, open: Open | null): { key: string; quote: string; idx: number[] }[] {
  const head = lineFrom(state, b.head)
  const out: { key: string; quote: string; idx: number[] }[] = []
  const add = (quote: string, i: number) => {
    const g = out.find((x) => x.quote === quote)
    if (g) g.idx.push(i)
    else out.push({ key: keyOf(head, i), quote, idx: [i] })
  }
  b.sides.forEach((s, i) => add(s.quote, i))
  if (open && open.head === head && open.side >= b.sides.length) add(open.quote, open.side)
  return out
}

const field = StateField.define<State>({
  create: (s) => ({ blocks: docAiBlocks(s.doc.toString()), open: null, pend: [], flash: null, ver: 0 }),
  update(v, tr) {
    let next = v
    if (tr.docChanged) {
      const map = (p: number) => tr.changes.mapPos(p, -1)
      next = {
        ...next,
        blocks: docAiBlocks(tr.state.doc.toString()),
        open: next.open ? { ...next.open, head: map(next.open.head) } : null,
        pend: next.pend.map((p) => ({ ...p, head: map(p.head) })),
      }
      // 开着的那块讲解被删了：收起
      if (next.open && !next.blocks.some((b) => lineFrom(tr.state, b.head) === next.open!.head)) next = { ...next, open: null }
    }
    for (const e of tr.effects) {
      if (e.is(setOpen)) {
        const was = next.open
        let flash = next.flash
        if (!e.value && was) {
          const b = next.blocks.find((x) => lineFrom(tr.state, x.head) === was.head)
          const g = b && groupsOf(tr.state, b, null).find((x) => x.quote === was.quote)
          if (g) flash = { key: g.key, seq: ++flashSeq }
        }
        next = { ...next, open: e.value, flash }
      } else if (e.is(pendAdd)) next = { ...next, pend: [...next.pend.filter((p) => !(p.head === e.value.head && p.side === e.value.side && !p.running)), e.value] }
      else if (e.is(pendText)) next = { ...next, pend: next.pend.map((p) => (p.id === e.value.id ? { ...p, a: p.a + e.value.delta } : p)) }
      else if (e.is(pendEnd)) next = { ...next, pend: e.value.drop ? next.pend.filter((p) => p.id !== e.value.id) : next.pend.map((p) => (p.id === e.value.id ? { ...p, running: false, error: e.value.error ?? tNow('没有回答') } : p)) }
      else if (e.is(pendWrote)) {
        const { head, slot, at } = e.value
        const move = (i: number) => (i === slot ? at : i >= at && i < slot ? i + 1 : i)
        next = {
          ...next,
          pend: next.pend.map((p) => (p.head === head ? { ...p, side: move(p.side) } : p)),
          open: next.open && next.open.head === head ? { ...next.open, side: move(next.open.side) } : next.open,
        }
      }
    }
    return next === v ? v : { ...next, ver: v.ver + 1 }
  },
})

// ---------------------------------------------------------------- 画：虚线、小标、藏起来的旁支、开着的那一块

class BadgeWidget extends WidgetType {
  constructor(
    readonly key: string,
    readonly n: number,
    readonly cur: boolean,
  ) {
    super()
  }
  eq(o: BadgeWidget) {
    return o.key === this.key && o.n === this.n && o.cur === this.cur
  }
  toDOM(view: EditorView) {
    const b = badgeEl(groupMark({ key: this.key, quote: '', sides: Array.from({ length: this.n }, (_, i) => ({ id: String(i) })) }, null))
    if (this.cur) b.classList.add('cur')
    b.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      toggle(view, this.key)
    })
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      toggle(view, this.key)
    })
    return b
  }
  ignoreEvent() {
    return true
  }
}

/** 点小标：这一句开着的那条收起；没开着就打开这一句最后开的那条 */
function toggle(view: EditorView, key: string) {
  const st = view.state.field(field)
  for (const b of st.blocks) {
    const g = groupsOf(view.state, b, st.open).find((x) => x.key === key)
    if (!g) continue
    const head = lineFrom(view.state, b.head)
    if (st.open && st.open.head === head && g.idx.includes(st.open.side)) return close(view)
    wantFocus = true
    view.dispatch({ effects: setOpen.of({ head, side: g.idx[g.idx.length - 1]!, quote: g.quote }) })
    return
  }
}

/** 收起：那句闪一下；焦点在旁支里的回到正文 */
function close(view: EditorView) {
  const inSide = !!(document.activeElement as HTMLElement | null)?.closest?.('.cm-side-host')
  view.dispatch({ effects: setOpen.of(null) })
  if (inSide) view.focus()
}

/** 打开、切过来的那一下光标进旁支的输入框 */
let wantFocus = false

class HostWidget extends WidgetType {
  constructor(
    readonly ver: number,
    /** 在讲解的最后一段后面：这一块接着画提示块的底和下圆角 */
    readonly last: boolean,
  ) {
    super()
  }
  eq(o: HostWidget) {
    return o.ver === this.ver && o.last === this.last
  }
  toDOM(view: EditorView) {
    const el = document.createElement('div')
    el.className = 'cm-side-host' + (this.last ? ' last' : '')
    this.mount(el, view)
    return el
  }
  updateDOM(dom: HTMLElement, view: EditorView) {
    dom.className = 'cm-side-host' + (this.last ? ' last' : '')
    this.mount(dom, view)
    return true
  }
  private mount(el: HTMLElement, view: EditorView) {
    const root = ((el as HTMLElement & { _root?: Root })._root ??= guardedRoot(el, 'doc-side'))
    flushSync(() => root.render(<DocSide view={view} />))
  }
  destroy(dom: HTMLElement) {
    const root = (dom as HTMLElement & { _root?: Root })._root
    if (root) queueMicrotask(() => root.unmount())
  }
  ignoreEvent() {
    return true
  }
  get estimatedHeight() {
    return 260
  }
}

function build(state: EditorState): { deco: DecorationSet; hidden: Hidden[] } {
  const st = state.field(field)
  const out: Range<Decoration>[] = []
  const hidden: Hidden[] = []
  const text = state.doc.toString()
  const len = state.doc.length
  for (const b of st.blocks) {
    const head = lineFrom(state, b.head)
    const open = st.open && st.open.head === head ? st.open : null
    const folded = calloutFolded(state, head)
    for (const g of groupsOf(state, b, open)) {
      const at = locateQuote(text, b, g.quote)
      if (!at || folded) continue
      const cur = !!open && g.idx.includes(open.side)
      // 紧跟着的收尾标点算进那一句（小标跟在「。」后面，同回答里）
      const ln = state.doc.lineAt(at.to)
      const to = ln.from + closeRun(ln.text, at.to - ln.from)
      out.push(Decoration.mark({ class: 'asked' + (cur ? ' on' : ''), attributes: { 'data-side': g.key } }).range(at.from, to))
      out.push(Decoration.widget({ widget: new BadgeWidget(g.key, g.idx.length, cur), side: 1 }).range(to))
    }
    // 挂着的旁支那几行（从讲解后面那个空行到最后一块）藏起来；光标、打的字进不去，整块讲解连着选中删才跟着删
    if (b.tail) {
      const from = lineFrom(state, b.tail.from)
      const to = lineTo(state, b.tail.to)
      out.push(Decoration.replace({ block: true }).range(from, to))
      const z = to < len ? to + 1 : to
      hidden.push({ from: from - 1, to: z, fromOk: true, toOk: true, side: 'near', unit: { from: head, to }, ...(z < len ? {} : { pad: '\n\n' }) })
    }
    // 开着的那一条：那句所在的那一段的最后一行后面（讲解收着时不画，收起来）
    if (open && !folded) {
      const at = locateQuote(text, b, open.quote)
      const line = at ? state.doc.lineAt(at.to).number - 1 : b.end
      const para = b.paras.find((p) => line >= p.from && line <= p.to) ?? b.paras[b.paras.length - 1]
      const end = para ? para.to : b.end
      out.push(Decoration.widget({ widget: new HostWidget(st.ver, end === b.end), block: true, side: 1 }).range(lineTo(state, end)))
    }
  }
  return { deco: Decoration.set(out, true), hidden }
}

const decoField = StateField.define<{ deco: DecorationSet; hidden: Hidden[] }>({
  create: build,
  update: (v, tr) => (tr.docChanged || tr.effects.length ? build(tr.state) : v),
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.deco),
    EditorView.atomicRanges.of((view) => {
      const set = view.state.field(f).deco
      const blocks: Range<Decoration>[] = []
      set.between(0, view.state.doc.length, (from, to, d) => {
        if (d.spec.block && !d.spec.widget) blocks.push(d.range(from, to))
      })
      return Decoration.set(blocks)
    }),
    hiddenSyntax.of((state) => state.field(f).hidden),
  ],
})

// ---------------------------------------------------------------- 开着的那一块（React）

/** 这块讲解的那几行问答（问的原话、回答原文），没写进去的那一问接在后面 */
function msgsOf(b: DocAiBlock | undefined, side: number, pend: Pend[], head: number): SideMsgView[] {
  const out: SideMsgView[] = []
  let id = 1
  for (const t of b?.sides[side]?.turns ?? []) {
    out.push({ id: id++, role: 'user', text: t.q })
    out.push({ id: id++, role: 'ai', text: t.a })
  }
  for (const p of pend.filter((x) => x.head === head && x.side === side)) {
    out.push({ id: id++, role: 'user', text: p.q, ...(p.mats?.length ? { mats: p.mats } : {}) })
    out.push({ id: id++, role: 'ai', text: p.a, ...(p.error ? { error: p.error } : {}) })
  }
  return out
}

function DocSide({ view }: { view: EditorView }): ReactNode {
  const t = useT()
  const st = view.state.field(field)
  const open = st.open
  const path = view.state.facet(editorHost).path()
  const place = `file:${path}`
  // 改了名字重画一次（名字不在编辑器的状态里）
  const [, setNamed] = useState(0)
  // 模型、effort 跟这篇的 AI 对话（谁来答不放，跟「AI 对话」那一行）
  const [own, setOwn] = useState<AiPick | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.aiChatPick(place).then((p) => live && setOwn(p))
    return () => {
      live = false
    }
  }, [place])
  const cp = useConvPick<AiPick, EngineInfo>(own, (p) => {
    setOwn(p)
    void window.cn.aiChatSetPick(place, p)
  }, (t) => app().notice(t))
  if (!open) return null
  const b = st.blocks.find((x) => lineFrom(view.state, x.head) === open.head)
  if (!b) return null
  const groups = groupsOf(view.state, b, open)
  const g = groups.find((x) => x.idx.includes(open.side))
  // 第 i 条的第一问：写进文件的那一问，还没写进去的是正在答的那一问
  const firstQ = (i: number) => b.sides[i]?.turns[0]?.q ?? st.pend.find((p) => p.head === open.head && p.side === i)?.q
  const nameAt = (i: number) => sideName({ name: nameOf(path, open.quote, firstQ(i)), quote: open.quote, msgs: msgsOf(b, i, st.pend, open.head) })
  const msgs = msgsOf(b, open.side, st.pend, open.head)
  const running = st.pend.some((p) => p.head === open.head && p.side === open.side && p.running)
  const all = st.blocks.flatMap((x) => {
    const h = lineFrom(view.state, x.head)
    return x.sides.map((s, i) => ({ id: `${h}:${i}`, name: sideName({ name: nameOf(path, s.quote, s.turns[0]?.q), quote: s.quote, msgs: s.turns.map((t) => ({ role: 'user', text: t.q })) }), right: t('{n} 问', { n: sideAsks({ msgs: s.turns.map(() => ({ role: 'user' })) }) }) }))
  })
  const current = `${open.head}:${open.side}`
  return (
    <SideInline
      side={{ id: current, quote: open.quote, name: nameAt(open.side), msgs }}
      group={(g?.idx ?? [open.side]).map((i) => ({ id: `${open.head}:${i}`, name: nameAt(i) }))}
      running={running}
      record={{ icon: 'file', text: isSummaryHead(view.state.doc.line(b.head + 1).text) ? t('写在这篇文档里，挂在这段总结下面') : t('写在这篇文档里，挂在这段讲解下面') }}
      picks={cp.picks}
      onSend={(text, mats) => void send(view, open, text, mats, { engine: cp.pick.engine, req: cp.req })}
      onStop={() => {
        const p = st.pend.find((x) => x.head === open.head && x.side === open.side && x.running)
        if (p) void window.cn.aiTurnStop(p.id)
      }}
      onClose={() => close(view)}
      onNew={() => {
        wantFocus = true
        view.dispatch({ effects: setOpen.of({ head: open.head, side: Math.max(b.sides.length, ...st.pend.filter((p) => p.head === open.head).map((p) => p.side + 1)), quote: open.quote }) })
      }}
      onSwitch={(id) => {
        const [h, i] = id.split(':').map(Number) as [number, number]
        const to = st.blocks.find((x) => lineFrom(view.state, x.head) === h)
        wantFocus = true
        view.dispatch({ effects: setOpen.of({ head: h, side: i, quote: to?.sides[i]?.quote ?? open.quote }) })
      }}
      onPut={(text) => {
        app().askAi(text, t('旁支 · {name}', { name: nameAt(open.side) }))
        app().notice(t('插进了主对话的输入框，没发'))
      }}
      menu={{
        title: t('这篇文档的旁支'),
        all: all.length && all.some((x) => x.id === current) ? all : [...all, { id: current, name: nameAt(open.side), right: t('{n} 问', { n: 0 }) }],
        onRename: (name) => {
          const first = firstQ(open.side)
          if (!first) return app().notice(t('先问一句，再给这条旁支改名'))
          setName(path, open.quote, first, name)
          setNamed((n) => n + 1)
        },
        onDelete: () => {
          const s = b.sides[open.side]
          view.dispatch({ effects: setOpen.of(null) })
          if (!s) return
          if (s.turns[0]) setName(path, s.quote, s.turns[0].q, '')
          const r = sideRemove(view.state.doc.toString(), s)
          view.dispatch({ changes: { from: r.from, to: r.to }, annotations: [hiddenOk.of(true), Transaction.addToHistory.of(false)], userEvent: 'delete.side' })
        },
      }}
      onNotice={(t) => app().notice(t)}
      takeFocus={() => {
        const w = wantFocus
        wantFocus = false
        return w
      }}
    />
  )
}

// ---------------------------------------------------------------- 问：交给 ai:side，答好了写进文档

/** 答着的那几问是哪个编辑器的（边答边出字往它里面送） */
const asking = new Map<number, EditorView>()
let listening = false
let askSeq = Date.now() * 10

async function send(view: EditorView, open: Open, text: string, mats: Material[], how: { engine: AiPick['engine']; req: { model?: string; effort?: string } }) {
  const st = view.state.field(field)
  const b = st.blocks.find((x) => lineFrom(view.state, x.head) === open.head)
  if (!b || st.pend.some((p) => p.head === open.head && p.side === open.side && p.running)) return
  const done = b.sides[open.side]?.turns ?? []
  const q = text.trim() || (done.length ? '' : tNow(ASK_THIS))
  if (!q) return
  if (!listening) {
    listening = true
    ipcOn(window.cn.onAiEvent, 'cn.onAiEvent')((id, e) => {
      const v = asking.get(id)
      if (v && e.type === 'text') v.dispatch({ effects: pendText.of({ id, delta: e.delta }) })
    })
  }
  const path = view.state.facet(editorHost).path()
  const title = titleOf(path)
  const id = ++askSeq
  asking.set(id, view)
  const target = done.length ? { quote: open.quote, first: done[0]!.q } : null
  view.dispatch({ effects: pendAdd.of({ id, head: open.head, side: open.side, quote: open.quote, q, ...(mats.length ? { mats } : {}), a: '', running: true, target }) })
  // 讲解块没有会话：新会话，那段讲解（和这条旁支已经问过的）放在第一问前面；上面那一问（视频框一块问的疑惑）也带上
  const text0 = view.state.doc.toString()
  const lines = text0.split('\n')
  const above = lines.slice(Math.max(0, b.head - 6), b.head).find((l) => /\*\*我的疑惑\*\*：/.test(l))
  const res = await askSide({
    id,
    path,
    title,
    text: text0,
    block: b,
    quote: open.quote,
    q,
    done,
    // 不翻：给 AI 的话（他当时问的、那段讲解在哪）
    ...(above ? { lead: `他当时问的：${above.replace(/^\s*>\s*\*\*我的疑惑\*\*：/, '')}` } : {}),
    where: `文档《${title}》里 AI 写的${isSummaryHead(lines[b.head] ?? '') ? '总结' : '讲解'}`, // 不翻
    mats,
    how,
  })
  asking.delete(id)
  const pend = view.state.field(field, false)?.pend.find((p) => p.id === id)
  const answer = (res.text || pend?.a || '').trim()
  // 标签关了（编辑器没了）：直接写进文件（这一问不丢）
  if (!view.dom.isConnected) {
    if (!res.error && answer) await writeOnDisk(path, view.state.doc.toString(), (t) => blockAgain(t, b.head, open.quote), { q, a: answer }, open.quote, target)
    return
  }
  if (res.error || !answer) {
    view.dispatch({ effects: pendEnd.of({ id, drop: false, error: res.error ?? tNow('没有回答') }) })
    return
  }
  // 写进文档：这块讲解（跟着改动挪过的位置）下面，新开的写在最后、接着问的写在那条最后一块后面
  const now = view.state
  const head = pend?.head ?? open.head
  const blk = now.field(field).blocks.find((x) => lineFrom(now, x.head) === head)
  if (!blk) {
    view.dispatch({ effects: pendEnd.of({ id, drop: false, error: tNow('那段讲解不在了，这条回答没写进文档') }) })
    return
  }
  const at = sideIndex(blk, target)
  const ins = sideInsert(now.doc.toString(), blk, at, { q, a: answer }, open.quote)
  view.dispatch({
    changes: { from: ins.at, insert: ins.insert },
    effects: [pendEnd.of({ id, drop: true }), ...(at >= blk.sides.length ? [pendWrote.of({ head, slot: pend?.side ?? open.side, at })] : [])],
    annotations: [hiddenOk.of(true), Transaction.addToHistory.of(false)],
    userEvent: 'input.side',
  })
}

// ---------------------------------------------------------------- 选一句：小框

class AskPlugin implements PluginValue {
  private el: HTMLDivElement
  private root: Root
  private box: { cx: number; top: number; bottom: number; quote: string; head: number } | null = null
  private flashSeen = 0

  constructor(readonly view: EditorView) {
    this.el = document.createElement('div')
    this.el.className = 'cm-side-askbox'
    document.body.appendChild(this.el)
    this.root = guardedRoot(this.el, 'doc-side-ask')
    view.contentDOM.addEventListener('mouseup', this.onUp)
  }

  private onUp = (e: MouseEvent) => {
    // 旁支那一块里、小标上松开的不算（那里面的字不是讲解）
    if ((e.target as Element | null)?.closest?.('.cm-side-host, .badge')) return
    setTimeout(() => {
      const v = this.view
      const sel = v.state.selection.main
      if (sel.empty || v.state.readOnly) return
      const text = v.state.doc.toString()
      const st = v.state.field(field)
      const a = aiBodyAt(text, st.blocks, sel.from)
      const z = aiBodyAt(text, st.blocks, Math.max(sel.from, sel.to - 1))
      if (!a || !z || a.block !== z.block) return
      const quote = quoteOfRange(text, sel.from, sel.to)
      if (quote.length < 2) return
      const b = st.blocks[a.block]!
      const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null
      const r = range?.getBoundingClientRect() ?? null
      const end = v.coordsAtPos(sel.to)
      const start = v.coordsAtPos(sel.from)
      // 小条量到选中高亮的上沿、下沿（r129 放在上方，放不下放下方）：文档里的高亮铺满整行行高，比字高出、低出半个行距
      const rect = range && r && r.width ? { left: r.left, width: r.width, top: highlightTop(range), bottom: highlightBottom(range) } : start && end ? { left: Math.min(start.left, end.left), width: Math.abs(end.right - start.left), top: start.top, bottom: end.bottom } : null
      if (!rect) return
      this.box = { cx: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom, quote, head: lineFrom(v.state, b.head) }
      this.draw()
    }, 0)
  }

  /** 小框开着：编辑器里按回车是「问这句」（不把选中的字换成换行） */
  enter(): boolean {
    if (!this.box) return false
    this.ask('')
    return true
  }

  private ask(question: string) {
    const b = this.box
    if (!b) return
    this.box = null
    this.draw()
    const v = this.view
    const st = v.state.field(field)
    const blk = st.blocks.find((x) => lineFrom(v.state, x.head) === b.head)
    if (!blk) return
    const side = Math.max(blk.sides.length, ...st.pend.filter((p) => p.head === b.head).map((p) => p.side + 1))
    const open: Open = { head: b.head, side, quote: b.quote }
    wantFocus = true
    v.dispatch({ effects: setOpen.of(open), selection: { anchor: v.state.selection.main.to } })
    if (question.trim()) {
      const ai = window.cn.aiEngines()
      void Promise.all([ai, window.cn.aiChatPick(`file:${v.state.facet(editorHost).path()}`)]).then(([e, own]) => {
        const pick = convPick(e.engines, e.chat, own)
        void send(v, open, question, [], { engine: pick.engine, req: hasEffort(pick.engine) ? { model: pick.model ?? '', ...(pick.effort ? { effort: pick.effort } : {}) } : {} })
      })
    }
  }

  private draw() {
    const b = this.box
    flushSync(() =>
      this.root.render(
        b ? (
          <AskBoxView
            key={`${b.cx},${b.bottom}`}
            at={b}
            sel={b.quote}
            within={this.view.scrollDOM.getBoundingClientRect()}
            onClose={(why) => {
              this.box = null
              this.draw()
              if (why === 'esc') this.view.dispatch({ selection: { anchor: this.view.state.selection.main.to } })
            }}
            onQuote={() => {
              const q = b.quote
              this.box = null
              this.draw()
              app().askAi(q)
            }}
            onAsk={(question) => this.ask(question)}
          />
        ) : null,
      ),
    )
  }

  update(u: ViewUpdate) {
    if (this.box && (u.docChanged || u.selectionSet) && u.state.selection.main.empty) {
      this.box = null
      this.draw()
    }
    // 刚收起的那一句闪一下
    const f = u.state.field(field).flash
    if (f && f.seq !== this.flashSeen) {
      this.flashSeen = f.seq
      requestAnimationFrame(() => flashMark(this.view.contentDOM, f.key))
    }
  }

  destroy() {
    this.view.contentDOM.removeEventListener('mouseup', this.onUp)
    const root = this.root
    queueMicrotask(() => root.unmount())
    this.el.remove()
  }
}

const askPlugin = ViewPlugin.fromClass(AskPlugin)

/** 文档里 AI 讲解块的旁支：放进文档模式的扩展里（note-doc.ts） */
export const docSides = [
  field,
  decoField,
  askPlugin,
  Prec.highest(
    keymap.of([
      {
        key: 'Enter',
        run: (view) => view.plugin(askPlugin)?.enter() ?? false,
      },
    ]),
  ),
]
