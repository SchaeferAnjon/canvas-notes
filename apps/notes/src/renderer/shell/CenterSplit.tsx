/**
 * 中间栏分屏（规则 design/split/README.md）：拖中间的标签（落点、跟着指针的小牌照工作区 Dock 的 .dmark / .dbar / .dghost），
 * 两格之间的分隔条。拖到哪、放下算什么交给 App（shared/center-split.ts 的纯函数改标签和分屏）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { trackDrag } from '@cn/design/drag-end'
import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PaneNo, Side, SplitDir } from '../../shared/center-split'
import { clampRatio } from '../../shared/center-split'
import { t } from '../../shared/i18n'
import './center-split.css'

/** 放下算什么：拖到某一格的标签条上（排在 before 前面）、没分屏时拖到内容的一边、分屏时拖到另一格的内容上 */
export type SplitDrop = { kind: 'strip'; pane: PaneNo; before: string | null } | { kind: 'side'; side: Side } | { kind: 'pane'; pane: PaneNo }

type Mark = { left: number; top: number; width: number; height: number; label: string; icon: CodiconName }
type Bar = { left: number; top: number; height: number }

/** 按下以后挪过 4 才算拖（同 Dock），不然是点 */
const SLOP = 4

const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom

/**
 * 指针下面是哪个落点。center：中间那一栏（main.center）；from：拖的标签在第几格；split：分没分屏；canSplit：没分屏时这一格不止一个标签
 */
function hit(center: HTMLElement, id: string, from: PaneNo, split: boolean, canSplit: boolean, x: number, y: number): { drop: SplitDrop; mark?: Mark; bar?: Bar } | null {
  for (const strip of center.querySelectorAll<HTMLElement>(':scope > .tabs[data-strip]')) {
    const r = strip.getBoundingClientRect()
    if (!inside(r, x, y)) continue
    const pane = Number(strip.dataset.strip) as PaneNo
    const list = [...strip.querySelectorAll<HTMLElement>('.tlist > .tab[data-tab]')]
    const next = list.find((el) => {
      const b = el.getBoundingClientRect()
      return x < b.left + b.width / 2
    })
    const ref = next ?? list[list.length - 1]
    if (!ref) return { drop: { kind: 'strip', pane, before: null } }
    const b = ref.getBoundingClientRect()
    const before = next?.dataset.tab ?? null
    // 放回原处（自己前后）：不亮
    const at = list.findIndex((el) => el.dataset.tab === id)
    const to = next ? list.indexOf(next) : list.length
    if (pane === from && at >= 0 && (to === at || to === at + 1)) return null
    return { drop: { kind: 'strip', pane, before }, bar: { left: (next ? b.left : b.right) - 2, top: b.top + 2, height: b.height - 4 } }
  }
  for (const slot of center.querySelectorAll<HTMLElement>(':scope > .cslot:not([hidden])')) {
    const r = slot.getBoundingClientRect()
    if (!inside(r, x, y) || !r.width) continue
    const pane = Number(slot.dataset.pane) as PaneNo
    if (split) {
      if (pane === from) return null
      return { drop: { kind: 'pane', pane }, mark: { left: r.left, top: r.top, width: r.width, height: r.height, label: t('放进这一格'), icon: 'layers' } }
    }
    if (!canSplit) return null
    const fx = (x - r.left) / r.width
    const fy = (y - r.top) / r.height
    // 同 Dock 一组上的落点：上下各 26%，左右各 24%，正中不亮
    const side: Side | null = fy < 0.26 ? 'top' : fy > 0.74 ? 'bottom' : fx < 0.24 ? 'left' : fx > 0.76 ? 'right' : null
    if (!side) return null
    const m = { left: r.left, top: r.top, width: r.width, height: r.height }
    if (side === 'top') m.height /= 2
    if (side === 'bottom') (m.top += r.height / 2), (m.height /= 2)
    if (side === 'left') m.width /= 2
    if (side === 'right') (m.left += r.width / 2), (m.width /= 2)
    const lab = { left: [t('分到左边'), 'split-horizontal'], right: [t('分到右边'), 'split-horizontal'], top: [t('分到上半'), 'split-vertical'], bottom: [t('分到下半'), 'split-vertical'] } as const
    return { drop: { kind: 'side', side }, mark: { ...m, label: lab[side][0], icon: lab[side][1] } }
  }
  return null
}

