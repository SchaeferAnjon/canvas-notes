/**
 * 格子焦点（task-cle3x，照 Notion）：数据库表格（base/BaseTable.tsx）和文档里的普通表格（table-edit.ts）共用一套手感。
 * 表格有一个「选中的格子」（蓝框、淡底：类名 cn-cell-sel，样子在 grid-focus.css），表格拿到焦点才接管键盘：
 * - ← → ↑ ↓ 一格一格走，⌘ 加方向键到头；Tab / ⇧Tab 横着走，到行尾接下一行开头；
 * - 回车进编辑，直接打字也进编辑（打的字换掉原来的，像 Notion、表格软件）；编辑时回车、Esc 都回到选中这一格（回车存、Esc 不存），
 *   Tab / ⇧Tab 存了走到旁边一格；
 * - 第一行再按 ↑、最后一行再按 ↓：出表，回到上面、下面的正文（leave）；Esc 退回整块（escape）；
 * - 退格、Delete 清空这一格；⌘C、⌘X、⌘V 复制、剪切、粘贴这一格（剪贴板事件，复制出来是制表符隔开的字，能贴进别的表格软件）。
 * 这里只把键翻成「要做什么」（行差、列差的映射照 Tolaria 表格笔记的思路，代码自己写的），格子怎么画、怎么存归各自的表格。
 * 不依赖 React、CodeMirror：两种表格都按同一张表翻键。
 */
import './grid-focus.css'

/** 第几行、第几列（行、列都从 0 数，只数能选中的格子：数据库不算表头和组头，普通表格的表头算第 0 行） */
export interface GridPos {
  row: number
  col: number
}

export interface GridSize {
  rows: number
  cols: number
}

export type GridAct =
  /** 走到这一格 */
  | { kind: 'move'; to: GridPos }
  /** 出表：第一行按 ↑（up）、最后一行按 ↓（down） */
  | { kind: 'leave'; dir: 'up' | 'down' }
  /** 进编辑：回车（没有 seed），或者直接打字（typed：这个键的字会落进编辑框，换掉原来的字） */
  | { kind: 'edit'; typed: boolean }
  /** Esc：退出格子选中（数据库退回选中整块，普通表格回到正文） */
  | { kind: 'escape' }
  /** 退格、Delete：清空这一格 */
  | { kind: 'clear' }

/** 只看用得到的几样（React 的 KeyboardEvent、原生的都行） */
export interface KeyLike {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  isComposing?: boolean
  keyCode?: number
}

/** 方向键 → 行差、列差 */
const STEP: Record<string, [number, number]> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
}

/** 这个键会打出字（选中一格时直接打字就进编辑）：一个字符、没按 ⌘ / Ctrl；输入法开始选字（Process、229）也算 */
export function typesText(e: KeyLike): boolean {
  if (e.metaKey || e.ctrlKey) return false
  if (e.key === 'Process' || e.keyCode === 229) return true
  return [...e.key].length === 1
}

/**
 * 选中一格时按的键 → 要做什么；不归表格管的键给 null（交给外面：⌘S、⌘K 这些照常）。
 * 输入法正在选字时一律 null。
 */
export function gridKey(e: KeyLike, at: GridPos, size: GridSize): GridAct | null {
  if (e.isComposing) return null
  const last = { row: size.rows - 1, col: size.cols - 1 }
  const step = STEP[e.key]
  if (step && !e.altKey && !e.shiftKey) {
    const [dr, dc] = step
    // ⌘ 加方向键：到这一行、这一列的头
    if (e.metaKey || e.ctrlKey) {
      const to = { row: dr < 0 ? 0 : dr > 0 ? last.row : at.row, col: dc < 0 ? 0 : dc > 0 ? last.col : at.col }
      return { kind: 'move', to }
    }
    const row = at.row + dr
    if (row < 0) return { kind: 'leave', dir: 'up' }
    if (row > last.row) return { kind: 'leave', dir: 'down' }
    return { kind: 'move', to: { row, col: Math.min(last.col, Math.max(0, at.col + dc)) } }
  }
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) return { kind: 'move', to: tabFrom(at, size, e.shiftKey ? -1 : 1) }
  if (e.metaKey || e.ctrlKey || e.altKey) return null
  if (e.key === 'Enter' && !e.shiftKey) return { kind: 'edit', typed: false }
  if (e.key === 'Escape') return { kind: 'escape' }
  if (e.key === 'Backspace' || e.key === 'Delete') return { kind: 'clear' }
  if (typesText(e)) return { kind: 'edit', typed: true }
  return null
}

/** Tab 往右一格（⇧Tab 往左），到行尾接下一行开头；全表最后一格不动 */
export function tabFrom(at: GridPos, size: GridSize, dir: 1 | -1): GridPos {
  const i = at.row * size.cols + at.col + dir
  if (i < 0 || i >= size.rows * size.cols) return at
  return { row: Math.floor(i / size.cols), col: i % size.cols }
}

/** 编辑框里按的键：回车存、Esc 不存，都回到选中这一格；Tab / ⇧Tab 存了走到旁边一格。别的键留给编辑框 */
export type EditKey = 'commit' | 'cancel' | 'next' | 'prev'
export function editKey(e: KeyLike): EditKey | null {
  if (e.isComposing || e.keyCode === 229) return null
  if (e.key === 'Enter' && !e.shiftKey && !e.altKey) return 'commit'
  if (e.key === 'Escape') return 'cancel'
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) return e.shiftKey ? 'prev' : 'next'
  return null
}

/** 复制出去：一行一行、一格一格用制表符隔开（别的表格软件贴得进去）；格子里的换行、制表符换成空格 */
export function gridText(cells: string[][]): string {
  return cells.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t')).join('\n')
}

/** 贴进来的字 → 几行几格（制表符隔开；末尾的空行不算）。一格的字就是 [[字]] */
export function parseGridText(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')
  if (!lines.some((l) => l.includes('\t'))) return lines.length === 1 ? [[lines[0]!]] : lines.map((l) => [l])
  return lines.map((l) => l.split('\t'))
}
