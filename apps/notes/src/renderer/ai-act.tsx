/**
 * AI 动手看得见（DESIGN.v3 2.3；流光方向 A2，原型 design/glow/proto-a2.html）。画在被操作的那一块（白板、文档、右栏网页）上面：
 * - 整块改（整理白板、改开着的文档、操作网页）：四边一道柔光绕圈（ai-glow.tsx），顶上居中一条 32 高的胶囊，边上同一道光：
 *   「AI 正在整理这块白板 · 停下 esc」；做完光收成一圈再淡掉，胶囊换成「✓ 整理好了 · 挪了N张卡 · 撤回」1.8 秒后收起；
 *   按了停下光停住变灰，「停下了：这一步做完就停」→「停下了 · 做完的N步留着」，再淡掉。
 * - 只加一张卡：整块不亮，只那张卡边上一道光绕圈，卡下面「AI 在写这张卡 · 停下 esc」；做完停成一圈再淡掉。
 *   文档：AI 这一轮改到开着的这篇（文档工具、全能模式下命令行写盘、Edit，2026-11-24）整篇四边亮、顶上「AI 正在改这篇 · 停下 esc」，
 *   做完「✓ 改好了 · +20 −0 · 撤回」；改到的那一段竖线、字一点点长出来由编辑器自己画（ai-spot.ts）
 * - 「AI」小指针（20 的箭头 + 右下一个「AI」小胶囊）每去拿一样东西先移过去（0.55 秒），到了那样东西边上跑一圈光，挪的时候跟着走。
 * 主进程在 ai:act 里说（ai-act-store.ts 记着）。网页里的指针和「✂ 剪成卡片」画在网页自己里面（main/agent/web.ts）。
 */
import { UndoButton } from '@cn/ai-chat/answer-bar'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Codicon } from '@cn/design'
import type { AiActArea } from '../shared/agent'
import { type ActLines, actDoneText, actHaltText, docLinesHead } from '../shared/ai-act'
import { type ActEntry, actEntries, actVersion, lastGrab, onActs, onWrote, showDoc, still, stopActing, undoActing } from './ai-act-store'
import { watchBoard } from './ai-card-grow'
import { type EdgePhase, GlowEdge, GlowRing, type RingMode } from './ai-glow'
import { AiIcon } from './engine-logo'
import { useT } from './i18n'
import './ai-act.css'

export { stopActing }

export function useActs(): number {
  return useSyncExternalStore(onActs, actVersion)
}

// 不翻：键，画的地方翻（ActBar 里 t(TEXT[area])）
const TEXT: Record<AiActArea, string> = { board: 'AI 正在整理这块白板', doc: 'AI 正在改这篇', web: 'AI 正在操作这个网页' }

type Box = { x: number; y: number; w: number; h: number; r: string }

/** 整块那一圈光走到哪一步 */
function edgePhase(e: ActEntry): EdgePhase {
  if (!e.end) return e.stopping ? 'halt' : 'run'
  if (e.end.stopped) return 'gone'
  return e.end.step === 0 ? 'end' : e.end.step === 1 ? 'seal' : 'gone'
}

/** 顶上那条：进行中、停下了、整理好了…撤回 */
function ActBar(props: { e: ActEntry; area: AiActArea }) {
  const t = useT()
  const { e, area } = props
  const end = e.end
  const fin = !!end && !end.stopped && end.step >= 2
  const halt = e.stopping || !!end?.stopped
  // 文档栏有这次提交的加减行数时说行数（「改好了 · +20 −0」，和改动卡同一个数、同样上色），没有（提交没成）照段数说
  const lines = (fin && !end!.undone) || end?.stopped ? end!.lines : undefined
  const text = lines
    ? null
    : fin
      ? end!.undone
        ? t('撤回了')
        : actDoneText(area, end!.tally)
      : end?.stopped
        ? actHaltText(end.tally)
        : e.stopping
          ? t('停下了：这一步做完就停')
          : t(TEXT[area])
  const running = !end && !e.stopping
  return (
    <div className={'ai-actbar' + (fin ? ' fin' : '') + (halt ? ' halt' : '') + (end?.step === 3 ? ' hide' : '')} role="status" data-testid="ai-actbar">
      {running && !still() && <GlowRing mode="loop" testid="ai-bar-glow" />}
      {fin ? <Codicon name="check" size={12} className="ok" /> : <i className={'pulse' + (running ? ' on' : '')} />}
      {lines ? <LinesSaid l={lines} stopped={!!end?.stopped} /> : <span>{text}</span>}
      {/* 撤回：各处同一颗（无边框、discard 图标，task-eavzx） */}
      {fin && end!.commit && !end!.undone && <UndoButton label={t('撤回')} onClick={() => undoActing(e)} />}
      {!end && !e.stopping && (
        <button type="button" className="ai-stop" onClick={stopActing}>
          {t('停下')}
          <kbd>esc</kbd>
        </button>
      )}
    </div>
  )
}

