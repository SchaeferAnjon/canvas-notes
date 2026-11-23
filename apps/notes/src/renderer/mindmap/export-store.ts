/**
 * 「导出导图…」的请求（第二批 ④⑫）：⌘K、标签条「⋯」里点了，记下哪一篇、先选哪种格式；
 * 那块导图画出来的 MindmapLayer 接走、打开导出弹窗（在文档看法里点的，先切到白板再开）。
 */
import { useSyncExternalStore } from 'react'

export type ExportFormat = 'png' | 'svg' | 'pdf' | 'opml'

let want: { path: string; fmt?: ExportFormat; seq: number } | null = null
const subs = new Set<() => void>()

export function requestExport(path: string, fmt?: ExportFormat) {
  want = { path, ...(fmt ? { fmt } : {}), seq: (want?.seq ?? 0) + 1 }
  for (const f of subs) f()
}

/** 这一篇有没有人要导出（拿到以后 takeExport 清掉） */
export function useExportRequest(path: string): { fmt?: ExportFormat; seq: number } | null {
  const w = useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => want,
  )
  return w && w.path === path ? w : null
}

export function takeExport(seq: number) {
  if (want?.seq === seq) want = null
}
