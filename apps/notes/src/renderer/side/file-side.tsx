/**
 * 旁支接到排好的 AI 讲解上（task-p90ra，偏好「旁支就地展开」「旁支全局能用」，方向 A 原型 proto.html#dir=a 推到这两处）：
 * - 白板上的 AI 讲解卡（`> [!ai]` 那一张）：卡里选一句，旁支长在卡里那一段下面，卡跟着长高；
 * - 网页视频「框一块问」问框自己的回答：回答里选一句，旁支长在问框里那一段下面。
 * 两处画的都是排好的字（md-render 的 Markdown），不是编辑器：SideText 把回答画出来、划问过的那句和小标（@cn/ai-chat 的 side/marks）、
 * 选一句出同一个小框（AskBoxView）、开着的那条用同一个 SideInline 画进那一段后面的格子。
 * 问答写进同一篇文件：挂在那块讲解下面的 `> [!side]`（@cn/format doc-side.ts，和文档里开的是同一份、同一条旁支的会话，side-core.ts）。
 * 那篇在编辑器里开着就改编辑器（不进撤销，同文档里的旁支），没开着先比后写进文件；问框选了「只问不记」的只留在问框里（mem）。
 */
import { type CodiconName } from '@cn/design'
import { type DocAiBlock, foldQuote, mdPlain, rawQuoteOf, sideInsert, sideRemove } from '@cn/format'
import { Transaction } from '@codemirror/state'
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { type AiPick, convPick, type EngineInfo, hasEffort } from '@cn/ai-engines/shared'
import type { Material } from '../../shared/materials'
import type { ReplyPlace } from '../../shared/replies'
import { useConvPick } from '@cn/ai-chat/composer'
import { app } from '../ctx/actions'
import { hiddenOk } from '../hidden-syntax'
import { isKey } from '../keys'
import { useCiteSig } from '../cite-names'
import { Markdown } from '../md-render'
import { NoteDoc } from '../note-doc'
import { applyMarks, flashMark, type Mark, rangeText } from '@cn/ai-chat/side/marks'
import { AskBoxView, highlightBottom, highlightTop } from '@cn/ai-chat/side/AskBox'
import { blockOf, showSide } from '@cn/ai-chat/side/host'
import { ASK_THIS, sideAsks, sideName } from './name'
import { askSide, nameOf, setName, sideIndex } from './side-core'
import { SideInline, type SideMsgView } from '@cn/ai-chat/side/SideInline'
import { useT } from '../i18n'
import { t as tNow } from '../../shared/i18n'

/** 一处挂旁支的地方（一张白板卡、问框里的一问） */
export interface Spot {
  /** 这一处的编号：同一时间开着的那条旁支认它 */
  host: string
  /** 写进哪一篇；null：只在这里（问框「只问不记」），不写进文件 */
  path: string | null
  /** 那篇的名字（给 AI 的话、底栏） */
  title: string
  /** 那篇现在的文字（path 是 null 时不用） */
  text: string
  /** 这一处对着的那块讲解（按现在的文字找） */
  find(text: string): DocAiBlock | null
  /** 给 AI 说这段讲解在哪 */
  where: string
  /** 讲解前面的话（问框：他当时问的那一句） */
  lead?: string
  /** 不写进文件时（只问不记）那段讲解的原文 */
  body?: string
  /** 最下面那一行：记到了哪 */
  record: { icon: CodiconName; text: string }
  /** 小框「引用」 */
  onQuote(quote: string): void
  /** 选的模型、effort 跟哪一份对话（AI 对话那一行的 place） */
  place: string
  readOnly?: boolean
  /** 问框里：旁支的输入框和「记到哪」钉在问框底部这一格（task-5yp97 选法 2）；没有就在旁支那一块里 */
  dock?: HTMLElement | null
  /** 这段 AI 写的是讲解还是总结（「AI 总结的」卡，task-5yp97）：⋯ 菜单写「这段总结的旁支」 */
  noun?: '讲解' | '总结'
  /** 回答下面那排的快捷回复跟哪一处排（视频问框是视频）；不给是 AI 对话 */
  replies?: ReplyPlace
}

