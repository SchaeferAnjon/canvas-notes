import { useRef, useState } from 'react'
import { clipText } from '@cn/ai-chat/paste'
import { asClip, imagesFrom, looksLikeImage, mayHaveImage, saveImages, takeWebText, WEB_DRAG_TYPE, webAnyLive, webImgClipped, webTextLive, webTextMd } from './image-drop'

type Pt = { x: number; y: number }

const editable = (t: EventTarget | null) => t instanceof HTMLElement && !!t.closest('textarea, input, [contenteditable="true"]')

/**
 * 白板接图片：拖进来（网页、访达）、粘贴进来（剪贴板）。存进附件后在落点（粘贴时在看得到的地方）放图片卡。
 * 粘贴时剪贴板里字和图都有（微信多条聊天记录、Excel 单元格另附一张渲染图）：贴成一张文字卡，不存图（粘贴优先文字，规矩同 AI 输入框、文档，@cn/ai-chat/paste 的 clipText）。
 */
export function useBoardImageDrop(opts: {
  notePath: string
  readOnly: boolean
  toPlane(clientX: number, clientY: number): Pt
  freeSpot(): Pt
  addCards(texts: string[], at: Pt): void
  /** 粘贴进来的是字（剪贴板里字和图都有）：在看得到的地方放一张文字卡，和右键「粘贴」一样 */
  pasteText(text: string): void
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
    // 从右栏网页拖来的当剪藏写（说明是图注，来源回到那张图，网页上标「剪过」），和文档里一样
    const cands = paste ? found.map((c) => ({ ...c, alt: '', shot: true })) : found.map(asClip)
    const { md, errors } = await saveImages(o.current.notePath, cands)
    if (md.length) o.current.addCards(md, at ?? o.current.freeSpot())
    const web = cands.find((c) => c.web)?.web
    if (md.length && web && /^https?:/i.test(web.url)) webImgClipped(o.current.notePath, md.join('\n\n'), web.url)
    if (errors.length) o.current.onNotice(`有${errors.length}张图没存成：${errors[0]}`)
  }

  return {
    dropping,
    handlers: {
      onDragOver(e: React.DragEvent) {
        if (o.current.readOnly || !(webAnyLive() || mayHaveImage(Array.from(e.dataTransfer.types)))) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dropping) setDropping(true)
      },
      onDragLeave(e: React.DragEvent) {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropping(false)
      },
      onDrop(e: React.DragEvent) {
        setDropping(false)
        if (o.current.readOnly) return
        const at = o.current.toPlane(e.clientX, e.clientY)
        // 网页里选中的字：放成一张卡，写法和点「剪藏」一样
        if (webTextLive()) {
          e.preventDefault()
          const c = takeWebText()
          if (!c) return
          const md = webTextMd(c)
          o.current.addCards([md], { x: Math.round(at.x - 40), y: Math.round(at.y - 20) })
          if (/^https?:/i.test(c.url)) webImgClipped(o.current.notePath, md, c.url)
          return
        }
        // 界面补发的那一下，真的 drop 已经接住了：吞掉
        if (!looksLikeImage(e.dataTransfer)) return void (Array.from(e.dataTransfer.types).includes(WEB_DRAG_TYPE) && e.preventDefault())
        e.preventDefault()
        void place(e.dataTransfer, { x: Math.round(at.x - 40), y: Math.round(at.y - 20) })
      },
      onPaste(e: React.ClipboardEvent) {
        if (o.current.readOnly || editable(e.target) || !e.clipboardData) return
        if (!Array.from(e.clipboardData.items).some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return
        e.preventDefault()
        const text = clipText(e.clipboardData).trim()
        if (text) o.current.pasteText(text)
        else void place(e.clipboardData, null, true)
      },
    },
  }
}
