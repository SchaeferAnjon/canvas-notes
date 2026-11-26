/**
 * 中间的「生长」标签（task-h7oy8，设计页 44「2. 生长图」方向 A；动效 2026-11-25 换成设计页 154 版本 A：force-graph + Motion，graph.ts）：
 * Obsidian 那样的关系图加时间轴。位置还是主进程后台算好的那一份；拖时间轴或播放时笔记按加进来的日子一颗颗从连着的那篇旁边弹出来、
 * 线沿弯线伸过去，一边长一边排回自己的位置；每次打开这个标签先从头长一遍（几秒，能暂停、点「现在」或 Esc 跳过）。
 * 拖点、拖画布、滚轮 / 双指缩放；点一篇：别的淡下去、镜头飞近它和连着的、出它的卡片（连着几篇、打开笔记、只看它周围），点空白处回去。
 * 停在梦游的那一晚，那晚连的线用强调色加粗、动过的笔记加圈。按住 ⌘ 停在一篇上弹出那篇（peek）；
 * 标签条右端「全库 ▾」只看一个文件夹、「估的画空心」；画布底下是时间轴和「跳到」。
 * 左栏梦游报告的「生长」看法列每一晚，点一晚这里跳过去（store.ts 共用一份状态）。
 */
import { Codicon } from '@cn/design'
import { trackDrag } from '@cn/design/drag-end'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { list, t } from '../../shared/i18n'
import { ActBtn, TabActs } from '../shell/TabActs'
import { SelMenu } from '../multi-select/SelMenu'
import { anchorOf, type PopAnchor } from '../pop-place'
import { keyFor } from '../keys'
import { dayText, monthText, weekText, yearText } from './dates'
import { drawTimeline, readColors } from './draw'
import { GrowthGraph } from './graph'
import { scene, type ViewOpts } from './model'
import { onThemeChange, reducedMotion } from './paint'
import { loadGrowth, setGrowth, useGrowth } from './store'
import { nightSummary as nightSummaryOf } from './GrowthSide'
import './growth.css'

/** 从头长一遍要多久（秒）：有事的日子越多越长，2.5 到 6 秒 */
const growSeconds = (events: number) => Math.max(2.5, Math.min(6, events * 0.12))
const nameOf = (p: string) => p.replace(/\.md$/i, '').split('/').pop()!
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
/** 文件夹太长：只留最后三层，前面写「…」（悬停看全路径） */
const shortDir = (dir: string) => {
  const s = dir.split('/')
  return s.length > 3 ? ['…', ...s.slice(-3)].join(' / ') : s.join(' / ')
}

/** 标签换走时看的那一块（回来接着看）；哪几个标签已经从头长过一遍了 */
const kept: { cam: { k: number; x: number; y: number } | null; fitKey: string } = { cam: null, fitKey: '' }
const grown = new Set<string>()

/**
 * 测试和交付量帧率：每次画一帧记下用了多久；at：某一篇现在在窗口的哪（测试去点它）；zoom：现在放大几倍；
 * points：看得见的每一篇在窗口的哪（找空白处）；dimmed：上一帧淡下去的有几篇（选中一篇时）
 */
const perf = {
  frames: 0,
  drawMs: [] as number[],
  dimmed: 0,
  at: (_path: string): { x: number; y: number } | null => null,
  zoom: (): number => 0,
  points: (): { x: number; y: number }[] => [],
}
;(window as unknown as { cnGrowthPerf: typeof perf }).cnGrowthPerf = perf

