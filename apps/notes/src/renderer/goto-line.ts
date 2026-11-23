/**
 * 画布今日和待办详情小卡的「打开笔记，到这一行」（canvas-notes://open?file=<笔记>.md&line=N），
 * AI 回答里引用的「笔记#L12-L18」「笔记#标题」（task-3e53q，cite.tsx）：
 * 等这一篇的编辑器开好（刚开的标签要读文件），光标放到那几行末尾、滚到当中、左边闪一下（同插进文档的那道竖线）。
 */
import { EditorView } from '@codemirror/view'
import { flashRange } from './insert-flash'
import { NoteDoc } from './note-doc'

/** el 第一次有了大小（藏着的标签切到前面）时叫 run 一次；已经看得见就马上叫 */
export function whenShown(el: Element, run: () => void) {
  if (el.getClientRects().length) return run()
  const ro = new ResizeObserver(() => {
    if (!el.isConnected) return ro.disconnect()
    if (!el.getClientRects().length) return
    ro.disconnect()
    run()
  })
  ro.observe(el)
}

/**
 * pick：第几行（1 起），或按全文算出哪几行（找不到给 null，只开不跳）。
 * later：标签开在后面（⇧⌘点）：等它切到前面再滚、再闪。返回找到的那几行（没开成或没找到是 null）
 */
export async function goToLines(path: string, pick: number | ((text: string) => { from: number; to: number } | null), opts: { wait?: number; later?: boolean } = {}): Promise<{ from: number; to: number } | null> {
  const t0 = Date.now()
  const wait = opts.wait ?? 4000
  let doc: NoteDoc | undefined
  while (!(doc = [...NoteDoc.open].find((d) => d.path === path)) && Date.now() - t0 < wait) await new Promise((r) => setTimeout(r, 50))
  if (!doc) return null
  // 打开时先放回上次的光标：等它放完再换到这一行
  await new Promise((r) => requestAnimationFrame(() => r(null)))
  const range = typeof pick === 'number' ? { from: pick, to: pick } : pick(doc.view.state.doc.toString())
  if (!range) return null
  // 这一篇开在任务界面（task-pd1d1，名字叫「待办」的默认）：那一行在任务界面里亮一下；编辑器藏着，不碰它、不给它焦点
  window.dispatchEvent(new CustomEvent('cn:goto-line', { detail: { path, line: range.from } }))
  const view = doc.view
  const go = () => {
    const d = view.state.doc
    const a = d.line(Math.min(Math.max(1, range.from), d.lines))
    const b = d.line(Math.min(Math.max(range.from, range.to), d.lines))
    view.dispatch({ selection: { anchor: b.to }, effects: EditorView.scrollIntoView(a.from, { y: 'center' }) })
    view.focus()
    flashRange(view, { from: a.from, to: b.to })
  }
  if (view.dom.offsetParent) go()
  else if (opts.later) whenShown(view.dom, go)
  return range
}

export async function goToLine(path: string, line: number, wait = 4000): Promise<boolean> {
  return (await goToLines(path, line, { wait })) !== null
}
