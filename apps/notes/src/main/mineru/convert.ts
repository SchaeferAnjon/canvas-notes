/**
 * MinerU 原样的结果（middle_json 的字）换成全文缓存（m1）：JSON 坏了、不是 middle_json、一块也没认出来都抛错，
 * 调用的地方当成「增强识别没成功」，照常用 pdf.js 的块。
 */
import { fromMiddle, type MiddleJson } from '@cn/format'
import type { PdfTextCache } from '../pdf-text-cache'

export function convertMiddle(raw: string, o: { pdf: string; pages: number; sizes?: [number, number][]; version: string }): PdfTextCache {
  let j: MiddleJson
  try {
    j = JSON.parse(raw) as MiddleJson
  } catch {
    throw new Error('MinerU 的结果不是完整的 JSON')
  }
  const r = fromMiddle(j, o.pages, o.sizes)
  if (!r.pages.some((p) => p.length)) throw new Error('一块也没认出来')
  return { pdf: o.pdf, pages: r.pages, sizes: r.sizes, mineru: o.version }
}
