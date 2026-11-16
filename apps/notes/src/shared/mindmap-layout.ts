/**
 * 导图白板的自动排版：XMind「逻辑图」那样从中心往右展开。
 * 原照片卡在中心左边 70；中心到第一层 56，往后每层 44；叶子一行 34，第一层的组和组之间多空 16。
 * 同一层的节点左边对齐成一列。尺寸照 spec（第 4 节）。
 */
import { type MapNode, pathKey } from '@cn/format'

export type Level = 'c' | 'l1' | 'l2'
export const levelOf = (depth: number): Level => (depth === 0 ? 'c' : depth === 1 ? 'l1' : 'l2')

/** 字以外的宽（左右内边距）和高 */
export const NODE_BOX: Record<Level, { pad: number; h: number }> = {
  c: { pad: 36, h: 42 },
  l1: { pad: 28, h: 32 },
  l2: { pad: 8, h: 26 },
}
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

/**
 * measure：一段字在某一层的字号下多宽（界面里用 canvas 量）。
 * photoAspect：照片的高 / 宽，没有照片是 null。folded：收起来的节点（它的孩子不画）。
 */
export function layoutMindmap(
  roots: MapNode[],
  measure: (text: string, level: Level) => number,
  photoAspect: number | null,
  folded: ReadonlySet<string> = new Set(),
): MapLayout {
  const size = (n: MapNode, depth: number) => {
    const l = levelOf(depth)
    return { w: Math.ceil(measure(n.text, l) + NODE_BOX[l].pad + (n.unsure ? UNSURE_EXTRA : 0)), h: NODE_BOX[l].h }
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

  /** 排一个节点和它下面的，返回它的中线 y */
  const place = (n: MapNode, depth: number, path: number[]): number => {
    const key = pathKey(path)
    const { w, h } = size(n, depth)
    const kids = folded.has(key) ? [] : n.children
    let mid: number
    if (!kids.length) {
      mid = cursor + h / 2
      cursor += depth === 0 ? Math.max(h, ROW) + 8 : ROW
    } else {
      const mids = kids.map((k, i) => {
        const m = place(k, depth + 1, [...path, i])
        wires.push({ from: key, to: pathKey([...path, i]) })
        // 第一层的组和组之间多空一点
        if (depth === 0 && i < kids.length - 1) cursor += GROUP_GAP
        return m
      })
      mid = (mids[0]! + mids[mids.length - 1]!) / 2
    }
    nodes.push({ key, x: colX[depth]!, y: Math.round(mid - h / 2), w, h, level: levelOf(depth), depth })
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
        cursor += shift
        y = ORIGIN.y
      }
      photo = { x: ORIGIN.x, y: Math.round(y), w: PHOTO_W, h: Math.round(photoH) }
      cursor = Math.max(cursor, y + photoH)
    }
    if (cursor === top) cursor += ROW
    cursor += TREE_GAP
  })

  const byKey = Object.fromEntries(nodes.map((n) => [n.key, n]))
  const right = Math.max(ORIGIN.x + (photo ? PHOTO_W : 0), ...nodes.map((n) => n.x + n.w))
  return { nodes, byKey, wires, photo, w: right + 60, h: cursor - TREE_GAP + 40 }
}

/**
 * 首页「最近的白板」里导图的缩略图：按排版算出的节点位置（字宽粗估：中文一个字一个字号，别的半个），
 * 有原照片时左边一块照片。节点总数一起给（首页写「N 个节点」）。
 */
export function mindmapThumb(roots: MapNode[], hasPhoto: boolean): { nodes: number; thumb: { x: number; y: number; w: number; h: number; k: 'm' | 'i' }[] } {
  const SIZE: Record<Level, number> = { c: 16, l1: 14, l2: 13 }
  const measure = (t: string, l: Level) => [...t].reduce((w, ch) => w + (/[\u2e80-\uffff]/.test(ch) ? 1 : 0.55), 0) * SIZE[l]
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
