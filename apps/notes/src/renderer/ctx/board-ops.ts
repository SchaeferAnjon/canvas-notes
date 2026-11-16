/**
 * 白板右键菜单里的几样整理（纯函数，好测）：复制一份、拿出列、左对齐 / 顶对齐、排整齐、放进新列。
 * 都是改卡片的 x / y / in，再交给白板按最小改动写回文件（一次 ⌘Z 撤回）。
 */
import { type BoardDoc, appendBlock, attr, content, newBlock, newId, num, withAttrs } from '@cn/format'
import { addColumn, CARD_W, putInColumn } from '../board-drop'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const GAP = 24

const indexOf = (doc: BoardDoc, id: string) => doc.blocks.findIndex((b) => attr(b, 'id') === id)

/** 复制一份：在列里的放在它下面一格，画布上的往右下错开一点；返回新白板和新卡片的 id */
export function duplicateCard(doc: BoardDoc, id: string): { doc: BoardDoc; id: string } {
  const i = indexOf(doc, id)
  const b = doc.blocks[i]
  if (!b) return { doc, id }
  const nid = newId(doc)
  const col = attr(b, 'in')
  if (col) {
    const slot = doc.blocks.filter((x) => attr(x, 'in') === col).findIndex((x) => attr(x, 'id') === id) + 1
    const next = appendBlock(doc, newBlock('card', { id: nid }, content(b)))
    return { doc: putInColumn(next, next.blocks.length - 1, col, slot), id: nid }
  }
  const copy = newBlock('card', { id: nid, x: num(b, 'x', 0) + GAP, y: num(b, 'y', 0) + GAP, w: num(b, 'w', CARD_W) }, content(b))
  return { doc: appendBlock(doc, copy), id: nid }
}

/** 从列里拿出来：放回它现在在画布上的位置（列的右边一点），宽度回到卡片宽 */
export function takeOut(doc: BoardDoc, id: string, at: Rect | undefined): BoardDoc {
  return { ...doc, blocks: doc.blocks.map((b) => (attr(b, 'id') === id ? withAttrs(b, { in: undefined, x: Math.round((at?.x ?? 0) + (at?.w ?? 0) + GAP), y: Math.round(at?.y ?? 0), w: CARD_W }) : b)) }
}

/** 在画布上（不在列里）的那几张 */
const freeIds = (doc: BoardDoc, ids: Iterable<string>) => [...ids].filter((id) => doc.blocks.some((b) => attr(b, 'id') === id && b.kind === 'card' && !attr(b, 'in')))

/** 左对齐 / 顶对齐：都挪到最靠左 / 最靠上那张的位置 */
export function align(doc: BoardDoc, ids: Iterable<string>, edge: 'left' | 'top'): BoardDoc {
  const free = new Set(freeIds(doc, ids))
  const key = edge === 'left' ? 'x' : 'y'
  const blocks = doc.blocks.filter((b) => free.has(attr(b, 'id') ?? ''))
  if (blocks.length < 2) return doc
  const v = Math.min(...blocks.map((b) => num(b, key, 0)))
  return { ...doc, blocks: doc.blocks.map((b) => (free.has(attr(b, 'id') ?? '') ? withAttrs(b, { [key]: v }) : b)) }
}

/** 排整齐：按原来从上到下、从左到右的顺序排成格子（每行最多 ceil(√n) 张），从最左上那张的位置开始 */
export function tidyGrid(doc: BoardDoc, ids: Iterable<string>, rects: Record<string, Rect>): BoardDoc {
  const free = freeIds(doc, ids).filter((id) => rects[id])
  if (free.length < 2) return doc
  const order = free.sort((a, b) => rects[a]!.y - rects[b]!.y || rects[a]!.x - rects[b]!.x)
  const per = Math.ceil(Math.sqrt(order.length))
  const x0 = Math.min(...order.map((id) => rects[id]!.x))
  const y0 = Math.min(...order.map((id) => rects[id]!.y))
  const place = new Map<string, { x: number; y: number }>()
  let y = y0
  for (let r = 0; r * per < order.length; r++) {
    const row = order.slice(r * per, r * per + per)
    row.forEach((id, c) => place.set(id, { x: Math.round(x0 + c * (CARD_W + GAP)), y: Math.round(y) }))
    y += Math.max(...row.map((id) => rects[id]!.h)) + GAP
  }
  return { ...doc, blocks: doc.blocks.map((b) => (place.has(attr(b, 'id') ?? '') ? withAttrs(b, { ...place.get(attr(b, 'id')!)!, w: CARD_W }) : b)) }
}

/** 放进新列：在最左上那张的位置建一列，几张按原来的上下顺序放进去 */
export function intoNewColumn(doc: BoardDoc, ids: Iterable<string>, rects: Record<string, Rect>): BoardDoc {
  const cards = [...ids].filter((id) => doc.blocks.some((b) => attr(b, 'id') === id && b.kind === 'card') && rects[id])
  if (!cards.length) return doc
  const order = cards.sort((a, b) => rects[a]!.y - rects[b]!.y || rects[a]!.x - rects[b]!.x)
  const col = newId(doc)
  let next = addColumn(doc, col, { x: Math.min(...order.map((id) => rects[id]!.x)), y: Math.min(...order.map((id) => rects[id]!.y)) })
  order.forEach((id, slot) => {
    next = putInColumn(next, indexOf(next, id), col, slot)
  })
  return next
}
