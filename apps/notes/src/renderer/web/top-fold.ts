/**
 * 网页栏顶上（task-sta8n，方向 A「紧凑两档」）记在本机的两样：顶上收没收成一行、书签栏开没开（默认不摆，在「⋯ › 书签」里开）。
 * 组头右边的 ⌃（Dock 的组头）、⇧⌘\、⇧⌘B、网页面板自己都读写这一份。
 */
import { useSyncExternalStore } from 'react'

const FOLD_KEY = 'cn.webTopFold'
const BM_KEY = 'cn.webBookmarksBar'

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    // 读不到本机存的：当没收、没开
    return false
  }
}

function write(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0')
  } catch {
    // 存不下只是下次不记得
  }
}

export interface WebTop {
  /** 顶上收成一行 */
  fold: boolean
  /** 书签栏摆出来 */
  bm: boolean
}

let state: WebTop = { fold: read(FOLD_KEY), bm: read(BM_KEY) }
const subs = new Set<() => void>()

function set(next: Partial<WebTop>) {
  state = { ...state, ...next }
  if (next.fold !== undefined) write(FOLD_KEY, next.fold)
  if (next.bm !== undefined) write(BM_KEY, next.bm)
  subs.forEach((f) => f())
}

export const webTopNow = () => state

export function useWebTop(): WebTop {
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state,
  )
}

export const setTopFold = (fold: boolean) => set({ fold })
export const toggleTopFold = () => set({ fold: !state.fold })
export const toggleBookmarksBar = () => set({ bm: !state.bm })
