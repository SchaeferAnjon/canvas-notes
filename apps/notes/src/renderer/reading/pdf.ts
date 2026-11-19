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

/**
 * 把一页的一块（这一页上的比例）画成 PNG；没给 rect 就是整页。宽度最多 maxW 像素；
 * fixed：按 PDF 100% 的几倍画（框好的那块按 2 倍，笔记里按 100% 的宽显示，CN-111）。cssW 是这块在 PDF 上 100% 时的宽
 */
export async function renderCrop(doc: PdfDoc, n: number, rect: Rect | undefined, maxW = 1400, fixed?: number): Promise<{ png: Uint8Array; url: string; w: number; h: number; cssW: number }> {
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const [rx, ry, rw, rh] = rect ?? [0, 0, 1, 1]
  // 截出来的那块大约 maxW 宽，但不超过 4 倍（小框放太大糊）
  const scale = fixed ?? Math.min(4, Math.max(1, maxW / (base.width * rw)))
  // 只画框住的那一块（视口挪到框的左上角、画布只有框那么大）：以前整页按最多 4 倍画再裁，
  // 重排里每个小 Logo 都整页画一遍，pdf.js 一个线程排着队，切到并排时原页要等很久（CN-31）
  const full = page.getViewport({ scale })
  const vp = page.getViewport({ scale, offsetX: -full.width * rx, offsetY: -full.height * ry })
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(full.width * rw))
  out.height = Math.max(1, Math.round(full.height * rh))
  const ctx = out.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, out.width, out.height)
  await page.render({ canvas: out, canvasContext: ctx, viewport: vp }).promise
  page.cleanup()
  // 当场编码成 PNG（toDataURL）：toBlob 在 Chromium 里排到空闲时才编码，刚点过按钮、窗口不在屏幕上（测试模式）时要等 1 到 7 秒
  const data = out.toDataURL('image/png')
  const bin = atob(data.slice(data.indexOf(',') + 1))
  const png = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) png[i] = bin.charCodeAt(i)
  return { png, url: URL.createObjectURL(new Blob([png], { type: 'image/png' })), w: out.width, h: out.height, cssW: Math.max(1, Math.round(base.width * rw)) }
}
