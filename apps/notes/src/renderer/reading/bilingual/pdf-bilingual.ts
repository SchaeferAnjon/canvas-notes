/**
 * PDF 对照读里和 PDF 本身有关的：块在页上的比例、译文进度那一行、「存成双语笔记」（先把没翻的翻完，再裁公式和图，交给主进程写）。
 */
import { biKind, decorations, type PdfBlock, type Rect, tableToMarkdown, translatable } from '@cn/format'
import type { BilingualSaveRequest } from '../../../shared/reading'
import * as R from '../store'
import type { FlowBlock } from './ReflowView'
import { hashOf, langsLine, request, trOf } from './store'

/** 块的外框换成这一页上的比例（pad：四周多留几个页面单位） */
export function blockRect(b: Pick<PdfBlock, 'x' | 'y' | 'w' | 'h'>, size: { w: number; h: number }, pad = 3): Rect {
  const x = Math.max(0, (b.x - pad) / size.w)
  const y = Math.max(0, (b.y - pad) / size.h)
  return [x, y, Math.min(1 - x, (b.w + pad * 2) / size.w), Math.min(1 - y, (b.h + pad * 2) / size.h)]
}

/** 页眉页脚（页面最上、最下一小条里的短行）和装饰图（decorations 认出来的 Logo 这类）不进对照，也不进双语笔记 */
export function bodyBlocks<T extends Pick<PdfBlock, 'id' | 'kind' | 'text' | 'y' | 'h'>>(list: T[], size: { h: number }, decor?: Set<string>): T[] {
  return list.filter((b) => (b.kind === 'image' ? !decor?.has(b.id) : !(b.text.length < 80 && (b.y > size.h * 0.92 || b.y + b.h < size.h * 0.07))))
}

/** 「译文 7/10 页」；还在翻时「正在翻 · 译文 7/10 页」 */
export function biStatus(bi: { tr: Record<string, { state: string }> }, blocks: Record<number, FlowBlock[]>, pages: number): { text: string; busy: boolean } {
  let done = 0
  let busy = false
  for (let n = 1; n <= pages; n++) {
    const list = blocks[n]
    if (!list) continue
    const want = translatable(list)
    const states = want.map((b) => bi.tr[hashOf(b.text)]?.state)
    if (states.some((s) => s === 'wait')) busy = true
    if (states.every((s) => s === 'ok')) done++
  }
  return { text: `${busy ? '正在翻 · ' : ''}译文${done}/${pages}页`, busy }
}

/**
 * 存成双语笔记：全文读完 → 没翻的全部翻完（按钮上写进度）→ 公式和图照原页裁下来 → 主进程写「<PDF 名> 双语.md」，一次提交。
 */
export async function savePdfBilingual(pdf: string, sizes: { w: number; h: number }[], course: string | null, progress: (t: string) => void): Promise<{ path: string; failed: number }> {
  const r = R.get(pdf)
  if (r.readN < sizes.length) throw new Error(`全文还在读（${r.readN}/${sizes.length}页），读完再存`)
  const decor = decorations(r.blocks, sizes)
  const pages = sizes.map((sz, i) => ({ page: i + 1, blocks: bodyBlocks(r.blocks[i + 1] ?? [], sz, decor) }))
  const all = pages.flatMap((p) => translatable(p.blocks))
  progress(`在翻0/${sizes.length}页…`)
  // 一页一页翻，按钮上数到第几页
  for (const p of pages) {
    await request(pdf, translatable(p.blocks), course)
    progress(`在翻${p.page}/${sizes.length}页…`)
  }
  // 别处已经在翻的段（看得到的那几页）不重复要，等它们回来
  for (let i = 0; i < 3000 && all.some((b) => trOf(pdf)[hashOf(b.text)]?.state === 'wait'); i++) await new Promise((res) => setTimeout(res, 100))
  const tr = trOf(pdf)
  const failed = all.filter((b) => tr[hashOf(b.text)]?.state !== 'ok').length
  progress('在裁公式和图…')
  const out: BilingualSaveRequest['pages'] = []
  for (const p of pages) {
    const blocks: BilingualSaveRequest['pages'][number]['blocks'] = []
    for (const b of p.blocks) {
      const k = biKind(b)
      // PDF 精读增强认出的公式写 $$LaTeX$$，表格写 Markdown 表（有合并格的照原页裁）
      const md = k === 'table' ? tableToMarkdown(b.text) : null
      if (k === 'formula' && b.kind === 'formula') blocks.push({ kind: 'math', tex: b.text })
      else if (md) blocks.push({ kind: 'table', md })
      else if (k === 'formula' || k === 'figure' || k === 'table') {
        const c = await R.cropOf(pdf, p.page, blockRect(b, sizes[p.page - 1]!))
        URL.revokeObjectURL(c.url)
        blocks.push({ kind: k === 'formula' ? 'formula' : 'figure', png: c.png })
      } else if (translatable([b]).length) blocks.push({ kind: k === 'heading' ? 'heading' : 'text', text: b.text, tr: tr[hashOf(b.text)]?.text ?? null })
    }
    out.push({ page: p.page, blocks })
  }
  progress('在写…')
  const res = await window.cnReading.saveBilingual({ pdf, langs: langsLine(all.slice(0, 40).map((b) => b.text).join(' ')), pages: out })
  return { path: res.path, failed }
}
