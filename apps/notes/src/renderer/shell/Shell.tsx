import { Codicon, type CodiconName } from '@cn/design'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * 主界面框架（task-mzstv，设计稿 design-frame/spec.md）：上面标题栏只管「开着什么、找东西」，
 * 左边图标栏 + 左栏管「东西在哪」，右边图标栏 + 右栏管「眼前这一页」，下面底栏管「后台在干什么」。
 * 两种风格（设置 › 外观 › 界面风格）只换样子和几处位置，结构一样。
 */

export interface BarItem {
  id: string
  /** 悬停提示和读屏的名字 */
  label: string
  key?: string
  icon: CodiconName
  on?: boolean
  /** 这一页用不上（比如首页没有大纲）：图标变淡，照样能点 */
  dim?: boolean
  badge?: number
  /** 收件箱堆多了：数字胶囊变琥珀 */
  warn?: boolean
  dot?: boolean
  /** 测试里认它的名字（默认是 id；摘出来的收件箱一格叫 inbox） */
  tid?: string
  /** 不是常用那套 Codicons 里的图标（摘出来的文件夹自己挑的）：直接给画好的 */
  glyph?: React.ReactNode
  onClick(e: React.MouseEvent<HTMLButtonElement>): void
  onContextMenu?(e: React.MouseEvent<HTMLButtonElement>): void
  /** 按住拖上拖下排顺序（摘出来的文件夹）：key 是自己，onDrop(拖的, 放到谁前面) */
  drag?: { key: string; onDrop(from: string, before: string): void }
}

/** 一条图标栏：只放图标，悬停才出名字；亮着的那个再点一下 = 收起那一侧 */
export function ActivityBar(props: { side: 'left' | 'right'; label: string; groups: BarItem[][]; bottom?: React.ReactNode }) {
  const tipSide = props.side === 'left' ? 'right' : 'left'
  return (
    <nav className={'abar ' + props.side} aria-label={props.label}>
      {props.groups
        .filter((g) => g.length)
        .map((g, i) => (
          <div className="abg" key={i}>
            {i > 0 && <i className="ab-sep" />}
            {g.map((it) => (
              <button
                key={it.id}
                className={'ab' + (it.on ? ' on' : '') + (it.dim ? ' dim' : '')}
                aria-label={it.label}
                aria-pressed={it.on}
                data-tip={it.label}
                data-key={it.key}
                data-side={tipSide}
                data-testid={`ab-${it.tid ?? it.id}`}
                onClick={it.onClick}
                onContextMenu={it.onContextMenu}
                draggable={!!it.drag}
                onDragStart={it.drag ? (e) => (e.dataTransfer.setData('application/x-cn-left', it.drag!.key), (e.dataTransfer.effectAllowed = 'move')) : undefined}
                onDragOver={it.drag ? (e) => [...e.dataTransfer.types].includes('application/x-cn-left') && e.preventDefault() : undefined}
                onDrop={
                  it.drag
                    ? (e) => {
                        const from = e.dataTransfer.getData('application/x-cn-left')
                        if (from) (e.preventDefault(), it.drag!.onDrop(from, it.drag!.key))
                      }
                    : undefined
                }
              >
                {it.glyph ?? <Codicon name={it.icon} size={0} />}
                <span className="sr">{it.label}</span>
                {!!it.badge && <span className={'badge num' + (it.warn ? ' warn' : '')} data-testid={`${it.tid ?? it.id}-count`}>{it.badge}</span>}
                {it.dot && <i className="dot" data-testid={`${it.id}-dot`} />}
              </button>
            ))}
          </div>
        ))}
      <div className="grow" />
      {props.bottom}
    </nav>
  )
}

