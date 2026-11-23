/**
 * 拍导图窗口在哪打开都行（⌘K、菜单、白板工具板、/ 菜单）：这里记一个「请打开」，App 里的 CaptureHost 接着开窗口。
 * 刚做好的导图白板记在 growing 里，白板第一次画它时节点一个个长出来。
 * 开着的白板登记「在我这儿放一张导图卡」（boardCapture）：⌘K、⇧⌘C、菜单在白板看法里拍，导图就是这块白板的子白板。
 */
import { useSyncExternalStore } from 'react'
import type { MapNode } from '@cn/format'
import type { PlaceInto, Placed } from '../../shared/mindmap'

export interface CaptureRequest {
  seq: number
  /** 从哪门课进来的（课程首页的「拍一张」），AI 先按这门课填 */
  course?: string
  /** 挂在哪（task-wuv05）：父白板 / 那篇笔记；不给是进收件箱 */
  into?: PlaceInto
  /** 做好以后：在父白板落点放一张子白板卡、在笔记光标处插缩略图块，再三样一起提交（mindmap/place.ts） */
  onPlaced?(r: Placed): Promise<void> | void
  /**
   * 不拍照，直接拿一棵树进 ② 核对（费曼「拍成导图」：这一轮讲的整理成的树）：没有照片，名字用 title，
   * 第一步写成 step1（「讲」）
   */
  seed?: { title: string; roots: MapNode[]; step1: string; said: string }
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

/** 前面那块白板：在它屏幕正中那一列放一张导图卡（同点工具板「拍导图」） */
export interface BoardCapture {
  path: string
  capture(): void
  /** 费曼「拍成导图」：不拍照，拿这棵树进 ② 核对；near 是材料那张卡的开头，导图卡放进它那一列的末尾（不放进费曼那一节） */
  seeded?(seed: NonNullable<CaptureRequest['seed']>, near?: string): void
}
let board: BoardCapture | null = null
/** 白板在前面时登记，退到后面、关掉时拿掉（只拿自己的那一个：换标签时新的一块可能先登记了） */
export function setBoardCapture(b: BoardCapture | null, mine?: BoardCapture) {
  if (b) board = b
  else if (board === mine) board = null
}
export const boardCapture = (path: string): BoardCapture | null => (board?.path === path ? board : null)
