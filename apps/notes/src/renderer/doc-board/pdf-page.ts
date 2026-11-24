/**
 * 白板上 PDF 某一页的缩略图（文档里的 ![[x.pdf#page=3]]、问过 AI 没有截图时的那一页）：
 * 界面用 pdf.js 画成 PNG，存在软件设置目录 thumbs/（和课件封面同一处，按路径 + 修改时间 + 页码），不进库。
 * 一次只画一份（一块白板上好几页时不同时打开好几个 PDF），同一份 PDF 连着画的几页共用一次打开。
 * 页码链接带着引的那句（#page=2&text=…）时，缩略图上也框出那一段（usePdfQuote，找法和点了跳过去同一个 quoteRect）。
 */
import { quoteRect, type Rect } from '@cn/format'
import { useEffect, useState } from 'react'
import { pageText, pdfDoc, pdfjs, renderCrop } from '../reading/pdf'

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

/** 引的那句在哪一页的哪一段：先找写的那页，再找后一页、前一页（AI 页码记差一页时，和点了跳过去一样）；找不到 null */
export interface QuoteAt {
  page: number
  rect: Rect
}
const quoteMemo = new Map<string, Promise<QuoteAt | null>>()

async function findQuote(path: string, page: number, text: string): Promise<QuoteAt | null> {
  // PDF 开着（读 PDF 时 AI 回答、配对笔记）借那份；没开着自己打开一次，和画缩略图排同一个队
  const open = pdfDoc(path)
  const look = async (doc: NonNullable<ReturnType<typeof pdfDoc>>) => {
    for (const n of [page, page + 1, page - 1].filter((n) => n >= 1 && n <= doc.numPages)) {
      const rect = quoteRect(await pageText(doc, n), text, n)
      if (rect) return { page: n, rect }
    }
    return null
  }
  if (open) return look(open)
  const { data } = await window.cnReading.pdfData(path)
  const task = pdfjs.getDocument({ data, cMapUrl: './pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: './pdfjs/standard_fonts/', wasmUrl: './pdfjs/wasm/', iccUrl: './pdfjs/iccs/' })
  try {
    return await look(await task.promise)
  } finally {
    void task.destroy()
  }
}

function pdfQuote(path: string, mtimeMs: number, page: number, text: string): Promise<QuoteAt | null> {
  const k = `${path}\0${mtimeMs}\0${page}\0${text}`
  let p = quoteMemo.get(k)
  if (!p) {
    p = queue.then(() => findQuote(path, page, text))
    queue = p.catch(() => undefined)
    p.catch(() => quoteMemo.delete(k))
    quoteMemo.set(k, p)
  }
  return p
}

/** 页码链接引的那一段在哪：没带引的句子、找不到、PDF 读不出字都是 null；还在找是 undefined（缩略图等它再画，免得先画一页又换一页） */
export function usePdfQuote(path: string, mtimeMs: number, page: number, text: string | undefined): QuoteAt | null | undefined {
  const [at, setAt] = useState<{ key: string; v: QuoteAt | null } | null>(null)
  const key = text ? `${path}\0${mtimeMs}\0${page}\0${text}` : ''
  useEffect(() => {
    if (!text) return
    let alive = true
    pdfQuote(path, mtimeMs, page, text).then(
      (v) => alive && setAt({ key, v }),
      () => alive && setAt({ key, v: null }),
    )
    return () => {
      alive = false
    }
  }, [key])
  if (!text) return null
  return at?.key === key ? at.v : undefined
}
