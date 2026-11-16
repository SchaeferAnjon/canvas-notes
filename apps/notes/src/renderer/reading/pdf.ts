/**
 * pdf.js（Apache-2.0，mozilla.github.io/pdf.js）在界面里：打开库里的 PDF、读每页的文字和图的位置、截一块成 PNG。
 * 用法照 ParaRead（~/Documents/Projects/scholar-reader 的 src/renderer/src/lib/pdf.ts）。
 */
import type { PdfPageText, Rect } from '@cn/format'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { pageTextOf } from '../../shared/pdf-page-text'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export { pdfjs }
export type PdfDoc = pdfjs.PDFDocumentProxy

/** 打开着的 PDF：PDF 标签打开，笔记要截 AI 挑的图、整页问时借来用 */
const open = new Map<string, PdfDoc>()
const tasks = new Map<PdfDoc, pdfjs.PDFDocumentLoadingTask>()
export const pdfDoc = (path: string) => open.get(path) ?? null

export async function loadPdf(path: string): Promise<{ doc: PdfDoc; hash: string }> {
  const { data, hash } = await window.cnReading.pdfData(path)
  const task = pdfjs.getDocument({
    data,
    cMapUrl: './pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: './pdfjs/standard_fonts/',
    wasmUrl: './pdfjs/wasm/',
    iccUrl: './pdfjs/iccs/',
  })
  const doc = await task.promise
  open.set(path, doc)
  tasks.set(doc, task)
  return { doc, hash }
}

export function closePdf(path: string, doc: PdfDoc) {
  if (open.get(path) === doc) open.delete(path)
  void tasks.get(doc)?.destroy()
  tasks.delete(doc)
}

/** 一页的文字项（左上角量）和图的位置，交给 pdf-blocks 拼段落（和搜索进程同一段） */
export async function pageText(doc: PdfDoc, n: number): Promise<PdfPageText> {
  return pageTextOf(pdfjs, await doc.getPage(n))
}

/** 把一页的一块（这一页上的比例）画成 PNG；没给 rect 就是整页。宽度最多 maxW 像素 */
export async function renderCrop(doc: PdfDoc, n: number, rect: Rect | undefined, maxW = 1400): Promise<{ png: Uint8Array; url: string; w: number; h: number }> {
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const [rx, ry, rw, rh] = rect ?? [0, 0, 1, 1]
  // 截出来的那块大约 maxW 宽，但不超过 4 倍（小框放太大糊）
  const scale = Math.min(4, Math.max(1, maxW / (base.width * rw)))
  const vp = page.getViewport({ scale })
  const full = document.createElement('canvas')
  full.width = Math.ceil(vp.width)
  full.height = Math.ceil(vp.height)
  const ctx = full.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, full.width, full.height)
  await page.render({ canvas: full, canvasContext: ctx, viewport: vp }).promise
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(vp.width * rw))
  out.height = Math.max(1, Math.round(vp.height * rh))
  out.getContext('2d')!.drawImage(full, vp.width * rx, vp.height * ry, out.width, out.height, 0, 0, out.width, out.height)
  page.cleanup()
  const blob = await new Promise<Blob>((res, rej) => out.toBlob((b) => (b ? res(b) : rej(new Error('截图失败'))), 'image/png'))
  const png = new Uint8Array(await blob.arrayBuffer())
  return { png, url: URL.createObjectURL(blob), w: out.width, h: out.height }
}
