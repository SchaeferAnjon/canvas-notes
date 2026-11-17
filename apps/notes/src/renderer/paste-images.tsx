/**
 * AI 输入框里 ⌘V 粘图、从访达拖图进来（CN-24）：图变成输入框上面的附件小图（和框一块问的小图一个样子，
 * 左下角「粘贴的图」，右上角 × 去掉），光标留在输入框，不预填字；一次最多 4 张。读 PDF 的输入框和右下角浮窗共用。
 */
import { Codicon } from '@cn/design'
import { useState } from 'react'

export const MAX_PASTED = 4
export const pastedUrl = (name: string) => `cn-file://app/pasted/${encodeURIComponent(name)}`

export interface Pasted {
  name: string
  url: string
}

const imagesOf = (items: Iterable<File>) => [...items].filter((f) => /^image\/(png|jpeg|gif|webp|heic|bmp|tiff)$/.test(f.type))

/** 别的格式（gif、webp、heic……）先画成 PNG：引擎只收 PNG、JPEG */
async function toBytes(f: File): Promise<{ bytes: Uint8Array; mime: string }> {
  if (f.type === 'image/png' || f.type === 'image/jpeg') return { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type }
  const bmp = await createImageBitmap(f)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  const blob = await c.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }
}

export function usePastedImages(onNotice: (text: string) => void) {
  const [list, setList] = useState<Pasted[]>([])
  const [dragging, setDragging] = useState(false)

  async function add(files: File[]) {
    if (!files.length) return false
    let room = MAX_PASTED - list.length
    if (room <= 0) {
      onNotice(`最多${MAX_PASTED}张`)
      return true
    }
    if (files.length > room) onNotice(`最多${MAX_PASTED}张`)
    for (const f of files.slice(0, room)) {
      try {
        const { bytes, mime } = await toBytes(f)
        const name = await window.cn.aiPaste(bytes, mime)
        setList((l) => (l.length >= MAX_PASTED ? l : [...l, { name, url: pastedUrl(name) }]))
        room--
      } catch (e) {
        onNotice(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      }
    }
    return true
  }

  return {
    list,
    dragging,
    clear: () => setList([]),
    /** 排着没发的那一问退回输入框：它贴过的图放回来 */
    /** 排着的那几问不发了：它们贴的图接回来（已经贴着的留着） */
    restore: (names: string[]) => setList((l) => [...l, ...names.filter((n) => !l.some((p) => p.name === n)).map((name) => ({ name, url: pastedUrl(name) }))].slice(0, MAX_PASTED)),
    remove: (name: string) => setList((l) => l.filter((p) => p.name !== name)),
    /** 输入框的 onPaste：有图就收下（字照常粘） */
    onPaste(e: React.ClipboardEvent) {
      const files = imagesOf([...e.clipboardData.items].filter((i) => i.kind === 'file').map((i) => i.getAsFile()!).filter(Boolean))
      if (!files.length) return
      e.preventDefault()
      void add(files)
    },
    /** 整个输入区的拖放：拖着图经过时外圈亮 */
    dropProps: {
      onDragOver(e: React.DragEvent) {
        if (![...e.dataTransfer.items].some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragging(true)
      },
      onDragLeave(e: React.DragEvent) {
        if (!(e.currentTarget as Element).contains(e.relatedTarget as Node | null)) setDragging(false)
      },
      onDrop(e: React.DragEvent) {
        setDragging(false)
        const files = imagesOf(e.dataTransfer.files)
        if (!files.length) return
        e.preventDefault()
        void add(files)
      },
    },
  }
}

/** 输入框上面的附件小图 */
export function PastedThumbs(props: { list: Pasted[]; onRemove(name: string): void }) {
  return (
    <>
      {props.list.map((p) => (
        <div key={p.name} className="attc pasted" data-testid="pasted-att">
          <img src={p.url} alt="粘贴的图" />
          <span className="lb">粘贴的图</span>
          <button className="rm" aria-label="不要这张图了" onClick={() => props.onRemove(p.name)}>
            <Codicon name="close" size={10} />
          </button>
        </div>
      ))}
    </>
  )
}
