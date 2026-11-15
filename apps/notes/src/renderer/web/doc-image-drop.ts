/**
 * 文档里接图片：网页里的图拖进来、访达里的图拖进来、粘贴截图，存进附件后在落点那一段后面插 ![说明](附件/…)。
 */
import type { Text } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { imagesFrom, looksLikeImage, saveImages } from './image-drop'

/** 落在哪一行就插在那一段后面（落在空行上就插在空行处），前后各空一行；插在最后时以换行结尾 */
export function blockInsert(doc: Text, pos: number, text: string): { from: number; insert: string } {
  const line = doc.lineAt(Math.min(pos, doc.length))
  const isBlank = (n: number) => doc.line(n).text.trim() === ''
  const blank = isBlank(line.number)
  const next = line.number < doc.lines ? line.number + 1 : null
  const before = blank ? (line.number === 1 || isBlank(line.number - 1) ? '' : '\n') : '\n\n'
  const after = next === null ? '\n' : isBlank(next) ? '' : '\n'
  return { from: blank ? line.from : line.to, insert: before + text + after }
}

export function docImageDrop(notePath: () => string, onNotice: (t: string) => void) {
  const handle = (view: EditorView, dt: DataTransfer, pos: number) => {
    void imagesFrom(dt).then(async (cands) => {
      if (!cands.length) return
      const { md, errors } = await saveImages(notePath(), cands, '\n\n')
      if (md.length) view.dispatch({ changes: blockInsert(view.state.doc, pos, md.join('\n\n')), userEvent: 'input.drop', scrollIntoView: true })
      if (errors.length) onNotice(`有 ${errors.length} 张图没存成：${errors[0]}`)
    })
  }
  return EditorView.domEventHandlers({
    dragover(e, view) {
      if (view.state.readOnly || !e.dataTransfer || !Array.from(e.dataTransfer.types).some((t) => t === 'Files' || t === 'text/html' || t === 'text/uri-list')) return false
      e.preventDefault()
      return false
    },
    drop(e, view) {
      if (view.state.readOnly || !e.dataTransfer || !looksLikeImage(e.dataTransfer)) return false
      e.preventDefault()
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
      handle(view, e.dataTransfer, pos)
      return true
    },
    paste(e, view) {
      const items = Array.from(e.clipboardData?.items ?? [])
      if (view.state.readOnly || !items.some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return false
      e.preventDefault()
      handle(view, e.clipboardData!, view.state.selection.main.head)
      return true
    },
  })
}
