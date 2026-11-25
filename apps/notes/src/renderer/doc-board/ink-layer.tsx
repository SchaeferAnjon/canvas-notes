/**
 * 白板笔迹层（方案 B「白板笔迹层」，2026-11-25；格式 @cn/format ink.ts，DESIGN.v3 6.6「白板笔迹」）：Mac 上看、改 iPad 写的笔迹。
 * - 画：白板上盖一块和视野一样大的 canvas（不随 CSS zoom 放大，只画看得见的笔；缩到 40% 以下画简化的）；
 *   挂在卡上的组跟着那张卡画（每次画的时候量那张卡的位置：拖卡、列里上面插了一段、列宽 400、推开都跟着），卡看不见（收起的列、删了）就不画；
 *   深色主题照 PencilKit 反亮度（darkInk）。
 * - 改（Mac 第一版只改不写，用户定）：点一笔选中它那一组（⇧ 点加减一组）；空白处按住拖是框选，碰到的笔和卡一起选上；
 *   按住选中的笔拖是挪；操作条「已选N笔 · 颜色 ▾ ｜ 删除」；⌫ 删、Esc 取消。每一下写一次笔迹文件、提交一次，⌘Z 撤回（和白板别的动作同一串）。
 *   鼠标在空白处拖永远是框选，不会写出笔来。
 */
import { trackDrag } from '@cn/design/drag-end'
import {
  deleteInk,
  HIGHLIGHT_COLORS,
  INK_COLORS,
  type InkDoc,
  inkGroups,
  type InkGroup,
  type InkStroke,
  inkStrokes,
  moveInk,
  parseInk,
  printInk,
  recolorInk,
} from '@cn/format'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { ipcOn } from '../crash/ipc'
import { useT } from '../i18n'
import { t as tNow } from '../../shared/i18n'
import { titleOf } from '../../shared/layout'
import { SelBar } from '../multi-select/SelBar'
import { anchorOf, FloatPop, type PopAnchor } from '../pop-place'
import { distTo, geomOf, type InkGeom, paintInk, roughBox, shownColor, touchesBox } from './ink-draw'

type Pt = { x: number; y: number }

/** 缩到这个比例以下画简化的笔（只连控制点） */
const LOD_BELOW = 0.4
/** 点中一笔：离笔多远（屏幕上的点）还算点中 */
const HIT_PX = 4

export interface InkLayerProps {
  notePath: string
  readOnly: boolean
  /** 画布上真正的比例（CSS zoom） */
  scale: number
  wrap: RefObject<HTMLDivElement | null>
  plane: RefObject<HTMLDivElement | null>
  /** 卡的编号 → 白板上那张卡的元素（看不见是 null） */
  cardEl(id: string): HTMLElement | null
  /**
   * 一步做完：进白板的 ⌘Z、底部提示带「撤回」（before / after 是笔迹文件的全文）。动手的当下就进（写完之前按 ⌘Z 也撤的是这一步）；
   * 返回的函数：主进程和外面改的合过、写进去的和 after 不一样时，把这一步的 after 换成真写进去的
   */
  step(before: string, after: string, what: string): (written: string) => void
  /** 选了笔：卡的选中由白板自己管，这里只告诉它「点了笔」（点一笔时卡不再选着） */
  onPick(): void
  /** 拖着卡、改着字：操作条先藏起来 */
  hidden: boolean
  /** 同时选着几张卡（框选碰到的）：只出这一条操作条，写「已选N笔 · M张卡」，删除连卡一起删 */
  cards: number
  removeCards(): void
  /** 这块白板在前台 */
  active: boolean
  focus(): void
}

export interface InkLayer {
  text: string
  /** 笔迹文件现在的全文（刚写的也算，不等下一次画） */
  latest(): string
  doc: InkDoc
  sel: ReadonlySet<string>
  node: ReactNode
  /** 鼠标按下：点在笔上就选中（拖就是挪）并返回 true，白板别的处理不再管 */
  down(e: React.MouseEvent): boolean
  /** 框选：两个角（窗口坐标）、加在已选的上面 */
  marquee(a: Pt, b: Pt, add: boolean): void
  clear(): void
  /** ⌫ 删、Esc 取消；处理了返回 true */
  key(e: React.KeyboardEvent): boolean
  /** 撤回、重做：把笔迹文件写成这样（盘上和以为的不一样时主进程按编号合） */
  restore(text: string, what: string): void
}

