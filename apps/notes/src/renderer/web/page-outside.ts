/**
 * 网页里按下鼠标、按 Esc（CN-43）：焦点在 webview 里时软件窗口收不到这些事，网页预加载报过来（cn:page-down / cn:page-esc），
 * WebView 转成这一个窗口事件；右栏的弹层（翻译菜单、书签和历史、插件、⋯、书签栏的文件夹）都听它收起。
 */
const EVT = 'cn:web-outside'
export type PageOutside = 'down' | 'esc'

export const pageOutside = (what: PageOutside) => window.dispatchEvent(new CustomEvent<PageOutside>(EVT, { detail: what }))

export function onPageOutside(fn: (what: PageOutside) => void): () => void {
  const h = (e: Event) => fn((e as CustomEvent<PageOutside>).detail)
  window.addEventListener(EVT, h)
  return () => window.removeEventListener(EVT, h)
}
