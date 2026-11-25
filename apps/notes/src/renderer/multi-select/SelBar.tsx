/**
 * 多选的操作条（task-5ryf9，设计稿 17-白板框选 方向 A「浮在选区上」，用户定）：白板框选好几张、文档拖选好几块以后出的同一条。
 * 和选中一段字时出的「选中小条」（renderer/sel-bar/，task-26nz7）不是一个东西。
 * - 「已选N张 / 已选N块」开头，后面几颗按钮；选了两样起才出（一样时照旧：白板右键菜单、文档点把手出块菜单）；
 * - 浮在选中的那几样上方 10，跟着选区走；上面放不下翻到下面，选区比这一格还高就贴在顶上 8；左右夹在这一格里，四边留 8；
 *   拖的时候先藏起来，松手再出来；
 * - 这一格窄了：先只留图标（「问AI」留字），再按 foldOrder 一颗颗收进「⋯」，不挤字、不换行（偏好「窄的时候不许挤成一字一行」）；
 * - 悬停提示走全软件那一个（data-tip，0.4 秒，一次只出一条）。
 * 画在 body 上（position: fixed、窗口坐标）：白板画布有 CSS zoom，画在里面会跟着缩放；按钮的菜单也挂在 body 上（SelMenu）。
 */
import { Codicon, type CodiconName } from '@cn/design'
import { Fragment, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AiIcon } from '../engine-logo'
import './selbar.css'

export interface BarItem {
  /** 动作的名字：align、col、ai、tidy、anki、copy、delete、more；文档 turn、move */
  k: string
  /** 按钮上的字（只有图标的不给） */
  label?: string
  icon?: CodiconName
  /** 画一个颜色小圆点代替图标（白板笔迹「颜色」：选中的几笔现在的颜色） */
  dot?: string
  /** 交给 AI 的：画当前 AI 那一家的标志（偏好「AI 图标用引擎标志」） */
  ai?: true
  /** 悬停提示 */
  tip: string
  /** 提示里写的键 */
  keys?: string | null
  /** 点了出菜单：右边一个小箭头 */
  menu?: true
  /** 窄了只留图标时它还留着字（问AI） */
  keep?: true
  red?: true
  /** 前面一道竖线 */
  sep?: true
}

export interface Rect {
  left: number
  top: number
  right: number
  bottom: number
}

const EDGE = 8
const GAP = 10

/** 浮在选区上方 10；上面放不下翻到下面；都放不下贴在顶上；左右、上下都夹在 area 里（四边留 8）。纯函数，量好了算 */
export function barSpot(sel: Rect, area: Rect, bw: number, bh: number): { left: number; top: number; below: boolean } {
  let top = sel.top - GAP - bh
  let below = false
  if (top < area.top + EDGE) {
    if (sel.bottom + GAP + bh < area.bottom - EDGE) {
      top = sel.bottom + GAP
      below = true
    } else top = area.top + EDGE
  }
  // 选区滚出了这一格：贴着那一边（还看得到、按得到）
  top = Math.max(area.top + EDGE, Math.min(top, area.bottom - EDGE - bh))
  const mid = (sel.left + sel.right) / 2
  const left = Math.max(area.left + EDGE, Math.min(mid - bw / 2, area.right - EDGE - bw))
  return { left: Math.round(left), top: Math.round(top), below }
}

/** 这一格多宽时排好的样子：level 1 只留图标；folded 收进「⋯」的几颗 */
interface Fit {
  avail: number
  key: string
  level: 0 | 1
  folded: string[]
}

