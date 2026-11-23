/**
 * 「补进导图」放进去以后，新的几处在导图上一个个长出来（偏好「导图长出来的动画」）：
 * 放之前在这里记一下哪块白板、哪几处（新节点的 pathKey，空框写成「<key>#blank」），MindmapLayer 画到新的字时照这个顺序一个个露出来。
 */
import { useSyncExternalStore } from 'react'

export interface GrowRequest {
  seq: number
  path: string
  keys: string[]
}

let req: GrowRequest | null = null
let seq = 0
const subs = new Set<() => void>()

export function growOnMap(path: string, keys: string[]) {
  req = { seq: ++seq, path, keys }
  subs.forEach((f) => f())
}

export function useMapGrow(path: string): GrowRequest | null {
  const r = useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => req,
  )
  return r && r.path === path ? r : null
}
