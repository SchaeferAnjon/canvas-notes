/**
 * 类型筛选（全部 / 文档 / 白板 / 素材）：不单独占活动栏的入口，是「文件」「最近」顶上同一排；文件夹首页、中间的「最近」页也是这一排。
 * 左栏的那一排「文件」「最近」和摘出来的文件夹共用一个，记在本机。
 */
import { useSyncExternalStore } from 'react'
import type { NoteFile } from '../../shared/api'
import type { FileEntry } from '../../shared/files'

export type TypeFilter = 'all' | 'doc' | 'board' | 'clip'
export const TYPE_FILTERS: [TypeFilter, string][] = [
  ['all', '全部'],
  ['doc', '文档'],
  ['board', '白板'],
  ['clip', '素材'],
]

/** 一篇笔记算哪类：白板；剪来的（素材/ 里的、收件箱里带来源的）是素材；其余是文档 */
export function noteType(n: Pick<NoteFile, 'kind' | 'board' | 'source'>): Exclude<TypeFilter, 'all'> {
  if (n.board) return 'board'
  if (n.kind === 'clip' || (n.kind === 'inbox' && n.source)) return 'clip'
  return 'doc'
}

/** 目录树里的一个文件：md 看笔记是哪类，PDF、HTML 算素材 */
export function fileType(f: FileEntry, notes: ReadonlyMap<string, Exclude<TypeFilter, 'all'>>): Exclude<TypeFilter, 'all'> {
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

export function TypeChips(props: { value: TypeFilter; onChange(t: TypeFilter): void; className?: string }) {
  return (
    <div className={'tchips' + (props.className ? ' ' + props.className : '')} role="tablist" aria-label="类型">
      {TYPE_FILTERS.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={props.value === k} className={'chip' + (props.value === k ? ' on' : '')} onClick={() => props.onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  )
}
