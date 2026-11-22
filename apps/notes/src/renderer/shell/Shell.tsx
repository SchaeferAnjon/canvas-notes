import { Codicon, type CodiconName } from '@cn/design'
import { useKeys } from '../keys'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { menuAt } from '../ctx/menu'

/**
 * 主界面框架（task-mzstv，设计稿 design-frame/spec.md）：上面标题栏只管「开着什么、找东西」，
 * 左边图标栏 + 左栏管「东西在哪」，右边图标栏 + 右栏管「眼前这一页」，下面底栏管「后台在干什么」。
 * 两种风格（设置 › 外观 › 界面风格）只换样子和几处位置，结构一样。
 */

export interface BarItem {
  id: string
  /** 悬停提示和读屏的名字 */
  label: string
  /** 悬停提示要多说一句时（书桌：存好的一整套…）；不给就是 label */
  tip?: string
  key?: string
  icon: CodiconName
  on?: boolean
  /** 这一页用不上（比如首页没有大纲、不读 PDF 时的笔记）：图标原地变淡，不挪位置 */
  dim?: boolean
  /** 变淡时点它：不打开，旁边说一句为什么（右图标栏方向 A） */
  why?: string
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
  /** 按住拖上拖下排顺序（摘出来的文件夹，只在同一段里）：key 是自己，onDrop(拖的, 放到谁前面；null 是这一段最后) */
  drag?: { key: string; onDrop(from: string, before: string | null): void }
  /** 窗口矮、放不下时能收进「⋯」的（摘出来的分类和文件夹，从最后一格往前收） */
  /** 数字：比分类先收，数大的先收（窗口最矮时先收「待办」再收「书桌」，八个分类都留着，2026-11-22 用户定） */
  fold?: boolean | number
}

/**
 * 图标栏接别处拖来的东西（task-wniqx：左栏树里的文件夹拖上来「放到左边」）：
 * type 是认的拖动类型；ok() 这一次能不能放（已经在左边的不接）；落点在 cells 这几格之间（自己放上去的那一段），
 * 这一段还空着时线画在 after 那一格下面；onDrop(放到谁前面，null 是最后)
 */
export interface BarDrop {
  type: string
  ok(): boolean
  cells: string[]
  after: string | null
  onDrop(before: string | null): void
}

const LEFT_DRAG = 'application/x-cn-left'

/**
 * 一条图标栏：只放图标，悬停才出名字；亮着的那个再点一下 = 收起那一侧。
 * 窗口矮、一列放不下时，能收的格子（fold）收进一格「⋯」，点开是这几格的菜单（方案 v2 分类与入口 A2 第 3 条）：先收「待办」、再收「书桌」
 * （「⋯」自己也占一格，只收「待办」腾不出地方），再从最后一格往前收分类和摘上来的文件夹。
 * 拖着排、从树里拖文件夹上来时（task-wniqx，原型 proto-pin-folder.html）：落点一道强调色线，栏右边一句「松手：挪到这里」/「松手：放到左边」
 */
