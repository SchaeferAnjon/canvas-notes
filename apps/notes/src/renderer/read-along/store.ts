/**
 * 长期一起看的网页和笔记（task-kbnc0）在界面这边的状态：
 * - 哪几篇配了哪本书（库里笔记的属性 read-along，App 每次列完笔记交进来）；
 * - 每本书读到哪（库里 .canvas-notes/读到哪.json：开软件、文件变了时读一遍，记的时候先改这里再存盘，停手 1.2 秒才写）；
 * - 右栏现在开着的网页（网址、标题：提示「配成一对？」要它）；
 * - 这台 Mac 上记的「这篇和哪个网站一起开过几次」（cn.coopen，一周内的）、× 掉不再提的提示（cn.readHintOff）；
 * - 书桌（库里 .canvas-notes/书桌/），和这次开着、改动自动记下的那一张。
 */
import { useSyncExternalStore } from 'react'
import type { NoteFile } from '../../shared/api'
import { bookTitle, booksOf, type Desk, inBook, type PagePos, pageHead, type ReadPos, type ReadPositions } from '../../shared/read-along'

type Sub = () => void

function signal<T>(init: T) {
  let v = init
  const subs = new Set<Sub>()
  return {
    get: () => v,
    set(next: T) {
      if (next === v) return
      v = next
      for (const s of [...subs]) s()
    },
    use(): T {
      return useSyncExternalStore(
        (cb) => (subs.add(cb), () => void subs.delete(cb)),
        () => v,
      )
    },
    on(cb: Sub) {
      subs.add(cb)
      return () => void subs.delete(cb)
    },
  }
}

// ---------------------------------------------------------------- 配对

/** 笔记路径 → 配的书（read-along 的值） */
const pairs = signal<ReadonlyMap<string, string>>(new Map())

/** App 每次列完笔记：哪几篇配了书 */
export function setPairNotes(notes: readonly NoteFile[]) {
  const next = new Map(notes.flatMap((n) => (n.readAlong ? [[n.path, n.readAlong] as const] : [])))
  const cur = pairs.get()
  if (next.size === cur.size && [...next].every(([k, v]) => cur.get(k) === v)) return
  pairs.set(next)
}

/** 刚配好、刚解除（文件还没重新列出来时先改这里，标题下、目录树、网页标签当场跟着变） */
export function setPairNow(path: string, book: string | null) {
  const next = new Map(pairs.get())
  if (book) next.set(path, book)
  else next.delete(path)
  pairs.set(next)
}

export const usePairs = () => pairs.use()
export const pairOf = (path: string): string | undefined => pairs.get().get(path)

/** 这个网址是哪几篇配的书（几篇配了同一本时都算） */
export function notesOfUrl(url: string, map: ReadonlyMap<string, string> = pairs.get()): string[] {
  return [...map].filter(([, book]) => inBook(book, url)).map(([p]) => p)
}

// ---------------------------------------------------------------- 读到哪

const positions = signal<ReadPositions>({})
export const usePositions = () => positions.use()
export const positionOf = (book: string): ReadPos | undefined => positions.get()[book]

/** 书名：记过读到哪的用记下的，没有用网址的域名 */
export const bookName = (book: string): string => positionOf(book)?.book || bookTitle(undefined, book)

/** 读到的那段写成什么：小标题，没有小标题写这一页叫什么 */
export const headOf = (p: Pick<PagePos, 'head' | 'title' | 'url'>) => p.head || pageHead(p.title, p.url)

let loadSeq = 0
export function loadPositions(): Promise<void> {
  const mine = ++loadSeq
  return window.cnRead.positions().then((p) => {
    // 正在等着写的：以这边的为准（别让刚读回来的旧文件盖掉刚滚到的地方）
    if (mine !== loadSeq) return
    positions.set({ ...p, ...Object.fromEntries([...pending].map((b) => [b, positions.get()[b]!]).filter(([, v]) => v)) })
  })
}

const pending = new Set<string>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/** 记一本书读到哪：先改这里（标题下「读到」当场变），停手 1.2 秒再存进库 */
export function recordPos(book: string, pos: PagePos, now = new Date()) {
  const was = positions.get()[book]
  const next: ReadPos = { ...pos, book: bookTitle(pos.title, pos.url) || was?.book || '', at: now.toISOString() }
  if (!next.book) delete next.book
  positions.set({ ...positions.get(), [book]: next })
  pending.add(book)
  clearTimeout(timers.get(book))
  timers.set(
    book,
    setTimeout(() => {
      timers.delete(book)
      const p = positions.get()[book]
      if (!p) return
      void window.cnRead.setPosition(book, p).finally(() => pending.delete(book))
    }, 1200),
  )
}

/** 退出、换库前：等着写的马上写 */
export function flushPositions(): Promise<unknown> {
  const all = [...timers.keys()]
  for (const b of all) {
    clearTimeout(timers.get(b))
    timers.delete(b)
  }
  return Promise.all(all.map((b) => positions.get()[b] && window.cnRead.setPosition(b, positions.get()[b]!).finally(() => pending.delete(b))))
}

