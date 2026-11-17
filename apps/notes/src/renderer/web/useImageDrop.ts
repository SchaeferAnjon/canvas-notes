import { useRef, useState } from 'react'
import { imagesFrom, looksLikeImage, mayHaveImage, saveImages } from './image-drop'

type Pt = { x: number; y: number }

const editable = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('textarea, input, [contenteditable="true"]')

/**
 * 白板接图片：拖进来（网页、访达）、粘贴进来（剪贴板）。存进附件后在落点（粘贴时在看得到的地方）放图片卡。
 */
export function useBoardImageDrop(opts: {
  notePath: string
  readOnly: boolean
  toPlane(clientX: number, clientY: number): Pt
  freeSpot(): Pt
  addCards(texts: string[], at: Pt): void
  onNotice(t: string): void
}) {
  const [dropping, setDropping] = useState(false)
  const o = useRef(opts)
  o.current = opts

  async function place(dt: DataTransfer, at: Pt | null, paste = false) {
    // imagesFrom 在第一个 await 之前就把 DataTransfer 读完了（事件过后就读不到）
    const found = await imagesFrom(dt)
    if (!found.length) return
    // 剪贴板里的截图（文件名都叫 image.png）：起名「截图 N」、说明留空，和文档里一样（CN-40）
    const cands = paste ? found.map((c) => ({ ...c, alt: '', shot: true })) : found
    const { md, errors } = await saveImages(o.current.notePath, cands)
    if (md.length) o.current.addCards(md, at ?? o.current.freeSpot())
    if (errors.length) o.current.onNotice(`有${errors.length}张图没存成：${errors[0]}`)
  }

  return {
    dropping,
    handlers: {
      onDragOver(e: React.DragEvent) {
        if (o.current.readOnly || !mayHaveImage(Array.from(e.dataTransfer.types))) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dropping) setDropping(true)
      },
      onDragLeave(e: React.DragEvent) {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropping(false)
      },
      onDrop(e: React.DragEvent) {
        setDropping(false)
        if (o.current.readOnly || !looksLikeImage(e.dataTransfer)) return
        e.preventDefault()
        const at = o.current.toPlane(e.clientX, e.clientY)
        void place(e.dataTransfer, { x: Math.round(at.x - 40), y: Math.round(at.y - 20) })
      },
      onPaste(e: React.ClipboardEvent) {
        if (o.current.readOnly || editable(e.target) || !e.clipboardData) return
        if (!Array.from(e.clipboardData.items).some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return
        e.preventDefault()
        void place(e.clipboardData, null, true)
      },
    },
  }
}
