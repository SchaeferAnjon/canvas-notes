/**
 * 库里的全部文件（md、PDF、HTML、文件夹）：⌘O 和目录树共用一份，文件一变（包括 PDF、HTML）就重新列。
 * 另外记着最近打开过的文件（本机，⌘O 空着时列出来）。
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { FileEntry } from '../../shared/files'

let files: FileEntry[] = []
let loaded = false
const subs = new Set<() => void>()
let watching = 0
let off: (() => void) | null = null
let seq = 0

function emit() {
  for (const s of subs) s()
}

/**
 * 重新列一遍。监听只报外面来的改动（软件自己新建、改名的文件，主进程早记下了内容，不再报），
 * 所以界面自己动了文件后（App 的 refreshNotes）也调这里，目录树、⌘O 才跟上
 */
export function refreshVaultFiles() {
  if (watching > 0) refresh()
}

function refresh() {
  const mine = ++seq
  void window.cnFiles.all().then((next) => {
    if (mine !== seq) return
    files = next
    loaded = true
    emit()
  })
}

/** 现在知道的文件（目录树开过才有；「移到」菜单拿它补上空文件夹） */
export const vaultFiles = (): readonly FileEntry[] => files

/** 库里的全部文件；第一次用时列一遍，之后跟着文件变化 */
export function useVaultFiles(): { files: FileEntry[]; loaded: boolean } {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => files,
  )
  useEffect(() => {
    if (watching++ === 0) {
      refresh()
      off = window.cn.onFilesChanged(refresh)
    }
    return () => {
      if (--watching === 0) {
        off?.()
        off = null
      }
    }
  }, [])
  return { files, loaded }
}

/** 只看现在知道的文件、跟着变，自己不去列（AI「看得到」的文件夹篇数：文件夹首页开着时它在列） */
export function useKnownFiles(): readonly FileEntry[] {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => files,
  )
}

// ---------- 最近打开 ----------

const RECENT_KEY = 'cn.recentFiles'

export function recentFiles(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 打开了一个文件：放到最近打开的最前面（最多记 30 个） */
export function fileOpened(path: string) {
  const next = [path, ...recentFiles().filter((p) => p !== path)].slice(0, 30)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // 记不住最近打开不影响使用
  }
}

// ---------- 换到「文件」时要定位的（摘出来的文件夹「在「文件」里看位置」） ----------

let reveal: string | null = null
/** 开着的那棵「文件」树（开着时马上定位，不用等下一次出来） */
let revealNow: ((path: string, open?: boolean, more?: string[]) => void) | null = null
/**
 * 下一次「文件」那棵树出来时展开到这里、一圈外圈；树正开着就马上。
 * open：这个文件夹自己也展开；more：一起亮的几行（历史里「放回」整个文件夹以后：文件夹和放回的几篇都亮约 2 秒，同 CN-108 小样）
 */
export function requestReveal(path: string, open = false, more?: string[]) {
  if (revealNow) return revealNow(path, open, more)
  reveal = path
}
/** 开着的「文件」树登记自己；返回撤销登记 */
export function onReveal(f: (path: string, open?: boolean, more?: string[]) => void): () => void {
  revealNow = f
  return () => {
    if (revealNow === f) revealNow = null
  }
}
/** 树拿走这个请求（拿一次就没了） */
export function takeReveal(): string | null {
  const r = reveal
  reveal = null
  return r
}

// ---------- 目录树里点过的文件夹（新建笔记放进它里面） ----------

let picked: string | null = null

/** 目录树开着、里面点过一个文件夹时是那个文件夹，否则 null */
export const treePicked = () => picked

export function setTreePicked(folder: string | null) {
  picked = folder
}

// ---------- 刚放回的（历史里「放回」以后，文件夹首页那张卡写「刚放回」、亮一圈约 2 秒，CN-108 小样） ----------

let restored: ReadonlyMap<string, number> = new Map()
const restoredSubs = new Set<() => void>()
/** 放回了这几个文件（撤回放回时 back=false 去掉） */
export function markRestored(paths: string[], back = true) {
  const next = new Map(restored)
  for (const p of paths) back ? next.set(p, Date.now()) : next.delete(p)
  restored = next
  for (const f of restoredSubs) f()
}
/** 放回过的文件 → 放回的时间（这次开软件以来） */
export function useRestored(): ReadonlyMap<string, number> {
  return useSyncExternalStore(
    (f) => (restoredSubs.add(f), () => void restoredSubs.delete(f)),
    () => restored,
  )
}
