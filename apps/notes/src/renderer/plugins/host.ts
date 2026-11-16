/**
 * 界面里插件共用的：插件表（开关和设置，主进程推过来就刷新）、每个网页报上来的插件状态、
 * 右栏网页面板借给插件用的几样本事（给网页发命令、开弹窗、打开网址、提示一句）。
 */
import type { WebviewEl } from '../web/WebView'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { PluginInfo } from '../../shared/plugins'
import type { WebPage } from './types'

// ---------------------------------------------------------------- 插件表

let list: PluginInfo[] = []
let loading: Promise<void> | null = null
const listSubs = new Set<() => void>()

function setList(l: PluginInfo[]) {
  list = l
  listSubs.forEach((f) => f())
}

function load() {
  if (loading) return
  loading = window.cnPlugins.list().then(setList, (e: Error) => {
    loading = null
    console.error('插件表读不出来', e)
  })
  window.cnPlugins.onChanged(setList)
}

/** 所有内置插件（说明、开没开、设置） */
export function usePlugins(): PluginInfo[] {
  useEffect(load, [])
  return useSyncExternalStore(
    (f) => {
      listSubs.add(f)
      return () => listSubs.delete(f)
    },
    () => list,
  )
}

export const pluginInfo = (id: string) => list.find((p) => p.id === id)

export async function setPluginEnabled(id: string, on: boolean) {
  setList(await window.cnPlugins.setEnabled(id, on))
}

export async function setPluginSettings(id: string, patch: Record<string, unknown>) {
  setList(await window.cnPlugins.setSettings(id, patch))
}

// ---------------------------------------------------------------- 网页报上来的状态

/** webContents id → 插件 id → 网页里报的状态 */
let pageStates = new Map<number, Record<string, unknown>>()
const pageSubs = new Set<() => void>()

/** WebView 收到网页预加载的 'cn:plugin' 时调 */
export function pageReported(wcId: number, id: unknown, payload: unknown) {
  if (typeof id !== 'string') return
  const next = new Map(pageStates)
  next.set(wcId, { ...next.get(wcId), [id]: payload })
  pageStates = next
  pageSubs.forEach((f) => f())
}

export const pageStateOf = <T,>(wcId: number, id: string): T | undefined => pageStates.get(wcId)?.[id] as T | undefined

export function usePageState<T>(wcId: number | undefined, id: string): T | undefined {
  const all = useSyncExternalStore(
    (f) => {
      pageSubs.add(f)
      return () => pageSubs.delete(f)
    },
    () => pageStates,
  )
  return wcId === undefined ? undefined : (all.get(wcId)?.[id] as T | undefined)
}

// ---------------------------------------------------------------- 右栏网页面板借给插件的本事

export interface WebHost {
  /** 当前网页 */
  page(): WebPage | null
  /** 右栏现在看得见吗 */
  visible(): boolean
  /** 给某个网页的预加载发命令（preload/plugins/state.ts 的 onHostCommand 收） */
  command(wcId: number, pluginId: string, cmd: string, arg?: unknown): void
  /** 打开右栏网页 */
  show(): void
  /** 开 / 关某个插件的弹窗 */
  openPopup(pluginId: string | null): void
  /** 在右栏打开一个网址（newTab：开新标签） */
  open(url: string, newTab: boolean): void
  notice(t: string): void
  /** 打开设置 · 插件 */
  openSettings(): void
  /** 在中间栏打开库里的一篇 */
  openNote(path: string): void
  /** 当前网页的 <webview>（阅读视图、框着问要它） */
  view(): WebviewEl | null
}

let host: WebHost | null = null
const hostSubs = new Set<() => void>()

/** 右栏网页面板挂上时交进来 */
export function setWebHost(h: WebHost | null) {
  host = h
  hostSubs.forEach((f) => f())
}

export function webHost(): WebHost | null {
  return host
}

/** 当前网页变了要重画的地方（⌘F 命令）用 */
export function useWebPage(): WebPage | null {
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick((n) => n + 1)
    hostSubs.add(f)
    return () => {
      hostSubs.delete(f)
    }
  }, [])
  return host?.page() ?? null
}

// ---------------------------------------------------------------- 中间栏开着的文件

let activePath: string | null = null
const activeSubs = new Set<(p: string | null) => void>()

/** App 换标签时报：中间栏现在开着的文件（不是文件的标签给 null） */
export function setActiveFile(p: string | null) {
  if (p === activePath) return
  activePath = p
  activeSubs.forEach((f) => f(p))
}

/** 插件要知道中间栏开着哪个文件（双语翻译照那门课的术语表翻）；马上给一次现在的 */
export function onActiveFile(f: (p: string | null) => void): () => void {
  activeSubs.add(f)
  f(activePath)
  return () => activeSubs.delete(f)
}

export function errText(e: unknown) {
  return String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
