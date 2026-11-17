/**
 * 课件封面（CN-21）：PDF 第一页按 2 倍画成 PNG，存在软件设置目录（按路径 + 修改时间），不进库。
 * 一次只画一份（课程主页一下列好几份时不同时打开好几个 PDF）。
 */
import { useEffect, useState } from 'react'
import { pdfjs, renderCrop } from '../reading/pdf'

let queue: Promise<unknown> = Promise.resolve()
const memo = new Map<string, Promise<string>>()

async function draw(path: string, mtimeMs: number): Promise<string> {
  const have = await window.cnFolder.thumb(path, mtimeMs)
  if (have) return have
  const { data } = await window.cnReading.pdfData(path)
  const task = pdfjs.getDocument({ data, cMapUrl: './pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: './pdfjs/standard_fonts/', wasmUrl: './pdfjs/wasm/', iccUrl: './pdfjs/iccs/' })
  try {
    const doc = await task.promise
    // 封面一格约 240 宽，按 2 倍画
    const c = await renderCrop(doc, 1, undefined, 480)
    URL.revokeObjectURL(c.url)
    return await window.cnFolder.putThumb(path, mtimeMs, c.png)
  } finally {
    void task.destroy()
  }
}

export function coverOf(path: string, mtimeMs: number): Promise<string> {
  const k = `${path}\0${mtimeMs}`
  let p = memo.get(k)
  if (!p) {
    p = queue.then(() => draw(path, mtimeMs))
    queue = p.catch(() => undefined)
    p.catch(() => memo.delete(k))
    memo.set(k, p)
  }
  return p
}

/** 封面的网址；还在画是 null，画不出来（PDF 坏了、加了密）是 'failed' */
export function useCover(path: string, mtimeMs: number): string | null | 'failed' {
  const [url, setUrl] = useState<string | null | 'failed'>(null)
  useEffect(() => {
    let alive = true
    setUrl(null)
    coverOf(path, mtimeMs).then(
      (u) => alive && setUrl(u),
      () => alive && setUrl('failed'),
    )
    return () => {
      alive = false
    }
  }, [path, mtimeMs])
  return url
}