export function SelBar(props: {
  /** 「已选5张」 */
  count: string
  items: BarItem[]
  /** 窄了按这个先后收进「⋯」 */
  foldOrder: string[]
  /** 量选区和这一格（窗口坐标）；选区量不到（全藏在收起的列里）给 sel: null */
  measure(): { sel: Rect | null; area: Rect } | null
  /** 滚动时跟着走、这一格变宽变窄时重排 */
  scrollers: (HTMLElement | null | undefined)[]
  /** 拖着的时候藏起来 */
  hidden?: boolean
  /** 开着菜单的那一颗（底色深一档） */
  open?: string | null
  label: string
  testid: string
  /** el：按钮自己（菜单贴着它弹）；folded：收进「⋯」的那几颗，「⋯」的菜单最前面放它们 */
  onAct(k: string, el: HTMLElement, folded: string[]): void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<Fit>({ avail: -1, key: '', level: 0, folded: [] })
  const fitRef = useRef(fit)
  fitRef.current = fit
  const [spot, setSpot] = useState<{ left: number; top: number; below: boolean } | null>(null)
  const [, bump] = useState(0)
  const measureRef = useRef(props.measure)
  measureRef.current = props.measure
  const key = props.items.map((it) => it.k).join(',') + '|' + props.count

  const place = () => {
    const el = ref.current
    const m = measureRef.current()
    if (!el || !m || !m.sel) return setSpot(null)
    // 这一格宽窄变了：重排一遍（下一次画的时候）
    if (Math.floor(m.area.right - m.area.left - 16) !== fitRef.current.avail) return bump((x) => x + 1)
    const s = barSpot(m.sel, m.area, el.offsetWidth, el.offsetHeight)
    setSpot((p) => (p && p.left === s.left && p.top === s.top && p.below === s.below ? p : s))
  }
  const placeRef = useRef(place)
  placeRef.current = place

  // 每画一次：先排宽窄（放不下先只留图标，再一颗颗收进「⋯」，画出来之前排好，不闪），排好了量位置
  useLayoutEffect(() => {
    const el = ref.current
    const m = measureRef.current()
    if (!el || !m) return void (spot && setSpot(null))
    const avail = Math.floor(m.area.right - m.area.left - 16)
    const f = fitRef.current
    if (avail !== f.avail || key !== f.key) return setFit({ avail, key, level: 0, folded: [] })
    if (el.offsetWidth <= avail) return placeRef.current()
    if (f.level === 0) return setFit({ ...f, level: 1 })
    const next = props.foldOrder.find((k) => !f.folded.includes(k) && props.items.some((it) => it.k === k))
    if (next) setFit({ ...f, folded: [...f.folded, next] })
    else placeRef.current()
  })

  useLayoutEffect(() => {
    const on = () => placeRef.current()
    const els = props.scrollers.filter((x): x is HTMLElement => !!x)
    for (const s of els) s.addEventListener('scroll', on, { passive: true })
    window.addEventListener('resize', on)
    const ro = new ResizeObserver(on)
    for (const s of els) ro.observe(s)
    return () => {
      for (const s of els) s.removeEventListener('scroll', on)
      window.removeEventListener('resize', on)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, props.scrollers)

  const shown = props.items.filter((it) => !fit.folded.includes(it.k))
  return createPortal(
    <div
      ref={ref}
      className={'selbar' + (fit.level ? ' l1' : '') + (props.hidden || !spot ? ' hide' : '')}
      role="toolbar"
      aria-label={props.label}
      aria-hidden={props.hidden || !spot || undefined}
      data-testid={props.testid}
      data-level={fit.level}
      data-below={spot?.below ? '1' : undefined}
      data-folded={fit.folded.join(',') || undefined}
      style={spot ? { left: spot.left, top: spot.top } : { left: 0, top: -200 }}
      // 点操作条不挪焦点：文档里选着的几块、白板的键盘都还在
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="cnt num">{props.count}</span>
      <span className="vs" />
      {shown.map((it) => (
        <Fragment key={it.k}>
          {it.sep && <span className="vs" />}
          <button
            type="button"
            className={'sb' + (it.keep ? ' keep' : '') + (it.red ? ' red' : '') + (props.open === it.k ? ' open' : '')}
            data-k={it.k}
            aria-label={it.label ?? it.tip}
            aria-haspopup={it.menu || it.k === 'more' ? 'menu' : undefined}
            aria-expanded={it.menu || it.k === 'more' ? props.open === it.k : undefined}
            data-tip={it.tip}
            data-key={it.keys ?? undefined}
            data-side="below"
            onClick={(e) => props.onAct(it.k, e.currentTarget, fit.folded)}
          >
            {it.ai ? <AiIcon job="chat" size={15} /> : it.dot ? <span className="sb-dot" style={{ background: it.dot }} /> : it.icon && <Codicon name={it.icon} size={15} />}
            {it.label && <span className="lb">{it.label}</span>}
            {it.menu && <Codicon name="chevron-down" size={14} className="dn" />}
          </button>
        </Fragment>
      ))}
    </div>,
    document.body,
  )
}
