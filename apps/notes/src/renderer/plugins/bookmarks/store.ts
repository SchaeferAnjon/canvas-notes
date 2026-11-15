/** 书签管家的数据：和书签栏同一份，主进程说书签变了就重读一遍；书签首页挪书签（arrange）和稍后再看 */
import { useEffect, useSyncExternalStore } from 'react'
import type { Arrange, LaterItem } from '../../../shared/plugins/bookmark-home'
import type { BookmarkRow } from '../../../shared/plugins/bookmarks'
import { pluginInfo } from '../host'

export const ID = 'bookmarks'

/** 主进程 home 方法给的（main/plugins/bookmarks/home.ts） */
export interface HomeData {
  later: LaterItem[]
}

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

// ---------------------------------------------------------------- 书签首页

let home: HomeData = { later: [] }
const homeSubs = new Set<() => void>()

function setHome(h: HomeData) {
  home = h
  homeSubs.forEach((f) => f())
}

export function useHome(): HomeData {
  useEffect(() => {
    if (pluginInfo(ID)?.enabled) void window.cnPlugins.call<HomeData>(ID, 'home').then(setHome, (e: Error) => console.error('书签首页读不出来', e))
  }, [])
  return useSyncExternalStore(
    (f) => {
      homeSubs.add(f)
      return () => homeSubs.delete(f)
    },
    () => home,
  )
}

/** 调主进程改稍后再看（addLater、laterDone、removeLater），拿回来的就是新的 */
export async function homeCall(method: 'addLater' | 'laterDone' | 'removeLater', ...args: unknown[]) {
  setHome(await window.cnPlugins.call<HomeData>(ID, method, ...args))
}

/** 挪书签（合并成分组、排序、改分组名）：先在界面上改（拖完立刻看到），再让主进程一次写盘 */
export async function arrange(changes: Arrange[]) {
  if (!changes.length) return
  const by = new Map(changes.map((c) => [c.id, c]))
  set(rows.map((b) => (by.has(b.id) ? { ...b, ...by.get(b.id) } : b)))
  set(await window.cnPlugins.call<BookmarkRow[]>(ID, 'arrange', changes))
}
