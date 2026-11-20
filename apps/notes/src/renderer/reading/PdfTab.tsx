import { composing } from '../ime'
/**
 * 中间栏的 PDF 标签：一页一页往下滚（只画看得到的几页），文字层能选字；
 * 拖一个框就问（框完右栏 AI 输入框顶上那一排第一张就是这块截图，回车就发），没框时 ⌘↵ 问整页、框着时 ⌘↵ 是改问法（CN-92 方向 A）；
 * 框好的工具条「讲解一下 ↵ · 翻译 + 讲一讲 · 改问法 ⌘↵ · 引用这块 ⇧⌘L · ×」，点外面就收（CN-97）；
 * 页边「这里问过」的小标记，点了右栏切到笔记那一段；从笔记点回来，翻到那页、框闪两下。
 * 照 design/pdf 方向 A（右栏切换）的 spec 1.2–1.4。
 */
import { Codicon } from '@cn/design'
import { AiIcon } from '../engine-logo'
import { menuAt } from '../ctx/menu'
import { ActBtn, TabActs } from '../shell/TabActs'
import type { Rect } from '@cn/format'
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { closePdf, loadPdf, type PdfDoc, pdfjs } from './pdf'
import * as R from './store'
import type { Material } from '../../shared/materials'
import { useDismiss } from '../use-dismiss'

interface Size {
  w: number
  h: number
}
/** 拖框时：页面上的像素 */
interface Drag {
  page: number
  x0: number
  y0: number
  x1: number
  y1: number
}
/** 松手后留着的框（这一页上的比例）或选中的字 */
interface Boxed {
  page: number
  rect: Rect
  quote?: string
}

const PAD_TOP = 24
const GAP = 24
const MIN_BOX = 14

const zoomKey = (p: string) => `cn.pdfZoom:${p}`

