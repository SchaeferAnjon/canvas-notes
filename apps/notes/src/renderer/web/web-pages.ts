/**
 * 界面这边记的两样（AI 操纵哪个网页用，shared/web-pages.ts 排）：
 * - 每个网页现在是哪个 webContents：右栏是它当前那个标签的，中间栏的按标签 id；
 * - 用户最后点进、切到的是哪一页（key：right 或中间标签的 id）：不给 page 时 AI 默认操纵它。
 */
import { useSyncExternalStore } from 'react'

const wcs = new Map<string, number>()
let last: string | null = null
const subs = new Set<() => void>()

/** 这一页（right、中间标签的 id）现在的 webContents；null 是没了 */
export function noteWebWc(key: string, wc: number | null) {
  if (wc === null) wcs.delete(key)
  else wcs.set(key, wc)
}

export const wcOf = (key: string): number | undefined => wcs.get(key)

/** 用户点进了、切到了这一页 */
export function touchWeb(key: string) {
  if (last === key) return
  last = key
  for (const f of subs) f()
}

/** 拿到焦点的 webContents 是哪一页的 */
export function touchWc(wc: number) {
  for (const [k, v] of wcs) if (v === wc) return touchWeb(k)
}

export const lastWeb = () => last

/** 最后点过的那一页变了就重画（「看得到」那一行） */
export function useLastWeb(): string | null {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => void subs.delete(f)),
    () => last,
  )
}