/** 标题栏：红绿灯旁收起左栏、后退前进、首页；正中搜索框；最右收起右栏，开着网页时它左边是「移到中间 / 放回右栏」 */
export function TitleBar(props: {
  leftOpen: boolean
  rightOpen: boolean
  canBack: boolean
  canForward: boolean
  /** 方向 B：搜索框平时写着当前页面在哪 */
  location: string | null
  vaultName: string
  onToggleLeft(): void
  onToggleRight(): void
  onBack(): void
  onForward(): void
  onHome(): void
  onSearch(): void
  /** 正在看的网页在哪：右栏（按钮写「移到中间」）还是中间的宽标签（「放回右栏」）；都没在看网页时没有这颗按钮 */
  web: { where: 'right' | 'center'; onMove(): void } | null
}) {
  const webLabel = props.web?.where === 'center' ? '放回右栏' : '移到中间'
  return (
    <header className="titlebar">
      <div className="tb-left">
        <button className="tb-btn" aria-label={props.leftOpen ? '收起左栏' : '展开左栏'} aria-pressed={props.leftOpen} data-tip={props.leftOpen ? '收起左栏' : '展开左栏'} data-key="⌘\" data-side="below" onClick={props.onToggleLeft}>
          <Codicon name={props.leftOpen ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} />
        </button>
        <button className="tb-btn" aria-label="后退" data-tip="后退" data-key="⌘[" data-side="below" disabled={!props.canBack} onClick={props.onBack}>
          <Codicon name="arrow-left" />
        </button>
        <button className="tb-btn" aria-label="前进" data-tip="前进" data-key="⌘]" data-side="below" disabled={!props.canForward} onClick={props.onForward}>
          <Codicon name="arrow-right" />
        </button>
        <button className="tb-btn" aria-label="首页" data-tip="首页" data-key="⇧⌘H" data-side="below" onClick={props.onHome}>
          <Codicon name="home" />
        </button>
      </div>
      <button className="cmd" aria-label="搜索" data-tip="搜索笔记、输入网址或命令" data-key="⌘K" data-side="below" onClick={props.onSearch}>
        <Codicon name="search" />
        <span className="ph truncate">
          {props.location ?? (
            <>
              搜索<b>{props.vaultName}</b>：笔记、PDF、命令、网址
            </>
          )}
        </span>
        <kbd>⌘K</kbd>
      </button>
      <div className="tb-right">
        {props.web && (
          <button
            className="tb-btn tb-web"
            aria-label={webLabel}
            data-tip={props.web.where === 'center' ? '放回右栏：网页回到右栏，边看边记' : '移到中间：开成中间的宽标签，右栏空出来'}
            data-side="below-left"
            data-testid="tb-web"
            onClick={props.web.onMove}
          >
            <Codicon name={props.web.where === 'center' ? 'layout-sidebar-right' : 'layout-centered'} />
            <span className="lb">{webLabel}</span>
          </button>
        )}
        <button className="tb-btn" aria-label={props.rightOpen ? '收起右栏' : '展开右栏'} aria-pressed={props.rightOpen} data-tip={props.rightOpen ? '收起右栏' : '展开右栏'} data-key="⌥⌘\" data-side="below-left" onClick={props.onToggleRight}>
          <Codicon name={props.rightOpen ? 'layout-sidebar-right' : 'layout-sidebar-right-off'} />
        </button>
      </div>
    </header>
  )
}

/** 左右栏的头：标题 12/600 + 右端几颗图标按钮 */
export function ViewHead(props: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="vh">
      <h2>
        <span className="t">{props.title}</span>
        {props.sub !== undefined && <span className="sub">{props.sub}</span>}
      </h2>
      {props.children}
    </div>
  )
}

export function HeadBtn(props: { icon: CodiconName; label: string; keys?: string; on?: boolean; /** 正在做（新建笔记建好、读好之前） */ busy?: boolean; onClick(e: React.MouseEvent<HTMLButtonElement>): void; className?: string; children?: React.ReactNode }) {
  return (
    <button className={'ib' + (props.on ? ' on' : '') + (props.className ? ' ' + props.className : '')} aria-label={props.label} aria-pressed={props.on} aria-busy={props.busy || undefined} data-tip={props.label} data-key={props.keys} data-side="below" onClick={props.onClick}>
      <Codicon name={props.icon} />
      {props.children}
    </button>
  )
}

