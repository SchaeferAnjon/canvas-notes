/**
 * 导图白板的自动排版：XMind「逻辑图」那样从中心往右展开。
 * 原照片卡在中心左边 70；中心到第一层 56，往后每层 44；叶子一行 34，第一层的组和组之间多空 16。
 * 同一层的节点左边对齐成一列。尺寸照 spec（第 4 节）。
 * 节点按字变宽，到 NODE_MAX_W 换行、跟着变高，不截字（偏好「导图节点不截字」）；变高的节点照样不和上下的重叠。
 */
import { type MapNode, pathKey } from '@cn/format'

export type Level = 'c' | 'l1' | 'l2'
export const levelOf = (depth: number): Level => (depth === 0 ? 'c' : depth === 1 ? 'l1' : 'l2')

/** 字以外的宽（左右内边距）、一行字时的高、换行后字以外的高（上下内边距） */
export const NODE_BOX: Record<Level, { pad: number; h: number; vpad: number }> = {
  c: { pad: 36, h: 42, vpad: 20 },
  l1: { pad: 28, h: 32, vpad: 12 },
  l2: { pad: 8, h: 26, vpad: 6 },
}
/** 节点最宽（含内边距），再长就换行；同 XMind 主题的默认最宽 */
export const NODE_MAX_W = 260
/** 字在 .mm-node .t 里的行高（mindmap.css 同一个数） */
export const LINE_HEIGHT = 1.4
/** 拿不准的节点后面多一个 16 的「?」和 6 的间距 */
export const UNSURE_EXTRA = 22

export const PHOTO_W = 300
/** 照片卡下面那行说明的高 */
export const CAPTION_H = 34
const ORIGIN = { x: 100, y: 70 }
const PHOTO_GAP = 70
const GAP: Record<number, number> = { 1: 56 }
const LEVEL_GAP = 44
const ROW = 34
const GROUP_GAP = 16
const TREE_GAP = 60
/** 同一列上下两个节点至少空这么多（换了行的高节点也不贴上前一个）：第一层同组和组之间一样空 16，往后 8 */
const minGap = (depth: number) => (depth === 1 ? GROUP_GAP : 8)

export interface NodeBox {
  key: string
  x: number
  y: number
  w: number
  h: number
  level: Level
  depth: number
}

export interface MapLayout {
  nodes: NodeBox[]
  byKey: Record<string, NodeBox>
  /** 父 → 子 */
  wires: { from: string; to: string }[]
  photo: { x: number; y: number; w: number; h: number } | null
  /** 整张图右下角（画布要这么大） */
  w: number
  h: number
}

/** 一段字排进最宽 maxW 的框里占多宽、多高（宽不超过 maxW，放不下就换行） */
export type Measure = (text: string, level: Level, maxW: number) => { w: number; h: number }

/**
 * measure：一段字在某一层的字号下排出来多大（界面里放进一个看不见的节点里量，和画出来的一样，含中西文间距）。
 * photoAspect：照片的高 / 宽，没有照片是 null。folded：收起来的节点（它的孩子不画）。
 */
