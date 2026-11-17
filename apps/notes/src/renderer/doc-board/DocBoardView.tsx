/**
 * 文档切到白板（方向 A「先按节摆、再自由」，design：proposals/doc-to-board）：一篇普通文档（没有 type: board）
 * 按 packages/format/src/doc-board.ts 的规则切成列和卡，摆在点阵上。切过去只看，一个字节不写。
 * - 拖一张卡进别的列（或同一列里上下挪）：文档里这段也挪进那一节；
 * - 拖到空白处：这段前面多一行位置，正文顺序不变，卡底一行「在文档『出发前』这一节里」；
 * - 双击看全文、就地改字，「在文档里看」切回文档；勾待办只改那一个字；视频卡、时刻卡点一下在右栏播（时刻从那一秒）；
 * - 每列先摆 6 张（超过 200 张的文档每列 4 张），第 7 节起只留列头；「摆回原样」去掉所有位置行。
 * 每个动作改的是编辑器里的文字，底部提示带「撤回」。⌘Z / ⇧⌘Z 只撤、重做这块白板自己做过的动作（自己记一份），
 * 不撤切白板前在文档里打的字，更不撤别的标签。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { type DocBoard, type DocColumn, type DocUnit, merge3, moveUnit, placeUnit, reconcile, resetLayout, splitDoc, toggleTask } from '@cn/format'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { NoteFile } from '../../shared/api'
import { titleOf } from '../../shared/layout'
import type { BoardZoomApi } from '../BoardView'
import { clampZoom, fitZoom, stepZoom, wheelZoom } from '../board-zoom'
import { CardBody, classify } from '../CardBody'
import { sayMerged, saySameSpot } from '../conflict-say'
import { Markdown } from '../md-render'
import { imageSrc } from '../md-widgets'
import { openVideo } from '../video/actions'
import { videoUrlOfCard } from '../video/BoardCards'
import './doc-board.css'

const COL_W = 272
const PER_COL = 6
const PER_COL_LONG = 4
const OPEN_COLS = 6

export interface DocBoardViewProps {
  text: string
  notePath: string
  notes: NoteFile[]
  readOnly: boolean
  /** 这个标签在前面：⌘Z、⌘+ ⌘− ⌘0 才归这块白板 */
  active: boolean
  /** 画布上真正的比例（用户比例 × 右栏开着时的 0.8）；zoom 是用户比例，和真白板同一套（board-zoom.ts） */
  scale: number
  zoom: number
  onZoom(z: number): void
  /** 标签条「100% ▾」菜单调这里 */
  zoomApi: React.MutableRefObject<BoardZoomApi | null>
  onChange(text: string): void
  /** 「在文档里看」：切到文档，光标放到 pos */
  onOpenDoc(pos: number): void
  /**
   * 「改字」弹层开着时登记一个「把弹层里的字存回去」（关标签、关窗口、退出时叫，和 Esc 一样）；弹层关了登记 null
   */
  onDraft?(flush: (() => void) | null): void
  /** 底栏提示（全软件那条）：弹层是关标签、退出时存回去的，白板自己的提示条跟着标签没了，冲突的话说在这里 */
  onNotice(text: string): void
}

const KIND: Partial<Record<DocUnit['kind'], { icon: CodiconName; label: string }>> = {
  table: { icon: 'table', label: '表格' },
  base: { icon: 'database', label: '数据库' },
  code: { icon: 'code', label: '代码' },
  ask: { icon: 'comment-discussion-sparkle', label: '问过 AI' },
  todo: { icon: 'checklist', label: '待办' },
  images: { icon: 'file-media', label: '图集' },
}