/** 两种颜色（#rrggbb）差不多吗：RGB 各通道差的平均不到 24 */
function near(a: string, b: string): boolean {
  const rgb = (c: string) => {
    const m = /^#([0-9a-f]{6})/i.exec(c.trim())
    if (!m) return null
    const v = parseInt(m[1]!, 16)
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
  }
  const x = rgb(a)
  const y = rgb(b)
  return !!x && !!y && (Math.abs(x[0]! - y[0]!) + Math.abs(x[1]! - y[1]!) + Math.abs(x[2]! - y[2]!)) / 3 < 24
}

/** 读这块白板的笔迹文件，外面改了（iPad 同步下来、别处写的）跟着重读 */
function useInkText(notePath: string): [string, (s: string) => void, React.MutableRefObject<string>] {
  const [text, setText] = useState('')
  const ref = useRef('')
  const set = (s: string) => {
    ref.current = s
    setText(s)
  }
  useEffect(() => {
    let live = true
    const read = () =>
      void window.cn.inkRead(notePath).then(
        (s) => live && s !== ref.current && set(s),
        (e) => console.error('读笔迹失败', e),
      )
    set('')
    read()
    const off = ipcOn(window.cn.onFilesChanged, 'cn.onFilesChanged')(read)
    return () => {
      live = false
      off()
    }
  }, [notePath])
  return [text, set, ref]
}

