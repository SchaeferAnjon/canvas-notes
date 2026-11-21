/**
 * 左栏选了好几个交给 AI（task-0tgz2，用户 r20「多选文件之后 能不能也加一个AI的接口可以处理」，偏好「多选文件能交给 AI」）：
 * 选中那一条底栏的「问AI」、右键「问 AI」把这几个记在这里；AI 那一格「看得到」写「选中的5个」，问候和快捷命令换成「好几篇」的，
 * 每一轮把这些文件（文件夹算里面的笔记）交给 AI。换了标签就拿掉（和文档里 ⌘J 带进来的那段一样）。
 */
import { useSyncExternalStore } from 'react'
import type { FileEntry } from '../shared/files'
import { titleOf } from '../shared/layout'

/** 选中的一个：dir 是文件夹 */
export interface PickItem {
  path: string
  dir: boolean
}

export interface Picked {
  items: PickItem[]
  /** 那时开着的标签（换了标签就拿掉） */
  tab: string | null
}

let cur: Picked | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((s) => s())

export function pickForAi(items: PickItem[], tab: string | null) {
  cur = items.length ? { items, tab } : null
  emit()
}

export function dropPicked() {
  if (!cur) return
  cur = null
  emit()
}

export const usePicked = (): Picked | null =>
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => cur,
  )

const READABLE = new Set(['md', 'pdf', 'html'])

/** 选中的展开成文件：文件照旧，文件夹换成里面所有的笔记、PDF、HTML（子文件夹里的也算，附件不算）；去重、按选的顺序 */
export function pickedFiles(items: readonly PickItem[], files: readonly FileEntry[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const add = (p: string) => {
    if (seen.has(p)) return
    seen.add(p)
    out.push(p)
  }
  for (const it of items) {
    if (!it.dir) add(it.path)
    else for (const f of files) if (READABLE.has(f.kind) && f.path.startsWith(it.path + '/')) add(f.path)
  }
  return out
}

/** 「看得到」那颗的悬停提示：一个一行，文件夹写里面几篇 */
export function pickTip(items: readonly PickItem[], files: readonly FileEntry[]): string {
  return items.map((it) => (it.dir ? `${it.path.split('/').pop()}（${pickedFiles([it], files).length}篇）` : titleOf(it.path))).join('\n')
}
