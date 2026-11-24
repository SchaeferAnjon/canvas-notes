/**
 * 读 PDF 的 AI 看得到公式（2026-11-24）：给 AI 的这一页文字来自 pdf.js 的文字层，公式在里面是拆散的
 * （「αij = exp LeakyReLU a [W h ∥ W h ]」，上下标、求和上下限各成一行），AI 看不出原文的写法。
 * 画布笔记的 PDF 解析没有现成的公式图，就按文字层认出公式那几块（@cn/format 的 formulaRegions），照框截图带给 AI。
 *
 * 带哪几块（规则写在 DESIGN 之外，这里是唯一一处）：
 * - 问的话点了公式编号（askedEquations：「公式 (1)」「Eq. 3」）：带编号对得上的那几块，这一页没有就往前后页找（最多看 60 页）；
 * - 没点编号：这一页有公式，且是这一处的第一问、或者问的是公式（asksFormula）时，带这一页的公式块；
 * - 一次最多 4 块；这一页公式块多于 4 块又没点编号时，带整页一张（整页是最后的退路）；
 * - 他自己框了一块（附了框的图）时不另带。
 * 截图按 PDF 100% 的 3 倍画（7 磅的下标也清楚），一块公式几百像素宽、一百来像素高，一张一两百个 token。
 */
import { askedEquations, asksFormula, formulaRegions, type FormulaRegion, type Rect } from '@cn/format'
import { pageText, pdfDoc, renderCrop } from './pdf'

/** 一次最多带几块 */
export const MAX_FORMULA_CROPS = 4
/** 点了编号、这一页没有时最多往前后翻几页找 */
const SCAN_PAGES = 60

export interface FormulaCrop {
  /** 存在软件设置目录 pasted/ 里的名字（不进库） */
  name: string
  /** 给 AI 说这张是什么：「第 3 页公式 (1)」 */
  what: string
}

/** 这一问要带的公式块（还没截图）：[页, 块]；整页退路是 rect 为 null */
export async function formulaPicks(pdf: string, page: number, question: string, first: boolean): Promise<{ page: number; region: FormulaRegion | null }[]> {
  const doc = pdfDoc(pdf)
  if (!doc || page < 1) return []
  const here = formulaRegions(await pageText(doc, page))
  const nums = askedEquations(question)
  if (nums.length) {
    const out: { page: number; region: FormulaRegion }[] = []
    const want = new Set(nums)
    const take = (pg: number, rs: FormulaRegion[]) => {
      for (const r of rs)
        if (r.tags.some((t) => want.has(t))) {
          out.push({ page: pg, region: r })
          for (const t of r.tags) want.delete(t)
        }
    }
    take(page, here)
    // 这一页没有：从近到远往前后页找（公式 (1) 多半在前面几页）
    for (let d = 1; want.size && d <= SCAN_PAGES; d++)
      for (const pg of [page - d, page + d]) if (pg >= 1 && pg <= doc.numPages && want.size) take(pg, formulaRegions(await pageText(doc, pg)))
    if (out.length) return out.slice(0, MAX_FORMULA_CROPS)
  }
  if (!here.length || !(first || asksFormula(question))) return []
  if (here.length > MAX_FORMULA_CROPS) return [{ page, region: null }]
  return here.map((region) => ({ page, region }))
}

/** 截好、存进 pasted/，返回名字和给 AI 的说明 */
export async function formulaCrops(pdf: string, picks: { page: number; region: FormulaRegion | null }[]): Promise<FormulaCrop[]> {
  const doc = pdfDoc(pdf)
  if (!doc) return []
  const out: FormulaCrop[] = []
  for (const p of picks) {
    const c = await renderCrop(doc, p.page, p.region ? (p.region.rect as Rect) : undefined, 1400, p.region ? 3 : undefined)
    URL.revokeObjectURL(c.url)
    const name = await window.cn.aiPaste(c.png, 'image/png')
    const what = !p.region ? `第 ${p.page} 页整页（这一页公式多）` : p.region.tags.length ? `第 ${p.page} 页公式 ${p.region.tags.map((t) => `(${t})`).join('')}` : `第 ${p.page} 页一块没编号的公式`
    out.push({ name, what })
  }
  return out
}
