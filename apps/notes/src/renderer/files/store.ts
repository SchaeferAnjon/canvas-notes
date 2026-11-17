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
/** 下一次「文件」那棵树出来时展开到这里、一圈外圈 */
export function requestReveal(path: string) {
  reveal = path
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
