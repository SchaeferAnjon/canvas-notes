/**
 * 网页里画的 AI 那几样（选中字的「翻译」、框一块的「讲解一下」）用哪家的标志（偏好「AI 图标用引擎标志」）：
 * 界面（web/WebView.tsx）一打开网页、设置里一换，就发 cn:ai-logo 过来。还没收到、翻译没有能用的那家时是 null（照旧画原来的图标）
 */
import { ipcRenderer } from 'electron'
import type { TrEngineId } from '../shared/plugins/translate'
import { logoHtml } from '../shared/engine-logo-html'

export type AiLogos = { chat: TrEngineId | null; translate: TrEngineId | null }

let logos: AiLogos = { chat: null, translate: null }
const subs = new Set<() => void>()

ipcRenderer.on('cn:ai-logo', (_e, l: AiLogos) => {
  logos = l
  subs.forEach((f) => f())
})

/** 这件活现在画的那一段 HTML；不知道是哪家时 null */
export const aiLogoHtml = (job: keyof AiLogos): string | null => (logos[job] ? logoHtml(logos[job]) : null)

export function onAiLogo(f: () => void): () => void {
  subs.add(f)
  return () => subs.delete(f)
}