/** 卡头那一行：带东西的卡写种类和数量 */
function headOf(u: DocUnit): string | null {
  const k = KIND[u.kind]
  if (!k) return null
  const lines = u.text.split('\n')
  if (u.kind === 'table') return `${k.label} · ${Math.max(0, lines.filter((l) => l.trim().startsWith('|')).length - 2)}行`
  if (u.kind === 'code') return `${k.label} · ${/^(?:```|~~~)(\S*)/.exec(u.text.trimStart())?.[1] || ''} ${Math.max(0, lines.length - 2)}行`.replace('  ', ' ')
  if (u.kind === 'todo') {
    const all = lines.filter((l) => /^\s*[-*] \[( |x|X)\]/.test(l))
    return `${k.label} · ${all.filter((l) => /\[(x|X)\]/.test(l)).length}/${all.length}`
  }
  if (u.kind === 'images') return `${k.label} · ${(u.text.match(/!\[/g) ?? []).length}张`
  if (u.kind === 'base') return `${k.label} · ${/inFolder\("([^"]+)"\)/.exec(u.text)?.[1]?.split('/').pop() ?? ''}`
  return k.label
}

function Preview(props: { u: DocUnit; notePath: string; notes: NoteFile[]; onToggle(line: number): void }) {
  const { u } = props
  // 视频、时刻、待办（能勾）、图片、带出处的引文：白板卡片同一套（CardBody，行内写法也走 md-render 的 inline）
  if (cardBodyKind(u, props.notes)) {
    const main = u.kind === 'video' && u.moments ? u.text.slice(0, u.moments[0]!.from - u.from).trimEnd() : u.text
    return (
      <>
        <CardBody text={main} info={classify(main, props.notes)} notes={props.notes} notePath={props.notePath} onToggle={props.onToggle} />
        {u.moments?.map((m) => (
          <div key={m.from} className="db-moment" data-url={videoUrlOfCard(m.text)?.url}>
            <CardBody text={m.text} info={{ kind: 'moment' }} notes={props.notes} notePath={props.notePath} small onToggle={() => undefined} />
          </div>
        ))}
      </>
    )
  }
  if (u.kind === 'images') {
    const imgs = [...u.text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)]
    return (
      <div className="db-images">
        {imgs.slice(0, 4).map((m, i) => (
          <img key={i} src={imageSrc(props.notePath, m[2]!)} alt={m[1]} draggable={false} />
        ))}
      </div>
    )
  }
  if (u.kind === 'base') return <div className="db-note">表格嵌在文档里：双击看全文，整页打开在文档里点「整页打开」</div>
  // 其余（段落、列表、引文、提示块、折叠块整块、表格、代码、问答）：和文档、AI 回答同一套 md 显示，长的只露一截
  let text = u.text
  if (u.kind === 'ask') text = text.replace(/^##\s*/, '### ')
  if (u.kind === 'table') text = text.split('\n').filter((l) => l.trim()).slice(0, 6).join('\n')
  if (u.kind === 'code') {
    const lines = text.split('\n')
    text = [lines[0], ...lines.slice(1, -1).slice(0, 8), lines[lines.length - 1]].join('\n')
  }
  return (
    <div className={'db-md' + (u.kind === 'table' ? ' tbl' : '')}>
      <Markdown text={text} />
    </div>
  )
}

/** 交给 CardBody 画的几种 */
function cardBodyKind(u: DocUnit, notes: NoteFile[]): boolean {
  if (u.kind === 'video' || u.kind === 'moment' || u.kind === 'todo' || u.kind === 'image') return true
  return u.kind === 'quote' && classify(u.text, notes).kind === 'clip'
}

type Drag = { unit: DocUnit; start: { x: number; y: number }; grab: { x: number; y: number }; moved: boolean; at: { x: number; y: number }; w: number }

