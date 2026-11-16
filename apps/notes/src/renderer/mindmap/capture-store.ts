/**
 * 拍导图窗口在哪打开都行（⌘K、菜单、白板工具板）：这里记一个「请打开」，App 里的 CaptureHost 接着开窗口。
 * 刚做好的导图白板记在 growing 里，白板第一次画它时节点一个个长出来。
 */
import { useSyncExternalStore } from 'react'

export interface CaptureRequest {
  seq: number
  /** 从哪门课进来的（课程首页的「拍一张」），AI 先按这门课填 */
  course?: string
  /** 做好以后（白板工具板拖出来的：在落点放一张指向它的卡片） */
  onPlaced?(path: string): void
}

let req: CaptureRequest | null = null
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function openCapture(o: Omit<CaptureRequest, 'seq'> = {}) {
  req = { ...o, seq: ++seq }
  emit()
}

export function closeCapture() {
  req = null
  emit()
}

export function useCaptureRequest(): CaptureRequest | null {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => req,
  )
}

const growing = new Set<string>()
export const markGrow = (path: string) => growing.add(path)
/** 这块白板要不要放长出来的动画（只放一次） */
export const takeGrow = (path: string) => growing.delete(path)