export function PdfTab(props: {
  path: string
  active: boolean
  /** 框好了：右栏打开到 AI */
  onAsk(): void
  /** 点了页边标记：右栏切到笔记那一段 */
  onShowNote(id: string): void
  onNotice(text: string): void
}) {
  const { path } = props
  const r = R.useReading(path)!
  const [doc, setDoc] = useState<PdfDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sizes, setSizes] = useState<Size[] | null>(null)
  const [width, setWidth] = useState(0)
  const [zoom, setZoom] = useState(() => {
    try {
      return Number(localStorage.getItem(zoomKey(path))) || 1
    } catch {
      return 1
    }
  })
  const [visible, setVisible] = useState<Set<number>>(new Set([1, 2]))
  const [page, setPage] = useState(1)
  const [pageEdit, setPageEdit] = useState(false)
  const [more, setMore] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [boxed, setBoxed] = useState<Boxed | null>(null)
  /** 框好的工具条开着（框还在、工具条收了：点进了输入框、按了改问法） */
  const [capOpen, setCapOpen] = useState(false)
  const capRef = useRef<HTMLDivElement>(null)
  /** 第几块框（每框一块、取消一块加一）：截图截好时已经不是这一块了就丢掉 */
  const boxSeq = useRef(0)
  /** 工具条伸出这一页右边多少（往左挪回来） */
  const [capShift, setCapShift] = useState(0)
  const [flash, setFlash] = useState<{ page: number; rect?: Rect; seq: number } | null>(null)
  const [hoverThread, setHoverThread] = useState<string | null>(null)
  const [plusOpen, setPlusOpen] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  // 标签关了：排着的那一问不发、不记笔记（正在答的照常答完）
  useEffect(() => () => R.closed(path), [path])

  // ---------- 打开 ----------
  useEffect(() => {
    let alive = true
    let opened: PdfDoc | null = null
    void R.load(path)
    loadPdf(path).then(
      async ({ doc: d, hash }) => {
        opened = d
        if (!alive) return closePdf(path, d)
        const out: Size[] = []
        for (let i = 1; i <= d.numPages; i++) {
          const p = await d.getPage(i)
          const vp = p.getViewport({ scale: 1 })
          out.push({ w: vp.width, h: vp.height })
        }
        if (!alive) return
        setDoc(d)
        setSizes(out)
        // 后台读全文（AI 先把整份读一遍）；读的时候已经能问
        void R.readAll(path, hash, d.numPages)
      },
      (e) => alive && setError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')),
    )
    return () => {
      alive = false
      if (opened) closePdf(path, opened)
    }
  }, [path])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => el.clientWidth && setWidth(el.clientWidth))
    ro.observe(el)
    if (el.clientWidth) setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const maxW = sizes ? Math.max(...sizes.map((s) => s.w)) : 600
  // 适合宽度：左边留 40 写页码、右边 52 放标记
  const fit = width ? (width - 40 - 52) / maxW : 1
  const scale = Math.max(0.25, Math.min(fit * zoom, 6))

  const pageTop = useCallback(
    (n: number) => {
      if (!sizes) return 0
      let y = PAD_TOP
      for (let i = 0; i < n - 1; i++) y += sizes[i]!.h * scale + GAP
      return y
    },
    [sizes, scale],
  )

  // 缩放前记住看到哪页、页里哪里，换了比例滚回去
  const anchor = useRef<{ page: number; frac: number } | null>(null)
  const prevScale = useRef(scale)
  if (prevScale.current !== scale && scroller.current && sizes) {
    const st = scroller.current.scrollTop
    let y = PAD_TOP
    let n = 1
    for (let i = 0; i < sizes.length; i++) {
      const h = sizes[i]!.h * prevScale.current
      if (y + h + GAP > st) {
        n = i + 1
        break
      }
      y += h + GAP
    }
    anchor.current = { page: n, frac: (st - y) / (sizes[n - 1]!.h * prevScale.current) }
    prevScale.current = scale
  }
  useLayoutEffect(() => {
    if (!anchor.current || !scroller.current || !sizes) return
    const a = anchor.current
    scroller.current.scrollTop = pageTop(a.page) + a.frac * sizes[a.page - 1]!.h * scale
    anchor.current = null
  }, [scale, sizes, pageTop])

  // 回到上次看到的那页（只在打开时一次）；不是第 1 页就在底栏正中说一声（和别的提示一样，不压在页面上）
  useLayoutEffect(() => {
    if (restored.current || !sizes || !width || !r.loaded || !scroller.current) return
    restored.current = true
    const p = Math.min(Math.max(1, r.state.page), sizes.length)
    if (p > 1) {
      scroller.current.scrollTop = pageTop(p) - 8
      props.onNotice(`回到上次看到的第${p}页`)
    }
    onScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes, width, r.loaded])

  function onScroll() {
    const el = scroller.current
    if (!el || !sizes) return
    const st = el.scrollTop
    const bottom = st + el.clientHeight
    // 现在是第几页：露出来最多的那一页，一样多取上面那页（窗口窄、一屏装下好几页时还是第 1 页，不自己跳到第 2 页）
    let y = PAD_TOP
    let n = 1
    let best = -1
    const vis = new Set<number>()
    for (let i = 0; i < sizes.length; i++) {
      const h = sizes[i]!.h * scale
      const shown = Math.min(y + h, bottom) - Math.max(y, st)
      if (shown > best + 1) {
        best = shown
        n = i + 1
      }
      if (y + h > st - el.clientHeight && y < st + el.clientHeight * 2) vis.add(i + 1)
      y += h + GAP
    }
    setVisible((old) => (same(old, vis) ? old : vis))
    setPage(n)
    if (restored.current) R.setPage(path, n)
  }
  useEffect(() => {
    if (sizes && width) onScroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes, width, scale])

  useEffect(() => {
    try {
      localStorage.setItem(zoomKey(path), String(zoom))
    } catch {
      // 记不住缩放不影响看
    }
  }, [path, zoom])

  // ---------- 从笔记跳回来：翻到那页，框的上沿停在视口上方约 80，框闪两下 ----------
  useEffect(() => {
    const j = r.jump
    if (!j || !sizes || !scroller.current) return
    const p = Math.min(Math.max(1, j.page), sizes.length)
    const y = pageTop(p) + (j.rect ? j.rect[1] * sizes[p - 1]!.h * scale : 0) - 80
    scroller.current.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    setFlash({ page: p, ...(j.rect ? { rect: j.rect } : {}), seq: j.seq })
    const t = setTimeout(() => setFlash((f) => (f?.seq === j.seq ? null : f)), 1900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.jump?.seq, sizes])

  // 发出去了（右栏回车、工具条按钮）：实线框和工具条马上收起来
  useEffect(() => {
    if (!r.pending) {
      setBoxed(null)
      setCapOpen(false)
    }
  }, [r.pending])
  // 改问法了（工具条、⌘↵）：工具条收起，框和图留着（CN-92 方向 A）
  useEffect(() => {
    if (r.pending?.blank) setCapOpen(false)
  }, [r.pending?.blank])
  // 工具条点外面就收（CN-97）：点进 AI 输入框（和它弹出来的菜单）只收工具条，框和图留着；点 PDF 空白处、标签条、右栏空白处连框一起取消；
  // esc：焦点在输入框里、输入框里是自己打的字时只收工具条，别的连框和图一起取消；窗口失焦（切到别的软件、点进右栏网页）什么都不动，回来还在
  useDismiss(capOpen, [capRef], (why, target, event) => {
    if (why === 'blur') return
    const el = target instanceof Element ? target : null
    if (why === 'outside' && el?.closest('[data-composer], [data-composer-pop]')) return setCapOpen(false)
    // 右键（在选着的字上要右键菜单「拷贝」「讲解一下」）：只收工具条，框和选着的字留着
    if (why === 'outside' && event instanceof PointerEvent && event.button !== 0) return setCapOpen(false)
    if (why === 'esc') {
      const t = document.activeElement
      if (t instanceof HTMLTextAreaElement && t.closest('[data-composer]') && t.dataset.own === '1') return setCapOpen(false)
    }
    cancelBox()
  })

  // ---------- 框一块 ----------
  const pageAt = (target: EventTarget | null) => (target as Element | null)?.closest('.pdfpage') as HTMLElement | null

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    const pageEl = pageAt(e.target)
    if (!pageEl) return
    // 在能选的字上拖 = 选字；按住 ⌘ 在哪都框
    const onText = (e.target as Element).closest('.textLayer span') && !(e.target as Element).closest('.endOfContent')
    if (onText && !e.metaKey) return
    e.preventDefault()
    window.getSelection()?.removeAllRanges()
    const b = pageEl.getBoundingClientRect()
    const x = e.clientX - b.left
    const y = e.clientY - b.top
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({ page: Number(pageEl.dataset.page), x0: x, y0: y, x1: x, y1: y })
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return
    const pageEl = scroller.current?.querySelector<HTMLElement>(`.pdfpage[data-page="${drag.page}"]`)
    if (!pageEl) return
    const b = pageEl.getBoundingClientRect()
    setDrag({ ...drag, x1: clamp(e.clientX - b.left, 0, b.width), y1: clamp(e.clientY - b.top, 0, b.height) })
  }

  async function onPointerUp() {
    if (!drag) return onSelectionEnd()
    const d = drag
    setDrag(null)
    const s = sizes![d.page - 1]!
    const pw = s.w * scale
    const ph = s.h * scale
    const w = Math.abs(d.x1 - d.x0)
    const h = Math.abs(d.y1 - d.y0)
    if (w < MIN_BOX || h < MIN_BOX) {
      // 点一下空白处：选字的工具条收起来（框好的那块要按 esc 或 × 取消）
      if (boxed?.quote) setBoxed(null)
      return
    }
    const rect: Rect = [Math.min(d.x0, d.x1) / pw, Math.min(d.y0, d.y1) / ph, w / pw, h / ph]
    setBoxed({ page: d.page, rect })
    setCapOpen(true)
    blankNext.current = false
    props.onAsk()
    const sentAt = R.get(path).sent
    const mine = ++boxSeq.current
    try {
      const c = await R.cropOf(path, d.page, rect)
      // 截好之前已经取消了这块（点了空白处、esc、×）或者又框了一块：晚到的截图丢掉，不再放回去
      if (mine !== boxSeq.current) return URL.revokeObjectURL(c.url)
      // 截好之前已经按了改问法（手快）：截好的这块直接是改问法的样子
      R.stage(path, { page: d.page, rect, url: c.url, png: c.png, w: c.cssW, ...(blankNext.current ? { blank: true } : {}) }, sentAt)
      blankNext.current = false
    } catch (e) {
      setBoxed(null)
      setCapOpen(false)
      props.onNotice(String((e as Error).message ?? e))
    }
  }

  /** PDF 里选着的那段字（页码、在页上的位置、去掉多余空白的字）；没选、选在别处是 null */
  function selectionBox(): Boxed | null {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null
    const range = sel.getRangeAt(0)
    const pageEl = pageAt(range.startContainer.parentElement)
    if (!pageEl || !scroller.current?.contains(pageEl)) return null
    const quote = sel.toString().replace(/\s+/g, ' ').trim()
    if (quote.length < 2) return null
    const pb = pageEl.getBoundingClientRect()
    const rb = range.getBoundingClientRect()
    return { page: Number(pageEl.dataset.page), rect: [(rb.left - pb.left) / pb.width, (rb.top - pb.top) / pb.height, rb.width / pb.width, rb.height / pb.height], quote }
  }

  /** 选中一段字：工具条出在选区上方，问的时候截图换成引文 */
  function onSelectionEnd() {
    const b = selectionBox()
    if (!b) return
    setBoxed(b)
    setCapOpen(true)
  }

  /** 右键（DESIGN.v3 9.2）：选了字是拷贝、问 AI、翻译 + 讲一讲；页面上是问这一页、跳到笔记、在访达中显示 */
  function onContext(e: React.MouseEvent) {
    const pageEl = pageAt(e.target)
    if (!pageEl) return
    const n = Number(pageEl.dataset.page)
    const sel = selectionBox()
    const threads = r.state.threads.filter((t) => t.page === n)
    void menuAt(e, [
      sel && { edit: 'copy' },
      // AI 那几项（带引擎标志）自成一组
      '-',
      sel && { label: '问 AI', ai: 'chat', run: () => capAsk('rephrase', sel) },
      sel && { label: '讲解一下', ai: 'chat', run: () => capAsk('explain', sel) },
      sel && { label: '翻译 + 讲一讲', ai: 'chat', run: () => capAsk('translate', sel) },
      '-',
      { label: `问这一页（第 ${n} 页）`, accel: 'CommandOrControl+Return', ai: 'chat', enabled: !!doc && r.running === null, run: () => askPage(n) },
      '-',
      threads.length > 0 && { label: '跳到笔记', run: () => props.onShowNote(threads[threads.length - 1]!.id) },
      '-',
      { label: '在访达中显示', run: () => window.cnReading.reveal(path) },
    ])
  }

  function cancelBox() {
    boxSeq.current++
    setBoxed(null)
    setCapOpen(false)
    R.unstage(path)
    window.getSelection()?.removeAllRanges()
  }

  /**
   * 引用这块（⇧⌘L，多段引用方向 B）：框的图成为 AI 输入框顶上那一排的一块材料（来源「第28页 · 我框的」），选着的一段字成为一块引用（「第28页」）；
   * 框和工具条收起，可以接着框下一块
   */
  async function capQuote(b = boxed) {
    if (!b) return
    props.onAsk()
    if (b.quote) {
      cancelBox()
      R.addMaterial(path, { kind: 'quote', text: b.quote, src: `第${b.page}页` })
      return
    }
    // 截图还在截的话等它好（最多 5 秒）
    for (let i = 0; i < 125 && !R.get(path).pending?.png; i++) await new Promise((res) => setTimeout(res, 40))
    const png = R.get(path).pending?.png
    cancelBox()
    if (!png) return props.onNotice('这块还没截好，再框一次')
    try {
      const mat: Material = { kind: 'image', name: await window.cn.aiPaste(png, 'image/png'), src: `第${b.page}页 · 我框的`, page: b.page }
      R.addMaterial(path, mat)
    } catch (e) {
      props.onNotice(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  /** 已经点过「讲解一下」「翻译 + 讲一讲」的那一块：手快连点两下，第二下不再发（CN-28） */
  const asking = useRef<Boxed | null>(null)
  /** 框的这块还在截就按了改问法：截好时直接放成改问法的样子 */
  const blankNext = useRef(false)
  /** 工具条上的按钮：讲解一下 / 翻译 + 讲一讲 直接发（AI 还在答就排在后面）；改问法（⌘↵）只放好图、工具条收起，光标进输入框 */
  async function capAsk(kind: 'explain' | 'translate' | 'rephrase', b = boxed) {
    if (!b) return
    if (kind !== 'rephrase') {
      if (asking.current === b) return
      asking.current = b
    }
    props.onAsk()
    if (b.quote) R.stage(path, { page: b.page, rect: b.rect, quote: b.quote, ...(kind === 'rephrase' ? { blank: true } : { direct: true }) })
    else if (kind === 'rephrase') {
      const pend = R.get(path).pending
      if (pend) R.stage(path, { ...pend, blank: true })
      else blankNext.current = true
    }
    if (kind === 'rephrase') setCapOpen(false)
    window.getSelection()?.removeAllRanges()
    if (kind === 'rephrase') return
    // 截图还在截的话等它好；5 秒还没好就不带图问这一块（框的位置还在），晚到的截图丢掉
    for (let i = 0; i < 125 && !b.quote && !R.get(path).pending?.png; i++) await new Promise((res) => setTimeout(res, 40))
    if (!R.get(path).pending) R.stage(path, { page: b.page, rect: b.rect, direct: true })
    await R.send(path, kind === 'explain' ? '给我讲解一下' : '先把这块翻译成中文，再讲一讲')
  }

  /** 问这一页：整页当一个框，直接发出；text：输入框里自己打的那句（不给是「给我讲解一下这一页」），mats：输入框里带的材料 */
  const pageAsking = useRef(false)
  async function askPage(n = page, text = '给我讲解一下这一页', mats: Material[] = []) {
    if (!doc || R.get(path).running !== null || pageAsking.current) return
    pageAsking.current = true
    props.onAsk()
    try {
      const c = await R.cropOf(path, n)
      R.stage(path, { page: n, url: c.url, png: c.png, w: c.cssW, direct: true })
      await R.send(path, text, [], mats.length ? { mats } : {})
    } catch (e) {
      props.onNotice(String((e as Error).message ?? e))
    } finally {
      pageAsking.current = false
    }
  }

  // ⌘↵：框着一块是改问法（CN-92 方向 A），没框问这一页（在 AI 输入框里也一样，那边先接）；⇧⌘L 引用这块；esc 取消框
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey && !e.isComposing) {
        e.preventDefault()
        if (boxed) void capAsk('rephrase')
        else void askPage()
      } else if (e.metaKey && e.shiftKey && e.code === 'KeyL' && boxed) {
        e.preventDefault()
        void capQuote()
      } else if (e.key === 'Escape' && boxed && !(e.target as Element)?.closest?.('textarea')) cancelBox()
      else if (e.metaKey && (e.key === '=' || e.key === '+')) (e.preventDefault(), setZoom((z) => Math.min(4, z * 1.15)))
      else if (e.metaKey && e.key === '-') (e.preventDefault(), setZoom((z) => Math.max(0.4, z / 1.15)))
      else if (e.metaKey && e.key === '0') (e.preventDefault(), setZoom(1))
    }
    // 输入框里打了自己的问题再按 ⌘↵：带上这一页问这句（ReadingAi 发来，带着输入框里的材料）
    const onAskPage = (e: Event) => {
      const d = (e as CustomEvent<{ src: string; text: string; mats?: Material[] }>).detail
      if (d.src === path) void askPage(page, d.text, d.mats ?? [])
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(R.ASK_PAGE, onAskPage)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(R.ASK_PAGE, onAskPage)
    }
  })

  function goPage(n: number) {
    if (!sizes || !scroller.current) return
    scroller.current.scrollTop = pageTop(Math.min(Math.max(1, Math.round(n)), sizes.length)) - 8
  }

  const rounds = (id: string) => r.state.msgs.filter((m) => m.thread === id && m.role === 'user').length

  // ---------- 页边标记：每处问过的地方一颗，一页超过 3 颗时第 3 颗是 +N ----------
  const current = r.focus?.id ?? null
  const fresh = r.state.threads.length ? r.state.threads.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)) : null

  const cap = boxed && sizes ? capPos(boxed, sizes[boxed.page - 1]!, scale) : null
  // 工具条比框宽、框靠右时伸出看得见的这一栏：往左挪回来，最多挪到这一栏的左边（页边的空处也用上）
  useLayoutEffect(() => {
    const el = capRef.current
    const view = scroller.current
    if (!el || !view) return setCapShift(0)
    const r = el.getBoundingClientRect()
    const left = r.left - capShift
    const v = view.getBoundingClientRect()
    const over = left + r.width - (v.right - 8)
    setCapShift(over > 0 ? -Math.max(0, Math.min(over, left - (v.left + 8))) : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capOpen, cap?.left, cap?.top, boxed?.quote, width])

  return (
    <section className="pane pdfpane" hidden={!props.active} data-path={path}>
      <TabActs active={props.active}>
        {sizes && (
          <div className="pager num" data-testid="pdf-pager">
            {pageEdit ? (
              <input
                autoFocus
                aria-label="跳到第几页"
                defaultValue={page}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={() => setPageEdit(false)}
                onKeyDown={(e) => {
                  if (composing(e)) return
                  if (e.key === 'Enter') {
                    goPage(Number(e.currentTarget.value))
                    setPageEdit(false)
                  } else if (e.key === 'Escape') setPageEdit(false)
                }}
              />
            ) : (
              <button data-tip="点一下输入页码" data-side="below" onClick={() => setPageEdit(true)}>
                {page} / {sizes.length}
              </button>
            )}
          </div>
        )}
        <ActBtn icon="comment-discussion" ai="chat" label="问这一页" keys="⌘↵" disabled={!doc || r.running !== null} onClick={() => void askPage()} />
        <div className="pdfmore">
          <ActBtn icon="ellipsis" label="更多" aria-expanded={more} onClick={() => setMore((v) => !v)} />
          {more && (
            <div className="menu" role="menu" aria-label="更多" onMouseLeave={() => setMore(false)}>
              <button role="menuitem" onClick={() => (setZoom((z) => Math.min(4, z * 1.15)), setMore(false))}>
                <Codicon name="zoom-in" size={14} />
                放大<kbd>⌘=</kbd>
              </button>
              <button role="menuitem" onClick={() => (setZoom((z) => Math.max(0.4, z / 1.15)), setMore(false))}>
                <Codicon name="zoom-out" size={14} />
                缩小<kbd>⌘-</kbd>
              </button>
              <button role="menuitem" onClick={() => (setZoom(1), setMore(false))}>
                <Codicon name="arrow-both" size={14} />
                适合宽度<kbd>⌘0</kbd>
              </button>
              <button role="menuitem" onClick={() => (void window.cnReading.reveal(path), setMore(false))}>
                <Codicon name="folder-opened" size={14} />
                在访达中显示
              </button>
            </div>
          )}
        </div>
      </TabActs>
      <div className="pdfbody">
        {error && <div className="pdferr">打不开这份PDF：{error}</div>}
        <div
          className={'pdfv' + (drag ? ' drawing' : '')}
          ref={scroller}
          tabIndex={0}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onContextMenu={onContext}
          onPointerMove={onPointerMove}
          onPointerUp={() => void onPointerUp()}
          data-testid="pdf-view"
        >
          {sizes?.map((s, i) => {
            const n = i + 1
            const threads = r.state.threads.filter((t) => t.page === n)
            const shown = threads.length > 3 ? threads.slice(0, 2) : threads
            const extra = threads.length > 3 ? threads.slice(2) : []
            return (
              <div key={n} className="pdfrow" style={{ marginTop: n === 1 ? PAD_TOP : 0 }}>
              <div className="pdfslot" style={{ width: s.w * scale, height: s.h * scale }}>
                <span className="pno num">{n}</span>
                <PageView doc={doc!} n={n} w={s.w * scale} h={s.h * scale} scale={scale} render={!!doc && visible.has(n)} />
                <div className="pdfover">
                  {drag?.page === n && <div className="fr drawing" style={px(drag)} />}
                  {boxed?.page === n && !boxed.quote && <div className="fr pending" style={pct(boxed.rect)} data-testid="pdf-box" />}
                  {threads.map((t) =>
                    t.rect ? <div key={t.id} className={'fr asked' + (hoverThread === t.id ? ' show' : '')} style={pct(t.rect)} /> : null,
                  )}
                  {flash?.page === n && <div key={flash.seq} className={'fr flash' + (flash.rect ? '' : ' whole')} style={flash.rect ? pct(flash.rect) : undefined} data-testid="pdf-flash" />}
                </div>
                {shown.map((t) => (
                  <button
                    key={t.id}
                    className={'mk num' + (current === t.id ? ' cur' : '') + (fresh?.id === t.id && Date.now() - t.createdAt < 1500 ? ' new' : '')}
                    style={{ top: (t.rect ? t.rect[1] : 0) * s.h * scale }}
                    title={`这里问过 ${rounds(t.id)} 轮 · 点一下看笔记`}
                    aria-label={`第 ${n} 页这里问过 ${rounds(t.id)} 轮`}
                    onMouseEnter={() => setHoverThread(t.id)}
                    onMouseLeave={() => setHoverThread(null)}
                    onClick={() => props.onShowNote(t.id)}
                  >
                    <Codicon name="comment" size={12} />
                    {rounds(t.id)}
                  </button>
                ))}
                {extra.length > 0 && (
                  <button className="mk num" style={{ top: (extra[0]!.rect ? extra[0]!.rect[1] : 0) * s.h * scale }} aria-label={`第 ${n} 页还有 ${extra.length} 处问过`} onClick={() => setPlusOpen(plusOpen === n ? null : n)}>
                    +{extra.length}
                  </button>
                )}
                {plusOpen === n && (
                  <div className="mklist" role="menu" style={{ top: (extra[0]!.rect ? extra[0]!.rect[1] : 0) * s.h * scale + 26 }} onMouseLeave={() => setPlusOpen(null)}>
                    {extra.map((t) => (
                      <button key={t.id} role="menuitem" onClick={() => (setPlusOpen(null), props.onShowNote(t.id))}>
                        <span className="num">{where(t.rect)}</span>
                        <b className="truncate">{r.note.sections.find((x) => x.id === t.id)?.title ?? '还在记'}</b>
                      </button>
                    ))}
                  </div>
                )}
                {capOpen && cap && boxed?.page === n && !r.queued.length && (
                  <div
                    ref={capRef}
                    className="cap capbar"
                    style={{ left: cap.left, top: cap.top, ...(capShift ? { translate: `${capShift}px 0` } : {}) }}
                    role="toolbar"
                    aria-label="框好的这块"
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <button className="main" onClick={() => void capAsk('explain')}>
                      <AiIcon job="chat" size={14} />
                      讲解一下<kbd>↵</kbd>
                    </button>
                    <button onClick={() => void capAsk('translate')}>
                      <Codicon name="whole-word" size={14} />
                      翻译 + 讲一讲
                    </button>
                    <button onClick={() => void capAsk('rephrase')}>
                      <Codicon name="edit" size={14} />
                      改问法<kbd>⌘↵</kbd>
                    </button>
                    <button onClick={() => void capQuote()}>
                      <Codicon name="quote" size={14} />
                      {boxed.quote ? '引用这段' : '引用这块'}
                      <kbd>⇧⌘L</kbd>
                    </button>
                    <span className="sepv" />
                    <button aria-label="取消" data-tip="取消 esc" data-side="below" onClick={cancelBox}>
                      <Codicon name="close" size={14} />
                    </button>
                  </div>
                )}
              </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** 工具条（34 高）放在框下面 8；下面放不下就放上面 */
function capPos(b: Boxed, s: Size, scale: number) {
  const ph = s.h * scale
  const top = (b.rect[1] + b.rect[3]) * ph + 8
  const above = b.rect[1] * ph - 42
  return { left: Math.max(0, b.rect[0] * s.w * scale), top: b.quote || top + 34 > ph ? Math.max(0, above) : top }
}

function where(rect?: Rect) {
  if (!rect) return '整页'
  const y = rect[1] + rect[3] / 2
  return y < 0.33 ? '上方' : y < 0.66 ? '中间' : '下方'
}

const px = (d: Drag) => ({ left: Math.min(d.x0, d.x1), top: Math.min(d.y0, d.y1), width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0) })
const pct = (r: Rect) => ({ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` })
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b)

function same(a: Set<number>, b: Set<number>) {
  if (a.size !== b.size) return false
  for (const x of a) if (!b.has(x)) return false
  return true
}

/** 一页：看得到才画（画布 + 文字层）；看不到的只占位 */
const PageView = memo(function PageView(p: { doc: PdfDoc; n: number; w: number; h: number; scale: number; render: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!p.render || !p.doc) return
    let cancelled = false
    let task: ReturnType<pdfjs.PDFPageProxy['render']> | null = null
    let tl: pdfjs.TextLayer | null = null
    void (async () => {
      const page = await p.doc.getPage(p.n)
      if (cancelled) return
      const vp = page.getViewport({ scale: p.scale })
      const dpr = window.devicePixelRatio || 1
      const canvas = canvasRef.current!
      // 换了比例重画：画好之前不算画好
      delete canvas.dataset.ready
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      task = page.render({ canvas, viewport: vp, ...(dpr !== 1 ? { transform: [dpr, 0, 0, dpr, 0, 0] } : {}) })
      try {
        await task.promise
      } catch {
        return
      }
      if (cancelled || !textRef.current) return
      textRef.current.replaceChildren()
      tl = new pdfjs.TextLayer({ textContentSource: page.streamTextContent(), container: textRef.current, viewport: vp })
      await tl.render().catch(() => undefined)
      if (!cancelled) canvas.dataset.ready = '1'
    })()
    return () => {
      cancelled = true
      task?.cancel()
      tl?.cancel()
    }
  }, [p.doc, p.n, p.scale, p.render])
  return (
    <div className="pdfpage" data-page={p.n} style={{ width: p.w, height: p.h, ['--total-scale-factor' as string]: p.scale, ['--scale-round-x' as string]: '1px', ['--scale-round-y' as string]: '1px' }}>
      <canvas ref={canvasRef} style={{ width: p.w, height: p.h }} />
      <div className="textLayer" ref={textRef} />
    </div>
  )
})
