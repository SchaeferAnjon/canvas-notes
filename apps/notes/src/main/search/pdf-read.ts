/**
 * 在搜索进程里读 PDF 的字：pdfjs-dist 的 Node 版（legacy），和 PDF 标签同一段拼法（shared/pdf-page-text.ts），
 * 拼出来的段落块写进同一个全文缓存，PDF 标签以后打开直接用。
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { documentBlocks, type PdfBlock, type PdfPageText } from '@cn/format'
import { pageTextOf, type PdfjsParts } from '../../shared/pdf-page-text'

type Pdfjs = typeof import('pdfjs-dist') & PdfjsParts

let lib: Promise<{ pdfjs: Pdfjs; dir: string }> | null = null
function pdfjs() {
  // 包里的 pdfjs-dist 原样放在 node_modules（不打进 bundle），字形表、标准字体从它那拿
  lib ??= (async () => {
    const req = createRequire(__filename)
    const dir = dirname(req.resolve('pdfjs-dist/package.json'))
    const url = (f: string) => pathToFileURL(join(dir, 'legacy/build', f)).href
    // pdf.js 载入时看 process.type 认是不是 Node：Electron 的 utilityProcess 里是 'utility'，它会当成浏览器（找 Web Worker、用 fetch 读字形表，都没有）。
    // 载入这两个模块的那一下让它当 Node；worker 那半边也先载好挂在 globalThis.pdfjsWorker 上（pdf.js 在 Node 里就这样用，不另起线程）
    const was = Object.getOwnPropertyDescriptor(process, 'type')
    if (was) Object.defineProperty(process, 'type', { value: 'browser', configurable: true })
    try {
      const mod = (await import(url('pdf.mjs'))) as Pdfjs
      ;(globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import(url('pdf.worker.mjs'))
      return { pdfjs: mod, dir }
    } finally {
      if (was) Object.defineProperty(process, 'type', was)
    }
  })()
  return lib
}

export async function readPdfText(abs: string): Promise<{ data: Uint8Array; pages: PdfBlock[][]; sizes: [number, number][] }> {
  const data = new Uint8Array(await readFile(abs))
  const { pdfjs: lib, dir } = await pdfjs()
  // pdf.js 会把 data 交给它自己的 worker（拿走缓冲区），给它一份拷贝
  const task = lib.getDocument({
    data: data.slice(),
    cMapUrl: join(dir, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(dir, 'standard_fonts') + '/',
    verbosity: 0,
  })
  try {
    const doc = await task.promise
    const texts: PdfPageText[] = []
    for (let n = 1; n <= doc.numPages; n++) texts.push(await pageTextOf(lib, await doc.getPage(n)))
    return { data, pages: documentBlocks(texts), sizes: texts.map((t) => [t.width, t.height]) }
  } finally {
    await task.destroy()
  }
}