export function ActivityBar(props: { side: 'left' | 'right'; label: string; groups: BarItem[][]; bottom?: React.ReactNode; accept?: BarDrop }) {
  const tipSide = props.side === 'left' ? 'right' : 'left'
  const nav = useRef<HTMLElement>(null)
  /** 收进「⋯」的格子数 */
  const [folded, setFolded] = useState(0)
  // 从这一串的最后往前收：带数字的（「待办」「书桌」）排在最后、数大的最先收；其余从最后一格往前收
  const all = props.groups.flat()
  const foldable = [...all.filter((it) => it.fold === true), ...all.filter((it) => typeof it.fold === 'number').sort((a, b) => (a.fold as number) - (b.fold as number))]
  const hide = new Set(folded ? foldable.slice(-folded).map((it) => it.id) : [])
  const key = foldable.map((it) => it.id).join('|')
  // 量：放不下就再收一格（直到放得下或者都收完）；窗口变高、格子变了重新从 0 量
  useLayoutEffect(() => {
    const el = nav.current
    if (!el) return
    if (el.scrollHeight > el.clientHeight + 1 && folded < foldable.length) setFolded(folded + 1)
  })
  useEffect(() => {
    const el = nav.current
    if (!el) return
    let h = el.clientHeight
    const ro = new ResizeObserver(() => {
      if (el.clientHeight !== h) ((h = el.clientHeight), setFolded(0))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  useEffect(() => setFolded(0), [key])
  const groups = props.groups.map((g) => g.filter((it) => !hide.has(it.id)))
  const lastFoldGroup = folded ? props.groups.findIndex((g) => g.includes(foldable[foldable.length - folded]!)) : -1
  const moreBtn = (
    <button
      key="ab-more"
      className="ab"
      aria-label={`还有${folded}个`}
      data-tip={`还有${folded}个：${foldable.slice(-folded).map((it) => it.label).join('、')}`}
      data-side={tipSide}
      data-testid="ab-more"
      onClick={(e) => void menuAt(e, foldable.slice(-folded).map((it) => ({ label: it.label, checked: it.on, run: () => it.onClick(e) })))}
    >
      <Codicon name="ellipsis" size={0} />
    </button>
  )
  /** 点了变淡的那格：旁边说一句为什么（点别处、按 esc 收起） */
  const [say, setSay] = useState<{ id: string; text: string; el: HTMLElement } | null>(null)
  /** 正在拖着排的那一格（dragover 时读不到 dataTransfer 里的值，自己记着） */
  const dragKey = useRef<string | null>(null)
  /** 拖着经过时的落点：线画在 y，松手放到 before 前面 */
  const [slot, setSlot] = useState<{ y: number; before: string | null; text: string } | null>(null)
  useEffect(() => {
    if (!slot) return
    // 拖到别处松手、按 esc 取消：落点收起（冒泡到 window 才收：松在图标栏上时 nav 的 onDrop 先用到 dragKey）
    const end = () => ((dragKey.current = null), setSlot(null))
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => (window.removeEventListener('dragend', end), window.removeEventListener('drop', end))
  }, [!!slot])
  /** 这一拖落在哪：同一段（拖着排）或 accept.cells（从树里拖来）里，指针在哪一格的上半就放它前面，过了最后一格的一半放最后；before 是 drag.key（拖着排）或格子的 id（从树里拖来） */
  const slotAt = (e: React.DragEvent): { y: number; before: string | null; text: string } | null => {
    const types = [...e.dataTransfer.types]
    /** [格子的 id, 松手时给 onDrop 的名字] */
    let keys: (readonly [string, string])[]
    let after: string | null = null
    let text: string
    if (types.includes(LEFT_DRAG) && dragKey.current) {
      const g = props.groups.find((x) => x.some((it) => it.drag?.key === dragKey.current))
      if (!g) return null
      keys = g.filter((it) => it.drag && !hide.has(it.id)).map((it) => [it.id, it.drag!.key] as const)
      text = '松手：挪到这里'
    } else if (props.accept && types.includes(props.accept.type) && props.accept.ok()) {
      keys = props.accept.cells.filter((id) => !hide.has(id)).map((id) => [id, id] as const)
      after = props.accept.after
      text = '松手：放到左边'
    } else return null
    const el = (id: string) => nav.current?.querySelector<HTMLElement>(`[data-bar-id="${CSS.escape(id)}"]`) ?? null
    const rects = keys.map(([id, key]) => [key, el(id)?.getBoundingClientRect()] as const).filter((x): x is readonly [string, DOMRect] => !!x[1])
    if (!rects.length) {
      const a = after ? el(after)?.getBoundingClientRect() : null
      return a ? { y: a.bottom + 6, before: null, text } : null
    }
    for (const [id, r] of rects) if (e.clientY < r.top + r.height / 2) return { y: r.top, before: id, text }
    return { y: rects[rects.length - 1]![1].bottom, before: null, text }
  }
  const navRect = nav.current?.getBoundingClientRect()
  return (
    <nav
      ref={nav}
      className={'abar ' + props.side + (slot ? ' accept' : '')}
      aria-label={props.label}
      onDragOver={(e) => {
        const at = slotAt(e)
        if (!at) return slot && setSlot(null)
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (at.y !== slot?.y || at.before !== slot?.before || at.text !== slot?.text) setSlot(at)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setSlot(null)}
      onDrop={(e) => {
        const at = slotAt(e)
        const from = e.dataTransfer.getData(LEFT_DRAG)
        dragKey.current = null
        setSlot(null)
        if (!at) return
        e.preventDefault()
        if (from) props.groups.flat().find((it) => it.drag?.key === from)?.drag!.onDrop(from, at.before)
        else props.accept?.onDrop(at.before)
      }}
    >
      {say && <Say text={say.text} anchor={say.el} side={tipSide} onClose={() => setSay(null)} />}
      {slot &&
        navRect &&
        createPortal(
          <>
            <i className="ab-drop-line" data-testid="bar-drop-line" style={{ left: navRect.left + 8, width: navRect.width - 16, top: slot.y - 1 }} />
            <div className="ab-drop-say" data-testid="bar-drop-say" style={{ left: navRect.right + 8, top: slot.y - 10 }}>
              {slot.text}
            </div>
          </>,
          document.body,
        )}
      {groups
        .map((g, i) => [g, i] as const)
        .filter(([g, i]) => g.length || i === lastFoldGroup)
        .map(([g, i], k) => (
          <div className="abg" key={i}>
            {k > 0 && <i className="ab-sep" />}
            {g.map((it) => (
              <button
                key={it.id}
                className={'ab' + (it.on ? ' on' : '') + (it.dim ? ' dim' : '') + (slot && it.drag && it.drag.key === dragKey.current ? ' dragging' : '')}
                aria-label={it.label}
                aria-pressed={it.on}
                data-tip={it.tip ?? it.label}
                data-key={it.key}
                data-side={tipSide}
                data-testid={`ab-${it.tid ?? it.id}`}
                data-bar-id={it.id}
                data-saying={say?.id === it.id || undefined}
                onClick={it.dim && it.why ? (e) => setSay({ id: it.id, text: it.why!, el: e.currentTarget }) : it.onClick}
                onContextMenu={it.onContextMenu}
                draggable={!!it.drag}
                onDragStart={it.drag ? (e) => ((dragKey.current = it.drag!.key), e.dataTransfer.setData(LEFT_DRAG, it.drag!.key), (e.dataTransfer.effectAllowed = 'move')) : undefined}
                onDragEnd={it.drag ? () => ((dragKey.current = null), setSlot(null)) : undefined}
              >
                {it.glyph ?? <Codicon name={it.icon} size={0} />}
                <span className="sr">{it.label}</span>
                {!!it.badge && <span className={'badge num' + (it.warn ? ' warn' : '')} data-testid={`${it.tid ?? it.id}-count`}>{it.badge}</span>}
                {it.dot && <i className="dot" data-testid={`${it.id}-dot`} />}
              </button>
            ))}
            {i === lastFoldGroup && moreBtn}
          </div>
        ))}
      <div className="grow" />
      {props.bottom}
    </nav>
  )
}

/** 图标栏上一格旁边说的一句（点了变淡的那格时）：贴在格子朝里的一侧，竖着居中；点别处、按 esc 收起 */
function Say(props: { text: string; anchor: HTMLElement; side: 'left' | 'right'; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = props.anchor.getBoundingClientRect()
    el.style.left = `${props.side === 'left' ? r.left - el.offsetWidth - 8 : r.right + 8}px`
    el.style.top = `${r.top + r.height / 2 - el.offsetHeight / 2}px`
  }, [props.anchor, props.text])
  useEffect(() => {
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && !props.anchor.contains(e.target as Node) && props.onClose()
    const key = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose()
    document.addEventListener('mousedown', down, true)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down, true)
      document.removeEventListener('keydown', key)
    }
  }, [props])
  return createPortal(
    <div ref={ref} className="ab-say" role="status" data-testid="bar-say">
      {props.text}
    </div>,
    document.body,
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
  /** 正在看的网页在哪：右栏（按钮写「移到中间」）还是中间的宽标签（「放回右栏」）；中间栏收着、网页占满时是「展开中间栏」（task-kbnc0）；都没在看网页时没有这颗按钮 */
  web: { where: 'right' | 'center' | 'fold'; onMove(): void } | null
}) {
  /** 写在提示上的键照命令表（改了跟着变） */
  const K = useKeys()
  const webLabel = props.web?.where === 'center' ? '放回右栏' : props.web?.where === 'fold' ? '展开中间栏' : '移到中间'
  return (
    <header className="titlebar">
      <div className="tb-left">
        <button className="tb-btn" aria-label={props.leftOpen ? '收起左栏' : '展开左栏'} aria-pressed={props.leftOpen} data-tip={props.leftOpen ? '收起左栏' : '展开左栏'} data-key={K('toggle-left') ?? undefined} data-side="below" onClick={props.onToggleLeft}>
          <Codicon name={props.leftOpen ? 'layout-sidebar-left' : 'layout-sidebar-left-off'} />
        </button>
        <button className="tb-btn" aria-label="后退" data-tip="后退" data-key={K('back') ?? undefined} data-side="below" disabled={!props.canBack} onClick={props.onBack}>
          <Codicon name="arrow-left" />
        </button>
        <button className="tb-btn" aria-label="前进" data-tip="前进" data-key={K('forward') ?? undefined} data-side="below" disabled={!props.canForward} onClick={props.onForward}>
          <Codicon name="arrow-right" />
        </button>
        <button className="tb-btn" aria-label="首页" data-tip="首页" data-key={K('home') ?? undefined} data-side="below" onClick={props.onHome}>
          <Codicon name="home" />
        </button>
      </div>
      <button className="cmd" aria-label="搜索" data-tip="搜索笔记、输入网址或命令" data-key={K('search') ?? undefined} data-side="below" onClick={props.onSearch}>
        <Codicon name="search" />
        <span className="ph truncate">
          {props.location ?? (
            <>
              搜索<b>{props.vaultName}</b>：笔记、PDF、命令、网址
            </>
          )}
        </span>
        {K('search') && <kbd>{K('search')}</kbd>}
      </button>
      <div className="tb-right">
        {props.web && (
          <button
            className="tb-btn tb-web"
            aria-label={webLabel}
            data-tip={props.web.where === 'center' ? '放回右栏：网页回到右栏，边看边记' : props.web.where === 'fold' ? '展开中间栏：中间那篇回来，网页回到原来的宽' : '移到中间：开成中间的宽标签，右栏空出来'}
            data-key={props.web.where === 'fold' ? (K('fold-center') ?? undefined) : undefined}
            data-side="below-left"
            data-testid="tb-web"
            onClick={props.web.onMove}
          >
            <Codicon name={props.web.where === 'center' ? 'layout-sidebar-right' : props.web.where === 'fold' ? 'screen-normal' : 'layout-centered'} />
            <span className="lb">{webLabel}</span>
          </button>
        )}
        <button className="tb-btn" aria-label={props.rightOpen ? '收起右栏' : '展开右栏'} aria-pressed={props.rightOpen} data-tip={props.rightOpen ? '收起右栏' : '展开右栏'} data-key={K('toggle-right') ?? undefined} data-side="below-left" onClick={props.onToggleRight}>
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

export function HeadBtn(props: {
  icon: CodiconName
  /** 不用 Codicon 时画这个（「问AI」画正在用的那家的标志，CN-127） */
  glyph?: React.ReactNode
  label: string
  keys?: string
  on?: boolean
  /** 正在做（新建笔记建好、读好之前） */
  busy?: boolean
  onClick(e: React.MouseEvent<HTMLButtonElement>): void
  className?: string
  children?: React.ReactNode
}) {
  return (
    <button className={'ib' + (props.on ? ' on' : '') + (props.className ? ' ' + props.className : '')} aria-label={props.label} aria-pressed={props.on} aria-busy={props.busy || undefined} data-tip={props.label} data-key={props.keys} data-side="below" onClick={props.onClick}>
      {props.glyph ?? <Codicon name={props.icon} />}
      {props.children}
    </button>
  )
}

/** 小弹出菜单（库、设置、改动、后台）：贴着点它的那个按钮，点外面关 */
export function Popover(props: {
  anchor: HTMLElement
  onClose(): void
  label: string
  children: React.ReactNode
  className?: string
  /** right：贴在点它那一行的右边（目录树里的文件夹） */
  side?: 'right'
  /** end：右边和按钮的右边对齐（标签条右端「12 ⌄」、历史头上的 ⋯） */
  align?: 'end'
  /** 离 anchor 下沿多远（默认 4） */
  gap?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const place = () => {
      const r = props.anchor.getBoundingClientRect()
      const w = el.offsetWidth
      const h = el.offsetHeight
      let left = props.align === 'end' ? r.right - w : r.left
      let top = r.bottom + (props.gap ?? 4)
      // 往下最多到底栏上沿往上 8（A 的底栏不透明，弹层压上去会盖住「库 · 分支」；task-wniqx 设计复审）
      const floor = Math.min(innerHeight, document.querySelector('.win > .status')?.getBoundingClientRect().top ?? innerHeight) - h - 8
      if (props.side === 'right') ((left = r.right + 8), (top = Math.min(r.top + r.height / 2 - h / 2, floor)))
      else if (props.anchor.closest('.abar.left')) ((left = r.right + 6), (top = Math.min(r.top, floor)))
      else if (props.anchor.closest('.abar.right')) ((left = r.left - w - 6), (top = Math.min(r.top, floor)))
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

/** glyph：不用 Codicon 时画这个（AI 那几项画跑它的那一家的标志） */
export function MenuItem(props: { icon?: CodiconName; glyph?: React.ReactNode; label: React.ReactNode; right?: React.ReactNode; onClick?(): void; disabled?: boolean; className?: string; title?: string }) {
  return (
    <button className={props.className ? `mi ${props.className}` : 'mi'} role="menuitem" disabled={props.disabled} onClick={props.onClick} title={props.title}>
      {props.glyph ?? (props.icon ? <Codicon name={props.icon} /> : <i className="mi-sp" />)}
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
  const [tip, setTip] = useState<{ text: string; key?: string; cls?: string; x: number; y: number; side: string; el: Element } | null>(null)
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
      // 图标栏上正说着「为什么变淡」的那格：不再叠一个悬停提示
      if (!el || el.hasAttribute('data-saying')) return hide()
      hide()
      const delay = Date.now() - lastHide < 600 ? 0 : 400
      timer = window.setTimeout(() => {
        if (!el.isConnected) return
        cur = el
        const r = el.getBoundingClientRect()
        const side = el.getAttribute('data-side') ?? 'below'
        // above-start：左边和它对齐（全能模式那一行在右栏底下，往两边伸会盖住右图标栏和中间栏）
        const x = side === 'right' ? r.right + 6 : side === 'left' ? r.left - 6 : side === 'below-left' || side === 'above-left' ? r.right : side === 'above-start' ? r.left : r.left + r.width / 2
        const y = side === 'right' || side === 'left' ? r.top + r.height / 2 : side.startsWith('above') ? r.top - 6 : r.bottom + 6
        setTip({ text: el.getAttribute('data-tip')!, key: el.getAttribute('data-key') ?? undefined, cls: el.getAttribute('data-tip-class') ?? undefined, x, y, side, el })
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
    let left = tip.side === 'right' || tip.side === 'above-start' ? tip.x : tip.side === 'left' ? tip.x - w : tip.side === 'below-left' || tip.side === 'above-left' ? tip.x - w : tip.x - w / 2
    const top = tip.side === 'right' || tip.side === 'left' ? tip.y - h / 2 : tip.side.startsWith('above') ? tip.y - h : tip.y
    left = Math.max(6, Math.min(left, innerWidth - w - 6))
    el.style.left = left + 'px'
    el.style.top = Math.max(4, top) + 'px'
    el.classList.add('show')
  }, [tip])
  if (!tip) return null
  return (
    <div ref={ref} className={'shell-tip' + (tip.text.length > 60 ? ' long' : '') + (tip.cls ? ' ' + tip.cls : '')} role="tooltip" data-testid="tooltip">
      {/* 字里有换行：一行一段（段间 4） */}
      {tip.text.includes('\n') ? (
        <span className="paras">
          {tip.text.split('\n').map((line, i) => (
            <span key={i} className="para">
              {line}
            </span>
          ))}
        </span>
      ) : (
        <span>{tip.text}</span>
      )}
      {tip.key && <kbd>{tip.key}</kbd>}
    </div>
  )
}