export function DocBoardView(props: DocBoardViewProps) {
  const { text } = props
  const board: DocBoard = useMemo(() => splitDoc(text), [text])
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [more, setMore] = useState<Set<number>>(new Set())
  const [drag, setDrag] = useState<Drag | null>(null)
  const [drop, setDrop] = useState<{ col: number; before: number } | null>(null)
  /** 双击看全文的那张卡，和打开时的全文（改字存回时拿它当三方合并的底） */
  const [full, setFull] = useState<{ unit: DocUnit; base: string } | null>(null)
  /** 底部提示：undo 为真时带「撤回」（撤回、撤不回之后的那句不带） */
  const [toast, setToastState] = useState<{ text: string; undo: boolean } | null>(null)
  const setToast = (t: string | null, undo = true) => setToastState(t === null ? null : { text: t, undo })
  const plane = useRef<HTMLDivElement>(null)
  const per = board.total > 200 ? PER_COL_LONG : PER_COL

  /** 这块白板做过的动作：改前、改后的全文。撤的时候文档已经不是「改后」（别处改过）就不撤了，免得把别的改动一起撤掉 */
  const done = useRef<{ before: string; after: string }[]>([])
  const undone = useRef<{ before: string; after: string }[]>([])
  /** 编辑器里现在的全文：连按 ⌘Z 时 props.text 可能还没跟上 */
  const cur = useRef(text)
  cur.current = text
  const apply = (next: string) => {
    props.onChange(next)
    cur.current = next
  }
  const write = (next: string, what: string) => {
    if (props.readOnly || next === text) return
    done.current.push({ before: text, after: next })
    undone.current = []
    apply(next)
    setToast(what)
  }
  /**
   * 撤回 / 重做一步。白板以外改过这篇（文档里、外部同步）时，按现在的全文三方合并着撤：只撤这一步改的那几行，
   * 别处的改动留着；撤的那几行也被别处改过、合不了，就说清楚撤不回，不假装撤好了。返回说给人听的一句。
   */
  const step = (redo: boolean): string | null => {
    const from = redo ? undone : done
    const to = redo ? done : undone
    const s = from.current.pop()
    if (!s) return null
    const was = redo ? s.before : s.after
    const want = redo ? s.after : s.before
    const now = cur.current
    const m = now === was ? { text: want, conflict: false } : merge3(was, want, now)
    if (m.conflict) {
      done.current = []
      undone.current = []
      return '文件在外面改过，这一步撤不回了'
    }
    apply(m.text)
    to.current.push(redo ? { before: now, after: m.text } : { before: m.text, after: now })
    return redo ? '重做了这一步' : '撤回了这一步'
  }
  const stepRef = useRef(step)
  stepRef.current = step
  const setToastRef = useRef(setToast)
  setToastRef.current = setToast
  // ⌘Z / ⇧⌘Z：在这块白板上一律拦下（不交给浏览器自带的撤销，它会撤到别的标签去）；改字框里照常撤字
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey || e.key.toLowerCase() !== 'z') return
      const field = (e.target as HTMLElement | null)?.closest?.('input, textarea, [contenteditable="true"]')
      if (field?.checkVisibility()) return
      e.preventDefault()
      e.stopPropagation()
      if (props.readOnly) return
      const said = stepRef.current(e.shiftKey)
      // 撤回、重做之后底部那句跟着换，不再挂着上一个动作的「撤回」
      if (said) setToastRef.current(said, false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props.active, props.readOnly])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])

  const replaceUnit = (u: DocUnit, body: string, what: string) => write(text.slice(0, u.from) + body + text.slice(u.to), what)
  /**
   * 改字框存回：卡的位置是打开框时那份全文里的，框开着时外面（同步盘、手机、AI）可能改过这篇。
   * 和文档编辑器同一套三方合并（@cn/format reconcile）：底 = 打开时的全文，我的 = 底里换掉这张卡，外面的 = 现在的全文。
   * 改的不是一处就合起来；改了同一段就留我的版本写进文件，外面那版另存成冲突副本并提示（外部改动不丢正在打的字）。
   */
  const saveCard = (f: { unit: DocUnit; base: string }, body: string, closing = false) => {
    const mine = f.base.slice(0, f.unit.from) + body + f.base.slice(f.unit.to)
    if (text === f.base) return write(mine, '改好了')
    const r = reconcile(f.base, mine, text)
    if (r.kind === 'none') return
    if (r.kind === 'update') return write(r.text, sayMerged(props.notePath))
    const theirs = text
    // 同一段留我的；外面在别的段落改的照样合进来（以前整篇写成我的，别处的外部改动只在冲突副本里）
    const others = r.text !== mine
    write(r.text, saySameSpot(props.notePath, others, null))
    // 关标签、退出时存回的：白板连着提示条一起收起，改说在底栏
    const say = (t: string, undo: boolean) => (closing ? props.onNotice(t) : setToast(t, undo))
    void window.cn.saveConflictCopy(props.notePath, theirs).then(
      (copy) => say(saySameSpot(props.notePath, others, { path: copy }), true),
      (e) => say(saySameSpot(props.notePath, others, { error: String((e as Error).message ?? e) }), false),
    )
  }
  /** 弹层里现在的字（FullCard 打字时更新） */
  const fullBody = useRef<string | null>(null)
  const saveCardRef = useRef(saveCard)
  saveCardRef.current = saveCard
  const onDraftRef = useRef(props.onDraft)
  onDraftRef.current = props.onDraft
  useEffect(() => {
    if (!full) return
    fullBody.current = full.unit.text
    onDraftRef.current?.(() => {
      const body = fullBody.current
      if (body !== null && body !== full.unit.text) saveCardRef.current(full, body, true)
      setFull(null)
    })
    return () => onDraftRef.current?.(null)
  }, [full])
  const toggle = (u: DocUnit, line: number) => {
    const lines = u.text.split('\n')
    const l = lines[line]
    if (l === undefined) return
    lines[line] = toggleTask(l)
    replaceUnit(u, lines.join('\n'), '勾好了')
  }

  // ----- 缩放（和真白板一样：⌘+ ⌘− ⌘0 ⇧⌘1、捏合、按住 ⌘ 滚轮、标签条菜单；以鼠标或画面正中为中心）-----
  const wrap = useRef<HTMLDivElement>(null)
  const factor = props.zoom > 0 ? props.scale / props.zoom : 1
  const liveZoom = useRef(props.zoom)
  const pendingScroll = useRef<{ left: number; top: number } | null>(null)
  const zoomTo = (next: number, anchor?: { x: number; y: number }) => {
    const w = wrap.current
    const z = clampZoom(next)
    if (!w || z === liveZoom.current) return
    const oldS = liveZoom.current * factor
    const newS = z * factor
    const r = w.getBoundingClientRect()
    const ax = anchor ? anchor.x - r.left : w.clientWidth / 2
    const ay = anchor ? anchor.y - r.top : w.clientHeight / 2
    const from = pendingScroll.current ?? { left: w.scrollLeft, top: w.scrollTop }
    pendingScroll.current = { left: ((from.left + ax) / oldS) * newS - ax, top: ((from.top + ay) / oldS) * newS - ay }
    liveZoom.current = z
    props.onZoom(z)
  }
  /** 适合窗口：所有列和单独摆的卡整个放进画面 */
  const fit = () => {
    const w = wrap.current
    const p = plane.current
    if (!w || !p) return
    const base = p.getBoundingClientRect()
    const rs = [...p.querySelectorAll<HTMLElement>('.db-col, .db-card.placed')].map((el) => el.getBoundingClientRect())
    const s0 = props.scale
    const box = rs.length
      ? (() => {
          const x = Math.min(...rs.map((r) => r.left - base.left)) / s0
          const y = Math.min(...rs.map((r) => r.top - base.top)) / s0
          return { x, y, w: Math.max(...rs.map((r) => r.right - base.left)) / s0 - x, h: Math.max(...rs.map((r) => r.bottom - base.top)) / s0 - y }
        })()
      : null
    const z = fitZoom(box, { w: w.clientWidth, h: w.clientHeight }, factor)
    const s = z * factor
    const to = box ? { left: Math.max(0, (box.x - 40) * s), top: Math.max(0, (box.y - 40) * s) } : { left: 0, top: 0 }
    if (z === liveZoom.current) return void ((w.scrollLeft = to.left), (w.scrollTop = to.top))
    pendingScroll.current = to
    liveZoom.current = z
    props.onZoom(z)
  }
  const zoomRef = useRef({ zoomTo, fit })
  zoomRef.current = { zoomTo, fit }
  props.zoomApi.current = { step: (d) => zoomTo(stepZoom(liveZoom.current, d)), set: (z) => zoomTo(z), fit }
  useLayoutEffect(() => {
    liveZoom.current = props.zoom
    const p = pendingScroll.current
    pendingScroll.current = null
    if (p && wrap.current) {
      wrap.current.scrollLeft = p.left
      wrap.current.scrollTop = p.top
    }
  }, [props.scale, props.zoom])
  useEffect(() => {
    const w = wrap.current
    if (!w) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      zoomRef.current.zoomTo(wheelZoom(liveZoom.current, e.deltaY), { x: e.clientX, y: e.clientY })
    }
    w.addEventListener('wheel', onWheel, { passive: false })
    return () => w.removeEventListener('wheel', onWheel)
  }, [])
  // ⌘+ / ⌘− / ⌘0 / ⇧⌘1：拦住，不然软件菜单把整个窗口缩放了；改字框里不管
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey) return
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea')) return
      const z = zoomRef.current
      if (e.key === '=' || e.key === '+') z.zoomTo(stepZoom(liveZoom.current, 1))
      else if (e.key === '-' || e.key === '_') z.zoomTo(stepZoom(liveZoom.current, -1))
      else if (e.key === '0' && !e.shiftKey) z.zoomTo(1)
      else if (e.code === 'Digit1' && e.shiftKey) z.fit()
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [props.active])

  // ----- 拖 -----
  const planeXY = (cx: number, cy: number) => {
    const r = plane.current!.getBoundingClientRect()
    return { x: (cx - r.left) / props.scale, y: (cy - r.top) / props.scale }
  }
  const onDown = (e: React.MouseEvent, u: DocUnit) => {
    if (e.button !== 0 || props.readOnly) return
    if ((e.target as HTMLElement).closest('input, button, a, .play, .db-moment, .cb-moment')) return
    const card = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setDrag({ unit: u, start: { x: e.clientX, y: e.clientY }, grab: { x: e.clientX - card.left, y: e.clientY - card.top }, moved: false, at: { x: e.clientX, y: e.clientY }, w: card.width })
  }
  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent) => {
      const moved = drag.moved || Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) > 4
      setDrag({ ...drag, moved, at: { x: e.clientX, y: e.clientY } })
      if (!moved) return
      // 落在哪一列、插到第几张前面
      const colEl = (document.elementsFromPoint(e.clientX, e.clientY) as HTMLElement[]).find((el) => el.classList?.contains('db-col'))
      if (!colEl || colEl.dataset.ask === '1') return setDrop(null)
      const ci = Number(colEl.dataset.col)
      const cards = [...colEl.querySelectorAll<HTMLElement>('.db-card[data-i]')].filter((c) => !c.classList.contains('dragging'))
      const i = cards.find((c) => e.clientY < c.getBoundingClientRect().top + c.getBoundingClientRect().height / 2)
      setDrop({ col: ci, before: i ? Number(i.dataset.i) : -1 })
    }
    const up = (e: MouseEvent) => {
      const d = drag
      const target = drop
      setDrag(null)
      setDrop(null)
      if (!d.moved) return
      try {
        if (target) {
          const col = board.columns[target.col]!
          const before = target.before >= 0 ? col.cards[target.before]! : null
          if (before && before.from === d.unit.from) return
          write(moveUnit(text, d.unit, col, before), `挪进了「${col.title ?? '开头'}」，文档里这段也挪过去了`)
        } else {
          const p = planeXY(e.clientX - d.grab.x, e.clientY - d.grab.y)
          write(placeUnit(text, d.unit, Math.max(0, p.x), Math.max(0, p.y)), '单独摆在这里：文档里只多一行位置，正文顺序不变')
        }
      } catch (err) {
        setToast(String((err as Error).message), false)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => (window.removeEventListener('mousemove', move), window.removeEventListener('mouseup', up))
  }, [drag, drop, text])

  // 视频卡、时刻卡：点一下在右栏播（时刻从那一秒）
  const onClick = (e: React.MouseEvent, u: DocUnit) => {
    const t = e.target as HTMLElement
    const m = t.closest<HTMLElement>('.db-moment')
    if (m?.dataset.url) return void openVideo(m.dataset.url)
    if (u.kind === 'moment' || (u.kind === 'video' && t.closest('.play, .cover'))) {
      const v = videoUrlOfCard(u.kind === 'video' && u.moments ? u.text.slice(0, u.moments[0]!.from - u.from) : u.text)
      if (v) void openVideo(v.url, v.resume)
    }
  }

  const card = (u: DocUnit, i: number, ci: number, extra?: { style?: React.CSSProperties; section?: string | null }) => {
    if (u.kind === 'gap') return <div key={'g' + u.from} className="db-gap" />
    const head = headOf(u)
    const dragging = drag?.moved && drag.unit.from === u.from
    // 交给 CardBody 画的几种，用白板卡片同一套样子（.bcard.k-*：内边距、引文竖线、来源行）
    const k = cardBodyKind(u, props.notes) ? classify(u.kind === 'video' && u.moments ? u.text.slice(0, u.moments[0]!.from - u.from) : u.text, props.notes).kind : 'note'
    return (
      <div key={u.from} className="db-sub-wrap">
        {u.sub && <div className="db-sub">{u.sub}</div>}
        {drop && drop.col === ci && drop.before === i && <div className="db-drop" />}
        <div
          className={`db-card bcard incol k-${k}` + (u.kind === 'quote' || u.kind === 'ask' ? ' clip' : '') + (u.kind === 'callout' ? ' db-callout' : '') + (dragging ? ' dragging' : '') + (u.place ? ' placed' : '')}
          data-i={i}
          data-kind={u.kind}
          style={extra?.style}
          onMouseDown={(e) => onDown(e, u)}
          onClick={(e) => onClick(e, u)}
          onDoubleClick={(e) => !(e.target as HTMLElement).closest('input, button') && setFull({ unit: u, base: text })}
        >
          {head && (
            <div className="db-head">
              <Codicon name={KIND[u.kind]!.icon} size={12} />
              <span>{head}</span>
            </div>
          )}
          <div className="db-body">
            <Preview u={u} notePath={props.notePath} notes={props.notes} onToggle={(line) => toggle(u, line)} />
          </div>
          {extra?.section !== undefined && <div className="db-where">在文档『{extra.section ?? '开头'}』这一节里</div>}
        </div>
      </div>
    )
  }

  const column = (c: DocColumn, ci: number) => {
    const folded = ci >= OPEN_COLS && !open.has(ci)
    const cards = c.cards.filter((u) => u.kind !== 'gap')
    const showAll = more.has(ci)
    let shown = 0
    return (
      <section key={ci} className={'db-col' + (c.title === null ? ' bare' : '') + (drop?.col === ci ? ' drop' : '')} data-col={ci} data-ask={c.ask ? '1' : '0'} aria-label={c.title ?? '开头'}>
        {c.title !== null && (
          <h3 onClick={() => folded && setOpen(new Set(open).add(ci))}>
            {c.ask && <Codicon name="comment-discussion-sparkle" size={14} />}
            <span className="truncate">{c.title}</span>
            <span className="meta">{`${cards.length}张`}</span>
          </h3>
        )}
        {!folded &&
          c.cards.map((u, i) => {
            if (u.kind !== 'gap' && !showAll && shown >= per) return null
            if (u.kind !== 'gap') shown++
            return card(u, i, ci)
          })}
        {!folded && drop?.col === ci && drop.before === -1 && <div className="db-drop" />}
        {!folded && !showAll && cards.length > per && (
          <button type="button" className="db-more" onClick={() => setMore(new Set(more).add(ci))}>
            {`还有${cards.length - per}张，点开`}
          </button>
        )}
        {folded && (
          <button type="button" className="db-more" onClick={() => setOpen(new Set(open).add(ci))}>
            展开这一节
          </button>
        )}
      </section>
    )
  }

  const ghost = drag?.moved ? (
    <div className="db-ghost" style={{ left: drag.at.x - drag.grab.x, top: drag.at.y - drag.grab.y, width: drag.w }}>
      {drag.unit.text.replace(/^[#>\-*\s]+/, '').split('\n')[0]!.slice(0, 40)}
    </div>
  ) : null

  return (
    <div className="board db-board" data-testid="doc-board">
      <div className="board-wrap" ref={wrap}>
        <div className="db-plane" ref={plane} style={{ zoom: props.scale }}>
          <div className="db-cols">{board.columns.map(column)}</div>
          {board.placed.map((u) => card(u, -1, -1, { style: { position: 'absolute', left: u.place!.x, top: u.place!.y, width: COL_W }, section: u.section }))}
        </div>
      </div>
      <div className="db-tools">
        <span>
          {`${board.columns.length}列 · ${board.total}张`}
        </span>
        {board.placed.length > 0 && (
          <button type="button" className="btn" onClick={() => write(resetLayout(text), '摆回原样了：去掉了位置行，全部按节摆')}>
            <Codicon name="discard" size={14} />
            摆回原样
          </button>
        )}
      </div>
      {ghost}
      {toast && (
        <div className="db-toast" role="status">
          <span title={toast.text}>{toast.text}</span>
          {toast.undo && (
            <button type="button" onClick={() => setToast(step(false), false)}>
              撤回
            </button>
          )}
        </div>
      )}
      {full && <FullCard unit={full.unit} {...props} bodyRef={fullBody} onClose={() => setFull(null)} onSave={(body) => (saveCard(full, body), setFull(null))} />}
    </div>
  )
}

/**
 * 双击看全文：白板正中，里面能直接改字；右上「在文档里看」；Esc、点外面、关掉都一样：改过的字存下（想放弃按 ⌘Z），没改就直接关
 */
function FullCard(props: DocBoardViewProps & { unit: DocUnit; bodyRef: React.MutableRefObject<string | null>; onClose(): void; onSave(body: string): void }) {
  const [body, setBody] = useState(props.unit.text)
  const [editing, setEditing] = useState(false)
  const bodyNow = useRef(body)
  bodyNow.current = body
  props.bodyRef.current = body
  const close = () => (bodyNow.current !== props.unit.text ? props.onSave(bodyNow.current) : props.onClose())
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !e.isComposing && (e.preventDefault(), e.stopPropagation(), closeRef.current())
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [])
  return (
    <div className="db-full-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="db-full" role="dialog" aria-label="全文">
        <div className="db-full-hd">
          <span className="sp" />
          {!props.readOnly && !editing && (
            <button type="button" className="db-btn" onClick={() => setEditing(true)}>
              <Codicon name="edit" size={14} />
              改字
            </button>
          )}
          <button type="button" className="db-btn" onClick={() => (close(), props.onOpenDoc(props.unit.from))}>
            <Codicon name="file-text" size={14} />
            在文档里看
          </button>
          <button type="button" className="db-btn" aria-label="关掉" onClick={close}>
            <Codicon name="close" size={14} />
          </button>
        </div>
        {editing ? (
          <>
            <textarea aria-label="这张卡的原文" value={body} autoFocus onChange={(e) => setBody(e.currentTarget.value)} />
            <div className="db-full-ft">
              <button type="button" className="btn" onClick={() => props.onSave(body)}>
                存好
              </button>
            </div>
          </>
        ) : (
          <div className="db-full-body">
            <Markdown text={props.unit.text} />
          </div>
        )}
      </div>
    </div>
  )
}
