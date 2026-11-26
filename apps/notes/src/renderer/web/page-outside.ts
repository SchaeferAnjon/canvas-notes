/**
 * 网页里按下鼠标、按 Esc（CN-43）：焦点在 webview 里时软件窗口收不到这些事，网页预加载报过来（cn:page-down / cn:page-esc），
 * WebView 转成这一个窗口事件，同时交给公共的弹层关闭（@cn/design/dismiss 的 remoteDismiss）：接了 useDismiss / dismissable 的弹层
 * 点进网页、在网页里按 Esc 都收。onPageOutside 只留给要分清「网页里按了什么」的地方（视频问框在答时 Esc 是停下）。
 */
import { remoteDismiss } from '@cn/design/dismiss'

const EVT = 'cn:web-outside'
export type PageOutside = 'down' | 'esc'

export const pageOutside = (what: PageOutside) => {
  window.dispatchEvent(new CustomEvent<PageOutside>(EVT, { detail: what }))
  remoteDismiss(what)
}

export function onPageOutside(fn: (what: PageOutside) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<PageOutside>).detail)
  window.addEventListener(EVT, h)
  return () => window.removeEventListener(EVT, h)
}
