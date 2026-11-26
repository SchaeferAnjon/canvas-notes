/**
 * 中间「生长」标签的图（设计页 154 版本 A，2026-11-25 用户选：force-graph + Motion）：
 * force-graph 管画布、拖点、拖画布、滚轮 / 双指缩放、点选和镜头（里面是 d3-force）；Motion 管新点弹出来、新线伸过去。
 * 位置还是主进程后台算好的那一份（数据来源不变）：每篇有个落脚点（forceX / forceY 往那拉），线的长度照落脚点之间的距离，
 * 所以停下来的样子和以前一样；新加进来的一篇从连着的那篇旁边冒出来，一边长一边被拉回自己的位置（「一边长一边排」）；拖开的松手弹回去。
 * 画在 force-graph 的 onRenderFramePost 里（draw.ts，一种样子拼一条路径一次画），每个点各自的画图回调空着（几千篇不卡）。
 */
import ForceGraph from 'force-graph'
import { forceX, forceY } from 'd3-force'
import { animate } from 'motion'
import type { Model, Scene, ViewOpts } from './model'
import { type Colors, drawGrowth, type Live } from './draw'
import { radius } from './model'
import { reducedMotion } from './paint'

export interface GNode {
  id: number
  x?: number
  y?: number
  vx?: number
  vy?: number
  fx?: number
  fy?: number
  /** 落脚点（主进程算好的位置） */
  tx: number
  ty: number
}
interface GLink {
  e: number
  source: number | GNode
  target: number | GNode
  /** 落脚点之间多远（线的长度照这个，停下来不改样子） */
  d: number
}

export interface GraphHooks {
  click(i: number, ev: MouseEvent): void
  background(): void
  hover(i: number | null): void
  /** 每画一帧（量帧率、摆悬停的那块、写 data-labels） */
  frame(ms: number, labels: string[], dimmed: number): void
}

/** 一次冒出来超过这么多篇（跳到别的日子、换文件夹）就不一颗颗弹，直接摆好 */
const ANIM_MAX = 60
const FRESH_MS = 800

export class GrowthGraph {
  readonly fg: InstanceType<typeof ForceGraph<GNode, GLink>>
  private m: Model | null = null
  private sc: Scene | null = null
  private view: ViewOpts | null = null
  private nodes = new Map<number, GNode>()
  private links = new Map<number, GLink>()
  private shown = new Set<number>()
  private shownLinks = new Set<number>()
  private grow = new Map<number, { s: number; at: number }>()
  private stretch = new Map<number, { p: number }>()
  colors: Colors | null = null
  hollow = true
  private keepDrawing = 0