/**
 * 网页报来读到的地方（人滚的、人翻过来的）：这个网址是哪几本配好对的书，就记到哪几本上；返回记了几本
 */
export function reportPos(pos: PagePos): number {
  const books = booksOf(pairs.get().values(), pos.url)
  for (const b of books) recordPos(b, pos)
  return books.length
}

// ---------------------------------------------------------------- 右栏开着的网页

export interface RightPage {
  url: string
  title: string
}
const right = signal<RightPage | null>(null)
export const useRightPage = () => right.use()
export const rightPage = () => right.get()
export function setRightPage(p: RightPage | null) {
  const cur = right.get()
  if (cur?.url === p?.url && cur?.title === p?.title) return
  right.set(p)
}

// ---------------------------------------------------------------- 一起开过几次（这台 Mac 上记的）

const CO_KEY = 'cn.coopen'
const OFF_KEY = 'cn.readHintOff'
const WEEK = 7 * 86_400_000
/** 同一篇和同一个网站，20 分钟里只算一次 */
const GAP = 20 * 60_000
/** 一周里一起开过这么多次才提 */
export const HINT_AT = 3

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
    // 记坏了的（该是数组的不是数组，task-pyb39）当没记过
    return v !== null && Array.isArray(v) === Array.isArray(fallback) && typeof v === typeof fallback ? v : fallback
  } catch {
    // 记不住就当没记过：只是少一句提示
    return fallback
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // 同上
  }
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

const coVersion = signal(0)
export const useCoOpen = () => coVersion.use()

/** 这篇在中间开着、右栏开着这个网站：记一次（同一对 20 分钟里只记一次） */
export function noteCoOpen(note: string, url: string, now = Date.now()) {
  const host = hostOf(url)
  if (!host || !/^https?:/.test(url)) return
  const all = readJson<Record<string, number[]>>(CO_KEY, {})
  const key = `${note}\n${host}`
  const list = (Array.isArray(all[key]) ? all[key] : []).filter((t) => typeof t === 'number' && now - t < WEEK)
  if (list.length && now - list[list.length - 1]! < GAP) return
  list.push(now)
  all[key] = list
  // 一周以前的整条拿掉
  for (const k of Object.keys(all)) if (!(Array.isArray(all[k]) ? all[k] : []).some((t) => now - t < WEEK)) delete all[k]
  writeJson(CO_KEY, all)
  coVersion.set(coVersion.get() + 1)
}

/** 这周这篇和这个网站一起开过几次 */
export function coOpenCount(note: string, host: string, now = Date.now()): number {
  const list = readJson<Record<string, number[]>>(CO_KEY, {})[`${note}\n${host}`]
  return (Array.isArray(list) ? list : []).filter((t) => now - t < WEEK).length
}

/** × 掉的提示：配对的按「这篇 + 网站」记，书桌的按「这篇」记 */
export const hintKey = (kind: 'pair' | 'desk', note: string, host = '') => `${kind}\n${note}\n${host}`
export function hintOff(key: string) {
  const list = readJson<string[]>(OFF_KEY, [])
  if (!list.includes(key)) writeJson(OFF_KEY, [...list, key])
  coVersion.set(coVersion.get() + 1)
}
export const isHintOff = (key: string) => readJson<string[]>(OFF_KEY, []).includes(key)

export interface Hint {
  kind: 'pair' | 'desk'
  /** 网页那一本叫什么（「动手学深度学习」） */
  title: string
  host: string
  /** 这周一起开了几次 */
  n: number
}

/**
 * 这篇标题下出不出一句提示（只说一次，× 掉不再提）：
 * - 还没配：右栏开着的网站这周和它一起开过 3 次以上 →「配成一对？」
 * - 已经配了一本书，又常和别的网站一起开（一对管不过来）、还没进哪张书桌 →「存成一张书桌？」
 */
export function hintFor(note: string, page: RightPage | null, book: string | undefined, desks: readonly { desk: Desk }[]): Hint | null {
  if (!page || !/^https?:/.test(page.url)) return null
  const host = hostOf(page.url)
  const n = coOpenCount(note, host)
  if (n < HINT_AT) return null
  const title = bookTitle(page.title, page.url)
  if (!book) return isHintOff(hintKey('pair', note, host)) ? null : { kind: 'pair', title, host, n }
  if (inBook(book, page.url) || desks.some((d) => d.desk.notes.includes(note)) || isHintOff(hintKey('desk', note))) return null
  return { kind: 'desk', title, host, n }
}

// ---------------------------------------------------------------- 书桌

export interface DeskEntry {
  file: string
  desk: Desk
}
const desks = signal<readonly DeskEntry[]>([])
export const useDesks = () => desks.use()
export const desksNow = () => desks.get()

let deskSeq = 0
export function loadDesks(): Promise<void> {
  const mine = ++deskSeq
  return window.cnRead.desks().then((d) => {
    if (mine === deskSeq) desks.set(d)
  })
}

/** 这次开着、改动自动记下的那一张（只在这次开软件里；重开软件就没有了） */
const deskOn = signal<string | null>(null)
export const useDeskOn = () => deskOn.use()
export const deskOnNow = () => deskOn.get()
export const setDeskOn = (file: string | null) => deskOn.set(file)
