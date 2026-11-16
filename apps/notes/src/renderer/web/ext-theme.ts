/**
 * 书签管家新标签页跟着主题走（shared/ext-theme.ts）：这边按 <html> 上现在的主题算好颜色，报给主进程，
 * 主进程记下并转给开着的插件页。换主题（data-skin / data-tone 变了）就再报一次。
 */
import { EXT_THEME_KEYS, type ExtTheme } from '../../shared/ext-theme'

function current(): ExtTheme {
  const r = document.documentElement
  const cs = getComputedStyle(r)
  const vars: ExtTheme['vars'] = {}
  for (const k of EXT_THEME_KEYS) {
    const v = cs.getPropertyValue('--' + k).trim()
    if (v) vars[k] = v
  }
  return { tone: r.dataset.tone === 'dark' ? 'dark' : 'light', vars }
}

let started = false
export function syncExtTheme() {
  if (started) return
  started = true
  let last = ''
  const send = () => {
    const t = current()
    const key = JSON.stringify(t)
    if (key === last) return
    last = key
    window.cnWeb.extTheme(t)
  }
  send()
  new MutationObserver(send).observe(document.documentElement, { attributes: true, attributeFilter: ['data-skin', 'data-tone'] })
}
