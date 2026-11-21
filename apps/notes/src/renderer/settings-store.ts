/**
 * 软件设置在界面这边的一份（主进程 settings.json 的样子）：App 打开库前先读一次再画书桌（「打开时回到上次的样子」这种
 * 第一帧就要用的不等），之后 useAppSettings 每次改完放进来。深处的组件（编辑器、白板、PDF、网页）用 usePrefs 取自己那一组，
 * 不是 React 的地方（新建笔记、拼网址）用 appSettings()。
 */
import { useSyncExternalStore } from 'react'
import { type AppSettings, DEFAULT_SETTINGS } from '../shared/appearance'

let cur: AppSettings = DEFAULT_SETTINGS
const subs = new Set<() => void>()

export const appSettings = (): AppSettings => cur

export function publishSettings(s: AppSettings) {
  if (s === cur) return
  cur = s
  for (const f of subs) f()
}

/** 取设置里的一块（pick 要返回设置里原有的那个对象或值，不要每次新拼一个） */
export function usePrefs<T>(pick: (s: AppSettings) => T): T {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => pick(cur),
  )
}
