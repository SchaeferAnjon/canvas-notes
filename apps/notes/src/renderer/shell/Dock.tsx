/**
 * 工作区「拖到哪就在哪」（2026-11-20 方向 A，原型 design/workspace/proto-a.html，DESIGN.v3 1.9）：画右边几栏的头、空身子和浮窗，
 * 管拖：拖标签（落点：上半、下半、左右并排、叠成标签；中间内容的左右两边、浮起来）、拖整栏（组头的空处、中间标签条的空处）、
 * 拖浮窗、拉浮窗的角、拖栏和组之间的缝。布局怎么变在 shared/dock.ts。
 *
 * 五样的内容（网页、笔记、AI、大纲、历史）不在这里画：App 把它们一直挂在 .win 下面（.dview[data-view]），这里量着每组身子（.dbody）的位置摆上去，
 * 挪来挪去不重新挂（网页的 webview、AI 正在答的那一轮都不断）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import * as D from '../../shared/dock'
import { WebFoldButton } from '../web/WebFoldButton'
import { MenuItem, Popover } from './Shell'
import { CENTER_MIN } from './SideSash'
import './dock.css'

const ICON: Record<Exclude<D.ViewId, 'ai' | 'aicol'>, CodiconName> = { web: 'globe', note: 'note', outline: 'list-tree', history: 'history', record: 'file', auto: 'symbol-event' }
/** AI 和数据库 AI 列的标签画正在用的那家的标志 */
const logoView = (v: D.ViewId): v is 'ai' | 'aicol' => v === 'ai' || v === 'aicol'
/** 标签上写的名字：names 里给了用它（数据库点开的一条写那一条的名字），不然是这一样的名字 */
const nameOf = (p: { names?: Partial<Record<D.ViewId, string>> }, v: D.ViewId) => p.names?.[v] || D.VIEW_NAME[v]
const CN_NUM = ['零', '一', '两', '三', '四', '五']
/** 按下挪过这么多才算拖，不然是点 */
const SLOP = 4

export type DockOp = 'layout' | 'view'

export interface DockProps {
  /** 记着的布局（拖、挪都改它） */
  stored: D.Dock
  /** 画出来的样子（用不上的笔记拿掉了） */
  shown: D.Dock
  frame: 'a' | 'b'
  /** 当前栏：组的 id 时这一组的当前标签画强调色 */
  pane: string
  /** 窗口窄时每栏实际画多宽 */
  widths: Record<string, number>
  /** AI 标签前面画的：正在用的那家的标志 */
  aiLogo: React.ReactNode
  /** 标签在前面时它后面跟的一句灰字（右栏网页的「笔记」：「《那篇》· 来自这个网页」，task-6cxtc） */
  subs?: Partial<Record<D.ViewId, string>>
  /** 标签上写的名字换成这个（数据库点开的一条：「第3讲 生产」） */
  names?: Partial<Record<D.ViewId, string>>
  /** 这一样在前面时组头右边多放的按钮（数据库点开的一条：上一条、下一条、看写法、整页打开） */
  tools?: Partial<Record<D.ViewId, React.ReactNode>>
  /** layout：用户挪了布局（底栏说「布局记住了」）；view：开关标签 */
  onDock(next: D.Dock, op: DockOp): void
  onCloseView(v: D.ViewId): void
  onPane(id: string): void
  onReset(): void
  /** 第一次有两个以上标签时的小卡：还没关过 */
  hint: boolean
  onHintDone(): void
}

/**
 * 一组标签的头：标签条、空处和六点把手（拖整栏 / 拖浮窗）、⋯ 或「停靠」。
 * 把手紧挨在 ⋯ 左边（task-331zt，用户：「这六个点可以放在三个点的左侧」）；标签多到放不下时标签条横着滚，让出把手和 ⋯ 那块
 */