export function useInkLayer(p: InkLayerProps): InkLayer {
  const t = useT()
  const [text, setText, textRef] = useInkText(p.notePath)
  const doc = useMemo(() => parseInk(text), [text])
  /** 改的时候用最新的那份（拖着的时候外面改了也不拿旧的写回去） */
  const docRef = useRef(doc)
  docRef.current = doc
  const groups = useMemo(() => inkGroups(doc), [doc])
  const strokes = useMemo(() => inkStrokes(doc), [doc])
  const byGroup = useMemo(() => {
    const m = new Map<string, InkStroke[]>()
    for (const s of strokes) m.set(s.g, [...(m.get(s.g) ?? []), s])
    return m
  }, [strokes])
  const [sel, setSel] = useState<Set<string>>(new Set())
  // 文件变了（撤回、外面删了）：选着的里面已经没有的去掉
  useEffect(() => {
    const ids = new Set(strokes.map((s) => s.id))
    setSel((cur) => ([...cur].every((id) => ids.has(id)) ? cur : new Set([...cur].filter((id) => ids.has(id)))))
  }, [strokes])
  /** 拖着选中的笔：挪了多少（白板坐标），画的时候加上 */
  const [drag, setDrag] = useState<Pt | null>(null)
  const [colors, setColors] = useState<PopAnchor | null>(null)
  const [up, setUp] = useState(true)
  const canvas = useRef<HTMLCanvasElement>(null)
  const pRef = useRef(p)
  pRef.current = p

  // ----- 量位置：组的原点在白板上的哪（挂卡的跟着卡），每次画的时候量 -----
  const placeOf = (g: InkGroup, cards: Map<string, Pt | null>): Pt | null => {
    if (g.on === null) return { x: g.x, y: g.y }
    if (!cards.has(g.on)) {
      const el = pRef.current.cardEl(g.on)
      const plane = pRef.current.plane.current
      if (!el || !plane || !el.checkVisibility()) cards.set(g.on, null)
      else {
        const r = el.getBoundingClientRect()
        const b = plane.getBoundingClientRect()
        const s = pRef.current.scale || 1
        cards.set(g.on, { x: (r.left - b.left) / s, y: (r.top - b.top) / s })
      }
    }
    const c = cards.get(g.on)
    return c ? { x: c.x + g.x, y: c.y + g.y } : null
  }

  /** 这一回画出来的每一笔在白板上的原点（点中、框选用；没画的不在里面） */
  const shown = useRef(new Map<string, { s: InkStroke; g: InkGeom; o: Pt }>())
  /** 挂着笔的卡和它们所在的列：长高、挪了就重画 */
  const watched = useRef(new Set<Element>())
  const ro = useRef<ResizeObserver | null>(null)

  const draw = () => {
    const cv = canvas.current
    const w = pRef.current.wrap.current
    const plane = pRef.current.plane.current
    if (!cv || !w || !plane) return
    const t0 = performance.now()
    const area = cv.parentElement!
    const ar = area.getBoundingClientRect()
    const wr = w.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const cw = Math.round(w.clientWidth)
    const ch = Math.round(w.clientHeight)
    cv.style.left = `${wr.left - ar.left}px`
    cv.style.top = `${wr.top - ar.top}px`
    cv.style.width = `${cw}px`
    cv.style.height = `${ch}px`
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) {
      cv.width = Math.round(cw * dpr)
      cv.height = Math.round(ch * dpr)
    }
    const ctx = cv.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    shown.current = new Map()
    if (!strokes.length) return
    const s = pRef.current.scale || 1
    const pr = plane.getBoundingClientRect()
    const ox = pr.left - wr.left
    const oy = pr.top - wr.top
    // 视野（白板坐标），四周多留一点
    const pad = 8 / s
    const vx0 = -ox / s - pad
    const vy0 = -oy / s - pad
    const vx1 = (cw - ox) / s + pad
    const vy1 = (ch - oy) / s + pad
    const dark = document.documentElement.dataset.tone === 'dark'
    const css = getComputedStyle(area)
    const acc = css.getPropertyValue('--acc').trim() || '#12805a'
    const glowAlt = `color-mix(in srgb, ${css.getPropertyValue('--t1').trim() || '#15231d'} 40%, transparent)`
    const lod = s < LOD_BELOW
    const cards = new Map<string, Pt | null>()
    const sel = selRef.current
    const d = dragRef.current
    let bx0 = Infinity
    let by0 = Infinity
    let bx1 = -Infinity
    let by1 = -Infinity
    const wantWatch = new Set<Element>()
    for (const st of strokes) {
      const g = groups.get(st.g)
      if (!g) continue
      const o0 = placeOf(g, cards)
      if (!o0) continue
      if (g.on) {
        const el = pRef.current.cardEl(g.on)
        if (el) {
          wantWatch.add(el)
          const col = el.closest('.db-col')
          if (col) wantWatch.add(col)
        }
      }
      const rough = roughBox(st)
      if (!rough) continue
      const on = sel.has(st.id)
      const o = on && d ? { x: o0.x + d.x, y: o0.y + d.y } : o0
      const [x0, y0, x1, y1] = rough
      if (o.x + x1 < vx0 || o.x + x0 > vx1 || o.y + y1 < vy0 || o.y + y0 > vy1) {
        if (on) {
          bx0 = Math.min(bx0, o.x + x0)
          by0 = Math.min(by0, o.y + y0)
          bx1 = Math.max(bx1, o.x + x1)
          by1 = Math.max(by1, o.y + y1)
        }
        continue
      }
      const geom = geomOf(st)
      if (!geom) continue
      if (on) {
        bx0 = Math.min(bx0, o.x + geom.box[0])
        by0 = Math.min(by0, o.y + geom.box[1])
        bx1 = Math.max(bx1, o.x + geom.box[2])
        by1 = Math.max(by1, o.y + geom.box[3])
      }
      shown.current.set(st.id, { s: st, g: geom, o })
      ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (ox + o.x * s), dpr * (oy + o.y * s))
      const color = shownColor(st.c, dark)
      if (on) {
        // 选中的笔：强调色的光晕（照小样 drop-shadow 2px + 1px）；笔的颜色和强调色差不多（薄荷的绿墨水）时光晕看不出，换成字色 40%
        ctx.shadowColor = near(color, acc) ? glowAlt : acc
        ctx.shadowBlur = 4 * dpr
      }
      paintInk(ctx, geom, color, { dark, k: s * dpr, lod: lod && !on })
      if (on) {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
    }
    ctx.globalAlpha = 1
    // 选中的那几笔外面一圈虚线框（四周空 6，圆角 8，1.5px 强调色）
    if (sel.size && bx0 < Infinity) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const l = ox + bx0 * s - 6
      const tp = oy + by0 * s - 6
      const r = ox + bx1 * s + 6
      const b = oy + by1 * s + 6
      ctx.strokeStyle = acc
      ctx.lineWidth = 1.5
      ctx.setLineDash([5, 4])
      ctx.beginPath()
      ctx.roundRect(l, tp, r - l, b - tp, 8)
      ctx.stroke()
      ctx.setLineDash([])
      selBox.current = { left: wr.left + l, top: wr.top + tp, right: wr.left + r, bottom: wr.top + b }
    } else selBox.current = null
    // 挂着笔的卡（和它的列）长高了、挪了：重画
    if (!ro.current) ro.current = new ResizeObserver(() => schedule())
    for (const el of watched.current) if (!wantWatch.has(el)) ro.current.unobserve(el)
    for (const el of wantWatch) if (!watched.current.has(el)) ro.current.observe(el)
    watched.current = wantWatch
    // 这一帧画了几笔、用了多久（性能测试 ink-perf.spec.ts 读）
    cv.dataset.shown = String(shown.current.size)
    cv.dataset.ms = (performance.now() - t0).toFixed(2)
    if (!cv.dataset.first && strokes.length) cv.dataset.first = cv.dataset.ms
  }
  const selRef = useRef(sel)
  selRef.current = sel
  const dragRef = useRef(drag)
  dragRef.current = drag
  const selBox = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const raf = useRef(0)
  const schedule = () => {
    if (raf.current) return
    raf.current = requestAnimationFrame(() => {
      raf.current = 0
      drawRef.current()
    })
  }

  // 每画一次白板（卡挪了、字改了、缩放了）就重画；滚动、窗口变大小、换主题也重画
  useLayoutEffect(() => drawRef.current())
  useEffect(() => {
    const w = p.wrap.current
    const plane = p.plane.current
    if (!w) return
    w.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    const r = new ResizeObserver(schedule)
    r.observe(w)
    if (plane) r.observe(plane)
    const mo = new MutationObserver(schedule)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tone', 'data-skin'] })
    return () => {
      w.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      r.disconnect()
      mo.disconnect()
      ro.current?.disconnect()
      ro.current = null
      watched.current = new Set()
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.wrap, p.plane])

  // ----- 点中、框选 -----
  const toPlane = (cx: number, cy: number): Pt | null => {
    const plane = p.plane.current
    if (!plane) return null
    const r = plane.getBoundingClientRect()
    const s = p.scale || 1
    return { x: (cx - r.left) / s, y: (cy - r.top) / s }
  }
  const hitAt = (cx: number, cy: number): InkStroke | null => {
    const q = toPlane(cx, cy)
    if (!q) return null
    const tol = HIT_PX / (p.scale || 1)
    const list = [...shown.current.values()]
    for (let i = list.length - 1; i >= 0; i--) {
      const { s, g, o } = list[i]!
      const [x0, y0, x1, y1] = g.box
      const lx = q.x - o.x
      const ly = q.y - o.y
      if (lx < x0 - tol || lx > x1 + tol || ly < y0 - tol || ly > y1 + tol) continue
      if (distTo(g, lx, ly) <= tol) return s
    }
    return null
  }
  const groupOf = (s: InkStroke) => (byGroup.get(s.g) ?? [s]).map((x) => x.id)

  // ----- 写：一下一次写、一次提交，进白板的 ⌘Z -----
  const title = titleOf(p.notePath)
  const save = (next: InkDoc, what: string, commit: string) => {
    const before = textRef.current
    const after = printInk(next)
    if (after === before || p.readOnly) return
    setText(after)
    const fix = p.step(before, after, what)
    void window.cn.inkWrite(p.notePath, after, before, `${commit} · ${title}`).then(
      (r) => {
        if (r.text !== after) {
          setText(r.text)
          fix(r.text)
        }
      },
      (e) => {
        setText(before)
        fix(before)
        console.error('写笔迹失败', e)
      },
    )
  }
  const now = () => Date.now()
  const move = (ids: string[], dx: number, dy: number) => {
    const n = ids.length
    save(moveInk(docRef.current, ids, dx, dy, { now: now() }), tNow('挪了{n}笔', { n }), `笔迹：挪了 ${n} 笔`) // 不翻：提交说明
  }
  const recolor = (c: string) => {
    const ids = [...sel].filter((id) => {
      const s = strokes.find((x) => x.id === id)
      if (!s) return false
      const hl = (HIGHLIGHT_COLORS as readonly string[]).includes(c)
      return hl ? s.pen === 'marker' : s.pen !== 'marker'
    })
    const n = ids.length
    if (!n) return
    save(recolorInk(docRef.current, ids, c, { now: now() }), tNow('{n}笔改了颜色', { n }), `笔迹：${n} 笔改了颜色`) // 不翻：提交说明
  }
  const remove = (ids: Iterable<string>) => {
    const list = [...ids]
    const n = list.length
    if (!n) return
    save(deleteInk(docRef.current, list), tNow('删了{n}笔', { n }), `笔迹：删了 ${n} 笔`) // 不翻：提交说明
    setSel(new Set())
  }

  const down = (e: React.MouseEvent): boolean => {
    if (e.button !== 0) return false
    const hit = hitAt(e.clientX, e.clientY)
    if (!hit) return false
    e.preventDefault()
    e.stopPropagation()
    p.focus()
    const grp = groupOf(hit)
    let next: Set<string>
    if (e.shiftKey) {
      next = new Set(sel)
      const allIn = grp.every((id) => next.has(id))
      for (const id of grp) allIn ? next.delete(id) : next.add(id)
    } else next = sel.has(hit.id) ? new Set(sel) : new Set(grp)
    setSel(next)
    p.onPick()
    setColors(null)
    if (p.readOnly || !next.has(hit.id)) return true
    const start = toPlane(e.clientX, e.clientY)!
    let moved = false
    let last: Pt = { x: 0, y: 0 }
    trackDrag(e, {
      move: (ev: MouseEvent) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
        moved = true
        const q = toPlane(ev.clientX, ev.clientY)!
        last = { x: q.x - start.x, y: q.y - start.y }
        setDrag(last)
      },
      end: () => {
        setDrag(null)
        if (moved) move([...next], last.x, last.y)
      },
    })
    return true
  }

  const marquee = (a: Pt, b: Pt, add: boolean) => {
    const pa = toPlane(Math.min(a.x, b.x), Math.min(a.y, b.y))
    const pb = toPlane(Math.max(a.x, b.x), Math.max(a.y, b.y))
    if (!pa || !pb) return
    const hits = [...shown.current.values()].filter(({ g, o }) => touchesBox(g, pa.x - o.x, pa.y - o.y, pb.x - o.x, pb.y - o.y)).map(({ s }) => s.id)
    const next = new Set(add ? [...baseSel.current, ...hits] : hits)
    setSel((cur) => (cur.size === next.size && [...next].every((id) => cur.has(id)) ? cur : next))
  }
  /** 框选开始时已经选着的（⇧ 框选加在它们上面） */
  const baseSel = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!drag) baseSel.current = sel
  }, [sel, drag])

  const clear = () => {
    setColors(null)
    if (sel.size) setSel(new Set())
  }
  const key = (e: React.KeyboardEvent): boolean => {
    if (!sel.size) return false
    if ((e.key === 'Backspace' || e.key === 'Delete') && !p.readOnly) {
      e.preventDefault()
      remove(sel)
      return true
    }
    if (e.key === 'Escape') {
      clear()
      return false
    }
    return false
  }
  const restore = (next: string, what: string) => {
    const before = textRef.current
    setText(next)
    void window.cn.inkWrite(p.notePath, next, before, `笔迹：${what} · ${title}`).then( // 不翻：提交说明
      (r) => r.text !== next && setText(r.text),
      (e) => (setText(before), console.error('写笔迹失败', e)),
    )
  }

  // ----- 操作条：已选N笔（· M张卡）· 颜色 ▾ ｜ 删除 -----
  const picked = strokes.filter((s) => sel.has(s.id))
  const hasMarker = picked.some((s) => s.pen === 'marker')
  const hasInk = picked.some((s) => s.pen !== 'marker')
  const dark = document.documentElement.dataset.tone === 'dark'
  /** 选中的几笔都是一个颜色：就是它（「颜色」按钮上画这个点，浮层里这一颗带圈） */
  const same = picked.length && picked.every((s) => s.c === picked[0]!.c) ? picked[0]!.c : null
  const names: Record<string, string> = {
    '#1d2421': t('黑'),
    '#2459c6': t('蓝'),
    '#d64545': t('红'),
    '#12805a': t('绿'),
    '#e08a00': t('橙'),
    '#ffd84d': t('黄'),
    '#9be3b7': t('浅绿'),
    '#ffb3c7': t('粉'),
  }
  const swatches = (list: readonly string[], label: string) => (
    <div className="ink-sw-row" role="group" aria-label={label}>
      {list.map((c) => (
        <button
          key={c}
          type="button"
          className={'ink-sw' + (same === c ? ' on' : '')}
          aria-label={names[c] ?? c}
          aria-pressed={same === c}
          data-tip={names[c] ?? c}
          data-side="below"
          data-c={c}
          style={{ background: shownColor(c, dark) }}
          onClick={() => (recolor(c), setColors(null), p.focus())}
        />
      ))}
    </div>
  )
  const node = (
    <>
      <canvas ref={canvas} className="db-ink" aria-hidden data-testid="db-ink" data-strokes={strokes.length} />
      {sel.size > 0 && p.active && (
        <SelBar
          count={p.cards ? t('已选{n}笔 · {m}张卡', { n: sel.size, m: p.cards }) : t('已选{n}笔', { n: sel.size })}
          items={
            p.readOnly
              ? []
              : [
                  { k: 'color', label: t('颜色'), ...(same ? { dot: shownColor(same, dark) } : { icon: 'symbol-color' as const }), menu: true, tip: t('改这几笔的颜色') },
                  { k: 'delete', label: t('删除'), icon: 'trash', red: true, sep: true, tip: p.cards ? t('删掉这几笔和这几张卡') : t('删掉这几笔'), keys: '⌫' },
                ]
          }
          foldOrder={[]}
          label={t('选中的笔迹')}
          testid="ink-selbar"
          hidden={p.hidden || !!drag}
          open={colors ? 'color' : null}
          scrollers={[p.wrap.current]}
          measure={() => {
            const area = p.wrap.current?.parentElement
            if (!area || !p.wrap.current?.checkVisibility()) return null
            const a = area.getBoundingClientRect()
            return { sel: selBox.current, area: { left: a.left, top: a.top, right: a.right, bottom: a.bottom } }
          }}
          onAct={(k, el) => {
            if (k === 'delete') {
              remove(sel)
              if (p.cards) p.removeCards()
            } else if (k === 'color') {
              // 操作条在选区上面：浮层往上开，不盖住要改的那几笔
              setUp(el.closest<HTMLElement>('.selbar')?.dataset.below !== '1')
              setColors((c) => (c ? null : anchorOf(el)))
            }
          }}
        />
      )}
      {colors && sel.size > 0 && (
        <FloatPop at={colors} gap={6} up={up} className="ink-colors" role="dialog" aria-label={t('笔迹颜色')} data-testid="ink-colors" onMouseDown={(e) => e.preventDefault()}>
          {hasInk && (
            <>
              <div className="ink-sw-h">{t('墨水')}</div>
              {swatches(INK_COLORS, t('墨水'))}
            </>
          )}
          {hasMarker && (
            <>
              <div className="ink-sw-h">{t('荧光笔')}</div>
              {swatches(HIGHLIGHT_COLORS, t('荧光笔'))}
            </>
          )}
        </FloatPop>
      )}
      {colors && <ColorsCloser onClose={() => setColors(null)} />}
    </>
  )
  return { text, latest: () => textRef.current, doc, sel, node, down, marquee, clear, key, restore }
}

/** 颜色小浮层：点外面、Esc 收起 */
function ColorsCloser(props: { onClose(): void }) {
  const ref = useRef(props.onClose)
  ref.current = props.onClose
  useEffect(() => {
    const out = (e: MouseEvent) => {
      const el = e.target as Element | null
      if (el?.closest?.('.ink-colors, .selbar .sb[data-k="color"]')) return
      ref.current()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), ref.current())
    document.addEventListener('mousedown', out, true)
    window.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', out, true)
      window.removeEventListener('keydown', esc, true)
    }
  }, [])
  return null
}