/** 「改好了 · +20 −0」：数字照改动卡（加的绿、删的红，是 0 的那一半淡下去），等宽数字 */
function LinesSaid(props: { l: ActLines; stopped: boolean }) {
  const { l } = props
  return (
    <span>
      {docLinesHead(props.stopped)} ·{' '}
      <span className={'n add' + (l.added ? '' : ' zero')}>+{l.added}</span> <span className={'n del' + (l.removed ? '' : ' zero')}>−{l.removed}</span>
    </span>
  )
}

/**
 * 画在这一块（host，position: relative，不随内容滚动）上面。
 * bar：顶上那条要不要（右栏网页太窄、网页里自己画指针时只要四边的光）
 */
export function AiActLayer(props: { area: AiActArea; path?: string | null; host: React.RefObject<HTMLElement | null>; bar?: boolean }) {
  useActs()
  const { area, host } = props
  const path = props.path ?? null
  const mine = actEntries().filter((a) => a.area === area && (area === 'web' || a.path === path))
  const whole = mine.find((a) => a.whole) ?? null
  const live = mine.find((a) => !a.end) ?? null
  const spots = area === 'board' ? mine.filter((a) => !a.whole && a.spot) : []
  // 这篇开着：AI 这一轮改到它时整篇亮（ai-act-store 只认开着的文档栏，没开着的那篇不画、esc 不接走）
  useEffect(() => (area === 'doc' && path ? showDoc(path) : undefined), [area, path])
  /** 指针在哪；dur：这一下移过去用多久（一长串时短一点，和主进程的节奏一样） */
  const [cur, setCur] = useState<{ x: number; y: number; shown: boolean; follow: boolean; dur?: number }>({ x: 0, y: 0, shown: false, follow: false })
  const [ring, setRing] = useState<{ seq: number; once: number; at: number; boxes: Box[] } | null>(null)
  /** 这一层自己：卡片、指针的位置都按它算（文档切成的白板上它盖白板这一格），盖不住的切掉 */
  const self = useRef<HTMLDivElement>(null)
  const frame = () => self.current ?? host.current
  // 白板开着 AI 时卡片挪动带动画（.ai-on 下的 .bcard / .bcol 有 left/top 的过渡）；文档切成的白板顶上那条说明让位，
  // 收尾时「整理好了…撤回」还在，说明等它收起再回来（不叠在一起）
  const on = mine.length > 0
  useLayoutEffect(() => {
    const h = host.current
    if (!h) return
    h.classList.toggle('ai-on', on)
    return () => h.classList.remove('ai-on')
  }, [on])
  // 指针最开始放在这一块正中，看不见；第一次去拿东西时淡入；做完收起
  useEffect(() => {
    if (!live) setCur((c) => ({ ...c, shown: false }))
    else {
      const h = frame()
      if (h) setCur({ x: h.clientWidth * 0.4, y: h.clientHeight * 0.4, shown: false, follow: false })
    }
    setRing(null)
  }, [live?.turn])

  const rectOf = (el: HTMLElement): Box => {
    const hr = frame()!.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height, r: getComputedStyle(el).borderRadius || '10px' }
  }
  const find = (id: string) => host.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`) ?? null

  const g = lastGrab()
  const grabKey = live && g && g.turn === live.turn && g.area === area && g.path === path ? g.seq : 0
  const timer = useRef<{ raf: number; timers: ReturnType<typeof setTimeout>[] }>({ raf: 0, timers: [] })
  useEffect(() => {
    if (!grabKey || !g) return
    const st = timer.current
    let tries = 0
    // 刚加的卡：文件改了、白板重画出来要一两帧，等它出来（最多约半秒）
    const begin = () => {
      if (!g.ids.some((id) => find(id))) {
        if (++tries < 30) st.raf = requestAnimationFrame(begin)
        return
      }
      go(g.ids.find((id) => find(id))!)
    }
    const go = (first: string) => {
      const point = () => {
        const el = find(first)
        if (!el) return null
        const r = rectOf(el)
        return { x: r.x + Math.min(40, r.w / 2), y: r.y + Math.min(18, r.h / 2) }
      }
      // 移过去 0.55 秒（一长串时主进程给的时间更短，跟着它）
      const dur = Math.max(150, Math.min(550, g.ms - 50))
      const p = point()
      if (p) setCur({ ...p, shown: true, follow: false, dur })
      // 到了：那几样边上跑一圈光（0.9 秒，一长串时短一点），停成一圈 0.25 秒，1.2 秒淡掉；挪的时候光和指针跟着它走
      st.timers.push(
        setTimeout(() => {
          const t0 = performance.now()
          const once = Math.max(450, Math.min(900, g.ms + 300))
          const loop = () => {
            const boxes = g.ids
              .map(find)
              .filter((x): x is HTMLElement => !!x)
              .map(rectOf)
            setRing({ seq: g.seq, once, at: performance.now() - t0, boxes })
            const q = point()
            if (q) setCur({ ...q, shown: true, follow: true })
            if (performance.now() - t0 < once + 1450) st.raf = requestAnimationFrame(loop)
            else setRing(null)
          }
          st.raf = requestAnimationFrame(loop)
        }, dur),
      )
    }
    begin()
    return () => {
      cancelAnimationFrame(st.raf)
      for (const t of st.timers) clearTimeout(t)
      st.timers = []
    }
  }, [grabKey])

  // AI 写了这块白板（加卡、改卡、自己写文件）：新的卡、改过字的卡里的字一点点长出来，卡的大小不动（task-6kun1）
  useEffect(() => {
    if (area !== 'board' || !path) return
    return onWrote((p) => {
      if (p === path && host.current) watchBoard(host.current)
    })
  }, [area, path])

  if (!mine.length) return null
  const ringMode = (r: { once: number; at: number }): RingMode => (r.at < r.once ? 'once' : r.at < r.once + 250 ? 'settle' : 'fade')
  return (
    <div ref={self} className={`ai-act ai-act-${area}`} data-testid="ai-act" data-area={area}>
      {whole && <GlowEdge phase={edgePhase(whole)} halted={!!whole.end?.stopped || whole.stopping} />}
      {whole && props.bar !== false && <ActBar e={whole} area={area} />}
      {ring &&
        ring.boxes.map((r, i) => (
          <div key={`${ring.seq}-${i}`} className="ai-grab" data-testid="ai-grab-ring" style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: r.r }}>
            <GlowRing mode={ringMode(ring)} once={ring.once} />
          </div>
        ))}
      {spots.map((s) => (
        <SpotCard key={`${s.turn}-${s.spot!.seq}`} e={s} find={find} rectOf={rectOf} room={() => ({ w: frame()?.clientWidth ?? 0, h: frame()?.clientHeight ?? 0 })} />
      ))}
      {live && (
        <div
          className={'ai-cursor' + (cur.shown ? ' on' : '') + (cur.follow ? ' follow' : '')}
          data-testid="ai-cursor"
          style={{ left: cur.x, top: cur.y, ...(cur.dur && !cur.follow ? { transitionDuration: `${cur.dur}ms, ${cur.dur}ms, 200ms` } : {}) }}
          aria-hidden
        >
          <svg viewBox="0 0 20 20">
            <path d="M3.5 2.2 16.6 9.4 10.4 10.9 7.4 16.8Z" />
          </svg>
          {/* 指针旁的小胶囊：动手的那一家的标志 + AI（偏好「AI 图标用引擎标志」） */}
          <span>
            <i className="lg">
              <AiIcon job="chat" size={10} />
            </i>
            AI
          </span>
        </div>
      )}
    </div>
  )
}

/** 只加一张卡：那张卡边上一道光一直绕，卡下面「AI 在写这张卡 · 停下 esc」；做完停成一圈 1.2 秒淡掉，停下的说一句再淡掉 */
function SpotCard(props: { e: ActEntry; find(id: string): HTMLElement | null; rectOf(el: HTMLElement): Box; room(): { w: number; h: number } }) {
  const t = useT()
  const { e } = props
  const [box, setBox] = useState<Box | null>(null)
  const inl = useRef<HTMLDivElement>(null)
  // 那一颗放不下（卡在这一块的右边上）：往左挪到放得下
  useLayoutEffect(() => {
    const el = inl.current
    if (!el || !box) return
    const w = props.room().w
    el.style.left = `${Math.max(8, Math.min(box.x, w - el.offsetWidth - 8))}px`
  })
  // 卡还会动（白板拖动、缩放、AI 接着挪）：每帧跟着它，位置没变不重画
  useEffect(() => {
    let raf = 0
    let last = ''
    const tick = () => {
      const el = e.spot!.ids.map(props.find).find(Boolean)
      const b = el ? props.rectOf(el) : null
      const k = b ? `${b.x},${b.y},${b.w},${b.h}` : ''
      if (k !== last) {
        last = k
        setBox(b)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [e.spot!.seq])
  if (!box) return null
  const end = e.end
  const mode: RingMode | null = !end ? 'loop' : end.stopped ? null : end.step >= 2 ? 'fade' : 'settle'
  const said = !end ? t('AI 在写这张卡') : end.stopped ? t('停下了：这张卡留着') : null
  return (
    <>
      {mode && (
        <div className="ai-grab" data-testid="ai-spot-ring" style={{ left: box.x, top: box.y, width: box.w, height: box.h, borderRadius: box.r }}>
          <GlowRing mode={mode} />
        </div>
      )}
      {said && (
        <div
          ref={inl}
          className={'ai-inl' + (end?.step === 3 ? ' hide' : '')}
          data-testid="ai-spot-bar"
          // 卡下面 8；卡贴着这一块的底边、下面放不下时放到卡上面
          style={{ top: box.y + box.h + 40 > props.room().h ? box.y - 32 : box.y + box.h + 8 }}
        >
          <i className={'dot' + (end ? '' : ' on')} />
          <span>{said}</span>
          {!end && !e.stopping && (
            <button type="button" className="stop" onClick={stopActing}>
              {t('停下 esc')}
            </button>
          )}
        </div>
      )}
    </>
  )
}
