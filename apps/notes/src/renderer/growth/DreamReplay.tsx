/**
 * 梦游报告顶上的前后对比小图（设计页 154 版本 A，2026-11-25 用户「那就选这个吧」：force-graph + Motion）：
 * 先长出梦游前（这晚动过的几篇和一步以内的邻居），再一处一处：补的双链沿弯线伸过去（没收下是虚线）、可能重复的两篇合成一个、
 * 挪走的那篇沿弧线走到新文件夹（原处空心圈落定 0.6 秒内淡掉）、新词条从连着的那篇旁边弹出来再连线，最后停在梦游后。
 * 下面一排重播、暂停、进度条（能拖）；每份报告第一次打开时自己播，以后打开直接是梦游后；系统「减少动态效果」开着时直接是梦游后。
 * 点图换到「生长」、中间开整张停在那一晚（同原来的小图）。
 * force-graph 在这里只当画布（位置钉死、不跑模拟、不接鼠标），每个点、每条线在它的回调里画；时间线交给 Motion 的 animate()。
 */
import { Codicon } from '@cn/design'
import ForceGraph from 'force-graph'
import { animate, type AnimationSequence } from 'motion'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DreamReport } from '../../shared/api'
import { t } from '../../shared/i18n'
import { dreamTimeline, phaseAt, type Timeline, type Tween } from './dream-anim'
import { dreamScene, type DNode, type DreamScene } from './dream-scene'
import { type Colors, readColors } from './draw'
import { curveTo, FONT, haloText, onThemeChange, reducedMotion } from './paint'
import { focusNight, loadGrowth, setGrowth, useGrowth } from './store'
import { dayOf } from '../../shared/growth'

const EASE: Record<Exclude<Tween['ease'], 'spring'>, string | number[]> = { out: 'easeOut', in: 'easeIn', inout: [0.65, 0, 0.35, 1], linear: 'linear' }
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const PLAYED_KEY = 'cn.dream.replayed'

/** 这份报告播过没有（每份报告第一次打开自己播一遍；记在本机） */
function playedBefore(started: number): boolean {
  try {
    return (JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '[]') as number[]).includes(started)
  } catch {
    // 本机读不到：当没播过，这次照播
    return false
  }
}
function markPlayed(started: number) {
  try {
    const list = JSON.parse(localStorage.getItem(PLAYED_KEY) ?? '[]') as number[]
    if (!list.includes(started)) localStorage.setItem(PLAYED_KEY, JSON.stringify([...list, started].slice(-30)))
  } catch {
    // 存不下就下次再播一遍
  }
}

interface GNode {
  id: string
  x?: number
  y?: number
  fx?: number
  fy?: number
}

/** 一份戏的播放器：force-graph 画、Motion 播；React 那一层只读它的时间、调它的按钮 */
class Player {
  fg: InstanceType<typeof ForceGraph<GNode>>
  tl: Timeline
  ctrl: ReturnType<typeof animate>
  playing = false
  colors: Colors
  private idle = 0
  private k = 1

