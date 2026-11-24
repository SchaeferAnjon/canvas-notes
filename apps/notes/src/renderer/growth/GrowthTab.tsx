/**
 * 中间的「生长」标签（task-h7oy8，设计页 44「2. 生长图」方向 A，用户「全按推荐」）：Obsidian 那样的关系图加时间轴。
 * 位置一次算好不再挪（主进程后台算、存在设置目录），拖时间轴或播放时笔记按加进来的日子一颗颗亮起、线一条条长出来；
 * 停在梦游的那一晚，那晚连的线用强调色加粗、动过的笔记加圈。点一篇看它的卡片（打开笔记、只看它周围），按住 ⌘ 停在一篇上弹出那篇（peek）；
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
import { type Colors, drawGrowth, drawTimeline, readColors, type Xf } from './draw'
import { type Model, pick, radius, scene, type ViewOpts } from './model'
import { loadGrowth, setGrowth, useGrowth } from './store'
import { nightSummary as nightSummaryOf } from './GrowthSide'
import './growth.css'

/** 播放：一个有事的日子走多久（毫秒）；整段放完大约十几秒 */
const stepMs = (events: number) => Math.max(16, Math.min(90, 14_000 / Math.max(1, events)))
const nameOf = (p: string) => p.replace(/\.md$/i, '').split('/').pop()!
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
/** 文件夹太长：只留最后三层，前面写「…」（悬停看全路径） */
const shortDir = (dir: string) => {
  const s = dir.split('/')
  return s.length > 3 ? ['…', ...s.slice(-3)].join(' / ') : s.join(' / ')
}

/** 标签换走时看的那一块（回来接着看） */
const kept: { xf: Xf | null; fitKey: string } = { xf: null, fitKey: '' }

/** 测试和交付量帧率：每次画一帧记下用了多久；at：某一篇现在在窗口的哪（测试去点它） */
const perf = { frames: 0, drawMs: [] as number[], at: (_path: string): { x: number; y: number } | null => null }
;(window as unknown as { cnGrowthPerf: typeof perf }).cnGrowthPerf = perf

