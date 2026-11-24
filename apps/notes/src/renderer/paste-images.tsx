/**
 * AI 输入框里 ⌘V 粘图、从访达拖图进来、底行「+」加图（CN-24、第 2b 段）：图存进软件设置目录 pasted/（不进库、不进 Git），
 * 在输入框里是顶上那一排的一块材料（composer.tsx），发给引擎时作为图片一起附上；一次最多 4 张。读 PDF 的输入框和别处的 AI 对话共用。
 */
export const MAX_PASTED = 4
export const pastedUrl = (name: string) => `cn-file://app/pasted/${encodeURIComponent(name)}`

/** 剪贴板、拖进来的文件里的图 */
export const imageFiles = (items: Iterable<File | null>) => [...items].filter((f): f is File => !!f && /^image\/(png|jpeg|gif|webp|heic|bmp|tiff)$/.test(f.type))

/** 别的格式（gif、webp、heic……）先画成 PNG：引擎只收 PNG、JPEG */
export async function toBytes(f: File): Promise<{ bytes: Uint8Array; mime: string }> {
  if (f.type === 'image/png' || f.type === 'image/jpeg') return { bytes: new Uint8Array(await f.arrayBuffer()), mime: f.type }
  const bmp = await createImageBitmap(f)
  const c = new OffscreenCanvas(bmp.width, bmp.height)
  c.getContext('2d')!.drawImage(bmp, 0, 0)
  const blob = await c.convertToBlob({ type: 'image/png' })
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png' }
}

/** 画成 PNG（SVG 没有自己的大小时按 800 宽画；小于 1200 宽的 SVG 放大两倍画，AI 看得清） */
async function blobToPng(blob: Blob, svg: boolean): Promise<Uint8Array> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode().catch(() => {
      throw new Error(svg ? '这张 SVG 图画不出来' : '这张图读不出来')
    })
    let w = img.naturalWidth || 800
    let h = img.naturalHeight || Math.round(w * 0.6)
    if (svg && w < 1200) {
      w *= 2
      h *= 2
    }
    const c = new OffscreenCanvas(w, h)
    const g = c.getContext('2d')!
    // SVG 多半是透明底：垫白底（AI、缩略图里黑字不会糊在深色上）
    if (svg) {
      g.fillStyle = '#fff'
      g.fillRect(0, 0, w, h)
    }
    g.drawImage(img, 0, 0, w, h)
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer())
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * 网页上的一张图（拖进来的、右键「问 AI 这张图」的）存进 pasted/：主进程用网页那个会话取回来，
 * PNG、JPEG 原样，SVG、WebP、GIF 画成 PNG；返回 pasted/ 里的名字
 */
export async function pasteWebImage(src: string): Promise<string> {
  const { bytes, type } = await window.cnWeb.fetchImage(src)
  if (type === 'image/png' || type === 'image/jpeg') return window.cn.aiPaste(bytes, type)
  const png = await blobToPng(new Blob([new Uint8Array(bytes)], { type }), type === 'image/svg+xml')
  return window.cn.aiPaste(png, 'image/png')
}