// ---------------------------------------------------------------- 开着哪一条、在答的、只问不记的（全软件一份：一次只开一条）

interface Open {
  host: string
  /** 那一句（原文） */
  quote: string
  /** 这条旁支的第一问；还没问过（新开的）是 null，fresh 认它 */
  first: string | null
  fresh: number
}

interface Pend {
  id: number
  host: string
  quote: string
  /** 写进哪一条：那条的第一问；新开的一条答好写进去以前是 null（fresh 认它） */
  first: string | null
  fresh: number
  /** 问的时候这条已经有几问（文件里有了第 at+1 问就不再画这一问） */
  at: number
  q: string
  mats?: Material[]
  a: string
  running: boolean
  error?: string
  written?: boolean
}

interface MemSide {
  quote: string
  turns: { q: string; a: string }[]
}

interface State {
  open: Open | null
  pend: Pend[]
  mem: Record<string, MemSide[]>
  /** 刚收起的那一句（那句闪一下） */
  flash: { host: string; key: string; seq: number } | null
  /** 打开、切过来的那一下光标进旁支的输入框 */
  focus: boolean
  /** 改了名字：重画 */
  named: number
}

let st: State = { open: null, pend: [], mem: {}, flash: null, focus: false, named: 0 }
const subs = new Set<() => void>()
function set(next: Partial<State>) {
  st = { ...st, ...next }
  subs.forEach((f) => f())
}
const useStore = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => st,
  )

let freshSeq = 0
let flashSeq = 0
let askSeq = Date.now() * 10 + 5
let listening = false

/** 这一句的编号（小标、虚线上的 data-side）：那一句原文的短指纹 */
function keyOf(quote: string): string {
  const s = foldQuote(quote)
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return 'q' + (h >>> 0).toString(36)
}

const sideIdOf = (quote: string, first: string) => `f:${foldQuote(quote)}\u0001${first}`
const freshId = (n: number) => `n:${n}`

/**
 * 那一篇现在的文字：编辑器开着就是编辑器里的（每次画的时候读），没开着读文件（旁支写进去以后再读一次）；path 是 null 给空串
 */
export function useFileText(path: string | null): string {
  const s = useStore()
  const [disk, setDisk] = useState<{ path: string; text: string } | null>(null)
  const doc = path ? [...NoteDoc.open].find((d) => d.path === path) : undefined
  useEffect(() => {
    if (!path || doc) return
    let live = true
    void window.cn.readNote(path).then((r) => live && setDisk({ path, text: r.text }))
    return () => {
      live = false
    }
  }, [path, !!doc, s.pend])
  if (!path) return ''
  if (doc) return doc.text
  return disk?.path === path ? disk.text : ''
}

/** 收起：那句闪一下；没问过的空旁支不留 */
export function closeFileSide() {
  const o = st.open
  if (!o) return
  set({ open: null, flash: { host: o.host, key: keyOf(o.quote), seq: ++flashSeq }, pend: st.pend.filter((p) => !(p.written && !p.running)) })
}

/** 开着的那条旁支在哪一处（没开着是 null） */
export function useFileSideHost(): string | null {
  return useStore().open?.host ?? null
}

/**
 * 写进那一篇：编辑器开着就改编辑器（不进撤销，软件写的，同文档里的旁支），没开着先比后写进文件（改过就照新的再算一次）
 */
async function editFile(path: string, edit: (text: string) => { from: number; to: number; insert: string } | null): Promise<boolean> {
  const d = [...NoteDoc.open].find((x) => x.path === path)
  if (d) {
    if (d.readOnly) return false
    const c = edit(d.view.state.doc.toString())
    if (!c) return false
    d.view.dispatch({ changes: c, annotations: [hiddenOk.of(true), Transaction.addToHistory.of(false)], userEvent: 'input.side' })
    return true
  }
  for (let i = 0; i < 2; i++) {
    const cur = (await window.cn.readNote(path)).text
    const c = edit(cur)
    if (!c) return false
    const r = await window.cn.writeNote(path, cur.slice(0, c.from) + c.insert + cur.slice(c.to), cur)
    if (r.ok) return true
  }
  return false
}

