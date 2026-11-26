/**
 * 会消失的笔（设计页 145 第 3、4 条，用户定）：Mac 上白板右上角缩放旁一颗按钮，或按住 L 键用鼠标画；写给别人看，哪里都不写
 * （.ink 和 md 都不变，不进撤销、不同步）。
 * - 默认红色、停 3 秒、写完一起消失：写着时前面的都留着，停笔 3 秒后整组，最后 0.5 秒淡到 78%、0.6 秒淡完；
 *   「一笔一笔」时每一笔从它写完算。光迹照设计稿 decor.js 的 glowSVG：外晕、中层、亮芯，正在写的那一笔笔头一个亮点；
 *   系统开了「减少动态效果」时不画光晕，只画中层那一道、照样淡出。
 * - 再点一下这颗按钮出浮层：颜色（红 / 强调色 / 黄）、停多久（1.5 / 3 / 6 秒）、写完一起 / 一笔一笔；选的记在设置里
 *   （editor.fadeColor / fadeSecs / fadeMode，设置 › 文档和白板「消失笔停多久」是同一个）。
 * - 点按钮：关着 → 开；开着 → 出浮层；浮层开着再点 → 收起浮层、关掉笔。Esc 也关掉。
 * 笔迹记在白板坐标里（滚动、缩放时跟着内容走），画在盖住整块白板的一块 canvas 上（不随 CSS zoom 放大，线宽在屏幕上不变）。
 */
import { Codicon } from '@cn/design'
import { useDismiss } from '@cn/design/dismiss'
import { trackDrag } from '@cn/design/drag-end'
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { FADE_SECS, type FadeSecs } from '../../../shared/prefs'
import { useT } from '../../i18n'
import { anchorOf, FloatPop, type PopAnchor } from '../../pop-place'
import { publishSettings, usePrefs } from '../../settings-store'
import { typingIn } from '../../typing'
import { type FadeColor, glowColors, smoothPath } from './art'

type Pt = [number, number]
interface Stroke {
  pts: Pt[]
  /** 松手的时间（还在写是 null） */
  end: number | null
}

/** 淡出用的时间：停够秒数前 0.5 秒先淡到 78%，过了秒数 0.6 秒淡完 */
const PRE = 500
const OUT = 600

export interface FadePen {
  /** 消失笔开着（按钮按下了，或按住 L） */
  live: boolean
  /** 鼠标按下：开着就画一笔，返回 true（白板别的处理不再管） */
  down(e: React.MouseEvent): boolean
  /** 右上角缩放旁那一颗 */
  button: ReactNode
  /** 盖在白板上的那块 canvas 和浮层 */
  node: ReactNode
}