/**
 * 拖中间的标签：start(按下的事件, 标签) 开始跟；拖着时画落点、竖线、小牌（portal 到 body），松手交给 onDrop。
 * 没挪过 4 就松手是点，什么都不做（标签自己的 onClick 照常切过去）
 */
export function useTabDrag(get: () => { center: HTMLElement | null; split: boolean; paneOf(id: string): PaneNo; canSplit(id: string): boolean }, onDrop: (id: string, d: SplitDrop) => void) {
  const [mark, setMark] = useState<Mark | null>(null)
  const [bar, setBar] = useState<Bar | null>(null)
  const [ghost, setGhost] = useState<{ x: number; y: number; icon: React.ReactNode; text: string } | null>(null)
  const ghostEl = useRef<HTMLDivElement>(null)

  function start(e: React.PointerEvent, tab: { id: string; icon: React.ReactNode; name: string }) {
    if (e.button !== 0) return
    const sx = e.clientX
    const sy = e.clientY
    let on = false
    let drop: SplitDrop | null = null
    const clear = () => (setGhost(null), setMark(null), setBar(null), document.body.classList.remove('docking'))
    trackDrag<PointerEvent>(e, {
      move: (ev) => {
        if (!on && Math.hypot(ev.clientX - sx, ev.clientY - sy) <= SLOP) return
        on = true
        document.body.classList.add('docking')
        const w = ghostEl.current?.offsetWidth ?? 100
        setGhost({ x: ev.clientX + w + 24 > innerWidth ? ev.clientX - w - 12 : ev.clientX + 12, y: ev.clientY + 10, icon: tab.icon, text: tab.name })
        const g = get()
        const h = g.center ? hit(g.center, tab.id, g.paneOf(tab.id), g.split, g.canSplit(tab.id), ev.clientX, ev.clientY) : null
        drop = h?.drop ?? null
        setMark(h?.mark ?? null)
        setBar(h?.bar ?? null)
      },
      end: (how) => {
        clear()
        // 松手没送到页面（窗口外松手、失焦）：当没拖过（trackDrag 的 lost）
        if (on && how === 'up' && drop) onDrop(tab.id, drop)
      },
    })
  }

  const overlay = createPortal(
    <>
      {mark && (
        <div className="dmark" data-testid="split-mark" style={{ left: mark.left, top: mark.top, width: mark.width, height: mark.height }}>
          <span>
            <Codicon name={mark.icon} size={14} />
            {mark.label}
          </span>
        </div>
      )}
      {bar && <div className="dbar" data-testid="split-bar" style={{ left: bar.left, top: bar.top, height: bar.height }} />}
      {ghost && (
        <div ref={ghostEl} className="dghost" data-testid="tab-ghost" style={{ left: ghost.x, top: ghost.y }}>
          {ghost.icon}
          {ghost.text}
        </div>
      )}
    </>,
    document.body,
  )
  return { start, overlay }
}

/**
 * 两格之间的分隔条：拖着改比例（每格至少 240 宽 / 高），双击回一半。指上去、拖着时中间一条 2px --line2（同 Dock 的缝）
 */
export function SplitSash(props: { dir: SplitDir; ratio: number; center: () => HTMLElement | null; onRatio(r: number): void }) {
  const [on, setOn] = useState(false)
  return (
    <div
      className={'csash' + (on ? ' on' : '')}
      data-testid="split-sash"
      role="separator"
      aria-orientation={props.dir === 'row' ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(props.ratio * 100)}
      onPointerDown={(e) => {
        const el = props.center()
        if (e.button !== 0 || !el) return
        e.preventDefault()
        const r = el.getBoundingClientRect()
        const row = props.dir === 'row'
        const size = row ? r.width : r.height
        const min = Math.min(0.5, 240 / Math.max(1, size))
        setOn(true)
        document.body.classList.add('resizing', ...(row ? [] : ['resizing-row']))
        trackDrag<PointerEvent>(e, {
          move: (ev) => {
            const f = row ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height
            props.onRatio(clampRatio(Math.min(1 - min, Math.max(min, f))))
          },
          end: () => {
            setOn(false)
            document.body.classList.remove('resizing', 'resizing-row')
          },
        })
      }}
      onDoubleClick={() => props.onRatio(0.5)}
    />
  )
}