/** 这一处的旁支（文件里的，或者只问不记的） */
function sidesOf(spot: Spot, b: DocAiBlock | null): MemSide[] {
  if (!spot.path) return st.mem[spot.host] ?? []
  return b?.sides.map((s) => ({ quote: s.quote, turns: s.turns })) ?? []
}

/** 问：交给 ai:side，答好了写进那块讲解下面（新开的写在最后，接着问的写在那条最后一块后面） */
async function send(spot: Spot, open: Open, text: string, mats: Material[], how: { engine: AiPick['engine']; req: { model?: string; effort?: string } }) {
  const b = spot.path ? spot.find(spot.text) : null
  if (spot.path && !b) return app().notice(tNow('那段讲解不在了'))
  const side = open.first !== null ? sidesOf(spot, b).find((s) => foldQuote(s.quote) === foldQuote(open.quote) && s.turns[0]?.q === open.first) : undefined
  const done = side?.turns ?? []
  const mine = (p: Pend) => p.host === open.host && (open.first !== null ? p.first === open.first && foldQuote(p.quote) === foldQuote(open.quote) : p.first === null && p.fresh === open.fresh)
  if (st.pend.some((p) => mine(p) && p.running)) return
  const q = text.trim() || (done.length || st.pend.some((p) => mine(p) && !p.error) ? '' : tNow(ASK_THIS))
  if (!q) return
  if (!listening) {
    listening = true
    window.cn.onAiEvent((id, e) => {
      if (e.type !== 'text' || !st.pend.some((p) => p.id === id)) return
      set({ pend: st.pend.map((p) => (p.id === id ? { ...p, a: p.a + e.delta } : p)) })
    })
  }
  const id = ++askSeq
  const pend: Pend = { id, host: open.host, quote: open.quote, first: open.first, fresh: open.fresh, at: done.length, q, ...(mats.length ? { mats } : {}), a: '', running: true }
  set({ pend: [...st.pend.filter((p) => !(mine(p) && p.error)), pend] })
  const res = await askSide({
    id,
    path: spot.path ?? `问框:${spot.host}`, // 不翻：只问不记的那一份的名字（会话、旁支名认它）
    title: spot.title,
    text: spot.path ? spot.text : '',
    block: b ?? { head: -1, end: -1, paras: [], sides: [], tail: null },
    quote: open.quote,
    q,
    done,
    ...(spot.lead ? { lead: spot.lead } : {}),
    ...(spot.path ? {} : { body: spot.body ?? '' }),
    where: spot.where,
    mats,
    how,
  })
  const now = st.pend.find((p) => p.id === id)
  const answer = (res.text || now?.a || '').trim()
  const fail = (error: string) => set({ pend: st.pend.map((p) => (p.id === id ? { ...p, running: false, error } : p)) })
  if (res.error || !answer) return fail(res.error ?? tNow('没有回答'))
  const target = open.first !== null ? { quote: open.quote, first: open.first } : null
  // 新开的一条答好了：它的第一问就是这一问（开着的那条、在答的接着问跟着认它）
  const named = (o: Open | null) => (o && o.first === null && o.fresh === open.fresh && o.host === open.host ? { ...o, first: q } : o)
  if (!spot.path) {
    const list = [...(st.mem[spot.host] ?? [])]
    const i = target ? list.findIndex((s) => foldQuote(s.quote) === foldQuote(target.quote) && s.turns[0]?.q === target.first) : -1
    if (i >= 0) list[i] = { ...list[i]!, turns: [...list[i]!.turns, { q, a: answer }] }
    else list.push({ quote: open.quote, turns: [{ q, a: answer }] })
    set({ mem: { ...st.mem, [spot.host]: list }, pend: st.pend.filter((p) => p.id !== id), open: named(st.open) })
    return
  }
  const ok = await editFile(spot.path, (t) => {
    const blk = spot.find(t)
    if (!blk) return null
    const ins = sideInsert(t, blk, sideIndex(blk, target), { q, a: answer }, open.quote)
    return { from: ins.at, to: ins.at, insert: ins.insert }
  })
  if (!ok) return fail(tNow('那段讲解不在了，这条回答没写进去'))
  set({ pend: st.pend.map((p) => (p.id === id ? { ...p, running: false, written: true, first: p.first ?? q } : p.first === null && p.fresh === open.fresh && p.host === open.host ? { ...p, first: q } : p)), open: named(st.open) })
}

