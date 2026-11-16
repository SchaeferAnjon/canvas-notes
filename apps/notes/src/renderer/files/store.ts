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

function refresh() {
  const mine = ++seq
  void window.cnFiles.all().then((next) => {
    if (mine !== seq) return
    files = next
    loaded = true
    emit()
  })
}

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
