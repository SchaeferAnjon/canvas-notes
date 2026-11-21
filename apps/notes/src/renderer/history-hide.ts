/**
 * 「历史里藏起软件自己的设置文件」（CN-116 方向 A，默认开，记在本机）：历史头上「⋯」和设置 › Git和同步是同一个开关，
 * 一边改了另一边当场跟着变。
 */
import { useSyncExternalStore } from 'react'

const HIDE_KEY = 'cn.historyHideInternal'
const subs = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) !== '0'
  } catch {
    return true
  }
}

let hide = read()

export function setHideInternal(v: boolean) {
  hide = v
  try {
    localStorage.setItem(HIDE_KEY, v ? '1' : '0')
  } catch {
    // 记不住只影响下次打开
  }
  for (const f of subs) f()
}

export const useHideInternal = () =>
  useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => hide,
  )
