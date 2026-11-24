/**
 * 一页 PDF 的「第一行大字」（AI 对话记进配对笔记时一页一节的二级标题「第 28 页 · LIF Neuron」，design/ai-note-switch）：
 * pdf.js 那一页字号最大的那一行（一样大取最上面那行）；比正文大不出两成的页（全是正文、扫描件）没有，只写页码。纯函数。
 */
import { itemsToLines, type PdfPageText } from '@cn/format'

/** 标题最多几个字 */
const MAX = 40

export function pageTitle(text: PdfPageText | null | undefined): string {
  const lines = itemsToLines(text?.items ?? [])
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    // 页码、只有一两个符号的行不算
    .filter((l) => l.text.length >= 2 && !/^[\d\s.\-–—/|·•]+$/.test(l.text))
  if (!lines.length) return ''
  const hs = lines.map((l) => l.h).sort((a, b) => a - b)
  const body = hs[Math.floor(hs.length / 2)]!
  const top = Math.max(...hs)
  if (top < body * 1.2) return ''
  const big = lines.filter((l) => l.h >= top - 0.5).sort((a, b) => a.y - b.y)[0]!
  const t = big.text
  return [...t].length > MAX ? [...t].slice(0, MAX - 1).join('') + '…' : t
}
