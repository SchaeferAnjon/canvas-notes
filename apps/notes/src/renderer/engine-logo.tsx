/** 各家 AI 自己的标志（偏好「Agent 用自己的图标」，DESIGN.v3 2.1）：右下角圆钮、A 底栏的 AI 入口、左栏「问AI」、引擎菜单、翻译设置都用它 */
import { Codicon } from '@cn/design'
import { useEffect, useSyncExternalStore } from 'react'
import type { EngineId } from '../shared/agent'
import claudeSvg from './assets/engine-logos/claude.svg?raw'
import codexSvg from './assets/engine-logos/codex.svg?raw'
import deepseekSvg from './assets/engine-logos/deepseek.svg?raw'
import geminiPng from './assets/engine-logos/gemini.png'
import zhipuSvg from './assets/engine-logos/zhipu.svg?raw'

export type LogoEngine = 'claude' | 'codex' | 'gemini' | 'opencode' | 'deepseek' | 'zhipu'

const SVG: Partial<Record<LogoEngine, string>> = { claude: claudeSvg, codex: codexSvg, deepseek: deepseekSvg, zhipu: zhipuSvg }

/** OpenCode 没有现成的标志，用终端图标 */
export function EngineLogo({ id, size = 14 }: { id: LogoEngine; size?: number }) {
  const svg = SVG[id]
  if (svg) return <span className="eng-logo" data-engine={id} style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  if (id === 'gemini') return <img className="eng-logo" data-engine={id} src={geminiPng} width={size} height={size} alt="" />
  return (
    <span className="eng-logo" data-engine={id} style={{ width: size, height: size, display: 'inline-grid' }} aria-hidden="true">
      <Codicon name="terminal" size={size} />
    </span>
  )
}

// 「AI 对话」现在用哪家（设置 › AI 那一行；引擎菜单、设置里一改，主进程广播 ai:prefs:changed，用到的地方当场跟着换，CN-127）
let chatEngine: { id: EngineId; label: string } = { id: 'claude', label: 'Claude Code' }
const subs = new Set<() => void>()
let off: (() => void) | null = null
function load() {
  void window.cn.aiEngines().then((r) => {
    const label = r.engines.find((e) => e.id === r.current)?.label ?? chatEngine.label
    if (r.current === chatEngine.id && label === chatEngine.label) return
    chatEngine = { id: r.current, label }
    for (const s of subs) s()
  })
}

/** 「AI 对话」现在用的那家：右下角圆钮、A 底栏那一项、左栏「问AI」画它的标志 */
export function useChatEngine(): { id: EngineId; label: string } {
  useEffect(() => {
    if (!off) {
      load()
      off = window.cn.onAiPrefsChanged(load)
    }
  }, [])
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => chatEngine,
  )
}