export function GrowthTab(props: { active: boolean; onOpen(path: string): void; onOpenReport(): void }) {
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
  const cv = useRef<HTMLCanvasElement>(null)
  const tl = useRef<HTMLCanvasElement>(null)
  const hot = useRef<HTMLDivElement>(null)
  // 换到别的标签再回来：还是走之前看的那一块（不是每次都看全部）
  const xf = useRef<Xf>(kept.xf ?? { x: 0, y: 0, k: 1 })
  const size = useRef({ w: 0, h: 0, tw: 0, th: 46 })
  const colors = useRef<Colors | null>(null)
  const fitted = useRef<string>('')
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null)
  const [menu, setMenu] = useState<PopAnchor | null>(null)
  const menuClosed = useRef(0)

  // ---------- 画 ----------
  const frame = useRef(0)
  const latest = useRef({ m, sc, view, hollow: g.hollow, playing: g.playing })
  latest.current = { m, sc, view, hollow: g.hollow, playing: g.playing }
  const paint = () => {
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const { m, sc, view, hollow, playing } = latest.current
      const c = cv.current
      if (!m || !sc || !c || size.current.w < 20) return
      const ctx = c.getContext('2d')!
      colors.current ??= readColors(pane.current!)
      const s0 = performance.now()
      const r = drawGrowth(ctx, m, sc, view, { w: size.current.w, h: size.current.h, dpr: devicePixelRatio || 1, xf: xf.current, colors: colors.current, hollow, fresh: playing })
      perf.frames++
      perf.drawMs.push(performance.now() - s0)
      if (perf.drawMs.length > 600) perf.drawMs.splice(0, 300)
      c.dataset.labels = r.labels.join('|')
      const tc = tl.current
      if (tc && size.current.tw > 20)
        drawTimeline(tc.getContext('2d')!, m, view.t, { w: size.current.tw, h: size.current.th, dpr: devicePixelRatio || 1, colors: colors.current, pad: 8, years: yearText, month: monthText })
      placeHot()
    })
  }
  useEffect(paint)
  useEffect(() => {
    perf.at = (path) => {
      const md = latest.current.m
      const i = md ? md.d.notes.findIndex((n) => n.path === path) : -1
      const r = stage.current?.getBoundingClientRect()
      if (!md || i < 0 || !r) return null
      const n = md.d.notes[i]!
      return { x: r.left + n.x * xf.current.k + xf.current.x, y: r.top + n.y * xf.current.k + xf.current.y }
    }
  }, [])

  // 换主题、换深浅色：颜色重新取
  useEffect(() => {
    const again = () => {
      colors.current = null
      paint()
    }
    const mo = new MutationObserver(again)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-skin'] })
    const mq = matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', again)
    return () => (mo.disconnect(), mq.removeEventListener('change', again))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
      cv.current!.width = Math.round(r.width * dpr)
      cv.current!.height = Math.round(r.height * dpr)
      const tr = tc.getBoundingClientRect()
      size.current.tw = tr.width
      tc.width = Math.round(tr.width * dpr)
      tc.height = Math.round(size.current.th * dpr)
      if (fitted.current === 'need') fit()
      paint()
    })
    ro.observe(s)
    ro.observe(tc)
    return () => ro.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- 看全部、看一部分 ----------
  function fitTo(ids: number[]) {
    const { w, h } = size.current
    if (!m || w < 50 || h < 50) {
      fitted.current = 'need'
      return
    }
    const xs = ids.map((i) => m.d.notes[i]!.x).sort((a, b) => a - b)
    const ys = ids.map((i) => m.d.notes[i]!.y).sort((a, b) => a - b)
    if (!xs.length) return
    // 几百篇以上：两头各去掉 1%（个别飞出去的不把整张缩成一小团）
    const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))]!
    const cut = ids.length > 200 ? 0.01 : 0
    const x0 = q(xs, cut)
    const x1 = q(xs, 1 - cut)
    const y0 = q(ys, cut)
    const y1 = q(ys, 1 - cut)
    // 给浮在画布上的几块让位：上面是左上那一天的块，下面是图例，右边开着卡片时是卡片
    const st = stage.current
    const infoH = st?.querySelector<HTMLElement>('.gr-info')?.offsetHeight ?? 90
    const legH = st?.querySelector<HTMLElement>('.gr-legend')?.offsetHeight ?? 26
    const pad = { top: 12 + infoH + 24, bottom: 12 + legH + 24, left: 24, right: st?.querySelector('.gr-card') ? 304 : 48 }
    const aw = Math.max(80, w - pad.left - pad.right)
    const ah = Math.max(80, h - pad.top - pad.bottom)
    // 最多放大 2.5 倍：几十篇的小库不铺成一张稀疏的网
    const k = Math.min(aw / Math.max(40, x1 - x0), ah / Math.max(40, y1 - y0), g.local || g.folder ? 5 : 2.5)
    xf.current = { k, x: pad.left + aw / 2 - ((x0 + x1) / 2) * k, y: pad.top + ah / 2 - ((y0 + y1) / 2) * k }
    fitted.current = 'done'
    paint()
  }
  const visibleIds = (min: 1 | 2) => (sc ? [...sc.vis].map((v, i) => (v >= min ? i : -1)).filter((i) => i >= 0) : [])
  const fit = () => m && fitTo(g.folder || view.local ? visibleIds(2) : m.d.notes.map((_, i) => i))
  // 第一次有数据、换了文件夹、进出「只看周围」：看全这一部分
  const fitKey = m ? `${m.d.notes.length}|${g.folder}|${view.local ? g.sel : ''}` : ''
  const fitKeyNow = useRef(fitKey)
  fitKeyNow.current = fitKey
  useEffect(() => {
    if (!m) return
    if (kept.xf && kept.fitKey === fitKey) {
      kept.xf = null
      fitted.current = 'done'
      return paint()
    }
    fit()
  }, [fitKey]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(
    () => () => {
      kept.xf = xf.current
      kept.fitKey = fitKeyNow.current
    },
    [],
  )

  function zoomAt(f: number, cx = size.current.w / 2, cy = size.current.h / 2) {
    const o = xf.current
    const k = Math.max(0.05, Math.min(40, o.k * f))
    const r = k / o.k
    xf.current = { k, x: cx - (cx - o.x) * r, y: cy - (cy - o.y) * r }
    paint()
  }
  function centerOn(i: number) {
    if (!m) return
    const n = m.d.notes[i]!
    const o = xf.current
    xf.current = { k: o.k, x: size.current.w / 2 - n.x * o.k, y: size.current.h / 2 - n.y * o.k }
    paint()
  }

  // ---------- 鼠标 ----------
  const at = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect()
    const sx = e.clientX - r.left
    const sy = e.clientY - r.top
    const o = xf.current
    return { sx, sy, x: (sx - o.x) / o.k, y: (sy - o.y) / o.k }
  }
  const pickAt = (e: { clientX: number; clientY: number }) => {
    if (!m || !sc) return -1
    const p = at(e)
    return pick(m, sc, p.x, p.y, Math.max(10, 14) / xf.current.k)
  }
  /** 悬停的那篇上面垫一块看不见的：按住 ⌘ 停在上面时 peek 认它（data-peek-wiki），弹出那一篇 */
  function placeHot() {
    const h = hot.current
    const hv = hoverRef.current
    if (!h) return
    if (!m || !sc || !hv || !sc.vis[hv.i]) {
      h.hidden = true
      return
    }
    const n = m.d.notes[hv.i]!
    const o = xf.current
    const r = radius(sc.deg[hv.i]!, o.k) + 6
    h.hidden = false
    h.style.left = `${n.x * o.k + o.x - r}px`
    h.style.top = `${n.y * o.k + o.y - r}px`
    h.style.width = h.style.height = `${2 * r}px`
    h.dataset.peekWiki = n.path.replace(/\.md$/i, '')
    h.dataset.path = n.path
  }
  const hoverRef = useRef(hover)
  hoverRef.current = hover

  function onMove(e: React.PointerEvent) {
    if (e.buttons) return
    const i = pickAt(e)
    const p = at(e)
    setHover(i >= 0 ? { i, x: p.sx, y: p.sy } : null)
    hoverRef.current = i >= 0 ? { i, x: p.sx, y: p.sy } : null
    placeHot()
  }

  function onDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    pane.current?.focus({ preventScroll: true })
    const sx = e.clientX
    const sy = e.clientY
    const o0 = { ...xf.current }
    let moved = false
    stage.current?.classList.add('grabbing')
    trackDrag(e.nativeEvent, {
      move(ev) {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 4) return
        moved = true
        setHover(null)
        xf.current = { k: o0.k, x: o0.x + ev.clientX - sx, y: o0.y + ev.clientY - sy }
        paint()
      },
      end(how, ev) {
        stage.current?.classList.remove('grabbing')
        if (moved || how !== 'up' || !ev) return
        const i = pickAt(ev)
        if (i < 0) return setGrowth({ sel: null, local: false })
        // ⌘ 点：直接打开（和链接一样）
        if (ev.metaKey || ev.ctrlKey) return props.onOpen(m!.d.notes[i]!.path)
        setGrowth({ sel: m!.d.notes[i]!.path })
      },
    })
  }

  // 滚轮平移，捏合和 ⌘ 滚轮缩放（同白板）
  useEffect(() => {
    const s = stage.current
    if (!s) return
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const r = s.getBoundingClientRect()
        zoomAt(Math.exp(-Math.max(-10, Math.min(10, e.deltaY)) * 0.02), e.clientX - r.left, e.clientY - r.top)
      } else {
        xf.current = { ...xf.current, x: xf.current.x - e.deltaX, y: xf.current.y - e.deltaY }
        paint()
      }
    }
    s.addEventListener('wheel', wheel, { passive: false })
    return () => s.removeEventListener('wheel', wheel)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- 时间 ----------
  const setT = (d: number, nightToo = false) => m && setGrowth({ t: Math.max(m.start, Math.min(m.end, d)), night: nightToo ? d : null })
  useEffect(() => {
    if (!g.playing || !m) return
    let cur = g.t ?? m.end
    if (cur >= m.end) cur = m.start
    setGrowth({ t: cur, night: null })
    const timer = setInterval(() => {
      const next = m.events.find((d) => d > cur)
      if (next === undefined) {
        setGrowth({ playing: false, t: m.end })
        return
      }
      cur = next
      setGrowth({ t: cur })
    }, stepMs(m.events.length))
    return () => clearInterval(timer)
  }, [g.playing, m]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const r = e.currentTarget.getBoundingClientRect()
    const tx = (d: number) => r.left + 8 + ((d - m.start) / Math.max(1, m.end - m.start)) * (r.width - 16)
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
      if (g.local) setGrowth({ local: false })
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
      <div ref={stage} className="gr-stage" onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => (setHover(null), (hoverRef.current = null), placeHot())} onDoubleClick={(e) => {
        const i = pickAt(e)
        if (i >= 0 && m) props.onOpen(m.d.notes[i]!.path)
      }}>
        <canvas
          ref={cv}
          className="gr-cv"
          data-testid="growth-canvas"
          role="img"
          aria-label={sc && m ? t('{day}：{notes}篇笔记、{links}条链接', { day: dayText(t0, m.end, true), notes: sc.notes, links: sc.links }) : t('生长图')}
          data-day={m ? t0 : ''}
          data-notes={sc?.notes ?? 0}
          data-links={sc?.links ?? 0}
          data-shown={sc ? sc.vis.reduce((s, v) => s + (v ? 1 : 0), 0) : 0}
          data-night={night ? night.day : ''}
        />
        <div ref={hot} className="gr-hot" hidden data-testid="growth-hot" />
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
              {t('{n}条链接', { n: nbrs.length })}
              {nbrs.some((x) => x.l.dream) ? t('，其中{n}条是梦游连的', { n: nbrs.filter((x) => x.l.dream).length }) : ''}
            </p>
            {nbrs.length > 0 && (
              <ul>
                {nbrs.slice(0, 8).map((x) => (
                  <li key={x.j}>
                    <button
                      onClick={() => {
                        setGrowth({ sel: d.notes[x.j]!.path })
                        centerOn(x.j)
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
          <button className="iconbtn" aria-label={t('放大')} data-tip={t('放大')} onClick={() => zoomAt(1.5)}>
            <Codicon name="add" size={14} />
          </button>
          <button className="iconbtn" aria-label={t('缩小')} data-tip={t('缩小')} onClick={() => zoomAt(1 / 1.5)}>
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