// ---------------------------------------------------------------- 画：排好的回答 + 问过的那句 + 小框 + 开着的那一块

/**
 * 一段排好的 AI 讲解（白板卡、问框里的回答）：问过的那句划点线、后面一个小标；选一句出小框；开着的旁支长在那一段下面。
 * className 给外面那一格（白板卡的 db-md、问框的 ak-tx md）；closedClass 只在没开着旁支时加（白板卡只露五行）
 */
export function SideText(p: { spot: Spot; md: string; className?: string; closedClass?: string; testid?: string }): ReactNode {
  const t = useT()
  const { spot } = p
  const s = useStore()
  const root = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ cx: number; top: number; bottom: number; plain: string; seq: number } | null>(null)
  const b = spot.path ? spot.find(spot.text) : null
  const sides = sidesOf(spot, b)
  const open = s.open?.host === spot.host ? s.open : null
  const hostId = useRef(spot.host)
  hostId.current = spot.host
  // 这一处没了（白板切回文档、问框关了）：开着的旁支跟着收起
  useEffect(
    () => () => {
      if (st.open?.host === hostId.current) set({ open: null })
    },
    [],
  )

  // 一句一组（按开的先后），开着的那条新开的也算进它那一句
  const groups = useMemo(() => {
    const out: { key: string; quote: string; ids: string[]; names: { first: string | null; fresh: number }[] }[] = []
    const add = (quote: string, id: string, who: { first: string | null; fresh: number }) => {
      const k = keyOf(quote)
      const g = out.find((x) => x.key === k)
      if (g) {
        if (!g.ids.includes(id)) (g.ids.push(id), g.names.push(who))
      } else out.push({ key: k, quote, ids: [id], names: [who] })
    }
    for (const x of sides) if (x.turns[0]) add(x.quote, sideIdOf(x.quote, x.turns[0].q), { first: x.turns[0].q, fresh: 0 })
    // 写进去了、文件里还没看到的那一问（编辑器的字下一下才到这里）
    for (const x of s.pend) if (x.host === spot.host && x.first !== null) add(x.quote, sideIdOf(x.quote, x.first), { first: x.first, fresh: 0 })
    if (open && open.first === null) add(open.quote, freshId(open.fresh), { first: null, fresh: open.fresh })
    return out
  }, [sides, s.pend, open, spot.host])

  const curId = open ? (open.first !== null ? sideIdOf(open.quote, open.first) : freshId(open.fresh)) : null
  const marks: Mark[] = groups.map((g) => ({ side: g.key, quote: mdPlain(g.quote), n: g.ids.length, title: t('这句有 {n} 条旁支', { n: g.ids.length }), cur: !!curId && g.ids.includes(curId) }))
  const sig = JSON.stringify(marks)
  // 讲解卡、问框的回答：没写成链接的路径、笔记名也认（task-3e53q）；「不是这篇」记在这一处上
  const conv = `side:${spot.path ?? spot.host}`
  const mdEl = useMemo(() => <Markdown text={p.md} cites={{ conv }} />, [p.md, conv])
  const citeSig = useCiteSig(conv)

  // 划那几句（回答一变、认出来的链接一变整块换掉：key 是回答的字 + 链接的指纹）
  useLayoutEffect(() => {
    if (!root.current) return
    return applyMarks(root.current, JSON.parse(sig) as Mark[])
  }, [sig, p.md, citeSig])

  // 开着的那一条挂在那句所在的那一段后面（找不到那句挂在最后）
  const host = useMemo(() => {
    const d = document.createElement('div')
    d.className = 'side-host'
    return d
  }, [])
  useLayoutEffect(() => {
    const r = root.current
    if (!open || !r) return void host.remove()
    const md = r.querySelector('.md') ?? r
    const spans = r.querySelectorAll(`.asked[data-side="${CSS.escape(keyOf(open.quote))}"]`)
    const last = spans[spans.length - 1]
    const anchor = last ? blockOf(last, md) : [...md.children].filter((e) => e !== host).pop()
    if (!anchor) md.appendChild(host)
    else if (anchor.nextSibling !== host) anchor.after(host)
  })
  useEffect(() => () => host.remove(), [host])

  // 刚收起的那一句闪一下
  const seen = useRef(0)
  useEffect(() => {
    const f = s.flash
    if (!f || f.host !== spot.host || f.seq === seen.current) return
    seen.current = f.seq
    requestAnimationFrame(() => flashMark(root.current, f.key))
  }, [s.flash, spot.host])

  // ⇧⌘L：选区在这段讲解里就直接引用
  const quoteRef = useRef(spot.onQuote)
  quoteRef.current = spot.onQuote
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.isComposing || !isKey(e, 'quote')) return
      const sel = selected()
      if (!sel) return
      e.preventDefault()
      e.stopPropagation()
      window.getSelection()?.removeAllRanges()
      setBox(null)
      quoteRef.current(sel.plain)
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [])

  /** 选区整个在这段讲解的字里（开着的旁支那一块里的不算）；bottom 是选中高亮的下沿（小框离它 8） */
  function selected(): { plain: string; rect: DOMRect; top: number; bottom: number } | null {
    const sel = window.getSelection()
    const r = root.current
    if (!r || !sel || sel.isCollapsed || !sel.rangeCount) return null
    const el = (n: Node | null) => (n instanceof Element ? n : (n?.parentElement ?? null))
    const a = el(sel.anchorNode)
    const z = el(sel.focusNode)
    if (!a || !z || !r.contains(a) || !r.contains(z) || a.closest('.side-host') || z.closest('.side-host')) return null
    const range = sel.getRangeAt(0)
    const plain = rangeText(range)
    return plain.length < 2 ? null : { plain, rect: range.getBoundingClientRect(), top: highlightTop(range), bottom: highlightBottom(range) }
  }

  function openSide(o: Open | null) {
    if (o) set({ open: o, focus: true, pend: st.pend.filter((x) => !(x.written && !x.running)) })
    else closeFileSide()
  }

  function ask(plain: string, question: string) {
    const raw = (spot.path && b ? rawQuoteOf(spot.text, b, plain) : null) ?? plain
    const o: Open = { host: spot.host, quote: raw, first: null, fresh: ++freshSeq }
    openSide(o)
    if (question.trim()) void Promise.all([window.cn.aiEngines(), window.cn.aiChatPick(spot.place)]).then(([e, own]) => void send(spot, o, question, [], howOf(e, own)))
  }

  /** 点小标：这一句开着的那条收起；没开着就打开这一句最后开的那条 */
  function toggle(key: string) {
    const g = groups.find((x) => x.key === key)
    if (!g) return
    if (curId && g.ids.includes(curId)) return closeFileSide()
    const who = g.names[g.names.length - 1]!
    openSide({ host: spot.host, quote: g.quote, first: who.first, fresh: who.fresh })
  }

  return (
    <div
      ref={root}
      className={'side-text' + (p.className ? ' ' + p.className : '') + (!open && p.closedClass ? ' ' + p.closedClass : '')}
      data-testid={p.testid}
      onMouseUp={(e) => {
        if ((e.target as Element).closest('.side-host, .badge') || spot.readOnly) return
        setTimeout(() => {
          const sel = selected()
          if (sel) setBox({ cx: sel.rect.left + sel.rect.width / 2, top: sel.top, bottom: sel.bottom, plain: sel.plain, seq: (box?.seq ?? 0) + 1 })
        }, 0)
      }}
      onMouseDown={(e) => {
        // 小标、旁支那一块里按下：不拖卡、不选卡
        if ((e.target as Element).closest('.badge, .side-host')) e.stopPropagation()
      }}
      onDoubleClick={(e) => {
        // 双击选一个词，不是「看全文」
        if (!(e.target as Element).closest('.side-host, .badge')) e.stopPropagation()
      }}
      onClick={(e) => {
        const badge = (e.target as Element).closest<HTMLElement>('.badge[data-side]')
        if (!badge || !root.current?.contains(badge) || badge.closest('.side-host')) return
        e.stopPropagation()
        toggle(badge.dataset.side!)
      }}
      onKeyDown={(e) => {
        const badge = (e.target as Element).closest<HTMLElement>('.badge[data-side]')
        if (!badge || (e.key !== 'Enter' && e.key !== ' ')) return
        e.preventDefault()
        toggle(badge.dataset.side!)
      }}
    >
      <div key={p.md + citeSig} style={{ display: 'contents' }}>
        {mdEl}
      </div>
      {box && (
        <AskBoxView
          key={box.seq}
          at={box}
          sel={box.plain}
          answer={p.md}
          within={root.current?.closest('.db-board, .ak')?.getBoundingClientRect() ?? null}
          onClose={(why) => {
            if (why === 'esc') window.getSelection()?.removeAllRanges()
            setBox(null)
          }}
          onQuote={() => {
            window.getSelection()?.removeAllRanges()
            setBox(null)
            spot.onQuote(box.plain)
          }}
          onAsk={(question) => {
            window.getSelection()?.removeAllRanges()
            setBox(null)
            ask(box.plain, question)
          }}
        />
      )}
      {open && createPortal(<OpenSide spot={spot} sides={sides} groups={groups} open={open} host={host} />, host)}
    </div>
  )
}

