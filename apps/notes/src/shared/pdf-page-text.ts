/**
 * pdf.js 的一页 → 文字项（左上角量）和图的位置，交给 pdf-blocks 拼段落。
 * 界面（PDF 标签，pdfjs-dist）和搜索进程（Node 里的 pdfjs-dist/legacy）用同一段，拼出来的块一样，缓存两边通用。
 */
import type { PdfImageBox, PdfPageText, PdfTextItem } from '@cn/format'
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'

/** 要用到的 pdf.js 的两样（两个版本的 pdfjs-dist 都有） */
export interface PdfjsParts {
  OPS: Record<string, number>
  Util: { transform(m1: number[], m2: number[]): number[] }
}

/** 点 p 按矩阵 m 变换（pdf.js 的 Util.applyTransform 是原地改，这里要新值） */
const apply = (p: number[], m: number[]): [number, number] => [m[0]! * p[0]! + m[2]! * p[1]! + m[4]!, m[1]! * p[0]! + m[3]! * p[1]! + m[5]!]

export async function pageTextOf(pdfjs: PdfjsParts, page: PDFPageProxy): Promise<PdfPageText> {
  const vp = page.getViewport({ scale: 1 })
  const tc = await page.getTextContent()
  const items: PdfTextItem[] = []
  for (const it of tc.items) {
    if (!('str' in it) || !it.str) continue
    const [a, b, , , e, f] = it.transform as number[]
    const [x, y] = apply([e!, f!], vp.transform)
    items.push({ str: it.str, x: x!, y: y!, w: it.width * vp.scale, h: Math.hypot(a!, b!) || it.height })
  }
  const images = await imageBoxes(pdfjs, page, vp)
  page.cleanup()
  return { width: vp.width, height: vp.height, items, images }
}

/** 运算符列表里画图片的那几步换成页面上的框 */
async function imageBoxes(pdfjs: PdfjsParts, page: PDFPageProxy, vp: PageViewport): Promise<PdfImageBox[]> {
  const { OPS, Util } = pdfjs
  const ops = await page.getOperatorList()
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack: number[][] = []
  const out: PdfImageBox[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i] as unknown[]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() ?? ctm
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args as number[])
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(ctm)
      const m = args[0] as number[] | null
      if (Array.isArray(m) && m.length === 6) ctm = Util.transform(ctm, m)
    } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() ?? ctm
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
      const m = Util.transform(vp.transform, ctm)
      const pts = [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ].map((p) => apply(p, m))
      const xs = pts.map((p) => p[0]!)
      const ys = pts.map((p) => p[1]!)
      const x = Math.max(0, Math.min(...xs))
      const y = Math.max(0, Math.min(...ys))
      out.push({ x, y, w: Math.min(vp.width, Math.max(...xs)) - x, h: Math.min(vp.height, Math.max(...ys)) - y })
    }
  }
  return out
}