  constructor(
    private el: HTMLElement,
    private hooks: GraphHooks,
  ) {
    this.fg = new ForceGraph<GNode, GLink>(el)
      .backgroundColor('rgba(0,0,0,0)')
      .nodeId('id')
      .nodeLabel(() => '')
      .linkLabel(() => '')
      .minZoom(0.02)
      .maxZoom(40)
      .d3AlphaDecay(0.035)
      .d3VelocityDecay(0.4)
      .cooldownTime(1600)
      .enableNodeDrag(true)
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject(() => {})
      .linkCanvasObjectMode(() => 'replace')
      .linkCanvasObject(() => {})
      .linkPointerAreaPaint(() => {})
      .nodePointerAreaPaint((n, color, ctx, k) => {
        // 点得到的范围：屏幕上至少 10 像素
        const r = Math.max(10, radius(this.sc?.deg[n.id] ?? 0, k)) / k
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2)
        ctx.fill()
      })
      // 点中哪篇按点下去的位置自己找：force-graph 认点用的那张隐藏画布 0.8 秒才更新一次，镜头刚动过时会认错
      .onNodeClick((_n, ev) => this.clickAt(ev))
      .onBackgroundClick((ev) => this.clickAt(ev))
      .onNodeHover((n) => this.hooks.hover(n ? n.id : null))
      .onNodeDrag(() => this.hooks.hover(null))
      // 松手：模拟重新热一下、多跑一会儿，拖开的那篇弹回自己的位置
      .onNodeDragEnd(() => this.fg.cooldownTime(2500).d3ReheatSimulation())
      .onRenderFramePost((ctx) => this.paint(ctx))
    // 只留往落脚点拉的力和线：停下来就是算好的位置
    this.fg.d3Force('charge', null)
    this.fg.d3Force('center', null)
    this.fg.d3Force('x', forceX<GNode>((n) => n.tx).strength(0.18) as never)
    this.fg.d3Force('y', forceY<GNode>((n) => n.ty).strength(0.18) as never)
    const link = this.fg.d3Force('link') as unknown as { distance(f: (l: GLink) => number): unknown; strength(s: number): unknown }
    link.distance((l) => l.d)
    link.strength(0.05)
    // 手一拖、一滚：还在飞的镜头停下，听手的
    const stop = () => (this.flight?.stop(), (this.flight = null))
    el.addEventListener('pointerdown', stop, true)
    el.addEventListener('wheel', stop, { capture: true, passive: true })
  }

  /** 正在动（Motion 在播）时每帧都画；停了让 force-graph 只在拖、缩放、模拟在跑时画 */
  private redraw(ms = 300) {
    this.keepDrawing = Math.max(this.keepDrawing, performance.now() + ms)
    this.fg.autoPauseRedraw(false)
  }

  size(w: number, h: number) {
    this.fg.width(w).height(h)
  }
  active(on: boolean) {
    if (on) this.fg.resumeAnimation()
    else this.fg.pauseAnimation()
  }
  dispose() {
    this.fg.pauseAnimation()
    this.fg._destructor()
    this.el.replaceChildren()
  }

  /** 库重算了：点全换新的 */
  setModel(m: Model) {
    if (m === this.m) return
    this.m = m
    this.nodes.clear()
    this.links.clear()
    this.shown.clear()
    this.shownLinks.clear()
    this.grow.clear()
    this.stretch.clear()
  }

  /** 这一刻该看见哪些（时间轴、文件夹、只看周围变了）：新冒出来的从邻居旁边弹出来，没了的拿掉 */
  update(sc: Scene, view: ViewOpts, o: { playing: boolean }) {
    const m = this.m
    if (!m) return
    this.sc = sc
    this.view = view
    const d = m.d
    const want: number[] = []
    for (let i = 0; i < sc.vis.length; i++) if (sc.vis[i]) want.push(i)
    const fresh = want.filter((i) => !this.shown.has(i))
    const gone = [...this.shown].filter((i) => !sc.vis[i])
    const local = view.local && view.sel >= 0
    const wantLinks = sc.edges.filter((e) => !local || (sc.vis[d.links[e]!.a] === 2 && sc.vis[d.links[e]!.b] === 2))
    const wantSet = new Set(wantLinks)
    const freshLinks = wantLinks.filter((e) => !this.shownLinks.has(e))
    const goneLinks = [...this.shownLinks].filter((e) => !wantSet.has(e))
    if (!fresh.length && !gone.length && !freshLinks.length && !goneLinks.length) return this.redraw(80)
    const anim = !reducedMotion() && (o.playing || fresh.length <= ANIM_MAX) && this.shown.size > 0
    const before = new Set(this.shown)
    for (const i of gone) {
      this.shown.delete(i)
      this.grow.delete(i)
    }
    for (const e of goneLinks) {
      this.shownLinks.delete(e)
      this.stretch.delete(e)
    }
    const now = performance.now()
    for (const i of fresh) {
      const nd = d.notes[i]!
      let n = this.nodes.get(i)
      if (!n) this.nodes.set(i, (n = { id: i, tx: nd.x, ty: nd.y }))
      // 从连着的、已经在图上的那篇旁边冒出来（像长出一根新枝）；没有就在自己的位置
      let from: GNode | null = null
      if (anim)
        for (const e of m.adj[i]!) {
          const l = d.links[e]!
          const j = l.a === i ? l.b : l.a
          if (before.has(j)) {
            from = this.nodes.get(j)!
            break
          }
        }
      n.x = from ? from.x! + (Math.random() - 0.5) * 4 : nd.x
      n.y = from ? from.y! + (Math.random() - 0.5) * 4 : nd.y
      n.vx = n.vy = 0
      this.shown.add(i)
      if (anim) {
        const g = { s: 0, at: now }
        this.grow.set(i, g)
        animate(g, { s: 1 }, { type: 'spring', bounce: 0.5, duration: 0.6 })
      } else this.grow.delete(i)
    }
    for (const e of freshLinks) {
      const l = d.links[e]!
      if (!this.links.has(e)) this.links.set(e, { e, source: l.a, target: l.b, d: Math.hypot(d.notes[l.a]!.x - d.notes[l.b]!.x, d.notes[l.a]!.y - d.notes[l.b]!.y) })
      this.shownLinks.add(e)
      if (anim) {
        const st = { p: 0 }
        this.stretch.set(e, st)
        animate(st, { p: 1 }, { duration: 0.45, ease: 'easeOut', delay: 0.12 })
      } else this.stretch.delete(e)
    }
    // 没在动、一下子换了一大批（跳日子、换文件夹）：都摆在落脚点上，模拟不用跑多久
    if (!anim) for (const i of this.shown) {
      const n = this.nodes.get(i)!
      if (n.fx === undefined) {
        n.x = n.tx
        n.y = n.ty
        n.vx = n.vy = 0
      }
    }
    // 链接里的 source / target：force-graph 第一次给的是编号，之后换成点本身；拿掉的点它连着的线也拿掉了
    const links = [...this.shownLinks].map((e) => this.links.get(e)!)
    for (const l of links) {
      if (typeof l.source === 'object') l.source = this.nodes.get(l.source.id)!
      if (typeof l.target === 'object') l.target = this.nodes.get(l.target.id)!
    }
    this.fg.cooldownTime(anim ? 1600 : 600)
    this.fg.graphData({ nodes: [...this.shown].map((i) => this.nodes.get(i)!), links })
    this.redraw(anim ? 1300 : 120)
  }

  /** 只换了怎么看（选中、停在一晚、空心、主题）：重画一次 */
  restyle(sc: Scene, view: ViewOpts) {
    this.sc = sc
    this.view = view
    this.redraw(120)
  }

  private paint(ctx: CanvasRenderingContext2D) {
    const m = this.m
    const sc = this.sc
    const view = this.view
    if (!m || !sc || !view || !this.colors) return
    if (this.grow.size || this.stretch.size) this.keepDrawing = Math.max(this.keepDrawing, performance.now() + 100)
    else if (performance.now() > this.keepDrawing) this.fg.autoPauseRedraw(true)
    const t = ctx.getTransform()
    const dpr = devicePixelRatio || 1
    const now = performance.now()
    const live: Live = {
      pos: (i) => {
        const n = this.shown.has(i) ? this.nodes.get(i) : undefined
        return n && n.x !== undefined ? (n as { x: number; y: number }) : null
      },
      scale: (i) => this.grow.get(i)?.s ?? 1,
      linkP: (e) => this.stretch.get(e)?.p ?? 1,
      fresh: (i) => {
        const g = this.grow.get(i)
        return g ? Math.max(0, 1 - (now - g.at) / FRESH_MS) : 0
      },
    }
    const s0 = performance.now()
    ctx.save()
    const r = drawGrowth(ctx, m, sc, view, { w: this.fg.width(), h: this.fg.height(), dpr, xf: { k: t.a / dpr, x: t.e / dpr, y: t.f / dpr }, colors: this.colors, hollow: this.hollow }, live)
    ctx.restore()
    // 弹完、伸完的不再记（之后照常一起画）
    for (const [i, g] of this.grow) if (now - g.at > FRESH_MS && Math.abs(g.s - 1) < 0.002) this.grow.delete(i)
    for (const [e, st] of this.stretch) if (st.p >= 0.999) this.stretch.delete(e)
    this.hooks.frame(performance.now() - s0, r.labels, r.dimmed)
  }

  // ---------- 镜头 ----------
  /** 屏幕上（画布左上为 0）某一篇在哪 */
  screenOf(i: number): { x: number; y: number } | null {
    const n = this.shown.has(i) ? this.nodes.get(i) : undefined
    if (!n || n.x === undefined) return null
    return this.fg.graph2ScreenCoords(n.x, n.y!)
  }
  /** 窗口里 (x, y) 点中的那篇（屏幕上 10 像素以内或点自己那么大，取最近的），没有 -1 */
  pick(clientX: number, clientY: number): number {
    const r = this.el.getBoundingClientRect()
    const k = this.fg.zoom()
    const g = this.fg.screen2GraphCoords(clientX - r.left, clientY - r.top)
    let best = -1
    let bd = Infinity
    for (const i of this.shown) {
      const n = this.nodes.get(i)!
      if (n.x === undefined) continue
      const d = Math.hypot(n.x - g.x, n.y! - g.y) * k
      const reach = Math.max(10, radius(this.sc?.deg[i] ?? 0, k))
      if (d <= reach && d < bd) [bd, best] = [d, i]
    }
    return best
  }
  private clickAt(ev: MouseEvent) {
    const i = this.pick(ev.clientX, ev.clientY)
    if (i >= 0) this.hooks.click(i, ev)
    else this.hooks.background()
  }
  /** 图上看得见的每一篇在屏幕上的哪（测试找空白处用） */
  screenAll(): { x: number; y: number }[] {
    return [...this.shown].map((i) => this.screenOf(i)).filter((p): p is { x: number; y: number } => !!p)
  }
  /** 一篇现在在图上的哪（拖开了就是拖到的地方） */
  posOf(i: number): { x: number; y: number } | null {
    const n = this.shown.has(i) ? this.nodes.get(i) : undefined
    return n && n.x !== undefined ? { x: n.x, y: n.y! } : null
  }
  camera(): { k: number; x: number; y: number } {
    const c = this.fg.centerAt()
    return { k: this.fg.zoom(), x: c.x, y: c.y }
  }
  /**
   * 镜头挪到哪、放大几倍；ms 是飞过去用多久（Motion 播，缓出）。新的一次镜头会先停掉还在飞的那次（不然点完一篇马上「只看周围」，
   * 前一次没飞完的会把镜头拽回去）
   */
  private flight: ReturnType<typeof animate> | null = null
  setCamera(c: { k: number; x: number; y: number }, ms = 0) {
    this.flight?.stop()
    this.flight = null
    const put = (v: { k: number; x: number; y: number }) => {
      this.fg.zoom(v.k)
      this.fg.centerAt(v.x, v.y)
    }
    if (ms <= 0 || reducedMotion()) return put(c), this.redraw(80)
    const cam = this.camera()
    this.flight = animate(cam, c, { duration: ms / 1000, ease: [0.22, 1, 0.36, 1], onUpdate: () => put(cam) })
    this.redraw(ms + 80)
  }
  zoomBy(f: number, ms = 200) {
    const c = this.camera()
    this.setCamera({ ...c, k: Math.max(0.02, Math.min(40, c.k * f)) }, ms)
  }
  /**
   * 看这几篇（落脚点算）：给浮在画布上的几块让位（pad 是屏幕上上下左右各让多少），最多放大 maxK 倍；
   * 离得远的个别几篇（几百篇以上时两头各 1%）不把整张缩成一小团
   */
  fit(ids: number[], pad: { top: number; bottom: number; left: number; right: number }, maxK: number, ms = 0) {
    const m = this.m
    if (!m || !ids.length) return
    const w = this.fg.width()
    const h = this.fg.height()
    const xs = ids.map((i) => m.d.notes[i]!.x).sort((a, b) => a - b)
    const ys = ids.map((i) => m.d.notes[i]!.y).sort((a, b) => a - b)
    const q = (a: number[], p: number) => a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))]!
    const cut = ids.length > 200 ? 0.01 : 0
    const x0 = q(xs, cut)
    const x1 = q(xs, 1 - cut)
    const y0 = q(ys, cut)
    const y1 = q(ys, 1 - cut)
    const aw = Math.max(80, w - pad.left - pad.right)
    const ah = Math.max(80, h - pad.top - pad.bottom)
    const k = Math.min(aw / Math.max(40, x1 - x0), ah / Math.max(40, y1 - y0), maxK)
    // 让出来的那块中间对着这几篇的中间：画布中间对着的那一点往反方向挪
    const cx = (x0 + x1) / 2 - (pad.left + aw / 2 - w / 2) / k
    const cy = (y0 + y1) / 2 - (pad.top + ah / 2 - h / 2) / k
    this.setCamera({ k, x: cx, y: cy }, ms)
  }
}
