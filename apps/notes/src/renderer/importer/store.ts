/**
 * 导入窗口在哪打开都行（⌘K、设置 › 库、菜单「文件 › 导入旧笔记…」）：这里记一个「请打开」，App 里的 ImportHost 接着开窗口。
 */
import { useSyncExternalStore } from 'react'

let seq = 0
let open = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function openImport() {
  open = ++seq
  emit()
}

export function closeImport() {
  open = 0
  emit()
}

/** 开着时是这次打开的序号，关着是 0 */
export function useImportOpen(): number {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => open,
  )
}
