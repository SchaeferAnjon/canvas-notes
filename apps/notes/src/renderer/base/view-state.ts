/**
 * 数据库块记在本机的两样（设计页「只看不写」：不写文件、不进 Git）：
 * - 当前看哪个视图：按数据源文件夹记视图名（文档里的块、白板上展开的卡是同一个 base 块，切一边另一边跟着换）；
 * - 哪几组收起：按「文件夹 + 视图名」记组的值。
 * 读不了、存不下（隐私模式、localStorage 满了）时照样能切、能收，只是不记。
 */
import { useSyncExternalStore } from 'react'

const VIEW_KEY = 'cn.base.view'
const FOLD_KEY = 'cn.base.fold'
const subs = new Set<() => void>()

function readMap(key: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '{}')
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    // 存的不是那个样子、读不了：当没记
    return {}
  }
}

function writeMap(key: string, m: Record<string, unknown>) {
  try {
    localStorage.setItem(key, JSON.stringify(m))
  } catch {
    // 存不下也照样切、照样收，只是下次不记得
  }
}

/** 内存里的一份（读不了 localStorage 时也能用），变了通知每个画着的块 */
let views: Record<string, unknown> = typeof localStorage === 'undefined' ? {} : readMap(VIEW_KEY)
let folds: Record<string, unknown> = typeof localStorage === 'undefined' ? {} : readMap(FOLD_KEY)
let stamp = 0
const changed = () => {
  stamp++
  for (const f of [...subs]) f()
}
const subscribe = (f: () => void) => (subs.add(f), () => void subs.delete(f))

/** 这个数据库当前看的视图名（没记过是 null：看第一个） */
export function viewNameOf(folder: string | null): string | null {
  const v = folder === null ? undefined : views[folder]
  return typeof v === 'string' ? v : null
}

export function setViewName(folder: string | null, name: string) {
  if (folder === null || views[folder] === name) return
  views = { ...views, [folder]: name }
  writeMap(VIEW_KEY, views)
  changed()
}

const foldKey = (folder: string | null, view: string) => `${folder ?? ''}\n${view}`

/** 这个视图里收起来的组（组的值，空的那组是 ''） */
export function foldedGroups(folder: string | null, view: string): string[] {
  const v = folds[foldKey(folder, view)]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function toggleGroup(folder: string | null, view: string, group: string) {
  const k = foldKey(folder, view)
  const cur = foldedGroups(folder, view)
  const next = cur.includes(group) ? cur.filter((x) => x !== group) : [...cur, group]
  folds = { ...folds }
  if (next.length) folds[k] = next
  else delete folds[k]
  writeMap(FOLD_KEY, folds)
  changed()
}

/** 组件里用：本机记的变了（切了视图、收了一组）就重画 */
export const useViewState = () => useSyncExternalStore(subscribe, () => stamp)
