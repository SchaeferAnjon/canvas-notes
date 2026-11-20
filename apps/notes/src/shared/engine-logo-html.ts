/**
 * 各家标志的一段 HTML（偏好「AI 图标用引擎标志」）：画在网页里的地方用（AI 小指针、选中字的「翻译」、框一块的「讲解一下」），
 * 和界面同一套图（renderer/assets/engine-logos）。主进程、网页预加载都用，不碰 Electron。
 */
import { codiconSvg } from '@cn/design/codicon-svg'
import claudeSvg from '../renderer/assets/engine-logos/claude.svg?raw'
import codexSvg from '../renderer/assets/engine-logos/codex.svg?raw'
import deepseekSvg from '../renderer/assets/engine-logos/deepseek.svg?raw'
import geminiPng from '../renderer/assets/engine-logos/gemini.png?inline'
import zhipuSvg from '../renderer/assets/engine-logos/zhipu.svg?raw'
import type { TrEngineId } from './plugins/translate'

const SVG: Partial<Record<TrEngineId, string>> = { claude: claudeSvg, codex: codexSvg, deepseek: deepseekSvg, zhipu: zhipuSvg }

export function logoHtml(id: TrEngineId): string {
  if (id === 'gemini') return `<img src="${geminiPng}" alt="">`
  // OpenCode 没有现成的标志，用终端图标（同界面）
  return SVG[id] ?? codiconSvg('terminal')
}
