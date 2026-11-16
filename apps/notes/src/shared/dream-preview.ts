/**
 * 梦游预览：「归类和改名」还没收下的那几条，左栏（以后是目录树、文件夹首页）先画成改好以后的样子。
 * 只按路径换：不切工作目录、不读分支，正在打的字不受影响。纯函数，界面和测试都用。
 */
import type { DreamItem, DreamReport, NoteFile } from './api'
import { kindOf, titleOf } from './layout'

export interface Moved {
  id: string
  from: string
  to: string
  /** 名字也改了 */
  renamed: boolean
  /** 按用户说的重做过 */
  redo?: string
}

/** 一次挪了很多（导入几百条旧笔记）：按去处分组、默认收起，组里只露几条加搜索 */
export const BULK = 12
/** 大批量时一组里露几条 */
export const GROUP_SHOW = 5

const folderOf = (p: string) => p.split('/').slice(0, -1).join('/')

export function pendingMoves(r: DreamReport | null): Moved[] {
  return (r?.items ?? [])
    .filter((i) => i.group === 'file' && i.state === 'pending' && i.move)
    .map((i) => ({ id: i.id, from: i.move!.from, to: i.move!.to, renamed: titleOf(i.move!.from) !== titleOf(i.move!.to), ...(i.redo ? { redo: i.redo } : {}) }))
}

export interface Preview {
  /** 改好以后的笔记列表（挪的换了路径和分区） */
  notes: NoteFile[]
  /** 新路径 → 挪来的那条 */
  marks: Map<string, Moved>
  /** 原来的位置留个影子：挪走的 */
  ghosts: Moved[]
}

export function previewOf(notes: NoteFile[], moves: Moved[]): Preview {
  const byFrom = new Map(moves.map((m) => [m.from, m]))
  const marks = new Map<string, Moved>()
  const out = notes.map((n) => {
    const m = byFrom.get(n.path)
    if (!m) return n
    marks.set(m.to, m)
    const { topic, kind } = kindOf(m.to)
    const moved: NoteFile = { ...n, path: m.to, kind, ...(topic ? { topic } : {}) }
    if (!topic) delete moved.topic
    return moved
  })
  return { notes: out, marks, ghosts: moves.filter((m) => marks.has(m.to)) }
}

export interface FileGroup {
  /** 去处，如 课程/线性代数 */
  folder: string
  items: DreamItem[]
  /** 还没处理的 */
  pending: DreamItem[]
  /** 改了名字的条数 */
  renamed: number
}

/** 归类和改名按去处分组：条数多的在前，一样多按名字 */
export function fileGroups(items: DreamItem[]): FileGroup[] {
  const m = new Map<string, DreamItem[]>()
  for (const i of items) {
    if (i.group !== 'file' || !i.move) continue
    const f = i.state === 'dropped' && i.move.to === i.move.from ? '收件箱' : folderOf(i.move.to)
    m.set(f, [...(m.get(f) ?? []), i])
  }
  return [...m]
    .map(([folder, list]) => ({
      folder,
      items: list,
      pending: list.filter((i) => i.state === 'pending'),
      renamed: list.filter((i) => titleOf(i.move!.from) !== titleOf(i.move!.to)).length,
    }))
    .sort((a, b) => b.items.length - a.items.length || a.folder.localeCompare(b.folder, 'zh-CN'))
}

/** 组里按名字或原名找 */
export function searchGroup(items: DreamItem[], q: string): DreamItem[] {
  const s = q.trim().toLowerCase()
  if (!s) return items
  return items.filter((i) => titleOf(i.move!.to).toLowerCase().includes(s) || titleOf(i.move!.from).toLowerCase().includes(s))
}

/** 预览条上的一句：「3 处挪动和改名」/ 大批量「292 条，分到 5 个文件夹」 */
export function previewLine(moves: Moved[]): string {
  if (moves.length > BULK) return `${moves.length} 条，分到 ${new Set(moves.map((m) => folderOf(m.to))).size} 个文件夹`
  return `${moves.length} 处挪动和改名`
}
