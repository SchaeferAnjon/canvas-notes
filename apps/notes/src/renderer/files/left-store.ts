/**
 * 左栏的设置（摘到活动栏的文件夹、文件夹的图标和颜色）在界面这边的一份：活动栏、目录树、文件夹首页的头、图标弹层共用。
 * 改的时候先改这份（界面马上变），再交主进程写进 .canvas-notes/左栏.json。
 */
import { useSyncExternalStore } from 'react'
import type { FolderEntry } from '../../shared/folder-home'
import { defaultLeft, FOLDER_COLORS, type LeftConfig, lookOf } from '../../shared/left'
import { folderIcon } from '../folder-home/icons'

let cfg: LeftConfig = defaultLeft()
/** 有组件首页的文件夹在 .首页.json 里选过的图标和颜色（老的设法）：左栏.json 里没设时用它 */
let homes = new Map<string, FolderEntry>()
let version = 0
/** 正在写：这时候文件变了的通知读到的还是旧的，不拿它盖掉刚改的 */
let writing = 0
const subs = new Set<() => void>()
const emit = () => {
  version++
  for (const s of subs) s()
}

/** 打开库、库里文件变了（拉下来别的电脑改的）时重读 */
export async function loadLeft() {
  const c = await window.cnFolder.left()
  if (writing) return
  cfg = c
  emit()
}

export const leftConfig = () => cfg

export async function updateLeft(fn: (c: LeftConfig) => LeftConfig) {
  const next = fn(cfg)
  if (next === cfg) return
  cfg = next
  emit()
  writing++
  try {
    cfg = await window.cnFolder.setLeft(next)
  } finally {
    writing--
  }
  emit()
}

export function setHomeLooks(list: FolderEntry[]) {
  homes = new Map(list.map((f) => [f.folder, f]))
  emit()
}

export function useLeft(): LeftConfig {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version,
  )
  return cfg
}

/** 一个文件夹现在的图标和颜色：自己设的 → 首页里选过的 → 默认（课程书架、收件箱、普通文件夹） */
export function folderLook(folder: string): { icon: string; color: string | null; own: boolean } {
  const own = cfg.looks[folder]
  if (own) return { ...lookOf(cfg, folder), own: true }
  const h = homes.get(folder)
  // 只认挑过颜色的（没挑过的是默认图标，课程的 sigma 在树上不如书架好认）
  if (h?.color) return { icon: folderIcon(h.icon), color: h.color, own: false }
  return { ...lookOf(cfg, folder), own: false }
}

export const colorHex = (c: keyof typeof FOLDER_COLORS) => FOLDER_COLORS[c]