export function GrowthTab(props: { tabId: string; active: boolean; onOpen(path: string): void; onOpenReport(): void }) {
  const g = useGrowth()
  const m = g.model
  useEffect(() => {
    if (props.active) loadGrowth()
  }, [props.active])
  const t0 = m ? (g.t ?? m.end) : 0
  const selIdx = useMemo(() => (m && g.sel ? m.d.notes.findIndex((n) => n.path === g.sel) : -1), [m, g.sel])
  // 停在某一晚是点出来的（左栏点一晚、点时间轴上那根竖线、「梦游后」、报告顶上的小图），拖时间轴、播放、跳到别处就不停在那晚了
  const night = m && g.night !== null && g.night === t0 ? (m.nightByDay.get(g.night) ?? null) : null
  const view: ViewOpts = { t: t0, folder: g.folder, sel: selIdx, local: g.local && selIdx >= 0, night }
  const sc = useMemo(() => (m ? scene(m, view) : null), [m, t0, g.folder, selIdx, view.local, night]) // eslint-disable-line react-hooks/exhaustive-deps

  const pane = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const tl = useRef<HTMLCanvasElement>(null)
  const hot = useRef<HTMLDivElement>(null)
  const graph = useRef<GrowthGraph | null>(null)
  const size = useRef({ w: 0, h: 0, tw: 0, th: 46 })
  const fitted = useRef<string>('')
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const hoverRef = useRef(hover)
  hoverRef.current = hover
  const [menu, setMenu] = useState<PopAnchor | null>(null)
  const menuClosed = useRef(0)
  const latest = useRef({ m, sc, view })
  latest.current = { m, sc, view }
  const fitKey = m ? `${m.d.notes.length}|${g.folder}|${view.local ? g.sel : ''}` : ''
  const fitKeyNow = useRef(fitKey)
  fitKeyNow.current = fitKey
  const pointer = useRef({ x: 0, y: 0 })

  // 按住 ⌘ 停在一篇上弹出那篇：悬停那块平时不接鼠标（不挡拖点、点选），按下 ⌘ 时才接，再替它报一次「指着这里」给 peek
  const metaDown = useRef(false)
  function armHot() {
    const h = hot.current
    if (!h || h.hidden || !metaDown.current) return
    h.classList.add('on')
    h.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: pointer.current.x, clientY: pointer.current.y, metaKey: true }))
  }
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if ((e.key !== 'Meta' && e.key !== 'Control') || e.repeat) return
      metaDown.current = true
      armHot()
    }
    const up = (e?: KeyboardEvent) => {
      if (e && e.key !== 'Meta' && e.key !== 'Control') return
      metaDown.current = false
      hot.current?.classList.remove('on')
    }
    const blur = () => up()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => (window.removeEventListener('keydown', down), window.removeEventListener('keyup', up), window.removeEventListener('blur', blur))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- 图：force-graph 一份，跟着标签活着 ----------
  useLayoutEffect(() => {
    const el = host.current!
    let lastClick = { i: -1, at: 0 }
    const gr = new GrowthGraph(el, {
      click(i, ev) {
        const md = latest.current.m
        if (!md) return
        const path = md.d.notes[i]!.path
        // ⌘ 点、双击：直接打开（和链接一样）
        const dbl = lastClick.i === i && performance.now() - lastClick.at < 400
        lastClick = { i, at: performance.now() }
        if (ev.metaKey || ev.ctrlKey || dbl) return props.onOpen(path)
        pane.current?.focus({ preventScroll: true })
        setGrowth({ sel: path })
      },
      background() {
        pane.current?.focus({ preventScroll: true })
        setGrowth({ sel: null, local: false })
      },
      hover(i) {
        const p = i === null ? null : gr.screenOf(i)
        const hv = i === null || !p ? null : { i, x: p.x, y: p.y }
        hoverRef.current = hv
        setHover(hv)
        placeHot()
        if (hv) armHot()
        else hot.current?.classList.remove('on')
      },
      frame(ms, labels, dimmed) {
        perf.dimmed = dimmed
        perf.frames++
        perf.drawMs.push(ms)
        if (perf.drawMs.length > 600) perf.drawMs.splice(0, 300)
        const joined = labels.join('|')
        if (el.dataset.labels !== joined) el.dataset.labels = joined
        placeHot()
      },
    })
    graph.current = gr
    perf.at = (path) => {
      const md = latest.current.m
      const i = md ? md.d.notes.findIndex((n) => n.path === path) : -1
      const r = host.current?.getBoundingClientRect()
      const p = i >= 0 ? gr.screenOf(i) : null
      return p && r ? { x: r.left + p.x, y: r.top + p.y } : null
    }
    perf.zoom = () => gr.camera().k
    perf.points = () => {
      const r = host.current?.getBoundingClientRect()
      return r ? gr.screenAll().map((p) => ({ x: r.left + p.x, y: r.top + p.y })) : []
    }
    return () => {
      kept.cam = gr.camera()
      kept.fitKey = fitKeyNow.current
      gr.dispose()
      graph.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => graph.current?.active(props.active), [props.active])

  // 颜色（换主题、换深浅色重新取）
  const colorsFor = () => {
    const gr = graph.current
    if (gr && pane.current) gr.colors = readColors(pane.current)
  }
  useEffect(
    () =>
      onThemeChange(() => {
        colorsFor()
        if (latest.current.sc) graph.current?.restyle(latest.current.sc, latest.current.view)
        paintTimeline()
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  )
  // 数据、这一刻看什么变了：交给图
  useEffect(() => {
    const gr = graph.current
    if (!gr || !m || !sc) return
    if (!gr.colors) colorsFor()
    gr.hollow = g.hollow
    gr.setModel(m)
    gr.update(sc, view, { playing: g.playing })
    gr.restyle(sc, view)
    paintTimeline()
  }) // eslint-disable-line react-hooks/exhaustive-deps

  /** 悬停的那篇上面垫一块看不见的：按住 ⌘ 停在上面时 peek 认它（data-peek-wiki），弹出那一篇 */
  function placeHot() {
    const h = hot.current
    const hv = hoverRef.current
    const { m, sc } = latest.current
    if (!h) return
    const p = hv && m && sc && sc.vis[hv.i] ? graph.current?.screenOf(hv.i) : null
    if (!hv || !m || !p) {
      if (!h.hidden) h.hidden = true
      return
    }
    const n = m.d.notes[hv.i]!
    const r = 12
    h.hidden = false
    h.style.left = `${p.x - r}px`
    h.style.top = `${p.y - r}px`
    h.style.width = h.style.height = `${2 * r}px`
    h.dataset.peekWiki = n.path.replace(/\.md$/i, '')
    h.dataset.path = n.path
  }

  function paintTimeline() {
    const { m } = latest.current
    const tc = tl.current
    if (!m || !tc || size.current.tw < 20 || !pane.current) return
    drawTimeline(tc.getContext('2d')!, m, latest.current.view.t, { w: size.current.tw, h: size.current.th, dpr: devicePixelRatio || 1, colors: readColors(pane.current), pad: 8, years: yearText, month: monthText })
  }

  // 大小：画布跟着岛走
  useLayoutEffect(() => {
    const s = stage.current
    const tc = tl.current
    if (!s || !tc) return
    const ro = new ResizeObserver(() => {
      const dpr = devicePixelRatio || 1
      const r = s.getBoundingClientRect()
      size.current.w = r.width
      size.current.h = r.height
      graph.current?.size(r.width, r.height)
      const tr = tc.getBoundingClientRect()
      size.current.tw = tr.width
      tc.width = Math.round(tr.width * dpr)
      tc.height = Math.round(size.current.th * dpr)
      if (fitted.current === 'need') fit()
      paintTimeline()
    })
    ro.observe(s)
    ro.observe(tc)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- 看全部、看一部分 ----------
  /** 给浮在画布上的几块让位：上面是左上那一天的块，下面是图例，右边开着卡片时是卡片 */
  const padding = () => {
    const st = stage.current
    const infoH = st?.querySelector<HTMLElement>('.gr-info')?.offsetHeight ?? 90
    const legH = st?.querySelector<HTMLElement>('.gr-legend')?.offsetHeight ?? 26
    return { top: 12 + infoH + 24, bottom: 12 + legH + 24, left: 24, right: st?.querySelector('.gr-card') || latest.current.view.sel >= 0 ? 304 : 48 }
  }
  function fitTo(ids: number[], maxK = g.local || g.folder ? 5 : 2.5, ms = 0) {
    const { w, h } = size.current
    if (!m || w < 50 || h < 50 || !graph.current) {
      fitted.current = 'need'
      return
    }
    if (!ids.length) return
    // 最多放大 2.5 倍：几十篇的小库不铺成一张稀疏的网
    graph.current.fit(ids, padding(), maxK, ms)
    fitted.current = 'done'
  }
  const visibleIds = (min: 1 | 2) => (sc ? [...sc.vis].map((v, i) => (v >= min ? i : -1)).filter((i) => i >= 0) : [])
  const fit = () => m && fitTo(g.folder || view.local ? visibleIds(2) : m.d.notes.map((_, i) => i))
  // 第一次有数据、换了文件夹、进出「只看周围」：看全这一部分
  useEffect(() => {
    if (!m) return
    if (kept.cam && kept.fitKey === fitKey) {
      graph.current?.setCamera(kept.cam)
      kept.cam = null
      fitted.current = 'done'
      return
    }
    fit()
  }, [fitKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // 点一篇：镜头飞近它和连着的（别的淡下去在 draw.ts）；不选了：回到点之前看的那一块
  const beforeSel = useRef<{ k: number; x: number; y: number } | null>(null)
  const prevSel = useRef(selIdx)
  useEffect(() => {
    const gr = graph.current
    const was = prevSel.current
    prevSel.current = selIdx
    if (!gr || !m || !sc || view.local) return
    if (selIdx >= 0 && selIdx !== was) {
      if (was < 0) beforeSel.current = gr.camera()
      const ids = [selIdx]
      for (const e of m.adj[selIdx]!) {
        const l = m.d.links[e]!
        const j = l.a === selIdx ? l.b : l.a
        if (sc.vis[j]) ids.push(j)
      }
      requestAnimationFrame(() => fitTo(ids, 4, 600))
    } else if (selIdx < 0 && was >= 0 && beforeSel.current) {
      gr.setCamera(beforeSel.current, 500)
      beforeSel.current = null
    }
  }, [selIdx]) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- 时间：播放按「有事的日子」走，从头到尾 2.5 到 6 秒 ----------
  const setT = (d: number, nightToo = false) => m && setGrowth({ t: Math.max(m.start, Math.min(m.end, d)), night: nightToo ? d : null })
  useEffect(() => {
    if (!g.playing || !m || !m.events.length) return
    let from = g.t ?? m.end
    if (from >= m.end) from = m.start
    const k0 = Math.max(0, m.events.findIndex((d) => d >= from))
    const span = growSeconds(m.events.length) * 1000 * ((m.events.length - k0) / m.events.length)
    const begin = performance.now()
    let last = -1
    let lastAt = 0
    setGrowth({ t: from, night: null })
    let raf = 0
    const step = (now: number) => {
      const f = Math.min(1, (now - begin) / Math.max(1, span))
      if (f >= 1) return setGrowth({ playing: false, t: m.end })
      const k = Math.min(m.events.length - 1, k0 + Math.floor(f * (m.events.length - k0)))
      // 几千篇时一秒换十几次就够（每换一次要重算这一刻看见哪些）
      if (k !== last && now - lastAt > (m.d.notes.length > 1500 ? 60 : 30)) {
        last = k
        lastAt = now
        setGrowth({ t: m.events[k]! })
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [g.playing, m]) // eslint-disable-line react-hooks/exhaustive-deps
  // 每次打开这个标签先从头长一遍（停在某一晚、选着一篇、减弱动态时不长）
  useEffect(() => {
    if (!m || !props.active || grown.has(props.tabId)) return
    grown.add(props.tabId)
    if (g.t !== null || g.night !== null || g.sel || reducedMotion() || !m.d.notes.length) return
    setGrowth({ t: m.start, playing: true })
  }, [m, props.active]) // eslint-disable-line react-hooks/exhaustive-deps

  function scrubAt(clientX: number) {
    if (!m || !tl.current) return
    const r = tl.current.getBoundingClientRect()
    const f = (clientX - r.left - 8) / Math.max(1, r.width - 16)
    setT(Math.round(m.start + f * (m.end - m.start)))
  }
  function onTimeline(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.button !== 0 || !m) return
    setGrowth({ playing: false })
    // 点在梦游那一晚的小竖线上：停到那一晚
    const near = nightNear(e.currentTarget, e.clientX, e.clientY)
    if (near) return setT(near.day, true)
    scrubAt(e.clientX)
    trackDrag(e.nativeEvent, { move: (ev) => scrubAt(ev.clientX) })
  }
  /** 时间轴上鼠标附近（左右 6 以内、竖线那一条高度上）的那一晚 */
  function nightNear(c: HTMLCanvasElement, x: number, y: number) {
    if (!m) return null
    const r = c.getBoundingClientRect()
    if (y < r.bottom - 24) return null
    const tx = (d: number) => r.left + 8 + ((d - m.start) / Math.max(1, m.end - m.start)) * (r.width - 16)
    return m.d.nights.filter((n) => Math.abs(tx(n.day) - x) <= 6).sort((a, b) => Math.abs(tx(a.day) - x) - Math.abs(tx(b.day) - x))[0] ?? null
  }
  const [tlTip, setTlTip] = useState<{ x: number; text: string } | null>(null)
  function onTimelineMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (e.buttons || !m) return
    const n = nightNear(e.currentTarget, e.clientX, e.clientY)
    const r = e.currentTarget.getBoundingClientRect()
    setTlTip(n ? { x: e.clientX - r.left, text: `${dayText(n.day, m.end)} ${weekText(n.day)} · ${nightSummaryOf(m, n)}` } : null)
  }

  function onKey(e: React.KeyboardEvent) {
    // ⇧⌘1 看全部（同白板的「适合窗口」）
    if (e.key === '1' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      return fit()
    }
    if (!m || (e.target as HTMLElement).closest('input, textarea, button, [role="menu"]')) return
    if (e.key === ' ') {
      e.preventDefault()
      setGrowth({ playing: !g.playing })
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const next = e.key === 'ArrowRight' ? m.events.find((d) => d > t0) : [...m.events].reverse().find((d) => d < t0)
      if (next !== undefined) setGrowth({ t: next, playing: false, night: null })
    } else if (e.key === 'Escape') {
      // 正在长：跳过，直接到现在
      if (g.playing) setGrowth({ playing: false, t: null, night: null })
      else if (g.local) setGrowth({ local: false })
      else if (g.sel) setGrowth({ sel: null })
      else return
      e.preventDefault()
    }
  }

  // 跳到：第一个月、半年后、最近一晚梦游前后、现在
  const lastNight = m ? ([...m.d.nights].reverse().find((n) => n.src === 'dream') ?? m.d.nights[m.d.nights.length - 1]) : undefined
  const jumps: { k: string; label: string; day: number; night?: boolean }[] = m
    ? [
        { k: 'first', label: t('第一个月'), day: Math.min(m.end, m.start + 30) },
        ...(m.end - m.start > 240 ? [{ k: 'half', label: t('半年后'), day: m.start + 182 }] : []),
        ...(lastNight ? [{ k: 'before', label: t('梦游前'), day: Math.max(m.start, lastNight.day - 1) }, { k: 'after', label: t('梦游后'), day: lastNight.day, night: true }] : []),
        { k: 'now', label: t('现在'), day: m.end },
      ]
    : []

  // ---------- 字 ----------
  const d = m?.d
  const firstImport = d?.imports.length ? Math.min(...d.imports.map((x) => x.day)) : null
  const sel = selIdx >= 0 && d ? d.notes[selIdx]! : null
  const nbrs = useMemo(() => {
    if (!m || selIdx < 0) return []
    return m.adj[selIdx]!.map((e) => m.d.links[e]!)
      .filter((l) => l.day <= t0)
      .map((l) => ({ j: l.a === selIdx ? l.b : l.a, l }))
      .filter((x) => m.d.notes[x.j]!.born <= t0)
      .sort((a, b) => a.l.day - b.l.day)
  }, [m, selIdx, t0])
  const areaColor = (i: number) => {
    const c = d?.areas[d.notes[i]!.area]?.color ?? -1
    return c >= 0 ? `var(--mm-b${[5, 4, 0][c]})` : 'var(--t3)'
  }
  const bornWhy = (i: number) => {
    const f = d!.notes[i]!.from
    if (f === 'git') return t('Git 记的')
    if (f === 'prop') return t('估的：取自属性里的日期')
    if (f === 'name') return t('估的：取自文件名里的日期')
    if (f === 'mtime') return t('估的：没写创建日期，取了文件修改时间')
    return t('还没提交，取了文件建的时间')
  }
  const legend = d ? d.areas.filter((a) => a.color >= 0) : []
  const hasOther = !!d?.areas.some((a) => a.color < 0 && a.count > 0)
  /** 「别的」指哪些：最大的两个灰色顶层文件夹 */
  const grey = d ? d.areas.filter((a) => a.color < 0 && a.dir) : []
  const otherNames = list(grey.slice(0, 2).map((a) => a.name)) + (grey.length > 2 ? '…' : '')

  return (
    <section ref={pane} className="pane growth" data-testid="growth-tab" tabIndex={-1} onKeyDown={onKey} data-cite-base="">
      <TabActs active={props.active}>
        <button
          className={'ab-act wt gr-folder' + (g.folder ? ' on' : '')}
          aria-label={t('只看一个文件夹')}
          data-tip={t('只看一个文件夹')}
          data-side="below"
          aria-expanded={!!menu}
          data-testid="growth-folder"
          onClick={(e) => {
            if (Date.now() - menuClosed.current < 250) return
            setMenu(menu ? null : anchorOf(e.currentTarget))
          }}
        >
          <Codicon name="folder" size={16} />
          <span className="lb">{g.folder ? `${g.folder.split('/').pop()} · ${m?.folders.find((f) => f.dir === g.folder)?.count ?? ''}` : t('全库')}</span>
          <Codicon name="chevron-down" size={12} />
        </button>
        <ActBtn icon="circle-large" label={t('估的画空心')} text on={g.hollow} onClick={() => setGrowth({ hollow: !g.hollow })} />
      </TabActs>
      {menu && m && (
        <SelMenu
          at={menu}
          label={t('只看一个文件夹')}
          testid="growth-folders"
          rows={[{ v: '', label: t('全库 · {n}篇', { n: d!.notes.length.toLocaleString() }), icon: 'graph-scatter' }, 'sep', ...m.folders.map((f) => ({ v: f.dir, label: `${'　'.repeat(f.dir.split('/').length - 1)}${f.dir.split('/').pop()} · ${f.count}` }))]}
          onPick={(v) => {
            setMenu(null)
            setGrowth({ folder: v, local: false })
          }}
          onClose={() => {
            menuClosed.current = Date.now()
            setMenu(null)
          }}
        />
      )}
      <div ref={stage} className="gr-stage" onPointerMove={(e) => (pointer.current = { x: e.clientX, y: e.clientY })} onPointerLeave={() => (setHover(null), (hoverRef.current = null), placeHot())}>
        <div
          ref={host}
          className="gr-cv"
          data-testid="growth-canvas"
          role="img"
          aria-label={sc && m ? t('{day}：{notes}篇笔记、{links}条链接', { day: dayText(t0, m.end, true), notes: sc.notes, links: sc.links }) : t('生长图')}
          data-day={m ? t0 : ''}
          data-notes={sc?.notes ?? 0}
          data-links={sc?.links ?? 0}
          data-shown={sc ? sc.vis.reduce((s, v) => s + (v ? 1 : 0), 0) : 0}
          data-night={night ? night.day : ''}
          data-sel={sel ? sel.path : ''}
          data-playing={g.playing ? '1' : ''}
        />
        <div ref={hot} className="gr-hot" hidden data-testid="growth-hot" onClick={(e) => (e.metaKey || e.ctrlKey) && hot.current?.dataset.path && props.onOpen(hot.current.dataset.path)} />
        {hover && d && sc && !g.playing && hover.i !== selIdx && (
          <div className="gr-tip" style={{ left: Math.min(hover.x + 14, size.current.w - 300), top: hover.y + 14 }} data-testid="growth-tip">
            <b>{nameOf(d.notes[hover.i]!.path)}</b>
            <span>
              {[shortDir(dirOf(d.notes[hover.i]!.path)) || t('库的最外层'), dayText(d.notes[hover.i]!.born, d.today) + (d.notes[hover.i]!.est ? t('（估）') : ''), t('{n}条链接', { n: sc.deg[hover.i]! })].join(' · ')}
            </span>
            <em>{t('⌘ 停住看内容 · 双击打开')}</em>
          </div>
        )}
        {m && sc && (
          <div className="gr-info" data-testid="growth-info">
            <h2 className="num">{dayText(t0, m.end, true)}</h2>
            <div className="wk">
              {weekText(t0)}
              {night ? ` · ${night.src === 'dream' ? t('梦游的一晚') : t('整理的一晚')}` : ''}
              {firstImport !== null && t0 < firstImport ? ` · ${t('导入前的时间是估的')}` : ''}
            </div>
            <div className="stats num">
              <span>
                {g.folder ? t('{folder} 里', { folder: g.folder.split('/').pop()! }) : view.local && sel ? t('它周围') : ''}
                <b>{sc.notes.toLocaleString()}</b>
                {t('篇笔记')}
              </span>
              <span>
                <b>{sc.links.toLocaleString()}</b>
                {t('条链接')}
                {sc.dreamLinks ? t('，{n}条是梦游连的', { n: sc.dreamLinks.toLocaleString() }) : ''}
              </span>
            </div>
            {night && night.touched.length > 0 && (
              <button className="gr-these" data-testid="growth-these" onClick={() => fitTo(night.touched)}>
                {t('这晚动了{n}篇 · 看这几篇', { n: night.touched.length })}
              </button>
            )}
          </div>
        )}
        {m && (
          <div className="gr-legend" data-testid="growth-legend">
            {legend.map((a) => (
              <span key={a.dir}>
                <i style={{ background: `var(--mm-b${[5, 4, 0][a.color]})` }} />
                {a.name}
              </span>
            ))}
            {hasOther && (
              <span>
                <i className="other" />
                {legend.length ? t('别的（{names}）', { names: otherNames }) : t('笔记')}
              </span>
            )}
            <span>
              <i className="ln" />
              {t('正文里的链接')}
            </span>
            <span>
              <i className="ln acc" />
              {t('梦游连的')}
            </span>
            {g.hollow && d!.notes.some((n) => n.est) && (
              <span>
                <i className="ring" />
                {t('空心：时间是估的')}
              </span>
            )}
            <span>{t('点越大链接越多')}</span>
          </div>
        )}
        {sel && d && sc && (
          <div className="gr-card" data-testid="growth-card" onPointerDown={(e) => e.stopPropagation()}>
            <h3>{nameOf(sel.path)}</h3>
            <p className="where" data-tip={dirOf(sel.path) || undefined}>
              {shortDir(dirOf(sel.path)) || t('库的最外层')}
            </p>
            <p>
              {t('{day}加进来', { day: dayText(sel.born, d.today) })}
              <span className="why">{`（${bornWhy(selIdx)}）`}</span>
            </p>
            <p>
              {t('连着{n}篇', { n: nbrs.length })}
              {nbrs.some((x) => x.l.dream) ? t('，其中{n}条是梦游连的', { n: nbrs.filter((x) => x.l.dream).length }) : ''}
            </p>
            {nbrs.length > 0 && (
              <ul>
                {nbrs.slice(0, 8).map((x) => (
                  <li key={x.j}>
                    <button
                      onClick={() => {
                        setGrowth({ sel: d.notes[x.j]!.path })
                      }}
                    >
                      <i className="dot" style={{ background: areaColor(x.j) }} />
                      <span className="nm">{nameOf(d.notes[x.j]!.path)}</span>
                      <span className="s num">{(x.l.dream ? t('梦游') + ' · ' : '') + dayText(x.l.day, d.today)}</span>
                    </button>
                  </li>
                ))}
                {nbrs.length > 8 && <li className="more">{t('还有{n}篇', { n: nbrs.length - 8 })}</li>}
              </ul>
            )}
            <div className="btns">
              <button className="btn btn-sm" onClick={() => props.onOpen(sel.path)}>
                <Codicon name="go-to-file" size={14} />
                {t('打开笔记')}
              </button>
              <button className={'btn btn-sm' + (g.local ? ' on' : '')} aria-pressed={g.local} onClick={() => setGrowth({ local: !g.local })}>
                <Codicon name="target" size={14} />
                {g.local ? t('回到全库') : t('只看它周围')}
              </button>
              <span className="sp" />
              <button className="iconbtn" aria-label={t('不选这篇')} onClick={() => setGrowth({ sel: null, local: false })}>
                <Codicon name="close" size={14} />
              </button>
            </div>
          </div>
        )}
        <div className="gr-zoom">
          <button className="iconbtn" aria-label={t('放大')} data-tip={t('放大')} onClick={() => graph.current?.zoomBy(1.5)}>
            <Codicon name="add" size={14} />
          </button>
          <button className="iconbtn" aria-label={t('缩小')} data-tip={t('缩小')} onClick={() => graph.current?.zoomBy(1 / 1.5)}>
            <Codicon name="remove" size={14} />
          </button>
          <button className="iconbtn gr-all" aria-label={t('看全部')} data-tip={t('看全部')} data-key={keyFor('zoom-fit') ?? undefined} onClick={fit}>
            {t('全', { ctx: '生长图看全部' })}
          </button>
        </div>
        {!m && (
          <div className="gr-empty" data-testid="growth-empty">
            {g.state.error ? t('生长图没算出来：{e}', { e: g.state.error }) : t('正在读库的历史、摆位置…几千篇的库要几秒')}
          </div>
        )}
        {m && m.d.notes.length === 0 && <div className="gr-empty">{t('库里还没有笔记。写几篇、或者导入已有的笔记，这里就会长出来')}</div>}
        {m && g.state.building && <div className="gr-busy">{t('库变了，正在重算…')}</div>}
      </div>
      <div className="gr-foot">
        <button className="gr-play" aria-label={g.playing ? t('暂停') : t('播放')} data-testid="growth-play" onClick={() => setGrowth({ playing: !g.playing })} disabled={!m}>
          <Codicon name={g.playing ? 'debug-pause' : 'play'} size={16} />
        </button>
        <div className="gr-tlbox">
          <canvas ref={tl} className="gr-tl" data-testid="growth-timeline" aria-label={t('时间轴')} onPointerDown={onTimeline} onPointerMove={onTimelineMove} onPointerLeave={() => setTlTip(null)} />
          {tlTip && (
            <div className="gr-tltip" style={{ left: tlTip.x }} data-testid="growth-tl-tip">
              {tlTip.text}
            </div>
          )}
        </div>
        <div className="gr-jumps" data-testid="growth-jumps">
          <span>{t('跳到')}</span>
          {jumps.map((j) => (
            <button key={j.k} className={j.day === t0 && !!j.night === !!night ? 'on' : ''} onClick={() => setGrowth({ t: j.day, playing: false, night: j.night ? j.day : null })}>
              {j.label}
            </button>
          ))}
          {night?.report && (
            <button className="gr-report" onClick={props.onOpenReport}>
              <Codicon name="wand" size={12} />
              {t('看这晚的报告')}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
