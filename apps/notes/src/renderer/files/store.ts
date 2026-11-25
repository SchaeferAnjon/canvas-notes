/**
 * 库里的全部文件（md、PDF、HTML、文件夹）：⌘O 和目录树共用一份，文件一变（包括 PDF、HTML）就重新列。
 * 另外记着最近打开过的文件（本机，⌘O 空着时列出来）。
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { type FileEntry, hideTodos } from '../../shared/files'
import type { HistoryEntry } from '../../shared/web-api'
import { usePrefs } from '../settings-store'
import { ipcOn } from '../crash/ipc'

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
  forget()
  if (watching > 0) refresh()
}

/**
 * listFiles 记着的那一份。库里文件一变（外面来的报 files:changed，软件自己动的走 refreshVaultFiles）：歇 300 ms 重新列，
 * 列好之前先用旧的（⌘ 悬停不等主进程；刚新建的一篇认不出时 cite.tsx 会要一份新的再认）
 */
let listed: Promise<FileEntry[]> | null = null
let gen = 0
let listening = false
let relist: ReturnType<typeof setTimeout> | undefined
function fetchList(): Promise<FileEntry[]> {
  const g = gen
  const p = window.cnFiles.all()
  p.then(
    (v) => {
      if (g === gen) listed = Promise.resolve(v)
    },
    () => {},
  )
  return p
}
function forget() {
  gen++
  if (!listed) return
  clearTimeout(relist)
  relist = setTimeout(() => void fetchList(), 300)
}

/**
 * 库里的全部文件，记着用：主进程每次都把整个库走一遍、每个文件 stat 一次（2000 篇的库 110–160 ms），
 * ⌘ 悬停弹出那一篇、引用认链接不能每次都等它（⌘预览常驻）。fresh：不用记着的，重新列一遍
 */
export function listFiles(fresh = false): Promise<FileEntry[]> {
  if (!listening) {
    listening = true
    ipcOn(window.cn.onFilesChanged, 'cn.onFilesChanged')(forget)
  }
  if (listed && !fresh) return listed
  const p = fetchList()
  if (!listed) {
    listed = p
    p.catch(() => listed === p && (listed = null))
  }
  return p
}

function refresh() {
  const mine = ++seq
  void window.cnFiles.all().then((next) => {
    if (mine !== seq) return
    files = next
    listed = Promise.resolve(next)
    loaded = true
    emit()
  })
}

/** 现在知道的文件（目录树开过才有；「移到」菜单拿它补上空文件夹） */
export const vaultFiles = (): readonly FileEntry[] => files

/**
 * 库里的全部文件；第一次用时列一遍，之后跟着文件变化。
 * 设置 › 文件没开「文件树里显示待办」时，名字叫「待办」的笔记记上 hidden：目录树、文件夹首页的文件列表（buildTree）不画、篇数不算，
 * ⌘O 照样找得到（task-pd1d1）
 */
export function useVaultFiles(): { files: FileEntry[]; loaded: boolean } {
  const showTodo = usePrefs((s) => s.files.showTodo)
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
      off = ipcOn(window.cn.onFilesChanged, 'cn.onFilesChanged')(refresh)
    }
    return () => {
      if (--watching === 0) {
        off?.()
        off = null
      }
    }
  }, [])
  const shown = useMemo(() => (showTodo ? files : hideTodos(files)), [files, showTodo])
  return { files: shown, loaded }
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

/** 打开了一个文件：放到最近打开的最前面（最多记 30 个）；PDF、HTML 另记下打开的时间（左栏「最近」按它排） */
export function fileOpened(path: string) {
  const next = [path, ...recentFiles().filter((p) => p !== path)].slice(0, 30)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // 记不住最近打开不影响使用
  }
  if (/\.(pdf|html?)$/i.test(path)) docOpened(path)
}

// ---------- PDF、HTML 最后打开的时间（本机，「最近」列它们，2026-11-24） ----------

const OPENED_KEY = 'cn.openedAt'
/** 最多记这么多个（老的挤掉） */
const OPENED_MAX = 300
let openedAt: ReadonlyMap<string, number> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(OPENED_KEY) ?? '{}') as unknown
    return new Map(v && typeof v === 'object' ? Object.entries(v).filter((e): e is [string, number] => typeof e[1] === 'number') : [])
  } catch {
    return new Map()
  }
})()
const openedSubs = new Set<() => void>()

function docOpened(path: string, at = Date.now()) {
  const next = new Map([[path, at], ...[...openedAt].filter(([p]) => p !== path).sort((a, b) => b[1] - a[1]).slice(0, OPENED_MAX - 1)])
  openedAt = next
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify(Object.fromEntries(next)))
  } catch {
    // 记不住打开时间：「最近」里少这一条，不影响使用
  }
  for (const f of openedSubs) f()
}

/** PDF、HTML（库里路径）→ 最后打开的时间 */
export function useOpenedAt(): ReadonlyMap<string, number> {
  return useSyncExternalStore(
    (f) => (openedSubs.add(f), () => void openedSubs.delete(f)),
    () => openedAt,
  )
}

// ---------- 「最近删掉的」有几篇（task-5yp97）：目录树最底下那一行的数 ----------

/**
 * 库里的文件变了（删了、放回了、撤回了）就重数一次（隔 150 毫秒，连着变只数一次）；还没数出来是 null。
 * 不是 Git 库、git 出错时数不出来：照样是 null，那一行不写数
 */
export function useTrashCount(dep: unknown): number | null {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    let live = true
    const t = setTimeout(
      () =>
        void window.cn.trashRecent().then(
          // 篇数：一组附件（attachOf）不算一篇
          (l) => live && setN(l.filter((i) => !i.attachOf).length),
          () => live && setN(null),
        ),
      150,
    )
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [dep])
  return n
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

// ---------- 右栏看过的网页（左栏「最近」列它们；主进程存在设置目录，不进库，2026-11-24） ----------

/** 看过的网页，最近的在前；设置里关了「记下看过的网页」时是空的 */
export function useRecentWeb(): HistoryEntry[] {
  const keep = usePrefs((s) => s.web.keepRecent)
  const [list, setList] = useState<HistoryEntry[]>([])
  useEffect(() => {
    if (!keep) return setList([])
    let live = true
    const load = () => void window.cnWeb.recent().then((l) => live && setList(l))
    load()
    const off = ipcOn(window.cnWeb.onRecentChanged, 'cnWeb.onRecentChanged')(load)
    return () => {
      live = false
      off()
    }
  }, [keep])
  return list
}