/** 小弹出菜单（库、设置、改动、后台）：贴着点它的那个按钮，点外面关 */
export function Popover(props: { anchor: HTMLElement; onClose(): void; label: string; children: React.ReactNode; className?: string; /** right：贴在点它那一行的右边（目录树里的文件夹） */ side?: 'right' }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const r = props.anchor.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      let left = r.left
      let top = r.bottom + 4
      if (props.side === 'right') ((left = r.right + 8), (top = Math.min(r.top + r.height / 2 - h / 2, innerHeight - h - 8)))
      else if (props.anchor.closest('.abar.left')) ((left = r.right + 6), (top = Math.min(r.top, innerHeight - h - 8)))
      else if (props.anchor.closest('.abar.right')) ((left = r.left - w - 6), (top = Math.min(r.top, innerHeight - h - 8)))
      else if (r.top > innerHeight - 80) top = r.top - h - 6
      setPos({ left: Math.max(8, Math.min(left, innerWidth - w - 8)), top: Math.max(8, top) })
    }
    place()
    // 里面的内容变了（比如改动列表刚读出来）：高度跟着变，往上长的弹层要重新摆，不然下半截出了窗口
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [props.anchor])
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !props.anchor.contains(e.target as Node)) props.onClose()
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [props])
  // 挂到 body 上：底栏（B 有磨砂）会给 fixed 的子元素另起坐标，弹层就跑出窗口
  return createPortal(
    <div ref={ref} className={'shell-menu' + (props.className ? ' ' + props.className : '')} role="dialog" aria-label={props.label} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
      {props.children}
    </div>,
    document.body,
  )
}

export function MenuItem(props: { icon?: CodiconName; label: React.ReactNode; right?: React.ReactNode; onClick?(): void; disabled?: boolean }) {
  return (
    <button className="mi" role="menuitem" disabled={props.disabled} onClick={props.onClick}>
      {props.icon ? <Codicon name={props.icon} /> : <i className="mi-sp" />}
      <span className="truncate">{props.label}</span>
      {props.right !== undefined && <span className="r">{props.right}</span>}
    </button>
  )
}

/**
 * 悬停提示：所有带 data-tip 的按钮共用一个。0.4 秒后出现；
 * 刚在别的按钮上出过（0.6 秒内）就马上出，在一条栏里换着指不用每次等。
 */
export function Tooltips() {
  const [tip, setTip] = useState<{ text: string; key?: string; x: number; y: number; side: string; el: Element } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let timer = 0
    let lastHide = 0
    let cur: Element | null = null
    const hide = () => {
      window.clearTimeout(timer)
      if (cur) lastHide = Date.now()
      cur = null
      setTip(null)
    }
    const over = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]')
      if (el === cur) return
      if (!el) return hide()
      hide()
      const delay = Date.now() - lastHide < 600 ? 0 : 400
      timer = window.setTimeout(() => {
        if (!el.isConnected) return
        cur = el
        const r = el.getBoundingClientRect()
        const side = el.getAttribute('data-side') ?? 'below'
        const x = side === 'right' ? r.right + 6 : side === 'left' ? r.left - 6 : side === 'below-left' || side === 'above-left' ? r.right : r.left + r.width / 2
        const y = side === 'right' || side === 'left' ? r.top + r.height / 2 : side.startsWith('above') ? r.top - 6 : r.bottom + 6
        setTip({ text: el.getAttribute('data-tip')!, key: el.getAttribute('data-key') ?? undefined, x, y, side, el })
      }, delay)
    }
    document.addEventListener('mouseover', over)
    document.addEventListener('mousedown', hide, true)
    window.addEventListener('blur', hide)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('mousedown', hide, true)
      window.removeEventListener('blur', hide)
      window.clearTimeout(timer)
    }
  }, [])
  // 量完自己的宽高再摆，别出窗口
  useEffect(() => {
    const el = ref.current
    if (!el || !tip) return
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = tip.side === 'right' ? tip.x : tip.side === 'left' ? tip.x - w : tip.side === 'below-left' || tip.side === 'above-left' ? tip.x - w : tip.x - w / 2
    const top = tip.side === 'right' || tip.side === 'left' ? tip.y - h / 2 : tip.side.startsWith('above') ? tip.y - h : tip.y
    left = Math.max(6, Math.min(left, innerWidth - w - 6))
    el.style.left = left + 'px'
    el.style.top = Math.max(4, top) + 'px'
    el.classList.add('show')
  }, [tip])
  if (!tip) return null
  return (
    <div ref={ref} className={'shell-tip' + (tip.text.length > 60 ? ' long' : '')} role="tooltip" data-testid="tooltip">
      <span>{tip.text}</span>
      {tip.key && <kbd>{tip.key}</kbd>}
    </div>
  )
}
