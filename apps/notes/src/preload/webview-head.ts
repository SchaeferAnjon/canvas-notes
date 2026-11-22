/**
 * 右栏网页预加载里：一处（选中的字、框住的那块）上面最近的小标题（「2.2.1. 读取数据集」）。
 * 网页的笔记写进那篇时，回到那一段的链接、剪藏的来源一行写它（task-6cxtc）。藏着的、软件自己画的不算。
 */
import { cleanHead } from '../shared/read-along'

const HEADS = 'h1, h2, h3, h4, h5, h6'

export function headAbove(node: Node | null): string | undefined {
  if (!node) return undefined
  let best: Element | null = null
  for (const h of Array.from(document.querySelectorAll(HEADS))) {
    if (h.closest('#cn-clip-host, #cn-box-host, #cn-mark-host')) continue
    const pos = h.compareDocumentPosition(node)
    // 标题在它后面了：再往后的都在后面（querySelectorAll 按先后给）
    if (!(pos & Node.DOCUMENT_POSITION_FOLLOWING) && !(pos & Node.DOCUMENT_POSITION_CONTAINED_BY)) break
    if (h.getClientRects().length) best = h
  }
  const t = best ? cleanHead(best.textContent ?? '') : ''
  return t || undefined
}
