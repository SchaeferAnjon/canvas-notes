/**
 * 速记（⌥⌘N）时前台就是画布笔记自己：主进程问这里选中了什么（main/quick.ts 的 ownSelection），不按 ⌘C、不要辅助功能权限。
 * - 焦点在右栏网页里（<webview>）：交回那个网页的编号，主进程去问那个网页；
 * - 在编辑器里（文档、白板卡、右栏笔记）：选中的那几段原文（md），长的选区不在屏上也拿得全；
 * - 输入框、文本框里：选中的那一截；
 * - 别处（读 PDF 的文字层、AI 回答、预览）：系统选区的字。
 */
import { EditorView } from '@codemirror/view'

declare global {
  interface Window {
    cnQuickGrab(): { text: string } | { webview: number }
  }
}

window.cnQuickGrab = () => {
  const a = document.activeElement as (HTMLElement & { getWebContentsId?: () => number }) | null
  if (a?.tagName === 'WEBVIEW' && a.getWebContentsId) return { webview: a.getWebContentsId() }
  const ed = a?.closest<HTMLElement>('.cm-editor')
  const view = ed ? EditorView.findFromDOM(ed) : null
  if (view) {
    const parts = view.state.selection.ranges.filter((r) => !r.empty).map((r) => view.state.sliceDoc(r.from, r.to))
    if (parts.length) return { text: parts.join('\n') }
  }
  if (a instanceof HTMLTextAreaElement || (a instanceof HTMLInputElement && /^(text|search|url)$/.test(a.type))) {
    const s = a.selectionStart ?? 0
    const e = a.selectionEnd ?? 0
    if (e > s) return { text: a.value.slice(s, e) }
  }
  return { text: String(window.getSelection() ?? '') }
}
