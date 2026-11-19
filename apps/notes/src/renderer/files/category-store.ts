/**
 * 顶级分类改过的「放什么」在界面这边的一份（分类的首页头上、首页的分类卡共用）。
 * 改的时候先改这份（马上变），再交主进程写进 .canvas-notes/分类.json。
 */
import { useSyncExternalStore } from 'react'
import { type CategoryDescs, descOf } from '../../shared/categories'

let descs: CategoryDescs = {}
let version = 0
const subs = new Set<() => void>()
const emit = () => {
  version++
  for (const s of subs) s()
}

/** 打开库、库里文件变了（拉下来别的电脑改的）时重读 */
export async function loadDescs() {
  descs = await window.cnFolder.descs()
  emit()
}

export async function setDesc(name: string, text: string) {
  descs = { ...descs, [name]: text }
  emit()
  descs = await window.cnFolder.setDesc(name, text)
  emit()
}

/** 一类现在的「放什么」 */
export function useDesc(): (name: string) => string {
  useSyncExternalStore(
    (cb) => {
      subs.add(cb)
      return () => subs.delete(cb)
    },
    () => version,
  )
  return (name) => descOf(descs, name)
}
