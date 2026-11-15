import { appendBlock, attr, type BoardDoc, moveBlock, newBlock, withAttrs } from '@cn/format'

/**
 * 白板上「东西落在哪」的算法：落点在哪一列、在列里排第几、新东西怎么写进文件。
 * 不碰 React 和 DOM，拖卡片和从工具板拖新东西共用。
 */

export const CARD_W = 280
export const COL_W = 300

export type Pt = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }

/** 工具板上的四样 */
export type PalKind = 'card' | 'todo' | 'column' | 'board'

/** 按住工具板按钮移动超过这么多（屏幕像素）才算拖，不然还是点一下 */
export const DRAG_SLOP = 4

/** 从工具板拖出来时，鼠标捏在新卡片左上角往里这么多（画布坐标）；预览和落下的位置都按它算 */
export const GRAB: Pt = { x: 24, y: 16 }

/** 预览的大小（画布坐标），接近新东西落下后的样子 */
export const PAL_SIZE: Record<PalKind, { w: number; h: number }> = {
  card: { w: CARD_W, h: 46 },
  todo: { w: CARD_W, h: 76 },
  column: { w: COL_W, h: 116 },
  board: { w: CARD_W, h: 72 },
}

export const TODO_BODY = '**待办**\n- [ ] '

export function movedEnough(from: Pt, to: Pt): boolean {
  return Math.abs(to.x - from.x) > DRAG_SLOP || Math.abs(to.y - from.y) > DRAG_SLOP
}

/** 新东西的左上角：落点减去捏住的那一点 */
export function dropOrigin(p: Pt): Pt {
  return { x: Math.round(p.x - GRAB.x), y: Math.round(p.y - GRAB.y) }
}

/** 落点下面的列（列下面多留 40 好放到最后）；except 是正在拖的那块自己 */
export function columnAt(doc: BoardDoc, rects: Record<string, Rect>, p: Pt, except?: string): string | null {
  for (const b of doc.blocks) {
    if (b.kind !== 'column') continue
    const id = attr(b, 'id')!
    if (id === except) continue
    const r = rects[id]
    if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h + 40) return id
  }
  return null
}

/** 落在列里排第几：数一数中线在落点上面的卡 */
export function slotInColumn(doc: BoardDoc, rects: Record<string, Rect>, col: string, y: number, except?: string): number {
  return doc.blocks.filter((b) => {
    if (attr(b, 'in') !== col || attr(b, 'id') === except) return false
    const r = rects[attr(b, 'id')!]
    return r !== undefined && r.y + r.h / 2 < y
  }).length
}

/** 把第 i 块卡放进列 col 的第 slot 个位置，文件里也挪到那里 */
export function putInColumn(doc: BoardDoc, i: number, col: string, slot: number): BoardDoc {
  const b = doc.blocks[i]!
  const id = attr(b, 'id')
  const members = doc.blocks.map((x, j) => ({ x, j })).filter(({ x }) => attr(x, 'in') === col && attr(x, 'id') !== id)
  const at = Math.max(0, Math.min(members.length, slot))
  const colIdx = doc.blocks.findIndex((x) => attr(x, 'id') === col)
  const target = at < members.length ? members[at]!.j : members.length ? members[members.length - 1]!.j + 1 : colIdx + 1
  const updated = withAttrs(b, { in: col, x: undefined, y: undefined, w: undefined })
  return moveBlock({ ...doc, blocks: doc.blocks.map((x, j) => (j === i ? updated : x)) }, i, target)
}

export type Place = { at: Pt } | { column: string; slot: number }

/** 加一张卡：放在画布上的 at，或者放进某一列的第 slot 个位置 */
export function addCard(doc: BoardDoc, id: string, body: string, place: Place): BoardDoc {
  if ('at' in place) return appendBlock(doc, newBlock('card', { id, x: Math.round(place.at.x), y: Math.round(place.at.y), w: CARD_W }, body))
  const next = appendBlock(doc, newBlock('card', { id }, body))
  return putInColumn(next, next.blocks.length - 1, place.column, place.slot)
}

/** 加一列：列只放在画布上，不进别的列 */
export function addColumn(doc: BoardDoc, id: string, at: Pt, title = '新的列'): BoardDoc {
  return appendBlock(doc, newBlock('column', { id, x: Math.round(at.x), y: Math.round(at.y), w: COL_W, title }, ''))
}
