/**
 * AI 动手时的流光（DESIGN.v3 2.3，2026-11-21 用户选方向 A 后的 A2：慢一点、一道光、边缘柔化、颜色淡；原型 design/glow/proto-a2.html）。
 * - GlowEdge：被整块改的那一块（白板、文档、右栏网页）四条边各画一条细条，一道光沿四边匀速走，7 秒一圈；
 *   最外沿最亮，往内容里一层层变淡（静止的遮罩）。四条边分开画、光只动 transform：每帧只合成四条边，不重画白板。
 * - GlowRing：一样东西（改到的卡、提示条、AI 输入框）自己边上的一圈，同样往里柔化；一道光绕圈也只动 transform（rotate）。
 * 减少动态（prefers-reduced-motion）时不建动画，只有不动的一圈。
 * 2026-11-26 GlowEdge、GlowRing 搬进 @cn/design/glow（画布今日也用），这里转出去，只留 AI 输入框边上那一圈。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { GlowRing, type RingMode } from '@cn/design/glow'
import { actVersion, onActs, shownActs, still } from './ai-act-store'
import '@cn/design/glow.css'
import './ai-glow.css'

export { edgeFrames, type EdgePhase, GLOW_LOOP, GlowEdge, GlowRing, ringElement, type RingMode } from '@cn/design/glow'

/**
 * AI 输入框边上那一圈（AI 对话、读 PDF、旁支共用）：AI 在答时一道光绕着输入框走；答完停成一圈 0.25 秒、1.2 秒淡掉。
 * AI 在白板、文档、网页上动手时光让给那一块（光只在 AI 的手在的地方）；减少动态时不画
 */
export function ComposerGlow(props: { running: boolean }) {
  useSyncExternalStore(onActs, actVersion)
  // 动手的地方亮着（含做完收尾的那两秒）时都让给它，不在收尾时又在输入框上闪一下
  const on = props.running && !shownActs().length && !still()
  const [mode, setMode] = useState<RingMode | null>(null)
  const was = useRef(false)
  useEffect(() => {
    if (on) {
      was.current = true
      setMode('loop')
      return
    }
    if (!was.current) return
    was.current = false
    setMode('settle')
    const a = setTimeout(() => setMode('fade'), 250)
    const b = setTimeout(() => setMode(null), 1500)
    return () => {
      clearTimeout(a)
      clearTimeout(b)
    }
  }, [on])
  return mode ? <GlowRing mode={mode} testid="ai-input-glow" /> : null
}
