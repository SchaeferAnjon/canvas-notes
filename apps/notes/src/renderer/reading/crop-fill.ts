/**
 * 以前问过、笔记里那一段没有「我框的」图的，打开那份 PDF（或那篇配对笔记）时补一次（task-yp8l7）：
 * 主进程列出缺图的几段和记下的框（reading:crop-gaps），这里用 pdf.js 照框按 2 倍截（和框一块问时一样，笔记里按 100% 的宽显示），
 * 交回主进程插进那几段、一次提交（reading:crop-fill）。补完说一句「补上了 N 张截图；M 条当时没记下框的位置，补不了」。
 * 一次打开软件里同一份 PDF 只补一次；补不了的那句同一份笔记、同样的条数只说一次（记在本机）。
 */
import { t as tNow } from '../../shared/i18n'
import { pdfDoc, pdfjs, renderCrop, type PdfDoc } from './pdf'
import * as R from './store'

const tried = new Set<string>()
const TOLD = 'cn.cropFill.told'

/** 截图要用的 PDF：开着的那份直接用，没开就临时打开一份，用完关掉 */
async function withDoc<T>(pdf: string, f: (doc: PdfDoc) => Promise<T>): Promise<T> {
  const open = pdfDoc(pdf)
  if (open) return f(open)
  const { data } = await window.cnReading.pdfData(pdf)
  const task = pdfjs.getDocument({ data, cMapUrl: './pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: './pdfjs/standard_fonts/', wasmUrl: './pdfjs/wasm/', iccUrl: './pdfjs/iccs/' })
  try {
    return await f(await task.promise)
  } finally {
    void task.destroy()
  }
}

function toldBefore(key: string): boolean {
  try {
    const all = JSON.parse(localStorage.getItem(TOLD) ?? '{}') as Record<string, boolean>
    if (all[key]) return true
    all[key] = true
    localStorage.setItem(TOLD, JSON.stringify(all))
  } catch {
    // 本机存不了（隐私模式、存满了）：照样说
  }
  return false
}

/**
 * 补这份 PDF 的笔记里缺的图；返回要说的那句（没补、也不用说时是 null）。
 * 同一份这次打开软件已经补过就不再补
 */
export async function fillCrops(pdf: string): Promise<string | null> {
  if (!/\.pdf$/i.test(pdf) || tried.has(pdf)) return null
  tried.add(pdf)
  const said = await fill(pdf)
  // 右栏「笔记」顶上也说这一句（从配对笔记打开时补的，之后打开这份 PDF 的笔记栏也看得到）；读进来的笔记换成补好的
  if (said) {
    if (R.get(pdf).loaded) await R.reloadNote(pdf)
    R.setFilled(pdf, said)
  }
  return said
}

async function fill(pdf: string): Promise<string | null> {
  const { note, gaps, missing } = await window.cnReading.cropGaps(pdf)
  let added = 0
  if (gaps.length) {
    const items = await withDoc(pdf, async (doc) => {
      const out: { id: string; page: number; png?: Uint8Array; have?: string; w?: number }[] = []
      for (const g of gaps) {
        if (g.have) out.push({ id: g.id, page: g.page, have: g.have })
        else if (g.page <= doc.numPages) {
          const c = await renderCrop(doc, g.page, g.rect, undefined, 2)
          URL.revokeObjectURL(c.url)
          out.push({ id: g.id, page: g.page, png: c.png, w: c.cssW })
        }
      }
      return out
    })
    added = await window.cnReading.cropFill(pdf, items)
  }
  const key = `${note}\0${missing}`
  if (added) {
    if (missing) toldBefore(key)
    return missing ? tNow('补上了 {n} 张截图；{m} 条当时没记下框的位置，补不了', { n: added, m: missing }) : tNow('补上了 {n} 张截图', { n: added })
  }
  if (missing && !toldBefore(key)) return tNow('{m} 条当时没记下框的位置，补不了截图', { m: missing })
  return null
}
