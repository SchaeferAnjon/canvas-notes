/**
 * 中间栏的 PDF 标签：一页一页往下滚（只画看得到的几页），文字层能选字；
 * 拖一个框就问（框完右栏 AI 输入框里就有这块截图，回车就发），⌘↵ 问整页；
 * 页边「这里问过」的小标记，点了右栏切到笔记那一段；从笔记点回来，翻到那页、框闪两下。
 * 照 design/pdf 方向 A（右栏切换）的 spec 1.2–1.4。
 */
import { Codicon } from '@cn/design'
import { menuAt } from '../ctx/menu'
import { ActBtn, TabActs } from '../shell/TabActs'
import type { Rect } from '@cn/format'
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { courseOf, decorations } from '@cn/format'
import { closePdf, loadPdf, type PdfDoc, pdfjs } from './pdf'
import * as R from './store'
import { BiBar, SideCol } from './bilingual/BiParts'
import { type FlowBlock, type FlowGroup, ReflowView } from './bilingual/ReflowView'
import { autoLayout, type BiLayout, type BiMode, langsLine, nextMode, saveMode, savedMode, useBi } from './bilingual/store'
import { biStatus, blockRect, bodyBlocks, savePdfBilingual } from './bilingual/pdf-bilingual'
import { MineruBar, MineruTool, useMineruStatus } from './MineruBar'

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
  /** 右栏 AI 开着（对照的默认版式看它） */
  aiOpen: boolean
  /** 打开库里的一篇（存好的双语笔记、术语表） */
  onOpenNote(path: string): void
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
  const [biMenu, setBiMenu] = useState(false)
  /** 对照读按钮：上次用的是对照还是只看译文 */
  const lastBi = useRef<BiMode>('bi')
  const [drag, setDrag] = useState<Drag | null>(null)
  const [boxed, setBoxed] = useState<Boxed | null>(null)
  const [flash, setFlash] = useState<{ page: number; rect?: Rect; seq: number } | null>(null)
  const [hoverThread, setHoverThread] = useState<string | null>(null)
  const [plusOpen, setPlusOpen] = useState<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  // ---------- 双语：原文 / 对照 / 只看译文；对照时 并排 / 重排 ----------
  const [bi, setBi] = useState<{ mode: BiMode; layout?: BiLayout }>(() => savedMode(path))
  /** 没手选过版式时，进对照那一刻定下来的（之后 AI 开合不换，框不跳） */
  const [autoLay, setAutoLay] = useState<BiLayout>('side')
  const [hoverBlock, setHoverBlock] = useState<{ page: number; id: string } | null>(null)
  const [flowScroll, setFlowScroll] = useState<{ key: string; seq: number } | null>(null)
  const [flowFlash, setFlowFlash] = useState<{ key: string; seq: number } | null>(null)
  const [stagedBlock, setStagedBlock] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const course = courseOf(path) ?? null
  const trBi = useBi(path)
  // PDF 精读增强：哪都找不到 MinerU 时工具条下面一行提示；后台认完换上它的块时底栏说一声
  const mineru = useMineruStatus()
  const wasLayout = useRef(r.layout)
  useEffect(() => {
    if (wasLayout.current === 'pdfjs' && r.layout === 'mineru' && props.active) props.onNotice('已换成PDF精读增强认的版面：表格、公式、图注')
    wasLayout.current = r.layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.layout])
  const layout: BiLayout = bi.layout ?? autoLay
  const flow = bi.mode === 'tr' || (bi.mode === 'bi' && layout === 'flow')
  const side = bi.mode === 'bi' && layout === 'side'

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
  // 适合宽度：左边留 40 写页码、右边 52 放标记；并排时原页占 0.56、最宽 640，右边是译文
  const fit = width ? (side ? Math.min((width - 40 - 52) * 0.56, 640) : width - 40 - 52) / maxW : 1
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
    if (j && flow) {
      // 重排里没有原页：滚到那一页的段组，外圈闪一下
      setFlowScroll({ key: `p${j.page}`, seq: j.seq })
      setFlowFlash({ key: `p${j.page}`, seq: j.seq })
      const t = setTimeout(() => setFlowFlash((f) => (f?.seq === j.seq ? null : f)), 1900)
      return () => clearTimeout(t)
    }
    if (!j || !sizes || !scroller.current) return
    const p = Math.min(Math.max(1, j.page), sizes.length)
    const y = pageTop(p) + (j.rect ? j.rect[1] * sizes[p - 1]!.h * scale : 0) - 80
    scroller.current.scrollTo({ top: Math.max(0, y), behavior: 'smooth' })
    setFlash({ page: p, ...(j.rect ? { rect: j.rect } : {}), seq: j.seq })
    const t = setTimeout(() => setFlash((f) => (f?.seq === j.seq ? null : f)), 1900)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.jump?.seq, sizes])

  // 发出去了（右栏回车）：实线框收起来
  useEffect(() => {
    if (!r.pending) {
      setBoxed(null)
      setStagedBlock(null)
    }
  }, [r.pending])

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
    props.onAsk()
    const sentAt = R.get(path).sent
    try {
      const c = await R.cropOf(path, d.page, rect)
      R.stage(path, { page: d.page, rect, url: c.url, png: c.png }, sentAt)
    } catch (e) {
      setBoxed(null)
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
    if (b) setBoxed(b)
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
      sel && { label: '问 AI', run: () => capAsk('rephrase', sel) },
      sel && { label: '讲解一下', run: () => capAsk('explain', sel) },
      sel && { label: '翻译 + 讲一讲', run: () => capAsk('translate', sel) },
      '-',
      { label: `问这一页（第 ${n} 页）`, accel: 'CommandOrControl+Return', enabled: !!doc && r.running === null, run: () => askPage(n) },
      threads.length > 0 && { label: '跳到笔记', run: () => props.onShowNote(threads[threads.length - 1]!.id) },
      '-',
      { label: '在访达中显示', run: () => window.cnReading.reveal(path) },
    ])
  }

  function cancelBox() {
    setBoxed(null)
    R.unstage(path)
    window.getSelection()?.removeAllRanges()
  }

  /** 已经点过「讲解一下」「翻译 + 讲一讲」的那一块：手快连点两下，第二下不再发（CN-28） */
  const asking = useRef<Boxed | null>(null)
  /** 工具条上的按钮：讲解一下 / 翻译 + 讲一讲 直接发（AI 还在答就排在后面）；改问法 只放好图，光标进输入框 */
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
    }
    window.getSelection()?.removeAllRanges()
    if (kind === 'rephrase') return
    // 截图还在截的话等它好；5 秒还没好就不带图问这一块（框的位置还在），晚到的截图丢掉
    for (let i = 0; i < 125 && !b.quote && !R.get(path).pending?.png; i++) await new Promise((res) => setTimeout(res, 40))
    if (!R.get(path).pending) R.stage(path, { page: b.page, rect: b.rect, direct: true })
    await R.send(path, kind === 'explain' ? '给我讲解一下' : '先把这块翻译成中文，再讲一讲')
  }

  /** 问这一页：整页当一个框，直接发出；text：输入框里自己打的那句（不给是「给我讲解一下这一页」） */
  const pageAsking = useRef(false)
  async function askPage(n = page, text = '给我讲解一下这一页') {
    if (!doc || R.get(path).running !== null || pageAsking.current) return
    pageAsking.current = true
    props.onAsk()
    try {
      const c = await R.cropOf(path, n)
      R.stage(path, { page: n, url: c.url, png: c.png, direct: true })
      await R.send(path, text)
    } catch (e) {
      props.onNotice(String((e as Error).message ?? e))
    } finally {
      pageAsking.current = false
    }
  }

  // ⌘↵ 问这一页（在 AI 输入框里也一样）；esc 取消框
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.metaKey && !e.isComposing) {
        e.preventDefault()
        void askPage()
      } else if (e.key === 'Escape' && boxed && !(e.target as Element)?.closest?.('textarea')) cancelBox()
      else if (e.metaKey && (e.key === '=' || e.key === '+')) (e.preventDefault(), setZoom((z) => Math.min(4, z * 1.15)))
      else if (e.metaKey && e.key === '-') (e.preventDefault(), setZoom((z) => Math.max(0.4, z / 1.15)))
      else if (e.metaKey && e.key === '0') (e.preventDefault(), setZoom(1))
    }
    // 输入框里打了自己的问题再按 ⌘↵：带上这一页问这句（ReadingAi 发来）
    const onAskPage = (e: Event) => {
      const d = (e as CustomEvent<{ src: string; text: string }>).detail
      if (d.src === path) void askPage(page, d.text)
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

  // ---------- 双语 ----------
  const rounds = (id: string) => r.state.msgs.filter((m) => m.thread === id && m.role === 'user').length
  /** 换显示：进对照时没手选过版式就按当下定一个；换完回到同一页 */
  function setMode(mode: BiMode) {
    if (mode === bi.mode) return
    if (mode !== 'orig') lastBi.current = mode
    if (mode !== 'orig' && bi.mode === 'orig' && !bi.layout) setAutoLay(autoLayout(props.aiOpen, width))
    const next = { ...bi, mode }
    setBi(next)
    saveMode(path, next)
    setFlowScroll({ key: `p${page}`, seq: Date.now() })
  }
  function setLayout(l: BiLayout) {
    const next = { ...bi, layout: l }
    setBi(next)
    saveMode(path, next)
    setFlowScroll({ key: `p${page}`, seq: Date.now() })
  }
  // 从重排回到有原页的版式：翻到刚才看的那页
  const wasFlow = useRef(flow)
  useLayoutEffect(() => {
    if (wasFlow.current && !flow) goPage(page)
    wasFlow.current = flow
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow])

  // ⌥A 轮流切（焦点在软件里、不在输入框时）；比网页翻译的 ⌥A 先接，PDF 开着时切的是 PDF
  useEffect(() => {
    if (!props.active) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey || e.shiftKey || e.code !== 'KeyA') return
      const el = document.activeElement as HTMLElement | null
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setMode(nextMode(bi.mode))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  /** 每页的块，带公式、图的裁图 */
  const flowBlocks = useMemo(() => {
    const out: Record<number, FlowBlock[]> = {}
    if (!sizes) return out
    // Logo、校徽、页角色块：同一个位置 3 页以上都有的、很小的图，不进对照
    const decor = decorations(r.blocks, sizes)
    for (const [k, list] of Object.entries(r.blocks)) {
      const n = Number(k)
      const sz = sizes[n - 1]
      if (!sz) continue
      out[n] = bodyBlocks(list, sz, decor).map((b) => ({
          id: b.id,
          kind: b.kind,
          text: b.text,
          top: b.y,
          ...(b.stack ? { stack: b.stack } : {}),
          ...(b.by === 'mineru' ? { math: true as const } : {}),
          // 裁图按原页大约 1.25 倍显示（MinerU 认出的表格拆不出格子时也照原页裁）
          ...(b.kind === 'image' || b.kind === 'text' || b.kind === 'table' ? { crop: () => cropUrl(path, n, blockRect(b, sz)), w: Math.round((b.w + 6) * 1.25) } : {}),
        }))
    }
    return out
  }, [r.blocks, sizes, path])

  const groups: FlowGroup[] = useMemo(
    () =>
      (sizes ?? []).map((_, i) => {
        const n = i + 1
        const asked = r.state.threads.filter((t) => t.page === n)
        return {
          key: `p${n}`,
          blocks: flowBlocks[n] ?? [],
          ...(flowBlocks[n] ? {} : { loading: `正在读第${n}页…` }),
          head: (
            <>
              <button type="button" className="pgc" title="切回原文看这一页" onClick={() => (setMode('orig'), setTimeout(() => goPage(n), 0))}>
                <Codicon name="book" size={12} />{`第${n}页`}
              </button>
              {asked.slice(0, 3).map((t) => (
                <button key={t.id} type="button" className="mk num" title={`这里问过 ${rounds(t.id)} 轮 · 点一下看笔记`} onClick={() => props.onShowNote(t.id)}>
                  <Codicon name="comment" size={12} />
                  {rounds(t.id)}
                </button>
              ))}
            </>
          ),
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sizes, flowBlocks, r.state.threads, r.state.msgs],
  )

  /** 重排里「问这段」：那段照原页裁下来，进 AI 输入框 */
  async function askBlock(b: FlowBlock, key: string) {
    const n = Number(key.slice(1))
    const blk = r.blocks[n]?.find((x) => x.id === b.id)
    const sz = sizes?.[n - 1]
    if (!blk || !sz || r.running !== null) return
    const rect = blockRect(blk, sz)
    setStagedBlock(b.id)
    props.onAsk()
    const sentAt = R.get(path).sent
    try {
      const c = await R.cropOf(path, n, rect)
      R.stage(path, { page: n, rect, url: c.url, png: c.png }, sentAt)
    } catch (e) {
      setStagedBlock(null)
      props.onNotice(String((e as Error).message ?? e))
    }
  }

  /** 并排时在左边原页上移动：对应的那段译文亮 */
  function hoverPage(e: React.PointerEvent) {
    if (!side || drag || !sizes || (e.target as Element).closest('.bicol')) return
    const pageEl = pageAt(e.target)
    if (!pageEl) return setHoverBlock(null)
    const n = Number(pageEl.dataset.page)
    const b = pageEl.getBoundingClientRect()
    const x = ((e.clientX - b.left) / b.width) * sizes[n - 1]!.w
    const y = ((e.clientY - b.top) / b.height) * sizes[n - 1]!.h
    const hit = r.blocks[n]?.find((k) => k.kind !== 'image' && x >= k.x - 2 && x <= k.x + k.w + 2 && y >= k.y - 2 && y <= k.y + k.h + 2)
    setHoverBlock((old) => (hit ? (old?.id === hit.id ? old : { page: n, id: hit.id }) : null))
  }

  async function saveBi() {
    if (!sizes || saving) return
    try {
      const res = await savePdfBilingual(path, sizes, course, (t) => setSaving(t))
      setSaved(res.path)
      props.onNotice(`已存成${res.path} · 每页带回到PDF的链接`)
    } catch (e) {
      props.onNotice(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSaving(null)
    }
  }

  const status = sizes ? biStatus(trBi, flowBlocks, sizes.length) : null

  // ---------- 页边标记：每处问过的地方一颗，一页超过 3 颗时第 3 颗是 +N ----------
  const current = r.focus?.id ?? null
  const fresh = r.state.threads.length ? r.state.threads.reduce((a, b) => (a.createdAt > b.createdAt ? a : b)) : null

  const cap = boxed && sizes ? capPos(boxed, sizes[boxed.page - 1]!, scale) : null

  return (
    <section className="pane pdfpane" hidden={!props.active} data-path={path}>
      <TabActs active={props.active}>
        <MineruTool job={r.mineru} onRetry={() => void R.enhance(path, true)} />
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
        {/* 对照读：点一下按上次的方式开 / 关，小箭头里选 原文 / 对照 / 只看译文（按钮带菜单） */}
        <div className={'split-btn' + (bi.mode !== 'orig' ? ' on' : '')} data-testid="bi-mode" data-mode={bi.mode}>
          <ActBtn
            icon="split-horizontal"
            label={bi.mode === 'orig' ? '对照读' : '回到原文'}
            keys="⌥A"
            on={bi.mode !== 'orig'}
            className="bimain"
            onClick={() => setMode(bi.mode === 'orig' ? lastBi.current : 'orig')}
          />
          <ActBtn icon="chevron-down" label="原文 / 对照 / 只看译文" className="bichev" aria-expanded={biMenu} onClick={() => setBiMenu((v) => !v)} />
          {biMenu && (
            <div className="menu" role="radiogroup" aria-label="原文 对照 只看译文" onMouseLeave={() => setBiMenu(false)}>
              {(
                [
                  ['orig', '原文'],
                  ['bi', '对照'],
                  ['tr', '只看译文'],
                ] as const
              ).map(([m, name]) => (
                <button key={m} type="button" role="radio" aria-checked={bi.mode === m} className={bi.mode === m ? 'on' : ''} onClick={() => (setMode(m), setBiMenu(false))}>
                  <Codicon name={bi.mode === m ? 'check' : 'blank'} size={12} />
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
        <ActBtn icon="comment-discussion-sparkle" label="问这一页" keys="⌘↵" disabled={!doc || r.running !== null} onClick={() => void askPage()} />
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
      <MineruBar status={mineru} />
      {bi.mode !== 'orig' && status && (
        <BiBar
          langs={langsLine(Object.values(r.blocks).flat().slice(0, 40).map((b) => b.text).join(' '))}
          layout={bi.mode === 'bi' ? layout : null}
          onLayout={setLayout}
          status={status.text}
          busy={status.busy}
          course={course}
          saved={saved}
          saving={saving}
          onSave={() => void saveBi()}
          onOpenSaved={props.onOpenNote}
          onOpenGlossary={props.onOpenNote}
        />
      )}
      <div className="pdfbody">
        {flow && (
          <ReflowView
            srcKey={path}
            groups={groups}
            mode={bi.mode === 'tr' ? 'tr' : 'bi'}
            course={course}
            onAsk={(b, k) => void askBlock(b, k)}
            staged={stagedBlock}
            scrollTo={flowScroll}
            flash={flowFlash}
            onTopGroup={(k) => {
              const n = Number(k.slice(1))
              setPage(n)
              R.setPage(path, n)
            }}
          />
        )}
        {error && <div className="pdferr">打不开这份PDF：{error}</div>}
        <div
          className={'pdfv' + (drag ? ' drawing' : '') + (side ? ' side' : '')}
          hidden={flow}
          ref={scroller}
          tabIndex={0}
          onScroll={onScroll}
          onPointerDown={onPointerDown}
          onContextMenu={onContext}
          onPointerMove={(e) => (onPointerMove(e), hoverPage(e))}
          onPointerUp={() => void onPointerUp()}
          data-testid="pdf-view"
        >
          {sizes?.map((s, i) => {
            const n = i + 1
            const threads = r.state.threads.filter((t) => t.page === n)
            const shown = threads.length > 3 ? threads.slice(0, 2) : threads
            const extra = threads.length > 3 ? threads.slice(2) : []
            return (
              <div key={n} className={side ? 'birow' : 'pdfrow'} style={{ marginTop: n === 1 ? PAD_TOP : 0 }}>
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
                  {side && hoverBlock?.page === n && (() => {
                    const hb = r.blocks[n]?.find((k) => k.id === hoverBlock.id)
                    return hb ? <div className="fr hl" style={pct(blockRect(hb, s, 2))} /> : null
                  })()}
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
                {cap && boxed?.page === n && !r.queued.length && (
                  <div className="cap" style={{ left: cap.left, top: cap.top }} role="toolbar" aria-label="框好的这块" onPointerDown={(e) => e.stopPropagation()}>
                    <button onClick={() => void capAsk('explain')}>
                      讲解一下<span className="k">↵</span>
                    </button>
                    <button onClick={() => void capAsk('translate')}>
                      <Codicon name="whole-word" size={14} />
                      翻译 + 讲一讲
                    </button>
                    <button onClick={() => void capAsk('rephrase')}>
                      <Codicon name="edit" size={14} />
                      改问法
                    </button>
                    <span className="sep" />
                    <button aria-label="取消" onClick={cancelBox}>
                      <Codicon name="close" size={14} />
                    </button>
                  </div>
                )}
              </div>
              {side && (
                <SideCol
                  srcKey={path}
                  blocks={flowBlocks[n]}
                  course={course}
                  height={s.h * scale}
                  scale={scale}
                  visible={visible.has(n)}
                  hover={hoverBlock?.page === n ? hoverBlock.id : null}
                  onHover={(id) => setHoverBlock(id ? { page: n, id } : null)}
                />
              )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/** 工具条放在框下面 8；下面放不下就放上面 */
function capPos(b: Boxed, s: Size, scale: number) {
  const ph = s.h * scale
  const top = (b.rect[1] + b.rect[3]) * ph + 8
  const above = b.rect[1] * ph - 40
  return { left: Math.max(0, b.rect[0] * s.w * scale), top: b.quote || top + 32 > ph ? Math.max(0, above) : top }
}

function where(rect?: Rect) {
  if (!rect) return '整页'
  const y = rect[1] + rect[3] / 2
  return y < 0.33 ? '上方' : y < 0.66 ? '中间' : '下方'
}

const px = (d: Drag) => ({ left: Math.min(d.x0, d.x1), top: Math.min(d.y0, d.y1), width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0) })
const pct = (r: Rect) => ({ left: `${r[0] * 100}%`, top: `${r[1] * 100}%`, width: `${r[2] * 100}%`, height: `${r[3] * 100}%` })
const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b)

/** 公式、图的裁图（重排里用；同一块只裁一次） */
const crops = new Map<string, Promise<string>>()
function cropUrl(pdf: string, page: number, rect: Rect): Promise<string> {
  const k = `${pdf}\0${page}\0${rect.join(',')}`
  let p = crops.get(k)
  if (!p) {
    p = R.cropOf(pdf, page, rect).then((c) => c.url)
    p.catch(() => crops.delete(k))
    crops.set(k, p)
  }
  return p
}

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
