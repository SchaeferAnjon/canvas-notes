/**
 * AI 动手看得见（DESIGN.v3.md 2.3，第三版 A4 / B3）：AI 在白板、文档、右栏网页上动手时，
 * - 那一块内描一圈 2px --acc-ring（从第一步到最后一步）；
 * - 顶上居中一条 32 高的胶囊：8px 紫点呼吸 +「AI 正在整理这块白板」+ 小按钮「停下 esc」（点它、按 esc 都停，当前这一步做完就停）；
 * - 「AI」小指针（20 的箭头 + 右下一个「AI」小胶囊）每去拿一样东西先移过去（0.55 秒），到了那样东西外圈亮约 0.5 秒，挪的时候指针跟着走。
 * 主进程在 ai:act 里说开始动哪一块（start）、去拿哪几样（grab，卡片和列的 data-id）、做完（end）。网页里的指针和
 * 「✂ 剪成卡片」画在网页自己里面（main/agent/web.ts），这里只画右栏网页的外圈。
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AiAct, AiActArea } from '../shared/agent'
import { AiIcon } from './engine-logo'
import './ai-act.css'

interface Acting {
  turn: number
  area: AiActArea
  path: string | null
  /** 按了停下，等这一步做完 */
  stopping: boolean
}

type Grab = Extract<AiAct, { kind: 'grab' }> & { seq: number }

let acting: Acting[] = []
let lastGrab: Grab | null = null
let version = 0
let seq = 0
const subs = new Set<() => void>()
const emit = () => {
  version++
  for (const f of subs) f()
}
let wired = false

/** 按了停下（esc、提示条上的「停下」）：这一轮当前这一步做完就停 */
export function stopActing() {
  const turns = [...new Set(acting.map((a) => a.turn))]
  if (!turns.length) return
  acting = acting.map((a) => ({ ...a, stopping: true }))
  emit()
  for (const t of turns) void window.cn.aiTurnStop(t)
}

function wire() {
  if (wired) return
  wired = true
  window.cn.onAiAct((e) => {
    if (e.kind === 'start') acting = [...acting.filter((a) => !(a.turn === e.turn && a.area === e.area)), { turn: e.turn, area: e.area, path: e.path, stopping: false }]
    else if (e.kind === 'grab') lastGrab = { ...e, seq: ++seq }
    else {
      acting = acting.filter((a) => a.turn !== e.turn)
      if (lastGrab?.turn === e.turn) lastGrab = null
    }
    emit()
  })
  // esc：AI 在动手时就是「停下」，比别处的 esc（关浮窗、关弹层）先接住
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape' || e.isComposing || !acting.length) return
      e.preventDefault()
      e.stopImmediatePropagation()
      stopActing()
    },
    true,
  )
}

function useActs(): number {
  wire()
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => version,
  )
}

const TEXT: Record<AiActArea, string> = { board: 'AI 正在整理这块白板', doc: 'AI 正在改这篇', web: 'AI 正在操作这个网页' }

/**
 * 画在这一块（host，position: relative，不随内容滚动）上面的外圈、提示条、指针和被拿的那样东西的外圈。
 * bar：顶上那条要不要（右栏网页太窄、网页里自己画指针，只要外圈）
 */
export function AiActLayer(props: { area: AiActArea; path?: string | null; host: React.RefObject<HTMLElement | null>; bar?: boolean }) {
  useActs()
  const { area, host } = props
  const path = props.path ?? null
  const on = acting.find((a) => a.area === area && (area === 'web' || a.path === path)) ?? null
  /** 指针在哪；dur：这一下移过去用多久（一长串时短一点，和主进程的节奏一样） */
  const [cur, setCur] = useState<{ x: number; y: number; shown: boolean; follow: boolean; dur?: number }>({ x: 0, y: 0, shown: false, follow: false })
  const [ring, setRing] = useState<{ x: number; y: number; w: number; h: number; r: string }[]>([])
  // 白板开着 AI 时卡片挪动带动画（.ai-on 下的 .bcard / .bcol 有 left/top 的过渡）
  useLayoutEffect(() => {
    const h = host.current
    if (!h) return
    h.classList.toggle('ai-on', !!on)
    return () => h.classList.remove('ai-on')
  }, [!!on])
  // 指针最开始放在这一块正中，看不见；第一次去拿东西时淡入
  useEffect(() => {
    if (!on) setCur((c) => ({ ...c, shown: false }))
    else {
      const h = host.current
      if (h) setCur({ x: h.clientWidth * 0.4, y: h.clientHeight * 0.4, shown: false, follow: false })
    }
    setRing([])
  }, [on?.turn])

  const g = lastGrab
  const grabKey = on && g && g.turn === on.turn && g.area === area && g.path === path ? g.seq : 0
  const live = useRef<{ raf: number; timers: ReturnType<typeof setTimeout>[] }>({ raf: 0, timers: [] })
  useEffect(() => {
    if (!grabKey || !g) return
    const h = host.current
    if (!h) return
    const find = (id: string) => h.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`)
    const els = g.ids.map(find).filter((x): x is HTMLElement => !!x)
    if (!els.length) return
    const first = g.ids.find((id) => find(id))!
    const rectOf = (el: HTMLElement) => {
      const hr = h.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      return { x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height, r: getComputedStyle(el).borderRadius || '10px' }
    }
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
    const st = live.current
    // 到了：那几样外圈亮起来；挪的时候外圈和指针跟着它走
    st.timers.push(
      setTimeout(() => {
        const t0 = performance.now()
        const keep = Math.max(500, g.ms)
        const loop = () => {
          const rs = g.ids.map(find).filter((x): x is HTMLElement => !!x).map(rectOf)
          setRing(rs)
          const q = point()
          if (q) setCur({ ...q, shown: true, follow: true })
          if (performance.now() - t0 < keep + 500) st.raf = requestAnimationFrame(loop)
          else setRing([])
        }
        st.raf = requestAnimationFrame(loop)
      }, dur),
    )
    return () => {
      cancelAnimationFrame(st.raf)
      for (const t of st.timers) clearTimeout(t)
      st.timers = []
      setRing([])
    }
  }, [grabKey])

  if (!on) return null
  return (
    <div className={`ai-act ai-act-${area}`} data-testid="ai-act" data-area={area}>
      <div className="ai-acting" data-testid="ai-acting" />
      {props.bar !== false && (
        <div className="ai-actbar" role="status" data-testid="ai-actbar">
          <i className="pulse" />
          <span>{on.stopping ? '停下了：这一步做完就停' : TEXT[area]}</span>
          <button type="button" className="ai-stop" disabled={on.stopping} onClick={stopActing}>
            停下
            <kbd>esc</kbd>
          </button>
        </div>
      )}
      {ring.map((r, i) => (
        <div key={i} className="ai-grab-ring" data-testid="ai-grab-ring" style={{ left: r.x, top: r.y, width: r.w, height: r.h, borderRadius: r.r }} />
      ))}
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
    </div>
  )
}