  constructor(
    private el: HTMLElement,
    public sc: DreamScene,
    colors: Colors,
  ) {
    this.colors = colors
    this.tl = dreamTimeline(sc)
    const seq = this.tl.tw.map((w) => [w.target, w.values, w.ease === 'spring' ? { at: w.at, type: 'spring', bounce: w.bounce, duration: w.duration } : { at: w.at, duration: w.duration, ease: EASE[w.ease] }])
    this.ctrl = animate(seq as unknown as AnimationSequence)
    this.ctrl.pause()
    const byId = new Map(sc.nodes.map((n) => [n.id, n]))
    const nodes: GNode[] = sc.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, fx: n.x, fy: n.y }))
    this.fg = new ForceGraph<GNode>(el)
      .backgroundColor('rgba(0,0,0,0)')
      .enableZoomInteraction(false)
      .enablePanInteraction(false)
      .enableNodeDrag(false)
      .enablePointerInteraction(false)
      .cooldownTicks(0)
      .autoPauseRedraw(false)
      .nodeLabel(() => '')
      .graphData({ nodes, links: [] })
      .onRenderFramePre((ctx) => {
        for (const n of nodes) {
          const s = this.tl.ns.get(n.id)!
          n.x = s.x
          n.y = s.y
        }
        this.under(ctx)
        sc.edges.forEach((_, i) => this.edge(ctx, i))
      })
      .nodeCanvasObjectMode(() => 'replace')
      .nodeCanvasObject((n, ctx) => this.node(ctx, byId.get(n.id)!))
      .onRenderFramePost((ctx) => this.labels(ctx))
    this.fit()
  }

  get px() {
    return 1 / this.k
  }
  fit() {
    const w = this.el.clientWidth
    const h = this.el.clientHeight
    if (w < 10 || h < 10) return
    this.k = Math.min(w / this.sc.W, h / this.sc.H)
    this.fg.width(w).height(h).centerAt(this.sc.W / 2, this.sc.H / 2).zoom(this.k)
    this.wake()
  }
  get end() {
    return this.tl.end
  }
  get time() {
    return Math.min(this.ctrl.time, this.end)
  }
  isPlaying() {
    return this.playing && this.ctrl.time < this.end - 0.001
  }
  play() {
    if (this.ctrl.time >= this.end - 0.01) this.ctrl.time = 0
    this.ctrl.play()
    this.playing = true
    this.wake()
  }
  pause() {
    this.ctrl.pause()
    this.playing = false
    this.wake()
  }
  seek(t: number) {
    this.ctrl.pause()
    this.playing = false
    this.ctrl.time = Math.max(0, Math.min(this.end, t))
    this.wake()
  }
  replay() {
    this.ctrl.time = 0
    this.ctrl.play()
    this.playing = true
    this.wake()
  }
  /** 动起来时 force-graph 每帧画；停着 0.4 秒后不再画（左栏开着也不白占一个核） */
  wake() {
    this.idle = performance.now() + 400
    this.fg.resumeAnimation()
  }
  tick(now: number) {
    if (!this.isPlaying() && now > this.idle) this.fg.pauseAnimation()
  }
  dispose() {
    this.ctrl.stop()
    this.fg.pauseAnimation()
    this.fg._destructor()
    this.el.replaceChildren()
  }

  // ---------- 画（坐标是小图的 480 宽；字、线宽、点按屏幕像素，报告里 132 高也清楚） ----------
  private R(n: DNode) {
    return Math.min(7, 3 + Math.sqrt(n.deg)) * this.px
  }
  /** 颜色和大图同一张表：前三大的顶层文件夹三种颜色，别的 --t3 淡一点（55%，灰的不比三种颜色抢眼） */
  private fill(n: DNode, mv: number): [string, number] {
    const c = mv > 0.5 && n.toColor !== undefined ? n.toColor : n.color
    return c >= 0 ? [this.colors.cat[c]!, 1] : [this.colors.other, 0.55]
  }
  private under(ctx: CanvasRenderingContext2D) {
    const C = this.colors
    const px = this.px
    // 原处的空心虚圈
    for (const n of this.sc.nodes) {
      const s = this.tl.ns.get(n.id)!
      if (s.ghost <= 0.01) continue
      ctx.globalAlpha = s.ghost * 0.9
      ctx.setLineDash([2 * px, 1.6 * px])
      ctx.strokeStyle = C.t3
      ctx.lineWidth = px
      ctx.beginPath()
      ctx.arc(s.gx, s.gy, this.R(n), 0, Math.PI * 2)
      ctx.stroke()
      ctx.setLineDash([])
    }
    ctx.globalAlpha = 1
  }
  private edge(ctx: CanvasRenderingContext2D, k: number) {
    const e = this.sc.edges[k]!
    const p = this.tl.es[k]!
    if (p.p <= 0.001) return
    const A = this.tl.ns.get(e.a)!
    const B = this.tl.ns.get(e.b)!
    const dim = lerp(this.tl.bg.dim, 1, Math.max(A.f, B.f))
    const px = this.px
    ctx.lineCap = 'round'
    if (e.kind === 'new') {
      ctx.strokeStyle = this.colors.acc
      ctx.globalAlpha = 0.95 * dim
      ctx.lineWidth = 1.6 * px
      ctx.setLineDash(e.taken ? [] : [4 * px, 3 * px])
    } else {
      ctx.strokeStyle = this.colors.edge
      ctx.globalAlpha = 0.3 * dim
      ctx.lineWidth = 0.9 * px
      ctx.setLineDash([])
    }
    ctx.beginPath()
    curveTo(ctx, A.x, A.y, B.x, B.y, p.p, p.sign)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }
  private node(ctx: CanvasRenderingContext2D, n: DNode) {
    const s = this.tl.ns.get(n.id)!
    if (s.s <= 0.01) return
    const [color, a] = this.fill(n, s.mv)
    ctx.globalAlpha = lerp(this.tl.bg.dim, 1, s.f) * a
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(s.x, s.y, this.R(n) * s.s, 0, Math.PI * 2)
    ctx.fill()
    // 新点：强调色外圈
    if (s.ring > 0.01) {
      ctx.globalAlpha = Math.min(1, s.ring)
      ctx.strokeStyle = this.colors.acc
      ctx.lineWidth = 1.5 * this.px
      ctx.beginPath()
      ctx.arc(s.x, s.y, this.R(n) * s.s + 2 * this.px, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.globalAlpha = 1
  }
  /**
   * 名字最后写，压在线上面：写在离线远的一侧，那边放不下（出边、压到左上角那行字、压到写了的）换另一侧，两边都不行就这一帧不写；
   * 长名字截成前 6 个字加「…」。群名挂在那一团中间那篇的上方，让着篇名
   */
  private labels(ctx: CanvasRenderingContext2D) {
    const px = this.px
    // 看得见的那一截（小图比戏宽、比戏高时多出来的也算）
    const halfW = this.fg.width() / 2 / this.k
    const halfH = this.fg.height() / 2 / this.k
    const lo = this.sc.W / 2 - halfW + 3 * px
    const hi = this.sc.W / 2 + halfW - 3 * px
    const top = this.sc.H / 2 - halfH
    // 左上角那行「第2处，共5处」占的地方
    const placed: number[][] = [[lo - 3 * px, top, lo + 92 * px, top + 22 * px]]
    const hit = (b: number[]) => placed.some((q) => b[0]! < q[2]! && b[2]! > q[0]! && b[1]! < q[3]! && b[3]! > q[1]!)
    for (const n of this.sc.nodes) {
      const s = this.tl.ns.get(n.id)!
      if (s.lab <= 0.01 || s.s <= 0.01) continue
      const txt = n.title.length > 7 ? n.title.slice(0, 6) + '…' : n.title
      ctx.font = `500 ${11 * px}px ${FONT}`
      const w = ctx.measureText(txt).width
      const gap = this.R(n) + 4 * px
      const boxOf = (side: number) => {
        const x = side > 0 ? s.x + gap : s.x - gap
        return { x, side, b: [side > 0 ? x : x - w, s.y - 7 * px, side > 0 ? x + w : x, s.y + 7 * px] }
      }
      const ok = (o: { b: number[] }) => o.b[0]! >= lo && o.b[2]! <= hi && !hit(o.b)
      const pick = [boxOf(s.side), boxOf(-s.side)].find(ok)
      if (!pick) continue
      placed.push(pick.b)
      ctx.globalAlpha = s.lab
      haloText(ctx, txt, pick.x, s.y, { size: 11, px, color: this.colors.t1, halo: this.colors.halo, align: pick.side > 0 ? 'left' : 'right' })
    }
    // 群名（不垫方框）：11/600 --t1 85%，写在那一团中间那篇上方 8 像素；压到篇名、左上角那行就这一帧不写
    ctx.font = `600 ${11 * px}px ${FONT}`
    for (const c of this.sc.clusters) {
      if (!c.name) continue
      const w = ctx.measureText(c.name).width
      const y = c.y - 7 * px - 8 * px
      const box = [c.x - w / 2, y - 6 * px, c.x + w / 2, y + 6 * px]
      if (hit(box)) continue
      placed.push(box)
      ctx.globalAlpha = 0.85
      haloText(ctx, c.name, c.x, y, { size: 11, px, color: this.colors.t1, halo: this.colors.halo, weight: 600, align: 'center' })
    }
    ctx.globalAlpha = 1
  }
}

/**
 * 报告第一次打开、小图自己在播的那几秒：左栏先别自己滚到展开的那一条（窗口矮时小图会被滚出去，自己播了也看不见），
 * 播完、暂停、拖进度就放开，DreamPanel 那时再滚；在左栏里点了别处也放开，但不替他滚（他在点，滚了就点歪了）
 */
let holding = false
const releaseSubs = new Set<() => void>()
export const replayHolds = () => holding
export function onReplayRelease(f: () => void): () => void {
  releaseSubs.add(f)
  return () => void releaseSubs.delete(f)
}
function hold(on: boolean, scroll = true) {
  if (holding === on) return
  holding = on
  if (!on && scroll) for (const f of releaseSubs) f()
}

/** 测试和交付量：现在第几秒、在不在播、某一篇在窗口的哪 */
const probe = { player: null as Player | null }
;(window as unknown as { cnDreamReplay: unknown }).cnDreamReplay = {
  time: () => probe.player?.time ?? null,
  end: () => probe.player?.end ?? null,
  playing: () => probe.player?.isPlaying() ?? false,
  ids: () => probe.player?.sc.nodes.map((n) => n.id) ?? [],
  steps: () => probe.player?.sc.steps.map((s) => s.kind) ?? [],
  node(id: string) {
    const p = probe.player
    const s = p?.tl.ns.get(id)
    if (!p || !s) return null
    const q = p.fg.graph2ScreenCoords(s.x, s.y)
    return { x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10, scale: Math.round(s.s * 100) / 100, ghost: Math.round(s.ghost * 100) / 100 }
  },
}

const shortTitle = (p: string) => {
  const s = p.replace(/\.md$/i, '').split('/').pop()!
  return s.length > 18 ? s.slice(0, 9) + '…' + s.slice(-8) : s
}

export function DreamReplay(props: { report: DreamReport; onOpen(): void }) {
  const g = useGrowth()
  const m = g.model
  useEffect(() => loadGrowth(), [])
  const host = useRef<HTMLDivElement>(null)
  const range = useRef<HTMLInputElement>(null)
  const timeEl = useRef<HTMLSpanElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const player = useRef<Player | null>(null)
  const [aspect, setAspect] = useState(0)
  const [state, setState] = useState({ phase: '', playing: false, atEnd: false })
  const scene = useMemo(() => (m && aspect ? dreamScene(props.report, m, aspect) : null), [m, props.report, aspect])
  const empty = !!scene && !scene.nodes.length

  // 小图多宽：宽高比变了一截才重排（拖左栏宽窄时不一直重算）
  useEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const a = el.clientWidth / Math.max(1, el.clientHeight)
      if (el.clientWidth < 20) return
      setAspect((old) => (old && Math.abs(old - a) / old < 0.15 ? old : Math.round(a * 20) / 20))
      player.current?.fit()
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [empty, !!m])

  // 戏换了（收下、丢掉、报告重读）：接着停在原来那一秒；第一次有戏时决定播不播
  useEffect(() => {
    const el = host.current
    if (!scene || !el || !scene.nodes.length) return
    const was = player.current
    const before = was ? { t: was.time, end: was.end, playing: was.isPlaying() } : null
    was?.dispose()
    const p = new Player(el, scene, readColors(box.current!))
    if (before) {
      p.seek(before.t >= before.end - 0.01 ? p.end : Math.min(before.t, p.end))
      if (before.playing) p.play()
    } else if (reducedMotion() || playedBefore(props.report.started)) p.seek(p.end)
    else p.play()
    markPlayed(props.report.started)
    player.current = p
    probe.player = p
    return undefined
  }, [scene]) // eslint-disable-line react-hooks/exhaustive-deps
  // 第一次打开、要自己播：先拦住左栏自己滚；在左栏里一点、播完就放开
  useLayoutEffect(() => {
    if (!reducedMotion() && !playedBefore(props.report.started)) hold(true)
    // 点小图自己的按钮、进度条不算（那是在看它）；点左栏别处才放开
    const go = (e: PointerEvent) => !box.current?.contains(e.target as Node) && hold(false, false)
    document.addEventListener('pointerdown', go, true)
    return () => (document.removeEventListener('pointerdown', go, true), hold(false, false))
  }, [props.report.started])
  useEffect(() => {
    if (empty) hold(false)
  }, [empty])
  useEffect(
    () => () => {
      player.current?.dispose()
      if (probe.player === player.current) probe.player = null
      player.current = null
    },
    [],
  )
  useEffect(
    () =>
      onThemeChange(() => {
        const p = player.current
        if (!p || !box.current) return
        p.colors = readColors(box.current)
        p.wake()
      }),
    [],
  )

  // 进度条、时间、按钮跟着走（直接改 DOM，不每帧重渲染）；说明换一段才重渲染
  useEffect(() => {
    let raf = 0
    let dragging = false
    const r = range.current
    const down = () => {
      dragging = true
      player.current?.pause()
    }
    const up = () => (dragging = false)
    r?.addEventListener('pointerdown', down)
    window.addEventListener('pointerup', up)
    const loop = (now: number) => {
      const p = player.current
      if (p && scene) {
        const t = p.time
        if (r && !dragging) r.value = String(Math.round((t / p.end) * 1000))
        if (timeEl.current) timeEl.current.textContent = `${t.toFixed(1)} / ${p.end.toFixed(1)}s`
        const ph = phaseAt(scene, p.tl, t)
        const phase = ph.kind === 'step' ? `step${ph.i}` : ph.kind
        const playing = p.isPlaying()
        const atEnd = t >= p.end - 0.01
        box.current?.setAttribute('data-time', t.toFixed(2))
        setState((o) => (o.phase === phase && o.playing === playing && o.atEnd === atEnd ? o : { phase, playing, atEnd }))
        p.tick(now)
        if (holding && !playing) hold(false)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      r?.removeEventListener('pointerdown', down)
      window.removeEventListener('pointerup', up)
    }
  }, [scene])

  if (!m) return null
  const day = dayOf(props.report.started)
  const open = () => {
    focusNight(day)
    setGrowth({ side: 'growth' })
    props.onOpen()
  }
  // 这晚没有能画在图上的（只有可视化、周记、附件……）：只留一行去整张生长图
  if (empty)
    return (
      <div ref={box} className="dr" data-testid="dream-replay" data-steps={0}>
        <div className="dr-cap" data-testid="dream-replay-cap">
          <span>{t('这晚没有能画在图上的改动')}</span>
          <button className="go" data-testid="growth-thumb" onClick={open}>
            {t('看整张')}
            <Codicon name="chevron-right" size={12} />
          </button>
        </div>
      </div>
    )
  const steps = scene?.steps ?? []
  const titleOf = (id: string) => scene?.nodes.find((n) => n.id === id)?.title ?? shortTitle(id)
  const say = (i: number): string => {
    const s = steps[i]!
    if (s.kind === 'link') return t('补双链：{a} ↔ {b}', { a: titleOf(s.a), b: titleOf(s.b) })
    if (s.kind === 'merge') return t('可能重复：{a} 和 {b}', { a: titleOf(s.node), b: titleOf(s.into) })
    if (s.kind === 'move') return t('挪到{dir}：{name}', { dir: s.to.split('/').pop() || t('库的最外层'), name: titleOf(s.node) })
    return t('新词条：「{name}」，连上{n}篇', { name: s.name, n: s.links.length })
  }
  const links = steps.filter((s) => s.kind === 'link').length + steps.filter((s) => s.kind === 'new').reduce((a, s) => a + (s.kind === 'new' ? s.links.length : 0), 0)
  const summary = [
    links ? t('连了{n}条线', { n: links }) : '',
    steps.some((s) => s.kind === 'move') ? t('挪了{n}篇', { n: steps.filter((s) => s.kind === 'move').length }) : '',
    steps.some((s) => s.kind === 'merge') ? t('{n}对可能重复', { n: steps.filter((s) => s.kind === 'merge').length }) : '',
    steps.some((s) => s.kind === 'new') ? t('新词条{n}个', { n: steps.filter((s) => s.kind === 'new').length }) : '',
  ].filter(Boolean)
  const pending = scene?.edges.some((e) => e.kind === 'new' && !e.taken)
  const ph = state.phase
  const corner = ph === 'before' || ph === '' ? t('梦游前') : ph === 'after' ? t('梦游后') : ph === 'rest' ? t('其余几处') : t('第{i}处，共{n}处', { i: Number(ph.slice(4)) + 1, n: steps.length })
  const caption = ph.startsWith('step')
    ? say(Number(ph.slice(4)))
    : ph === 'rest'
      ? t('还有{n}处一起画上', { n: steps.length - 4 })
      : ph === 'after'
        ? summary.map((x, i) => (
            <Fragment key={i}>
              {i ? ' · ' : ''}
              <span className="nw">{x}</span>
            </Fragment>
          ))
        : t('这晚动过的几篇和它们连着的')
  return (
    <div ref={box} className="dr" data-testid="dream-replay" data-phase={ph} data-steps={steps.length}>
      <div className="gr-thumb">
        <div className="dr-stage" role="button" tabIndex={0} aria-label={t('这晚的生长图')} onClick={open} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open())}>
          <div ref={host} className="dr-cv" data-testid="dream-replay-canvas" />
          <span className="dr-corner" data-testid="dream-replay-corner">
            {corner}
          </span>
          {ph === 'after' && pending && (
            <span className="dr-key" data-testid="dream-replay-key">
              <i />
              {t('虚线是还没收下的')}
            </span>
          )}
        </div>
        <div className="dr-ctl">
          <button className="iconbtn" aria-label={t('重播')} data-tip={t('从头再放一遍')} data-testid="dream-replay-again" onClick={() => player.current?.replay()}>
            <Codicon name="debug-restart" size={14} />
          </button>
          <button
            className="iconbtn"
            aria-label={state.playing ? t('暂停') : t('播放')}
            data-tip={state.playing ? t('暂停') : state.atEnd ? t('从头播') : t('接着播')}
            data-testid="dream-replay-toggle"
            onClick={() => (player.current?.isPlaying() ? player.current.pause() : player.current?.play())}
          >
            <Codicon name={state.playing ? 'debug-pause' : 'play'} size={14} />
          </button>
          <input ref={range} type="range" min={0} max={1000} step={1} defaultValue={0} aria-label={t('进度')} data-testid="dream-replay-range" onInput={(e) => player.current?.seek((Number(e.currentTarget.value) / 1000) * player.current.end)} />
          <span ref={timeEl} className="dr-time num" />
        </div>
      </div>
      <div className="dr-cap" data-testid="dream-replay-cap">
        <span>{caption}</span>
        <button className="go" data-testid="growth-thumb" onClick={open}>
          {t('看整张')}
          <Codicon name="chevron-right" size={12} />
        </button>
      </div>
    </div>
  )
}
