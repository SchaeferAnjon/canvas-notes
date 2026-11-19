/**
 * 类型筛选（全部 / 文档 / 白板 / 剪藏，文件树多一个「附件」）：不单独占活动栏的入口，是「文件」「最近」顶上同一排；
 * 文件夹首页、中间的「最近」页也是这一排。左栏的那一排「文件」「最近」和摘出来的文件夹共用一个，记在本机。
 * 「附件」只在文件树里有（CN-104：附件挂在用它的那篇笔记下面）；别处选着「附件」时当「全部」。
 */
import { useSyncExternalStore } from 'react'
import type { NoteFile } from '../../shared/api'
import type { FileEntry } from '../../shared/files'

export type TypeFilter = 'all' | 'doc' | 'board' | 'clip' | 'att'
export const TYPE_FILTERS: [TypeFilter, string][] = [
  ['all', '全部'],
  ['doc', '文档'],
  ['board', '白板'],
  ['clip', '剪藏'],
  ['att', '附件'],
]

/** 一篇笔记算哪类：白板；剪来的（剪藏/ 里的、收件箱里带来源的）是剪藏；其余是文档 */
export function noteType(n: Pick<NoteFile, 'kind' | 'board' | 'source'>): Exclude<TypeFilter, 'all' | 'att'> {
  if (n.board) return 'board'
  if (n.kind === 'clip' || (n.kind === 'inbox' && n.source)) return 'clip'
  return 'doc'
}

/** 目录树里的一个文件：md 看笔记是哪类，PDF、HTML 算剪藏，附件/ 里的图和文件是附件 */
export function fileType(f: FileEntry, notes: ReadonlyMap<string, Exclude<TypeFilter, 'all' | 'att'>>): Exclude<TypeFilter, 'all'> {
  if (f.kind === 'img' || f.kind === 'att') return 'att'
  if (f.kind === 'pdf' || f.kind === 'html') return 'clip'
  return notes.get(f.path) ?? 'doc'
}

const KEY = 'cn.typeFilter'
let cur: TypeFilter = (() => {
  try {
    const v = localStorage.getItem(KEY)
    return TYPE_FILTERS.some(([k]) => k === v) ? (v as TypeFilter) : 'all'
  } catch {
    return 'all'
  }
})()
const subs = new Set<() => void>()

/** 左栏共用的那一个 */
export function useSideType(): [TypeFilter, (t: TypeFilter) => void] {
  const v = useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => cur,
  )
  return [v, setSideType]
}

function setSideType(t: TypeFilter) {
  cur = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    // 记不住筛选不影响使用
  }
  for (const s of subs) s()
}

/** att：带不带「附件」（只有文件树带）；没带时选着「附件」显示成「全部」 */
export function TypeChips(props: { value: TypeFilter; onChange(t: TypeFilter): void; className?: string; att?: boolean }) {
  const value = props.value === 'att' && !props.att ? 'all' : props.value
  return (
    <div className={'tchips' + (props.className ? ' ' + props.className : '')} role="tablist" aria-label="类型">
      {TYPE_FILTERS.filter(([k]) => props.att || k !== 'att').map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} className={'chip' + (value === k ? ' on' : '')} onClick={() => props.onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  )
}
