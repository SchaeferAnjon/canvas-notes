/**
 * 读 PDF 时显示 iPad 上写的笔迹（设计页 159「iPad 读 PDF 手写和白板同一套」）：照 附件/<PDF 名>/笔迹.ink（@cn/format ink.ts，组行带 pg）
 * 每页叠一层 canvas 画出来；照白板 Mac 第一版「改笔迹不写」：点一笔选中它那一组（⇧ 点加减一组），按住选中的拖是挪（只在这一页里），
 * 操作条「已选N笔 · 颜色 ▾ ｜ 删除」，⌫ 删、Esc 取消，⌘Z / ⇧⌘Z 撤回重做；每一下写一次笔迹文件、提交一次。
 * 坐标：笔迹是页内坐标（cropBox 左上角起、没旋转、PDF 点），pdf.js 的视口变换管旋转和裁切框偏移（Size.xf，page.ts 开的时候算好）。
 * PDF 是白纸：深色主题下笔迹也照浅色画（和 iPad 一样不反色）；整层正片叠底（荧光笔叠在字上字不变淡）。
 */
import { trackDrag } from '@cn/design/drag-end'
import { deleteInk, HIGHLIGHT_COLORS, INK_COLORS, inkColor, type InkDoc, inkGroups, type InkStroke, inkStrokes, moveInk, parseInk, printInk, recolorInk } from '@cn/format'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { distTo, geomOf, paintInk } from '../doc-board/ink-draw'
import { ColorsCloser, useInkText } from '../doc-board/ink-layer'
import { useT } from '../i18n'
import { RING, SelBar } from '../multi-select/SelBar'
import { anchorOf, FloatPop, type PopAnchor } from '../pop-place'

type Pt = { x: number; y: number }
/** 仿射变换 [a, b, c, d, e, f]：x' = a·x + c·y + e，y' = b·x + d·y + f */
export type Xf = [number, number, number, number, number, number]

/** 点中一笔：离笔多远（屏幕上的点）还算点中 */
const HIT_PX = 4

export const mulXf = (t: Xf, l: Xf): Xf => [
  t[0] * l[0] + t[2] * l[1],
  t[1] * l[0] + t[3] * l[1],
  t[0] * l[2] + t[2] * l[3],
  t[1] * l[2] + t[3] * l[3],
  t[0] * l[4] + t[2] * l[5] + t[4],
  t[1] * l[4] + t[3] * l[5] + t[5],
]

/** 页内坐标 → 100% 时的页面像素：pdf.js 的视口变换（transform）接在「cropBox 左上角起、y 朝下 → PDF 用户空间」后面 */
export function pageXf(transform: number[], view: number[]): Xf {
  return mulXf(transform as Xf, [1, 0, 0, -1, view[0]!, view[3]!])
}

/** 两种颜色（#rrggbb、rgb()）的对比度（WCAG）；认不出的当够 */
export function contrast(a: string, b: string): number {
  const rgb = (c: string): number[] | null => {
    const h = /^#([0-9a-f]{6})/i.exec(c.trim())
    if (h) return [0, 2, 4].map((i) => parseInt(h[1]!.slice(i, i + 2), 16))
    const m = /rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/.exec(c)
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
  }
  const lum = (v: number[]) => {
    const ch = (x: number) => (x / 255 <= 0.03928 ? x / 255 / 12.92 : ((x / 255 + 0.055) / 1.055) ** 2.4)
    return 0.2126 * ch(v[0]!) + 0.7152 * ch(v[1]!) + 0.0722 * ch(v[2]!)
  }
  const x = rgb(a)
  const y = rgb(b)
  if (!x || !y) return 21
  const [l1, l2] = [lum(x), lum(y)].sort((p, q) => q - p)
  return (l1! + 0.05) / (l2! + 0.05)
}

const apply = (m: Xf, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
const invert = (m: Xf): Xf => {
  const det = m[0] * m[3] - m[1] * m[2]
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]
}

export interface PdfInkProps {
  path: string
  scale: number
  /** 每页 100% 时的大小和页内坐标 → 页面像素的变换 */
  sizes: { w: number; h: number; xf: Xf }[] | null
  scroller: RefObject<HTMLDivElement | null>
  /** 正在看的几页（只画这几页） */
  visible: Set<number>
  active: boolean
}

