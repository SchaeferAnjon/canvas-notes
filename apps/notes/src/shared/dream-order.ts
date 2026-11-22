/**
 * 梦游报告里一条一条怎么排、怎么走（task-m552v，demo proto.html）：左栏、中间的条目头「第 i 条，共 N 条」、顶上进度格子、
 * J / K 换条、收下后往下走一条，都按同一个先后。纯函数，界面和单元测试都用。
 */
import type { DreamItem, DreamReport } from './api'
import { fileGroups } from './dream-preview'

/** 左栏里从上到下的先后：归类和改名按去处分的小组（fileGroups）在最上面，再是别的几组（报告里的先后：附件、可视化、补上的双链、可能重复、本周小结） */
export function displayOrder(items: readonly DreamItem[]): DreamItem[] {
  const files = fileGroups([...items]).flatMap((g) => g.items)
  const filed = new Set(files.map((i) => i.id))
  // 归类那几条里没有 move 的（老报告）也排在归类组里，跟在小组后面
  const loose = items.filter((i) => i.group === 'file' && !filed.has(i.id))
  return [...files, ...loose, ...items.filter((i) => i.group !== 'file')]
}

/** 这一条是第几条（从 0 起），不在报告里是 -1 */
export const indexOf = (items: readonly DreamItem[], id: string | null) => displayOrder(items).findIndex((i) => i.id === id)

/** J / K：下一条、上一条（到头了不绕回，给 null） */
export function stepFrom(items: readonly DreamItem[], id: string | null, d: 1 | -1): DreamItem | null {
  const order = displayOrder(items)
  const i = order.findIndex((x) => x.id === id)
  return order[i + d] ?? null
}

/** 收下、丢掉一条以后往下走：它下面第一条没处理的；下面都处理完了才绕回上面（设计稿 2.5「跳到下一条没处理的」） */
export function nextPending(items: readonly DreamItem[], id: string): DreamItem | null {
  const order = displayOrder(items)
  const i = order.findIndex((x) => x.id === id)
  return [...order.slice(i + 1), ...order.slice(0, Math.max(0, i))].find((x) => x.state === 'pending') ?? null
}

/** 顶上进度那一行：一共几条、看过几条（打开过的，处理过的也算）、收下几条、丢掉几条 */
export function progressOf(items: readonly DreamItem[], seen: ReadonlySet<string>) {
  return {
    total: items.length,
    seen: items.filter((i) => seen.has(i.id) || i.state !== 'pending').length,
    taken: items.filter((i) => i.state === 'taken').length,
    dropped: items.filter((i) => i.state === 'dropped').length,
  }
}

/** 这一条改了哪些文件（挪动的两头都算）：目录树里那几行后面一个小点 */
export const touchedBy = (it: DreamItem | null | undefined): string[] => (it ? [...new Set([...it.files, ...(it.move ? [it.move.from, it.move.to] : [])])] : [])

/** 梦游分支上还没收下的可视化：目录树里挂在它的笔记下面、淡着写「没收下」（html 的路径、嵌着它的笔记、报告里那一条） */
export function pendingViz(r: DreamReport | null): { path: string; note: string; item: string }[] {
  if (!r || r.closed) return []
  return r.items.flatMap((i) => {
    if (i.group !== 'viz' || i.state !== 'pending') return []
    const html = i.files.find((f) => /\.html?$/i.test(f))
    const note = i.files.find((f) => /\.md$/i.test(f))
    return html && note ? [{ path: html, note, item: i.id }] : []
  })
}
