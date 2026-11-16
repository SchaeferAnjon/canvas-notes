/** 书签管家的数据：和书签栏同一份，主进程说书签变了就重读一遍 */
import { useEffect, useSyncExternalStore } from 'react'
import type { BookmarkRow } from '../../../shared/plugins/bookmarks'
import { pluginInfo } from '../host'

export const ID = 'bookmarks'

let rows: BookmarkRow[] = []
let started = false
const subs = new Set<() => void>()

export function reload() {
  // 书签管家关着时不读（主进程会拒）
  if (!pluginInfo(ID)?.enabled) return
  void window.cnPlugins.call<BookmarkRow[]>(ID, 'list').then(set, (e: Error) => console.error('书签读不出来', e))
}

export function set(r: BookmarkRow[]) {
  rows = r
  subs.forEach((f) => f())
}

function start() {
  if (started) return
  started = true
  window.cnWeb.onBookmarksChanged(reload)
}

export function useBookmarkRows(): BookmarkRow[] {
  // 每个用到的地方挂上时读一遍（插件刚被打开时书签可能已经变过）
  useEffect(() => {
    start()
    reload()
  }, [])
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => rows,
  )
}

/** 收藏或改一个书签（有 id 改那一个，没有按网址收藏） */
export async function saveBookmark(b: { id?: string; url: string; title: string; folder?: string; tags?: string[]; note?: string }) {
  set(await window.cnPlugins.call<BookmarkRow[]>(ID, 'save', b))
}

export async function removeBookmark(id: string) {
  set(await window.cnPlugins.call<BookmarkRow[]>(ID, 'remove', id))
}