export function useFadePen(p: { wrap: RefObject<HTMLDivElement | null>; plane: RefObject<HTMLDivElement | null>; scale: number; active: boolean }): FadePen {
  const t = useT()
  const prefs = usePrefs((s) => s.editor)
  const [on, setOn] = useState(false)
  const [holdL, setHoldL] = useState(false)
  const [pop, setPop] = useState<PopAnchor | null>(null)
  const live = on || holdL
  const canvas = useRef<HTMLCanvasElement>(null)
  const strokes = useRef<Stroke[]>([])
  const writing = useRef<Stroke | null>(null)
  const lastUp = useRef(0)
  const raf = useRef(0)
  const pr = useRef({ prefs, scale: p.scale })
  pr.current = { prefs, scale: p.scale }

  const save = (patch: Partial<{ fadeColor: FadeColor; fadeSecs: FadeSecs; fadeMode: 'all' | 'each' }>) => void window.cn.setSettings({ editor: patch }).then(publishSettings)

  // ----- 画一帧 -----
  const frame = (now: number) => {
    raf.current = 0
    const cv = canvas.current
    const w = p.wrap.current
    const plane = p.plane.current
    if (!cv || !w || !plane) return
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
    const { prefs: f, scale } = pr.current
    const ms = f.fadeSecs * 1000
    const pl = plane.getBoundingClientRect()
    const ox = pl.left - wr.left
    const oy = pl.top - wr.top
    const css = getComputedStyle(area)
    const [col, core] = glowColors(f.fadeColor, css.getPropertyValue('--acc').trim() || '#12805a')
    const dark = document.documentElement.dataset.tone === 'dark'
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ageOf = (s: Stroke) => (f.fadeMode === 'all' ? (writing.current ? 0 : now - lastUp.current) : s.end === null ? 0 : now - s.end)
    strokes.current = strokes.current.filter((s) => ageOf(s) <= ms + OUT)
    let shown = 0
    let minA = 1
    for (const s of strokes.current) {
      const age = ageOf(s)
      let a = 1
      if (age > ms - PRE) a = 0.78
      if (age > ms) a = Math.max(0, 0.78 * (1 - (age - ms) / OUT))
      if (a <= 0 || !s.pts.length) continue
      shown++
      minA = Math.min(minA, a)
      // 白板坐标 → 这块 canvas 上的点（线宽在屏幕上不变）
      const pts = s.pts.map(([x, y]): Pt => [ox + x * scale, oy + y * scale])
      if (pts.length === 1) pts.push([pts[0]![0] + 0.1, pts[0]![1]])
      const path = new Path2D(smoothPath(pts))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = col
      // 照设计稿 glowSVG 三层：外晕 12 宽、模糊 4、浅色 30% / 深色 42%；中层 5.2、0.9、模糊 0.8；亮芯 2.2 近白。
      // 减弱动态：不画外晕和亮芯，只画中层那一道（照样淡出）
      if (!still) {
        ctx.filter = `blur(${4 * dpr}px)`
        ctx.globalAlpha = a * (dark ? 0.42 : 0.3)
        ctx.lineWidth = 12
        ctx.stroke(path)
        ctx.filter = `blur(${0.8 * dpr}px)`
      }
      ctx.globalAlpha = a * 0.9
      ctx.lineWidth = 5.2
      ctx.stroke(path)
      ctx.filter = 'none'
      if (!still) {
        ctx.strokeStyle = core
        ctx.globalAlpha = a
        ctx.lineWidth = 2.2
        ctx.stroke(path)
        // 正在写的那一笔：笔头一个亮点（半径 9 的光 + 2.6 的白点）
        if (s === writing.current) {
          const [hx, hy] = pts[pts.length - 1]!
          const g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 9)
          g.addColorStop(0, '#fff')
          g.addColorStop(0.35, core)
          g.addColorStop(0.6, col)
          g.addColorStop(1, 'rgba(0,0,0,0)')
          ctx.globalAlpha = 1
          ctx.fillStyle = g
          ctx.beginPath()
          ctx.arc(hx, hy, 9, 0, Math.PI * 2)
          ctx.fill()
          ctx.fillStyle = '#fff'
          ctx.beginPath()
          ctx.arc(hx, hy, 2.6, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    ctx.globalAlpha = 1
    // 还看得见几笔、最淡的那一笔多亮（测试量这两个）
    cv.dataset.live = String(shown)
    cv.dataset.alpha = shown ? minA.toFixed(2) : '0'
    if (strokes.current.length) kick()
  }
  const frameRef = useRef(frame)
  frameRef.current = frame
  const kick = () => {
    if (!raf.current) raf.current = requestAnimationFrame((n) => frameRef.current(n))
  }
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
  // 滚动、缩放：跟着内容重画
  useEffect(() => {
    const w = p.wrap.current
    if (!w) return
    const on = () => strokes.current.length && kick()
    w.addEventListener('scroll', on, { passive: true })
    return () => w.removeEventListener('scroll', on)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.wrap])
  useEffect(() => void (strokes.current.length && kick()), [p.scale])

  // ----- 开着时白板上的光标换成十字 -----
  useEffect(() => {
    const w = p.wrap.current
    if (!w) return
    w.classList.toggle('dc-fading', live)
    return () => w.classList.remove('dc-fading')
  }, [live, p.wrap])

  // ----- 按住 L 画、Esc 关 -----
  useEffect(() => {
    if (!p.active) return
    const down = (e: KeyboardEvent) => {
      if (typingIn(e.target) || e.metaKey || e.ctrlKey || e.altKey) return
      if (!p.wrap.current?.checkVisibility()) return
      if (e.key === 'Escape' && (on || pop)) {
        setPop(null)
        setOn(false)
        return
      }
      if (e.code === 'KeyL' && !e.repeat) setHoldL(true)
    }
    const up = (e: KeyboardEvent) => e.code === 'KeyL' && setHoldL(false)
    const blur = () => setHoldL(false)
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', blur)
    }
  }, [p.active, on, pop, p.wrap])
  // 白板不在前面了：关掉
  useEffect(() => {
    if (!p.active) (setOn(false), setHoldL(false), setPop(null))
  }, [p.active])

  const toPlane = (cx: number, cy: number): Pt => {
    const r = p.plane.current!.getBoundingClientRect()
    const s = p.scale || 1
    return [(cx - r.left) / s, (cy - r.top) / s]
  }
  const down = (e: React.MouseEvent): boolean => {
    if (!live || e.button !== 0 || !p.plane.current) return false
    e.preventDefault()
    e.stopPropagation()
    setPop(null)
    const s: Stroke = { pts: [toPlane(e.clientX, e.clientY)], end: null }
    strokes.current.push(s)
    writing.current = s
    kick()
    trackDrag(e, {
      move: (ev: MouseEvent) => {
        const q = toPlane(ev.clientX, ev.clientY)
        const l = s.pts[s.pts.length - 1]!
        if (Math.hypot(q[0] - l[0], q[1] - l[1]) * (p.scale || 1) < 1.5) return
        s.pts.push(q)
        kick()
      },
      end: () => {
        s.end = performance.now()
        lastUp.current = s.end
        writing.current = null
        kick()
      },
    })
    return true
  }

  const secs = prefs.fadeSecs
  const [glow] = glowColors(prefs.fadeColor, 'var(--acc)')
  const tip = t('消失笔：在白板上用鼠标写，停笔 {n} 秒后淡掉，不存进文件；开着时再点一下改颜色和秒数；按住 L 也能写', { n: secs })
  const button = (
    <div className="db-corner dc-fade-corner" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className={'dbc-btn dc-fade-btn' + (live ? ' on' : '')}
        aria-label={t('消失笔')}
        aria-pressed={live}
        data-testid="fade-pen"
        data-tip={tip}
        data-key="L"
        data-side="below"
        onClick={(e) => {
          const el = e.currentTarget
          if (!on) return setOn(true)
          if (!pop) return setPop(anchorOf(el))
          setPop(null)
          setOn(false)
        }}
      >
        <span className="dc-fade-ic" style={{ color: glow }}>
          <Codicon name="sparkle" size={15} />
        </span>
        <span className="lb">{t('消失笔')}</span>
      </button>
    </div>
  )
  const colors: [FadeColor, string][] = [
    ['red', t('红')],
    ['acc', t('强调色')],
    ['yellow', t('黄')],
  ]
  const node = (
    <>
      <canvas ref={canvas} className="dc-fade" aria-hidden data-testid="fade-canvas" data-live="0" />
      {pop && (
        <FloatPop at={pop} gap={6} align="end" className="dc-fpop" role="dialog" aria-label={t('消失笔')} data-testid="fade-pop" onMouseDown={(e) => e.preventDefault()}>
          <div className="fp-h">
            {t('消失笔')} <span>{t('写给别人看，不存')}</span>
          </div>
          <div className="fp-row">
            <span className="fp-l">{t('颜色')}</span>
            <div className="fp-dots" role="radiogroup" aria-label={t('颜色')}>
              {colors.map(([c, name]) => {
                const [g] = glowColors(c, 'var(--acc)')
                return (
                  <button key={c} type="button" role="radio" aria-checked={prefs.fadeColor === c} aria-label={name} data-tip={name} data-side="below" className={prefs.fadeColor === c ? 'on' : ''} style={{ background: g, boxShadow: `0 0 8px ${g}` }} onClick={() => save({ fadeColor: c })} />
                )
              })}
            </div>
          </div>
          <div className="fp-row">
            <span className="fp-l">{t('停多久')}</span>
            <div className="dc-seg" role="radiogroup" aria-label={t('停多久')}>
              {FADE_SECS.map((s) => (
                <button key={s} type="button" role="radio" aria-checked={secs === s} className={secs === s ? 'on' : ''} onClick={() => save({ fadeSecs: s })}>
                  {t('{n} 秒', { n: s })}
                </button>
              ))}
            </div>
          </div>
          <div className="fp-row">
            <span className="fp-l">{t('怎么消失')}</span>
            <div className="dc-seg" role="radiogroup" aria-label={t('怎么消失')}>
              <button type="button" role="radio" aria-checked={prefs.fadeMode === 'all'} className={prefs.fadeMode === 'all' ? 'on' : ''} onClick={() => save({ fadeMode: 'all' })}>
                {t('写完一起')}
              </button>
              <button type="button" role="radio" aria-checked={prefs.fadeMode === 'each'} className={prefs.fadeMode === 'each' ? 'on' : ''} onClick={() => save({ fadeMode: 'each' })}>
                {t('一笔一笔')}
              </button>
            </div>
          </div>
          <div className="fp-foot">{t('停笔 {n} 秒内接着写，前面的都留着；不进文件、不进撤销、不同步', { n: secs })}</div>
        </FloatPop>
      )}
      {pop && <PopCloser onClose={() => setPop(null)} />}
    </>
  )
  return { live, down, button, node }
}

/** 浮层：点外面（网页里也算）、窗口失焦收起（公共的 useDismiss；点那颗按钮由按钮自己管）；Esc 在上面「按住 L 画、Esc 关」那里连笔一起关 */
function PopCloser(props: { onClose(): void }) {
  useDismiss(true, [], () => props.onClose(), { keep: '.dc-fpop, .dc-fade-btn', esc: false })
  return null
}
