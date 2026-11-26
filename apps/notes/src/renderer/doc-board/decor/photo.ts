/**
 * 拖进来、「从照片…」选的图是不是透明图（设计页 145「贴纸」）：PNG / WebP 缩到 64 × 64，图边一圈有超过 30% 是透明的
 * （alpha < 16）就放成贴纸，别的照旧放成图片卡。同设计稿小样 placeImage 的算法。
 */

/** 能当贴纸的图的种类 */
export const STICKER_TYPES = ['image/png', 'image/webp']

export interface PhotoInfo {
  sticker: boolean
  /** 原图宽高（定贴纸的宽） */
  w: number
  h: number
}

export async function photoInfo(bytes: Uint8Array, type: string): Promise<PhotoInfo> {
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type }))
  try {
    const info = { w: bmp.width, h: bmp.height }
    if (!STICKER_TYPES.includes(type)) return { sticker: false, ...info }
    const n = 64
    const c = new OffscreenCanvas(n, n)
    const g = c.getContext('2d')!
    g.drawImage(bmp, 0, 0, n, n)
    const px = g.getImageData(0, 0, n, n).data
    let edge = 0
    let clear = 0
    for (let i = 0; i < n; i++)
      for (const [u, v] of [
        [i, 0],
        [i, n - 1],
        [0, i],
        [n - 1, i],
      ] as const) {
        edge++
        if (px[(v * n + u) * 4 + 3]! < 16) clear++
      }
    return { sticker: clear / edge > 0.3, ...info }
  } finally {
    bmp.close()
  }
}

/** 透明图贴纸的宽（白板点）：长边 160 上下，横的宽一些，最宽 200（同小样） */
export const photoWidth = (w: number, h: number) => Math.min(200, Math.round(160 * Math.max(1, w / Math.max(1, h))))