function Head(p: { g: D.Group | D.FloatWin; float: boolean; cur: boolean; props: DockProps; drag: Drag; colIdx: number; colCount: number }) {
  const { g, props, drag } = p
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const tabs = useRef<HTMLDivElement>(null)
  // 标签条滚着时：当前标签整个露着（换了当前、开了新的、栏变窄），哪头还藏着标签哪头淡出（同中间标签条）
  useLayoutEffect(() => {
    const el = tabs.current
    if (!el) return
    const reveal = () => {
      const on = el.querySelector<HTMLElement>('.dtab.on')
      if (on && on.offsetLeft < el.scrollLeft) el.scrollLeft = on.offsetLeft
      else if (on && on.offsetLeft + on.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = on.offsetLeft + on.offsetWidth - el.clientWidth
      fade(el)
    }
    reveal()
    const ro = new ResizeObserver(reveal)
    ro.observe(el)
    return () => ro.disconnect()
  }, [g.active, g.views.length])
  const grab = (e: React.PointerEvent) => (p.float ? drag.startFloat(e, g.id) : drag.startCol(e, g.id))
  return (
    <div className="dhead" role="tablist" aria-label={p.float ? '浮窗的标签' : '右栏标签'}>
      <div className="dtabs" ref={tabs} onWheel={(e) => e.deltaY && (e.currentTarget.scrollLeft += e.deltaY)} onScroll={(e) => fade(e.currentTarget)}>
        {g.views.map((v) => (
          <div
            key={v}
            className={'dtab' + (g.active === v ? ' on' : '')}
            role="tab"
            aria-selected={g.active === v}
            data-view={v}
            data-testid={`dtab-${v}`}
            onPointerDown={(e) => drag.startView(e, v)}
          >
            {logoView(v) ? <span className="dic">{props.aiLogo}</span> : <Codicon name={ICON[v]} size={15} />}
            <span className="dname">{nameOf(props, v)}</span>
            <button className="x" aria-label={`收起${nameOf(props, v)}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onCloseView(v)}>
              <Codicon name="close" size={12} />
            </button>
          </div>
        ))}
        {props.subs?.[g.active] && <span className="dsub">{props.subs[g.active]}</span>}
      </div>
      <div className="dspace" onPointerDown={grab} />
      {g.active === 'web' && <WebFoldButton />}
      {props.tools?.[g.active]}
      <div className="dgrab" data-tip={p.float ? '按住拖动浮窗' : '按住拖动这一栏，换左右位置'} data-side="below" onPointerDown={grab}>
        <span className="grip">
          <Codicon name="gripper" size={14} />
        </span>
      </div>
      {p.float ? (
        <button className="dbtn dock-back" aria-label="停靠" data-tip="停回右栏" data-side="below" onClick={() => drag.settle(D.dockFloat(props.stored, g.id), g.active)}>
          <Codicon name="layout-sidebar-right" size={14} />
          停靠
        </button>
      ) : (
        <button className={'dbtn dmore' + (menu ? ' on' : '')} aria-label="这一栏的布局" data-tip="这一栏的布局" data-side="below" onClick={(e) => setMenu(menu ? null : e.currentTarget)}>
          <Codicon name="ellipsis" size={14} />
        </button>
      )}
      {menu && (
        <Popover anchor={menu} label="这一栏的布局" className="dock-menu" align="end" onClose={() => setMenu(null)}>
          <MenuItem
            icon="multiple-windows"
            label={`把「${nameOf(props, g.active)}」浮起来`}
            onClick={() => {
              const r = menu.getBoundingClientRect()
              setMenu(null)
              drag.settle(D.floatView(props.stored, g.active, { x: r.left - 420, y: r.bottom + 40 }, { w: innerWidth, h: innerHeight }), g.active)
            }}
          />
          <div className="ms" />
          <MenuItem icon="arrow-left" label="这一栏往左挪" disabled={p.colIdx <= 0} onClick={() => (setMenu(null), drag.shiftCol(g.id, -1))} />
          <MenuItem icon="arrow-right" label="这一栏往右挪" disabled={p.colIdx >= p.colCount - 1} onClick={() => (setMenu(null), drag.shiftCol(g.id, 1))} />
          <div className="ms" />
          <MenuItem icon="discard" label="恢复默认布局" onClick={() => (setMenu(null), props.onReset())} />
        </Popover>
      )}
    </div>
  )
}

/** 组头标签条两头还藏着标签：挂 .more-l / .more-r（淡出） */
function fade(el: HTMLElement) {
  el.classList.toggle('more-l', el.scrollLeft > 1)
  el.classList.toggle('more-r', el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
}

interface Drag {
  startView(e: React.PointerEvent, v: D.ViewId): void
  startCol(e: React.PointerEvent, groupId: string): void
  startFloat(e: React.PointerEvent, floatId: string): void
  shiftCol(groupId: string, by: -1 | 1): void
  /** 挪好了：存下布局，挪的那一样所在的那一组成当前栏 */
  settle(next: D.Dock, v: D.ViewId): void
}

type Mark = { left: number; top: number; width: number; height: number; label: string; icon: CodiconName } | null
type Bar = { left: number; top: number; height: number } | null

/** 按下以后挪过 SLOP 才算拖：start 在那时调，move 每次挪，end 松开（没拖过是 click） */
function track(e: React.PointerEvent, h: { start(ev: PointerEvent): void; move(ev: PointerEvent): void; end(ev: PointerEvent): void; click?(): void }) {
  if (e.button !== 0) return
  const sx = e.clientX
  const sy = e.clientY
  let on = false
  const mv = (ev: PointerEvent) => {
    if (!on && Math.hypot(ev.clientX - sx, ev.clientY - sy) > SLOP) {
      on = true
      document.body.classList.add('docking')
      h.start(ev)
    }
    if (on) h.move(ev)
  }
  const up = (ev: PointerEvent) => {
    removeEventListener('pointermove', mv)
    removeEventListener('pointerup', up)
    removeEventListener('pointercancel', up)
    document.body.classList.remove('docking')
    if (on) h.end(ev)
    else h.click?.()
  }
  addEventListener('pointermove', mv)
  addEventListener('pointerup', up)
  addEventListener('pointercancel', up)
}

const rectOf = (el: Element) => el.getBoundingClientRect()

/** 量着每组身子摆五样的内容（.win > .dview[data-view]）：哪一组前面是它，就摆在那一组身子上 */
export function placeViews(win: HTMLElement) {
  const w = rectOf(win)
  for (const el of win.querySelectorAll<HTMLElement>(':scope > .dview')) {
    const body = win.querySelector<HTMLElement>(`.dbody[data-active="${el.dataset.view}"]`)
    if (!body) continue
    const r = rectOf(body)
    el.style.left = `${r.left - w.left}px`
    el.style.top = `${r.top - w.top}px`
    el.style.width = `${r.width}px`
    el.style.height = `${r.height}px`
    // 里面的弹层（书签管家、书签和历史）不比这一组宽：shell.css 的 .dview .wpop 按它算（同以前的 --right-w）
    el.style.setProperty('--view-w', `${r.width}px`)
    el.dataset.group = body.dataset.group
    el.classList.toggle('in-float', !!body.closest('.dfloat'))
  }
}

export function DockFrame(props: DockProps) {
  const { shown, frame } = props
  const cb = useRef(props)
  cb.current = props
  const [mark, setMark] = useState<Mark>(null)
  const [bar, setBar] = useState<Bar>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; icon: React.ReactNode; text: string } | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // 每次画完都摆一遍内容；身子变大小（拖缝、窗口变）也摆
  useLayoutEffect(() => {
    const win = ref.current?.closest<HTMLElement>('.win')
    if (win) placeViews(win)
  })
  useEffect(() => {
    const win = ref.current?.closest<HTMLElement>('.win')
    if (!win) return
    let frameId = 0
    const run = () => {
      cancelAnimationFrame(frameId)
      placeViews(win)
    }
    const ro = new ResizeObserver(run)
    const watch = () => {
      ro.disconnect()
      ro.observe(win)
      const c = win.querySelector(':scope > main.center')
      if (c) ro.observe(c)
      for (const b of win.querySelectorAll('.dbody')) ro.observe(b)
    }
    watch()
    const mo = new MutationObserver(watch)
    mo.observe(win, { childList: true, subtree: false })
    if (ref.current) mo.observe(ref.current, { childList: true, subtree: true })
    return () => (ro.disconnect(), mo.disconnect(), cancelAnimationFrame(frameId))
  }, [])

  const ghostEl = useRef<HTMLDivElement>(null)
  const ghostAt = (ev: PointerEvent, icon: React.ReactNode, text: string) => {
    // 指针右下 12、10；右边放不下就放到指针左边 12（按小牌自己的宽，同原型 proto-a）
    const w = ghostEl.current?.offsetWidth ?? 100
    const x = ev.clientX + w + 24 > innerWidth ? ev.clientX - w - 12 : ev.clientX + 12
    setGhost({ x, y: ev.clientY + 10, icon, text })
  }
  /** 挪好了：存下布局，挪的那一样所在的那一组（或浮窗）成了当前栏，标签下沿亮强调色 */
  const settle = (next: D.Dock, v: D.ViewId) => {
    if (next === cb.current.stored) return
    cb.current.onDock(next, 'layout')
    const f = D.findView(next, v)
    if (f) cb.current.onPane(f.group.id)
  }

  /** 指针下面是哪个落点（浮窗在上面，先看浮窗；再看各组；再看中间的内容） */
  function hit(v: D.ViewId, x: number, y: number): { target: D.DropTarget; mark: NonNullable<Mark> } | null {
    const win = ref.current?.closest('.win')
    if (!win) return null
    const s = cb.current.shown
    const at = (el: Element) => {
      const r = rectOf(el)
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? r : null
    }
    const head = frame === 'b' ? 38 : 35
    const own = D.findView(s, v)
    for (const el of [...win.querySelectorAll<HTMLElement>('.dfloat')].reverse()) {
      const r = at(el)
      if (!r) continue
      const id = el.dataset.group!
      if (own?.group.id === id && own.group.views.length === 1) return null
      return { target: { kind: 'group', group: id, zone: 'center' }, mark: { left: r.left, top: r.top + head, width: r.width, height: r.height - head, label: '叠成标签', icon: 'layers' } }
    }
    for (const el of win.querySelectorAll<HTMLElement>('.dgrp')) {
      const r = at(el)
      if (!r) continue
      const id = el.dataset.group!
      if (own?.group.id === id && own.group.views.length === 1) return null
      const fx = (x - r.left) / r.width
      const fy = (y - r.top) / r.height
      const zone: D.Zone = fy < 0.26 ? 'top' : fy > 0.74 ? 'bottom' : fx < 0.24 ? 'left' : fx > 0.76 ? 'right' : 'center'
      const m = { left: r.left, top: r.top, width: r.width, height: r.height }
      if (zone === 'top') m.height /= 2
      if (zone === 'bottom') (m.top += r.height / 2), (m.height /= 2)
      if (zone === 'left') m.width /= 2
      if (zone === 'right') (m.left += r.width / 2), (m.width /= 2)
      if (zone === 'center') (m.top += head), (m.height -= head)
      const lab = { center: ['叠成标签', 'layers'], top: ['放到上半', 'split-vertical'], bottom: ['放到下半', 'split-vertical'], left: ['在左边并排一栏', 'split-horizontal'], right: ['在右边并排一栏', 'split-horizontal'] } as const
      return { target: { kind: 'group', group: id, zone }, mark: { ...m, label: lab[zone][0], icon: lab[zone][1] } }
    }
    const c = win.querySelector(':scope > main.center')
    const r = c && at(c)
    if (!r) return null
    const fx = (x - r.left) / r.width
    const w = Math.min(360, r.width * 0.4)
    if (fx < 0.2) return { target: { kind: 'center', side: 'left' }, mark: { left: r.left, top: r.top, width: w, height: r.height, label: '放到中间左边', icon: 'arrow-left' } }
    if (fx > 0.8) return { target: { kind: 'center', side: 'right' }, mark: { left: r.right - w, top: r.top, width: w, height: r.height, label: '放到中间右边', icon: 'arrow-right' } }
    const wr = rectOf(win)
    return { target: { kind: 'float', x: x - 190 - wr.left, y: y - 60 - wr.top }, mark: { left: x - 190, top: y - 60, width: 380, height: 460, label: '浮在这里', icon: 'multiple-windows' } }
  }

  /** 几栏从左到右（量出来的）：中间是 center */
  function colRects(): { id: string; r: DOMRect }[] {
    const win = ref.current?.closest('.win')
    if (!win) return []
    return [...win.querySelectorAll<HTMLElement>(':scope > main.center, .dcol')].map((el) => ({ id: el.matches('main.center') ? 'center' : el.dataset.col!, r: rectOf(el) })).sort((a, b) => a.r.left - b.r.left)
  }

  const drag: Drag = {
    startView(e, v) {
      let t: D.DropTarget | null = null
      const g = D.findView(cb.current.shown, v)
      track(e, {
        start: () => cb.current.onHintDone(),
        move: (ev) => {
          ghostAt(ev, logoView(v) ? <span className="dic">{cb.current.aiLogo}</span> : <Codicon name={ICON[v]} size={14} />, nameOf(cb.current, v))
          const h = hit(v, ev.clientX, ev.clientY)
          t = h?.target ?? null
          setMark(h?.mark ?? null)
        },
        end: () => {
          setGhost(null)
          setMark(null)
          if (!t) return
          settle(D.dropView(cb.current.stored, v, t, { w: innerWidth, h: innerHeight }), v)
        },
        click: () => {
          if (g && g.group.active !== v) cb.current.onDock(D.activateView(cb.current.stored, v), 'view')
          if (g) cb.current.onPane(g.group.id)
        },
      })
    },
    startCol(e, groupId) {
      const col = D.findGroup(cb.current.shown, groupId)?.col
      if (!col) return
      startColDrag(e, col.id)
    },
    startFloat(e, floatId) {
      const el = ref.current?.querySelector<HTMLElement>(`.dfloat[data-group="${floatId}"]`)
      const f = cb.current.shown.floats.find((x) => x.id === floatId)
      if (!el || !f) return
      let x = f.x
      let y = f.y
      const sx = e.clientX
      const sy = e.clientY
      track(e, {
        start: () => undefined,
        move: (ev) => {
          x = f.x + ev.clientX - sx
          y = f.y + ev.clientY - sy
          el.style.left = `${x}px`
          el.style.top = `${y}px`
          const win = el.closest<HTMLElement>('.win')
          if (win) placeViews(win)
        },
        end: () => cb.current.onDock(D.moveFloat(cb.current.stored, floatId, x, y, { w: innerWidth, h: innerHeight }), 'layout'),
        click: () => cb.current.onPane(floatId),
      })
    },
    shiftCol(groupId, by) {
      const s = cb.current.shown
      const col = D.findGroup(s, groupId)?.col
      if (!col) return
      const i = s.cols.indexOf(col)
      const j = i + by
      if (j < 0 || j >= s.cols.length) return
      // 往左：挪到左边那栏前面；往右：挪到右边那栏后面
      const before = by < 0 ? s.cols[j]!.id : (s.cols[j + 1]?.id ?? null)
      cb.current.onDock(D.moveColBefore(cb.current.stored, col.id, before), 'layout')
    },
    settle,
  }

  /** 拖整栏：指针下跟着「挪这一栏」，两栏之间亮一条竖线说放在哪 */
  function startColDrag(e: React.PointerEvent | PointerEvent, colId: string) {
    let before: string | null | undefined
    track(e as React.PointerEvent, {
      start: () => cb.current.onHintDone(),
      move: (ev) => {
        ghostAt(ev, <Codicon name="gripper" size={14} />, '挪这一栏')
        const cols = colRects()
        const idx = cols.findIndex((c) => c.id === colId)
        let to = cols.length
        for (let i = 0; i < cols.length; i++) if (ev.clientX < cols[i]!.r.left + cols[i]!.r.width / 2) {
          to = i
          break
        }
        if (to === idx || to === idx + 1) {
          before = undefined
          setBar(null)
          return
        }
        before = to < cols.length ? cols[to]!.id : null
        const x = to === cols.length ? cols[cols.length - 1]!.r.right + 1 : cols[to]!.r.left - 5
        const top = cols[0]!.r.top
        setBar({ left: x, top, height: cols[0]!.r.height })
      },
      end: () => {
        setGhost(null)
        setBar(null)
        if (before === undefined) return
        const next = D.moveColBefore(cb.current.stored, colId, before)
        if (next !== cb.current.stored) cb.current.onDock(next, 'layout')
      },
    })
  }
  // 中间标签条的空处也能拖整栏（App 在那里放了 .tgrab，按下时转到这里）
  useEffect(() => {
    const on = (ev: Event) => startColDrag((ev as CustomEvent<PointerEvent>).detail, 'center')
    window.addEventListener('cn:dock-col-drag', on)
    return () => window.removeEventListener('cn:dock-col-drag', on)
  }, [])

  // 第一次有两个以上标签：那一组靠中间的一侧一张小卡
  const many = D.sideCols(shown).flatMap((c) => c.groups).find((g) => g.views.length > 1) ?? shown.floats.find((f) => f.views.length > 1) ?? null
  const ci = shown.cols.findIndex(D.isCenter)
  const sides = D.sideCols(shown)
  const head = frame === 'b' ? 38 : 35
  return (
    <div ref={ref} className="dock-host" data-frame={frame}>
      {shown.cols.map((c, i) => {
        if (D.isCenter(c)) return null
        const cur = props.pane
        return (
          <div key={c.id} className={'dcol' + (i === 0 ? ' first' : '') + (i === shown.cols.length - 1 ? ' last' : '')} data-col={c.id} style={{ gridColumn: 3 + 2 * i, gridRow: 2 }}>
            {c.groups.map((g, gi) => (
              <GroupBox key={g.id} g={g} gi={gi} col={c} cur={cur === g.id} props={props} drag={drag} colIdx={i} colCount={shown.cols.length} />
            ))}
          </div>
        )
      })}
      {shown.cols.map((c, i) => (i > 0 ? <ColSash key={'s' + c.id} i={i} props={props} /> : null))}
      {shown.floats.map((f) => (
        <FloatBox key={f.id} f={f} cur={props.pane === f.id} props={props} drag={drag} />
      ))}
      {many && props.hint && <Hint g={many} shown={shown} ci={ci} sides={sides} head={head} onDone={props.onHintDone} />}
      {createPortal(
        <>
          {mark && (
            <div className="dmark" data-testid="drop-mark" style={{ left: mark.left, top: mark.top, width: mark.width, height: mark.height }}>
              <span>
                <Codicon name={mark.icon} size={14} />
                {mark.label}
              </span>
            </div>
          )}
          {bar && <div className="dbar" data-testid="drop-bar" style={{ left: bar.left, top: bar.top, height: bar.height }} />}
          {ghost && (
            <div ref={ghostEl} className="dghost" data-testid="drag-ghost" style={{ left: ghost.x, top: ghost.y }}>
              {ghost.icon}
              {ghost.text}
            </div>
          )}
        </>,
        document.body,
      )}
    </div>
  )
}

/** 一组：头 + 空的身子（内容由 App 摆上来）；下面一组前面是能拖的缝 */
function GroupBox(p: { g: D.Group; gi: number; col: D.SideCol; cur: boolean; props: DockProps; drag: Drag; colIdx: number; colCount: number }) {
  const { g, col } = p
  return (
    <>
      {p.gi > 0 && <RowSash a={col.groups[p.gi - 1]!} b={g} props={p.props} />}
      <section className={'dgrp' + (p.cur ? ' cur' : '')} data-group={g.id} style={{ flex: `${g.f} 1 0` }} aria-label={`右栏：${g.views.map((v) => D.VIEW_NAME[v]).join('、')}`}>
        <Head g={g} float={false} cur={p.cur} props={p.props} drag={p.drag} colIdx={p.colIdx} colCount={p.colCount} />
        <div className="dbody" data-group={g.id} data-active={g.active} />
      </section>
    </>
  )
}

/** 上下两组之间的缝：拖着按比例分，双击各一半 */
function RowSash(p: { a: D.Group; b: D.Group; props: DockProps }) {
  const [on, setOn] = useState(false)
  return (
    <div
      className={'dsash-row' + (on ? ' on' : '')}
      role="separator"
      aria-orientation="horizontal"
      aria-label="拖着调上下两块的高低，双击回一半"
      onPointerDown={(e) => {
        const prev = e.currentTarget.previousElementSibling as HTMLElement | null
        const next = e.currentTarget.nextElementSibling as HTMLElement | null
        if (!prev || !next) return
        const top = rectOf(prev).top
        const both = rectOf(next).bottom - top
        e.currentTarget.setPointerCapture(e.pointerId)
        setOn(true)
        // 拖过网页上面时网页不吃掉指针（task-rbtrz：以前往上拖进网页那一组就不跟手了）
        document.body.classList.add('resizing', 'resizing-row')
        const cbp = p.props
        const mv = (ev: PointerEvent) => cbp.onDock(D.setSplit(cbp.stored, p.a.id, p.b.id, (ev.clientY - top) / both), 'layout')
        const up = () => {
          setOn(false)
          document.body.classList.remove('resizing', 'resizing-row')
          removeEventListener('pointermove', mv)
          removeEventListener('pointerup', up)
        }
        addEventListener('pointermove', mv)
        addEventListener('pointerup', up)
      }}
      onDoubleClick={() => p.props.onDock(D.resetSplit(p.props.stored, p.a.id, p.b.id), 'layout')}
    />
  )
}

/** 双击拉到最宽以前那栏多宽（再双击回到这个宽）；按栏的 id 记，只记在这一次打开里 */
const beforeWidest = new Map<string, number>()

/** 两栏之间的缝：挨着中间时拖着改旁边那栏（不是中间的那一栏）的宽。最宽到中间只剩 420（CENTER_MIN），不再卡在一个死数上；
 * 双击一下拉到最宽，再双击回到拉之前的宽（2026-11-21，task-zligc）。两边都不是中间（网页和 AI 并排）时另算，见 PairSash */
function ColSash(p: { i: number; props: DockProps }) {
  const { shown } = p.props
  const left = shown.cols[p.i - 1]!
  const right = shown.cols[p.i]!
  if (!D.isCenter(left) && !D.isCenter(right)) return <PairSash i={p.i} a={left} b={right} props={p.props} />
  return <CenterSash i={p.i} props={p.props} />
}

/**
 * 并排两栏（都不是中间）之间的缝（task-rbtrz，用户：「这里需要能拖动」）：拖着在这两栏之间分宽，左边宽多少右边就窄多少，中间不动；
 * 每栏最窄 300，不设上限（网页那栏也不设）。双击两栏各一半：同上下两组之间的缝双击回一半，一样的手势一样的结果，好记；
 * 「回到上次的比例」要另记一份、拖过几次以后说不清是哪次，不做
 */
function PairSash(p: { i: number; a: D.SideCol; b: D.SideCol; props: DockProps }) {
  const [on, setOn] = useState(false)
  /** 两栏现在画多宽（窗口窄时是收过的宽） */
  const measure = (cbp: DockProps) => {
    const a = cbp.widths[p.a.id] ?? p.a.w
    const b = cbp.widths[p.b.id] ?? p.b.w
    return { a, total: a + b }
  }
  return (
    <div
      className={'dsash-col' + (on ? ' on' : '')}
      style={{ gridColumn: 2 + 2 * p.i, gridRow: 2 }}
      role="separator"
      aria-orientation="vertical"
      aria-label="拖着调左右两栏的宽窄，双击各一半"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setOn(true)
        document.body.classList.add('resizing')
        const sx = e.clientX
        const cbp = p.props
        const { a, total } = measure(cbp)
        const mv = (ev: PointerEvent) => cbp.onDock(D.setPairWidths(cbp.stored, p.a.id, p.b.id, a + ev.clientX - sx, total), 'layout')
        const up = () => {
          setOn(false)
          document.body.classList.remove('resizing')
          removeEventListener('pointermove', mv)
          removeEventListener('pointerup', up)
        }
        addEventListener('pointermove', mv)
        addEventListener('pointerup', up)
      }}
      onDoubleClick={() => {
        const { total } = measure(p.props)
        p.props.onDock(D.setPairWidths(p.props.stored, p.a.id, p.b.id, total / 2, total), 'layout')
      }}
    />
  )
}

function CenterSash(p: { i: number; props: DockProps }) {
  const { shown } = p.props
  const left = shown.cols[p.i - 1]!
  const right = shown.cols[p.i]!
  const [on, setOn] = useState(false)
  // 改的是不是中间的那一栏：右边那栏不是中间就改它（往左拖变宽），不然改左边那栏（往右拖变宽）
  const side = (D.isCenter(right) ? left : right) as D.SideCol
  /** 这一栏现在画多宽、最宽能到多宽（中间现在多宽减去 420 都能让给它） */
  const measure = (cbp: DockProps) => {
    const w0 = cbp.widths[side.id] ?? side.w
    const center = document.querySelector<HTMLElement>('.win > main.center')
    const spare = center ? center.getBoundingClientRect().width - CENTER_MIN : 0
    return { w0, max: Math.max(D.COL_MIN, Math.floor(w0 + spare)) }
  }
  return (
    <div
      className={'dsash-col' + (on ? ' on' : '')}
      style={{ gridColumn: 2 + 2 * p.i, gridRow: 2 }}
      role="separator"
      aria-orientation="vertical"
      aria-label="拖动调整右栏宽度"
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.currentTarget.setPointerCapture(e.pointerId)
        setOn(true)
        document.body.classList.add('resizing')
        const sx = e.clientX
        const cbp = p.props
        const { w0, max } = measure(cbp)
        const mv = (ev: PointerEvent) => {
          const dx = ev.clientX - sx
          cbp.onDock(D.setColWidth(cbp.stored, side.id, Math.min(max, D.isCenter(right) ? w0 + dx : w0 - dx)), 'layout')
        }
        const up = () => {
          setOn(false)
          document.body.classList.remove('resizing')
          removeEventListener('pointermove', mv)
          removeEventListener('pointerup', up)
        }
        addEventListener('pointermove', mv)
        addEventListener('pointerup', up)
      }}
      onDoubleClick={() => {
        const cbp = p.props
        const { w0, max } = measure(cbp)
        if (w0 < max - 2) {
          beforeWidest.set(side.id, w0)
          cbp.onDock(D.setColWidth(cbp.stored, side.id, max), 'layout')
        } else {
          cbp.onDock(D.setColWidth(cbp.stored, side.id, beforeWidest.get(side.id) ?? D.COL_DEFAULT), 'layout')
          beforeWidest.delete(side.id)
        }
      }}
    />
  )
}

/** 浮窗：头（标签、空处挪、停靠）、身子、右下角拉大小 */
function FloatBox(p: { f: D.FloatWin; cur: boolean; props: DockProps; drag: Drag }) {
  const { f } = p
  const ref = useRef<HTMLElement>(null)
  return (
    <section ref={ref} className={'dfloat' + (p.cur ? ' cur' : '')} data-group={f.id} style={{ left: f.x, top: f.y, width: f.w, height: f.h }} aria-label={`浮窗：${f.views.map((v) => D.VIEW_NAME[v]).join('、')}`}>
      <Head g={f} float cur={p.cur} props={p.props} drag={p.drag} colIdx={0} colCount={0} />
      <div className="dbody" data-group={f.id} data-active={f.active} />
      <div
        className="drz"
        aria-label="拖着改浮窗大小"
        onPointerDown={(e) => {
          const el = ref.current
          if (!el) return
          let w = f.w
          let h = f.h
          const sx = e.clientX
          const sy = e.clientY
          track(e, {
            start: () => undefined,
            move: (ev) => {
              w = Math.max(D.FLOAT_MIN_W, f.w + ev.clientX - sx)
              h = Math.max(D.FLOAT_MIN_H, f.h + ev.clientY - sy)
              el.style.width = `${w}px`
              el.style.height = `${h}px`
              const win = el.closest<HTMLElement>('.win')
              if (win) placeViews(win)
            },
            end: () => p.props.onDock(D.resizeFloat(p.props.stored, f.id, w, h), 'layout'),
          })
        }}
      />
    </section>
  )
}

/** 第一次有两个以上标签：那一组靠中间的一侧（组在中间右边就在它左边），组顶下 64 */
function Hint(p: { g: D.Group | D.FloatWin; shown: D.Dock; ci: number; sides: D.SideCol[]; head: number; onDone(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-group="${p.g.id}"].dgrp, [data-group="${p.g.id}"].dfloat`)
    if (!el) return
    const r = rectOf(el)
    const colIdx = p.shown.cols.findIndex((c) => !D.isCenter(c) && c.groups.some((x) => x.id === p.g.id))
    const left = colIdx >= 0 && colIdx < p.ci ? r.right + 12 : r.left - 262
    setPos({ left: Math.max(8, left), top: r.top + 64 })
  }, [p.g.id, p.shown])
  const names = p.g.views.map((v) => D.VIEW_NAME[v])
  return createPortal(
    <div ref={ref} className="dhint" data-testid="dock-hint" role="note" style={pos ?? { visibility: 'hidden' }}>
      <b>想两样一起看？拖标签</b>
      {`${names.join('、')}现在是${CN_NUM[names.length] ?? names.length}个标签，只开一样时占满整栏。把标签拖到下半、拖到旁边成一栏，或拖到中间就浮起来。按住「⋯」左边的六点拖，整栏换左右。`}
      <button className="x" aria-label="关掉" onClick={p.onDone}>
        <Codicon name="close" size={12} />
      </button>
    </div>,
    document.body,
  )
}

/** 中间标签条右边的空处：按下转给工作区（拖整栏） */
export function startCenterColDrag(e: React.PointerEvent) {
  if (e.button !== 0 || e.target !== e.currentTarget) return
  window.dispatchEvent(new CustomEvent('cn:dock-col-drag', { detail: e.nativeEvent }))
}

/** .win 的列：左图标栏、左栏、各栏（之间是缝）、右图标栏；B 里中间在最右时它和右图标栏之间也留一道缝 */
/** fold：中间栏收着（task-kbnc0）时占满的那一栏（网页所在的栏）：中间那一列和它旁边的缝都是 0，这一栏 1fr */
export function gridTracks(shown: D.Dock, frame: 'a' | 'b', widths: Record<string, number>, fold: string | null = null): string {
  const t = ['var(--abar-w)', 'var(--side-w)']
  const ci = shown.cols.findIndex(D.isCenter)
  shown.cols.forEach((c, i) => {
    // 收着时中间左边那道缝（中间排在第一栏时是右边那道）也是 0
    if (i > 0) t.push(fold && (i === ci || (ci === 0 && i === 1)) ? '0px' : 'var(--dgap)')
    t.push(D.isCenter(c) ? (fold ? '0px' : 'minmax(0, 1fr)') : c.id === fold ? 'minmax(0, 1fr)' : `${widths[c.id] ?? c.w}px`)
  })
  // B：只剩中间一块时它和右边图标栏之间留 6（同以前右栏关着）；别的时候最后一块都贴着图标栏（中间排在最后也一样，原型 proto-a）
  if (frame === 'b' && shown.cols.length === 1) t.push('var(--dgap)')
  t.push('var(--abar-w)')
  return t.join(' ')
}