export function usePdfInk(p: PdfInkProps): { layer(n: number): ReactNode; down(e: React.PointerEvent): boolean; node: ReactNode; count: number } {
  const t = useT()
  // 写着的时候读回来的（上一下写完发的「文件变了」）不盖掉这边新的：不然 ⌘Z 紧接着 ⇧⌘Z，重做拿旧的当底、三方合并后什么都没变
  const [text, setText, textRef, track] = useInkText(p.path)
  const doc = useMemo(() => parseInk(text), [text])
  const docRef = useRef(doc)
  docRef.current = doc
  const groups = useMemo(() => inkGroups(doc), [doc])
  const strokes = useMemo(() => inkStrokes(doc), [doc])
  const byPage = useMemo(() => {
    const m = new Map<number, InkStroke[]>()
    for (const s of strokes) {
      const pg = groups.get(s.g)?.pg
      if (pg) m.set(pg, [...(m.get(pg) ?? []), s])
    }
    return m
  }, [strokes, groups])
  const [sel, setSel] = useState<Set<string>>(new Set())
  useEffect(() => {
    const ids = new Set(strokes.map((s) => s.id))
    setSel((cur) => ([...cur].every((id) => ids.has(id)) ? cur : new Set([...cur].filter((id) => ids.has(id)))))
  }, [strokes])
  /** 拖着选中的笔：挪了多少（页内坐标） */
  const [drag, setDrag] = useState<Pt | null>(null)
  const [colors, setColors] = useState<PopAnchor | null>(null)
  const [up, setUp] = useState(true)
  const canvases = useRef(new Map<number, HTMLCanvasElement>())
  /** 选中框（窗口坐标），操作条量它 */
  const selBox = useRef<{ left: number; top: number; right: number; bottom: number } | null>(null)
  /** 撤回重做：每一下改之前、之后的全文 */
  const undo = useRef<{ before: string; after: string }[]>([])
  const redo = useRef<{ before: string; after: string }[]>([])

  const selPage = useMemo(() => {
    for (const id of sel) {
      const s = strokes.find((x) => x.id === id)
      const pg = s && groups.get(s.g)?.pg
      if (pg) return pg
    }
    return null
  }, [sel, strokes, groups])

  // ----- 画：每页一块 canvas，按现在的比例和设备像素比 -----
  const draw = (n: number) => {
    const cv = canvases.current.get(n)
    const size = p.sizes?.[n - 1]
    if (!cv || !size) return
    const dpr = window.devicePixelRatio || 1
    const w = size.w * p.scale
    const h = size.h * p.scale
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
    }
    const ctx = cv.getContext('2d')!
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    const list = byPage.get(n) ?? []
    const k = p.scale * dpr
    const m = size.xf
    const unit = Math.hypot(m[0], m[1])
    const acc = getComputedStyle(cv).getPropertyValue('--acc').trim() || '#12805a'
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const st of list) {
      const g = groups.get(st.g)
      const geom = geomOf(st)
      if (!g || !geom) continue
      const on = sel.has(st.id)
      const o = on && drag ? { x: g.x + drag.x, y: g.y + drag.y } : { x: g.x, y: g.y }
      const f = mulXf(m, [1, 0, 0, 1, o.x, o.y])
      ctx.setTransform(k * f[0], k * f[1], k * f[2], k * f[3], k * f[4], k * f[5])
      if (on) {
        ctx.shadowColor = acc
        ctx.shadowBlur = 4 * dpr
        for (const [cx, cy] of [
          [geom.box[0], geom.box[1]],
          [geom.box[2], geom.box[1]],
          [geom.box[0], geom.box[3]],
          [geom.box[2], geom.box[3]],
        ] as const) {
          const q = apply(f, { x: cx, y: cy })
          x0 = Math.min(x0, q.x * p.scale)
          y0 = Math.min(y0, q.y * p.scale)
          x1 = Math.max(x1, q.x * p.scale)
          y1 = Math.max(y1, q.y * p.scale)
        }
      }
      // 文件里的旧红旧蓝照新值画（inkColor，文件不动）
      paintInk(ctx, geom, inkColor(st.c), { dark: false, k: k * unit })
      if (on) {
        ctx.shadowBlur = 0
        ctx.shadowColor = 'transparent'
      }
    }
    ctx.globalAlpha = 1
    if (n === selPage) {
      if (x0 < Infinity) {
        // 选中的那几笔外面一圈虚线框（四周空 6，圆角 8，1.5px 强调色）
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        ctx.strokeStyle = acc
        ctx.lineWidth = 1.5
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.roundRect(x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12, 8)
        ctx.stroke()
        ctx.setLineDash([])
        const r = cv.getBoundingClientRect()
        selBox.current = { left: r.left + x0 - 6, top: r.top + y0 - 6, right: r.left + x1 + 6, bottom: r.top + y1 + 6 }
      } else selBox.current = null
    }
    cv.dataset.shown = String(list.length)
  }
  const drawRef = useRef(draw)
  drawRef.current = draw
  useLayoutEffect(() => {
    if (!selPage) selBox.current = null
    for (const n of canvases.current.keys()) drawRef.current(n)
  })
  // 换主题（强调色）重画
  useEffect(() => {
    const mo = new MutationObserver(() => {
      for (const n of canvases.current.keys()) drawRef.current(n)
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-tone', 'data-skin'] })
    return () => mo.disconnect()
  }, [])

  // ----- 点中 -----
  /** 窗口上的一点 → 第几页、页内坐标 */
  const locate = (cx: number, cy: number, page?: number): { n: number; q: Pt } | null => {
    const sc = p.scroller.current
    const el = page
      ? sc?.querySelector<HTMLElement>(`.pdfpage[data-page="${page}"]`)
      : (document.elementsFromPoint(cx, cy).find((x) => x.classList.contains('pdfpage')) as HTMLElement | undefined)
    const n = page ?? Number(el?.dataset.page)
    const size = p.sizes?.[n - 1]
    if (!el || !size) return null
    const r = el.getBoundingClientRect()
    return { n, q: apply(invert(size.xf), { x: (cx - r.left) / p.scale, y: (cy - r.top) / p.scale }) }
  }
  const hitAt = (cx: number, cy: number): InkStroke | null => {
    const at = locate(cx, cy)
    if (!at) return null
    const size = p.sizes![at.n - 1]!
    const tol = HIT_PX / (p.scale * Math.hypot(size.xf[0], size.xf[1]))
    const list = byPage.get(at.n) ?? []
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i]!
      const g = groups.get(s.g)
      const geom = geomOf(s)
      if (!g || !geom) continue
      const lx = at.q.x - g.x
      const ly = at.q.y - g.y
      const [bx0, by0, bx1, by1] = geom.box
      if (lx < bx0 - tol || lx > bx1 + tol || ly < by0 - tol || ly > by1 + tol) continue
      if (distTo(geom, lx, ly) <= tol) return s
    }
    return null
  }

  // ----- 写：一下一次写、一次提交 -----
  const title = p.path.split('/').pop() ?? p.path
  const write = (after: string, before: string, commit: string) => {
    setText(after)
    void track(window.cn.inkWrite(p.path, after, before, `${commit} · ${title}`)).then(
      (r) => r.text !== after && setText(r.text),
      (e) => (setText(before), console.error('写笔迹失败', e)),
    )
  }
  const save = (next: InkDoc, commit: string) => {
    const before = textRef.current
    const after = printInk(next)
    if (after === before) return
    undo.current.push({ before, after })
    redo.current = []
    write(after, before, commit)
  }
  const now = () => Date.now()
  const recolor = (c: string) => {
    const hl = (HIGHLIGHT_COLORS as readonly string[]).includes(c)
    const ids = strokes.filter((s) => sel.has(s.id) && (hl ? s.pen === 'marker' : s.pen !== 'marker')).map((s) => s.id)
    if (ids.length) save(recolorInk(docRef.current, ids, c, { now: now() }), `笔迹：${ids.length} 笔改了颜色`) // 不翻：提交说明
  }
  const remove = (ids: Iterable<string>) => {
    const list = [...ids]
    if (!list.length) return
    save(deleteInk(docRef.current, list), `笔迹：删了 ${list.length} 笔`) // 不翻：提交说明
    setSel(new Set())
  }
  const back = (from: typeof undo, to: typeof undo, pick: 'before' | 'after') => {
    const step = from.current.pop()
    if (!step) return false
    to.current.push(step)
    write(step[pick], textRef.current, pick === 'before' ? '笔迹：撤回' : '笔迹：重做') // 不翻：提交说明
    return true
  }

  const down = (e: React.PointerEvent): boolean => {
    if (e.button !== 0) return false
    const hit = hitAt(e.clientX, e.clientY)
    if (!hit) {
      if (sel.size) setSel(new Set())
      return false
    }
    e.preventDefault()
    e.stopPropagation()
    window.getSelection()?.removeAllRanges()
    // 按下没让浏览器挪焦点：自己把焦点放到这一栏（⌫、Esc、⌘Z 才到这里）
    p.scroller.current?.focus({ preventScroll: true })
    const grp = strokes.filter((s) => s.g === hit.g).map((s) => s.id)
    let next: Set<string>
    if (e.shiftKey) {
      next = new Set(sel)
      const allIn = grp.every((id) => next.has(id))
      for (const id of grp) allIn ? next.delete(id) : next.add(id)
      // 只在一页里选（挪也只在这一页里）
      const pg = groups.get(hit.g)?.pg
      next = new Set([...next].filter((id) => groups.get(strokes.find((s) => s.id === id)?.g ?? '')?.pg === pg))
    } else next = sel.has(hit.id) ? new Set(sel) : new Set(grp)
    setSel(next)
    setColors(null)
    if (!next.has(hit.id)) return true
    const n = groups.get(hit.g)!.pg!
    const start = locate(e.clientX, e.clientY, n)!.q
    let moved = false
    let last: Pt = { x: 0, y: 0 }
    trackDrag(e.nativeEvent, {
      move: (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return
        moved = true
        const q = locate(ev.clientX, ev.clientY, n)!.q
        last = { x: q.x - start.x, y: q.y - start.y }
        setDrag(last)
      },
      end: () => {
        setDrag(null)
        if (moved) save(moveInk(docRef.current, [...next], last.x, last.y, { now: now() }), `笔迹：挪了 ${next.size} 笔`) // 不翻：提交说明
      },
    })
    return true
  }

  // ⌫ 删、Esc 取消、⌘Z / ⇧⌘Z 撤回重做（焦点在读 PDF 这一栏里、不在输入框里时）
  useEffect(() => {
    if (!p.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const target = e.target as Element | null
      if (target?.closest?.('textarea, input, .cm-editor, [contenteditable="true"]')) return
      if (!target?.closest?.('.pdfv') && target !== document.body) return
      if (sel.size && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault()
        remove(sel)
      } else if (sel.size && e.key === 'Escape') {
        setColors(null)
        setSel(new Set())
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey ? back(redo, undo, 'after') : back(undo, redo, 'before')) e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const layer = (n: number) =>
    byPage.has(n) && p.visible.has(n) ? (
      <canvas
        key={`ink-${n}`}
        className="pdfink"
        data-page={n}
        data-strokes={byPage.get(n)!.length}
        data-testid="pdf-ink"
        aria-hidden
        ref={(el) => {
          if (el) canvases.current.set(n, el)
          else canvases.current.delete(n)
        }}
      />
    ) : null

  const picked = strokes.filter((s) => sel.has(s.id))
  const hasMarker = picked.some((s) => s.pen === 'marker')
  const hasInk = picked.some((s) => s.pen !== 'marker')
  const same = picked.length && picked.every((s) => inkColor(s.c) === inkColor(picked[0]!.c)) ? inkColor(picked[0]!.c) : null
  // PDF 的笔迹是纸上的真色：深色主题下色点、色样和条子底色对比度不到 3:1 的描一圈白（同 iPad 笔盘）
  const pop = getComputedStyle(document.documentElement).getPropertyValue('--pop').trim()
  const faint = (c: string) => document.documentElement.dataset.tone === 'dark' && contrast(c, pop) < 3
  const names: Record<string, string> = {
    '#1d2421': t('黑'),
    '#1e4aa4': t('蓝'),
    '#9f2323': t('红'),
    '#12805a': t('绿'),
    '#c27700': t('橙'),
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
          style={{ background: c, ...(faint(c) ? { boxShadow: RING } : {}) }}
          onClick={() => (recolor(c), setColors(null))}
        />
      ))}
    </div>
  )
  const node = (
    <>
      {sel.size > 0 && p.active && (
        <SelBar
          count={t('已选{n}笔', { n: sel.size })}
          items={[
            { k: 'color', label: t('颜色'), ...(same ? { dot: same, dotRing: faint(same) } : { icon: 'symbol-color' as const }), menu: true, tip: t('改这几笔的颜色') },
            { k: 'delete', label: t('删除'), icon: 'trash', red: true, sep: true, tip: t('删掉这几笔'), keys: '⌫' },
          ]}
          foldOrder={[]}
          label={t('选中的笔迹')}
          testid="pdf-ink-selbar"
          hidden={!!drag}
          open={colors ? 'color' : null}
          scrollers={[p.scroller.current]}
          measure={() => {
            const sc = p.scroller.current
            if (!sc || !sc.checkVisibility()) return null
            const a = sc.getBoundingClientRect()
            return { sel: selBox.current, area: { left: a.left, top: a.top, right: a.right, bottom: a.bottom } }
          }}
          onAct={(k, el) => {
            if (k === 'delete') remove(sel)
            else if (k === 'color') {
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
  return { layer, down, node, count: strokes.length }
}
