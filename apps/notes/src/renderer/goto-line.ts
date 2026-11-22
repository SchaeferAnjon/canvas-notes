/**
 * 画布今日和待办详情小卡的「打开笔记，到这一行」（canvas-notes://open?file=<笔记>.md&line=N）：
 * 等这一篇的编辑器开好（刚开的标签要读文件），光标放到第 N 行行尾、滚到那一行、那一行左边闪一下（同插进文档的那道竖线）。
 */
import { EditorView } from '@codemirror/view'
import { flashRange } from './insert-flash'
import { NoteDoc } from './note-doc'

export async function goToLine(path: string, line: number, wait = 4000): Promise<boolean> {
  const t0 = Date.now()
  let doc: NoteDoc | undefined
  while (!(doc = [...NoteDoc.open].find((d) => d.path === path)) && Date.now() - t0 < wait) await new Promise((r) => setTimeout(r, 50))
  if (!doc) return false
  // 打开时先放回上次的光标：等它放完再换到这一行
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  // 这一篇开在任务界面（task-pd1d1，名字叫「待办」的默认）：那一行在任务界面里亮一下；编辑器藏着，不碰它、不给它焦点
  window.dispatchEvent(new CustomEvent('cn:goto-line', { detail: { path, line } }))
  const view = doc.view
  if (!view.dom.offsetParent) return true
  const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
  view.dispatch({ selection: { anchor: l.to }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) })
  view.focus()
  flashRange(view, { from: l.from, to: l.to })
  return true
}