export function layoutMindmap(
  roots: MapNode[],
  measure: Measure,
  photoAspect: number | null,
  folded: ReadonlySet<string> = new Set(),
): MapLayout {
  const size = (n: MapNode, depth: number) => {
    const l = levelOf(depth)
    const extra = NODE_BOX[l].pad + (n.unsure ? UNSURE_EXTRA : 0)
    const t = measure(n.text, l, NODE_MAX_W - extra)
    return { w: Math.min(NODE_MAX_W, Math.ceil(t.w) + extra), h: Math.max(NODE_BOX[l].h, Math.ceil(t.h) + NODE_BOX[l].vpad) }
  }
  // 每一层最宽的节点：下一层的列从它右边开始
  const maxW: number[] = []
  const visit = (list: MapNode[], depth: number, path: number[]) =>
    list.forEach((n, i) => {
      const p = [...path, i]
      maxW[depth] = Math.max(maxW[depth] ?? 0, size(n, depth).w)
      if (!folded.has(pathKey(p))) visit(n.children, depth + 1, p)
    })
  visit(roots, 0, [])

  const photoH = photoAspect === null ? 0 : PHOTO_W * photoAspect + CAPTION_H
  const colX: number[] = [ORIGIN.x + (photoAspect === null ? 0 : PHOTO_W + PHOTO_GAP)]
  for (let d = 1; d < maxW.length; d++) colX[d] = colX[d - 1]! + maxW[d - 1]! + (GAP[d] ?? LEVEL_GAP)

  const nodes: NodeBox[] = []
  const wires: MapLayout['wires'] = []
  let cursor = ORIGIN.y
  /** 每一列已经排下去的最下沿：各层的列左右不相交，只要同一列上下不压着就不会重叠 */
  const colBottom: number[] = []
  const below = (depth: number) => (colBottom[depth] ?? -Infinity) + minGap(depth)

  /** 排一个节点和它下面的，返回它的中线 y */
  const place = (n: MapNode, depth: number, path: number[]): number => {
    const key = pathKey(path)
    const { w, h } = size(n, depth)
    const kids = folded.has(key) ? [] : n.children
    const l = levelOf(depth)
    let mid: number
    if (!kids.length) {
      cursor = Math.max(cursor, below(depth))
      mid = cursor + h / 2
      // 叶子一行 34（换了行的多出来的高照加）
      cursor += depth === 0 ? Math.max(h, ROW) + 8 : h + ROW - NODE_BOX[l].h
    } else {
      const first = nodes.length
      const mids = kids.map((k, i) => {
        const m = place(k, depth + 1, [...path, i])
        wires.push({ from: key, to: pathKey([...path, i]) })
        // 第一层的组和组之间多空一点
        if (depth === 0 && i < kids.length - 1) cursor += GROUP_GAP
        return m
      })
      mid = (mids[0]! + mids[mids.length - 1]!) / 2
      // 父节点换了行、比它的孩子们还高，会压到同一列上面那个：连孩子整棵往下挪
      const shift = below(depth) - (mid - h / 2)
      if (shift > 0) {
        for (const b of nodes.slice(first)) {
          b.y += shift
          colBottom[b.depth] = Math.max(colBottom[b.depth] ?? -Infinity, b.y + b.h)
        }
        mid += shift
        cursor += shift
      }
    }
    colBottom[depth] = Math.max(colBottom[depth] ?? -Infinity, mid + h / 2)
    nodes.push({ key, x: colX[depth]!, y: Math.round(mid - h / 2), w, h, level: l, depth })
    return mid
  }

  let photo: MapLayout['photo'] = null
  roots.forEach((r, i) => {
    const top = cursor
    const mid = place(r, 0, [i])
    if (i === 0 && photoAspect !== null) {
      // 照片和第一棵树的中心对齐；树比照片矮时，往下挪树，别让照片顶出画布
      let y = mid - photoH / 2
      if (y < ORIGIN.y) {
        const shift = ORIGIN.y - y
        for (const n of nodes) n.y += shift
        colBottom.forEach((b, d) => (colBottom[d] = b + shift))
        cursor += shift
        y = ORIGIN.y
      }
      photo = { x: ORIGIN.x, y: Math.round(y), w: PHOTO_W, h: Math.round(photoH) }
      cursor = Math.max(cursor, y + photoH)
    }
    // 最下面那个节点换了行、比游标还低
    cursor = Math.max(cursor, ...colBottom.filter((b) => b !== undefined))
    if (cursor === top) cursor += ROW
    cursor += TREE_GAP
  })

  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]))
  const right = Math.max(ORIGIN.x + (photo ? PHOTO_W : 0), ...nodes.map((n) => n.x + n.w))
  return { nodes, byKey, wires, photo, w: right + 60, h: cursor - TREE_GAP + 40 }
}

/**
 * 首页「最近的白板」里导图的缩略图：按排版算出的节点位置（字宽粗估：中文一个字一个字号，别的半个；超过最宽按行数折），
 * 有原照片时左边一块照片。节点总数一起给（首页写「N 个节点」）。
 */
export function mindmapThumb(roots: MapNode[], hasPhoto: boolean): { nodes: number; thumb: { x: number; y: number; w: number; h: number; k: 'm' | 'i' }[] } {
  const SIZE: Record<Level, number> = { c: 16, l1: 14, l2: 13 }
  const measure: Measure = (t, l, max) => {
    const w = [...t].reduce((w, ch) => w + (/[\u2e80-\uffff]/.test(ch) ? 1 : 0.55), 0) * SIZE[l]
    return { w: Math.min(w, max), h: Math.ceil(w / max || 1) * SIZE[l] * LINE_HEIGHT }
  }
  const lay = layoutMindmap(roots, measure, hasPhoto ? 0.75 : null)
  const thumb: { x: number; y: number; w: number; h: number; k: 'm' | 'i' }[] = lay.nodes.map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h, k: 'm' }))
  if (lay.photo) thumb.unshift({ ...lay.photo, k: 'i' })
  return { nodes: lay.nodes.length, thumb }
}

/** 连线：父节点右边中点 → 子节点左边（第二层以下接下划线左端），控制点各伸 26 */
export function wirePath(a: NodeBox, b: NodeBox): string {
  const x1 = a.x + a.w
  const y1 = a.y + a.h / 2
  const x2 = b.x
  const y2 = b.level === 'l2' ? b.y + b.h : b.y + b.h / 2
  return `M${x1} ${y1} C${x1 + 26} ${y1}, ${x2 - 26} ${y2}, ${x2} ${y2}`
}
