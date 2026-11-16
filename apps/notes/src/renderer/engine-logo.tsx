/** 各家 AI 自己的标志（偏好「Agent 用自己的图标」，DESIGN.v3 2.1）：AI 浮窗的引擎胶囊和菜单、A 底栏的 AI 入口、翻译设置都用它 */
import { Codicon } from '@cn/design'
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
  if (svg) return <span className="eng-logo" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  if (id === 'gemini') return <img className="eng-logo" src={geminiPng} width={size} height={size} alt="" />
  return <Codicon name="terminal" size={size} />
}