const howOf = (e: Awaited<ReturnType<typeof window.cn.aiEngines>>, own: AiPick | null) => {
  // 和文档里的旁支、useConvPick 同一个选法
  const pick = convPick(e.engines, e.chat, own)
  return { engine: pick.engine, req: hasEffort(pick.engine) ? { model: pick.model ?? '', ...(pick.effort ? { effort: pick.effort } : {}) } : {} }
}

/** 开着的那一条（SideInline，和读 PDF、AI 对话、文档里的同一个） */
function OpenSide(p: { spot: Spot; sides: MemSide[]; groups: { key: string; quote: string; ids: string[]; names: { first: string | null; fresh: number }[] }[]; open: Open; host: HTMLElement }) {
  const t = useT()
  const { spot, open } = p
  const s = useStore()
  const [own, setOwn] = useState<AiPick | null>(null)
  useEffect(() => {
    let live = true
    void window.cn.aiChatPick(spot.place).then((x) => live && setOwn(x))
    return () => {
      live = false
    }
  }, [spot.place])
  const cp = useConvPick<AiPick, EngineInfo>(own, (x) => {
    setOwn(x)
    void window.cn.aiChatSetPick(spot.place, x)
  }, (t) => app().notice(t))

  const path = spot.path ?? ''
  /** 第 who 条的问答：文件里的 + 还没写进去（或者写进去了、文件里还没看到）的那几问 */
  const msgsOf = (who: { first: string | null; fresh: number }, quote: string): SideMsgView[] => {
    const side = who.first !== null ? p.sides.find((x) => foldQuote(x.quote) === foldQuote(quote) && x.turns[0]?.q === who.first) : undefined
    const turns = side?.turns ?? []
    const out: SideMsgView[] = []
    let id = 1
    for (const t of turns) {
      out.push({ id: id++, role: 'user', text: t.q })
      out.push({ id: id++, role: 'ai', text: t.a })
    }
    const mine = s.pend.filter((x) => x.host === spot.host && foldQuote(x.quote) === foldQuote(quote) && (who.first !== null ? x.first === who.first : x.first === null && x.fresh === who.fresh))
    for (const x of mine) {
      if (x.written && turns.length > x.at) continue
      out.push({ id: id++, role: 'user', text: x.q, ...(x.mats?.length ? { mats: x.mats } : {}) })
      out.push({ id: id++, role: 'ai', text: x.a, ...(x.error ? { error: x.error } : {}) })
    }
    return out
  }
  const nameOfWho = (who: { first: string | null; fresh: number }, quote: string) =>
    sideName({ name: spot.path ? nameOf(path, quote, who.first ?? undefined) : undefined, quote: mdPlain(quote), msgs: msgsOf(who, quote) })
  const g = p.groups.find((x) => x.key === keyOf(open.quote))
  const me = { first: open.first, fresh: open.fresh }
  const id = open.first !== null ? sideIdOf(open.quote, open.first) : freshId(open.fresh)
  const msgs = msgsOf(me, open.quote)
  const running = s.pend.some((x) => x.host === spot.host && x.running && foldQuote(x.quote) === foldQuote(open.quote) && (open.first !== null ? x.first === open.first : x.first === null && x.fresh === open.fresh))
  const all = p.groups.flatMap((x) => x.names.map((w, i) => ({ id: x.ids[i]!, name: nameOfWho(w, x.quote), right: t('{n} 问', { n: sideAsks({ msgs: msgsOf(w, x.quote) }) }) })))

  return (
    <SideInline
      side={{ id, quote: open.quote, name: nameOfWho(me, open.quote), msgs }}
      group={(g?.names ?? [me]).map((w, i) => ({ id: g?.ids[i] ?? id, name: nameOfWho(w, open.quote) }))}
      running={running}
      record={spot.record}
      dock={spot.dock ?? null}
      {...(spot.replies ? { place: spot.replies } : {})}
      picks={cp.picks}
      onSend={(text, mats) => void send(spot, open, text, mats, { engine: cp.pick.engine, req: cp.req })}
      onStop={() => {
        const x = s.pend.find((y) => y.host === spot.host && y.running && foldQuote(y.quote) === foldQuote(open.quote))
        if (x) void window.cn.aiTurnStop(x.id)
      }}
      onClose={closeFileSide}
      onNew={() => set({ open: { host: spot.host, quote: open.quote, first: null, fresh: ++freshSeq }, focus: true })}
      onSwitch={(to) => {
        for (const x of p.groups) {
          const i = x.ids.indexOf(to)
          if (i >= 0) return set({ open: { host: spot.host, quote: x.quote, first: x.names[i]!.first, fresh: x.names[i]!.fresh }, focus: true })
        }
      }}
      onPut={(text) => {
        app().askAi(text, t('旁支 · {name}', { name: nameOfWho(me, open.quote) }))
        app().notice(t('插进了主对话的输入框，没发'))
      }}
      menu={{
        // 不翻：noun 是讲解块的种类（「讲解」「总结」两个字），比的是身份
        title: spot.path ? (spot.noun === '总结' ? t('这段总结的旁支') : t('这段讲解的旁支')) : t('这个问框的旁支'),
        all: all.some((x) => x.id === id) ? all : [...all, { id, name: nameOfWho(me, open.quote), right: t('{n} 问', { n: 0 }) }],
        onRename: (name) => {
          if (!open.first) return app().notice(t('先问一句，再给这条旁支改名'))
          if (!spot.path) return app().notice(t('只问不记的旁支不能改名'))
          setName(path, open.quote, open.first, name)
          set({ named: st.named + 1 })
        },
        onDelete: () => {
          const first = open.first
          set({ open: null })
          if (first === null) return
          if (!spot.path) {
            const list = (st.mem[spot.host] ?? []).filter((x) => !(foldQuote(x.quote) === foldQuote(open.quote) && x.turns[0]?.q === first))
            return set({ mem: { ...st.mem, [spot.host]: list } })
          }
          setName(path, open.quote, first, '')
          void editFile(path, (t) => {
            const blk = spot.find(t)
            const side = blk?.sides.find((x) => foldQuote(x.quote) === foldQuote(open.quote) && x.turns[0]?.q === first)
            return side ? { ...sideRemove(t, side), insert: '' } : null
          })
        },
      }}
      onNotice={(t) => app().notice(t)}
      // 开、问、出字：外面那一格（问框的回答区、白板）把这一块滚进来，被问的那句留在上面（同 AI 对话里的旁支）
      onGrow={() => showSide(p.host.closest<HTMLElement>('.ak-body, .board-wrap'), p.host, keyOf(open.quote))}
      takeFocus={() => {
        const f = st.focus
        if (f) st = { ...st, focus: false }
        return f
      }}
    />
  )
}
