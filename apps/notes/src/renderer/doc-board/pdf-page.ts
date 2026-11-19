/**
 * 白板上 PDF 某一页的缩略图（文档里的 ![[x.pdf#page=3]]、问过 AI 没有截图时的那一页）：
 * 界面用 pdf.js 画成 PNG，存在软件设置目录 thumbs/（和课件封面同一处，按路径 + 修改时间 + 页码），不进库。
 * 一次只画一份（一块白板上好几页时不同时打开好几个 PDF），同一份 PDF 连着画的几页共用一次打开。
 */
import { useEffect, useState } from 'react'
import { pdfjs, renderCrop } from '../reading/pdf'

let queue: Promise<unknown> = Promise.resolve()
const memo = new Map<string, Promise<string>>()

/** 封面（第 1 页）用 PDF 的路径，别的页在后面加 #page=N，和课程首页的封面不打架 */
const keyOf = (path: string, page: number, w: number) => `${path}${page === 1 && w === 480 ? '' : `#page=${page}&w=${w}`}`

async function draw(path: string, mtimeMs: number, page: number, w: number): Promise<string> {
  const key = keyOf(path, page, w)
  const have = await window.cnFolder.thumb(key, mtimeMs)
  if (have) return have
  const { data } = await window.cnReading.pdfData(path)
  const task = pdfjs.getDocument({ data, cMapUrl: './pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: './pdfjs/standard_fonts/', wasmUrl: './pdfjs/wasm/', iccUrl: './pdfjs/iccs/' })
  try {
    const doc = await task.promise
    const c = await renderCrop(doc, Math.min(Math.max(1, page), doc.numPages), undefined, w)
    URL.revokeObjectURL(c.url)
    return await window.cnFolder.putThumb(key, mtimeMs, c.png)
  } finally {
    void task.destroy()
  }
}

export function pdfPage(path: string, mtimeMs: number, page: number, w: number): Promise<string> {
  const k = `${keyOf(path, page, w)}\0${mtimeMs}`
  let p = memo.get(k)
  if (!p) {
    p = queue.then(() => draw(path, mtimeMs, page, w))
    queue = p.catch(() => undefined)
    p.catch(() => memo.delete(k))
    memo.set(k, p)
  }
  return p
}

/** 这一页缩略图的网址；还在画是 null，画不出来（PDF 坏了、加了密、没这一页）是 'failed'；w：画多宽（像素，按 2 倍算） */
export function usePdfPage(path: string | null, mtimeMs: number, page: number, w = 560): string | null | 'failed' {
  const [url, setUrl] = useState<string | null | 'failed'>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    setUrl(null)
    pdfPage(path, mtimeMs, page, w).then(
      (u) => alive && setUrl(u),
      () => alive && setUrl('failed'),
    )
    return () => {
      alive = false
    }
  }, [path, mtimeMs, page, w])
  return path ? url : null
}
